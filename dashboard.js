const get = key => new Promise(resolve => chrome.storage.local.get(key, data => resolve(data[key] || [])));
const save = (key, value) => new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
const getItems = () => get('items');
const setItems = value => save('items', value);
const getActivities = () => get('activities');
const setActivities = value => save('activities', value);
const getFolders = () => get('folders');
const setFolders = value => save('folders', value);
const getStores = () => get('stores');
const setStores = value => save('stores', value);
const getNotifications = () => get('notifications');
const setNotifications = value => save('notifications', value);
const getDeletedItemKeys = () => get('deletedItemKeys');
const setDeletedItemKeys = value => save('deletedItemKeys', value);
const SYNC_STATUS_KEY = 'stashwearSyncStatus';
const THEME_KEY = 'stashwearTheme';
const getStorageObject = keys => new Promise(resolve => chrome.storage.local.get(keys, resolve));

let state = {
  items: [],
  activities: [],
  folders: [],
  stores: [],
  notifications: [],
  view: 'collection',
  search: '',
  sort: 'date',
  priorityFilter: 'todos',
  typeFilter: 'todos',
  storeFilter: 'todos',
  globalSearch: '',
  selectedStoreDomain: null,
  selectedFolderId: null,
  folderPickerOpen: false,
  editingFolderId: null,
  editingStoreIndex: null
};
let accountMode = 'login';
let pendingRecoverySession = null;

