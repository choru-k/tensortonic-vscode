'use strict';

const crypto = require('node:crypto');
const { isAllowedRequest, validateBody, ORIGINS } = require('./request-policy');
const MAX_RESPONSE = 8 * 1024 * 1024;
const MAX_BODY = 1024 * 1024;
const SLUG = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';
const PAGE_GUARD = `window===window.top && (${JSON.stringify([...ORIGINS])}).includes(location.origin)`;
function fault(message, code) { const error = new Error(message); if (code) error.code = code; return error; }
function problemUrl(value) {
  let url; try { url = new URL(value); } catch (_) { return undefined; }
  if (url.origin !== 'https://www.tensortonic.com' || url.username || url.password || url.hash ||
      !new RegExp(`^/problems/${SLUG}$`).test(url.pathname)) return undefined;
  if ([...url.searchParams].some(([key, val]) => key !== 'studyPlan' || !new RegExp(`^${SLUG}$`).test(val)) ||
      url.searchParams.getAll('studyPlan').length > 1) return undefined;
  return url.href;
}
function bounded(promise, ms, message, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const done = (fn, value) => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => done(reject, fault('Native browser operation canceled. A dispatched Run or Submit may have completed; check the website before trying again.', 'CANCELED'));
    Promise.resolve(promise).then(value => done(resolve, value), () => done(reject, fault(message, 'TRANSPORT_ERROR')));
    timer = setTimeout(() => done(reject, fault(message, 'TIMEOUT')), ms);
    if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
  });
}

// Accept only bounded base64 chunks with their exact requested length.
// Retrying a chunk read never repeats the upstream HTTP operation.
function displayedBase64(result, length) {
  if (typeof result !== 'string') return undefined;
  let value = result;
  if ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")) value = value.slice(1, -1);
  return value.length === length && /^[A-Za-z0-9+/=]*$/.test(value) ? value : undefined;
}

function canonical(value) { try { return ORIGINS.has(new URL(value).origin); } catch (_) { return false; } }

