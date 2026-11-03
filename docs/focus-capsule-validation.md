# Top navigation capsule: evidence and limits

Version 0.12.6 adds one exact target to the existing seven-control Focus contract.
The intended target is the rounded top navigation capsule containing hamburger,
TensorTonic logo, announcements, Discord, theme and signed-in avatar. The separate
Problem/Theory/Solution/Submissions/Notes/Code navigation is not selected.

## Evidence

Public source was retrieved without authentication on 2026-11-03:

- https://www.tensortonic.com/problems/relu (server-rendered HTML).
  SHA-256: `9054a109811ffc874c028d880cb720ad508fb062be201c8e301438031364d5e3`.
- https://www.tensortonic.com/_next/static/immutable/chunks/2xv1uplc4nzzv.js
  (Navbar, theme and signed-in account trigger component code).
  SHA-256: `3328fae1586085ac2d43b1b93047c71334c8f4a5cc4c39f32c818f6612672bd5`.

The public PremiumAvatar implementation was also checked in
`/_next/static/immutable/chunks/074hztdv8ifoi.js` (SHA-256
`869ad3f37ac03ab42c8f724081e18ca276a2a6cf8f1880e4f42faf451b978f9a`).
Its extra-small variant uses the allowed div/span/image structure and omits the
larger avatar's badge text. This remains source evidence, not a rendered check.

The public SSR has loading placeholders for account and theme controls. Those
placeholders are deliberately rejected. The account-trigger fixture is synthetic,
based on the public component code; it is not a captured authenticated DOM.
No account, session, cookie, avatar URL or account identity was retrieved.

## Boundaries

The exact owned page must satisfy all eight targets before any styles apply.
The navbar verifier checks the wrapper, child counts, links, menu state, icons,
theme label, closed account trigger and text allowlist. Unknown structure, missing
controls, open menus and loading/sign-in variants fail open. The navbar CSS also
excludes semantic alerts, dialogs, live regions, forms and auth links. Before CSS,
a conservative MutationObserver is installed atomically with a fresh structural
proof and own document-root marker. It observes only the original navbar subtree
and its ancestors' direct child/attribute changes. Any mutation revokes the marker
and disconnects, including unlabelled text, normal animation attributes and node
replacement. There is no automatic requalification. A cloned/replaced root loses
the copied gate too. Original view removes the marker and disconnects the observer.
No global JavaScript state, account data or persistent storage is created.

A preexisting marker is never adopted or overwritten. An uncertain installation
result keeps cleanup pending until the owned document closes; no CSS is applied
after an unconfirmed guard. Execution-context destruction ends its observer, but
the retained inspector stylesheet is still explicitly emptied. Fail-open reopening
can happen while Focus remains on for the other seven controls.
Original view empties the dedicated stylesheet; it never rewrites site styles.

The generic selector validator accepts the exact pinned navbar selector as a
narrow exception for its protective functional CSS suffix. Other functional or
broad selectors are still rejected, and the native bridge pins the complete
contract including expectations and CSS.

## Required native check

The authenticated native host has not been used for this candidate. A cloud
Chromium fixture check was attempted but could not launch because the environment
blocked its process socket. No rendered browser pass is claimed.

Before treating the candidate as visually validated, use an explicitly authorized
owned native problem tab, confirm all eight targets hide, preserve the problem
tabs and notices, toggle Original view, repeat, and test both narrow and desktop
widths. Verify unknown/loading/sign-in/open-menu states remain visible and Off
still clears the dedicated stylesheet after same-page refresh. Do not substitute
synthetic passing tests for this check.
