const PRICE_CHECK_ALARM = 'stashwear-price-check';
const CHECK_INTERVAL_MINUTES = 360;
const MAX_ITEMS_PER_RUN = 25;
const SYNC_DATA_KEYS = ['items', 'folders', 'stores', 'activities', 'deletedItemKeys'];
const SYNC_SESSION_KEY = 'stashwearSupabaseSession';
const SYNC_STATUS_KEY = 'stashwearSyncStatus';
const SYNC_DEBOUNCE_MS = 1800;
const SYNC_TOKEN_REFRESH_MARGIN_SECONDS = 120;

try { importScripts('supabase-config.js'); } catch {}
const SUPABASE_CONFIG = globalThis.STASHWEAR_SUPABASE || {};
let syncTimer = null;
let isAutoSyncing = false;

const getStorage = key => new Promise(resolve => chrome.storage.local.get(key, data => resolve(data[key] || [])));
const setStorage = (key, value) => new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
const getItems = () => getStorage('items');
const setItems = items => setStorage('items', items);
const getActivities = () => getStorage('activities');
const setActivities = activities => setStorage('activities', activities);
const getNotifications = () => getStorage('notifications');
const setNotifications = notifications => setStorage('notifications', notifications);

const getStorageObject = keys => new Promise(resolve => chrome.storage.local.get(keys, resolve));

async function setSyncStatus(state, detail = '') {
  await chrome.storage.local.set({
    [SYNC_STATUS_KEY]: {
      state,
      detail,
      at: Date.now()
    }
  });
}

async function getSyncSession() {
  const data = await getStorageObject(SYNC_SESSION_KEY);
  const session = data[SYNC_SESSION_KEY] || null;
  if (!session) return null;
  if (!shouldRefreshSyncSession(session)) return session;
  try {
    return await refreshSyncSession(session);
  } catch (error) {
    console.warn('StashWear refresh de sessao falhou:', error);
    if (isSyncSessionExpired(session)) {
      await chrome.storage.local.set({ [SYNC_SESSION_KEY]: null });
      return null;
    }
    return session;
  }
}

function shouldRefreshSyncSession(session) {
  const expiresAt = Number(session?.expiresAt || 0);
  const now = Math.floor(Date.now() / 1000);
  return Boolean(session?.refreshToken && expiresAt && expiresAt <= now + SYNC_TOKEN_REFRESH_MARGIN_SECONDS);
}

function isSyncSessionExpired(session) {
  const expiresAt = Number(session?.expiresAt || 0);
  return Boolean(expiresAt && expiresAt <= Math.floor(Date.now() / 1000));
}

function normalizeSyncSession(data) {
  const user = data.user || {};
  const metadata = user.user_metadata || {};
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    user: {
      id: user.id,
      email: user.email,
      displayName: metadata.display_name || metadata.name || ''
    }
  };
}

async function refreshSyncSession(session) {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) throw new Error('Supabase nao configurado.');
  const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refreshToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.msg || data.message || `Supabase Auth HTTP ${response.status}`);
  const nextSession = normalizeSyncSession(data);
  await chrome.storage.local.set({ [SYNC_SESSION_KEY]: nextSession });
  return nextSession;
}

