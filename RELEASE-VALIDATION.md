# 0.12.14 anchor diagnostic candidate

Based on published 0.12.13 commit `9c2d742e7878620aad4bf5751475a66aa78a4258`;
all 150 base blobs matched its remote tree. Native follow-up on that version
showed manual On success, refresh failure on four Prev/Next shape checks, later
new-problem automatic application success, and successful Off restoration.
The precise failed anchor predicate remains unknown.

This candidate refines local fixed-enum diagnostics only. It does not accept
legacy links or placeholders, retry shape failures, change the loading deadline,
rearm a revoked guard, or alter session/network/Run/Submit behavior. See
`docs/focus-anchor-diagnostics.md` for public-source evidence and the next bounded
native evidence needed. The public catalog fallback is a hypothesis, not a proven
native cause. No Mac access, installation or publication was performed.

Serial cloud tests passed 910/910 aggregate, 152/152 session and 96/96 transport.
Added checks cover original predicate equivalence, exact evaluated failure categories,
no retries or CSS writes for rejected anchors, and no private values in diagnostics.
Independent source review passed; artifact parity is checked separately.

Historical validation follows.

# 0.12.13 verified reload recovery candidate

The observed reload behavior follows the previous deliberate boundary: document
changes cleared applied styling while keeping requested On, with no automatic
recovery. This candidate adds narrowly verified reload recovery rather than
retrying same-document guard revocation or arbitrary navigation.

A successful prior application anchors one resource/session/frame/URL. Old CSS
cleanup must finish; a new document and navigation type reload are required before
existing readiness and single guarded application. Cancellation, observed URL
departure, cleanup failure and unrelated active tabs remain fail-open. Recovery
uses only the owned display and does not alter saved sessions or grading behavior.

Serial cloud validation passed 906/906 aggregate tests, 152/152 session checks
and 95/95 transport checks. New coverage includes verified reload recovery,
normal/history navigation rejection, changed frame/URL, absent prior application,
cleanup failure, delayed context/write cancellation, active-tab switches, observed
away-and-back navigation, initial-observation races, and stalled-read deadlines.
The pristine base matched all 148 remote blobs of commit
`4c6be837f57e76d6e1094498872a5c2f3df1d55f`. No Mac access, installation
or publication was performed. Native success remains unverified. Historical
validation follows.

# 0.12.12 non-mutating local session diagnosis

The separate `diagnoseStoredSession` API performs at most one fixed HTTPS account
GET. It bypasses ordinary session restoration, verification, transport and cleanup
paths that can clear or rotate saved credentials. It does not write the local
session index or SecretStorage, adopt response cookies, expose account payloads,
open browser resources, import credentials or grade. The native runner requires
an already active extension and never activates or reconnects it.

Final serial cloud checks passed 896/896 aggregate, 152/152 session and 91/91
transport tests with no failures, skips or cancellations. Fifty-seven new tests
cover local byte preservation, production-factory/HTTPS-dispatch integration,
401/schema/rotation failures, timeout/cancellation, corrupt storage, trust and
lifecycle gates, concurrent changes, facade wiring and the native runner.
Independent focused review and all 57 new tests passed without blocking findings.
JavaScript syntax, package allowlist, archive integrity and source parity passed.

Local non-mutation is not remote non-mutation: a GET can rotate a server session.
Any Set-Cookie response is unverified and never adopted. Snapshot checks are
optimistic, not an atomic cross-process revocation lock. Another process can clear
or change the session after the last pre-dispatch read, allowing one request before
a later check rejects the result. No automatic replay is performed.

These tests use synthetic credentials and responses. No real account access,
Mac installation, native pixels or live grading is established by this release.
Earlier 0.12.11 artifacts remain unchanged. Historical validation follows.

# 0.12.11 reviewed Labs compatibility candidate

Fresh public SSR and official navbar JavaScript confirm an added `/labs` link
labeled Labs. The former exact six-link verifier rejects that layout. The candidate
accepts only complete reviewed six- or seven-link sets; it does not broaden unknown
structure, authentication, security notices or menu states.

Old and current public streamed problem content are byte-identical, so no change
to the seven problem-control selectors is supported or included. The native report
of missing controls remains unresolved; public evidence does not prove the actual
Mac DOM or a complete fix. See [evidence and limits](docs/focus-labs-compatibility.md).

