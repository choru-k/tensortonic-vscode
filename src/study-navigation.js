'use strict';

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const METADATA = /^(?:#|\/\/|--)\s*tensortonic:\s*(\{[^\r\n]*\})\s*$/m;
const NON_PYTHON = /sql|cuda|triton|(?:^|[\s_/-])cpp(?:$|[\s_/-])|c\+\+/i;

function refOf(value) {
  const ref = value && (value.problemRef || value.ref || value);
  return ref && typeof ref === 'object' && !Array.isArray(ref) ? ref : undefined;
}

function identifier(value) { return typeof value === 'string' && value ? value : undefined; }
function planOf(ref) {
  if (!ref || (ref.planId != null && typeof ref.planId !== 'string')) return undefined;
  return ref.planId || '';
}

function problemKey(value) {
  const ref = refOf(value);
  const plan = planOf(ref);
  if (plan === undefined) return undefined;
  const apiId = identifier(ref.apiId);
  const slug = identifier(ref.slug);
  if (!apiId && !slug) return undefined;
  // A legacy browser slug is not itself evidence of an API identity.
  return JSON.stringify([plan, apiId ? 'api' : 'slug', apiId || slug]);
}

function locateProblem(orderedRefs, value) {
  const missing = { index: -1, ambiguous: false };
  const ref = refOf(value);
  const plan = planOf(ref);
  if (!Array.isArray(orderedRefs) || plan === undefined) return missing;
  const apiId = identifier(ref.apiId);
  const slug = identifier(ref.slug);
  if (!apiId && !slug) return missing;
  const rows = orderedRefs.map((value, index) => ({ ref: refOf(value), index }))
    .filter(row => planOf(row.ref) === plan);
  const result = matches => matches.length === 1
    ? { index: matches[0].index, ambiguous: false }
    : { index: -1, ambiguous: matches.length > 1 };
  if (apiId) {
    const exact = rows.filter(row => identifier(row.ref.apiId) === apiId);
    if (exact.length) return result(exact);
  }
  if (!slug) return missing;
  const aliases = rows.filter(row => row.ref.slug === slug && (!apiId || !identifier(row.ref.apiId)));
  return result(aliases);
}

function findProblemIndex(orderedRefs, currentRef) {
  return locateProblem(orderedRefs, currentRef).index;
}

function navigationTargets(orderedRefs, currentRef, { selectedPlanId } = {}) {
  const none = { previous: undefined, next: undefined, nextUnsolved: undefined, index: -1 };
  if (!Array.isArray(orderedRefs)) return none;
  let plan = selectedPlanId;
  if (plan === undefined) {
    const plans = new Set(orderedRefs.map(value => planOf(refOf(value))).filter(value => value !== undefined));
    if (plans.size !== 1) return none;
    [plan] = plans;
  }
  if (typeof plan !== 'string') return none;
  const planRows = orderedRefs.map((value, index) => ({ value, ref: refOf(value), index }))
    .filter(row => planOf(row.ref) === plan && problemKey(row.ref) !== undefined);
  const apiCounts = new Map();
  const slugCounts = new Map();
  for (const row of planRows) {
    const apiId = identifier(row.ref.apiId);
    const slug = identifier(row.ref.slug);
    if (apiId) apiCounts.set(apiId, (apiCounts.get(apiId) || 0) + 1);
    if (slug) slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
  }
  // A destination must remain uniquely identifiable when it becomes current.
  // Quarantine ambiguous rows while retaining the service order of safe rows.
  const rows = planRows.filter(row => {
    const apiId = identifier(row.ref.apiId);
    return apiId ? apiCounts.get(apiId) === 1 : slugCounts.get(row.ref.slug) === 1;
  });
  const current = planOf(refOf(currentRef)) === plan ? locateProblem(orderedRefs, currentRef) : { index: -1, ambiguous: false };
  if (current.ambiguous) return none;
  const index = current.index;
  const position = rows.findIndex(row => row.index === index);
  const following = rows.filter(row => row.index > index);
  return {
    previous: plan && position > 0 ? rows[position - 1].value : undefined,
    next: plan && position >= 0 ? rows[position + 1]?.value : undefined,
    nextUnsolved: following.find(row => row.ref.solved === false)?.value,
    index,
  };
}

// Keep the existing generated-file metadata format without loading VS Code.
function normalizedMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.slug !== 'string' || !SLUG.test(value.slug)) return undefined;
  const ref = { slug: value.slug };
  if (value.apiId != null) {
    if (typeof value.apiId !== 'string' || !SLUG.test(value.apiId)) return undefined;
    ref.apiId = value.apiId;
  }
  if (value.planId != null && value.planId !== '') {
    if (typeof value.planId !== 'string' || !SLUG.test(value.planId)) return undefined;
    ref.planId = value.planId;
  }
  if (typeof value.technology === 'string') ref.technology = value.technology.slice(0, 80);
  return ref;
}

function recognizedSolution(document, { readRef } = {}) {
  try {
    const uri = document && document.uri;
    if (!uri || uri.scheme !== 'file' || typeof document.getText !== 'function') return undefined;
    const filePath = typeof uri.path === 'string' ? uri.path : uri.fsPath;
    if (typeof filePath !== 'string' || !/\.py$/i.test(filePath)) return undefined;
    const text = document.getText();
    if (typeof text !== 'string') return undefined;
    const header = text.split('\n').slice(0, 8).join('\n');
    const match = header.match(METADATA);
    if (!match) return undefined;
    const metadata = JSON.parse(match[1]);
    if (!normalizedMetadata(metadata) || NON_PYTHON.test(metadata.planId || '') ||
        (typeof metadata.technology === 'string' && NON_PYTHON.test(metadata.technology))) return undefined;
    const ref = normalizedMetadata(typeof readRef === 'function' ? readRef(header) : metadata);
    if (!ref || NON_PYTHON.test(ref.planId || '') || NON_PYTHON.test(ref.technology || '')) return undefined;
    return ref;
  } catch (_) {
    return undefined;
  }
}

module.exports = { problemKey, findProblemIndex, navigationTargets, recognizedSolution };
