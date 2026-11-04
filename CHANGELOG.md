# 0.12.13 (cloud candidate)

- Recover requested Focus after a verified new-document browser reload of the same owned tab and exact URL, following old-style cleanup and fresh readiness/contract proof.
- Require actual reload timing evidence and a prior successful application; never rearm same-document revoked guards or adopt unrelated navigation/tabs.
- Abort stale reload work on Off, new navigation, session/Markdown changes, close, unrelated active tab or observed URL departure. Keep late-write cleanup ownership.
- Preserve 0.12.12 read-only saved-session diagnostics. Not yet published, installed or native-validated.

# 0.12.12

- Add a separately invoked saved-session diagnostic using one fixed account GET without local session writes, clearing, reconnecting, cookie adoption or grading.
- Return only bounded diagnostic enums, booleans and a zero-or-one request count. Invalid local credentials, authentication failures, changed schemas and response cookie rotation do not mutate saved credentials.
- Require a trusted idle local session, reject owned browser resources, bound cancellation/timeouts, and invalidate observed concurrent changes.
- Replace the obsolete 0.10.0 native runner with an active-extension-only diagnostic runner. No activation, fallback or automatic replay occurs.
- Document server-side GET effects and the optimistic cross-process fence limit. This release is cloud-tested; native installation and real-account validation remain separate.

# 0.12.11 (cloud candidate)

- Accept the exact publicly verified Labs navbar link while requiring the complete known six- or seven-link set. Unknown/missing/duplicate links and security-sensitive changes still fail open.
- Revise the reviewed contract identifier; preserve all seven problem-control selectors and existing readiness/application/restoration behavior.
- The separate native missing-controls condition remains unresolved. This candidate is not published, installed or native-validated.

# 0.12.10 (cloud candidate)

- Address the observed post-spinner state where all seven problem controls are absent while the signed-in navbar passes verification. Only that exact incomplete state may wait read-only within the existing readiness deadline.
- Require two fresh complete proofs after controls appear; malformed, partial, extra-count or navbar/security rejection remains terminal. No CSS is applied during waiting.
- Keep exact-document pinning, cancellation, bounded timeout and single guarded application.
- Preserve precise readiness proof failure codes and stop labeling a discarded page as a URL mismatch.
- Cloud-tested candidate; not yet published, installed or confirmed on Mac.

# 0.12.9 (diagnostic-only cloud candidate)

- Add bounded local Focus attempt traces to identify the unresolved automatic carryover failure. No further readiness or selector fix is claimed.
- Record allowlisted stage/outcome/error-category and fixed contract-target labels only. No URL, problem/document identifiers, DOM text, credentials or raw error content is included.
- Keep latest automatic and manual traces in memory for comparison. Current automatic failures emit one bounded summary to the TensorTonic Output channel; there is no telemetry or extension file/storage write.
- Bind diagnostic callbacks to their originating controller operation and cleanup lease, so stale cleanup cannot contaminate a newer trace.
- Not yet published, installed or verified on Mac.

# 0.12.8 (cloud candidate)

- Wait read-only for initial document loading and reviewed TensorTonic navbar/problem loading placeholders before automatically carrying Focus to a new problem.
- Require two successful exact-document contract checks 200 ms apart before the existing single apply. Readiness is bounded to five seconds and canceled by Off, newer navigation or session changes.
- Unknown structure, security/menu rejection, changed document and failed full proof stop without retrying CSS. Existing fail-open observer and restoration remain unchanged.
- Not yet published, installed or validated on the native Mac UI.

# Changelog

## 0.12.7 (cloud-only candidate; not published or installed)

- Keep the session-only Focus preference across extension-opened Web problems. Restore the old page first, then independently verify the exact new owned destination before applying.
- Separate requested On from current application. Show On / Not applied or unavailable rather than a stale Applied claim when cleanup, navigation or proof fails. Off, session changes, shutdown and newer opens cancel stale work.
- Preserve conservative boundaries: browser refresh/manual navigation, Markdown, unrelated tabs and same-document opens do not automatically re-arm Focus. Extension reload/session change resets the preference. No durable setting is written.
- Cover delayed restoration, late writes, canceled page lookup, rejected structures and competing navigation in synthetic tests. Native UI remains unverified.

