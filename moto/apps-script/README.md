# Controle da Moto — instalação e manutenção

O app (`/moto/`) é uma página estática. Quem guarda os dados é uma planilha
do Google Sheets, através de um backend em Google Apps Script.

> **Este app é separado do Controle de Socorro.** Planilha própria, script
> próprio. Um não enxerga o outro, e mexer em um não afeta o outro. Só o
> endereço do site (Netlify) é o mesmo, em pastas diferentes: `/socorro/` e
> `/moto/`.

**Não tem login, de propósito.** Este é um app de campo: o técnico abre no
posto, na garagem, no subsolo — e o login seria justamente a única parte a
exigir internet, onde ela mais falta. Aqui ele escolhe o próprio nome na
primeira vez, o aparelho lembra, e **todo formulário traz o campo "Quem está
registrando"** já marcado — então a planilha sempre sabe de quem é cada
lançamento, sem ninguém digitar senha.

Filtrar *quem pode entrar* continua fazendo sentido em tela com dado de
cliente, como o Controle de Socorro. Aqui é diário de bordo de moto: KM,
litros, oficina. O que protege o endereço do script é a `CHAVE_DO_APP` —
uma tranca, não uma senha (veja [Sobre a segurança](#sobre-a-segurança)).

**Como funciona sem internet:** o app grava tudo primeiro no próprio
aparelho e envia depois. Sem login no caminho, a fila sobe sozinha assim que
o sinal volta — ninguém precisa tocar em nada. Veja
[Sobre o funcionamento offline](#sobre-o-funcionamento-offline).

---

## Parte 1 — Criar a planilha

1. Crie uma planilha nova no Google Sheets (ex: **"Controle da Moto —
   Chaveiro Timóteo"**). Pode ser em branco: as abas são criadas sozinhas
2. **Não use a planilha do socorro.** São dados diferentes, e misturar
   complicaria os relatórios dos dois

## Parte 2 — Publicar o site na Netlify

Se o site do socorro já está publicado, **pule esta parte**: o app da moto
já está no ar em `https://SEU-SITE.netlify.app/moto/`, no mesmo endereço.

Se ainda não estiver:

1. [app.netlify.com](https://app.netlify.com/) → **Add new site → Import an
   existing project** → GitHub → escolha este repositório
2. Branch: `main`
3. Build command: deixe **vazio**. Publish directory: `.`
   (o `netlify.toml` na raiz já define isso)
4. **Deploy**, e troque o nome do site em **Site configuration → Change
   site name**

## Parte 3 — Publicar o Apps Script

1. Na planilha da moto: **Extensões → Apps Script**
2. Apague o conteúdo e cole o `Code.gs` desta pasta
3. Confira no topo do arquivo:
   - `MOTO` com o apelido ou a placa da moto (ex: `'Honda CG 160 - ABC1D23'`)
   - `EQUIPE_INICIAL` com os nomes que aparecem na primeira abertura
   - `LIMITE_ABASTECIMENTO` com o valor pré-autorizado (padrão: 40)
   - `CHAVE_DO_APP` já vem preenchida — não precisa mexer
4. **Implantar → Nova implantação** (só na primeira vez):
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Autorize as permissões pedidas (planilha, Drive e requisições externas)
5. Copie a URL gerada (termina em `/exec`) para `API_URL` em
   `moto/assets/app.js` — **este é o único valor que falta preencher**, e é
   o que liga o app à SUA planilha

> "Qualquer pessoa" significa que a *URL* aceita chamadas sem login do
> Google no nível do Apps Script. O que faz o script recusar um pedido
> qualquer é a `CHAVE_DO_APP`, que o app envia em toda chamada.

Opcional, mas recomendado: no editor do Apps Script, rode a função
**`prepararPlanilha`** uma vez. Ela cria todas as abas já com os
cabeçalhos certos, para você poder montar suas fórmulas antes do primeiro
lançamento.

### Erro "Você não tem permissão para chamar UrlFetchApp.fetch"

Acontece quando o script foi autorizado antes de passar a fazer chamadas
externas. Para resolver:

1. No editor do Apps Script: **⚙️ Configurações do projeto** → marque
   **"Mostrar o arquivo de manifesto appsscript.json no editor"**
2. Abra o `appsscript.json` que apareceu e substitua o conteúdo pelo do
   arquivo desta pasta
3. Selecione a função **`autorizarAgora`** e clique em **Executar**
4. Vai aparecer **"Autorização necessária"** → **Revisar permissões** →
   escolha sua conta → **Avançado** → **Acessar (não seguro)** → **Permitir**
   - O aviso de "app não verificado" é esperado: o app é seu e não passou
     pela verificação do Google, que só faz sentido para apps públicos
5. Faça uma **nova versão** da implantação e teste de novo

### Conferir se está tudo certo

Abra a URL do app (a que termina em `/exec`) no navegador com `?diag=1` no
final. A página responde em texto: versão implantada, se as permissões
estão liberadas, se a planilha e o Drive estão acessíveis, e quem está
cadastrado na equipe.

### Ao alterar o Code.gs depois

**Implantar → Gerenciar implantações → ✏️ (lápis) → Versão: Nova versão →
Implantar.** Salvar o arquivo não basta, e **não** use "Nova implantação",
que geraria um endereço diferente.

## Parte 4 — A equipe

A lista de nomes que aparece em "Quem é você?" e no campo **"Quem está
registrando"** de cada formulário vem da aba **`Equipe`** da planilha:

| Nome | Ativo |
|---|---|
| Willian | Sim |
| Lucas | Sim |
| Giovani | Sim |

- **Para incluir alguém:** adicione uma linha. Aparece no app na próxima vez
  que ele buscar dados — sem mexer em código, sem reimplantar nada
- **Para tirar alguém:** troque `Sim` por `Não` (ou apague a linha). Os
  lançamentos antigos daquela pessoa continuam na planilha, como devem
- Quem não estiver na lista ainda pode digitar o nome na abertura do app —
  útil para um ajudante de um dia

## Parte 5 — Instalar no celular do técnico

O app funciona no navegador, mas instalado é melhor: abre em tela cheia,
tem ícone próprio e funciona offline com mais folga.

- **Android (Chrome):** abra `/moto/` → menu ⋮ → **Instalar aplicativo**
- **iPhone (Safari):** abra `/moto/` → botão compartilhar → **Adicionar à
  Tela de Início**

Na primeira abertura o técnico toca no próprio nome. Só isso. Depois de
instalado, segurar o ícone abre atalhos diretos para **Retirada**,
**Devolução** e **Abastecimento** (no Android).

---

## Sobre a segurança

Vale ser claro sobre o que este app protege e o que não protege.

**O que existe:**

- A `CHAVE_DO_APP` viaja em toda chamada. Sem ela, o script recusa o pedido.
  Isso impede que a URL do `/exec`, se um dia for varrida por um robô ou
  parar num histórico, aceite qualquer coisa
- As fotos ficam **privadas** no Drive, sem link público
- A pasta `/moto/` não é indexada por buscadores (`noindex`)
- O app não apaga nem corrige linhas: essas ações só existem na planilha,
  que só você abre

**O que NÃO existe, e é uma escolha:**

- Não há senha nem login. Quem tiver o endereço do site consegue abrir o app
  e lançar registros
- A `CHAVE_DO_APP` está no código do site. Quem abrir o "ver código-fonte"
  do navegador consegue lê-la. Ela é uma tranca contra acesso casual e
  automatizado, **não** um segredo
- O campo "quem está registrando" é uma declaração, não uma comprovação:
  registra quem a pessoa disse ser

**Por isso:** aqui vai só dado operacional da moto. Nada de cliente, nada de
valor a receber, nada que precise de sigilo. Se um dia entrar algo assim
nesta planilha, é hora de rever esta decisão.

Para trocar a chave (se algum dia quiser invalidar a antiga), mude o valor
nos **dois** arquivos ao mesmo tempo — `Code.gs` e `assets/app.js` — e
reimplante o script.

## Sobre o funcionamento offline

O app foi feito para ser usado onde o sinal falha:

1. **Tudo é gravado no aparelho primeiro** (IndexedDB), com um identificador
   gerado ali mesmo. Para o técnico, o registro está feito no instante em
   que ele toca em "Registrar" — sem espera e sem barra de progresso
2. **A fila de envio** guarda o que ainda não subiu, inclusive as fotos. Ela
   sobrevive a fechar o app, trocar de rede e reiniciar o celular
3. **O envio é tentado sozinho** quando a internet volta, quando o app é
   aberto, quando volta para a frente e a cada minuto enquanto houver fila.
   Como não há login no caminho, isso acontece **sem ninguém tocar em nada**
4. **Reenviar nunca duplica.** Como o identificador nasce no celular, o
   Apps Script reconhece um registro que já gravou e apenas confirma. Isso
   cobre o caso clássico de a conexão cair depois de gravar e antes de o
   celular receber a resposta
5. **As fotos são reduzidas** para 1600px antes de guardar. Uma foto de
   painel sai de ~5 MB para ~200 KB: é o que permite enviar com sinal ruim
6. **A tela mostra a verdade.** O que está na fila aparece nas listas
   marcado como "aguardando envio", e uma faixa no topo diz quantos
   registros faltam enviar

O que **precisa de internet**: ver fotos já enviadas e carregar o histórico
completo da planilha. O resto funciona sem sinal.

Na primeiríssima abertura, sem internet, a lista de nomes ainda não chegou —
o técnico digita o nome dele e segue trabalhando normalmente.

## Sobre a planilha

Uma aba por tipo de registro, todas começando com `ID` e `Data/Hora`:

| Aba | O que guarda |
|---|---|
| `Diario de Bordo` | Retiradas e devoluções, com KM e foto do painel |
| `Abastecimentos` | KM, litros, valor, preço/litro, posto, foto da bomba |
| `Ocorrencias` | Multa, queda, avaria, acidente, furto — com status e prazo |
| `Manutencoes` | Serviço, itens, valor, oficina, quem autorizou, nota |
| `Fechamento Mensal` | Números fechados do mês |
| `Equipe` | Os nomes que aparecem no app |

Todas as abas de registro têm a coluna **`Técnico`**: quem preencheu o
formulário.

Colunas calculadas na hora da gravação (valor, não fórmula — assim o
CSV exportado sai certo):

- `Preço/litro` = valor pago ÷ litros
- `Acima do pré-autorizado` = "Sim" quando passa do `LIMITE_ABASTECIMENTO`
- No fechamento: `KM rodados`, `Custo total`, `KM/L` e `Custo por KM`

**Para seus próprios cálculos:** acrescente colunas e fórmulas à direita
das existentes, ou monte abas novas com `QUERY`/`IMPORTRANGE` apontando
para estas. O app só lê e grava nas colunas que conhece, pelo nome do
cabeçalho — ele ignora o que você criar ao lado.

Exemplos úteis (troque o intervalo conforme o seu caso):

```
=SOMASE(Abastecimentos!B:B; ">="&DATA(2026;8;1); Abastecimentos!G:G)   → gasto de combustível no mês
=MÁXIMO(Abastecimentos!E:E) - MÍNIMO(Abastecimentos!E:E)               → KM rodados no período
=MÉDIA(Abastecimentos!H:H)                                            → preço médio do litro
```

⚠️ **Não renomeie nem reordene as colunas existentes.** O app procura cada
coluna pelo nome do cabeçalho; renomear faz o dado parar de ser gravado
naquela coluna. Adicionar colunas novas ao lado é seguro.

**Corrigir ou apagar um lançamento** se faz aqui, direto na planilha. O app
não oferece isso de propósito: o endereço do script não pede login, e uma
ação destrutiva não pode ficar ao alcance de quem tiver a URL.

## Sobre as fotos

Ficam privadas numa pasta do Drive ("Moto - Fotos"), visíveis apenas para o
dono da planilha. O app não usa link do Drive: pede o conteúdo pela API e
mostra na tela. Não há link público para vazar.

## Rotina de conferência

Herdada do que já era feito no Notion:

- **Semanal (5 min):** confira no Diário se todo dia com uso tem retirada
  **e** devolução. Falta de devolução costuma ser esquecimento — cobre na
  hora, senão o KM do mês fica errado
- **Mensal (10 min):** abra **Resumo mensal** no app, confira KM/L e custo
  por km contra os meses anteriores e toque em **Fechar este mês**. Queda
  brusca de KM/L merece investigação (pneu murcho, corrente frouxa, ou
  abastecimento não registrado)
