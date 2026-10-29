# Linux VM hardening validation — 2026-10-29 UTC

This review ran on the assistant's Linux VM, not the user's Mac. It incorporates upstream commit `c2287d5` without replacing its changes. The historical 0.1.x and 0.2.x release VSIX files are preserved; the unpublished 0.3.0 and companion 0.1.0 artifacts are rebuilt from the final reviewed source. Validation evidence below separates the former console flow from the new companion flow.

## Baseline hardening checks (before companion implementation)

- Official Microsoft VS Code 1.144.0 x64, commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`, downloaded from Microsoft's stable update endpoint.
- VSIX archive integrity and source-file parity; actual CLI installation into a separate extensions directory/profile.
- Existing 0.2.0 smoke runner passed in the real Linux Extension Development Host: activation, disconnected state, and all 15 commands.
- `npm test`: 52 tests pass. V8 coverage: lines 87.16%, branches 77.57%, functions 83.58% (unit suite only; not proof of full behavior).
- `npm run test:transport`: 10 tests pass through a real TCP/HTTP loopback listener and the original connector. TensorTonic upstream requests are strictly simulated; no service/account changes occur.
- Real VS Code host integration: command registration, problem files and Markdown context, CodeLens, unsaved code/tests, simulated Run/Submit, duplicate-click rejection, malformed tests, preservation of learner files, correct explicit Description destination, A → B → A → chat context, language-model tool, Agent composer attachments, and disconnect.
- The earlier startup/disconnect regression now passes over real TCP, including 100 repeated startup/disconnect/reconnect cycles.

## Regressions addressed

1. Canceling startup could leave its promise pending forever and block reconnect.
2. An older catalogue refresh could overwrite the latest plan or clear a newer loading state.
3. A delayed problem-open response could restore an older selection.
4. Returning to an earlier solution tab was not remembered once Agent took focus.
5. Explicit Description for problem B could write B's context beside selected solution A.
6. Repeated grading commands could queue metadata requests and produce a second Submit after the first completed.
7. A command that read inputs across reconnect could send code through a different browser session.

Regression assertions are in `test/bridge.test.js` and `test/extension.test.js`. The connector's origin, capability-key, endpoint and request-body restrictions remain in place. No grading operation is automatically replayed.

## Former console flow: live-account boundary blocked, not passed

GitHub sign-in to TensorTonic succeeded in the VM's existing managed Chromium. The actual Code host opened a private pairing script. However, Chromium displayed: **“DevTools not allowed on this page. Your organization has blocked the use of DevTools on this page.”**

The browser pairing step therefore did not run. The host was closed, its temporary pairing file deleted, and no live Run or Submit was executed in this review. No alternate injection, unmanaged browser, policy modification, cookie export, or Mac fallback was used.

Actual browser CORS/local-network enforcement, live grading through the installed extension, and an Agent model's reply remain unverified. Prior live API observations in `validation.md` are separate historical evidence, not a successful browser-to-extension E2E result from this VM.

That console-paste limitation prompted the companion implementation below. The former failure is not presented as evidence that the new companion is installed or working in a real browser.

## Companion 0.1.0 + VS Code extension 0.3.0 validation

- `npm test`: 98 tests pass, including popup/controller, ticket validation, cancellation, stale responses and package permission/asset checks.
- `npm run test:transport`: 15 tests pass with actual TCP/HTTP, including single-use redemption, expiry/reissue, concurrent tabs, slow request bodies, exact Host/Origin checks, stale disconnect and acknowledgement flush.
- Actual official VS Code 1.144.0 loads the installed 0.3.0 internal VSIX. The original companion controller executes in a simulated browser realm and redeems a real one-use ticket over HTTP, followed by 14 host integration checks (final rebuilt-package run: 2026-10-29 17:45:54 UTC). The upstream API is fake; the report explicitly records `simulatedBrowser: true`, `mockedUpstream: true` and zero live service requests.
- The real popup HTML/CSS/JS was also opened as a clearly labeled local browser fixture with a mock Chrome API. This checks UI text, field clearing and button state, not installation or actual extension permissions.
- Independent code review found no remaining blocker in the reviewed pairing/companion code. Raw local-network exceptions are not printed because they may contain capability-bearing request URLs.
- Unit coverage for instrumented modules is 90.38% lines / 80.82% branches / 85.62% functions. Dynamically VM-evaluated scripts are exercised by tests but are not included in that coverage table.

**Not completed:** actual companion installation/activation in managed Chromium and live authenticated Run/Submit through it. The user explicitly approved installation, but the environment's browser automation URL policy blocked navigation to `chrome://extensions` because it permits only HTTP/HTTPS URLs. The installation did not execute. No alternate UI/CLI route, browser-policy change, authenticated-page injection, or Mac fallback was used to bypass the block. An Agent model reply and older VS Code versions are also unverified.

Both packages are built from explicit whitelists. The companion archive contains only nine reviewed source/license files and copies the canonical connector byte-for-byte. The VSIX contains only manifest/source/media/documentation/license files. No live pairing code, cookie, account credential, user solution, runtime log or test report is included.

## English-language release review

The 0.3.0/0.1.0 release candidates were updated before publication; no version bump was needed. README, changelog, contribution guidelines, companion UI, Agent prompts, and live-E2E instructions are maintained in English. Upstream problem text and learner input are preserved, including an intentional multilingual regression fixture.

- `npm test`: 100 tests pass, including English popup language/action labels and preservation of multilingual statements, code, and filenames.
- `npm run test:transport`: 15 tests pass with actual loopback HTTP and simulated upstream responses.
- The rebuilt VSIX installed successfully into a fresh VM-only profile. Its packaged runtime passed all 14 real VS Code 1.144.0 host checks on 2026-10-29 at 23:12:08 UTC. The report records `actualExtensionHost: true`, `actualLoopbackHttp: true`, `simulatedBrowser: true`, `mockedUpstream: true`, and `liveRequests: 0`.
- The English Agent draft and three attachments were also observed in the real host UI. No Agent message was sent; no model response was verified.
- Final archives were checked for integrity, explicit file allowlists, byte-for-byte source parity, and credential-like material. Historical release archives were not modified. The only remaining Korean text in maintained source is the documented multilingual test fixture, which is not packaged.

The installation-policy block above still prevents a live browser/companion E2E claim. Unit checks cover the translated popup; the earlier local popup screenshot was from before this language conversion, not a new installed-companion test.

## Reproduce without a live account

Node.js and Python are sufficient for unit/transport tests and packaging:

```sh
npm test
npm run test:transport
python3 scripts/package.py
python3 scripts/package_companion.py
```

On a Linux/macOS/Windows desktop capable of launching official VS Code, use a separate profile, extension directory, and fixture workspace. Do not run the mock and live runners interchangeably:

```sh
code --user-data-dir /tmp/tensortonic-review-profile \
  --extensions-dir /tmp/tensortonic-review-extensions \
  --extensionDevelopmentPath="$PWD" \
  --extensionTestsPath="$PWD/test/vscode-mock-integration.js" \
  "$PWD/test/workspace"
```

The mock runner writes `dist/vscode-mock-integration.json`, including the actual loaded extension path/version and exact completed checks. `test/vscode-smoke.js` writes `dist/vscode-smoke-result.json`. Use an otherwise unused fixture folder if you want a pristine first-open check. The tests do not send Agent messages or authenticate a model provider.

`test/vscode-e2e.js` is different: it requires a permitted signed-in browser and may run and submit a previously solved exercise. Read its authorization and account checks before using it. It was not completed in this review.
