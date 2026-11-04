'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { makeNavbar } = require('./helpers/focus-navbar-fixture');
const { NAVBAR_CANDIDATE, NAVBAR_SELECTOR, NAVBAR_MARKER } = require('../src/focus-navbar');
const { NativeBrowserBridge, displayedBase64, problemUrl } = require('../src/native-browser-bridge');
const { FOCUS_CONTRACT } = require('../src/focus-contract');
const { FocusBrowserAdapter } = require('../src/focus-browser-adapter');
function emitter() { const handlers = new Set(); return { event: fn => { handlers.add(fn); return { dispose: () => handlers.delete(fn) }; }, fire: value => { for (const fn of [...handlers]) fn(value); } }; }
function harness(t, options = {}) {
  const messages = emitter(), closed = emitter(), tabClosed = emitter(), tabState = emitter();
  const h = { requests: [], calls: [], timers: new Set(), data: { ok: true }, status: 200, opens: 0, groupCloses: 0, tabCloses: 0, sid: 'owned-page', cid: 7, uid: 'context-7', navigations: [], styles: new Map([['site-style', '.site{color:blue}']]), nextSheet: 0 };
  const location = { origin: 'https://www.tensortonic.com', pathname: '/', search: '', assign(value) { const u = new URL(value); Object.assign(this, { origin: u.origin, pathname: u.pathname, search: u.search }); h.tab.url = u.href; h.navigations.push(value); h.newDocument(); } };
  const sandbox = { location, document: {}, URL, AbortController, Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); h.timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); h.timers.delete(timer); },
    fetch: async (url, init) => { h.requests.push({ url, init }); if (h.fetch) return h.fetch(url, init); return new Response(JSON.stringify(h.data), { status: h.status }); },
  }; sandbox.window = sandbox; sandbox.top = sandbox; sandbox.globalThis = sandbox; vm.createContext(sandbox); h.sandbox = sandbox;
  h.context = (overrides = {}) => messages.fire({ method: 'Runtime.executionContextCreated', sessionId: h.sid, params: { context: { id: h.cid, uniqueId: h.uid, origin: location.origin, auxData: { isDefault: true, frameId: 'top-frame' }, ...overrides } } });
  h.attach = (id = h.sid, info = {}, outer) => messages.fire({ method: 'Target.attachedToTarget', ...(outer ? { sessionId: outer } : {}), params: { sessionId: id, targetInfo: { type: 'page', url: h.tab.url, vscodeBrowserViewId: 'owned-browser', ...info } } });
  h.newDocument = () => { messages.fire({ method: 'Runtime.executionContextsCleared', sessionId: h.sid }); sandbox.document = {}; h.uid += '-next'; h.context(); };
  h.group = { onDidReceiveMessage: messages.event, onDidClose: closed.event, async close() { h.groupCloses++; if (h.failGroupClose) throw Error('failed'); closed.fire(); }, async sendMessage(message) {
    h.calls.push(message); if (h.beforeSend && await h.beforeSend(message) === false) return;
    let result;
    if (message.method === 'Target.setAutoAttach') { if (message.params.autoAttach) h.attach(); result = {}; }
    else if (message.method === 'Runtime.enable') { h.context(); result = {}; }
    else if (message.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: h.frameId || 'top-frame' } } };
    else if (message.method === 'DOM.enable' || message.method === 'CSS.enable') result = {};
    else if (message.method === 'CSS.createStyleSheet') { assert.deepEqual(message.params, { frameId: 'top-frame', force: true }); const styleSheetId = `native-own-sheet-${++h.nextSheet}`; h.styles.set(styleSheetId, ''); result = { styleSheetId }; }
    else if (message.method === 'CSS.setStyleSheetText') { if (h.failEmpty && message.params.text === '') throw Error('synthetic empty failed'); assert.ok(h.styles.has(message.params.styleSheetId)); h.styles.set(message.params.styleSheetId, message.params.text); result = {}; }
    else if (message.method === 'CSS.getStyleSheetText') { if (!h.styles.has(message.params.styleSheetId)) throw Error('synthetic missing sheet'); result = { text: h.styles.get(message.params.styleSheetId) }; }
    else if (message.method === 'Runtime.evaluate') {
      assert.equal(message.sessionId, h.sid);
      if (message.params.uniqueContextId) assert.equal(message.params.uniqueContextId, h.uid);
      else assert.equal(message.params.contextId, h.cid);
      const value = vm.runInContext(message.params.expression, sandbox);
      result = { result: { value } };
      if (h.afterEval) await h.afterEval(message);
    } else throw Error('unexpected method');
    messages.fire({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}), result });
  } };
  h.tab = { url: 'https://www.tensortonic.com/', async startCDPSession() { if (h.openGroup) return h.openGroup(); return h.group; }, async close() { h.tabCloses++; if (h.failTabClose) throw Error('failed'); tabClosed.fire(h.tab); } };
  h.vscode = { workspace: { isTrusted: true }, env: {}, ViewColumn: { Beside: -2 }, debug: new Proxy({}, { get() { throw Error('debug API forbidden'); } }), window: {
    onDidCloseBrowserTab: tabClosed.event, onDidChangeBrowserTabState: tabState.event,
    async openBrowserTab(url, opts) { h.opens++; h.openOptions = opts; assert.equal(url, 'https://www.tensortonic.com/'); if (h.openTab) return h.openTab(); return h.tab; },
  } };
  h.messages = messages; h.closed = closed; h.tabClosed = tabClosed; h.tabState = tabState;
  h.bridge = new NativeBrowserBridge(h.vscode, { discoverTimeout: 30, evaluationTimeout: 30, launchTimeout: 30, cleanupTimeout: 30, requestTimeout: 1000, pause: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 1))), ...options });
  t.after(async () => { h.failGroupClose = false; h.failTabClose = false; h.beforeSend = undefined; for (const timer of h.timers) clearTimeout(timer); await h.bridge.dispose().catch(() => {}); });
  return h;
}
async function focusHarness(t, options) {
  const h = harness(t, options);
  h.bridge.setFocusContract(FOCUS_CONTRACT);
  await h.bridge.openProblemPage('https://www.tensortonic.com/problems/current?studyPlan=pytorch');
  h.focusElements = new Map(FOCUS_CONTRACT.targets.map(target => [target.selector, [{ tagName: target.expectation.tag.toUpperCase(), textContent: target.expectation.text, form: null,
    getAttribute(name) { return name === 'title' ? target.expectation.title : name === 'aria-label' ? target.expectation.ariaLabel || null : name === 'type' ? target.expectation.type ?? null : name === 'href' && target.expectation.tag === 'a' ? 'https://www.tensortonic.com/problems/next?studyPlan=pytorch' : null; },
    closest() { return null; }, querySelectorAll(selector) { return ['svg', 'svg.' + target.expectation.icon].includes(selector) ? [{}] : []; } }]]));
  h.navbar = makeNavbar();
  h.focusElements.set(FOCUS_CONTRACT.targets.find(target => target.id === 'top-navbar').selector, [h.navbar.nav]);
  const markerAttrs = new Map(), observers = new Set();
  const root = { parentNode: h.sandbox.document, hasAttribute: key => markerAttrs.has(key), getAttribute: key => markerAttrs.get(key) ?? null, setAttribute: (key, value) => markerAttrs.set(key, value), removeAttribute: key => { markerAttrs.delete(key); for (const observer of [...observers]) observer.callback(); } };
  h.sandbox.document.documentElement = root;
  h.navbar.nav.parentNode = root; h.navbar.nav.isConnected = true;
  h.sandbox.MutationObserver = class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } takeRecords() { return []; } };
  h.revokeNavbar = () => { for (const observer of [...observers]) observer.callback(); };
  h.sandbox.document.querySelectorAll = selector => selector === NAVBAR_CANDIDATE ? h.focusElements.get(NAVBAR_SELECTOR) || [] : selector === NAVBAR_SELECTOR && !root.hasAttribute(NAVBAR_MARKER) ? [] : h.focusElements.get(selector) || [];
  h.sandbox.getComputedStyle = element => ({ display: typeof h.focusDisplay === 'function' ? h.focusDisplay(element) : h.focusDisplay || ([...h.styles.values()].includes(FOCUS_CONTRACT.cssText) ? 'none' : 'block') });
  Object.defineProperty(h.sandbox.document, 'cookie', { get() { assert.fail('focus code read cookies'); } });
  h.adapter = new FocusBrowserAdapter({ getPage: () => h.bridge.getFocusPage(), inspect: contract => h.bridge.inspectFocusContract(contract), createStyleSheet: (...args) => h.bridge.createFocusStyleSheet(...args), setStyleSheetText: (...args) => h.bridge.setFocusStyleSheetText(...args), styleSheetExists: (...args) => h.bridge.focusStyleSheetExists(...args) });
  h.page = await h.bridge.getFocusPage();
  h.applyFocus = async options => h.adapter.apply(await h.adapter.verify(h.page, FOCUS_CONTRACT, options), FOCUS_CONTRACT, options);
  return h;
}
test('constructor and restore never launch; missing proposed browser API explains scoped opt-in', async () => {
  const b = new NativeBrowserBridge({ workspace: { isTrusted: true } });
  assert.equal(b.hasOwnedResources, false); assert.equal(await b.restore(), false);
  await assert.rejects(b.start(), e => e.code === 'UNAVAILABLE' && /--enable-proposed-api choru-local.tensortonic-vscode/.test(e.message)); await b.dispose();
});
test('explicit direct launch owns one tab, reuses it, and never accesses debugger APIs', async t => {
  const h = harness(t); await h.bridge.start(); const token = h.bridge.token;
  assert.equal(h.bridge.connected, true); assert.equal(h.bridge.hasOwnedResources, true);
  assert.deepEqual(h.openOptions, { viewColumn: -2, preserveFocus: true, background: false });
  await h.bridge.start(); assert.equal(h.opens, 1); assert.equal(h.bridge.token, token);
  await h.bridge.stop(); assert.equal(h.groupCloses, 1); assert.equal(h.tabCloses, 1); assert.equal(h.bridge.hasOwnedResources, false);
});
test('allowed JSON fetch uses normal browser authentication without extracting credentials', async t => {
  const h = harness(t); await h.bridge.start(); h.data = { title: '한글', data: [1, 2] };
  assert.deepEqual(await h.bridge.request('/api/problems/x'), h.data);
  assert.equal(h.requests[0].init.credentials, 'include'); assert.equal(h.requests[0].init.redirect, 'error');
  assert.equal(h.requests[0].init.headers, undefined);
  assert.equal(Object.keys(h.sandbox).some(k => k.startsWith('__tt_native_')), false); assert.equal(h.timers.size, 0);
  assert.ok(h.calls.every(c => ['Target.setAutoAttach', 'Runtime.enable', 'Page.getFrameTree', 'Runtime.evaluate'].includes(c.method)));
});
test('route and body policy reject before protocol evaluation', async t => {
  const h = harness(t); await h.bridge.start(); const count = h.calls.length;
  for (const [route, options] of [['/api/me', {}], ['https://evil/x', {}], ['/api/problems/x/submit', { method: 'POST', body: { code: 'pass', cookie: 'no' } }], ['/api/problems/x/submit', { method: 'POST', body: { code: 'a'.repeat(600000) } }]]) await assert.rejects(h.bridge.request(route, options), { code: 'UNSUPPORTED' });
  assert.equal(h.calls.length, count);
});
test('large Unicode JSON is bounded and reconstructed without repeating fetch', async t => {
  const h = harness(t); await h.bridge.start(); h.data = { text: '한글🍀'.repeat(30000) };
  assert.deepEqual(await h.bridge.request('/api/problems/x'), h.data); assert.equal(h.requests.length, 1);
});
test('stream limit fails closed before decoding', async t => {
  const h = harness(t, { maxResponseBytes: 32 }); await h.bridge.start(); h.data = { text: 'x'.repeat(100) };
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'TOO_LARGE' }); assert.equal(h.requests.length, 1);
});
test('401 and403 preserve owned login tab and retry requires explicit request', async t => {
  const h = harness(t); await h.bridge.start();
  for (const status of [401, 403]) { h.status = status; await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'AUTH_REQUIRED' }); }
  assert.equal(h.bridge.connected, true); assert.equal(h.opens, 1); h.status = 200;
  await h.bridge.start(); assert.deepEqual(await h.bridge.request('/api/problems/x'), h.data); assert.equal(h.requests.length, 3);
});
test('synthetic POST dispatches once with injection-safe body', async t => {
  const h = harness(t); await h.bridge.start(); const code = "x='\"});globalThis.injected=1;//'";
  await h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code } });
  assert.equal(h.requests.length, 1); assert.deepEqual(JSON.parse(h.requests[0].init.body), { code }); assert.equal(h.sandbox.injected, undefined);
});
test('already canceled POST dispatches nothing', async t => {
  const h = harness(t); await h.bridge.start(); const controller = new AbortController(); controller.abort();
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' }, signal: controller.signal }), { code: 'CANCELED' }); assert.equal(h.requests.length, 0);
});
test('cancellation after POST dispatch reports uncertain and never retries', async t => {
  const h = harness(t); await h.bridge.start(); const controller = new AbortController();
  h.fetch = async (_url, init) => new Promise((_, reject) => { controller.abort(); init.signal.addEventListener('abort', () => reject(Error('aborted'))); });
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' }, signal: controller.signal }), { code: 'UNCERTAIN_RESULT' });
  assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
});
test('wrong-session CDP reply cannot satisfy an owned request', async t => {
  const h = harness(t); await h.bridge.start();
  h.beforeSend = async m => { if (m.method === 'Runtime.evaluate') { h.messages.fire({ id: m.id, sessionId: 'foreign', result: { result: { value: 1 } } }); return false; } };
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'TIMEOUT' }); assert.equal(h.requests.length, 0);
});
test('iframe and worker attachments/default contexts cannot become top-frame target', async t => {
  const h = harness(t); await h.bridge.start();
  h.attach('iframe', { type: 'iframe' }); h.attach('worker', { type: 'worker' }); h.attach('nested', {}, h.sid);
  h.context({ id: 99, uniqueId: 'iframe-context', auxData: { isDefault: true, frameId: 'iframe' } });
  await h.bridge.start(); assert.equal(h.bridge.target.context.id, 7); assert.equal([...h.bridge.resources][0].targets.size, 1);
});
test('multiple root page targets fail closed instead of taking over another target', async t => {
  const h = harness(t); await h.bridge.start(); h.attach('second-page');
  await assert.rejects(h.bridge.start(), { code: 'AMBIGUOUS_TARGET' });
});
test('context replacement reusing numeric id invalidates in-flight grading', async t => {
  const h = harness(t); await h.bridge.start();
  h.fetch = async () => { h.newDocument(); return new Response('{"ok":true}'); };
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' } }), { code: 'UNCERTAIN_RESULT' });
  assert.equal(h.requests.length, 1); assert.equal(h.bridge.connected, false);
});
test('navigation is one-shot, rebinds new document, and preserves logical token', async t => {
  const h = harness(t); await h.bridge.start(); const token = h.bridge.token;
  assert.deepEqual(await h.bridge.openProblemPage('https://www.tensortonic.com/problems/x?studyPlan=pytorch'), { requested: true, target: 'native-owned' });
  assert.equal(h.navigations.length, 1); assert.equal(h.bridge.token, token); assert.equal(h.bridge.target.context.uniqueId, h.uid);
});
test('manual account/login and foreign pages are not redirected or read', async t => {
  const h = harness(t); await h.bridge.start(); h.sandbox.location.pathname = '/account';
  await assert.rejects(h.bridge.openProblemPage('https://www.tensortonic.com/problems/x'), { code: 'PAGE_CHANGED' }); assert.equal(h.navigations.length, 0);
  h.tab.url = 'https://foreign.example'; h.tabState.fire(h.tab);
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'DISCONNECTED' }); assert.equal(h.requests.length, 0);
});
test('page guards prevent fetch when page origin changes before notification', async t => {
  const h = harness(t); await h.bridge.start(); h.sandbox.location.origin = 'https://foreign.example';
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'PAGE_CHANGED' }); assert.equal(h.requests.length, 0);
});
test('navigation and grading share synchronous exclusion latch', async t => {
  const h = harness(t); await h.bridge.start(); const navigating = h.bridge.openProblemPage('https://www.tensortonic.com/problems/x');
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'BUSY' }); await navigating;
  let release; h.fetch = () => new Promise(resolve => { release = () => resolve(new Response('{}')); });
  const grading = h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' } });
  await assert.rejects(h.bridge.openProblemPage('https://www.tensortonic.com/problems/y'), { code: 'BUSY' });
  await assert.rejects(h.bridge.start(), { code: 'BUSY' }); release(); await grading;
});
test('group close rejects all inflight protocol promises', async t => {
  const h = harness(t); await h.bridge.start(); h.beforeSend = async m => { if (m.method === 'Runtime.evaluate') { h.closed.fire(); return false; } };
  await assert.rejects(h.bridge.request('/api/problems/x')); assert.equal(h.bridge.connected, false); assert.equal([...h.bridge.resources][0].requests.size, 0);
});
test('cancel during slow tab open retains ownership and closes late tab only', async t => {
  const h = harness(t); let release; h.openTab = () => new Promise(resolve => { release = () => resolve(h.tab); });
  const c = new AbortController(); const starting = h.bridge.start({ signal: c.signal }); await new Promise(resolve => setImmediate(resolve)); c.abort();
  await assert.rejects(starting, { code: 'CANCELED' }); release(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.tabCloses, 1); assert.equal(h.bridge.hasOwnedResources, false);
});
test('late group acquisition after disconnect closes both owned resources', async t => {
  const h = harness(t); let release; h.openGroup = () => new Promise(resolve => { release = () => resolve(h.group); });
  const starting = h.bridge.start(); starting.catch(() => {}); await new Promise(resolve => setTimeout(resolve, 2));
  const stopping = h.bridge.stop(); release(); await stopping; await assert.rejects(starting);
  assert.equal(h.groupCloses, 1); assert.equal(h.tabCloses, 1); assert.equal(h.bridge.hasOwnedResources, false);
});
test('failed resource close retains ownership and cleanup can be retried', async t => {
  const h = harness(t); await h.bridge.start(); h.failTabClose = true;
  await assert.rejects(h.bridge.stop(), { code: 'CLEANUP_PENDING' }); assert.equal(h.bridge.hasOwnedResources, true);
  await assert.rejects(h.bridge.start(), { code: 'CLEANUP_PENDING' }); h.failTabClose = false; await h.bridge.stop(); assert.equal(h.bridge.hasOwnedResources, false);
});
test('trust revocation fails closed and web/remote hosts cannot open', async t => {
  const h = harness(t); h.vscode.env.uiKind = 2; await assert.rejects(h.bridge.start(), { code: 'UNAVAILABLE' });
  h.vscode.env.uiKind = 1; h.vscode.env.remoteName = 'ssh'; await assert.rejects(h.bridge.start(), { code: 'UNAVAILABLE' });
  delete h.vscode.env.remoteName; await h.bridge.start(); h.vscode.workspace.isTrusted = false;
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'CANCELED' }); assert.equal(h.requests.length, 0);
});
test('strict chunk and canonical problem URL validation', () => {
  assert.equal(displayedBase64('"YWJj"', 4), 'YWJj'); assert.equal(displayedBase64('YW…', 4), undefined);
  assert.equal(problemUrl('https://www.tensortonic.com/problems/x?studyPlan=y'), 'https://www.tensortonic.com/problems/x?studyPlan=y');
  for (const url of ['https://evil/problems/x', 'https://www.tensortonic.com/problems/x#hash', 'https://www.tensortonic.com/problems/x?foo=bar']) assert.equal(problemUrl(url), undefined);
});
test('proposal getters may throw without breaking activation and give exact opt-in guidance on Start', async () => {
  const window = {}; Object.defineProperty(window, 'openBrowserTab', { get() { throw Error('proposal denied'); } });
  const b = new NativeBrowserBridge({ workspace: { isTrusted: true }, window });
  await assert.rejects(b.start(), e => e.code === 'UNAVAILABLE' && /--enable-proposed-api choru-local.tensortonic-vscode/.test(e.message));
  assert.equal(b.hasOwnedResources, false); await b.dispose();
});
test('proposed event getter denial is also explicit and cannot create a tab', async t => {
  const h = harness(t); Object.defineProperty(h.vscode.window, 'onDidCloseBrowserTab', { get() { throw Error('proposal denied'); } });
  await assert.rejects(h.bridge.start(), { code: 'UNAVAILABLE' }); assert.equal(h.opens, 0);
});
test('explicit reconnect after closed group cleans its tab before opening a new owned group', async t => {
  const h = harness(t); await h.bridge.start(); const token = h.bridge.token; h.closed.fire();
  await h.bridge.start(); assert.equal(h.opens, 2); assert.equal(h.tabCloses, 1); assert.equal(h.bridge.connected, true);
  // A new transport root has a distinct logical identity.
  assert.notEqual(h.bridge.token, token);
});
test('root target detach invalidates transport and does not auto-replay', async t => {
  const h = harness(t); await h.bridge.start(); h.messages.fire({ method: 'Target.detachedFromTarget', params: { sessionId: h.sid } });
  assert.equal(h.bridge.connected, false); await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'DISCONNECTED' }); assert.equal(h.requests.length, 0);
});
test('lost POST dispatch acknowledgment is uncertain and the fetch is never resent', async t => {
  const h = harness(t); await h.bridge.start();
  h.afterEval = async m => { if (m.params.expression.includes('await fetch(')) throw Error('lost acknowledgement'); };
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' } }), { code: 'UNCERTAIN_RESULT' });
  assert.equal(h.requests.length, 1);
});
test('lost navigation reply verifies exact new owned document without navigating twice', async t => {
  const h = harness(t); await h.bridge.start();
  h.afterEval = async m => { if (m.params.expression.includes('location.assign(')) throw Error('context destroyed'); };
  await h.bridge.openProblemPage('https://www.tensortonic.com/problems/next'); assert.equal(h.navigations.length, 1);
});
test('unresolved timed-out opening reports pending cleanup and closes eventual tab', async t => {
  const h = harness(t, { launchTimeout: 5 }); let release;
  h.openTab = () => new Promise(resolve => { release = () => resolve(h.tab); });
  await assert.rejects(h.bridge.start(), { code: 'TIMEOUT' });
  await assert.rejects(h.bridge.stop(), { code: 'CLEANUP_PENDING' });
  release(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(h.tabCloses, 1); assert.equal(h.bridge.hasOwnedResources, false);
});
test('non-default or wrong-frame contexts never get evaluated', async t => {
  const h = harness(t); h.context = () => {
    h.messages.fire({ method: 'Runtime.executionContextCreated', sessionId: h.sid, params: { context: { id: 8, origin: 'https://www.tensortonic.com', auxData: { isDefault: false, frameId: 'top-frame' } } } });
    h.messages.fire({ method: 'Runtime.executionContextCreated', sessionId: h.sid, params: { context: { id: 9, origin: 'https://www.tensortonic.com', auxData: { isDefault: true, frameId: 'iframe' } } } });
  };
  await assert.rejects(h.bridge.start(), { code: 'LOGIN_OR_PAGE_REQUIRED' }); assert.equal(h.calls.filter(m => m.method === 'Runtime.evaluate').length, 0);
});
test('without uniqueContextId the explicit numeric context is still epoch guarded', async t => {
  const h = harness(t); h.uid = undefined; await h.bridge.start();
  assert.deepEqual(await h.bridge.request('/api/problems/x'), h.data);
  assert.ok(h.calls.filter(m => m.method === 'Runtime.evaluate').every(m => m.params.contextId === 7));
});
test('cancel during discovery cleans already-acquired owned tab and group without separate Stop', async t => {
  const h = harness(t); const controller = new AbortController();
  h.beforeSend = async m => { if (m.method === 'Page.getFrameTree') controller.abort(); };
  await assert.rejects(h.bridge.start({ signal: controller.signal }), { code: 'CANCELED' });
  assert.equal(h.tabCloses, 1); assert.equal(h.groupCloses, 1); assert.equal(h.bridge.hasOwnedResources, false);
});

test('owned presentation placement is initial-only and navigation events expose sanitized problem identity',async t=>{
 const h=harness(t),states=[];
 await h.bridge.openProblemPage('https://www.tensortonic.com/problems/first?studyPlan=pytorch',{viewColumn:1,onDidChangePage:state=>states.push(state)});assert.equal(h.openOptions.viewColumn,1);assert.deepEqual(states.at(-1),{closed:false,ref:{slug:'first',planId:'pytorch'}});
 h.tabState.fire({url:'https://www.tensortonic.com/problems/unrelated?studyPlan=pytorch'});assert.equal(states.at(-1).ref.slug,'first');
 h.tab.url='https://www.tensortonic.com/problems/second?studyPlan=numpy&discard=private-query-sentinel#discard-private-fragment';h.tabState.fire(h.tab);assert.deepEqual(states.at(-1),{closed:false,ref:{slug:'second',planId:'numpy'},focusUnverified:true});assert.equal(JSON.stringify(states).includes('sentinel'),false);assert.equal(JSON.stringify(states).includes('private-fragment'),false);
 await h.bridge.openProblemPage('https://www.tensortonic.com/problems/third',{viewColumn:2});assert.equal(h.opens,1);assert.equal(h.openOptions.viewColumn,1);assert.equal(states.at(-1).ref.slug,'third');
 h.tab.url='https://www.tensortonic.com/auth?token=AUTH_SENTINEL';h.tabState.fire(h.tab);assert.deepEqual(states.at(-1),{closed:false,focusUnverified:true});assert.equal(JSON.stringify(states).includes('AUTH_SENTINEL'),false);await h.bridge.stop();assert.equal(states.at(-1).closed,true);
});

test('invalid presentation columns and failing listeners cannot alter browser scope or navigation',async t=>{
 const h=harness(t);await h.bridge.openProblemPage('https://www.tensortonic.com/problems/first',{viewColumn:100,onDidChangePage(){throw Error('synthetic observer failure');}});assert.equal(h.openOptions.viewColumn,-2);assert.equal(h.opens,1);assert.ok(h.calls.every(call=>['Target.setAutoAttach','Runtime.enable','Page.getFrameTree','Runtime.evaluate'].includes(call.method)));
});

test('focus port applies only the pinned anchors in an owned dedicated sheet and empties it on Off', async t => {
  const h = await focusHarness(t);
  const lease = await h.applyFocus();
  const sheet = [...h.bridge.focusSheets.values()][0];
  assert.equal(h.styles.get(sheet.nativeId), FOCUS_CONTRACT.cssText);
  assert.notEqual(sheet.id, sheet.nativeId, 'public lease identity must not grant raw protocol IDs');
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
  await lease.restore();
  assert.equal(h.styles.get(sheet.nativeId), '');
  assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).exists, true);
  assert.equal(h.requests.length, 0);
  assert.ok(!h.calls.some(call => /^(?:Network|Storage|Browser|DOMStorage)\./.test(call.method) || call.method === 'CSS.disable'));
});

