const get = key => new Promise(r => chrome.storage.local.get(key, d => r(d[key] || [])));
const save = (key, val) => new Promise(r => chrome.storage.local.set({ [key]: val }, r));
const getItems = () => get('items');
const setItems = v => save('items', v);
const getStores = () => get('stores');
const setStores = v => save('stores', v);
const getActivities = () => get('activities');
const setActivities = v => save('activities', v);
const getDeletedItemKeys = () => get('deletedItemKeys');
const setDeletedItemKeys = v => save('deletedItemKeys', v);
const THEME_KEY = 'stashwearTheme';

let activeFilter = 'Todos';
let activeSort = 'date';
let activePriorityFilter = 'todos';

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
  const data = await new Promise(resolve => chrome.storage.local.get(THEME_KEY, resolve));
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

applyTheme('dark');
bindThemeControls();
loadThemePreference();

// ── Abas ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'insights') { renderCollectionIntelligence(); renderTimeline(); }
    if (btn.dataset.tab === 'shopping') renderShoppingList();
  });
});

document.getElementById('sort-select').addEventListener('change', e => {
  activeSort = e.target.value;
  renderItems();
});

// ── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
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
  return isNaN(n) ? null : n;
}
function formatPrice(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
}
function activityIcon(type) {
  return ({
    salvo: '+', atualizada: '↻', queda_preco: '↓', preco_atualizado: '↕',
    favorita: '♥', prioridade: '★', removida: '×', loja: '⌂'
  })[type] || '•';
}
function activityTitle(type) {
  return ({
    salvo: 'Peça salva na coleção', atualizada: 'Peça atualizada', queda_preco: 'Preço caiu',
    preco_atualizado: 'Preço atualizado', favorita: 'Favorito alterado', prioridade: 'Prioridade alterada',
    removida: 'Peça removida', loja: 'Loja adicionada'
  })[type] || 'Atividade registrada';
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
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
async function logActivity(entry) {
  try {
    const activities = await getActivities();
    activities.unshift({ at: Date.now(), ...entry });
    await setActivities(activities.slice(0, 80));
  } catch (e) {}
}
function getTags(item) {
  if (Array.isArray(item.tags)) return item.tags.filter(Boolean);
  return String(item.tags || '').split(',').map(t => t.trim()).filter(Boolean);
}
function foldText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function inferItemCategory(name = '', url = '') {
  const text = foldText(`${name} ${url}`);
  const rules = [
    ['Tenis', /\b(tenis|sneaker|sapatenis|runner|running)\b/],
    ['Sapato', /\b(sapato|loafer|mocassim|bota|sandalia|chinelo|rasteira|salto)\b/],
    ['Calca', /\b(calca|jeans|pantalona|legging|cargo|alfaiataria)\b/],
    ['Short', /\b(short|bermuda|shorts)\b/],
    ['Camisa', /\b(camisa|camiseta|t-shirt|tee|polo|regata|top|blusa|body|cropped)\b/],
    ['Jaqueta', /\b(jaqueta|casaco|blazer|cardigan|moletom|sweater|tricot|parka)\b/],
    ['Vestido', /\b(vestido|dress)\b/],
    ['Saia', /\b(saia|skirt)\b/],
    ['Bolsa', /\b(bolsa|bag|mochila|clutch|tote)\b/],
    ['Acessorio', /\b(acessorio|oculos|relogio|cinto|bone|chapeu|gorro|touca|strapback|snapback|dad\s*hat|aba\s*curva|brinco|colar|pulseira|anel|meia)\b/]
  ];
  const found = rules.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : 'Outro';
}
function priceHistory(item) {
  return Array.isArray(item.priceHistory) ? item.priceHistory : [];
}
function itemDeletionKeys(item) {
  return [item?.url, item?.savedAt, item?.id, item?.name].map(value => String(value || '')).filter(Boolean);
}
async function rememberDeletedItem(item) {
  const deletedKeys = await getDeletedItemKeys();
  const nextKeys = Array.from(new Set([...deletedKeys, ...itemDeletionKeys(item)])).slice(-400);
  await setDeletedItemKeys(nextKeys);
}
async function forgetDeletedItemKeys(keys) {
  const remove = new Set(keys.map(value => String(value || '')).filter(Boolean));
  if (!remove.size) return;
  const deletedKeys = await getDeletedItemKeys();
  await setDeletedItemKeys(deletedKeys.filter(key => !remove.has(String(key))));
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
function normalizePriorityLevel(value) {
  if (value === 'alta' || value === 'media' || value === 'baixa') return value;
  if (value === 'avaliando') return 'media';
  if (value === 'inspiracional') return 'baixa';
  return '';
}
function getPriorityLevel(item) {
  const normalized = normalizePriorityLevel(item.curationPriority);
  if (normalized) return normalized;
  if (item.buyThisMonth) return 'alta';
  if (item.priority === 'quero muito') return 'alta';
  if (item.priority === 'talvez') return 'baixa';
  return 'media';
}
function getPriorityLabel(item) {
  const level = getPriorityLevel(item);
  if (level === 'alta') return 'Prioridade Alta';
  if (level === 'baixa') return 'Prioridade Baixa';
  return 'Prioridade Média';
}
function getNextPriority(level) {
  if (level === 'alta') return 'media';
  if (level === 'media') return 'baixa';
  return 'alta';
}
function hasPriceDrop(item) {
  const current = trustedCurrentPrice(item).value;
  const high = getHighestPrice(item);
  return current !== null && high !== null && current < high * 0.97;
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
function priceMemoryHtml(low, high) {
  if (low === null || high === null || low === high) return '';
  return `<div class="price-history-line">Menor ${formatPrice(low)} · Maior ${formatPrice(high)}</div>`;
}
function emptyStateHtml(title, message) {
  return `<div class="empty-state styled-empty">
    <div class="empty-preview-card"><span></span><strong></strong><em></em></div>
    <p>${escapeHtml(title)}</p>
    <small>${escapeHtml(message)}</small>
  </div>`;
}
function isRecentlySaved(item) {
  const savedAt = Number(item.savedAt || item.updatedAt || 0);
  return savedAt && Date.now() - savedAt <= 7 * 24 * 60 * 60 * 1000;
}
function getCurationScore(item, allItems = []) {
  const priority = getPriorityLevel(item);
  const price = trustedCurrentPrice(item).value || 0;
  const prices = allItems.map(i => trustedCurrentPrice(i).value).filter(n => n !== null).sort((a, b) => a - b);
  const premiumCut = prices.length ? prices[Math.max(0, Math.floor(prices.length * 0.75) - 1)] : 0;
  let score = 0;
  if (item.favorite) score += 50;
  if (priority === 'alta') score += 30;
  else if (priority === 'media') score += 15;
  if (hasPriceDrop(item)) score += 15;
  if (isRecentlySaved(item)) score += 10;
  if (price && premiumCut && price >= premiumCut) score += 20;
  return score;
}
function pickCurrentCuration(items) {
  return [...items].sort((a, b) => {
      const diff = getCurationScore(b, items) - getCurationScore(a, items);
      if (diff) return diff;
      return (b.savedAt || 0) - (a.savedAt || 0);
    })[0] || items[0];
}
function sortItems(items) {
  const priority = { 'alta': 0, 'media': 1, 'baixa': 2, 'avaliando': 1, 'inspiracional': 2, 'quero muito': 0, 'normal': 1, 'talvez': 2, '': 3 };
  return [...items].sort((a, b) => {
    if (activeSort === 'date') return (b.savedAt || 0) - (a.savedAt || 0);
    if (activeSort === 'price') return (parsePrice(a.price) || 0) - (parsePrice(b.price) || 0);
    if (activeSort === 'store') return (a.store || '').localeCompare(b.store || '');
    if (activeSort === 'priority') return (priority[getPriorityLevel(a)] ?? 1) - (priority[getPriorityLevel(b)] ?? 1);
    if (activeSort === 'favorite') return Number(!!b.favorite) - Number(!!a.favorite);
    return 0;
  });
}

// ── Captura da página ──────────────────────────────────────────────────────
function productValidationMessage(reason) {
  const messages = {
    blocked_page: 'O StashWear fica inativo em paginas de video, redes sociais, ferramentas internas e checkout.',
    not_fashion: 'Esta pagina nao parece ser de uma peca ou acessorio de moda.',
    listing_or_multiple_products: 'Esta pagina mostra varios produtos. Abra a pagina individual da peca para salvar.',
    landing_or_category: 'Esta parece ser uma pagina inicial, categoria, busca ou promocao. Abra a pagina individual da peca para salvar.',
    low_confidence: 'Encontrei poucos sinais confiaveis de produto nesta pagina. Abra a pagina individual da peca.',
    missing_price: 'Nao encontrei o preco da peca nesta pagina. Abra a pagina individual do produto ou confira se o preco carregou.',
    missing_image: 'Nao encontrei uma imagem principal da peca. Abra a pagina individual do produto e tente novamente.',
    missing_name: 'Nao encontrei o nome da peca nesta pagina.',
    missing_product_signal: 'Nao encontrei sinais de produto, como botao de compra, SKU ou dados de produto na pagina.'
  };
  return messages[reason] || 'Esta pagina nao parece ser uma pagina de produto. Abra a pagina individual da peca para salvar.';
}

let validationNoticeTimer = null;
function showValidationNotice(message) {
  const notice = document.getElementById('validation-notice');
  const messageEl = document.getElementById('validation-message');
  if (!notice || !messageEl) return;
  messageEl.textContent = message;
  notice.style.display = 'grid';
  notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  clearTimeout(validationNoticeTimer);
  validationNoticeTimer = setTimeout(() => {
    notice.style.display = 'none';
  }, 6500);
}

function hideValidationNotice() {
  const notice = document.getElementById('validation-notice');
  if (!notice) return;
  clearTimeout(validationNoticeTimer);
  notice.style.display = 'none';
}

async function scrapeWithSharedDetector(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['stashwear-scraper.js']
  });
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.StashWearScraper().scrapeProduct()
  });
  return injected?.[0]?.result || {};
}

