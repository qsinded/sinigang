// Run: node tests/offline.js   (npm test runs it too)
// Exercises sw.js against fake Cache/network objects: the offline shell, the old-cache cleanup and
// the "leave other people's requests alone" rules. A browser is not needed, and no files are served.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');

const SW = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const listOf = name => {
  const m = SW.match(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);'));
  assert.ok(m, name + ' is declared in sw.js');
  return m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
};
const SHELL = listOf('SHELL'), OPTIONAL = listOf('OPTIONAL');

// A world: one origin, a set of files the fake network can answer, and a cache per version.
function world(scope) {
  const caches = new Map(), net = new Set(), broken = new Set(), hits = { net: 0 };
  const res = body => ({ ok: true, type: 'basic', body, clone: () => res(body) });
  const store = name => {
    if (!caches.has(name)) caches.set(name, new Map());
    const m = caches.get(name);
    return {
      addAll: async urls => { for (const u of urls) { if (!net.has(u)) throw new Error('404 ' + u); m.set(u, res(u)); } },
      add: async u => { if (!net.has(u) || broken.has(u)) throw new Error('404 ' + u); m.set(u, res(u)); },
      match: async k => m.get(k),
      put: async (k, r) => { m.set(k, r); }
    };
  };
  const listeners = {};
  const sandbox = {
    self: {
      addEventListener: (t, f) => (listeners[t] = f),
      skipWaiting: async () => {}, clients: { claim: async () => {} },
      registration: { scope }
    },
    caches: { open: async n => store(n), keys: async () => [...caches.keys()], delete: async n => caches.delete(n) },
    location: { origin: new URL(scope).origin },
    fetch: async req => {
      hits.net++;
      const u = typeof req === 'string' ? req : req.url.replace(scope, './');
      if (!net.has(u)) throw new Error('offline');
      return res(u);
    },
    Response: class { constructor(body, init) { this.body = body; this.status = (init || {}).status; } },
    URL, console, Promise
  };
  sandbox.self.location = sandbox.location;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW, sandbox);
  const cacheName = vm.runInContext('CACHE', sandbox); // 'reviewer-v1', kept in one place in sw.js
  // Fire a listener. A handler that never answers means "not intercepted", which is undefined here.
  const fire = (type, event) => new Promise((resolve, reject) => {
    let answered = false;
    listeners[type]({
      ...event,
      waitUntil: p => { answered = true; Promise.resolve(p).then(resolve, reject); },
      respondWith: p => { answered = true; Promise.resolve(p).then(resolve, reject); }
    });
    setImmediate(() => { if (!answered) resolve(undefined); });
  });
  const request = (url, opts = {}) => ({
    method: opts.method || 'GET',
    mode: opts.mode || 'cors',
    url: new URL(url, scope).href,
    headers: { get: () => (opts.page ? 'text/html' : '') }
  });
  return { caches, net, broken, hits, fire, request, cacheName, store: () => caches.get(cacheName) };
}

(async () => {
  for (const scope of ['https://example.com/', 'https://example.com/repo/']) {
    const w = world(scope), at = u => scope + u;
    [...SHELL, ...OPTIONAL].forEach(u => w.net.add(u));
    // A cache left behind by an older deploy, and a file the install-time fetch fails on.
    w.caches.set(w.cacheName.replace(/\d+$/, '0'), new Map());
    w.broken.add('./js/pdfjs-worker-bundle.js');
    w.net.delete('./js/pdfjs-worker-bundle.js');

    await w.fire('install', {});
    const cached = w.store();
    assert.deepStrictEqual([...cached.keys()].sort(), [...SHELL, ...OPTIONAL.filter(f => !w.broken.has(f))].sort(), 'the shell installs even when an optional bundle cannot be fetched');
    await w.fire('activate', {});
    assert.deepStrictEqual([...w.caches.keys()], [w.cacheName], 'old caches are removed on activate');

    // Offline page load: any path, any depth, answered from the cache without touching the network.
    const nav = await w.fire('fetch', { request: w.request(at('a/deep/link'), { mode: 'navigate', page: true }) });
    assert.strictEqual(nav && nav.body, './index.html', 'a page load offline opens the app');
    // Precached files are not refetched, and a cache-busting query does not miss.
    for (const f of ['./js/app.js', './css/styles.css?v=2']) {
      const r = await w.fire('fetch', { request: w.request(at(f.replace(/^\.\//, ''))) });
      assert.strictEqual(r && r.body, './' + f.replace(/^\.\//, '').replace(/\?.*/, ''), f + ' is served from the cache');
    }
    assert.strictEqual(w.hits.net, 0, 'nothing was fetched from the network');
    // A bundle that failed at install is fetched on first use, then available offline.
    w.net.add('./js/pdfjs-worker-bundle.js');
    const first = await w.fire('fetch', { request: w.request(at('js/pdfjs-worker-bundle.js')) });
    assert.strictEqual(first && first.body, './js/pdfjs-worker-bundle.js');
    w.net.delete('./js/pdfjs-worker-bundle.js');
    const again = await w.fire('fetch', { request: w.request(at('js/pdfjs-worker-bundle.js')) });
    assert.strictEqual(again && again.body, './js/pdfjs-worker-bundle.js', 'the bundle works offline after one use');
    // Unknown file offline: an explicit 504, not a crash. Other requests are left to the browser.
    const miss = await w.fire('fetch', { request: w.request(at('nope.txt')) });
    assert.strictEqual(miss && miss.status, 504, 'an uncached file offline answers 504');
    assert.strictEqual(await w.fire('fetch', { request: w.request(at('x'), { method: 'POST' }) }), undefined, 'POST is not intercepted');
    assert.strictEqual(await w.fire('fetch', { request: w.request('https://other.example/x') }), undefined, 'a cross-origin request is not intercepted');
  }

  // Every precached path must exist in the repository, or the install fails on a real phone.
  const root = path.join(__dirname, '..');
  const missing = [...SHELL, ...OPTIONAL].filter(f => f !== './' && !fs.existsSync(path.join(root, f.replace(/^\.\//, '').split('?')[0])));
  assert.deepStrictEqual(missing, [], 'every cached file exists');
  assert.ok(SHELL.includes('./js/app.js') && SHELL.includes('./css/styles.css'), 'the shell covers the app itself');
  assert.ok(!SHELL.includes('./sw.js'), 'the worker does not cache itself');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /js\/sw-register\.js/, 'the page registers the worker');

  console.log('offline checks passed');
})().catch(e => { console.error(e); process.exit(1); });
