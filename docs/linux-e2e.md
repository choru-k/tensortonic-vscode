# Linux extension-host smoke

Run from a clean, committed checkout on native Linux x64 as a non-root user:

```sh
npm run test:e2e:linux
```

No npm packages, sudo, global installs or Docker security changes are needed.
Use Node 24+ with `node:sqlite`, Git, curl, tar, apt-get, dpkg-deb, xauth,
xkbcomp, dbus-run-session and VS Code's desktop shared-library dependencies.
Ubuntu 26.04 x64 supplies these prerequisites on the development host. When
`/usr/bin/Xvfb` is absent, the runner downloads the configured distribution's
`xvfb` package and extracts it in its own scratch directory. Missing shared
libraries remain an actionable startup failure; the runner does not install them.
Native unprivileged user namespaces must be available for Chromium's sandbox.

The runner downloads official VS Code **1.144.0**, verifies its pinned SHA-256
and embedded version/commit, and caches only the archive under
`.agent/linux-e2e/cache`. Downloads and setup commands have finite timeouts.
Each run stages `git archive HEAD`, creates a fresh empty-window working directory, profile,
extensions directory, HOME and XDG directories, and starts its own authenticated
Xvfb without TCP listening. The desktop child receives an allowlisted environment
without inherited VS Code/Electron forwarding or account/session variables.
No browser proposal opt-in or Chromium sandbox bypass is used. Settings apply
only to the disposable profile. Workspace trust keeps its default behavior; no
folder is opened. A short task-owned `/tmp/tensortonic-e2e-*` directory holds
disposable IPC sockets to fit Linux's socket path limit and is removed afterward;
all execution evidence stays under `.agent/`.

The existing `test/vscode-smoke.js` runs inside the real extension host. Success
requires both exit zero and fresh JSON confirming the exact host version,
activation and disconnected state. The smoke also checks every exported command
is registered. This verifies disconnected discovery/activation/commands only;
it does not validate login, encrypted persistence, live requests, grading or UI.

Reports, command exit codes, SHA, archive checksum, desktop logs and successful
`smoke.json` stay under ignored `.agent/linux-e2e/run-*`. Do not commit personal
execution reports. Scratch profiles and runner-owned process groups are cleaned
on success, failure and timeout. The desktop timeout defaults to 120 seconds;
`TENSORTONIC_E2E_TIMEOUT_SECONDS=30 npm run test:e2e:linux` overrides it (1–600).
A timeout exits 124; command failures propagate nonzero; invalid/missing evidence
exits 1. Read the report's failure phase and logs before retrying.

On the headless development Mac, commit first: `linux-run` transfers only HEAD.
Check that no Electron/Playwright job is active immediately before E2E, then run
the command on Linux:

```sh
ssh linux "pgrep -fl 'electron|playwright'"
linux-run 'npm test && npm run test:e2e:linux'
```

An empty `pgrep` result exits 1 and means no matching job. Also inspect any other
VS Code test-host processes before starting another run. Keep Linux reports before
`linux-run --clean`; they are not automatically copied by that helper. Assertion
failure and timeout propagation can be checked in a disposable committed worktree
by changing only its smoke assertion or by selecting the short timeout. Never
weaken the real smoke assertions in the maintained checkout.
