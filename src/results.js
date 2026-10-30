'use strict';

// Pure presentation of a grading response. This module performs no requests,
// retries, script execution, or HTML interpretation of server-provided values.
const MAX_CASES = 50;
const MAX_VALUE_LENGTH = 16000;
const MAX_RAW_LENGTH = 100000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function field(value, key) {
  if (!record(value) && !Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch (_) { return undefined; }
}
function first(value, keys) {
  for (const key of keys) {
    const candidate = field(value, key);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}
function nonempty(value) { return value !== undefined && value !== null && value !== '' && value !== false; }
function count(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

// Bound malformed/deep/large responses, do not invoke accessors or toJSON, and
// make every truncation visible. Normal small JSON responses remain complete.
function formatValue(value, limit = MAX_VALUE_LENGTH) {
  const seen = new WeakSet();
  let remaining = 2000;
  function copy(input, depth) {
    if (--remaining < 0) return '[Response truncated: too many values]';
    if (typeof input === 'string') return input.length > limit ? input.slice(0, limit) + '\n[Value truncated]' : input;
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : String(input);
    if (input === undefined) return '[Not provided]';
    if (typeof input === 'bigint') return String(input) + 'n';
    if (typeof input !== 'object') return '[Unsupported value]';
    if (seen.has(input)) return '[Circular reference]';
    if (depth > 12) return '[Response truncated: nesting limit]';
    seen.add(input);
    let output;
    if (Array.isArray(input)) {
      output = [];
      const length = Math.min(input.length, 200);
      for (let i = 0; i < length; i++) output.push(copy(field(input, String(i)), depth + 1));
      if (input.length > length) output.push(`[Response truncated: ${input.length - length} more items]`);
    } else {
      output = Object.create(null);
      let keys;
      try { keys = Object.keys(input); } catch (_) { return '[Unreadable object]'; }
      for (const key of keys.slice(0, 200)) output[key] = copy(field(input, key), depth + 1);
      if (keys.length > 200) output['[Truncated]'] = `${keys.length - 200} more properties`;
    }
    seen.delete(input);
    return output;
  }
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(copy(value, 0), null, 2); }
  catch (_) { text = '[Unable to display response]'; }
  if (text.length > limit) text = text.slice(0, limit) + '\n[Display truncated]';
  return text;
}

function payload(result) {
  const data = field(result, 'data');
  // The existing API sometimes wraps grading data in a success envelope. A
  // successful HTTP/API request alone is not proof that test cases passed.
  return field(result, 'status') === 'success' && record(data) &&
    !nonempty(field(result, 'error')) && !nonempty(field(result, 'traceback')) ? data : result;
}

const PASS_STATUSES = ['passed', 'pass', 'accepted'];
const FAIL_STATUSES = ['failed', 'fail', 'wrong_answer', 'rejected'];
const ERROR_STATUSES = ['error', 'runtime_error', 'compilation_error', 'compile_error', 'syntax_error', 'timeout', 'time_limit_exceeded'];
const PENDING_STATUSES = ['pending', 'queued', 'running', 'processing'];
const CASE_FIELDS = ['tests', 'results', 'testResults', 'test_results', 'testCases', 'cases'];
function statusOf(value) {
  const raw = field(value, 'status');
  return typeof raw === 'string' ? raw.toLowerCase().trim().replace(/[\s-]+/g, '_') : '';
}
function hasKnownFailure(value) {
  const passed = field(value, 'passed'), total = field(value, 'total');
  return nonempty(field(value, 'error')) || nonempty(field(value, 'traceback')) ||
    FAIL_STATUSES.includes(statusOf(value)) || ERROR_STATUSES.includes(statusOf(value)) ||
    ['passed', 'accepted', 'ok'].some(key => field(value, key) === false) ||
    count(passed) && count(total) && passed !== total;
}

function stateOf(value) {
  const status = statusOf(value);
  if (nonempty(field(value, 'error')) || nonempty(field(value, 'traceback'))) return { kind: 'error', label: 'Error' };
  if (ERROR_STATUSES.includes(status)) return { kind: 'error', label: 'Error' };
  if (FAIL_STATUSES.includes(status)) return { kind: 'failed', label: 'Failed' };
  if (PENDING_STATUSES.includes(status)) return { kind: 'pending', label: 'Still processing' };
  // An unfamiliar explicit outcome must not be overwritten with an optimistic
  // inference from partial counts (for example, "service_unavailable").
  if (status && status !== 'success' && !PASS_STATUSES.includes(status)) return { kind: 'unknown', label: 'Result received' };
  const passed = field(value, 'passed'), total = field(value, 'total');
  const flags = ['passed', 'accepted', 'ok'].map(key => field(value, key));
  const explicitPass = PASS_STATUSES.includes(status) || flags.includes(true);
  const cases = first(value, CASE_FIELDS);
  let failedCase = false;
  if (Array.isArray(cases)) {
    for (let index = 0; index < cases.length; index++) {
      if (hasKnownFailure(field(cases, String(index)))) { failedCase = true; break; }
    }
  }
  const invalidCounts = passed !== undefined && typeof passed !== 'boolean' && !count(passed) || total !== undefined && !count(total);
  const countsDisagree = count(passed) && count(total) && passed !== total;
  if (explicitPass && (flags.includes(false) || failedCase || invalidCounts || countsDisagree)) {
    return { kind: 'unknown', label: 'Result needs review', conflict: true };
  }
  if (explicitPass) return { kind: 'passed', label: 'Passed' };
  if (flags.includes(false)) return { kind: 'failed', label: 'Failed' };
  if (count(passed) && count(total) && total > 0 && passed <= total) {
    if (passed === total && failedCase) return { kind: 'unknown', label: 'Result needs review', conflict: true };
    return { kind: passed === total ? 'passed' : 'failed', label: passed === total ? 'Passed' : 'Failed' };
  }
  return { kind: 'unknown', label: 'Result received' };
}

function durationOf(value) {
  for (const key of ['durationMs', 'duration_ms', 'runtimeMs', 'runtime_ms', 'executionTimeMs', 'execution_time_ms']) {
    const duration = field(value, key);
    if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) return `${duration} ms`;
  }
  const duration = field(value, 'duration');
  if (typeof duration === 'string' && /^\d+(?:\.\d+)?\s*(?:ms|s|milliseconds?|seconds?)$/i.test(duration.trim())) return duration.trim();
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) return `${duration} (unit not provided)`;
  return undefined;
}

