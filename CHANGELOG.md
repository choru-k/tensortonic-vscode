# Changelog

## 0.8.1

- Send native connection guidance to the TensorTonic output channel instead of a notification that can pause the integrated browser during login. Keep pre-launch consent, cancellable progress, and existing status-bar feedback.
- No authentication, browser-storage, request, or grading behavior changes.

## 0.8.0 (native-browser release candidate)

- Add an explicit built-in browser connection using only an owned editor-browser debugger tree; no cookie/token extraction, pairing codes, or companion is required in native mode.
- Add bounded large-JSON result transport, strict endpoint/body allowlists, owned-session cleanup and exactly-once grading without automatic retries or fallback.
- Route Web presentation through the owned study browser while preserving dirty solutions, Python environments, and explicit Markdown descriptions.
- Keep the legacy companion and 30-day pairing as an explicit selectable fallback until actual installed-candidate feature parity is verified.
- Include a separately authorized read-only native-host validation runner; no real account submission or automatic companion removal is part of installation.


## 0.7.0 (local release candidate)

- Offer dedicated per-study-folder Python environment setup after explicit Start/setup consent, using installed supported runtimes and fixed torch/numpy packages in extension-owned storage.
- Select and verify the interpreter through Microsoft's scoped Python API; never overwrite global Python or existing project .venv/settings. Add cancellable setup and explicit repair commands.
- Add `tensortonic.problemView` and a discoverable Markdown/Web choice. Explicit problem navigation respects the preference, preserves dirty solutions, and safely reuses original native-browser pages when possible.
- Retain 0.6.0's fixed 30-day remembered browser pairing and companion 0.2.0.


## 0.6.0 (local release candidate)

- Remember explicitly paired browser access for an absolute 30 days using VS Code SecretStorage and extension-owned browser storage; never store website passwords or cookies.
- Restore the same workspace's loopback listener after editor restart; reconnect after tab refresh, browser restart, sleep, or transient connection loss when a signed-in TensorTonic tab is available.
- Keep two-minute single-use setup tickets. Require companion 0.2.0 with storage and optional exact TensorTonic site access; do not request arbitrary sites, API-origin, or loopback host permissions.
- Revoke remembered access on explicit Disconnect, fail closed at expiry, isolate multiple study windows, and never replay an uncertain Run or Submit.
- Add regression coverage for persistence races, stale window ownership, expiry during requests, failed secure storage, and duplicate browser sessions.


## 0.5.0

- Make Interactive explanation open the original TensorTonic page in VS Code’s native Integrated Browser, with feature detection and canonical URL reuse filtering without wildcards. No per-problem visualization implementation is needed for this path.
- Keep original independent cards under a clearly separate Offline learning exploration command/sidebar action.
- Preserve the external-browser action; unavailable/failed native dispatch offers an explicit external choice, never silently falls back or changes security settings.
- Keep sign-in user-owned and separate from the existing external companion session; do not transfer cookies or promise authenticated rendering.
- Do not automatically open or navigate native pages on startup, refresh, problem open, or Previous/Next.


## 0.4.0

- Add 30 independently authored, bounded local PyTorch basics explorations with editable controls, numerical tables/plots, softmax rows and a neural-network architecture diagram.
- Add explicit solution CodeLens, sidebar context action and command; preserve native statement rendering and the 0.3.2 study-window workflow.
- Use nonce-only scripted webview isolation with no network, account content, or automatic grading. Unknown problems explicitly report unsupported coverage.
- Add numerical, DOM-mock, security and lifecycle tests; native visual verification remains uncompleted.


## 0.3.2

- Add Start studying with an explicitly chosen, remembered local folder and a separate VS Code window; reuse the current single-folder study window and preserve development workspaces/unsaved edits.
- Add Start studying in another folder without migrating files or changing existing operations in other windows. A short-lived, best-effort startup handoff can focus the study sidebar but never opens windows by itself.
- Organize the TensorTonic sidebar as study plan → original sections → clickable problems, with solved counts and checkmarks.
- Mark the selected solution as Current and reveal it only in an already-visible sidebar without stealing editor/Agent focus. Serialize overlapping reveals and ignore stale tree snapshots.
- Add an explicit Show study plan sidebar command; preserve Explorer, existing files, unsaved edits, and layout settings.
- Retain sanitized plan/section names and stable section IDs from verified plan metadata; keep free problems available without invented sections.
- Cover section structure, completion, identity collisions, selection/refresh races, unavailable/loading/empty states, and navigation preservation with regression tests.

## 0.3.1

- Follow the website's study-plan section/problem sort order, joining catalogue progress and API identifiers without hardcoded curricula.
- Add Previous/Next study-plan commands and CodeLens using the active solution's plan, with non-wrapping boundaries, stale-request protection, and preservation of local edits.
- Replace raw Run/Submit JSON with a clear outcome, reported test counts and runtime, expandable individual test results, and optional collapsed debug JSON.
- Show grading-request failures in the results panel without claiming a failed submission or retrying an uncertain request.
- Activate the built-in Markdown preview before checking command availability, avoiding raw headings and math in the plain-text fallback on first problem open.
- Clearly identify degraded plain-text previews, keep their script-disabled CSP, and remove the old fallback panel when native preview becomes available.
- Cover activation, preview failures, stale navigation, native Markdown/math rendering, and preservation of sanitized content with regression checks.
- Clarify that solved checkmarks do not import earlier website submissions; newly created solution files use starter code and existing local files are preserved.

## 0.3.0

- Replace console pasting with a separate Manifest V3 browser companion popup. It uses only the `activeTab` and `scripting` permissions; browser installation requires separate user approval.
- Add two-minute, single-use pairing codes, host/origin/session validation, and rejection of reused codes and excessive attempts. Login cookies are never copied or stored.
- Copy pairing codes to the clipboard only through the explicit Copy action; keep them out of documents and logs.
- Fix a startup race where disconnecting could prevent a later reconnection.
- Prevent stale problem-list and problem-open responses from overwriting the latest selection.
- Keep Agent context aligned with the reselected solution tab, and update only the explicitly requested solution's document for Description.
- Lock the entire Run/Submit command against duplicate execution; cancel transmission if the connection changes while reading inputs.
- Add real loopback HTTP integration tests and safe, simulated grading checks in a real VS Code host.
- Standardize repository documentation, companion UI, Agent prompts, and test instructions in English while preserving upstream problem content and intentional multilingual fixtures.

## 0.2.1

- Open a separate test folder in the development host instead of reusing the parent window's folder.
- Add connection instructions, waiting status, and phase-by-phase reports for the live-account E2E test.
- Add timeouts to local connection requests and guidance for checking browser network permissions.
- Document extension activation and connection-wait observations from the actual Mac.

## 0.2.0

- Add Markdown problem statements and equation previews.
- Attach problem, solution, and test files together in Agent chat.
- Add a context tool for reading the current problem and unsaved editor code.
- Support an optional Codex file-attachment command.
- Preserve personal edits in generated problem files.
- Add a live-account E2E configuration and report for use in real VS Code.

## 0.1.0

- Browse TensorTonic Python problems and study plans in the sidebar.
- Open problem descriptions, local solution files, and editable JSON test cases.
- Use TensorTonic's grading service through Run/Submit CodeLens actions.
- Connect a signed-in browser tab while keeping login cookies in the browser.
- Build an installable VSIX without npm dependencies.
