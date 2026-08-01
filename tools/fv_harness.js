/**
 * fv_harness.js — FleetView reusable headless test harness.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * FleetView is one self-contained index.html with a single inline <script>.
 * For ~18 deploys this harness was re-authored inline in a Bash heredoc every
 * single time: ~80 lines of identical DOM-stub / Supabase-mock boilerplate,
 * which broke three separate times on its own typos and cost a debug turn each.
 * It lives in a file now. Per-deploy you write ONLY the new assertions.
 *
 * DESIGN RULES (do not "simplify" these away)
 * -------------------------------------------
 * 1. ZERO npm dependencies. jsdom is not installed in the sandbox and a
 *    show-day deploy must never depend on an npm install succeeding.
 * 2. The DOM stub AUTO-VIVIFIES: querySelector() returns a live stub element
 *    for any selector it has never seen. index.html line ~742 does
 *    `$('#navInner').innerHTML=...` with NO null guard, so a strict stub would
 *    throw at eval time. Auto-vivify also means this harness does NOT need
 *    editing every time the founder adds a div.
 * 3. Function names are discovered by scanning the source, not hardcoded, so
 *    renaming an app function does not silently drop it from the test surface.
 * 4. Top-level `let`/`const` bindings (S, TAB, USER, ...) are NOT visible on a
 *    vm context object. We append an epilogue that closes over them and
 *    installs real getters/setters, so tests can read AND reassign `S` even
 *    though the app does `S=blankState()` in wipe()/importData().
 *
 * USAGE
 *   const {load} = require('./fv_harness.js');
 *   const app = load('index.html');        // throws on syntax error, with real
 *                                          // index.html line numbers
 *   app.S.units.push({...});               // read/mutate app state
 *   app.call('computeStatus', unit);       // call any app function
 *   app.fn.computeStatus(unit);            // same thing, shorthand
 *   app.consoleErrors;                     // app-level console.error/warn
 *   app.supabaseCalls;                     // what the app tried to persist
 */

'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Minimal auto-vivifying DOM element stub
 * ------------------------------------------------------------------ */
