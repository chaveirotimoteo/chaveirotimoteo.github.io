# Controle da Moto — instalação e manutenção

O app (`/moto/`) é uma página estática. Quem guarda os dados é uma planilha
do Google Sheets, através de um backend em Google Apps Script.

> **Este app é separado do Controle de Socorro.** Planilha própria, script
> próprio, lista de acessos própria. Um não enxerga o outro, e mexer em um
> não afeta o outro. Só o endereço do site (Netlify) é o mesmo, em pastas
> diferentes: `/socorro/` e `/moto/`.

**Como funciona o acesso:** cada pessoa entra com a própria conta Google. O
Google emite um "crachá" digital assinado, o app envia esse crachá em todo
pedido, e o Apps Script confere com o Google e procura o e-mail na aba
`Usuarios` da planilha. Não existe senha guardada em lugar nenhum.

**Como funciona sem internet:** o app grava tudo primeiro no próprio
aparelho e envia depois. O técnico registra no posto, na garagem, no
subsolo — sem sinal — e os dados sobem sozinhos quando a conexão voltar.
Veja a seção [Sobre o funcionamento offline](#sobre-o-funcionamento-offline).

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

Anote o endereço final — ele é usado na Parte 3 e não deve mudar depois,
sob pena de o login parar de funcionar até ser atualizado lá.

## Parte 3 — Client ID do Google

É o que permite o botão "Entrar com Google". Gratuito.

✅ **Já vem preenchido.** Os dois arquivos deste app já trazem o mesmo
Client ID usado no Controle de Socorro. Ele autoriza o *endereço do site*,
que é o mesmo para os dois apps — e isso **não** mistura os dados: cada app
fala com a sua planilha e tem a sua própria lista de quem pode entrar.
**Pode pular para a Parte 5.**

Só crie um Client ID novo se quiser separar os dois apps também no Google
Cloud (por exemplo, para telas de consentimento com nomes diferentes):

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/)
2. Crie um projeto (ex: "Chaveiro Timóteo") ou selecione um existente
3. Menu → **APIs e serviços → Tela de permissão OAuth**
   - Tipo: **Externo**
   - Nome do app: `Controle da Moto`
   - E-mail de suporte e de contato: o seu
   - Em "Usuários de teste", adicione os e-mails da equipe **ou** publique o
     app (botão "Publicar"). Publicar evita o aviso de "app não verificado"
     reaparecendo a cada 7 dias
4. Menu → **APIs e serviços → Credenciais → Criar credenciais → ID do
   cliente OAuth**
   - Tipo: **Aplicativo da Web**
   - Nome: `Moto Web`
   - Em **Origens JavaScript autorizadas**, adicione o endereço do site:
     - `https://SEU-SITE.netlify.app`
     - (para testar no computador, adicione também `http://localhost:8000`)
   - **Não** precisa preencher "URIs de redirecionamento"
5. Copie o **Client ID** gerado (termina em `.apps.googleusercontent.com`)

⚠️ O endereço em "Origens JavaScript autorizadas" precisa ser exatamente o
do site publicado. Se mudar, o login para de funcionar até você atualizar.

## Parte 4 — Colocar o Client ID nos dois arquivos

*(Só se você criou um Client ID novo na Parte 3.)* O mesmo valor vai em
dois lugares, e precisa ser idêntico nos dois:

- `moto/assets/app.js` → `GOOGLE_CLIENT_ID`
- `moto/apps-script/Code.gs` → `CLIENT_ID`

Esse valor é público por natureza — pode ficar no repositório sem problema.

## Parte 5 — Publicar o Apps Script

1. Na planilha da moto: **Extensões → Apps Script**
2. Apague o conteúdo e cole o `Code.gs` desta pasta
3. Confira no topo do arquivo:
   - `CLIENT_ID` preenchido (já vem, veja a Parte 3)
   - `BOOTSTRAP_ADMIN` com o e-mail do primeiro administrador
   - `MOTO` com o apelido ou a placa da moto (ex: `'Honda CG 160 - ABC1D23'`)
   - `LIMITE_ABASTECIMENTO` com o valor pré-autorizado (padrão: 40)
4. **Implantar → Nova implantação** (só na primeira vez):
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Autorize as permissões pedidas (planilha, Drive e requisições externas)
5. Copie a URL gerada (termina em `/exec`) para `API_URL` em
   `moto/assets/app.js` — **este é o único valor que falta preencher**, e é
   o que liga o app à SUA planilha

> "Qualquer pessoa" aqui significa que a *URL* aceita chamadas sem login do
> Google no nível do Apps Script. Quem barra o acesso é o próprio código,
> que exige um crachá válido e um e-mail cadastrado. Sem isso, nada passa.

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
   arquivo desta pasta (declara as três permissões necessárias)
3. Selecione a função **`autorizarAgora`** e clique em **Executar**
4. Vai aparecer **"Autorização necessária"** → **Revisar permissões** →
   escolha sua conta → **Avançado** → **Acessar (não seguro)** → **Permitir**
   - O aviso de "app não verificado" é esperado: o app é seu e não passou
     pela verificação do Google, que só faz sentido para apps públicos
