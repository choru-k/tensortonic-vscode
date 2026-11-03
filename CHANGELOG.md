# Changelog

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