async function getSyncDeviceId() {
  const data = await getStorageObject('stashwearDeviceId');
  if (data.stashwearDeviceId) return data.stashwearDeviceId;
  const id = `device-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  await chrome.storage.local.set({ stashwearDeviceId: id });
  return id;
}

async function collectSyncPayload() {
  const data = await getStorageObject(SYNC_DATA_KEYS);
  return SYNC_DATA_KEYS.reduce((acc, key) => {
    acc[key] = Array.isArray(data[key]) ? data[key] : [];
    return acc;
  }, {});
}

async function autoSyncToSupabase() {
  if (isAutoSyncing || !SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) return;
  const session = await getSyncSession();
  if (!session?.accessToken || !session?.user?.id) return;
  isAutoSyncing = true;
  try {
    await setSyncStatus('syncing', 'Salvando alteracoes');
    const payload = await collectSyncPayload();
    const deviceId = await getSyncDeviceId();
    const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/stashwear_snapshots?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_CONFIG.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        user_id: session.user.id,
        device_id: deviceId,
        payload,
        updated_at: new Date().toISOString()
      })
    });
    if (!response.ok) throw new Error(await response.text());
    await setSyncStatus('synced', 'Sincronizado');
  } catch (error) {
    console.warn('StashWear autosync falhou:', error);
    await setSyncStatus('error', 'Falha ao sincronizar');
  } finally {
    isAutoSyncing = false;
  }
}

function scheduleAutoSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(autoSyncToSupabase, SYNC_DEBOUNCE_MS);
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

function isSaneProductPrice(value) {
  return value !== null && Number.isFinite(value) && value > 0 && value < 50000;
}

function normalizeSaleInfo(info, price) {
  const current = parsePrice(price || info?.currentPrice);
  const original = parsePrice(info?.originalPrice);
  const percent = Number(info?.discountPercent || 0);
  const hasOriginal = isSaneProductPrice(current)
    && isSaneProductPrice(original)
    && original > current * 1.03
    && original / current <= 10
    && percent < 95;
  const discountPercent = hasOriginal
    ? Math.round(((original - current) / original) * 100)
    : (percent >= 5 && percent < 95 ? percent : null);

  return {
    ...(info || {}),
    onSale: Boolean(hasOriginal || discountPercent),
    originalPrice: hasOriginal ? formatPrice(original) : null,
    currentPrice: price || info?.currentPrice || null,
    discountPercent: discountPercent && discountPercent > 0 && discountPercent < 95 ? discountPercent : null
  };
}

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePrice(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  const match = text.match(/(?:R\$|BRL|US\$|USD|€|£)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|\d+(?:[\.,]\d{2})/i);
  if (!match) return null;
  let price = cleanText(match[0]);
  if (!/(R\$|BRL|US\$|USD|€|£)/i.test(price)) price = 'R$ ' + price;
  return price.replace(/^BRL\s*/i, 'R$ ');
}

function detectSaleInfo(price, text = '') {
  const current = parsePrice(price);
  const source = cleanText(text);
  const candidates = collectPriceCandidates(source)
    .map(candidate => ({ price: candidate, value: parsePrice(candidate) }))
    .filter(candidate => current !== null && candidate.value !== null && candidate.value > current * 1.08 && candidate.value / current <= 10 && isSaneProductPrice(candidate.value))
    .sort((a, b) => b.value - a.value);
  const original = candidates[0] || null;
  const saleWords = /\b(sale|promo|promocao|promoção|off|desconto|liquidacao|liquidação|preco\s+original|preço\s+original)\b/i.test(source);
  const percentMatch = source.match(/(\d{1,2})\s*%/);
  const discountPercent = original && current !== null
    ? Math.round(((original.value - current) / original.value) * 100)
    : (percentMatch ? Number(percentMatch[1]) : null);
  return normalizeSaleInfo({
    onSale: Boolean(saleWords || original || (discountPercent && discountPercent >= 5)),
    originalPrice: original?.price || null,
    currentPrice: price || null,
    discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null
  }, price);
}

function isLikelyAuxiliaryPriceContext(beforeText = '', afterText = '') {
  const before = cleanText(beforeText).toLowerCase();
  const after = cleanText(afterText).toLowerCase();
  return /\b(?:\d+\s*(?:x|vezes)\s*(?:de)?|x\s*de|em\s+ate\s+\d+\s*x\s*(?:de)?|em\s+até\s+\d+\s*x\s*(?:de)?|parcela|parcelas|parcelamento)\b/i.test(before)
    || /^(?:\s*(?:\/\s*mes|\/\s*mês|por\s+mes|por\s+mês))/i.test(after);
}

function collectPriceCandidates(text) {
  const source = cleanText(text);
  const pattern = /(?:R\$|BRL|US\$|USD|€|£)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|\d+(?:[\.,]\d{2})/gi;
  return collectPriceCandidateObjects(source).map(candidate => candidate.price);
}

function collectPriceCandidateObjects(text) {
  const source = cleanText(text);
  const pattern = /(?:R\$|BRL|US\$|USD|€|£)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|\d+(?:[\.,]\d{2})/gi;
  const candidates = [];
  let match;
  while ((match = pattern.exec(source))) {
    const before = source.slice(Math.max(0, match.index - 70), match.index);
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 30);
    if (isLikelyAuxiliaryPriceContext(before, after)) continue;
    const price = normalizePrice(match[0]);
    const value = parsePrice(price);
    if (price && isSaneProductPrice(value)) {
      candidates.push({
        price,
        value,
        context: `${before}${match[0]}${after}`
      });
    }
  }
  return candidates;
}

function saleContextScore(text = '') {
  const value = cleanText(text).toLowerCase();
  let score = 0;
  if (/\b(preco|preço|valor)\s+(promocional|atual|com\s+desconto|final)\b/i.test(value)) score += 4;
  if (/\b(por|agora|sale|promo|promocao|promoção|off|desconto|liquidacao|liquidação)\b/i.test(value)) score += 3;
  if (/\d{1,2}\s*%/.test(value)) score += 2;
  if (/\b(de|antes|preco\s+original|preço\s+original|valor\s+original)\b/i.test(value)) score -= 2;
  if (/\b(?:parcela|parcelas|parcelamento|sem juros|juros|frete|cashback|cupom|boleto|pix)\b/i.test(value)) score -= 4;
  return score;
}

function chooseCurrentPriceFromCandidates(candidates) {
  const valid = candidates
    .filter(candidate => candidate?.price && isSaneProductPrice(candidate.value))
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff) return scoreDiff;
      return a.value - b.value;
    });
  if (!valid.length) return null;
  const saleCandidates = valid.filter(candidate => (candidate.score || 0) > 0);
  return (saleCandidates.length ? saleCandidates : valid).sort((a, b) => a.value - b.value)[0];
}

function findOfferPrice(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const price = findOfferPrice(item);
      if (price) return price;
    }
    return null;
  }

  const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : String(value['@type'] || '');
  if (/offer|aggregateoffer|product/i.test(type)) {
    const direct = normalizePrice(value.price || value.lowPrice || value.salePrice || value.offerPrice);
    if (direct) return direct;
  }

  return findOfferPrice(value.offers || value.aggregateOffer);
}

function extractJsonLdPrice(html) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const json = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const price = findOfferPrice(JSON.parse(json));
      if (price) return price;
    } catch {}
  }
  return null;
}

function extractMercadoLivrePriceFromHtml(html) {
  if (!/mercadolivre|mercadolibre|ui-pdp-price/i.test(html || '')) return null;
  const snippets = [];
  const patterns = [
    /ui-pdp-price__second-line[\s\S]{0,1800}/gi,
    /ui-pdp-price__main-container[\s\S]{0,2600}/gi,
    /data-testid=["']price-part["'][\s\S]{0,2200}/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html || '')) && snippets.length < 6) snippets.push(match[0]);
  }

  const saleText = cleanText(snippets.join(' '));
  for (const snippet of snippets) {
    const text = cleanText(snippet);
    const candidates = collectPriceCandidateObjects(text).map(candidate => ({
      ...candidate,
      score: saleContextScore(candidate.context),
      text
    }));
    let current = chooseCurrentPriceFromCandidates(candidates);
    if (current?.value < 10) {
      const alternative = candidates
        .filter(candidate => candidate.value >= 10)
        .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      if (alternative) current = alternative;
    }
    if (current) {
      return {
        price: current.price,
        saleInfo: detectSaleInfo(current.price, saleText || text),
        priceSource: 'mercadolivre-main-price'
      };
    }
  }

  return null;
}

function readMetaContent(html, keys) {
  for (const key of keys) {
    const attr = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const after = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${attr}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html);
    if (after?.[1]) return cleanText(after[1]);
    const before = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${attr}["']`, 'i').exec(html);
    if (before?.[1]) return cleanText(before[1]);
  }
  return null;
}

