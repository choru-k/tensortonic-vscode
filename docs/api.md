# Observed TensorTonic API contracts

These are the first-party browser application's observed contracts, not a published or guaranteed TensorTonic API. Origin: `https://api.tensortonic.com`. The browser sends requests with `credentials: 'include'`; this extension's browser bridge keeps login cookies inside that browser.

Source evidence: public asset `work/research/1mh93pi4i6t73.js` (API helpers) and `work/research/2yk0j4p-v9-e3.js` (catalogue pagination and source routing), downloaded from TensorTonic. Live catalogue, free details, and signed-in PyTorch details were inspected during development. The website's PyTorch Run request was captured in browser Network tools.

| Operation | Method and path | JSON body |
| --- | --- | --- |
| Catalogue | `GET /api/problems/list?page=1&limit=100` | None; optional `planId` query parameter |
| Study plans | `GET /api/study-plans` | None |
| Free Python detail | `GET /api/problems/{id}` | None |
| Study-plan Python detail | `GET /api/study-plans/{planId}/problems/{id}` | None |
| Run free Python | `POST /api/problems/{id}/run-cases` | `{code, testCases, problemType: 'free'}` |
| Submit free Python | `POST /api/problems/{id}/submit` | `{code, problemType: 'free'}` |
| Run study-plan Python | `POST /api/study-plans/{planId}/problems/{id}/run` | `{code, testCases}` |
| Submit study-plan Python | `POST /api/study-plans/{planId}/problems/{id}/submit` | `{code}` |

Catalogue/detail responses wrap results in `{status: 'success', data: ...}`. Catalogue data contains `problems` and `pagination: {page, limit, total, totalPages, hasMore}`. Each problem includes `id`, `sourceId`, `slug`, `source`, `category`, `title`, `difficulty`, `planId`, `solved`, and access flags. `source` chooses the runtime route: `free` or `python` are supported. `category` is a technology label such as `numpy` or `pytorch`, not a runtime route. The adapter preserves catalogue `slug` for browser links and stores `sourceId || id` in `apiId` for API requests.

Detail data includes Markdown `description`, `requirements`, `constraints`, HTML/Markdown `title`, `starterCode`, string-array `examples`, `testCases`, and `functionMetadata`. Public cases have `{id, name, inputs, isPublic: true}`. The captured study-plan Run request sends `{id, inputs}` wrappers in `testCases`, not bare inputs. The adapter strips `name`/`isPublic` from outgoing cases and excludes explicitly nonpublic cases. Cases entered by the user must have an `inputs` object. Examples are display text, not runnable cases.

Run and Submit responses are returned unchanged so that results, tracebacks and service error fields are not guessed or discarded. HTTP failures are handled by the transport. The adapter does not request theory, reference solutions, community solutions, account settings or billing endpoints. SQL, CUDA and Triton routes are intentionally unsupported and rejected before execution.

The live captured study-plan request used `/api/study-plans/pytorch-basics/problems/pytorch-manual-weight-update/run`, with cases such as `{id: 'test-1', inputs: {X: [[1, 0], [0, 1]], y: [[1], [0]], lr: 0.1, seed: 42}}`.
