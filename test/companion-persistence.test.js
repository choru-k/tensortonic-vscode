'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const shared = require('../browser-companion/shared');
const source = name => fs.readFileSync(path.join(__dirname, '../browser-companion', name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const base = 'http://127.0.0.1:43210';
const token = 'a'.repeat(64);
const resumeKey = 'b'.repeat(64);
const origin = 'https://www.tensortonic.com';
const fresh = () => ({ base, resumeKey, expiresAt: Date.now() + 29 * 86400000 });
function workerHarness(options = {}) {
  const listeners = {};
  const local = options.local || {};
  const session = options.session || {};
  const grants = options.grants || new Set([origin + '/*']);
  const access = [];
  const registrations = [];
  const sent = [];
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const storage = (values, name) => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => values[k]).map(k => [k, values[k]])); },
    async set(entries) { Object.assign(values, plain(entries)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete values[k]; },
    async setAccessLevel(value) { access.push([name, value.accessLevel]); },
  });
  const chrome = {
    runtime: { id: 'extension-id', getURL: p => 'chrome-extension://extension-id/' + p,
      onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed') },
    storage: { local: storage(local, 'local'), session: storage(session, 'session') },
    permissions: { async contains({ origins }) { return origins.every(x => grants.has(x)); }, onRemoved: event('removed') },
    scripting: { async getRegisteredContentScripts() { return registrations; },
      async registerContentScripts(s) { registrations.push(...plain(s)); },
      async updateContentScripts(s) { registrations.splice(0, registrations.length, ...plain(s)); },
      async unregisterContentScripts() { registrations.length = 0; } },
    tabs: { onRemoved: event('tabRemoved'), async query() { return [{ id: 1 }]; },
      async sendMessage(id, message) { sent.push([id, message]); } },
  };
  vm.runInNewContext(source('background.js'), { chrome, URL, Date, crypto, TensorTonicCompanionShared: shared, importScripts() {} });
  const page = (tabId = 1, url = origin + '/problems', frameId = 0) => ({ id: chrome.runtime.id, tab: { id: tabId }, frameId, url });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  const call = (message, sender = page()) => new Promise(resolve => listeners.message(message, sender, resolve));
  async function save(record, sender = page()) {
    const reservation = (await call({ type: 'reserve', base: record.base }, sender)).reservation;
    return call({ type: 'save', record, reservation }, sender);
  }
  return { local, session, grants, access, registrations, sent, listeners, page, popup, call, save };
}

test('remembered response validates exact keys, absolute max 30 days, loopback and secret shape', () => {
  const record = fresh();
  assert.deepEqual(shared.validateConnection({ ...record, token }, base), { ...record, token });
  for (const bad of [{ ...record, expiresAt: Date.now() - 1 }, { ...record, expiresAt: Date.now() + 31 * 86400000 },
    { ...record, base: 'https://evil.example' }, { ...record, resumeKey: 'x' }, { ...record, path: '/steal' }]) {
    assert.throws(() => shared.validateRecord(bad));
  }
});

test('worker restricts storage before serving credentials and registers only granted exact origin', async () => {
  const h = workerHarness();
  await h.call({ type: 'register' }, h.popup);
  assert.deepEqual(h.access, [['local', 'TRUSTED_CONTEXTS'], ['session', 'TRUSTED_CONTEXTS']]);
  assert.deepEqual(h.registrations[0].matches, [origin + '/*']);
  assert.equal(h.registrations[0].allFrames, false);
  assert.equal(h.registrations[0].world, 'ISOLATED');
  assert.equal(h.registrations[0].persistAcrossSessions, true);
});