function normalizeTheme(value) {
  return ['light', 'dark'].includes(value) ? value : 'dark';
}
function resolveTheme(theme) {
  return normalizeTheme(theme);
}
function applyTheme(theme = 'dark') {
  const normalized = normalizeTheme(theme);
  const resolved = resolveTheme(normalized);
  document.documentElement.dataset.themePreference = normalized;
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll('[data-theme-option]').forEach(button => {
    const isActive = button.dataset.themeOption === normalized;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}
async function loadThemePreference() {
  const data = await getStorageObject(THEME_KEY);
  applyTheme(data[THEME_KEY] || 'dark');
}
async function setThemePreference(theme) {
  const normalized = normalizeTheme(theme);
  await chrome.storage.local.set({ [THEME_KEY]: normalized });
  applyTheme(normalized);
}
function bindThemeControls() {
  document.querySelectorAll('[data-theme-option]').forEach(button => {
    button.addEventListener('click', () => setThemePreference(button.dataset.themeOption));
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
function foldText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function parsePrice(str) {
  if (!str) return null;
  let raw = String(str).replace(/[^\d,.]/g, '');
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma > lastDot) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(/,/g, '');
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}
function formatPrice(n) {
  return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function getTags(item) {
  if (Array.isArray(item.tags)) return item.tags.filter(Boolean);
  return String(item.tags || '').split(',').map(t => t.trim()).filter(Boolean);
}
function itemKey(item) {
  return String(item?.savedAt || item?.url || item?.id || item?.name || '');
}
function itemDeletionKeys(item) {
  return [item?.url, item?.savedAt, item?.id, item?.name].map(value => String(value || '')).filter(Boolean);
}
async function rememberDeletedItem(item) {
  const deletedKeys = await getDeletedItemKeys();
  const nextKeys = Array.from(new Set([...deletedKeys, ...itemDeletionKeys(item)])).slice(-400);
  await setDeletedItemKeys(nextKeys);
}
function createFolderId() {
  return `folder-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
function extractDomain(url) {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function domainToName(domain) {
  if (!domain) return '';
  const part = domain.split('.').find(p => !['www','shop','loja','store'].includes(p)) || domain.split('.')[0];
  return part.charAt(0).toUpperCase() + part.slice(1);
}
function getStoreName(store) {
  const domain = extractDomain(store?.url);
  return store?.name || domainToName(domain) || 'Loja salva';
}
function itemMatchesStore(item, store) {
  const name = getStoreName(store);
  const domain = extractDomain(store?.url);
  return String(item.store || '').toLowerCase() === String(name).toLowerCase() || (domain && extractDomain(item.url) === domain);
}
function getStoreItems(store) {
  return state.items.filter(item => itemMatchesStore(item, store));
}
function normalizeFolder(folder) {
  return {
    id: folder.id || createFolderId(),
    name: String(folder.name || 'Nova pasta').trim() || 'Nova pasta',
    itemKeys: Array.isArray(folder.itemKeys) ? folder.itemKeys.filter(Boolean) : [],
    createdAt: folder.createdAt || Date.now()
  };
}
function ensureSelectedFolder() {
  state.folders = state.folders.map(normalizeFolder);
  if (!state.folders.length) {
    state.selectedFolderId = null;
    return null;
  }
  const selected = state.folders.find(folder => folder.id === state.selectedFolderId) || state.folders[0];
  state.selectedFolderId = selected.id;
  return selected;
}
function getFolderItems(folder) {
  if (!folder) return [];
  const keys = new Set(folder.itemKeys);
  return state.items.filter(item => keys.has(itemKey(item)));
}
function getNameSizeClass(name) {
  const length = String(name || '').replace(/\s+/g, ' ').trim().length;
  if (length <= 38) return 'name-short';
  if (length <= 70) return 'name-medium';
  if (length <= 105) return 'name-long';
  return 'name-xlong';
}

function normalizeTypeLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Outro';
  if (/^sem\s+(tipo|categoria|informacao|informação)$/i.test(raw)) return 'Outro';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}
function getItemType(item) {
  const direct = item.type || item.tipo || item.category || item.categoria || item.productType || item.product_type;
  if (direct) return normalizeTypeLabel(direct);
  const tags = getTags(item);
  const known = ['camisa','camiseta','calça','calca','bermuda','short','jaqueta','casaco','blazer','vestido','saia','tênis','tenis','sapato','sandália','sandalia','bolsa','acessório','acessorio','óculos','oculos','relógio','relogio'];
  const found = tags.find(t => known.includes(String(t).toLowerCase()));
  return found ? normalizeTypeLabel(found) : 'Outro';
}
function priceHistory(item) { return Array.isArray(item.priceHistory) ? item.priceHistory : []; }
function getPriorityLevel(item) {
  if (item.curationPriority) return item.curationPriority;
  if (item.buyThisMonth === true) return 'alta';
  if (item.buyThisMonth === false) return 'inspiracional';
  return 'avaliando';
}
function priorityLabel(item) {
  const level = getPriorityLevel(item);
  if (level === 'alta') return '⭐ Prioridade Alta';
  if (level === 'inspiracional') return '○ Inspiracional';
  return '● Avaliando';
}
function activityIcon(type) {
  return ({ salvo: '+', atualizada: '↻', queda_preco: '↓', preco_atualizado: '↕', favorita: '♥', prioridade: '★', status: '✓', removida: '×', loja: '⌂' })[type] || '•';
}
function activityTitle(type) {
  return ({ salvo: 'Peça salva na coleção', atualizada: 'Peça atualizada', queda_preco: 'Preço caiu', preco_atualizado: 'Preço atualizado', favorita: 'Favorito alterado', prioridade: 'Prioridade alterada', status: 'Status alterado', removida: 'Peça removida', loja: 'Loja adicionada' })[type] || 'Atividade registrada';
}
function activityDateLabel(ts) {
  const date = new Date(Number(ts) || Date.now());
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startThat) / 86400000);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `${diffDays} dias atrás`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
async function logActivity(entry) {
  const activities = await getActivities();
  activities.unshift({ at: Date.now(), ...entry });
  await setActivities(activities.slice(0, 120));
  state.activities = activities.slice(0, 120);
}
function showConfirmDialog({ title, message, confirmLabel = 'Remover' }) {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) return Promise.resolve(false);
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const confirmBtn = dialog.querySelector('[data-confirm-action="confirm"]');
  const cancelEls = dialog.querySelectorAll('[data-confirm-action="cancel"]');
  const previousFocus = document.activeElement;

  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmLabel;
  dialog.classList.add('active');
  dialog.setAttribute('aria-hidden', 'false');
  confirmBtn.focus();

  return new Promise(resolve => {
    const close = result => {
      dialog.classList.remove('active');
      dialog.setAttribute('aria-hidden', 'true');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelEls.forEach(el => el.removeEventListener('click', onCancel));
      document.removeEventListener('keydown', onKeydown);
      previousFocus?.focus?.();
      resolve(result);
    };
    const onConfirm = () => close(true);
    const onCancel = () => close(false);
    const onKeydown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelEls.forEach(el => el.addEventListener('click', onCancel));
    document.addEventListener('keydown', onKeydown);
  });
}
function showToast(message, type = 'info') {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<strong>${escapeHtml(message)}</strong>`;
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}
function syncStatusLabel(status, isLoggedIn) {
  if (!isLoggedIn) return 'Offline';
  if (status?.state === 'syncing') return 'Salvando...';
  if (status?.state === 'synced') return 'Sincronizado';
  if (status?.state === 'error') return 'Falha ao sincronizar';
  return 'Sincronizacao ativa';
}
async function setSyncStatus(stateName, detail = '') {
  await save(SYNC_STATUS_KEY, { state: stateName, detail, at: Date.now() });
}
async function refreshSyncStatus() {
  const el = document.getElementById('sync-status');
  const label = document.getElementById('sync-status-label');
  if (!el || !label) return;
  const [session, storage] = await Promise.all([
    window.StashWearSync?.getSession?.(),
    getStorageObject(SYNC_STATUS_KEY)
  ]);
  const isLoggedIn = Boolean(session?.user?.id);
  const status = storage[SYNC_STATUS_KEY] || null;
  const stateName = isLoggedIn ? (status?.state || 'synced') : 'offline';
  el.className = `sync-status ${stateName}`;
  label.textContent = syncStatusLabel(status, isLoggedIn);
  el.title = status?.detail || label.textContent;
}
function authErrorMessage(error) {
  const raw = String(error?.message || error || '').toLowerCase();
  console.error('StashWear auth error:', error);
  if (!raw) return 'Nao foi possivel autenticar. Tente novamente.';
  if (raw.includes('redirect') || raw.includes('not allowed') || raw.includes('uri')) return 'URL de confirmacao nao permitida no Supabase. Adicione a URL publica em Authentication > URL Configuration.';
  if (raw.includes('api key') || raw.includes('apikey') || raw.includes('invalid key')) return 'Chave do Supabase invalida. Confira a anon/public key em supabase-config.js.';
  if (raw.includes('email provider') || raw.includes('smtp') || raw.includes('mail')) return 'Envio de e-mail nao configurado no Supabase. Confira Authentication > Email.';
  if (raw.includes('invalid login credentials')) return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
  if (raw.includes('email not confirmed') || raw.includes('email_not_confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (raw.includes('user not found') || raw.includes('not found')) return 'Nao encontramos uma conta com este e-mail.';
  if (raw.includes('user already registered') || raw.includes('already registered') || raw.includes('already been registered')) return 'Este e-mail ja esta cadastrado. Use Entrar em vez de Criar conta.';
  if (raw.includes('password should be at least') || (raw.includes('password') && raw.includes('characters'))) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (raw.includes('weak password') || raw.includes('password is too weak')) return 'A senha esta fraca. Use letras, numeros e pelo menos 6 caracteres.';
  if (raw.includes('invalid email') || raw.includes('email address') || raw.includes('invalid format')) return 'Digite um e-mail valido, como nome@exemplo.com.';
  if (raw.includes('signup') && raw.includes('disabled')) return 'Cadastro desativado no Supabase. Ative novos usuarios em Authentication.';
  if (raw.includes('rate limit') || raw.includes('too many') || raw.includes('security purposes')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (raw.includes('network') || raw.includes('failed to fetch') || raw.includes('fetch')) return 'Falha de conexao com o Supabase. Verifique a internet e tente novamente.';
  if (raw.includes('jwt') || raw.includes('token') || raw.includes('expired')) return 'Sua sessao expirou. Entre novamente.';
  if (raw.includes('database') || raw.includes('row-level security') || raw.includes('permission denied')) return 'Sem permissao para sincronizar. Confira se o SQL do Supabase foi atualizado.';
  if (raw.includes('entre na sua conta')) return 'Entre na sua conta ou realize cadastro para sincronizar.';
  return `Nao foi possivel autenticar: ${String(error?.message || error || 'erro desconhecido')}`;
}
function normalizeDisplayName(name, email = '') {
  const value = String(name || '').trim();
  if (value) return value;
  return String(email || '').split('@')[0] || 'Usuario';
}
function validateDisplayName(name) {
  const value = String(name || '').trim();
  if (!value) return 'Escolha um nome de usuario.';
  if (value.length < 2) return 'O nome de usuario precisa ter pelo menos 2 caracteres.';
  if (value.length > 32) return 'Use um nome de usuario com ate 32 caracteres.';
  if (!/^[\p{L}\p{N} _.-]+$/u.test(value)) return 'Use apenas letras, numeros, espaco, ponto, hifen ou underline no nome.';
  return '';
}
function validateStrongPassword(password) {
  if (!password) return 'Preencha a senha.';
  if (password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (password.trim() !== password) return 'A senha nao pode comecar ou terminar com espaco.';
  if (password.length > 72) return 'Use uma senha com ate 72 caracteres.';
  if (!/[A-Z]/.test(password)) return 'A senha precisa ter pelo menos 1 letra maiuscula.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'A senha precisa ter pelo menos 1 caractere especial.';
  return '';
}
function passwordChecks(password = '') {
  return {
    length: password.length >= 6,
    uppercase: /[A-Z]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    trim: password.length > 0 && password.trim() === password && password.length <= 72
  };
}
function passwordStrengthInfo(password = '') {
  const checks = passwordChecks(password);
  const score = Object.values(checks).filter(Boolean).length;
  if (!password) return { checks, score: 0, level: '', label: 'Obrigatoria' };
  if (score >= 4) return { checks, score, level: 'strong', label: 'Forte' };
  if (score >= 3) return { checks, score, level: 'good', label: 'Boa' };
  return { checks, score, level: 'weak', label: 'Fraca' };
}
function updatePasswordStrength() {
  const panel = document.getElementById('password-strength');
  if (!panel) return;
  const password = document.getElementById('account-password')?.value || '';
  const label = document.getElementById('password-strength-label');
  const info = passwordStrengthInfo(password);
  panel.classList.remove('weak', 'good', 'strong');
  if (info.level) panel.classList.add(info.level);
  if (label) label.textContent = info.label;
  Object.entries(info.checks).forEach(([key, valid]) => {
    panel.querySelector(`[data-password-rule="${key}"]`)?.classList.toggle('valid', Boolean(valid));
  });
}
function eyeIconHtml(isVisible = false) {
  return isVisible
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.3 12s3.7-6.5 9.7-6.5S21.7 12 21.7 12s-3.7 6.5-9.7 6.5S2.3 12 2.3 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.4A10.5 10.5 0 0 1 12 4c5 0 8.5 4.2 9.7 6-.4.7-1.3 1.9-2.6 3.1"/><path d="M6.6 6.7C4.5 8 3.2 9.9 2.3 11.2c1.2 1.8 4.7 6 9.7 6 1.5 0 2.9-.4 4.1-1"/></svg>';
}
function setPasswordToggleState(button, isVisible) {
  button.innerHTML = eyeIconHtml(isVisible);
  button.setAttribute('aria-label', isVisible ? 'Ocultar senha' : 'Mostrar senha');
  button.title = isVisible ? 'Ocultar senha' : 'Mostrar senha';
}
function validateAccountFields(mode, email, password, displayName = '', emailConfirm = '', passwordConfirm = '') {
  if (mode === 'reset') {
    const passwordMessage = validateStrongPassword(password);
    if (passwordMessage) return passwordMessage.replace('Preencha a senha.', 'Digite a nova senha.');
    if (!passwordConfirm) return 'Confirme a nova senha.';
    if (password !== passwordConfirm) return 'As senhas nao conferem.';
    return '';
  }
  if (mode === 'signup') {
    const nameMessage = validateDisplayName(displayName);
    if (nameMessage) return nameMessage;
  }
  if (mode === 'recover') {
    if (!email) return 'Preencha o e-mail da sua conta.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Digite um e-mail valido, como nome@exemplo.com.';
    return '';
  }
  if (!email && !password) return 'Preencha o e-mail e a senha.';
  if (!email) return 'Preencha o e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Digite um e-mail valido, como nome@exemplo.com.';
  if (!password) return 'Preencha a senha.';
  if (mode === 'signup') {
    if (!emailConfirm) return 'Confirme o e-mail.';
    if (email.toLowerCase() !== String(emailConfirm || '').trim().toLowerCase()) return 'Os e-mails nao conferem.';
    const passwordMessage = validateStrongPassword(password);
    if (passwordMessage) return passwordMessage;
    if (!passwordConfirm) return 'Confirme a senha.';
    if (password !== passwordConfirm) return 'As senhas nao conferem.';
  }
  return '';
}
async function refreshAccountUi() {
  const session = await window.StashWearSync?.getSession?.();
  const accountBtn = document.getElementById('btn-account');
  const status = document.getElementById('account-status');
  const accountTitle = document.getElementById('account-title');
  const accountForm = document.getElementById('account-form');
  const accountProfile = document.getElementById('account-profile');
  const nameInput = document.getElementById('account-name');
  const email = document.getElementById('account-email');
  const emailConfirm = document.getElementById('account-email-confirm');
  const password = document.getElementById('account-password');
  const passwordConfirm = document.getElementById('account-password-confirm');
  const passwordConfirmField = document.querySelector('[data-password-field="account-password-confirm"]');
  const passwordStrength = document.getElementById('password-strength');
  const loginBtn = document.getElementById('btn-account-login');
  const modeCopy = document.getElementById('account-mode-copy');
  const modeQuestion = document.getElementById('account-mode-question');
  const modeButton = document.getElementById('btn-account-mode-signup');
  const isLoggedIn = Boolean(session?.user?.email);
  const displayName = normalizeDisplayName(session?.user?.displayName, session?.user?.email);
  const isRecovering = accountMode === 'recover';
  const isResetting = accountMode === 'reset';

  if (accountBtn) accountBtn.textContent = isLoggedIn ? displayName : 'Entrar';
  if (accountTitle) accountTitle.textContent = isLoggedIn && !isResetting ? 'Sua conta' : (accountMode === 'signup' ? 'Criar cadastro' : isRecovering ? 'Recuperar senha' : isResetting ? 'Criar nova senha' : 'Entrar no StashWear');
  if (status) status.textContent = isLoggedIn
    ? 'Sua colecao esta vinculada a esta conta.'
    : (accountMode === 'signup'
      ? 'Crie sua conta para sincronizar sua colecao.'
      : isRecovering
        ? 'Informe seu e-mail para receber o link de recuperacao.'
        : isResetting
          ? 'Digite uma nova senha para recuperar o acesso.'
        : 'Entre para carregar e sincronizar sua colecao.');
  if (accountForm) accountForm.hidden = isLoggedIn && !isResetting;
  if (accountProfile) accountProfile.hidden = !isLoggedIn || isResetting;
  if (nameInput && !isLoggedIn) {
    nameInput.hidden = accountMode !== 'signup';
    nameInput.disabled = accountMode !== 'signup';
  }
  if (email) {
    email.hidden = isResetting;
    if (!isLoggedIn) email.disabled = false;
  }
  if (emailConfirm) {
    emailConfirm.value = '';
    emailConfirm.hidden = accountMode !== 'signup' || isLoggedIn || isResetting;
    emailConfirm.disabled = accountMode !== 'signup' || isLoggedIn || isResetting;
    emailConfirm.required = accountMode === 'signup' && !isLoggedIn && !isResetting;
  }
  if (password) {
    password.value = '';
    password.hidden = isRecovering;
    password.type = 'password';
    password.autocomplete = isResetting || accountMode === 'signup' ? 'new-password' : 'current-password';
    password.placeholder = isResetting ? 'Nova senha' : 'Senha';
    if (!isLoggedIn || isResetting) password.disabled = isRecovering;
  }
  if (passwordConfirm) {
    passwordConfirm.value = '';
    passwordConfirm.type = 'password';
    passwordConfirm.hidden = !isResetting && accountMode !== 'signup';
    passwordConfirm.disabled = isRecovering || (!isResetting && accountMode !== 'signup');
    passwordConfirm.required = isResetting || accountMode === 'signup';
    passwordConfirm.placeholder = isResetting ? 'Confirmar nova senha' : 'Confirmar senha';
  }
  if (passwordConfirmField) passwordConfirmField.hidden = !isResetting && accountMode !== 'signup';
  if (passwordStrength) passwordStrength.hidden = !isResetting && accountMode !== 'signup';
  document.querySelectorAll('[data-password-toggle]').forEach(button => {
    const target = document.getElementById(button.dataset.passwordToggle);
    if (!target) return;
    setPasswordToggleState(button, false);
  });
  updatePasswordStrength();
  if (loginBtn) loginBtn.hidden = isLoggedIn && !isResetting;
  if (loginBtn && (!isLoggedIn || isResetting)) loginBtn.textContent = accountMode === 'signup' ? 'Criar conta' : isRecovering ? 'Enviar link' : isResetting ? 'Salvar nova senha' : 'Entrar';
  if (modeCopy) modeCopy.hidden = isLoggedIn || isResetting;
  if (modeButton && (!isLoggedIn || isResetting)) {
    if (modeQuestion) modeQuestion.textContent = accountMode === 'signup' ? 'Ja tem conta?' : isRecovering ? 'Lembrou sua senha?' : 'Ainda nao tem conta?';
    modeButton.textContent = accountMode === 'signup' ? 'Entrar' : isRecovering ? 'Voltar para entrar' : 'Criar cadastro';
  }
  const profileName = document.getElementById('profile-name');
  const profileEmail = document.getElementById('profile-email');
  const profileAvatar = document.getElementById('profile-avatar');
  const profileNameInput = document.getElementById('profile-name-input');
  if (isLoggedIn) {
    if (profileName) profileName.textContent = displayName;
    if (profileEmail) profileEmail.textContent = session.user.email;
    if (profileAvatar) profileAvatar.textContent = displayName.charAt(0).toUpperCase();
    if (profileNameInput) profileNameInput.value = displayName;
  }
  await refreshSyncStatus();
}
function openAccountDialog() {
  const dialog = document.getElementById('account-dialog');
  if (!dialog) return;
  dialog.classList.add('active');
  dialog.setAttribute('aria-hidden', 'false');
  refreshAccountUi().then(async () => {
    const session = await window.StashWearSync?.getSession?.();
    if (!session?.user?.email && accountMode !== 'reset') accountMode = 'login';
    await refreshAccountUi();
    setTimeout(() => {
      (accountMode === 'reset'
        ? document.getElementById('account-password')
        : session?.user?.email
          ? document.getElementById('profile-name-input')
          : document.getElementById('account-email'))?.focus?.();
    }, 0);
  });
}
function setAccountMode(mode) {
  accountMode = mode === 'signup' ? 'signup' : mode === 'recover' ? 'recover' : mode === 'reset' ? 'reset' : 'login';
  refreshAccountUi();
  setTimeout(() => {
    (accountMode === 'signup' ? document.getElementById('account-name') : document.getElementById('account-email'))?.focus?.();
  }, 0);
}
function closeAccountDialog() {
  const dialog = document.getElementById('account-dialog');
  if (!dialog) return;
  dialog.classList.remove('active');
  dialog.setAttribute('aria-hidden', 'true');
}
async function handleAccountAuth(mode) {
  mode = accountMode;
  const displayName = document.getElementById('account-name')?.value.trim();
  const email = document.getElementById('account-email')?.value.trim();
  const emailConfirm = document.getElementById('account-email-confirm')?.value.trim();
  const password = document.getElementById('account-password')?.value;
  const passwordConfirm = document.getElementById('account-password-confirm')?.value;
  const validationMessage = validateAccountFields(mode, email, password, displayName, emailConfirm, passwordConfirm);
  if (validationMessage) {
    showToast(validationMessage, 'danger');
    return;
  }
  if (mode === 'recover') {
    try {
      await window.StashWearSync.requestPasswordRecovery(email);
      showToast('Enviamos um link de recuperacao para seu e-mail.');
      setAccountMode('login');
    } catch (error) {
      showToast(authErrorMessage(error), 'danger');
    }
    return;
  }
  if (mode === 'reset') {
    try {
      await window.StashWearSync.setPasswordFromRecovery(pendingRecoverySession, password);
      pendingRecoverySession = null;
      showToast('Senha atualizada. Sua conta foi conectada.');
      await refreshAccountUi();
      await bootData();
      closeAccountDialog();
    } catch (error) {
      showToast(authErrorMessage(error), 'danger');
    }
    return;
  }
  try {
    const localBeforeLogin = await window.StashWearSync.collectLocalData();
    const localItemsCount = Array.isArray(localBeforeLogin.items) ? localBeforeLogin.items.length : 0;
    const result = mode === 'signup'
      ? await window.StashWearSync.signUp(email, password, displayName)
      : await window.StashWearSync.signIn(email, password);
    if (result?.pendingConfirmation) {
      showToast('Conta criada. Confirme seu e-mail antes de entrar.');
    } else {
      let saveLocal = false;
      if (localItemsCount > 0) {
        saveLocal = await showConfirmDialog({
          title: 'Salvar pecas deste navegador?',
          message: `Encontramos ${localItemsCount} peca(s) salvas antes do login. Quer salvar esses dados na sua conta StashWear?`,
          confirmLabel: 'Salvar na conta'
        });
      }
      await setSyncStatus('syncing', 'Carregando colecao da conta');
      await window.StashWearSync.syncAfterLogin({ saveLocal });
      await setSyncStatus('synced', 'Sincronizado');
      await loadData();
      showToast(saveLocal ? 'Colecao local salva na sua conta' : 'Colecao da conta carregada');
      closeAccountDialog();
    }
    await refreshAccountUi();
  } catch (error) {
    await setSyncStatus('error', 'Falha ao sincronizar');
    showToast(authErrorMessage(error), 'danger');
  }
}

function readRecoverySessionFromHash() {
  const hash = window.location.hash?.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.get('type') !== 'recovery') return null;
  const accessToken = params.get('access_token');
  if (!accessToken) return null;
  const expiresIn = Number(params.get('expires_in') || 3600);
  return {
    accessToken,
    refreshToken: params.get('refresh_token') || '',
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn
  };
}

function bootRecoveryFlow() {
  pendingRecoverySession = readRecoverySessionFromHash();
  if (!pendingRecoverySession) return;
  history.replaceState(null, document.title, `${location.pathname}${location.search}`);
  accountMode = 'reset';
  openAccountDialog();
}

function notificationDateLabel(ts) {
  const date = new Date(Number(ts) || Date.now());
  return date.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function isReliablePriceDropNotification(notification) {
  if (notification?.type !== 'price_drop') return true;
  const previous = parsePrice(notification.previousPrice);
  const current = parsePrice(notification.currentPrice);
  if (previous === null || current === null) return true;
  if (current >= previous) return false;
  return current / previous >= 0.55;
}
function notificationMessage(notification) {
  if (notification?.type === 'sale_ended') {
    if (notification.previousPrice && notification.currentPrice) {
      return `Promoção encerrada: ${notification.previousPrice} -> ${notification.currentPrice}`;
    }
    return 'Promoção encerrada';
  }
  return `Caiu de ${notification.previousPrice || '-'} para ${notification.currentPrice || '-'}`;
}
function renderNotifications() {
  const bell = document.getElementById('notification-bell');
  const dot = document.getElementById('notification-dot');
  const panel = document.getElementById('notification-panel');
  if (!bell || !dot || !panel) return;
  const notifications = (Array.isArray(state.notifications) ? state.notifications : []).filter(isReliablePriceDropNotification);
  const unread = notifications.filter(n => !n.read).length;
  dot.hidden = unread === 0;
  bell.classList.toggle('has-unread', unread > 0);

  if (!notifications.length) {
    panel.innerHTML = `<div class="notification-empty"><strong>Nenhum alerta de preço ainda.</strong><small>O StashWear vai avisar quando uma peça baixar ou sair da promoção.</small></div>`;
    return;
    panel.innerHTML = `<div class="notification-empty"><strong>Nenhuma queda de preço ainda.</strong><small>O StashWear vai avisar quando uma peça salva baixar.</small></div>`;
    return;
  }

  panel.innerHTML = `<div class="notification-head">
    <div><span class="eyebrow">Notificações</span><strong>Quedas de preço</strong></div>
    <button class="ghost-btn" data-notification-action="clear">Limpar</button>
  </div>
  <div class="notification-list">
    ${notifications.slice(0, 12).map(n => `<a class="notification-item ${n.read ? '' : 'unread'}" href="${escapeHtml(n.url || '#')}" target="_blank" data-notification-id="${escapeHtml(n.id)}">
      <span class="notification-thumb">${n.imageUrl ? `<img src="${escapeHtml(n.imageUrl)}" alt="">` : '<span></span>'}</span>
      <span class="notification-copy">
        <strong>${escapeHtml(n.itemName || 'Peça salva')}</strong>
        <small>${escapeHtml(notificationMessage(n))}</small>
        <em>${notificationDateLabel(n.createdAt)}</em>
      </span>
    </a>`).join('')}
  </div>`;

  panel.querySelector('[data-notification-action="clear"]')?.addEventListener('click', async event => {
    event.preventDefault();
    state.notifications = [];
    await setNotifications([]);
    renderNotifications();
  });
  panel.querySelectorAll('[data-notification-id]').forEach(link => link.addEventListener('click', async () => {
    const id = link.dataset.notificationId;
    state.notifications = state.notifications.map(n => n.id === id ? { ...n, read:true } : n);
    await setNotifications(state.notifications);
    renderNotifications();
  }));
}
async function toggleNotificationPanel() {
  const bell = document.getElementById('notification-bell');
  const panel = document.getElementById('notification-panel');
  if (!bell || !panel) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  bell.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    state.notifications = state.notifications.map(n => ({ ...n, read:true }));
    await setNotifications(state.notifications);
    renderNotifications();
  }
}
function showPopupTipDialog() {
  const dialog = document.getElementById('popup-tip-dialog');
  if (!dialog) return;
  const closeEls = dialog.querySelectorAll('[data-tip-action="close"]');
  const previousFocus = document.activeElement;

  const close = () => {
    dialog.classList.remove('active');
    dialog.setAttribute('aria-hidden', 'true');
    closeEls.forEach(el => el.removeEventListener('click', close));
    document.removeEventListener('keydown', onKeydown);
    previousFocus?.focus?.();
  };
  const onKeydown = event => {
    if (event.key === 'Escape' || event.key === 'Enter') close();
  };

  dialog.classList.add('active');
  dialog.setAttribute('aria-hidden', 'false');
  closeEls.forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', onKeydown);
  dialog.querySelector('.solid-btn')?.focus?.();
}
function activateView(view) {
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.dash-view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view)?.classList.add('active');
  state.view = view;
}
function isRecent(item) {
  const date = Number(item.savedAt || item.updatedAt || 0);
  return date && Date.now() - date < 7 * 24 * 60 * 60 * 1000;
}
function cleanDisplayName(name) {
  const fallback = String(name || 'Peça sem nome');
  return fallback
    .replace(/^\s*comprar\s+/i, '')
    .replace(/\s*(?:-|–|—|\|)?\s*(?:R\$|BRL|US\$|USD)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?.*$/i, '')
    .trim() || fallback;
}
function embeddedPriceFromName(item) {
  const matches = String(item?.name || '').match(/(?:R\$|BRL|US\$|USD)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?/gi) || [];
  const values = matches.map(parsePrice).filter(value => value !== null && value >= 10 && value < 50000);
  return values.length ? values[values.length - 1] : null;
}
function trustedCurrentPrice(item) {
  const current = parsePrice(item?.price);
  const embedded = embeddedPriceFromName(item);
  if (embedded !== null && (current === null || current < 10 || embedded / Math.max(current, 0.01) > 10)) {
    return { value: embedded, text: formatPrice(embedded) };
  }
  if (current !== null && current > 0 && current < 50000) return { value: current, text: item.price || formatPrice(current) };
  return { value: embedded, text: embedded !== null ? formatPrice(embedded) : (item?.price || 'Sem preço') };
}
function trustedPriceValues(item, includeOriginal = false) {
  const current = trustedCurrentPrice(item).value;
  const values = [];
  if (current !== null) values.push(current);
  priceHistory(item).forEach(entry => {
    const value = parsePrice(entry?.price);
    if (value !== null && value > 0 && value < 50000 && (current === null || (value / current <= 10 && current / value <= 10))) values.push(value);
  });
  if (includeOriginal) {
    const original = parsePrice(item.saleInfo?.originalPrice);
    if (original !== null && current !== null && original > current * 1.03 && original / current <= 10 && original < 50000) values.push(original);
  }
  return values;
}
function getLowestPrice(item) {
  const values = trustedPriceValues(item);
  return values.length ? Math.min(...values) : null;
}
function getHighestPrice(item) {
  const values = trustedPriceValues(item, true);
  return values.length ? Math.max(...values) : null;
}
function hasPriceDrop(item) {
  const current = trustedCurrentPrice(item).value;
  const high = getHighestPrice(item);
  return current !== null && high !== null && high > current * 1.03;
}
function isOnSale(item) {
  const current = trustedCurrentPrice(item).value;
  const original = parsePrice(item.saleInfo?.originalPrice);
  const percent = Number(item.saleInfo?.discountPercent || 0);
  if (!item.saleInfo?.onSale || current === null || percent >= 95) return false;
  if (original !== null) return original > current * 1.03 && original / current <= 10 && original < 50000;
  return percent >= 5 && percent < 95;
}
function saleBadgeText(item) {
  const percent = Number(item.saleInfo?.discountPercent || 0);
  return percent > 0 && percent < 95 ? `-${percent}% OFF` : 'Promo ativa';
}
function priceDisplayHtml(item) {
  const trusted = trustedCurrentPrice(item);
  const currentValue = trusted.value;
  const originalValue = parsePrice(item.saleInfo?.originalPrice);
  const hasOriginal = isOnSale(item) && originalValue !== null && currentValue !== null && originalValue > currentValue;
  return `<span class="price-stack">
    ${hasOriginal ? `<span class="original-price">${escapeHtml(item.saleInfo.originalPrice)}</span>` : ''}
    <span class="item-price">${escapeHtml(trusted.text || 'Sem preço')}</span>
  </span>`;
}
function priceMemoryHtml(item) {
  const low = getLowestPrice(item);
  const high = getHighestPrice(item);
  if (low === null || high === null || low === high) return '';
  return `<div class="price-memory">Menor ${formatPrice(low)} · Maior ${formatPrice(high)}</div>`;
}
function emptyStateHtml(title = 'Nenhuma peça encontrada.', message = 'Salve peças pelo popup ou ajuste os filtros.') {
  return `<div class="empty-state styled-empty">
    <div class="empty-preview-card">
      <span></span><strong></strong><em></em>
    </div>
    <strong>${escapeHtml(title)}</strong>
    <small>${escapeHtml(message)}</small>
  </div>`;
}
function getCurationScore(item, allItems = state.items) {
  const price = trustedCurrentPrice(item).value || 0;
  const maxPrice = Math.max(1, ...allItems.map(i => trustedCurrentPrice(i).value || 0));
  let score = 0;
  if (item.favorite) score += 50;
  if (getPriorityLevel(item) === 'alta') score += 40;
  if (getPriorityLevel(item) === 'avaliando') score += 16;
  if (hasPriceDrop(item)) score += 15;
  if (isOnSale(item)) score += 12;
  if (isRecent(item)) score += 10;
  score += Math.round((price / maxPrice) * 20);
  return score;
}
function pickCurrentCuration(items) {
  return [...items].sort((a, b) => {
    const diff = getCurationScore(b, items) - getCurationScore(a, items);
    if (diff !== 0) return diff;
    return Number(b.savedAt || 0) - Number(a.savedAt || 0);
  })[0] || null;
}
function sortItems(items) {
  const list = [...items];
  if (state.sort === 'curation') return list.sort((a,b) => getCurationScore(b) - getCurationScore(a));
  if (state.sort === 'priceDesc') return list.sort((a,b) => (parsePrice(b.price) || 0) - (parsePrice(a.price) || 0));
  if (state.sort === 'priceAsc') return list.sort((a,b) => (parsePrice(a.price) || 999999999) - (parsePrice(b.price) || 999999999));
  if (state.sort === 'store') return list.sort((a,b) => String(a.store || '').localeCompare(String(b.store || ''), 'pt-BR'));
  return list.sort((a,b) => Number(b.savedAt || b.updatedAt || 0) - Number(a.savedAt || a.updatedAt || 0));
}
function applySearch(items) {
  const q = foldText(state.search).trim();
  if (!q) return items;
  return items.filter(item => foldText([item.name, item.store, item.category, item.note, item.price, item.url, getItemType(item), priorityLabel(item), ...getTags(item)].join(' ')).includes(q));
}
function applyStoreFilter(items) {
  if (state.storeFilter === 'todos') return items;
  return items.filter(item => {
    const domain = extractDomain(item.url);
    return String(item.store || '').toLowerCase() === state.storeFilter || domain === state.storeFilter;
  });
}
function renderGlobalSearch() {
  const panel = document.getElementById('global-search-panel');
  if (!panel) return;
  const q = foldText(state.globalSearch).trim();
  if (!q) {
    panel.classList.remove('active');
    panel.innerHTML = '';
    return;
  }
  const pieces = state.items.filter(item => foldText([item.name, item.store, item.category, item.note, item.price, item.url, getItemType(item), ...getTags(item)].join(' ')).includes(q)).slice(0, 6);
  const stores = state.stores.map((store, index) => ({ store, index })).filter(({ store }) => foldText([getStoreName(store), store.url, extractDomain(store.url)].join(' ')).includes(q)).slice(0, 6);
  const folders = state.folders.filter(folder => foldText(folder.name).includes(q)).slice(0, 6);
  const total = pieces.length + stores.length + folders.length;
  panel.classList.add('active');
  if (!total) {
    panel.innerHTML = `<div class="global-empty">Nenhum resultado para "${escapeHtml(state.globalSearch)}".</div>`;
    return;
  }
  panel.innerHTML = `<div class="global-results">
    ${pieces.map(item => `<button class="global-result" data-global-type="piece" data-key="${escapeHtml(itemKey(item))}"><span>Peça</span><strong>${escapeHtml(item.name || 'Peça sem nome')}</strong><small>${escapeHtml(item.store || item.price || 'Coleção')}</small></button>`).join('')}
    ${stores.map(({ store, index }) => `<button class="global-result" data-global-type="store" data-index="${index}"><span>Loja</span><strong>${escapeHtml(getStoreName(store))}</strong><small>${escapeHtml(extractDomain(store.url) || store.url || 'Loja salva')}</small></button>`).join('')}
    ${folders.map(folder => `<button class="global-result" data-global-type="folder" data-folder-id="${escapeHtml(folder.id)}"><span>Pasta</span><strong>${escapeHtml(folder.name)}</strong><small>${getFolderItems(folder).length} peça(s)</small></button>`).join('')}
  </div>`;
  panel.querySelectorAll('.global-result').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.globalType === 'piece') {
      state.search = state.globalSearch;
      state.typeFilter = 'todos';
      state.storeFilter = 'todos';
      document.getElementById('search-input').value = state.search;
      activateView('collection');
      renderCollection();
    } else if (btn.dataset.globalType === 'store') {
      state.selectedStoreDomain = extractDomain(state.stores[Number(btn.dataset.index)]?.url);
      activateView('stores');
      renderStores();
    } else if (btn.dataset.globalType === 'folder') {
      state.selectedFolderId = btn.dataset.folderId;
      state.folderPickerOpen = false;
      activateView('folders');
      renderFolders();
    }
    state.globalSearch = '';
    const globalSearchInput = document.getElementById('global-search-input');
    if (globalSearchInput) globalSearchInput.value = '';
    renderGlobalSearch();
  }));
}
function topEntries(items, key, limit = 6) {
  const map = {};
  items.forEach(item => { const value = (item[key] || 'Sem informação').trim?.() || 'Sem informação'; map[value] = (map[value] || 0) + 1; });
  return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, limit);
}
function topTags(items, limit = 10) {
  const map = {};
  items.forEach(i => getTags(i).forEach(t => map[t] = (map[t] || 0) + 1));
  return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, limit);
}

function renderStats() {
  renderDecisions();
}
function getUnorganizedItems() {
  const folderKeys = new Set(state.folders.flatMap(folder => folder.itemKeys || []));
  return state.items.filter(item => {
    const noType = getItemType(item) === 'Outro';
    const noStore = !String(item.store || '').trim();
    const noFolder = !folderKeys.has(itemKey(item));
    return noType || noStore || noFolder;
  });
}
function decisionPreview(items) {
  const previewItems = items.slice(0, 3);
  if (!previewItems.length) return '<small>Tudo certo por aqui.</small>';
  return `<div class="decision-preview">${previewItems.map(item => `
    <span class="decision-thumb" title="${escapeHtml(item.name || 'Peça sem nome')}">
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || 'Peça')}">` : '<span>◇</span>'}
    </span>
  `).join('')}</div>`;
}
function renderDecisionCard({ key, label, value, desc, items, actionLabel }) {
  return `<button class="decision-card" data-decision="${key}">
    <span>${label}</span>
    <strong>${value}</strong>
    <small>${desc}</small>
    ${decisionPreview(items)}
    <em>${actionLabel}</em>
  </button>`;
}
function renderDecisions() {
  const el = document.getElementById('decisions-grid');
  if (!el) return;
  const openItems = state.items;
  const buyNow = openItems.filter(item => getPriorityLevel(item) === 'alta' || hasPriceDrop(item) || isOnSale(item));
  const reviewing = openItems.filter(item => getPriorityLevel(item) === 'avaliando');
  const priceRadar = openItems.filter(item => hasPriceDrop(item) || isOnSale(item));
  const organize = getUnorganizedItems();
  const cards = [
    { key:'buy', label:'Comprar agora', value:buyNow.length, desc:'Prioridade alta ou preço em queda', items:buyNow, actionLabel:'Ver prioridades' },
    { key:'review', label:'Revisar', value:reviewing.length, desc:'Peças ainda em avaliação', items:reviewing, actionLabel:'Abrir avaliando' },
    { key:'organize', label:'Organizar', value:organize.length, desc:'Sem tipo, loja ou pasta', items:organize, actionLabel:'Limpar coleção' },
    { key:'price', label:'Radar de preço', value:priceRadar.length, desc:'Quedas e metas de preço', items:priceRadar, actionLabel:'Ver oportunidades' }
  ];
  el.innerHTML = cards.map(renderDecisionCard).join('');
  el.querySelectorAll('[data-decision]').forEach(btn => btn.addEventListener('click', () => {
    const decision = btn.dataset.decision;
    state.search = '';
    state.typeFilter = 'todos';
    state.storeFilter = 'todos';
    document.getElementById('search-input').value = '';
    if (decision === 'buy') {
      state.priorityFilter = 'alta';
      activateView('priorities');
      renderPriorities();
      return;
    }
    if (decision === 'review') {
      state.priorityFilter = 'avaliando';
      activateView('priorities');
      renderPriorities();
      return;
    }
    state.sort = decision === 'price' ? 'curation' : 'date';
    document.getElementById('sort-select-dashboard').value = state.sort;
    activateView('collection');
    renderCollection();
  }));
}
function renderCuration() {
  const featured = pickCurrentCuration(state.items);
  const el = document.getElementById('curation-card');
  if (!featured) {
    el.innerHTML = `<div class="curation-empty"><span class="eyebrow">Curadoria Atual</span><h2>Sua coleção ainda está vazia</h2><p class="curation-note">Salve uma peça pelo popup para começar.</p></div>`;
    return;
  }
  const score = getCurationScore(featured);
  const lowest = getLowestPrice(featured);
  const trusted = trustedCurrentPrice(featured);
  const price = trusted.value;
  const displayName = cleanDisplayName(featured.name);
  const drop = lowest !== null && price !== null && price <= lowest && priceHistory(featured).length > 1;
  el.innerHTML = `<div class="curation-inner">
    <div class="curation-image">${featured.imageUrl ? `<img src="${escapeHtml(featured.imageUrl)}" alt="${escapeHtml(featured.name)}">` : '<div class="thumb-placeholder">◇</div>'}</div>
    <div class="curation-copy">
      <div>
        <span class="eyebrow">Curadoria Atual</span>
        <h2>${escapeHtml(displayName)}</h2>
        <div class="curation-meta">
          ${featured.favorite ? '<span class="pill light">♥ Favorita</span>' : ''}
          <span class="pill">${priorityLabel(featured)}</span>
          ${trusted.text ? `<span class="pill">${escapeHtml(trusted.text)}</span>` : ''}
          ${featured.store ? `<span class="pill">${escapeHtml(featured.store)}</span>` : ''}
          ${drop ? '<span class="pill light">↓ Menor preço</span>' : ''}
          <span class="pill">Pontuação ${score}</span>
        </div>
        ${featured.note ? `<p class="curation-note">${escapeHtml(featured.note)}</p>` : ''}
      </div>
      ${featured.url ? `<a class="open-link" href="${escapeHtml(featured.url)}" target="_blank">Abrir peça ↗</a>` : ''}
    </div>
  </div>`;
}
function itemCardHtml(item, index, options = {}) {
  const price = trustedCurrentPrice(item).value;
  const lowest = getLowestPrice(item);
  const dropped = hasPriceDrop(item);
  const onSale = isOnSale(item);
  const displayName = cleanDisplayName(item.name);
  const nameClass = getNameSizeClass(displayName);
  return `<article class="item-card ${nameClass}" data-index="${index}">
    <div class="item-thumb">
      ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : '<div class="thumb-placeholder">◇</div>'}
      ${onSale ? `<span class="sale-badge">${escapeHtml(saleBadgeText(item))}</span>` : ''}
      <button class="fav-btn ${item.favorite ? 'active' : ''}" data-action="favorite" title="Favoritar">♥</button>
    </div>
    <div class="item-body">
      <div class="item-title-row"><div class="item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div></div>
      <div class="item-meta"><span class="item-store">${escapeHtml(item.store || item.category || 'Sem loja')}</span>${priceDisplayHtml(item)}</div>
      ${priceMemoryHtml(item)}
      <div class="card-surface-row">
        <span class="piece-type">${escapeHtml(getItemType(item))}</span>
        ${onSale ? `<span class="sale-pill">${escapeHtml(saleBadgeText(item))}</span>` : ''}
        ${dropped && lowest !== null && price !== null ? `<span class="price-drop-pill">Preço caiu</span>` : ''}
      </div>
      <div class="priority-toggle" aria-label="Prioridade da peça">
        <button class="${getPriorityLevel(item)==='alta'?'active':''}" data-action="priority" data-value="alta" title="Prioridade Alta"><span>Alta</span></button>
        <button class="${getPriorityLevel(item)==='avaliando'?'active':''}" data-action="priority" data-value="avaliando" title="Avaliando"><span>Aval.</span></button>
        <button class="${getPriorityLevel(item)==='inspiracional'?'active':''}" data-action="priority" data-value="inspiracional" title="Inspiracional"><span>Insp.</span></button>
      </div>
      <div class="card-controls">
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank">Abrir</a>` : '<button disabled>Abrir</button>'}
        ${options.hideDelete ? '' : '<button data-action="delete">Remover</button>'}
      </div>
    </div>
  </article>`;
}
function renderGrid(id, items, options = {}) {
  const el = document.getElementById(id);
  if (!items.length) {
    el.innerHTML = emptyStateHtml();
    return;
  }
  el.innerHTML = items.map(item => itemCardHtml(item, state.items.findIndex(i => itemKey(i) === itemKey(item)), options)).join('');
  bindCardActions(el, options);
}
function renderTypeFilters() {
  const el = document.getElementById('type-filter-dashboard');
  if (!el) return;
  const counts = new Map();
  state.items.forEach(item => {
    const type = getItemType(item);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  const options = [['todos', 'Todos os tipos', state.items.length], ...Array.from(counts.entries()).sort((a,b) => b[1] - a[1]).map(([type,count]) => [type, type, count])];
  el.innerHTML = options.map(([key,label,count]) => `<button class="filter-chip ${state.typeFilter===key?'active':''}" data-type="${escapeHtml(key)}">${escapeHtml(label)} · ${count}</button>`).join('');
  el.querySelectorAll('[data-type]').forEach(btn => btn.addEventListener('click', () => { state.typeFilter = btn.dataset.type; renderCollection(); }));
}
function renderStoreFilters() {
  const el = document.getElementById('store-filter-dashboard');
  if (!el) return;
  const counts = new Map();
  state.items.forEach(item => {
    const key = String(item.store || extractDomain(item.url) || 'Sem loja').toLowerCase();
    const label = item.store || domainToName(extractDomain(item.url)) || 'Sem loja';
    const current = counts.get(key) || { label, count: 0 };
    current.count += 1;
    counts.set(key, current);
  });
  const options = [{ key:'todos', label:'Todas as lojas', count:state.items.length }, ...Array.from(counts.entries()).map(([key, data]) => ({ key, ...data })).sort((a,b) => b.count - a.count)];
  el.innerHTML = options.map(opt => `<button class="filter-chip ${state.storeFilter===opt.key?'active':''}" data-store-filter="${escapeHtml(opt.key)}">${escapeHtml(opt.label)} · ${opt.count}</button>`).join('');
  el.querySelectorAll('[data-store-filter]').forEach(btn => btn.addEventListener('click', () => {
    state.storeFilter = btn.dataset.storeFilter;
    renderCollection();
  }));
}
function applyTypeFilter(items) {
  if (state.typeFilter === 'todos') return items;
  return items.filter(item => getItemType(item) === state.typeFilter);
}
function renderCollection() {
  renderTypeFilters();
  renderStoreFilters();
  renderGrid('collection-grid', sortItems(applyStoreFilter(applyTypeFilter(applySearch(state.items)))));
}
function renderPriorityFilters() {
  const options = [
    ['todos', 'Todas', state.items.length],
    ['alta', 'Prioridade Alta', state.items.filter(i => getPriorityLevel(i) === 'alta').length],
    ['avaliando', 'Avaliando', state.items.filter(i => getPriorityLevel(i) === 'avaliando').length],
    ['inspiracional', 'Inspiracional', state.items.filter(i => getPriorityLevel(i) === 'inspiracional').length]
  ];
  document.getElementById('priority-filter-dashboard').innerHTML = options.map(([key,label,count]) => `<button class="filter-chip ${state.priorityFilter===key?'active':''}" data-priority="${key}">${label} · ${count}</button>`).join('');
  document.querySelectorAll('[data-priority]').forEach(btn => btn.addEventListener('click', () => { state.priorityFilter = btn.dataset.priority; renderPriorities(); }));
}
function renderPriorities() {
  renderPriorityFilters();
  let items = state.items;
  if (state.priorityFilter !== 'todos') items = items.filter(i => getPriorityLevel(i) === state.priorityFilter);
  items = items.sort((a,b) => getCurationScore(b) - getCurationScore(a));
  renderGrid('priorities-grid', items);
}
function trashIconHtml() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 8h10l-.7 12H7.7L7 8Z"/></svg>`;
}
function renderFolderPicker(folder) {
  const el = document.getElementById('folder-picker');
  if (!el) return;
  if (!folder) { el.innerHTML = ''; return; }
  if (!state.folderPickerOpen) { el.innerHTML = ''; return; }
  if (!state.items.length) {
    el.innerHTML = '<div class="empty-state compact">Nenhuma peca salva para selecionar.</div>';
    return;
  }
  const selectedKeys = new Set(folder.itemKeys);
  el.innerHTML = `<div class="folder-picker-head">
    <div><span class="eyebrow">Selecionar pecas</span><strong>Itens desta pasta</strong></div>
    <div class="folder-picker-actions"><small>${selectedKeys.size} selecionada(s)</small><button class="ghost-btn" data-action="folder-picker-close">Concluir</button></div>
  </div>
  <div class="folder-picker-list">
    ${sortItems(state.items).map(item => {
      const key = itemKey(item);
      return `<label class="folder-picker-item ${selectedKeys.has(key) ? 'selected' : ''}">
        <input type="checkbox" data-folder-item="${escapeHtml(key)}" ${selectedKeys.has(key) ? 'checked' : ''}>
        <span class="folder-picker-thumb">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ''}</span>
        <span class="folder-picker-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.store || item.price || 'Sem loja')}</small></span>
      </label>`;
    }).join('')}
  </div>`;
  el.querySelectorAll('[data-folder-item]').forEach(input => input.addEventListener('change', async e => {
    const key = e.target.dataset.folderItem;
    if (e.target.checked) {
      if (!folder.itemKeys.includes(key)) folder.itemKeys.push(key);
    } else {
      folder.itemKeys = folder.itemKeys.filter(itemKeyValue => itemKeyValue !== key);
    }
    await setFolders(state.folders);
    renderFolders();
  }));
  el.querySelector('[data-action="folder-picker-close"]')?.addEventListener('click', () => {
    state.folderPickerOpen = false;
    renderFolders();
  });
}
function renderFolderGrid(id, items, folder) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><strong>Nenhuma peca nesta pasta.</strong><br><small>Use "Selecionar pecas" para montar este conjunto.</small></div>`;
    return;
  }
  el.innerHTML = items.map(item => {
    const index = state.items.findIndex(i => itemKey(i) === itemKey(item));
    const key = itemKey(item);
    return `<div class="folder-card-wrap" data-folder-remove-key="${escapeHtml(key)}">
      <button class="folder-trash-btn" data-action="folder-trash" title="Tirar da pasta" aria-label="Tirar da pasta">${trashIconHtml()}</button>
      ${itemCardHtml(item, index, { hideDelete: true })}
    </div>`;
  }).join('');
  bindCardActions(el, { hideDelete: true });
  el.querySelectorAll('[data-action="folder-trash"]').forEach(btn => btn.addEventListener('click', async () => {
    const key = btn.closest('[data-folder-remove-key]')?.dataset.folderRemoveKey;
    if (!key) return;
    folder.itemKeys = folder.itemKeys.filter(itemKeyValue => itemKeyValue !== key);
    await setFolders(state.folders);
    await logActivity({ type:'pasta', itemName:folder.name, detail:'Peca removida da pasta' });
    showToast('Peça removida da pasta');
    renderFolders();
  }));
}
function renderFolders() {
  const list = document.getElementById('folder-list');
  const current = document.getElementById('folder-current');
  const picker = document.getElementById('folder-picker');
  const selected = ensureSelectedFolder();
  if (!list || !current) return;

  if (!state.folders.length) {
    list.innerHTML = '<div class="empty-state compact">Nenhuma pasta criada ainda.</div>';
    current.innerHTML = '<strong>Crie uma pasta para guardar conjuntos de roupas.</strong><small>Depois selecione as pecas dentro dela.</small>';
    if (picker) picker.innerHTML = '';
    renderGrid('folders-grid', []);
    return;
  }

  list.innerHTML = state.folders.map(folder => {
    const count = getFolderItems(folder).length;
    return `<button class="folder-chip ${folder.id === state.selectedFolderId ? 'active' : ''}" data-folder-id="${escapeHtml(folder.id)}">
      <span>${escapeHtml(folder.name)}</span>
      <small>${count} peca(s)</small>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-folder-id]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedFolderId = btn.dataset.folderId;
    state.folderPickerOpen = false;
    state.editingFolderId = null;
    renderFolders();
  }));

  const items = getFolderItems(selected);
  if (state.editingFolderId === selected.id) {
    current.innerHTML = `<form class="folder-edit-form" data-action="save-folder-edit"><div><span class="eyebrow">Editar pasta</span><input data-edit-folder-name value="${escapeHtml(selected.name)}" maxlength="40" /></div><div class="folder-current-actions"><button class="solid-btn" type="submit">Salvar</button><button class="ghost-btn" type="button" data-action="cancel-folder-edit">Cancelar</button></div></form>`;
    current.querySelector('[data-action="save-folder-edit"]')?.addEventListener('submit', async e => {
      e.preventDefault();
      selected.name = current.querySelector('[data-edit-folder-name]').value.trim() || selected.name;
      state.editingFolderId = null;
      await setFolders(state.folders);
      await logActivity({ type:'pasta', itemName:selected.name, detail:'Pasta renomeada' });
      showToast('Pasta renomeada');
      renderAll();
    });
    current.querySelector('[data-action="cancel-folder-edit"]')?.addEventListener('click', () => {
      state.editingFolderId = null;
      renderFolders();
    });
  } else {
    current.innerHTML = `<div><span class="eyebrow">Pasta selecionada</span><strong>${escapeHtml(selected.name)}</strong><small>${items.length} peca(s) neste conjunto</small></div><div class="folder-current-actions"><button class="solid-btn" data-action="folder-picker-toggle">${state.folderPickerOpen ? 'Ocultar selecao' : 'Selecionar pecas'}</button><button class="ghost-btn" data-action="folder-edit">Renomear</button><button class="ghost-btn" data-action="folder-delete">Apagar pasta</button></div>`;
  }
  current.querySelector('[data-action="folder-picker-toggle"]')?.addEventListener('click', () => {
    state.folderPickerOpen = !state.folderPickerOpen;
    renderFolders();
  });
  current.querySelector('[data-action="folder-edit"]')?.addEventListener('click', () => {
    state.editingFolderId = selected.id;
    renderFolders();
  });
  current.querySelector('[data-action="folder-delete"]')?.addEventListener('click', async () => {
    const ok = await showConfirmDialog({
      title: 'Apagar pasta?',
      message: `A pasta "${selected.name}" sera removida. As pecas continuam salvas na colecao.`,
      confirmLabel: 'Apagar pasta'
    });
    if (!ok) return;
    state.folders = state.folders.filter(folder => folder.id !== selected.id);
    state.selectedFolderId = state.folders[0]?.id || null;
    await setFolders(state.folders);
    await logActivity({ type:'pasta', itemName:selected.name, detail:'Pasta removida' });
    showToast('Pasta removida', 'danger');
    renderAll();
  });

  renderFolderPicker(selected);
  renderFolderGrid('folders-grid', sortItems(items), selected);
}
function renderFavorites() {
  renderGrid('favorites-grid', state.items.filter(i => i.favorite).sort((a,b) => getCurationScore(b) - getCurationScore(a)));
}
function renderTimeline() {
  const el = document.getElementById('timeline-dashboard');
  const fallback = state.items.slice(0, 12).map(i => ({ type:'salvo', itemName:i.name, detail:i.price ? `Salva por ${i.price}` : 'Adicionada à coleção', at:i.savedAt || i.updatedAt || Date.now(), url:i.url }));
  const activities = state.activities.length ? state.activities : fallback;
  if (!activities.length) { el.innerHTML = `<div class="empty-state">Nenhuma atividade registrada ainda.</div>`; return; }
  el.innerHTML = activities.slice(0, 60).map(a => `<div class="timeline-item">
    <div class="timeline-icon">${activityIcon(a.type)}</div>
    <div class="timeline-body"><div class="timeline-top"><strong>${activityTitle(a.type)}</strong><span>${activityDateLabel(a.at)}</span></div><p>${escapeHtml(a.itemName || a.storeName || 'StashWear')}</p><small>${escapeHtml(a.detail || '')}</small></div>
  </div>`).join('');
}
function renderStorePieces() {
  const el = document.getElementById('store-pieces-dashboard');
  if (!el) return;
  const store = state.stores.find(s => extractDomain(s.url) === state.selectedStoreDomain);
  if (!store) {
    el.innerHTML = '';
    return;
  }
  const items = getStoreItems(store);
  el.innerHTML = `<div class="store-pieces-header">
    <div><span class="eyebrow">Peças da loja</span><strong>${escapeHtml(getStoreName(store))}</strong><small>${items.length} peça(s) relacionadas</small></div>
    <button class="ghost-btn" data-action="close-store-items">Fechar</button>
  </div><div id="store-pieces-grid" class="collection-grid"></div>`;
  el.querySelector('[data-action="close-store-items"]')?.addEventListener('click', () => {
    state.selectedStoreDomain = null;
    renderStores();
  });
  renderGrid('store-pieces-grid', sortItems(items));
}
function renderStores() {
  const el = document.getElementById('stores-dashboard');
  const piecesEl = document.getElementById('store-pieces-dashboard');
  if (!el) return;
  if (!state.stores.length) {
    el.innerHTML = `<div class="empty-state"><strong>Nenhuma loja salva.</strong><br><small>As lojas detectadas pelo popup aparecem aqui automaticamente.</small></div>`;
    if (piecesEl) piecesEl.innerHTML = '';
    return;
  }
  el.innerHTML = state.stores.map((store, index) => {
    const url = normalizeUrl(store.url);
    const domain = extractDomain(url);
    const name = getStoreName(store);
    const initial = name.trim().charAt(0).toUpperCase() || 'L';
    const count = getStoreItems(store).length;
    if (state.editingStoreIndex === index) {
      return `<article class="store-card editing" data-store-index="${index}">
        <div class="store-avatar">${escapeHtml(initial)}</div>
        <form class="store-edit-form" data-action="save-store-edit">
          <input data-edit-store-name value="${escapeHtml(name)}" maxlength="48" />
          <input data-edit-store-url value="${escapeHtml(url)}" />
          <div class="store-card-actions">
            <button class="solid-btn" type="submit">Salvar</button>
            <button class="ghost-btn" type="button" data-action="cancel-store-edit">Cancelar</button>
          </div>
        </form>
      </article>`;
    }
    return `<article class="store-card" data-store-index="${index}">
      <div class="store-avatar">${escapeHtml(initial)}</div>
      <div class="store-copy">
        <div class="store-title-row"><strong>${escapeHtml(name)}</strong>${store.autoSaved ? '<span class="badge-auto">detectada</span>' : ''}</div>
        <span>${escapeHtml(domain || url || 'Sem endereco')}</span>
        <small>${count} peca(s) salvas desta loja</small>
      </div>
      <div class="store-card-actions">
        <button class="ghost-btn" data-action="view-store-items">Peças</button>
        <button class="ghost-btn" data-action="edit-store">Editar</button>
        ${url ? `<a class="ghost-btn" href="${escapeHtml(url)}" target="_blank">Abrir</a>` : ''}
        <button class="danger-icon-btn" data-action="delete-store" title="Remover loja" aria-label="Remover loja">${trashIconHtml()}</button>
      </div>
    </article>`;
  }).join('');
  el.querySelectorAll('[data-action="view-store-items"]').forEach(btn => btn.addEventListener('click', () => {
    const index = Number(btn.closest('[data-store-index]')?.dataset.storeIndex);
    state.selectedStoreDomain = extractDomain(state.stores[index]?.url);
    renderStores();
  }));
  el.querySelectorAll('[data-action="edit-store"]').forEach(btn => btn.addEventListener('click', () => {
    state.editingStoreIndex = Number(btn.closest('[data-store-index]')?.dataset.storeIndex);
    renderStores();
  }));
  el.querySelectorAll('[data-action="cancel-store-edit"]').forEach(btn => btn.addEventListener('click', () => {
    state.editingStoreIndex = null;
    renderStores();
  }));
  el.querySelectorAll('[data-action="save-store-edit"]').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const index = Number(form.closest('[data-store-index]')?.dataset.storeIndex);
    const store = state.stores[index];
    if (!store) return;
    store.name = form.querySelector('[data-edit-store-name]').value.trim() || getStoreName(store);
    store.url = normalizeUrl(form.querySelector('[data-edit-store-url]').value) || store.url;
    state.editingStoreIndex = null;
    await setStores(state.stores);
    await logActivity({ type:'loja', storeName:store.name, detail:'Loja editada' });
    showToast('Loja atualizada');
    renderAll();
  }));
  el.querySelectorAll('[data-action="delete-store"]').forEach(btn => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-store-index]');
    const index = Number(card?.dataset.storeIndex);
    const store = state.stores[index];
    if (!store) return;
    const ok = await showConfirmDialog({
      title: 'Remover loja?',
      message: `"${store.name || 'Esta loja'}" sera removida da lista de lojas salvas. As pecas continuam na colecao.`,
      confirmLabel: 'Remover loja'
    });
    if (!ok) return;
    state.stores.splice(index, 1);
    if (state.selectedStoreDomain === extractDomain(store.url)) state.selectedStoreDomain = null;
    await setStores(state.stores);
    await logActivity({ type:'loja', storeName:store.name, detail:'Loja removida' });
    showToast('Loja removida', 'danger');
    renderAll();
  }));
  renderStorePieces();
}
function renderAnalysis() {
  const totalValue = state.items.reduce((sum, item) => sum + (parsePrice(item.price) || 0), 0);
  const pending = state.items;
  const brands = topEntries(state.items, 'store', 6);
  const tags = topTags(state.items, 10);
  const types = topEntries(state.items.map(i => ({ type: getItemType(i) })), 'type', 8);
  const cards = [
    ['Valor da coleção', formatPrice(totalValue), `${state.items.length} peça(s) salvas`],
    ['Prioridades ativas', pending.filter(i => getPriorityLevel(i)==='alta').length, `${pending.length} peça(s) em aberto`],
    ['Promoções', state.items.filter(item => hasPriceDrop(item) || isOnSale(item)).length, 'Peças em sale ou abaixo de um preço anterior'],
    ['Favoritas', state.items.filter(i => i.favorite).length, 'Peças especiais da coleção']
  ];
  document.getElementById('analysis-dashboard').innerHTML = cards.map(([label,value,desc]) => `<div class="analysis-card"><span>${label}</span><strong>${value}</strong><small>${desc}</small></div>`).join('') +
    `<div class="analysis-card"><span>Lojas mais salvas</span>${brands.length ? brands.map(([name,count]) => `<div class="brand-row"><span>${escapeHtml(name)}</span><em>${count}</em></div>`).join('') : '<small>Sem lojas registradas.</small>'}</div>` +
    `<div class="analysis-card"><span>Tipos de peça</span>${types.length ? types.map(([name,count]) => `<div class="brand-row"><span>${escapeHtml(name)}</span><em>${count}</em></div>`).join('') : '<small>Sem tipos registrados.</small>'}</div>` +
    `<div class="analysis-card"><span>Etiquetas</span>${tags.length ? tags.map(([name,count]) => `<div class="brand-row"><span>#${escapeHtml(name)}</span><em>${count}</em></div>`).join('') : '<small>Sem etiquetas registradas.</small>'}</div>`;
}
function renderAll() {
  renderStats(); renderCuration(); renderCollection(); renderPriorities(); renderFolders(); renderFavorites(); renderTimeline(); renderStores(); renderAnalysis(); renderGlobalSearch(); renderNotifications();
}
async function loadData() {
  state.items = await getItems();
  state.activities = await getActivities();
  state.folders = (await getFolders()).map(normalizeFolder);
  state.stores = await getStores();
  state.notifications = await getNotifications();
  ensureSelectedFolder();
  renderAll();
}
async function bootData() {
  const session = await window.StashWearSync?.getSession?.();
  if (session?.accessToken) {
    try {
      await setSyncStatus('syncing', 'Carregando colecao da conta');
      await window.StashWearSync.syncAfterLogin({ saveLocal: false });
      await setSyncStatus('synced', 'Sincronizado');
    } catch (error) {
      await setSyncStatus('error', 'Falha ao sincronizar');
      showToast(authErrorMessage(error), 'danger');
    }
  }
  await loadData();
  await refreshSyncStatus();
}
function bindCardActions(container, options = {}) {
  container.querySelectorAll('.item-card').forEach(card => {
    const index = Number(card.dataset.index);
    const item = state.items[index];
    if (!item) return;
    card.querySelector('[data-action="favorite"]')?.addEventListener('click', async () => {
      item.favorite = !item.favorite;
      item.updatedAt = Date.now();
      await setItems(state.items);
      await logActivity({ type:'favorita', itemName:item.name, detail:item.favorite ? 'Marcada como favorita' : 'Removida dos favoritos', url:item.url });
      renderAll();
    });
    card.querySelectorAll('[data-action="priority"]').forEach(btn => btn.addEventListener('click', async () => {
      item.curationPriority = btn.dataset.value;
      item.buyThisMonth = btn.dataset.value !== 'inspiracional';
      item.updatedAt = Date.now();
      await setItems(state.items);
      await logActivity({ type:'prioridade', itemName:item.name, detail:`Nova prioridade: ${priorityLabel(item)}`, url:item.url });
      renderAll();
    }));
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      const ok = await showConfirmDialog({
        title: 'Remover peca da colecao?',
        message: `"${item.name || 'Esta peca'}" sera removida da colecao e de todas as pastas. Essa acao nao pode ser desfeita.`,
        confirmLabel: 'Remover peca'
      });
      if (!ok) return;
      const [removed] = state.items.splice(index, 1);
      const removedKey = itemKey(removed);
      state.folders.forEach(folder => { folder.itemKeys = folder.itemKeys.filter(key => key !== removedKey); });
      await rememberDeletedItem(removed);
      await setFolders(state.folders);
      await setItems(state.items);
      showToast('Peça removida da coleção', 'danger');
      await logActivity({ type:'removida', itemName:removed?.name, detail:'Peça removida pela tela completa', url:removed?.url });
      renderAll();
    });
  });
}