function extractPriceFromHtml(html) {
  const mercadoLivrePrice = extractMercadoLivrePriceFromHtml(html);
  if (mercadoLivrePrice) return mercadoLivrePrice;

  const jsonLdPrice = extractJsonLdPrice(html);
  if (jsonLdPrice) return { price: jsonLdPrice, saleInfo: detectSaleInfo(jsonLdPrice, html.slice(0, 250000)), priceSource: 'jsonld' };

  const saleMeta = readMetaContent(html, [
    'product:sale_price:amount',
    'product:sale_price',
    'lowPrice'
  ]);
  const saleMetaPrice = normalizePrice(saleMeta);
  if (saleMetaPrice && !isLikelyAuxiliaryPriceContext(saleMeta)) {
    return { price: saleMetaPrice, saleInfo: detectSaleInfo(saleMetaPrice, html.slice(0, 250000)), priceSource: 'meta-sale' };
  }

  const meta = readMetaContent(html, [
    'product:price:amount',
    'og:price:amount',
    'twitter:data1',
    'price'
  ]);
  const metaPrice = normalizePrice(meta);
  if (metaPrice && !isLikelyAuxiliaryPriceContext(meta)) return { price: metaPrice, saleInfo: detectSaleInfo(metaPrice, meta), priceSource: 'meta' };

  const saleFocused = html.match(/(?:sale|promo|promocao|promoção|desconto|off|por|preco\s+promocional|preço\s+promocional)[\s\S]{0,900}/i)?.[0];
  const focused = saleFocused || html.match(/(?:price|preco|preço|valor)[\s\S]{0,700}/i)?.[0];
  const focusedCandidates = collectPriceCandidateObjects(focused).map(candidate => ({
    ...candidate,
    score: saleContextScore(candidate.context),
    text: focused
  }));
  const pageSlice = html.slice(0, 250000);
  const pageCandidates = collectPriceCandidateObjects(pageSlice).slice(0, 40).map(candidate => ({
    ...candidate,
    score: saleContextScore(candidate.context),
    text: pageSlice
  }));
  const current = chooseCurrentPriceFromCandidates([...focusedCandidates, ...pageCandidates]);
  return current ? { price: current.price, saleInfo: detectSaleInfo(current.price, current.text || pageSlice), priceSource: focused ? 'focused' : 'html' } : null;
}

