'use strict';
// Real loopback transport only; all secrets and submissions are synthetic fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { BrowserBridge, REMEMBER_MS } = require('../src/bridge');
const ORIGIN = 'https://www.tensortonic.com';

async function vacantPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function memoryStore() {
  return { raw: undefined, writes: 0, deletes: 0,
    async load() { return this.raw; },
    async save(value) { this.raw = value; this.writes++; },
    async delete() { this.raw = undefined; this.deletes++; },
  };
}
function wire(bridge, route, body, headers = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: bridge.port, path: route, method,
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, agent: false }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('Test HTTP timeout')));
    req.end(body == null ? undefined : JSON.stringify(body));
  });
}
async function fixture(t, overrides = {}) {
  const store = overrides.store || memoryStore();
  const clock = { value: Date.now() };
  const port = await vacantPort();
  const options = { persistence: store, preferredPort: port, now: () => clock.value, requestTimeout: 2000 };
  const bridge = new BrowserBridge(options);
  t.after(() => bridge.shutdown());
  await bridge.start();
  return { bridge, store, clock, options };
}
async function pair(bridge) {
  const pairingKey = bridge.pairingCode().split(':')[2];
  const response = await wire(bridge, '/pair', { pairingKey });
  assert.equal(response.status, 200);
  return response.body;
}

test('remembered pairing survives editor shutdown and resumes on its stable loopback port', async t => {
  const { bridge, store, clock, options } = await fixture(t);
  const first = await pair(bridge); const raw = store.raw;
  assert.match(first.resumeKey, /^[a-f0-9]{64}$/);
  assert.equal(first.expiresAt, clock.value + REMEMBER_MS);
  assert.equal(JSON.parse(raw).port, bridge.port);
  assert.equal(Object.hasOwn(JSON.parse(raw), 'token'), false);
  await bridge.shutdown(); assert.equal(store.raw, raw);
  const restarted = new BrowserBridge(options); t.after(() => restarted.shutdown());
  assert.equal(await restarted.restore(), true);
  const resumed = await wire(restarted, '/resume', { resumeKey: first.resumeKey });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.base, first.base);
  assert.notEqual(resumed.body.token, first.token);
  assert.equal(resumed.body.expiresAt, first.expiresAt);
  assert.equal(store.raw, raw, 'Resume must not slide expiration or rewrite the key');
  assert.equal((await wire(restarted, '/poll?key=' + first.token, undefined, {}, 'GET')).status, 403);
});

test('remembered resume rejects wrong origin, loopback host, key, shape, path and method', async t => {
  const { bridge, clock } = await fixture(t); const p = await pair(bridge); clock.value += 45001;
  const body = { resumeKey: p.resumeKey };
  for (const response of await Promise.all([
    wire(bridge, '/resume', body, { Origin: 'https://evil.example' }),
    wire(bridge, '/resume', body, { Host: 'localhost:' + bridge.port }),
    wire(bridge, '/resume', { resumeKey: '0'.repeat(64) }),
    wire(bridge, '/resume', { ...body, expiresAt: clock.value + REMEMBER_MS }),
    wire(bridge, '/resume?extra=true', body),
    wire(bridge, '/resume', body, {}, 'GET'),
  ])) assert.equal(response.status, 403);
  assert.equal((await wire(bridge, '/resume', body)).status, 200);
});