5. Faça uma **nova versão** da implantação e teste de novo

### Conferir se está tudo certo

Abra a URL do app (a que termina em `/exec`) no navegador com `?diag=1` no
final. A página responde em texto: versão implantada, se as permissões
estão liberadas, se a planilha e o Drive estão acessíveis.

### Ao alterar o Code.gs depois

**Implantar → Gerenciar implantações → ✏️ (lápis) → Versão: Nova versão →
Implantar.** Salvar o arquivo não basta, e **não** use "Nova implantação",
que geraria um endereço diferente.

## Parte 6 — Primeiro acesso e cadastro da equipe

1. Abra `https://SEU-SITE.netlify.app/moto/` e entre com a conta definida
   em `BOOTSTRAP_ADMIN`
2. Toque no círculo com suas iniciais (canto superior direito)
3. Em **"Quem pode acessar"**, cadastre os técnicos com o Gmail de cada um
   - **Técnico**: registra retirada, devolução, abastecimento, ocorrência
     e manutenção
   - **Admin**: além disso, fecha o mês, muda o status de ocorrências e
     gerencia os acessos
4. Para tirar o acesso de alguém, toque no **×** ao lado do nome. Vale na
   hora, em todos os aparelhos

## Parte 7 — Instalar no celular do técnico

O app funciona no navegador, mas instalado é melhor: abre em tela cheia,
tem ícone próprio e funciona offline com mais folga.

- **Android (Chrome):** abra `/moto/` → menu ⋮ → **Instalar aplicativo**
- **iPhone (Safari):** abra `/moto/` → botão compartilhar → **Adicionar à
  Tela de Início**

Depois de instalado, segurar o ícone abre atalhos diretos para **Retirada**,
**Devolução** e **Abastecimento** (no Android).

---

## Sobre o funcionamento offline

O app foi feito para ser usado onde o sinal falha. Como funciona:

1. **Tudo é gravado no aparelho primeiro** (IndexedDB), com um identificador
   gerado ali mesmo. Para o técnico, o registro está feito no instante em
   que ele toca em "Registrar" — sem espera e sem barra de progresso
2. **A fila de envio** guarda o que ainda não subiu, inclusive as fotos. Ela
   sobrevive a fechar o app, trocar de rede e reiniciar o celular
3. **O envio é tentado sozinho** quando a internet volta, quando o app é
   aberto, quando volta para a frente e a cada minuto enquanto houver fila
4. **Reenviar nunca duplica.** Como o identificador nasce no celular, o
   Apps Script reconhece um registro que já gravou e apenas confirma. Isso
   cobre o caso clássico de a conexão cair depois de gravar e antes de o
   celular receber a resposta
5. **As fotos são reduzidas** para 1600px antes de guardar. Uma foto de
   painel sai de ~5 MB para ~200 KB: é o que permite enviar com sinal ruim
6. **A tela mostra a verdade.** O que está na fila aparece nas listas
   marcado como "aguardando envio", e uma faixa no topo diz quantos
   registros faltam enviar

O que **precisa de internet**: entrar com o Google (o crachá vale ~1 hora),
ver fotos já enviadas e carregar o histórico completo da planilha.

Se o técnico abrir o app sem sinal, ele entra direto na tela de trabalho
com os dados da última vez e pode registrar tudo normalmente. Quando o
sinal voltar, a faixa no topo oferece o botão **Entrar** — um toque envia
a fila inteira.

## Sobre a planilha

Uma aba por tipo de registro, todas começando com `ID` e `Data/Hora`:

| Aba | O que guarda |
|---|---|
| `Diario de Bordo` | Retiradas e devoluções, com KM e foto do painel |
| `Abastecimentos` | KM, litros, valor, preço/litro, posto, foto da bomba |
| `Ocorrencias` | Multa, queda, avaria, acidente, furto — com status e prazo |
| `Manutencoes` | Serviço, itens, valor, oficina, quem autorizou, nota |
| `Fechamento Mensal` | Números fechados do mês |
| `Usuarios` | Quem pode entrar no app |

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

## Sobre as fotos

Ficam privadas numa pasta do Drive ("Moto - Fotos"), visíveis apenas para o
dono da planilha. O app não usa link do Drive: pede o conteúdo pela API já
autenticada e mostra na tela. Não há link público para vazar.

## Rotina de conferência

Herdada do que já era feito no Notion:

- **Semanal (5 min):** confira no Diário se todo dia com uso tem retirada
  **e** devolução. Falta de devolução costuma ser esquecimento — cobre na
  hora, senão o KM do mês fica errado
- **Mensal (10 min):** abra **Resumo mensal** no app, confira KM/L e custo
  por km contra os meses anteriores e toque em **Fechar este mês**. Queda
  brusca de KM/L merece investigação (pneu murcho, corrente frouxa, ou
  abastecimento não registrado)
