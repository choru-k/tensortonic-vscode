'use strict';

const { randomUUID } = require('node:crypto');

// Machine-local Memento values: deliberately never registered for Settings Sync.
const STUDY_FOLDER_KEY = 'tensortonic.studyFolder';
const PENDING_STUDY_VIEW_KEY = 'tensortonic.pendingStudyView';
const CONSUMED_STUDY_VIEW_KEY = 'tensortonic.consumedStudyViewNonce';
const PENDING_TTL_MS = 5 * 60 * 1000;
const NONCE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

class StudyWorkspace {
  constructor(vscode, context, { showStudyPlan, offerEnvironment, now = Date.now, createNonce = randomUUID }) {
    if (typeof showStudyPlan !== 'function') throw new TypeError('A Study Plan view callback is required.');
    this.vscode = vscode;
    this.state = context.globalState;
    this.workspaceState = context.workspaceState;
    this.showStudyPlan = showStudyPlan;
    this.offerEnvironment = offerEnvironment;
    this.now = now;
    this.createNonce = createNonce;
    this.queue = Promise.resolve();
    this.starting = null;
    this.restoring = null;
  }

  supported() {
    const { env, workspace, UIKind } = this.vscode;
    return !!env && !!UIKind && env.uiKind === UIKind.Desktop && !env.remoteName && workspace.isTrusted === true;
  }

  requireSupported() {
    if (!this.supported()) throw new Error('Start Studying requires a trusted, local VS Code desktop window. Browser and remote workspaces are not supported.');
  }

  localUri(value) {
    try {
      const uri = typeof value === 'string' && value.length <= 16384 ? this.vscode.Uri.parse(value, true) : value;
      if (!this.vscode.Uri.isUri(uri) || uri.scheme !== 'file' || uri.authority || uri.query || uri.fragment ||
          !uri.path.startsWith('/') || uri.path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(uri.path)) return null;
      return uri;
    } catch { return null; }
  }

  uriKey(uri) {
    return uri.with({ path: uri.path.replace(/\/+$/, '') || '/' }).toString();
  }

  singleFolderMatches(uri) {
    const { workspace } = this.vscode;
    const folders = workspace.workspaceFolders;
    if (workspace.workspaceFile || !Array.isArray(folders) || folders.length !== 1) return false;
    const current = this.localUri(folders[0].uri);
    return !!current && this.uriKey(current) === this.uriKey(uri);
  }

  async directory(value) {
    const uri = this.localUri(value);
    if (!uri) return null;
    try {
      const stat = await this.vscode.workspace.fs.stat(uri);
      return (stat.type & this.vscode.FileType.Directory) !== 0 ? uri : null;
    } catch { return null; }
  }

  serialize(operation) {
    const promise = this.queue.then(operation);
    this.queue = promise.catch(() => {});
    return promise;
  }

  start({ chooseFolder = false } = {}) {
    if (this.starting) return this.starting;
    const promise = this.serialize(() => this.startOnce(chooseFolder));
    this.starting = promise;
    promise.then(() => { if (this.starting === promise) this.starting = null; }, () => { if (this.starting === promise) this.starting = null; });
    return promise;
  }

  async startOnce(chooseFolder) {
    this.requireSupported();
    const remembered = this.state.get(STUDY_FOLDER_KEY);
    let folder = typeof remembered === 'string' ? await this.directory(remembered) : null;
    if (chooseFolder || !folder) {
      const selected = await this.vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        title: 'Choose a TensorTonic study folder — opens in a new window', openLabel: 'Study here',
        ...(folder ? { defaultUri: folder } : {}),
      });
      if (!selected || selected.length === 0) return { status: 'cancelled' };
      if (selected.length !== 1 || !(folder = await this.directory(selected[0]))) {
        throw new Error('Choose an existing local folder for TensorTonic study. Remote locations and files are not supported.');
      }
      this.requireSupported();
      await this.state.update(STUDY_FOLDER_KEY, folder.toString());
    }
    this.requireSupported();
    if (this.singleFolderMatches(folder)) {
      await this.showStudyPlan();
      if (this.offerEnvironment) await this.offerEnvironment();
      return { status: 'reused' };
    }
    const pending = { uri: folder.toString(), createdAt: this.now(), nonce: this.createNonce() };
    await this.state.update(PENDING_STUDY_VIEW_KEY, pending);
    this.requireSupported();
    // Never retry an uncertain open or clean shared state on failure: an older window's
    // Memento write could overwrite a newer handoff. The UI-only marker expires shortly.
    await this.vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: true });
    return { status: 'open-requested' };
  }

  samePending(snapshot) {
    const current = this.state.get(PENDING_STUDY_VIEW_KEY);
    return !!current && current.nonce === snapshot.nonce && current.uri === snapshot.uri && current.createdAt === snapshot.createdAt;
  }

  pendingFresh(pending) {
    const now = this.now();
    return Number.isFinite(pending.createdAt) && pending.createdAt <= now && now - pending.createdAt < PENDING_TTL_MS;
  }

  restorePendingStudyView() {
    if (this.restoring) return this.restoring;
    const promise = this.serialize(() => this.restoreOnce());
    this.restoring = promise;
    promise.then(() => { if (this.restoring === promise) this.restoring = null; }, () => { if (this.restoring === promise) this.restoring = null; });
    return promise;
  }

  async restoreOnce() {
    // A fresh explicit Start handoff may focus the view and offer setup consent.
    // Ordinary startup never opens folders, runs Python, or installs packages.
    if (!this.supported()) return false;
    const pending = this.state.get(PENDING_STUDY_VIEW_KEY);
    if (pending === undefined) return false;
    const folder = pending && typeof pending === 'object' && typeof pending.uri === 'string' ? this.localUri(pending.uri) : null;
    if (!folder || typeof pending.nonce !== 'string' || !NONCE.test(pending.nonce) || !Number.isFinite(pending.createdAt) ||
        !this.pendingFresh(pending)) {
      return false;
    }
    if (this.workspaceState.get(CONSUMED_STUDY_VIEW_KEY) === pending.nonce) return false;
    if (!this.singleFolderMatches(folder)) return false;
    if (!(await this.directory(folder))) return false;
    if (!this.supported() || !this.singleFolderMatches(folder) || !this.samePending(pending) || !this.pendingFresh(pending)) return false;
    try {
      if (this.workspaceState.get(CONSUMED_STUDY_VIEW_KEY) === pending.nonce) return false;
      // Startup never writes globalState. Memento updates persist whole objects across
      // windows, so consumption belongs to this workspace, not the shared handoff.
      await this.workspaceState.update(CONSUMED_STUDY_VIEW_KEY, pending.nonce);
      if (!this.supported() || !this.singleFolderMatches(folder) || !this.samePending(pending) ||
          !this.pendingFresh(pending) || this.workspaceState.get(CONSUMED_STUDY_VIEW_KEY) !== pending.nonce) return false;
      await this.showStudyPlan();
      if (this.offerEnvironment) await this.offerEnvironment();
      return true;
    } catch { return false; }
  }
}

module.exports = { StudyWorkspace, STUDY_FOLDER_KEY, PENDING_STUDY_VIEW_KEY, CONSUMED_STUDY_VIEW_KEY, PENDING_TTL_MS };