test('wrong origin, subframe and external extension cannot read or mutate persisted pairing', async () => {
  const h = workerHarness();
  const record = fresh();
  await h.save(record);
  for (const sender of [h.page(1, 'https://evil.example/'), h.page(1, origin + '/', 2),
    { ...h.page(), id: 'another-extension' }, { id: 'extension-id', url: origin + '/' }]) {
    assert.ok((await h.call({ type: 'claim' }, sender)).error);
    assert.ok((await h.call({ type: 'forget' }, sender)).error);
  }
  assert.equal(h.local.rememberedPairing.resumeKey, resumeKey);
  const summary = await h.call({ type: 'summary' }, h.popup);
  assert.equal(JSON.stringify(summary).includes(resumeKey), false);
  assert.ok((await h.call({ type: 'claim' }, h.popup)).error);
});

test('single tab lease survives worker restart and prevents another window taking a live editor', async () => {
  const h = workerHarness();
  await h.save(fresh());
  assert.equal((await h.call({ type: 'claim' }, h.page(2))).busy, true);
  const restarted = workerHarness({ local: h.local, session: h.session });
  assert.equal((await restarted.call({ type: 'claim' }, restarted.page(2))).busy, true);
  assert.equal((await restarted.call({ type: 'claim' })).record.resumeKey, resumeKey);
  restarted.listeners.tabRemoved(1);
  assert.equal((await restarted.call({ type: 'claim' }, restarted.page(2))).record.resumeKey, resumeKey);
});

test('browser restart and same tab refresh recover saved credential but second workspace requires forget', async () => {
  const h = workerHarness();
  const record = fresh();
  await h.save(record);
  assert.equal((await h.call({ type: 'claim' })).record.resumeKey, resumeKey);
  const restarted = workerHarness({ local: h.local });
  assert.equal((await restarted.call({ type: 'claim' }, restarted.page(9))).record.resumeKey, resumeKey);
  assert.ok((await restarted.call({ type: 'reserve', base: 'http://127.0.0.1:45678' }, restarted.page(9))).error);
});

test('global popup forget works without a website tab and retains revoke-only tombstone', async () => {
  const h = workerHarness();
  await h.save(fresh());
  const result = await h.call({ type: 'forget' }, h.popup);
  assert.equal(result.phase, 'disconnected');
  assert.equal(result.pendingRevocation, true);
  assert.equal(h.local.rememberedPairing, undefined);
  assert.equal(h.session.connectionOwner, undefined);
  assert.equal(h.local.pendingRevocation[0].resumeKey, resumeKey);
  assert.equal((await h.call({ type: 'claim' })).record, undefined);
  assert.equal((await h.call({ type: 'claim' })).pending.resumeKey, resumeKey);
  assert.ok((await h.call({ type: 'save', record: fresh() })).error);
  await h.call({ type: 'revoked', resumeKey });
  assert.equal(h.local.pendingRevocation, undefined);
});

test('permission removal forgets credential, unregisters scripts, and never silently reconnects', async () => {
  const h = workerHarness();
  await h.save(fresh());
  h.grants.clear();
  h.listeners.removed({ origins: [origin + '/*'] });
  await h.call({ type: 'summary' }, h.popup);
  assert.equal(h.local.rememberedPairing, undefined);
  assert.equal(h.registrations.length, 0);
  assert.ok(h.local.pendingRevocation);
  assert.equal((await h.call({ type: 'claim' })).record, undefined);
});

test('expired stored credentials are purged and never returned or renewed', async () => {
  const h = workerHarness({ local: { rememberedPairing: { ...fresh(), origin, expiresAt: Date.now() - 100 } } });
  assert.equal((await h.call({ type: 'claim' })).record, undefined);
  assert.equal(h.local.rememberedPairing, undefined);
});

