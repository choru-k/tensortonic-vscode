'use strict';

// Pure workspace-state model. No persistence, filesystem, server, or progress APIs.
const VERSION = 1;
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function id(value, label = 'plan ID') {
  if (typeof value !== 'string' || !SLUG.test(value)) throw new TypeError(`Invalid ${label}.`);
  return value;
}
function catalogIds(catalog) {
  if (!Array.isArray(catalog)) throw new TypeError('A successfully loaded catalog array is required.');
  const ids = new Set();
  for (const row of catalog) {
    if (!row || typeof row !== 'object') throw new TypeError('Invalid catalog row.');
    id(row.id);
    if (row.supported !== false) ids.add(row.id);
  }
  return ids;
}
function chosenIds(values, catalog) {
  if (!Array.isArray(values)) throw new TypeError('Chosen plans must be an array.');
  const allowed = catalogIds(catalog);
  const result = [];
  for (const value of values) {
    id(value);
    if (!allowed.has(value)) throw new RangeError(`Unknown or unsupported study plan: ${value}`);
    if (!result.includes(value)) result.push(value);
  }
  return result;
}
function ref(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid problem reference.');
  const result = { slug: id(value.slug, 'problem slug') };
  if (value.planId != null && value.planId !== '') result.planId = id(value.planId);
  return result;
}
function assertState(state) {
  if (!state || state.version !== VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.planIds) || !state.resumeByPlan || typeof state.resumeByPlan !== 'object' || Array.isArray(state.resumeByPlan)) {
    throw new TypeError('Invalid membership state. Restore it before use.');
  }
  const seen = new Set();
  for (const planId of state.planIds) {
    id(planId);
    if (seen.has(planId)) throw new TypeError('Duplicate stored membership.');
    seen.add(planId);
  }
  for (const [planId, slug] of Object.entries(state.resumeByPlan)) { id(planId); id(slug, 'problem slug'); }
  if (state.openedRef !== null) ref(state.openedRef);
}
function next(state, changes) {
  if (state.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Membership revision exhausted.');
  return { version: VERSION, revision: state.revision + 1, planIds: [...state.planIds],
    resumeByPlan: { ...state.resumeByPlan }, openedRef: state.openedRef && { ...state.openedRef }, ...changes };
}
function expectRevision(state, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    const error = new Error('Study-plan selection changed. Reopen the picker and try again.');
    error.code = 'STALE_MEMBERSHIP_REVISION';
    throw error;
  }
}

/** Restore v1 data without dropping history when catalog is offline/changes.
 * First migration validates the legacy single-plan setting against a loaded catalog.
 * An existing empty v1 selection is authoritative: never resurrect the legacy value.
 */
function restoreState({ saved, legacyPlanId, catalog } = {}) {
  if (saved != null) {
    assertState(saved);
    return { version: VERSION, revision: saved.revision, planIds: [...saved.planIds],
      resumeByPlan: { ...saved.resumeByPlan }, openedRef: saved.openedRef && ref(saved.openedRef) };
  }
  const planIds = legacyPlanId == null || legacyPlanId === '' ? [] : chosenIds([legacyPlanId], catalog);
  return { version: VERSION, revision: 0, planIds, resumeByPlan: {}, openedRef: null };
}
function setMembership(state, values, catalog, { expectedRevision } = {}) {
  assertState(state);
  expectRevision(state, expectedRevision);
  const planIds = chosenIds(values, catalog);
  if (planIds.length === state.planIds.length && planIds.every((value, index) => value === state.planIds[index])) return state;
  return next(state, { planIds });
}
function addPlan(state, planId, catalog, options) {
  assertState(state);
  return setMembership(state, [...state.planIds, planId], catalog, options);
}
// Removal does not require a network catalog, and NEVER deletes resume/progress/code.
function removePlan(state, planId, { expectedRevision } = {}) {
  assertState(state);
  id(planId);
  expectRevision(state, expectedRevision);
  if (!state.planIds.includes(planId)) return state;
  return next(state, { planIds: state.planIds.filter(value => value !== planId) });
}
function recordOpenedProblem(state, problemRef) {
  assertState(state);
  const openedRef = ref(problemRef);
  const resumeByPlan = { ...state.resumeByPlan };
  if (openedRef.planId) resumeByPlan[openedRef.planId] = openedRef.slug;
  if (state.openedRef && state.openedRef.slug === openedRef.slug && state.openedRef.planId === openedRef.planId &&
      (!openedRef.planId || state.resumeByPlan[openedRef.planId] === openedRef.slug)) return state;
  return next(state, { openedRef, resumeByPlan });
}
function getResumeRef(state, planId) {
  assertState(state);
  id(planId);
  return own(state.resumeByPlan, planId) ? { planId, slug: state.resumeByPlan[planId] } : null;
}
function beginPicker(state) {
  assertState(state);
  return { revision: state.revision, planIds: [...state.planIds] };
}
function commitPicker(state, snapshot, chosen, catalog) {
  assertState(state);
  // VS Code cancellation is undefined; null also means cancel, [] means remove all.
  if (chosen == null) return { status: 'cancelled', state };
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new TypeError('Invalid picker snapshot.');
  if (snapshot.revision !== state.revision) return { status: 'stale', state };
  const result = setMembership(state, chosen, catalog, { expectedRevision: snapshot.revision });
  return { status: result === state ? 'unchanged' : 'committed', state: result };
}
module.exports = { VERSION, restoreState, setMembership, addPlan, removePlan, recordOpenedProblem, getResumeRef, beginPicker, commitPicker };