test('focus contract pinning rejects changed selectors, expectations, counts and CSS without protocol access', t => {
  const h = harness(t);
  for (const patch of [
    { id: 'unknown-contract' }, { cssText: 'body{display:none!important;}' }, { targets: [] },
    { targets: FOCUS_CONTRACT.targets.map((target, index) => index ? target : { ...target, selector: 'body' }) },
    { targets: FOCUS_CONTRACT.targets.map((target, index) => index ? target : { ...target, count: 2 }) },
    { targets: FOCUS_CONTRACT.targets.map((target, index) => index ? target : { ...target, expectation: { ...target.expectation, text: 'Sign in' } }) },
  ]) assert.throws(() => h.bridge.setFocusContract({ ...FOCUS_CONTRACT, ...patch }), { code: 'INVALID_CONTRACT' });
  assert.equal(h.bridge.setFocusContract(FOCUS_CONTRACT), true);
  assert.equal(h.calls.length, 0); assert.equal(h.opens, 0);
});

test('focus pins eight reviewed controls including responsive Browse and the floating assistant launcher', t => {
  const h = harness(t), browse = FOCUS_CONTRACT.targets.find(target => target.id === 'desktop-browse');
  assert.equal(FOCUS_CONTRACT.id, 'tt-problem-focus-capsule-2026-11-04');
  assert.equal(FOCUS_CONTRACT.targets.length, 8);
  assert.equal(FOCUS_CONTRACT.targets.filter(target => target.expectation.tag === 'a').length, 4);
  assert.equal(browse.selector, 'nav.flex.gap-4.px-4.h-12.items-end.border-b.border-border.text-sm > button[title="Browse problems"]');
  assert.deepEqual(browse.expectation, { tag: 'button', text: '', title: 'Browse problems', ariaLabel: '', icon: 'lucide-panel-left', href: null, type: null, inForm: false });
  assert.equal(browse.count, 1);
  assert.equal(FOCUS_CONTRACT.cssText, FOCUS_CONTRACT.targets.map(target => `${target.selector}{display:none!important;}`).join('\n'));
  assert.ok(FOCUS_CONTRACT.targets.some(target => target.id === 'mobile-browse' && target.selector.includes('md:hidden')));
  assert.ok(FOCUS_CONTRACT.targets.some(target => target.id === 'ask-toni' && target.selector.includes('button.fixed.bottom-5.right-5[aria-label="Ask Toni"][type="button"]')));
  assert.ok(!FOCUS_CONTRACT.targets.filter(target => target.id !== 'top-navbar').some(target => /input|textarea|section|role="(?:alert|dialog)"/.test(target.selector)));
  for (const changed of [
    { ...FOCUS_CONTRACT, id: 'tt-problem-navigation-2026-11-02' },
    { ...FOCUS_CONTRACT, targets: FOCUS_CONTRACT.targets.slice(0, 4) },
    { ...FOCUS_CONTRACT, targets: FOCUS_CONTRACT.targets.map(target => target === browse ? { ...target, expectation: { ...target.expectation, type: 'button' } } : target) },
    { ...FOCUS_CONTRACT, targets: FOCUS_CONTRACT.targets.map(target => target === browse ? { ...target, selector: 'button[title="Browse problems"]' } : target) },
  ]) assert.throws(() => h.bridge.setFocusContract(changed), { code: 'INVALID_CONTRACT' });
  assert.equal(h.bridge.setFocusContract(FOCUS_CONTRACT), true);
  assert.equal(h.calls.length, 0);
});

