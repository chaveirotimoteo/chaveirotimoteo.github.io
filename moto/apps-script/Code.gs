/**
 * Chaveiro Timóteo — Controle da Moto
 * Backend em Google Apps Script.
 *
 * Este script é INDEPENDENTE do Controle de Socorro: outra planilha, outra
 * implantação, outra lista de usuários. Os dois apps não se misturam.
 *
 * Autenticação: cada pedido traz um "crachá" (ID token) emitido pelo Google
 * quando a pessoa faz login no app. Este script confere o crachá direto com
 * o Google e depois procura o e-mail na aba "Usuarios" desta planilha. Não
 * existe senha guardada em lugar nenhum.
 *
 * Sobre o offline: o app grava primeiro no aparelho e envia depois, então o
 * MESMO registro pode chegar aqui mais de uma vez (rede caindo no meio do
 * envio, o técnico reabrindo o app, etc). Por isso o ID de cada linha é
 * gerado no celular e conferido antes de gravar — reenviar nunca duplica.
 */

// Sobe a cada mudança neste arquivo. Serve para conferir, pela resposta de
// diagnóstico (abra a URL do app com "?diag=1"), se a implantação está
// rodando esta versão ou uma antiga esquecida.
var CODE_VERSION = '2026-08-28-1';

// Client ID criado no Google Cloud Console (ver README.md). Precisa ser
// IDÊNTICO ao GOOGLE_CLIENT_ID de assets/app.js. Este valor é público por
// natureza — não é segredo.
//
// É o mesmo do Controle de Socorro porque ele autoriza o ENDEREÇO do site,
// que é o mesmo para os dois apps. Os dados continuam separados: cada app
// fala com a sua planilha e tem a sua própria aba "Usuarios".
var CLIENT_ID = '725408565457-tva4ijg1dvu1mdfb0tcvj0d87fml43k2.apps.googleusercontent.com';

// Primeiro administrador. Se a aba "Usuarios" ainda não existir ou estiver
// vazia, este e-mail é cadastrado como Admin para você conseguir entrar e
// cadastrar o resto da equipe pela tela de administração do app.
var BOOTSTRAP_ADMIN = 'willliantimoteo@gmail.com';

// Identificação da moto. Vai gravada em todas as linhas: se um dia entrar
// uma segunda moto na frota, os números de cada uma já saem separados na
// planilha sem precisar remexer no histórico.
var MOTO = 'Moto 1';

// Regras da empresa que o app mostra e a planilha registra.
var LIMITE_ABASTECIMENTO = 40;   // R$ pré-autorizados sem pedir antes
var HISTORICO_DIAS = 120;        // quanto o app carrega por padrão

var PHOTOS_FOLDER = 'Moto - Fotos';
var USERS_SHEET = 'Usuarios';

// ===================== Estrutura da planilha =====================
// Uma aba por tipo de registro, com colunas fixas. As duas primeiras
// colunas são sempre ID e Data/Hora — isso mantém as fórmulas que você
// escrever ao lado previsíveis.

var SHEETS = {
  diario: {
    nome: 'Diario de Bordo',
    colunas: [
      'ID', 'Data/Hora', 'Moto', 'Tipo', 'Técnico', 'KM', 'Observação',
      'Foto do painel', 'Registrado em', 'Enviado em',
    ],
  },
  abastecimento: {
    nome: 'Abastecimentos',
    colunas: [
      'ID', 'Data/Hora', 'Moto', 'Técnico', 'KM', 'Litros', 'Valor pago',
      'Preço/litro', 'Posto', 'Acima do pré-autorizado', 'Observação',
      'Foto do visor da bomba', 'Registrado em', 'Enviado em',
    ],
  },
  ocorrencia: {
    nome: 'Ocorrencias',
    colunas: [
      'ID', 'Data/Hora', 'Moto', 'Data do fato', 'Tipo', 'Técnico',
      'O que houve?', 'Status', 'Valor', 'Prazo de indicação',
      'Foto / Documento', 'Registrado em', 'Enviado em',
    ],
  },
  manutencao: {
    nome: 'Manutencoes',
    colunas: [
      'ID', 'Data/Hora', 'Moto', 'Data', 'Serviço', 'Tipo', 'Item', 'KM',
      'Valor', 'Oficina', 'Forma de pagamento', 'Autorizado por',
      'Observação', 'Nota fiscal', 'Registrado em', 'Enviado em',
    ],
  },
  fechamento: {
    nome: 'Fechamento Mensal',
    colunas: [
      'ID', 'Data/Hora', 'Moto', 'Mês', 'KM inicial', 'KM final',
      'KM rodados', 'Litros', 'Gasto combustível', 'Gasto manutenção',
      'Outros custos', 'Custo total', 'KM/L', 'Custo por KM',
      'Fechado por', 'Registrado em', 'Enviado em',
    ],
  },
};

