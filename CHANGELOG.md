# Changelog

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