function normalizeDetectedData(tab, data = {}) {
  const rawName = data.name || tab?.title || '';
  const name = rawName ? cleanDisplayName(rawName) : rawName;
  const rawPrice = data.price || '';
  const embeddedPrice = embeddedPriceFromName({ name: rawName });
  const rawPriceValue = parsePrice(rawPrice);
  const price = embeddedPrice !== null && (rawPriceValue === null || rawPriceValue < 10 || embeddedPrice / Math.max(rawPriceValue, 0.01) > 10)
    ? formatPrice(embeddedPrice)
    : rawPrice;
  return {
    ...data,
    name: name || data.name || tab?.title || null,
    price,
    saleInfo: data.saleInfo ? { ...data.saleInfo, currentPrice: price || data.saleInfo.currentPrice || null } : data.saleInfo
  };
}

function detectionScore(data = {}) {
  if (!data || typeof data !== 'object') return -1;
  return Number(data.confidenceScore || 0)
    + (data.isProductPage ? 8 : 0)
    + (data.isFashion ? 5 : 0)
    + (data.name ? 1 : 0)
    + (data.price ? 1 : 0)
    + (data.imageUrl ? 1 : 0)
    - (data.validationReason && data.validationReason !== 'ok' ? 2 : 0);
}

function chooseDetectedData(primary = {}, fallback = {}) {
  if (fallback?.isProductPage && fallback?.isFashion && !(primary?.isProductPage && primary?.isFashion)) return fallback;
  if (primary?.isProductPage && primary?.isFashion && !(fallback?.isProductPage && fallback?.isFashion)) return primary;
  return detectionScore(fallback) > detectionScore(primary) ? fallback : primary;
}

