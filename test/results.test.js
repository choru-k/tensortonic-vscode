'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderResult, formatValue } = require('../src/results');

const summary = html => html.split('<details class="result-debug">')[0];
const observedSubmit = { status: 'passed', tests: [], passed: 43, total: 43, duration_ms: 1006, newBadges: [] };
const observedRun = { status: 'passed', tests: [{ id: 'test-1', name: 'Case 1', ok: true, isPublic: true, msg: '',
  inputs: { logits: [[1, 2, 3]] }, expected: [[0.09, 0.2447, 0.6652]], actual: [[0.09, 0.2447, 0.6652]], logs: '' }] };

test('observed Submit response clearly shows pass count and millisecond duration without inventing case details', () => {
  const html = renderResult(observedSubmit);
  assert.match(html, /result-summary result-passed/);
  assert.match(html, /<h2>Passed<\/h2>/);
  assert.match(html, /<dt>Tests passed<\/dt><dd>43 \/ 43<\/dd>/);
  assert.match(html, /<dt>Runtime<\/dt><dd>1006 ms<\/dd>/);
  assert.match(html, /Individual test details were not returned\./);
  assert.doesNotMatch(summary(html), /No tests|zero test|0 \/ 0|not included/);
  assert.match(html, /<details class="result-debug"><summary>Raw response \(JSON\)<\/summary>/);
  assert.doesNotMatch(html, /class="result-debug" open/);
  assert.ok(html.includes('&quot;newBadges&quot;'));
});

test('observed Run response expands input, expected and actual values using ok flags', () => {
  const html = summary(renderResult(observedRun));
  assert.match(html, /<details class="result-case result-passed">/);
  assert.match(html, /class="case-title">Case 1<\/span>/);
  for (const label of ['Input', 'Expected', 'Actual']) assert.ok(html.includes(`<h4>${label}</h4>`));
  assert.match(html, /&quot;logits&quot;/);
  assert.match(html, /0\.6652/);
  assert.match(html, /Test counts were not included/);
  assert.doesNotMatch(html, /0 \/ 0/);
  assert.doesNotMatch(html, /<h4>Message|<h4>Standard output|<pre><\/pre>/);
});

test('failed cases expose errors and values prominently without scripts', () => {
  const html = summary(renderResult({ status: 'failed', passed: 1, total: 2, tests: [
    { name: 'Passing case', ok: true, inputs: 0, expected: false, actual: false },
    { name: 'Mismatch', ok: false, inputs: null, expected: [2], actual: [3], msg: 'Output differs', logs: 'run log' },
  ] }));
  assert.match(html, /result-summary result-failed/);
  assert.match(html, /1 \/ 2/);
  assert.match(html, /<details class="result-case result-failed" open>/);
  assert.match(html, /Output differs/);
  assert.match(html, /run log/);
  assert.match(html, /<h4>Input<\/h4><pre>null<\/pre>/);
  assert.match(html, /<h4>Expected<\/h4><pre>false<\/pre>/);
  assert.match(html, /<h4>Input<\/h4><pre>0<\/pre>/);
});

test('runtime errors display error, traceback and stderr instead of claiming a grading pass', () => {
  const html = summary(renderResult({ status: 'runtime_error', error: 'ValueError: wrong shape',
    traceback: 'File "solution.py", line 4\nraise ValueError()', stderr: 'process exited' }));
  assert.match(html, /result-summary result-error/);
  assert.match(html, /<h2>Error<\/h2>/);
  assert.match(html, /ValueError: wrong shape/);
  assert.match(html, /<h4>Traceback<\/h4>/);
  assert.match(html, /process exited/);
  assert.doesNotMatch(html, /0 \/ 0|<h2>Passed/);
});

test('local request errors are not mislabeled as raw server responses or final grading results', () => {
  const html = renderResult({ status: 'error', error: 'Network timeout',
    message: 'No confirmed grading result was received. Check TensorTonic before submitting again.' }, { localError: true });
  assert.match(html, /<h2>Request error<\/h2>/);
  assert.match(html, /Network timeout/);
  assert.match(html, /No confirmed grading result was received/);
  assert.doesNotMatch(html, /Raw response|Reported status|Tests passed|test details|result-debug/);
});

test('missing, primitive and unfamiliar responses never fabricate a successful outcome or zero counts', () => {
  for (const value of [undefined, null, [], {}, 'Unexpected response', { status: 'success' }, { status: 'mystery', duration_ms: -1 }]) {
    const html = summary(renderResult(value));
    assert.match(html, /result-summary result-unknown/);
    assert.match(html, /does not confirm a pass/);
    assert.doesNotMatch(html, /<h2>Passed|0 \/ 0|Runtime/);
  }
});

test('a success envelope unwraps actual grading data rather than treating transport success as a pass', () => {
  const html = summary(renderResult({ status: 'success', data: { passed: false, total: 3, error: 'Grading failed' } }));
  assert.match(html, /result-summary result-error/);
  assert.match(html, /Grading failed/);
  assert.doesNotMatch(html, /false \/ 3|0 \/ 3/);
  const unknown = summary(renderResult({ status: 'success', data: { message: 'Request received' } }));
  assert.match(unknown, /result-summary result-unknown/);
  const outerError = summary(renderResult({ status: 'success', error: 'Envelope failure', data: { status: 'passed' } }));
  assert.match(outerError, /result-summary result-error/);
  assert.match(outerError, /Envelope failure/);
});

