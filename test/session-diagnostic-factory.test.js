'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { createSessionBridge, SESSION_NAME, AUTH_URL } = require('../src/session/tensortonic');

for (const [name, status, body, cookies, outcome] of [
  ['valid account', 200, { user: { id: 'private-id', name: 'private-name' } }, [], 'VERIFIED'],
  ['401', 401, { authenticated: false }, [], 'AUTH_REQUIRED'],
  ['changed schema', 200, { unknown: 'private-payload' }, [], 'ACCOUNT_SCHEMA_UNVERIFIED'],
  ['rotation', 200, { user: { id: 'private-id', name: 'private-name' } }, ['untrusted-cookie=private-value'], 'ROTATION_UNVERIFIED'],
]) test('production factory diagnostic preserves saved session on ' + name, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-diag-factory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'saved-session-v1'); await fs.mkdir(directory);
  const key = 'tensortonic.http-session.v1.00000000-0000-0000-0000-000000000000';
  const encoded = JSON.stringify({ version: 2, retention: 'server', expiresAt: null, cookies: [{ name: SESSION_NAME, value: 'synthetic-only', domain: 'tensortonic.com', path: '/', hostOnly: false, secure: true, httpOnly: true, sameSite: 'Lax', persistent: true, expiresAt: Date.now() + 60000, created: 0 }] });
  const index = JSON.stringify({ version: 2, epoch: 7, activeKey: key, pending: [] });
  await fs.writeFile(path.join(directory, 'session-index.json'), index);
  let writes = 0, gets = 0, requests = 0;
  const secrets = { get: async k => { gets++; assert.equal(k, key); return encoded; }, store: async () => { writes++; throw Error('forbidden'); }, delete: async () => { writes++; throw Error('forbidden'); } };
  const original = https.request;
  https.request = (url, options, callback) => {
    requests++; assert.equal(url.href, AUTH_URL); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Cookie, SESSION_NAME + '=synthetic-only');
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = requestBody => { assert.equal(requestBody, undefined); queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = status; response.headers = { 'set-cookie': cookies }; response.destroy = () => {};
      callback(response); response.emit('data', Buffer.from(JSON.stringify(body))); response.emit('end');
    }); };
    return request;
  };
  t.after(() => { https.request = original; });
  const bridge = createSessionBridge({ workspace: { isTrusted: true }, env: { uiKind: 1 } }, { globalStorageUri: { fsPath: root }, secrets });
  bridge.connected = true; bridge.token = 'unchanged-token';
  const result = await bridge.diagnoseStoredSession();
  assert.deepEqual(result, { accountVerified: outcome === 'VERIFIED', outcome, requestCount: 1 });
  assert.equal(await fs.readFile(path.join(directory, 'session-index.json'), 'utf8'), index);
  assert.deepEqual(await fs.readdir(directory), ['session-index.json']);
  assert.equal(writes, 0); assert.equal(gets, 1); assert.equal(requests, 1);
  assert.equal(bridge.connected, true); assert.equal(bridge.token, 'unchanged-token');
  assert.equal(JSON.stringify(result).includes('private-'), false);
});