async function logActivity(entry) {
  const activities = await getActivities();
  activities.unshift({ at: Date.now(), ...entry });
  await setActivities(activities.slice(0, 120));
}

async function addPriceDropNotification(item, previousPrice, nextPrice) {
  const notifications = await getNotifications();
  notifications.unshift({
    id: `price-drop-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: 'price_drop',
    itemName: item.name || 'Peça salva',
    previousPrice,
    currentPrice: nextPrice,
    url: item.url,
    imageUrl: item.imageUrl,
    read: false,
    createdAt: Date.now()
  });
  await setNotifications(notifications.slice(0, 80));
}

async function addSaleEndedNotification(item, previousPrice, nextPrice, originalPrice = null) {
  const notifications = await getNotifications();
  notifications.unshift({
    id: `sale-ended-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: 'sale_ended',
    itemName: item.name || 'Peça salva',
    previousPrice,
    currentPrice: nextPrice,
    originalPrice: originalPrice || item.saleInfo?.originalPrice || nextPrice || null,
    url: item.url,
    imageUrl: item.imageUrl,
    read: false,
    createdAt: Date.now()
  });
  await setNotifications(notifications.slice(0, 80));
}

async function notifyPriceDrop(item, previousPrice, nextPrice) {
  if (!chrome.notifications?.create) return;
  await chrome.notifications.create(`stashwear-price-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Preço caiu no StashWear',
    message: `${item.name || 'Uma peça salva'} caiu de ${previousPrice} para ${nextPrice}.`
  });
}

async function notifySaleEnded(item, previousPrice, nextPrice) {
  if (!chrome.notifications?.create) return;
  await chrome.notifications.create(`stashwear-sale-ended-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Promoção encerrada no StashWear',
    message: `${item.name || 'Uma peça salva'} saiu da promoção${previousPrice && nextPrice ? `: ${previousPrice} → ${nextPrice}` : '.'}`
  });
}

