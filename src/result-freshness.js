'use strict';

// Extension-host only. No IO, clock reads, VS Code dependency, or retained source.
const { createHash } = require('node:crypto');
const VERSION = 1;
function field(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch (_) { return undefined; }
}
function identifier(value) {
  return typeof value === 'string' && value.length > 0 ||
    typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
}
function binding(input) {
  const problem = field(input, 'problem');
  const rawPlan = field(problem, 'planId');
  const planId = rawPlan == null || rawPlan === '' ? '' : identifier(rawPlan);
  const apiId = identifier(field(problem, 'apiId'));
  const slug = identifier(field(problem, 'slug'));
  const solutionUri = field(input, 'solutionUri');
  const action = field(input, 'action');
  if (planId === undefined || (!apiId && !slug) || typeof solutionUri !== 'string' ||
      solutionUri.length === 0 || !['run', 'submit'].includes(action)) return undefined;
  // API identity wins over a renamed/reused browser slug; do not truncate IDs.
  return Object.freeze({ planId, problemKind: apiId ? 'api' : 'slug',
    problemId: apiId || slug, solutionUri, action });
}
function contentHash(input, action) {
  const solutionText = field(input, 'solutionText');
  const testsText = field(input, 'testsText');
  if (typeof solutionText !== 'string' ||
      (action === 'run' ? typeof testsText !== 'string' : testsText !== null)) return undefined;
  // JSON framing prevents concatenation collisions and preserves exact strings,
  // including whitespace, line endings, and otherwise ambiguous lone surrogates.
  return createHash('sha256').update(JSON.stringify(['tt-result-v1', solutionText, testsText]), 'utf8').digest('hex');
}
function captureResultSnapshot(input) {
  const owner = binding(input);
  const submittedAt = field(input, 'submittedAt');
  const hash = owner && contentHash(input, owner.action);
  if (!owner || !hash || !Number.isSafeInteger(submittedAt) || submittedAt < 0 || submittedAt > 8640000000000000) {
    throw new TypeError('A result snapshot requires valid binding, captured content, and a UTC epoch-millisecond timestamp.');
  }
  return Object.freeze({ version: VERSION, algorithm: 'sha256', submittedAt, binding: owner, contentHash: hash });
}
function validSnapshot(snapshot) {
  if (field(snapshot, 'version') !== VERSION || field(snapshot, 'algorithm') !== 'sha256') return false;
  const timestamp = field(snapshot, 'submittedAt');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8640000000000000) return false;
  const hash = field(snapshot, 'contentHash');
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false;
  const owner = field(snapshot, 'binding');
  return typeof field(owner, 'planId') === 'string' && ['api', 'slug'].includes(field(owner, 'problemKind')) &&
    typeof field(owner, 'problemId') === 'string' && field(owner, 'problemId').length > 0 &&
    typeof field(owner, 'solutionUri') === 'string' && field(owner, 'solutionUri').length > 0 &&
    ['run', 'submit'].includes(field(owner, 'action'));
}
function outcome(status, reason) { return Object.freeze({ status, reason }); }
function compareResultSnapshot(snapshot, current) {
  if (!validSnapshot(snapshot)) return outcome('unknown', 'snapshot-unavailable');
  const owner = binding(current);
  if (!owner) return outcome('unknown', 'binding-unavailable');
  const savedOwner = field(snapshot, 'binding');
  if (Object.keys(owner).some(key => owner[key] !== field(savedOwner, key))) return outcome('unknown', 'binding-mismatch');
  const hash = contentHash(current, owner.action);
  if (!hash) return outcome('unknown', 'content-unavailable');
  return hash === field(snapshot, 'contentHash') ? outcome('unchanged', 'content-matches') : outcome('changed', 'content-differs');
}
module.exports = { captureResultSnapshot, compareResultSnapshot };
