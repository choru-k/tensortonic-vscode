'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');

const EXTENSION_ID = 'ms-python.vscode-python-envs';
const MANAGER_ID = 'choru-local.tensortonic-vscode:study';
const SELECTION_KEY = 'tensortonic.selectedStudyPython';
const NAME = 'TensorTonic';

function localPath(uri) {
  return uri?.scheme === 'file' && !uri.authority && !uri.query && !uri.fragment ? uri.fsPath : undefined;
}

function inFolder(uri, folder) {
  const file = localPath(uri);
  if (!folder || !file) return false;
  const relative = path.relative(folder.fsPath, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function executionInfo(executable) {
  // Run/debug uses the exact interpreter. A new terminal can use whichever
  // activation script this venv supplied for its shell, including paths with spaces.
  const bin = path.dirname(executable);
  const shellActivation = new Map(), shellDeactivation = new Map();
  for (const [file, shells] of [
    ['activate', ['unknown','bash','zsh','sh','ksh']],
    ['activate.fish', ['fish']], ['activate.csh', ['csh','tcsh']], ['Activate.ps1', ['pwsh']],
  ]) {
    const script = path.join(bin, file);
    if (!(await fs.stat(script).catch(() => undefined))?.isFile()) continue;
    for (const shell of shells) {
      const command = shell === 'pwsh' ? { executable: script }
        : { executable: ['sh','ksh'].includes(shell) ? '.' : 'source', args: [script] };
      shellActivation.set(shell, [command]);
      shellDeactivation.set(shell, [{ executable: 'deactivate' }]);
    }
  }
  return { run: { executable }, activatedRun: { executable }, shellActivation, shellDeactivation };
}

// Microsoft owns the interpreter indicator. Register our verified environment
// with its native manager API so the label, Run and interpreter picker agree.
class StudyPythonManager {
  constructor(host, api) {
    this.host = host;
    this.api = api;
    this.name = 'study';
    this.displayName = NAME;
    this.preferredPackageManagerId = 'ms-python.python:pip';
    this.registration = api.registerEnvironmentManager(this, { extensionId: 'choru-local.tensortonic-vscode' });
    this.onDidChangeActiveEnvironmentPath = api.onDidChangeEnvironment;
  }

  dispose() { this.disposed = true; this.registration.dispose(); }

  async item() {
    const folder = this.host.studyFolder();
    if (this.disposed || !folder) return undefined;
    const inspected = await this.host.environment(folder).inspect();
    if (this.disposed || !this.host.isCurrent(folder) || !this.host.verified(inspected, folder)) return undefined;
    const { interpreterPath, environmentPath, pythonVersion } = inspected;
    if (this.cached?.environmentPath.fsPath === interpreterPath && this.cached.version === pythonVersion) return this.cached;
    const execInfo = await executionInfo(interpreterPath);
    if (this.disposed || !this.host.isCurrent(folder)) return undefined;
    if (this.cached?.environmentPath.fsPath === interpreterPath && this.cached.version === pythonVersion) return this.cached;
    this.cached = this.api.createPythonEnvironmentItem({
      name: NAME, displayName: NAME, shortDisplayName: NAME, version: pythonVersion,
      environmentPath: this.host.vscode.Uri.file(interpreterPath), sysPrefix: environmentPath,
      displayPath: interpreterPath, description: 'Python ' + pythonVersion, execInfo,
    }, this);
    return this.cached;
  }

  async getEnvironments(scope) {
    if (scope !== 'all' && !inFolder(scope, this.host.studyFolder())) return [];
    const item = await this.item();
    return item ? [item] : [];
  }
  async refresh() { this.cached = undefined; }
  async resolve(uri) {
    const file = localPath(uri);
    if (!file) return undefined;
    const item = await this.item();
    return item && [item.environmentPath.fsPath, item.sysPrefix].includes(file) ? item : undefined;
  }
  async get(scope) {
    if (!inFolder(scope, this.host.studyFolder())) return undefined;
    const selected = this.host.context.workspaceState.get(SELECTION_KEY);
    if (!selected) return undefined;
    const item = await this.item();
    return item?.environmentPath.fsPath === selected ? item : undefined;
  }
  async set(scope, environment) {
    const folder = this.host.studyFolder();
    const scopes = Array.isArray(scope) ? scope : [scope];
    if (!folder || !scopes.length || !scopes.every(uri => localPath(uri) === folder.fsPath))
      throw new Error('Select TensorTonic in its study folder.');
    const file = environment && localPath(environment.environmentPath);
    if (environment && (environment.envId?.managerId !== MANAGER_ID || !file || !(await this.resolve(environment.environmentPath))))
      throw new Error('The managed study interpreter is unavailable.');
    if (this.disposed || !this.host.isCurrent(folder)) throw new Error('The study folder changed.');
    await this.host.context.workspaceState.update(SELECTION_KEY, file);
  }

  // Adapter for the existing Setup, Use and startup selection flow.
  async getActiveEnvironmentPath(folder) {
    // The native indicator follows the active file, which may belong to a
    // different Python project inside the same workspace.
    const document = this.host.vscode.window.activeTextEditor?.document;
    const resource = document?.languageId === 'python' && inFolder(document.uri, folder) ? document.uri : folder;
    const active = await this.api.getEnvironment(resource);
    return active && { path: active.execInfo?.run?.executable || localPath(active.environmentPath),
      named: active.envId?.managerId === MANAGER_ID && active.displayName === NAME };
  }
  async updateActiveEnvironmentPath(executable, folder) {
    const signal = this.host.controller?.signal;
    const item = await this.item();
    if (signal?.aborted || this.disposed || !item || item.environmentPath.fsPath !== executable || !this.host.isCurrent(folder))
      throw new Error('The managed study interpreter is unavailable.');
    await this.api.setEnvironment(folder, item);
  }
}

module.exports = { EXTENSION_ID, StudyPythonManager };
