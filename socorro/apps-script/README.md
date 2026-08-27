# Conectar o Controle de Socorro ao Google Sheets

O app (`/socorro/index.html`) é uma página estática — quem grava e edita os
dados de verdade é uma planilha do Google Sheets, através de um pequeno
backend em Google Apps Script. Siga estes passos uma única vez:

## 1. Criar a planilha

1. Crie uma planilha nova no Google Sheets (pode ficar em branco — a aba
   `Socorros` e as colunas são criadas automaticamente no primeiro
   lançamento).
2. Nela, abra **Extensões → Apps Script**.
3. Apague o conteúdo de `Code.gs` que abrir e cole o conteúdo do arquivo
   `Code.gs` desta pasta.

## 2. Definir o segredo e o PIN

No topo do `Code.gs`, troque:

- `SECRET` — uma senha só sua, qualquer texto. Protege quem pode gravar na
  planilha (evita que alguém que descubra a URL publique lixo nela).
- `ADMIN_PIN` — o código que só o administrador terá, usado para corrigir
  um lançamento já feito.

Esses dois valores precisam ser **idênticos** aos definidos no topo de
`../assets/app.js` (`APP_SECRET` e `ADMIN_PIN`).

## 3. Publicar como Web App

1. No editor do Apps Script, clique em **Implantar → Nova implantação**.
2. Tipo: **App da Web**.
3. Executar como: **Eu** (sua conta).
4. Quem pode acessar: **Qualquer pessoa**.
5. Clique em **Implantar** e autorize as permissões pedidas (acesso à
   planilha e ao Drive, para salvar as fotos).
6. Copie a URL gerada (termina em `/exec`).

## 4. Ligar o app à URL

Cole essa URL em `API_URL`, no topo de `../assets/app.js`, e publique
(commit/push) o site. Todos os aparelhos que abrirem `/socorro/` passam a
usar a mesma planilha.

## 5. Sempre que editar o Code.gs

Depois de qualquer alteração no `Code.gs`, é preciso **gerar uma nova
implantação** (Implantar → Gerenciar implantações → editar → Nova versão)
para que as mudanças entrem em vigor — só salvar o arquivo não é
suficiente.

## Sobre as fotos

As fotos enviadas pelo app são salvas em uma pasta do Google Drive chamada
"Socorro - Fotos" (criada automaticamente), com link de visualização
público, e o link é gravado na coluna "Fotos" da planilha.

## Sobre a planilha como fonte de verdade

Como os dados ficam em uma aba normal do Sheets, você pode:

- Adicionar colunas de fórmula ao lado (ex: comissão calculada) sem afetar
  o app — ele só lê/grava nas colunas que conhece.
- Exportar, filtrar e montar relatórios normalmente.
- Editar uma célula direto na planilha em último caso — mas o fluxo
  recomendado é sempre corrigir pelo app (botão "Corrigir dados"), que já
  atualiza "Atualizado em/por" para manter rastreabilidade.