Serial cloud validation passed 839/839 aggregate tests, 102/102 session checks
and 91/91 transport checks. New regression cases cover both complete reviewed
link sets, wrong href/text, missing/duplicate/extra links, warning text and guarded
application/revocation/restoration with Labs. No Mac access, installation or
publication occurred. Historical validation follows.

# 0.12.10 observed incomplete-controls candidate

The approved native 0.12.9 diagnostic run established this sequence: page lookup
succeeded, initial document/body loading indicators cleared, then all seven
problem controls were missing from the full contract check. No navbar target
failure was reported. Automatic Focus stayed Unavailable; manual On after loading
succeeded and Off restored. This identifies the failing verification state, not
an underlying website implementation cause.

The new exception is readiness-only: exactly the seven known non-navbar controls
must have zero matches, exactly seven unique missing failures must be present,
and the signed-in navbar must pass its complete proof with exactly one match.
Metadata keys and URL are checked, and the owned document is checked again.
Only the private readiness gate can return incomplete, which clears any apply
proof. The ordinary verifier still rejects the same incomplete state.

Waiting remains read-only, within the original five-second/25-attempt bound.
Two complete proofs are still required after loading; an incomplete result resets
that streak. Partial/malformed/count/security rejection does not retry. Off,
newer navigation, session changes, Markdown and document changes retain existing
fences. Diagnostics preserve proof error categories and no longer infer URL
mismatch when no page object exists.

Serial cloud validation passed 837/837 aggregate tests, 102/102 session checks
and 90/90 transport checks. New cases cover the observed incomplete-to-valid
transition, partial/count/security near misses, malformed metadata, timeout,
cancellation, document change, reset proof streak, falsy rejection and accurate
URL diagnostics. No Mac access, installation or publication occurred for this
candidate. Native verification remains necessary.
Historical results follow.

# 0.12.9 diagnostic-only candidate

Native testing of both 0.12.7 and 0.12.8 reported On / Unavailable after problem
switching, while manual On after loading succeeded and Off restored controls.
The exact failing branch remains unknown. This candidate adds observability;
it does not claim another fix or change the reviewed hide/restore policy.

Latest automatic and manual traces each hold at most 64 enum-only records.
Stages distinguish initial lookup, identity frame/location, URL mismatch,
same-document skip, recognized loading reason, full contract target rejection,
controller outcome, sheet creation/write, capsule guard, visibility and cleanup.
Callbacks are bound to operations and leases, not whichever attempt is current.

No diagnostic contains page URLs, problem names, document/frame identifiers,
page text, code, cookies, credentials, raw errors or timestamps. No diagnostic
network request or extension storage/file write is added. The local TensorTonic
Output channel receives one bounded summary for a current automatic failure;
VS Code controls its normal Output retention. A read-only extension export exposes
frozen snapshots for local inspection. No clipboard copying or upload occurs.

Serial cloud validation passed 830/830 aggregate tests, 102/102 session checks
and 84/84 transport checks. Coverage includes enum sanitization, bounded immutable
snapshots, stale callback/lease isolation, raw-error redaction, target rejection,
readiness cancellation and single current-failure output. No Mac access, installation
or publication was performed. Historical results follow.

# 0.12.8 loading-readiness candidate

Mac testing of 0.12.7 reported automatic new-problem Focus as On / Unavailable,
while manual On after loading succeeded. Source confirms that navigation previously
returned at URL match, before document or hydrated controls were necessarily ready.
This is a concrete readiness gap consistent with the symptom; the exact failing
Mac DOM check was not captured, and this candidate has not been Mac-validated.

The new read-only phase pins the destination document and waits only for browser
loading or source-reviewed navbar/body placeholders. It requires two successful
full proofs separated by 200 ms, then invokes the existing apply once. Unknown
complete structures and security exclusions are not polled. Off, navigation,
Markdown, session changes and shutdown still fence stale work. Timeout or failure
leaves controls visible and does not claim Applied. No fallback discovery occurs.

Cloud serial tests passed: 821/821 aggregate, 102/102 session and 82/82 transport.
Tests cover delayed document/navbar/body hydration, rejected structure/security
checks, cancellation, changed URL/context, bounded loading and a stalled read,
plus Off/session/Markdown/newer-navigation fences during readiness. No installation
or publication was performed for this candidate. Historical results follow.

