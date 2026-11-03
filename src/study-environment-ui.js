'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { STUDY_FOLDER_KEY } = require('./study-workspace');
const { StudyEnvironment } = require('./study-environment');
const { recognizeStudyFolder, configuredDirectory } = require('./study-folder-detector');

function waitCancelable(value, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { const error = new Error('Study setup canceled.'); error.name = 'AbortError'; reject(error); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

class StudyEnvironmentUI {
  constructor(vscode, context, { factory = options => new StudyEnvironment(options), recognize = recognizeStudyFolder, getSessionEpoch = () => 0 } = {}) {
    this.vscode = vscode;
    this.context = context;
    this.factory = factory;
    this.recognize = recognize;
    this.getSessionEpoch = getSessionEpoch;
    this.recognized = undefined;
    this.recognitionGeneration = 0;
    this.running = undefined;
    this.disposed = false;
    this.controller = undefined;
    this.revision = 0;
    this.scopeRevision = 0;
    this.listeners = new Set();
    this.subscriptions = [];
    this.unverified = new Set();
    this.onDidChange = (listener, thisArgs, disposables) => {
      const callback = thisArgs ? listener.bind(thisArgs) : listener;
      if (!this.disposed) this.listeners.add(callback);
      const subscription = { dispose: () => this.listeners.delete(callback) };
      if (Array.isArray(disposables)) disposables.push(subscription);
      return subscription;
    };
    const watch = (owner, name, callback) => {
      if (owner && typeof owner[name] === 'function') this.subscriptions.push(owner[name](callback));
    };
    const scopeChanged = () => {
      this.invalidateSession();
    };
    watch(vscode.workspace, 'onDidChangeWorkspaceFolders', scopeChanged);
    watch(vscode.workspace, 'onDidGrantWorkspaceTrust', scopeChanged);
    watch(vscode.workspace, 'onDidChangeConfiguration', event => {
      if (!event || typeof event.affectsConfiguration !== 'function' || event.affectsConfiguration('tensortonic.solutionDirectory')) scopeChanged();
      else if (event.affectsConfiguration('python') || event.affectsConfiguration('tensortonic')) this.changed();
    });
    watch(vscode.extensions, 'onDidChange', () => { this.watchPython(undefined); this.changed(); });
  }

  dispose() {
    this.disposed = true; this.revision++;
    this.recognized = undefined; this.recognitionGeneration++;
    if (this.controller) this.controller.abort();
    this.watchPython(undefined);
    for (const subscription of this.subscriptions) if (subscription && typeof subscription.dispose === 'function') subscription.dispose();
    this.subscriptions = []; this.listeners.clear();
  }

  changed() {
    this.revision++;
    if (!this.disposed) for (const listener of this.listeners) { try { listener(); } catch (_) { /* One UI subscriber cannot block another. */ } }
  }

  invalidateSession() {
    this.scopeRevision++;
    this.recognized = undefined;
    this.recognitionGeneration++;
    if (this.controller) this.controller.abort();
    this.changed();
  }

  watchPython(api) {
    if (this.pythonApi === api) return;
    if (this.pythonSubscription) this.pythonSubscription.dispose();
    this.pythonApi = api; this.pythonSubscription = undefined;
    if (!this.disposed && api && typeof api.onDidChangeActiveEnvironmentPath === 'function') {
      this.pythonSubscription = api.onDidChangeActiveEnvironmentPath(() => this.changed());
    }
  }

  verified(inspected, folder) {
    // inspect validates ownership, the interpreter, and pyvenv.cfg using files
    // only. A ready marker records the last successful torch/numpy import check;
    // status never upgrades unknown metadata into a fresh health claim.
    if (!inspected || typeof inspected.interpreterPath !== 'string' || !path.isAbsolute(inspected.interpreterPath) ||
        typeof inspected.environmentPath !== 'string' || !path.isAbsolute(inspected.environmentPath)) return false;
    const relative = path.relative(inspected.environmentPath, inspected.interpreterPath);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
    const inStudy = path.relative(folder.fsPath, inspected.environmentPath);
    if (!inStudy || (inStudy !== '..' && !inStudy.startsWith('..' + path.sep) && !path.isAbsolute(inStudy))) return false;
    return inspected.exists === true && inspected.managed === true && inspected.ready === true &&
      inspected.marker && inspected.marker.state === 'ready' &&
      !this.unverified.has(this.readyKey(folder));
  }

  matches(active, inspected) {
    return !!active && typeof active.path === 'string' && path.isAbsolute(active.path) &&
      [inspected.interpreterPath, inspected.environmentPath].filter(Boolean).some(candidate => path.resolve(active.path) === path.resolve(candidate));
  }

  async status() {
    const hidden = reason => ({ state: 'not-study-window', label: '', command: undefined, ...(reason ? { reason } : {}) });
    const choose = () => ({ state: 'not-study-window', label: 'Choose study workspace', command: 'tensortonic.startStudying' });
    const unavailable = (reason, canUse = false) => ({ state: canUse ? 'use' : 'unavailable', label: canUse ? 'Use study environment' : 'Study environment unavailable', command: canUse ? 'tensortonic.useStudyEnvironment' : undefined, reason });
    if (this.disposed) return hidden();
    if (!this.supportedLocal()) return unavailable('unsupported-window');
    const revision = this.revision;
    const scope = this.scope();
    if (!scope) return choose();
    if (this.running) return this.studyFolder() ? unavailable('operation-in-progress') : hidden();
    const folder = await this.resolveStudyFolder();
    if (!folder) return this.revision !== revision || !this.sameScope(scope) ? hidden('stale') : choose();
    const current = () => this.revision === revision && this.sameScope(scope) && this.isCurrent(folder);
    let inspected;
    try { inspected = await this.environment(folder).inspect(); }
    catch (_) { return current() ? unavailable('inspection-failed') : hidden('stale'); }
    if (!current()) return hidden('stale');
    if (inspected && inspected.exists === false) return { state: 'missing', label: 'Create study environment', command: 'tensortonic.setupStudyEnvironment' };
    if (!inspected || inspected.managed !== true) return unavailable('unmanaged-environment');
    if (!this.verified(inspected, folder)) return { state: 'repair', label: 'Repair study environment', command: 'tensortonic.repairStudyEnvironment', reason: 'health-unknown' };
    try {
      const python = this.vscode.extensions.getExtension('ms-python.python');
      if (!python) return unavailable('python-extension-missing');
      // Activation can start Python discovery. Only an explicit Use/Setup action
      // may activate it; a footer refresh reads an already active public API.
      if (!python.isActive) return unavailable('python-inactive', true);
      const api = python.exports && python.exports.environments;
      if (!api || typeof api.getActiveEnvironmentPath !== 'function') return unavailable('selection-api-unavailable');
      this.watchPython(api);
      const active = await api.getActiveEnvironmentPath(folder);
      if (!current()) return hidden('stale');
      if (!active || typeof active.path !== 'string' || !active.path) return unavailable('selection-unknown', typeof api.updateActiveEnvironmentPath === 'function');
      if (this.matches(active, inspected)) return { state: 'ready', label: 'Study environment ready', command: undefined, health: 'recorded' };
      if (typeof api.updateActiveEnvironmentPath !== 'function') return unavailable('selection-api-unavailable');
      return { state: 'use', label: 'Use study environment', command: 'tensortonic.useStudyEnvironment', health: 'recorded' };
    } catch (_) { return current() ? unavailable('selection-unavailable') : hidden('stale'); }
  }

  supportedLocal() {
    const v = this.vscode;
    return !this.disposed && v.env.uiKind === v.UIKind.Desktop && !v.env.remoteName && v.workspace.isTrusted === true;
  }

  scope() {
    if (this.disposed) return undefined;
    const v = this.vscode;
    if (!this.supportedLocal() || v.workspace.workspaceFile) return undefined;
    const folders = v.workspace.workspaceFolders;
    if (!Array.isArray(folders) || folders.length !== 1) return undefined;
    const uri = folders[0].uri;
    if (uri.scheme !== 'file' || uri.authority || uri.query || uri.fragment || !path.isAbsolute(uri.fsPath || '') || /[\u0000-\u001f\u007f]/.test(uri.fsPath)) return undefined;
    let directory, session;
    try {
      directory = v.workspace.getConfiguration ? v.workspace.getConfiguration('tensortonic', uri).get('solutionDirectory', 'tensortonic') : 'tensortonic';
      session = this.getSessionEpoch();
    } catch (_) { return undefined; }
    if (!configuredDirectory(directory) || !Number.isSafeInteger(session) || session < 0) return undefined;
    const remembered = this.context.globalState.get(STUDY_FOLDER_KEY);
    let selected;
    try { if (typeof remembered === 'string') selected = v.Uri.parse(remembered); } catch (_) { /* Try files-only recognition. */ }
    const registered = selected && selected.scheme === 'file' && !selected.authority && !selected.query && !selected.fragment && path.isAbsolute(selected.fsPath || '') && path.resolve(selected.fsPath) === path.resolve(uri.fsPath);
    return { folder: uri, directory, registered: !!registered, key: JSON.stringify([path.resolve(uri.fsPath), directory, typeof remembered === 'string' ? remembered : null, session, this.scopeRevision]) };
  }

  sameScope(snapshot) {
    const current = this.scope();
    return !!snapshot && !!current && snapshot.key === current.key;
  }

  studyFolder() {
    const scope = this.scope();
    return scope && (scope.registered || this.recognized && this.recognized.key === scope.key) ? scope.folder : undefined;
  }

  async resolveStudyFolder() {
    const scope = this.scope();
    if (!scope) return undefined;
    const generation = ++this.recognitionGeneration;
    if (scope.registered) return scope.folder;
    const current = () => this.sameScope(scope) && generation === this.recognitionGeneration;
    let recognized = false;
    try { recognized = await this.recognize({ workspaceRoot: scope.folder.fsPath, solutionDirectory: scope.directory, isCurrent: current }); } catch (_) { /* Fail closed. */ }
    if (!current()) return undefined;
    this.recognized = recognized === true ? { key: scope.key } : undefined;
    return recognized === true ? scope.folder : undefined;
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
    // globalStoragePath is the host's documented absolute local file path. Do
    // not reinterpret vscode-userdata.fsPath or convert a non-file URI to file.
    const root = storage && storage.scheme === 'file' ? storage.fsPath : storage && storage.scheme === 'vscode-userdata' ? this.context.globalStoragePath : undefined;
    if (!this.scope() || !storage || storage.authority || storage.query || storage.fragment || typeof root !== 'string' || !path.isAbsolute(root) || root === path.parse(root).root || root.startsWith('//') || path.resolve(root) !== root || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(root)) throw new Error('Local extension storage is unavailable. Python setup was not started.');
    return this.factory({ managedRoot: path.join(root, 'python-envs'), workspaceRoot: folder.fsPath });
  }

  // A fresh Start Studying handoff offers the same explicit consent as a direct
  // command. Ordinary activation neither installs packages nor executes Python.
  offer() { return this.run({ firstStart: true }); }
  repair() { return this.run({ repair: true }); }
  setup() { return this.run({}); }
  use() { return this.operation(() => this.useOnce()); }

  run(options) {
    return this.operation(() => this.runOnce(options));
  }

  operation(callback) {
    if (this.running) return this.running;
    const task = callback();
    this.running = task;
    this.changed();
    const finished = () => { if (this.running === task) { this.running = undefined; this.changed(); } };
    task.then(finished, finished);
    return task;
  }

  async useOnce() {
    const snapshot = this.scope();
    const folder = await this.resolveStudyFolder();
    if (snapshot && !this.sameScope(snapshot)) return { status: 'cancelled' };
    if (!folder) return { status: 'not-study-window' };
    const scopeRevision = this.scopeRevision;
    const controller = new AbortController();
    this.controller = controller;
    const current = () => !controller.signal.aborted && scopeRevision === this.scopeRevision && this.sameScope(snapshot) && this.isCurrent(folder);
    try {
      const inspected = await waitCancelable(this.environment(folder).inspect(), controller.signal);
      if (!current()) return { status: 'cancelled' };
      if (!this.verified(inspected, folder)) return { status: inspected && inspected.exists === false ? 'missing-environment' : 'repair-required' };
      const python = this.vscode.extensions.getExtension('ms-python.python');
      if (!python) return { status: 'python-extension-missing' };
      if (!python.isActive) await waitCancelable(python.activate(), controller.signal);
      if (!current()) return { status: 'cancelled' };
      const exported = python.exports;
      if (exported && exported.ready && typeof exported.ready.then === 'function') await waitCancelable(exported.ready, controller.signal);
      if (!current()) return { status: 'cancelled' };
      const api = exported && exported.environments;
      if (!api || typeof api.getActiveEnvironmentPath !== 'function') return { status: 'selection-unavailable' };
      this.watchPython(api);
      const active = await waitCancelable(api.getActiveEnvironmentPath(folder), controller.signal);
      if (!current()) return { status: 'cancelled' };
      if (!this.matches(active, inspected)) {
        if (typeof api.updateActiveEnvironmentPath !== 'function') return { status: 'selection-unavailable' };
        await waitCancelable(api.updateActiveEnvironmentPath(inspected.interpreterPath, folder), controller.signal);
        if (!current()) return { status: 'cancelled' };
        const selected = await waitCancelable(api.getActiveEnvironmentPath(folder), controller.signal);
        if (!current()) return { status: 'cancelled' };
        if (!this.matches(selected, inspected)) return { status: 'selection-unverified' };
      }
      await this.context.globalState.update(this.readyKey(folder), { interpreterPath: inspected.interpreterPath, selected: true });
      if (!current()) return { status: 'cancelled' };
      return { status: 'ready', interpreterPath: inspected.interpreterPath };
    } catch (error) {
      if (!current() || error.name === 'AbortError') return { status: 'cancelled' };
      return { status: 'selection-unavailable' };
    } finally { if (this.controller === controller) this.controller = undefined; }
  }

  async runOnce({ firstStart = false, repair = false } = {}) {
    const v = this.vscode;
    const snapshot = this.scope();
    const folder = await this.resolveStudyFolder();
    if (snapshot && !this.sameScope(snapshot)) return { status: 'cancelled' };
    if (!folder) {
      if (!firstStart) await v.window.showInformationMessage('Open your trusted local TensorTonic study folder with Start studying before setting up Python. No development environment was changed.');
      return { status: 'not-study-window' };
    }
    const current = () => this.sameScope(snapshot) && this.isCurrent(folder);
    const environment = this.environment(folder);
    let inspected;
    try { inspected = await environment.inspect(); }
    catch (error) { if (!current()) return { status: 'cancelled' }; throw error; }
    if (!current()) return { status: 'cancelled' };
    const ready = this.context.globalState.get(this.readyKey(folder));
    const python = v.extensions.getExtension('ms-python.python');
    if (firstStart && ready && ready.selected === true && inspected.managed && inspected.exists &&
        ready.interpreterPath === inspected.interpreterPath && python && python.isActive &&
        python.exports && python.exports.environments && typeof python.exports.environments.getActiveEnvironmentPath === 'function') {
      const active = await python.exports.environments.getActiveEnvironmentPath(folder);
      if (!current()) return { status: 'cancelled' };
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
    if (choice !== (repair ? 'Repair study environment' : 'Set up study environment') || !current()) return { status: 'cancelled' };

    const controller = new AbortController();
    this.controller = controller;
    let result;
    try {
      result = await v.window.withProgress({ location: v.ProgressLocation.Notification, title: 'TensorTonic Python environment', cancellable: true }, async (progress, token) => {
        const cancel = token.onCancellationRequested(() => controller.abort());
        try {
          if (token.isCancellationRequested) controller.abort();
          this.unverified.add(this.readyKey(folder));
          const checked = await environment.ensure({ confirmed: true, repair, signal: controller.signal, onProgress: message => progress.report({ message }) });
          this.unverified.delete(this.readyKey(folder));
          if (controller.signal.aborted || !current()) return { status: 'cancelled' };
          progress.report({ message: 'Selecting the interpreter for this study folder…' });
          if (!python.isActive) await waitCancelable(python.activate(), controller.signal);
          const exported = python.exports;
          if (exported && exported.ready && typeof exported.ready.then === 'function') await waitCancelable(exported.ready, controller.signal);
          if (controller.signal.aborted || !current()) return { status: 'cancelled' };
          const api = exported && exported.environments;
          this.watchPython(api);
          if (!api || typeof api.updateActiveEnvironmentPath !== 'function') {
            return { status: 'selection-unavailable', ...checked };
          }
          await waitCancelable(api.updateActiveEnvironmentPath(checked.interpreterPath, folder), controller.signal);
          if (controller.signal.aborted || !current()) return { status: 'cancelled' };
          let selected = false;
          if (typeof api.getActiveEnvironmentPath === 'function') {
            const active = await waitCancelable(api.getActiveEnvironmentPath(folder), controller.signal);
            selected = !!active && typeof active.path === 'string' && [checked.interpreterPath, checked.environmentPath].filter(Boolean).some(candidate => path.resolve(active.path) === path.resolve(candidate));
          }
          if (controller.signal.aborted || !current()) return { status: 'cancelled' };
          await this.context.globalState.update(this.readyKey(folder), { interpreterPath: checked.interpreterPath, selected });
          return { ...checked, status: selected ? 'ready' : 'selection-unverified' };
        } finally { cancel.dispose(); }
      });
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') return { status: 'cancelled' };
      throw error;
    } finally { if (this.controller === controller) this.controller = undefined; }
    if (result.status === 'ready') {
      // Completion is not an operation or consent boundary. A hidden notification
      // can stay open in Notification Center until dismissed; do not hold Ready
      // behind its lifetime.
      Promise.resolve(v.window.showInformationMessage(`TensorTonic study Python is ready: torch and numpy verified. Selected ${result.interpreterPath} for this study folder only.`)).catch(() => {});
    } else if (result.status === 'selection-unavailable' || result.status === 'selection-unverified') {
      const choice = await v.window.showInformationMessage(`The study environment is ready, but interpreter selection could not be verified. Use Python: Select Interpreter → Enter interpreter path and choose ${result.interpreterPath}.`, 'Select interpreter');
      if (choice === 'Select interpreter' && current()) await v.commands.executeCommand('python.setInterpreter');
    }
    return result;
  }
}
module.exports = { StudyEnvironmentUI };
