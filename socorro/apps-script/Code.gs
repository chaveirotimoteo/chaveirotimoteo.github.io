/**
 * Chaveiro Timóteo — Controle de Socorro
 * Backend em Google Apps Script.
 *
 * Autenticação: cada pedido traz um "crachá" (ID token) emitido pelo Google
 * quando a pessoa faz login no app. Este script confere o crachá direto com
 * o Google e depois procura o e-mail na aba "Usuarios" desta planilha. Não
 * existe senha guardada em lugar nenhum — quem não estiver na lista, ou
 * estiver marcado como inativo, não passa.
 */

// Cole aqui o Client ID criado no Google Cloud Console (ver README.md).
// Precisa ser IDÊNTICO ao GOOGLE_CLIENT_ID de assets/app.js.
// Este valor é público por natureza — não é segredo.
var CLIENT_ID = '725408565457-tva4ijg1dvu1mdfb0tcvj0d87fml43k2.apps.googleusercontent.com';

// Primeiro administrador. Se a aba "Usuarios" ainda não existir ou estiver
// vazia, este e-mail é cadastrado como Admin para você conseguir entrar e
// cadastrar o resto da equipe pela tela de administração do app.
var BOOTSTRAP_ADMIN = 'willliantimoteo@gmail.com';

var SHEET_NAME = 'Socorros';
var USERS_SHEET = 'Usuarios';
var PHOTOS_FOLDER = 'Socorro - Fotos';

var COLUMNS = [
  'ID', 'Criado em', 'Técnico', 'Categoria', 'Tipo', 'Cliente', 'Telefone',
  'Endereço', 'Descrição', 'Valor orçado', 'Valor final', 'Status',
  'Previsão de finalização', 'Data de finalização', 'Fotos', 'Observações',
  'Atualizado em', 'Atualizado por',
];

var USER_COLUMNS = ['E-mail', 'Nome', 'Perfil', 'Ativo', 'Criado em'];

// ===================== Roteamento =====================

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
      return jsonOut(out);
    }

    // Todo pedido exige um crachá válido e um usuário ativo na lista.
    var identity = verifyIdToken(body.idToken);
    var user = requireActiveUser(identity);

    switch (body.action) {
      case 'session':
        out = { ok: true, user: user };
        break;
      case 'list':
        out = { ok: true, items: listServices(), user: user };
        break;
      case 'create':
        out = { ok: true, item: createService(body.data || {}, user) };
        break;
      case 'setStatus':
        out = { ok: true, item: setStatus(body.id, body.status, body.data || {}, user) };
        break;
      case 'photo':
        out = { ok: true, photo: readPhoto(body.fileId) };
        break;
      case 'edit':
        requireAdmin(user);
        out = { ok: true, item: editService(body.id, body.data || {}, user) };
        break;
      case 'listUsers':
        requireAdmin(user);
        out = { ok: true, users: listUsers() };
        break;
      case 'saveUser':
        requireAdmin(user);
        out = { ok: true, users: saveUser(body.data || {}, user) };
        break;
      case 'deleteUser':
        requireAdmin(user);
        out = { ok: true, users: deleteUser(body.email, user) };
        break;
      default:
        out = { ok: false, error: 'Ação desconhecida.' };
    }
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err) };
    if (err && err.authFailed) out.authFailed = true;
  }
  return jsonOut(out);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function authError(message) {
  var err = new Error(message);
  err.authFailed = true; // o app usa isso para reabrir a tela de login
  return err;
}

// ===================== Autenticação =====================

/**
 * Confere o crachá com o próprio Google. Se o token foi adulterado, expirou
 * ou foi emitido para outra aplicação, o Google recusa e ninguém entra.
 */
function verifyIdToken(idToken) {
  if (!idToken) throw authError('Faça login para continuar.');
  if (CLIENT_ID.indexOf('COLE_AQUI') === 0) {
    throw new Error('O Client ID do Google ainda não foi configurado no Code.gs.');
  }

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) {
    throw authError('Sessão expirada. Entre novamente com o Google.');
  }

  var info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID) throw authError('Login emitido para outra aplicação.');
  if (String(info.email_verified) !== 'true') throw authError('E-mail não verificado no Google.');
  if (Number(info.exp) * 1000 < Date.now()) throw authError('Sessão expirada. Entre novamente.');
  if (!info.email) throw authError('Não foi possível ler o e-mail da sua conta Google.');

  return { email: String(info.email).toLowerCase(), nomeGoogle: info.name || '' };
}

