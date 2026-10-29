'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const vm = require('node:vm');
const { BrowserBridge, isAllowedRequest, validateBody } = require('../src/bridge');

const origin = 'https://www.tensortonic.com';
const token = 'a'.repeat(64);
function response() {
  const res = new EventEmitter();
  Object.assign(res, { headers: {}, writableEnded: false, destroyed: false,
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(text) { this.body = JSON.parse(text); this.writableEnded = true; this.emit('close'); },
  });
  return res;
}
async function send(bridge, endpoint, options = {}) {
  const req = Readable.from(options.body == null ? [] : [Buffer.from(JSON.stringify(options.body))]);
  Object.assign(req, { url: endpoint + '?key=' + (options.key || token), method: options.method || 'GET', headers: { origin: options.origin || origin } });
  const res = response();
  await bridge._handle(req, res);
  return res;
}
function ready() {
  const b = new BrowserBridge(); b.token = token; b.connected = true; return b;
}

test('only observed Python problem endpoints and bounded catalog parameters are permitted', () => {
  for (const p of ['/api/study-plans', '/api/study-plans/pytorch-basics', '/api/problems/sigmoid-numpy', '/api/study-plans/pytorch-basics/problems/pytorch-mini-training', '/api/problems/list?page=1&limit=100&planId=pytorch-basics']) assert.equal(isAllowedRequest(p), true, p);
  for (const p of ['/api/problems/sigmoid-numpy/run-cases', '/api/problems/sigmoid-numpy/submit', '/api/study-plans/pytorch-basics/problems/pytorch-mini-training/run', '/api/study-plans/pytorch-basics/problems/pytorch-mini-training/submit']) assert.equal(isAllowedRequest(p, 'POST'), true, p);
  for (const p of ['https://evil.example/api/problems/x', '//evil.example/api/problems/x', '/api/me', '/api/billing', '/api/problems/x/solution', '/api/problems/../me', '/api/problems/%2e%2e/me', '/api/study-plans/gpu/cuda/x/run', '/api/problems/list?redirect=evil', '/api/problems/list?limit=99999', '/api/problems/x#ignore']) {
    assert.equal(isAllowedRequest(p), false, p); assert.equal(isAllowedRequest(p, 'POST'), false, p);
  }
});

test('grading body rejects additional destinations, huge code and non-free problemType', () => {
  assert.equal(validateBody({ code: 'pass', testCases: [] }, '/api/problems/x/run-cases'), true);
  assert.equal(validateBody({ code: 'pass', problemType: 'free' }, '/api/problems/x/submit'), true);
  for (const body of [{ code: 'pass', testCases: {}, }, { code: 'x'.repeat(600000), testCases: [] }, { code: 'pass', testCases: [], url: 'https://evil.example' }, { code: 'pass', testCases: [], problemType: 'cuda' }]) assert.equal(validateBody(body, '/api/problems/x/run-cases'), false);
});