function detail(label, value) {
  if (value === undefined) return '';
  return `<div class="result-value"><h4>${escapeHtml(label)}</h4><pre>${escapeHtml(formatValue(value))}</pre></div>`;
}
function optionalDetail(label, value) { return value === '' ? '' : detail(label, value); }

function renderCase(value, index) {
  const state = stateOf(value);
  const name = first(value, ['name', 'id']);
  const label = typeof name === 'string' || typeof name === 'number' ? String(name).slice(0, 240) : `Test case ${index + 1}`;
  const duration = durationOf(value);
  const values = [
    detail('Input', first(value, ['inputs', 'input'])),
    detail('Expected', first(value, ['expected', 'expectedOutput', 'expected_output'])),
    detail('Actual', first(value, ['actual', 'output', 'actualOutput', 'actual_output'])),
    optionalDetail('Error', field(value, 'error')),
    optionalDetail('Traceback', field(value, 'traceback')),
    optionalDetail('Standard error', field(value, 'stderr')),
    optionalDetail('Standard output', first(value, ['stdout', 'logs'])),
    optionalDetail('Message', first(value, ['message', 'msg'])),
  ].join('');
  return `<details class="result-case result-${state.kind}"${(state.kind === 'failed' || state.kind === 'error') && index < 5 ? ' open' : ''}><summary><span class="case-title">${escapeHtml(label)}</span> <span class="result-badge">${state.label}</span>${duration ? ` <span class="meta">${escapeHtml(duration)}</span>` : ''}</summary>${values || '<p class="meta">No input, expected value, or actual value was included for this case.</p>'}</details>`;
}

