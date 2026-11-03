# 0.12.2 local label candidate

The display-name change is not published. Its 754/754 aggregate tests pass with zero failures or skips;
package integrity and source parity are checked for the local candidate. The
existing environment label was verified in the actual interpreter picker and
status bar using accessibility state after a supported manager refresh. Current
screenshot capture returned blank images, so no new pixel evidence is claimed.
The environment path, selected interpreter and installed packages are preserved.

# 0.12.1 release checks

This page describes reproducible release checks and their limits. It contains no
account-specific test history, login/session values, personal paths, screenshots,
or internal checkpoint identifiers.

## Check status

| Area | Status and scope |
| --- | --- |
| Automated suite | The public 0.12.1 tree passed 752/752 tests with zero failures or skips. Tests use synthetic sessions, requests, browser ports and isolated filesystem fixtures. |
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
