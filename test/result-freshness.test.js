'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { captureResultSnapshot: capture, compareResultSnapshot: compare } = require('../src/result-freshness');
const base = () => ({ action: 'run', problem: { planId: 'python', apiId: 'p1', slug: 'sum' },
  solutionUri: 'file:///study/python/sum.py', solutionText: 'return a + b\n',
  testsText: '[{"input":[1,2],"expected":3}]', submittedAt: 1793605500000 });
const status = (snapshot, current) => compare(snapshot, current).status;
test('unchanged in-memory content matches captured request', () => {
  const input = base(); assert.equal(status(capture(input), input), 'unchanged');
});
test('snapshot is deterministic, frozen metadata and contains no raw content or credentials', () => {
  const input = { ...base(), cookie: 'synthetic-cookie', token: 'synthetic-token' };
  const snapshot = capture(input);
  assert.deepEqual(snapshot, capture(input));
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.binding));
  assert.deepEqual(Object.keys(snapshot), ['version', 'algorithm', 'submittedAt', 'binding', 'contentHash']);
  const serialized = JSON.stringify(snapshot);
  for (const secret of [input.solutionText, input.testsText, input.cookie, input.token]) assert.ok(!serialized.includes(secret));
  assert.equal(snapshot.submittedAt, input.submittedAt);
});
for (const key of ['solutionText', 'testsText']) {
  test(`${key} edit marks changed; restoring exact content marks unchanged`, () => {
    const input = base(), snapshot = capture(input);
    assert.equal(status(snapshot, { ...input, [key]: input[key] + ' ' }), 'changed');
    assert.equal(status(snapshot, input), 'unchanged');
  });
}
for (const [name, change] of [
  ['plan', x => ({ ...x, problem: { ...x.problem, planId: 'other' } })],
  ['API problem', x => ({ ...x, problem: { ...x.problem, apiId: 'other' } })],
  ['solution URI', x => ({ ...x, solutionUri: 'file:///other.py' })],
  ['action', x => ({ ...x, action: 'submit', testsText: null })],
]) test(`${name} mismatch never claims freshness for another owner`, () => {
  const input = base(); assert.deepEqual(compare(capture(input), change(input)), { status: 'unknown', reason: 'binding-mismatch' });
});
test('API identity survives slug rename, but does not silently fall back to slug', () => {
  const input = base(), snapshot = capture(input);
  assert.equal(status(snapshot, { ...input, problem: { ...input.problem, slug: 'new' } }), 'unchanged');
  assert.equal(status(snapshot, { ...input, problem: { slug: 'sum', planId: 'python' } }), 'unknown');
});
test('free plan null, absent and empty are equivalent; numeric API IDs supported', () => {
  const input = { ...base(), problem: { apiId: 12 } }, snapshot = capture(input);
  for (const planId of [null, undefined, '']) assert.equal(status(snapshot, { ...input, problem: { apiId: '12', planId } }), 'unchanged');
});
test('slug-only owner is exact and identifiers are never truncated', () => {
  const input = { ...base(), problem: { slug: 'a'.repeat(1500) } }, snapshot = capture(input);
  assert.equal(status(snapshot, { ...input, problem: { slug: 'a'.repeat(1499) + 'b' } }), 'unknown');
});
test('Submit excludes tests because its request sends no test cases', () => {
  const input = { ...base(), action: 'submit', testsText: null };
  assert.equal(status(capture(input), input), 'unchanged');
  assert.throws(() => capture({ ...input, testsText: '[]' }), TypeError);
});
test('missing current tests/source or binding fails closed', () => {
  const input = base(), snapshot = capture(input);
  for (const key of ['testsText', 'solutionText', 'solutionUri', 'problem', 'action']) {
    const current = { ...input }; delete current[key]; assert.equal(status(snapshot, current), 'unknown');
  }
});
test('legacy or malformed snapshot is unknown, not passed or fresh', () => {
  const input = base(), snapshot = capture(input);
  for (const bad of [null, undefined, {}, [], { ...snapshot, version: 2 }, { ...snapshot, contentHash: 'bad' },
    { ...snapshot, submittedAt: NaN }, { ...snapshot, binding: {} }]) assert.equal(status(bad, input), 'unknown');
});
test('invalid captures rejected without coercing source or reading accessors', () => {
  for (const patch of [{ submittedAt: -1 }, { submittedAt: 'today' }, { submittedAt: Infinity },
    { solutionText: {} }, { testsText: undefined }, { action: 'RUN' }, { solutionUri: '' }, { problem: {} }])
    assert.throws(() => capture({ ...base(), ...patch }), TypeError);
  const input = base(); Object.defineProperty(input, 'solutionText', { get() { throw Error('getter ran'); } });
  assert.throws(() => capture(input), TypeError);
});
test('later mutable caller changes cannot alter captured binding', () => {
  const input = base(), snapshot = capture(input); input.problem.planId = 'other'; input.solutionText = 'changed';
  assert.equal(snapshot.binding.planId, 'python'); assert.equal(status(snapshot, base()), 'unchanged');
});
test('hash framing distinguishes adjacent values, line endings and lone surrogates', () => {
  const input = base();
  const hash = (solutionText, testsText = '[]') => capture({ ...input, solutionText, testsText }).contentHash;
  assert.notEqual(hash('ab', 'c'), hash('a', 'bc'));
  assert.notEqual(hash('a\n'), hash('a\r\n'));
  assert.notEqual(hash('\ud800'), hash('\ud801'));
});
test('timestamp does not affect content matching; zero is a valid explicit timestamp', () => {
  const input = { ...base(), submittedAt: 0 };
  assert.equal(status(capture(input), { ...input, submittedAt: 123 }), 'unchanged');
});
