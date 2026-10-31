'use strict';
// Cross-component simulation: isolated browser scripts + actual loopback HTTP.
// TensorTonic upstream is a local synthetic response; no external service is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { BrowserBridge } = require('../src/bridge');
const origin = 'https://www.tensortonic.com';
const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate, label) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(); }
  assert.ok(predicate(), label);
}
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function browserRealm(storage, calls, upstream) {
  let interval;
  let listener;
  let reservation;
  let disposed = false;
  const window = {}; window.top = window;
  const runtime = { id: 'fixture-extension', onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage(message) {
      if (disposed) throw new Error('Simulated destroyed browser realm');
      if (message.type === 'reserve') { reservation = 'fixture-explicit-reservation'; return { reservation }; }
      if (message.type === 'save') {
        assert.equal(message.reservation, reservation);
        storage.record = copy(message.record); reservation = undefined; return { ok: true };
      }
      if (message.type === 'claim') return storage.record ? { record: { ...storage.record, origin } } : { pending: storage.pending };
      if (message.type === 'forget') { storage.pending = storage.record; storage.record = undefined; return { ok: true }; }
      if (message.type === 'revocations') return { pending: storage.pending };
      if (message.type === 'revoked') { storage.pending = undefined; return { ok: true }; }
      if (message.type === 'invalid') { storage.record = undefined; return { ok: true }; }
      if (message.type === 'abandon') { storage.pending = copy(message.record); return { ok: true }; }
      return { error: 'Unsupported fixture message' };
    } };
  const context = vm.createContext({ window, location: { origin, href: origin + '/problems/synthetic' }, URL, Date,
    AbortController, AbortSignal, chrome: { runtime },
    console: { info() {}, warn() {}, error() {} },
    setInterval(fn) { interval = fn; },
    async fetch(url, init = {}) {
      const target = new URL(url); calls.push({ path: target.pathname, method: init.method || 'GET' });
      if (target.origin === 'https://api.tensortonic.com') {
        upstream.push({ path: target.pathname, method: init.method || 'GET' });
        assert.equal(init.method, 'GET', 'Reconnect must never issue automatic grading');
        return new Response(JSON.stringify({ fixture: true, slug: 'synthetic' }), { status: 200 });
      }
      assert.equal(target.hostname, '127.0.0.1', 'No non-loopback network access');
      return fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
    },
  });
  vm.runInContext(read('browser-companion/shared.js'), context);
  vm.runInContext(read('src/browser-connector.js'), context);
  vm.runInContext(read('browser-companion/companion.js'), context);
  return {
    api: context.__tensorTonicCompanion,
    tick() { interval(); },
    abortTransport() { if (window.__tensorTonicVSCode) window.__tensorTonicVSCode.abort(); },
    destroy() { disposed = true; if (window.__tensorTonicVSCode) window.__tensorTonicVSCode.abort(); },
    globalForget() { listener({ type: 'forget-pairing' }, { id: runtime.id }); },
  };
}

test('real bridge and actual browser scripts reconnect across editor restart, page reinjection and transient transport loss without pairing or grading replay', async t => {
  let raw;
  const persistence = { async load() { return raw; }, async save(value) { raw = value; }, async delete() { raw = undefined; } };
  const clock = { now: Date.now() };
  const options = { persistence, preferredPort: await freePort(), now: () => clock.now };
  const bridges = []; const realms = [];
  t.after(async () => { for (const realm of realms) realm.destroy(); for (const bridge of bridges) await bridge.shutdown(); });
  const calls = []; const upstream = []; const storage = {};
  const first = new BrowserBridge(options); bridges.push(first); await first.start();
  const initial = browserRealm(storage, calls, upstream); realms.push(initial);
  // Initial pairing is explicit; no network operation precedes this request.
  await pause(); assert.equal(calls.length, 0);
  const paired = await initial.api.connect(first.pairingCode());
  assert.equal(paired.phase, 'connecting');
  await until(() => first.connected, 'Initial connector polled real bridge');
  assert.ok(storage.record); assert.equal(storage.record.token, undefined);
  const original = copy(storage.record);
  assert.deepEqual(await first.request('/api/problems/synthetic'), { fixture: true, slug: 'synthetic' });
  await until(() => initial.api.status().phase === 'connected', 'Connector confirmed response');
  assert.equal(upstream.length, 1);

  // Closing Code preserves its secure lease; recreating the browser realm models
  // a real reload/restart, with only extension-persisted data surviving.
  await first.shutdown(); initial.destroy();
  const second = new BrowserBridge(options); bridges.push(second);
  assert.equal(await second.restore(), true);
  const reloaded = browserRealm(storage, calls, upstream); realms.push(reloaded);
  await until(() => { reloaded.tick(); return second.connected; }, 'Reloaded content resumed the restarted listener');
  assert.equal(calls.filter(call => call.path === '/pair').length, 1);
  assert.deepEqual(storage.record, original);
  assert.equal(upstream.length, 1, 'Resume itself made no upstream or grading request');
  assert.deepEqual(await second.request('/api/problems/synthetic'), { fixture: true, slug: 'synthetic' });
  await until(() => reloaded.api.status().phase === 'connected', 'Resumed connector received response');

  // Model the server watchdog marking an interrupted transport stale. The
  // production resume interval then uses the same persistent capability.
  reloaded.abortTransport();
  await until(() => reloaded.api.status().phase === 'disconnected', 'Transport terminated');
  second._connection(false); clock.now += 45001;
  const countBefore = upstream.length;
  reloaded.tick();
  await until(() => second.connected, 'Interval resumed transport without a new setup ticket');
  assert.equal(upstream.length, countBefore);
  assert.equal(calls.filter(call => call.path === '/pair').length, 1);
  assert.equal(calls.some(call => /\/(?:submit|run|run-cases)$/.test(call.path)), false);
  assert.equal(storage.record.expiresAt, original.expiresAt, 'Reconnect never extends the absolute lease');

  await reloaded.api.disconnect();
  assert.equal(storage.record, undefined); assert.equal(storage.pending, undefined);
  assert.equal(raw, undefined); assert.equal(second.lease, undefined); assert.equal(second.token, undefined);
  const beforeForgetTick = calls.length;
  reloaded.tick(); await pause(); await pause();
  assert.equal(calls.length, beforeForgetTick, 'Explicit Forget does not reconnect');
  assert.ok(calls.some(call => call.path === '/revoke'));
});
