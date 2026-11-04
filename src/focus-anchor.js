'use strict';
// Runs in the pinned document. Return only fixed diagnostic categories, never
// page text, URLs, query values or attributes. Acceptance matches the existing
// reviewed anchor contract; a reason never qualifies for readiness retry.
function focusAnchorFailure(element, expected, origin) {
  if (element.tagName.toLowerCase() !== expected.tag) return 'anchor-tag';
  if ((element.textContent || '').replace(/\s+/g, '') !== expected.text) return 'anchor-text';
  if ((element.getAttribute('title') || '') !== expected.title) return 'anchor-title';
  if (expected.href !== 'owned-problem') return 'anchor-contract';
  const href = element.getAttribute('href');
  // These two diagnostic categories remain rejected by the original URL rules.
  if (href === null || href === '') return 'href-missing';
  if (href === '#') return 'href-placeholder';
  let url;
  try { url = new URL(href, origin); } catch (_) { return 'href-parse'; }
  if (url.origin !== 'https://www.tensortonic.com') return 'href-origin';
  if (url.username || url.password) return 'href-credentials';
  if (url.hash) return 'href-fragment';
  if (!/^\/problems\/[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(url.pathname)) return url.pathname.startsWith('/study-plans/') ? 'href-study-plan-path' : 'href-path';
  if (url.searchParams.getAll('studyPlan').length > 1 ||
      ![...url.searchParams].every(([key, value]) => key === 'studyPlan' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(value))) return 'href-query';
  return null;
}
module.exports = { focusAnchorFailure };
