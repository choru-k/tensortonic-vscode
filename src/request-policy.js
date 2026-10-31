'use strict';

const ORIGINS = new Set(['https://www.tensortonic.com', 'https://tensortonic.com']);
const SLUG = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';

// The bridge cannot call arbitrary URLs, account settings, billing, or solutions.
function isAllowedRequest(apiPath, method = 'GET') {
  if (typeof apiPath !== 'string' || apiPath.length > 1000 || /[\\#%]/.test(apiPath)) return false;
  const url = new URL(apiPath, 'https://api.tensortonic.com');
  if (url.origin !== 'https://api.tensortonic.com' || !apiPath.startsWith('/api/')) return false;
  if (method === 'GET') {
    if (url.pathname === '/api/problems/list') {
      return [...url.searchParams].every(([k, v]) =>
        ['page', 'limit'].includes(k) ? /^\d{1,4}$/.test(v) : k === 'planId' && new RegExp(`^${SLUG}$`).test(v));
    }
    if (url.search) return false;
    return new RegExp(`^/api/(?:study-plans(?:/${SLUG}(?:/problems/${SLUG})?)?|problems/${SLUG})$`).test(url.pathname);
  }
  return method === 'POST' && !url.search && new RegExp(`^/api/(?:study-plans/${SLUG}/problems/${SLUG}/(?:run|submit)|problems/${SLUG}/(?:run-cases|submit))$`).test(url.pathname);
}

function validateBody(body, apiPath) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.code !== 'string') return false;
  if (Buffer.byteLength(body.code) > 512 * 1024) return false;
  const run = /\/(?:run|run-cases)$/.test(apiPath);
  const keys = run ? ['code', 'testCases', 'problemType'] : ['code', 'problemType'];
  return Object.keys(body).every(k => keys.includes(k)) &&
    (!run || Array.isArray(body.testCases)) &&
    (body.problemType == null || body.problemType === 'free');
}

module.exports = { ORIGINS, isAllowedRequest, validateBody };
