'use strict';
const { emitDiagnostic, diagnosticErrorCode } = require('./focus-diagnostics');
const { verifyNavbar, installNavbarGuard, NAVBAR_BASE, NAVBAR_CANDIDATE, NAVBAR_MARKER } = require('./focus-navbar');

const crypto = require('node:crypto');
const { isAllowedRequest, validateBody, ORIGINS } = require('./request-policy');
const { FOCUS_CONTRACT } = require('./focus-contract');
const MAX_RESPONSE = 8 * 1024 * 1024;
const MAX_BODY = 1024 * 1024;
const SLUG = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';
const PAGE_GUARD = `window===window.top && (${JSON.stringify([...ORIGINS])}).includes(location.origin)`;
const FOCUS_GATES = new WeakMap();
// A private brand for Chromium's exact response to our own stylesheet probe.
// Arbitrary error codes/messages from callers or other protocol methods cannot
// become proof of cleanup, and raw protocol details never leave this module.
const MISSING_FOCUS_SHEETS = new WeakMap();
const FOCUS_URL = new RegExp(`^https://www\\.tensortonic\\.com/problems/${SLUG}(?:\\?studyPlan=${SLUG})?$`);
const focusCore = value => JSON.stringify({ id: value?.id, verified: value?.verified, surface: value?.surface, hidesSecurityUI: value?.hidesSecurityUI, targets: Array.isArray(value?.targets) ? value.targets.map(target => ({ id: target?.id, selector: target?.selector, count: target?.count })) : undefined, cssText: value?.cssText });
const focusFull = value => JSON.stringify({ core: focusCore(value), expectations: Array.isArray(value?.targets) ? value.targets.map(target => target?.expectation || target?.expect) : undefined });
const sameFocusPage = (left, right) => !!left && !!right && left.owned === true && right.owned === true && ['id', 'url', 'documentId', 'frameId'].every(key => left[key] === right[key]);
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
    Promise.resolve(promise).then(value => done(resolve, value), error => done(reject,
      MISSING_FOCUS_SHEETS.has(error) ? error : fault(message, 'TRANSPORT_ERROR')));
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
    this.focusSheets = new Map(); FOCUS_GATES.set(this, Symbol('owned presentation protocol'));
  }
  _listenTabs(w) {
    if (this.listeners.length) return;
    if (w && w.onDidCloseBrowserTab) this.listeners.push(w.onDidCloseBrowserTab(tab => {
      for (const r of this.resources) if (r.tab === tab) { r.tabClosed = true; this._focusGone(r, undefined, undefined, 'page-closed'); this.token = undefined; this._invalidate(r); this._displayState(r, true); }
    }));
    if (w && w.onDidChangeBrowserTabState) this.listeners.push(w.onDidChangeBrowserTabState(tab => {
      for (const r of this.resources) if (r.tab === tab) {
        this._displayState(r);
        if (!canonical(tab.url)) this._invalidate(r);
      }
    }));
  }
  _displayState(resource, closed = false) {
    if (typeof this.onDisplayPage !== 'function') return;
    let ref;
    if (!closed) {
      try {
        const url = new URL(resource.tab.url);
        const match = new RegExp(`^/problems/(${SLUG})/?$`).exec(url.pathname);
        const planId = url.searchParams.get('studyPlan');
        if (url.origin === 'https://www.tensortonic.com' && match && !url.username && !url.password && url.searchParams.getAll('studyPlan').length <= 1 && (!planId || new RegExp(`^${SLUG}$`).test(planId))) ref = Object.freeze({ slug: match[1], ...(planId ? { planId } : {}) });
      } catch (_) { /* Unknown routes provide no problem identity. */ }
    }
    // Presentation metadata from this exact owned tab only. Never forward raw
    // auth URLs, arbitrary query values, page content, credentials or targets.
    try { this.onDisplayPage(Object.freeze({ closed, ...(ref ? { ref } : {}) })); } catch (_) {}
  }
  get hasOwnedResources() { return this.resources.size > 0 || !!this.launching; }
  get presentationState() {
    // Compare only the public active-tab reference with resources we already own.
    // Never enumerate other tabs or expose their URL, title, content or CDP group.
    const owned = [...this.resources].filter(resource => !resource.tabClosed && resource.tab);
    const active = this.vscode.window?.activeBrowserTab;
    return Object.freeze({ open: owned.length > 0, otherBrowserActive: !!active && !owned.some(resource => resource.tab === active) });
  }
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
      if (message.error) {
        const sheet = entry.focusReadSheet;
        if (sheet && this.focusSheets.get(sheet.id) === sheet && sheet.resource === r &&
            sheet.nativeId === entry.focusNativeId && sheet.target.sessionId === entry.sessionId &&
            this.resources.has(r) && !r.closed && !r.tabClosed && r.targets.size === 1 && r.targets.has(entry.sessionId) &&
            message.error.code === -32000 && message.error.message === 'No style sheet with given id found') {
          const error = fault('The owned focus stylesheet no longer exists.', 'FOCUS_SHEET_ABSENT');
          MISSING_FOCUS_SHEETS.set(error, { sheet, resource: r, sessionId: entry.sessionId });
          entry.reject(error);
        } else entry.reject(fault('Owned browser protocol request failed.', 'TRANSPORT_ERROR'));
      }
      else entry.resolve(message.result);
      return;
    }
    const p = message.params;
    if (message.method === 'CSS.styleSheetRemoved') {
      let changed = false;
      for (const sheet of this.focusSheets.values()) if (sheet.nativeId === p?.styleSheetId && sheet.resource === r && sheet.target.sessionId === message.sessionId) { sheet.gone = 'sheet-removed'; changed = true; }
      if (changed) this._displayState(r);
      return;
    }
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
      if (message.method === 'Runtime.executionContextsCleared') { for (const sheet of this.focusSheets.values()) if (sheet.resource === r && sheet.target.sessionId === message.sessionId) sheet.navbarGuard = undefined; this.focusProof = undefined; this._invalidate(r, message.sessionId); this._displayState(r); }
      else if (message.method === 'Runtime.executionContextDestroyed') {
        if (target.contexts.has(p?.executionContextId)) { for (const sheet of this.focusSheets.values()) if (sheet.resource === r && sheet.target.sessionId === message.sessionId && sheet.target.context.id === p.executionContextId) sheet.navbarGuard = undefined; this.focusProof = undefined; this._invalidate(r, message.sessionId); this._displayState(r); }
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
  setFocusContract(value) {
    if (focusFull(value) !== focusFull(FOCUS_CONTRACT)) throw fault('Only the fixed reviewed problem-content contract is supported.', 'INVALID_CONTRACT');
    if (this.focusContract && focusCore(this.focusContract) !== focusCore(value)) throw fault('The focus contract is already pinned.', 'INVALID_CONTRACT');
    this.focusContract = FOCUS_CONTRACT;
    return true;
  }
  _focusGone(resource, sessionId, contextId, reason) {
    for (const sheet of this.focusSheets.values()) {
      if (sheet.resource === resource && (!sessionId || sheet.target.sessionId === sessionId) &&
          (contextId === undefined || sheet.target.context.id === contextId)) sheet.gone = reason;
    }
    const proof = this.focusProof;
    if (proof?.target.resource === resource && (!sessionId || proof.target.sessionId === sessionId) && (contextId === undefined || proof.target.context.id === contextId)) this.focusProof = undefined;
  }
  _focusPage(target, url) {
    const resource = target.resource;
    if (!resource.focusId) resource.focusId = crypto.randomUUID();
    const documentId = crypto.createHash('sha256').update(JSON.stringify([target.sessionId, target.context.uniqueId || target.context.id, target.epoch])).digest('hex');
    return Object.freeze({ id: resource.focusId, url, documentId, frameId: target.context.frameId, owned: true });
  }
  async getFocusPage({ signal, onDiagnostic } = {}) {
    let stage = 'identity-target';
    try {
    const target = this.target, generation = this.generation;
    if (!target) throw fault('No exact owned problem page is available.', 'PAGE_CHANGED');
    this._check(generation, target, signal);
    stage = 'identity-url';
    const url = target.resource.tab.url;
    if (typeof url !== 'string' || !FOCUS_URL.test(url) || url.length > 2048) throw fault('Focus mode requires the exact owned canonical problem page.', 'PAGE_CHANGED');
    stage = 'identity-frame';
    const tree = await this._cdp(target.resource, 'Page.getFrameTree', {}, target.sessionId, signal);
    this._check(generation, target, signal);
    if (tree?.frameTree?.frame?.id !== target.context.frameId) throw fault('The owned top frame changed.', 'PAGE_CHANGED');
    stage = 'identity-location';
    const expression = `(()=>{if(window!==window.top||location.origin!=='https://www.tensortonic.com'||location.origin+location.pathname+location.search!==${JSON.stringify(url)}||location.hash)return '';return JSON.stringify({url:location.origin+location.pathname+location.search})})()`;
    const raw = await this._evaluate(target, expression, generation, signal);
    if (typeof raw !== 'string' || raw.length > 2200) throw fault('Invalid owned page metadata.', 'INVALID_RESPONSE');
    let metadata; try { metadata = JSON.parse(raw); } catch (_) { throw fault('Owned page identity is unavailable.', 'PAGE_CHANGED'); }
    if (metadata?.url !== url || target.resource.tab.url !== url) throw fault('The owned problem page changed.', 'PAGE_CHANGED');
    this.focusAnchor = { resource: target.resource, sessionId: target.sessionId, frameId: target.context.frameId, url };
    return this._focusPage(target, url);
    } catch (error) { emitDiagnostic(onDiagnostic, stage, 'fail', diagnosticErrorCode(error)); throw error; }
  }
  async recoverFocusPage({ signal, onDiagnostic } = {}) {
    if (this.target) return this.getFocusPage({ signal, onDiagnostic });
    const anchor = this.focusAnchor, generation = this.generation;
    const r = anchor?.resource;
    // Explicit Focus action only: no tab launch, navigation, global discovery,
    // other resource adoption, or change to the saved-session transport.
    if (!r || !this.resources.has(r) || r.closed || r.tabClosed || !r.group ||
        r.tab.url !== anchor.url || !FOCUS_URL.test(anchor.url) || r.targets.size !== 1 || !r.targets.has(anchor.sessionId)) throw fault('The original owned Focus page is unavailable.', 'PAGE_CHANGED');
    const deadline = this.now() + Math.min(this.discoverTimeout, this.evaluationTimeout);
    do {
      this._check(generation, undefined, signal);
      if (r.closed || r.tabClosed || r.tab.url !== anchor.url || r.targets.size !== 1 || !r.targets.has(anchor.sessionId)) throw fault('The owned Focus page changed.', 'PAGE_CHANGED');
      const tree = await bounded(this._cdp(r, 'Page.getFrameTree', {}, anchor.sessionId, signal), this.evaluationTimeout, 'Owned Focus frame is unavailable.', signal);
      this._check(generation, undefined, signal);
      if (r.closed || r.tabClosed || r.tab.url !== anchor.url || r.targets.size !== 1 || !r.targets.has(anchor.sessionId)) throw fault('The owned Focus page changed during frame verification.', 'PAGE_CHANGED');
      if (tree?.frameTree?.frame?.id !== anchor.frameId) throw fault('The owned Focus root frame changed.', 'PAGE_CHANGED');
      const live = r.targets.get(anchor.sessionId), matches = [];
      for (const context of live.contexts.values()) {
        if (context.frameId !== anchor.frameId) continue;
        const target = { resource: r, sessionId: anchor.sessionId, context, epoch: live.epoch };
        const expression = `window===window.top && location.origin==='https://www.tensortonic.com' && location.origin+location.pathname+location.search===${JSON.stringify(anchor.url)} && !location.hash ? 1 : 0`;
        try { if (await this._number(target, expression, generation, signal) === 1) matches.push(target); }
        catch (_) { this._check(generation, undefined, signal); }
      }
      if (matches.length > 1) throw fault('The owned Focus context is ambiguous.', 'AMBIGUOUS_TARGET');
      if (matches.length === 1) {
        this._check(generation, matches[0], signal);
        if (r.tab.url !== anchor.url) throw fault('The owned Focus URL changed.', 'PAGE_CHANGED');
        const recovered = matches[0];
        this.target = recovered;
        try { return await this.getFocusPage({ signal, onDiagnostic }); }
        catch (error) {
          // Never retain a partially verified rebind after cancellation or a
          // document/URL change during the final identity checks.
          if (this.target === recovered) this.target = undefined;
          throw error;
        }
      }
      await this.pause(50);
    } while (this.now() < deadline);
    throw fault('The owned Focus page is still loading. Try Focus after it loads.', 'PAGE_CHANGED');
  }
  async waitForFocusReady(page, { signal: externalSignal, onDiagnostic } = {}) {
    const controller = new AbortController(), signal = controller.signal;
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    try {
      const target = this.target, generation = this.generation;
      const deadline = this.now() + Math.min(5000, this.discoverTimeout);
      const check = async () => {
        this._check(generation, target, signal);
        if (!sameFocusPage(page, await this.getFocusPage({ signal, onDiagnostic }))) throw fault('The loading Focus document changed.', 'PAGE_CHANGED');
        this._check(generation, target, signal);
      };
      // Read-only loading classification. Only browser document loading and the
      // reviewed public Navbar SSR placeholders may delay verification. Unknown
      // structures, security UI and failed full proofs are never retried.
      const expression = `(()=>{const base=document.querySelectorAll(${JSON.stringify(NAVBAR_BASE)}),safe=document.querySelectorAll(${JSON.stringify(NAVBAR_CANDIDATE)});if(base.length>1||(base.length===1&&(safe.length!==1||safe[0]!==base[0])))return -1;if(document.readyState==='loading'||document.readyState==='interactive')return 2;if(document.readyState!=='complete'||base.length!==1)return -1;const loading=document.querySelectorAll('div.h-dvh.flex.flex-col.overflow-hidden.relative.bg-background > main.flex-1.overflow-hidden.relative > div.flex.items-center.justify-center.min-h-screen.bg-background > svg[role="status"][aria-label="Loading"][viewBox="10 30 180 140"]');if([...loading].some(e=>e.getClientRects().length))return 3;const n=base[0];const placeholders=[...n.querySelectorAll('div.w-8.h-8.rounded-full.bg-muted.animate-pulse,button.h-8.w-8[class~="md:h-9"][class~="md:w-9"][disabled]')];return placeholders.some(e=>!e.children.length&&!(e.textContent||'').trim())?4:1})()`;
      let verified = false;
      for (let attempt = 0; attempt < 25 && this.now() < deadline; attempt++) {
        const remaining = () => Math.max(1, deadline - this.now());
        await bounded(check(), remaining(), 'Focus readiness timed out.', signal);
        emitDiagnostic(onDiagnostic, 'loading', 'start');
        const loadingState = await bounded(this._number(target, expression, generation, signal), remaining(), 'Focus readiness timed out.', signal);
        await bounded(check(), remaining(), 'Focus readiness timed out.', signal);
        const state = [2, 3, 4].includes(loadingState) ? 0 : loadingState;
        emitDiagnostic(onDiagnostic, 'loading', state === 0 ? 'wait' : state === 1 ? 'ok' : 'fail', ({2:'document',3:'body',4:'account-theme',1:'ready'})[loadingState] || 'blocked');
        if (state !== 0 && state !== 1) throw fault('The loading page structure is not recognized.', 'INVALID_PROOF');
        if (state === 1) {
          emitDiagnostic(onDiagnostic, 'contract', 'start');
          try { await bounded(this.inspectFocusContract(this.focusContract, { signal, onDiagnostic }), remaining(), 'Focus readiness timed out.', signal); emitDiagnostic(onDiagnostic, 'contract', 'ok'); }
          catch (error) { emitDiagnostic(onDiagnostic, 'contract', 'fail', diagnosticErrorCode(error)); throw error; }
          await bounded(check(), remaining(), 'Focus readiness timed out.', signal);
          if (verified) return page;
          verified = true;
        } else verified = false;
        await bounded(this.pause(200), remaining(), 'Focus readiness timed out.', signal);
      }
      throw fault('The problem page is still loading. Focus remains unapplied.', 'TIMEOUT');
    } finally { controller.abort(); externalSignal?.removeEventListener('abort', abort); }
  }
  async inspectFocusContract(value, { signal, onDiagnostic } = {}) {
    if (!this.focusContract || focusCore(value) !== focusCore(this.focusContract)) throw fault('The reviewed focus contract is not pinned.', 'INVALID_CONTRACT');
    const page = await this.getFocusPage({ signal, onDiagnostic }), target = this.target, generation = this.generation;
    const targets = this.focusContract.targets.map(item => ({ id: item.id, selector: item.id === 'top-navbar' ? NAVBAR_CANDIDATE : item.selector, count: item.count, expectation: item.expectation }));
    const expression = `(()=>{if(window!==window.top||location.origin!=='https://www.tensortonic.com'||location.origin+location.pathname+location.search!==${JSON.stringify(page.url)}||location.hash)return '';const counts={};let valid=true;const failures=[];const reject=(target,reason)=>{valid=false;failures.push({target,reason})};const safeHref=e=>{try{const u=new URL(e.getAttribute('href'),location.origin);return u.origin==='https://www.tensortonic.com'&&!u.username&&!u.password&&!u.hash&&/^\\/problems\\/[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(u.pathname)&&u.searchParams.getAll('studyPlan').length<=1&&[...u.searchParams].every(([k,v])=>k==='studyPlan'&&/^[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(v))}catch{return false}};for(const t of ${JSON.stringify(targets)}){let nodes;try{nodes=document.querySelectorAll(t.selector)}catch{return ''}counts[t.id]=nodes.length;if(nodes.length!==t.count){reject(t.id,nodes.length===0?'missing':'count');continue}for(const e of nodes){const x=t.expectation;if(x.kind==='top-navbar'){if(!(${verifyNavbar.toString()})(e))reject(t.id,'shape');continue}if(e.tagName.toLowerCase()!==x.tag||(e.textContent||'').replace(/\\s+/g,'')!==x.text||(e.getAttribute('title')||'')!==x.title){reject(t.id,'shape');continue}if(x.tag==='a'){if(x.href!=='owned-problem'||!safeHref(e))reject(t.id,'shape')}else if(x.tag==='button'){if(!['lucide-panel-left','lucide-sparkles'].includes(x.icon)||x.href!==null||![null,'button'].includes(x.type)||x.inForm!==false||e.getAttribute('href')!==null||e.getAttribute('type')!==x.type||(e.getAttribute('aria-label')||'')!==x.ariaLabel||e.closest('form')!==null||e.form!==null||e.querySelectorAll('svg.'+x.icon).length!==1||e.querySelectorAll('svg').length!==1)reject(t.id,'shape')}else reject(t.id,'shape')}}return JSON.stringify({url:location.origin+location.pathname+location.search,valid,counts,failures})})()`;
    const raw = await this._evaluate(target, expression, generation, signal);
    if (typeof raw !== 'string' || raw.length > 4096) throw fault('Invalid focus selector metadata.', 'INVALID_RESPONSE');
    let metadata; try { metadata = JSON.parse(raw); } catch (_) { throw fault('Focus selectors could not be verified.', 'INVALID_PROOF'); }
    if (Array.isArray(metadata?.failures)) for (const failure of metadata.failures.slice(0, 8)) emitDiagnostic(onDiagnostic, 'contract-target', 'fail', failure?.reason, failure?.target);
    if (!metadata || metadata.valid !== true || metadata.url !== page.url || !metadata.counts || Object.keys(metadata.counts).length !== targets.length || targets.some(item => metadata.counts[item.id] !== item.count)) throw fault('The reviewed problem controls changed. They remain visible.', 'INVALID_PROOF');
    if (!sameFocusPage(page, await this.getFocusPage({ signal, onDiagnostic }))) throw fault('The owned document changed during verification.', 'PAGE_CHANGED');
    this.focusProof = { page, target, fingerprint: focusCore(this.focusContract) };
    return Object.freeze({ ...page, contractId: this.focusContract.id, counts: Object.freeze({ ...metadata.counts }) });
  }
  _focusProtocol(resource, method, params, sessionId, gate, signal) {
    if (signal?.aborted) throw fault('Focus operation canceled before dispatch.', 'CANCELED');
    if (gate !== FOCUS_GATES.get(this) || !this.resources.has(resource) || !resource.group || resource.closed || resource.tabClosed) throw fault('Focus protocol is outside its owned resource.', 'UNSUPPORTED');
    const keys = Object.keys(params).sort().join(',');
    if (method === 'DOM.enable' || method === 'CSS.enable') {
      if (keys || !resource.targets.has(sessionId) || resource.targets.size !== 1) throw fault('Invalid owned CSS domain request.', 'UNSUPPORTED');
    } else if (method === 'CSS.createStyleSheet') {
      if (keys !== 'force,frameId' || params.force !== true || !this.focusProof || this.focusProof.target.resource !== resource || this.focusProof.target.sessionId !== sessionId || params.frameId !== this.focusProof.page.frameId) throw fault('Invalid owned stylesheet creation.', 'UNSUPPORTED');
    } else if (method === 'CSS.setStyleSheetText' || method === 'CSS.getStyleSheetText') {
      const sheet = this.focusSheets.get(params.styleSheetId);
      if (!sheet || sheet.resource !== resource || sheet.target.sessionId !== sessionId || sheet.gone || keys !== (method === 'CSS.setStyleSheetText' ? 'styleSheetId,text' : 'styleSheetId') ||
          (method === 'CSS.setStyleSheetText' && params.text !== '' && params.text !== this.focusContract?.cssText)) throw fault('Stylesheet is outside the owned focus lease.', 'UNSUPPORTED');
    } else throw fault('Unsupported focus protocol operation.', 'UNSUPPORTED');
    const wireParams = (method === 'CSS.setStyleSheetText' || method === 'CSS.getStyleSheetText')
      ? { ...params, styleSheetId: this.focusSheets.get(params.styleSheetId).nativeId } : params;
    const id = ++this.nextId;
    let resolve, reject;
    const reply = new Promise((yes, no) => { resolve = yes; reject = no; }); reply.catch(() => {});
    const readSheet = method === 'CSS.getStyleSheetText' ? this.focusSheets.get(params.styleSheetId) : undefined;
    resource.requests.set(id, { resolve, reject, sessionId, ...(readSheet ? { focusReadSheet: readSheet, focusNativeId: readSheet.nativeId } : {}) });
    // Retain the raw mutation until it settles. A caller timeout/cancellation
    // must not let a late nonempty write overtake its own cleanup.
    const completion = Promise.resolve().then(() => {
      if (signal?.aborted) throw fault('Focus operation canceled before dispatch.', 'CANCELED');
      if (method === 'CSS.setStyleSheetText' && params.text !== '') {
        const sheet = this.focusSheets.get(params.styleSheetId);
        this._check(this.generation, sheet.target, signal);
        if (sheet.gone || resource.tab.url !== sheet.page.url) throw fault('The owned page changed before style dispatch.', 'PAGE_CHANGED');
      }
      return resource.group.sendMessage({ id, method, params: wireParams, sessionId });
    }).then(() => reply);
    completion.then(() => resource.requests.delete(id), () => resource.requests.delete(id));
    return completion;
  }
  _focusCall(resource, method, params, sessionId, signal) {
    return this._focusProtocol(resource, method, params, sessionId, FOCUS_GATES.get(this), signal);
  }
  _focusSheet(id, page) {
    const sheet = this.focusSheets.get(id);
    if (!sheet || !sameFocusPage(sheet.page, page)) throw fault('Stylesheet does not belong to this owned document.', 'UNSUPPORTED');
    return sheet;
  }
  async createFocusStyleSheet({ frameId, force, page } = {}, { signal } = {}) {
    if (signal?.aborted) throw fault('Focus operation canceled.', 'CANCELED');
    if (force !== true || frameId !== page?.frameId || !this.focusProof || !sameFocusPage(this.focusProof.page, page) || !sameFocusPage(page, await this.getFocusPage())) throw fault('Focus proof is missing or stale.', 'INVALID_PROOF');
    const proof = this.focusProof, target = proof.target, resource = target.resource;
    await bounded(this._focusCall(resource, 'DOM.enable', {}, target.sessionId, signal), this.evaluationTimeout, 'Owned DOM domain unavailable.', signal);
    await bounded(this._focusCall(resource, 'CSS.enable', {}, target.sessionId, signal), this.evaluationTimeout, 'Owned CSS domain unavailable.', signal);
    this._check(this.generation, target, signal);
    if (!sameFocusPage(page, await this.getFocusPage()) || this.focusProof !== proof) throw fault('The owned focus proof changed.', 'PAGE_CHANGED');
    const pending = this._focusCall(resource, 'CSS.createStyleSheet', { frameId, force: true }, target.sessionId, signal).then(result => {
      const nativeId = result?.styleSheetId;
      if (typeof nativeId !== 'string' || !nativeId || nativeId.length > 1024 || /\s/.test(nativeId) || [...this.focusSheets.values()].some(sheet => sheet.resource === resource && sheet.target.sessionId === target.sessionId && sheet.nativeId === nativeId)) throw fault('Invalid owned stylesheet identity.', 'INVALID_RESPONSE');
      const id = `tt-focus-${crypto.randomUUID()}`;
      const sheet = { id, nativeId, page, target, resource, fingerprint: proof.fingerprint, dirty: false, used: false };
      this.focusSheets.set(id, sheet);
      if (resource.tabClosed) sheet.gone = 'page-closed';
      return Object.freeze({ styleSheetId: id });
    });
    pending.catch(() => {});
    const created = await bounded(pending, this.evaluationTimeout, 'Owned stylesheet creation did not settle.');
    if (signal?.aborted) throw fault('Focus operation canceled.', 'CANCELED');
    return created;
  }
  _emptyFocusSheet(sheet) {
    if ((sheet.gone && sheet.gone !== 'sheet-removed') || (!sheet.dirty && !sheet.navbarGuard)) return Promise.resolve();
    if (sheet.emptying) return sheet.emptying;
    const task = this._emptyFocusSheetOnce(sheet);
    sheet.emptying = task;
    task.then(() => { if (sheet.emptying === task) sheet.emptying = undefined; }, () => { if (sheet.emptying === task) sheet.emptying = undefined; });
    return task;
  }
  async _emptyFocusSheetOnce(sheet) {
    if ((sheet.gone && sheet.gone !== 'sheet-removed') || (!sheet.dirty && !sheet.navbarGuard)) return;
    // DOM guard cleanup and inspector CSS restoration are independent. A
    // failed marker removal must not prevent restoring the seven old controls.
    let guardError;
    try {
      if (sheet.navbarGuard === 'uncertain') throw fault('Capsule guard installation is uncertain; close the owned page to finish cleanup.', 'RESTORE_PENDING');
      if (sheet.navbarGuard === 'installed') {
        const expression = `(()=>{const root=document.documentElement;if(root.getAttribute(${JSON.stringify(NAVBAR_MARKER)})==='guarded')root.removeAttribute(${JSON.stringify(NAVBAR_MARKER)});return root.hasAttribute(${JSON.stringify(NAVBAR_MARKER)})?0:1})()`;
        const target = sheet.target, live = sheet.resource.targets.get(target.sessionId);
        if (!live || live.epoch !== target.epoch || live.contexts.get(target.context.id) !== target.context) throw fault('Capsule guard cleanup lost its exact owned context.', 'RESTORE_PENDING');
        const context = target.context;
        const reply = await this._cdp(sheet.resource, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false, silent: true, timeout: this.cleanupTimeout, ...(context.uniqueId ? { uniqueContextId: context.uniqueId } : { contextId: context.id }) }, target.sessionId);
        if (reply?.exceptionDetails || reply?.result?.value !== 1) throw fault('Capsule guard cleanup is unconfirmed.', 'RESTORE_PENDING');
        sheet.navbarGuard = undefined;
      }
    } catch (error) { guardError = error; }
    if (sheet.pending) {
      const previous = sheet.pending;
      try { await bounded(previous, this.cleanupTimeout, 'Owned style mutation cleanup is pending.'); }
      catch (error) { if (sheet.pending === previous) throw error; }
    }
    if (sheet.gone) { if (guardError) throw guardError; return; }
    const pending = this._focusCall(sheet.resource, 'CSS.setStyleSheetText', { styleSheetId: sheet.id, text: '' }, sheet.target.sessionId);
    sheet.pending = pending;
    try {
      await bounded(pending, this.cleanupTimeout, 'Owned stylesheet could not be emptied.');
      const result = await bounded(this._focusCall(sheet.resource, 'CSS.getStyleSheetText', { styleSheetId: sheet.id }, sheet.target.sessionId), this.cleanupTimeout, 'Owned empty stylesheet could not be confirmed.');
      if (result?.text !== '') throw fault('Owned stylesheet cleanup is unconfirmed.', 'RESTORE_PENDING');
      sheet.dirty = false;
      if (guardError) throw guardError;
    } finally { pending.then(() => { if (sheet.pending === pending) sheet.pending = undefined; }, () => { if (sheet.pending === pending) sheet.pending = undefined; }); }
  }
  async setFocusStyleSheetText(id, text, { page, signal, onDiagnostic } = {}) {
    const sheet = this._focusSheet(id, page);
    if (text === '') { await this._emptyFocusSheet(sheet); return; }
    if (signal?.aborted) throw fault('Focus operation canceled.', 'CANCELED');
    if (sheet.gone || sheet.used || !this.focusContract || text !== this.focusContract.cssText || sheet.fingerprint !== focusCore(this.focusContract)) throw fault('Nonempty focus styles require the exact reviewed proof.', 'INVALID_PROOF');
    await this.inspectFocusContract(this.focusContract, { onDiagnostic });
    if (!sameFocusPage(page, this.focusProof.page)) throw fault('The owned document changed.', 'PAGE_CHANGED');
    const generation = this.generation;
    this._check(generation, sheet.target, signal);
    if (sheet.resource.tab.url !== page.url) throw fault('The owned problem URL changed before styling.', 'PAGE_CHANGED');
    sheet.used = true; sheet.dirty = true;
    // Install the observer and prove/mark the exact node atomically before CSS.
    // An uncertain evaluation never permits another apply; closing the owned
    // document is the safe recovery when its result cannot be established.
    sheet.navbarGuard = 'uncertain';
    const guardExpression = `(()=>{if(window!==window.top||location.origin+location.pathname+location.search!==${JSON.stringify(page.url)}||location.hash)return 0;return (${installNavbarGuard.toString()})(document,${JSON.stringify(NAVBAR_CANDIDATE)},${JSON.stringify(NAVBAR_MARKER)},(${verifyNavbar.toString()}),typeof MutationObserver==='function'?MutationObserver:undefined)})()`;
    emitDiagnostic(onDiagnostic, 'guard-install', 'start');
    const guarded = await this._number(sheet.target, guardExpression, generation);
    sheet.navbarGuard = guarded === 1 ? 'installed' : undefined;
    emitDiagnostic(onDiagnostic, 'guard-install', guarded === 1 ? 'ok' : 'fail');
    if (guarded !== 1) throw fault('Capsule guard could not be installed. Controls remain visible.', 'INVALID_PROOF');
    this._check(generation, sheet.target, signal);
    const pending = this._focusCall(sheet.resource, 'CSS.setStyleSheetText', { styleSheetId: id, text }, sheet.target.sessionId, signal);
    sheet.pending = pending;
    const settled = () => {
      if (sheet.pending === pending) sheet.pending = undefined;
      if (sheet.needsLateEmpty || signal?.aborted) void this._emptyFocusSheet(sheet).catch(() => { sheet.restoreFailed = true; });
    };
    pending.then(settled, settled);
    try {
      await bounded(pending, this.evaluationTimeout, 'Owned focus stylesheet mutation is unconfirmed.');
      if (signal?.aborted) throw fault('Focus operation canceled.', 'CANCELED');
      if (!sameFocusPage(page, await this.getFocusPage())) throw fault('The styled document changed.', 'PAGE_CHANGED');
      const targets = this.focusContract.targets.map(target => ({ selector: target.selector, count: target.count }));
      const expression = `(()=>{if(window!==window.top||location.origin!=='https://www.tensortonic.com'||location.origin+location.pathname+location.search!==${JSON.stringify(page.url)}||location.hash)return 0;return ${JSON.stringify(targets)}.every(target=>{const nodes=document.querySelectorAll(target.selector);return nodes.length===target.count&&[...nodes].every(element=>getComputedStyle(element).display==='none')})?1:0})()`;
      emitDiagnostic(onDiagnostic, 'visibility', 'start');
      const visibleProof = await this._number(sheet.target, expression, generation, signal);
      emitDiagnostic(onDiagnostic, 'visibility', visibleProof === 1 ? 'ok' : 'fail');
      if (visibleProof !== 1) throw fault('Focus controls remained visible; original styles will be restored.', 'FOCUS_NOT_APPLIED');
      if (!sameFocusPage(page, await this.getFocusPage())) throw fault('The styled document changed after visibility verification.', 'PAGE_CHANGED');
      if (signal?.aborted) throw fault('Focus operation canceled.', 'CANCELED');
    } catch (error) {
      sheet.needsLateEmpty = true;
      if (!sheet.pending) void this._emptyFocusSheet(sheet).catch(() => { sheet.restoreFailed = true; });
      throw error;
    }
  }
  async focusStyleSheetExists(id, { page } = {}) {
    const sheet = this._focusSheet(id, page);
    if (sheet.gone) return Object.freeze({ exists: false, authoritative: sheet.gone !== 'sheet-removed' || !sheet.navbarGuard, reason: sheet.gone, styleSheetId: id, documentId: sheet.page.documentId });
    let result;
    try { result = await bounded(this._focusCall(sheet.resource, 'CSS.getStyleSheetText', { styleSheetId: id }, sheet.target.sessionId), this.evaluationTimeout, 'Owned stylesheet state is unknown.'); }
    catch (error) {
      const proof = MISSING_FOCUS_SHEETS.get(error), r = sheet.resource;
      if (proof?.sheet === sheet && proof.resource === r && proof.sessionId === sheet.target.sessionId &&
          !sheet.pending && this.resources.has(r) && !r.closed && !r.tabClosed && r.targets.size === 1 && r.targets.has(proof.sessionId)) {
        sheet.gone = 'sheet-removed';
        return Object.freeze({ exists: false, authoritative: !sheet.navbarGuard, reason: 'sheet-removed', styleSheetId: id, documentId: sheet.page.documentId });
      }
      throw fault('Owned stylesheet state is unknown.', 'RESTORE_PENDING');
    }
    if (typeof result?.text !== 'string' || result.text.length > 16384) throw fault('Owned stylesheet state is invalid.', 'INVALID_RESPONSE');
    return Object.freeze({ exists: true, authoritative: true, styleSheetId: id, documentId: sheet.page.documentId });
  }
  async _restoreFocusResource(resource) {
    try { for (const sheet of this.focusSheets.values()) if (sheet.resource === resource) await this._emptyFocusSheet(sheet); }
    catch (_) { throw fault('Owned focus stylesheet cleanup is pending.', 'RESTORE_PENDING'); }
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
        await this._acquire(r, 'tab', () => v.window.openBrowserTab('https://www.tensortonic.com/', { viewColumn: this.presentationColumn ?? v.ViewColumn?.Beside ?? -2, preserveFocus: true, background: false }), generation, signal);
        this._displayState(r);
        if (typeof r.tab?.startCDPSession !== 'function') throw fault('The experimental browser API is unavailable. Launch with --enable-proposed-api choru-local.tensortonic-vscode and fully restart VS Code; this opt-in applies to this extension only.', 'UNAVAILABLE');
        await this._acquire(r, 'group', () => r.tab.startCDPSession(), generation, signal);
        r.listeners.push(r.group.onDidReceiveMessage(message => this._onMessage(r, message)));
        r.listeners.push(r.group.onDidClose(() => {
          r.closed = true; this.token = undefined; this._invalidate(r);
          for (const entry of r.requests.values()) entry.reject(fault('Owned browser transport closed.', 'DISCONNECTED'));
          r.requests.clear();
          this._displayState(r);
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
  async openProblemPage(value, { signal, viewColumn, onDidChangePage } = {}) {
    const url = problemUrl(value); if (!url) throw fault('Only canonical TensorTonic problem pages can be opened.', 'UNSUPPORTED');
    if (this.pending || this.navigating) throw fault('Wait for the current operation before navigating.', 'BUSY');
    // Applies only when creating an owned presentation tab. Existing tabs keep
    // the user's manual group placement across navigation.
    if (Number.isInteger(viewColumn) && viewColumn >= 1 && viewColumn <= 9) this.presentationColumn = viewColumn;
    if (typeof onDidChangePage === 'function') this.onDisplayPage = onDidChangePage;
    this.navigating = true;
    try {
      await this.start({ signal });
      const generation = this.generation, target = this.target;
      await this._restoreFocusResource(target.resource);
      this._check(generation, target, signal);
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
        if (await this._number(this.target, `(${exact})?1:0`, generation, signal) === 1) { this._displayState(this.target.resource); return { requested: true, target: 'native-owned' }; }
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
      let focusRestoreFailed = false;
      try { await this._restoreFocusResource(r); } catch (_) { focusRestoreFailed = true; }
      if (r.group && !r.closed) {
        if (r.listeners.length) await this._cdp(r, 'Target.setAutoAttach', { autoAttach: false, flatten: true, waitForDebuggerOnStart: false }).catch(() => {});
        try { await bounded(r.group.close(), this.cleanupTimeout, 'Owned browser session cleanup pending.'); r.closed = true; }
        catch (_) { failed = true; }
      }
      if (r.tab && !r.tabClosed) {
        try { await bounded(r.tab.close(), this.cleanupTimeout, 'Owned browser tab cleanup pending.'); r.tabClosed = true; this._focusGone(r, undefined, undefined, 'page-closed'); }
        catch (_) { failed = true; }
      }
      if (focusRestoreFailed && [...this.focusSheets.values()].some(sheet => sheet.resource === r && (sheet.dirty || sheet.navbarGuard) && !['page-closed', 'document-destroyed'].includes(sheet.gone))) failed = true;
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
