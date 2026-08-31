(function () {
  // ===== CONFIGURAÇÃO =====
  // Os dois valores abaixo são públicos por natureza (não são segredos):
  // quem autoriza de fato é o Apps Script, conferindo o login com o Google
  // e procurando o e-mail na aba "Usuarios" da planilha.
  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbwlZUq4YClqfq9UeHXB8qPLe058FpEVZyD1yrZNpZ_ge937eo42yXoVOGZ4jBn9Bwvx/exec',
    // Client ID criado no Google Cloud Console (ver apps-script/README.md).
    // Precisa ser idêntico ao CLIENT_ID do Code.gs.
    GOOGLE_CLIENT_ID: '725408565457-tva4ijg1dvu1mdfb0tcvj0d87fml43k2.apps.googleusercontent.com',
  };

  const STATUS_LIST = ['Pendente', 'Devedor', 'Finalizado'];
  const STATUS_CLASS = { Pendente: 'badge-pendente', Devedor: 'badge-devedor', Finalizado: 'badge-finalizado' };
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const loginScreen = document.getElementById('login-screen');
  const loginStatus = document.getElementById('login-status');
  const gsiButton = document.getElementById('gsi-button');
  const appEl = document.getElementById('app');

  const mainEl = document.getElementById('main');
  const tabsEl = document.getElementById('tabs');
  const fabNew = document.getElementById('fab-new');
  const userChip = document.getElementById('user-chip');

  const modalNew = document.getElementById('modal-new');
  const modalDetail = document.getElementById('modal-detail');
  const modalAccount = document.getElementById('modal-account');
  const detailBody = document.getElementById('detail-body');
  const accountBody = document.getElementById('account-body');

  const fCategoria = document.getElementById('f-categoria');
  const fTipoWrap = document.getElementById('f-tipo-wrap');
  const fTipo = document.getElementById('f-tipo');
  const fCliente = document.getElementById('f-cliente');
  const fTelefone = document.getElementById('f-telefone');
  const fEndereco = document.getElementById('f-endereco');
  const fDescricao = document.getElementById('f-descricao');
  const fValor = document.getElementById('f-valor');
  const fPrevisao = document.getElementById('f-previsao');
  const fFotos = document.getElementById('f-fotos');
  const fFotosLabel = document.getElementById('f-fotos-label');
  const fSubmit = document.getElementById('f-submit');
  const newStatus = document.getElementById('new-status');

  let idToken = null;
  let currentUser = null;
  let items = [];
  // Quantos finalizados antigos o servidor deixou de fora, e se o usuário
  // pediu para ver o histórico completo.
  let ocultos = 0;
  let verHistorico = false;
  let activeTab = 'Todos';
  let categoriaValue = 'Automotivo';
  let tipoValue = 'Carro';

  // ===== Utilidades =====
  function setStatusMsg(el, msg, kind) {
    if (!el) return;
    el.innerHTML = msg ? '<div class="status ' + kind + '">' + escapeHtml(msg) + '</div>' : '';
  }

  function escapeHtml(str) {
    return (str || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatDateTime(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // ===== Login com Google =====
  // O "crachá" (ID token) fica só na memória da aba aberta. Fechou o app,
  // some — nada de credencial guardada no aparelho.
  function onCredential(response) {
    idToken = response.credential;
    startSession();
  }

  function initGoogleLogin() {
    if (CONFIG.GOOGLE_CLIENT_ID.indexOf('COLE_AQUI') === 0) {
      setStatusMsg(loginStatus, 'O login com Google ainda não foi configurado. Veja apps-script/README.md.', 'err');
      return;
    }
    if (!window.google || !google.accounts || !google.accounts.id) {
      setStatusMsg(loginStatus, 'Não foi possível carregar o login do Google. Verifique sua conexão.', 'err');
      return;
    }
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: onCredential,
    });
    google.accounts.id.renderButton(gsiButton, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      locale: 'pt-BR',
      width: 260,
    });
    // Não usamos o "One Tap" (auto_select + prompt): em navegadores móveis
    // e com bloqueio de cookies de terceiros ele costuma falhar de forma
    // confusa (inclusive com erro de origem) mesmo com tudo configurado
    // certo. O botão explícito é mais lento em um toque, mas muito mais
    // confiável entre aparelhos.
  }

  function waitForGoogle(tries) {
    if (window.google && google.accounts && google.accounts.id) return initGoogleLogin();
    if (tries <= 0) {
      setStatusMsg(loginStatus, 'Não foi possível carregar o login do Google. Verifique sua conexão.', 'err');
      return;
    }
    setTimeout(() => waitForGoogle(tries - 1), 300);
  }

  function showLogin(message) {
    idToken = null;
    currentUser = null;
    appEl.hidden = true;
    loginScreen.style.display = 'flex';
    if (message) setStatusMsg(loginStatus, message, 'err');
  }

  function logout() {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    closeModal(modalAccount);
    showLogin('Você saiu da sua conta.');
  }

  async function startSession() {
    setStatusMsg(loginStatus, 'Verificando acesso...', 'info');
    try {
      const res = await api('session', {});
      currentUser = res.user;
      loginScreen.style.display = 'none';
      appEl.hidden = false;
      setStatusMsg(loginStatus, '', '');
      renderUserChip();
      await loadItems();
    } catch (err) {
      showLogin(err.message);
    }
  }

  // ===== API =====
  async function api(action, payload) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('COLE_AQUI') === 0) {
      throw new Error('O app ainda não foi conectado à planilha.');
    }
    const body = Object.assign({ action, idToken }, payload);
    const corpo = JSON.stringify(body);

    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: corpo,
      });
    } catch (e) {
      // fetch só rejeita por falha de rede, então a mensagem crua ("Failed
      // to fetch") não ajuda quem está usando. O tamanho do envio costuma
      // ser o culpado quando há fotos.
      const mb = (corpo.length / 1048576).toFixed(1);
      throw new Error(
        corpo.length > 4 * 1048576
          ? 'O envio ficou grande demais (' + mb + ' MB) e não completou. Tente com menos fotos por vez.'
          : 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
      );
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error('O servidor respondeu de forma inesperada (HTTP ' + res.status + '). Se persistir, refaça a implantação do Apps Script.');
    }

    if (!json.ok) {
      const err = new Error(json.error || 'Erro desconhecido.');
      err.authFailed = !!json.authFailed;
      throw err;
    }
    return json;
  }

  // Erro de sessão em qualquer ponto do app devolve a pessoa para o login.
  function handleApiError(err, el) {
    if (err.authFailed) {
      showLogin(err.message);
      return;
    }
    setStatusMsg(el, err.message, 'err');
  }

  const FOTO_LADO_MAX = 1600; // pixels no maior lado
  const FOTO_QUALIDADE = 0.8;

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  // Foto de celular costuma ter vários MB, e em base64 cresce mais um terço.
  // Enviar assim trava o upload em rede móvel. Reduzir para 1600px de lado
  // mantém a foto legível para conferência e derruba o tamanho para a casa
  // das centenas de KB.
  function comprimirImagem(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const escala = Math.min(1, FOTO_LADO_MAX / Math.max(img.width, img.height));
          const largura = Math.max(1, Math.round(img.width * escala));
          const altura = Math.max(1, Math.round(img.height * escala));

          const canvas = document.createElement('canvas');
          canvas.width = largura;
          canvas.height = altura;
          canvas.getContext('2d').drawImage(img, 0, 0, largura, altura);

          const dataUrl = canvas.toDataURL('image/jpeg', FOTO_QUALIDADE);
          resolve({
            name: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg',
            mimeType: 'image/jpeg',
            base64: dataUrl.split(',')[1],
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível abrir a imagem.'));
      };
      img.src = url;
    });
  }

  async function filesToPayload(fileList) {
    const files = Array.from(fileList || []);
    const out = [];
    for (const f of files) {
      try {
        out.push(await comprimirImagem(f));
      } catch (err) {
        // Formato que o navegador não sabe desenhar (HEIC antigo, por
        // exemplo): manda o original em vez de perder a foto.
        out.push({ name: f.name, mimeType: f.type, base64: await fileToBase64(f) });
      }
    }
    return out;
  }

  // ===== Lista de atendimentos =====
  async function loadItems() {
    mainEl.innerHTML = '<div class="empty">Carregando atendimentos...</div>';
    try {
      const res = await api('list', { historico: verHistorico });
      items = res.items || [];
      ocultos = res.ocultos || 0;
      if (res.user) currentUser = res.user;
      renderTabs();
      renderList();
    } catch (err) {
      if (err.authFailed) return showLogin(err.message);
      mainEl.innerHTML = '<div class="empty">' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderUserChip() {
    if (!currentUser) return;
    const nome = currentUser.nome || currentUser.email;
    const iniciais = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    userChip.textContent = iniciais || '?';
    userChip.classList.toggle('is-admin', currentUser.perfil === 'Admin');
  }

  function renderTabs() {
    const tabs = [
      { key: 'Todos', label: 'Todos', count: items.length },
      ...STATUS_LIST.map((s) => ({ key: s, label: s, count: items.filter((i) => i.status === s).length })),
    ];
    tabsEl.innerHTML = '';
    tabs.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'tab' + (t.key === activeTab ? ' active' : '');
      el.innerHTML = '<span>' + t.label + '</span><span class="n">' + t.count + '</span>';
      el.addEventListener('click', () => {
        activeTab = t.key;
        renderTabs();
        renderList();
      });
      tabsEl.appendChild(el);
    });
  }

  function renderList() {
    const list = activeTab === 'Todos' ? items : items.filter((i) => i.status === activeTab);
    mainEl.innerHTML = '';

    if (!list.length) {
      mainEl.innerHTML = '<div class="empty">Nenhum atendimento aqui ainda.</div>';
    } else {
      list.forEach((item) => mainEl.appendChild(renderCard(item)));
    }

    mainEl.appendChild(renderHistoricoFooter());
  }

  // Rodapé explicando o recorte da lista. Pendentes e devedores estão
  // sempre todos aqui; só os finalizados antigos ficam de fora até que se
  // peça o histórico.
  function renderHistoricoFooter() {
    const wrap = document.createElement('div');
    wrap.className = 'historico-footer';

    if (verHistorico) {
      wrap.innerHTML = '<p class="hint">Mostrando o histórico completo.</p>';
      const btn = document.createElement('button');
      btn.className = 'btn secondary';
      btn.textContent = 'Voltar para os recentes';
      btn.addEventListener('click', () => {
        verHistorico = false;
        loadItems();
      });
      wrap.appendChild(btn);
      return wrap;
    }

    if (!ocultos) return wrap;

    wrap.innerHTML = '<p class="hint">' + ocultos + ' atendimento(s) finalizado(s) há mais de 90 dias não aparecem aqui. Pendentes e devedores são sempre mostrados, por mais antigos que sejam.</p>';
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = 'Ver histórico completo';
    btn.addEventListener('click', () => {
      verHistorico = true;
      loadItems();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'service-card';
    const valor = (item.status === 'Finalizado' || item.status === 'Devedor')
      ? (item.valorFinal || item.valorOrcado)
      : item.valorOrcado;
    card.innerHTML = `
      <div class="top-row">
        <div>
          <div class="cliente">${escapeHtml(item.clienteNome || 'Sem nome')}</div>
          <div class="meta">${escapeHtml(item.categoria || '')}${item.tipo ? ' · ' + escapeHtml(item.tipo) : ''} · ${escapeHtml(item.tecnico || '')}</div>
        </div>
        <span class="badge ${STATUS_CLASS[item.status] || ''}">${escapeHtml(item.status || '')}</span>
      </div>
      ${item.descricao ? '<div class="desc">' + escapeHtml(item.descricao) + '</div>' : ''}
      <div class="bottom-row">
        <span class="meta">${escapeHtml(formatDateTime(item.criadoEm))}</span>
        <span class="valor">${valor ? money.format(valor) : ''}</span>
      </div>
    `;
    card.addEventListener('click', () => openDetail(item));
    return card;
  }

  // ===== Novo atendimento =====
  function setSegmented(container, value) {
    Array.from(container.children).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
  }

  function resetNewForm() {
    categoriaValue = 'Automotivo';
    tipoValue = 'Carro';
    setSegmented(fCategoria, categoriaValue);
    setSegmented(fTipo, tipoValue);
    fTipoWrap.style.display = 'block';
    [fCliente, fTelefone, fEndereco, fDescricao, fValor, fPrevisao].forEach((el) => { el.value = ''; });
    fFotos.value = '';
    fFotosLabel.textContent = 'Toque para adicionar fotos';
    newStatus.innerHTML = '';
  }

  fCategoria.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    categoriaValue = btn.dataset.value;
    setSegmented(fCategoria, categoriaValue);
    fTipoWrap.style.display = categoriaValue === 'Automotivo' ? 'block' : 'none';
  });

  fTipo.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    tipoValue = btn.dataset.value;
    setSegmented(fTipo, tipoValue);
  });

  fFotos.addEventListener('change', () => {
    fFotosLabel.textContent = fFotos.files.length
      ? fFotos.files.length + ' foto(s) selecionada(s)'
      : 'Toque para adicionar fotos';
  });

  fabNew.addEventListener('click', () => {
    resetNewForm();
    modalNew.classList.add('open');
  });

  fSubmit.addEventListener('click', async () => {
    if (!fCliente.value.trim() || !fEndereco.value.trim()) {
      setStatusMsg(newStatus, 'Preencha ao menos cliente e endereço.', 'err');
      return;
    }
    fSubmit.disabled = true;
    setStatusMsg(newStatus, 'Enviando fotos e registrando...', 'info');
    try {
      const fotos = await filesToPayload(fFotos.files);
      await api('create', {
        data: {
          categoria: categoriaValue,
          tipo: categoriaValue === 'Automotivo' ? tipoValue : '',
          clienteNome: fCliente.value.trim(),
          clienteTelefone: fTelefone.value.trim(),
          endereco: fEndereco.value.trim(),
          descricao: fDescricao.value.trim(),
          valorOrcado: fValor.value ? Number(fValor.value) : '',
          previsao: fPrevisao.value,
          fotos,
        },
      });
      setStatusMsg(newStatus, 'Atendimento registrado!', 'ok');
      await loadItems();
      setTimeout(() => closeModal(modalNew), 700);
    } catch (err) {
      handleApiError(err, newStatus);
    } finally {
      fSubmit.disabled = false;
    }
  });

  // ===== Detalhe do atendimento =====
  function openDetail(item) {
    renderDetail(item);
    modalDetail.classList.add('open');
    loadPhotos(item);
  }

  function renderDetail(item) {
    const isAdmin = currentUser && currentUser.perfil === 'Admin';
    const actions = [];
    if (item.status !== 'Finalizado') actions.push('<button class="btn" data-action="finalizar">Marcar como finalizado</button>');
    if (item.status === 'Pendente') actions.push('<button class="btn secondary" data-action="devedor">Marcar como devedor</button>');
    if (item.status !== 'Pendente') actions.push('<button class="btn secondary" data-action="reabrir">Reabrir (pendente)</button>');

    detailBody.innerHTML = `
      <span class="badge ${STATUS_CLASS[item.status] || ''}">${escapeHtml(item.status || '')}</span>
      <div class="detail-row" style="margin-top:12px">
        <div class="l">Cliente</div>
        <div class="v">${escapeHtml(item.clienteNome)} ${item.clienteTelefone ? '· ' + escapeHtml(item.clienteTelefone) : ''}</div>
      </div>
      <div class="detail-row"><div class="l">Endereço</div><div class="v">${escapeHtml(item.endereco)}</div></div>
      <div class="detail-row"><div class="l">Categoria</div><div class="v">${escapeHtml(item.categoria)}${item.tipo ? ' · ' + escapeHtml(item.tipo) : ''}</div></div>
      <div class="detail-row"><div class="l">Técnico</div><div class="v">${escapeHtml(item.tecnico)}</div></div>
      <div class="detail-row"><div class="l">Descrição</div><div class="v">${escapeHtml(item.descricao) || '-'}</div></div>
      <div class="detail-row"><div class="l">Valor orçado</div><div class="v">${item.valorOrcado ? money.format(item.valorOrcado) : '-'}</div></div>
      ${item.valorFinal ? '<div class="detail-row"><div class="l">Valor final</div><div class="v">' + money.format(item.valorFinal) + '</div></div>' : ''}
      <div class="detail-row"><div class="l">Aberto em</div><div class="v">${escapeHtml(formatDateTime(item.criadoEm))}</div></div>
      ${item.previsao ? '<div class="detail-row"><div class="l">Previsão</div><div class="v">' + escapeHtml(formatDateTime(item.previsao)) + '</div></div>' : ''}
      ${item.dataFinalizacao ? '<div class="detail-row"><div class="l">Finalizado em</div><div class="v">' + escapeHtml(formatDateTime(item.dataFinalizacao)) + '</div></div>' : ''}
      ${item.observacoes ? '<div class="detail-row"><div class="l">Observações</div><div class="v">' + escapeHtml(item.observacoes) + '</div></div>' : ''}
      ${item.atualizadoPor ? '<div class="detail-row"><div class="l">Última alteração</div><div class="v">' + escapeHtml(item.atualizadoPor) + ' · ' + escapeHtml(formatDateTime(item.atualizadoEm)) + '</div></div>' : ''}
      <div class="detail-row"><div class="l">Fotos</div><div class="photos-row" id="photos-row">${item.fotos.length ? '<span class="hint">Carregando fotos...</span>' : '<span class="hint">Sem fotos.</span>'}</div></div>

      <div class="btn-row">${actions.join('')}</div>
      <div id="detail-status"></div>

      ${isAdmin ? `
        <div class="section-title">Correção (administrador)</div>
        <p class="hint">Use apenas para corrigir um lançamento feito errado. A alteração fica registrada no seu nome.</p>
        <button class="btn secondary" data-action="editar">Corrigir dados</button>
        <div id="edit-area"></div>
      ` : ''}
    `;

    detailBody.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleDetailAction(btn.dataset.action, item));
    });
  }

  // As fotos são privadas no Drive: o conteúdo vem pela API já autenticada,
  // e é exibido direto da memória, sem link público em lugar nenhum.
  async function loadPhotos(item) {
    const row = document.getElementById('photos-row');
    if (!row || !item.fotos.length) return;
    row.innerHTML = '';
    for (const fileId of item.fotos) {
      try {
        const res = await api('photo', { fileId });
        const img = document.createElement('img');
        img.src = 'data:' + res.photo.mimeType + ';base64,' + res.photo.base64;
        img.alt = 'Foto do atendimento';
        img.className = 'photo-thumb';
        img.addEventListener('click', () => img.classList.toggle('zoom'));
        row.appendChild(img);
      } catch (err) {
        if (err.authFailed) return showLogin(err.message);
        const span = document.createElement('span');
        span.className = 'hint';
        span.textContent = 'Uma foto não pôde ser carregada.';
        row.appendChild(span);
      }
    }
  }

  async function handleDetailAction(action, item) {
    const statusEl = document.getElementById('detail-status');

    if (action === 'finalizar' || action === 'devedor' || action === 'reabrir') {
      const novoStatus = action === 'finalizar' ? 'Finalizado' : action === 'devedor' ? 'Devedor' : 'Pendente';
      let valorFinal;
      if (novoStatus !== 'Pendente') {
        const input = prompt('Valor final do serviço (R$) — deixe em branco para manter o orçado:', item.valorFinal || item.valorOrcado || '');
        if (input === null) return;
        if (input.trim() !== '') valorFinal = Number(input.replace(',', '.'));
      }
      setStatusMsg(statusEl, 'Atualizando...', 'info');
      try {
        await api('setStatus', { id: item.id, status: novoStatus, data: { valorFinal } });
        setStatusMsg(statusEl, 'Atualizado!', 'ok');
        await loadItems();
        setTimeout(() => closeModal(modalDetail), 500);
      } catch (err) {
        handleApiError(err, statusEl);
      }
      return;
    }

    if (action === 'editar') renderEditForm(item);
  }

  function renderEditForm(item) {
    const area = document.getElementById('edit-area');
    area.innerHTML = `
      <div class="field"><label>Cliente</label><input id="e-cliente" value="${escapeHtml(item.clienteNome)}"></div>
      <div class="field"><label>Telefone</label><input id="e-telefone" value="${escapeHtml(item.clienteTelefone)}"></div>
      <div class="field"><label>Endereço</label><input id="e-endereco" value="${escapeHtml(item.endereco)}"></div>
      <div class="field"><label>Descrição</label><textarea id="e-descricao" rows="3">${escapeHtml(item.descricao)}</textarea></div>
      <div class="field"><label>Valor orçado (R$)</label><input id="e-valor-orcado" type="number" step="0.01" value="${item.valorOrcado || ''}"></div>
      <div class="field"><label>Valor final (R$)</label><input id="e-valor-final" type="number" step="0.01" value="${item.valorFinal || ''}"></div>
      <div class="field"><label>Status</label>
        <select id="e-status">
          ${STATUS_LIST.map((s) => `<option value="${s}" ${s === item.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Observações</label><textarea id="e-obs" rows="2">${escapeHtml(item.observacoes)}</textarea></div>
      <button class="btn" id="e-save">Salvar correção</button>
      <div id="edit-status"></div>
    `;
    document.getElementById('e-save').addEventListener('click', async () => {
      const editStatus = document.getElementById('edit-status');
      setStatusMsg(editStatus, 'Salvando...', 'info');
      try {
        await api('edit', {
          id: item.id,
          data: {
            clienteNome: document.getElementById('e-cliente').value.trim(),
            clienteTelefone: document.getElementById('e-telefone').value.trim(),
            endereco: document.getElementById('e-endereco').value.trim(),
            descricao: document.getElementById('e-descricao').value.trim(),
            valorOrcado: document.getElementById('e-valor-orcado').value ? Number(document.getElementById('e-valor-orcado').value) : '',
            valorFinal: document.getElementById('e-valor-final').value ? Number(document.getElementById('e-valor-final').value) : '',
            status: document.getElementById('e-status').value,
            observacoes: document.getElementById('e-obs').value.trim(),
          },
        });
        setStatusMsg(editStatus, 'Corrigido!', 'ok');
        await loadItems();
        setTimeout(() => closeModal(modalDetail), 600);
      } catch (err) {
        handleApiError(err, editStatus);
      }
    });
  }

  // ===== Conta e administração de usuários =====
  userChip.addEventListener('click', () => {
    renderAccount();
    modalAccount.classList.add('open');
  });

  function renderAccount() {
    const isAdmin = currentUser.perfil === 'Admin';
    accountBody.innerHTML = `
      <div class="detail-row"><div class="l">Conectado como</div><div class="v">${escapeHtml(currentUser.nome || '')}</div></div>
      <div class="detail-row"><div class="l">E-mail</div><div class="v">${escapeHtml(currentUser.email)}</div></div>
      <div class="detail-row"><div class="l">Perfil</div><div class="v">${escapeHtml(currentUser.perfil)}</div></div>
      <button class="btn secondary" id="btn-logout">Sair desta conta</button>
      ${isAdmin ? `
        <div class="section-title">Quem pode acessar</div>
        <p class="hint">Só estas contas Google conseguem entrar. Remover alguém tira o acesso imediatamente, em todos os aparelhos.</p>
        <div id="users-list"><span class="hint">Carregando...</span></div>
        <div class="section-title">Adicionar ou atualizar</div>
        <div class="field"><label for="u-email">E-mail (Gmail)</label><input type="email" id="u-email" placeholder="pessoa@gmail.com" autocomplete="off"></div>
        <div class="field"><label for="u-nome">Nome</label><input type="text" id="u-nome" placeholder="Como aparece nos lançamentos"></div>
        <div class="field">
          <label>Perfil</label>
          <div class="segmented" id="u-perfil">
            <button type="button" data-value="Técnico" class="active">Técnico</button>
            <button type="button" data-value="Admin">Admin</button>
          </div>
        </div>
        <button class="btn" id="u-save">Salvar acesso</button>
        <div id="users-status"></div>
      ` : ''}
    `;

    document.getElementById('btn-logout').addEventListener('click', logout);
    if (isAdmin) setupUserAdmin();
  }

  function setupUserAdmin() {
    let perfilValue = 'Técnico';
    const perfilEl = document.getElementById('u-perfil');
    perfilEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      perfilValue = btn.dataset.value;
      setSegmented(perfilEl, perfilValue);
    });

    document.getElementById('u-save').addEventListener('click', async () => {
      const statusEl = document.getElementById('users-status');
      const email = document.getElementById('u-email').value.trim();
      if (!email) return setStatusMsg(statusEl, 'Informe o e-mail.', 'err');
      setStatusMsg(statusEl, 'Salvando...', 'info');
      try {
        const res = await api('saveUser', {
          data: { email, nome: document.getElementById('u-nome').value.trim(), perfil: perfilValue, ativo: true },
        });
        setStatusMsg(statusEl, 'Acesso salvo!', 'ok');
        document.getElementById('u-email').value = '';
        document.getElementById('u-nome').value = '';
        renderUsersList(res.users);
      } catch (err) {
        handleApiError(err, statusEl);
      }
    });

    api('listUsers', {})
      .then((res) => renderUsersList(res.users))
      .catch((err) => handleApiError(err, document.getElementById('users-status')));
  }

  function renderUsersList(users) {
    const wrap = document.getElementById('users-list');
    if (!wrap) return;
    if (!users || !users.length) {
      wrap.innerHTML = '<span class="hint">Ninguém cadastrado ainda.</span>';
      return;
    }
    wrap.innerHTML = '';
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <div class="user-info">
          <div class="user-name">${escapeHtml(u.nome || u.email)} ${u.perfil === 'Admin' ? '<span class="tag-admin">Admin</span>' : ''}</div>
          <div class="user-email">${escapeHtml(u.email)}</div>
        </div>
      `;
      if (u.email !== currentUser.email) {
        const del = document.createElement('button');
        del.className = 'icon-btn danger';
        del.textContent = '×';
        del.title = 'Remover acesso';
        del.addEventListener('click', async () => {
          if (!confirm('Remover o acesso de ' + u.email + '?')) return;
          try {
            const res = await api('deleteUser', { email: u.email });
            renderUsersList(res.users);
          } catch (err) {
            handleApiError(err, document.getElementById('users-status'));
          }
        });
        row.appendChild(del);
      }
      wrap.appendChild(row);
    });
  }

  // ===== Modais =====
  function closeModal(modal) {
    modal.classList.remove('open');
  }
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.closest('.modal-backdrop')));
  });
  [modalNew, modalDetail, modalAccount].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // ===== Início =====
  waitForGoogle(20);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
