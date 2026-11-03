'use strict';

const MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'The saved session is missing, expired, deleted or revoked. Sign in again explicitly.',
  SESSION_SCOPE_UNVERIFIED: 'The session acquisition scope is unavailable or outside the verified policy. No broader cookie scope was used.',
  ACCOUNT_SCHEMA_UNVERIFIED: 'The account response changed. The local session was cleared; compatibility must be reviewed before reconnecting.',
  CONSENT_REQUIRED: 'Explicit confirmation is required before saving a session.',
  COOKIE_POLICY: 'Session cookie metadata does not satisfy the approved scope.',
  STORAGE_UNAVAILABLE: 'Secure session storage is unavailable. No credential was written to a plaintext fallback.',
  STORAGE_TIMEOUT: 'The secure-storage provider did not finish in time. No credential operation or HTTP request was replayed.',
  ACQUISITION_FENCE_REQUIRED: 'Begin a new explicitly confirmed sign-in attempt before importing a session.',
  ACQUISITION_FAILED: 'The owned login-page session could not be acquired. No credential was logged or sent to another origin.',
  ACQUISITION_PAGE_CHANGED: 'The owned login page is outside the approved return URL. No session was imported.',
  ACQUISITION_CLEANUP_PENDING: 'Owned login-page cleanup is incomplete. Close only that page before starting another acquisition.',
  STORAGE_BUSY: 'Another window is using the session. Nothing was sent or replayed.',
  STORAGE_CLEANUP_PENDING: 'The active session is cleared locally, but retired encrypted-entry deletion is incomplete or uncertain. No retired generation can become active again.',
  ROTATION_CLEANUP_PENDING: 'A newer saved session is active, but retired encrypted-entry cleanup is incomplete. No request was replayed.',
  DISPLAY_CLEANUP_PENDING: 'Optional browser-page cleanup is incomplete; close only the owned page. Credential cleanup is reported separately. Server sessions on other devices were not revoked.',
  UNSUPPORTED: 'The request is outside the approved HTTPS origin, route or method.',
  POST_CONTRACT_UNVERIFIED: 'Run and Submit are unavailable in this read-only candidate until grading compatibility is verified. No code was sent.',
  CANCELED: 'The operation was canceled before a confirmed result.',
  TIMEOUT: 'The request timed out. No request was replayed.',
  TRANSPORT_ERROR: 'The HTTPS request failed. No request was replayed.',
  HTTP_ERROR: 'The service rejected the request. No request was replayed.',
  REDIRECT_REFUSED: 'The service redirected the request. No redirect was followed or credential forwarded.',
  INVALID_RESPONSE: 'The service returned an invalid or oversized response.',
  UNCERTAIN_RESULT: 'The Run/Submit outcome is uncertain. Check the website before explicitly trying again; it was not replayed.',
});
function fault(code) {
  const error = new Error(MESSAGES[code] || MESSAGES.TRANSPORT_ERROR);
  error.code = Object.hasOwn(MESSAGES, code) ? code : 'TRANSPORT_ERROR';
  return error;
}
module.exports = { fault };
