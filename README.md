# TensorTonic for VS Code — Unofficial

TensorTonic study tools for VS Code: browse Python problems, edit native solution
files, run or submit explicitly, and keep the original interactive problem page
beside your code. Version **0.12.2** gives new study environments a recognizable TensorTonic
interpreter label while preserving stable environment paths.

This project is not affiliated with TensorTonic. Normal website account and
subscription requirements apply. Browser integration uses an unstable VS Code API
and requires the scoped host opt-in described below.

## Connect and study

1. Open a trusted local desktop window and run **TensorTonic: Start studying**.
   Choose a study folder; other work windows and existing edits are preserved.
2. Run **TensorTonic: Connect session**. Before a new session import, review the
   in-app cookie scope, retention and account-access consent. Complete normal
   sign-in and 2FA in the dedicated browser page.
3. Return to a normal TensorTonic page and choose **Capture session** in the status
   bar. **Cancel sign-in** or closing that owned tab cancels acquisition. Unrelated
   browser tabs are not adopted or closed.
4. The acquisition tab closes before direct account verification. Choose a plan
   and problem. The original problem page opens on the left and the native solution
   editor on the right by default. Local Markdown is an opt-in alternative.

The saved HTTP session and optional problem browser are independent. Saved
availability restores without startup HTTP or opening a browser; requested reads
still check server access. Problems can be read and edited with the presentation
browser closed.

## Study workspace

Click the plan label or connected TensorTonic status to search the public study-plan
catalogue. **Manage sidebar study plans** controls workspace-local memberships;
removing a plan leaves files, resume hints, history and server data intact. Resume
rechecks the saved problem against the current catalogue. Manual URL or slug entry
remains available. Catalogue visibility does not imply account entitlement.

Sidebar Previous, Next and **Next unsolved** follow plan order without wrapping.
Unknown progress is not treated as unsolved. The current solution is revealed
without moving focus away from code or Chat. Difficulty can appear as text, a
color cue, or be hidden in extension-owned UI.

Recognized Python solutions have **TensorTonic Run / Submit** editor-title actions.
During an operation, Cancel identifies its captured target. CodeLens offers
**Problem**, **Tests**, and **Discuss with Agent**. These actions use the selected
solution; changing editors does not redirect an in-flight request.

A reusable auxiliary panel holds **Description / Tests / Results** when requested.
Description uses the local VS Code Markdown renderer and native MathML without
remote resources; unavailable formatting has an escaped-source fallback. Tests
preserve unsaved JSON and offer native editing. Run cases and Submit verdicts stay
separate, with summaries and expandable details. Results show whether current
unsaved inputs match the captured request, without changing remote progress or
repeating grading.

**Discuss a selected failed case** drafts a prompt for one explicitly public or
user-provided case. Hidden cases, unrelated results and credentials are excluded.
The extension does not execute that draft or send it automatically.

Existing solutions, tests, protected problem-context files and unsaved edits are
preserved. Initial layout setup applies only to a confirmed simple editor layout;
complex layouts and later manual moves are retained. Background results stay with
their exact problem and plan, without reopening a closed panel or stealing focus.
Website Theory, Solution, Notes and other interactive content remain on the original
page; the extension does not mirror them or embed the website in an iframe.

If the owned website tab moves to another or unknown problem, grading is blocked
until the local target is aligned or that browser is closed. Website navigation
does not silently select another solution. Session changes clear cached account
results and reject stale completions while preserving local work.

## Python environment

The sidebar offers **Choose study workspace**, **Create study environment**,
**Use study environment**, **Repair study environment**, or a non-actionable
**Study environment · Ready** status as appropriate. A supported local folder can
be recognized from validated TensorTonic solution metadata without creating a new
registration or executing workspace code.

Create and Repair require explicit confirmation before running Python or
installing packages. They use an installed supported Python and a dedicated
environment in extension storage, with fixed torch/numpy dependencies. Use selects
an existing verified managed interpreter for this study folder only. Status reads
local metadata and the Python extension's selected-interpreter API; it does not
run imports, activate Python, install packages, or treat terminal `VIRTUAL_ENV` as
proof of selection. Recorded readiness is not a fresh dependency audit.

An existing selected interpreter alone does not prove that this extension's
managed environment exists. Ordinary project environments remain unchanged.
Existing terminals also keep their current environment; open a new Python terminal
when you need terminal activation. No activation command is injected into a busy
terminal. See [Python setup and limits](docs/study-python.md).

## Optional focus mode