function shouldRetryDetection(data = {}) {
  return !data?.isProductPage || ['missing_price', 'missing_image', 'low_confidence'].includes(data.validationReason);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) return { tab, data: { name: tab?.title || null, price: null, imageUrl: null, isProductPage: false } };
    let responseData = null;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProduct' });
      if (response && (response.imageUrl || response.price || response.name || response.validationReason)) responseData = response;
    } catch (e) {}
    if (responseData?.isProductPage && responseData?.isFashion && responseData.validationReason !== 'low_confidence') {
      return { tab, data: normalizeDetectedData(tab, responseData) };
    }
    const injectedData = await scrapeWithSharedDetector(tab.id);
    let selectedData = chooseDetectedData(responseData || {}, injectedData || {});
    if (shouldRetryDetection(selectedData)) {
      await wait(450);
      const retryData = await scrapeWithSharedDetector(tab.id);
      selectedData = chooseDetectedData(selectedData || {}, retryData || {});
    }
    return { tab, data: normalizeDetectedData(tab, selectedData) };
  } catch (e) {
    return { tab: null, data: {} };
  }
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function renderSavePreview(tab, data = {}) {
  const currentUrl = tab?.url || '';
  const domain = extractDomain(currentUrl);
  const storeName = domainToName(domain) || 'Loja automatica';
  const category = data.category || inferItemCategory(data.name || tab?.title || '', currentUrl);
  const name = data.name || tab?.title || 'Peca detectada';
  const price = data.price || '';
  const saleText = data.saleInfo?.onSale ? ` · ${saleBadgeText(data)}` : '';

  setFieldValue('item-name', name);
  setFieldValue('item-price', price);
  setFieldValue('item-category', category);
  setFieldValue('item-store', storeName);
  setFieldValue('item-priority', 'casual');

  const nameEl = document.getElementById('preview-name');
  const priceEl = document.getElementById('preview-price');
  const storeEl = document.getElementById('preview-store');
  const categoryEl = document.getElementById('preview-category');
  const thumb = document.querySelector('#auto-detect-preview .preview-thumb');
  if (nameEl) nameEl.textContent = name;
  if (priceEl) priceEl.textContent = price ? `${price}${saleText}` : 'Sem preco detectado';
  if (storeEl) storeEl.textContent = storeName;
  if (categoryEl) categoryEl.textContent = category;
  if (thumb) {
    thumb.innerHTML = data.imageUrl ? `<img src="${escapeHtml(data.imageUrl)}" alt="">` : '<div class="thumb-placeholder">◇</div>';
  }
}

