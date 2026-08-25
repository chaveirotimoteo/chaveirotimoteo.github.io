(function () {
  const mainEl = document.getElementById('main');
  const chipsEl = document.getElementById('chips');
  const searchEl = document.getElementById('search');
  const updatedEl = document.getElementById('updated');

  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  let data = { categories: [] };
  let activeCategory = 'Todas';

  function normalize(str) {
    return (str || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function matchesQuery(service, cat, group, q) {
    if (!q) return true;
    if (normalize(service.name).includes(q)) return true;
    if (normalize(service.sub).includes(q)) return true;
    if (normalize(service.note).includes(q)) return true;
    if (normalize(cat.name).includes(q)) return true;
    if (normalize(group.name).includes(q)) return true;
    return (service.fields || []).some(
      (f) => normalize(f.label).includes(q) || normalize(f.value).includes(q)
    );
  }

  function renderItem(s) {
    const item = document.createElement('div');
    item.className = 'item';

    const info = document.createElement('div');
    info.className = 'info';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = s.name;
    info.appendChild(name);

    if (s.sub) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = s.sub;
      info.appendChild(sub);
    }

    if (s.fields && s.fields.length) {
      const fieldsWrap = document.createElement('div');
      fieldsWrap.className = 'fields';
      s.fields.forEach((f) => {
        const chip = document.createElement('span');
        chip.className = 'field-chip';
        const b = document.createElement('b');
        b.textContent = f.label + ': ';
        chip.appendChild(b);
        chip.appendChild(document.createTextNode(f.value));
        fieldsWrap.appendChild(chip);
      });
      info.appendChild(fieldsWrap);
    }

    if (s.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = s.note;
      info.appendChild(note);
    }

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = typeof s.price === 'number' && s.price > 0 ? money.format(s.price) : (s.price || 'Consultar');

    item.appendChild(info);
    item.appendChild(price);
    return item;
  }

  function render() {
    const q = normalize(searchEl.value.trim());
    mainEl.innerHTML = '';

    let anyResult = false;

    data.categories.forEach((cat) => {
      if (activeCategory !== 'Todas' && cat.name !== activeCategory) return;

      const groupsOut = [];
      (cat.groups || []).forEach((group) => {
        const matched = (group.services || []).filter((s) => matchesQuery(s, cat, group, q));
        if (matched.length) groupsOut.push({ name: group.name, services: matched });
      });
      if (!groupsOut.length) return;
      anyResult = true;

      const section = document.createElement('section');
      section.className = 'category';

      const h2 = document.createElement('h2');
      h2.textContent = cat.name;
      section.appendChild(h2);

      groupsOut.forEach((group) => {
        if (group.name) {
          const gTitle = document.createElement('div');
          gTitle.className = 'group-title';
          gTitle.textContent = group.name;
          section.appendChild(gTitle);
        }

        const card = document.createElement('div');
        card.className = 'card';
        group.services.forEach((s) => card.appendChild(renderItem(s)));
        section.appendChild(card);
      });

      mainEl.appendChild(section);
    });

    if (!anyResult) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhum resultado encontrado.';
      mainEl.appendChild(empty);
    }
  }

  function renderChips() {
    chipsEl.innerHTML = '';
    const names = ['Todas', ...data.categories.map((c) => c.name)];
    names.forEach((name) => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (name === activeCategory ? ' active' : '');
      chip.textContent = name;
      chip.addEventListener('click', () => {
        activeCategory = name;
        renderChips();
        render();
      });
      chipsEl.appendChild(chip);
    });
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return 'Atualizado em ' + d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  fetch('data.json?ts=' + Date.now())
    .then((r) => r.json())
    .then((json) => {
      data = json;
      updatedEl.textContent = formatDate(json.updatedAt);
      renderChips();
      render();
    })
    .catch(() => {
      mainEl.innerHTML = '<div class="empty">Não foi possível carregar os dados.</div>';
    });

  searchEl.addEventListener('input', render);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
