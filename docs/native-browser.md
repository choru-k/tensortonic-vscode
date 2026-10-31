# Native built-in browser connection (0.9.0)

Version **0.9.0 is native-only**. Connect uses VS Code's Integrated Browser and built-in JavaScript debugger; no browser companion, pairing code, Legacy selector, or alternate transport is included. Existing companion installations are not automatically removed. Earlier versions remain in Git history, not the current release tree.

Use a **trusted local VS Code desktop** with these APIs available and the built-in debugger enabled. Native 0.8.0 was validated on **VS Code 1.144.0 / JavaScript debugger 1.140.0**. If an older host cannot provide the native route, update VS Code normally and enable the built-in debugger. Browser/remote workspaces and alternative editors without these APIs are unsupported. Do not weaken policy, permissions, or trust controls to force a connection.

## Connect and sign in

1. Run **TensorTonic: Connect browser** in the study window.
2. Review **Connect built-in browser**. It opens a dedicated TensorTonic page and attaches only the unique debug-session tree created by this extension.
3. Sign in normally on that page. No password, cookie, local-storage value, session token, or Authorization header is extracted or copied.
4. Use **Refresh problems** or Connect again after login. Connected transport does not prove website login, subscription entitlement, or an individual API request will succeed.

Ordinary activation and editor restart never launch or attach a browser automatically. Use Connect again. Website authentication can expire independently; complete normal login and explicitly retry only the desired action. No authentication automation, security-policy change, or external-browser session transfer is performed.

Browser login persistence follows VS Code's existing `workbench.browser.dataStorage` setting and website session expiry. The extension does not change that storage scope or promise a fixed login lifetime. Connect can reuse a live owned session; after restart, a newly owned tab may reuse existing browser storage. See [official session-storage documentation](https://code.visualstudio.com/docs/debugtest/integrated-browser#session-storage).

## Local editor and original web page

Catalog reads, study plans, descriptions, and explicit local-editor Run/Submit use narrowly allowlisted TensorTonic requests from the owned page with normal browser credentials. Account, billing, settings, arbitrary URLs, and reference-solution endpoints are not supported.

`tensortonic.problemView` defaults to `markdown`. Choose **Web** with **Choose problem view (Markdown / Web)** to make explicit problem opens and Previous/Next navigate the owned original page alongside the preserved Python editor. Only the expected TensorTonic study surface is reusable: account pages, external navigation, and login flows are not silently redirected. Changing the setting alone does not navigate. Native transport also works with Markdown presentation, and explicit **Description** stays Markdown.

Dirty local solutions, existing tests, protected notes, and dedicated Python environments remain unchanged. The original page's own editor and actions are distinct from this extension sending the current local file through Run/Submit. This is top-level navigation, not iframe embedding, copied site code, a proxy, or a header/CSP bypass.

## Scoped debugger presentation

The native transport needs a debugger session to communicate with its own page. Version 0.9.0 keeps that capability enabled while configuring **only the launch it owns**:

- `sourceMaps: false` and `pauseForSourceMap: false` disable source-mapped stepping/pauses. `resolveSourceMapLocations: ['!**']` additionally excludes normal file/URL source-map loading for the owned session; the debugger may retain internal exceptions. This avoids treating stepping suppression alone as a guarantee that no map metadata will be loaded.
- `internalConsoleOptions: 'neverOpen'` requests that its Debug Console not open automatically.
- Root-launch options request suppression of the debug toolbar, debug status bar, and debug view, and suppress save-before-start so unsaved work is not forced to disk. These presentation requests are best-effort: the host does not propagate every root option to its child JavaScript debug session, so a child toolbar or status indication can remain. This release does not promise that all debugger chrome is hidden.

Source-map and console configuration propagates to the owned child adapter; root toolbar/status/view requests have the limitation above. These are per-session launch values—not global settings, changes to user launch configurations, or modifications to unrelated debuggers. They do not change website authentication, browser storage, subscription access, or the request allowlist. The actual 0.9.0 UI result is pending its separately coordinated read-only host check; a configuration value alone is not proof of rendered UI behavior.

## Safety and failure behavior

- Operations are serialized. A new action is rejected as busy rather than queueing or replaying grading. Navigation cannot interrupt an in-flight grading request.
- A Run/Submit is dispatched at most once. Timeout/cancellation can leave the outcome uncertain: inspect the website before explicitly trying again. No automatic POST retry or transport switch occurs.
- Responses use an 8 MiB byte limit. Bounded encoded chunks are read through the debug adapter; truncation triggers smaller reads of the existing result, never another HTTP request. Invalid lengths, encoding, and JSON fail closed.
- Transient request data is removed after use or cancellation. Debugger errors, browser globals, and authentication material are not logged.
- Only the uniquely named owned root and exact descendants qualify. Existing user debugger sessions are never attached, stopped, or used as fallback targets. Multiple matching owned pages fail closed.
- Disconnect stops the owned connection, not unrelated debuggers. It does not sign out or erase browser cookies. Unconfirmed cleanup is reported and silent reuse refused; use the owned session's normal Stop control when instructed.
- An unavailable native browser/debugger route produces actionable upgrade/enablement guidance. No legacy fallback, browser-extension installation, or policy bypass is attempted.

## Validation

Cloud tests simulate the debug adapter and page realm. They cover bounded Unicode JSON, chunk truncation, API allowlists, exactly-once dispatch, cancellation, launch cleanup, session ownership, navigation races, and session-scoped debugger options. They do not establish real account login, OS/browser UI, website grading, or every host/platform combination.

Native **0.8.0** passed actual Mac checks on VS Code **1.144.0**: connection, a 30-problem list, full JSON retrieval, Markdown, dirty temporary-solution preservation, five Web navigations, cancellation, and reconnect. An explicitly approved existing solved solution was run once (3/3) and submitted once (43/43); both result views passed. No account or solution payload is distributed here. These are version-specific observations, not proof of dedicated Python installation or all subsequent changes.

Version **0.9.0** removes the old transport and adds scoped debugger-presentation settings. Automated results are recorded with the release checks. Its new native UI behavior awaits the separately authorized **read-only** check; no fresh live grading is implied or required for that check.

`test/vscode-native-readonly-validation.js` is an optional actual-host runner gated by `TENSORTONIC_TEST_ALLOW_REAL_READ=1`. Use it only with explicit authorization in a review workspace. It calls only the fixed read endpoints, writes a sanitized summary, and contains no Run/Submit. Normal user login may still be required. Real grading must be coordinated separately with an approved existing solution; never submit a starter placeholder or infer permission from a read-only test.