test('foreign origins and incorrect pairing keys never receive pending code', async () => {
  const bridge = ready();
  assert.equal((await send(bridge, '/poll', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await send(bridge, '/poll', { key: 'bad' })).status, 403);
  assert.equal((await send(bridge, '/poll', { key: 'é'.repeat(64) })).status, 403);
  assert.equal(bridge.pollResponse, undefined);
});

test('malformed local request targets receive HTTP errors without unhandled rejections', async () => {
  const bridge = ready();
  assert.equal((await send(bridge, 'http://[')).status, 400);
});

test('concurrent connection commands share one loopback listener and wait for its port', async () => {
  let starts = 0;
  const server = new EventEmitter();
  Object.assign(server, {
    listen(port, host, callback) { assert.equal(host, '127.0.0.1'); assert.equal(port, 0); starts++; setImmediate(callback); },
    address() { return { port: 43210 }; }, unref() {}, close(callback) { callback(); }, closeAllConnections() {},
  });
  const bridge = new BrowserBridge({ serverFactory: () => server });
  await Promise.all([bridge.start(), bridge.start()]);
  assert.equal(starts, 1); assert.equal(bridge.port, 43210);
  const snippet = bridge.connectionCode();
  assert.match(snippet, /127\.0\.0\.1:43210/); assert.doesNotMatch(snippet, /undefined/);
  await bridge.stop();
});

test('request travels through authenticated poll/result, retains false/zero data, and rejects replay', async () => {
  const bridge = ready();
  const pending = bridge.request('/api/problems/sigmoid-numpy');
  const poll = await send(bridge, '/poll');
  assert.equal(poll.body.path, '/api/problems/sigmoid-numpy');
  assert.equal(poll.headers['Access-Control-Allow-Origin'], origin);
  const payload = { id: poll.body.id, status: 200, data: { status: 'success', data: { loss: 0, passed: false } } };
  assert.equal((await send(bridge, '/result', { method: 'POST', body: payload })).status, 200);
  assert.deepEqual(await pending, payload.data);
  assert.equal((await send(bridge, '/result', { method: 'POST', body: payload })).status, 404);
  assert.equal(bridge.pending.size, 0);
});

test('server failures propagate without retrying a submission', async () => {
  const bridge = ready();
  const pending = bridge.request('/api/problems/sigmoid-numpy/submit', { method: 'POST', body: { code: 'pass', problemType: 'free' } });
  const rejected = assert.rejects(pending, /Sign in required/);
  await assert.rejects(bridge.request('/api/problems/sigmoid-numpy/submit', { method: 'POST', body: { code: 'pass' } }), /already in progress/);
  const poll = await send(bridge, '/poll');
  await send(bridge, '/result', { method: 'POST', body: { id: poll.body.id, status: 401, data: { message: 'Sign in required' } } });
  await rejected;
  assert.equal(bridge.queue.length, 0);
  assert.equal(bridge.pending.size, 0);
});

test('disconnect rejects outstanding work and invalidates local capabilities', async () => {
  const bridge = ready();
  const request = bridge.request('/api/study-plans');
  const check = assert.rejects(request, /disconnected/);
  await bridge.stop(); await check;
  assert.equal(bridge.connected, false); assert.equal(bridge.token, undefined);
  assert.equal(bridge.pending.size, 0); assert.equal(bridge.queue.length, 0);
});

test('browser code keeps cookies inside TensorTonic and forwards one exact grading operation', async () => {
  const command = { id: 'run-1', path: '/api/problems/sigmoid-numpy/run-cases', method: 'POST', body: { code: 'pass', testCases: [{ x: 0 }], problemType: 'free' } };
  let polls = 0; const calls = [];
  const sandbox = {
    location: { origin }, window: {}, URL, AbortController, AbortSignal,
    console: { info() {}, warn() {}, error() {} },
    async fetch(url, options = {}) {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() {
        if (url.includes('/poll')) return polls++ ? { stop: true } : command;
        return url.includes('api.tensortonic.com') ? { status: 'success', data: { passed: false } } : { ok: true };
      } };
    },
  };
  const source = fs.readFileSync(require.resolve('../src/browser-connector'), 'utf8');
  await vm.runInNewContext(`(${source})(${JSON.stringify({ base: 'http://127.0.0.1:43210', token })})`, sandbox);
  const upstream = calls.filter(c => c.url.startsWith('https://'));
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].url, 'https://api.tensortonic.com' + command.path);
  assert.equal(upstream[0].options.credentials, 'include');
  assert.equal(upstream[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(upstream[0].options.body), command.body);
  assert.equal(sandbox.window.__tensorTonicVSCode, undefined);
});

test('browser connector rejects arbitrary upstream destinations even from a malformed local queue', async () => {
  const results = []; let polls = 0; let upstreamCalls = 0;
  const sandbox = {
    location: { origin }, window: {}, URL, AbortController, AbortSignal, console: { info() {}, warn() {}, error() {} },
    async fetch(url, options = {}) {
      if (url.startsWith('https://')) upstreamCalls++;
      if (url.includes('/result')) results.push(JSON.parse(options.body));
      return { ok: true, status: 200, async json() { return url.includes('/poll') ? polls++ ? { stop: true } : { id: 'bad', path: 'https://evil.example/steal', method: 'GET' } : {}; } };
    },
  };
  const source = fs.readFileSync(require.resolve('../src/browser-connector'), 'utf8');
  await vm.runInNewContext(`(${source})(${JSON.stringify({ base: 'http://127.0.0.1:43210', token })})`, sandbox);
  assert.equal(upstreamCalls, 0);
  assert.match(results[0].error, /Unsupported/);
});

test('browser connection timeout gives local-network guidance and never sends grading code', async () => {
  const messages = []; const requests = [];
  const sandbox = {
    location: { origin }, window: {}, URL, AbortController, AbortSignal,
    console: { info() {}, warn() {}, error(...args) { messages.push(args.join(' ')); } },
    async fetch(url, options) {
      requests.push(url);
      assert.ok(options.signal);
      const error = new Error('Local connection timed out'); error.name = 'TimeoutError'; throw error;
    },
  };
  const source = fs.readFileSync(require.resolve('../src/browser-connector'), 'utf8');
  await vm.runInNewContext(`(${source})(${JSON.stringify({ base: 'http://127.0.0.1:43210', token })})`, sandbox);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].startsWith('http://127.0.0.1:43210/poll'));
  assert.match(messages.join('\n'), /local-network access/);
  assert.match(messages.join('\n'), /same computer/);
  assert.equal(sandbox.window.__tensorTonicVSCode, undefined);
});