**Focus mode / Original view** is available in the study sidebar and recognized
solution editor overflow menus. It starts off. On the exact extension-owned problem
page, a reviewed contract checks eight targets: four responsive Prev/Next links,
desktop and narrow **Browse problems** launchers, the floating **Ask Toni** button,
and the closed signed-in top navigation capsule (hamburger, logo, announcements,
Discord, theme and avatar). The separate Problem/Theory/Solution/Submissions/Notes/
Code tabs remain visible. Exact structure, labels, counts and semantics are checked.

Changed, missing or ambiguous structures stay visible. Login/loading states and
open menus do not qualify. A conservative observer reopens the capsule on any content, attribute or ancestor
structure change, including unlabelled notices or replacement navigation. It never
automatically hides a changed capsule again. Original view
empties only the extension's dedicated stylesheet. In this candidate, the Focus
preference stays On across extension-opened Web problems: old styles are restored
first and the new exact owned page is verified independently. A same-tab, same-URL browser reload can reapply after old cleanup and independent
verification of the new document. Other manual navigation does not automatically
reapply. A
same-document open never re-arms a revoked capsule. The preference lives only
in memory and resets on extension reload or session changes.
Uncertain cleanup stays pending and can be retried. Browser chrome and automation
indicators are unaffected. The authenticated desktop capsule has not yet been
visually validated for this candidate.
See [focus behavior and boundaries](docs/sidebar-and-results.md#difficulty-and-focus).

## Session scope and lifetime

Only `__Secure-better-auth.session_token` with Domain `tensortonic.com`, Path `/`,
Secure, HttpOnly and SameSite=Lax is retained. Acquisition queries only
`https://api.tensortonic.com/api/me` from the owned www page. The protocol returns
all cookies applicable to that exact URL into memory before local name filtering;
other names are immediately discarded, never saved or logged. Google/GitHub and
other browser profiles are not queried or copied.

The session is stored in native encrypted SecretStorage until explicit server
cookie expiry, revocation, or **Clear saved session**. Genuine server Set-Cookie
renewal is respected; restarting the extension does not extend expiry. There is
no forced daily cutoff or guaranteed login lifetime. Cookies without explicit
expiry are refused for persistent storage.

Clear invalidates local copied access and deletes copied generations. It does not
call server logout, revoke other devices, or erase ordinary browser login cookies.
Credential deletion and owned-page cleanup are independent; pending cleanup remains
visible and offers a retry. There is no plaintext or globalState credential fallback.
A saved session can grant account access, as disclosed before import.

Run/Submit send only the explicitly chosen solution and permitted case payloads.
Cancellation after dispatch cannot undo server execution. An uncertain outcome is
never automatically replayed, and there is no browser grading fallback. See the
[HTTPS and grading contract](docs/session-http.md#grading-and-rollout).

## Supported host and installation

Download [the current VSIX](releases/tensortonic-vscode-0.12.2.vsix) and use
**Extensions: Install from VSIX...**. See [SHA-256](releases/SHA256SUMS.txt) for
artifact integrity. Installing it does not import a session or set up Python.

The manifest requires **VS Code 1.144.0 or later** on a supporting local desktop
host. New session acquisition and optional Web presentation use the unstable
proposed `browser` API. Installing the VSIX alone does not enable that API.

Opt in for this extension only, for example:

```sh
code --enable-proposed-api choru-local.tensortonic-vscode "/path/to/Study"
```

A forwarded command may reuse an already running process without applying new
startup arguments. Save work and restart VS Code normally when changing the opt-in.
See [persistent opt-in and reversal](docs/native-browser.md#exact-opt-in).
The extension does not edit launch arguments, product allowlists, browser storage,
debug settings or security policies. Saved-session HTTPS reads use stable APIs.
Remote, browser and virtual workspaces are unsupported for session acquisition.
This experimental VSIX is not a Marketplace or every-host compatibility promise.

## Development and validation

No external npm dependencies or install scripts are required. Use Node 24 with
`node:sqlite` and Python 3:

```sh
npm test
npm run test:session
npm run test:transport
python3 scripts/package.py
```

Automated tests use synthetic credentials, requests and browser fixtures.
[Release checks and limitations](RELEASE-VALIDATION.md) distinguish those tests
from native UI checks. Public source and packages exclude personal test reports,
login data, browser profiles, runtime logs and user solutions. The activation API
exports safe diagnostics rather than a vault, raw transport or browser capability.

Website content and trademarks belong to their owners. The bundled icon derives
from TensorTonic's favicon; **reuse rights remain unresolved and the brand asset is
not covered by this repository's MIT license**. See [icon provenance](docs/icon-provenance.md).

## Requirements checklist

See [implemented features and verification limits](docs/requirements.md), including
server-bound login expiry, environment setup and remaining licensing limits.
