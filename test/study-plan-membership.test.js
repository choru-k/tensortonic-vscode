'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/study-plan-membership');
const catalog = [{ id: 'python', supported: true }, { id: 'numpy' }, { id: 'pytorch' }, { id: 'sql', supported: false }];
const empty = () => m.restoreState();
const selected = () => m.setMembership(empty(), ['python', 'numpy'], catalog);
function freeze(value) { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value; }

test('empty state is JSON serializable and contains no timestamps', () => {
  assert.deepEqual(empty(), { version: 1, revision: 0, planIds: [], resumeByPlan: {}, openedRef: null });
  assert.deepEqual(JSON.parse(JSON.stringify(empty())), empty());
});
test('migrates legacy configured single plan', () => {
  assert.deepEqual(m.restoreState({ legacyPlanId: 'python', catalog }).planIds, ['python']);
});
test('empty legacy/free problems does not create phantom membership', () => {
  assert.deepEqual(m.restoreState({ legacyPlanId: '' }).planIds, []);
});
test('migration rejects unknown and unsupported catalog IDs', () => {
  for (const legacyPlanId of ['missing', 'sql']) assert.throws(() => m.restoreState({ legacyPlanId, catalog }), RangeError);
});
test('existing empty v1 selection wins over legacy config', () => {
  assert.deepEqual(m.restoreState({ saved: empty(), legacyPlanId: 'python', catalog }), empty());
});
test('restore preserves saved membership and resumes even when catalog unavailable', () => {
  const saved = m.recordOpenedProblem(selected(), { planId: 'python', slug: 'first' });
  const restored = m.restoreState({ saved });
  assert.deepEqual(restored, saved);
  assert.notEqual(restored.planIds, saved.planIds);
  assert.notEqual(restored.resumeByPlan, saved.resumeByPlan);
  assert.notEqual(restored.openedRef, saved.openedRef);
});
test('unsupported schema and malformed stored state fail instead of destructive fallback', () => {
  for (const saved of [{ ...empty(), version: 2 }, { ...empty(), revision: NaN }, { ...empty(), planIds: ['python', 'python'] }, { ...empty(), resumeByPlan: [] }, { ...empty(), openedRef: {} }]) {
    assert.throws(() => m.restoreState({ saved }), TypeError);
  }
});
test('ordered selection deduplicates without sorting and supports three concurrent plans', () => {
  assert.deepEqual(m.setMembership(empty(), ['pytorch', 'python', 'pytorch', 'numpy'], catalog).planIds, ['pytorch', 'python', 'numpy']);
});
test('invalid IDs, unsupported plans and malformed catalogs fail before changing input', () => {
  const state = freeze(selected());
  for (const values of [['nope'], ['sql'], ['../python'], [''], [null]]) assert.throws(() => m.setMembership(state, values, catalog));
  assert.throws(() => m.setMembership(state, ['python'], undefined), TypeError);
  assert.throws(() => m.setMembership(state, ['python'], [{}]), TypeError);
  assert.deepEqual(state.planIds, ['python', 'numpy']);
});
test('add is immutable; already selected add is a no-op', () => {
  const state = freeze(selected());
  const next = m.addPlan(state, 'pytorch', catalog);
  assert.deepEqual(next.planIds, ['python', 'numpy', 'pytorch']);
  assert.equal(next.revision, state.revision + 1);
  assert.equal(m.addPlan(state, 'python', catalog), state);
});
test('removing completed plan changes membership only and retains its resume', () => {
  const state = freeze(m.recordOpenedProblem(selected(), { planId: 'python', slug: 'last-problem' }));
  const next = m.removePlan(state, 'python');
  assert.deepEqual(next.planIds, ['numpy']);
  assert.deepEqual(next.resumeByPlan, state.resumeByPlan);
  assert.deepEqual(next.openedRef, state.openedRef);
  assert.deepEqual(state.planIds, ['python', 'numpy']);
});
test('readding deselected plan restores its prior resume target', () => {
  const opened = m.recordOpenedProblem(selected(), { planId: 'python', slug: 'last-problem' });
  const readded = m.addPlan(m.removePlan(opened, 'python'), 'python', catalog);
  assert.deepEqual(m.getResumeRef(readded, 'python'), { planId: 'python', slug: 'last-problem' });
  assert.deepEqual(readded.planIds, ['numpy', 'python']);
});
test('each plan keeps an independent resume and returned ref is detached', () => {
  let state = m.recordOpenedProblem(selected(), { planId: 'python', slug: 'p1' });
  state = m.recordOpenedProblem(state, { planId: 'numpy', slug: 'n2' });
  const resume = m.getResumeRef(state, 'python'); resume.slug = 'changed';
  assert.equal(m.getResumeRef(state, 'python').slug, 'p1');
  assert.equal(m.getResumeRef(state, 'numpy').slug, 'n2');
  assert.equal(m.getResumeRef(state, 'pytorch'), null);
});
test('opened problem is independent from selected plans and dropping all membership', () => {
  const state = m.recordOpenedProblem(selected(), { planId: 'pytorch', slug: 'tensor' });
  assert.deepEqual(state.planIds, ['python', 'numpy']);
  const next = m.setMembership(state, [], catalog);
  assert.deepEqual(next.openedRef, { planId: 'pytorch', slug: 'tensor' });
  assert.equal(next.resumeByPlan.pytorch, 'tensor');
});
test('opening free problem does not replace plan resume', () => {
  const prior = m.recordOpenedProblem(selected(), { planId: 'python', slug: 'p1' });
  const state = m.recordOpenedProblem(prior, { slug: 'free-one', planId: '' });
  assert.deepEqual(state.openedRef, { slug: 'free-one' });
  assert.deepEqual(state.resumeByPlan, prior.resumeByPlan);
});
test('opened reference whitelists slug and planId; repeated open is no-op', () => {
  const state = m.recordOpenedProblem(empty(), { slug: 'p1', planId: 'python', code: 'not stored', token: 'not stored' });
  assert.deepEqual(state.openedRef, { slug: 'p1', planId: 'python' });
  assert.equal(m.recordOpenedProblem(state, state.openedRef), state);
});
test('picker snapshot is detached and does not mutate membership', () => {
  const state = freeze(selected()); const snapshot = m.beginPicker(state);
  snapshot.planIds.push('pytorch');
  assert.deepEqual(state.planIds, ['python', 'numpy']);
});
test('cancelled picker is a no-op even if snapshot is stale or catalog unavailable', () => {
  const state = selected();
  for (const chosen of [undefined, null]) assert.deepEqual(m.commitPicker(state, { revision: 0 }, chosen), { status: 'cancelled', state });
});
test('accepted empty picker commits remove-all while preserving resume', () => {
  const state = m.recordOpenedProblem(selected(), { planId: 'python', slug: 'p1' });
  const result = m.commitPicker(state, m.beginPicker(state), [], catalog);
  assert.equal(result.status, 'committed');
  assert.deepEqual(result.state.planIds, []);
  assert.deepEqual(result.state.resumeByPlan, state.resumeByPlan);
});
test('late picker cannot overwrite newer selection', () => {
  const before = selected(); const snapshot = m.beginPicker(before);
  const after = m.addPlan(before, 'pytorch', catalog);
  assert.deepEqual(m.commitPicker(after, snapshot, ['python'], catalog), { status: 'stale', state: after });
});
test('late picker cannot overwrite newer resume/opened target', () => {
  const before = selected(); const snapshot = m.beginPicker(before);
  const after = m.recordOpenedProblem(before, { planId: 'numpy', slug: 'n1' });
  assert.equal(m.commitPicker(after, snapshot, ['python'], catalog).status, 'stale');
});
test('unchanged picker does not bump revision', () => {
  const state = selected();
  assert.deepEqual(m.commitPicker(state, m.beginPicker(state), ['python', 'numpy', 'python'], catalog), { status: 'unchanged', state });
});
test('direct stale revisions are rejected, even for otherwise no-op changes', () => {
  const state = selected();
  assert.throws(() => m.removePlan(state, 'missing', { expectedRevision: 0 }), { code: 'STALE_MEMBERSHIP_REVISION' });
  assert.throws(() => m.setMembership(state, state.planIds, catalog, { expectedRevision: 0 }), { code: 'STALE_MEMBERSHIP_REVISION' });
});
test('revision exhaustion refuses ambiguous mutation', () => {
  assert.throws(() => m.addPlan({ ...empty(), revision: Number.MAX_SAFE_INTEGER }, 'python', catalog), RangeError);
});
test('all updates are deterministic and keep caller-owned data detached', () => {
  const state = freeze(selected()); const values = ['numpy', 'pytorch'];
  const first = m.setMembership(state, values, catalog);
  assert.deepEqual(first, m.setMembership(state, values, catalog));
  values.push('python');
  assert.deepEqual(first.planIds, ['numpy', 'pytorch']);
  assert.deepEqual(m.restoreState({ saved: JSON.parse(JSON.stringify(first)) }), first);
});
