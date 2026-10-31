'use strict';

const crypto = require('node:crypto');
const { isAllowedRequest, validateBody, ORIGINS } = require('./bridge');
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

// DAP display strings are not transport-safe JSON. Only a bounded base64 alphabet
// is accepted, and the exact chunk length is verified before decoding. Truncated
// display output causes a smaller READ retry, never another HTTP dispatch.
function displayedBase64(result, length) {
  if (typeof result !== 'string') return undefined;
  let value = result;
  if ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")) value = value.slice(1, -1);
  return value.length === length && /^[A-Za-z0-9+/=]*$/.test(value) ? value : undefined;
}

class NativeBrowserBridge {
  constructor(vscode, { now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
    discoverTimeout = 15000, evaluationTimeout = 5000, requestTimeout = 180000, maxResponseBytes = MAX_RESPONSE, launchTimeout = 20000, cleanupTimeout = 5000 } = {}) {
    this.vscode = vscode; this.now = now; this.pause = pause;
    this.discoverTimeout = discoverTimeout; this.evaluationTimeout = evaluationTimeout;
    this.launchTimeout = launchTimeout; this.cleanupTimeout = cleanupTimeout;
    this.requestTimeout = requestTimeout; this.maxResponseBytes = Math.min(MAX_RESPONSE, maxResponseBytes);
    this.connected = false; this.token = undefined; this.onDidChange = undefined;
    this.sessions = new Map(); this.ownerNames = new Set(); this.ownerGenerations = new Map(); this.generation = 0;
    this.target = undefined; this.pending = undefined; this.starting = undefined; this.launching = undefined;
    this.stopping = undefined; this.disposed = false; this.cleanupPending = false;
    this.listeners = [];
    if (vscode.debug && vscode.debug.onDidStartDebugSession && vscode.debug.onDidTerminateDebugSession) {
      this.listeners.push(vscode.debug.onDidStartDebugSession(session => {
        if (this._owns(session)) {
          this.sessions.set(session.id, session);
          let root = session; while (root.parentSession) root = root.parentSession;
          if (this.disposed || this.stopping || this.ownerGenerations.get(root.name) !== this.generation) {
            Promise.resolve(vscode.debug.stopDebugging(session)).catch(() => {});
          }
        }
      }));
      this.listeners.push(vscode.debug.onDidTerminateDebugSession(session => {
        if (!this.sessions.has(session.id)) return;
        this.sessions.delete(session.id);
        if (this.target && this.target.id === session.id) { this.target = undefined; if (!this.navigating) this._setConnected(false); }
        if (!session.parentSession) { this.token = undefined; this._setConnected(false); }
        if (this.sessions.size === 0) this.cleanupPending = false;
      }));
    }
  }
  _owns(session) {
    let current = session;
    for (let depth = 0; current && depth < 16; depth++, current = current.parentSession) {
      if (!current.parentSession && this.ownerNames.has(current.name) &&
          ['editor-browser', 'pwa-editor-browser'].includes(current.type)) return true;
    }
    return false;
  }
  _setConnected(value) { if (this.connected !== value) { this.connected = value; if (this.onDidChange) this.onDidChange(); } }
  _check(generation, session, signal) {
    if (this.disposed || this.stopping || generation !== this.generation || this.vscode.workspace.isTrusted !== true || (signal && signal.aborted)) throw fault('Native browser connection changed or was canceled. No request was replayed.', 'CANCELED');
    if (session && (!this.sessions.has(session.id) || !this._owns(session))) throw fault('The owned TensorTonic browser session ended. Connect again.', 'DISCONNECTED');
  }
  async _eval(session, expression, generation, signal) {
    this._check(generation, session, signal);
    const reply = await bounded(session.customRequest('evaluate', { expression, context: 'watch' }), this.evaluationTimeout,
      'Native browser evaluation did not complete. A dispatched Run or Submit may have completed; check the website before retrying.', signal);
    this._check(generation, session, signal);
    if (!reply || typeof reply.result !== 'string') throw fault('Native browser returned an unsupported response.', 'INVALID_RESPONSE');
    return reply.result;
  }
  async _number(session, expression, generation, signal) {
    const value = await this._eval(session, expression, generation, signal);
    if (!/^-?\d+$/.test(value)) throw fault('Native browser returned an invalid numeric response.', 'INVALID_RESPONSE');
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw fault('Native browser returned an invalid numeric response.', 'INVALID_RESPONSE');
    return number;
  }
  async _discover(generation, signal) {
    const deadline = this.now() + this.discoverTimeout;
    do {
      this._check(generation, undefined, signal);
      const owned = [...this.sessions.values()].filter(session => this._owns(session));
      const leaves = owned.filter(session => !owned.some(other => other.parentSession && other.parentSession.id === session.id));
      const matches = [];
      for (const session of leaves) {
        try { if (await this._number(session, `(${PAGE_GUARD})?1:0`, generation, signal) === 1) matches.push(session); }
        catch (error) { this._check(generation, undefined, signal); if (error.code === 'CANCELED') throw error; }
      }
      this._check(generation, undefined, signal);
      if (matches.length > 1) throw fault('More than one owned TensorTonic page matched. Disconnect and connect a single browser page.', 'AMBIGUOUS_TARGET');
      if (matches.length === 1) { this.target = matches[0]; if (!this.token) this.token = crypto.randomUUID(); this._setConnected(true); return true; }
      await this.pause(100); this._check(generation, undefined, signal);
    } while (this.now() < deadline);
    this._setConnected(false);
    throw fault('No owned TensorTonic browser page is ready. Finish normal login in the opened browser, then choose Connect again. Do not change security policies.', 'LOGIN_OR_PAGE_REQUIRED');
  }
  connect(options) { return this.start(options); }
  confirmConnection(options) { return this.start(options); }
  restore() { return Promise.resolve(false); }
  async start({ signal } = {}) {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    const generation = this.generation;
    const task = this._start(generation, signal); this.starting = task;
    try { return await task; } finally { if (this.starting === task) this.starting = undefined; }
  }
  async _start(generation, signal) {
    this._check(generation, undefined, signal);
    const v = this.vscode;
    if (this.cleanupPending) throw fault('Previous owned browser cleanup is still pending. Disconnect again before opening another native connection.', 'CLEANUP_PENDING');
    if (!v.debug || !v.debug.startDebugging || !v.debug.stopDebugging ||
        !v.workspace || v.workspace.isTrusted !== true || (v.env && (v.env.remoteName || v.env.uiKind === 2))) {
      throw fault('Native TensorTonic connection requires a trusted local VS Code desktop with the built-in JavaScript debugger.', 'UNAVAILABLE');
    }
    if (this.pending) throw fault('Wait for the current TensorTonic operation before reconnecting.', 'BUSY');
    if (![...this.sessions.values()].some(session => this._owns(session))) {
      const name = 'TensorTonic native ' + crypto.randomBytes(16).toString('hex');
      this.ownerNames.add(name); this.ownerGenerations.set(name, generation);
      const launch = v.debug.startDebugging(undefined, { type: 'editor-browser', request: 'launch', name, url: 'https://www.tensortonic.com/' }, { suppressSaveBeforeStart: true });
      this.launching = launch;
      const settled = () => { if (this.launching === launch) this.launching = undefined; if (this.sessions.size === 0 && !this.launching) this.cleanupPending = false; };
      Promise.resolve(launch).then(settled, settled);
      let accepted;
      try {
        accepted = await bounded(launch, this.launchTimeout, 'The native browser did not launch. Use a VS Code version with Integrated Browser; no security policy was changed.', signal);
      } catch (error) {
        // Canceling this method alone invalidates the launch, even when callers
        // do not separately invoke stop(). Late owned events are stopped by ID.
        if (this.generation === generation) this.generation++;
        this.cleanupPending = !!this.launching || this.sessions.size > 0;
        this._setConnected(false); this.token = undefined;
        for (const candidate of this.sessions.values()) if (this._owns(candidate)) Promise.resolve(v.debug.stopDebugging(candidate)).catch(() => {});
        throw error;
      }
      this._check(generation, undefined, signal);
      if (!accepted) throw fault('The native browser launch was declined or unavailable.', 'UNAVAILABLE');
    }
    return this._discover(generation, signal);
  }

