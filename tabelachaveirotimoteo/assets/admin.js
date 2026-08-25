(function () {
  // Troque este código de acesso pelo que preferir.
  const ACCESS_PIN = '7777';

  const REPO_OWNER = 'W77WWW';
  const REPO_NAME = 'W77WWW.github.io';
  const REPO_BRANCH = 'main';
  const DATA_PATH = 'tabelachaveirotimoteo/data.json';

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

  // Cada aba vira uma categoria. Dentro da aba, uma linha "divisória" (só a
  // coluna do nome/veículo preenchida, todo o resto vazio) inicia uma nova
  // subcategoria (ex: uma montadora) até a próxima divisória ou o fim da aba.
  // Qualquer coluna extra além de nome/sub/preço/observação é reconhecida
  // automaticamente e exibida como informação adicional no card.
  function parseWorkbook(wb) {
    const categories = [];

    wb.SheetNames.forEach((sheetName) => {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows.length) return;

      const rawHeader = rows[0].map((h) => (h || '').toString().trim());
      const header = rawHeader.map(normHeader);
      const colName = header.findIndex((h) => /servic|item|produto|descri|nome|veic/.test(h));
      const colSub = header.findIndex((h) => /sub|variac|tamanho|opcao|detalhe/.test(h));
      const colPrice = header.findIndex((h) => /prec|valor/.test(h));
      const colNote = header.findIndex((h) => /obs|nota/.test(h));

      const nameIdx = colName >= 0 ? colName : 0;
      const priceIdx = colPrice >= 0 ? colPrice : header.length - 1;
      const knownIdx = new Set([nameIdx, colSub, priceIdx, colNote].filter((i) => i >= 0));
      const extraIdx = header.map((_, i) => i).filter((i) => !knownIdx.has(i) && rawHeader[i]);

      const cellAt = (row, idx) => (idx >= 0 && row[idx] !== undefined ? row[idx].toString().trim() : '');

      const groups = [];
      let currentGroup = { name: '', services: [] };
      let lastName = '';

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every((c) => c === '' || c === undefined)) continue;

        const name = cellAt(row, nameIdx);
        const sub = cellAt(row, colSub);
        const note = cellAt(row, colNote);
        const rawPrice = cellAt(row, priceIdx);
        const extras = extraIdx
          .map((idx) => ({ label: rawHeader[idx], value: cellAt(row, idx) }))
          .filter((f) => f.value);

        const othersEmpty = !sub && !note && !rawPrice && extras.length === 0;

        if (name && othersEmpty) {
          if (currentGroup.services.length > 0) groups.push(currentGroup);
          currentGroup = { name, services: [] };
          lastName = '';
          continue;
        }

        let itemName = name;
        if (!itemName && lastName) {
          itemName = lastName;
        } else if (itemName) {
          lastName = itemName;
        }
        if (!itemName) continue;

        let price = 0;
        if (rawPrice) {
          const cleaned = rawPrice.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3},)/g, '').replace(',', '.');
          const n = parseFloat(cleaned);
          price = isNaN(n) ? 0 : n;
        }

        currentGroup.services.push({ name: itemName, sub, price, note, fields: extras });
      }
      if (currentGroup.services.length > 0) groups.push(currentGroup);
      if (!groups.length) return;

      categories.push({ name: sheetName, groups });
    });

    return { updatedAt: new Date().toISOString(), categories };
  }

  function renderPreview(data) {
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    let html = '';
    data.categories.forEach((cat) => {
      const total = cat.groups.reduce((n, g) => n + g.services.length, 0);
      html += '<div class="section-title" style="margin-top:16px;font-size:.9rem">' + escapeHtml(cat.name) + ' (' + total + ' itens' + (cat.groups.length > 1 || cat.groups[0].name ? ', ' + cat.groups.length + ' subcategorias' : '') + ')</div>';
      cat.groups.forEach((group) => {
        if (group.name) {
          html += '<div style="font-size:.78rem;font-weight:700;margin-top:8px;color:var(--muted)">' + escapeHtml(group.name) + '</div>';
        }
        html += '<table class="preview"><thead><tr><th>Nome</th><th>Preço</th><th>Extras</th></tr></thead><tbody>';
        group.services.slice(0, 6).forEach((s) => {
          const extras = (s.fields || []).map((f) => f.label + ': ' + f.value).join(' · ');
          html += '<tr><td>' + escapeHtml(s.name) + (s.sub ? ' <span style="color:var(--muted)">(' + escapeHtml(s.sub) + ')</span>' : '') + '</td><td>' + (s.price ? money.format(s.price) : '-') + '</td><td>' + escapeHtml(extras) + '</td></tr>';
        });
        if (group.services.length > 6) {
          html += '<tr><td colspan="3">+' + (group.services.length - 6) + ' itens...</td></tr>';
        }
        html += '</tbody></table>';
      });
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
