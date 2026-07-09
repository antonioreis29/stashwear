function StashWearScraper() {
  function absoluteUrl(url) {
    try { return new URL(url, location.href).href; } catch { return url || null; }
  }

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePrice(raw) {
    if (!raw) return null;
    let text = cleanText(String(raw));

    const match = text.match(/(?:R\$|BRL|US\$|USD|\u20ac|\u00a3)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|\d+(?:[\.,]\d{2})/i);
    if (!match) return null;

    let price = cleanText(match[0]);
    if (!/(R\$|BRL|US\$|USD|\u20ac|\u00a3)/i.test(price)) {
      price = 'R$ ' + price;
    }
    return price.replace(/^BRL\s*/i, 'R$ ');
  }

  function cleanProductName(value) {
    return cleanText(value)
      .replace(/^\s*comprar\s+/i, '')
      .replace(/\s*(?:-|–|—|\|)?\s*(?:R\$|BRL|US\$|USD|\u20ac|\u00a3)\s*\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})?.*$/i, '')
      .replace(/\s+\d{1,2}\s*%\s*off\b.*$/i, '')
      .trim();
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

  function isPlausibleSale(current, original, percent = null) {
    if (!isSaneProductPrice(current)) return false;
    const numericPercent = Number(percent || 0);
    if (numericPercent >= 95) return false;
    if (original !== null) {
      if (!isSaneProductPrice(original)) return false;
      if (original <= current * 1.03) return false;
      if (original / current > 10) return false;
    }
    return original !== null || (numericPercent >= 5 && numericPercent < 95);
  }

  function normalizeSaleInfo(info, price) {
    const current = parsePrice(price || info?.currentPrice);
    const original = parsePrice(info?.originalPrice);
    const percent = Number(info?.discountPercent || 0);
    const hasOriginal = isPlausibleSale(current, original, percent);
    const discountPercent = original !== null && hasOriginal
      ? Math.round(((original - current) / original) * 100)
      : (percent >= 5 && percent < 95 ? percent : null);

    return {
      ...(info || {}),
      onSale: Boolean(hasOriginal || discountPercent),
      originalPrice: hasOriginal && original !== null ? formatPrice(original) : null,
      currentPrice: price || info?.currentPrice || null,
      discountPercent: discountPercent && discountPercent > 0 && discountPercent < 95 ? discountPercent : null
    };
  }

  function isMercadoLivrePage() {
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br') || host === 'mercadolibre.com' || host.endsWith('.mercadolibre.com');
  }

  function isMercadoLivreProductUrl() {
    if (!isMercadoLivrePage()) return false;
    const path = location.pathname;
    return /\/MLB-\d+|\/p\/MLB\d+|\/MLB\d+/i.test(path);
  }

  function metaContent(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = el?.getAttribute('content') || el?.getAttribute('value') || el?.textContent;
      if (cleanText(value)) return cleanText(value);
    }
    return null;
  }

  function hasElement(selectors) {
    return selectors.some(selector => document.querySelector(selector));
  }

  function hasTextMatch(selectors, pattern) {
    return selectors.some(selector => Array.from(document.querySelectorAll(selector)).slice(0, 60).some(el => pattern.test(cleanText(el.textContent || el.getAttribute('aria-label') || el.value || ''))));
  }

  function getPriceCandidatesFromText(text) {
    const source = cleanText(text);
    const pattern = /(?:R\$|BRL|US\$|USD|\u20ac|\u00a3)\s*\d{1,3}(?:[\.\s]\d{3})*(?:[,.]\d{2})?|\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|\d+(?:[\.,]\d{2})/gi;
    return Array.from(source.matchAll(pattern))
      .map(match => {
        const price = normalizePrice(match[0]);
        const before = source.slice(Math.max(0, match.index - 70), match.index);
        const after = source.slice(match.index + match[0].length, match.index + match[0].length + 30);
        const context = `${before}${match[0]}${after}`;
        return { price, context, before, after };
      })
      .filter(candidate => candidate.price)
      .map(candidate => ({ ...candidate, value: parsePrice(candidate.price), auxiliary: isLikelyAuxiliaryPriceContext(candidate.before, candidate.after) }))
      .filter(candidate => candidate.value !== null);
  }

  function isLikelyAuxiliaryPriceContext(beforeText = '', afterText = '') {
    const before = cleanText(beforeText).toLowerCase();
    const after = cleanText(afterText).toLowerCase();
    return /\b(?:\d+\s*(?:x|vezes)\s*(?:de)?|x\s*de|em\s+ate\s+\d+\s*x\s*(?:de)?|em\s+até\s+\d+\s*x\s*(?:de)?|parcela|parcelas|parcelamento)\b/i.test(before)
      || /^(?:\s*(?:\/\s*mes|\/\s*mês|por\s+mes|por\s+mês))/i.test(after);
  }

  function getPrimaryPriceCandidatesFromText(text) {
    return getPriceCandidatesFromText(text).filter(candidate => !candidate.auxiliary);
  }

  function saleContextScore(text = '') {
    const value = cleanText(text).toLowerCase();
    let score = 0;
    if (/\b(preco|preço|valor)\s+(promocional|atual|com\s+desconto|final)\b/i.test(value)) score += 4;
    if (/\b(por|agora|sale|promo|promocao|promoção|off|desconto|liquidacao|liquidação)\b/i.test(value)) score += 3;
    if (/\d{1,2}\s*%/.test(value)) score += 2;
    if (/\b(de|antes|preco\s+original|preço\s+original|valor\s+original)\b/i.test(value)) score -= 2;
    if (/\b(?:parcela|parcelas|parcelamento|sem juros|juros|frete|cashback|cupom|boleto|pix)\b/i.test(value)) score -= 8;
    return score;
  }

  function chooseCurrentPriceFromCandidates(candidates) {
    const valid = candidates
      .filter(candidate => candidate?.price && candidate.value !== null && !candidate.auxiliary)
      .sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff) return scoreDiff;
        return a.value - b.value;
      });

    if (!valid.length) return null;
    const hasSaleSignal = valid.some(candidate => (candidate.score || 0) > 0);
    if (hasSaleSignal) {
      const saleCandidates = valid.filter(candidate => (candidate.score || 0) > 0);
      return saleCandidates.sort((a, b) => a.value - b.value)[0];
    }
    return valid[0];
  }

  function detectSaleInfo(price, sourceText = '') {
    const current = parsePrice(price);
    const text = cleanText(sourceText);
    const candidates = getPrimaryPriceCandidatesFromText(text);
    const higher = candidates
      .filter(candidate => current !== null && candidate.value > current * 1.08 && candidate.value / current <= 10 && isSaneProductPrice(candidate.value))
      .sort((a, b) => b.value - a.value)[0];
    const saleWords = /\b(sale|promo|promocao|promoção|off|desconto|liquidacao|liquidação|de\s+r\$|preco\s+original|preço\s+original)\b/i.test(text);
    const percentMatch = text.match(/(\d{1,2})\s*%/);
    const discountPercent = higher && current !== null
      ? Math.round(((higher.value - current) / higher.value) * 100)
      : (percentMatch ? Number(percentMatch[1]) : null);

    return normalizeSaleInfo({
      onSale: Boolean(saleWords || higher || (discountPercent && discountPercent >= 5)),
      originalPrice: higher?.price || null,
      currentPrice: price || null,
      discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null
    }, price);
  }

  function moneyAmountFromElement(el) {
    if (!el) return null;
    if (!el.matches?.('.andes-money-amount')) {
      const nested = Array.from(el.querySelectorAll?.('.andes-money-amount:not(.andes-money-amount--previous)') || [])
        .find(node => !isAuxiliaryMercadoLivrePrice(node));
      if (nested) return moneyAmountFromElement(nested);
    }

    const fraction = cleanText(el.querySelector?.('.andes-money-amount__fraction')?.textContent || '');
    if (fraction) {
      const cents = cleanText(el.querySelector?.('.andes-money-amount__cents')?.textContent || '');
      const visiblePrice = cents ? `R$ ${fraction},${cents.padEnd(2, '0').slice(0, 2)}` : `R$ ${fraction}`;
      const visibleValue = parsePrice(visiblePrice);
      if (isSaneProductPrice(visibleValue)) return formatPrice(visibleValue);
    }

    const content = el.getAttribute?.('content') || el.querySelector?.('[content]')?.getAttribute('content');
    const contentValue = parsePrice(content);
    if (isSaneProductPrice(contentValue)) return formatPrice(contentValue);

    const candidates = getPrimaryPriceCandidatesFromText(cleanText(el.textContent || ''));
    const candidate = candidates.find(c => isSaneProductPrice(c.value));
    return candidate?.price || null;
  }

  function findMercadoLivreOriginalPrice(container, currentPrice) {
    const current = parsePrice(currentPrice);
    const scopes = [container, document].filter(Boolean);
    const selectors = [
      '.ui-pdp-price__original-value .andes-money-amount',
      '.andes-money-amount--previous',
      's .andes-money-amount',
      '[class*="original" i] .andes-money-amount',
      '[class*="previous" i] .andes-money-amount'
    ];

    for (const scope of scopes) {
      for (const selector of selectors) {
        const nodes = Array.from(scope.querySelectorAll?.(selector) || []);
        for (const node of nodes) {
          const price = moneyAmountFromElement(node);
          const value = parsePrice(price);
          if (price && value !== null && current !== null && value > current * 1.08 && value / current <= 10 && isSaneProductPrice(value)) return price;
        }
      }
    }

    return null;
  }

  function buildMercadoLivreSaleInfo(price, container) {
    const text = cleanText(container?.textContent || '');
    const base = detectSaleInfo(price, text);
    const current = parsePrice(price);
    const originalPrice = findMercadoLivreOriginalPrice(container, price) || base.originalPrice;
    const original = parsePrice(originalPrice);
    const percentFromText = Number((text.match(/(\d{1,2})\s*%\s*off/i) || [])[1] || 0);
    const discountPercent = original && current
      ? Math.round(((original - current) / original) * 100)
      : (percentFromText || base.discountPercent || null);

    return normalizeSaleInfo({
      ...base,
      onSale: Boolean(base.onSale || originalPrice || discountPercent),
      originalPrice: originalPrice || null,
      currentPrice: price || null,
      discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null
    }, price);
  }

  function isAuxiliaryMercadoLivrePrice(el) {
    const aux = el?.closest?.([
      '.ui-pdp-price__subtitles',
      '.ui-pdp-price__payments',
      '.ui-pdp-price__original-value',
      '.ui-pdp-media__discount',
      '.ui-pdp-coupon',
      '.ui-pdp-promotions-pill',
      '[class*="installment" i]',
      '[class*="parcel" i]',
      '[class*="coupon" i]',
      '[class*="shipping" i]',
      '[class*="discount" i]'
    ].join(','));
    return Boolean(aux);
  }

  function findMercadoLivrePrice() {
    if (!isMercadoLivrePage()) return null;

    const selectors = [
      '.ui-pdp-price__second-line .andes-money-amount:not(.andes-money-amount--previous)',
      '.ui-pdp-price__main-container .andes-money-amount:not(.andes-money-amount--previous)',
      '[data-testid="price-part"] .andes-money-amount:not(.andes-money-amount--previous)',
      '.ui-pdp-price__main-container [itemprop="price"]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(node => !isAuxiliaryMercadoLivrePrice(node));
      for (const node of nodes) {
        let price = moneyAmountFromElement(node);
        let value = parsePrice(price);
        const container = node.closest('.ui-pdp-price__main-container, [data-testid="price-part"]') || node;
        if (value !== null && value < 10) {
          const alternatives = getPrimaryPriceCandidatesFromText(cleanText(container.textContent || ''))
            .filter(candidate => isSaneProductPrice(candidate.value) && candidate.value >= 10)
            .sort((a, b) => saleContextScore(b) - saleContextScore(a));
          if (alternatives[0]) {
            price = alternatives[0].price;
            value = alternatives[0].value;
          }
        }
        if (price && isSaneProductPrice(value)) {
          const container = node.closest('.ui-pdp-price__main-container, [data-testid="price-part"]') || node;
          return {
            price,
            source: 'mercadolivre-main-price',
            saleInfo: buildMercadoLivreSaleInfo(price, container)
          };
        }
      }
    }

    return null;
  }

  function countProductLikeElements() {
    const productSchemaNodes = Array.from(document.querySelectorAll('[itemtype*="schema.org/Product" i]')).length;
    const productLinks = new Set(
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => absoluteUrl(a.getAttribute('href') || ''))
        .filter(href => /\/(?:p|produto|product|products|item|itens?)\/|[?&](?:sku|productId|pid|variant)=/i.test(href || ''))
    ).size;
    const buyButtons = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]'))
      .filter(el => /\b(comprar|adicionar|add to cart|buy now|colocar no carrinho|adicionar ao carrinho)\b/i.test(cleanText(el.textContent || el.getAttribute('aria-label') || el.value || '')))
      .length;
    const productCards = Array.from(document.querySelectorAll(
      '[class*="product" i], [class*="produto" i], [data-testid*="product" i], [data-test*="product" i], [data-cy*="product" i], [itemtype*="schema.org/Product" i]'
    ))
      .filter(el => {
        const text = cleanText(el.textContent).slice(0, 500);
        return normalizePrice(text) && (el.querySelector('img') || el.querySelector('a[href]'));
      })
      .length;

    return Math.max(productSchemaNodes, productLinks, buyButtons, productCards);
  }

  function isBlockedPage() {
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    const path = location.pathname.toLowerCase();
    const blockedHosts = [
      'supabase.com',
      'github.com',
      'youtube.com',
      'youtu.be',
      'music.youtube.com',
      'spotify.com',
      'open.spotify.com',
      'soundcloud.com',
      'deezer.com',
      'vimeo.com',
      'tiktok.com',
      'instagram.com',
      'facebook.com',
      'x.com',
      'twitter.com',
      'linkedin.com',
      'pinterest.com',
      'google.com',
      'accounts.google.com',
      'mail.google.com',
      'docs.google.com',
      'drive.google.com',
      'notion.so',
      'figma.com',
      'localhost',
      '127.0.0.1'
    ];
    const blockedHost = blockedHosts.some(domain => host === domain || host.endsWith(`.${domain}`));
    const blockedPath = /\/(?:dashboard|admin|account|accounts|login|signin|signup|auth|settings|docs|documentation|editor|console|checkout|cart|carrinho)(?:\/|$)/i.test(path);
    return blockedHost || blockedPath;
  }

  function productPageSignals(name, price, imageUrl, priceSource, saleInfo) {
    const fold = value => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const path = fold(location.pathname);
    const title = fold(document.title);
    const bodyText = fold(document.body?.innerText || '').slice(0, 140000);
    const negativeUrl = /(^\/?$|\/(?:collections?|categorias?|category|busca|search|sale|promocoes?|promocao|outlet|cart|carrinho|checkout|login|account|blog|pages?)(?:\/|$))/i.test(path);
    const negativeTitle = /\b(home|inicio|colecao|categoria|busca|resultado|promocoes|blog)\b/i.test(title);
    const productSchema = hasElement([
      '[itemtype*="schema.org/Product" i]',
      'script[type="application/ld+json"]'
    ]) && /"@type"\s*:\s*"?Product"?|schema\.org\/Product/i.test(document.documentElement.innerHTML.slice(0, 250000));
    const productMeta = hasElement([
      'meta[property^="product:" i]',
      'meta[property="og:type"][content*="product" i]',
      'meta[name="twitter:label1"][content*="price" i]',
      '[itemprop="sku"]',
      '[itemprop="mpn"]',
      '[itemprop="brand"]',
      '[itemprop="offers"]'
    ]);
    const buyButton = hasTextMatch('button, a, input[type="submit"], [role="button"]'.split(', '), /\b(comprar|adicionar|add to cart|buy now|colocar no carrinho|adicionar ao carrinho)\b/i);
    const skuText = /\b(sku|ref(?:erencia)?|codigo do produto|product code)\b/i.test(fold(document.body?.innerText || '').slice(0, 120000));
    const optionText = /\b(tamanho|cor|cores|variacao|variacoes|variant|variants|size|color)\b/i.test(bodyText);
    const commerceText = /\b(estoque|disponivel|disponibilidade|frete|entrega|devolucao|parcelamento|sem juros|quantidade|quantity|stock|shipping|delivery|returns)\b/i.test(bodyText);
    const optionControls = hasElement([
      'select[name*="size" i]',
      'select[name*="tamanho" i]',
      'select[name*="variant" i]',
      'select[name*="cor" i]',
      '[class*="sku" i]',
      '[class*="variant" i]',
      '[class*="variacao" i]',
      '[class*="tamanho" i]',
      '[class*="color" i]',
      '[data-testid*="size" i]',
      '[data-testid*="variant" i]'
    ]);
    const mercadoLivreProductUrl = isMercadoLivreProductUrl();
    const productUrl = mercadoLivreProductUrl || /\/(?:p|produto|product|products|item|itens?)\/|[?&](?:sku|productId|pid|variant)=/i.test(location.href);
    const productLikeCount = countProductLikeElements();
    const manyProducts = productLikeCount >= 4;
    const compactProductArea = mercadoLivreProductUrl || productLikeCount < 4;
    const productDetails = compactProductArea && (optionControls || (buyButton && (optionText || commerceText)));
    const score = [productSchema, productMeta, buyButton, skuText, productUrl].filter(Boolean).length;
    const strongProductEvidence = productSchema || productMeta || productUrl || skuText || (buyButton && productDetails);
    const hasCoreData = Boolean(name && price && (imageUrl || strongProductEvidence));
    const confidenceScore = Math.max(0,
      (productSchema ? 3 : 0) +
      (productMeta ? 3 : 0) +
      (buyButton ? 2 : 0) +
      (skuText ? 2 : 0) +
      (optionControls ? 2 : 0) +
      (productDetails ? 1 : 0) +
      (commerceText && buyButton ? 1 : 0) +
      (mercadoLivreProductUrl ? 3 : 0) +
      (productUrl ? 2 : 0) +
      (imageUrl ? 1 : 0) +
      (priceSource === 'mercadolivre-main-price' ? 2 : /^meta/.test(priceSource) ? 2 : /^selector/.test(priceSource) ? 1 : 0) +
      (saleInfo?.onSale ? 1 : 0) -
      (negativeUrl || negativeTitle ? 2 : 0)
    );
    const isLandingLike = negativeUrl || negativeTitle;
    const hasProductEvidence = productMeta || productSchema || productUrl || skuText || buyButton || productDetails;
    const isListingLike = manyProducts && isLandingLike && !strongProductEvidence && !mercadoLivreProductUrl;
    const minConfidence = strongProductEvidence ? 4 : 5;
    const isProductPage = hasCoreData && hasProductEvidence && confidenceScore >= minConfidence && !isListingLike && !(isLandingLike && !strongProductEvidence && !buyButton);
    let validationReason = 'ok';
    if (!name) validationReason = 'missing_name';
    else if (!price) validationReason = 'missing_price';
    else if (!imageUrl && !strongProductEvidence) validationReason = 'missing_image';
    else if (isListingLike) validationReason = 'listing_or_multiple_products';
    else if (confidenceScore < minConfidence) validationReason = 'low_confidence';
    else if (!hasProductEvidence) validationReason = 'missing_product_signal';
    else if (isLandingLike && !strongProductEvidence && !buyButton) validationReason = 'landing_or_category';

    return {
      isProductPage,
      validationReason,
      confidenceScore,
      productSignals: { productSchema, productMeta, buyButton, skuText, productUrl, mercadoLivreProductUrl, productDetails, optionControls, commerceText, negativeUrl, negativeTitle, productLikeCount, manyProducts, score }
    };
  }

  function fashionSignals(name = '') {
    const fold = value => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const meta = [
      metaContent(['meta[property="og:site_name"]']),
      metaContent(['meta[name="description"]', 'meta[property="og:description"]']),
      metaContent(['meta[property="product:category"]', 'meta[name="category"]'])
    ].filter(Boolean).join(' ');
    const breadcrumbs = Array.from(document.querySelectorAll('[itemtype*="BreadcrumbList" i], nav, [class*="breadcrumb" i], [aria-label*="breadcrumb" i]'))
      .slice(0, 8)
      .map(el => cleanText(el.textContent))
      .join(' ');
    const primaryText = fold([
      name,
      location.pathname,
      document.title,
      meta,
      breadcrumbs
    ].join(' '));
    const focusedText = fold([
      primaryText,
      cleanText(document.body?.innerText || '').slice(0, 22000)
    ].join(' '));

    const hardBlockPattern = /\b(carregador|cabo|fonte|usb|tipo[\s-]*c|type[\s-]*c|xiaomi|iphone|android|celular|smartphone|charger|cable|adapter|power[\s-]*supply|spotify|playlist|musica|música|album|álbum|artista|podcast|song|track|artist)\b/i;
    if (hardBlockPattern.test(primaryText)) {
      return {
        isFashion: false,
        fashionSignals: { hardBlocked: true, primaryPositiveMatches: 0, positiveMatches: 0, primaryNegativeMatches: 1, negativeMatches: 1, fashionUrl: false }
      };
    }

    const fashionPattern = /\b(moda|roupa|look|vestuario|calcado|calcados|tenis|sneaker|sapato|bota|sandalia|chinelo|salto|camisa|camiseta|blusa|body|cropped|regata|polo|moletom|casaco|jaqueta|blazer|cardigan|tricot|sueter|calca|jeans|bermuda|short|shorts|saia|vestido|macacao|lingerie|cueca|sutia|biquini|maio|bolsa|mochila|carteira|cinto|bone|chapeu|gorro|touca|strapback|snapback|dad\s*hat|aba\s*curva|oculos|relogio|colar|brinco|pulseira|anel|meia|acessorio|acessorios|fashion|clothing|apparel|wear|wearing|shoes|sneakers|shirt|t-shirt|tee|pants|jeans|shorts|jacket|coat|dress|skirt|bag|handbag|backpack|belt|cap|hat|sunglasses|watch|jewelry|jewellery)\b/gi;
    const nonFashionPattern = /\b(notebook|laptop|tablet|monitor|televisao|tv|geladeira|fogao|microondas|air fryer|camera|console|playstation|xbox|livro|ebook|curso|software|ferramenta|parafusadeira|furadeira|pneu|peca automotiva|suplemento|whey|remedio|medicamento|shampoo|perfume|creme|maquiagem|brinquedo|movel|sofa|mesa|cadeira|colchao|eletrodomestico|eletronico|musica|música|playlist|album|álbum|artista|podcast|electronics|appliance|furniture|book|toy|makeup|skincare|supplement|music|song|track|artist)\b/gi;
    const primaryPositiveMatches = (primaryText.match(fashionPattern) || []).length;
    const positiveMatches = (focusedText.match(fashionPattern) || []).length;
    const primaryNegativeMatches = (primaryText.match(nonFashionPattern) || []).length;
    const negativeMatches = (focusedText.match(nonFashionPattern) || []).length;
    const fashionUrl = /\/(moda|roupas?|vestuario|calcados?|tenis|sapatos?|bolsas?|acessorios?|fashion|clothing|apparel|shoes|sneakers|bags?)\b/i.test(primaryText);
    const blockedByPrimary = primaryNegativeMatches > 0 && primaryPositiveMatches === 0;
    const isFashion = !blockedByPrimary && (
      primaryPositiveMatches >= 1 ||
      fashionUrl ||
      (positiveMatches >= 3 && negativeMatches === 0)
    );

    return {
      isFashion: isFashion && primaryNegativeMatches < 2,
      fashionSignals: { primaryPositiveMatches, positiveMatches, primaryNegativeMatches, negativeMatches, fashionUrl }
    };
  }

  function findName() {
    const name = metaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[property="product:name"]',
      'meta[itemprop="name"]'
    ]) || cleanText(document.querySelector('h1')?.textContent) || document.title || null;
    return cleanProductName(name) || name;
  }

  function findPrice() {
    const mercadoLivrePrice = findMercadoLivrePrice();
    if (mercadoLivrePrice) return mercadoLivrePrice;

    const saleMeta = metaContent([
      'meta[property="product:sale_price:amount"]',
      'meta[property="product:sale_price"]',
      'meta[itemprop="lowPrice"]'
    ]);
    const normalizedSaleMeta = normalizePrice(saleMeta);
    if (normalizedSaleMeta) {
      const saleText = [
        saleMeta,
        metaContent(['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]'])
      ].filter(Boolean).join(' ');
      return { price: normalizedSaleMeta, source: 'meta-sale', saleInfo: detectSaleInfo(normalizedSaleMeta, saleText) };
    }

    const meta = metaContent([
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[itemprop="price"]',
      'meta[name="twitter:data1"]'
    ]);
    const normalizedMeta = normalizePrice(meta);
    if (normalizedMeta) return { price: normalizedMeta, source: 'meta', saleInfo: detectSaleInfo(normalizedMeta, meta) };

    const saleSelectors = [
      '[class*="sale" i]',
      '[id*="sale" i]',
      '[class*="promo" i]',
      '[id*="promo" i]',
      '[class*="discount" i]',
      '[id*="discount" i]',
      '[class*="final" i]',
      '[id*="final" i]',
      '[class*="current" i]',
      '[id*="current" i]',
      '[class*="por" i]',
      '[id*="por" i]'
    ];

    const saleCandidates = [];
    for (const selector of saleSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 60);
      for (const node of nodes) {
        const text = cleanText(node.getAttribute('content') || node.getAttribute('aria-label') || node.textContent);
        getPriceCandidatesFromText(text).forEach(candidate => {
          saleCandidates.push({ ...candidate, score: saleContextScore(candidate.context), text });
        });
      }
    }
    const salePrice = chooseCurrentPriceFromCandidates(saleCandidates);
    if (salePrice && salePrice.score > 0) {
      return { price: salePrice.price, source: 'selector-sale', saleInfo: detectSaleInfo(salePrice.price, salePrice.text) };
    }

    const selectors = [
      '[itemprop="price"]',
      '[property="price"]',
      '[data-testid*="price" i]',
      '[data-test*="price" i]',
      '[data-cy*="price" i]',
      '[class*="price" i]',
      '[id*="price" i]',
      '[class*="valor" i]',
      '[id*="valor" i]',
      '[class*="preco" i]',
      '[id*="preco" i]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 80);
      for (const node of nodes) {
        const text = cleanText(node.getAttribute('content') || node.getAttribute('aria-label') || node.textContent);
        const candidates = getPriceCandidatesFromText(text).map(candidate => ({ ...candidate, score: saleContextScore(candidate.context), text }));
        const current = chooseCurrentPriceFromCandidates(candidates);
        if (current) return { price: current.price, source: 'selector', saleInfo: detectSaleInfo(current.price, text) };
      }
    }

    return { price: null, source: 'none', saleInfo: { onSale: false, originalPrice: null, currentPrice: null, discountPercent: null } };
  }

  function imageUrlFromElement(img) {
    if (!img) return null;
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const srcsetUrl = srcset
      .split(',')
      .map(part => part.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop();
    return absoluteUrl(
      img.currentSrc ||
      img.src ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-zoom') ||
      img.getAttribute('data-lazy') ||
      img.getAttribute('data-image') ||
      srcsetUrl ||
      null
    );
  }

  function imageScore(img) {
    const width = Number(img.naturalWidth || img.width || img.getAttribute('width') || 0);
    const height = Number(img.naturalHeight || img.height || img.getAttribute('height') || 0);
    const parentText = `${img.className || ''} ${img.id || ''} ${img.closest?.('[class], [id], [data-testid]')?.className || ''} ${img.closest?.('[data-testid]')?.getAttribute('data-testid') || ''}`;
    const productBonus = /product|produto|gallery|galeria|pdp|main|hero|image|photo|foto/i.test(parentText) ? 90000 : 0;
    const size = width && height ? width * height : 60000;
    return size + productBonus;
  }

  function findImageUrl() {
    const meta = metaContent([
      'meta[property="og:image"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[itemprop="image"]'
    ]);
    if (meta) return absoluteUrl(meta);

    const focusedSelectors = [
      '.ui-pdp-gallery img',
      '[class*="product" i] img',
      '[class*="produto" i] img',
      '[class*="gallery" i] img',
      '[class*="galeria" i] img',
      '[data-testid*="image" i] img',
      'main img',
      'picture img',
      'img'
    ];
    const imgs = Array.from(new Set(focusedSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))))
      .filter(img => {
        const url = imageUrlFromElement(img);
        if (!url || /^data:image\/svg/i.test(url) || /\.svg(?:$|\?)/i.test(url)) return false;
        const width = Number(img.naturalWidth || img.width || img.getAttribute('width') || 0);
        const height = Number(img.naturalHeight || img.height || img.getAttribute('height') || 0);
        return (!width || width >= 80) && (!height || height >= 80);
      })
      .sort((a, b) => imageScore(b) - imageScore(a));

    return imageUrlFromElement(imgs[0]);
  }

  function toBase64(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX = 420;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function scrapeProduct() {
    if (isBlockedPage()) {
      return {
        name: null,
        price: null,
        imageUrl: null,
        isProductPage: false,
        isFashion: false,
        validationReason: 'blocked_page'
      };
    }

    const imageOriginal = findImageUrl();
    const imageBase64 = await toBase64(imageOriginal);
    const name = findName();
    const priceResult = findPrice();
    const price = priceResult.price;
    const imageUrl = imageBase64 || imageOriginal || null;
    const validation = productPageSignals(name, price, imageUrl, priceResult.source, priceResult.saleInfo);
    const fashion = fashionSignals(name);
    return {
      name,
      price,
      priceSource: priceResult.source,
      saleInfo: priceResult.saleInfo,
      imageUrl,
      ...fashion,
      ...validation
    };
  }

  return { scrapeProduct, isBlockedPage };
}

globalThis.StashWearScraper = StashWearScraper;
