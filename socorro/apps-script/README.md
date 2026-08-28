# Controle de Socorro — instalação e manutenção

O app (`/socorro/`) é uma página estática. Quem guarda e valida os dados é
uma planilha do Google Sheets, através de um backend em Google Apps Script.

**Como funciona o acesso:** cada pessoa entra com a própria conta Google. O
Google emite um "crachá" digital assinado, o app envia esse crachá em todo
pedido, e o Apps Script confere com o Google e procura o e-mail na aba
`Usuarios` da planilha. Não existe senha guardada em lugar nenhum — nem no
código, nem na planilha, nem no aparelho.

> **Siga as partes na ordem.** A configuração do Google exige o endereço
> definitivo do site, por isso a publicação na Netlify vem primeiro.

---

## Parte 1 — Publicar o site na Netlify

1. [app.netlify.com](https://app.netlify.com/) → **Add new site → Import an
   existing project** → GitHub → escolha este repositório
2. Branch: `main` (ou o branch onde está a versão que você quer publicar)
3. Build command: deixe **vazio**. Publish directory: `.`
   (o `netlify.toml` na raiz já define isso)
4. **Deploy**
5. A Netlify gera um nome aleatório. Troque por um definitivo em **Site
   configuration → Change site name** (ex: `chaveirotimoteo-socorro`)

Anote o endereço final — ele é usado na Parte 2 e não deve mudar depois,
sob pena de o login parar de funcionar até ser atualizado lá.

O app fica em `https://SEU-SITE.netlify.app/socorro/`.

## Parte 2 — Criar o Client ID do Google

É o que permite o botão "Entrar com Google". Gratuito.

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/)
2. Crie um projeto (ex: "Chaveiro Timóteo") ou selecione um existente
3. Menu → **APIs e serviços → Tela de permissão OAuth**
   - Tipo: **Externo**
   - Nome do app: `Controle de Socorro`
   - E-mail de suporte e de contato: o seu
   - Em "Usuários de teste", adicione os e-mails da equipe **ou** publique o
     app (botão "Publicar"). Publicar evita o aviso de "app não verificado"
     reaparecendo a cada 7 dias
4. Menu → **APIs e serviços → Credenciais → Criar credenciais → ID do
   cliente OAuth**
   - Tipo: **Aplicativo da Web**
   - Nome: `Socorro Web`
   - Em **Origens JavaScript autorizadas**, adicione o endereço do site:
     - `https://SEU-SITE.netlify.app`
     - (para testar no computador, adicione também `http://localhost:8000`)
   - **Não** precisa preencher "URIs de redirecionamento"
5. Copie o **Client ID** gerado (termina em `.apps.googleusercontent.com`)

⚠️ O endereço em "Origens JavaScript autorizadas" precisa ser exatamente o
do site publicado. Se o endereço mudar, o login para de funcionar até você
atualizar aqui.

## Parte 3 — Colocar o Client ID nos dois arquivos

O mesmo valor vai em dois lugares:

- `socorro/assets/app.js` → `GOOGLE_CLIENT_ID`
- `socorro/apps-script/Code.gs` → `CLIENT_ID`

Esse valor é público por natureza — pode ficar no repositório sem problema.

## Parte 4 — Publicar o Apps Script

1. Na planilha: **Extensões → Apps Script**
2. Apague o conteúdo e cole o `Code.gs` desta pasta
3. Confira que `CLIENT_ID` está preenchido e que `BOOTSTRAP_ADMIN` tem o
   e-mail do primeiro administrador
4. **Implantar → Nova implantação** (só na primeira vez):
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Autorize as permissões pedidas (planilha, Drive e requisições externas)
5. Copie a URL gerada (termina em `/exec`) para `API_URL` em
   `socorro/assets/app.js`

> "Qualquer pessoa" aqui significa que a *URL* aceita chamadas sem login do
> Google no nível do Apps Script. Quem barra o acesso é o próprio código,
> que exige um crachá válido e um e-mail cadastrado. Sem isso, nada passa.

### Ao alterar o Code.gs depois

**Implantar → Gerenciar implantações → ✏️ (lápis) → Versão: Nova versão →
Implantar.** Salvar o arquivo não basta, e **não** use "Nova implantação",
que geraria um endereço diferente.

## Parte 5 — Primeiro acesso e cadastro da equipe

1. Abra o app e entre com a conta definida em `BOOTSTRAP_ADMIN`
2. Toque no círculo com suas iniciais (canto superior direito)
3. Em **"Quem pode acessar"**, cadastre os demais com o Gmail de cada um
   - **Técnico**: registra e atualiza atendimentos
   - **Admin**: além disso, corrige lançamentos e gerencia os acessos
4. Para tirar o acesso de alguém, toque no **×** ao lado do nome. Vale na
   hora, em todos os aparelhos

A aba `Usuarios` é criada sozinha na planilha e pode ser conferida por lá,
mas o caminho recomendado é pela tela do app.

---

## Migrando da versão anterior (com senha no código)

Se você usou a versão que tinha `senha3457` no código:

1. As fotos antigas ficaram com link público no Drive. No editor do Apps
   Script, selecione a função **`protegerFotosAntigas`** e clique em
   **Executar**. Isso revoga o compartilhamento de todas elas
2. Os links de foto já gravados na planilha continuam funcionando — o app
   reconhece tanto o formato antigo quanto o novo
3. Se algum atendimento de teste tiver dado errado, apague a linha direto
   na planilha

## Sobre a planilha como fonte de verdade

- Colunas de fórmula adicionadas ao lado (comissão, totais) não atrapalham
  o app: ele só lê e grava nas colunas que conhece
- Exportar, filtrar e montar relatórios funciona normalmente
- Prefira corrigir pelo app, que registra quem alterou e quando

## Sobre as fotos

Ficam privadas numa pasta do Drive ("Socorro - Fotos"), visíveis apenas
para o dono da planilha. O app não usa link do Drive: pede o conteúdo pela
API já autenticada e mostra na tela. Não há link público para vazar.
