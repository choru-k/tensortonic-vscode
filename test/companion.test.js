'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const shared = require('../browser-companion/shared');
const sourceRoot = path.resolve(__dirname, '../browser-companion');
const source = name => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const ticket = 'TT1:43210:' + 'a'.repeat(32);
const token = 'b'.repeat(64);
const base = 'http://127.0.0.1:43210';
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function pageHarness(options = {}) {
  const calls = [];
  const connections = [];
  const logs = [];
  const window = {};
  window.top = options.subframe ? {} : window;
  const origin = options.origin || 'https://www.tensortonic.com';
  const sandbox = {
    window, location: { origin, href: options.href || origin + '/problems' },
    URL, AbortController, AbortSignal,
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(name => [name, (...args) => logs.push(args)])),
    async fetch(url, init) {
      calls.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      return new Response(JSON.stringify(url.endsWith('/pair') ? { base, token } : { ok: true }), { status: 200 });
    },
    connectTensorTonic(config) {
      if (options.connectorThrows) throw new Error('INTERNAL_SECRET_' + token);
      const controller = new AbortController();
      window.__tensorTonicVSCode = controller;
      let finish;
      const lifetime = new Promise(resolve => { finish = resolve; });
      const connection = { config, controller, finish() {
        if (window.__tensorTonicVSCode === controller) delete window.__tensorTonicVSCode;
        if (config.onState) config.onState('disconnected');
        finish();
      } };
      controller.signal.addEventListener('abort', () => connection.finish(), { once: true });
      connections.push(connection);
      if (options.announce !== false && config.onState) config.onState('connected');
      return lifetime;
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source('shared.js'), context);
  vm.runInContext(source('companion.js'), context);
  return { context, api: context.__tensorTonicCompanion, calls, connections, logs, window };
}

test('companion manifest has only explicit activeTab and scripting permissions', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  for (const field of ['host_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'externally_connectable', 'web_accessible_resources']) {
    assert.equal(field in manifest, false, field);
  }
  assert.equal(source('companion.js').includes('addListener'), false);
  assert.equal(source('companion.js').includes('postMessage'), false);
  assert.equal(source('popup.html').includes('type="password"'), true);
  assert.equal(source('popup.html').includes('autocomplete="off"'), true);
});

test('pairing ticket parser permits only a canonical bounded loopback port and fixed random key', () => {
  assert.deepEqual(shared.parseTicket(' ' + ticket + '\n'), { base, pairingKey: 'a'.repeat(32) });
  for (const invalid of [null, {}, '', 'TT1:0:' + 'a'.repeat(32), 'TT1:65536:' + 'a'.repeat(32),
    'TT1:043210:' + 'a'.repeat(32), 'TT1:43210:' + 'A'.repeat(32), 'TT1:43210:' + 'a'.repeat(31),
    'TT1:43210:' + 'a'.repeat(32) + '/steal', 'https://evil.example', 'TT1:localhost:' + 'a'.repeat(32),
    'TT1:43210:' + 'a'.repeat(32) + '\nbody', 'x'.repeat(100)]) {
    assert.throws(() => shared.parseTicket(invalid), /INVALID_TICKET/);
  }
  assert.equal(shared.parseTicket('TT1:65535:' + '0'.repeat(32)).base, 'http://127.0.0.1:65535');
});

test('only the two exact HTTPS TensorTonic origins pass the page filter', () => {
  for (const url of ['https://www.tensortonic.com/problems/x', 'https://tensortonic.com/']) assert.equal(shared.isTensorTonicPage(url), true);
  for (const url of ['https://www.tensortonic.com.evil.example/', 'https://evil.example/?site=tensortonic.com',
    'http://www.tensortonic.com/', 'https://www.tensortonic.com:444/', 'https://user:pass@www.tensortonic.com/',
    'https://api.tensortonic.com/', 'chrome://extensions', 'javascript:alert(1)']) assert.equal(shared.isTensorTonicPage(url), false, url);
});

test('pairing response cannot redirect the capability or add unexpected configuration', () => {
  assert.deepEqual(shared.validateConnection({ base, token }, base), { base, token });
  for (const response of [{ base: 'http://127.0.0.1:43211', token }, { base: 'https://evil.example', token },
    { base, token: 'x' }, { base, token, path: 'https://evil.example' }, [], null]) {
    assert.throws(() => shared.validateConnection(response, base), /INVALID_PAIRING_RESPONSE/);
  }
});

