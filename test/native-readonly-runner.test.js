'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNativeReadOnly, run } = require('./vscode-native-readonly-validation');
const version = require('../package.json').version;
function fixture() {
  let calls = 0, disposed = 0, debug;
  const forbidden = () => { throw new Error('Forbidden lifecycle call'); };
  const api = { diagnoseStoredSession: async () => { calls++; return { accountVerified: true, outcome: 'VERIFIED', requestCount: 1, privateData: 'secret-sentinel' }; },
    smokeTest: forbidden, sessionReady: { then: forbidden } };
  const extension = { packageJSON: { version }, isActive: true, exports: api, activate: forbidden };
  const vscode = { extensions: { getExtension: id => { assert.equal(id, 'choru-local.tensortonic-vscode'); return extension; } }, debug: { onDidStartDebugSession: cb => { debug = cb; return { dispose: () => { disposed++; } }; } } };
  return { api, extension, vscode, get calls() { return calls; }, get disposed() { return disposed; }, emitDebug: () => debug() };
}
test('runner invokes only the active facade diagnostic and copies a bounded summary', async () => {
  const h = fixture(), result = await validateNativeReadOnly(h.vscode);
  assert.equal(result.status, 'PASS'); assert.equal(result.extensionVersion, version); assert.equal(result.runSubmitCalls, 0);
  assert.equal(h.calls, 1); assert.equal(h.disposed, 1); assert.equal(JSON.stringify(result).includes('secret-sentinel'), false);
});
test('runner rejects stale version and inactive extension without activation or reads', async () => {
  const h = fixture(); h.extension.packageJSON.version = '0.10.0';
  await assert.rejects(validateNativeReadOnly(h.vscode), { code: 'VERSION_MISMATCH' }); assert.equal(h.calls, 0);
  const inactive = fixture(); inactive.extension.isActive = false;
  await assert.rejects(validateNativeReadOnly(inactive.vscode), { code: 'ACTIVE_EXTENSION_REQUIRED' }); assert.equal(inactive.calls, 0);
});
test('runner rejects missing diagnostic and unsafe capability exports before reads', async () => {
  for (const patch of [{ bridge: {} }, { client: {} }, { vault: {} }, { diagnoseStoredSession: undefined }]) {
    const h = fixture(); Object.assign(h.api, patch); await assert.rejects(validateNativeReadOnly(h.vscode), { code: 'DIAGNOSTIC_API_REQUIRED' }); assert.equal(h.calls, 0);
  }
});
test('runner never retries failed diagnosis and does not accept partial or rotation outcomes', async () => {
  for (const response of [null, {}, { accountVerified: true, outcome: 'ROTATION_UNVERIFIED' }, { accountVerified: false, outcome: 'VERIFIED' }]) {
    const h = fixture(); let calls = 0; h.api.diagnoseStoredSession = async () => { calls++; return response; };
    await assert.rejects(validateNativeReadOnly(h.vscode), { code: 'DIAGNOSIS_NOT_VERIFIED' }); assert.equal(calls, 1); assert.equal(h.disposed, 1);
  }
  const h = fixture(); let calls = 0; h.api.diagnoseStoredSession = async () => { calls++; throw new Error('private-error'); };
  await assert.rejects(validateNativeReadOnly(h.vscode)); assert.equal(calls, 1); assert.equal(h.disposed, 1);
});
test('runner detects unexpected debugger and removes its listener', async () => {
  const h = fixture(), diagnose = h.api.diagnoseStoredSession;
  h.api.diagnoseStoredSession = async () => { h.emitDebug(); return diagnose(); };
  await assert.rejects(validateNativeReadOnly(h.vscode), { code: 'UNEXPECTED_DEBUG_SESSION' }); assert.equal(h.disposed, 1);
});
test('runner entry point requires explicit real-read opt in before accessing vscode', async () => {
  const old = process.env.TENSORTONIC_TEST_ALLOW_REAL_READ;
  delete process.env.TENSORTONIC_TEST_ALLOW_REAL_READ;
  try { await assert.rejects(run(), /explicit authorization/); }
  finally { if (old !== undefined) process.env.TENSORTONIC_TEST_ALLOW_REAL_READ = old; }
});
