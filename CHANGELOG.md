# Changelog

## 0.3.0

- Replace console pasting with a separate Manifest V3 browser companion popup. It uses only the `activeTab` and `scripting` permissions; browser installation requires separate user approval.
- Add two-minute, single-use pairing codes, host/origin/session validation, and rejection of reused codes and excessive attempts. Login cookies are never copied or stored.
- Copy pairing codes to the clipboard only through the explicit Copy action; keep them out of documents and logs.
- Fix a startup race where disconnecting could prevent a later reconnection.
- Prevent stale problem-list and problem-open responses from overwriting the latest selection.
- Keep Agent context aligned with the reselected solution tab, and update only the explicitly requested solution's document for Description.
- Lock the entire Run/Submit command against duplicate execution; cancel transmission if the connection changes while reading inputs.
- Add real loopback HTTP integration tests and safe, simulated grading checks in a real VS Code host.
- Standardize repository documentation, companion UI, Agent prompts, and test instructions in English while preserving upstream problem content and intentional multilingual fixtures.

## 0.2.1

- Open a separate test folder in the development host instead of reusing the parent window's folder.
- Add connection instructions, waiting status, and phase-by-phase reports for the live-account E2E test.
- Add timeouts to local connection requests and guidance for checking browser network permissions.
- Document extension activation and connection-wait observations from the actual Mac.

## 0.2.0

- Add Markdown problem statements and equation previews.
- Attach problem, solution, and test files together in Agent chat.
- Add a context tool for reading the current problem and unsaved editor code.
- Support an optional Codex file-attachment command.
- Preserve personal edits in generated problem files.
- Add a live-account E2E configuration and report for use in real VS Code.

## 0.1.0

- Browse TensorTonic Python problems and study plans in the sidebar.
- Open problem descriptions, local solution files, and editable JSON test cases.
- Use TensorTonic's grading service through Run/Submit CodeLens actions.
- Connect a signed-in browser tab while keeping login cookies in the browser.
- Build an installable VSIX without npm dependencies.