test('wrong-origin pages and subframes cannot pair or disconnect or send any network request', async () => {
  for (const options of [{ origin: 'https://evil.example' }, { origin: 'http://www.tensortonic.com' }, { subframe: true }]) {
    const h = pageHarness(options);
    assert.equal((await h.api.connect(ticket)).phase, 'error');
    assert.equal((await h.api.disconnect()).phase, 'error');
    assert.equal(h.calls.length, 0);
    assert.equal(h.connections.length, 0);
  }
});

test('malformed messages and arbitrary URLs cannot become a network request', async () => {
  const h = pageHarness();
  for (const invalid of [{ url: 'https://evil.example/steal', method: 'GET' },
    { type: 'connect', code: ticket }, 'http://127.0.0.1:43210/api/account', 'TT1:43210:' + 'a'.repeat(32) + '?target=evil']) {
    assert.equal((await h.api.connect(invalid)).phase, 'error');
  }
  assert.equal(h.calls.length, 0);
  assert.deepEqual(Object.keys(h.api), ['connect', 'disconnect', 'status']);
});

test('one explicit pairing exchanges only the ticket; popup/status never receive bridge capability', async () => {
  const h = pageHarness();
  const result = await h.api.connect(ticket);
  assert.deepEqual(plain(result), { phase: 'connected' });
  assert.equal(h.calls.length, 1);
  const { url, init } = h.calls[0];
  assert.equal(url, base + '/pair');
  assert.equal(url.includes('a'.repeat(32)), false);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(JSON.parse(init.body), { pairingKey: 'a'.repeat(32) });
  assert.equal(h.connections[0].config.base, base);
  assert.equal(h.connections[0].config.token, token);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(h.api.status()).includes(token), false);
  assert.deepEqual(h.logs, []);
  await h.api.disconnect();
});

test('accepted pairing without a confirmed connector poll remains honestly connecting', async () => {
  const h = pageHarness({ announce: false });
  assert.equal((await h.api.connect(ticket)).phase, 'connecting');
  h.connections[0].config.onState('connected');
  assert.equal(h.api.status().phase, 'connected');
  await h.api.disconnect();
});

test('duplicate Connect does not silently replace an active connection', async () => {
  const h = pageHarness();
  await h.api.connect(ticket);
  const again = await h.api.connect(ticket);
  assert.equal(again.errorCode, 'ALREADY_ACTIVE');
  assert.equal(h.connections.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.connections[0].controller.signal.aborted, false);
  await h.api.disconnect();
});

test('rejected or expired pairing fails without launching connector or echoing server details', async () => {
  const h = pageHarness({ fetch: async () => new Response('SECRET_' + token, { status: 410 }) });
  const result = await h.api.connect(ticket);
  assert.deepEqual(plain(result), { phase: 'error', errorCode: 'PAIRING_FAILED' });
  assert.equal(h.connections.length, 0);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.deepEqual(h.logs, []);
});

test('mismatched, oversized, invalid JSON and network-error responses never launch the connector', async () => {
  for (const response of [JSON.stringify({ base: 'https://evil.example', token }),
    JSON.stringify({ base, token, extra: true }), 'not json', 'x'.repeat(2049), undefined]) {
    const h = pageHarness({ fetch: async () => { if (response === undefined) throw new Error('SECRET_' + token); return new Response(response); } });
    assert.equal((await h.api.connect(ticket)).phase, 'error');
    assert.equal(h.connections.length, 0);
    assert.deepEqual(h.logs, []);
  }
});

test('disconnect aborts operation, notifies only original editor, and drops the ephemeral session', async () => {
  const h = pageHarness();
  await h.api.connect(ticket);
  const connection = h.connections[0];
  const result = await h.api.disconnect();
  assert.equal(result.phase, 'disconnected');
  assert.equal(connection.controller.signal.aborted, true);
  assert.equal(h.calls[1].url, base + '/disconnect?key=' + token);
  assert.equal(h.calls[1].init.method, 'POST');
  assert.equal(h.calls[1].init.redirect, 'error');
  assert.equal(h.calls[1].init.credentials, 'omit');
  await flush();
  await h.api.disconnect();
  assert.equal(h.calls.length, 2, 'second Disconnect has no retained capability to send');
  assert.equal(JSON.stringify(h.api.status()).includes(token), false);
});

test('disconnect network failure still aborts locally without logging or replaying grading', async () => {
  const h = pageHarness({ fetch: async url => {
    if (url.includes('/disconnect')) throw new Error('SECRET_' + token);
    return new Response(JSON.stringify({ base, token }));
  } });
  await h.api.connect(ticket);
  assert.equal((await h.api.disconnect()).phase, 'disconnected');
  assert.equal(h.connections[0].controller.signal.aborted, true);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.logs, []);
});

