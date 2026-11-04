# Reviewed Labs navbar compatibility (0.12.11 candidate)

On 2026-11-04, public `https://www.tensortonic.com/problems/relu` SSR and the
same site's `/_next/static/immutable/chunks/0isxu7-mgnu7z.js` navbar bundle add an
exact `/labs` link labeled `Labs`, between Study Plans and Projects. The prior
captured navbar had six desktop links; the current navbar has seven. The strict
verifier rejected this new known link and required six links, so the current
public layout is incompatible with the old verifier.

The candidate accepts only the complete prior six-link set or the complete
current seven-link set. It requires every expected href/label pair exactly once.
Unknown, duplicate, missing or mismatched links still fail. Security, authentication,
menu, avatar and warning-text checks, plus mutation-driven reopening, are unchanged.
No arbitrary navbar structure or new hide target is accepted.

The complete old and freshly captured streamed ReLU problem-content fragments
(`S:1`, 80,047 UTF-8 bytes each, extracted with nested HTML parsing) are byte-for-byte
identical. Both have SHA256
`c3b089a7394bd3a49f377849954cfa4cfb4a596c0e60b941dcfd7455327b2667`. The initial main loading subtree is also identical. Public evidence
does not support changing any of the seven problem-control selectors. Public SSR
uses loading account/theme placeholders, not an authenticated avatar proof.

The later automatic native attempt reports seven missing problem controls and
navbar shape rejection. The earlier manual attempt was Unavailable but lacks a
detailed trace; its AX snapshot showed controls, without a verified hydration
state. These two observations must not be conflated. The Labs change is a proven public compatibility blocker, but actual
Mac DOM was not captured and the separate missing-control condition is unresolved.
This candidate has not been installed or rendered on Mac and is not claimed to
resolve the complete failure.

Current public SSR SHA256:
`37d2c6cf09da9d5af33e67e1461f69044730d39331f3fc8c130d9e0d733d1c4d`

Current official navbar bundle SHA256:
`197cf9c2e27b2378503e5387dea45100db2546c772d1c287822c791ef9776375`
