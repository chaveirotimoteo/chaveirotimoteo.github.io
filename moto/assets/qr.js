/**
 * Gerador de QR code — só o necessário para as etiquetas da moto.
 *
 * Está aqui dentro, e não vindo de uma biblioteca de fora, por um motivo
 * prático: a página de etiquetas precisa funcionar em qualquer computador
 * da loja, inclusive sem internet, e continuar funcionando daqui a anos sem
 * depender de um site de terceiros ter saído do ar.
 *
 * Faz o suficiente e nada além: modo byte (endereços de site são ASCII),
 * correção de erro nível Q (recupera ~25% do código danificado — etiqueta de
 * moto pega sujeira, sol e chuva) e versões 1 a 6, que cobrem endereços de
 * até ~70 caracteres — de sobra para os nossos.
 *
 * Uso:  QR.svg('https://exemplo.com/moto/?acao=abastecimento')  ->  string SVG
 */
(function (raiz) {
  'use strict';

  // ===================================================================
  // Aritmética no corpo finito GF(256) — a base da correção de erro
  // ===================================================================
  // O QR code usa Reed-Solomon, que faz contas num "corpo" de 256
  // elementos onde somar é XOR e multiplicar passa por tabelas de
  // logaritmo. As tabelas abaixo são geradas na carga, pelo polinômio
  // primitivo 0x11D que o padrão QR define.

  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function montarTabelas() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** Polinômio gerador de grau `grau`, usado para calcular a correção. */
  function polinomioGerador(grau) {
    var g = [1];
    for (var i = 0; i < grau; i++) {
      var novo = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        novo[j] ^= g[j];
        novo[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = novo;
    }
    return g;
  }

  /** Divide os dados pelo gerador e devolve o resto: os bytes de correção. */
  function correcao(dados, quantos) {
    var g = polinomioGerador(quantos);
    var resto = new Array(quantos).fill(0);
    for (var i = 0; i < dados.length; i++) {
      var fator = dados[i] ^ resto[0];
      resto.shift();
      resto.push(0);
      if (fator !== 0) {
        for (var j = 0; j < quantos; j++) {
          resto[j] ^= mul(g[j + 1], fator);
        }
      }
    }
    return resto;
  }

  // ===================================================================
  // Tabelas do padrão (versões 1 a 10, correção nível Q)
  // ===================================================================
  // Para cada versão: [bytes de correção por bloco, blocos do grupo 1,
  // bytes de dados por bloco do grupo 1, blocos do grupo 2, bytes de dados
  // por bloco do grupo 2]. Valores da especificação ISO/IEC 18004.

  var VERSOES_Q = {
    1: [13, 1, 13, 0,  0],
    2: [22, 1, 22, 0,  0],
    3: [18, 2, 17, 0,  0],
    4: [26, 2, 24, 0,  0],
    5: [18, 2, 15, 2, 16],
    6: [24, 4, 19, 0,  0],
  };

  // Centro dos padrões de alinhamento, por versão.
  var ALINHAMENTO = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

  function capacidadeDeDados(versao) {
    var v = VERSOES_Q[versao];
    return v[1] * v[2] + v[3] * v[4];
  }

  function tamanho(versao) {
    return versao * 4 + 17;
  }

  // ===================================================================
  // Montagem dos dados
  // ===================================================================

  function bytesDoTexto(texto) {
    // Endereços de site são ASCII; se vier acento, o encodeURI resolve.
    var s = /^[\x00-\x7F]*$/.test(texto) ? texto : encodeURI(texto);
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  // Paramos na versão 6 de propósito: a partir da 7 a norma exige mais dois
  // blocos com a informação de versão, e não precisamos disso — a versão 6
  // já carrega um endereço de ~70 caracteres, bem mais que os nossos.
  function menorVersao(qtdBytes) {
    for (var v = 1; v <= 6; v++) {
      var bitsCabecalho = 4 + 8;  // modo byte + contagem de bytes
      if (qtdBytes * 8 + bitsCabecalho <= capacidadeDeDados(v) * 8) return v;
    }
    throw new Error('Endereço longo demais para o QR code (cabem cerca de 70 caracteres).');
  }

  function montarCodewords(bytes, versao) {
    var bits = [];
    var push = function (valor, quantos) {
      for (var i = quantos - 1; i >= 0; i--) bits.push((valor >> i) & 1);
    };

    push(0b0100, 4);                          // modo byte
    push(bytes.length, versao <= 9 ? 8 : 16); // quantos bytes vêm
    bytes.forEach(function (b) { push(b, 8); });

    var totalBits = capacidadeDeDados(versao) * 8;
    // Terminador: até 4 zeros, se couber.
    for (var i = 0; i < 4 && bits.length < totalBits; i++) bits.push(0);
    // Completa o byte corrente.
    while (bits.length % 8 !== 0) bits.push(0);

    var dados = [];
    for (var j = 0; j < bits.length; j += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[j + k];
      dados.push(b);
    }
    // Enchimento padrão, alternando os dois bytes que a norma define.
    var enchimento = [0xec, 0x11];
    var e = 0;
    while (dados.length < capacidadeDeDados(versao)) {
      dados.push(enchimento[e++ % 2]);
    }
    return dados;
  }

  /**
   * Reparte os dados em blocos, calcula a correção de cada um e intercala
   * tudo — é o entrelaçamento que faz um arranhão no código atingir vários
   * blocos de leve, em vez de destruir um só por inteiro.
   */
  function entrelacar(dados, versao) {
    var v = VERSOES_Q[versao];
    var bytesCorrecao = v[0];
    var blocos = [];
    var pos = 0;

    for (var i = 0; i < v[1]; i++) {
      blocos.push(dados.slice(pos, pos + v[2]));
      pos += v[2];
    }
    for (var j = 0; j < v[3]; j++) {
      blocos.push(dados.slice(pos, pos + v[4]));
      pos += v[4];
    }

    var correcoes = blocos.map(function (b) { return correcao(b, bytesCorrecao); });

    var saida = [];
    var maiorBloco = Math.max.apply(null, blocos.map(function (b) { return b.length; }));
    for (var c = 0; c < maiorBloco; c++) {
      blocos.forEach(function (b) { if (c < b.length) saida.push(b[c]); });
    }
    for (var d = 0; d < bytesCorrecao; d++) {
      correcoes.forEach(function (ec) { saida.push(ec[d]); });
    }
    return saida;
  }

  // ===================================================================
  // Desenho da matriz
  // ===================================================================

  function novaMatriz(n) {
    var m = [];
    for (var i = 0; i < n; i++) {
      m.push(new Array(n).fill(null)); // null = módulo ainda livre
    }
    return m;
  }

  function porFinder(m, linha, coluna) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var y = linha + i, x = coluna + j;
        if (y < 0 || y >= m.length || x < 0 || x >= m.length) continue;
        var borda = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                    (j >= 0 && j <= 6 && (i === 0 || i === 6));
        var miolo = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        m[y][x] = borda || miolo ? 1 : 0;
      }
    }
  }

  function porAlinhamento(m, versao) {
    var centros = ALINHAMENTO[versao];
    centros.forEach(function (linha) {
      centros.forEach(function (coluna) {
        // Não vão sobre os três finders dos cantos.
        if (m[linha][coluna] !== null) return;
        for (var i = -2; i <= 2; i++) {
          for (var j = -2; j <= 2; j++) {
            var borda = Math.max(Math.abs(i), Math.abs(j));
            m[linha + i][coluna + j] = borda === 1 ? 0 : 1;
          }
        }
      });
    });
  }

  function porTiming(m) {
    for (var i = 8; i < m.length - 8; i++) {
      var v = i % 2 === 0 ? 1 : 0;
      if (m[6][i] === null) m[6][i] = v;
      if (m[i][6] === null) m[i][6] = v;
    }
  }

  /** Marca onde a informação de formato vai ficar, para os dados não usarem. */
  function reservarFormato(m) {
    var n = m.length;
    for (var i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = 2;      // 2 = reservado
      if (m[i][8] === null) m[i][8] = 2;
    }
    for (var j = 0; j < 8; j++) {
      if (m[8][n - 1 - j] === null) m[8][n - 1 - j] = 2;
      if (m[n - 1 - j][8] === null) m[n - 1 - j][8] = 2;
    }
    m[n - 8][8] = 1; // módulo sempre escuro, exigido pela norma
  }

  /** Percorre a matriz em ziguezague, de baixo para cima, colocando os bits. */
  function porDados(m, bytes) {
    var n = m.length;
    var bits = [];
    bytes.forEach(function (b) {
      for (var i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    });

    var indice = 0;
    var subindo = true;
    for (var coluna = n - 1; coluna > 0; coluna -= 2) {
      if (coluna === 6) coluna--; // a coluna 6 é do timing, pula
      for (var passo = 0; passo < n; passo++) {
        var linha = subindo ? n - 1 - passo : passo;
        for (var k = 0; k < 2; k++) {
          var x = coluna - k;
          if (m[linha][x] !== null) continue;
          m[linha][x] = indice < bits.length ? bits[indice] : 0;
          indice++;
        }
      }
      subindo = !subindo;
    }
  }

  var MASCARAS = [
    function (l, c) { return (l + c) % 2 === 0; },
    function (l) { return l % 2 === 0; },
    function (l, c) { return c % 3 === 0; },
    function (l, c) { return (l + c) % 3 === 0; },
    function (l, c) { return (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (l, c) { return ((l * c) % 2) + ((l * c) % 3) === 0; },
    function (l, c) { return (((l * c) % 2) + ((l * c) % 3)) % 2 === 0; },
    function (l, c) { return (((l + c) % 2) + ((l * c) % 3)) % 2 === 0; },
  ];

  /**
   * Nota de penalidade da norma: quanto MENOR, mais fácil de ler. Serve para
   * escolher, entre as 8 máscaras, a que deixa o desenho menos confuso para
   * o leitor (menos listras longas, menos blocos, menos falso-finder).
   */
  function penalidade(m) {
    var n = m.length;
    var total = 0;

    // Regra 1: sequências de 5 ou mais iguais, em linha e em coluna.
    for (var i = 0; i < n; i++) {
      for (var eixo = 0; eixo < 2; eixo++) {
        var seguidos = 1;
        for (var j = 1; j < n; j++) {
          var atual = eixo === 0 ? m[i][j] : m[j][i];
          var anterior = eixo === 0 ? m[i][j - 1] : m[j - 1][i];
          if (atual === anterior) {
            seguidos++;
          } else {
            if (seguidos >= 5) total += 3 + (seguidos - 5);
            seguidos = 1;
          }
        }
        if (seguidos >= 5) total += 3 + (seguidos - 5);
      }
    }

    // Regra 2: blocos 2x2 da mesma cor.
    for (var l = 0; l < n - 1; l++) {
      for (var c = 0; c < n - 1; c++) {
        var v = m[l][c];
        if (v === m[l][c + 1] && v === m[l + 1][c] && v === m[l + 1][c + 1]) total += 3;
      }
    }

    // Regra 3: desenhos parecidos com um finder (confundem o leitor).
    var alvo1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var alvo2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    var casa = function (linha, inicio, alvo) {
      for (var k = 0; k < 11; k++) if (linha[inicio + k] !== alvo[k]) return false;
      return true;
    };
    for (var a = 0; a < n; a++) {
      var linhaH = m[a];
      var linhaV = [];
      for (var b = 0; b < n; b++) linhaV.push(m[b][a]);
      for (var p = 0; p + 11 <= n; p++) {
        if (casa(linhaH, p, alvo1) || casa(linhaH, p, alvo2)) total += 40;
        if (casa(linhaV, p, alvo1) || casa(linhaV, p, alvo2)) total += 40;
      }
    }

    // Regra 4: desequilíbrio entre claros e escuros.
    var escuros = 0;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) if (m[y][x] === 1) escuros++;
    }
    var proporcao = (escuros * 100) / (n * n);
    total += Math.floor(Math.abs(proporcao - 50) / 5) * 10;
    return total;
  }

  /** Informação de formato: nível de correção + máscara, com BCH e XOR fixo. */
  function bitsDeFormato(mascara) {
    var NIVEL_Q = 0b11;
    var dados = (NIVEL_Q << 3) | mascara;
    var resto = dados << 10;
    for (var i = 14; i >= 10; i--) {
      if ((resto >> i) & 1) resto ^= 0b10100110111 << (i - 10);
    }
    return ((dados << 10) | resto) ^ 0b101010000010010;
  }

  /**
   * Espalha os 15 bits do formato nas duas cópias que a norma exige (uma
   * em volta do finder de cima, outra repartida entre os outros cantos),
   * para o leitor conseguir o formato mesmo com um canto danificado.
   *
   * A ordem dos bits NÃO é a mesma nas duas cópias — é a peça mais fácil de
   * errar aqui, e um QR com formato torto simplesmente não é lido.
   */
  function porFormato(m, mascara) {
    var n = m.length;
    var f = bitsDeFormato(mascara);
    var b = function (i) { return (f >> i) & 1; };  // b(0) = bit menos significativo

    // Cópia 1, em volta do finder superior esquerdo.
    for (var i = 0; i <= 5; i++) m[8][i] = b(14 - i);
    m[8][7] = b(8);
    m[8][8] = b(7);
    m[7][8] = b(6);
    for (var j = 0; j <= 5; j++) m[j][8] = b(j);

    // Cópia 2: bits 0..7 na linha, da direita para a esquerda; bits 8..14 na
    // coluna, de cima para baixo.
    for (var k = 0; k <= 7; k++) m[8][n - 1 - k] = b(k);
    for (var l = 0; l <= 6; l++) m[n - 7 + l][8] = b(8 + l);

    m[n - 8][8] = 1; // módulo sempre escuro
  }

  function aplicarMascara(m, reservado, mascara) {
    var n = m.length;
    var copia = m.map(function (linha) { return linha.slice(); });
    for (var l = 0; l < n; l++) {
      for (var c = 0; c < n; c++) {
        if (reservado[l][c]) continue;
        if (MASCARAS[mascara](l, c)) copia[l][c] ^= 1;
      }
    }
    return copia;
  }

  /** Devolve a matriz final: array de arrays com 0 (claro) e 1 (escuro). */
  function matriz(texto) {
    var bytes = bytesDoTexto(texto);
    var versao = menorVersao(bytes.length);
    var n = tamanho(versao);

    var m = novaMatriz(n);
    porFinder(m, 0, 0);
    porFinder(m, 0, n - 7);
    porFinder(m, n - 7, 0);
    porAlinhamento(m, versao);
    porTiming(m);
    reservarFormato(m);

    // Guarda o que é estrutura fixa: a máscara não pode mexer nesses módulos.
    var reservado = m.map(function (linha) {
      return linha.map(function (v) { return v !== null; });
    });

    // Os módulos "2" eram só marcação de lugar; viram 0 até o formato entrar.
    for (var l = 0; l < n; l++) {
      for (var c = 0; c < n; c++) if (m[l][c] === 2) m[l][c] = 0;
    }

    porDados(m, entrelacar(montarCodewords(bytes, versao), versao));

    // Escolhe a máscara que deixa o código mais fácil de ler.
    var melhor = null, melhorNota = Infinity;
    for (var k = 0; k < 8; k++) {
      var tentativa = aplicarMascara(m, reservado, k);
      porFormato(tentativa, k);
      var nota = penalidade(tentativa);
      if (nota < melhorNota) {
        melhorNota = nota;
        melhor = tentativa;
      }
    }
    return melhor;
  }

  /**
   * Desenha o QR code como SVG. A margem de 4 módulos ("zona silenciosa")
   * é exigida pela norma — sem ela, muitos leitores simplesmente não veem
   * o código.
   */
  function svg(texto, opcoes) {
    var o = opcoes || {};
    var m = matriz(texto);
    var n = m.length;
    var margem = o.margem === undefined ? 4 : o.margem;
    var lado = n + margem * 2;

    var caminho = [];
    for (var l = 0; l < n; l++) {
      for (var c = 0; c < n; c++) {
        if (m[l][c] === 1) {
          caminho.push('M' + (c + margem) + ' ' + (l + margem) + 'h1v1h-1z');
        }
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + lado + ' ' + lado + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + lado + '" height="' + lado + '" fill="#ffffff"/>' +
      '<path d="' + caminho.join('') + '" fill="#000000"/>' +
      '</svg>';
  }

  raiz.QR = { matriz: matriz, svg: svg };
})(typeof window !== 'undefined' ? window : globalThis);