test('disconnect during pending pairing prevents a late response from reviving the connection', async () => {
  let finish;
  const h = pageHarness({ fetch: async () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.api.connect(ticket);
  assert.equal(h.api.status().phase, 'pairing');
  await h.api.disconnect();
  finish(new Response(JSON.stringify({ base, token })));
  assert.equal((await pending).phase, 'disconnected');
  assert.equal(h.connections.length, 0);
});

test('old connector completion cannot clear a new connection after disconnect/reconnect', async () => {
  const h = pageHarness();
  await h.api.connect(ticket);
  const old = h.connections[0];
  await h.api.disconnect();
  await h.api.connect(ticket);
  old.config.onState('disconnected');
  old.finish();
  await flush();
  assert.equal(h.api.status().phase, 'connected');
  assert.equal(h.connections.length, 2);
  await h.api.disconnect();
});

test('connector ending clears status and enables a fresh pairing rather than replaying old work', async () => {
  const h = pageHarness();
  await h.api.connect(ticket);
  h.connections[0].finish();
  await flush();
  assert.equal(h.api.status().phase, 'disconnected');
  await h.api.connect(ticket);
  assert.equal(h.calls.length, 2);
  assert.equal(h.connections.length, 2);
  await h.api.disconnect();
});

test('repeated content-file injection keeps one isolated controller and no listeners', async () => {
  const h = pageHarness();
  const api = h.api;
  vm.runInContext(source('shared.js'), h.context);
  vm.runInContext(source('companion.js'), h.context);
  assert.equal(h.context.__tensorTonicCompanion, api);
  await api.connect(ticket);
  assert.equal(h.connections.length, 1);
  await api.disconnect();
});

function popupHarness(options = {}) {
  const elements = Object.fromEntries(['pair-form', 'ticket', 'connect', 'disconnect', 'status'].map(id => [id, {
    value: '', disabled: false, textContent: '', dataset: {}, listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
  }]));
  const calls = [];
  const window = { listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } };
  const sandbox = {
    document: { getElementById: id => elements[id] }, window, URL,
    TensorTonicCompanionShared: shared,
    setInterval: callback => { window.interval = callback; return 1; },
    clearInterval: () => { window.interval = undefined; },
    chrome: {
      tabs: { query: async () => [{ id: 7, url: options.url || 'https://www.tensortonic.com/problems' }] },
      scripting: { executeScript: async spec => {
        calls.push(spec);
        if (spec.args) {
          assert.equal(spec.args.some(value => value === undefined), false, 'Chrome rejects undefined ScriptInjection arguments');
          JSON.stringify(spec.args);
        }
        if (options.execute) return options.execute(spec);
        return [{ result: { phase: spec.args && spec.args[0] === 'connect' ? 'connecting' : 'idle' } }];
      } },
    },
  };
  vm.runInNewContext(source('popup.js'), sandbox);
  return { elements, calls, window };
}

test('popup rejects non-TensorTonic active tabs without injection', async () => {
  const h = popupHarness({ url: 'https://evil.example' });
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.elements.connect.disabled, true);
  assert.match(h.elements.status.textContent, /tensortonic.com/);
});

test('popup clears pairing input and injects only packaged isolated top-frame scripts on submit', async () => {
  const h = popupHarness();
  await flush();
  h.elements.ticket.value = ticket;
  await h.elements['pair-form'].listeners.submit({ preventDefault() {} });
  assert.equal(h.elements.ticket.value, '');
  const injection = h.calls.find(spec => spec.files);
  assert.deepEqual(plain(injection.target), { tabId: 7, frameIds: [0] });
  assert.equal(injection.world, 'ISOLATED');
  assert.deepEqual(plain(injection.files), ['shared.js', 'connector.js', 'companion.js']);
  const pairing = h.calls.find(spec => spec.args && spec.args[0] === 'connect');
  assert.equal(pairing.args[1], ticket);
  assert.equal(h.elements.status.textContent.includes(token), false);
  assert.match(h.elements.status.textContent, /Connection requested/);
  assert.equal(h.elements.connect.disabled, true);
});