// ── Filtros ────────────────────────────────────────────────────────────────
async function renderFilterBar() {
  const items = await getItems();
  const bar = document.getElementById('filter-bar');
  const counts = {};
  items.forEach(i => { const c = i.category || 'Outro'; counts[c] = (counts[c] || 0) + 1; });
  const categories = ['Todos', 'Favoritas', 'Em sale', 'Com queda', ...Object.keys(counts)];
  bar.innerHTML = '';
  bar.style.display = items.length ? 'flex' : 'none';
  categories.forEach(cat => {
    let count = cat === 'Todos' ? items.length : cat === 'Favoritas' ? items.filter(i => i.favorite).length : cat === 'Em sale' ? items.filter(isOnSale).length : cat === 'Com queda' ? items.filter(hasPriceDrop).length : counts[cat];
    if (!count && cat !== 'Todos') return;
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (cat === activeFilter ? ' active' : '');
    chip.innerHTML = `${cat} <span class="chip-count">(${count})</span>`;
    chip.addEventListener('click', () => { activeFilter = cat; renderFilterBar(); renderItems(); });
    bar.appendChild(chip);
  });
}

async function renderToolbar(visibleItems) {
  const toolbar = document.getElementById('toolbar');
  const totalBox = document.getElementById('total-box');
  const allItems = await getItems();
  if (allItems.length === 0) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = 'flex';
  const pending = visibleItems;
  const prices = pending.map(i => trustedCurrentPrice(i).value).filter(n => n !== null);
  if (prices.length > 0) {
    const total = prices.reduce((a, b) => a + b, 0);
    totalBox.innerHTML = `${prices.length} peça${prices.length > 1 ? 's' : ''} · total <strong>${formatPrice(total)}</strong>`;
  } else totalBox.innerHTML = `${pending.length} peça${pending.length !== 1 ? 's' : ''} para comprar`;

  const alertEl = document.getElementById('stash-alert');
  const reached = allItems.filter(item => hasPriceDrop(item) || isOnSale(item));
  if (reached.length) {
    alertEl.style.display = 'block';
    alertEl.textContent = `Oportunidade: ${reached.length} peça${reached.length > 1 ? 's estão' : ' está'} em sale ou com preço menor.`;
  } else {
    alertEl.style.display = 'none';
  }
}

function topEntries(items, key, limit = 4) {
  const map = {};
  items.forEach(i => { const value = (i[key] || '').trim() || 'Sem informação'; map[value] = (map[value] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit);
}
function topTags(items, limit = 8) {
  const map = {};
  items.forEach(i => getTags(i).forEach(t => map[t] = (map[t] || 0) + 1));
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0, limit);
}

async function renderFeaturedPiece() {
  const box = document.getElementById('featured-piece');
  if (!box) return;
  const items = await getItems();
  const featured = pickCurrentCuration(items);
  if (!featured) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const low = getLowestPrice(featured);
  const high = getHighestPrice(featured);
  const trusted = trustedCurrentPrice(featured);
  const displayName = cleanDisplayName(featured.name);
  const score = getCurationScore(featured, items);
  const reasons = [];
  if (featured.favorite) reasons.push('favorita');
  if (getPriorityLevel(featured) === 'alta') reasons.push('prioridade alta');
  if (isOnSale(featured)) reasons.push('em sale');
  if (hasPriceDrop(featured)) reasons.push('preço caiu');
  if (isRecentlySaved(featured)) reasons.push('salva recentemente');
  const reasonText = reasons.length ? reasons.join(' · ') : 'melhor equilíbrio da coleção';
  box.style.display = 'block';
  box.innerHTML = `
    <div class="featured-inner">
      <div class="featured-image">${featured.imageUrl ? `<img src="${escapeHtml(featured.imageUrl)}" alt="" onerror="this.parentElement.style.display='none'"/>` : ''}</div>
      <div class="featured-copy">
        <div>
          <span class="eyebrow">Curadoria Atual</span>
          <h3>${escapeHtml(displayName)}</h3>
          <div class="featured-meta">
            ${featured.store ? `<span>${escapeHtml(featured.store)}</span>` : ''}
            ${trusted.text ? `<span>${escapeHtml(trusted.text)}</span>` : ''}
            <span>${getPriorityLabel(featured)}</span>
            ${featured.favorite ? `<span>Favorita</span>` : ''}
            ${isOnSale(featured) ? `<span>${escapeHtml(saleBadgeText(featured))}</span>` : ''}
            ${hasPriceDrop(featured) ? `<span>Preço caiu</span>` : ''}
          </div>
          <small class="price-range">Pontuação ${score} · ${escapeHtml(reasonText)}</small>
          ${low !== null && high !== null && low !== high ? `<small class="price-range">Menor ${formatPrice(low)} · Maior ${formatPrice(high)}</small>` : ''}
        </div>
        ${featured.url ? `<a class="btn-open" href="${escapeHtml(featured.url)}" target="_blank">Abrir peça ↗</a>` : ''}
      </div>
    </div>`;
}


async function renderTimeline() {
  const wrap = document.getElementById('timeline-list');
  if (!wrap) return;
  const items = await getItems();
  const activities = await getActivities();
  const fallback = items
    .filter(i => i.savedAt)
    .slice(0, 8)
    .map(i => ({
      type: 'salvo',
      at: i.savedAt,
      itemName: i.name || 'Peça sem nome',
      detail: i.price ? `Salva por ${i.price}` : 'Adicionada à coleção',
      url: i.url,
      imageUrl: i.imageUrl
    }));
  const timeline = (activities.length ? activities : fallback)
    .filter(Boolean)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 12);

  if (!timeline.length) {
    wrap.innerHTML = `<div class="empty-state"><p>Nenhuma atividade ainda.</p><small>Salve, favorite ou altere prioridades para criar sua timeline.</small></div>`;
    return;
  }

  wrap.innerHTML = timeline.map(a => `
    <article class="timeline-item">
      <div class="timeline-icon">${activityIcon(a.type)}</div>
      <div class="timeline-body">
        <div class="timeline-top"><strong>${escapeHtml(activityTitle(a.type))}</strong><span>${activityDateLabel(a.at)}</span></div>
        <p>${escapeHtml(a.itemName || a.storeName || 'StashWear')}</p>
        ${a.detail ? `<small>${escapeHtml(a.detail)}</small>` : ''}
      </div>
    </article>
  `).join('');
}

