# Browser companion: no-console connection, architecture and verification

The canonical installation, permission, privacy and revocation details are in
[`browser-companion/README.md`](../browser-companion/README.md). Version 0.2.0
adds explicitly authorized, absolute 30-day remembered pairing to extension 0.6.0.
The old 0.1.0 design was memory-only and required re-pairing after tab refresh or
editor restart; those limitations do not describe 0.2.0.

## Components

- `shared.js`: exact HTTPS origins, bounded loopback ticket parsing, exact response
  shapes, 64-hex capability validation, and fixed absolute-expiry validation.
- `background.js`: trusted-only local storage; session tab-owner lease and
  reservation nonce; one remembered editor; ordered mutations; optional-origin
  dynamic isolated-script registration; non-secret popup summaries; durable
  revoke-only tombstones and global Disconnect.
- `companion.js`: top-frame isolated connector, in-memory transient capability,
  explicit pair, periodic resume while a permitted tab exists, expiry handling,
  and revocation delivery. Generation guards discard late asynchronous responses.
- `popup.js`: explicit user-gesture site permission request, short ticket input
  cleared after use, sanitized status, and Disconnect even without a website tab.
- `connector.js`: copied from canonical `src/browser-connector.js` at build time;
  no duplicate source is maintained in the companion folder.

## Security boundaries

Pairing tickets remain one-use and two minutes long. The durable resume secret is
not a website cookie or password, is never placed in the DOM, and is never returned
by popup status messages. Browser local storage is not a password vault. The
service worker and popup are trusted extension contexts; the code restricts raw
storage access from content scripts and returns only the one matching exact-origin
record to its own top-frame script. No externally connectable interface is enabled.

The editor must rotate ephemeral capabilities on resumed connections, refuse a
second active owner, enforce the original absolute expiry, and discard uncertain
pending Run/Submit work. Automatic reconnect does not authorize command replay.
The browser never searches for editors or sends credentials to another port.

One editor is remembered per browser profile. Closing an owning tab releases its
lease; stale ownership recovers after a bounded timeout. Browser and VS Code
Disconnect are distinct: browser Disconnect forgets locally immediately but
requires a permitted live tab to deliver server revocation. Offline revocations
remain as tombstones, not reconnectable records. Editor Disconnect revokes at the
server immediately. Account switching requires Disconnect because website requests
use the currently signed-in browser account.

## Checks

```sh
node --test test/companion.test.js test/companion-persistence.test.js
npm test
npm run test:transport
python3 scripts/package_companion.py
```

The package builder checks exact required and optional permissions, the expected
worker, the canonical connector, and an explicit file allowlist. It refuses
unexpected files and symlinked outputs.

Automated coverage includes ephemeral compatibility, expiry, malformed responses,
wrong origins and subframes, service-worker restart, browser restart/refresh,
competing tabs/windows, pending pairing cancellation, storage reservation
invalidation, stale resume completion, offline revoke-only recovery, and permission
removal. These simulations are not proof that a particular real browser's
permissions, managed policy, website session, or native VS Code UI works. Real
activation remains a user-reviewed installation step; do not submit live exercises
merely to test reconnection.
