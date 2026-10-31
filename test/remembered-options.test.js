'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rememberedOptions } = require('../src/remembered-pairing');
function config(identity) { return { workspace: { workspaceFolders: [{ uri: { toString: () => identity } }] } }; }
test('pairing credentials use only SecretStorage and stable workspace-specific keys', async () => {
  const calls = []; const context = { secrets: {
    get: async key => { calls.push(['get', key]); return undefined; },
    store: async (key, value) => { calls.push(['store', key, value]); },
    delete: async key => { calls.push(['delete', key]); },
  } };
  const first = rememberedOptions(config('file:///study-a'), context);
  const same = rememberedOptions(config('file:///study-a'), context);
  const other = rememberedOptions(config('file:///study-b'), context);
  assert.equal(first.preferredPort, same.preferredPort);
  assert.ok(first.preferredPort >= 40000 && first.preferredPort < 60000);
  await first.persistence.load(); await first.persistence.save('synthetic'); await first.persistence.delete();
  await other.persistence.load();
  assert.equal(calls[0][1], calls[1][1]); assert.equal(calls[1][1], calls[2][1]);
  assert.notEqual(calls[0][1], calls[3][1]); assert.ok(!calls[0][1].includes('study-a'));
});
