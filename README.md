<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="StashWear" />
</p>

<h1 align="center">StashWear</h1>

<p align="center">
  Uma extensao de navegador para salvar, organizar e acompanhar pecas de moda encontradas em lojas online.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-sync-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
</p>

## Sobre

StashWear transforma o navegador em uma colecao pessoal de moda. Salve produtos de diferentes lojas, organize favoritos, acompanhe precos e mantenha tudo sincronizado com uma conta.

## Proposito unico

Permitir que o usuario salve, organize e acompanhe produtos de moda online em uma wishlist inteligente, com alertas de preco e painel de comparacao para ajudar na decisao de compra.

## Recursos

- Salvar pecas diretamente pelo popup da extensao.
- Organizar itens por tipo, loja, prioridade, favoritos e pastas.
- Visualizar uma colecao completa em dashboard.
- Acompanhar preco alvo e notificacoes de queda.
- Usar login e sincronizacao via Supabase.
- Criar conta com confirmacao dupla de e-mail e senha dentro da extensao.
- Consultar timeline, lojas salvas e analise da colecao.

## Instalacao local

1. Baixe ou clone este repositorio.
2. Abra `chrome://extensions` no Chrome ou Edge.
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactacao**.
5. Selecione a pasta do projeto.

## Supabase

Este repositorio inclui `supabase-config.js` com a configuracao publica usada pela extensao oficial do StashWear. Assim, login e sincronizacao funcionam logo apos instalar a extensao localmente.

A chave `anon`/`publishable` do Supabase e feita para uso no cliente. A seguranca dos dados depende das politicas de Row Level Security configuradas em `supabase-setup.sql`, que limitam cada usuario aos proprios dados.

Se voce fizer um fork e quiser usar outro Supabase, substitua os valores de `supabase-config.js` ou use `supabase-config.example.js` como modelo:

```js
globalThis.STASHWEAR_SUPABASE = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY',
  authRedirectTo: 'https://YOUR_PUBLIC_CONFIRMATION_PAGE_URL'
};
```

Para configurar outro projeto:

1. Crie um projeto no Supabase.
2. Ative autenticacao por e-mail/senha em **Authentication**.
3. Rode `supabase-setup.sql` no **SQL Editor**.
4. Em **Authentication > Sign In / Providers > Email**, mantenha o provider de e-mail ativo e permita novos cadastros.
5. Para desenvolvimento sem SMTP customizado, a confirmacao de e-mail pode ficar desativada. A extensao ainda valida cadastro com confirmacao dupla de e-mail e senha antes de chamar o Supabase.
6. Em **Authentication > URL Configuration**, configure uma URL publica fixa em **Site URL** e **Redirect URLs**.
7. Informe essa mesma URL em `authRedirectTo` no `supabase-config.js`.
8. Opcionalmente, use `supabase-email-confirmation-template.html` como template de confirmacao de e-mail.
9. Opcionalmente, use `supabase-password-recovery-template.html` como template de recuperacao de senha.

### Fluxo de conta

O modal de conta permite login e criacao de cadastro. Na criacao de conta, o usuario precisa preencher e confirmar o e-mail e a senha antes da requisicao ao Supabase. A opcao de reenvio de confirmacao e o link de recuperacao de senha nao ficam expostos no login.

## Estrutura

| Arquivo | Funcao |
| --- | --- |
| `manifest.json` | Manifesto da extensao |
| `popup.html`, `popup.css`, `popup.js` | Popup principal |
| `dashboard.html`, `dashboard.css`, `dashboard.js` | Dashboard da colecao |
| `content.js`, `stashwear-scraper.js` | Captura de dados nas paginas |
| `background.js` | Service worker, alarmes, notificacoes e sync |
| `supabase-sync.js` | Cliente de sincronizacao |
| `supabase-setup.sql` | Tabela e politicas RLS |
| `supabase-email-confirmation-template.html` | Template de confirmacao de e-mail |
| `supabase-password-recovery-template.html` | Template de recuperacao de senha |

## Permissoes

A extensao solicita acesso a abas, armazenamento local, scripts, alarmes, notificacoes e paginas acessadas (`<all_urls>`). Esse acesso e usado para identificar dados da pagina atual e salvar pecas a partir de diferentes lojas online.

## Privacidade

A extensao coleta apenas informacoes visiveis da pagina do produto quando o usuario decide salvar um item, como nome, preco, imagem, loja e link. Esses dados sao usados para montar a wishlist, organizar a colecao, sincronizar a conta e gerar alertas de preco.

Politica de Privacidade publicada:

https://sites.google.com/view/polticadeprivacidade-stashwear/in%C3%ADcio

## Desenvolvimento

Este projeto nao usa etapa de build. Para validar sintaxe:

```powershell
node --check background.js
node --check content.js
node --check dashboard.js
node --check popup.js
node --check stashwear-scraper.js
node --check supabase-sync.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

## Publicacao

Antes de distribuir a extensao com `supabase-config.js`, confira se as politicas RLS do Supabase estao ativas e revise as permissoes em `manifest.json`.

Para publicar na Chrome Web Store, use a politica de privacidade publica e declare apenas os dados e permissoes necessarios ao proposito unico da extensao.

## Licenca

Este projeto esta sob a licenca MIT. Veja `LICENSE` para mais detalhes.