document.querySelectorAll('.dash-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activateView(btn.dataset.view);
  });
});
document.getElementById('global-search-input')?.addEventListener('input', e => {
  state.globalSearch = e.target.value;
  state.search = e.target.value;
  state.typeFilter = 'todos';
  state.storeFilter = 'todos';
  const collectionSearch = document.getElementById('search-input');
  if (collectionSearch) collectionSearch.value = state.search;
  if (state.globalSearch.trim()) {
    activateView('collection');
    renderCollection();
  }
  renderGlobalSearch();
});
document.getElementById('search-input').addEventListener('input', e => { state.search = e.target.value; renderCollection(); });
document.getElementById('sort-select-dashboard').addEventListener('change', e => { state.sort = e.target.value; renderCollection(); });
document.getElementById('folder-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.getElementById('folder-name-input');
  const name = input.value.trim();
  if (!name) return;
  const folder = normalizeFolder({ id: createFolderId(), name, itemKeys: [], createdAt: Date.now() });
  state.folders.unshift(folder);
  state.selectedFolderId = folder.id;
  input.value = '';
  await setFolders(state.folders);
  await logActivity({ type:'pasta', itemName:name, detail:'Pasta criada' });
  showToast('Pasta criada');
  renderAll();
});
document.getElementById('store-form-dashboard')?.addEventListener('submit', async e => {
  e.preventDefault();
  const nameInput = document.getElementById('store-name-dashboard');
  const urlInput = document.getElementById('store-url-dashboard');
  const url = normalizeUrl(urlInput.value);
  const domain = extractDomain(url);
  const name = nameInput.value.trim() || domainToName(domain);
  if (!name || !url) return;
  const exists = state.stores.some(store => extractDomain(store.url) === domain);
  if (!exists) {
    state.stores.push({ name, url });
    await setStores(state.stores);
    await logActivity({ type:'loja', storeName:name, detail:'Loja adicionada pelo dashboard' });
    showToast('Loja adicionada');
  } else {
    showToast('Loja ja estava salva');
  }
  nameInput.value = '';
  urlInput.value = '';
  renderAll();
});
document.getElementById('btn-refresh').addEventListener('click', loadData);
document.getElementById('btn-account')?.addEventListener('click', openAccountDialog);
document.querySelectorAll('[data-account-action="close"]').forEach(el => el.addEventListener('click', closeAccountDialog));
document.getElementById('account-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  await handleAccountAuth('login');
});
document.getElementById('account-password')?.addEventListener('input', updatePasswordStrength);
document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  setPasswordToggleState(button, isHidden);
  input.focus();
}));
document.getElementById('btn-account-mode-signup')?.addEventListener('click', () => {
  setAccountMode(accountMode === 'signup' || accountMode === 'recover' ? 'login' : 'signup');
});
document.getElementById('btn-profile-save')?.addEventListener('click', async () => {
  const input = document.getElementById('profile-name-input');
  const displayName = input?.value.trim();
  const validationMessage = validateDisplayName(displayName);
  if (validationMessage) {
    showToast(validationMessage, 'danger');
    return;
  }
  try {
    await window.StashWearSync?.updateDisplayName?.(displayName);
    await refreshAccountUi();
    showToast('Nome de usuario atualizado');
  } catch (error) {
    showToast(authErrorMessage(error), 'danger');
  }
});
document.getElementById('btn-account-logout')?.addEventListener('click', async () => {
  const ok = await showConfirmDialog({
    title: 'Sair da conta?',
    message: 'Ao sair, a colecao desta conta sera removida desta tela. Seus dados sincronizados continuam salvos na nuvem.',
    confirmLabel: 'Sair da conta'
  });
  if (!ok) return;
  await window.StashWearSync?.signOut?.();
  await Promise.all([
    setItems([]),
    setActivities([]),
    setFolders([]),
    setStores([]),
    setNotifications([])
  ]);
  state.items = [];
  state.activities = [];
  state.folders = [];
  state.stores = [];
  state.notifications = [];
  state.selectedFolderId = null;
  await setSyncStatus('offline', 'Conta desconectada');
  await refreshAccountUi();
  renderAll();
  showToast('Conta desconectada');
  closeAccountDialog();
});
document.getElementById('notification-bell')?.addEventListener('click', toggleNotificationPanel);
document.addEventListener('click', event => {
  const center = document.querySelector('.notification-center');
  const panel = document.getElementById('notification-panel');
  const bell = document.getElementById('notification-bell');
  if (!center || !panel || !bell || panel.hidden || center.contains(event.target)) return;
  panel.hidden = true;
  bell.setAttribute('aria-expanded', 'false');
});
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.notifications) {
    state.notifications = changes.notifications.newValue || [];
    renderNotifications();
  }
  if (changes[SYNC_STATUS_KEY] || changes.stashwearSupabaseSession) refreshSyncStatus();
  if (changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || 'dark');
});
document.getElementById('btn-open-popup-tip').addEventListener('click', showPopupTipDialog);

applyTheme('dark');
bindThemeControls();
loadThemePreference();
refreshAccountUi();
bootData();
bootRecoveryFlow();