test('desktop Browse fails open for form association, wrong icon, changed label/type, or count', async t => {
  const h = await focusHarness(t), target = FOCUS_CONTRACT.targets.find(item => item.id === 'desktop-browse');
  const original = h.focusElements.get(target.selector)[0];
  const variants = [
    [], [original, original], [{ ...original, tagName: 'A' }], [{ ...original, textContent: 'Browse problems' }],
    [{ ...original, closest: () => ({ tagName: 'FORM' }) }], [{ ...original, form: { tagName: 'FORM' } }],
    [{ ...original, querySelectorAll: () => [] }],
    [{ ...original, querySelectorAll: selector => selector === 'svg' ? [{}] : [] }],
    [{ ...original, querySelectorAll: () => [{}, {}] }],
    ...['button', 'submit', ''].map(type => [{ ...original, getAttribute: name => name === 'type' ? type : original.getAttribute(name) }]),
    [{ ...original, getAttribute: name => name === 'title' ? 'Search' : original.getAttribute(name) }],
    [{ ...original, getAttribute: name => name === 'href' ? '/account' : original.getAttribute(name) }],
  ];
  for (const elements of variants) {
    h.focusElements.set(target.selector, elements);
    await assert.rejects(h.bridge.inspectFocusContract(FOCUS_CONTRACT), { code: 'INVALID_PROOF' });
  }
  assert.equal(h.calls.filter(call => call.method.startsWith('CSS.')).length, 0);
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
});

