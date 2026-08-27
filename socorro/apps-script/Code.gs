/**
 * Chaveiro Timóteo — Controle de Socorro
 * Backend em Google Apps Script: recebe os lançamentos feitos pelo app
 * estático (index.html) e grava/atualiza linhas nesta planilha do Google
 * Sheets. Publique como Web App (ver README.md nesta pasta).
 */

var SHEET_NAME = 'Socorros';
// Estes dois valores precisam ser IDÊNTICOS aos de assets/app.js. Como o
// app é uma página estática, eles ficam visíveis no código do site de
// qualquer forma — servem para evitar uso acidental/casual por quem
// descobrir a URL, não como segredo forte.
var SECRET = 'senha3457'; // igual ao APP_SECRET em assets/app.js
var ADMIN_PIN = 'senha3457'; // igual ao ADMIN_PIN em assets/app.js
var PHOTOS_FOLDER = 'Socorro - Fotos';

var COLUMNS = [
  'ID', 'Criado em', 'Técnico', 'Categoria', 'Tipo', 'Cliente', 'Telefone',
  'Endereço', 'Descrição', 'Valor orçado', 'Valor final', 'Status',
  'Previsão de finalização', 'Data de finalização', 'Fotos', 'Observações',
  'Atualizado em', 'Atualizado por',
];

function doPost(e) {
  return handleRequest(e);
}
function doGet(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var out;
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    if (!body.action) {
      out = { ok: true, info: 'Controle de Socorro — backend ativo.' };
    } else if (body.secret !== SECRET) {
      out = { ok: false, error: 'unauthorized' };
    } else if (body.action === 'list') {
      out = { ok: true, items: listServices() };
    } else if (body.action === 'create') {
      out = { ok: true, item: createService(body.data || {}) };
    } else if (body.action === 'setStatus') {
      out = { ok: true, item: setStatus(body.id, body.status, body.data || {}) };
    } else if (body.action === 'edit') {
      if (body.pin !== ADMIN_PIN) {
        out = { ok: false, error: 'PIN inválido' };
      } else {
        out = { ok: true, item: editService(body.id, body.data || {}) };
      }
    } else {
      out = { ok: false, error: 'Ação desconhecida' };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rowToObject(header, row) {
  var obj = {};
  header.forEach(function (h, i) { obj[h] = row[i]; });
  return {
    id: obj['ID'],
    criadoEm: obj['Criado em'],
    tecnico: obj['Técnico'],
    categoria: obj['Categoria'],
    tipo: obj['Tipo'],
    clienteNome: obj['Cliente'],
    clienteTelefone: obj['Telefone'],
    endereco: obj['Endereço'],
    descricao: obj['Descrição'],
    valorOrcado: obj['Valor orçado'],
    valorFinal: obj['Valor final'],
    status: obj['Status'],
    previsao: obj['Previsão de finalização'],
    dataFinalizacao: obj['Data de finalização'],
    fotos: obj['Fotos'] ? String(obj['Fotos']).split(',').filter(Boolean) : [],
    observacoes: obj['Observações'],
    atualizadoEm: obj['Atualizado em'],
    atualizadoPor: obj['Atualizado por'],
  };
}

function listServices() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var items = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    items.push(rowToObject(header, values[i]));
  }
  items.reverse(); // mais recentes primeiro
  return items;
}

function findRowById(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function getOrCreateFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

function saveFotos(fotos) {
  if (!fotos || !fotos.length) return [];
  var folder = getOrCreateFolder(PHOTOS_FOLDER);
  var urls = [];
  fotos.forEach(function (f) {
    try {
      var blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mimeType || 'image/jpeg', f.name || ('foto-' + Date.now() + '.jpg'));
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push(file.getUrl());
    } catch (err) {
      // ignora uma foto que falhar, não trava o lançamento inteiro
    }
  });
  return urls;
}

function createService(data) {
  var sheet = getSheet();
  var id = Utilities.getUuid();
  var now = new Date();
  var fotoUrls = saveFotos(data.fotos);

  sheet.appendRow([
    id, now, data.tecnico || '', data.categoria || '', data.tipo || '',
    data.clienteNome || '', data.clienteTelefone || '', data.endereco || '',
    data.descricao || '', data.valorOrcado || '', '', 'Pendente',
    data.previsao || '', '', fotoUrls.join(','), data.observacoes || '',
    now, data.tecnico || '',
  ]);

  return { id: id, status: 'Pendente' };
}

function setStatus(id, status, data) {
  var sheet = getSheet();
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Registro não encontrado');
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = function (name) { return header.indexOf(name) + 1; };

  sheet.getRange(row, col('Status')).setValue(status);
  if (status === 'Finalizado' || status === 'Devedor') {
    sheet.getRange(row, col('Data de finalização')).setValue(new Date());
    if (data.valorFinal !== undefined && data.valorFinal !== '' && data.valorFinal !== null) {
      sheet.getRange(row, col('Valor final')).setValue(data.valorFinal);
    }
  }
  var novasFotos = saveFotos(data.fotos);
  if (novasFotos.length) {
    var atual = sheet.getRange(row, col('Fotos')).getValue();
    var todas = (atual ? atual + ',' : '') + novasFotos.join(',');
    sheet.getRange(row, col('Fotos')).setValue(todas);
  }
  sheet.getRange(row, col('Atualizado em')).setValue(new Date());
  sheet.getRange(row, col('Atualizado por')).setValue(data.tecnico || '');
  return { id: id, status: status };
}

function editService(id, data) {
  var sheet = getSheet();
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Registro não encontrado');
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = function (name) { return header.indexOf(name) + 1; };

  var map = {
    tecnico: 'Técnico', categoria: 'Categoria', tipo: 'Tipo',
    clienteNome: 'Cliente', clienteTelefone: 'Telefone', endereco: 'Endereço',
    descricao: 'Descrição', valorOrcado: 'Valor orçado', valorFinal: 'Valor final',
    status: 'Status', previsao: 'Previsão de finalização', observacoes: 'Observações',
  };
  Object.keys(map).forEach(function (key) {
    if (data[key] !== undefined) {
      sheet.getRange(row, col(map[key])).setValue(data[key]);
    }
  });
  sheet.getRange(row, col('Atualizado em')).setValue(new Date());
  sheet.getRange(row, col('Atualizado por')).setValue('Admin (correção)');
  return { id: id };
}