function contentHarness(options = {}) {
  const connections = [];
  const calls = [];
  const messages = [];
  let saved = options.saved;
  let pending = options.pending;
  let interval;
  let listener;
  const window = {}; window.top = window;
  const runtime = { id: 'extension-id', onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage(message) {
      messages.push(plain(message));
      if (message.type === 'claim') return saved ? { record: { ...saved, origin } } : { pending: Array.isArray(pending) ? pending[0] : pending, pendings: Array.isArray(pending) ? pending : undefined };
      if (message.type === 'save') { saved = message.record; return { ok: true }; }
      if (message.type === 'reserve') return { ok: true, reservation: 'test-reservation' };
      if (message.type === 'abandon') { pending = message.record; return { ok: true }; }
      if (message.type === 'invalid') { saved = undefined; return { ok: true }; }
      if (message.type === 'forget') { pending = saved; saved = undefined; return { ok: true }; }
      if (message.type === 'revocations') return { pending };
      if (message.type === 'revoked') { pending = Array.isArray(pending) ? pending.filter(item => item.resumeKey !== message.resumeKey) : undefined; return { ok: true }; }
      return { error: 'INVALID_MESSAGE' };
    } };
  const context = vm.createContext({ window, location: { origin, href: origin + '/problems' }, URL, Date,
    AbortSignal, AbortController, chrome: { runtime }, setInterval(fn) { interval = fn; },
    async fetch(url, init) {
      calls.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      return new Response(JSON.stringify(url.endsWith('/revoke') ? { ok: true } : { ...(saved || fresh()), token }));
    },
    connectTensorTonic(config) {
      const controller = new AbortController(); window.__tensorTonicVSCode = controller;
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      const connection = { config, finish() { config.onState('disconnected'); resolve(); } };
      controller.signal.addEventListener('abort', connection.finish);
      connections.push(connection); config.onState('connected'); return promise;
    },
  });
  vm.runInContext(source('shared.js'), context);
  vm.runInContext(source('companion.js'), context);
  return { api: context.__tensorTonicCompanion, calls, messages, connections,
    async tick() { interval(); await flush(); await flush(); },
    async forget() { saved = undefined; listener({ type: 'forget-pairing' }, { id: runtime.id }); await flush(); },
    saved: () => saved, pending: () => pending };
}

test('content resumes after reload and a transient transport end without persisting token or replaying work', async () => {
  const record = fresh();
  const h = contentHarness({ saved: record });
  await flush(); await flush();
  assert.equal(h.connections.length, 1);
  assert.equal(h.calls[0].url, base + '/resume');
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { resumeKey });
  h.connections[0].finish(); await flush();
  await h.tick();
  assert.equal(h.connections.length, 2);
  assert.ok(h.calls.every(call => call.url === base + '/resume'));
  assert.equal(h.saved().expiresAt, record.expiresAt);
  assert.equal(JSON.stringify(h.api.status()).includes(resumeKey), false);
  assert.equal(h.messages.some(message => message.record && message.record.token), false);
});

test('rejected or expired resume fails closed and erases remembered capability', async () => {
  const h = contentHarness({ saved: fresh(), fetch: async () => new Response('{}', { status: 403 }) });
  await flush(); await flush();
  assert.equal(h.connections.length, 0);
  assert.equal(h.saved(), undefined);
  await h.tick();
  assert.equal(h.calls.length, 1);
});

test('busy editor does not lose remembered pairing or take over an active tab', async () => {
  const h = contentHarness({ saved: fresh(), fetch: async () => new Response('{}', { status: 409 }) });
  await flush(); await flush();
  assert.equal(h.connections.length, 0);
  assert.ok(h.saved());
  await h.tick();
  assert.equal(h.connections.length, 0);
});

test('offline Disconnect deletes remembered key and retries only revoke on recovery', async () => {
  let offline = false;
  const record = fresh();
  const h = contentHarness({ saved: record, fetch: async url => {
    if (url.endsWith('/revoke') && offline) throw new Error('offline');
    return new Response(JSON.stringify(url.endsWith('/revoke') ? { ok: true } : { ...record, token }));
  } });
  await flush(); await flush();
  offline = true;
  await h.api.disconnect();
  assert.equal(h.saved(), undefined);
  assert.ok(h.pending());
  const count = h.calls.length;
  offline = false;
  await h.tick();
  assert.equal(h.pending(), undefined);
  assert.ok(h.calls.slice(count).every(call => call.url.endsWith('/revoke')));
});

