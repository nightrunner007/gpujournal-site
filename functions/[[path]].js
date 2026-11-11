// GPUJournal pre-render injector (Cloudflare Pages Function).
//
// The site is a single-file SPA: every route serves the same index.html
// shell and the content appears only after JS runs, which made Google
// index the site slowly. tools/build-prerender.mjs renders every sitemap
// route with the site's own code and stores the finished page in
// /prerender.json. This function injects that snapshot — route title,
// meta, canonical, JSON-LD and the #app HTML — into the shell at request
// time, so crawlers and no-JS readers get a finished page. Real users
// are unaffected: the app boots over the snapshot and re-renders the
// same content itself (the app's render always wins).
//
// Safety: any failure (missing/corrupt prerender.json, unknown route,
// transform error) falls back to the untouched shell — exactly the
// behaviour the site had before this function existed.

let dataPromise = null;

function loadData(env, origin) {
  if (!dataPromise) {
    dataPromise = env.ASSETS.fetch(new URL('/prerender.json', origin))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return dataPromise;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();

  const res = await next();
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return res;

  try {
    const url = new URL(request.url);
    let p = url.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);

    const data = await loadData(env, url.origin);
    const entry = data && data.routes ? data.routes[p] : null;
    if (!entry) return res;

    const setMeta = (rw, selector, value) => {
      if (value) rw.on(selector, { element(e) { e.setAttribute('content', value); } });
    };

    const rw = new HTMLRewriter()
      .on('title', { element(e) { e.setInnerContent(entry.title); } })
      .on('link[rel="canonical"]', { element(e) { e.setAttribute('href', entry.canonical); } })
      .on('#app', { element(e) { e.setInnerContent(entry.html, { html: true }); } });

    setMeta(rw, 'meta[name="description"]', entry.desc);
    if (entry.og) {
      setMeta(rw, 'meta[property="og:title"]', entry.og.title);
      setMeta(rw, 'meta[property="og:description"]', entry.og.description);
      setMeta(rw, 'meta[property="og:type"]', entry.og.type);
      setMeta(rw, 'meta[property="og:url"]', entry.og.url);
      setMeta(rw, 'meta[property="og:image"]', entry.og.image);
    }
    if (entry.tw) {
      setMeta(rw, 'meta[name="twitter:card"]', entry.tw.card);
      setMeta(rw, 'meta[name="twitter:title"]', entry.tw.title);
      setMeta(rw, 'meta[name="twitter:description"]', entry.tw.description);
      setMeta(rw, 'meta[name="twitter:image"]', entry.tw.image);
    }
    // The shell's <head> has no og:url element (the app creates it at
    // runtime), so append one — and the route JSON-LD — at the end of head.
    let headExtra = '';
    if (entry.og && entry.og.url) {
      headExtra += '<meta property="og:url" content="' + String(entry.og.url).replace(/"/g, '&quot;') + '" />';
    }
    if (entry.ld) {
      headExtra += '<script type="application/ld+json" id="seo-jsonld">' + String(entry.ld).replace(/<\/script>/gi, '<\\/script>') + '</script>';
    }
    if (headExtra) {
      rw.on('head', { element(e) { e.append(headExtra, { html: true }); } });
    }

    return rw.transform(res);
  } catch (err) {
    return res; // never let the injector take the site down
  }
}
