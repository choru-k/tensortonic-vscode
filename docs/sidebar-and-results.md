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
anything, the contract verifies these five controls:

- The responsive Prev/Next problem-navigation links: two mobile and two desktop.
- The desktop problem-header **Browse problems** button that opens the problem
  search drawer. It must have the expected label, one panel-left SVG icon, no href,
  no type attribute and no form association.

Every selector must match exactly once. The page, document and top frame must
remain the same; links must have safe canonical problem destinations. A changed,
missing, boundary or ambiguous structure stays visible. The drawer search input,
mobile Browse button and global website navigation are not hide targets.

Original view empties only the extension's dedicated stylesheet, including after
SPA route changes. Full document destruction, exact stylesheet removal or tab
closure count as cleanup only with owned lifecycle proof. Navigation turns focus
off. Failed or late cleanup remains pending for retry; a protocol error alone
never means the page was restored.

Login, payment or security notices, Theory/Solution/Notes controls, site stylesheets,
browser chrome, automation indicators and global settings are outside focus mode.
See [release verification limits](../RELEASE-VALIDATION.md).

## Icon

The extension uses TensorTonic's favicon silhouette and raster icon and remains
explicitly unofficial. Reuse rights are unresolved; the brand asset is not covered
by this repository's MIT license. See [icon provenance](icon-provenance.md).