## 0.12.6 (cloud candidate; native visual check pending)

- Extend Focus to the entire closed signed-in top navigation capsule, preserving the separate problem tabs. Original view restores the dedicated stylesheet as before.
- Use exact public-source-reviewed structure and semantics, with fail-open checks for unknown, loading, sign-in and open-menu variants. A conservative marker/observer revokes capsule hiding on any subtree or ancestor mutation, including unlabelled notices and replacements; it never automatically hides changed UI again.
- Keep owned-page identity, cancellation, refresh recovery, authentication and grading behavior unchanged. The authenticated desktop DOM and rendered hide/restore behavior still require native validation.

## 0.12.5 (cloud-validated candidate)

- Recover Focus after a same-page refresh using only the original owned browser resource, session, root frame and exact problem URL. Explicit Focus never opens or adopts another tab.
- Accept only the exact missing-owned-stylesheet protocol response as absence proof; transport errors and pending writes remain conservative. Late removal notifications retry cleanup without reapplying Focus.
- Honor cancellation throughout recovery and discard an incompletely verified rebind. Fence pending Focus actions before discovery so newer navigation, session changes, Original view or disposal cannot be overwritten. Authentication, cookie handling and grading behavior are unchanged.

## 0.12.4 (local candidate)

- Extend reversible Focus mode to the exact narrow-layout Browse/search launcher and floating Ask Toni button, alongside the existing desktop launcher and Prev/Next links.
- Require the expected label, button type, single icon, form isolation and exact count before styling. Confirm computed hiding before reporting Applied; preserve assistant conversations and all other website controls.

## 0.12.3 (local candidate)

- Separate persistent Study status from the problem tree. Show Focus application/cleanup state, the Web/Markdown default, and explicit workspace environment actions with native inline controls.
- Refresh presentation status on commands, settings, browser navigation, active-tab changes and delayed cleanup. Keep proposed API denial compatible with Markdown/status activation.
- Show compact status in the section header when collapsed. Existing commands and menus remain available.

## 0.12.2

- Give newly created study environments a supported TensorTonic prompt label, with bounded workspace context. Keep their stable storage path and interpreter identity. Existing environments can receive the same display metadata without moving or reinstalling them.

## 0.12.1

- Publish Ready immediately after environment setup, without waiting for the completed informational notification to be dismissed.

- Recognize existing generated study workspaces from bounded local metadata without requiring an old registration value.
- Keep environment status discoverable: Choose workspace, Create, Use, Repair, or a non-actionable Ready row. Refresh never installs packages, executes Python or changes interpreter selection.
- Support documented local storage paths on compatible hosts and fence stale workspace/session/configuration operations.
- Extend default-off focus mode to the exact desktop Browse problems launcher. Original view restores the dedicated stylesheet; changed structure stays visible.
- Validate selected UI surfaces in dark and light high-contrast themes.

## 0.12.0

- Add multi-plan sidebar memberships, per-plan resume, plan-order Previous/Next/Next unsolved navigation and current-problem reveal.
- Keep native code editing with contextual Run/Submit/Cancel and three compact CodeLens actions.
- Reuse one Description/Tests/Results workspace; preserve focus, dirty content and result ownership across close, navigation and session changes.
- Add memory-only result freshness, explicit selected-public-case discussion, specific recovery choices and subtle difficulty presentation.
- Default to original problem left and native code right while preserving later manual layout changes.

## 0.11

- Separate encrypted saved-session ownership from optional browser presentation. Use fixed direct-HTTPS Python routes with explicit consent, server expiry and at-most-once dispatch.
- Add immutable credential generations, shared revocation fencing, bounded storage and independent cleanup reporting.
- Restore saved availability without startup browser or HTTP. Never manufacture cookie expiry or refresh semantics.

## 0.10

- Use the explicitly opted-in proposed browser API for newly owned tabs, without a VS Code DebugSession.
- Remove the Chrome/Helium companion, pairing transport and legacy connection selector from the maintained implementation.

Earlier releases remain available in Git history.