test('desktop Browse is rechecked before nonempty CSS and an altered button is left visible', async t => {
  const h = await focusHarness(t), target = FOCUS_CONTRACT.targets.find(item => item.id === 'desktop-browse');
  await h.bridge.inspectFocusContract(FOCUS_CONTRACT);
  const created = await h.bridge.createFocusStyleSheet({ frameId: h.page.frameId, force: true, page: h.page });
  const original = h.focusElements.get(target.selector)[0];
  h.focusElements.set(target.selector, [{ ...original, form: {} }]);
  await assert.rejects(h.bridge.setFocusStyleSheetText(created.styleSheetId, FOCUS_CONTRACT.cssText, { page: h.page }), { code: 'INVALID_PROOF' });
  assert.equal(h.calls.filter(call => call.method === 'CSS.setStyleSheetText' && call.params.text !== '').length, 0);
  assert.equal(h.styles.get('native-own-sheet-1'), '');
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
});

test('floating Ask Toni fails open for a form, submit action, changed identity, icon, or duplicate', async t => {
  const h = await focusHarness(t), target = FOCUS_CONTRACT.targets.find(item => item.id === 'ask-toni');
  const original = h.focusElements.get(target.selector)[0];
  for (const nodes of [
    [], [original, original], [{ ...original, textContent: 'Sign in' }],
    [{ ...original, closest: () => ({ tagName: 'FORM' }) }], [{ ...original, form: {} }],
    [{ ...original, getAttribute: name => name === 'type' ? 'submit' : original.getAttribute(name) }],
    [{ ...original, getAttribute: name => name === 'aria-label' ? 'Sign in' : original.getAttribute(name) }],
    [{ ...original, querySelectorAll: selector => ['svg', 'svg.lucide-panel-left'].includes(selector) ? [{}] : [] }],
  ]) {
    h.focusElements.set(target.selector, nodes);
    await assert.rejects(h.bridge.inspectFocusContract(FOCUS_CONTRACT), { code: 'INVALID_PROOF' });
  }
  assert.equal(h.calls.filter(call => call.method.startsWith('CSS.')).length, 0);
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
});

test('narrow Browse is independently verified before any stylesheet is dispatched', async t => {
  const h = await focusHarness(t), target = FOCUS_CONTRACT.targets.find(item => item.id === 'mobile-browse');
  const original = h.focusElements.get(target.selector)[0];
  h.focusElements.set(target.selector, [{ ...original, getAttribute: name => name === 'type' ? 'submit' : original.getAttribute(name) }]);
  await assert.rejects(h.applyFocus(), { code: 'UNAVAILABLE' });
  assert.equal(h.calls.filter(call => call.method.startsWith('CSS.')).length, 0);
});

test('Focus cannot report Applied when the floating assistant or narrow Browse remains visible', async t => {
  for (const id of ['ask-toni', 'mobile-browse']) {
    const h = await focusHarness(t), target = FOCUS_CONTRACT.targets.find(item => item.id === id);
    const visible = h.focusElements.get(target.selector)[0];
    h.focusDisplay = element => element === visible ? 'block' : 'none';
    await assert.rejects(h.applyFocus(), { code: 'APPLY_FAILED' });
    assert.ok([...h.bridge.focusSheets.values()].every(sheet => h.styles.get(sheet.nativeId) === ''));
  }
});

test('focus inspects only the eight reviewed targets and restores only its dedicated stylesheet', async t => {
  const h = await focusHarness(t), selectors = new Set([...FOCUS_CONTRACT.targets.map(target => target.selector), NAVBAR_CANDIDATE]), inspected = [];
  const query = h.sandbox.document.querySelectorAll;
  h.sandbox.document.querySelectorAll = selector => { assert.ok(selectors.has(selector), 'only exact contract targets may be queried'); inspected.push(selector); return query(selector); };
  const lease = await h.applyFocus(), sheet = [...h.bridge.focusSheets.values()][0];
  assert.equal(h.styles.get(sheet.nativeId), FOCUS_CONTRACT.cssText);
  assert.ok(inspected.includes(FOCUS_CONTRACT.targets.find(target => target.id === 'desktop-browse').selector));
  await lease.restore();
  assert.equal(h.styles.get(sheet.nativeId), '');
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
  assert.ok(h.calls.filter(call => call.method === 'CSS.setStyleSheetText').every(call => call.params.styleSheetId === sheet.nativeId));
});

test('focus selector proof fails open for unknown counts, changed tag/labels/title and unsafe href', async t => {
  const h = await focusHarness(t), selector = FOCUS_CONTRACT.targets[0].selector;
  const original = h.focusElements.get(selector)[0];
  const variants = [[], [original, original], [{ ...original, tagName: 'BUTTON' }], [{ ...original, textContent: 'Sign in' }],
    [{ ...original, getAttribute: name => name === 'title' ? 'Account' : original.getAttribute(name) }],
    [{ ...original, getAttribute: name => name === 'href' ? 'https://evil.example/problems/next' : original.getAttribute(name) }],
    [{ ...original, getAttribute: name => name === 'href' ? 'https://www.tensortonic.com/problems/next?token=private' : original.getAttribute(name) }]];
  for (const elements of variants) {
    h.focusElements.set(selector, elements);
    await assert.rejects(h.bridge.inspectFocusContract(FOCUS_CONTRACT), { code: 'INVALID_PROOF' });
  }
  assert.equal(h.calls.filter(call => call.method.startsWith('CSS.')).length, 0);
});