# 0.12.7 session-only Focus preference candidate

This cloud-only candidate separates the user's requested On state from current
page styling. On a completed extension-opened Web problem, it restores the old
lease and verifies the exact latest destination before applying. Off, newer
navigation, session changes, shutdown and Markdown changes fence stale work.
An unavailable or rejected page keeps the preference but does not claim Applied.
Cleanup failures continue to block navigation/reapply until explicitly resolved.

Browser refresh/manual navigation, unrelated tabs, Markdown and same-document
opens do not automatically re-arm Focus. The existing navbar mutation guard stays
fail-open. The preference is in memory only and resets on extension/session reload.

Serial cloud validation passed 814/814 aggregate tests, 102/102 session checks
and 76/76 transport checks. New tests cover different owned tabs, same-document
opens, initial verification failure, delayed lookup/write/restore, Off and On
during navigation, concurrent opens, stale sessions, cleanup failures, rejected
security verification, manual refresh and Markdown. No user device was accessed,
no native rendering was verified, and this candidate was neither installed nor
published. Historical 0.12.6 and earlier results follow.

# 0.12.6 guarded top navigation capsule candidate

Cloud serial validation passed 800/800 aggregate tests on Node 24.22.1. The
additional tests exercise capsule structure rejection, direct warning text, observer
revocation, cloned-root replacement, marker collisions, uncertain installation,
exact contract pinning, computed-visibility failure and dedicated-sheet restoration.
Separate serial session and transport suites passed 102/102 and 76/76 checks.
All account UI fixtures are synthetic. Source evidence and precise limits are
recorded in [capsule validation](docs/focus-capsule-validation.md).

The cloud Chromium fixture check could not launch: the environment denied its
process socket, including after an approval-reviewed retry. The test did not
reach a page. No authenticated DOM, native rendering, Mac access, installation,
publication, cookie import or grading request was performed for this candidate.

The following sections are historical validation for earlier versions.

# 0.12.5 cloud-validated Focus refresh recovery candidate

Cloud-only validation on Node 24.22.1 and Python 3.12.14 passed 789/789
aggregate tests (with file concurrency set to one), 102/102 session checks and 70/70 transport checks, with no
failures, skips or cancellations. All fixtures are synthetic. No desktop host,
real account, cookie import, grading request or installation was used.

Regression coverage verifies exact owned missing-stylesheet responses; rejection
of wrong methods, codes, messages, native IDs, sessions and pending mutations;
original-resource/root/URL-only recovery; cancellation and failed-rebind cleanup;
and late removal notifications that retry Off without discovery or styling.
A pending-action regression covers both recovery and legacy page lookup across
new navigation, session changes, Original view, page observations and disposal.

An earlier serial run had one existing synthetic Unicode-response deadline
timeout during host contention; a parallel session-only run also hit an existing
secure-storage deadline fixture. The unchanged Unicode test passed alone in
59 ms, and the complete unchanged serial suite passed. No deadlines were relaxed.

The VSIX is built by the repository allowlist, archive-tested and checked for
byte-for-byte source parity. Authentication/session code is unchanged. The
recovery only reads the existing owned page's frame and exact URL metadata and
never opens, navigates or adopts another tab.

Actual native-host refresh recovery and visual behavior are not verified for
this candidate. Earlier native checks below concern earlier versions and must
not be read as native validation of 0.12.5. Publication and installation are
separate actions.

# 0.12.4 local Focus controls candidate

This local candidate extends the fixed owned-page CSS contract from five to
seven controls: responsive Prev/Next, both Browse/search launchers and floating
Ask Toni. Anonymous public source and an actual owned problem page established
the exact control structures. Baseline native checks reproduced the narrow
Browse and floating assistant remaining visible under the older contract.

The candidate passed 781/781 aggregate tests, 102/102 session checks, 64/64
transport checks and an independent 125-test Focus/status review. Synthetic
loopback fixtures require ordinary local execution permission on restricted hosts.

Actual native checks at 896 and 384 CSS-pixel widths confirmed all seven controls
hidden with Focus On and their computed display restored with Off. Native pixels
and accessibility checks preserved Theory, Solution, Notes and interactive content.
Navigation resets Focus; a mismatched or404 problem page is left untouched.

