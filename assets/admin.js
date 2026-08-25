(function () {
  // Troque este código de acesso pelo que preferir.
  const ACCESS_PIN = '7777';

  const REPO_OWNER = 'W77WWW';
  const REPO_NAME = 'W77WWW.github.io';
  const REPO_BRANCH = 'main';
  const DATA_PATH = 'data.json';

  const gate = document.getElementById('gate');
  const panel = document.getElementById('panel');
  const pinInput = document.getElementById('pin');
  const gateBtn = document.getElementById('gate-btn');
  const gateStatus = document.getElementById('gate-status');

  const tokenInput = document.getElementById('token');
  const saveTokenBtn = document.getElementById('save-token');
  const tokenStatus = document.getElementById('token-status');

  const fileInput = document.getElementById('file');
  const drop = document.getElementById('drop');
  const dropLabel = document.getElementById('drop-label');
  const parseStatus = document.getElementById('parse-status');
  const preview = document.getElementById('preview');
  const publishTitle = document.getElementById('publish-title');
  const publishBtn = document.getElementById('publish-btn');
  const publishStatus = document.getElementById('publish-status');

  let parsedData = null;

  function setStatus(el, msg, kind) {
    el.innerHTML = msg ? '<div class="status ' + kind + '">' + msg + '</div>' : '';
  }

  gateBtn.addEventListener('click', () => {
    if (pinInput.value === ACCESS_PIN) {
      gate.style.display = 'none';
      panel.style.display = 'block';
      const saved = localStorage.getItem('gh_token');
      if (saved) tokenInput.value = saved;
    } else {
      setStatus(gateStatus, 'Código incorreto.', 'err');
    }
  });

  saveTokenBtn.addEventListener('click', () => {
    if (!tokenInput.value.trim()) {
      setStatus(tokenStatus, 'Cole o token antes de salvar.', 'err');
      return;
    }
    localStorage.setItem('gh_token', tokenInput.value.trim());
    setStatus(tokenStatus, 'Token salvo neste aparelho.', 'ok');
  });

  drop.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    dropLabel.textContent = file.name;
    parseStatus.innerHTML = '';
    preview.innerHTML = '';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        parsedData = parseWorkbook(wb);
        renderPreview(parsedData);
        publishTitle.style.display = 'block';
        publishBtn.style.display = 'block';
        setStatus(parseStatus, 'Planilha lida com sucesso. Confira o preview abaixo.', 'ok');
      } catch (err) {
        console.error(err);
        setStatus(parseStatus, 'Não foi possível ler o arquivo: ' + err.message, 'err');
      }
    };
    reader.readAsArrayBuffer(file);
  });

  function normHeader(h) {
    return (h || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function parseWorkbook(wb) {
    const categories = [];

    wb.SheetNames.forEach((sheetName) => {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows.length) return;

      const header = rows[0].map(normHeader);
      const colName = header.findIndex((h) => /servic|item|produto|descri|nome/.test(h));
      const colSub = header.findIndex((h) => /sub|variac|tamanho|opcao|detalhe/.test(h));
      const colPrice = header.findIndex((h) => /prec|valor/.test(h));
      const colNote = header.findIndex((h) => /obs|nota/.test(h));

      const nameIdx = colName >= 0 ? colName : 0;
      const priceIdx = colPrice >= 0 ? colPrice : header.length - 1;

      const services = [];
      let lastName = '';

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every((c) => c === '' || c === undefined)) continue;

        let name = (row[nameIdx] || '').toString().trim();
        const sub = colSub >= 0 ? (row[colSub] || '').toString().trim() : '';
        const note = colNote >= 0 ? (row[colNote] || '').toString().trim() : '';
        let rawPrice = row[priceIdx];

        if (!name && lastName) {
          name = lastName;
        } else if (name) {
          lastName = name;
        }
        if (!name) continue;

        let price = 0;
        if (typeof rawPrice === 'number') {
          price = rawPrice;
        } else if (typeof rawPrice === 'string' && rawPrice.trim()) {
          const cleaned = rawPrice.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3},)/g, '').replace(',', '.');
          const n = parseFloat(cleaned);
          price = isNaN(n) ? 0 : n;
        }

        services.push({ name, sub, price, note });
      }

      if (services.length) {
        categories.push({ name: sheetName, services });
      }
    });

    return { updatedAt: new Date().toISOString(), categories };
  }

  function renderPreview(data) {
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    let html = '';
    data.categories.forEach((cat) => {
      html += '<div class="section-title" style="margin-top:16px;font-size:.9rem">' + escapeHtml(cat.name) + ' (' + cat.services.length + ' itens)</div>';
      html += '<table class="preview"><thead><tr><th>Serviço</th><th>Sub</th><th>Preço</th></tr></thead><tbody>';
      cat.services.slice(0, 8).forEach((s) => {
        html += '<tr><td>' + escapeHtml(s.name) + '</td><td>' + escapeHtml(s.sub) + '</td><td>' + (s.price ? money.format(s.price) : '-') + '</td></tr>';
      });
      if (cat.services.length > 8) {
        html += '<tr><td colspan="3">+' + (cat.services.length - 8) + ' itens...</td></tr>';
      }
      html += '</tbody></table>';
    });
    preview.innerHTML = html || '<div class="status err">Nenhum dado reconhecido nas abas.</div>';
  }

  function escapeHtml(str) {
    return (str || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  publishBtn.addEventListener('click', async () => {
    const token = (localStorage.getItem('gh_token') || tokenInput.value || '').trim();
    if (!token) {
      setStatus(publishStatus, 'Informe e salve o token do GitHub primeiro.', 'err');
      return;
    }
    if (!parsedData || !parsedData.categories.length) {
      setStatus(publishStatus, 'Nenhum dado válido para publicar.', 'err');
      return;
    }

    publishBtn.disabled = true;
    setStatus(publishStatus, 'Publicando...', 'info');

    const apiBase = 'https://api.github.com/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/' + DATA_PATH;

    try {
      const getRes = await fetch(apiBase + '?ref=' + REPO_BRANCH, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      });
      if (!getRes.ok) throw new Error('Falha ao ler arquivo atual (' + getRes.status + '). Verifique o token.');
      const current = await getRes.json();

      const content = btoa(unescape(encodeURIComponent(JSON.stringify(parsedData, null, 2))));

      const putRes = await fetch(apiBase, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({
          message: 'Atualiza tabela de preços via admin',
          content,
          sha: current.sha,
          branch: REPO_BRANCH,
        }),
      });

      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}));
        throw new Error(err.message || 'Falha ao publicar (' + putRes.status + ').');
      }

      setStatus(publishStatus, 'Publicado! O site atualiza em 1-2 minutos.', 'ok');
    } catch (err) {
      setStatus(publishStatus, err.message, 'err');
    } finally {
      publishBtn.disabled = false;
    }
  });
})();
