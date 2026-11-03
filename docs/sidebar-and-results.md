# Sidebar membership, results and optional focus mode

Version 0.12.1 keeps study navigation, local results and optional presentation
controls separate from session policy. It never runs or submits a solution merely
because a sidebar selection or view changes.

## Sidebar plans

Use **Manage sidebar study plans** to select multiple supported plans. Membership
is local to the workspace and separate from server enrollment or progress. Removing
a plan changes the sidebar only: code, notes, tests, history, resume hints and
server data remain intact. An open solution stays the command target even after
its plan is removed.

Each plan retains its last successfully opened problem. Resume validates it against
the current catalogue; a missing target offers a problem picker. Unknown or offline
progress is labeled unavailable rather than inferred. Canceling a picker or a stale
request cannot overwrite a newer selection. Invalid stored membership is preserved
for recovery rather than silently reset.

The sidebar also keeps environment status discoverable when disconnected or when
no problem list is loaded. It offers **Choose study workspace**, **Create**,
**Use**, or **Repair study environment**, or a non-actionable **Ready** row. See
[environment recognition and setup](study-python.md).

## Results and discussion

Run and Submit remain separate remote outcomes. A memory-only fingerprint captures
the effective Run payload, including normalized cases, or the Submit code. The
results pane shows capture time and whether current unsaved inputs match. Editing
and exact reverting update this label; a closed or unavailable source is unknown.
This label never changes server progress or causes grading to repeat.

**Discuss a selected failed case** drafts an Agent prompt after an explicit case
choice. Only one explicitly public or user-provided failed case is included;
hidden cases, other results, logs and credentials are excluded. Result data is
labeled untrusted. The draft requests explanation, and the extension neither sends
it automatically nor executes or submits anything on its behalf.

Recovery choices are explicit: Connect, local Clear, the original page or Output,
as appropriate to the error. Old notifications cannot clear a newer session or
replay grading. Background outcomes remain attached to their original problem
and plan; they do not replace another problem or reopen a closed panel.

## Difficulty and focus

`tensortonic.difficultyDisplay` selects `text`, `color` or `hidden`. Text uses a
subtle sidebar description. Color adds a theme-aware tint while retaining the
solved-status shape. Hidden removes extension-owned difficulty metadata. Website
difficulty labels are unchanged.

**Focus mode / Original view** is available in the study sidebar overflow and
recognized solution editor overflow. It starts off and affects only the exact
extension-owned canonical problem tab. Before a dedicated stylesheet can hide
anything, the contract verifies these eight targets:

- The responsive Prev/Next problem-navigation links: two mobile and two desktop.
- The desktop and narrow problem-header **Browse problems** launchers. Each must
  retain its reviewed navigation parent, title, one panel-left SVG icon, no href,
  no type attribute and no form association.
- The floating **Ask Toni** launcher directly inside the problem main area. It
  must retain its fixed bottom/right classes, accessible label, button type, text
  and one sparkles icon, with no form association. Existing Toni conversations
  are not hidden or closed.

- The closed signed-in top navigation capsule, with its exact public-source-reviewed
  wrapper, navigation links, hamburger, logo, announcements, Discord, theme and
  avatar structure. Loading/sign-in variants, open menus and changed content fail
  open. A temporary root marker gates the CSS. An observer revokes that marker
  on any capsule subtree or ancestor mutation and never requalifies a replacement;
  new notices, including unlabelled text, remain visible. Normal UI updates can
  conservatively reopen the capsule too.

Every selector must match exactly once. The page, document and top frame must
remain the same; links must have safe canonical problem destinations. A changed,
missing, boundary or ambiguous structure stays visible. The contents of an already-open drawer,
separate problem tabs and browser address bar are not hide targets. The top
Browse/search launchers are hidden at both responsive widths.

Original view empties only the extension's dedicated stylesheet, including after
SPA route changes. Full document destruction, exact stylesheet removal or tab
closure count as cleanup only with owned lifecycle proof. The session-only Focus
request survives extension-opened Web problems; each new destination must pass a
fresh proof after old styles are restored. Browser refresh/manual navigation clears
application without automatic requalification. Failed or late cleanup remains pending for retry; a protocol error alone
never means the page was restored. A full browser-page reload can leave cleanup
pending even when controls are visibly restored. If Original view cannot confirm
cleanup, finish any page-local work, close only that owned problem tab, then
explicitly reopen the problem.

Login, payment or security notices, Problem/Theory/Solution/Submissions/Notes/Code controls, site stylesheets,
browser chrome, automation indicators and global settings are outside focus mode.
See [release verification limits](../RELEASE-VALIDATION.md).

## Icon

The extension uses TensorTonic's favicon silhouette and raster icon and remains
explicitly unofficial. Reuse rights are unresolved; the brand asset is not covered
by this repository's MIT license. See [icon provenance](icon-provenance.md).

## Study status

The **Study status** section is shown by default below the problem tree. It keeps
three native rows separate from problem membership and progress:

- **Focus mode** reports Off, Updating, On/Applied, Unavailable or Cleanup pending.
  Select the row or its inline eye action to toggle the existing Focus/Original
  control. A requested On state alone is not shown as Applied. Each fixed target must
  still match and have computed display `none` immediately after applying the
  stylesheet. A failed visibility check restores the owned styles; this is not
  continuous visibility polling.
- **Problem view** reports the Web or Markdown default for future explicit problem
  opens. Select it or its inline browser action to choose a mode. The preference
  does not close existing tabs or rewrite code.
- **Study environment** offers the existing explicit Create, Use, Repair or Choose
  workspace action, or a non-actionable Ready state. Refresh never installs or
  selects an environment. The old problem-list environment footer moves here.

The section header also shows a short summary when collapsed. VS Code still lets
the user resize, move, collapse or hide native views. Use **TensorTonic: Show study
status** to focus it again; the extension does not override manual layout choices.

Focus preference resets to Off after extension reload or a session change.
It stays On across extension-opened Web problems but actual application is verified
separately. After browser refresh/manual navigation it may show On / Not applied.
Same-document opens never re-arm an observer-revoked capsule. Markdown and unrelated
tabs are never automatically styled. No global/workspace setting is persisted.
Its tooltip explains this and why it may not apply: no owned website page, a
changed or mismatched page, another browser tab active, unverified controls, or
pending restoration. Markdown is a local renderer and is not styled by website
Focus mode. An existing owned Web tab can remain styled even when the default is
changed to Markdown. Only fixed reviewed website controls are affected; login,
security, payment and interactive content remain outside this presentation scope.

Status rendering reads only host state and settings. It performs no HTTP request,
cookie access, Python import, grading action or browser inspection. Browser state
uses only references to already-owned tabs and the public active-tab reference;
no unrelated page URL, title or content is inspected.