function requireActiveUser(identity) {
  var user = findUser(identity.email);
  if (!user) {
    throw authError('A conta ' + identity.email + ' não tem acesso a este aplicativo. Peça para o administrador liberar.');
  }
  if (!user.ativo) {
    throw authError('O acesso da conta ' + identity.email + ' está desativado.');
  }
  if (!user.nome && identity.nomeGoogle) user.nome = identity.nomeGoogle;
  return user;
}

function requireAdmin(user) {
  if (user.perfil !== 'Admin') {
    throw new Error('Somente um administrador pode fazer isso.');
  }
}

// ===================== Planilhas =====================

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getUsersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) sheet = ss.insertSheet(USERS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(USER_COLUMNS);
    sheet.setFrozenRows(1);
  }
  // Sem ninguém cadastrado, o administrador inicial entra automaticamente —
  // senão não haveria como fazer o primeiro login.
  if (sheet.getLastRow() === 1 && BOOTSTRAP_ADMIN) {
    sheet.appendRow([BOOTSTRAP_ADMIN.toLowerCase(), 'Administrador', 'Admin', 'Sim', new Date()]);
  }
  return sheet;
}

function listUsers() {
  var sheet = getUsersSheet();
  var values = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    users.push({
      email: String(values[i][0]).toLowerCase(),
      nome: values[i][1] || '',
      perfil: values[i][2] === 'Admin' ? 'Admin' : 'Técnico',
      ativo: String(values[i][3]).toLowerCase() !== 'não' && String(values[i][3]).toLowerCase() !== 'nao',
    });
  }
  return users;
}

function findUser(email) {
  var target = String(email || '').toLowerCase();
  var users = listUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === target) return users[i];
  }
  return null;
}

function findUserRow(sheet, email) {
  var target = String(email || '').toLowerCase();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === target) return i + 2;
  }
  return -1;
}

function saveUser(data, actor) {
  var email = String(data.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) throw new Error('Informe um e-mail válido.');

  var perfil = data.perfil === 'Admin' ? 'Admin' : 'Técnico';
  var ativo = data.ativo === false ? 'Não' : 'Sim';
  var nome = String(data.nome || '').trim();

  var sheet = getUsersSheet();
  var row = findUserRow(sheet, email);

  // Trava de segurança: um admin não pode se rebaixar nem se desativar, para
  // não existir a situação de uma planilha sem nenhum administrador ativo.
  if (email === actor.email && (perfil !== 'Admin' || ativo === 'Não')) {
    throw new Error('Você não pode remover o seu próprio acesso de administrador.');
  }

  if (row < 0) {
    sheet.appendRow([email, nome, perfil, ativo, new Date()]);
  } else {
    sheet.getRange(row, 1, 1, 4).setValues([[email, nome, perfil, ativo]]);
  }
  return listUsers();
}

function deleteUser(email, actor) {
  var target = String(email || '').trim().toLowerCase();
  if (target === actor.email) throw new Error('Você não pode remover a si mesmo.');
  var sheet = getUsersSheet();
  var row = findUserRow(sheet, target);
  if (row < 0) throw new Error('Usuário não encontrado.');
  sheet.deleteRow(row);
  return listUsers();
}

// ===================== Atendimentos =====================

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
    fotos: parsePhotoIds(obj['Fotos']),
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

function createService(data, user) {
  var sheet = getSheet();
  var id = Utilities.getUuid();
  var now = new Date();
  var fotoIds = savePhotos(data.fotos);

  sheet.appendRow([
    id, now, user.nome || user.email, data.categoria || '', data.tipo || '',
    data.clienteNome || '', data.clienteTelefone || '', data.endereco || '',
    data.descricao || '', data.valorOrcado || '', '', 'Pendente',
    data.previsao || '', '', fotoIds.join(','), data.observacoes || '',
    now, user.nome || user.email,
  ]);

  return { id: id, status: 'Pendente' };
}

function setStatus(id, status, data, user) {
  var sheet = getSheet();
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Registro não encontrado.');
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = function (name) { return header.indexOf(name) + 1; };

  sheet.getRange(row, col('Status')).setValue(status);
  if (status === 'Finalizado' || status === 'Devedor') {
    sheet.getRange(row, col('Data de finalização')).setValue(new Date());
    if (data.valorFinal !== undefined && data.valorFinal !== '' && data.valorFinal !== null) {
      sheet.getRange(row, col('Valor final')).setValue(data.valorFinal);
    }
  }

  var novasFotos = savePhotos(data.fotos);
  if (novasFotos.length) {
    var atual = sheet.getRange(row, col('Fotos')).getValue();
    sheet.getRange(row, col('Fotos')).setValue((atual ? atual + ',' : '') + novasFotos.join(','));
  }

  sheet.getRange(row, col('Atualizado em')).setValue(new Date());
  sheet.getRange(row, col('Atualizado por')).setValue(user.nome || user.email);
  return { id: id, status: status };
}

