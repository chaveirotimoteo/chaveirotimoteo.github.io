(function () {
  // ===== CONFIGURAÇÃO =====
  // Depois de publicar o Apps Script (ver apps-script/README.md), cole aqui a
  // URL do Web App. O SECRET e o PIN precisam ser IDÊNTICOS aos definidos em
  // apps-script/Code.gs (constantes SECRET e ADMIN_PIN).
  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbwlZUq4YClqfq9UeHXB8qPLe058FpEVZyD1yrZNpZ_ge937eo42yXoVOGZ4jBn9Bwvx/exec',
    APP_SECRET: 'Acede2101*',
    ADMIN_PIN: '191215',
    // Para incluir mais técnicos, basta adicionar o nome à lista.
    TECNICOS: ['Lucas', 'Giovani'],
  };

  const STATUS_LIST = ['Pendente', 'Devedor', 'Finalizado'];
  const STATUS_CLASS = { Pendente: 'badge-pendente', Devedor: 'badge-devedor', Finalizado: 'badge-finalizado' };

  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const mainEl = document.getElementById('main');
  const tabsEl = document.getElementById('tabs');
  const fabNew = document.getElementById('fab-new');

  const modalNew = document.getElementById('modal-new');
  const modalDetail = document.getElementById('modal-detail');
  const detailBody = document.getElementById('detail-body');

  const fCategoria = document.getElementById('f-categoria');
  const fTipoWrap = document.getElementById('f-tipo-wrap');
  const fTipo = document.getElementById('f-tipo');
  const fTecnico = document.getElementById('f-tecnico');
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

  let items = [];
  let activeTab = 'Todos';
  let categoriaValue = 'Automotivo';
  let tipoValue = 'Carro';

  function setStatusMsg(el, msg, kind) {
    el.innerHTML = msg ? '<div class="status ' + kind + '">' + msg + '</div>' : '';
  }

  function escapeHtml(str) {
    return (str || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatDateTime(v) {
    if (!v) return '';
    try {
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return String(v);
    }
  }

  // ===== API (Google Apps Script) =====
  async function api(action, payload) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('COLE_AQUI') === 0) {
      throw new Error('O app ainda não foi conectado à planilha. Configure API_URL em assets/app.js.');
    }
    const body = Object.assign({ action, secret: CONFIG.APP_SECRET }, payload);
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Erro desconhecido.');
    return json;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function filesToPayload(fileList) {
    const files = Array.from(fileList || []);
    return Promise.all(files.map(async (f) => ({ name: f.name, mimeType: f.type, base64: await fileToBase64(f) })));
  }

  // ===== Carregar / renderizar lista =====
  async function loadItems() {
    mainEl.innerHTML = '<div class="empty">Carregando atendimentos...</div>';
    try {
      const res = await api('list', {});
      items = res.items || [];
      renderTabs();
      renderList();
    } catch (err) {
      mainEl.innerHTML = '<div class="empty">' + escapeHtml(err.message) + '</div>';
    }
  }

  function countByStatus(status) {
    return items.filter((i) => i.status === status).length;
  }

  function renderTabs() {
    const tabs = [
      { key: 'Todos', label: 'Todos', count: items.length },
      ...STATUS_LIST.map((s) => ({ key: s, label: s, count: countByStatus(s) })),
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
      return;
    }
    list.forEach((item) => mainEl.appendChild(renderCard(item)));
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = 'service-card';
    const valor = item.status === 'Finalizado' || item.status === 'Devedor'
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

  // ===== Modal: novo atendimento =====
  function resetNewForm() {
    setSegmented(fCategoria, 'Automotivo');
    categoriaValue = 'Automotivo';
    setSegmented(fTipo, 'Carro');
    tipoValue = 'Carro';
    fTipoWrap.style.display = 'block';
    fTecnico.value = CONFIG.TECNICOS[0] || '';
    fCliente.value = '';
    fTelefone.value = '';
    fEndereco.value = '';
    fDescricao.value = '';
    fValor.value = '';
    fPrevisao.value = '';
    fFotos.value = '';
    fFotosLabel.textContent = 'Toque para adicionar fotos';
    newStatus.innerHTML = '';
  }

  function setSegmented(container, value) {
    Array.from(container.children).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
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
    fFotosLabel.textContent = fFotos.files.length ? fFotos.files.length + ' foto(s) selecionada(s)' : 'Toque para adicionar fotos';
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
          tecnico: fTecnico.value,
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
      setStatusMsg(newStatus, err.message, 'err');
    } finally {
      fSubmit.disabled = false;
    }
  });

  // ===== Modal: detalhe / status / edição =====
  let pinUnlocked = false;

  function openDetail(item) {
    pinUnlocked = false;
    renderDetail(item);
    modalDetail.classList.add('open');
  }

  function renderDetail(item) {
    const fotosHtml = (item.fotos || []).length
      ? '<div class="photos-row">' + item.fotos.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="foto"></a>`).join('') + '</div>'
      : '<div class="hint">Sem fotos.</div>';

    const actions = [];
    if (item.status !== 'Finalizado') {
      actions.push('<button class="btn" data-action="finalizar">Marcar como finalizado</button>');
    }
    if (item.status === 'Pendente') {
      actions.push('<button class="btn secondary" data-action="devedor">Marcar como devedor</button>');
    }
    if (item.status !== 'Pendente') {
      actions.push('<button class="btn secondary" data-action="reabrir">Reabrir (pendente)</button>');
    }

    detailBody.innerHTML = `
      <span class="badge ${STATUS_CLASS[item.status] || ''}">${escapeHtml(item.status || '')}</span>
      <div class="detail-row" style="margin-top:12px">
        <div class="l">Cliente</div><div class="v">${escapeHtml(item.clienteNome)} ${item.clienteTelefone ? '· ' + escapeHtml(item.clienteTelefone) : ''}</div>
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
      <div class="detail-row"><div class="l">Fotos</div>${fotosHtml}</div>

      <div class="btn-row">${actions.join('')}</div>
      <div id="detail-status"></div>

      <div class="section-title">Correção (somente administrador)</div>
      <p class="hint">Use apenas para corrigir um lançamento feito errado. Pede o código de acesso.</p>
      <button class="btn secondary" data-action="editar">Corrigir dados</button>
      <div id="edit-area"></div>
    `;

    detailBody.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleDetailAction(btn.dataset.action, item));
    });
  }

  async function handleDetailAction(action, item) {
    const statusEl = document.getElementById('detail-status');
    if (action === 'finalizar' || action === 'devedor' || action === 'reabrir') {
      const novoStatus = action === 'finalizar' ? 'Finalizado' : action === 'devedor' ? 'Devedor' : 'Pendente';
      let valorFinal;
      if (novoStatus === 'Finalizado' || novoStatus === 'Devedor') {
        const input = prompt('Valor final do serviço (R$) — deixe em branco para manter o orçado:', item.valorFinal || item.valorOrcado || '');
        if (input === null) return;
        if (input.trim() !== '') valorFinal = Number(input.replace(',', '.'));
      }
      setStatusMsg(statusEl, 'Atualizando...', 'info');
      try {
        await api('setStatus', { id: item.id, status: novoStatus, data: { valorFinal, tecnico: item.tecnico } });
        setStatusMsg(statusEl, 'Atualizado!', 'ok');
        await loadItems();
        setTimeout(() => closeModal(modalDetail), 500);
      } catch (err) {
        setStatusMsg(statusEl, err.message, 'err');
      }
      return;
    }

    if (action === 'editar') {
      if (!pinUnlocked) {
        const pin = prompt('Código de acesso do administrador:');
        if (pin === null) return;
        if (pin !== CONFIG.ADMIN_PIN) {
          setStatusMsg(statusEl, 'Código incorreto.', 'err');
          return;
        }
        pinUnlocked = true;
      }
      renderEditForm(item);
    }
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
          pin: CONFIG.ADMIN_PIN,
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
        setStatusMsg(editStatus, err.message, 'err');
      }
    });
  }

  // ===== Modais: abrir/fechar =====
  function closeModal(modal) {
    modal.classList.remove('open');
  }
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.closest('.modal-backdrop')));
  });
  [modalNew, modalDetail].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  function populateTecnicos() {
    fTecnico.innerHTML = CONFIG.TECNICOS.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  }

  populateTecnicos();
  loadItems();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
