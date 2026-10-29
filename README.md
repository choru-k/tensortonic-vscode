# TensorTonic for VS Code — Unofficial

Browse TensorTonic problems in VS Code, write Python solutions, and use **Run** or **Submit** to receive grading results. The default study plan is `pytorch-basics`.

This is not an official TensorTonic extension. It currently supports free Python problems and Python study-plan problems. SQL, CUDA, Triton, and separate project or interview exercises are not supported.

## Installation

Requires VS Code 1.95 or later. In the Extensions view, choose `…` → **Install from VSIX…** and select the package, or run:

```sh
code --install-extension releases/tensortonic-vscode-0.3.0.vsix
```

Open a local folder for your solutions in VS Code, then select the TensorTonic activity-bar icon.

## Connect your browser — no console required

Install the **TensorTonic Browser Companion** once, then pair it with VS Code. GitHub sign-in, passwords, and login cookies stay in the browser. The current distribution is an unpacked browser extension supplied in the [companion ZIP](releases/tensortonic-browser-companion-0.1.0.zip), not a Chrome Web Store listing. Read the [installation, permissions, and troubleshooting guide](docs/browser-companion.md) first. If your organization blocks installation, do not disable or bypass its policy.

1. In a browser **on the same computer as VS Code**, sign in to [TensorTonic](https://www.tensortonic.com/) normally. Complete GitHub sign-in and 2FA on the website, and confirm that you are using the intended account.
2. In VS Code, run **TensorTonic: Connect browser companion** and choose **Copy pairing code**.
3. Open the companion popup on the signed-in TensorTonic tab, paste the code, and select **Connect this tab**. No DevTools or console is needed.
4. If the browser asks for local-network access, review the request. This is a temporary connection to `127.0.0.1` on the same computer and must be permitted by your browser and organization. Keep the tab open.

Each pairing code expires after two minutes and can be used only once. Issuing a new code, disconnecting, or restarting VS Code invalidates the old code. Pair again after refreshing the tab. Do not share the code. The popup clears its input after a connection attempt; it does not export login cookies to VS Code or save them to files or extension storage. Copying the one-use code into the popup is still required.

Use **Disconnect browser** in VS Code or **Disconnect** in the companion to end the session. Disconnect before switching to another tab or account. A browser on another computer or VM cannot reach your computer's `127.0.0.1` listener.

## Solve problems

- Select a problem in the sidebar to open its description and solution file side by side.
- Use the **Run**, **Submit**, **Description**, and **Test cases** buttons above the solution.
- **Run** uses the adjacent `.tests.json` file. You can edit it, but keep it as a JSON array.
- **Submit** sends the current editor code to TensorTonic and displays its grading result. Both execution and grading run on TensorTonic's servers.
- Reopening a problem does not overwrite existing solution or test files.
- Use **Choose study plan** with the `studyPlan` value from a problem URL to switch plans. Leave it empty to browse free problems.

Keep the `# tensortonic: {...}` metadata on the solution's first line: it associates the file with its problem. The default location is `tensortonic/<study-plan>/` inside the current workspace.

## Discuss problems with an Agent

- Select **Discuss with Agent** above a solution to attach the problem statement, current solution, and tests to VS Code's built-in Agent chat. The question opens as a draft; you send it yourself.
- Read the problem's equations and examples in the adjacent Markdown preview. The Agent reads the generated `.problem.md` source file. Keep personal notes in a separate file; if you edit a generated problem file, the extension will not overwrite it.
- An Agent can use `#tensortonicProblem` to read the selected problem and **current unsaved editor code**. The tool does not run or submit code, or retrieve reference solutions.
- The English discussion prompt asks for one learning step at a time, without a complete answer unless you request one. You can edit the draft or ask the Agent to use another language.
- If you use the Codex extension, **TensorTonic: Attach problem and solution to Codex** adds those two files. This requires a Codex version that exposes its file-attachment command. Built-in Chat and Codex integration are separate.

## Settings and diagnostics

| Setting | Default | Purpose |
| --- | --- | --- |
| `tensortonic.studyPlan` | `pytorch-basics` | Study-plan slug; leave empty for free problems |
| `tensortonic.solutionDirectory` | `tensortonic` | Relative solution folder inside the workspace |

**TensorTonic: Check connection and problem access** checks the connection, problem list, statement, and starter-code access. Results appear in **Output → TensorTonic**.

The extension uses API contracts observed in TensorTonic's web client. There is no official API guarantee, so site changes may require integration updates. Existing TensorTonic subscription requirements still apply to paid problems. Confirm the signed-in account before connecting.

## Validation status

Official VS Code on the assistant's Linux VM was used to check the real extension host: commands, problem files, CodeLens, unsaved edits, simulated Run/Submit, and Agent file attachments. Real loopback HTTP tests and unit regression tests are also provided. The [detailed validation record](docs/vm-validation.md) distinguishes simulated responses from actual browser validation.

**Installing the companion and testing it with a live account in the managed browser remain incomplete.** The user approved installation, but this environment's browser automation policy blocked navigation to `chrome://extensions`; no installation or activation was performed, and no alternate route was used to bypass the restriction. Earlier website API observations of Run 3/3 and Submit 43/43 do not establish that the installed companion works end to end with VS Code. An Agent's actual response has not been automatically requested or verified either.

## Development and packaging

No external npm packages are required. Install Node.js and Python 3, then run:

```sh
npm test
npm run test:transport
python3 scripts/package.py
python3 scripts/package_companion.py
```

Open this source folder in VS Code and launch **Run TensorTonic extension** to use an Extension Development Host. The development host opens the separate `test/workspace` folder: passing the source folder already open in the parent window can cause VS Code to remove the duplicate folder and open an empty window. Remote SSH, containers, and VS Code for the Web are not supported. The extension and browser must run on the same computer.

`test:transport` opens real loopback HTTP ports and requires permission to do so. It does not sign in, call the live API, or submit to the service. `test/vscode-mock-integration.js` uses the real VS Code API and a local connection but simulates the browser and upstream grading responses. See the [Linux VM validation record](docs/vm-validation.md) for commands and live-account limitations.

Repository documentation, maintained UI text, code comments, and test descriptions are written in English. Preserve upstream problem text and intentional multilingual test fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and review guidelines.

## Run the live-account E2E test

This configuration uses the real VS Code host and a signed-in account, not a mock server.

1. Open this repository folder in VS Code.
2. In Run and Debug, select **TensorTonic: live account E2E**, then use **Run → Run Without Debugging**. A Node network-instrumentation error was observed in the installed VS Code during a debug launch; its relationship to the test window closing was not established.
3. The companion must already be installed in a permitted browser. In the development host, choose **Copy pairing code** and enter it in the companion popup on your signed-in TensorTonic tab. The browser must be on the same computer and allow the local-network connection.
4. The runner saves progress to `dist/e2e-report.json` in **the repository from which it was launched**. It submits only the already-solved **Softmax from Scratch** problem again; it stops if that problem is unsolved for the current account.

The development-host window may close when the test ends or the connection wait expires. Use **Run TensorTonic extension** instead if you want to keep solving problems or chatting with an Agent.

The test checks opening and editing a problem, Run, Submit, the Agent context tool, and chat attachments. Whether the Agent understands the problem in its actual response must be checked separately in chat; the automated report does not mark that as verified.

## Acknowledgments

The problem browser, description panel, and Run/Submit CodeLens workflow were inspired by the [LeetCode OpenSource VS Code extension](https://github.com/LeetCode-OpenSource/vscode-leetcode). Its LeetCode-specific CLI and authentication code are not included. This implementation is licensed under MIT. The TensorTonic name and service belong to their respective owners.