A full browser-page reload restored the visible controls but retained conservative
cleanup-pending state in the tested host. Closing only the owned problem tab and
explicitly reopening its problem restored clean Focus operation. Do not treat a
protocol error or visible controls alone as proof that an old sheet is gone.

Both owned test hosts exited normally with no pending fixture requests, debugger
sessions, secret operations or cookie operations. No new account import, real
grading or public publication is implied. Private host records and research
downloads are excluded from the package.

# 0.12.3 local Study status candidate

This candidate adds a separate native status view. Automated tests cover cached
status rendering, denied browser APIs, settings and navigation updates, delayed
cleanup and computed visibility failure after a successful stylesheet write.
Native local verification is recorded separately; no account-specific records or
new public publication are implied by this local package.

# 0.12.2 release checks

This page describes reproducible release checks and their limits. It contains no
account-specific test history, login/session values, personal paths, screenshots,
or internal checkpoint identifiers.

## Check status

| Area | Status and scope |
| --- | --- |
| Automated suite | The 0.12.2 release source passed 754/754 tests with zero failures or skips. Tests use synthetic sessions, requests, browser ports and isolated filesystem fixtures. |
| Environment label | The actual interpreter picker and status bar showed the friendly name after the supported manager refresh. Metadata-only migration preserved the environment path, selected interpreter and package imports. Label screenshot capture returned blank images, so no new pixel evidence is claimed. |
| Native UI | Selected study-workspace flows have been exercised in a supporting VS Code desktop host. This is not evidence of real-account grading compatibility on every host. |
| Theme smoke checks | Reviewed UI surfaces passed pixel checks in Dark 2026, Dark High Contrast and Light High Contrast. Other themes, scales and assistive-technology combinations are not exhaustively covered. |
| Focus mode | The five-control desktop Browse/Prev/Next contract passed native force-apply/restore: all five exact controls hid and recovered their computed display. Unknown structures remain visible. |
| Package | The source allowlist is reviewed. The installation artifact is rebuilt from this sanitized tree and checked for integrity and source parity. |

These are local checks. No remote CI pass, formal WCAG conformance, complete
visual audit, or general server compatibility is claimed. Native screenshots and
personal execution reports are not part of the public payload.

## Reproduce automated checks

Use Node 24 with `node:sqlite` and Python 3, then run from the repository root:

```sh
npm test
npm run test:session
npm run test:transport
python3 scripts/package.py
```

The tests cover exact route/body/cookie scope, session revocation and cleanup,
at-most-once grading dispatch, cancellation and stale results, owned browser
identity, dedicated focus stylesheet restoration, study-folder recognition,
metadata-only environment status, and synthetic process cancellation.

A passing fixture does not prove live authentication, real package availability,
Pylance behavior, or rendered UI on another installation. Real account requests,
Python setup and local installation require their own explicit user actions;
release verification does not automatically perform them.

## Package review

Build the VSIX from the reviewed public tree, then check ZIP integrity and compare
every packaged source/document/asset byte with that tree. Publish only the intended
current artifact. The builder includes an explicit allowlist of runtime JavaScript,
package metadata, documentation, license and icon assets. Tests, private reports,
profiles, cookies, credentials, environment files, local solutions, logs and research
downloads are excluded.

Keep the **Unofficial** display name and non-affiliation disclosure. The icon's
[provenance and unresolved reuse rights](docs/icon-provenance.md) remain disclosed;
the code's MIT license does not license the TensorTonic brand asset.

## Native checks and limits

Review problem-left/code-right layout, preserved manual layouts, keyboard tab
switching, visible environment actions, unsaved-source freshness, close/reopen,
cancellation and delayed completions in an isolated study window. A website page
must be the exact newly owned canonical problem tab before focus styles can apply.
Verify that Original view empties the dedicated stylesheet before detachment and
that changed controls, wrong documents, closed tabs and uncertain cleanup fail
open or remain truthfully pending.

Host browser APIs are proposed and can change. Theme smoke checks are limited to
the tested surfaces; they do not establish full keyboard/screen-reader or WCAG
acceptance. Session and grading policy tests remain distinct from native rendering.