class NativeBrowserBridge {
  constructor(vscode, { now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), discoverTimeout = 15000, evaluationTimeout = 5000, requestTimeout = 180000, maxResponseBytes = MAX_RESPONSE, launchTimeout = 20000, cleanupTimeout = 5000 } = {}) {
    Object.assign(this, { vscode, now, pause, discoverTimeout, evaluationTimeout, requestTimeout, launchTimeout, cleanupTimeout });
    this.maxResponseBytes = Math.min(MAX_RESPONSE, maxResponseBytes);
    this.resources = new Set(); this.generation = 0; this.connected = false; this.cleanupPending = false; this.disposed = false;
    this.nextId = 0; this.listeners = [];
  }
  _listenTabs(w) {
    if (this.listeners.length) return;
    if (w && w.onDidCloseBrowserTab) this.listeners.push(w.onDidCloseBrowserTab(tab => {
      for (const r of this.resources) if (r.tab === tab) { r.tabClosed = true; this.token = undefined; this._invalidate(r); }
    }));
    if (w && w.onDidChangeBrowserTabState) this.listeners.push(w.onDidChangeBrowserTabState(tab => {
      for (const r of this.resources) if (r.tab === tab && !canonical(tab.url)) this._invalidate(r);
    }));
  }
  get hasOwnedResources() { return this.resources.size > 0 || !!this.launching; }
  _setConnected(value) { if (this.connected !== value) { this.connected = value; if (this.onDidChange) this.onDidChange(); } }
  _invalidate(r, sessionId) {
    for (const target of r.targets.values()) if (!sessionId || target.sessionId === sessionId) { target.epoch++; target.contexts.clear(); }
    if (this.target && this.target.resource === r && (!sessionId || this.target.sessionId === sessionId)) {
      this.target = undefined; if (!this.navigating) this._setConnected(false);
      if (this.pending) this.pending.controller.abort();
    }
  }
  _check(generation, target, signal) {
    if (this.disposed || this.stopping || generation !== this.generation || this.vscode.workspace?.isTrusted !== true || signal?.aborted) throw fault('Native browser connection changed or was canceled. No request was replayed.', 'CANCELED');
    if (target) {
      const r = target.resource, live = r.targets.get(target.sessionId);
      if (!this.resources.has(r) || r.closed || r.tabClosed || !canonical(r.tab.url) || !live || r.targets.size !== 1 || live.epoch !== target.epoch || live.contexts.get(target.context.id) !== target.context) throw fault('The owned TensorTonic browser page changed. Connect again; no request was replayed.', 'PAGE_CHANGED');
    }
  }
  _onMessage(r, message) {
    if (!message || typeof message !== 'object') return;
    if (Number.isSafeInteger(message.id)) {
      const entry = r.requests.get(message.id);
      if (!entry || message.sessionId !== entry.sessionId) return;
      if (message.error) entry.reject(fault('Owned browser protocol request failed.', 'TRANSPORT_ERROR'));
      else entry.resolve(message.result);
      return;
    }
    const p = message.params;
    if (message.method === 'Target.attachedToTarget' && !message.sessionId && p?.targetInfo?.type === 'page' && typeof p.sessionId === 'string' && typeof p.targetInfo.vscodeBrowserViewId === 'string') {
      // This CDP group was obtained solely from the newly opened BrowserTab.
      // Never attach a global target, nested page, worker, or iframe.
      if (!r.targets.has(p.sessionId)) {
        r.targets.set(p.sessionId, { sessionId: p.sessionId, epoch: 0, contexts: new Map(), initialized: false });
        if (r.targets.size > 1) this._invalidate(r);
      }
    } else if (message.method === 'Target.detachedFromTarget' && !message.sessionId) {
      this._invalidate(r, p?.sessionId); r.targets.delete(p?.sessionId);
    } else {
      const target = r.targets.get(message.sessionId); if (!target) return;
      if (message.method === 'Runtime.executionContextsCleared') this._invalidate(r, message.sessionId);
      else if (message.method === 'Runtime.executionContextDestroyed') {
        if (target.contexts.has(p?.executionContextId)) this._invalidate(r, message.sessionId);
      } else if (message.method === 'Runtime.executionContextCreated') {
        const c = p?.context;
        if (Number.isSafeInteger(c?.id) && c.auxData?.isDefault === true && typeof c.auxData.frameId === 'string' && ORIGINS.has(c.origin)) {
          if (target.contexts.has(c.id)) this._invalidate(r, message.sessionId);
          target.contexts.set(c.id, { id: c.id, uniqueId: typeof c.uniqueId === 'string' ? c.uniqueId : undefined, frameId: c.auxData.frameId });
        }
      }
    }
  }
  async _cdp(r, method, params, sessionId, signal) {
    if (!r.group || r.closed || signal?.aborted) throw fault('Owned browser transport is closed or canceled.', 'CANCELED');
    if (method === 'Target.setAutoAttach') {
      if (sessionId || params.flatten !== true || params.waitForDebuggerOnStart !== false || typeof params.autoAttach !== 'boolean') throw fault('Invalid owned attachment request.', 'UNSUPPORTED');
    } else if (!['Runtime.enable', 'Runtime.evaluate', 'Page.getFrameTree'].includes(method) || !r.targets.has(sessionId)) throw fault('CDP operation is outside the owned page.', 'UNSUPPORTED');
    const id = ++this.nextId;
    let resolve, reject;
    const reply = new Promise((yes, no) => { resolve = yes; reject = no; }); reply.catch(() => {});
    r.requests.set(id, { resolve, reject, sessionId });
    try {
      // Dispatch once only, including when sendMessage resolves late or rejects.
      await bounded(r.group.sendMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) }), this.evaluationTimeout, 'Owned browser send did not complete.', signal);
      return await bounded(reply, this.evaluationTimeout, 'Owned browser response did not complete.', signal);
    } finally { r.requests.delete(id); }
  }
  async _evaluate(target, expression, generation, signal, navigation = false) {
    this._check(generation, target, signal);
    const context = target.context;
    const reply = await this._cdp(target.resource, 'Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: false, silent: true, timeout: this.evaluationTimeout,
      ...(context.uniqueId ? { uniqueContextId: context.uniqueId } : { contextId: context.id }),
    }, target.sessionId, signal);
    this._check(generation, navigation ? undefined : target, signal);
    if (reply?.exceptionDetails || !['number', 'string', 'boolean'].includes(typeof reply?.result?.value)) throw fault('Owned browser returned an invalid evaluation response.', 'INVALID_RESPONSE');
    return reply.result.value;
  }
  async _eval(target, expression, generation, signal) {
    const value = await this._evaluate(target, expression, generation, signal);
    return typeof value === 'string' ? value : String(value);
  }
  async _number(target, expression, generation, signal) {
    const value = await this._evaluate(target, expression, generation, signal);
    if (!Number.isSafeInteger(value)) throw fault('Owned browser returned an invalid numeric response.', 'INVALID_RESPONSE');
    return value;
  }
  async _discover(generation, signal) {
    const deadline = this.now() + this.discoverTimeout;
    do {
      this._check(generation, undefined, signal);
      const matches = [];
      for (const r of this.resources) {
        if (r.closed || r.tabClosed || !r.group || !canonical(r.tab.url)) continue;
        // Multiple root pages in one owned group are ambiguous, not permission
        // to choose the active tab or the first target that happens to match.
        if (r.targets.size > 1) throw fault('Owned browser page is ambiguous. Disconnect and reconnect.', 'AMBIGUOUS_TARGET');
        for (const live of r.targets.values()) {
          if (!live.initialized) {
            await this._cdp(r, 'Runtime.enable', {}, live.sessionId, signal); this._check(generation, undefined, signal);
            live.initialized = true;
          }
          const tree = await this._cdp(r, 'Page.getFrameTree', {}, live.sessionId, signal); this._check(generation, undefined, signal);
          const frameId = tree?.frameTree?.frame?.id;
          if (typeof frameId !== 'string') continue;
          for (const context of live.contexts.values()) {
            if (context.frameId !== frameId) continue;
            const target = { resource: r, sessionId: live.sessionId, context, epoch: live.epoch };
            try { if (await this._number(target, `(${PAGE_GUARD})?1:0`, generation, signal) === 1) matches.push(target); }
            catch (_) { this._check(generation, undefined, signal); }
          }
        }
      }
      this._check(generation, undefined, signal);
      if (matches.length > 1) throw fault('Owned browser context is ambiguous. Disconnect and reconnect.', 'AMBIGUOUS_TARGET');
      if (matches.length === 1) { this.target = matches[0]; if (!this.token) this.token = crypto.randomUUID(); this._setConnected(true); return true; }
      await this.pause(100);
    } while (this.now() < deadline);
    this._setConnected(false);
    throw fault('Finish normal login in the owned TensorTonic browser, then choose Connect again. No login information was copied.', 'LOGIN_OR_PAGE_REQUIRED');
  }
  connect(options) { return this.start(options); }
  confirmConnection(options) { return this.start(options); }
  restore() { return Promise.resolve(false); }
  async start({ signal } = {}) {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    const task = this._start(this.generation, signal); this.starting = task;
    try { return await task; } finally { if (this.starting === task) this.starting = undefined; }
  }
  async _acquire(r, key, create, generation, signal) {
    // Keep late resources owned: cancel/timeout never abandons a tab or group.
    const raw = Promise.resolve().then(create).then(async value => {
      r[key] = value;
      if (this.disposed || this.stopping || this.generation !== generation) await this._closeResource(r);
      return value;
    });
    r.opening = raw; this.launching = raw;
    const settled = () => { if (r.opening === raw) r.opening = undefined; if (this.launching === raw) this.launching = undefined; };
    raw.then(settled, settled);
    try { const value = await bounded(raw, this.launchTimeout, 'Owned browser launch did not complete. If the browser proposal is not enabled, launch VS Code with --enable-proposed-api choru-local.tensortonic-vscode and fully restart it.', signal); this._check(generation, undefined, signal); return value; }
    catch (error) { if (this.generation === generation) this.generation++; this.cleanupPending = this.resources.size > 0; throw error; }
  }
  async _start(generation, signal) {
    this._check(generation, undefined, signal);
    const v = this.vscode;
    if (this.cleanupPending) throw fault('Owned browser cleanup is pending. Disconnect again before connecting.', 'CLEANUP_PENDING');
    if (this.pending) throw fault('Wait for the current TensorTonic operation before reconnecting.', 'BUSY');
    let browser;
    try {
      browser = v.window;
      if (typeof browser?.openBrowserTab !== 'function' || v.env?.remoteName || v.env?.uiKind === 2) throw Error();
      this._listenTabs(browser);
    } catch (_) {
      for (const listener of this.listeners) listener.dispose(); this.listeners = [];
      throw fault('TensorTonic requires a supported local VS Code desktop and the experimental browser API enabled for this extension only. Launch VS Code with --enable-proposed-api choru-local.tensortonic-vscode and fully restart it; do not change product.json or global security policies.', 'UNAVAILABLE');
    }
    for (const r of [...this.resources]) if (r.closed || r.tabClosed) await this._closeResource(r);
    this._check(generation, undefined, signal);
    if (!this.resources.size) {
      this.token = undefined;
      const r = { targets: new Map(), requests: new Map(), listeners: [], closed: false, tabClosed: false }; this.resources.add(r);
      try {
        await this._acquire(r, 'tab', () => v.window.openBrowserTab('https://www.tensortonic.com/', { viewColumn: v.ViewColumn?.Beside ?? -2, preserveFocus: true, background: false }), generation, signal);
        if (typeof r.tab?.startCDPSession !== 'function') throw fault('The experimental browser API is unavailable. Launch with --enable-proposed-api choru-local.tensortonic-vscode and fully restart VS Code; this opt-in applies to this extension only.', 'UNAVAILABLE');
        await this._acquire(r, 'group', () => r.tab.startCDPSession(), generation, signal);
        r.listeners.push(r.group.onDidReceiveMessage(message => this._onMessage(r, message)));
        r.listeners.push(r.group.onDidClose(() => {
          r.closed = true; this.token = undefined; this._invalidate(r);
          for (const entry of r.requests.values()) entry.reject(fault('Owned browser transport closed.', 'DISCONNECTED'));
          r.requests.clear();
        }));
        await this._cdp(r, 'Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false });
        this._check(generation, undefined, signal);
      } catch (error) {
        this._setConnected(false);
        if (!r.opening) await this._closeResource(r).catch(() => {});
        throw error;
      }
    }
    try { return await this._discover(generation, signal); }
    catch (error) {
      // Login/page-not-ready retains the visible tab, but an explicitly canceled
      // Connect must not leave its acquired browser resources running.
      if (error.code === 'CANCELED' && this.generation === generation) await this.stop().catch(() => {});
      throw error;
    }
  }
  async openProblemPage(value, { signal } = {}) {
    const url = problemUrl(value); if (!url) throw fault('Only canonical TensorTonic problem pages can be opened.', 'UNSUPPORTED');
    if (this.pending || this.navigating) throw fault('Wait for the current operation before navigating.', 'BUSY');
    this.navigating = true;
    try {
      await this.start({ signal });
      const generation = this.generation, target = this.target;
      const study = `(${PAGE_GUARD}) && /^\\/(?:$|problems(?:\\/[a-zA-Z0-9-]+)?\\/?$)/.test(location.pathname)`;
      try {
        const result = await this._evaluate(target, `(()=>{if(!(${study}))return 0;location.assign(${JSON.stringify(url)});return 1})()`, generation, signal, true);
        if (result !== 1) throw fault('Finish the current login or account flow before opening another problem. It was not redirected.', 'PAGE_CHANGED');
      } catch (error) {
        this._check(generation, undefined, signal);
        if (!['TRANSPORT_ERROR', 'TIMEOUT'].includes(error.code)) throw error;
      }
      const expected = new URL(url), deadline = this.now() + this.discoverTimeout;
      do {
        await this.pause(100); await this._discover(generation, signal);
        const exact = `(${PAGE_GUARD}) && location.origin===${JSON.stringify(expected.origin)} && location.pathname===${JSON.stringify(expected.pathname)} && location.search===${JSON.stringify(expected.search)}`;
        if (await this._number(this.target, `(${exact})?1:0`, generation, signal) === 1) return { requested: true, target: 'native-owned' };
      } while (this.now() < deadline);
      throw fault('Owned browser did not reach the requested page. Navigation was not repeated.', 'PAGE_CHANGED');
    } finally { this.navigating = false; if (!this.target) this._setConnected(false); }
  }
  request(apiPath, options = {}) {
    const method = options.method || 'GET';
    if (!isAllowedRequest(apiPath, method) || (method === 'POST' && !validateBody(options.body, apiPath))) return Promise.reject(fault('Unsupported TensorTonic request.', 'UNSUPPORTED'));
    let body;
    try { body = method === 'POST' ? JSON.stringify(options.body) : undefined; }
    catch (_) { return Promise.reject(fault('Invalid TensorTonic request body.', 'UNSUPPORTED')); }
    if (body && Buffer.byteLength(body) > MAX_BODY) return Promise.reject(fault('TensorTonic request is too large.', 'TOO_LARGE'));
    if (this.navigating) return Promise.reject(fault('The owned browser is navigating. Wait before issuing another operation.', 'BUSY'));
    if (this.pending) return Promise.reject(fault('Another TensorTonic browser operation is in progress. Nothing was queued or replayed.', 'BUSY'));
    if (!this.connected || !this.target) return Promise.reject(fault('Connect the built-in TensorTonic browser first.', 'DISCONNECTED'));
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    if (options.signal) { options.signal.addEventListener('abort', externalAbort, { once: true }); if (options.signal.aborted) controller.abort(); }
    const operation = { controller, generation: this.generation, session: this.target, key: '__tt_native_' + crypto.randomBytes(24).toString('hex') };
    this.pending = operation;
    return this._request(apiPath, method, body, operation).finally(() => {
      if (options.signal) options.signal.removeEventListener('abort', externalAbort);
      if (this.pending === operation) this.pending = undefined;
    });
  }
  async _request(apiPath, method, body, operation) {
    const { generation, session, key, controller } = operation; const signal = controller.signal;
    const slot = `globalThis[${JSON.stringify(key)}]`;
    // The page owns normal browser authentication. No cookie/storage/header value
    // is read, copied, persisted, or returned. Slot data contains only this request.
    const guard = `(${PAGE_GUARD})`;
    const start = `(()=>{if(!${guard})return -2;if(Object.prototype.hasOwnProperty.call(globalThis,${JSON.stringify(key)}))return -4;const c=new AbortController();const s={state:0,c,document:document};${slot}=s;s.timer=setTimeout(()=>{if(${slot}===s){c.abort();delete ${slot}}},${this.requestTimeout + 10000});(async()=>{try{const r=await fetch(${JSON.stringify('https://api.tensortonic.com' + apiPath)},{method:${JSON.stringify(method)},credentials:'include',redirect:'error',cache:'no-store',signal:c.signal${method === 'POST' ? ",headers:{'Content-Type':'application/json'},body:" + JSON.stringify(body) : ''}});const reader=r.body.getReader();let n=0;const a=[];while(true){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;if(n>${this.maxResponseBytes}){c.abort();s.state=-5;return}a.push(x.value)}const bytes=new Uint8Array(n);let o=0;for(const x of a){bytes.set(x,o);o+=x.length}let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));if(${slot}!==s||s.document!==document)return;s.data=btoa(binary);s.status=r.status;s.state=1}catch{if(${slot}===s)s.state=-1}})();return 1})()`;
    const safeSlot = `${guard} && ${slot} && ${slot}.document===document`;
    const deadline = this.now() + this.requestTimeout;
    let dispatched = false;
    try {
      // Never retry this evaluation: it may have dispatched even if CDP times out.
      this._check(generation, session, signal);
      dispatched = true;
      const started = await this._number(session, start, generation, signal);
      if (started !== 1) throw fault('TensorTonic browser scope changed before the request. Reconnect manually.', 'PAGE_CHANGED');
      let state;
      do {
        state = await this._number(session, `(${safeSlot})?${slot}.state:-2`, generation, signal);
        if (state !== 0) break;
        if (this.now() >= deadline) throw fault('TensorTonic response timed out. Check the website before retrying a Run or Submit.', 'TIMEOUT');
        await this.pause(75); this._check(generation, session, signal);
      } while (true);
      if (state !== 1) throw fault(state === -5 ? 'TensorTonic response exceeded the safe size limit.' : 'TensorTonic browser request did not complete. Check the website before retrying a Run or Submit.', state === -5 ? 'TOO_LARGE' : 'UNCERTAIN_RESULT');
      const status = await this._number(session, `(${safeSlot})?${slot}.status:-2`, generation, signal);
      if (status === 401 || status === 403) throw fault('Sign in normally in the owned TensorTonic browser, then explicitly Refresh or retry. No login information was copied.', 'AUTH_REQUIRED');
      if (status < 200 || status >= 300) throw fault(`TensorTonic returned HTTP ${status}. No request was replayed.`, 'HTTP_ERROR');
      const length = await this._number(session, `(${safeSlot})?${slot}.data.length:-2`, generation, signal);
      if (length < 0 || length > Math.ceil(this.maxResponseBytes / 3) * 4) throw fault('Invalid TensorTonic response length.', 'INVALID_RESPONSE');
      let encoded = ''; let chunkSize = 4096;
      while (encoded.length < length) {
        if (this.now() >= deadline) throw fault('Response retrieval timed out; no upstream request was repeated.', 'TIMEOUT');
        const wanted = Math.min(chunkSize, length - encoded.length);
        const chunk = await this._eval(session, `(${safeSlot})?${slot}.data.slice(${encoded.length},${encoded.length + wanted}):''`, generation, signal);
        const decoded = displayedBase64(chunk, wanted);
        if (decoded === undefined) {
          if (chunkSize <= 64) throw fault('Browser response was truncated or invalid; no upstream request was repeated.', 'INVALID_RESPONSE');
          chunkSize = Math.max(64, Math.floor(chunkSize / 2)); continue;
        }
        encoded += decoded;
      }
      this._check(generation, session, signal);
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > this.maxResponseBytes || bytes.toString('base64') !== encoded) throw fault('Invalid response encoding.', 'INVALID_RESPONSE');
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch (_) { throw fault('TensorTonic returned invalid JSON. No request was replayed.', 'INVALID_RESPONSE'); }
    } catch (error) {
      if (dispatched && method === 'POST' && !['AUTH_REQUIRED', 'HTTP_ERROR', 'UNSUPPORTED'].includes(error.code)) {
        throw fault('Run or Submit outcome is uncertain. Check the website before explicitly trying again; the extension did not retry or switch transports.', 'UNCERTAIN_RESULT');
      }
      throw error;
    } finally {
      // Cleanup is scoped to the random operation slot and document only. Ignore
      // its result; never evaluate another request to compensate for lost output.
      try {
        this._check(generation, session);
        await this._evaluate(session, `(()=>{if(!${guard})return 0;const s=${slot};if(s&&s.document===document){clearTimeout(s.timer);s.c.abort();delete ${slot}}return 1})()`, generation);
      } catch (_) { /* Document changed or transport closed: never reuse stale context IDs. */ }
    }
  }
  async _closeResource(r) {
    if (r.closing) return r.closing;
    const work = (async () => {
      let failed = false;
      if (r.group && !r.closed) {
        if (r.listeners.length) await this._cdp(r, 'Target.setAutoAttach', { autoAttach: false, flatten: true, waitForDebuggerOnStart: false }).catch(() => {});
        try { await bounded(r.group.close(), this.cleanupTimeout, 'Owned browser session cleanup pending.'); r.closed = true; }
        catch (_) { failed = true; }
      }
      if (r.tab && !r.tabClosed) {
        try { await bounded(r.tab.close(), this.cleanupTimeout, 'Owned browser tab cleanup pending.'); r.tabClosed = true; }
        catch (_) { failed = true; }
      }
      if (failed) { this.cleanupPending = true; throw fault('Owned browser cleanup is pending. Disconnect again; unrelated tabs were not touched.', 'CLEANUP_PENDING'); }
      for (const entry of r.requests.values()) entry.reject(fault('Owned browser transport closed.', 'DISCONNECTED'));
      r.requests.clear(); r.targets.clear();
      for (const listener of r.listeners) listener.dispose(); r.listeners = [];
      this.resources.delete(r); this.cleanupPending = this.resources.size > 0;
    })();
    r.closing = work;
    try { await work; } finally { if (r.closing === work) r.closing = undefined; }
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.generation++; this.pending?.controller.abort();
    this.target = undefined; this.token = undefined; this._setConnected(false);
    const work = (async () => {
      for (const r of [...this.resources]) {
        if (r.opening) await bounded(r.opening, this.launchTimeout, 'Owned browser launch is still settling.').catch(() => {});
        if (r.opening) { this.cleanupPending = true; throw fault('Owned browser launch cleanup is pending. Late resources will be closed without touching other tabs.', 'CLEANUP_PENDING'); }
        await this._closeResource(r);
      }
      this.cleanupPending = this.resources.size > 0;
    })();
    this.stopping = work;
    return work.finally(() => { if (this.stopping === work) this.stopping = undefined; });
  }
  shutdown() { return this.stop(); }
  revoke() { return this.stop(); }
  async dispose() {
    try { await this.stop(); } finally {
      this.disposed = true;
      for (const listener of this.listeners) listener.dispose(); this.listeners = [];
    }
  }
}
module.exports = { NativeBrowserBridge, displayedBase64, problemUrl, MAX_RESPONSE, MAX_BODY };
