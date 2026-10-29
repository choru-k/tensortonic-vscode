# Validation — 2026-10-30 (Asia/Seoul)

## Completed

- `npm test`: 38 tests passed, 0 failed. Client request contracts, metadata and path validation, preservation of existing solutions, unsaved editor/test input, inert problem rendering, browser origin/capability checks, request/result/error lifecycle, concurrent startup, cookie-preserving fetch behavior, and connection-timeout guidance are covered.
- VSIX built offline with Python standard library; VS Code CLI installed it successfully into a separate workspace-local extensions/profile directory.
- TensorTonic GitHub sign-in succeeded through the website's normal Continue with GitHub flow.
- Authenticated Python study-plan detail and its public test-case schema were observed.
- The actual website Run request was inspected to confirm `{id, inputs}` case wrappers.
- Authenticated study-plan Run: previously solved Softmax, HTTP 200, `status: passed`, 3/3 public cases.
- Authenticated study-plan Submit: same previously solved Softmax, HTTP 200, `status: passed`, 43/43 cases.
- No newly unsolved problem was marked solved during validation.
- User-launched VS Code 1.144 on the actual Mac discovered and activated the development extension and created its temporary browser connection script.
- A second actual launch through Run Without Debugging also activated the extension. Its report ended in the pairing timeout with no Run or Submit performed.
- The controlled TensorTonic browser tab was signed in. Its `local-network-access` permission state was `prompt`; browser-to-editor pairing was not established.

## Launch and connection fixes

- Code deliberately removes a requested folder from a development-host launch if that exact folder is already open in another Code window. Both launch configurations now use the distinct tracked `test/workspace` folder.
- E2E writes a running report before waiting, persists each phase, and shows connection instructions and waiting progress.
- Browser polling has a 30-second timeout with local-network permission and same-computer guidance. No Run or Submit is retried.

## Agent context checks

- Built-in Code Agent compose options were confirmed against the installed Code 1.141 source: actual problem, solution and test URIs are attached with `isPartialQuery: true`.
- Unit/integration tests verify current unsaved code through the registered language-model tool, correct attachments, safe statement generation and saved/unsaved note preservation.
- No Agent reply has yet been verified in the actual Code UI.

## Not completed on this host

- Actual browser-to-extension loopback connection and full Run/Submit/Agent sequence remain incomplete. The live run timed out waiting for browser pairing. A browser permission state of `prompt` was observed, and the automation cannot operate the containing app's permission UI.
- In a debug launch, Code logged `TypeError: Missing dataLength in event` from Node's inspector network instrumentation before the renderer terminated the host. These observations do not establish that this error caused the termination. Run Without Debugging avoids attaching that debugger for the diagnostic retry.
- Earlier agent-side CLI launches failed with macOS Launch Services `kLSNoLaunchPermissionErr`; actual UI activation was subsequently reached in the user-launched Code app.
- Installation into the user's default VS Code profile: OS workspace restrictions denied writes to its logs and extension directory. The separate-profile install check succeeded.

The live API checks and mocked extension/transport tests are separate checks. They do not constitute a completed end-to-end test of the installed extension. The first real local installation must verify Connect browser, problem opening, Run and Submit together.

## Scope

Python free and study-plan problems, including NumPy, Pandas and PyTorch. SQL, CUDA, Triton, research/project exercises and assessments are not supported. Existing website permissions and subscription requirements remain in force.

The package contains no account cookies, session tokens, connection keys, copied website bundles or user solutions.