test('focus page identity excludes login/foreign URLs, wrong frames and replaced documents', async t => {
  const h = await focusHarness(t), original = h.page;
  h.frameId = 'iframe'; await assert.rejects(h.bridge.getFocusPage(), { code: 'PAGE_CHANGED' }); h.frameId = undefined;
  h.tab.url = 'https://www.tensortonic.com/account'; await assert.rejects(h.bridge.getFocusPage(), { code: 'PAGE_CHANGED' });
  h.tab.url = original.url; h.newDocument(); await h.bridge.start();
  const current = await h.bridge.getFocusPage(); assert.notEqual(current.documentId, original.documentId);
  await assert.rejects(h.bridge.createFocusStyleSheet({ frameId: original.frameId, force: true, page: original }), { code: 'INVALID_PROOF' });
});

test('focus protocol cannot access site sheets, arbitrary domains or unverified nonempty CSS', async t => {
  const h = await focusHarness(t); await h.bridge.inspectFocusContract(FOCUS_CONTRACT);
  const created = await h.bridge.createFocusStyleSheet({ frameId: h.page.frameId, force: true, page: h.page });
  await assert.rejects(h.bridge.setFocusStyleSheetText('site-style', '', { page: h.page }), { code: 'UNSUPPORTED' });
  await assert.rejects(h.bridge.focusStyleSheetExists('site-style', { page: h.page }), { code: 'UNSUPPORTED' });
  await assert.rejects(h.bridge.setFocusStyleSheetText(created.styleSheetId, 'body{display:none}', { page: h.page }), { code: 'INVALID_PROOF' });
  const resource = [...h.bridge.resources][0];
  await assert.rejects(h.bridge._cdp(resource, 'CSS.disable', {}, h.sid), { code: 'UNSUPPORTED' });
  assert.throws(() => h.bridge._focusProtocol(resource, 'Network.getAllCookies', {}, h.sid), { code: 'UNSUPPORTED' });
  assert.throws(() => h.bridge._focusCall(resource, 'CSS.disable', {}, h.sid), { code: 'UNSUPPORTED' });
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
});

test('focus cancellation after dispatch observes the late mutation and then restores its own sheet', async t => {
  const h = await focusHarness(t), controller = new AbortController();
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  h.beforeSend = async message => { if (message.method === 'CSS.setStyleSheetText' && message.params.text) { entered(); await gate; } };
  let settled = false;
  const applying = h.applyFocus({ signal: controller.signal }); applying.finally(() => { settled = true; }).catch(() => {});
  await waiting; controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'a dispatched write must stay observed'); release();
  await assert.rejects(applying, { code: 'CANCELED' });
  assert.deepEqual([...h.styles.entries()].filter(([id]) => id !== 'site-style').map(([, text]) => text), ['']);
});

test('focus pre-cancellation dispatches no domain or stylesheet operations', async t => {
  const h = await focusHarness(t), controller = new AbortController(); controller.abort();
  await assert.rejects(h.bridge.createFocusStyleSheet({ frameId: h.page.frameId, force: true, page: h.page }, { signal: controller.signal }), { code: 'CANCELED' });
  assert.equal(h.calls.filter(call => /^(?:CSS|DOM)\./.test(call.method)).length, 0);
});

test('owned navigation empties focus styles before navigation without assuming context loss removes CSS', async t => {
  const h = await focusHarness(t); await h.applyFocus();
  const sheet = [...h.bridge.focusSheets.values()][0];
  await h.bridge.openProblemPage('https://www.tensortonic.com/problems/next?studyPlan=pytorch');
  const emptyIndex = h.calls.findIndex(call => call.method === 'CSS.setStyleSheetText' && call.params.text === '');
  const navigationIndex = h.calls.findLastIndex(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('location.assign('));
  assert.ok(emptyIndex >= 0 && emptyIndex < navigationIndex);
  assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).exists, true);
  assert.equal(h.styles.get(sheet.nativeId), '');
});

test('Runtime context resets invalidate proof and notify root but still empty retained inspector CSS', async t => {
  for (const method of ['Runtime.executionContextsCleared', 'Runtime.executionContextDestroyed']) {
    const h = await focusHarness(t); const lease = await h.applyFocus(); const sheet = [...h.bridge.focusSheets.values()][0];
    const states = []; h.bridge.onDisplayPage = value => states.push(value);
    h.messages.fire({ method, sessionId: h.sid, ...(method.endsWith('Destroyed') ? { params: { executionContextId: h.cid } } : {}) });
    assert.equal(h.bridge.focusProof, undefined);
    assert.equal(h.styles.get(sheet.nativeId), FOCUS_CONTRACT.cssText, 'fake CDP retains inspector CSS through context reset');
    assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).exists, true);
    const before = h.calls.filter(call => call.method === 'CSS.setStyleSheetText' && call.params.text === '').length;
    await lease.restore();
    assert.equal(h.styles.get(sheet.nativeId), '');
    assert.equal(h.calls.filter(call => call.method === 'CSS.setStyleSheetText' && call.params.text === '').length, before + 1);
    assert.equal(states.at(-1).closed, false); assert.deepEqual(states.at(-1).ref, { slug: 'current', planId: 'pytorch' });
  }
});

test('a nonempty write released after apply and cleanup timeouts is automatically emptied', async t => {
  const h = await focusHarness(t); h.bridge.evaluationTimeout = 10; h.bridge.cleanupTimeout = 5;
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  h.beforeSend = async message => { if (message.method === 'CSS.setStyleSheetText' && message.params.text) { entered(); await gate; } };
  let retained;
  const applying = h.applyFocus(); await waiting;
  await assert.rejects(applying, error => { retained = error.lease; return error.code === 'RESTORE_PENDING' && !!retained; });
  const sheet = [...h.bridge.focusSheets.values()][0]; assert.equal(h.styles.get(sheet.nativeId), '');
  release(); await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(h.styles.get(sheet.nativeId), '', 'a late apply must schedule its own empty write');
  assert.equal(h.calls.filter(call => call.method === 'CSS.setStyleSheetText' && call.params.text === '').length, 1);
  await retained.restore(); assert.equal(h.styles.get(sheet.nativeId), '');
});

test('late blank stylesheet creation stays owned after the create deadline', async t => {
  const h = await focusHarness(t); await h.bridge.inspectFocusContract(FOCUS_CONTRACT); h.bridge.evaluationTimeout = 10;
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  h.beforeSend = async message => { if (message.method === 'CSS.createStyleSheet') { entered(); await gate; } };
  const creating = h.bridge.createFocusStyleSheet({ frameId: h.page.frameId, force: true, page: h.page }); await waiting;
  await assert.rejects(creating, { code: 'TIMEOUT' }); release(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.bridge.focusSheets.size, 1); const sheet = [...h.bridge.focusSheets.values()][0];
  assert.equal(h.styles.get(sheet.nativeId), ''); assert.equal(sheet.dirty, false);
  await h.bridge.stop(); assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).reason, 'page-closed');
});

test('only matching owned stylesheet-removed events prove a sheet gone', async t => {
  const h = await focusHarness(t); await h.applyFocus(); const sheet = [...h.bridge.focusSheets.values()][0];
  h.messages.fire({ method: 'CSS.styleSheetRemoved', sessionId: 'foreign', params: { styleSheetId: sheet.nativeId } });
  assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).exists, true);
  h.messages.fire({ method: 'CSS.styleSheetRemoved', sessionId: h.sid, params: { styleSheetId: sheet.nativeId } });
  assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).reason, 'sheet-removed');
});

test('stylesheet protocol errors and detached groups never become generic absence proof', async t => {
  const h = await focusHarness(t); const lease = await h.applyFocus(); const sheet = [...h.bridge.focusSheets.values()][0];
  h.beforeSend = async message => { if (message.method === 'CSS.getStyleSheetText') throw Error('synthetic read failure'); };
  await assert.rejects(h.bridge.focusStyleSheetExists(sheet.id, { page: h.page }));
  h.beforeSend = undefined; h.closed.fire();
  await assert.rejects(h.bridge.focusStyleSheetExists(sheet.id, { page: h.page }));
  await assert.rejects(lease.restore(), { code: 'RESTORE_PENDING' });
  h.failTabClose = true; await assert.rejects(h.bridge.stop(), { code: 'CLEANUP_PENDING' });
  assert.equal(h.bridge.hasOwnedResources, true); assert.equal(h.bridge.cleanupPending, true);
  h.failTabClose = false; await h.bridge.stop();
  assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).reason, 'page-closed');
  await lease.restore();
});

test('cleanup attempts owned tab close after failed CSS restore and requires confirmed closure', async t => {
  const h = await focusHarness(t); await h.applyFocus(); const sheet = [...h.bridge.focusSheets.values()][0];
  h.failEmpty = true; h.failTabClose = true;
  await assert.rejects(h.bridge.stop(), { code: 'CLEANUP_PENDING' });
  assert.equal(h.tabCloses, 1); assert.equal(h.groupCloses, 1); assert.equal(h.bridge.cleanupPending, true);
  await assert.rejects(h.bridge.focusStyleSheetExists(sheet.id, { page: h.page }));
  h.failTabClose = false; await h.bridge.stop();
  assert.equal(h.bridge.hasOwnedResources, false);
  assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page })).reason, 'page-closed');
  assert.equal(h.styles.get('site-style'), '.site{color:blue}');
  assert.ok(!h.calls.some(call => call.method === 'CSS.disable'));
});