var USER_COLUMNS = ['E-mail', 'Nome', 'Perfil', 'Ativo', 'Criado em'];

// Colunas que o app pode preencher/corrigir, por tipo. Qualquer outra
// coisa que chegue no pedido é ignorada. O nome do campo usado pelo app é
// derivado do nome da coluna (ver chaveDe): "Valor pago" -> valorPago. Assim
// existe UM nome por informação, valendo tanto para gravar quanto para ler.
var EDITAVEIS = {
  diario: ['Tipo', 'Técnico', 'KM', 'Observação'],
  abastecimento: ['Técnico', 'KM', 'Litros', 'Valor pago', 'Posto', 'Observação'],
  ocorrencia: [
    'Data do fato', 'Tipo', 'Técnico', 'O que houve?', 'Status', 'Valor',
    'Prazo de indicação',
  ],
  manutencao: [
    'Data', 'Serviço', 'Tipo', 'Item', 'KM', 'Valor', 'Oficina',
    'Forma de pagamento', 'Autorizado por', 'Observação',
  ],
  fechamento: [
    'Mês', 'KM inicial', 'KM final', 'Litros', 'Gasto combustível',
    'Gasto manutenção', 'Outros custos',
  ],
};

// Coluna de foto de cada tipo (o app manda as imagens em "fotos").
var COLUNA_FOTO = {
  diario: 'Foto do painel',
  abastecimento: 'Foto do visor da bomba',
  ocorrencia: 'Foto / Documento',
  manutencao: 'Nota fiscal',
  fechamento: null,
};

// ===================== Roteamento =====================

function doPost(e) {
  return handleRequest(e);
}

