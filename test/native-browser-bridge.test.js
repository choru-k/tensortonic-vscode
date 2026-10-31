'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { NativeBrowserBridge, displayedBase64, problemUrl } = require('../src/native-browser-bridge');
function emitter() { const handlers = new Set(); return { event: fn => { handlers.add(fn); return { dispose: () => handlers.delete(fn) }; }, fire: value => { for (const fn of [...handlers]) fn(value); } }; }
function harness(t, options = {}) {
  const messages = emitter(), closed = emitter(), tabClosed = emitter(), tabState = emitter();
  const h = { requests: [], calls: [], timers: new Set(), data: { ok: true }, status: 200, opens: 0, groupCloses: 0, tabCloses: 0, sid: 'owned-page', cid: 7, uid: 'context-7', navigations: [] };
  const location = { origin: 'https://www.tensortonic.com', pathname: '/', search: '', assign(value) { const u = new URL(value); Object.assign(this, { origin: u.origin, pathname: u.pathname, search: u.search }); h.tab.url = u.href; h.navigations.push(value); h.newDocument(); } };
  const sandbox = { location, document: {}, AbortController, Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'),
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
    else if (message.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'top-frame' } } };
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
