'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { NativeBrowserBridge, displayedBase64, problemUrl } = require('../src/native-browser-bridge');
function emitter() { const handlers = new Set(); return { event: fn => { handlers.add(fn); return { dispose: () => handlers.delete(fn) }; }, fire: value => { for (const fn of handlers) fn(value); } }; }
function harness(t, options = {}) {
  const started = emitter(), ended = emitter(); const calls = [], stops = [], requests = [];
  const h = { calls, stops, requests, status: 200, data: { ok: true }, chunkLimit: Infinity, sessions: [], timers: new Set() };
  const location = { origin: 'https://www.tensortonic.com', pathname: '/', search: '', assign(value) { const u = new URL(value); this.origin = u.origin; this.pathname = u.pathname; this.search = u.search; h.navigations.push(value); } };
  h.navigations = [];
  const sandbox = { location, document: {}, AbortController, Uint8Array, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    clearTimeout(timer) { clearTimeout(timer); h.timers.delete(timer); },
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); h.timers.add(timer); return timer; },
    fetch: async (url, init) => { requests.push({ url, init }); if (h.fetch) return h.fetch(url, init); return new Response(JSON.stringify(h.data), { status: h.status }); },
  }; sandbox.window = sandbox; sandbox.top = sandbox; sandbox.globalThis = sandbox; vm.createContext(sandbox); h.sandbox = sandbox;
  h.evaluate = async expression => {
    calls.push(expression);
    if (h.beforeEval) await h.beforeEval(expression);
    const value = vm.runInContext(expression, sandbox);
    let result = typeof value === 'number' ? String(value) : JSON.stringify(value);
    if (typeof value === 'string' && value.length > h.chunkLimit) result = JSON.stringify(value.slice(0, h.chunkLimit)) + '…';
    return { result };
  };
  const vscode = { workspace: { isTrusted: true }, env: {}, debug: {
    onDidStartDebugSession: started.event, onDidTerminateDebugSession: ended.event,
    async startDebugging(_folder, config, settings) {
      h.launches = (h.launches || 0) + 1; h.config = config; h.settings = settings;
      if (h.launch) return h.launch(config);
      h.addTree(config); return true;
    },
    async stopDebugging(session) { stops.push(session.id); for (const candidate of [...h.sessions]) if (candidate === session || candidate.parentSession === session) ended.fire(candidate); },
  } };
  h.addTree = config => {
    const root = { id: 'root-' + h.sessions.length, name: config.name, type: 'editor-browser', customRequest: async () => { throw new Error('root not evaluable'); } };
    const child = { id: 'child-' + h.sessions.length, name: 'TensorTonic', type: 'pwa-editor-browser', parentSession: root, customRequest: async (command, args) => { assert.equal(command, 'evaluate'); assert.equal(args.context, 'watch'); return h.evaluate(args.expression); } };
    h.sessions.push(root, child); started.fire(root); started.fire(child); return { root, child };
  };
  h.started = started; h.ended = ended; h.vscode = vscode;
  h.bridge = new NativeBrowserBridge(vscode, { discoverTimeout: 30, evaluationTimeout: 100, requestTimeout: 1000, pause: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 2))), ...options });
  t.after(async () => { for (const timer of h.timers) clearTimeout(timer); await h.bridge.dispose(); });
  return h;
}
test('constructor is inert and tolerates missing optional debug APIs', () => {
  const b = new NativeBrowserBridge({ workspace: { isTrusted: true } });
  assert.equal(b.connected, false); assert.equal(b.sessions.size, 0);
  return assert.rejects(b.start(), { code: 'UNAVAILABLE' });
});
test('explicit launch selects one owned top-level TensorTonic child without unrelated debugger access', async t => {
  const h = harness(t); h.started.fire({ id: 'user', name: 'User debugger', type: 'pwa-node', customRequest() { throw new Error('must not inspect'); } });
  await h.bridge.start(); assert.equal(h.bridge.connected, true); assert.equal(h.launches, 1);
  assert.equal(h.config.type, 'editor-browser'); assert.deepEqual(h.settings, { suppressSaveBeforeStart: true });
  const token = h.bridge.token; await h.bridge.start(); assert.equal(h.launches, 1); assert.equal(h.bridge.token, token);
  await h.bridge.stop(); assert.ok(!h.stops.includes('user')); assert.equal(h.bridge.connected, false);
});
test('allowlist and body limits reject before evaluation or fetch', async t => {
  const h = harness(t); await h.bridge.start(); const count = h.calls.length;
  for (const [route, opts] of [['/api/me', {}], ['https://evil.example/x', {}], ['/api/problems/x/submit', { method: 'POST', body: { code: 'pass', cookie: 'no' } }], ['/api/problems/x/submit', { method: 'POST', body: { code: 'x'.repeat(600000) } }]]) {
    await assert.rejects(h.bridge.request(route, opts), { code: 'UNSUPPORTED' });
  }
  assert.equal(h.calls.length, count); assert.equal(h.requests.length, 0);
});
test('normal authenticated fetch returns JSON without reading credentials or custom authorization', async t => {
  const h = harness(t); await h.bridge.start(); h.data = { data: { title: '안녕', examples: [1, 2] } };
  assert.deepEqual(await h.bridge.request('/api/problems/x'), h.data);
  assert.equal(h.requests.length, 1); const init = h.requests[0].init;
  assert.equal(init.credentials, 'include'); assert.equal(init.redirect, 'error'); assert.equal(init.headers, undefined);
  assert.ok(h.calls.every(x => !/document\.cookie|localStorage|sessionStorage|Authorization|storage\.get/.test(x)));
  assert.equal(Object.keys(h.sandbox).filter(x => x.startsWith('__tt_native_')).length, 0);
});
test('large Unicode JSON is reconstructed despite DAP display truncation without upstream retry', async t => {
  const h = harness(t, { requestTimeout: 5000 }); await h.bridge.start(); h.data = { text: '🙂 한글 "\\\n'.repeat(3000) }; h.chunkLimit = 600;
  assert.deepEqual(await h.bridge.request('/api/problems/x'), h.data);
  assert.equal(h.requests.length, 1); assert.ok(h.calls.some(x => /data.slice/.test(x)));
});
test('401 and 403 retain the owned transport for normal login and explicit manual retry', async t => {
  const h = harness(t); await h.bridge.start();
  for (const status of [401, 403]) { h.status = status; await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'AUTH_REQUIRED' }); assert.equal(h.bridge.connected, true); }
  h.status = 200; await h.bridge.start(); assert.equal(h.launches, 1); assert.deepEqual(await h.bridge.request('/api/problems/x'), { ok: true });
});
test('POST is dispatched once with JSON-encoded code and never retried after response failure', async t => {
  const h = harness(t); await h.bridge.start(); h.fetch = async () => { throw new Error('hidden raw transport info'); };
  const code = '";globalThis.injected=true;//\n';
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code } }), { code: 'UNCERTAIN_RESULT' });
  assert.equal(h.requests.length, 1); assert.equal(h.sandbox.injected, undefined);
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { code });
});
test('response size is bounded before JSON parse and no retry occurs', async t => {
  const h = harness(t, { maxResponseBytes: 20 }); await h.bridge.start(); h.data = { text: 'x'.repeat(200) };
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'TOO_LARGE' }); assert.equal(h.requests.length, 1);
});
test('same-origin and top-frame checks fail closed before dispatch', async t => {
  const h = harness(t); await h.bridge.start(); h.sandbox.location.origin = 'https://evil.example';
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'PAGE_CHANGED' }); assert.equal(h.requests.length, 0);
});
test('cancellation aborts only the transient operation; dispatched POST is uncertain and not replayed', async t => {
  const h = harness(t); await h.bridge.start(); let dispatch;
  const seen = new Promise(resolve => { dispatch = resolve; });
  h.fetch = (_url, init) => new Promise((resolve, reject) => { dispatch(); init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const controller = new AbortController(); const pending = h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' }, signal: controller.signal });
  await seen; controller.abort(); await assert.rejects(pending, { code: 'UNCERTAIN_RESULT' });
  assert.equal(h.requests.length, 1); assert.equal(Object.keys(h.sandbox).filter(x => x.startsWith('__tt_native_')).length, 0);
});
test('navigation and requests share a synchronous latch and preserve token for intentional problem navigation', async t => {
  const h = harness(t); await h.bridge.start(); const token = h.bridge.token;
  const nav = h.bridge.openProblemPage('https://www.tensortonic.com/problems/a?studyPlan=pytorch-basics');
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'BUSY' }); await nav;
  assert.equal(h.bridge.token, token); assert.equal(h.navigations.length, 1);
  h.sandbox.location.pathname = '/account';
  await assert.rejects(h.bridge.openProblemPage('https://www.tensortonic.com/problems/b'), { code: 'PAGE_CHANGED' });
  assert.equal(h.navigations.length, 1);
});
test('pending grading prevents navigation, reconnect, and a second grading dispatch', async t => {
  const h = harness(t); await h.bridge.start(); let dispatch; const seen = new Promise(r => { dispatch = r; });
  h.fetch = () => { dispatch(); return new Promise(() => {}); };
  const controller = new AbortController(); const pending = h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' }, signal: controller.signal });
  await seen;
  await assert.rejects(h.bridge.openProblemPage('https://www.tensortonic.com/problems/b'), { code: 'BUSY' });
  await assert.rejects(h.bridge.start(), { code: 'BUSY' });
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' } }), { code: 'BUSY' });
  controller.abort(); await assert.rejects(pending); assert.equal(h.requests.length, 1);
});
test('disconnect during pending launch cleans only late owned sessions', async t => {
  const h = harness(t); let resolveLaunch; h.launch = config => new Promise(resolve => { resolveLaunch = () => { h.addTree(config); resolve(true); }; });
  const connecting = h.bridge.start(); const rejected = assert.rejects(connecting, { code: 'CANCELED' });
  const stopping = h.bridge.stop(); resolveLaunch(); await Promise.all([stopping, rejected]);
  assert.equal(h.bridge.connected, false); assert.ok(h.stops.length >= 1); assert.equal(h.bridge.sessions.size, 0);
});
test('strict display and canonical URL parsing rejects truncation, injected escapes, foreign pages and extra query keys', () => {
  assert.equal(displayedBase64('"YWJj"', 4), 'YWJj'); assert.equal(displayedBase64("'YWJj'", 4), 'YWJj');
  for (const value of ['"YWJj…"', '"\\u0059WJj"', 'YWJj + evil()', 'abc']) assert.equal(displayedBase64(value, 4), undefined);
  assert.ok(problemUrl('https://www.tensortonic.com/problems/x?studyPlan=abc'));
  for (const value of ['https://evil.example/problems/x', 'https://www.tensortonic.com/account', 'https://www.tensortonic.com/problems/x?token=secret', 'https://www.tensortonic.com/problems/x#x']) assert.equal(problemUrl(value), undefined);
});

