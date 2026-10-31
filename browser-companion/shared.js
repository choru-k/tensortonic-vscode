'use strict';

(function installShared(root) {
  const ORIGINS = new Set(['https://www.tensortonic.com', 'https://tensortonic.com']);

  function isTensorTonicPage(url) {
    try {
      const parsed = new URL(url);
      return ORIGINS.has(parsed.origin) && !parsed.username && !parsed.password;
    } catch (_) { return false; }
  }

  function parseTicket(value) {
    if (typeof value !== 'string' || value.length > 96) throw new Error('INVALID_TICKET');
    const match = value.trim().match(/^TT1:([1-9][0-9]{0,4}):([a-f0-9]{32})$/);
    if (!match || Number(match[1]) > 65535) throw new Error('INVALID_TICKET');
    return { base: `http://127.0.0.1:${match[1]}`, pairingKey: match[2] };
  }

  function validateConnection(value, base) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !['base,token', 'base,expiresAt,resumeKey,token'].includes(Object.keys(value).sort().join(',')) || value.base !== base ||
        typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) {
      throw new Error('INVALID_PAIRING_RESPONSE');
    }
    if ('resumeKey' in value) {
      const record = validateRecord({ base, resumeKey: value.resumeKey, expiresAt: value.expiresAt });
      return { ...record, token: value.token };
    }
    return { base, token: value.token };
  }

  function validateRecord(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'base,expiresAt,resumeKey' ||
        typeof value.base !== 'string' || !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(value.base) ||
        Number(new URL(value.base).port) > 65535 ||
        typeof value.resumeKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.resumeKey) ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 30 * 86400000) {
      throw new Error('INVALID_REMEMBERED_PAIRING');
    }
    return { base: value.base, resumeKey: value.resumeKey, expiresAt: value.expiresAt };
  }

  const api = Object.freeze({ isTensorTonicPage, parseTicket, validateConnection, validateRecord });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.TensorTonicCompanionShared) {
    Object.defineProperty(root, 'TensorTonicCompanionShared', { value: api });
  }
})(globalThis);
