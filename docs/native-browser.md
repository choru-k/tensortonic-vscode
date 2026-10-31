# Native built-in browser connection (0.8.1)

Built-in browser is the default connection mode; the companion is optional legacy fallback. Native 0.8.0 passed actual macOS validation on VS Code 1.144.0 / JavaScript debugger 1.140.0. Version 0.8.1 only moves post-connect guidance from a notification to Output so it does not pause the login page; the installed Mac runtime remains 0.8.0 until a separately coordinated upgrade.

## Connect and sign in

1. Run **TensorTonic: Connect browser** in a trusted local desktop study window.
2. Review **Connect built-in browser**. It opens a dedicated TensorTonic page through VS Code's Integrated Browser and attaches only the debug-session tree created by this extension.
3. Sign in normally in that page. No password, cookie, local-storage value, session token, or Authorization header is extracted or copied.
4. Use **Refresh problems** or **Connect browser** again after login. Native mode does not use setup/pairing codes and does not require the Chrome/Helium companion. Connection status means browser transport is available; a website login, subscription entitlement, or individual API request can still fail.

Ordinary activation and editor restart never launch or attach a browser automatically. Use Connect again. If normal login expires, finish login and explicitly retry the read/action you want. The extension does not automate authentication, change security policies, or transfer another browser's session.

## Local editor and original web page

The existing catalog, study plans, descriptions and explicit local-editor Run/Submit use narrowly allowlisted TensorTonic API requests from this owned browser page with the browser's normal credentials. Only supported problem browsing and grading endpoints are allowed. Account/billing/settings APIs and arbitrary URLs are not supported.

With `tensortonic.problemView` set to `web`, explicit problem opens/Previous/Next navigate the **owned** page alongside the preserved Python editor. The page must still be on the expected TensorTonic study surface; an account page, external navigation or login flow is not silently redirected. Dirty local solutions and dedicated Python environments remain unchanged. Explicit Description remains Markdown.

Changing the presentation setting alone does not navigate. Native transport remains usable with Markdown presentation. Reading the original page and using its own web editor is separate from sending the current local Python file via this extension's Run/Submit.

## Safety and failure behavior

- Native operations are serialized. A new action is rejected as busy rather than queueing/replaying grading. Browser navigation cannot interrupt an in-flight grading request.
- A Run/Submit dispatch happens at most once. Timeout/cancellation can leave its outcome uncertain; check the website before explicitly trying again. The extension never retries it or switches to the legacy companion automatically.
- Responses are streamed with an 8 MiB byte limit. Only bounded encoded chunks are read through the debug adapter; truncation causes smaller reads of the existing result, not another HTTP request. Invalid lengths/encoding/JSON fail closed.
- Transient request data is removed after use/cancellation. Debugger errors, browser globals and authentication material are not logged.
- Only the uniquely named root and its exact owned descendants are considered. Existing user debugger sessions are never attached, stopped or used as fallback targets. Multiple matching owned pages fail closed.
- Disconnect stops the owned connection, not unrelated debuggers. It does not sign you out or erase browser cookies. If debugger cleanup is unconfirmed, the extension reports it and refuses silent reuse; use the owned session's normal Stop control.
- Only trusted local desktop VS Code is supported. If the built-in browser/debugger route is unavailable, no policy or permission bypass is attempted.

## Legacy fallback and migration

Use **TensorTonic: Choose connection mode (Native / Legacy)** or set `tensortonic.connectionMode` to `browserCompanion` to explicitly return to the existing Chrome/Helium companion. Switching modes closes the previous owned transport and does not replay pending work. Legacy remembered-pairing credentials are preserved for fallback; explicit legacy Disconnect revokes them.

The legacy companion 0.2.0 and its 30-day pairing implementation remain included. They are not required for native mode, and remain available for older hosts. Remove an existing companion only after confirming native mode works in your own environment. No browser extension is uninstalled by this package.

## Validation

Cloud tests simulate the debug adapter and page realm and exercise real loopback legacy transport separately. They cover large Unicode JSON, chunk truncation, allowlists, exactly-once dispatch, cancellation, late launch/session cleanup, ownership and navigation races. They do not establish real website grading or actual OS/browser UI behavior.

`test/vscode-native-readonly-validation.js` is an optional actual-host runner gated by `TENSORTONIC_TEST_ALLOW_REAL_READ=1`. Use it only with explicit authorization in a review workspace. It performs only the two fixed read endpoints, writes a sanitized result summary, and does not contain Run/Submit. An authorized normal user login may be needed. Real Run/Submit parity must be coordinated separately with an approved already-solved local solution; never infer approval to submit a placeholder or an unrelated file.

## Release verification — 2026-10-31

- Cloud 0.8.1: 368 unit tests plus 16 transport integration tests passed (384 total); packaged source parity checked.
- Actual Mac 0.8.0: native connection, 30-problem list, full JSON retrieval, Markdown, dirty temporary solution preservation, five Web navigations, cancellation and reconnect passed.
- One explicitly approved existing solved solution was run once (3/3 tests) and submitted once (43/43 tests); both results views passed. No retry or legacy fallback occurred. No solution or account payload is distributed in this repository.
- 0.8.1 post-connect notification suppression has a unit regression; no additional live grading or 0.8.1 Mac upgrade was performed for this publication. Dedicated Python installation and other host/platform combinations are not implied by this native validation.

Browser login persistence follows VS Code’s existing `workbench.browser.dataStorage` setting and the website’s session expiry. The extension does not modify storage scope. Connect again can reuse its live owned session; after restart it opens a new owned tab, which may reuse persistent browser storage. See [official session storage documentation](https://code.visualstudio.com/docs/debugtest/integrated-browser#session-storage). No fixed login lifetime is promised.