function renderResult(result, options = {}) {
  const value = payload(result);
  if (options.localError === true) {
    // A transport exception is generated locally, not a grading response from
    // TensorTonic. Do not label its synthetic fields as raw server JSON.
    return `<section class="result-summary result-error" aria-label="Request error"><h2>Request error</h2></section>${detail('Message', field(value, 'message'))}${detail('Error', field(value, 'error'))}`;
  }
  const state = stateOf(value);
  const passed = field(value, 'passed'), total = field(value, 'total');
  const duration = durationOf(value);
  const metrics = [];
  const notices = [];
  if (count(passed) && count(total) && passed <= total) {
    metrics.push(`<div><dt>Tests passed</dt><dd>${passed} / ${total}</dd></div>`);
    if (total === 0) notices.push('The response reports zero test cases.');
  } else {
    if (count(passed)) metrics.push(`<div><dt>Tests passed</dt><dd>${passed}</dd></div>`);
    if (count(total)) metrics.push(`<div><dt>Total tests</dt><dd>${total}</dd></div>`);
    if (count(passed) && count(total) && passed > total) notices.push('The reported counts are inconsistent. Inspect the raw response for details.');
    else if (passed === undefined && total === undefined || typeof passed === 'boolean' && total === undefined) notices.push('Test counts were not included in the response.');
    else if (passed !== undefined && typeof passed !== 'boolean' && !count(passed) || total !== undefined && !count(total)) notices.push('Some test counts are invalid or unavailable. Inspect the raw response for details.');
  }
  if (duration !== undefined) metrics.push(`<div><dt>Runtime</dt><dd>${escapeHtml(duration)}</dd></div>`);
  const rawStatus = field(value, 'status');
  if (state.conflict) notices.push('The reported outcome conflicts with test counts or case results. A pass cannot be confirmed; inspect the details below.');
  else if (state.kind === 'unknown') notices.push('No recognized grading outcome was included. This does not confirm a pass.');
  if (state.kind === 'pending') notices.push('This is not a final grading result. Check the website before submitting again; the extension will not replay your submission.');
  const status = typeof rawStatus === 'string' ? `<p class="meta">Reported status: ${escapeHtml(rawStatus.slice(0, 160))}</p>` : '';
  const errors = [optionalDetail('Error', field(value, 'error')), optionalDetail('Traceback', field(value, 'traceback'))].join('');
  const output = [optionalDetail('Message', first(value, ['message', 'msg'])), optionalDetail('Standard output', first(value, ['stdout', 'logs'])), optionalDetail('Standard error', field(value, 'stderr'))].join('');
  let cases = first(value, CASE_FIELDS);
  if (!Array.isArray(cases)) cases = [];
  const shownCases = [];
  for (let index = 0; index < Math.min(cases.length, MAX_CASES); index++) shownCases.push(renderCase(field(cases, String(index)), index));
  const casesHtml = cases.length ? `<section class="result-cases"><h3>Test cases</h3><p class="meta">Expand a case to inspect the values returned by TensorTonic.</p>${shownCases.join('')}${cases.length > MAX_CASES ? `<p class="notice">Showing ${MAX_CASES} of ${cases.length} returned cases. Additional cases remain in the raw response, subject to its display limit.</p>` : ''}</section>` : '<p class="meta">Individual test details were not returned.</p>';
  return `<section class="result-summary result-${state.kind}" aria-label="Grading summary"><h2>${state.label}</h2>${metrics.length ? `<dl class="result-metrics">${metrics.join('')}</dl>` : ''}${status}${notices.map(notice => `<p class="notice">${notice}</p>`).join('')}</section>${errors}${output}${casesHtml}<details class="result-debug"><summary>Raw response (JSON)</summary><pre>${escapeHtml(formatValue(result, MAX_RAW_LENGTH))}</pre></details>`;
}

module.exports = { renderResult, formatValue };
