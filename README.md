# StashWear

StashWear é uma extensão de navegador para salvar, organizar e acompanhar peças de moda encontradas em lojas online. Ela captura dados da página atual, guarda uma coleção local e pode sincronizar os dados com Supabase.

## Recursos

- Salva peças diretamente pelo popup da extensão.
- Organiza itens por tipo, loja, prioridade, favoritos e pastas.
- Mostra dashboard completo com coleção, timeline, lojas e análise.
- Acompanha preço alvo e notificações de queda.
- Sincroniza a coleção com Supabase usando autenticação por e-mail e senha.

## Instalação local

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions` no Chrome ou Edge.
3. Ative o "Modo do desenvolvedor".
4. Clique em "Carregar sem compactação".
5. Selecione a pasta deste projeto.

## Configuração do Supabase

Este repositório inclui `supabase-config.js` com a configuração pública usada pela extensão oficial do StashWear. Isso permite que login e sincronização funcionem logo após instalar a extensão localmente.

A chave `anon`/`publishable` do Supabase é feita para uso no cliente, mas ela precisa estar protegida por Row Level Security. Este projeto usa políticas RLS em `supabase-setup.sql` para limitar cada usuário aos próprios dados.

Se você fizer um fork e quiser usar outro Supabase, substitua os valores de `supabase-config.js` ou use `supabase-config.example.js` como modelo:

```js
globalThis.STASHWEAR_SUPABASE = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY'
};
```

Para configurar outro projeto no painel do Supabase:

1. Crie um projeto.
2. Ative autenticação por e-mail/senha em Authentication.
3. Rode o conteúdo de `supabase-setup.sql` no SQL Editor.
4. Opcionalmente, use `supabase-email-confirmation-template.html` como template de confirmação de e-mail.

## Estrutura

- `manifest.json`: manifesto da extensão.
- `popup.html`, `popup.css`, `popup.js`: popup principal da extensão.
- `dashboard.html`, `dashboard.css`, `dashboard.js`: dashboard da coleção.
- `content.js` e `stashwear-scraper.js`: scripts injetados nas páginas para captura de dados.
- `background.js`: service worker com alarmes, notificações e sincronização automática.
- `supabase-sync.js`: cliente de sincronização com Supabase.
- `supabase-setup.sql`: tabela e políticas de segurança para o Supabase.

## Permissões

A extensão solicita acesso a abas, armazenamento local, scripts, alarmes, notificações e páginas acessadas (`<all_urls>`). Esse acesso é usado para identificar dados da página atual e salvar peças a partir de diferentes lojas online.

## Desenvolvimento

Este projeto não usa etapa de build. Para validar sintaxe dos arquivos principais:

```powershell
node --check background.js
node --check content.js
node --check dashboard.js
node --check popup.js
node --check stashwear-scraper.js
node --check supabase-sync.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
```

## Antes de publicar

- Confirme que as políticas RLS do Supabase estão ativas antes de distribuir a extensão com `supabase-config.js`.
- Revise as permissões em `manifest.json`.

## Licença

Este projeto está sob a licença MIT. Veja `LICENSE` para mais detalhes.
