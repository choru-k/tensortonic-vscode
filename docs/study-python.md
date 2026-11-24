# Study Python environment

Python environment support is optional and separate from TensorTonic's website
Run/Submit service. It helps local imports and exercises; it does not log in,
change remote grading, or run a solution automatically.

## Workspace recognition and status

**Start studying** opens a chosen local study folder in a separate VS Code window.
An existing single-folder study workspace can also be recognized from validated
TensorTonic solution metadata under the configured solution directory. Recognition
only reads bounded local metadata and matching source/context markers; it does not
execute workspace code, register a new folder, import Python or use a folder name
alone as proof. Unrecognized folders offer **Choose study workspace**.

The study sidebar keeps a visible environment row:

| Status | Meaning and action |
| --- | --- |
| Create study environment | No extension-managed environment exists for this study folder. Create opens the setup consent dialog. |
| Use study environment | A managed environment has recorded verified setup, but workspace interpreter selection differs or requires explicit activation of the Python API. Use selects that interpreter for this folder only. |
| Repair study environment | Managed metadata is incomplete, invalid, or a setup failure is known. Repair requires confirmation before validation or installation. |
| Study environment · Ready | The selected managed interpreter matches recorded verified setup metadata. This status has no setup action. |
| Study environment unavailable | Safe storage, workspace scope or the required Python API cannot be verified. It does not authorize automatic repair. |

Status reads files and the already active Python extension's selected-interpreter
API. It does not activate that extension, execute Python, test imports, install
packages, change interpreter selection, or inspect terminal `VIRTUAL_ENV`.
Recorded readiness describes the last verified setup, not a fresh dependency audit.
A selected system or project interpreter alone does not establish that this
extension's separate managed environment exists.

Reopening a previously configured study folder reuses the verified interpreter.
A missing selection is restored. A different selected interpreter is respected.
Setup and package installation are only started by an explicit action.

## Create or repair

1. Install Microsoft's **Python** extension normally if it is missing. TensorTonic
   offers an Extensions search rather than installing it silently.
2. Use **Start studying** or open a recognized trusted local study workspace.
3. Choose **Create study environment** or **TensorTonic: Set up study Python
   environment**. Review the location and download notice, then explicitly confirm.
   A fresh explicit Start may offer this same consent; ordinary activation does not
   start setup.
4. Setup uses an installed Python **3.11–3.14** in a standard supported location.
   Compatible Homebrew Python installations are eligible, including versioned
   kegs such as `/opt/homebrew/opt/python@3.13/bin/python3.13` and the equivalent
   `/usr/local/opt` path even when `python3` points to an unsupported Python 3.15.
   Runtime compatibility,
   available binary wheels and successful import checks are still required. If
   no supported runtime is found, install one from [python.org](https://www.python.org/downloads/)
   or your trusted package manager. On macOS, if an existing Homebrew installation
   is found at its standard location, Setup and Repair offer **install Python if needed** in their confirmation.
   Selecting that action authorizes the displayed Homebrew executable to run
   `install python@3.13` only if discovery finds no compatible runtime. Setup
   then continues in the same folder. The other action uses installed Python only. Declining
   makes no environment changes. The extension does not bootstrap Homebrew, use
   `sudo`, or download Python without that explicit confirmation. Without Homebrew,
   the error explains how to install a supported runtime and retry in this folder.
5. A dedicated environment is created in extension storage under
   `python-envs/<study-folder-hash>`. The hash is a stable internal storage ID.
   New environments use Python's supported `--prompt` metadata so the interpreter
   picker shows **TensorTonic** (with a short workspace name when useful) and the
   Python version. This display label does not rename or move the environment.
   Only **torch**, **numpy** and their required
   dependencies are installed from [PyPI](https://pypi.org/), using binary wheels.
   Downloads can be substantial; a tiny or CPU-only distribution is not promised.
6. After interpreter/prefix and package-import checks, the Python extension's public
   API selects the interpreter for this study folder. Selection is read back before
   success is reported. Global Python, existing project `.venv` folders and unrelated
   settings are preserved.

**Use study environment** does not install or repair anything. It rechecks the
managed metadata and explicitly selects the existing interpreter through the scoped
Python API. It may activate the Python extension, then verifies selection. If the
API is unavailable, use the offered **Python: Select Interpreter → Enter interpreter
path** guidance after setup; automatic selection is not assumed.

On a fresh explicit **Start studying**, a verified environment previously selected
with consent is reused without setup or package installation. Python's extension
may be activated; if its scoped choice is empty, the prior selection is restored.
A different current interpreter is preserved; choose **Use study environment** to
switch back explicitly. An existing verified environment without saved selection
consent offers **Use study environment** instead of repeating setup. Ordinary
activation and sidebar status updates do not perform this selection handoff.

Editor/Pylance selection and terminal activation are separate. Existing terminals
retain their environment. Open a new Python terminal when terminal activation is
needed; the extension does not inject activation into a busy terminal or change
user/global `python.defaultInterpreterPath`.

Older environments can retain the hash as their visible name until their owned
`pyvenv.cfg` receives a `prompt` label and Python's environment manager is refreshed.
Keep the interpreter path and other configuration intact; moving a virtual
environment can break absolute launcher paths. A metadata-only label change does
not update already-generated terminal activation scripts or existing terminals.

## Cancellation and safety

Setup progress is cancellable. Only its own subprocesses are stopped. Setup uses
no `sudo`, shell execution, global pip installation, arbitrary `requirements.txt`,
problem-provided package names or workspace-controlled Python executable. Caller
pip indexes, Python path injection and loader settings are not inherited.

**Repair study Python environment** explicitly validates/reinstalls the same fixed
packages. If the original system Python disappeared, Setup or Repair first finds a
compatible installed replacement (or offers the confirmed Homebrew action above).
Only after discovery succeeds, under the setup lock, the old owned environment is
retained at `python-envs/<study-folder-hash>.backup-<unique-id>/environment` and a
replacement is created at the original stable path. The backup location is shown
in progress and recorded as `previousEnvironment` in the new ownership marker.
Study files and prior contents are kept; a backup is for recovery/manual review,
not promised to run from its moved path. No backup is deleted automatically.

Declining, failed discovery, or failed Homebrew installation leaves the old
environment in place. Homebrew uses sanitized process settings, disables automatic
updates and install cleanup, and runs without a shell from extension storage.
Cancellation waits for the owned subprocess cleanup; Homebrew may retain a partial
formula installation. Retry discovers any now-compatible runtime before offering
installation again. A failed or canceled replacement setup retains both its backup
and retryable partial environment. Unknown ownership or a replaced interpreter is
refused, and a leftover setup lock is reported for review rather than removed blindly.

Automatic setup supports **macOS and Linux** in trusted local desktop study folders.
On Windows, select a manually managed interpreter; automatic setup does not start.
Remote, browser, virtual and unrelated development workspaces are outside the
managed setup scope. This feature is not a general Python/package manager.

## Verification limits

Automated tests use isolated filesystem fixtures, mocked Python APIs and synthetic
process results, including Homebrew consent, failures, cancellation and continued
setup. They do not install Python or torch/numpy or establish that package wheels,
Pylance and interpreter selection work on every host. Status inspection deliberately
does not diagnose packages removed or changed outside the setup flow.

[VS Code Python settings](https://code.visualstudio.com/docs/python/settings-reference)
explain why `defaultInterpreterPath` does not replace an already selected interpreter;
this extension uses the public scoped selection API instead.