async function fetchCurrentPrice(url) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return extractPriceFromHtml(html);
}

function findPreviousReliablePrice(item, currentValue) {
  const history = Array.isArray(item.priceHistory) ? item.priceHistory : [];
  return history
    .map(entry => ({ entry, value: parsePrice(entry?.price) }))
    .find(({ value }) => value !== null && value > currentValue * 1.8)?.entry?.price || null;
}

function isSuspiciousStoredAutoDrop(item) {
  const currentValue = parsePrice(item.price);
  if (currentValue === null) return false;
  const previousPrice = findPreviousReliablePrice(item, currentValue);
  if (!previousPrice) return false;
  const latestHistory = Array.isArray(item.priceHistory) ? item.priceHistory[0] : null;
  const wasAutoUpdated = latestHistory?.source === 'auto' || item.priceDropNotifiedPrice === item.price;
  return wasAutoUpdated && currentValue < parsePrice(previousPrice) * 0.55;
}

function isReliableAutomaticPriceChange(previousPrice, nextPriceValue, priceResult = null) {
  const previousValue = parsePrice(previousPrice);
  const nextValue = parsePrice(nextPriceValue);
  if (previousValue === null || nextValue === null) return true;
  if (nextValue >= previousValue) return true;

  const dropRatio = nextValue / previousValue;
  if (dropRatio >= 0.55) return true;

  const source = String(priceResult?.priceSource || '');
  const saleInfo = priceResult?.saleInfo || {};
  const originalValue = parsePrice(saleInfo.originalPrice);
  const hasTrustedSaleContext = source === 'mercadolivre-main-price'
    && saleInfo.onSale
    && originalValue !== null
    && Math.abs(originalValue - previousValue) <= Math.max(1, previousValue * 0.03)
    && Number(saleInfo.discountPercent || 0) <= 80;

  return hasTrustedSaleContext;
}

async function repairSuspiciousStoredPrices() {
  const items = await getItems();
  if (!Array.isArray(items) || !items.length) return;
  let changed = false;

  for (const item of items) {
    if (!isSuspiciousStoredAutoDrop(item)) continue;
    const wrongPrice = item.price;
    const previousPrice = findPreviousReliablePrice(item, parsePrice(wrongPrice));
    if (!previousPrice) continue;

    item.priceHistory = Array.isArray(item.priceHistory) ? item.priceHistory : [];
    item.priceHistory.unshift({
      price: wrongPrice,
      checkedAt: Date.now(),
      source: 'auto_ignored',
      note: 'Queda automatica suspeita revertida'
    });
    item.priceHistory = item.priceHistory.slice(0, 40);
    item.price = previousPrice;
    item.priceDropNotifiedPrice = '';
    item.priceCheckError = 'Preco automatico suspeito revertido; sera conferido novamente.';
    item.updatedAt = Date.now();
    changed = true;
  }

  if (changed) await setItems(items);
}

