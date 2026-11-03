# TensorTonic API adapter

The extension supports Python free problems and Python study-plan problems through
fixed HTTPS routes on `api.tensortonic.com`. Public study-plan discovery uses
anonymous `GET /api/study-plans`; catalogue visibility does not establish entitlement.

| Action | Free route | Study-plan route | Body |
| --- | --- | --- | --- |
| List | `/api/problems/list?page={page}&limit=100` | Same list route plus `&planId={plan}` | GET only |
| Plan order | — | `/api/study-plans/{plan}` | GET only |
| Detail | `/api/problems/{slug}` | `/api/study-plans/{plan}/problems/{slug}` | GET only |
| Run | `/api/problems/{slug}/run-cases` | `/api/study-plans/{plan}/problems/{slug}/run` | `{code, testCases:[{id,inputs}]}` |
| Submit | `/api/problems/{slug}/submit` | `/api/study-plans/{plan}/problems/{slug}/submit` | `{code}` |

Account verification uses `GET /api/me`. Route identifiers, methods, payload keys,
body sizes and response sizes are validated. Study-plan ordering comes from the
plan sections; ambiguous or inconsistent identities fail explicitly. Unknown solved
status remains unknown. SQL, CUDA and Triton grading routes are unsupported.

Public cases retain inputs for explicit local editing. Run excludes cases explicitly
marked nonpublic and sends only normalized ID/input pairs. Submit sends code only.
Results remain separate for their captured problem, plan, URI and operation.

Requests use the consented scoped session. No guessed Origin, Referer, Sec-Fetch or
CSRF headers are added. Redirects, rejection or uncertain outcomes never trigger a
transport fallback or automatic grading retry. The remote service decides account,
subscription and security requirements; documented client shape is not a grant of access.

## Presentation and diagnostics

The adapter retains whitelisted statement, starter, public-case and function metadata.
It does not mirror reference solutions, lessons or community content. Original website
interactive components remain on the optional owned website page; local Markdown
rendering does not execute downloaded website JavaScript.

The safe activation facade exposes bounded connection/read diagnostics. It exports
no vault, SecretStorage, raw transport or browser/CDP handle. A diagnostic verifies
an existing saved session and reads a catalogue/problem without acquiring a new
session or grading. Diagnostic output contains bounded booleans/counts/public
problem metadata, never credentials or private account identity.