test('concurrent resume admits one browser and reserves first poll without rotating twice', async t => {
  const { bridge, clock } = await fixture(t); const p = await pair(bridge); clock.value += 45001;
  const responses = await Promise.all([wire(bridge, '/resume', { resumeKey: p.resumeKey }), wire(bridge, '/resume', { resumeKey: p.resumeKey })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const accepted = responses.find(r => r.status === 200);
  assert.equal(bridge.token, accepted.body.token);
  assert.equal((await wire(bridge, '/resume', { resumeKey: p.resumeKey })).status, 409);
});

test('absolute 30-day expiry terminates live requests and rejects remembered resume', async t => {
  const { bridge, store, clock } = await fixture(t); const p = await pair(bridge);
  bridge._connection(true); clock.value = p.expiresAt;
  await assert.rejects(bridge.request('/api/problems/test'), /expired/i);
  await bridge.persistenceTail;
  assert.equal(store.raw, undefined); assert.equal(bridge.connected, false); assert.equal(bridge.token, undefined);
  assert.equal((await wire(bridge, '/resume', { resumeKey: p.resumeKey })).status, 403);
  assert.equal((await wire(bridge, '/poll?key=' + p.token, undefined, {}, 'GET')).status, 403);
});

test('expired or tampered persisted leases never restore a listener', async t => {
  const { bridge, store, clock, options } = await fixture(t); const p = await pair(bridge);
  await bridge.shutdown(); clock.value = p.expiresAt;
  const expired = new BrowserBridge(options); t.after(() => expired.shutdown());
  assert.equal(await expired.restore(), false); assert.equal(expired.server, undefined);
  const record = JSON.parse(store.raw); record.expiresAt += REMEMBER_MS; store.raw = JSON.stringify(record);
  const extended = new BrowserBridge(options); t.after(() => extended.shutdown());
  assert.equal(await extended.restore(), false); assert.equal(extended.server, undefined);
});

test('reconnecting rejects queued and uncertain grading without replay', async t => {
  const { bridge, clock } = await fixture(t); const p = await pair(bridge);
  bridge._connection(true);
  const request = bridge.request('/api/problems/test/submit', { method: 'POST', body: { code: '# synthetic, never executed' } });
  const rejected = assert.rejects(request, /reconnected|canceled/i);
  const pending = [...bridge.pending.values()][0]; pending.dispatched = true;
  bridge._connection(false); clock.value += 45001;
  const response = await wire(bridge, '/resume', { resumeKey: p.resumeKey });
  assert.equal(response.status, 200); await rejected;
  assert.equal(bridge.pending.size, 0); assert.equal(bridge.queue.length, 0);
  assert.equal((await wire(bridge, '/result?key=' + p.token, { id: 'old', status: 200, data: {} })).status, 403);
});

test('explicit browser revocation deletes remembered key and invalidates old session', async t => {
  const { bridge, store } = await fixture(t); const p = await pair(bridge);
  const response = await wire(bridge, '/revoke', { resumeKey: p.resumeKey });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { ok: true });
  assert.equal(store.raw, undefined); assert.equal(bridge.token, undefined);
  assert.equal((await wire(bridge, '/resume', { resumeKey: p.resumeKey })).status, 403);
  assert.equal((await wire(bridge, '/poll?key=' + p.token, undefined, {}, 'GET')).status, 403);
});

test('explicit editor revocation deletes lease and stops its owner listener', async t => {
  const { bridge, store } = await fixture(t); await pair(bridge);
  await bridge.revoke(); assert.equal(store.raw, undefined); assert.equal(bridge.server, undefined);
});

test('SecretStorage write failure never returns a persistent or live capability', async t => {
  const store = memoryStore(); store.save = async () => { throw new Error('Synthetic unavailable keychain'); };
  const { bridge } = await fixture(t, { store });
  const pairingKey = bridge.pairingCode().split(':')[2];
  const response = await wire(bridge, '/pair', { pairingKey });
  assert.equal(response.status, 500); assert.equal(response.body.token, undefined);
  assert.equal(bridge.lease, undefined); assert.equal(bridge.token, undefined); assert.equal(store.raw, undefined);
});

test('second editor cannot bind, revoke or erase the active owner remembered lease', async t => {
  const { bridge, store, options } = await fixture(t); await pair(bridge); const raw = store.raw;
  const second = new BrowserBridge(options); t.after(() => second.shutdown());
  await assert.rejects(second.restore(), /EADDRINUSE|address already in use/i);
  assert.equal(second.server, undefined); assert.equal(store.raw, raw);
  await assert.rejects(second.revoke(), /does not own/i);
  await second.shutdown(); assert.equal(store.raw, raw); assert.ok(bridge.server);
});

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(predicate(), 'Expected async fixture condition');
}

test('revocation during pending secure storage write cannot resurrect pairing', async t => {
  const { bridge, store } = await fixture(t);
  let release; let writing = false;
  store.save = async value => { writing = true; await new Promise(resolve => { release = resolve; }); store.raw = value; };
  const pairingKey = bridge.pairingCode().split(':')[2];
  const pairing = wire(bridge, '/pair', { pairingKey });
  await waitUntil(() => writing);
  const revoke = bridge.revoke(); release();
  const paired = await pairing;
  assert.equal(paired.status, 403); assert.equal(paired.body.token, undefined);
  await revoke; assert.equal(store.raw, undefined); assert.equal(bridge.lease, undefined); assert.equal(bridge.token, undefined);
});

test('replacement pairing during pending secure storage write cannot return stale capability', async t => {
  const { bridge, store } = await fixture(t);
  let release; let writing = false; let writes = 0;
  store.save = async value => { writes++; if (writes === 1) { writing = true; await new Promise(resolve => { release = resolve; }); } store.raw = value; };
  const firstKey = bridge.pairingCode().split(':')[2];
  const first = wire(bridge, '/pair', { pairingKey: firstKey });
  await waitUntil(() => writing);
  const secondKey = bridge.pairingCode().split(':')[2];
  const second = wire(bridge, '/pair', { pairingKey: secondKey });
  release();
  assert.equal((await first).status, 403);
  const accepted = await second; assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(store.raw).resumeKey, accepted.body.resumeKey);
  assert.equal(bridge.token, accepted.body.token);
});