async function checkSavedPrices() {
  await repairSuspiciousStoredPrices();
  const items = await getItems();
  if (!Array.isArray(items) || !items.length) return;

  let changed = false;
  const candidates = items
    .filter(item => item?.url && /^https?:\/\//i.test(item.url) && parsePrice(item.price) !== null)
    .sort((a, b) => Number(a.priceCheckedAt || 0) - Number(b.priceCheckedAt || 0))
    .slice(0, MAX_ITEMS_PER_RUN);

  for (const item of candidates) {
    const previousPrice = item.price;
    try {
      const nextPrice = await fetchCurrentPrice(item.url);
      const nextPriceValue = typeof nextPrice === 'string' ? nextPrice : nextPrice?.price;
      const previousSaleInfo = item.saleInfo || {};
      const wasOnSale = Boolean(previousSaleInfo.onSale);
      item.priceCheckedAt = Date.now();
      item.priceCheckError = '';
      if (nextPriceValue && parsePrice(nextPriceValue) !== null) {
        const priceChanged = parsePrice(nextPriceValue) !== parsePrice(previousPrice);
        const nextSaleInfo = { ...(item.saleInfo || {}), ...(nextPrice?.saleInfo || {}), currentPrice: nextPriceValue };
        const nextPriceSource = nextPrice?.priceSource || item.priceSource || '';
        let priceDropped = false;
        if (priceChanged) {
          if (!isReliableAutomaticPriceChange(previousPrice, nextPriceValue, nextPrice)) {
            item.priceCheckError = `Preco automatico suspeito ignorado: ${previousPrice} -> ${nextPriceValue}`;
            item.priceHistory = Array.isArray(item.priceHistory) ? item.priceHistory : [];
            item.priceHistory.unshift({ price: nextPriceValue, checkedAt: Date.now(), source: 'auto_ignored', saleInfo: nextPrice?.saleInfo || null });
            item.priceHistory = item.priceHistory.slice(0, 40);
            changed = true;
            continue;
          }
          item.saleInfo = nextSaleInfo;
          item.priceSource = nextPriceSource;
          const previousValue = parsePrice(previousPrice);
          const nextValue = parsePrice(nextPriceValue);
          priceDropped = previousValue !== null && nextValue !== null && nextValue < previousValue;
          item.priceHistory = Array.isArray(item.priceHistory) ? item.priceHistory : [];
          item.priceHistory.unshift({ price: nextPriceValue, checkedAt: Date.now(), source: 'auto', saleInfo: item.saleInfo });
          item.priceHistory = item.priceHistory.slice(0, 40);
          item.price = nextPriceValue;
          item.updatedAt = Date.now();
          await logActivity({
            type: priceDropped ? 'queda_preco' : 'preco_atualizado',
            itemName: item.name,
            detail: `Preço automático: ${previousPrice || 'sem preço'} → ${nextPriceValue}`,
            url: item.url,
          imageUrl: item.imageUrl
        });
        } else {
          item.saleInfo = nextSaleInfo;
          item.priceSource = nextPriceSource;
        }
        const isNowOnSale = Boolean(item.saleInfo?.onSale);
        const saleEnded = wasOnSale && nextPrice?.saleInfo && !isNowOnSale;
        if (isNowOnSale) {
          item.saleEndedNotifiedPrice = '';
          item.saleEndedNotifiedAt = null;
        }
        if (priceDropped && item.priceDropNotifiedPrice !== nextPriceValue) {
          await addPriceDropNotification(item, previousPrice, nextPriceValue);
          await notifyPriceDrop(item, previousPrice, nextPriceValue);
          item.priceDropNotifiedPrice = nextPriceValue;
          item.priceDropNotifiedAt = Date.now();
        }
        if (saleEnded && item.saleEndedNotifiedPrice !== nextPriceValue) {
          await addSaleEndedNotification(item, previousPrice, nextPriceValue, previousSaleInfo.originalPrice);
          await notifySaleEnded(item, previousPrice, nextPriceValue);
          item.saleEndedNotifiedPrice = nextPriceValue;
          item.saleEndedNotifiedAt = Date.now();
        }
      }
      changed = true;
    } catch (error) {
      item.priceCheckedAt = Date.now();
      item.priceCheckError = String(error?.message || error);
      changed = true;
    }
  }

  if (changed) await setItems(items);
}

function schedulePriceChecks() {
  chrome.alarms.create(PRICE_CHECK_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: CHECK_INTERVAL_MINUTES
  });
}

chrome.runtime.onInstalled.addListener(() => {
  schedulePriceChecks();
  checkSavedPrices();
});

chrome.runtime.onStartup.addListener(() => {
  schedulePriceChecks();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === PRICE_CHECK_ALARM) checkSavedPrices();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!SYNC_DATA_KEYS.some(key => changes[key])) return;
  scheduleAutoSync();
});
