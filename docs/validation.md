# Validation — 2026-10-30 (Asia/Seoul)

## Completed

- `npm test`: 37 tests passed, 0 failed. Includes client request contracts, metadata and path validation, preservation of existing solutions, unsaved editor/test input, inert problem rendering, browser origin/capability checks, request/result/error lifecycle, concurrent startup, and the connector's cookie-preserving fetch behavior.
- VSIX built offline with Python standard library; VS Code CLI installed it successfully into a separate workspace-local extensions/profile directory.
- TensorTonic GitHub sign-in succeeded through the website's normal Continue with GitHub flow.
- Authenticated Python study-plan detail and its public test-case schema were observed.
- The actual website Run request was inspected to confirm `{id, inputs}` case wrappers.
- Authenticated study-plan Run: previously solved Softmax, HTTP 200, `status: passed`, 3/3 public cases.
- Authenticated study-plan Submit: same previously solved Softmax, HTTP 200, `status: passed`, 43/43 cases.
- No newly unsolved problem was marked solved during validation.

## Agent context checks

- Built-in Code Agent compose options were confirmed against the installed Code 1.141 source: actual problem, solution and test URIs are attached with `isPartialQuery: true`.
- Unit/integration tests verify current unsaved code through the registered language-model tool, correct attachments, safe statement generation and saved/unsaved note preservation.
- No Agent reply has yet been verified in the actual Code UI.

## Not completed on this host

- Actual browser-to-extension loopback connection: this execution sandbox denies opening local listening ports.
- Final extension-host UI activation test: macOS Launch Services returned `kLSNoLaunchPermissionErr` / `User doesn't have permission to launch the app (managed networks)`. Native app control also failed to return usable state. No successful extension-host test result was produced.
- Installation into the user's default VS Code profile: OS workspace restrictions denied writes to its logs and extension directory. The separate-profile install check succeeded.

The live API checks and mocked extension/transport tests are separate checks. They do not constitute a completed end-to-end test of the installed extension. The first real local installation must verify Connect browser, problem opening, Run and Submit together.

## Scope

Python free and study-plan problems, including NumPy, Pandas and PyTorch. SQL, CUDA, Triton, research/project exercises and assessments are not supported. Existing website permissions and subscription requirements remain in force.

The package contains no account cookies, session tokens, connection keys, copied website bundles or user solutions.
