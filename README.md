<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="StashWear" />
</p>

<h1 align="center">StashWear</h1>

<p align="center">
  Uma extensão de navegador para salvar, organizar e acompanhar peças de moda encontradas em lojas online.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-sync-3ECF8E?style=flat-square&logo=supabase&logoColor=white" />
</p>

## Sobre

StashWear transforma o navegador em uma coleção pessoal de moda. Salve produtos de diferentes lojas, organize favoritos, acompanhe preços e mantenha tudo sincronizado com uma conta.

## Recursos

- Salvar peças diretamente pelo popup da extensão.
- Organizar itens por tipo, loja, prioridade, favoritos e pastas.
- Visualizar uma coleção completa em dashboard.
- Acompanhar preço alvo e notificações de queda.
- Usar login e sincronização via Supabase.
- Consultar timeline, lojas salvas e análise da coleção.

## Instalação Local

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions` no Chrome ou Edge.
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta do projeto.

## Supabase

Este repositório inclui `supabase-config.js` com a configuração pública usada pela extensão oficial do StashWear. Assim, login e sincronização funcionam logo após instalar a extensão localmente.

A chave `anon`/`publishable` do Supabase é feita para uso no cliente. A segurança dos dados depende das políticas de Row Level Security configuradas em `supabase-setup.sql`, que limitam cada usuário aos próprios dados.

Se você fizer um fork e quiser usar outro Supabase, substitua os valores de `supabase-config.js` ou use `supabase-config.example.js` como modelo:

```js
globalThis.STASHWEAR_SUPABASE = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY'
};
```

Para configurar outro projeto:

1. Crie um projeto no Supabase.
2. Ative autenticação por e-mail/senha em **Authentication**.
3. Rode `supabase-setup.sql` no **SQL Editor**.
4. Opcionalmente, use `supabase-email-confirmation-template.html` como template de confirmação de e-mail.
5. Opcionalmente, use `supabase-password-recovery-template.html` como template de recuperação de senha.
6. Em **Authentication > URL Configuration**, adicione a URL do dashboard da extensão em **Redirect URLs** para que o link de recuperação consiga voltar para a extensão.

## Estrutura

| Arquivo | Função |
| --- | --- |
| `manifest.json` | Manifesto da extensão |
| `popup.html`, `popup.css`, `popup.js` | Popup principal |
| `dashboard.html`, `dashboard.css`, `dashboard.js` | Dashboard da coleção |
| `content.js`, `stashwear-scraper.js` | Captura de dados nas páginas |
| `background.js` | Service worker, alarmes, notificações e sync |
| `supabase-sync.js` | Cliente de sincronização |
| `supabase-setup.sql` | Tabela e políticas RLS |
| `supabase-email-confirmation-template.html` | Template de confirmação de e-mail |
| `supabase-password-recovery-template.html` | Template de recuperação de senha |

## Permissões

A extensão solicita acesso a abas, armazenamento local, scripts, alarmes, notificações e páginas acessadas (`<all_urls>`). Esse acesso é usado para identificar dados da página atual e salvar peças a partir de diferentes lojas online.

## Desenvolvimento

Este projeto não usa etapa de build. Para validar sintaxe:

```powershell
node --check background.js
node --check content.js
node --check dashboard.js
node --check popup.js
node --check stashwear-scraper.js
node --check supabase-sync.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

## Publicação

Antes de distribuir a extensão com `supabase-config.js`, confira se as políticas RLS do Supabase estão ativas e revise as permissões em `manifest.json`.

## Licença

Este projeto está sob a licença MIT. Veja `LICENSE` para mais detalhes.