async function renderCollectionIntelligence() {
  const items = await getItems();
  renderTimeline();
  const grid = document.getElementById('analysis-grid');
  const tagsGrid = document.getElementById('tags-grid');
  if (!grid || !tagsGrid) return;
  const pending = items;
  const prices = pending.map(i => parsePrice(i.price)).filter(n => n !== null);
  const total = prices.reduce((a, b) => a + b, 0);
  const avg = prices.length ? total / prices.length : 0;
  const favCategory = topEntries(items, 'category', 1)[0];
  const brands = topEntries(items, 'store', 5);
  const dropCount = items.filter(item => hasPriceDrop(item) || isOnSale(item)).length;
  const priorityCount = items.filter(i => getPriorityLevel(i) !== 'baixa').length;
  const highPriorityCount = items.filter(i => getPriorityLevel(i) === 'alta').length;
  const favoriteCount = items.filter(i => i.favorite).length;
  const historyCount = items.reduce((acc, i) => acc + priceHistory(i).length, 0);

  grid.innerHTML = `
    <article class="analysis-card"><span>Valor da coleção</span><strong>${prices.length ? formatPrice(total) : '—'}</strong><small>${pending.length} peça${pending.length !== 1 ? 's' : ''} ativa${pending.length !== 1 ? 's' : ''}.</small></article>
    <article class="analysis-card"><span>Média por peça</span><strong>${avg ? formatPrice(avg) : '—'}</strong><small>Preço médio das peças capturadas.</small></article>
    <article class="analysis-card"><span>Promoções</span><strong>${dropCount}</strong><small>${dropCount ? 'Há peça em sale ou mais barata que antes.' : 'Nenhuma promoção registrada agora.'}</small></article>
    <article class="analysis-card"><span>Prioridades</span><strong>${priorityCount}</strong><small>${highPriorityCount} em prioridade alta.</small></article>
    <article class="analysis-card"><span>Favoritas</span><strong>${favoriteCount}</strong><small>Peças destacadas na coleção.</small></article>
    <article class="analysis-card"><span>Histórico de preço</span><strong>${historyCount}</strong><small>Registros salvos ao atualizar peças já existentes.</small></article>
    <article class="analysis-card"><span>Categoria favorita</span><strong>${favCategory ? escapeHtml(favCategory[0]) : '—'}</strong><small>${favCategory ? `${favCategory[1]} item${favCategory[1] > 1 ? 's' : ''} nessa categoria.` : 'Classifique suas peças.'}</small></article>
    <article class="analysis-card" style="grid-column:1/-1"><span>Marcas / Lojas</span><div class="brand-list">${brands.length ? brands.map(([name,count]) => `<div class="brand-row"><b>${escapeHtml(name)}</b><em>${count}</em></div>`).join('') : '<small>Nenhuma loja identificada ainda.</small>'}</div></article>`;

  const tags = topTags(items);
  tagsGrid.innerHTML = tags.length ? tags.map(([tag,count]) => `<span class="tag-pill">${escapeHtml(tag)} <b>${count}</b></span>`).join('') : `<div class="empty-state"><p>Nenhuma etiqueta ainda.</p><small>Use etiquetas como trabalho, verão, casual ou festa.</small></div>`;
}

