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

    const match = text.match(/(?:R\$|BRL|US\$|USD|\u20ac|\u00a3)?\s*\d{1,3}(?:[\.\s]\d{3})*(?:,\d{2})|(?:R\$|BRL|US\$|USD|\u20ac|\u00a3)?\s*\d+(?:[\.,]\d{2})/i);
    if (!match) return null;

    let price = cleanText(match[0]);
    if (!/(R\$|BRL|US\$|USD|\u20ac|\u00a3)/i.test(price)) {
      price = 'R$ ' + price;
    }
    return price.replace(/^BRL\s*/i, 'R$ ');
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

  function isBlockedPage() {
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    const path = location.pathname.toLowerCase();
    const blockedHosts = [
      'supabase.com',
      'github.com',
      'youtube.com',
      'youtu.be',
      'music.youtube.com',
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

  function productPageSignals(name, price, imageUrl) {
    const fold = value => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const path = fold(location.pathname);
    const title = fold(document.title);
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
    const productUrl = /\/(?:p|produto|product|products|item|itens?)\/|[?&](?:sku|productId|pid|variant)=/i.test(location.href);
    const score = [productSchema, productMeta, buyButton, skuText, productUrl].filter(Boolean).length;
    const hasCoreData = Boolean(name && price && imageUrl);
    const isLandingLike = negativeUrl || negativeTitle;
    const hasProductEvidence = productMeta || productSchema || productUrl || skuText || buyButton;
    const isProductPage = hasCoreData && hasProductEvidence && !(isLandingLike && !productMeta && !productSchema && !productUrl && !skuText);
    let validationReason = 'ok';
    if (!name) validationReason = 'missing_name';
    else if (!price) validationReason = 'missing_price';
    else if (!imageUrl) validationReason = 'missing_image';
    else if (!hasProductEvidence) validationReason = 'missing_product_signal';
    else if (isLandingLike && !productMeta && !productSchema && !productUrl && !skuText) validationReason = 'landing_or_category';

    return {
      isProductPage,
      validationReason,
      productSignals: { productSchema, productMeta, buyButton, skuText, productUrl, negativeUrl, negativeTitle, score }
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

    const hardBlockPattern = /\b(carregador|cabo|fonte|usb|tipo[\s-]*c|type[\s-]*c|xiaomi|iphone|android|celular|smartphone|charger|cable|adapter|power[\s-]*supply)\b/i;
    if (hardBlockPattern.test(primaryText)) {
      return {
        isFashion: false,
        fashionSignals: { hardBlocked: true, primaryPositiveMatches: 0, positiveMatches: 0, primaryNegativeMatches: 1, negativeMatches: 1, fashionUrl: false }
      };
    }

    const fashionPattern = /\b(moda|roupa|look|vestuario|calcado|calcados|tenis|sneaker|sapato|bota|sandalia|chinelo|salto|camisa|camiseta|blusa|body|cropped|regata|polo|moletom|casaco|jaqueta|blazer|cardigan|tricot|sueter|calca|jeans|bermuda|short|shorts|saia|vestido|macacao|lingerie|cueca|sutia|biquini|maio|bolsa|mochila|carteira|cinto|bone|chapeu|oculos|relogio|colar|brinco|pulseira|anel|meia|acessorio|acessorios|fashion|clothing|apparel|wear|wearing|shoes|sneakers|shirt|t-shirt|tee|pants|jeans|shorts|jacket|coat|dress|skirt|bag|handbag|backpack|belt|cap|hat|sunglasses|watch|jewelry|jewellery)\b/gi;
    const nonFashionPattern = /\b(notebook|laptop|tablet|monitor|televisao|tv|geladeira|fogao|microondas|air fryer|camera|console|playstation|xbox|livro|ebook|curso|software|ferramenta|parafusadeira|furadeira|pneu|peca automotiva|suplemento|whey|remedio|medicamento|shampoo|perfume|creme|maquiagem|brinquedo|movel|sofa|mesa|cadeira|colchao|eletrodomestico|eletronico|electronics|appliance|furniture|book|toy|makeup|skincare|supplement)\b/gi;
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
    return metaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[property="product:name"]',
      'meta[itemprop="name"]'
    ]) || cleanText(document.querySelector('h1')?.textContent) || document.title || null;
  }

  function findPrice() {
    const meta = metaContent([
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[property="product:sale_price:amount"]',
      'meta[itemprop="price"]',
      'meta[name="twitter:data1"]'
    ]);
    const normalizedMeta = normalizePrice(meta);
    if (normalizedMeta) return normalizedMeta;

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
        const price = normalizePrice(text);
        if (price) return price;
      }
    }

    const bodyText = cleanText(document.body?.innerText || '');
    return normalizePrice(bodyText);
  }

  function findImageUrl() {
    const meta = metaContent([
      'meta[property="og:image"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[itemprop="image"]'
    ]);
    if (meta) return absoluteUrl(meta);

    const imgs = Array.from(document.querySelectorAll('img'))
      .filter(img => img.src && img.naturalWidth > 180 && img.naturalHeight > 180)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));

    return absoluteUrl(imgs[0]?.currentSrc || imgs[0]?.src || null);
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
    const price = findPrice();
    const imageUrl = imageBase64 || imageOriginal || null;
    const validation = productPageSignals(name, price, imageUrl);
    const fashion = fashionSignals(name);
    return {
      name,
      price,
      imageUrl,
      ...fashion,
      ...validation
    };
  }

  return { scrapeProduct, isBlockedPage };
}

globalThis.StashWearScraper = StashWearScraper;
