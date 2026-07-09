chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageImage' || request.action === 'scrapeProduct') {
    getScraper().scrapeProduct().then(data => {
      sendResponse({ ...data, imageUrl: data.imageUrl || null });
    }).catch(() => sendResponse({ imageUrl: null, price: null, name: null }));
    return true;
  }
});

let stashWearScraperInstance = null;

function getScraper() {
  if (!stashWearScraperInstance) stashWearScraperInstance = StashWearScraper();
  return stashWearScraperInstance;
}

(function initStashWearInlineSave() {
  if (window.__stashWearInlineSaveReady) return;
  window.__stashWearInlineSaveReady = true;

  const HOST_ID = 'stashwear-inline-save-host';
  const storageGet = key => new Promise((resolve, reject) => {
    chrome.storage.local.get(key, data => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(data[key] || []);
    });
  });
  const storageSet = (key, value) => new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
  let currentProduct = null;
  let detectTimer = null;
  let lastUrl = location.href;
  let lastDetectedUrl = '';
  let detectionAttempts = 0;
  const MAX_DETECTION_ATTEMPTS = 6;

  function foldText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function normalizeComparableUrl(url) {
    try {
      const parsed = new URL(url);
      const trackingParams = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'spm'];
      Array.from(parsed.searchParams.keys()).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.startsWith('utm_') || trackingParams.includes(lowerKey)) {
          parsed.searchParams.delete(key);
        }
      });
      parsed.hash = '';
      return parsed.href.replace(/\/$/, '');
    } catch {
      return String(url || '').split('#')[0].replace(/\/$/, '');
    }
  }

  function domainToName(domain) {
    if (!domain) return '';
    const part = domain.split('.').find(p => !['www','shop','loja','store'].includes(p)) || domain.split('.')[0];
    return part.charAt(0).toUpperCase() + part.slice(1);
  }

  function isBlockedPage() {
    return Boolean(getScraper().isBlockedPage?.());
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

  async function forgetDeletedItemKeys(keys) {
    const remove = new Set(keys.map(value => String(value || '')).filter(Boolean));
    if (!remove.size) return;
    const deletedKeys = await storageGet('deletedItemKeys');
    await storageSet('deletedItemKeys', deletedKeys.filter(key => !remove.has(String(key))));
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

  function cleanDisplayName(name) {
    const fallback = String(name || 'Peca sem nome');
    return fallback
      .replace(/^\s*comprar\s+/i, '')
      .replace(/\s*(?:-|–|—|\|)?\s*(?:R\$|BRL|US\$|USD)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?.*$/i, '')
      .trim() || fallback;
  }

  function embeddedPriceFromName(name) {
    const matches = String(name || '').match(/(?:R\$|BRL|US\$|USD)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?/gi) || [];
    const values = matches.map(parsePrice).filter(value => value !== null && value >= 10 && value < 50000);
    return values.length ? values[values.length - 1] : null;
  }

  async function logActivity(entry) {
    const activities = await storageGet('activities');
    activities.unshift({ at: Date.now(), ...entry });
    await storageSet('activities', activities.slice(0, 120));
  }

  async function autoSaveStore(pageUrl) {
    const domain = extractDomain(pageUrl);
    if (!domain) return;
    const stores = await storageGet('stores');
    if (stores.some(store => extractDomain(store.url) === domain)) return;
    const { protocol, hostname } = new URL(pageUrl);
    const name = domainToName(domain);
    stores.push({ name, url: `${protocol}//${hostname}`, autoSaved: true });
    await storageSet('stores', stores);
    await logActivity({ type: 'loja', storeName: name, detail: 'Loja salva automaticamente' });
  }

  async function saveDetectedProduct(product) {
    const items = await storageGet('items');
    const currentUrl = location.href;
    const comparableUrl = normalizeComparableUrl(currentUrl);
    const domain = extractDomain(currentUrl);
    const storeName = domainToName(domain);
    const now = Date.now();
    const existingIndex = items.findIndex(item => normalizeComparableUrl(item.url) === comparableUrl);
    const rawName = product.name || document.title || 'Peca sem nome';
    const name = cleanDisplayName(rawName);
    const rawPrice = product.price || '';
    const embeddedPrice = embeddedPriceFromName(rawName);
    const rawPriceValue = parsePrice(rawPrice);
    const price = embeddedPrice !== null && (rawPriceValue === null || rawPriceValue < 10 || embeddedPrice / Math.max(rawPriceValue, 0.01) > 10)
      ? formatPrice(embeddedPrice)
      : rawPrice;
    const parsedPrice = parsePrice(price);
    const imageUrl = product.imageUrl || null;
    const saleInfo = product.saleInfo || { onSale: false };
    const category = inferItemCategory(name, currentUrl);

    if (existingIndex >= 0) {
      const old = items[existingIndex];
      const history = priceHistory(old);
      const oldParsedPrice = parsePrice(old.price);
      if (price && parsedPrice !== null && oldParsedPrice !== null && parsedPrice !== oldParsedPrice) {
        history.unshift({ price, checkedAt: now });
      } else if (price && parsedPrice !== null && !history.length) {
        history.unshift({ price, checkedAt: now });
      }
      items[existingIndex] = {
        ...old,
        name,
        imageUrl: imageUrl || old.imageUrl,
        price: price || old.price,
        priceSource: product.priceSource || old.priceSource || '',
        confidenceScore: product.confidenceScore ?? old.confidenceScore ?? null,
        saleInfo: { ...(old.saleInfo || {}), ...saleInfo, currentPrice: price || saleInfo.currentPrice || old.price },
        store: storeName || old.store,
        category: category || old.category,
        priceHistory: history.slice(0, 40),
        updatedAt: now
      };
      items.unshift(items.splice(existingIndex, 1)[0]);
    } else {
      items.unshift({
        name,
        url: currentUrl,
        imageUrl,
        price,
        priceSource: product.priceSource || '',
        confidenceScore: product.confidenceScore ?? null,
        saleInfo: { ...saleInfo, currentPrice: price || saleInfo.currentPrice || null },
        store: storeName,
        category,
        priority: 'casual',
        note: '',
        tags: [],
        favorite: false,
        curationPriority: 'avaliando',
        buyThisMonth: true,
        priceHistory: parsedPrice !== null ? [{ price, checkedAt: now }] : [],
        savedAt: now
      });
    }

    const savedItem = items[0];
    await storageSet('items', items);
    await forgetDeletedItemKeys([currentUrl, savedItem.savedAt, savedItem.id, savedItem.name]);
    await autoSaveStore(currentUrl);
    await logActivity({
      type: existingIndex >= 0 ? 'atualizada' : 'salvo',
      itemName: savedItem.name,
      detail: existingIndex >= 0 ? `Preco atual: ${savedItem.price || 'sem preco'}` : (savedItem.price ? `Salva por ${savedItem.price}` : 'Adicionada a colecao'),
      url: savedItem.url,
      imageUrl: savedItem.imageUrl
    });
    return existingIndex >= 0;
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
    host.shadowRoot.innerHTML = `
      <style>
        :host{all:initial}
        .wrap{position:fixed;right:22px;bottom:22px;z-index:2147483647;font-family:Inter,Arial,sans-serif;color:#f4f4f4}
        .fab{height:58px;border:1px solid rgba(232,227,218,.62);border-radius:999px;background:linear-gradient(180deg,#1d1d1c,#090909);color:#f4f4f4;box-shadow:0 24px 70px rgba(0,0,0,.56),0 0 0 6px rgba(232,227,218,.08);display:flex;align-items:center;gap:12px;padding:0 20px 0 14px;font-size:14px;font-weight:950;cursor:pointer;animation:stashwear-pop .42s ease both,stashwear-pulse 2.8s ease 1.1s 2}
        .fab[aria-expanded="true"]{background:#e8e3da;color:#080808}
        .fab:hover{background:#e8e3da;color:#080808;transform:translateY(-2px)}
        .dot{width:34px;height:34px;border-radius:999px;background:#e8e3da;color:#080808;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:900;line-height:1;box-shadow:0 10px 24px rgba(232,227,218,.22)}
        .fab[aria-expanded="true"] .dot{background:#080808;color:#e8e3da}
        .fab:hover .dot{background:#080808;color:#e8e3da}
        .panel{width:min(360px,calc(100vw - 36px));margin-bottom:12px;border:1px solid rgba(232,227,218,.38);border-radius:22px;background:linear-gradient(180deg,rgba(24,24,23,.99),rgba(10,10,10,.99));box-shadow:0 28px 90px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.05);overflow:hidden;display:none}
        .wrap.open .panel{display:block}
        .preview{display:grid;grid-template-columns:94px 1fr;gap:14px;padding:14px}
        .thumb{width:94px;height:112px;border-radius:16px;background:#171717;overflow:hidden;border:1px solid rgba(255,255,255,.1);position:relative}
        .thumb img{width:100%;height:100%;object-fit:cover;display:block}
        .sale-badge{position:absolute;left:8px;top:8px;border:1px solid rgba(255,255,255,.78);border-radius:999px;background:linear-gradient(180deg,#d82121,#a91414);color:#fff;padding:4px 6px;font-size:8px;text-transform:uppercase;letter-spacing:.1em;font-weight:950;box-shadow:0 9px 20px rgba(216,33,33,.24),0 1px 0 rgba(255,255,255,.18) inset;animation:sale-pop .22s ease both}
        .copy{min-width:0;padding-top:2px}
        .eyebrow{display:block;color:#e8e3da;font-size:9px;text-transform:uppercase;letter-spacing:.16em;font-weight:950}
        .name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:6px;color:#f4f4f4;font-size:14px;line-height:1.15;font-weight:900}
        .price{display:block;margin-top:9px;color:#fff;font-size:17px;line-height:1;font-weight:950}
        .actions{display:flex;gap:8px;padding:0 14px 14px}
        button{font:inherit}
        .save,.close{height:42px;border-radius:999px;padding:0 15px;font-size:12px;font-weight:950;cursor:pointer}
        .save{flex:1;border:1px solid #e8e3da;background:#e8e3da;color:#080808}
        .close{border:1px solid rgba(232,227,218,.28);background:transparent;color:#f4f4f4}
        .status{padding:0 14px 14px;color:#9a9a94;font-size:11px;line-height:1.35;display:none}
        .wrap.saved .status,.wrap.error .status{display:block}
        @keyframes stashwear-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes sale-pop{from{opacity:0;transform:translateY(-4px) scale(.92)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes stashwear-pulse{0%,100%{box-shadow:0 24px 70px rgba(0,0,0,.56),0 0 0 6px rgba(232,227,218,.08)}50%{box-shadow:0 24px 70px rgba(0,0,0,.56),0 0 0 12px rgba(232,227,218,.16)}}
        @media (max-width:520px){.wrap{right:12px;bottom:12px}.fab{height:54px;padding-right:16px}.label{display:inline}.panel{width:calc(100vw - 24px)}}
      </style>
      <div class="wrap">
        <div class="panel">
          <div class="preview">
            <div class="thumb"></div>
            <div class="copy">
              <span class="eyebrow">Peca detectada</span>
              <strong class="name"></strong>
              <span class="price"></span>
            </div>
          </div>
          <div class="actions">
            <button class="save" type="button">Salvar no StashWear</button>
            <button class="close" type="button">Fechar</button>
          </div>
          <div class="status"></div>
        </div>
        <button class="fab" type="button" aria-label="Salvar no StashWear" aria-expanded="false" aria-controls="stashwear-inline-save-panel"><span class="dot">+</span><span class="label">Salvar no StashWear</span></button>
      </div>
    `;
    host.shadowRoot.querySelector('.panel').id = 'stashwear-inline-save-panel';
    host.shadowRoot.querySelector('.panel').setAttribute('role', 'dialog');
    host.shadowRoot.querySelector('.panel').setAttribute('aria-label', 'Salvar peca no StashWear');
    host.shadowRoot.querySelector('.status').setAttribute('aria-live', 'polite');
    bindHostEvents(host);
    return host;
  }

  function bindHostEvents(host) {
    const root = host.shadowRoot;
    const wrap = root.querySelector('.wrap');
    const fab = root.querySelector('.fab');
    fab.addEventListener('click', () => {
      wrap.classList.toggle('open');
      fab.setAttribute('aria-expanded', String(wrap.classList.contains('open')));
      wrap.classList.remove('saved', 'error');
      renderProduct(currentProduct);
    });
    root.querySelector('.close').addEventListener('click', () => {
      wrap.classList.remove('open', 'saved', 'error');
      fab.setAttribute('aria-expanded', 'false');
    });
    root.querySelector('.save').addEventListener('click', async () => {
      if (!currentProduct) return;
      const button = root.querySelector('.save');
      const status = root.querySelector('.status');
      button.disabled = true;
      button.textContent = 'Salvando...';
      wrap.classList.remove('saved', 'error');
      try {
        const updated = await saveDetectedProduct(currentProduct);
        wrap.classList.add('saved');
        status.textContent = updated ? 'Peca atualizada na sua colecao.' : 'Peca salva na sua colecao.';
        button.textContent = updated ? 'Atualizada' : 'Salva';
        setTimeout(() => {
          wrap.classList.remove('open');
          fab.setAttribute('aria-expanded', 'false');
        }, 1600);
      } catch {
        wrap.classList.add('error');
        status.textContent = 'Nao foi possivel salvar agora. Tente pelo popup do StashWear.';
        button.textContent = 'Tentar de novo';
      } finally {
        button.disabled = false;
      }
    });
  }

  function renderProduct(product) {
    const host = ensureHost();
    const root = host.shadowRoot;
    root.querySelector('.name').textContent = product?.name || 'Peca detectada';
    root.querySelector('.price').textContent = product?.price || 'Preco detectado';
    const thumb = root.querySelector('.thumb');
    thumb.replaceChildren();
    if (product?.imageUrl) {
      const img = document.createElement('img');
      img.src = product.imageUrl;
      img.alt = '';
      thumb.appendChild(img);
    }
    if (product?.saleInfo?.onSale) {
      const badge = document.createElement('span');
      badge.className = 'sale-badge';
      badge.textContent = product.saleInfo.discountPercent ? `Sale -${product.saleInfo.discountPercent}%` : 'Sale';
      thumb.style.position = 'relative';
      thumb.appendChild(badge);
    }
    root.querySelector('.save').textContent = 'Salvar no StashWear';
    root.querySelector('.save').disabled = false;
    root.querySelector('.status').textContent = '';
    root.querySelector('.wrap').classList.remove('saved', 'error');
  }

  function removeHost() {
    document.getElementById(HOST_ID)?.remove();
    lastDetectedUrl = '';
  }

  function scheduleDetectionRetry() {
    if (currentProduct || detectionAttempts >= MAX_DETECTION_ATTEMPTS) return;
    detectionAttempts += 1;
    detectProductSoon(Math.min(5200, 850 + detectionAttempts * 650));
  }

  async function detectProductSoon(delay = 500, force = false) {
    if (detectTimer) {
      if (!force) return;
      clearTimeout(detectTimer);
      detectTimer = null;
    }
    detectTimer = setTimeout(async () => {
      detectTimer = null;
      if (!document.body || !/^https?:\/\//i.test(location.href)) return;
      if (isBlockedPage()) {
        currentProduct = null;
        detectionAttempts = 0;
        removeHost();
        return;
      }
      try {
        const product = await getScraper().scrapeProduct();
        if (product?.isProductPage && product?.isFashion) {
          currentProduct = product;
          detectionAttempts = 0;
          lastDetectedUrl = location.href;
          renderProduct(product);
        } else {
          currentProduct = null;
          removeHost();
          scheduleDetectionRetry();
        }
      } catch {
        currentProduct = null;
        removeHost();
        scheduleDetectionRetry();
      }
    }, delay);
  }

  detectProductSoon(900);

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      currentProduct = null;
      detectionAttempts = 0;
      removeHost();
      detectProductSoon(900, true);
      return;
    }
    if (!currentProduct || lastDetectedUrl !== location.href) detectProductSoon(1200);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
