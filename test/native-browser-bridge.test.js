'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
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
    getAttribute(name) { return name === 'title' ? target.expectation.title : name === 'href' && target.expectation.tag === 'a' ? 'https://www.tensortonic.com/problems/next?studyPlan=pytorch' : null; },
    closest() { return null; }, querySelectorAll(selector) { return ['svg', 'svg.lucide-panel-left'].includes(selector) ? [{}] : []; } }]]));
  h.sandbox.document.querySelectorAll = selector => h.focusElements.get(selector) || [];
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
 h.tab.url='https://www.tensortonic.com/problems/second?studyPlan=numpy&discard=private-query-sentinel#discard-private-fragment';h.tabState.fire(h.tab);assert.deepEqual(states.at(-1),{closed:false,ref:{slug:'second',planId:'numpy'}});assert.equal(JSON.stringify(states).includes('sentinel'),false);assert.equal(JSON.stringify(states).includes('private-fragment'),false);
 await h.bridge.openProblemPage('https://www.tensortonic.com/problems/third',{viewColumn:2});assert.equal(h.opens,1);assert.equal(h.openOptions.viewColumn,1);assert.equal(states.at(-1).ref.slug,'third');
 h.tab.url='https://www.tensortonic.com/auth?token=AUTH_SENTINEL';h.tabState.fire(h.tab);assert.deepEqual(states.at(-1),{closed:false});assert.equal(JSON.stringify(states).includes('AUTH_SENTINEL'),false);await h.bridge.stop();assert.equal(states.at(-1).closed,true);
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

test('focus v2026-11-03 pins exactly five controls and only the desktop Browse launcher', t => {
  const h = harness(t), browse = FOCUS_CONTRACT.targets.find(target => target.id === 'desktop-browse');
  assert.equal(FOCUS_CONTRACT.id, 'tt-problem-navigation-2026-11-03');
  assert.equal(FOCUS_CONTRACT.targets.length, 5);
  assert.equal(FOCUS_CONTRACT.targets.filter(target => target.expectation.tag === 'a').length, 4);
  assert.equal(browse.selector, 'nav.flex.gap-4.px-4.h-12.items-end.border-b.border-border.text-sm > button[title="Browse problems"]');
  assert.deepEqual(browse.expectation, { tag: 'button', text: '', title: 'Browse problems', icon: 'lucide-panel-left', href: null, type: null, inForm: false });
  assert.equal(browse.count, 1);
  assert.equal(FOCUS_CONTRACT.cssText, FOCUS_CONTRACT.targets.map(target => `${target.selector}{display:none!important;}`).join('\n'));
  assert.ok(!FOCUS_CONTRACT.targets.some(target => /input|Search problems|md:hidden.*button/.test(target.selector)));
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

test('focus inspects the five exact targets and restores only its dedicated stylesheet', async t => {
  const h = await focusHarness(t), selectors = new Set(FOCUS_CONTRACT.targets.map(target => target.selector)), inspected = [];
  const query = h.sandbox.document.querySelectorAll;
  h.sandbox.document.querySelectorAll = selector => { assert.ok(selectors.has(selector), 'drawer, mobile Browse and global navbar must not be queried'); inspected.push(selector); return query(selector); };
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
