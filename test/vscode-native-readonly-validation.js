'use strict';
// Explicitly authorized real-site READ validation only. This runner contains
// no Run/Submit call, authentication extraction, or solution-file modification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
exports.run = async function run() {
  if (process.env.TENSORTONIC_TEST_ALLOW_REAL_READ !== '1') throw new Error('Real-site read validation requires explicit authorization and TENSORTONIC_TEST_ALLOW_REAL_READ=1.');
  const vscode = require('vscode');
  const output = path.resolve(__dirname, '../dist/native-readonly-validation.json');
  const report = { version: vscode.version, startedAt: new Date().toISOString(), status: 'NOT VERIFIED',
    realSiteReads: 0, runSubmitCalls: 0, authMaterialRead: false, checks: [] };
  let bridge; let ownsConnection = false;
  try {
    const extension = vscode.extensions.getExtension('choru-local.tensortonic-vscode');
    if (!extension) throw new Error('Candidate extension is not installed.');
    report.extensionVersion = extension.packageJSON.version;
    if (report.extensionVersion !== '0.9.0') throw new Error('Expected release 0.9.0.');
    const api = await extension.activate(); bridge = api.bridge;
    const native = bridge;
    if (bridge.connected || !native || native.sessions.size || native.launching || native.starting || native.pending || native.navigating || native.cleanupPending) throw new Error('An existing native connection lifecycle is present; this runner will not take it over.');
    ownsConnection = true;
    await bridge.start();
    report.checks.push('Dedicated owned native browser session connected');
    const paths = ['/api/study-plans', '/api/study-plans/pytorch-basics/problems/pytorch-balanced-dataloader'];
    for (const route of paths) {
      report.realSiteReads++;
      const result = await bridge.request(route);
      if (!result || result.status !== 'success' || !result.data || typeof result.data !== 'object') throw new Error('Unexpected API schema');
      if (route.includes('/problems/') && (typeof result.data.title !== 'string' || typeof result.data.starterCode !== 'string' || typeof result.data.description !== 'string' || !result.data.functionMetadata || typeof result.data.functionMetadata !== 'object')) throw new Error('Unexpected problem schema');
      const text = JSON.stringify(result);
      report.checks.push({ route, bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex'),
        jsonType: Array.isArray(result) ? 'array' : typeof result });
    }
    report.status = 'PASS';
  } catch (error) {
    // Never serialize debugger errors, payloads, page globals, or auth data.
    report.errorCode = ['AUTH_REQUIRED','LOGIN_OR_PAGE_REQUIRED','UNAVAILABLE','BUSY','CANCELED','TIMEOUT'].includes(error.code) ? error.code : 'VALIDATION_NOT_COMPLETE';
  } finally {
    if (bridge && ownsConnection) {
      try { await bridge.stop(); report.ownedCleanup = 'requested'; }
      catch (_) { report.ownedCleanup = 'unconfirmed'; report.status = 'NOT VERIFIED'; }
    }
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  if (report.status !== 'PASS') throw new Error('Native read-only validation not complete. Review sanitized report; sign in normally and retry only the read checks when authorized.');
};