  async openProblemPage(value, { signal } = {}) {
    const url = problemUrl(value); if (!url) throw fault('Only canonical TensorTonic problem pages can be opened.', 'UNSUPPORTED');
    if (this.pending || this.navigating) throw fault('Wait for the current TensorTonic operation before navigating its browser.', 'BUSY');
    this.navigating = true;
    try {
    await this.start({ signal });
    const generation = this.generation, session = this.target;
    // Do not take over an owned page that the user manually navigated to account,
    // billing, or an in-progress login flow. Only the study surface may navigate.
    const study = `(${PAGE_GUARD}) && /^\\/(?:$|problems(?:\\/[a-zA-Z0-9-]+)?\\/?$)/.test(location.pathname)`;
    this._check(generation, session, signal);
    let result;
    try {
      // Navigation can destroy the old debug context BEFORE evaluate replies.
      // Do not require that child to survive, and never reissue location.assign.
      const reply = await bounded(session.customRequest('evaluate', {
        expression: `(()=>{if(!(${study}))return 0;location.assign(${JSON.stringify(url)});return 1})()`, context: 'watch',
      }), this.evaluationTimeout, 'The owned browser navigation did not confirm completion.', signal);
      this._check(generation, undefined, signal);
      result = reply && reply.result;
      if (result !== '1') throw fault('The owned browser is on another page or login flow. Finish that flow, then reconnect; it was not redirected.', 'PAGE_CHANGED');
    } catch (error) {
      this._check(generation, undefined, signal);
      if (!['TRANSPORT_ERROR', 'TIMEOUT'].includes(error.code)) throw error;
      // A lost evaluation reply is uncertain, not permission to navigate again.
      // Confirm the exact intended page in the replacement owned context below.
    }
    const expected = new URL(url); const deadline = this.now() + this.discoverTimeout;
    do {
      await this.pause(100); this._check(generation, undefined, signal);
      await this._discover(generation, signal);
      const exact = `(${PAGE_GUARD}) && location.origin===${JSON.stringify(expected.origin)} && location.pathname===${JSON.stringify(expected.pathname)} && location.search===${JSON.stringify(expected.search)}`;
      try { if (await this._number(this.target, `(${exact})?1:0`, generation, signal) === 1) return { requested: true, target: 'native-owned' }; }
      catch (_) { this._check(generation, undefined, signal); }
    } while (this.now() < deadline);
    throw fault('The owned browser did not reach the requested problem page. It was not navigated a second time.', 'PAGE_CHANGED');
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
      // Never retry this evaluation: it may have dispatched even if DAP times out.
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
          if (chunkSize <= 64) throw fault('Debugger response was truncated or invalid; no upstream request was repeated.', 'INVALID_RESPONSE');
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
      if (this.sessions.has(session.id) && this._owns(session)) {
        await bounded(session.customRequest('evaluate', { expression: `(()=>{if(!${guard})return 0;const s=${slot};if(s&&s.document===document){clearTimeout(s.timer);s.c.abort();delete ${slot}}return 1})()`, context: 'watch' }), this.evaluationTimeout, 'Native request cleanup failed.').catch(() => {});
      }
    }
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.generation++; if (this.pending) this.pending.controller.abort();
    this.target = undefined; this.token = undefined; this._setConnected(false);
    const work = (async () => {
      if (this.launching) await bounded(this.launching, this.launchTimeout, 'Native launch cleanup pending.').catch(() => {});
      if (this.launching) { this.cleanupPending = true; throw fault('Native launch is still settling. Cleanup will stop only its late owned sessions; do not start another connection yet.', 'CLEANUP_PENDING'); }
      // Roots first; exact descendant identity is retained for children surviving
      // root termination. Never use the active user debugger or stop-all command.
      const owned = [...this.sessions.values()].filter(session => this._owns(session));
      for (const session of owned.sort((a, b) => Number(!!a.parentSession) - Number(!!b.parentSession))) {
        if (this.sessions.has(session.id) && this._owns(session)) await bounded(this.vscode.debug.stopDebugging(session), this.cleanupTimeout, 'Owned native session cleanup failed.').catch(() => {});
      }
      const deadline = this.now() + this.cleanupTimeout;
      while ([...this.sessions.values()].some(session => this._owns(session)) && this.now() < deadline) await this.pause(50);
      if ([...this.sessions.values()].some(session => this._owns(session))) { this.cleanupPending = true; throw fault('An owned TensorTonic debugger session did not stop. Use its normal Stop control; unrelated debuggers were not touched.', 'CLEANUP_PENDING'); }
      this.cleanupPending = false;
    })();
    this.stopping = work;
    return work.finally(() => { if (this.stopping === work) this.stopping = undefined; });
  }
  shutdown() { return this.stop(); }
  revoke() { return this.stop(); }
  async dispose() {
    try { await this.stop(); } finally {
      this.disposed = true;
      const clear = () => { for (const listener of this.listeners) listener.dispose(); this.listeners = []; };
      if (this.launching) Promise.resolve(this.launching).then(clear, clear); else clear();
    }
  }
}
module.exports = { NativeBrowserBridge, displayedBase64, problemUrl, MAX_RESPONSE, MAX_BODY };
