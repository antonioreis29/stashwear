<p align="center">
  <img src="icons/icon128.png" width="104" height="104" alt="StashWear" />
</p>

<h1 align="center">StashWear</h1>

<p align="center">
  <strong>Seu closet digital para salvar, comparar e acompanhar pecas de moda online.</strong>
</p>

<p align="center">
  Transforme achados de lojas online em uma wishlist visual, organizada por estilo, loja, prioridade e preco.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-sync-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img alt="Moda" src="https://img.shields.io/badge/foco-moda%20%26%20wishlist-111111?style=for-the-badge" />
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-e8e3da?style=for-the-badge" />
</p>

---

## O que e

StashWear e uma extensao de navegador criada para quem pesquisa, compara e monta uma colecao pessoal de moda pela internet.

Ela ajuda o usuario a salvar pecas de diferentes lojas, organizar desejos por prioridade, acompanhar preco alvo e visualizar tudo em um painel mais bonito do que uma lista perdida de links.

> Pense nela como uma prateleira curada para roupas, tenis, bolsas, acessorios e qualquer peca que ainda esta em avaliacao antes da compra.

## Proposito unico

Permitir que o usuario salve, organize e acompanhe produtos de moda online em uma wishlist inteligente, com alertas de preco e painel de comparacao para ajudar na decisao de compra.

## Experiencia principal

| Momento | Como o StashWear ajuda |
| --- | --- |
| Encontrou uma peca | Salva nome, preco, imagem, loja e link pelo popup da extensao |
| Quer comparar depois | Mostra tudo em um dashboard visual, com filtros e busca |
| Esta montando prioridades | Marca pecas como prioridade alta, avaliando ou inspiracional |
| Esperando uma promocao | Permite acompanhar preco alvo e queda de preco |
| Pesquisa em varias lojas | Agrupa por loja, tipo de peca, favoritos e pastas |
| Usa mais de um dispositivo | Sincroniza a colecao com conta Supabase |

## Recursos

- Popup rapido para salvar a peca atual.
- Dashboard visual para colecao de moda.
- Organizacao por loja, tipo, prioridade, favoritos e pastas.
- Timeline de atividades da colecao.
- Alertas de preco e notificacoes.
- Analise da colecao, com lojas e tipos mais salvos.
- Login e sincronizacao via Supabase.
- Cadastro com confirmacao dupla de e-mail, confirmacao de senha e regra minima de senha forte dentro da extensao.
- Indicador visual de forca da senha e botoes para mostrar/ocultar senha.
- Interface pensada para uma wishlist de moda, nao apenas bookmarks.

## Fluxo de uso

1. Abra uma loja online.
2. Clique no icone do StashWear no navegador.
3. Salve a peca atual.
4. Abra o dashboard para comparar, filtrar e decidir.
5. Defina prioridades e preco alvo.
6. Entre na conta para sincronizar sua colecao.

## Dados coletados

A extensao coleta apenas informacoes visiveis da pagina do produto quando o usuario decide salvar um item:

- nome do produto
- preco
- imagem
- loja
- link da pagina
- categoria, notas, tags e configuracoes adicionadas pelo usuario

Esses dados sao usados para montar a wishlist, organizar a colecao, sincronizar a conta e gerar alertas de preco.

Politica de Privacidade publicada:

https://sites.google.com/view/polticadeprivacidade-stashwear/in%C3%ADcio

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
5. Para desenvolvimento sem SMTP customizado, a confirmacao de e-mail pode ficar desativada. A extensao ainda valida cadastro com confirmacao dupla de e-mail e senha forte antes de chamar o Supabase.
6. Em **Authentication > URL Configuration**, configure uma URL publica fixa em **Site URL** e **Redirect URLs**.
7. Informe essa mesma URL em `authRedirectTo` no `supabase-config.js`.

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

## Permissoes

A extensao solicita acesso a abas, armazenamento local, scripts, alarmes, notificacoes e paginas acessadas (`<all_urls>`).

Esse acesso e usado para:

- identificar dados visiveis da pagina atual;
- salvar pecas de diferentes lojas online;
- armazenar a colecao do usuario;
- exibir alertas e notificacoes de preco.

## Desenvolvimento

### Regra de senha

No cadastro e na criacao de nova senha, a senha precisa ter:

- pelo menos 6 caracteres;
- pelo menos 1 letra maiuscula;
- pelo menos 1 caractere especial;
- no maximo 72 caracteres;
- nenhum espaco no inicio ou no fim.

O modal de conta tambem mostra uma regua de forca da senha, lista os requisitos em tempo real e permite mostrar/ocultar os campos de senha.

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

Para publicar uma nova versao na Chrome Web Store, atualize o campo `version` no `manifest.json`, compacte a pasta da extensao e envie o pacote no painel da Chrome Web Store.

## Licenca

Este projeto esta sob a licenca MIT. Veja `LICENSE` para mais detalhes.