test('failed second-window restore cannot resurrect an owner-revoked cached lease', async t => {
  const { bridge, store, options } = await fixture(t); const p = await pair(bridge);
  const second = new BrowserBridge(options); t.after(() => second.shutdown());
  await assert.rejects(second.restore(), /EADDRINUSE|address already in use/i);
  await bridge.revoke(); assert.equal(store.raw, undefined);
  await second.start();
  assert.equal((await wire(second, '/resume', { resumeKey: p.resumeKey })).status, 403);
  assert.equal(second.lease, undefined);
});

test('failed replacement secure storage write does not resurrect previous remembered key on restart', async t => {
  const { bridge, store, options } = await fixture(t); const old = await pair(bridge);
  store.save = async () => { throw new Error('Synthetic replacement keychain failure'); };
  const pairingKey = bridge.pairingCode().split(':')[2];
  assert.equal((await wire(bridge, '/pair', { pairingKey })).status, 500);
  await bridge.shutdown();
  const restarted = new BrowserBridge(options); t.after(() => restarted.shutdown());
  await restarted.start();
  assert.equal((await wire(restarted, '/resume', { resumeKey: old.resumeKey })).status, 403);
});

test('remembered mode retains the short single-use setup ticket rather than extending it to a month', async t => {
  const { bridge, clock, store } = await fixture(t);
  const pairingKey = bridge.pairingCode().split(':')[2];
  clock.value += 120000;
  assert.equal((await wire(bridge, '/pair', { pairingKey })).status, 403);
  assert.equal(store.raw, undefined);
  const accepted = await pair(bridge);
  assert.equal((await wire(bridge, '/pair', { pairingKey })).status, 403);
  assert.ok(accepted.resumeKey);
});

test('expired session cannot accept a result body that began before expiry', async t => {
  const { bridge, clock } = await fixture(t); const p = await pair(bridge);
  bridge._connection(true);
  const requested = bridge.request('/api/problems/test');
  const rejected = assert.rejects(requested, /disconnected|expired/i);
  const id = [...bridge.pending.keys()][0];
  const body = JSON.stringify({ id, status: 200, data: { shouldNotResolve: true } });
  let req;
  const result = new Promise((resolve, reject) => {
    req = http.request({ hostname: '127.0.0.1', port: bridge.port, path: '/result?key=' + p.token, method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, agent: false }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); req.on('error', reject);
  });
  req.write(body.slice(0, 10));
  await new Promise(resolve => setTimeout(resolve, 15));
  clock.value = p.expiresAt;
  req.end(body.slice(10));
  assert.equal(await result, 403);
  await bridge.shutdown(); await rejected;
});

test('failed durable revocation never reports success and supports revoke-only retry', async t => {
  const { bridge, store } = await fixture(t); const p = await pair(bridge);
  const originalDelete = store.delete.bind(store);
  let fail = true;
  store.delete = async () => { if (fail) throw new Error('Synthetic keychain deletion unavailable'); return originalDelete(); };
  const failed = await wire(bridge, '/revoke', { resumeKey: p.resumeKey });
  assert.notEqual(failed.status, 200); assert.notEqual(failed.body.ok, true);
  assert.equal(bridge.lease, undefined); assert.equal(bridge.token, undefined);
  assert.equal(bridge.revocationPending.resumeKey, p.resumeKey);
  assert.equal((await wire(bridge, '/resume', { resumeKey: p.resumeKey })).status, 403);
  fail = false;
  const retried = await wire(bridge, '/revoke', { resumeKey: p.resumeKey });
  assert.equal(retried.status, 200); assert.equal(retried.body.ok, true);
  assert.equal(store.raw, undefined); assert.equal(bridge.revocationPending, undefined);
});

test('post-bind secure storage failure closes its listener and permits a safe retry', async t => {
  const store = memoryStore(); const port = await vacantPort(); let reads = 0;
  store.load = async () => { if (++reads === 2) throw new Error('Synthetic locked keychain'); return store.raw; };
  const bridge = new BrowserBridge({ persistence: store, preferredPort: port });
  t.after(() => bridge.shutdown());
  await assert.rejects(bridge.start(), /keychain/);
  assert.equal(bridge.server, undefined);
  await bridge.start(); assert.equal(bridge.port, port);
});

test('shutdown during initial secure storage read cannot later open a listener', async () => {
  const store = memoryStore(); let release;
  store.load = () => new Promise(resolve => { release = resolve; });
  const bridge = new BrowserBridge({ persistence: store, preferredPort: await vacantPort() });
  const starting = bridge.start(); const rejected = assert.rejects(starting, /canceled/);
  await bridge.shutdown(); release(undefined); await rejected;
  assert.equal(bridge.server, undefined);
});

test('malformed secure storage record is ignored without exposing it or blocking fresh pairing', async t => {
  const store = memoryStore(); store.raw = 'not json';
  const bridge = new BrowserBridge({ persistence: store, preferredPort: await vacantPort() });
  t.after(() => bridge.shutdown());
  assert.equal(await bridge.restore(), false);
  await bridge.start(); const paired = await pair(bridge); assert.ok(paired.resumeKey);
});
