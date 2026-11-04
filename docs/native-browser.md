# Browser host setup and scope

New sign-in/capture and optional Web presentation use VS Code's proposed `browser`
API. Saved-session HTTPS reads and startup restore do not require an open browser.
No VS Code debug adapter/session is started. Host automation indicators are not
hidden or bypassed.

## Exact opt-in

The manifest declares `enabledApiProposals: ["browser"]`. A supporting local host
must also opt in for **only** `choru-local.tensortonic-vscode`. For example:

```sh
code --enable-proposed-api choru-local.tensortonic-vscode "/path/to/Study"
```

A persistent opt-in can be added through **Preferences: Configure Runtime Arguments**:
merge that exact ID into the existing `enable-proposed-api` array while preserving
other entries and comments. The extension never edits this file. Save work and
fully quit/reopen VS Code normally when changing startup arguments. Reloading a
window or forwarding a command to an old process may not apply a new opt-in.

To reverse it, remove only this extension's array entry and restart safely. Preserve
other extensions' entries and unsaved work. Do not force termination merely to
apply the option.

The manifest minimum is VS Code 1.144.0, but the API remains unstable. Availability
on one supporting host is not a guarantee for every version or managed environment.
This experimental VSIX makes no Marketplace compatibility promise. If the API is
unavailable, use a supporting host and the exact opt-in; do not patch `product.json`,
spoof built-in identities, enable blanket proposals or weaken security policies.
Remote, browser and virtual workspaces are unsupported for acquisition.

## Owned resources

Only newly owned acquisition or presentation tabs are controlled. The extension
does not adopt unrelated tabs, clone profiles, alter `workbench.browser.dataStorage`,
transfer OAuth-provider cookies, or inspect browser profile files. Ordinary website
login follows the host's browser-storage behavior. The saved HTTP session is
separate and is not written into another browser's cookies.

Acquisition closes its own page after capture. Optional Web pages have an independent
lifecycle. Clear invalidates local copied access and attempts owned cleanup; it does
not call server logout or erase ordinary website login. Pending cleanup remains
visible for retry and is not silently adopted by a new connection.

## Focus mode

Focus starts off and accepts only the reviewed canonical problem-page contract.
It may hide the matching responsive Prev/Next links, desktop and narrow
problem-header Browse/search launchers, floating Ask Toni button and the guarded
closed signed-in top navigation capsule after exact
identity, count and semantic checks. It does not hide an already-open drawer or
assistant conversation, separate problem tabs, login/security notices, browser chrome or
automation indicators.

The adapter creates a dedicated forced stylesheet. Original view empties it and
checks cleanup before detaching; disabling the CSS domain is not treated as an
undo operation. Extension-opened Web problems retain the in-memory Focus request,
restore old styles and verify the new destination independently. Verified same-tab,
same-URL reloads can also recover after cleanup and fresh proof. Other navigation
or unverified document changes clear application without automatic requalification. Transport errors
alone never establish that styles disappeared. See [focus boundaries](sidebar-and-results.md#difficulty-and-focus).

## Validation

Synthetic browser tests cover attachment ownership, exact top-frame identity,
requests, cancellation, late mutations and restoration. They do not establish
live authentication or rendered UI behavior. Native UI/theme checks and their
limits are summarized in [release checks](../RELEASE-VALIDATION.md); personal host
reports and screenshots are excluded from the public payload.

Real account diagnostics require explicit user authorization and an already
connected saved session. They do not authorize session import, clearing credentials,
or grading. Test-host storage can differ from an ordinary development window;
do not infer secure persistence from an in-memory extension-test host. Keep
proposed-API access scoped to the owning extension and preserve unrelated windows,
settings and edits during any native check.


## Automatic Focus loading readiness (0.12.8 candidate)

A successful URL navigation is not itself a rendered-page proof. Automatic Focus
first waits read-only on the same owned document, for at most five seconds. The
recognized loading shapes are the browser's initial loading/interactive state,
the public navbar's empty account pulse/disabled theme placeholder, and the visible
public problem-body dolphin loading screen. Source: the captured 2026-11-03 public
`/problems/relu` SSR and navbar bundle `2xv1uplc4nzzv.js`.

Once those placeholders clear, two full reviewed contract checks 200 ms apart
precede the single existing application. A failed full proof or security/menu
exclusion stops immediately, rather than retrying arbitrary invalid structures.
A changed document is never adopted during this wait. Slow or differently shaped
pages can remain On / Unavailable and require explicit user action after loading.
Native confirmation of this candidate is still pending.


## Local Focus diagnostics (0.12.9 candidate)

The underlying automatic application failure remains unresolved. After an approved
native trial, inspect the single `Focus diagnostic:` line in TensorTonic Output
and compare the read-only `focusDiagnostics()` extension-export snapshots for the
latest automatic and manual On attempts. The export contains no browser or session
capability. It returns copied/frozen bounded metadata only.

The first failed stage or a started stage without completion distinguishes page
identity, loading classification, full proof, guard installation, style visibility
or cleanup. Fixed target labels identify which reviewed control failed without
capturing text or actual counts. `OTHER` means an unrecognized error category was
redacted. Dropped records are counted, never persisted elsewhere. New same-mode
attempts replace the old trace; late operations cannot overwrite the new trace.

Do not infer the root cause from elapsed time or Unavailable alone. A diagnostic
trial should first reproduce one automatic failure, then manual On/Off, and read
only these sanitized traces. Any new change should follow the actual failing branch.
This candidate is not a native-verified fix and has not been installed or published.


## Observed post-spinner incomplete controls (0.12.10 candidate)

An approved sanitized native trace found that document/body loading indicators
had cleared before the seven problem controls existed, while the navbar passed.
A private readiness-only exception now recognizes exactly seven zero control
counts and seven unique missing failures with the valid navbar. It does not
classify arbitrary INVALID_PROOF as loading, does not weaken the application
contract and cannot create a stylesheet proof.

After controls appear, two complete checks are still required. Any partial
structure, malformed metadata, navbar/security failure or identity change stops
without hiding controls. The original timeout/cancellation limits apply. A slow
page can remain Unavailable; no native success is claimed for this candidate.


## Verified browser reload recovery (0.12.13 candidate)

A prior successfully applied Focus page can recover after a browser reload only
on the same already-owned resource, CDP session, root frame and exact canonical
URL. The execution document must be new, and its navigation timing entry must
identify a reload. Ordinary navigation, history traversal, same-document updates,
missing/ambiguous evidence and new tabs are not accepted as reloads.

The root first confirms restoration of the old dedicated stylesheet/guard. Pending
cleanup blocks recovery. Context acquisition is read-only and bounded; it never
opens a tab, navigates or adopts another resource. The recovered document then
passes existing loading readiness and full contract proofs before one guarded apply.

Off, session changes, newer problem opens, Markdown, closure or switching to an
unrelated browser tab abort recovery and preserve cleanup ownership, including
late writes. Observed path/query/hash departures are latched even if the URL later
returns; only sanitized problem references and an unsafe-destination boolean cross
the presentation callback. Repeated same-URL notifications do not cancel the same
recovery. Same-document observer revocation never causes automatic rearming.

This candidate preserves 0.12.12 saved-session diagnostics and performs no new
session/network mutation. Native Mac reload validation remains pending.
