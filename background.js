const PRICE_CHECK_ALARM = 'stashwear-price-check';
const CHECK_INTERVAL_MINUTES = 360;
const MAX_ITEMS_PER_RUN = 25;
const SYNC_DATA_KEYS = ['items', 'folders', 'stores', 'activities'];
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
  const match = text.match(/(?:R\$|BRL|US\$|USD|€|£)?\s*\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|(?:R\$|BRL|US\$|USD|€|£)?\s*\d+(?:[\.,]\d{2})/i);
  if (!match) return null;
  let price = cleanText(match[0]);
  if (!/(R\$|BRL|US\$|USD|€|£)/i.test(price)) price = 'R$ ' + price;
  return price.replace(/^BRL\s*/i, 'R$ ');
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
  const meta = readMetaContent(html, [
    'product:price:amount',
    'og:price:amount',
    'product:sale_price:amount',
    'twitter:data1',
    'price'
  ]);
  const metaPrice = normalizePrice(meta);
  if (metaPrice) return metaPrice;

  const focused = html.match(/(?:price|preco|preço|valor)[\s\S]{0,500}/i)?.[0];
  return normalizePrice(focused) || normalizePrice(html.slice(0, 250000));
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

async function notifyPriceDrop(item, previousPrice, nextPrice) {
  if (!chrome.notifications?.create) return;
  await chrome.notifications.create(`stashwear-price-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Preço caiu no StashWear',
    message: `${item.name || 'Uma peça salva'} caiu de ${previousPrice} para ${nextPrice}.`
  });
}

async function fetchCurrentPrice(url) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return extractPriceFromHtml(html);
}

async function checkSavedPrices() {
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
      item.priceCheckedAt = Date.now();
      item.priceCheckError = '';
      if (nextPrice && parsePrice(nextPrice) !== null) {
        const priceChanged = parsePrice(nextPrice) !== parsePrice(previousPrice);
        let priceDropped = false;
        if (priceChanged) {
          const previousValue = parsePrice(previousPrice);
          const nextValue = parsePrice(nextPrice);
          priceDropped = previousValue !== null && nextValue !== null && nextValue < previousValue;
          item.priceHistory = Array.isArray(item.priceHistory) ? item.priceHistory : [];
          item.priceHistory.unshift({ price: nextPrice, checkedAt: Date.now(), source: 'auto' });
          item.priceHistory = item.priceHistory.slice(0, 40);
          item.price = nextPrice;
          item.updatedAt = Date.now();
          await logActivity({
            type: priceDropped ? 'queda_preco' : 'preco_atualizado',
            itemName: item.name,
            detail: `Preço automático: ${previousPrice || 'sem preço'} → ${nextPrice}`,
            url: item.url,
            imageUrl: item.imageUrl
          });
        }
        if (priceDropped && item.priceDropNotifiedPrice !== nextPrice) {
          await addPriceDropNotification(item, previousPrice, nextPrice);
          await notifyPriceDrop(item, previousPrice, nextPrice);
          item.priceDropNotifiedPrice = nextPrice;
          item.priceDropNotifiedAt = Date.now();
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

chrome.runtime.onStartup.addListener(schedulePriceChecks);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === PRICE_CHECK_ALARM) checkSavedPrices();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!SYNC_DATA_KEYS.some(key => changes[key])) return;
  scheduleAutoSync();
});
