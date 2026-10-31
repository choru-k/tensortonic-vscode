'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionManager } = require('../src/connection-manager');
function transport(name) { return { name, connected: false, token: undefined, calls: [], async start() { this.calls.push('start'); this.connected = true; this.token = name; this.onDidChange?.(); }, async shutdown() { this.calls.push('shutdown'); this.connected = false; this.token = undefined; this.onDidChange?.(); }, async stop() { this.calls.push('stop'); this.connected = false; this.token = undefined; this.onDidChange?.(); }, async revoke() { this.calls.push('revoke'); this.connected = false; this.onDidChange?.(); }, async restore() { this.calls.push('restore'); return true; }, pairingCode() { this.calls.push('pair'); return 'synthetic'; }, async request(path, options) { this.calls.push([path, options]); return { ok: true }; }, async openProblemPage(url) { this.calls.push(['page', url]); } }; }
function fixture(mode) { const native = transport('native'), legacy = transport('legacy'); return { native, legacy, bridge: new ConnectionManager({ native, legacy, mode }) }; }
test('native default never restores or pairs on activation; explicit start uses only native', async () => {
  const { bridge, native, legacy } = fixture(); assert.equal(await bridge.restore(), false);
  assert.deepEqual(native.calls, []); assert.deepEqual(legacy.calls, []);
  assert.throws(() => bridge.pairingCode(), /does not use pairing/);
  await bridge.start(); assert.equal(bridge.connected, true); assert.equal(bridge.token, 'native'); assert.deepEqual(legacy.calls, []);
});
test('legacy restoration and pairing require explicitly selected companion mode', async () => {
  const { bridge, native, legacy } = fixture('browserCompanion'); assert.equal(await bridge.restore(), true);
  await bridge.start(); assert.equal(bridge.pairingCode(), 'synthetic'); assert.deepEqual(native.calls, []);
  assert.deepEqual(legacy.calls, ['restore','start','pair']);
});
test('failed native Submit is never replayed or silently sent through companion', async () => {
  const { bridge, native, legacy } = fixture(); let attempts = 0;
  native.request = async () => { attempts++; throw new Error('Result uncertain'); };
  await assert.rejects(bridge.request('/api/problems/test/submit', { method: 'POST', body: { code: 'synthetic' } }), /uncertain/);
  assert.equal(attempts, 1); assert.deepEqual(legacy.calls, []);
});
test('mode switch invalidates pending result and preserves old legacy remembered state through shutdown', async () => {
  const { bridge, native, legacy } = fixture('browserCompanion'); await bridge.start();
  let release; legacy.request = () => new Promise(resolve => { release = resolve; });
  const request = bridge.request('/api/problems/test/submit', { method: 'POST' });
  await bridge.setMode('native'); release({ ok: true }); await assert.rejects(request, /uncertain/);
  assert.ok(legacy.calls.includes('shutdown')); assert.ok(!legacy.calls.includes('revoke'));
  assert.deepEqual(native.calls, []); assert.equal(bridge.connected, false);
});
test('disconnect targets current transport only and shutdown closes only owned transport resources', async () => {
  const { bridge, native, legacy } = fixture(); await bridge.start(); await bridge.revoke();
  assert.ok(native.calls.includes('revoke')); assert.deepEqual(legacy.calls, []);
  await bridge.shutdown(); assert.ok(native.calls.includes('shutdown')); assert.ok(legacy.calls.includes('shutdown'));
  await assert.rejects(bridge.start(), /closed/);
});
test('Web page routing never forwards to legacy or starts a second native connection', async () => {
  const { bridge, native, legacy } = fixture(); await bridge.openProblemPage('https://www.tensortonic.com/problems/test');
  assert.equal(native.calls.length, 1); assert.deepEqual(legacy.calls, []);
  await bridge.setMode('browserCompanion'); await assert.rejects(bridge.openProblemPage('https://www.tensortonic.com/problems/test'), /not active/);
});
