# TensorTonic for VS Code — Unofficial

Browse TensorTonic problems, write Python solutions in VS Code, and use **Run** or **Submit** to receive grading results. The default study plan is `pytorch-basics`.

This unofficial extension currently supports free Python problems and Python study-plan problems. SQL, CUDA, Triton, and separate project or interview exercises are not supported. TensorTonic's normal account and subscription requirements still apply.

## Installation

Download [TensorTonic 0.9.0 for VS Code](releases/tensortonic-vscode-0.9.0.vsix) or the [0.9.0 install bundle](releases/tensortonic-native-browser-0.9.0.zip). In the Extensions view, choose **… → Install from VSIX…**, select the package, and reload the window if prompted. From a repository checkout:

```sh
code --install-extension releases/tensortonic-vscode-0.9.0.vsix
```

**0.9.0 is native-only.** It requires a trusted local VS Code desktop window with supported **Integrated Browser** and the built-in **JavaScript debugger** enabled. Native operation was validated on VS Code **1.144.0**; an older host merely accepting installation does not establish runtime compatibility. If Connect reports that the route is unavailable, update VS Code and enable its built-in debugger normally. VS Code for the Web, remote workspaces, and alternative editors without these APIs are not supported. Do not bypass organizational restrictions.

No Chrome/Helium browser companion, pairing code, or separate browser-extension permission is needed. This release does not include a companion or a Legacy connection selector. Earlier release files and implementation history remain in Git history rather than the current release tree. An existing browser companion is not automatically uninstalled by this package.

## Start studying without disturbing your development workspace

1. Run **TensorTonic: Start studying** from the Command Palette or Study plan toolbar. First choose a dedicated existing local folder, such as `TensorTonic Study`. Canceling the picker changes nothing.
2. VS Code opens that folder in a **new window**. Your development window, workspace, tabs, and unsaved code stay in place. The extension remembers the chosen folder on this computer; running Start studying from that same single-folder study window reuses it.
3. The study window opens the **Study plan** sidebar when its short-lived launch handoff is available. A fresh Start may offer dedicated Python setup, but runs no installer until you explicitly accept. Connect the built-in browser in this study window, sign in normally, and refresh problems.
4. Next time, run Start studying again. To choose a different destination, use **TensorTonic: Start studying in another folder…**. Existing study files are not moved or copied.

Default files are stored under `<study folder>/tensortonic/<plan>/`: your `.py` solution, editable `.tests.json`, and generated `.problem.md` statement. `tensortonic.solutionDirectory` can change the relative `tensortonic` subfolder. Existing solution/test files are not overwritten on reopening; personal edits to generated Markdown are protected. Earlier test-workspace files remain where they were—Start studying does not import or delete them.

The remembered study folder does **not** redirect problem operations in another window. Opening a problem in an ordinary project window still stores files in that project's configured solution folder. Multi-root and saved `.code-workspace` windows are preserved by opening a separate folder window; Explorer, layout, roots, and trust settings are not rewritten. Review normal workspace-trust prompts yourself.

Only an explicit Start command requests a new window. Ordinary activation does not open one, connect a browser, or install Python packages. A matching short-lived handoff may focus the study sidebar once; if it is unavailable, use **TensorTonic: Show study plan sidebar**. Simultaneous Start requests can supersede a handoff; uncertain window opens are not automatically retried.

## Connect the built-in browser

1. Run **TensorTonic: Connect browser** in the trusted local study window.
2. Review **Connect built-in browser**. The extension opens a dedicated TensorTonic page in VS Code's Integrated Browser and uses only its own debug-session tree.
3. Sign in normally in that page, including any GitHub sign-in or 2FA. Confirm the intended account. Passwords, cookies, browser storage values, session tokens, and Authorization headers are not extracted or copied.
4. Use **Refresh problems** or Connect again after login. Connected transport does not guarantee that website login, subscription access, or every API request has succeeded.

After restarting VS Code, use Connect again; the extension does not attach or launch on ordinary startup. Website login lifetime follows the website and VS Code's existing browser-storage configuration—there is no fixed 30-day login promise. No browser storage, authentication, or global debug setting is changed.