test('successful shutdown empties the owned sheet before detaching its CDP group', async t => {
  const h = await focusHarness(t); await h.applyFocus(); await h.bridge.stop();
  const emptied = h.calls.findIndex(call => call.method === 'CSS.setStyleSheetText' && call.params.text === '');
  const detach = h.calls.findIndex(call => call.method === 'Target.setAutoAttach' && call.params.autoAttach === false);
  assert.ok(emptied >= 0 && detach > emptied); assert.equal(h.bridge.cleanupPending, false);
});

test('presentation status compares only already-owned tab references and never inspects a foreign page',async t=>{
 const h=harness(t);assert.deepEqual(h.bridge.presentationState,{open:false,otherBrowserActive:false});await h.bridge.start();
 const before=h.calls.length;h.vscode.window.activeBrowserTab=h.tab;assert.deepEqual(h.bridge.presentationState,{open:true,otherBrowserActive:false});
 h.vscode.window.activeBrowserTab=new Proxy({}, {get(){throw Error('Foreign tab metadata must not be read');}});assert.deepEqual(h.bridge.presentationState,{open:true,otherBrowserActive:true});assert.equal(h.calls.length,before);
 h.vscode.window.activeBrowserTab=undefined;assert.deepEqual(h.bridge.presentationState,{open:true,otherBrowserActive:false});
});

test('a closed automation group does not erase ownership of its still-open page and emits a display update',async t=>{
 const h=harness(t),states=[];await h.bridge.openProblemPage('https://www.tensortonic.com/problems/status-owned',{onDidChangePage:value=>states.push(value)});
 h.vscode.window.activeBrowserTab=h.tab;const before=states.length;h.closed.fire();
 assert.deepEqual(h.bridge.presentationState,{open:true,otherBrowserActive:false});assert.ok(states.length>before);assert.equal(states.at(-1).ref.slug,'status-owned');
});

test('a successful stylesheet write is not Applied when any fixed control remains computed-visible',async t=>{
 const h=await focusHarness(t);h.focusDisplay='block';const {FocusModeController}=require('../src/focus-mode'),events=[];
 const controller=new FocusModeController({adapter:h.adapter,verifiedContract:FOCUS_CONTRACT,onChange:value=>events.push(value)});
 assert.equal((await controller.setEnabled(true,{page:h.page})).status,'unavailable');
 assert.ok(!events.some(value=>value.status==='applied'));assert.ok(h.calls.some(call=>call.method==='Runtime.evaluate'&&call.params.expression.includes('getComputedStyle')));
 assert.equal([...h.bridge.focusSheets.values()].length,1);assert.ok([...h.bridge.focusSheets.values()].every(sheet=>h.styles.get(sheet.nativeId)===''));await controller.dispose();
});

test('fixed control count changes after the stylesheet write fail visibility proof and restore the own sheet',async t=>{
 const h=await focusHarness(t);h.beforeSend=async message=>{if(message.method==='CSS.setStyleSheetText'&&message.params.text!=='')h.focusElements.delete(FOCUS_CONTRACT.targets[0].selector);};
 await assert.rejects(h.applyFocus(),{code:'APPLY_FAILED'});assert.ok([...h.bridge.focusSheets.values()].every(sheet=>h.styles.get(sheet.nativeId)===''));
});

const missingSheetError = { code: -32000, message: 'No style sheet with given id found' };
function protocolError(h, method, error = missingSheetError, mutate = () => {}) {
  h.beforeSend = async message => {
    if (message.method !== method) return;
    mutate(message);
    h.messages.fire({ id: message.id, sessionId: message.sessionId, error });
    return false;
  };
}
test('exact owned missing-sheet read proves absence and restores lease after refresh', async t => {
  const h = await focusHarness(t), lease = await h.applyFocus(), sheet = [...h.bridge.focusSheets.values()][0];
  h.newDocument(); h.styles.delete(sheet.nativeId);
  protocolError(h, 'CSS.getStyleSheetText');
  assert.deepEqual(await h.bridge.focusStyleSheetExists(sheet.id, { page: h.page }), { exists: false, authoritative: true, reason: 'sheet-removed', styleSheetId: sheet.id, documentId: h.page.documentId });
  await lease.restore(); assert.equal(h.styles.get('site-style'), '.site{color:blue}');
});
test('wrong method, error, native ID, session and pending mutation do not prove absence', async t => {
  for (const scenario of ['method', 'code', 'message', 'native', 'session', 'pending', 'forged']) {
    const h = await focusHarness(t); await h.applyFocus(); const sheet = [...h.bridge.focusSheets.values()][0];
    if (scenario === 'method') {
      protocolError(h, 'CSS.setStyleSheetText');
      await assert.rejects(h.bridge.setFocusStyleSheetText(sheet.id, '', { page: h.page }));
    } else {
      const error = scenario === 'code' ? { ...missingSheetError, code: -1 } : scenario === 'message' ? { ...missingSheetError, message: 'No style sheet with given id found extra' } : missingSheetError;
      protocolError(h, 'CSS.getStyleSheetText', error, message => {
        if (scenario === 'native') sheet.nativeId += '-replaced';
        if (scenario === 'session') message.sessionId = 'foreign';
        if (scenario === 'pending') sheet.pending = new Promise(() => {});
      });
      if (scenario === 'forged') h.beforeSend = async message => { if (message.method === 'CSS.getStyleSheetText') throw Object.assign(Error(missingSheetError.message), { code: 'FOCUS_SHEET_ABSENT' }); };
      await assert.rejects(h.bridge.focusStyleSheetExists(sheet.id, { page: h.page }), { code: 'RESTORE_PENDING' });
    }
    assert.equal(sheet.gone, undefined); sheet.pending = undefined;
  }
});
test('explicit Focus recovers only original root and exact URL without launch, navigation or requests', async t => {
  const h = await focusHarness(t), original = h.page, token = h.bridge.token, opens = h.opens, navs = h.navigations.length;
  h.newDocument(); const calls = h.calls.length;
  const recovered = await h.bridge.recoverFocusPage();
  assert.equal(recovered.id, original.id); assert.notEqual(recovered.documentId, original.documentId);
  assert.equal(recovered.url, original.url); assert.equal(h.opens, opens); assert.equal(h.navigations.length, navs); assert.equal(h.bridge.token, token); assert.equal(h.requests.length, 0);
  assert.ok(h.calls.slice(calls).every(call => ['Page.getFrameTree', 'Runtime.evaluate'].includes(call.method)));
});
test('Focus recovery rejects changed root, URL, session, ambiguity, trust and cancellation', async t => {
  for (const scenario of ['frame', 'url', 'session', 'ambiguous', 'trust', 'cancel']) {
    const h = await focusHarness(t); h.newDocument(); const resource = [...h.bridge.resources][0];
    const controller = new AbortController();
    if (scenario === 'frame') h.frameId = 'different';
    if (scenario === 'url') h.tab.url = 'https://www.tensortonic.com/problems/other';
    if (scenario === 'session') resource.targets.clear();
    if (scenario === 'ambiguous') h.attach('other');
    if (scenario === 'trust') h.vscode.workspace.isTrusted = false;
    if (scenario === 'cancel') controller.abort();
    await assert.rejects(h.bridge.recoverFocusPage({ signal: controller.signal }));
    assert.equal(h.bridge.target, undefined);
  }
});

test('recovery cancellation with an existing target dispatches nothing', async t => {
  const h = await focusHarness(t), controller = new AbortController(), before = h.calls.length;
  controller.abort(); await assert.rejects(h.bridge.recoverFocusPage({ signal: controller.signal }));
  assert.equal(h.calls.length, before);
});
test('failed final recovery verification does not retain a partially rebound target', async t => {
  for (const scenario of ['cancel', 'url', 'context']) {
    const h = await focusHarness(t), controller = new AbortController(); h.newDocument();
    let frames = 0;
    h.beforeSend = async message => {
      if (message.method === 'Page.getFrameTree' && ++frames === 2) {
        if (scenario === 'cancel') controller.abort();
        if (scenario === 'url') h.tab.url = 'https://www.tensortonic.com/problems/other';
        if (scenario === 'context') h.newDocument();
      }
    };
    await assert.rejects(h.bridge.recoverFocusPage({ signal: controller.signal }));
    assert.equal(h.bridge.target, undefined);
  }
});

 test('top capsule fails open for changed structure, login, loading, menus and warning text', async t => {
  const h = await focusHarness(t), selector = FOCUS_CONTRACT.targets.find(target => target.id === 'top-navbar').selector;
  for (const mutate of [
    f => f.nav.children.push(f.element('DIV', [], 'Security notice')),
    f => f.menu.matches = () => false,
    f => f.avatar.matches = () => false,
    f => f.theme.textContent = 'Verify your account',
    f => f.logo.matches = () => false,
    f => f.right.children.push(f.element('DIV', [], 'Security notice')),
    f => f.news.childNodes.push({ nodeType: 3, textContent: 'Session expired' }),
  ]) {
    const f = makeNavbar(); mutate(f); h.focusElements.set(selector, [f.nav]);
    await assert.rejects(h.applyFocus(), { code: 'UNAVAILABLE' });
  }
  assert.equal(h.calls.filter(call => call.method.startsWith('CSS.')).length, 0);
});
 test('capsule is included in computed hiding and failed confirmation restores every target', async t => {
   const h = await focusHarness(t); h.focusDisplay = element => element === h.navbar.nav ? 'block' : 'none';
   await assert.rejects(h.applyFocus(), { code: 'APPLY_FAILED' });
   assert.ok([...h.bridge.focusSheets.values()].every(sheet => h.styles.get(sheet.nativeId) === ''));
 });