function doGet(e) {
  // Abrir a URL do app com "?diag=1" no final, direto no navegador (sem
  // precisar do editor do Apps Script nem de login), mostra na hora se as
  // permissões estão liberadas e qual versão do código está implantada.
  if (e && e.parameter && e.parameter.diag === '1') {
    return diag();
  }
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
      out = { ok: true, info: 'Controle da Moto — backend ativo.' };
      return jsonOut(out);
    }

    // Todo pedido exige um crachá válido e um usuário ativo na lista.
    var identity = verifyIdToken(body.idToken);
    var user = requireActiveUser(identity);

    switch (body.action) {
      case 'session':
        out = { ok: true, user: user, config: configPublica() };
        break;
      case 'list':
        out = listAll(body.historico === true);
        out.ok = true;
        out.user = user;
        out.config = configPublica();
        break;
      case 'create':
        // O app manda um lote: a fila inteira que estava esperando envio.
        out = { ok: true, resultados: createBatch(body.registros || [], user) };
        break;
      case 'setStatus':
        out = { ok: true, item: setStatusOcorrencia(body.id, body.status, user) };
        break;
      case 'photo':
        out = { ok: true, photo: readPhoto(body.fileId) };
        break;
      case 'edit':
        requireAdmin(user);
        out = { ok: true, item: editRegistro(body.tipo, body.id, body.data || {}, user) };
        break;
      case 'delete':
        requireAdmin(user);
        out = { ok: true, removido: deleteRegistro(body.tipo, body.id) };
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

function configPublica() {
  return { moto: MOTO, limiteAbastecimento: LIMITE_ABASTECIMENTO };
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

// ===================== Abas e usuários =====================

function getSheet(tipo) {
  var def = SHEETS[tipo];
  if (!def) throw new Error('Tipo de registro desconhecido: ' + tipo);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(def.nome);
  if (!sheet) sheet = ss.insertSheet(def.nome);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(def.colunas);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, def.colunas.length).setFontWeight('bold');
    sheet.setColumnWidth(1, 90);
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

// ===================== Leitura dos registros =====================

function valorCelula(v) {
  // Datas viram texto ISO para o app não depender do fuso da planilha.
  if (v instanceof Date) return v.toISOString();
  return v === '' ? '' : v;
}

function rowToObject(tipo, header, row) {
  // "_tipo" é a espécie do registro (diario, abastecimento...), não uma
  // coluna da planilha. O underscore evita que ela seja sobrescrita pela
  // coluna "Tipo", que existe em quase todas as abas com outro sentido.
  var obj = { _tipo: tipo };
  header.forEach(function (h, i) {
    obj[chaveDe(h)] = valorCelula(row[i]);
  });
  var colFoto = COLUNA_FOTO[tipo];
  obj.fotos = colFoto ? parsePhotoIds(obj[chaveDe(colFoto)]) : [];
  return obj;
}

/**
 * "Valor pago" -> "valorPago". É a única regra de conversão entre o nome da
 * coluna na planilha e o nome do campo no app: vale para ler e para gravar,
 * então cada informação tem UM nome só dos dois lados.
 */
function chaveDe(nomeColuna) {
  var s = String(nomeColuna || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // tira acentos
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim().toLowerCase();
  if (!s) return '';
  var partes = s.split(/\s+/);
  return partes[0] + partes.slice(1).map(function (p) {
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('');
}

/**
 * Devolve os registros de todas as abas, do mais recente para o mais antigo.
 *
 * Sem "incluirHistorico", traz só os últimos HISTORICO_DIAS dias — o que
 * mantém a resposta leve no celular conforme a planilha cresce. Ocorrências
 * ainda não resolvidas nunca são ocultadas: são pendência em aberto.
 */
function listAll(incluirHistorico) {
  var limite = new Date();
  limite.setDate(limite.getDate() - HISTORICO_DIAS);

  var out = { registros: {}, ocultos: 0 };

  Object.keys(SHEETS).forEach(function (tipo) {
    var sheet = getSheet(tipo);
    var values = sheet.getDataRange().getValues();
    var header = values[0];
    var lista = [];

    for (var i = 1; i < values.length; i++) {
      if (!values[i][0]) continue;
      var item = rowToObject(tipo, header, values[i]);

      if (!incluirHistorico) {
        var aberta = tipo === 'ocorrencia' && item.status !== 'Resolvida' && item.status !== 'Paga' && item.status !== 'Descontada';
        var data = item.dataHora ? new Date(item.dataHora) : null;
        if (!aberta && data && !isNaN(data.getTime()) && data < limite) {
          out.ocultos++;
          continue;
        }
      }
      lista.push(item);
    }

    lista.reverse();
    out.registros[tipo] = lista;
  });

  return out;
}

function findRowById(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// ===================== Gravação =====================

/**
 * Grava um lote de registros vindos da fila do celular.
 *
 * Cada registro traz o ID gerado no aparelho. Se esse ID já estiver na aba,
 * a linha NÃO é gravada de novo: o app só não tinha recebido a confirmação
 * do envio anterior. Devolvemos "duplicado" para ele tirar da fila em paz.
 */
function createBatch(registros, user) {
  var resultados = [];
  var lock = LockService.getScriptLock();
  // Dois celulares enviando ao mesmo tempo poderiam ler o "já existe?" antes
  // de o outro gravar. A trava resolve; 30s é folgado para um lote com fotos.
  try {
    lock.waitLock(30000);
  } catch (err) {
    // O app mantém a fila e tenta de novo sozinho — nada se perde.
    throw new Error('A planilha está recebendo outro envio agora. Tente em instantes.');
  }
  try {
    registros.forEach(function (reg) {
      try {
        resultados.push(createRegistro(reg, user));
      } catch (err) {
        resultados.push({
          id: reg && reg.id,
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    });
  } finally {
    lock.releaseLock();
  }
  return resultados;
}

function createRegistro(reg, user) {
  var tipo = reg.tipo;
  var def = SHEETS[tipo];
  if (!def) throw new Error('Tipo de registro desconhecido: ' + tipo);
  if (!reg.id) throw new Error('Registro sem identificador.');

  var sheet = getSheet(tipo);
  if (findRowById(sheet, reg.id) > 0) {
    return { id: reg.id, ok: true, duplicado: true };
  }

  var data = reg.data || {};
  var editaveis = EDITAVEIS[tipo];
  var linha = {};

  editaveis.forEach(function (coluna) {
    var valor = data[chaveDe(coluna)];
    if (valor === undefined || valor === null || valor === '') return;
    linha[coluna] = normalizaValor(coluna, valor);
  });

  // Campos que o servidor decide — não aceita do cliente.
  linha['ID'] = reg.id;
  linha['Data/Hora'] = parseData(reg.registradoEm) || new Date();
  linha['Moto'] = MOTO;
  linha['Registrado em'] = parseData(reg.registradoEm) || new Date();
  linha['Enviado em'] = new Date();

  // O técnico é sempre quem está logado: ninguém lança em nome de outro.
  if (editaveis.indexOf('Técnico') >= 0) linha['Técnico'] = user.nome || user.email;

  if (tipo === 'abastecimento') {
    var litros = Number(linha['Litros']) || 0;
    var valor = Number(linha['Valor pago']) || 0;
    linha['Preço/litro'] = litros > 0 ? arredonda(valor / litros, 3) : '';
    linha['Acima do pré-autorizado'] = valor > LIMITE_ABASTECIMENTO ? 'Sim' : 'Não';
  }

  if (tipo === 'ocorrencia') {
    if (!linha['Status']) linha['Status'] = 'Aberta';
  }

  if (tipo === 'fechamento') {
    var kmRodados = (Number(linha['KM final']) || 0) - (Number(linha['KM inicial']) || 0);
    var custoTotal = (Number(linha['Gasto combustível']) || 0)
      + (Number(linha['Gasto manutenção']) || 0)
      + (Number(linha['Outros custos']) || 0);
    var litrosMes = Number(linha['Litros']) || 0;
    linha['KM rodados'] = kmRodados;
    linha['Custo total'] = arredonda(custoTotal, 2);
    linha['KM/L'] = litrosMes > 0 ? arredonda(kmRodados / litrosMes, 2) : '';
    linha['Custo por KM'] = kmRodados > 0 ? arredonda(custoTotal / kmRodados, 3) : '';
    linha['Fechado por'] = user.nome || user.email;
  }

  var colFoto = COLUNA_FOTO[tipo];
  if (colFoto) linha[colFoto] = savePhotos(reg.fotos).join(',');

  sheet.appendRow(def.colunas.map(function (c) {
    return linha[c] === undefined ? '' : linha[c];
  }));

  return { id: reg.id, ok: true };
}

// Datas chegam como texto ISO ou "AAAA-MM-DD"; números como texto às vezes.
function normalizaValor(coluna, valor) {
  if (coluna === 'Data do fato' || coluna === 'Prazo de indicação' || coluna === 'Data') {
    return parseData(valor) || '';
  }
  if (Array.isArray(valor)) return valor.join(', ');
  return valor;
}

function parseData(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function arredonda(n, casas) {
  var f = Math.pow(10, casas);
  return Math.round(n * f) / f;
}

function setStatusOcorrencia(id, status, user) {
  var permitidos = ['Aberta', 'Indicação enviada', 'Paga', 'Descontada', 'Resolvida'];
  if (permitidos.indexOf(status) < 0) throw new Error('Status inválido.');

  var sheet = getSheet('ocorrencia');
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Ocorrência não encontrada.');
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(row, header.indexOf('Status') + 1).setValue(status);
  sheet.getRange(row, header.indexOf('Enviado em') + 1).setValue(new Date());
  return { id: id, status: status, por: user.nome || user.email };
}

function editRegistro(tipo, id, data, user) {
  var editaveis = EDITAVEIS[tipo];
  if (!editaveis) throw new Error('Tipo de registro desconhecido: ' + tipo);

  var sheet = getSheet(tipo);
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Registro não encontrado.');
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = function (nome) { return header.indexOf(nome) + 1; };

  editaveis.forEach(function (coluna) {
    var valor = data[chaveDe(coluna)];
    if (valor === undefined) return;
    var c = col(coluna);
    if (c > 0) sheet.getRange(row, c).setValue(normalizaValor(coluna, valor));
  });

  // Recalcula o que é derivado, para a correção não deixar a linha incoerente.
  if (tipo === 'abastecimento') {
    var litros = Number(sheet.getRange(row, col('Litros')).getValue()) || 0;
    var valor = Number(sheet.getRange(row, col('Valor pago')).getValue()) || 0;
    sheet.getRange(row, col('Preço/litro')).setValue(litros > 0 ? arredonda(valor / litros, 3) : '');
    sheet.getRange(row, col('Acima do pré-autorizado')).setValue(valor > LIMITE_ABASTECIMENTO ? 'Sim' : 'Não');
  }

  sheet.getRange(row, col('Enviado em')).setValue(new Date());
  return { id: id, corrigidoPor: user.nome || user.email };
}

function deleteRegistro(tipo, id) {
  var sheet = getSheet(tipo);
  var row = findRowById(sheet, id);
  if (row < 0) throw new Error('Registro não encontrado.');
  sheet.deleteRow(row);
  return true;
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
      // Uma foto que falhe não pode derrubar o lançamento inteiro: o
      // registro do KM vale mais do que a imagem.
    }
  });
  return ids;
}

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

function diag() {
  var linhas = [];
  linhas.push('Controle da Moto — versão implantada: ' + CODE_VERSION);
  linhas.push('');

  try {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=teste', { muteHttpExceptions: true });
    linhas.push('[OK] Chamadas externas (UrlFetchApp) — HTTP ' + res.getResponseCode() + ' (400 aqui é o esperado).');
  } catch (err) {
    linhas.push('[FALHA] Chamadas externas bloqueadas: ' + err.message);
    linhas.push('        -> Precisa reautorizar o script. Veja apps-script/README.md.');
  }

  try {
    linhas.push('[OK] Planilha acessível: "' + SpreadsheetApp.getActiveSpreadsheet().getName() + '".');
  } catch (err) {
    linhas.push('[FALHA] Planilha inacessível: ' + err.message);
  }

  try {
    getOrCreateFolder(PHOTOS_FOLDER);
    linhas.push('[OK] Drive acessível (pasta de fotos).');
  } catch (err) {
    linhas.push('[FALHA] Drive inacessível: ' + err.message);
  }

  linhas.push('');
  linhas.push('Client ID configurado: ' + (CLIENT_ID.indexOf('COLE_AQUI') === 0 ? 'NÃO' : 'sim'));
  linhas.push('Administrador inicial: ' + BOOTSTRAP_ADMIN);
  linhas.push('Moto: ' + MOTO);

  return ContentService.createTextOutput(linhas.join('\n')).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Rode ESTA função pelo editor (menu Executar) para forçar a tela de
 * autorização a aparecer. De propósito, SEM try/catch: o Apps Script só
 * mostra "Autorização necessária" quando o erro de permissão não é
 * capturado pelo código.
 */
function autorizarAgora() {
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=teste', { muteHttpExceptions: true });
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Se você está vendo esta linha sem ter passado por uma tela de autorização antes, as permissões já estavam concedidas.');
}

/**
 * Rode UMA VEZ pelo editor para criar todas as abas com os cabeçalhos
 * certos, antes mesmo do primeiro lançamento. Útil para já montar as
 * fórmulas de relatório ao lado das colunas.
 */
function prepararPlanilha() {
  Object.keys(SHEETS).forEach(function (tipo) { getSheet(tipo); });
  getUsersSheet();
  Logger.log('Abas criadas/conferidas: ' + Object.keys(SHEETS).map(function (t) { return SHEETS[t].nome; }).join(', ') + ', ' + USERS_SHEET);
}
