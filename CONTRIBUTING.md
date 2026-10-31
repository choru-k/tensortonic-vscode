# Contributing

## Language and scope

Maintain this public repository in English: documentation, maintained UI text, code comments, and test descriptions. Preserve TensorTonic's original problem content, proper names, intentional multilingual fixtures, and user-authored solutions or notes.

The extension is unofficial and supports free Python problems and Python study-plan problems. Version 0.10.0 is a **personal experimental, native-only** build using the proposed `browser` API directly: preserve its owned browser-page boundary, normal website login, and narrow supported API allowlist. The manifest opts into proposal `browser`; the host must separately enable it for `choru-local.tensortonic-vscode`. Do not claim ordinary Marketplace compatibility for this proposed-API build. Do not reintroduce a companion or legacy transport, extract authentication material, or change global debugger/browser/security settings.

## Checks before submitting a change

The extension build requires no external npm packages. From the repository root:

```sh
npm test
npm run test:transport
python3 scripts/package.py
```

Keep unit/simulated proposed-browser-API coverage distinct from actual native-host verification. Read [native-browser validation boundaries](docs/native-browser.md#validation) before running a host check; use a separate review workspace. A passing mock is not proof of real login, managed-policy compatibility, or rendered UI behavior.

The package builder uses an explicit source allowlist. Rebuild after changing packaged files, check archive integrity, and verify byte-for-byte source parity. Never include pairing credentials from historical work, browser data, cookies, private solutions, account payloads, runtime logs, or personal test reports in commits or release packages. Old release artifacts belong to Git history rather than the current release tree; retain only the intended current deliverables.

## Safety requirements

- The direct browser path must not call `debug.startDebugging`, launch a debug adapter, adopt unrelated user tabs, or touch unrelated debugger sessions. An automation indicator may remain; do not bypass host safeguards to hide it.
- Proposed-API activation is an explicit per-extension startup opt-in and full restart on a supporting host. Never patch `product.json`, spoof built-in extension identity, add blanket enablement/security flags, or silently modify the user's launch/runtime configuration. Document API instability and personal VSIX distribution limits.
- Preserve unsaved solutions, existing tests, protected Markdown notes, and normal development workspaces across Markdown/Web changes and study navigation.
- Run/Submit requests must remain explicit and at-most-once. An uncertain result is not permission to retry, change transports, or submit a placeholder.
- Python setup/repair must remain explicitly confirmed, cancellable, constrained to extension-owned environments and fixed reputable package sources. Do not install on activation or overwrite unrelated `.venv` folders/settings.
- Unsupported hosts should receive actionable update/enablement guidance, never policy bypass instructions or a silently restored legacy fallback.

## Live testing

A native read-only check requires explicit permission for the target host/session and normal user login. The optional `test/vscode-native-readonly-validation.js` runner is gated by `TENSORTONIC_TEST_ALLOW_REAL_READ=1`; it does not authorize or perform grading. The runner also requires the proposal to be enabled for this extension. Do not extend it to submit code merely to test reconnect, direct-API integration, or browser presentation.

Real Run/Submit verification needs separate authorization for the exact existing solution and action. Never automatically repeat a Submit whose outcome is uncertain. Keep account-specific evidence out of the package, and never describe Agent-composer attachment checks as proof of an actual Agent response.

Explain what changed, which checks actually ran, and what remains unverified. Keep new pull requests in draft unless explicitly directed otherwise. Publication, installation, and real account actions require their applicable authorization; a local build alone is not a completed release or live validation.
