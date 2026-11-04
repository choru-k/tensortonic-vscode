# Contributing

## Language and scope

Maintain this public repository in English: documentation, maintained UI text, code comments, and test descriptions. Preserve TensorTonic's original problem content, proper names, intentional multilingual fixtures, and user-authored solutions or notes.

The extension is unofficial and supports Python free and study-plan problems.
Use synthetic credentials and fixtures during development. Real account access,
local installation and publication need their applicable explicit authorization.
Never infer cookie scope, server security behavior or permission to grade from
framework defaults or an earlier unrelated test. Preserve installed profiles,
settings, study files and unsaved work.

Keep the exact route/cookie scope, encrypted SecretStorage boundary, shared revocation fence and no-replay rule. Test drivers must stay outside the production package. Optional Web presentation continues to use only its owned browser page through the proposed `browser` API; do not reintroduce a debugger or companion, access unrelated tabs, or change global browser/security settings. Never log or put real authentication material in plaintext storage, globalState, reports or packages.

## Checks before submitting a change

The extension build requires no external npm packages. From the repository root:

```sh
npm test
npm run test:session
npm run test:transport
python3 scripts/package.py
```

Keep unit/simulated proposed-browser-API coverage distinct from actual native-host verification. Read [session validation and gates](docs/session-http.md) and [native-browser validation boundaries](docs/native-browser.md#validation) before running a host check; use a separate review workspace. A passing mock is not proof of real login, managed-policy compatibility, or rendered UI behavior.

The package builder uses an explicit source allowlist. Rebuild after changing packaged files, check archive integrity, and verify byte-for-byte source parity. Never include pairing credentials from historical work, browser data, cookies, private solutions, account payloads, runtime logs, or personal test reports in commits or release packages. Old release artifacts belong to Git history rather than the current release tree; retain only the intended current deliverables.

## Safety requirements

- The browser path must not call `debug.startDebugging`, launch a debug adapter, adopt unrelated user tabs, or touch unrelated debugger sessions. An automation indicator may remain; do not bypass host safeguards to hide it.
- Proposed-API activation is an explicit per-extension startup opt-in and full restart on a supporting host. Never patch `product.json`, spoof built-in extension identity, add blanket enablement/security flags, or silently modify the user's launch/runtime configuration. Document API instability and personal VSIX distribution limits.
- Preserve unsaved solutions, existing tests, protected Markdown notes, and normal development workspaces across Markdown/Web changes and study navigation.
- Run/Submit requests must remain explicit and at-most-once. An uncertain result is not permission to retry, change transports, or submit a placeholder.
- Python setup/repair must remain explicitly confirmed, cancellable, constrained to extension-owned environments and fixed reputable package sources. Do not install on activation or overwrite unrelated `.venv` folders/settings.
- Unsupported hosts should receive actionable update/enablement guidance, never policy bypass instructions or a silently restored legacy fallback.

## Live testing

A native account diagnostic requires explicit permission for the target host/session
and an already active, connected extension whose version matches the checkout.
The optional `test/vscode-native-readonly-validation.js` runner is gated by
`TENSORTONIC_TEST_ALLOW_REAL_READ=1`. It invokes only the separate
`diagnoseStoredSession` activation-facade method. It does not activate, restore,
reconnect, call `smokeTest`, import or clear credentials, open/close browser pages,
change solutions, or grade. An inactive extension or missing diagnostic API blocks
rather than falling back to the ordinary session lifecycle.

The diagnostic performs at most one fixed `/api/me` GET through a separate path.
It does not write the local index or SecretStorage, collect old credentials, or
save response cookies. Invalid/expired local records, authentication rejection,
changed account schemas and cookie rotation are reported without clearing local
state. Pending work, cleanup and owned resources block the check. Snapshot and
session-generation changes invalidate the result. These are optimistic snapshot
checks, not an atomic cross-process revocation lock: another process can change
or clear the session after the final check but before the single GET is sent.
A detected change after dispatch prevents a verified result, but cannot unsend
that request. No lock file is created merely to diagnose. Only bounded enums,
booleans and a zero-or-one request count leave the API; account payloads and
credential values do not.

A GET can still have server-side effects. In particular, the service may rotate
its session independently. Any Set-Cookie response is reported as unverified and
is not adopted. Local non-mutation is not a promise that the remote account/session
cannot change. Do not replay a diagnostic automatically. This checks account
recognition only, not problem access, grading, session persistence or rendered UI.
No browser proposal is needed for this direct HTTPS diagnosis.


Real Run/Submit verification needs separate authorization for the exact existing solution and action. Never automatically repeat a Submit whose outcome is uncertain. Keep account-specific evidence out of the package, and never describe Agent-composer attachment checks as proof of an actual Agent response.

Explain what changed, which checks actually ran, and what remains unverified. Keep new pull requests in draft unless explicitly directed otherwise. Publication, installation, and real account actions require their applicable authorization; a local build alone is not a completed release or live validation.

## Retention and rollout boundary

Production follows explicit persistent cookie expiry and genuine server Set-Cookie renewal. Do not impose a daily cutoff, invent a monthly lifetime for session-only cookies, extend an issued expiry on restore, or manufacture OAuth refresh behavior. Bounded mock-cookie policies remain separate. Changed cookie metadata must fail closed rather than broaden acquisition.

Keep installations coordinated with the user. A package build alone is not permission to replace a working plugin. Native read helpers use only the safe activation facade and never import or clear a session themselves. Do not use --extensionTestsPath to claim persistence on a host that forces test storage in memory.