test('explicit booleans are outcomes, not numeric counts; real zero counts stay zero', () => {
  for (const property of ['passed', 'accepted', 'ok']) {
    assert.match(summary(renderResult({ [property]: true })), /result-summary result-passed/);
    assert.match(summary(renderResult({ [property]: false })), /result-summary result-failed/);
  }
  const zero = summary(renderResult({ passed: 0, total: 3, duration_ms: 0 }));
  assert.match(zero, /result-summary result-failed/);
  assert.match(zero, /<dd>0 \/ 3<\/dd>/);
  assert.match(zero, /<dd>0 ms<\/dd>/);
  const empty = summary(renderResult({ passed: 0, total: 0 }));
  assert.match(empty, /result-summary result-unknown/);
  assert.match(empty, /reports zero test cases/);
});

test('invalid and incomplete counts do not become fabricated ratios', () => {
  for (const value of [{ passed: '2', total: '3' }, { passed: -1, total: 3 }, { passed: 2.5, total: 3 }, { passed: Infinity, total: NaN }]) {
    const html = summary(renderResult(value));
    assert.match(html, /invalid or unavailable/);
    assert.doesNotMatch(html, /<dd>[^<]* \/ /);
  }
  const inconsistent = summary(renderResult({ passed: 4, total: 3 }));
  assert.match(inconsistent, /reported counts are inconsistent/);
  assert.match(inconsistent, /result-summary result-unknown/);
  assert.doesNotMatch(inconsistent, /4 \/ 3/);
  assert.match(summary(renderResult({ total: 43 })), /<dt>Total tests<\/dt><dd>43<\/dd>/);
});

test('contradictory success fields do not produce a green passed headline', () => {
  for (const value of [
    { status: 'passed', passed: 1, total: 2 },
    { status: 'passed', passed: 4, total: 3 },
    { status: 'passed', passed: -1, total: 3 },
    { status: 'passed', ok: false },
    { status: 'passed', tests: [{ ok: false }] },
    { status: 'passed', tests: [{ error: 'failed execution' }] },
    { status: 'passed', tests: [{ passed: 0, total: 1 }] },
    { passed: 3, total: 3, tests: [{ status: 'failed' }] },
    { passed: true, accepted: false },
  ]) {
    const html = summary(renderResult(value));
    assert.match(html, /result-summary result-unknown/);
    assert.match(html, /<h2>Result needs review<\/h2>/);
    assert.match(html, /A pass cannot be confirmed/);
    assert.doesNotMatch(html, /result-summary result-passed/);
  }
  const unknown = summary(renderResult({ status: 'service_unavailable', passed: 3, total: 3 }));
  assert.match(unknown, /result-summary result-unknown/);
  assert.doesNotMatch(unknown, /<h2>Passed/);
  const manyCases = Array.from({ length: 60 }, () => ({ ok: true }));
  manyCases[59] = { passed: 0, total: 1 };
  const laterFailure = summary(renderResult({ status: 'passed', tests: manyCases }));
  assert.match(laterFailure, /<h2>Result needs review<\/h2>/);
  assert.match(laterFailure, /Showing 50 of 60/);
});

test('duration unit is only attached when explicit in its field or value', () => {
  assert.match(summary(renderResult({ durationMs: 12.5 })), /12\.5 ms/);
  assert.match(summary(renderResult({ duration: '1.5 s' })), /1\.5 s/);
  assert.match(summary(renderResult({ duration: 12 })), /12 \(unit not provided\)/);
  assert.doesNotMatch(summary(renderResult({ duration: 'fast', runtime: 4 })), /<dt>Runtime/);
});

test('pending status is not a completed grading result and never instructs automatic replay', () => {
  const html = summary(renderResult({ status: 'running', passed: 1, total: 3 }));
  assert.match(html, /result-summary result-pending/);
  assert.match(html, /Still processing/);
  assert.match(html, /not a final grading result/);
  assert.match(html, /will not replay/);
  assert.doesNotMatch(html, /<h2>Failed|<h2>Passed/);
});

test('every untrusted string is escaped, including case titles, output, status and raw response', () => {
  const attack = '</pre></summary><script src="https://evil.example">x</script><img src=x onerror="alert(1)">&';
  const html = renderResult({ status: attack, message: attack, stdout: attack, error: attack,
    tests: [{ name: attack, ok: false, inputs: attack, expected: attack, actual: attack, traceback: attack, logs: attack }] });
  assert.doesNotMatch(html, /<script|<img|<iframe|<a\b|onerror="|<style/);
  assert.ok(html.includes('&lt;script src=&quot;https://evil.example&quot;&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('large case sets and strings stay bounded with visible truncation notices', () => {
  const cases = Array.from({ length: 100 }, (_, index) => ({ id: index, ok: false, actual: 'a'.repeat(17000) }));
  const html = renderResult({ tests: cases });
  assert.equal((html.match(/class="result-case /g) || []).length, 50);
  assert.equal((html.match(/class="result-case result-failed" open/g) || []).length, 5);
  assert.match(html, /Showing 50 of 100/);
  assert.match(html, /Display truncated/);
  assert.ok(html.length < 1000000);
});

test('cyclic, deep and non-JSON values remain readable without executing getters or toJSON', () => {
  let calls = 0;
  const value = { amount: 10n, toJSON() { calls++; throw Error('must not execute'); } };
  value.self = value;
  Object.defineProperty(value, 'error', { enumerable: true, get() { calls++; throw Error('must not execute'); } });
  const html = renderResult(value);
  assert.equal(calls, 0);
  assert.match(html, /Circular reference/);
  assert.match(html, /10n/);
  assert.doesNotMatch(html, /<h2>Error/);
  let deep = {};
  for (let i = 0; i < 30; i++) deep = { nested: deep };
  assert.match(formatValue(deep), /nesting limit/);
});
