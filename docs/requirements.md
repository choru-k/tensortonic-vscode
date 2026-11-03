# Feature and verification checklist

This checklist describes the released implementation. Per-user installation,
session import and environment creation happen only after the appropriate explicit
user action; a checked feature is not permission to perform those actions.

| Requirement | Status |
| --- | --- |
| Dedicated browser login and encrypted saved session | Implemented; consent and exact scope required. |
| Work with every browser tab closed | Implemented using fixed direct HTTPS routes. |
| No VS Code debugger or Chrome/Helium companion | Implemented; legacy transport and selector removed. Host automation indicators remain under host control. |
| Reuse login without needless reconnection | Implemented until actual server expiry/revocation; no daily cutoff or forced monthly login. |
| Guaranteed month-long authentication | Cannot be guaranteed by the extension. Server expiry is authoritative and is never extended or bypassed. No monthly override setting exists. |
| Multiple study plans, resume, Previous/Next/known Next unsolved | Implemented with local membership and unknown-progress handling. |
| Original problem left, native code right; preserve later layout | Implemented on explicit study open. |
| Contextual Run/Submit/Cancel; compact CodeLens | Implemented for recognized supported Python files; no automatic grading or replay. |
| Reusable Description/Tests/Results, freshness and explicit failure discussion | Implemented with captured-target and session/navigation fences. |
| Environment discovery and Create/Use/Repair/Ready status | Implemented; existing generated workspaces recognized read-only, unknown folders offer Choose. |
| Actual environment creation and scoped interpreter selection | Supported explicit setup workflow; depends on a compatible installed runtime and available official wheels. Never runs on refresh/startup. |
| Reversible focused original page | Implemented for the five exact reviewed Prev/Next/Browse controls. Changed structures remain visible; drawer input/global navigation are outside scope. |
| Dark and light high-contrast UI | Selected sidebar/code/results surfaces visually checked; full WCAG/theme/scale coverage is not claimed. |
| Unofficial branding and icon provenance | Disclosed; logo reuse rights remain unresolved and are not granted by the MIT code license. |
| Public VSIX source parity and tests | See the current release checks and artifact checksum. |

A normal update can require a safe window reload. Save/discard decisions remain
with the user; the extension does not force a restart, save code or drop buffers.
