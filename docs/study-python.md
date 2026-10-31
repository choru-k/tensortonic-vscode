# Dedicated study Python environment (0.7.0)

**Start studying** opens the chosen local study folder in a separate VS Code window. The first explicit Start, or its fresh handoff into that new window, offers Python setup. Nothing is installed just because the extension activates. Setup and repair always require an explicit confirmation before running Python or downloading packages.

## Setup

1. Install Microsoft's **Python** extension normally if it is missing. TensorTonic only offers an Extensions search; it does not install another extension silently.
2. Open the trusted local study folder through **TensorTonic: Start studying**.
3. Accept **Set up study environment** after reviewing the location and package-download notice. You can also use **TensorTonic: Set up study Python environment** later.
4. The extension uses a compatible Python already installed in a standard system location. This release currently selects Python **3.11–3.14**. Python 3.14 is eligible, including the user’s existing Homebrew installation when a compatible binary wheel is available; it is not replaced or assumed incompatible. If no supported runtime is found, install one yourself from [python.org](https://www.python.org/downloads/) or your usual trusted package manager and retry. Actual platform-wheel availability and a successful import check remain required. No Python distribution is downloaded by this extension.
5. A separate environment is created under this extension's local VS Code storage, in `python-envs/<study-folder-hash>`. Existing project `.venv` folders and global Python are untouched. Only the fixed packages **torch** and **numpy**, plus their required dependencies, are installed from [PyPI](https://pypi.org/), using binary wheels only. Download size can be substantial, especially on Linux; this is not a promise of a tiny or CPU-only distribution.
6. After successful interpreter/prefix and import checks, the Python extension's public API selects that environment for the **study folder only**. Selection is read back before success is reported. No user/global `python.defaultInterpreterPath` setting is written. If the API is unavailable or selection cannot be verified, follow the shown **Python: Select Interpreter → Enter interpreter path** instruction; automatic selection is not claimed.

The Pylance/editor environment and local terminal execution are separate from TensorTonic's website grading. This feature helps local imports and exercises; it does not change the remote Run/Submit service, log you into the website, or run your solution automatically.

## Cancellation and repair

Progress is cancellable. Only setup's own subprocesses are stopped; unrelated Python or editor processes are never searched for or terminated. No `sudo`, shell commands, global pip install, arbitrary `requirements.txt`, problem-provided package name, or workspace-controlled Python executable is used. Pip configuration, Python path injection, and custom package indexes from the calling environment are not inherited.

Use **TensorTonic: Repair study Python environment** to explicitly validate/reinstall the fixed packages in the managed environment. Failed/canceled setup is not marked ready. Managed ownership is checked, concurrent setup is locked, and existing unowned data is never overwritten or recursively deleted. A replaced interpreter, missing original runtime, or unavailable wheel may require a guided manual step instead of an unsafe automatic repair. A crash can leave a lock; the resulting message identifies it for manual review, not blind deletion.

Automated setup in this release supports **macOS and Linux only**. On Windows, select a manually managed interpreter; no automatic setup process is started. Only trusted local desktop study folders are supported. Remote/browser workspaces and unrelated development folders are refused. Automatic setup is not a general-purpose environment manager, package installer, or Python version manager.

## Verification limits

Unit tests use synthetic process results and isolated filesystem fixtures; they do not install torch or numpy. Real process tests, if listed in the release report, use only benign synthetic child processes for cancellation. No packages were installed on the user's Mac, and real VS Code/Pylance environment selection was not visually verified. The API integration is exercised with a mock; success on a particular installation remains subject to its Python extension and runtime availability.

Reference: [VS Code Python settings](https://code.visualstudio.com/docs/python/settings-reference) notes that `defaultInterpreterPath` does not override an already selected interpreter; this implementation instead uses the public scoped environment selection API.
