# 0.3.1 patch validation — 2026-10-30 UTC

This patch is based on `eb4c26c615d957d151aa585c67fb706970e07a7c`. Work and checks ran in the assistant's cloud workspace, not on the user's Mac. Historical 0.3.0 artifacts are unchanged. The installable [0.3.1 VSIX](../releases/tensortonic-vscode-0.3.1.vsix) includes these source and validation documents.

## Changes

- **First-open description:** activate VS Code's built-in Markdown extension before checking for `markdown.showPreviewToSide`. Recheck navigation/session state around asynchronous operations and remove an older fallback after native preview recovers. If activation or preview fails, opening the solution still works and the fallback explicitly identifies itself as plain text.
- **Readable Run/Submit results:** outcome, reported passed/total counts and runtime, expandable case inputs/expected/actual values, and collapsed optional raw JSON. The observed Submit response `passed:43,total:43,duration_ms:1006,tests:[]` remains 43/43, not zero executed tests. Missing values are not fabricated. Contradictory outcomes require review; request errors replace stale success without automatically replaying uncertain submissions.
- **Curriculum and navigation:** join catalogue progress/API identities to the first-party plan's section/problem `sortOrder`. Previous/Next uses the open solution's plan, not the sidebar setting, and stops at boundaries. Stable API identity prevents renamed/reused browser aliases selecting another problem. Existing code/tests and unsaved edits remain preserved; stale requests/errors cannot override newer navigation.

Both custom webviews retain `enableScripts: false`, empty local resource roots, and `default-src 'none'`. All result values are escaped and bounded. Native Markdown receives the existing sanitized `.problem.md`: active HTML, remote Markdown images, and downloaded links remain disabled/neutralized. No CDN, new renderer dependency, preview-security change, or math-setting change is introduced.

The separate interactive-card contract was researched read-only and is documented in [API contracts](api.md). Cards and prior website-solution imports are not implemented in this patch.

## Checks run against final code

- `npm test`: **138 passed**, zero failed or skipped. Includes first-use activation/recovery/failure, sanitized Markdown/math preservation, observed grading shapes, contradictory/malformed/oversized results, original ordering, navigation boundaries, stale responses/errors, API identity, and unsaved-file preservation.
- `npm run test:transport`: **15 passed**, zero failed or skipped, over actual loopback HTTP with simulated upstream responses. The new plan-order GET is exercised through the unchanged bridge and connector.
- `node --check` passed for the modified runtime modules and real-host integration runner; `git diff --check` passed.
- Independent read-only review cleared results presentation/security and navigation/order; focused client/extension tests passed 55/55.
- Read-only unauthenticated public API verification returned all 30 PyTorch problems in original order: Tensor Factory, Tensor Operations, Tensor Shape Manipulation first; Softmax #11; Residual Block and Beam Search Decoding last. No authenticated detail or grading requests were made.
- VSIX and companion packaging completed; archive integrity and source-byte parity were checked. The new VSIX is version 0.3.1. Historical releases were not replaced.

## Rendered-UI verification limits

The real-host runner `test/vscode-mock-integration.js` now checks actual native Markdown output (headings, lists, inline/display KaTeX and absence of remote active content), plus original-order Previous/Next and unsaved-edit preservation. The `markdown.api.render(TextDocument)` signature was verified in the installed official VS Code source.

A fresh real-host attempt using the existing official Linux VS Code binary, headless mode, and an isolated cloud profile exited with code **133 before producing an extension-host report**. The shell has no display server; the log also contains sandbox DBus/NETLINK errors. These observations do not establish the exact crash cause. The new native-render and navigation host assertions therefore remain **unrun**. Historical reports in `dist` are not fresh evidence for this patch.

A script-free HTML fixture generated from the current result renderer and styles could not be opened by the cloud browser at the cloud workspace's loopback address (`ERR_CONNECTION_REFUSED`). A subsequent inert `data:` fixture navigation was explicitly rejected by the browser URL policy (only HTTP/HTTPS allowed); no further alternative or policy bypass was attempted. Visual screenshot QA is therefore **not completed**.

The user's prior manual 0.3.0 screenshots separately confirmed problem browsing, Run success, Submit 43/43 with 1006 ms, and an Agent response using the three attached files. Those are user-driven observations, not automated checks of this patch. No authenticated browser, live grading, Agent response, or Mac UI was exercised during this cloud patch work.