test('popup invalid input or platform errors clear secrets and display only sanitized guidance', async () => {
  const h = popupHarness({ execute: async spec => {
    if (spec.files) throw new Error('SECRET_' + ticket);
    return [{ result: { phase: 'idle' } }];
  } });
  await flush();
  h.elements.ticket.value = 'not-a-ticket';
  await h.elements['pair-form'].listeners.submit({ preventDefault() {} });
  assert.equal(h.calls.some(spec => spec.files), false);
  h.elements.ticket.value = ticket;
  await h.elements['pair-form'].listeners.submit({ preventDefault() {} });
  assert.equal(h.elements.ticket.value, '');
  assert.equal(h.elements.status.textContent.includes(ticket), false);
  assert.equal(h.elements.status.textContent.includes('SECRET'), false);
  assert.match(h.elements.status.textContent, /new code/);
  h.elements.ticket.value = ticket;
  h.window.listeners.pagehide();
  assert.equal(h.elements.ticket.value, '');
  assert.equal(h.window.interval, undefined);
});

test('popup invalid ticket guidance survives idle polls until editing, retrying, or a real lifecycle change', async () => {
  let phase = 'idle';
  const h = popupHarness({ execute: async spec => {
    if (spec.files) throw new Error('UNSAFE_PLATFORM_MESSAGE');
    return [{ result: { phase } }];
  } });
  await flush();
  const rejectTicket = async () => {
    h.elements.ticket.value = 'PRIVATE_INVALID_VALUE';
    await h.elements['pair-form'].listeners.submit({ preventDefault() {} });
    assert.equal(h.elements.ticket.value, '');
    assert.match(h.elements.status.textContent, /code format/);
    assert.match(h.elements.status.textContent, /TT1:/);
    assert.equal(h.elements.status.textContent.includes('PRIVATE_INVALID_VALUE'), false);
    assert.equal(h.elements.status.dataset.error, 'true');
    assert.equal(h.elements.disconnect.disabled, true);
  };
  await rejectTicket();
  const guidance = h.elements.status.textContent;
  await h.window.interval();
  assert.equal(h.elements.status.textContent, guidance, 'idle polling preserves local validation');
  phase = 'error';
  await h.window.interval();
  assert.equal(h.elements.status.textContent, guidance, 'generic status failure preserves local validation');
  assert.equal(h.calls.some(spec => spec.files), false, 'invalid code never injects connection scripts');

  h.elements.ticket.value = 'T';
  h.elements.ticket.listeners.input();
  assert.equal(h.elements.status.dataset.error, 'false');
  assert.match(h.elements.status.textContent, /Ready to connect/);
  await rejectTicket();
  h.elements.ticket.value = ticket;
  await h.elements['pair-form'].listeners.submit({ preventDefault() {} });
  assert.match(h.elements.status.textContent, /signed in/);
  assert.equal(h.elements.status.textContent.includes('code format'), false, 'valid retry replaces format error');
  assert.equal(h.elements.status.textContent.includes('UNSAFE_PLATFORM_MESSAGE'), false);

  for (const update of ['connecting', 'connected', 'disconnected']) {
    await rejectTicket();
    phase = update;
    await h.window.interval();
    assert.equal(h.elements.status.textContent.includes('code format'), false, update);
    assert.equal(h.elements.status.dataset.error, 'false');
    assert.equal(h.elements.connect.disabled, update !== 'disconnected');
  }
});