test('capsule guard is sticky fail-open after a mutation and Off removes the marker', async t => {
  const h = await focusHarness(t), lease = await h.applyFocus();
  assert.equal(h.sandbox.document.documentElement.getAttribute(NAVBAR_MARKER), 'guarded');
  h.revokeNavbar();
  assert.equal(h.sandbox.document.querySelectorAll(NAVBAR_SELECTOR).length, 0);
  assert.equal(h.sandbox.document.querySelectorAll(NAVBAR_CANDIDATE).length, 1);
  await lease.restore();
  assert.equal(h.sandbox.document.documentElement.hasAttribute(NAVBAR_MARKER), false);
});
test('existing root marker is not adopted or overwritten and no nonempty stylesheet is sent', async t => {
  const h = await focusHarness(t);
  h.sandbox.document.documentElement.setAttribute(NAVBAR_MARKER, 'site-owned');
  await assert.rejects(h.applyFocus(), { code: 'APPLY_FAILED' });
  assert.equal(h.sandbox.document.documentElement.getAttribute(NAVBAR_MARKER), 'site-owned');
  assert.equal(h.calls.filter(call => call.method === 'CSS.setStyleSheetText' && call.params.text !== '').length, 0);
});
test('unconfirmed guard installation leaves cleanup pending until the owned document closes', async t => {
  const h = await focusHarness(t, { evaluationTimeout: 10 });
  h.beforeSend = async call => { if (call.method === 'Runtime.evaluate' && call.params.expression.includes('function installNavbarGuard')) return false; };
  await assert.rejects(h.applyFocus(), { code: 'RESTORE_PENDING' });
  assert.equal(h.calls.filter(call => call.method === 'CSS.setStyleSheetText' && call.params.text !== '').length, 0);
  assert.equal([...h.bridge.focusSheets.values()][0].navbarGuard, 'uncertain');
  h.beforeSend = undefined; await h.bridge.stop(); assert.equal(h.tabCloses, 1);
});
test('sheet absence never releases unresolved marker cleanup; CSS restores independently', async t => {
  for (const removed of [false, true, 'protocol']) {
    const h = await focusHarness(t), lease = await h.applyFocus(), sheet = [...h.bridge.focusSheets.values()][0];
    if (removed === true) h.messages.fire({ method: 'CSS.styleSheetRemoved', sessionId: h.sid, params: { styleSheetId: sheet.nativeId } });
    h.beforeSend = async call => { if (call.method === 'Runtime.evaluate' && call.params.expression.includes('const root=document.documentElement;')) throw Error('synthetic guard cleanup rejection'); if (removed === 'protocol' && call.method === 'CSS.getStyleSheetText') { h.messages.fire({ id: call.id, sessionId: call.sessionId, error: missingSheetError }); return false; } };
    await assert.rejects(lease.restore(), { code: 'RESTORE_PENDING' });
    assert.equal(sheet.navbarGuard,'installed');
    if (removed) assert.equal((await h.bridge.focusStyleSheetExists(sheet.id, {page:h.page})).authoritative, false);
    else { assert.equal(h.styles.get(sheet.nativeId), ''); assert.equal(sheet.dirty,false); }
    h.beforeSend = undefined; await lease.restore(); assert.equal(sheet.navbarGuard,undefined);
  }
});

function readinessFixture(h) {
 h.bridge.discoverTimeout=5000;
 const query=h.sandbox.document.querySelectorAll;
 h.sandbox.document.readyState='complete';
 h.sandbox.document.querySelectorAll=selector=>selector===require('../src/focus-navbar').NAVBAR_BASE?[h.navbar.nav]:selector.includes('svg[role="status"][aria-label="Loading"]')?(h.bodyLoading?[{getClientRects:()=>[{}]}]:[]):query(selector);
 const navQuery=h.navbar.nav.querySelectorAll;
 h.navbar.nav.querySelectorAll=selector=>{
  if(!selector.startsWith('div.w-8.h-8.rounded-full'))return navQuery(selector);
  assert.equal(selector,'div.w-8.h-8.rounded-full.bg-muted.animate-pulse,button.h-8.w-8[class~="md:h-9"][class~="md:w-9"][disabled]');
  return h.loadingPlaceholder?[{children:[],textContent:''}]:[];
 };
 let now=0;h.bridge.now=()=>now;h.bridge.pause=async()=>{now+=200;await h.onReadyPause?.();};
}
test('Focus readiness waits for initial document and reviewed hydration placeholder, without style writes',async t=>{
 const h=await focusHarness(t);readinessFixture(h);h.sandbox.document.readyState='loading';let pauses=0;
 h.onReadyPause=()=>{pauses++;h.sandbox.document.readyState='complete';h.loadingPlaceholder=pauses<3;};
 const before=h.calls.filter(x=>x.method.startsWith('CSS.')).length;
 const result=await h.bridge.waitForFocusReady(h.page);assert.equal(result.documentId,h.page.documentId);assert.equal(pauses,4);
 assert.equal(h.calls.filter(x=>x.method.startsWith('CSS.')).length,before);assert.equal(h.sandbox.document.documentElement.hasAttribute(NAVBAR_MARKER),false);
});
test('Focus readiness never retries unknown completed structure or protective navbar rejection',async t=>{
 for(const kind of ['structure','security','unknown-ready-state']) {
  const h=await focusHarness(t);readinessFixture(h);let pauses=0;h.onReadyPause=()=>pauses++;
  if(kind==='structure')h.focusElements.set(FOCUS_CONTRACT.targets[0].selector,[]);
  if(kind==='security')h.focusElements.set(NAVBAR_SELECTOR,[]);
  if(kind==='unknown-ready-state')h.sandbox.document.readyState='unrecognized';
  await assert.rejects(h.bridge.waitForFocusReady(h.page));assert.equal(pauses,0,kind);assert.equal(h.nextSheet,0);
 }
});
test('Focus readiness aborts on cancellation, context change or URL change rather than rediscovering',async t=>{
 for(const kind of ['cancel','context','url']) {
  const h=await focusHarness(t);readinessFixture(h);h.loadingPlaceholder=true;const c=new AbortController();
  h.onReadyPause=()=>{if(kind==='cancel')c.abort();if(kind==='context')h.newDocument();if(kind==='url')h.tab.url='https://www.tensortonic.com/problems/other';};
  await assert.rejects(h.bridge.waitForFocusReady(h.page,{signal:c.signal}));assert.equal(h.nextSheet,0);
 }
});
test('Focus readiness loading is bounded, and a failed final proof is never polled again',async t=>{
 const h=await focusHarness(t);readinessFixture(h);h.loadingPlaceholder=true;let pauses=0;h.onReadyPause=()=>pauses++;
 await assert.rejects(h.bridge.waitForFocusReady(h.page),{code:'TIMEOUT'});assert.ok(pauses<=25);assert.equal(h.nextSheet,0);
 h.loadingPlaceholder=false;pauses=0;h.onReadyPause=()=>{pauses++;h.focusElements.set(FOCUS_CONTRACT.targets[0].selector,[]);};
 await assert.rejects(h.bridge.waitForFocusReady(h.page));assert.equal(pauses,1);assert.equal(h.nextSheet,0);
});

test('Focus readiness recognizes the visible captured problem-body loading screen after document complete',async t=>{
 const h=await focusHarness(t);readinessFixture(h);h.bodyLoading=true;let pauses=0;h.onReadyPause=()=>{pauses++;h.bodyLoading=pauses<2;};
 await h.bridge.waitForFocusReady(h.page);assert.equal(pauses,3);assert.equal(h.nextSheet,0);
});

test('Focus readiness deadline cancels a stalled read and never creates a stylesheet',async t=>{
 const h=await focusHarness(t);readinessFixture(h);h.bridge.now=Date.now;h.bridge.discoverTimeout=20;
 const original=h.bridge._number.bind(h.bridge);let observed;
 h.bridge._number=(target,expression,generation,signal)=>{
  if(!expression.includes('document.readyState'))return original(target,expression,generation,signal);
  observed=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Canceled stalled probe')),{once:true}));
 };
 await assert.rejects(h.bridge.waitForFocusReady(h.page),{code:'TIMEOUT'});assert.equal(observed.aborted,true);assert.equal(h.nextSheet,0);
});

test('native Focus diagnostics expose target/category only and no raw page content',async t=>{
 const h=await focusHarness(t);readinessFixture(h);const events=[];
 h.focusElements.set(FOCUS_CONTRACT.targets[0].selector,[]);
 await assert.rejects(h.bridge.inspectFocusContract(FOCUS_CONTRACT,{onDiagnostic:e=>events.push(e)}));
 assert.deepEqual(events,[{stage:'contract-target',outcome:'fail',code:'missing',target:'mobile-prev'}]);
 assert.doesNotMatch(JSON.stringify(events),/https|current|studyPlan|context|frame|cookie/);
});
test('native readiness diagnostics distinguish loading reason and preserve behavior with throwing callback',async t=>{
 const h=await focusHarness(t);readinessFixture(h);const events=[];h.loadingPlaceholder=true;h.onReadyPause=()=>{h.loadingPlaceholder=false;};
 await h.bridge.waitForFocusReady(h.page,{onDiagnostic:e=>events.push(e)});
 assert.ok(events.some(e=>e.stage==='loading'&&e.code==='account-theme'));
 await h.bridge.waitForFocusReady(h.page,{onDiagnostic:()=>{throw Error('PRIVATE_CALLBACK');}});assert.equal(h.nextSheet,0);
});

