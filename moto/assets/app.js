/**
 * Chaveiro Timóteo — Controle da Moto.
 *
 * Aplicativo de campo: é usado no posto, na garagem, na rua — onde o sinal
 * costuma faltar. Por isso a regra número um deste arquivo é:
 *
 *     NADA que o técnico digitou pode se perder por falta de internet.
 *
 * Todo registro é gravado primeiro no aparelho (IndexedDB) e só depois
 * enviado para a planilha. Se o envio falhar, ele fica na fila e é tentado
 * de novo sozinho. Como o ID de cada registro nasce aqui no celular, o
 * backend reconhece um reenvio e não duplica a linha.
 *
 * NÃO TEM LOGIN, de propósito: o login seria a única parte do app a exigir
 * internet, justamente onde ela falta. Em vez disso, cada formulário traz um
 * campo "Quem está registrando", já marcado com quem usa o aparelho — então
 * a planilha sempre sabe de quem é o lançamento, sem ninguém digitar senha.
 * Filtrar quem pode entrar continua fazendo sentido em telas com dado de
 * cliente, como o Controle de Socorro; aqui é diário de bordo de moto.
 */
(function () {
  'use strict';

  // ===== CONFIGURAÇÃO =====
  var CONFIG = {
    // URL do Apps Script publicado (ver apps-script/README.md).
    API_URL: 'https://script.google.com/macros/s/AKfycbxc6iROa9ZH4zdDvrH8qfvGUfICDC8zKAwPLN3x08T2z9Q1XFdzguY-ub0Vs7LAj57q/exec',
    // Tranca simples do endereço acima: precisa ser idêntica à CHAVE_DO_APP
    // do Code.gs. Não é senha nem identifica ninguém — só faz o backend
    // recusar pedidos que não vieram deste app.
    CHAVE_DO_APP: 'GCnZuhwKCFVzFyK7ITZTzdad66YVeiNe',
  };

  var C = window.MotoCalc;

  // ===== Domínio (as mesmas opções que existiam no Notion) =====
  var TIPOS_OCORRENCIA = ['Multa', 'Queda', 'Avaria', 'Acidente', 'Furto', 'Outro'];
  var STATUS_OCORRENCIA = ['Aberta', 'Indicação enviada', 'Paga', 'Descontada', 'Resolvida'];
  var TIPOS_MANUTENCAO = ['Preventiva', 'Corretiva'];
  var ITENS_MANUTENCAO = ['Óleo', 'Filtro de óleo', 'Relação/Corrente', 'Pneu dianteiro',
    'Pneu traseiro', 'Freio', 'Filtro de ar', 'Vela', 'Elétrica', 'Suspensão', 'Outro'];
  var FORMAS_PAGAMENTO = ['Pix', 'Dinheiro', 'Cartão débito', 'Cartão crédito', 'Boleto'];

  var LIMITE_ABASTECIMENTO_PADRAO = 40;

  var CLASSE_STATUS = {
    'Aberta': 'badge-aberta',
    'Indicação enviada': 'badge-andamento',
    'Paga': 'badge-ok',
    'Descontada': 'badge-ok',
    'Resolvida': 'badge-ok',
  };

  // ===== Estado =====
  var tecnico = '';            // quem está usando este aparelho
  var equipe = [];             // nomes que aparecem no campo "quem registrou"
  var configServidor = { moto: '', limiteAbastecimento: LIMITE_ABASTECIMENTO_PADRAO };
  var registros = { diario: [], abastecimento: [], ocorrencia: [], manutencao: [], fechamento: [] };
  var fila = [];               // registros ainda não enviados
  var erroSincronizacao = '';  // último motivo de falha, para mostrar na faixa
  var sincronizando = false;
  var telaAtual = 'inicio';
  var verHistorico = false;

  // ===== Elementos =====
  var el = function (id) { return document.getElementById(id); };
  var telaQuemEVoce = el('quem-e-voce');
  var listaQuemEVoce = el('lista-quem');
  var appEl = el('app');
  var mainEl = el('main');
  var navEl = el('bottom-nav');
  var userChip = el('user-chip');
  var motoNome = el('moto-nome');
  var syncBar = el('sync-bar');
  var syncText = el('sync-text');
  var syncAction = el('sync-action');
  var modalForm = el('modal-form');
  var formTitle = el('form-title');
  var formBody = el('form-body');
  var modalDetail = el('modal-detail');
  var detailTitle = el('detail-title');
  var detailBody = el('detail-body');
  var modalAccount = el('modal-account');
  var accountBody = el('account-body');

  // ===================================================================
  // Guarda local (IndexedDB)
  // ===================================================================
  //
  // Duas prateleiras: "fila" com o que ainda não foi enviado, e "cache"
  // com a última cópia dos dados da planilha (para o app abrir com
  // conteúdo mesmo sem sinal).

  var BANCO = 'moto-timoteo';
  var bancoPromessa = null;

  function abrirBanco() {
    if (bancoPromessa) return bancoPromessa;
    bancoPromessa = new Promise(function (resolve, reject) {
      var req = indexedDB.open(BANCO, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'chave' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return bancoPromessa;
  }

  function transacao(loja, modo, acao) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(loja, modo);
        var req = acao(tx.objectStore(loja));
        tx.oncomplete = function () { resolve(req && req.result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  var lerFila = function () { return transacao('fila', 'readonly', function (s) { return s.getAll(); }); };
  var gravarNaFila = function (item) { return transacao('fila', 'readwrite', function (s) { return s.put(item); }); };
  var tirarDaFila = function (id) { return transacao('fila', 'readwrite', function (s) { return s.delete(id); }); };
  var lerCache = function (chave) {
    return transacao('cache', 'readonly', function (s) { return s.get(chave); })
      .then(function (r) { return r ? r.valor : null; });
  };
  var gravarCache = function (chave, valor) {
    return transacao('cache', 'readwrite', function (s) { return s.put({ chave: chave, valor: valor }); });
  };

  // Quem usa este aparelho fica guardado aqui, para o campo "quem está
  // registrando" já vir marcado e o app abrir direto no trabalho. É uma
  // preferência do aparelho, não uma credencial: não dá acesso a nada.
  function salvarTecnico(nome) {
    tecnico = nome;
    try { localStorage.setItem('moto.tecnico', nome); } catch (e) { /* modo privado */ }
  }
  function lerTecnico() {
    try { return localStorage.getItem('moto.tecnico') || ''; } catch (e) { return ''; }
  }

  // ===================================================================
  // Utilidades
  // ===================================================================

  function escapeHtml(str) {
    return (str === null || str === undefined ? '' : String(str)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function novoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Reserva para navegadores antigos: hora + aleatório é suficiente para
    // não colidir entre os poucos aparelhos da equipe.
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function setStatusMsg(alvo, msg, tipo) {
    if (!alvo) return;
    alvo.innerHTML = msg ? '<div class="status ' + tipo + '">' + escapeHtml(msg) + '</div>' : '';
  }

  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ===================================================================
  // Fotos
  // ===================================================================

  /**
   * Reduz a foto antes de guardar. Uma foto de celular tem 3-8 MB; no
   * posto, com sinal ruim, isso é a diferença entre enviar e não enviar.
   * 1600px de lado maior é mais que suficiente para ler um painel ou o
   * visor da bomba.
   */
  function comprimirFoto(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var max = 1600;
          var escala = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * escala);
          canvas.height = Math.round(img.height * escala);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.72);
          resolve({
            name: (file.name || 'foto') .replace(/\.[^.]+$/, '') + '.jpg',
            mimeType: 'image/jpeg',
            base64: dataUrl.split(',')[1],
          });
        } catch (err) {
          lerArquivoDireto(file).then(resolve);
        }
      };
      // Formato que o navegador não sabe desenhar (HEIC em alguns casos):
      // manda como veio, o Drive resolve.
      img.onerror = function () {
        URL.revokeObjectURL(url);
        lerArquivoDireto(file).then(resolve);
      };
      img.src = url;
    });
  }

  function lerArquivoDireto(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({ name: file.name || 'foto.jpg', mimeType: file.type || 'image/jpeg', base64: String(reader.result).split(',')[1] });
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  function prepararFotos(fileList) {
    var arquivos = Array.prototype.slice.call(fileList || []);
    return Promise.all(arquivos.map(comprimirFoto)).then(function (fotos) {
      return fotos.filter(Boolean);
    });
  }

  // ===================================================================
  // Conversa com a planilha
  // ===================================================================

  function api(action, payload) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('COLE_AQUI') === 0) {
      return Promise.reject(new Error('O app ainda não foi conectado à planilha. Veja apps-script/README.md.'));
    }
    // Confusão fácil de cometer: colar aqui o link da planilha em vez do
    // endereço do Apps Script publicado. Sem este aviso, o erro apareceria
    // só lá na frente, e sem dizer o que está errado.
    if (CONFIG.API_URL.indexOf('docs.google.com') >= 0) {
      return Promise.reject(new Error(
        'A API_URL está com o link da planilha. O app precisa do endereço do Apps Script publicado, ' +
        'que termina em /exec (Extensões → Apps Script → Implantar → App da Web).'));
    }
    if (CONFIG.API_URL.indexOf('/exec') < 0) {
      return Promise.reject(new Error(
        'A API_URL não parece ser a de um Apps Script publicado: ela deve terminar em /exec.'));
    }
    var body = Object.assign({ action: action, chave: CONFIG.CHAVE_DO_APP }, payload);
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido.');
      return json;
    });
  }

  // ===================================================================
  // Fila de envio
  // ===================================================================

  /**
   * Grava o registro no aparelho e devolve na hora. O envio é problema da
   * sincronização, que roda depois — com ou sem internet, para o técnico o
   * lançamento já está feito.
   */
  function enfileirar(tipo, dados, fotos) {
    var item = {
      id: novoId(),
      tipo: tipo,
      data: dados,
      fotos: fotos || [],
      registradoEm: new Date().toISOString(),
      tentativas: 0,
      ultimoErro: '',
    };
    return gravarNaFila(item).then(function () {
      fila.push(item);
      atualizarFaixaSync();
      // Não esperamos o envio terminar: a tela já pode seguir.
      sincronizar();
      return item;
    });
  }

  /**
   * Envia a fila em lotes pequenos. Fotos são pesadas e o Apps Script tem
   * limite de tempo por chamada, então mandamos poucos registros por vez —
   * assim um lote grande não estoura tudo de uma vez.
   */
  function montarLotes(itens) {
    var LIMITE_BYTES = 3.5 * 1024 * 1024;
    var MAX_ITENS = 5;
    var lotes = [];
    var atual = [];
    var bytes = 0;

    itens.forEach(function (item) {
      var peso = (item.fotos || []).reduce(function (t, f) { return t + (f.base64 ? f.base64.length : 0); }, 0);
      if (atual.length && (atual.length >= MAX_ITENS || bytes + peso > LIMITE_BYTES)) {
        lotes.push(atual);
        atual = [];
        bytes = 0;
      }
      atual.push(item);
      bytes += peso;
    });
    if (atual.length) lotes.push(atual);
    return lotes;
  }

  function sincronizar(forcarRecarga) {
    if (sincronizando) return Promise.resolve();
    if (!navigator.onLine) { atualizarFaixaSync(); return Promise.resolve(); }

    sincronizando = true;
    atualizarFaixaSync();

    var pendentes = fila.slice();
    var tentados = {};
    pendentes.forEach(function (i) { tentados[i.id] = true; });
    var cadeia = Promise.resolve();

    montarLotes(pendentes).forEach(function (lote) {
      cadeia = cadeia.then(function () {
        return api('create', {
          registros: lote.map(function (i) {
            return { id: i.id, tipo: i.tipo, data: i.data, fotos: i.fotos, registradoEm: i.registradoEm };
          }),
        }).then(function (res) {
          var resultados = res.resultados || [];
          return Promise.all(resultados.map(function (r) {
            if (r.ok) {
              // Gravado (ou já estava lá, de uma tentativa anterior).
              fila = fila.filter(function (f) { return f.id !== r.id; });
              return tirarDaFila(r.id);
            }
            // Erro do próprio registro (ex: campo inválido): fica na fila
            // com o motivo à vista, para alguém decidir o que fazer.
            var item = fila.filter(function (f) { return f.id === r.id; })[0];
            if (item) {
              item.tentativas = (item.tentativas || 0) + 1;
              item.ultimoErro = r.error || 'Erro ao gravar.';
              return gravarNaFila(item);
            }
            return null;
          }));
        });
      });
    });

    return cadeia
      .then(function () {
        erroSincronizacao = '';
        if (fila.length === 0 || forcarRecarga) return carregarDaPlanilha();
      })
      .catch(function (err) {
        // Falha de rede: a fila fica intacta e tenta de novo sozinha.
        erroSincronizacao = err.message || 'Falha ao enviar.';
      })
      .then(function () {
        sincronizando = false;
        atualizarFaixaSync();
        renderTelaAtual();
        // Na primeira abertura a lista da equipe chega DEPOIS da tela de
        // "Quem é você?" aparecer. Sem redesenhar aqui, ela ficaria pedindo
        // para digitar o nome mesmo já tendo os nomes em mãos.
        if (telaQuemEVoce.style.display !== 'none') renderQuemEVoce();

        // Registros lançados DURANTE este envio não entraram no lote. Em
        // vez de esperarem o próximo gatilho, saem agora — senão o técnico
        // ficaria com "1 registro esperando" na tela sem motivo aparente.
        var novos = fila.some(function (i) { return !tentados[i.id]; });
        if (novos && !erroSincronizacao) setTimeout(function () { sincronizar(); }, 300);
      });
  }

  function carregarDaPlanilha() {
    return api('list', { historico: verHistorico }).then(function (res) {
      registros = res.registros || registros;
      if (res.equipe && res.equipe.length) equipe = res.equipe;
      if (res.config) configServidor = res.config;
      return gravarCache('registros', registros)
        .then(function () { return gravarCache('config', configServidor); })
        .then(function () { return gravarCache('equipe', equipe); });
    });
  }

  // ===================================================================
  // Registros na tela = o que veio da planilha + o que ainda está na fila
  // ===================================================================

  /**
   * O que está na fila já é verdade para quem registrou: aparece na lista
   * na mesma hora, marcado como "aguardando envio". Sem isso o técnico
   * lançaria o abastecimento e não veria nada mudar — e lançaria de novo.
   */
  function registrosVisiveis() {
    var junto = {};
    Object.keys(registros).forEach(function (tipo) {
      junto[tipo] = (registros[tipo] || []).slice();
    });
    fila.forEach(function (item) {
      if (!junto[item.tipo]) junto[item.tipo] = [];
      junto[item.tipo].unshift(Object.assign({
        _tipo: item.tipo,
        id: item.id,
        dataHora: item.registradoEm,
        tecnico: tecnico,
        _pendente: true,
        _erro: item.ultimoErro,
        _fotosLocais: item.fotos || [],
      }, item.data));
    });
    return junto;
  }

  // ===================================================================
  // Quem é você?
  // ===================================================================
  //
  // No lugar do login. Só na primeira vez: o aparelho lembra da escolha, e
  // dali em diante o nome já vem marcado no campo de cada formulário. Trocar
  // é um toque no círculo do canto.

  function mostrarQuemEVoce() {
    appEl.hidden = true;
    telaQuemEVoce.style.display = 'flex';
    renderQuemEVoce();
  }

  function renderQuemEVoce() {
    var nomes = equipe.length ? equipe : [];
    listaQuemEVoce.innerHTML = nomes.length
      ? nomes.map(function (n) {
          return '<button type="button" class="nome-opcao' + (n === tecnico ? ' ativo' : '') +
            '" data-nome="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>';
        }).join('')
      : '<p class="campo-dica">Ainda não carregamos a lista da equipe. Digite seu nome abaixo.</p>';

    listaQuemEVoce.querySelectorAll('[data-nome]').forEach(function (b) {
      b.addEventListener('click', function () { escolherTecnico(b.dataset.nome); });
    });

    var outro = el('nome-outro');
    var confirmar = el('nome-confirmar');
    outro.value = nomes.indexOf(tecnico) < 0 ? tecnico : '';
    confirmar.onclick = function () {
      var nome = outro.value.trim();
      if (!nome) {
        setStatusMsg(el('quem-status'), 'Escolha um nome da lista ou digite o seu.', 'err');
        return;
      }
      escolherTecnico(nome);
    };
  }

  function escolherTecnico(nome) {
    salvarTecnico(nome);
    entrarNoApp();
    // A lista da equipe pode ter mudado na planilha; atualiza por trás.
    sincronizar(true);
  }

  function entrarNoApp() {
    telaQuemEVoce.style.display = 'none';
    appEl.hidden = false;
    renderUserChip();
    renderNav();
    atualizarFaixaSync();
    renderTelaAtual();
  }

  // ===================================================================
  // Faixa de sincronização
  // ===================================================================

  function atualizarFaixaSync() {
    if (!appEl || appEl.hidden) return;
    var n = fila.length;
    var acao = null;
    var texto = '';
    var classe = '';

    if (sincronizando) {
      texto = 'Enviando ' + n + ' registro(s) para a planilha...';
      classe = 'sync-info';
    } else if (!navigator.onLine) {
      texto = n
        ? 'Sem internet. ' + n + ' registro(s) guardado(s) no aparelho — vão sozinhos quando voltar o sinal.'
        : 'Sem internet. Pode registrar normalmente: o envio acontece depois.';
      classe = 'sync-offline';
    } else if (n) {
      texto = n + ' registro(s) esperando envio.' + (erroSincronizacao ? ' ' + erroSincronizacao : '');
      classe = 'sync-alerta';
      acao = { texto: 'Enviar agora', fn: function () { sincronizar(true); } };
    } else if (erroSincronizacao) {
      texto = erroSincronizacao;
      classe = 'sync-alerta';
      acao = { texto: 'Tentar de novo', fn: function () { sincronizar(true); } };
    }

    if (!texto) { syncBar.hidden = true; return; }
    syncBar.hidden = false;
    syncBar.className = 'sync-bar ' + classe;
    syncText.textContent = texto;
    if (acao) {
      syncAction.hidden = false;
      syncAction.textContent = acao.texto;
      syncAction.onclick = acao.fn;
    } else {
      syncAction.hidden = true;
      syncAction.onclick = null;
    }
  }

  // ===================================================================
  // Navegação
  // ===================================================================

  var TELAS = [
    { chave: 'inicio', titulo: 'Início', icone: '🏠' },
    { chave: 'diario', titulo: 'Diário', icone: '🔑' },
    { chave: 'abastecimento', titulo: 'Combustível', icone: '⛽' },
    { chave: 'manutencao', titulo: 'Manutenção', icone: '🔧' },
    { chave: 'ocorrencia', titulo: 'Ocorrências', icone: '⚠️' },
  ];

  function renderNav() {
    navEl.innerHTML = '';
    TELAS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'nav-item' + (t.chave === telaAtual ? ' active' : '');
      b.innerHTML = '<span class="nav-icone">' + t.icone + '</span><span class="nav-label">' + t.titulo + '</span>';
      b.addEventListener('click', function () { irPara(t.chave); });
      navEl.appendChild(b);
    });
  }

  function irPara(tela) {
    telaAtual = tela;
    renderNav();
    renderTelaAtual();
    window.scrollTo(0, 0);
  }

  function renderTelaAtual() {
    if (appEl.hidden) return;
    var v = registrosVisiveis();
    if (telaAtual === 'inicio') return renderInicio(v);
    if (telaAtual === 'diario') return renderListaDiario(v);
    if (telaAtual === 'abastecimento') return renderListaAbastecimento(v);
    if (telaAtual === 'manutencao') return renderListaManutencao(v);
    if (telaAtual === 'ocorrencia') return renderListaOcorrencia(v);
    if (telaAtual === 'resumo') return renderResumo(v);
    if (telaAtual === 'regras') return renderRegras();
  }

  // ===================================================================
  // Tela: início
  // ===================================================================

  function renderInicio(v) {
    var status = C.statusDaMoto(v);
    var km = C.kmAtual(v);
    var abertas = C.ocorrenciasAbertas(v);
    var mes = C.mesDe(new Date().toISOString());
    var resumo = C.resumoDoMes(v, mes);
    var naRua = status.situacao === 'na rua';

    var cartaoStatus = status.situacao === 'sem registro'
      ? '<div class="status-linha">Nenhuma movimentação registrada ainda.</div>'
      : '<div class="status-linha"><span class="ponto ' + (naRua ? 'ponto-rua' : 'ponto-base') + '"></span>' +
        (naRua
          ? 'Na rua com <strong>' + escapeHtml(status.com || 'alguém') + '</strong>'
          : 'Na base') +
        '</div><div class="status-sub">' + escapeHtml(C.tempoRelativo(status.desde)) +
        ' · ' + escapeHtml(C.formataDataHora(status.desde)) + '</div>';

    mainEl.innerHTML =
      '<section class="cartao cartao-status">' +
        '<div class="cartao-topo"><span class="rotulo">A moto agora</span>' +
        (configServidor.moto ? '<span class="tag">' + escapeHtml(configServidor.moto) + '</span>' : '') + '</div>' +
        cartaoStatus +
        '<div class="km-atual"><span class="rotulo">Último KM registrado</span><strong>' + escapeHtml(C.formataKm(km)) + '</strong></div>' +
      '</section>' +

      '<div class="acoes-rapidas">' +
        botaoAcao('retirada', '🔑', 'Retirada', naRua ? 'A moto já está na rua' : 'Antes de sair', naRua) +
        botaoAcao('devolucao', '🏠', 'Devolução', naRua ? 'Ao voltar' : 'A moto está na base', !naRua) +
        botaoAcao('abastecimento', '⛽', 'Abastecer', 'No posto') +
        botaoAcao('ocorrencia', '⚠️', 'Ocorrência', 'Queda, multa, avaria') +
        botaoAcao('manutencao', '🔧', 'Manutenção', 'Com autorização') +
      '</div>' +

      (abertas.length
        ? '<section class="cartao cartao-alerta" id="cartao-abertas">' +
            '<div class="cartao-topo"><span class="rotulo">Pendências</span></div>' +
            '<p>' + abertas.length + ' ocorrência(s) em aberto esperando providência.</p>' +
            '<button class="btn secondary" data-ir="ocorrencia">Ver ocorrências</button>' +
          '</section>'
        : '') +

      '<section class="cartao">' +
        '<div class="cartao-topo"><span class="rotulo">' + escapeHtml(C.formataMes(mes)) + '</span></div>' +
        '<div class="kpis">' +
          kpi('Rodados', C.formataKm(resumo.kmRodados)) +
          kpi('Consumo', resumo.kmPorLitro ? C.formataNumero(resumo.kmPorLitro, 1) + ' km/L' : '—') +
          kpi('Combustível', C.formataMoeda(resumo.gastoCombustivel)) +
          kpi('Custo por km', resumo.custoPorKm ? C.formataMoeda(resumo.custoPorKm) : '—') +
        '</div>' +
        '<button class="btn secondary" data-ir="resumo">Ver resumo completo</button>' +
      '</section>' +

      '<button class="link-regras" data-ir="regras">Regras da moto</button>';

    mainEl.querySelectorAll('[data-acao]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFormulario(b.dataset.acao); });
    });
    mainEl.querySelectorAll('[data-ir]').forEach(function (b) {
      b.addEventListener('click', function () { irPara(b.dataset.ir); });
    });
  }

  function botaoAcao(acao, icone, titulo, sub, esmaecido) {
    return '<button class="acao' + (esmaecido ? ' esmaecida' : '') + '" data-acao="' + acao + '">' +
      '<span class="acao-icone">' + icone + '</span>' +
      '<span class="acao-titulo">' + titulo + '</span>' +
      '<span class="acao-sub">' + escapeHtml(sub) + '</span>' +
      '</button>';
  }

  function kpi(rotulo, valor) {
    return '<div class="kpi"><span class="kpi-rotulo">' + escapeHtml(rotulo) + '</span>' +
      '<span class="kpi-valor">' + escapeHtml(valor) + '</span></div>';
  }

  // ===================================================================
  // Telas de lista
  // ===================================================================

  function cabecalhoLista(titulo, acao, rotuloAcao) {
    return '<div class="lista-topo"><h2>' + escapeHtml(titulo) + '</h2>' +
      (acao ? '<button class="btn-mini" data-acao="' + acao + '">+ ' + escapeHtml(rotuloAcao) + '</button>' : '') +
      '</div>';
  }

  function ligarBotoes() {
    mainEl.querySelectorAll('[data-acao]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFormulario(b.dataset.acao); });
    });
    mainEl.querySelectorAll('[data-ir]').forEach(function (b) {
      b.addEventListener('click', function () { irPara(b.dataset.ir); });
    });
    mainEl.querySelectorAll('[data-detalhe]').forEach(function (card) {
      card.addEventListener('click', function () {
        var v = registrosVisiveis();
        var lista = v[card.dataset.tipoReg] || [];
        var item = lista.filter(function (i) { return String(i.id) === card.dataset.detalhe; })[0];
        if (item) abrirDetalhe(item);
      });
    });
    var maisEl = el('btn-historico');
    if (maisEl) {
      maisEl.addEventListener('click', function () {
        verHistorico = true;
        maisEl.disabled = true;
        maisEl.textContent = 'Carregando...';
        carregarDaPlanilha().then(renderTelaAtual).catch(function (err) {
          erroSincronizacao = err.message;
          atualizarFaixaSync();
          renderTelaAtual();
        });
      });
    }
  }

  function rodapeHistorico() {
    if (verHistorico) return '';
    return '<div class="rodape-lista"><button class="btn secondary" id="btn-historico">Carregar histórico completo</button></div>';
  }

  function vazio(texto) {
    return '<div class="vazio">' + escapeHtml(texto) + '</div>';
  }

  function selosDoCard(item) {
    if (item._pendente) {
      return item._erro
        ? '<span class="selo selo-erro" title="' + escapeHtml(item._erro) + '">não enviado</span>'
        : '<span class="selo selo-fila">aguardando envio</span>';
    }
    return '';
  }

  function card(item, tipo, conteudo) {
    return '<div class="registro" data-detalhe="' + escapeHtml(item.id) + '" data-tipo-reg="' + tipo + '">' + conteudo + '</div>';
  }

  function renderListaDiario(v) {
    var lista = (v.diario || []).slice().sort(function (a, b) { return new Date(b.dataHora) - new Date(a.dataHora); });
    // O botão oferece o passo que falta: com a moto na rua, o que se espera
    // em seguida é a devolução.
    var naRua = C.statusDaMoto(v).situacao === 'na rua';
    mainEl.innerHTML = cabecalhoLista('Diário de bordo',
        naRua ? 'devolucao' : 'retirada',
        naRua ? 'Devolução' : 'Retirada') +
      (lista.length ? lista.map(function (i) {
        return card(i, 'diario',
          '<div class="registro-topo">' +
            '<span class="badge ' + (i.tipo === 'Retirada' ? 'badge-retirada' : 'badge-devolucao') + '">' + escapeHtml(i.tipo || '') + '</span>' +
            '<span class="registro-km">' + escapeHtml(C.formataKm(i.km)) + '</span>' +
          '</div>' +
          '<div class="registro-meta">' + escapeHtml(i.tecnico || '') + ' · ' + escapeHtml(C.formataDataHora(i.dataHora)) + '</div>' +
          (i.observacao ? '<div class="registro-obs">' + escapeHtml(i.observacao) + '</div>' : '') +
          selosDoCard(i));
      }).join('') : vazio('Nenhuma retirada ou devolução registrada.')) +
      rodapeHistorico();
    ligarBotoes();
  }

  function renderListaAbastecimento(v) {
    var comConsumo = C.consumoPorAbastecimento(v.abastecimento || []).reverse();
    var media = C.mediaKmPorLitro(v.abastecimento || []);

    mainEl.innerHTML = cabecalhoLista('Abastecimentos', 'abastecimento', 'Abastecer') +
      (media ? '<div class="faixa-media">Média geral: <strong>' + C.formataNumero(media, 1) + ' km/L</strong></div>' : '') +
      (comConsumo.length ? comConsumo.map(function (i) {
        return card(i, 'abastecimento',
          '<div class="registro-topo">' +
            '<span class="registro-titulo">' + escapeHtml(C.formataMoeda(i.valorPago)) + ' · ' + escapeHtml(C.formataNumero(i.litros, 2)) + ' L</span>' +
            '<span class="registro-km">' + escapeHtml(C.formataKm(i.km)) + '</span>' +
          '</div>' +
          '<div class="registro-meta">' +
            escapeHtml(C.formataDataHora(i.dataHora)) +
            (i.posto ? ' · ' + escapeHtml(i.posto) : '') +
            (i.tecnico ? ' · ' + escapeHtml(i.tecnico) : '') +
          '</div>' +
          '<div class="registro-numeros">' +
            '<span>' + escapeHtml(i.precoLitro ? C.formataMoeda(i.precoLitro) + '/L' : '—') + '</span>' +
            '<span>' + (i.kmPorLitro ? escapeHtml(C.formataNumero(i.kmPorLitro, 1)) + ' km/L' : 'consumo: falta o anterior') + '</span>' +
          '</div>' +
          selosDoCard(i));
      }).join('') : vazio('Nenhum abastecimento registrado.')) +
      rodapeHistorico();
    ligarBotoes();
  }

  function renderListaManutencao(v) {
    var lista = (v.manutencao || []).slice().sort(function (a, b) { return new Date(b.dataHora) - new Date(a.dataHora); });
    mainEl.innerHTML = cabecalhoLista('Manutenções', 'manutencao', 'Registrar') +
      (lista.length ? lista.map(function (i) {
        return card(i, 'manutencao',
          '<div class="registro-topo">' +
            '<span class="registro-titulo">' + escapeHtml(i.servico || 'Manutenção') + '</span>' +
            '<span class="registro-valor">' + escapeHtml(C.formataMoeda(i.valor)) + '</span>' +
          '</div>' +
          '<div class="registro-meta">' +
            escapeHtml(C.formataData(i.data || i.dataHora)) +
            (i.tipo ? ' · ' + escapeHtml(i.tipo) : '') +
            (i.oficina ? ' · ' + escapeHtml(i.oficina) : '') +
            ' · ' + escapeHtml(C.formataKm(i.km)) +
          '</div>' +
          (i.item ? '<div class="registro-obs">' + escapeHtml([].concat(i.item).join(', ')) + '</div>' : '') +
          selosDoCard(i));
      }).join('') : vazio('Nenhuma manutenção registrada.')) +
      rodapeHistorico();
    ligarBotoes();
  }

  function renderListaOcorrencia(v) {
    var lista = (v.ocorrencia || []).slice().sort(function (a, b) { return new Date(b.dataHora) - new Date(a.dataHora); });
    mainEl.innerHTML = cabecalhoLista('Ocorrências', 'ocorrencia', 'Registrar') +
      (lista.length ? lista.map(function (i) {
        return card(i, 'ocorrencia',
          '<div class="registro-topo">' +
            '<span class="registro-titulo">' + escapeHtml(i.tipo || 'Ocorrência') + '</span>' +
            '<span class="badge ' + (CLASSE_STATUS[i.status] || 'badge-aberta') + '">' + escapeHtml(i.status || 'Aberta') + '</span>' +
          '</div>' +
          '<div class="registro-meta">' +
            escapeHtml(C.formataData(i.dataDoFato || i.dataHora)) +
            (i.tecnico ? ' · ' + escapeHtml(i.tecnico) : '') +
            (i.valor ? ' · ' + escapeHtml(C.formataMoeda(i.valor)) : '') +
          '</div>' +
          (i.oQueHouve ? '<div class="registro-obs">' + escapeHtml(i.oQueHouve) + '</div>' : '') +
          (i.prazoDeIndicacao ? '<div class="registro-prazo">Indicar o condutor até ' + escapeHtml(C.formataData(i.prazoDeIndicacao)) + '</div>' : '') +
          selosDoCard(i));
      }).join('') : vazio('Nenhuma ocorrência registrada. Ótimo sinal.')) +
      rodapeHistorico();
    ligarBotoes();
  }

  // ===================================================================
  // Tela: resumo mensal
  // ===================================================================

  function renderResumo(v) {
    var meses = C.mesesComRegistro(v);
    if (!meses.length) {
      mainEl.innerHTML = '<div class="lista-topo"><h2>Resumo mensal</h2></div>' + vazio('Ainda não há lançamentos para resumir.');
      return;
    }

    mainEl.innerHTML = '<div class="lista-topo"><h2>Resumo mensal</h2>' +
      '<button class="btn-mini" data-ir="inicio">Voltar</button></div>' +
      meses.map(function (mes) {
        var r = C.resumoDoMes(v, mes);
        var jaFechado = (v.fechamento || []).some(function (f) { return f.mes === mes; });
        return '<section class="cartao">' +
          '<div class="cartao-topo"><span class="rotulo">' + escapeHtml(C.formataMes(mes)) + '</span>' +
            (jaFechado ? '<span class="tag">fechado</span>' : '') + '</div>' +
          '<div class="kpis">' +
            kpi('KM rodados', C.formataKm(r.kmRodados)) +
            kpi('Consumo', r.kmPorLitro ? C.formataNumero(r.kmPorLitro, 1) + ' km/L' : '—') +
            kpi('Litros', C.formataNumero(r.litros, 2)) +
            kpi('Combustível', C.formataMoeda(r.gastoCombustivel)) +
            kpi('Manutenção', C.formataMoeda(r.gastoManutencao)) +
            kpi('Custo por km', r.custoPorKm ? C.formataMoeda(r.custoPorKm) : '—') +
          '</div>' +
          '<div class="resumo-detalhe">' +
            'KM ' + escapeHtml(C.formataKm(r.kmInicial)) + ' → ' + escapeHtml(C.formataKm(r.kmFinal)) +
            ' · ' + r.abastecimentos + ' abastecimento(s) · ' + r.manutencoes + ' manutenção(ões)' +
            (r.gastoOcorrencias ? ' · ' + escapeHtml(C.formataMoeda(r.gastoOcorrencias)) + ' em ocorrências' : '') +
          '</div>' +
          '<button class="btn secondary" data-fechar-mes="' + mes + '">' +
            (jaFechado ? 'Refazer fechamento' : 'Fechar este mês') + '</button>' +
        '</section>';
      }).join('');

    mainEl.querySelectorAll('[data-fechar-mes]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFechamento(b.dataset.fecharMes); });
    });
    ligarBotoes();
  }

  // ===================================================================
  // Tela: regras (funciona offline, é parte do treinamento)
  // ===================================================================

  function renderRegras() {
    var limite = configServidor.limiteAbastecimento || LIMITE_ABASTECIMENTO_PADRAO;
    mainEl.innerHTML = '<div class="lista-topo"><h2>Regras da moto</h2>' +
      '<button class="btn-mini" data-ir="inicio">Voltar</button></div>' +
      grupoRegras('🔑 Antes de sair', [
        'Moto não sai sem o formulário de <strong>Retirada</strong> preenchido',
        'CNH categoria A válida é obrigatória. Vencida = moto não sai',
        'Capacete sempre, sem exceção',
        'Conferir se a moto tem combustível pro trajeto',
      ]) +
      grupoRegras('🏠 Ao voltar', [
        'Preencher a <strong>Devolução</strong> com foto do painel',
        'Devolver a chave no lugar certo',
        'Se notou qualquer problema na moto, registra como Ocorrência',
      ]) +
      grupoRegras('⛽ Abastecimento', [
        'Até <strong>' + C.formataMoeda(limite) + '</strong> está pré-autorizado, pode abastecer sem pedir',
        'Acima disso, avisa antes',
        'Sempre no posto combinado',
        'Foto do visor da bomba, mostrando os litros e o valor',
      ]) +
      grupoRegras('🔧 Manutenção', [
        'Qualquer manutenção precisa de autorização antes',
        'Não leve na oficina por conta própria',
        'Se a moto apresentar problema, para e avisa',
      ]) +
      grupoRegras('⚠️ Nunca', [
        'Sair sem preencher o formulário de Retirada',
        'Devolver sem foto do painel',
        'Levar na oficina por conta própria',
      ]) +
      '<div class="cartao cartao-alerta">' +
        '<div class="cartao-topo"><span class="rotulo">🚨 Em caso de acidente</span></div>' +
        '<p>Primeiro garanta que você está bem. Depois avise imediatamente. ' +
        'Não negocie nada no local sem falar com a gestão antes.</p>' +
      '</div>';
    ligarBotoes();
  }

  function grupoRegras(titulo, itens) {
    return '<section class="cartao">' +
      '<div class="cartao-topo"><span class="rotulo">' + escapeHtml(titulo) + '</span></div>' +
      '<ul class="regras">' + itens.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>' +
      '</section>';
  }

  // ===================================================================
  // Formulários
  // ===================================================================
  //
  // Todos os formulários são montados a partir de uma lista de campos.
  // Isso mantém teclado, validação e comportamento iguais em todos eles —
  // e um campo novo é uma linha, não uma tela nova.

  var FORMULARIOS = {
    retirada: {
      titulo: 'Retirada da moto',
      tipo: 'diario',
      fixos: { tipo: 'Retirada' },
      campos: [
        { chave: 'km', rotulo: 'KM do painel', tipo: 'km', obrigatorio: true },
        { chave: '_fotos', rotulo: 'Foto do painel', tipo: 'fotos', dica: 'Tire a foto mostrando o KM.' },
        { chave: 'observacao', rotulo: 'Observação', tipo: 'textarea', placeholder: 'Algo fora do normal? (opcional)' },
      ],
      enviar: 'Registrar retirada',
    },
    devolucao: {
      titulo: 'Devolução da moto',
      tipo: 'diario',
      fixos: { tipo: 'Devolução' },
      campos: [
        { chave: 'km', rotulo: 'KM do painel', tipo: 'km', obrigatorio: true },
        { chave: '_fotos', rotulo: 'Foto do painel', tipo: 'fotos', obrigatorio: true, dica: 'Obrigatória: a moto não é devolvida sem foto do painel.' },
        { chave: 'observacao', rotulo: 'Observação', tipo: 'textarea', placeholder: 'Notou algum problema? (opcional)' },
      ],
      enviar: 'Registrar devolução',
    },
    abastecimento: {
      titulo: 'Abastecimento',
      tipo: 'abastecimento',
      campos: [
        { chave: 'km', rotulo: 'KM do painel', tipo: 'km', obrigatorio: true },
        { chave: 'litros', rotulo: 'Litros', tipo: 'decimal', obrigatorio: true, placeholder: '0,00' },
        { chave: 'valorPago', rotulo: 'Valor pago (R$)', tipo: 'decimal', obrigatorio: true, placeholder: '0,00' },
        { chave: 'posto', rotulo: 'Posto', tipo: 'texto', placeholder: 'Nome do posto' },
        { chave: '_fotos', rotulo: 'Foto do visor da bomba', tipo: 'fotos', obrigatorio: true, dica: 'Precisa aparecer os litros e o valor.' },
        { chave: 'observacao', rotulo: 'Observação', tipo: 'textarea', placeholder: 'Opcional' },
      ],
      enviar: 'Registrar abastecimento',
    },
    ocorrencia: {
      titulo: 'Ocorrência',
      tipo: 'ocorrencia',
      aviso: 'Registrar não é problema. Não registrar é.',
      campos: [
        { chave: 'tipo', rotulo: 'O que foi?', tipo: 'chips', opcoes: TIPOS_OCORRENCIA, obrigatorio: true },
        { chave: 'oQueHouve', rotulo: 'Conte o que houve', tipo: 'textarea', obrigatorio: true, placeholder: 'Onde, como e o que aconteceu' },
        { chave: 'dataDoFato', rotulo: 'Data do fato', tipo: 'data', padrao: hojeISO },
        { chave: 'prazoDeIndicacao', rotulo: 'Prazo para indicar o condutor', tipo: 'data', soQuando: { tipo: 'Multa' }, dica: 'Está na notificação da multa. Perdeu o prazo, a multa fica na empresa.' },
        { chave: 'valor', rotulo: 'Valor (R$)', tipo: 'decimal', placeholder: 'Se já souber' },
        { chave: '_fotos', rotulo: 'Foto ou documento', tipo: 'fotos' },
      ],
      enviar: 'Registrar ocorrência',
    },
    manutencao: {
      titulo: 'Manutenção',
      tipo: 'manutencao',
      aviso: 'Manutenção de qualquer valor precisa de autorização prévia.',
      campos: [
        { chave: 'servico', rotulo: 'Serviço', tipo: 'texto', obrigatorio: true, placeholder: 'Ex: Troca de óleo + filtro' },
        { chave: 'tipo', rotulo: 'Tipo', tipo: 'chips', opcoes: TIPOS_MANUTENCAO, padrao: function () { return 'Preventiva'; } },
        { chave: 'item', rotulo: 'Itens', tipo: 'chips-multi', opcoes: ITENS_MANUTENCAO },
        { chave: 'km', rotulo: 'KM do painel', tipo: 'km', obrigatorio: true },
        { chave: 'valor', rotulo: 'Valor (R$)', tipo: 'decimal', obrigatorio: true, placeholder: '0,00' },
        { chave: 'oficina', rotulo: 'Oficina', tipo: 'texto', placeholder: 'Onde foi feito' },
        { chave: 'formaDePagamento', rotulo: 'Forma de pagamento', tipo: 'chips', opcoes: FORMAS_PAGAMENTO },
        { chave: 'autorizadoPor', rotulo: 'Autorizado por', tipo: 'texto', obrigatorio: true, placeholder: 'Quem autorizou' },
        { chave: 'data', rotulo: 'Data', tipo: 'data', padrao: hojeISO },
        { chave: '_fotos', rotulo: 'Nota fiscal', tipo: 'fotos' },
        { chave: 'observacao', rotulo: 'Observação', tipo: 'textarea', placeholder: 'Opcional' },
      ],
      enviar: 'Registrar manutenção',
    },
  };

  var estadoForm = {};   // valores do formulário aberto agora

  /**
   * Nomes oferecidos no campo "quem está registrando": a equipe da planilha,
   * mais quem estiver escolhido no aparelho (para o nome não sumir do campo
   * se a lista ainda não carregou ou se a pessoa digitou um nome fora dela).
   */
  function opcoesDeTecnico() {
    var nomes = equipe.slice();
    if (tecnico && nomes.indexOf(tecnico) < 0) nomes.unshift(tecnico);
    var atual = estadoForm.tecnico;
    if (atual && nomes.indexOf(atual) < 0) nomes.unshift(atual);
    return nomes;
  }

  function abrirFormulario(nome) {
    var spec = FORMULARIOS[nome];
    if (!spec) return;

    estadoForm = { _spec: spec, _nome: nome, _fotos: [], tecnico: tecnico };
    spec.campos.forEach(function (campo) {
      if (campo.padrao) estadoForm[campo.chave] = campo.padrao();
      else if (campo.tipo === 'chips-multi') estadoForm[campo.chave] = [];
    });

    formTitle.textContent = spec.titulo;
    renderCamposForm();
    modalForm.classList.add('open');
  }

  function renderCamposForm() {
    var spec = estadoForm._spec;
    var v = registrosVisiveis();
    var kmConhecido = C.kmAtual(v);

    var html = '';
    if (spec.aviso) html += '<div class="aviso-regra">' + escapeHtml(spec.aviso) + '</div>';

    // Quem está registrando: primeiro campo de todo formulário. Já vem
    // marcado com quem usa o aparelho, então no dia a dia não custa toque
    // nenhum — mas fica à vista e trocável, para quando alguém preencher
    // no celular do colega.
    html += renderCampo({
      chave: 'tecnico', rotulo: 'Quem está registrando', tipo: 'chips',
      opcoes: opcoesDeTecnico(), obrigatorio: true,
    }, kmConhecido);

    if (kmConhecido !== null) {
      html += '<div class="campo-fixo">Último KM registrado: <strong>' +
        escapeHtml(C.formataKm(kmConhecido)) + '</strong></div>';
    }

    spec.campos.forEach(function (campo) {
      if (campo.soQuando) {
        var chave = Object.keys(campo.soQuando)[0];
        if (estadoForm[chave] !== campo.soQuando[chave]) return;
      }
      html += renderCampo(campo, kmConhecido);
    });

    html += '<div id="form-status"></div>' +
      '<button class="btn" id="form-enviar">' + escapeHtml(spec.enviar) + '</button>' +
      '<p class="dica-envio">Salva no aparelho na hora. Se estiver sem internet, vai para a planilha assim que o sinal voltar.</p>';

    formBody.innerHTML = html;
    ligarCamposForm();
  }

  function renderCampo(campo, kmConhecido) {
    var id = 'campo-' + campo.chave;
    var valor = estadoForm[campo.chave];
    var rotulo = '<label for="' + id + '">' + escapeHtml(campo.rotulo) +
      (campo.obrigatorio ? '<span class="obrigatorio">*</span>' : '') + '</label>';
    var dica = campo.dica ? '<p class="campo-dica">' + escapeHtml(campo.dica) + '</p>' : '';
    var corpo = '';

    if (campo.tipo === 'km' || campo.tipo === 'decimal') {
      // inputmode="decimal" abre o teclado numérico do celular sem impedir
      // a vírgula — que é como se digita número no Brasil.
      corpo = '<input type="text" inputmode="decimal" id="' + id + '" data-chave="' + campo.chave + '"' +
        ' value="' + escapeHtml(valor === undefined ? '' : valor) + '"' +
        ' placeholder="' + escapeHtml(campo.placeholder || (campo.tipo === 'km' ? 'Só números' : '')) + '" autocomplete="off">';
      if (campo.tipo === 'km') corpo += '<div class="campo-aviso" id="aviso-' + campo.chave + '"></div>';
    } else if (campo.tipo === 'texto') {
      corpo = '<input type="text" id="' + id + '" data-chave="' + campo.chave + '" value="' + escapeHtml(valor || '') + '"' +
        ' placeholder="' + escapeHtml(campo.placeholder || '') + '">';
    } else if (campo.tipo === 'textarea') {
      corpo = '<textarea id="' + id + '" data-chave="' + campo.chave + '" rows="3" placeholder="' +
        escapeHtml(campo.placeholder || '') + '">' + escapeHtml(valor || '') + '</textarea>';
    } else if (campo.tipo === 'data') {
      corpo = '<input type="date" id="' + id + '" data-chave="' + campo.chave + '" value="' + escapeHtml(valor || '') + '">';
    } else if (campo.tipo === 'chips' || campo.tipo === 'chips-multi') {
      var selecionados = campo.tipo === 'chips-multi' ? (valor || []) : [valor];
      corpo = '<div class="chips" data-chave="' + campo.chave + '" data-multi="' + (campo.tipo === 'chips-multi') + '">' +
        campo.opcoes.map(function (o) {
          var ativo = selecionados.indexOf(o) >= 0;
          return '<button type="button" class="chip' + (ativo ? ' ativo' : '') + '" data-valor="' + escapeHtml(o) + '">' + escapeHtml(o) + '</button>';
        }).join('') + '</div>';
    } else if (campo.tipo === 'fotos') {
      var n = (estadoForm._fotos || []).length;
      corpo = '<label class="foto-area" for="' + id + '">' +
        (n ? n + ' foto(s) pronta(s) — toque para trocar' : '📷 Tirar foto') + '</label>' +
        '<input type="file" id="' + id + '" accept="image/*" capture="environment" multiple hidden>' +
        '<div class="miniaturas" id="miniaturas"></div>';
    }

    return '<div class="campo">' + rotulo + corpo + dica + '</div>';
  }

  function ligarCamposForm() {
    formBody.querySelectorAll('input[data-chave], textarea[data-chave]').forEach(function (input) {
      input.addEventListener('input', function () {
        estadoForm[input.dataset.chave] = input.value;
        if (input.dataset.chave === 'km') mostrarAvisoKm(input.value);
      });
    });

    formBody.querySelectorAll('.chips').forEach(function (grupo) {
      grupo.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip');
        if (!btn) return;
        var chave = grupo.dataset.chave;
        var valor = btn.dataset.valor;
        if (grupo.dataset.multi === 'true') {
          var atual = estadoForm[chave] || [];
          estadoForm[chave] = atual.indexOf(valor) >= 0
            ? atual.filter(function (x) { return x !== valor; })
            : atual.concat([valor]);
        } else {
          estadoForm[chave] = estadoForm[chave] === valor ? '' : valor;
        }
        // Campos condicionais (o prazo da multa) aparecem/somem aqui.
        renderCamposForm();
      });
    });

    var inputFoto = formBody.querySelector('input[type="file"]');
    if (inputFoto) {
      inputFoto.addEventListener('change', function () {
        var area = formBody.querySelector('.foto-area');
        if (area) area.textContent = 'Preparando foto...';
        prepararFotos(inputFoto.files).then(function (fotos) {
          estadoForm._fotos = fotos;
          renderCamposForm();
          mostrarMiniaturas();
        });
      });
    }
    mostrarMiniaturas();

    var enviar = el('form-enviar');
    if (enviar) enviar.addEventListener('click', submeterFormulario);
  }

  function mostrarMiniaturas() {
    var wrap = el('miniaturas');
    if (!wrap) return;
    wrap.innerHTML = (estadoForm._fotos || []).map(function (f) {
      return '<img class="miniatura" src="data:' + f.mimeType + ';base64,' + f.base64 + '" alt="">';
    }).join('');
  }

  function mostrarAvisoKm(valor) {
    var alvo = el('aviso-km');
    if (!alvo) return;
    var aviso = C.avisoDeKm(valor, C.kmAtual(registrosVisiveis()));
    alvo.innerHTML = aviso ? '<span class="alerta">' + escapeHtml(aviso) + '</span>' : '';
  }

  function submeterFormulario() {
    var spec = estadoForm._spec;
    var statusEl = el('form-status');
    var botao = el('form-enviar');

    // --- obrigatórios ---
    var faltando = [];
    spec.campos.forEach(function (campo) {
      if (!campo.obrigatorio) return;
      if (campo.soQuando) {
        var chave = Object.keys(campo.soQuando)[0];
        if (estadoForm[chave] !== campo.soQuando[chave]) return;
      }
      var v = campo.chave === '_fotos' ? estadoForm._fotos : estadoForm[campo.chave];
      var vazioo = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
      if (vazioo) faltando.push(campo.rotulo);
    });
    if (!estadoForm.tecnico) faltando.unshift('Quem está registrando');
    if (faltando.length) {
      setStatusMsg(statusEl, 'Falta preencher: ' + faltando.join(', ') + '.', 'err');
      return;
    }

    // --- conferências que pedem confirmação, mas não bloqueiam ---
    var aviso = C.avisoDeKm(estadoForm.km, C.kmAtual(registrosVisiveis()));
    if (aviso && !confirm(aviso + '\n\nRegistrar assim mesmo?')) return;

    if (spec.tipo === 'abastecimento') {
      var limite = configServidor.limiteAbastecimento || LIMITE_ABASTECIMENTO_PADRAO;
      var valorPago = C.num(estadoForm.valorPago);
      if (valorPago !== null && valorPago > limite &&
        !confirm('Acima do pré-autorizado (' + C.formataMoeda(limite) + ').\n\nVocê avisou a gestão antes? O registro fica marcado na planilha.')) {
        return;
      }
      var litros = C.num(estadoForm.litros);
      if (litros !== null && valorPago !== null && litros > 0) {
        var preco = valorPago / litros;
        if ((preco < 2 || preco > 12) &&
          !confirm('Isso dá ' + C.formataMoeda(preco) + ' por litro, fora do normal.\n\nConfira os litros e o valor. Registrar assim mesmo?')) {
          return;
        }
      }
    }

    // --- monta o registro só com os campos do formulário ---
    var dados = Object.assign({ tecnico: estadoForm.tecnico }, spec.fixos || {});
    spec.campos.forEach(function (campo) {
      if (campo.chave === '_fotos') return;
      var v = estadoForm[campo.chave];
      if (v === undefined || v === null || v === '') return;
      if (campo.tipo === 'km' || campo.tipo === 'decimal') {
        var n = C.num(v);
        if (n !== null) dados[campo.chave] = n;
      } else {
        dados[campo.chave] = v;
      }
    });

    botao.disabled = true;
    setStatusMsg(statusEl, 'Salvando...', 'info');

    enfileirar(spec.tipo, dados, estadoForm._fotos).then(function () {
      setStatusMsg(statusEl, navigator.onLine
        ? 'Registrado! Enviando para a planilha...'
        : 'Registrado no aparelho. Vai para a planilha quando o sinal voltar.', 'ok');
      renderTelaAtual();
      setTimeout(function () { fecharModal(modalForm); }, 800);
    }).catch(function (err) {
      setStatusMsg(statusEl, 'Não foi possível salvar no aparelho: ' + err.message, 'err');
      botao.disabled = false;
    });
  }

  // ===================================================================
  // Fechamento do mês
  // ===================================================================

  function abrirFechamento(mes) {
    var r = C.resumoDoMes(registrosVisiveis(), mes);
    formTitle.textContent = 'Fechar ' + C.formataMes(mes);
    formBody.innerHTML =
      '<p class="campo-dica">Os números abaixo vêm dos lançamentos do mês. ' +
      'Só "outros custos" é digitado: IPVA, seguro e licenciamento divididos por 12.</p>' +
      '<div class="kpis">' +
        kpi('KM rodados', C.formataKm(r.kmRodados)) +
        kpi('Litros', C.formataNumero(r.litros, 2)) +
        kpi('Combustível', C.formataMoeda(r.gastoCombustivel)) +
        kpi('Manutenção', C.formataMoeda(r.gastoManutencao)) +
      '</div>' +
      '<div class="campo"><label for="f-outros">Outros custos (R$)</label>' +
      '<input type="text" inputmode="decimal" id="f-outros" placeholder="0,00"></div>' +
      '<div id="form-status"></div>' +
      '<button class="btn" id="f-fechar">Gravar fechamento</button>';

    el('f-fechar').addEventListener('click', function () {
      var outros = C.num(el('f-outros').value) || 0;
      var statusEl = el('form-status');
      el('f-fechar').disabled = true;
      setStatusMsg(statusEl, 'Salvando...', 'info');
      enfileirar('fechamento', {
        tecnico: tecnico,
        mes: mes,
        kmInicial: r.kmInicial,
        kmFinal: r.kmFinal,
        litros: r.litros,
        gastoCombustivel: r.gastoCombustivel,
        gastoManutencao: r.gastoManutencao,
        outrosCustos: outros,
      }, []).then(function () {
        setStatusMsg(statusEl, 'Fechamento gravado!', 'ok');
        renderTelaAtual();
        setTimeout(function () { fecharModal(modalForm); }, 800);
      }).catch(function (err) {
        setStatusMsg(statusEl, err.message, 'err');
        el('f-fechar').disabled = false;
      });
    });

    modalForm.classList.add('open');
  }

  // ===================================================================
  // Detalhe de um registro
  // ===================================================================

  function abrirDetalhe(item) {
    var linhas = [];
    var add = function (rotulo, valor) {
      if (valor === undefined || valor === null || valor === '') return;
      linhas.push('<div class="detalhe-linha"><div class="l">' + escapeHtml(rotulo) + '</div><div class="v">' + escapeHtml(valor) + '</div></div>');
    };

    detailTitle.textContent = {
      diario: 'Movimentação', abastecimento: 'Abastecimento',
      manutencao: 'Manutenção', ocorrencia: 'Ocorrência', fechamento: 'Fechamento',
    }[item._tipo] || 'Registro';

    if (item._tipo === 'diario') {
      add('Tipo', item.tipo);
      add('KM', C.formataKm(item.km));
      add('Observação', item.observacao);
    } else if (item._tipo === 'abastecimento') {
      add('Valor pago', C.formataMoeda(item.valorPago));
      add('Litros', C.formataNumero(item.litros, 2));
      add('Preço por litro', item.precoLitro ? C.formataMoeda(item.precoLitro) : '');
      add('KM', C.formataKm(item.km));
      add('Posto', item.posto);
      add('Acima do pré-autorizado', item.acimaDoPreAutorizado);
      add('Observação', item.observacao);
    } else if (item._tipo === 'manutencao') {
      add('Serviço', item.servico);
      add('Tipo', item.tipo);
      add('Itens', [].concat(item.item || []).join(', '));
      add('Valor', C.formataMoeda(item.valor));
      add('KM', C.formataKm(item.km));
      add('Oficina', item.oficina);
      add('Forma de pagamento', item.formaDePagamento);
      add('Autorizado por', item.autorizadoPor);
      add('Data', C.formataData(item.data));
      add('Observação', item.observacao);
    } else if (item._tipo === 'ocorrencia') {
      add('Tipo', item.tipo);
      add('O que houve', item.oQueHouve);
      add('Status', item.status);
      add('Data do fato', C.formataData(item.dataDoFato));
      add('Prazo de indicação', C.formataData(item.prazoDeIndicacao));
      add('Valor', item.valor ? C.formataMoeda(item.valor) : '');
    } else if (item._tipo === 'fechamento') {
      add('Mês', C.formataMes(item.mes));
      add('KM rodados', C.formataKm(item.kmRodados));
      add('Litros', C.formataNumero(item.litros, 2));
      add('Custo total', C.formataMoeda(item.custoTotal));
      add('KM/L', C.formataNumero(item.kmL, 2));
      add('Custo por KM', C.formataMoeda(item.custoPorKm));
    }

    add('Técnico', item.tecnico);
    add('Registrado em', C.formataDataHora(item.dataHora));

    var fotosHtml = '';
    if (item._pendente) {
      fotosHtml = (item._fotosLocais || []).map(function (f) {
        return '<img class="foto" src="data:' + f.mimeType + ';base64,' + f.base64 + '" alt="">';
      }).join('') || '<span class="campo-dica">Sem foto.</span>';
    } else if ((item.fotos || []).length) {
      fotosHtml = '<span class="campo-dica">Carregando fotos...</span>';
    } else {
      fotosHtml = '<span class="campo-dica">Sem foto.</span>';
    }

    detailBody.innerHTML =
      (item._pendente
        ? '<div class="aviso-regra">' + (item._erro
            ? 'Não foi possível enviar: ' + escapeHtml(item._erro)
            : 'Guardado no aparelho, esperando envio para a planilha.') + '</div>'
        : '') +
      linhas.join('') +
      '<div class="detalhe-linha"><div class="l">Fotos</div><div class="fotos" id="fotos-detalhe">' + fotosHtml + '</div></div>' +
      (item._tipo === 'ocorrencia' && !item._pendente
        ? '<div class="section-titulo">Situação</div>' +
          '<div class="chips" id="chips-status">' + STATUS_OCORRENCIA.map(function (s) {
            return '<button type="button" class="chip' + (item.status === s ? ' ativo' : '') + '" data-valor="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
          }).join('') + '</div>'
        : '') +
      '<div id="detalhe-status"></div>' +
      (item._pendente && item._erro
        ? '<button class="btn secondary" id="btn-descartar">Descartar este registro</button>'
        : '') +
      (item._pendente
        ? ''
        : '<p class="campo-dica">Para corrigir ou apagar um lançamento, abra a planilha.</p>');

    var chips = el('chips-status');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var btn = e.target.closest('.chip');
        if (!btn) return;
        mudarStatusOcorrencia(item, btn.dataset.valor);
      });
    }

    var descartar = el('btn-descartar');
    if (descartar) {
      descartar.addEventListener('click', function () {
        if (!confirm('Descartar este registro? Ele não foi enviado e será perdido.')) return;
        fila = fila.filter(function (f) { return f.id !== item.id; });
        tirarDaFila(item.id).then(function () {
          fecharModal(modalDetail);
          atualizarFaixaSync();
          renderTelaAtual();
        });
      });
    }

    modalDetail.classList.add('open');
    if (!item._pendente && (item.fotos || []).length) carregarFotos(item);
  }

  function mudarStatusOcorrencia(item, status) {
    var statusEl = el('detalhe-status');
    setStatusMsg(statusEl, 'Atualizando...', 'info');
    api('setStatus', { id: item.id, status: status }).then(function () {
      return carregarDaPlanilha();
    }).then(function () {
      fecharModal(modalDetail);
      renderTelaAtual();
    }).catch(function (err) {
      setStatusMsg(statusEl, err.message, 'err');
    });
  }

  // As fotos são privadas no Drive: o conteúdo vem pela API já autenticada
  // e é exibido direto da memória, sem link público em lugar nenhum.
  function carregarFotos(item) {
    var wrap = el('fotos-detalhe');
    if (!wrap) return;
    wrap.innerHTML = '';
    item.fotos.forEach(function (fileId) {
      api('photo', { fileId: fileId }).then(function (res) {
        var img = document.createElement('img');
        img.className = 'foto';
        img.src = 'data:' + res.photo.mimeType + ';base64,' + res.photo.base64;
        img.addEventListener('click', function () { img.classList.toggle('zoom'); });
        wrap.appendChild(img);
      }).catch(function () {
        var s = document.createElement('span');
        s.className = 'campo-dica';
        s.textContent = 'Uma foto não pôde ser carregada.';
        wrap.appendChild(s);
      });
    });
  }

  // ===================================================================
  // Quem está usando este aparelho
  // ===================================================================

  function renderUserChip() {
    var nome = tecnico || '?';
    var iniciais = nome.trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
    userChip.textContent = iniciais || '?';
    if (configServidor.moto) motoNome.textContent = configServidor.moto;
  }

  function renderConta() {
    accountBody.innerHTML =
      '<div class="detalhe-linha"><div class="l">Usando este aparelho</div><div class="v">' +
        escapeHtml(tecnico || 'Ninguém escolhido') + '</div></div>' +
      '<div class="detalhe-linha"><div class="l">Moto</div><div class="v">' +
        escapeHtml(configServidor.moto || '—') + '</div></div>' +
      '<div class="detalhe-linha"><div class="l">Fila de envio</div><div class="v">' +
        (fila.length ? fila.length + ' registro(s) esperando' : 'tudo enviado') + '</div></div>' +
      '<p class="campo-dica">O nome escolhido aqui já vem marcado no campo ' +
      '"Quem está registrando" de cada formulário — e pode ser trocado ' +
      'dentro do próprio formulário quando alguém preencher no seu celular.</p>' +
      '<button class="btn secondary" id="btn-trocar-nome">Trocar de pessoa</button>' +
      '<div class="section-titulo">Quem aparece na lista</div>' +
      '<p class="campo-dica">A lista vem da aba <strong>Equipe</strong> da planilha. ' +
      'Para incluir ou tirar alguém, edite essa aba — não precisa mexer no app.</p>' +
      '<div class="equipe-lista">' +
        (equipe.length
          ? equipe.map(function (n) { return '<span class="chip">' + escapeHtml(n) + '</span>'; }).join('')
          : '<span class="campo-dica">Lista ainda não carregada neste aparelho.</span>') +
      '</div>';

    el('btn-trocar-nome').addEventListener('click', function () {
      fecharModal(modalAccount);
      mostrarQuemEVoce();
    });
  }

  // ===================================================================
  // Modais
  // ===================================================================

  function fecharModal(modal) { modal.classList.remove('open'); }

  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { fecharModal(btn.closest('.modal-backdrop')); });
  });
  [modalForm, modalDetail, modalAccount].forEach(function (modal) {
    modal.addEventListener('click', function (e) { if (e.target === modal) fecharModal(modal); });
  });
  userChip.addEventListener('click', function () {
    renderConta();
    modalAccount.classList.add('open');
  });

  // ===================================================================
  // Início
  // ===================================================================

  function acaoDaUrl() {
    var params = new URLSearchParams(window.location.search);
    var acao = params.get('acao');
    if (acao && FORMULARIOS[acao]) setTimeout(function () { abrirFormulario(acao); }, 400);
  }

  function comecar() {
    Promise.all([lerFila(), lerCache('registros'), lerCache('config'), lerCache('equipe')])
      .then(function (r) {
        fila = r[0] || [];
        if (r[1]) registros = r[1];
        if (r[2]) configServidor = r[2];
        if (r[3]) equipe = r[3];
      })
      .catch(function () { /* primeiro uso: não há nada guardado ainda */ })
      .then(function () {
        tecnico = lerTecnico();
        if (tecnico) {
          // Já usou este aparelho antes: vai direto para o trabalho, com ou
          // sem sinal. Nada a digitar, nada a esperar.
          entrarNoApp();
          acaoDaUrl();
        } else {
          mostrarQuemEVoce();
        }
        // Busca dados e lista da equipe por trás; se não houver sinal, o app
        // segue funcionando com o que está guardado.
        sincronizar(true);
      });
  }

  // Gatilhos de sincronização: cada um cobre um jeito de o sinal voltar.
  window.addEventListener('online', function () {
    atualizarFaixaSync();
    sincronizar(true);
  });
  window.addEventListener('offline', atualizarFaixaSync);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) sincronizar();
  });
  setInterval(function () { if (fila.length) sincronizar(); }, 60000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // Sincronização em segundo plano: o navegador acorda o app quando
        // a internet volta, mesmo com ele fechado (onde houver suporte).
        if (reg.sync) reg.sync.register('moto-sync').catch(function () {});
      }).catch(function () {});
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'sync') sincronizar();
      });
    });
  }

  comecar();
})();