test('late resume response after global Forget cannot revive the isolated connector', async () => {
  let finish;
  const record = fresh();
  const h = contentHarness({ saved: record, fetch: async () => new Promise(resolve => { finish = resolve; }) });
  await flush();
  await h.forget();
  finish(new Response(JSON.stringify({ ...record, token })));
  await flush(); await flush();
  assert.equal(h.connections.length, 0);
});

test('Disconnect invalidates an in-flight save reservation, including when no credential existed yet', async () => {
  const h = workerHarness();
  const reservation = (await h.call({ type: 'reserve', base })).reservation;
  assert.ok(reservation);
  await h.call({ type: 'forget' }, h.popup);
  assert.ok((await h.call({ type: 'save', record: fresh(), reservation })).error);
  assert.equal(h.local.rememberedPairing, undefined);
  assert.equal((await h.call({ type: 'claim' })).record, undefined);
});

test('late abandoned pairing is queued only for revocation and cannot become remembered access', async () => {
  const h = workerHarness();
  const reservation = (await h.call({ type: 'reserve', base })).reservation;
  await h.call({ type: 'forget' }, h.popup);
  const record = fresh();
  assert.ok((await h.call({ type: 'save', record, reservation })).error);
  await h.call({ type: 'abandon', record });
  assert.equal(h.local.rememberedPairing, undefined);
  assert.equal(h.local.pendingRevocation[0].resumeKey, resumeKey);
  assert.equal((await h.call({ type: 'claim' })).record, undefined);
});

test('pairing response arriving after Disconnect is revoked rather than saved or connected', async () => {
  let finish;
  const record = fresh();
  const h = contentHarness({ fetch: async url => url.endsWith('/pair')
    ? new Promise(resolve => { finish = resolve; })
    : new Response('{"ok":true}') });
  await flush();
  const pairing = h.api.connect('TT1:43210:' + 'c'.repeat(32));
  await flush();
  await h.api.disconnect();
  finish(new Response(JSON.stringify({ ...record, token })));
  await pairing;
  assert.equal(h.connections.length, 0);
  assert.equal(h.saved(), undefined);
  assert.equal(h.messages.some(message => message.type === 'save'), false);
  assert.ok(h.calls.some(call => call.url.endsWith('/revoke')));
});

test('late abandoned grants retain separate revoke tombstones instead of overwriting obligations', async () => {
  const h = workerHarness();
  const first = fresh();
  await h.save(first);
  await h.call({ type: 'forget' }, h.popup);
  const second = { ...fresh(), base: 'http://127.0.0.1:45678', resumeKey: 'c'.repeat(64) };
  await h.call({ type: 'abandon', record: second });
  assert.equal(h.local.pendingRevocation.length, 2);
  assert.equal((await h.call({ type: 'claim' })).record, undefined);
  await h.call({ type: 'revoked', resumeKey: first.resumeKey });
  assert.equal(h.local.pendingRevocation.length, 1);
  assert.equal((await h.call({ type: 'claim' })).pending.resumeKey, second.resumeKey);
});

test('offline older editor cannot block revocation of another reachable editor', async () => {
  const first = fresh();
  const second = { ...fresh(), base: 'http://127.0.0.1:45678', resumeKey: 'd'.repeat(64) };
  const h = contentHarness({ pending: [first, second], fetch: async url => {
    if (url.startsWith(first.base)) throw new Error('offline');
    return new Response('{"ok":true}');
  } });
  await flush(); await flush();
  assert.ok(h.calls.some(call => call.url === second.base + '/revoke'));
  assert.equal(h.pending().length, 1);
  assert.equal(h.pending()[0].resumeKey, first.resumeKey);
  assert.equal(h.connections.length, 0);
});