test('already canceled POST is never dispatched and is reported as canceled, not retried', async t => {
  const h = harness(t); await h.bridge.start(); const signal = AbortSignal.abort();
  await assert.rejects(h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' }, signal }), { code: 'CANCELED' });
  assert.equal(h.requests.length, 0);
});
test('ambiguous owned leaves fail closed while a foreign origin leaf is never chosen', async t => {
  const h = harness(t); h.launch = config => {
    const { root } = h.addTree(config);
    const another = { id: 'ambiguous', name: 'child', type: 'pwa-editor-browser', parentSession: root, customRequest: async (_command, args) => h.evaluate(args.expression) };
    h.sessions.push(another); h.started.fire(another); return true;
  };
  await assert.rejects(h.bridge.start(), { code: 'AMBIGUOUS_TARGET' }); assert.equal(h.bridge.connected, false); assert.equal(h.requests.length, 0);
});
test('trust revoked during response polling prevents further extraction and cleans only its slot', async t => {
  const h = harness(t); await h.bridge.start(); h.beforeEval = expression => { if (expression.includes('.state:-2')) h.vscode.workspace.isTrusted = false; };
  await assert.rejects(h.bridge.request('/api/problems/x'), { code: 'CANCELED' });
  assert.equal(h.requests.length, 1); assert.ok(!h.calls.some(x => x.includes('data.slice')));
});
test('an owned child ending invalidates a pending POST without replaying it or stopping user sessions', async t => {
  const h = harness(t); await h.bridge.start(); let dispatch; const seen = new Promise(r => { dispatch = r; });
  h.fetch = () => { dispatch(); return new Promise(() => {}); };
  const pending = h.bridge.request('/api/problems/x/submit', { method: 'POST', body: { code: 'pass' } }); await seen;
  h.ended.fire(h.sessions[1]); await assert.rejects(pending, { code: 'UNCERTAIN_RESULT' }); assert.equal(h.requests.length, 1);
});
test('failed owned stop retains identity for cleanup retry and blocks a new launch', async t => {
  let clock = 1000; const h = harness(t, { now: () => clock, pause: async () => { clock += 1000; } });
  await h.bridge.start(); const stop = h.vscode.debug.stopDebugging;
  h.vscode.debug.stopDebugging = async () => { throw new Error('Synthetic stop failed'); };
  await assert.rejects(h.bridge.stop(), { code: 'CLEANUP_PENDING' }); assert.ok(h.bridge.sessions.size > 0);
  await assert.rejects(h.bridge.start(), { code: 'CLEANUP_PENDING' }); assert.equal(h.launches, 1);
  h.vscode.debug.stopDebugging = stop; await h.bridge.stop(); assert.equal(h.bridge.sessions.size, 0);
});
test('manual OAuth or account navigation is not taken over by problem presentation', async t => {
  const h = harness(t); await h.bridge.start();
  h.sandbox.location.pathname = '/auth'; await assert.rejects(h.bridge.openProblemPage('https://www.tensortonic.com/problems/x'), { code: 'PAGE_CHANGED' });
  assert.deepEqual(h.navigations, []); assert.equal(h.requests.length, 0);
});
test('web and remote workspaces refuse native launch without changing policy', async t => {
  const h = harness(t); h.vscode.env.uiKind = 2;
  await assert.rejects(h.bridge.start(), { code: 'UNAVAILABLE' }); assert.equal(h.launches, undefined);
  h.vscode.env.uiKind = 1; h.vscode.env.remoteName = 'ssh';
  await assert.rejects(h.bridge.start(), { code: 'UNAVAILABLE' }); assert.equal(h.launches, undefined);
});

test('intentional navigation can replace its child session without losing owned root or logical token', async t => {
  const h = harness(t); await h.bridge.start(); const token = h.bridge.token; let replaced = false;
  h.bridge.pause = async () => {
    if (replaced || !h.navigations.length) return; replaced = true;
    const old = h.bridge.target, root = old.parentSession; h.ended.fire(old);
    const child = { id: 'replacement', name: 'new page', type: 'pwa-editor-browser', parentSession: root, customRequest: async (_command, args) => h.evaluate(args.expression) };
    h.sessions.push(child); h.started.fire(child);
  };
  assert.equal((await h.bridge.openProblemPage('https://www.tensortonic.com/problems/new')).requested, true);
  assert.equal(h.bridge.target.id, 'replacement'); assert.equal(h.bridge.token, token); assert.equal(h.bridge.connected, true);
});
test('aborted start alone obsoletes its generation and immediately stops a late owned tree', async t => {
  const h = harness(t); let release;
  h.launch = config => new Promise(resolve => { release = () => { h.addTree(config); resolve(true); }; });
  const controller = new AbortController(); const pending = h.bridge.start({ signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { code: 'CANCELED' });
  assert.equal(h.bridge.cleanupPending, true); release(); await new Promise(setImmediate);
  assert.equal(h.bridge.sessions.size, 0); assert.ok(h.stops.length > 0); assert.equal(h.bridge.connected, false);
});
test('timed out unresolved launch reports cleanup pending until the original launch really settles', async t => {
  const h = harness(t, { launchTimeout: 10 }); let release;
  h.launch = config => new Promise(resolve => { release = () => { h.addTree(config); resolve(true); }; });
  await assert.rejects(h.bridge.start(), { code: 'TIMEOUT' });
  await assert.rejects(h.bridge.stop(), { code: 'CLEANUP_PENDING' }); assert.equal(h.bridge.cleanupPending, true);
  release(); await new Promise(setImmediate); assert.equal(h.bridge.sessions.size, 0); assert.ok(h.stops.length > 0);
});
test('successful request clears its transient page cleanup timer as well as data slot', async t => {
  const h = harness(t); await h.bridge.start(); await h.bridge.request('/api/problems/x');
  assert.equal(h.timers.size, 0); assert.equal(Object.keys(h.sandbox).filter(x => x.startsWith('__tt_native_')).length, 0);
});

test('navigation verifies replacement page when old child dies before its evaluate response returns', async t => {
  const h = harness(t); await h.bridge.start(); const original = h.evaluate; let replaced = false;
  h.evaluate = async expression => {
    const result = await original(expression);
    if (!replaced && expression.includes('location.assign')) {
      replaced = true; const old = h.bridge.target; h.ended.fire(old);
      const child = { id: 'early-replacement', name: 'new page', type: 'pwa-editor-browser', parentSession: old.parentSession, customRequest: async (_command, args) => h.evaluate(args.expression) };
      h.sessions.push(child); h.started.fire(child);
      throw new Error('Old context destroyed after navigation dispatch');
    }
    return result;
  };
  assert.equal((await h.bridge.openProblemPage('https://www.tensortonic.com/problems/new?studyPlan=pytorch-basics')).requested, true);
  assert.equal(h.bridge.target.id, 'early-replacement'); assert.equal(h.navigations.length, 1);
});