function removeProblemControls(h) {
 const saved=new Map(h.focusElements);
 for(const target of FOCUS_CONTRACT.targets)if(target.id!=='top-navbar')h.focusElements.set(target.selector,[]);
 return ()=>{h.focusElements=new Map(saved);};
}
test('readiness retries exactly the observed seven-missing-controls state then requires two full proofs',async t=>{
 const h=await focusHarness(t);readinessFixture(h);const restore=removeProblemControls(h),events=[];let pauses=0;
 h.onReadyPause=()=>{pauses++;if(pauses===2)restore();};
 await assert.rejects(h.bridge.inspectFocusContract(FOCUS_CONTRACT),{code:'INVALID_PROOF'});
 await h.bridge.waitForFocusReady(h.page,{onDiagnostic:e=>events.push(e)});
 assert.equal(pauses,3);assert.equal(h.nextSheet,0);assert.ok(events.some(e=>e.stage==='contract'&&e.outcome==='wait'&&e.code==='controls-incomplete'));
 const lease=await h.applyFocus();assert.equal(h.nextSheet,1);await lease.restore();
});
test('incomplete-control readiness rejects partial, malformed, extra-count and unsafe-navbar near misses immediately',async t=>{
 for(const kind of ['partial','count','navbar-shape','navbar-missing','security']) {
  const h=await focusHarness(t);readinessFixture(h);const saved=new Map(h.focusElements);removeProblemControls(h);let pauses=0;h.onReadyPause=()=>pauses++;
  const first=FOCUS_CONTRACT.targets[0];
  if(kind==='partial')h.focusElements.set(first.selector,saved.get(first.selector));
  if(kind==='count')h.focusElements.set(first.selector,[...saved.get(first.selector),...saved.get(first.selector)]);
  if(kind==='navbar-shape')h.navbar.nav.childNodes.push({nodeType:3,textContent:'Synthetic warning'});
  if(kind==='navbar-missing'||kind==='security')h.focusElements.set(NAVBAR_SELECTOR,[]);
  const events=[];await assert.rejects(h.bridge.waitForFocusReady(h.page,{onDiagnostic:e=>events.push(e)}),{code:'INVALID_PROOF'});
  assert.equal(pauses,0,kind);assert.equal(h.nextSheet,0);assert.equal(events.some(e=>e.code==='controls-incomplete'),false);
 }
});
test('incomplete controls stay read-only through timeout, cancellation and exact-document change',async t=>{
 for(const kind of ['timeout','cancel','document']) {
  const h=await focusHarness(t);readinessFixture(h);removeProblemControls(h);const c=new AbortController();let pauses=0;
  h.onReadyPause=()=>{pauses++;if(kind==='cancel')c.abort();if(kind==='document')h.newDocument();};
  await assert.rejects(h.bridge.waitForFocusReady(h.page,{signal:c.signal}));
  assert.ok(pauses>0&&pauses<=25);assert.equal(h.nextSheet,0);assert.equal(h.bridge.focusProof,undefined);
 }
});
test('readiness does not reuse the first success after controls disappear again',async t=>{
 const h=await focusHarness(t);readinessFixture(h);let restore,pauses=0;
 h.onReadyPause=()=>{pauses++;if(pauses===1)restore=removeProblemControls(h);if(pauses===2)restore();};
 await h.bridge.waitForFocusReady(h.page);assert.equal(pauses,3);assert.equal(h.nextSheet,0);
});

test('readiness rejects malformed or extra incomplete metadata without broadening the exception',async t=>{
 for(const kind of ['extra-field','extra-count','extra-failure','duplicate-failure','wrong-url']) {
  const h=await focusHarness(t);readinessFixture(h);removeProblemControls(h);let pauses=0;h.onReadyPause=()=>pauses++;
  const evaluate=h.bridge._evaluate.bind(h.bridge);
  h.bridge._evaluate=async(...args)=>{const raw=await evaluate(...args);if(!args[1].includes('const failures=[]'))return raw;const m=JSON.parse(raw);
   if(kind==='extra-field')m.unexpected=true;
   if(kind==='extra-count')m.counts.unexpected=0;
   if(kind==='extra-failure')m.failures.push({target:'top-navbar',reason:'shape'});
   if(kind==='duplicate-failure')m.failures[1]=m.failures[0];
   if(kind==='wrong-url')m.url='https://www.tensortonic.com/problems/other';
   return JSON.stringify(m);};
  await assert.rejects(h.bridge.waitForFocusReady(h.page),{code:'INVALID_PROOF'});assert.equal(pauses,0,kind);assert.equal(h.nextSheet,0);
 }
});

test('readiness never treats a falsy inspection rejection as a successful proof',async t=>{
 for(const rejected of [undefined,null,0]) {
  const h=await focusHarness(t);readinessFixture(h);let calls=0;
  const inspect=h.bridge.inspectFocusContract.bind(h.bridge);h.bridge.inspectFocusContract=(...args)=>++calls===1?inspect(...args):Promise.reject(rejected);
  let rejectedObserved=false;try{await h.bridge.waitForFocusReady(h.page);}catch(_){rejectedObserved=true;}
  assert.equal(rejectedObserved,true);assert.equal(calls,2);assert.equal(h.nextSheet,0);
 }
});

test('current public Labs link verifies without weakening capsule restoration',async t=>{
 const h=await focusHarness(t);const f=h.navbar;
 f.links.children.splice(2,0,f.element('A',[],'Labs',{href:'/labs'}));f.links.queries.a=f.links.children.filter(n=>n.tagName==='A');
 await h.bridge.inspectFocusContract(FOCUS_CONTRACT);
 const lease=await h.applyFocus();assert.equal(h.nextSheet,1);h.revokeNavbar();
 assert.equal(h.sandbox.document.documentElement.hasAttribute(NAVBAR_MARKER),false);
 await lease.restore();assert.equal([...h.styles.values()].includes(FOCUS_CONTRACT.cssText),false);
});

test('reload recovery is anchored to a successful application and a new same-URL reload document',async t=>{
 const h=await focusHarness(t);const previous=h.page;const lease=await h.applyFocus();await lease.restore();
 h.newDocument();h.sandbox.performance={getEntriesByType:type=>{assert.equal(type,'navigation');return [{type:'reload'}];}};
 const before=h.calls.length,opens=h.opens;
 const page=await h.bridge.recoverReloadedFocusPage(previous);assert.equal(page.id,previous.id);assert.equal(page.url,previous.url);assert.notEqual(page.documentId,previous.documentId);
 assert.equal(h.opens,opens);assert.equal(h.calls.slice(before).some(c=>c.method.startsWith('CSS.')||c.method==='Target.setAutoAttach'),false);
});
test('reload recovery rejects same-document, ordinary navigation, changed URL/frame and unconfirmed prior apply',async t=>{
 for(const kind of ['same-document','navigate','back_forward','missing','url','frame','never-applied']) {
  const h=await focusHarness(t),previous=h.page;
  if(kind!=='never-applied'){const lease=await h.applyFocus();await lease.restore();}
  if(kind!=='same-document')h.newDocument();
  h.sandbox.performance={getEntriesByType:()=>kind==='missing'?[]:[{type:kind==='navigate'||kind==='back_forward'?kind:'reload'}]};
  if(kind==='url')h.tab.url='https://www.tensortonic.com/problems/other';if(kind==='frame')h.frameId='other-frame';
  const before=h.nextSheet;await assert.rejects(h.bridge.recoverReloadedFocusPage(previous));assert.equal(h.nextSheet,before,kind);
 }
});
test('reload recovery cancels delayed context acquisition and does not adopt unrelated resources',async t=>{
 const h=await focusHarness(t),previous=h.page;const lease=await h.applyFocus();await lease.restore();
 h.messages.fire({method:'Runtime.executionContextsCleared',sessionId:h.sid});
 const c=new AbortController();h.bridge.pause=async()=>c.abort();
 await assert.rejects(h.bridge.recoverReloadedFocusPage(previous,{signal:c.signal}),{code:'CANCELED'});assert.equal(h.bridge.target,undefined);
 h.newDocument();h.sandbox.performance={getEntriesByType:()=>[{type:'reload'}]};h.attach('unrelated-session');
 await assert.rejects(h.bridge.recoverReloadedFocusPage(previous));assert.equal(h.opens,1);
});

test('reload verification deadline aborts stalled read and releases partial rebound target',async t=>{
 const h=await focusHarness(t),previous=h.page;const lease=await h.applyFocus();await lease.restore();h.newDocument();
 h.bridge.discoverTimeout=20;h.bridge.evaluationTimeout=20;let probeSignal;
 const number=h.bridge._number.bind(h.bridge);
 h.bridge._number=(target,expression,generation,signal)=>{
  if(!expression.includes('performance.getEntriesByType'))return number(target,expression,generation,signal);
  probeSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Canceled probe')),{once:true}));
 };
 await assert.rejects(h.bridge.recoverReloadedFocusPage(previous),{code:'TIMEOUT'});
 assert.equal(probeSignal.aborted,true);assert.equal(h.bridge.target,undefined);assert.equal(h.nextSheet,1);
});