function itemCardHtml(item, realIndex, compact = false) {
  const priority = item.priority || 'normal';
  const priorityLevel = getPriorityLevel(item);
  const tags = getTags(item);
  const displayName = cleanDisplayName(item.name);
  const low = getLowestPrice(item);
  const high = getHighestPrice(item);
  const priceDropped = hasPriceDrop(item);
  const onSale = isOnSale(item);
  return `
    <div class="card-inner">
      <div class="item-thumb">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>` : ''}
        <div class="thumb-placeholder" style="${item.imageUrl ? 'display:none' : ''}">◇</div>
        ${onSale ? `<span class="sale-badge">${escapeHtml(saleBadgeText(item))}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="item-top">
          <div class="title-line"><span class="item-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span><button class="btn-fav ${item.favorite ? 'active' : ''}" data-index="${realIndex}" title="Favoritar">${item.favorite ? '♥' : '♡'}</button></div>
          <div class="item-badges">
            <span class="badge badge-light">${getPriorityLabel(item)}</span>
            ${item.category ? `<span class="badge">${escapeHtml(item.category)}</span>` : ''}
            ${onSale ? `<span class="badge badge-sale">${escapeHtml(saleBadgeText(item))}</span>` : ''}
            ${priceDropped ? `<span class="badge badge-alert">Preço caiu</span>` : ''}
          </div>
        </div>
        <div class="item-meta">${item.store ? `<span class="item-store-tag">${escapeHtml(item.store)}</span>` : ''}${priceDisplayHtml(item)}</div>
        ${priceMemoryHtml(low, high)}
        ${tags.length ? `<div class="tag-list">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${!compact && item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
        <div class="item-actions">
          <a class="btn-open" href="${escapeHtml(item.url)}" target="_blank">Abrir ↗</a>
          <button class="btn-buy-month ${priorityLevel !== 'baixa' ? 'active' : ''}" data-index="${realIndex}">${getPriorityLabel(item)}</button>
          <button class="btn-delete" data-index="${realIndex}">Remover</button>
        </div>
      </div>
    </div>`;
}

function bindItemActions(root) {
  root.querySelectorAll('.btn-fav').forEach(btn => btn.addEventListener('click', async () => {
    const all = await getItems();
    const item = all[parseInt(btn.dataset.index)];
    if (item) {
      item.favorite = !item.favorite;
      await logActivity({ type: 'favorita', itemName: item.name, detail: item.favorite ? 'Adicionada aos favoritos' : 'Removida dos favoritos', url: item.url, imageUrl: item.imageUrl });
    }
    await setItems(all); refreshAll();
  }));
  root.querySelectorAll('.btn-buy-month').forEach(btn => btn.addEventListener('click', async () => {
    const all = await getItems();
    const item = all[parseInt(btn.dataset.index)];
    if (item) {
      const next = getNextPriority(getPriorityLevel(item));
      item.curationPriority = next;
      item.buyThisMonth = next !== 'baixa';
      await logActivity({ type: 'prioridade', itemName: item.name, detail: getPriorityLabel(item), url: item.url, imageUrl: item.imageUrl });
    }
    await setItems(all); refreshAll();
  }));
  root.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', async () => {
    const all = await getItems();
    const removed = all[parseInt(btn.dataset.index)];
    if (removed) await logActivity({ type: 'removida', itemName: removed.name, detail: 'Removida da coleção' });
    if (removed) await rememberDeletedItem(removed);
    all.splice(parseInt(btn.dataset.index), 1);
    await setItems(all); activeFilter = 'Todos'; refreshAll();
  }));
}

async function renderItems() {
  let items = await getItems();
  const list = document.getElementById('items-list');
  const allItems = items;
  if (activeFilter === 'Favoritas') items = items.filter(i => i.favorite);
  else if (activeFilter === 'Em sale') items = items.filter(isOnSale);
  else if (activeFilter === 'Com queda') items = items.filter(hasPriceDrop);
  else if (activeFilter !== 'Todos') items = items.filter(i => (i.category || 'Outro') === activeFilter);
  items = sortItems(items);
  await renderToolbar(items);
  renderFeaturedPiece();
  renderCollectionIntelligence();
  renderShoppingList();

  if (items.length === 0) {
    list.innerHTML = activeFilter === 'Todos'
      ? emptyStateHtml('Nenhuma peça salva ainda.', 'Entre em uma loja e clique em "Salvar peça atual".')
      : emptyStateHtml(`Nenhuma peça em "${activeFilter}".`, 'Tente outro filtro.');
    return;
  }
  list.innerHTML = '';
  items.forEach(item => {
    const realIndex = allItems.findIndex(i => i.savedAt === item.savedAt || i.url === item.url && i.name === item.name);
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = itemCardHtml(item, realIndex);
    list.appendChild(card);
  });
  bindItemActions(list);
}

async function renderPriorityFilterBar(allItems) {
  const bar = document.getElementById('priority-filter-bar');
  if (!bar) return;
  const activeItems = allItems;
  const options = [
    { key: 'todos', label: 'Todas', count: activeItems.length },
    { key: 'alta', label: 'Alta', count: activeItems.filter(i => getPriorityLevel(i) === 'alta').length },
    { key: 'media', label: 'Média', count: activeItems.filter(i => getPriorityLevel(i) === 'media').length },
    { key: 'baixa', label: 'Baixa', count: activeItems.filter(i => getPriorityLevel(i) === 'baixa').length }
  ];
  bar.innerHTML = options.map(opt => `
    <button class="priority-filter-chip ${activePriorityFilter === opt.key ? 'active' : ''}" data-filter="${opt.key}">
      ${opt.label} <span>${opt.count}</span>
    </button>`).join('');
  bar.querySelectorAll('.priority-filter-chip').forEach(btn => btn.addEventListener('click', () => {
    activePriorityFilter = btn.dataset.filter;
    renderShoppingList();
  }));
}

async function renderShoppingList() {
  const list = document.getElementById('shopping-list');
  if (!list) return;
  const allItems = await getItems();
  await renderPriorityFilterBar(allItems);
  let items = allItems
    .filter(i => activePriorityFilter === 'todos' || getPriorityLevel(i) === activePriorityFilter)
    .sort((a, b) => getCurationScore(b, allItems) - getCurationScore(a, allItems));
  if (!items.length) {
    const labels = { todos: 'prioridades', alta: 'prioridade alta', media: 'prioridade média', baixa: 'prioridade baixa' };
    list.innerHTML = emptyStateHtml(`Nenhuma peça em ${labels[activePriorityFilter]}.`, 'Altere a prioridade da peça ao salvar ou pelo botão dentro do card.');
    return;
  }
  list.innerHTML = '';
  items.forEach(item => {
    const realIndex = allItems.findIndex(i => i.savedAt === item.savedAt);
    const card = document.createElement('div');
    card.className = 'item-card shopping-card';
    card.innerHTML = itemCardHtml(item, realIndex, true);
    list.appendChild(card);
  });
  bindItemActions(list);
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
function domainToName(domain) {
  if (!domain) return '';
  const part = domain.split('.').find(p => !['www','shop','loja','store'].includes(p)) || domain.split('.')[0];
  return part.charAt(0).toUpperCase() + part.slice(1);
}
async function autoSaveStore(pageUrl) {
  const domain = extractDomain(pageUrl);
  if (!domain) return;
  const stores = await getStores();
  const alreadySaved = stores.some(s => extractDomain(s.url) === domain);
  if (alreadySaved) return;
  const { protocol, hostname } = new URL(pageUrl);
  stores.push({ name: domainToName(domain), url: `${protocol}//${hostname}`, autoSaved: true });
  await setStores(stores);
  await logActivity({ type: 'loja', storeName: domainToName(domain), detail: 'Loja salva automaticamente' });
  renderStores();
}

async function refreshAll() {
  await renderFilterBar();
  await renderItems();
  await renderStores();
}

document.getElementById('btn-save-item').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-item');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const { tab, data } = await scrapeCurrentPage();
    const currentUrl = tab?.url || '';
    if (!data?.isProductPage || !data?.isFashion) {
      btn.textContent = 'Pagina nao reconhecida';
      showValidationNotice(productValidationMessage(!data?.isProductPage ? data?.validationReason : 'not_fashion'));
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
      return;
    }
    const typedName = document.getElementById('item-name').value.trim();
    const typedPrice = document.getElementById('item-price').value.trim();
    const rawName = typedName || data?.name || tab?.title || 'Peça sem nome';
    const name = cleanDisplayName(rawName);
    const rawPrice = typedPrice || data?.price || '';
    const embeddedPrice = embeddedPriceFromName({ name: rawName });
    const rawPriceValue = parsePrice(rawPrice);
    const price = !typedPrice && embeddedPrice !== null && (rawPriceValue === null || rawPriceValue < 10 || embeddedPrice / Math.max(rawPriceValue, 0.01) > 10)
      ? formatPrice(embeddedPrice)
      : rawPrice;
    const imageUrl = data?.imageUrl || null;
    const saleInfo = data?.saleInfo || { onSale: false };
    const selectedStore = document.getElementById('item-store').value;
    const domain = extractDomain(currentUrl);
    const storeName = selectedStore || domainToName(domain) || '';
    const detectedCategory = document.getElementById('item-category').value || data?.category || inferItemCategory(name, currentUrl) || 'Outro';
    renderSavePreview(tab, { ...data, name, price, imageUrl, category: detectedCategory });
    const tags = document.getElementById('item-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    const items = await getItems();
    const existingIndex = items.findIndex(i => i.url === currentUrl && currentUrl);
    const now = Date.now();

    if (existingIndex >= 0) {
      const old = items[existingIndex];
      const oldPrice = old.price || '';
      const history = priceHistory(old);
      if (price && oldPrice && parsePrice(price) !== parsePrice(oldPrice)) history.unshift({ price, checkedAt: now });
      else if (price && history.length === 0) history.unshift({ price, checkedAt: now });
      items[existingIndex] = {
        ...old,
        name,
        imageUrl: imageUrl || old.imageUrl,
        price: price || old.price,
        priceSource: data?.priceSource || old.priceSource || '',
        confidenceScore: data?.confidenceScore ?? old.confidenceScore ?? null,
        saleInfo: { ...(old.saleInfo || {}), ...saleInfo, currentPrice: price || saleInfo.currentPrice || old.price },
        store: storeName || old.store,
        category: detectedCategory || old.category,
        priority: document.getElementById('item-priority').value || old.priority,
        note: document.getElementById('item-note').value.trim() || old.note,
        tags: tags.length ? tags : getTags(old),
        curationPriority: document.getElementById('item-buy-this-month').value || getPriorityLevel(old),
        buyThisMonth: (document.getElementById('item-buy-this-month').value || getPriorityLevel(old)) !== 'baixa',
        priceHistory: history,
        updatedAt: now
      };
      items.unshift(items.splice(existingIndex, 1)[0]);
    } else {
      items.unshift({
        name, url: currentUrl, imageUrl, price, store: storeName,
        priceSource: data?.priceSource || '',
        confidenceScore: data?.confidenceScore ?? null,
        saleInfo: { ...saleInfo, currentPrice: price || saleInfo.currentPrice || null },
        category: detectedCategory,
        priority: document.getElementById('item-priority').value,
        note: document.getElementById('item-note').value.trim(),
        tags,
        favorite: false,
        curationPriority: document.getElementById('item-buy-this-month').value || 'media',
        buyThisMonth: (document.getElementById('item-buy-this-month').value || 'media') !== 'baixa',
        priceHistory: price ? [{ price, checkedAt: now }] : [],
        savedAt: now
      });
    }
    const savedItem = items[0];
    if (existingIndex >= 0) {
      const previous = parsePrice(items[0].priceHistory?.[1]?.price || '');
      const current = parsePrice(savedItem.price);
      let type = 'atualizada';
      let detail = 'Dados da peça atualizados';
      if (previous !== null && current !== null && current < previous) {
        type = 'queda_preco';
        detail = `De ${formatPrice(previous)} para ${formatPrice(current)}`;
      } else if (savedItem.price) {
        detail = `Preço atual: ${savedItem.price}`;
      }
      await logActivity({ type, itemName: savedItem.name, detail, url: savedItem.url, imageUrl: savedItem.imageUrl });
    } else {
      await logActivity({ type: 'salvo', itemName: savedItem.name, detail: savedItem.price ? `Salva por ${savedItem.price}` : 'Adicionada à coleção', url: savedItem.url, imageUrl: savedItem.imageUrl });
    }
    await setItems(items);
    await forgetDeletedItemKeys([currentUrl, savedItem.savedAt, savedItem.id, savedItem.name]);
    if (currentUrl) await autoSaveStore(currentUrl);
    ['item-name','item-price','item-note','item-target-price','item-tags'].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });
    document.getElementById('item-buy-this-month').value = 'media';
    await refreshAll();
    btn.textContent = existingIndex >= 0 ? '✓ Peça atualizada' : (price ? '✓ Salva com preço' : '✓ Peça salva');
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1400);
  } catch (e) {
    btn.textContent = 'Erro ao salvar';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1800);
  }
});