function editService(id, data, user) {
  var sheet = getSheet();
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Registro não encontrado.');
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = function (name) { return header.indexOf(name) + 1; };

  var map = {
    tecnico: 'Técnico', categoria: 'Categoria', tipo: 'Tipo',
    clienteNome: 'Cliente', clienteTelefone: 'Telefone', endereco: 'Endereço',
    descricao: 'Descrição', valorOrcado: 'Valor orçado', valorFinal: 'Valor final',
    status: 'Status', previsao: 'Previsão de finalização', observacoes: 'Observações',
  };
  Object.keys(map).forEach(function (key) {
    if (data[key] !== undefined) sheet.getRange(row, col(map[key])).setValue(data[key]);
  });

  sheet.getRange(row, col('Atualizado em')).setValue(new Date());
  sheet.getRange(row, col('Atualizado por')).setValue((user.nome || user.email) + ' (correção)');
  return { id: id };
}

// ===================== Fotos =====================

function getOrCreateFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

/**
 * As fotos ficam PRIVADAS no Drive (visíveis só para o dono da planilha).
 * O app não usa o link do Drive: pede o conteúdo por aqui, e só entrega a
 * quem já passou pela verificação de login acima.
 */
function savePhotos(fotos) {
  if (!fotos || !fotos.length) return [];
  var folder = getOrCreateFolder(PHOTOS_FOLDER);
  var ids = [];
  fotos.forEach(function (f) {
    try {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(f.base64),
        f.mimeType || 'image/jpeg',
        f.name || ('foto-' + Date.now() + '.jpg')
      );
      ids.push(folder.createFile(blob).getId());
    } catch (err) {
      // Uma foto que falhe não pode derrubar o lançamento inteiro.
    }
  });
  return ids;
}

// Aceita tanto os IDs novos quanto os links completos gravados antes.
function parsePhotoIds(cell) {
  if (!cell) return [];
  return String(cell)
    .split(',')
    .map(function (part) {
      part = part.trim();
      if (!part) return '';
      var m = part.match(/[-\w]{25,}/);
      return m ? m[0] : part;
    })
    .filter(Boolean);
}

function readPhoto(fileId) {
  if (!fileId) throw new Error('Foto não informada.');
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  return {
    id: fileId,
    mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}

// ===================== Diagnóstico =====================

/**
 * Rode pelo editor (menu Executar) para conferir se as permissões estão
 * concedidas. O resultado aparece no "Registro de execução", embaixo.
 * Se esta função passar e o app ainda falhar, o problema é a implantação
 * estar servindo uma versão antiga — refaça "Nova versão".
 */
function testarPermissoes() {
  var linhas = [];

  try {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=teste', { muteHttpExceptions: true });
    linhas.push('OK  - Chamadas externas (UrlFetchApp) liberadas. Código HTTP: ' + res.getResponseCode() + ' (400 aqui é esperado, o token é falso).');
  } catch (err) {
    linhas.push('FALHA - Chamadas externas bloqueadas: ' + err.message);
  }

  try {
    var nome = SpreadsheetApp.getActiveSpreadsheet().getName();
    linhas.push('OK  - Planilha acessível: "' + nome + '".');
  } catch (err) {
    linhas.push('FALHA - Planilha inacessível: ' + err.message);
  }

  try {
    getOrCreateFolder(PHOTOS_FOLDER);
    linhas.push('OK  - Drive acessível (pasta de fotos).');
  } catch (err) {
    linhas.push('FALHA - Drive inacessível: ' + err.message);
  }

  linhas.push('Client ID configurado: ' + (CLIENT_ID.indexOf('COLE_AQUI') === 0 ? 'NÃO' : 'sim'));
  linhas.push('Administrador inicial: ' + BOOTSTRAP_ADMIN);

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}

/**
 * Rode UMA VEZ pelo editor do Apps Script (menu Executar) para revogar o
 * compartilhamento público das fotos enviadas na versão anterior do app.
 */
function protegerFotosAntigas() {
  var folder = getOrCreateFolder(PHOTOS_FOLDER);
  var files = folder.getFiles();
  var n = 0;
  while (files.hasNext()) {
    var file = files.next();
    try {
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      n++;
    } catch (err) {
      // Alguns arquivos podem já estar privados.
    }
  }
  Logger.log('Fotos protegidas: ' + n);
}