**Disconnect browser** stops the owned connection, not unrelated user debug sessions. It does not sign you out or erase cookies. If cleanup is unconfirmed, follow the reported instruction and use the owned session's normal Stop control; do not silently reuse an uncertain connection.

See [native connection, scoped debugger behavior, privacy, and validation boundaries](docs/native-browser.md).

## Solve problems

- Open the **TensorTonic** activity-bar icon or run **Show study plan sidebar**. The Study plan view shows the original ordered sections and clickable problems. Section/plan headers show solved counts, checkmarks reflect website progress, and **Current** marks the selected solution.
- Choose a problem to open its statement and Python solution side by side. Switching solution tabs updates the selected sidebar row only when the TensorTonic view is already visible, without moving keyboard focus or changing the chosen plan.
- Use **Choose study plan** to enter the `studyPlan` slug from a problem URL. Leave it empty for free problems. **Refresh problems** updates progress without changing Explorer or deleting files.
- Use **Run**, **Submit**, **Description**, and **Test cases** above the solution. **Run** uses the adjacent editable `.tests.json` array. **Submit** sends the current editor code, including unsaved edits, to TensorTonic. Execution and grading occur on TensorTonic's servers.
- **Previous problem** and **Next problem** follow the open solution's study plan, stop at the ends without wrapping, and preserve existing files and unsaved edits.
- Results show the reported outcome, passed/total counts, and runtime first. Expand test details or **Raw response (JSON)** as needed. Missing counts, timings, and cases are identified rather than fabricated.
- A solved checkmark is progress, not an imported solution. New files contain starter code even for solved problems. Importing earlier website submissions is not implemented; copy your own saved code if needed.

Keep the `# tensortonic: {...}` metadata on the solution's first line; it associates the file with its problem. A Run/Submit is dispatched **at most once**. Timeout or cancellation can leave the result uncertain: inspect the website before explicitly trying again. The extension never automatically retries grading or switches to another transport.

## Choose Markdown or Web problem view

Use **TensorTonic: Choose problem view (Markdown / Web)** in the command palette or study sidebar toolbar, or set `tensortonic.problemView` to `web`. The default is `markdown`. The command saves the preference to the current workspace, or user settings when no workspace is open. Changing it alone does not navigate or rewrite your solution.

**Markdown** uses VS Code's built-in local preview and math renderer. If that renderer is unavailable, a labeled inert plain-text fallback remains. The extension does not change preview security or `markdown.math.enabled`, or load a remote renderer.

**Web** opens the original TensorTonic problem and interactive cards in the owned Integrated Browser beside the preserved Python editor when you explicitly open a problem or use Previous/Next. Only the expected TensorTonic study surface is reused; login, account, and manually navigated external pages are not hijacked. Native connection works with either presentation mode. **Show problem description** remains an explicit Markdown option, and dirty solution files remain protected.

If Web presentation cannot be opened safely, the local Markdown description remains available. This does not provide an alternative connection for an unsupported host: update to a supported local VS Code rather than installing a legacy transport.

## Original interactive explanations

Use **Interactive explanation** above a solution, the sidebar context action, or **Open original problem in VS Code** to view the actual TensorTonic page. The website renders its own cards and enforces its own account/subscription access. The complete page may include its navigation and editor—not just an explanation card.

This is normal top-level native browser navigation, **not an iframe, copied page, reverse proxy, or header/CSP bypass**. Sign in normally in the Integrated Browser; another browser's session is not transferred. The website's own editor and actions are separate from sending your local Python file through this extension's Run/Submit.

An explicit **Open original problem in browser** action remains available for ordinary external viewing. Opening an external page does not connect it to this extension or restore unsupported native transport. Requesting navigation is not proof that loading, authentication, or entitlement succeeded.

## Dedicated local Python setup

The first explicit **Start studying**, or its fresh handoff, offers a private environment after confirmation. It uses a supported installed Python, downloads fixed **torch** and **numpy** packages plus dependencies from PyPI into extension-owned storage, validates imports, and selects that interpreter only for the study folder through the Python extension's public API.

