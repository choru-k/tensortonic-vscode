# Saved-session HTTPS architecture

Production uses explicitly consented TensorTonic session scope in VS Code
SecretStorage and fixed extension-host HTTPS routes. Optional browser tabs have
independent presentation lifetimes; no open tab is required for saved HTTP access.

## Fixed production policy

`src/session/tensortonic.js` selects only
`__Secure-better-auth.session_token`, Domain `tensortonic.com`, Path `/`, domain
cookie semantics, Secure, HttpOnly and SameSite=Lax. This fixed minimum scope
requires explicit acquisition consent and matching attributes.
The production vault uses a new stable `saved-session-v1` directory and never
migrates experiment storage. Acquisition reads only the exact API `/api/me` URL.

After local consent, an owned canonical www page supplies the selected cookie.
Other applicable per-URL cookies may enter protocol memory, then are discarded
before storage. Top-frame ownership and the exact API source are checked around
the response. No global cookie enumeration, OAuth-provider cookies, profile files,
passwords or browser storage are collected. [Acquisition details](session-acquisition.md).

## Retention follows the server

Production uses a server-expiry jar record (version 2). Each retained cookie must
be persistent and have a finite explicit expiry. Restore preserves that timestamp;
it does not create a new lease. A genuine signed-session Set-Cookie may renew or
shorten its expiry. Max-Age takes precedence over Expires. Deletion, expiry,
required-cookie loss or HTTP 401 invalidates local access. No OAuth refresh flow,
background keep-alive or login-lifetime promise is manufactured.

The previous 24-hour cap came from the bounded synthetic foundation, not a server
rule. It would force unnecessary reconnects and is removed from production.
A session-only cookie with no explicit expiry is refused for durable storage;
it is not assigned 30 days. Separate bounded mock policies still cap their own
explicitly consented test lifetime. Server-controlled retention does not mean
indefinite valid access: revocation may occur before the cookie timestamp.

## Storage and concurrency

Cookie values and attributes live only in native SecretStorage. Each write uses
an immutable UUID generation. The private local index stores only schema version,
shared revocation epoch, active opaque key and pending cleanup references. SQLite
contains only a coordination row, never credentials. No plaintext/globalState
fallback or secret log is used.

An OS-backed SQLite transaction serializes requests, rotation, imports and Clear
across windows sharing the vault. Acquisition captures the shared epoch before
cookie capture and checks it under the mutex before atomic import. Another
window's successful Clear fences late capture. Native provider calls are bounded
and cancellable; the HTTP deadline starts before the secure read. Immutable keys
prevent late stores or a dead caller from reactivating a cleared/older generation.

Clear removes the active pointer before attempting provider deletion. Unknown
late-provider completion retains an opaque cleanup reference and truthful pending
state. Failed post-import tab closure retains its owner: Stop, Clear and Dispose
retry it independently. A committed rotation with old-entry deletion failure is
`ROTATION_CLEANUP_PENDING`, distinct from Clear's invalidated active session.
Transient Stop/Dispose preserves the authorized saved session; Clear deletes it.
No server logout/revoke or ordinary browser-cookie deletion is performed.

## HTTP boundary and user flow

Node HTTPS uses normal certificate verification and exactly
`https://api.tensortonic.com`. The existing narrow catalogue/study-plan/problem
read routes plus `/api/me` are allowed. HTTP, userinfo, alternate origins/ports,
path traversal, caller-supplied headers and arbitrary routes are refused.
Redirects are not followed, so credentials cannot reach an external destination.
Bodies, responses and duration are bounded; errors use fixed safe messages.

Startup restores encrypted availability only, with no browser, HTTP or login.
Explicit Connect verifies the account after acquisition-tab cleanup. Diagnostics
verify an already stored session without importing another one, then read a
catalogue and existing problem through the safe facade. They are cancellable and
do not change study files/selection. Optional Web presentation owns a separate
browser lifecycle; the HTTP jar does not depend on it.

The activation API exports no SecretStorage, vault, raw transport/client or CDP
handle. Safe status contains only booleans. Account payloads are validated inside
the bridge and never logged or returned through diagnostic summaries.

## Grading and rollout

Production enables only the four existing Python Run/Submit routes and payloads
listed in [API contracts](api.md). The fixed contract sends JSON to the exact API
origin using the consented session. It does not fabricate browser Origin,
Referer or Sec-Fetch metadata, add a guessed CSRF token, copy additional cookies,
or bypass server rejection. Public frontend behavior is evidence of client
request shape, **not proof that the server accepts direct HTTPS grading**.

Every action is explicit and dispatched at most once. Cancellation before dispatch
sends nothing; cancellation, timeout, connection loss or invalid response after
dispatch is an uncertain outcome. Check the website before choosing another
submission. There is no automatic retry, browser fallback or mutation during
session restore. The UI exposes cancellation but cannot retract server work.

Automated tests use synthetic sessions and dispatchers. A successful read does not
prove POST compatibility. If the server requires additional security behavior,
inspect its legitimate contract; never invent metadata or weaken checks.

## Primary references

- [VS Code SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265)
- [Node HTTP/HTTPS response API](https://nodejs.org/api/http.html)
- [Better Auth cookies](https://better-auth.com/docs/concepts/cookies)

Framework documentation explains mechanisms; it is not evidence of unobserved
TensorTonic settings or grading compatibility.
