/**
 * Contas do Controle da Moto.
 *
 * Só funções puras: entram registros, saem números. Nada aqui toca em tela,
 * rede ou banco — é o que permite conferir as contas sem abrir o app.
 *
 * Todo registro que chega aqui tem "_tipo" (diario, abastecimento,
 * manutencao, ocorrencia, fechamento) e os campos com os mesmos nomes que
 * a planilha usa (km, litros, valorPago, dataHora...).
 */
(function (raiz) {
  'use strict';

  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function data(v) {
    if (!v) return null;
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  // Mês no formato "2026-08", no fuso do aparelho (é o mês que a pessoa vê
  // no calendário, não o de Londres).
  function mesDe(v) {
    var d = data(v);
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function porDataDesc(a, b) {
    return (data(b.dataHora) || 0) - (data(a.dataHora) || 0);
  }

  /**
   * Onde a moto está agora, segundo o último lançamento do diário.
   * Devolve { situacao: 'na rua'|'na base'|'sem registro', desde, com, km }.
   */
  function statusDaMoto(registros) {
    var diario = (registros.diario || []).slice().sort(porDataDesc);
    if (!diario.length) return { situacao: 'sem registro' };

    var ultimo = diario[0];
    return {
      situacao: ultimo.tipo === 'Retirada' ? 'na rua' : 'na base',
      desde: ultimo.dataHora,
      com: ultimo.tecnico || '',
      km: num(ultimo.km),
      registro: ultimo,
    };
  }

  /**
   * Maior KM já registrado, olhando diário, abastecimentos e manutenções.
   * É a referência para conferir se o KM digitado faz sentido.
   */
  function kmAtual(registros) {
    var maior = null;
    ['diario', 'abastecimento', 'manutencao'].forEach(function (tipo) {
      (registros[tipo] || []).forEach(function (r) {
        var km = num(r.km);
        if (km !== null && (maior === null || km > maior)) maior = km;
      });
    });
    return maior;
  }

  /** A regra da empresa é completar o tanque; só "Não" marca o contrário. */
  function tanqueCompleto(a) {
    return a.tanqueCompleto !== 'Não';
  }

  /**
   * Consumo de cada abastecimento, de tanque a tanque: os KM rodados desde o
   * abastecimento anterior divididos pelos litros DESTE.
   *
   * A conta só fecha entre dois tanques CHEIOS — é isso que a regra de
   * "sempre completar" garante. Por isso o consumo fica de fora quando:
   *   - é o primeiro abastecimento (não há anterior para comparar);
   *   - este não completou o tanque (os litros não repõem a distância toda);
   *   - o ANTERIOR não completou (o ponto de partida não era tanque cheio).
   *
   * Descartar esses casos é o que faz a média ser um número de verdade, em
   * vez de uma estimativa que sobe e desce sem explicação.
   */
  function consumoPorAbastecimento(abastecimentos) {
    var lista = (abastecimentos || [])
      .filter(function (a) { return num(a.km) !== null; })
      .slice()
      .sort(function (a, b) { return num(a.km) - num(b.km); });

    return lista.map(function (a, i) {
      var litros = num(a.litros);
      var valor = num(a.valorPago);
      var anterior = i > 0 ? lista[i - 1] : null;
      var rodados = anterior ? num(a.km) - num(anterior.km) : null;
      var comparavel = rodados !== null && litros > 0 &&
        tanqueCompleto(a) && tanqueCompleto(anterior);

      return Object.assign({}, a, {
        kmRodados: rodados,
        kmPorLitro: comparavel ? rodados / litros : null,
        precoLitro: litros > 0 && valor !== null ? valor / litros : null,
        // Por que este abastecimento não entra na conta de consumo. Vale
        // mostrar na tela: senão parece defeito do app.
        semConsumoPorque: comparavel ? null
          : !anterior ? 'primeiro abastecimento registrado'
          : !tanqueCompleto(a) ? 'o tanque não foi completado'
          : !tanqueCompleto(anterior) ? 'o abastecimento anterior não completou o tanque'
          : 'faltam os litros',
      });
    });
  }

  /** Média de KM/L descartando os abastecimentos sem consumo calculável. */
  function mediaKmPorLitro(abastecimentos) {
    var comConsumo = consumoPorAbastecimento(abastecimentos)
      .filter(function (a) { return a.kmPorLitro !== null && a.kmPorLitro > 0; });
    if (!comConsumo.length) return null;
    var somaKm = 0, somaLitros = 0;
    comConsumo.forEach(function (a) {
      somaKm += a.kmRodados;
      somaLitros += num(a.litros);
    });
    return somaLitros > 0 ? somaKm / somaLitros : null;
  }

  /**
   * Fecha os números de um mês ("2026-08").
   *
   * KM rodados vem do maior menos o menor KM registrado no mês — mesma
   * conta que era feita na mão no Notion, só que sem precisar procurar.
   */
  function resumoDoMes(registros, mes) {
    var noMes = function (lista) {
      return (lista || []).filter(function (r) { return mesDe(r.dataHora) === mes; });
    };

    var diario = noMes(registros.diario);
    var abast = noMes(registros.abastecimento);
    var manut = noMes(registros.manutencao);
    var ocorr = noMes(registros.ocorrencia);

    var kms = diario.concat(abast, manut)
      .map(function (r) { return num(r.km); })
      .filter(function (v) { return v !== null; });

    var kmInicial = kms.length ? Math.min.apply(null, kms) : null;
    var kmFinal = kms.length ? Math.max.apply(null, kms) : null;
    var kmRodados = kmInicial !== null ? kmFinal - kmInicial : null;

    var litros = 0, gastoCombustivel = 0;
    abast.forEach(function (a) {
      litros += num(a.litros) || 0;
      gastoCombustivel += num(a.valorPago) || 0;
    });

    var gastoManutencao = 0;
    manut.forEach(function (m) { gastoManutencao += num(m.valor) || 0; });

    var gastoOcorrencias = 0;
    ocorr.forEach(function (o) { gastoOcorrencias += num(o.valor) || 0; });

    var custoTotal = gastoCombustivel + gastoManutencao;

    return {
      mes: mes,
      kmInicial: kmInicial,
      kmFinal: kmFinal,
      kmRodados: kmRodados,
      litros: litros,
      gastoCombustivel: gastoCombustivel,
      gastoManutencao: gastoManutencao,
      gastoOcorrencias: gastoOcorrencias,
      custoTotal: custoTotal,
      // KM/L do mês: usa o consumo tanque a tanque dos abastecimentos do
      // mês, não os KM rodados — assim um mês que começou com o tanque
      // cheio não distorce o número.
      kmPorLitro: mediaKmPorLitro(abast),
      custoPorKm: kmRodados > 0 ? custoTotal / kmRodados : null,
      abastecimentos: abast.length,
      manutencoes: manut.length,
      ocorrencias: ocorr.length,
    };
  }

  /** Meses que têm algum lançamento, do mais recente para o mais antigo. */
  function mesesComRegistro(registros) {
    var set = {};
    ['diario', 'abastecimento', 'manutencao', 'ocorrencia'].forEach(function (tipo) {
      (registros[tipo] || []).forEach(function (r) {
        var m = mesDe(r.dataHora);
        if (m) set[m] = true;
      });
    });
    return Object.keys(set).sort().reverse();
  }

  /** Ocorrências que ainda cobram uma providência. */
  function ocorrenciasAbertas(registros) {
    var resolvidas = ['Resolvida', 'Paga', 'Descontada'];
    return (registros.ocorrencia || []).filter(function (o) {
      return resolvidas.indexOf(o.status) < 0;
    });
  }

  /**
   * Confere se o KM digitado bate com o histórico. Não bloqueia nada:
   * offline o último KM conhecido pode estar velho, e um aviso errado não
   * pode impedir o registro de acontecer.
   */
  function avisoDeKm(kmDigitado, kmConhecido) {
    var km = num(kmDigitado);
    if (km === null) return null;
    if (km <= 0) return 'O KM precisa ser maior que zero.';
    if (kmConhecido === null || kmConhecido === undefined) return null;
    if (km < kmConhecido) {
      return 'Esse KM é MENOR que o último registrado (' + formataKm(kmConhecido) + '). Confira o painel.';
    }
    if (km - kmConhecido > 2000) {
      return 'São ' + formataKm(km - kmConhecido) + ' km desde o último registro. Confira se não sobrou um dígito.';
    }
    return null;
  }

  // ===== Formatação =====

  var moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formataMoeda(v) {
    var n = num(v);
    return n === null ? '—' : moeda.format(n);
  }

  function formataKm(v) {
    var n = num(v);
    return n === null ? '—' : new Intl.NumberFormat('pt-BR').format(Math.round(n)) + ' km';
  }

  function formataNumero(v, casas) {
    var n = num(v);
    if (n === null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: casas === undefined ? 2 : casas,
      maximumFractionDigits: casas === undefined ? 2 : casas,
    }).format(n);
  }

  function formataDataHora(v) {
    var d = data(v);
    if (!d) return '';
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function formataData(v) {
    var d = data(v);
    return d ? d.toLocaleDateString('pt-BR') : '';
  }

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function formataMes(mes) {
    var partes = String(mes || '').split('-');
    if (partes.length !== 2) return mes || '';
    var i = Number(partes[1]) - 1;
    return (MESES[i] || partes[1]) + ' de ' + partes[0];
  }

  /** "há 2 h", "ontem" — o quanto tempo faz, em linguagem de gente. */
  function tempoRelativo(v, agora) {
    var d = data(v);
    if (!d) return '';
    // Tempo decorrido se conta para baixo: 90 minutos é "há 1 hora", não 2.
    var min = Math.floor(((agora || new Date()) - d) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'há ' + h + (h === 1 ? ' hora' : ' horas');
    var dias = Math.floor(h / 24);
    if (dias === 1) return 'ontem';
    if (dias < 30) return 'há ' + dias + ' dias';
    return formataData(v);
  }

  raiz.MotoCalc = {
    num: num,
    tanqueCompleto: tanqueCompleto,
    mesDe: mesDe,
    statusDaMoto: statusDaMoto,
    kmAtual: kmAtual,
    consumoPorAbastecimento: consumoPorAbastecimento,
    mediaKmPorLitro: mediaKmPorLitro,
    resumoDoMes: resumoDoMes,
    mesesComRegistro: mesesComRegistro,
    ocorrenciasAbertas: ocorrenciasAbertas,
    avisoDeKm: avisoDeKm,
    formataMoeda: formataMoeda,
    formataKm: formataKm,
    formataNumero: formataNumero,
    formataDataHora: formataDataHora,
    formataData: formataData,
    formataMes: formataMes,
    tempoRelativo: tempoRelativo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