test('stdlib companion package contains canonical connector and only explicitly listed files', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'tensortonic-companion-package-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = spawnSync('python3', [path.resolve(__dirname, '../scripts/package_companion.py'), '--output-dir', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const unpacked = path.join(output, 'tensortonic-browser-companion');
  assert.equal(fs.readFileSync(path.join(unpacked, 'connector.js'), 'utf8'), fs.readFileSync(path.resolve(__dirname, '../src/browser-connector.js'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.equal(fs.readdirSync(unpacked).length, 9);
  assert.ok(fs.existsSync(path.join(output, 'tensortonic-browser-companion-' + manifest.version + '.zip')));
  fs.writeFileSync(path.join(unpacked, 'unexpected-token.txt'), 'must-not-package');
  const refused = spawnSync('python3', [path.resolve(__dirname, '../scripts/package_companion.py'), '--output-dir', output], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /unexpected files/);
});

test('popup status and Disconnect use JSON-serializable Chrome scripting arguments', async () => {
  const h = popupHarness({ execute: async spec => [{ result: {
    phase: spec.args[0] === 'disconnect' ? 'disconnected' : 'connected',
  } }] });
  await flush();
  assert.equal(h.elements.disconnect.disabled, false);
  await h.elements.disconnect.listeners.click();
  assert.equal(h.elements.status.textContent.includes('Disconnected'), true);
  for (const call of h.calls) assert.deepEqual(plain(call.args).slice(1), [null]);
});

test('closing and reopening popup during pairing preserves content operation but no ticket field', async () => {
  let respond;
  const page = pageHarness({ fetch: async () => new Promise(resolve => { respond = resolve; }) });
  const execute = async spec => {
    if (spec.files) return [{ result: null }];
    page.context.__testArgs = plain(spec.args);
    const result = await vm.runInContext(`(${spec.func.toString()})(...__testArgs)`, page.context);
    delete page.context.__testArgs;
    return [{ result }];
  };
  const popup = popupHarness({ execute });
  await flush();
  popup.elements.ticket.value = ticket;
  const connecting = popup.elements['pair-form'].listeners.submit({ preventDefault() {} });
  await flush();
  assert.equal(page.api.status().phase, 'pairing');
  popup.window.listeners.pagehide();
  assert.equal(popup.elements.ticket.value, '');
  assert.equal(popup.window.interval, undefined);
  const reopened = popupHarness({ execute });
  await flush();
  assert.equal(reopened.elements.ticket.value, '');
  assert.equal(reopened.elements.connect.disabled, true);
  respond(new Response(JSON.stringify({ base, token })));
  await connecting;
  await reopened.window.interval();
  assert.equal(page.api.status().phase, 'connected');
  assert.match(reopened.elements.status.textContent, /Connected to VS Code/);
  // Avoid a second fake pending HTTP response on disconnect in this fixture.
  page.connections[0].finish();
  await flush();
});

test('late old disconnect acknowledgement cannot clear a newly paired isolated session', async () => {
  let finishDisconnect;
  let pairCount = 0;
  const secondToken = 'c'.repeat(64);
  const h = pageHarness({ fetch: async url => {
    if (url.includes('/disconnect')) return new Promise(resolve => { finishDisconnect = resolve; });
    return new Response(JSON.stringify({ base, token: pairCount++ ? secondToken : token }));
  } });
  await h.api.connect(ticket);
  const disconnecting = h.api.disconnect();
  await h.api.connect(ticket);
  assert.equal(h.api.status().phase, 'connected');
  finishDisconnect(new Response('{"ok":true}'));
  await disconnecting;
  await flush();
  assert.equal(h.api.status().phase, 'connected');
  assert.equal(h.connections[1].controller.signal.aborted, false);
  assert.equal(h.calls.filter(call => call.url.includes('/disconnect')).length, 1);
  assert.equal(h.calls.find(call => call.url.includes('/disconnect')).url, base + '/disconnect?key=' + token);
  h.connections[1].finish();
  await flush();
});

test('packaging fails when the canonical connector is absent rather than shipping a broken companion', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tensortonic-companion-missing-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.cpSync(sourceRoot, path.join(fixture, 'browser-companion'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.copyFileSync(path.resolve(__dirname, '../scripts/package_companion.py'), path.join(fixture, 'scripts/package_companion.py'));
  fs.copyFileSync(path.resolve(__dirname, '../LICENSE'), path.join(fixture, 'LICENSE'));
  const result = spawnSync('python3', [path.join(fixture, 'scripts/package_companion.py')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing file or unsafe symlink: connector.js/);
  const output = path.join(fixture, 'dist/tensortonic-browser-companion');
  assert.deepEqual(fs.readdirSync(output), []);
});

test('a stale popup status poll cannot overwrite a newer connection action', async () => {
  let statusCount = 0;
  let releaseOldStatus;
  const h = popupHarness({ execute: async spec => {
    if (spec.files) return [{ result: null }];
    if (spec.args[0] === 'connect') return [{ result: { phase: 'connected' } }];
    if (statusCount++ === 0) return [{ result: { phase: 'idle' } }];
    return new Promise(resolve => { releaseOldStatus = resolve; });
  } });
  await flush();
  const oldPoll = h.window.interval();
  h.elements.ticket.value = ticket;
  await h.elements['pair-form'].listeners.submit({ preventDefault() {} });
  assert.match(h.elements.status.textContent, /Connected to VS Code/);
  releaseOldStatus([{ result: { phase: 'idle' } }]);
  await oldPoll;
  assert.match(h.elements.status.textContent, /Connected to VS Code/);
  assert.equal(h.elements.connect.disabled, true);
  assert.equal(h.elements.ticket.disabled, true);
});


test('companion popup declares English and labels pairing actions consistently', () => {
  const html = source('popup.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<label for="ticket">One-use pairing code<\/label>/);
  assert.match(html, /<button id="connect" type="submit">Connect this tab<\/button>/);
  assert.match(html, /<button id="disconnect"[^>]*>Disconnect<\/button>/);
  assert.match(html, /Use within 2 minutes/);
  assert.match(source('README.md'), /\*\*Connect this tab\*\*/);
});