It does not replace global Python, overwrite a project `.venv`, install on ordinary activation, run your solution, or change remote grading. Setup and repair are cancellable. Use **Set up study Python environment** or **Repair study Python environment** later. Unsupported runtimes, unavailable wheels, or unverified interpreter selection produce actionable guidance rather than a false success. See [setup, supported runtimes, cancellation, and verification limits](docs/study-python.md).

## Discuss problems with an Agent

- **Discuss with Agent** attaches the problem statement, current solution, and tests to VS Code's built-in Agent chat. It opens a draft; you send it yourself.
- The Agent reads generated `.problem.md` source. Keep personal notes separately; edited generated files are not overwritten.
- `#tensortonicProblem` reads the selected problem and current unsaved code. It does not run/submit or retrieve reference solutions.
- The English discussion draft asks for one learning step at a time without a complete answer unless requested. Edit the draft or choose another language as needed.
- **Attach problem and solution to Codex** requires a Codex extension version exposing its attachment command. Built-in Chat and Codex integration are separate.

## Settings and diagnostics

| Setting | Default | Purpose |
| --- | --- | --- |
| `tensortonic.studyPlan` | `pytorch-basics` | Study-plan slug; empty means free problems |
| `tensortonic.solutionDirectory` | `tensortonic` | Relative solution folder inside the workspace |
| `tensortonic.problemView` | `markdown` | Markdown or original Web presentation for explicit problem navigation |

**Check connection and problem access** reads the connection, problem list, statement, and starter-code access. Sanitized results appear in **Output → TensorTonic**. TensorTonic's web-client API has no official compatibility guarantee, so site changes can require updates.

## Optional offline learning explorations

**Offline learning exploration** opens a separately named local experiment without replacing the statement or changing your solution. All 30 supported PyTorch basics identities have independently authored numerical examples covering tensors, derivatives, layers, normalization, losses, training, data sampling, convolution, recurrence, attention, and beam search. Unsupported identities show an explicit unavailable notice.

These are illustrative mathematical experiments, not TensorTonic's original cards, reference solutions, or exact PyTorch API emulations. They run offline with bounded inputs and bundled scripts, make no service requests, and do not run/submit student code. Reopening resets the example; use **Calculate** and **Reset example** to explore it.

## Validation status

Native **0.8.0** was validated on the user's Mac with VS Code **1.144.0**: connection, a 30-problem list, full JSON retrieval, Markdown, dirty temporary-solution preservation, Web navigation, cancellation, and reconnect. One explicitly approved already-solved solution was run once and submitted once. These observations belong to that version and scope; they are not blanket proof for every host or subsequent change.

**0.9.0** removes the legacy transport and adds debugger presentation settings scoped to its owned session. Its current code has automated regression coverage; the new session-presentation behavior awaits the separately coordinated read-only native UI check. No additional live grading is implied. Dedicated Python installation and every platform combination are not established by the earlier native validation. See [current validation scope](docs/native-browser.md#validation).

## Development and packaging

The extension build needs no external npm packages. With Node.js and Python 3 installed:

```sh
npm test
npm run test:transport
python3 scripts/package.py
```

`test:transport` exercises the native bridge and request policy with simulated debug-adapter/page behavior. Automated tests do not authenticate a real account or authorize live grading. The VSIX is built from an explicit source allowlist; do not package credentials, browser data, user solutions, or runtime logs.

For a permitted local host check, use a separate review workspace and a fresh profile as appropriate. `test/vscode-native-readonly-validation.js` is an optional actual-host runner gated by `TENSORTONIC_TEST_ALLOW_REAL_READ=1`; it requires explicit authorization, uses fixed read endpoints, and does not contain Run/Submit. Real grading tests require separate approval for the exact existing solution and action. Never rerun an uncertain Submit automatically.

Maintain English repository documentation, UI text, code comments, and test descriptions while preserving upstream text and intentional multilingual fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgments

The problem-browser, description, and Run/Submit workflow was inspired by the [LeetCode OpenSource VS Code extension](https://github.com/LeetCode-OpenSource/vscode-leetcode). Its service-specific CLI and authentication code are not included. This implementation is MIT-licensed. TensorTonic's name and service belong to their respective owners.
