'use strict';
// Explicitly authorized fixed-route diagnosis. Never activate/reconnect an
// extension or invoke smokeTest, normal transport, grading, or cookie acquisition.
const fs = require('node:fs');
const path = require('node:path');
const expectedVersion = require('../package.json').version;
const { OUTCOMES } = require('../src/session/diagnostic');

function failure(code) { return Object.assign(new Error(code), { code }); }
async function validateNativeReadOnly(vscode) {
  const extension = vscode.extensions.getExtension('choru-local.tensortonic-vscode');
  if (!extension || extension.packageJSON.version !== expectedVersion) throw failure('VERSION_MISMATCH');
  // Activation/restoration itself may expire/delete saved credentials. A
  // diagnostic must not trigger that lifecycle merely to obtain the facade.
  if (extension.isActive !== true) throw failure('ACTIVE_EXTENSION_REQUIRED');
  const api = extension.exports;
  if (!api || typeof api.diagnoseStoredSession !== 'function' ||
      ['bridge', 'client', 'vault'].some(key => api[key] !== undefined)) throw failure('DIAGNOSTIC_API_REQUIRED');
  let debugSessionStarts = 0;
  const subscription = vscode.debug.onDidStartDebugSession(() => { debugSessionStarts++; });
  try {
    const result = await api.diagnoseStoredSession();
    if (debugSessionStarts !== 0) throw failure('UNEXPECTED_DEBUG_SESSION');
    if (!result || result.accountVerified !== true || result.outcome !== 'VERIFIED' || result.requestCount !== 1) {
      const error = failure('DIAGNOSIS_NOT_VERIFIED');
      error.diagnosticOutcome = OUTCOMES.includes(result?.outcome) && result.outcome !== 'VERIFIED' ? result.outcome : 'INVALID_RESPONSE';
      throw error;
    }
    // Never copy account response fields, error messages or credential metadata.
    return { extensionVersion: expectedVersion, status: 'PASS', operation: 'fixed-account-get',
      accountVerified: true, requestCount: 1, runSubmitCalls: 0, debugSessionStarts };
  } finally {
    subscription.dispose();
  }
}

exports.validateNativeReadOnly = validateNativeReadOnly;
exports.run = async function run() {
  if (process.env.TENSORTONIC_TEST_ALLOW_REAL_READ !== '1') throw new Error('Real-site read validation requires explicit authorization and TENSORTONIC_TEST_ALLOW_REAL_READ=1.');
  const vscode = require('vscode');
  const report = { version: vscode.version, status: 'NOT VERIFIED', operation: 'fixed-account-get' };
  try {
    Object.assign(report, await validateNativeReadOnly(vscode));
  } catch (error) {
    const allowed = ['VERSION_MISMATCH', 'ACTIVE_EXTENSION_REQUIRED', 'DIAGNOSTIC_API_REQUIRED',
      'UNEXPECTED_DEBUG_SESSION', 'DIAGNOSIS_NOT_VERIFIED'];
    report.errorCode = allowed.includes(error.code) ? error.code : 'VALIDATION_NOT_COMPLETE';
    if (OUTCOMES.includes(error.diagnosticOutcome)) report.diagnosticOutcome = error.diagnosticOutcome;
  }
  const output = path.resolve(__dirname, '../dist/native-readonly-validation.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  if (report.status !== 'PASS') throw new Error('Native diagnosis not complete. Review the sanitized report; no automatic retry was performed.');
};
