'use strict';

const { captureResultSnapshot, compareResultSnapshot } = require('./result-freshness');

// Host-only adapter. The caller injects the client's single shared Run-case
// normalizer, and supplies captured editor strings. No file or network reads,
// timers, credential access, storage, or retained source are introduced here.
function createResultFreshness({ normalizeRunCases, now = Date.now } = {}) {
  if (typeof normalizeRunCases !== 'function' || typeof now !== 'function') {
    throw new TypeError('Result freshness needs the client Run-case normalizer and a clock.');
  }
  function input(value) {
    const action = value?.action;
    let testsText;
    if (action === 'submit') testsText = null;
    else if (action === 'run' && Array.isArray(value?.testCases)) {
      testsText = JSON.stringify(normalizeRunCases(value.testCases));
    }
    return { action, problem: value?.problem, solutionUri: value?.solutionUri,
      solutionText: value?.solutionText, testsText };
  }
  return Object.freeze({
    capture(value) {
      // Capture immediately before dispatch, using the same source/tests as
      // the request, never a post-response read of the active editor.
      return captureResultSnapshot({ ...input(value), submittedAt: now() });
    },
    compare(snapshot, value) {
      try { return compareResultSnapshot(snapshot, input(value)); }
      catch (_) { return Object.freeze({ status: 'unknown', reason: 'content-unavailable' }); }
    },
  });
}

// Render this DTO as escaped text, not trusted HTML. Never expose fingerprints
// or editor URIs to the webview; freshness is not a server verdict or progress.
function resultFreshnessLabel(snapshot, freshness) {
  const noun = snapshot?.binding?.action === 'submit' ? 'submission' : 'run';
  const status = ['unchanged', 'changed', 'unknown'].includes(freshness?.status) ? freshness.status : 'unknown';
  const label = status === 'unchanged' ? `Unchanged since this ${noun}`
    : status === 'changed' ? `Changed since this ${noun} — results refer to the previous content`
      : 'Current content could not be compared';
  const milliseconds = snapshot?.submittedAt;
  const timestamp = Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 8640000000000000
    ? new Date(milliseconds).toISOString() : undefined;
  return Object.freeze({ status, label, ...(timestamp ? { timestamp } : {}) });
}

module.exports = { createResultFreshness, resultFreshnessLabel };
