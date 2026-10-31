'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { STUDY_FOLDER_KEY } = require('./study-workspace');
const { StudyEnvironment } = require('./study-environment');

function waitCancelable(value, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { const error = new Error('Study setup canceled.'); error.name = 'AbortError'; reject(error); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

class StudyEnvironmentUI {
  constructor(vscode, context, { factory = options => new StudyEnvironment(options) } = {}) {
    this.vscode = vscode;
    this.context = context;
    this.factory = factory;
    this.running = undefined;
    this.disposed = false;
    this.controller = undefined;
  }

  dispose() { this.disposed = true; if (this.controller) this.controller.abort(); }

  studyFolder() {
    if (this.disposed) return undefined;
    const v = this.vscode;
    if (v.env.uiKind !== v.UIKind.Desktop || v.env.remoteName || v.workspace.isTrusted !== true || v.workspace.workspaceFile) return undefined;
    const folders = v.workspace.workspaceFolders;
    if (!Array.isArray(folders) || folders.length !== 1) return undefined;
    const uri = folders[0].uri;
    if (uri.scheme !== 'file' || uri.authority || !uri.fsPath) return undefined;
    const remembered = this.context.globalState.get(STUDY_FOLDER_KEY);
    if (typeof remembered !== 'string') return undefined;
    let selected;
    try { selected = v.Uri.parse(remembered); } catch (_) { return undefined; }
    if (selected.scheme !== 'file' || selected.authority || path.resolve(selected.fsPath) !== path.resolve(uri.fsPath)) return undefined;
    return uri;
  }

  isCurrent(folder) {
    const current = this.studyFolder();
    return !!current && path.resolve(current.fsPath) === path.resolve(folder.fsPath);
  }

  readyKey(folder) {
    return 'tensortonic.pythonEnvironment.v1.' + crypto.createHash('sha256').update(path.resolve(folder.fsPath)).digest('hex');
  }

  environment(folder) {
    const storage = this.context.globalStorageUri;
    if (!storage || storage.scheme !== 'file' || !storage.fsPath) throw new Error('Local extension storage is unavailable. Python setup was not started.');
    return this.factory({ managedRoot: path.join(storage.fsPath, 'python-envs'), workspaceRoot: folder.fsPath });
  }

  // A fresh Start Studying handoff offers the same explicit consent as a direct
  // command. Ordinary activation neither installs packages nor executes Python.
  offer() { return this.run({ firstStart: true }); }
  repair() { return this.run({ repair: true }); }
  setup() { return this.run({}); }

  run(options) {
    if (this.running) return this.running;
    const task = this.runOnce(options);
    this.running = task;
    task.then(() => { if (this.running === task) this.running = undefined; }, () => { if (this.running === task) this.running = undefined; });
    return task;
  }

  async runOnce({ firstStart = false, repair = false } = {}) {
    const v = this.vscode;
    const folder = this.studyFolder();
    if (!folder) {
      if (!firstStart) await v.window.showInformationMessage('Open your trusted local TensorTonic study folder with Start studying before setting up Python. No development environment was changed.');
      return { status: 'not-study-window' };
    }
    const environment = this.environment(folder);
    const inspected = await environment.inspect();
    if (!this.isCurrent(folder)) return { status: 'cancelled' };
    const ready = this.context.globalState.get(this.readyKey(folder));
    const python = v.extensions.getExtension('ms-python.python');
    if (firstStart && ready && ready.selected === true && inspected.managed && inspected.exists &&
        ready.interpreterPath === inspected.interpreterPath && python && python.isActive &&
        python.exports && python.exports.environments && typeof python.exports.environments.getActiveEnvironmentPath === 'function') {
      const active = await python.exports.environments.getActiveEnvironmentPath(folder);
      if (!this.isCurrent(folder)) return { status: 'cancelled' };
      if (active && typeof active.path === 'string' && [ready.interpreterPath, inspected.environmentPath].filter(Boolean).some(candidate => path.resolve(active.path) === path.resolve(candidate))) {
        return { status: 'already-configured', interpreterPath: ready.interpreterPath };
      }
    }
    if (!python) {
      const choice = await v.window.showInformationMessage('TensorTonic Python setup needs Microsoft’s Python extension to select the study interpreter. Install it normally, then run TensorTonic: Set up study Python environment.', 'Find Python extension');
      if (choice === 'Find Python extension') await v.commands.executeCommand('workbench.extensions.search', '@id:ms-python.python');
      return { status: 'python-extension-missing' };
    }
    const title = repair ? 'Repair the TensorTonic study Python environment?' : 'Set up a dedicated TensorTonic study Python environment?';
    const choice = await v.window.showInformationMessage(title, {
      modal: true,
      detail: `Use an installed compatible Python to create or validate a private environment in VS Code extension storage for ${folder.fsPath}. Download and install only PyTorch (torch), NumPy, and their required dependencies from PyPI if needed. This can take time and significant disk/network space. Select that interpreter only for this study folder. Existing .venv folders, global Python, and unrelated workspace settings are not changed. No Python version is downloaded. You can cancel; run Setup/Repair again to retry.`,
    }, repair ? 'Repair study environment' : 'Set up study environment');
    if (choice !== (repair ? 'Repair study environment' : 'Set up study environment') || !this.isCurrent(folder)) return { status: 'cancelled' };

    const controller = new AbortController();
    this.controller = controller;
    let result;
    try {
      result = await v.window.withProgress({ location: v.ProgressLocation.Notification, title: 'TensorTonic Python environment', cancellable: true }, async (progress, token) => {
        const cancel = token.onCancellationRequested(() => controller.abort());
        try {
          if (token.isCancellationRequested) controller.abort();
          const checked = await environment.ensure({ confirmed: true, repair, signal: controller.signal, onProgress: message => progress.report({ message }) });
          if (controller.signal.aborted || !this.isCurrent(folder)) return { status: 'cancelled' };
          progress.report({ message: 'Selecting the interpreter for this study folder…' });
          if (!python.isActive) await waitCancelable(python.activate(), controller.signal);
          const exported = python.exports;
          if (exported && exported.ready && typeof exported.ready.then === 'function') await waitCancelable(exported.ready, controller.signal);
          if (controller.signal.aborted || !this.isCurrent(folder)) return { status: 'cancelled' };
          const api = exported && exported.environments;
          if (!api || typeof api.updateActiveEnvironmentPath !== 'function') {
            return { status: 'selection-unavailable', ...checked };
          }
          await waitCancelable(api.updateActiveEnvironmentPath(checked.interpreterPath, folder), controller.signal);
          if (controller.signal.aborted || !this.isCurrent(folder)) return { status: 'cancelled' };
          let selected = false;
          if (typeof api.getActiveEnvironmentPath === 'function') {
            const active = await waitCancelable(api.getActiveEnvironmentPath(folder), controller.signal);
            selected = !!active && typeof active.path === 'string' && [checked.interpreterPath, checked.environmentPath].filter(Boolean).some(candidate => path.resolve(active.path) === path.resolve(candidate));
          }
          if (controller.signal.aborted || !this.isCurrent(folder)) return { status: 'cancelled' };
          await this.context.globalState.update(this.readyKey(folder), { interpreterPath: checked.interpreterPath, selected });
          return { ...checked, status: selected ? 'ready' : 'selection-unverified' };
        } finally { cancel.dispose(); }
      });
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') return { status: 'cancelled' };
      throw error;
    } finally { if (this.controller === controller) this.controller = undefined; }
    if (result.status === 'ready') {
      await v.window.showInformationMessage(`TensorTonic study Python is ready: torch and numpy verified. Selected ${result.interpreterPath} for this study folder only.`);
    } else if (result.status === 'selection-unavailable' || result.status === 'selection-unverified') {
      const choice = await v.window.showInformationMessage(`The study environment is ready, but interpreter selection could not be verified. Use Python: Select Interpreter → Enter interpreter path and choose ${result.interpreterPath}.`, 'Select interpreter');
      if (choice === 'Select interpreter' && this.isCurrent(folder)) await v.commands.executeCommand('python.setInterpreter');
    }
    return result;
  }
}
module.exports = { StudyEnvironmentUI };