(async () => {
  const { tab, data } = await scrapeCurrentPage();
  renderSavePreview(tab, data);
})();

async function renderStores() {
  const stores = await getStores();
  const list = document.getElementById('stores-list');
  const select = document.getElementById('item-store');
  select.innerHTML = '<option value="">— Selecionar —</option>';
  stores.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name; select.appendChild(o); });
  if (stores.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div><p>Nenhuma loja salva.</p><small>Adicione suas lojas favoritas.</small></div>`;
    return;
  }
  list.innerHTML = '';
  stores.forEach((store, index) => {
    const card = document.createElement('div');
    card.className = 'store-card';
    card.innerHTML = `<div class="store-avatar">${escapeHtml(store.name.charAt(0).toUpperCase())}</div><div class="store-info"><div class="store-name-row"><span class="store-name">${escapeHtml(store.name)}</span>${store.autoSaved ? `<span class="badge-auto">detectada</span>` : ''}</div><span class="store-url">${escapeHtml(store.url)}</span></div><div class="store-actions"><a class="btn-open" href="${escapeHtml(store.url)}" target="_blank">Abrir ↗</a><button class="btn-delete" data-index="${index}">✕</button></div>`;
    list.appendChild(card);
  });
  list.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', async () => {
    const stores = await getStores(); stores.splice(parseInt(btn.dataset.index), 1); await setStores(stores); renderStores();
  }));
}

document.getElementById('btn-save-store').addEventListener('click', async () => {
  const name = document.getElementById('store-name').value.trim();
  let url = document.getElementById('store-url').value.trim();
  if (!name || !url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  const stores = await getStores();
  stores.push({ name, url });
  await setStores(stores);
  document.getElementById('store-name').value = '';
  document.getElementById('store-url').value = '';
  renderStores();
});


const openDashboardBtn = document.getElementById('btn-open-dashboard');
if (openDashboardBtn) {
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });
}

document.getElementById('validation-close')?.addEventListener('click', hideValidationNotice);
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || 'dark');
});

refreshAll();

(async () => {
  const result = await new Promise(r => chrome.storage.local.get('onboardingDone', r));
  if (!result.onboardingDone) {
    const overlay = document.getElementById('onboarding');
    overlay.style.display = 'flex';
    document.getElementById('onboarding-close').addEventListener('click', () => {
      overlay.style.display = 'none';
      chrome.storage.local.set({ onboardingDone: true });
    });
  }
})();