function makeEl(tag = 'div', id = '') {
  const listeners = {};
  const children = [];
  const el = {
    tagName: String(tag).toUpperCase(),
    id,
    // content
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    files: [],
    href: '',
    download: '',
    // layout / style
    style: {},
    dataset: {},
    attributes: {},
    children,
    parentNode: null,
    selectionStart: null,
    // classList
    classList: (() => {
      const set = new Set();
      return {
        _set: set,
        add: (...c) => c.forEach((x) => set.add(x)),
        remove: (...c) => c.forEach((x) => set.delete(x)),
        contains: (c) => set.has(c),
        toggle: (c, force) => {
          const on = force === undefined ? !set.has(c) : !!force;
          if (on) set.add(c);
          else set.delete(c);
          return on;
        },
      };
    })(),
    // attributes
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
    },
    getAttribute(k) {
      return k in this.attributes ? this.attributes[k] : null;
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    hasAttribute(k) {
      return k in this.attributes;
    },
    // tree
    appendChild(c) {
      children.push(c);
      if (c) c.parentNode = el;
      return c;
    },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      return c;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    insertBefore(c) {
      children.unshift(c);
      return c;
    },
    // queries — auto-vivify so unguarded lookups never throw
    querySelector(sel) {
      return makeEl('div', String(sel).replace(/^#/, ''));
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    getElementsByClassName() {
      return [];
    },
    contains() {
      return false;
    },
    // events / misc no-ops
    addEventListener(t, fn) {
      (listeners[t] = listeners[t] || []).push(fn);
    },
    removeEventListener() {},
    dispatchEvent(e) {
      (listeners[(e && e.type) || ''] || []).forEach((fn) => fn(e));
      return true;
    },
    _fire(t, e) {
      (listeners[t] || []).forEach((fn) => fn(e || { type: t }));
    },
    _listeners: listeners,
    focus() {},
    blur() {},
    click() {},
    scrollIntoView() {},
    setSelectionRange() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    // canvas surface — compressImage() draws and re-encodes photos
    getContext() {
      return { drawImage() {}, fillRect() {} };
    },
    toDataURL() {
      return 'data:image/jpeg;base64,U1RVQg==';
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 320, height: 640, x: 0, y: 0 };
    },
  };
  return el;
}

/* ------------------------------------------------------------------ *
 * Supabase mock — records everything the app tries to persist
 * ------------------------------------------------------------------ */
function makeSupabase(calls, opts) {
  const session = opts.session || null;

  const query = (table) => {
    const rec = (op, payload) => calls.push({ table, op, payload });
    // Failure injection: read opts.* LAZILY (per call, not at construction) so
    // tests can flip opts.writeError / opts.readError / opts.tableData mid-run
    // via app.opts. Return shape mirrors supabase-js v2: network failures come
    // back as { error }, they do not throw.
    const err = (op, payload) => (opts.writeError ? opts.writeError(table, op, payload) : null);
    const chain = {
      select(cols) {
        rec('select', cols);
        const e = opts.readError ? opts.readError(table) : null;
        const td = opts.tableData || {};
        return Promise.resolve(e ? { data: null, error: e } : { data: td[table] || [], error: null });
      },
      upsert(rows) {
        rec('upsert', rows);
        const e = err('upsert', rows);
        return Promise.resolve(e ? { data: null, error: e } : { data: rows, error: null });
      },
      insert(rows) {
        rec('insert', rows);
        const e = err('insert', rows);
        return Promise.resolve(e ? { data: null, error: e } : { data: rows, error: null });
      },
      update(row) {
        rec('update', row);
        return chain;
      },
      delete() {
        rec('delete', null);
        return chain;
      },
      in(col, vals) {
        rec('in', { col, vals });
        const e = err('delete', vals); // .delete().in('id', ids) resolves here
        return Promise.resolve(e ? { data: null, error: e } : { data: null, error: null });
      },
      eq(col, val) {
        rec('eq', { col, val });
        return chain;
      },
      then(res) {
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return chain;
  };

  return {
    from: (t) => query(t),
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: session && session.user }, error: null }),
      signInWithPassword: (c) => {
        calls.push({ table: '_auth', op: 'signIn', payload: c });
        return Promise.resolve({ data: { session }, error: null });
      },
      signUp: (c) => {
        calls.push({ table: '_auth', op: 'signUp', payload: c });
        return Promise.resolve({ data: { session }, error: null });
      },
      signOut: () => Promise.resolve({ error: null }),
      updateUser: (c) => {
        calls.push({ table: '_auth', op: 'updateUser', payload: c });
        return Promise.resolve({ data: {}, error: null });
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => ch };
      return ch;
    },
    removeChannel: () => {},
    storage: {
      from: (bucket) => ({
        upload: (path, blob, o) => {
          calls.push({ table: '_storage', op: 'upload', payload: { bucket, path } });
          const e = opts.storageError ? opts.storageError(path) : null;
          return Promise.resolve(e ? { data: null, error: e } : { data: { path }, error: null });
        },
        getPublicUrl: (path) => ({
          data: { publicUrl: 'https://stub.supabase.co/storage/v1/object/public/' + bucket + '/' + path },
        }),
      }),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Extract the single inline <script> block
 * ------------------------------------------------------------------ */
function extractInlineScript(html) {
  // Match <script> with NO attributes (the app's own code). CDN tags all have src=.
  const re = /<script>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    blocks.push({ code: m[1], index: m.index });
  }
  if (!blocks.length) throw new Error('fv_harness: no inline <script> block found');
  if (blocks.length > 1) {
    // Not fatal, but the app is documented as single-block. Warn loudly.
    process.stderr.write(
      `fv_harness: WARNING ${blocks.length} inline <script> blocks found; concatenating all.\n`
    );
  }
  const code = blocks.map((b) => b.code).join('\n;\n');
  // Line number of the first block's opening tag, so vm stack traces map to index.html
  const lineOffset = html.slice(0, blocks[0].index).split('\n').length;
  return { code, lineOffset };
}

/* ------------------------------------------------------------------ *
 * Discover app function names so the export surface is self-maintaining
 * ------------------------------------------------------------------ */
function discoverFunctionNames(code) {
  const names = new Set();
  const re = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(code)) !== null) names.add(m[1]);
  // Arrow/const helpers the app leans on ($, uid, now, esc, num, DT, MAPS...)
  const re2 = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|function|async|[A-Za-z_$'"`{[])/gm;
  while ((m = re2.exec(code)) !== null) names.add(m[1]);
  return [...names];
}

/* Mutable top-level bindings tests need live access to. */
const LIVE_BINDINGS = [
  'S', 'SNAP', 'TAB', 'jobView', 'USER', 'SYNC_READY', 'sb', 'authMode',
  'jobFilter', 'jobSearch', 'jobsSearch', 'mem', 'STORAGE_OK', 'IC',
  'TABLES', 'MAPS', 'DT', 'SC', 'NAV', 'KEY',
  'DEAD', 'KV', 'OFFLINE',
  'SYNC_FAILS', 'SYNC_LOST', 'DEAD',
];

/* ------------------------------------------------------------------ *
 * load()
 * ------------------------------------------------------------------ */
function load(htmlPath, opts = {}) {
  const file = path.resolve(htmlPath);
  const html = fs.readFileSync(file, 'utf8');
  const { code, lineOffset } = extractInlineScript(html);

  const consoleErrors = [];
  const consoleWarns = [];
  const supabaseCalls = [];
  const timers = [];
  // window/document listeners, capturable so tests can fire 'online' /
  // 'visibilitychange'. Document listeners are namespaced 'doc:<type>'.
  const windowListeners = {};

  /* localStorage stub */
  const store = new Map();
  if (opts.storage) for (const k in opts.storage) store.set(k, String(opts.storage[k]));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (opts.storageThrows) throw new Error('QuotaExceeded');
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    _dump: () => Object.fromEntries(store),
  };

  /* document stub */
  const elCache = new Map();
  const document = {
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: makeEl('body'),
    // stable identity per selector: two $('#x') calls return the same element
    querySelector(sel) {
      const k = String(sel);
      if (!elCache.has(k)) elCache.set(k, makeEl('div', k.replace(/^#/, '')));
      return elCache.get(k);
    },
    querySelectorAll: () => [],
    getElementById(id) {
      return document.querySelector('#' + id);
    },
    createElement: (t) => makeEl(t),
    createDocumentFragment: () => makeEl('fragment'),
    createTextNode: (t) => ({ textContent: t }),
    addEventListener(t, fn) {
      (windowListeners['doc:' + t] = windowListeners['doc:' + t] || []).push(fn);
    },
    removeEventListener() {},
    execCommand: () => true,
    cookie: '',
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    _elCache: elCache,
  };

  /* Deterministic clock + uuid so tests are reproducible */
  let uuidSeq = 0;
  const crypto = {
    randomUUID: () =>
      '00000000-0000-4000-8000-' + String(++uuidSeq).padStart(12, '0'),
    getRandomValues: (a) => {
      for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256;
      return a;
    },
  };

  /* Class-ish stubs for the CDN globals the app touches */
  class Chart {
    constructor(ctx, cfg) {
      this.ctx = ctx;
      this.config = cfg;
      Chart._made.push(cfg);
    }
    destroy() {}
    update() {}
    resize() {}
  }
  Chart._made = [];
  Chart.register = () => {};

  class Html5Qrcode {
    constructor(id) {
      this.id = id;
    }
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
    clear() {}
    static getCameras() {
      return Promise.resolve([{ id: 'cam0', label: 'back' }]);
    }
  }
  class Html5QrcodeScanner {
    constructor() {}
    render() {}
    clear() {
      return Promise.resolve();
    }
  }
  class QRCode {
    constructor(el, o) {
      this.el = el;
      this.options = o;
    }
    clear() {}
    makeCode() {}
  }

  /* Leaflet stub — chainable, every method returns something chainable */
  const leafletObj = () => {
    const o = new Proxy(
      {},
      {
        get: (t, k) => {
          if (k === 'then') return undefined; // don't look like a promise
          if (!(k in t)) t[k] = (...a) => (k === 'getBounds' ? leafletObj() : o);
          return t[k];
        },
      }
    );
    return o;
  };
  const L = new Proxy(
    { Icon: { Default: { prototype: {}, mergeOptions() {} } } },
    {
      get: (t, k) => {
        if (k in t) return t[k];
        return (...a) => leafletObj();
      },
    }
  );

  const sandbox = {
    console: {
      log: () => {},
      info: () => {},
      debug: () => {},
      warn: (...a) => consoleWarns.push(a.map(String).join(' ')),
      error: (...a) => consoleErrors.push(a.map(String).join(' ')),
    },
    document,
    localStorage,
    sessionStorage: localStorage,
    crypto,
    Chart,
    Html5Qrcode,
    Html5QrcodeScanner,
    QRCode,
    L,
    // timers: capture instead of firing, so eval never hangs the process
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => {
      timers.push({ fn, ms: 0 });
      return timers.length;
    },
    cancelAnimationFrame: () => {},
    fetch: () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert: () => {},
    confirm: () => (opts.confirm === undefined ? true : !!opts.confirm),
    prompt: () => '',
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    Blob: class { constructor(p, o) { this.parts = p; this.options = o; } },
    File: class { constructor(p, n) { this.parts = p; this.name = n; } },
    FileReader: class {
      readAsText() { if (this.onload) this.onload({ target: this }); }
      readAsDataURL() { this.result = 'data:image/jpeg;base64,AAAA'; if (this.onload) this.onload({ target: this }); }
    },
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    Image: class { constructor() { setTimeout(() => this.onload && this.onload(), 0); } },
    navigator: {
      userAgent: 'fv-harness',
      geolocation: {
        getCurrentPosition: (ok) =>
          ok && ok({ coords: { latitude: 33.6797, longitude: -116.2373, accuracy: 8 } }),
        watchPosition: () => 1,
        clearWatch: () => {},
      },
      onLine: true,
      clipboard: { writeText: () => Promise.resolve() },
      mediaDevices: { getUserMedia: () => Promise.resolve({}) },
    },
    location: {
      href: 'https://apginvests.github.io/fleet-view/',
      origin: 'https://apginvests.github.io',
      pathname: '/fleet-view/',
      search: '',
      hash: '',
      reload: () => {},
      replace: () => {},
      assign: () => {},
    },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {} },
    matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
    scrollTo: () => {},
    scrollBy: () => {},
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2,
    addEventListener: (t, fn) => {
      (windowListeners[t] = windowListeners[t] || []).push(fn);
    },
    removeEventListener: () => {},
    performance: { now: () => 0 },
    process: undefined, // don't leak node's process into app scope
  };

  // window self-reference + the supabase global the app reads at line ~290
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.supabase = { createClient: () => makeSupabase(supabaseCalls, opts) };

  /* Epilogue: expose the app's private top-level scope to tests. */
  const fnNames = discoverFunctionNames(code);
  const exportable = fnNames.filter((n) => !LIVE_BINDINGS.includes(n));
  const epilogue = `
;(function(){
  var __fn = {};
  ${exportable.map((n) => `try{ if(typeof ${n}!=='undefined') __fn[${JSON.stringify(n)}] = ${n}; }catch(e){}`).join('\n  ')}
  globalThis.__fv_fn = __fn;
  globalThis.__fv_live = {};
  ${LIVE_BINDINGS.map(
    (n) => `try{ Object.defineProperty(globalThis.__fv_live, ${JSON.stringify(n)}, {
    get: function(){ return typeof ${n}==='undefined'? undefined : ${n}; },
    set: function(v){ try{ ${n} = v; }catch(e){} },
    enumerable: true, configurable: true }); }catch(e){}`
  ).join('\n  ')}
})();`;

  const context = vm.createContext(sandbox);
  let script;
  try {
    script = new vm.Script(code + epilogue, {
      filename: file,
      lineOffset, // so a syntax error reports the real index.html line
    });
  } catch (e) {
    const err = new Error(
      `SYNTAX ERROR in ${path.basename(file)}: ${e.message}\n` +
        `  (line numbers are index.html lines)`
    );
    err.original = e;
    err.isSyntaxError = true;
    throw err;
  }

  let evalError = null;
  try {
    script.runInContext(context, { timeout: opts.timeout || 15000 });
  } catch (e) {
    evalError = e;
    if (!opts.tolerateEvalError) {
      const err = new Error(
        `RUNTIME ERROR while evaluating ${path.basename(file)}: ${e.message}\n${e.stack || ''}`
      );
      err.original = e;
      throw err;
    }
  }

  const fn = sandbox.__fv_fn || {};
  const live = sandbox.__fv_live || {};

  const api = {
    file,
    html,
    code,
    context: sandbox,
    fn,
    live,
    fnNames: Object.keys(fn),
    consoleErrors,
    consoleWarns,
    supabaseCalls,
    timers,
    localStorage,
    document,
    evalError,
    charts: Chart._made,
    opts, // mutate writeError/readError/storageError/tableData mid-test
    windowListeners,
    /** Fire captured window listeners, e.g. fireWindow('online'). */
    fireWindow(type, e) {
      (windowListeners[type] || []).forEach((fn2) => fn2(e || { type }));
    },
    /** Fire captured document listeners, e.g. fireDocument('visibilitychange'). */
    fireDocument(type, e) {
      (windowListeners['doc:' + type] || []).forEach((fn2) => fn2(e || { type }));
    },
    /** Call an app function by name. Throws a clear error if it's missing. */
    call(name, ...args) {
      if (typeof fn[name] !== 'function') {
        throw new Error(
          `fv_harness: app function "${name}" not found. ` +
            `Did it get renamed? Available: ${Object.keys(fn).slice(0, 12).join(', ')}...`
        );
      }
      return fn[name](...args);
    },
    /** Run any captured setTimeout callbacks (the app debounces flush/reload). */
    flushTimers(max = 50) {
      let n = 0;
      while (timers.length && n < max) {
        const t = timers.shift();
        try {
          t.fn();
        } catch (e) {
          consoleErrors.push('timer: ' + e.message);
        }
        n++;
      }
      return n;
    },
    /** Replace app state wholesale, then re-snapshot. */
    setState(partial) {
      const base = fn.blankState ? fn.blankState() : {};
      live.S = Object.assign(base, partial);
      if (fn.snapshot) { try { fn.snapshot(); } catch (e) {} }
      return live.S;
    },
  };

  // Convenience: app.S <-> live.S (get AND set, survives S=blankState())
  Object.defineProperty(api, 'S', {
    get: () => live.S,
    set: (v) => {
      live.S = v;
    },
    enumerable: true,
  });
  ['TAB', 'jobView', 'USER', 'SYNC_READY', 'sb', 'SNAP'].forEach((k) => {
    Object.defineProperty(api, k, {
      get: () => live[k],
      set: (v) => {
        live[k] = v;
      },
      enumerable: true,
    });
  });

  return api;
}

module.exports = { load, makeEl, extractInlineScript, discoverFunctionNames };
