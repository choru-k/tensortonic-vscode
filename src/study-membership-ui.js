'use strict';

const model = require('./study-plan-membership');
const { loadPublicStudyPlans, normalizePlans } = require('./study-plans');
const STORAGE_KEY = 'tensortonic.studyPlanMembership.v1';

// Sidebar membership only. This controller has no filesystem, grading, account,
// progress mutation or editor-selection capability. One owner per workspace.
class StudyMembershipController {
  constructor(vscode, context, { legacyPlanId = () => '', loadCatalog = async () => normalizePlans(await loadPublicStudyPlans()), onChange = () => {}, onError = () => {} } = {}) {
    this.vscode = vscode; this.storage = context.workspaceState;
    this.legacyPlanId = legacyPlanId; this.loadCatalog = loadCatalog;
    this.onChange = onChange; this.onError = onError;
    this._state = undefined; this.disposed = false; this.operation = 0;
    this._writeTail = Promise.resolve(); this.dirty = false;
    // Corrupt/future membership must not prevent ordinary extension activation.
    // Never replace an unreadable value with empty membership or legacy config.
    try {
      const saved = this.storage?.get(STORAGE_KEY);
      if (saved != null) this._state = model.restoreState({ saved });
    } catch (_) {
      this.membershipError = 'Saved study-plan membership could not be read. Its data was preserved. Update the extension if this workspace was saved by a newer version, or repair the membership data before managing plans.';
    }
  }
  get initialized() { return !!this._state; }
  get state() { return this._state ? model.restoreState({ saved: this._state }) : undefined; }
  get planIds() { return this._state ? [...this._state.planIds] : undefined; }
  _check() {
    if (this.disposed) throw new Error('Study-plan management is closed.');
    if (this.membershipError) throw new Error(this.membershipError);
    if (this.vscode.workspace?.isTrusted !== true) throw new Error('Trust this workspace before managing study plans.');
    if (!this.storage || typeof this.storage.update !== 'function') throw new Error('Workspace storage is unavailable.');
  }
  async initialize() {
    this._check();
    if (this._state) return this.state;
    if (this._initializing) return this._initializing;
    const task = (async () => {
      const legacyPlanId = typeof this.legacyPlanId === 'function' ? this.legacyPlanId() : this.legacyPlanId;
      const catalog = legacyPlanId ? await this.loadCatalog() : undefined;
      this._check();
      if (!this._state) {
        this._state = model.restoreState({ legacyPlanId, catalog });
        this.onChange(this.state);
        // Persist authoritative empty membership too; never resurrect old config.
        this.dirty = true;
        await this.flush();
      }
      return this.state;
    })();
    this._initializing = task;
    try { return await task; } finally { if (this._initializing === task) this._initializing = undefined; }
  }
  _commit(next) {
    this._check();
    if (next === this._state) return Promise.resolve(false);
    this._state = next; this.dirty = true;
    this.onChange(this.state);
    return this.flush().then(() => true);
  }
  flush() {
    this._check();
    const work = this._writeTail.catch(() => {}).then(async () => {
      this._check();
      if (!this.dirty || !this._state) return;
      const snapshot = this.state;
      try {
        await this.storage.update(STORAGE_KEY, snapshot);
        if (this._state.revision === snapshot.revision) this.dirty = false;
      } catch (error) {
        this.dirty = true;
        // Keep the newest memory state; callers may retry flush, never old snapshots.
        try { this.onError(new Error('Study-plan changes could not be saved. Retry saving the current selection.')); } catch (_) {}
        throw new Error('Study-plan changes could not be saved. Retry saving the current selection.');
      }
    });
    this._writeTail = work;
    // The returned promise still rejects for the caller; queued mutation failures
    // cannot become unhandled merely because a UI handler does not await disposal.
    work.catch(() => {});
    return work;
  }
  async manage() {
    this._check();
    const operation = ++this.operation;
    await this.initialize();
    const snapshot = model.beginPicker(this._state);
    const catalog = await this.loadCatalog();
    this._check();
    if (operation !== this.operation) return { status: 'stale', state: this.state };
    if (!Array.isArray(catalog)) throw new Error('A successful study-plan catalog is required.');
    const known = new Set(catalog.filter(row => row.supported !== false).map(row => row.id));
    const missing = snapshot.planIds.filter(id => !known.has(id));
    if (missing.length) throw new Error('A saved study plan is unavailable in the current catalog. Remove that sidebar membership explicitly, then reopen Manage study plans.');
    const items = catalog.filter(row => row.supported !== false).map(row => ({
      label: row.title || row.id, description: row.id, planId: row.id,
      picked: snapshot.planIds.includes(row.id),
    }));
    const chosen = await this.vscode.window.showQuickPick(items, {
      canPickMany: true, ignoreFocusOut: true, matchOnDescription: true,
      title: 'Manage study plans',
      placeHolder: 'Select sidebar plans. Removing a plan keeps its files, history and server progress.',
    });
    this._check();
    if (operation !== this.operation) return { status: 'stale', state: this.state };
    const selected = chosen == null ? chosen : chosen.map(item => item.planId);
    // Keep existing membership order and append newly selected catalog items.
    const ids = selected == null ? selected : [...snapshot.planIds.filter(id => selected.includes(id)), ...selected.filter(id => !snapshot.planIds.includes(id))];
    const result = model.commitPicker(this._state, snapshot, ids, catalog);
    if (result.status === 'committed') await this._commit(result.state);
    return { status: result.status, state: this.state };
  }
  async remove(planId) {
    this._check(); await this.initialize();
    await this._commit(model.removePlan(this._state, planId));
    return this.state;
  }
  async recordOpened(ref) {
    // Ordinary problem opening remains usable when only membership is blocked.
    if (this.membershipError) return false;
    this._check();
    // Opening a problem must not start a catalog request or destructive fallback.
    // Parent calls initialize during sidebar setup; an offline unmigrated owner
    // simply retains legacy behavior until a successful later initialization.
    if (!this._state) return false;
    return this._commit(model.recordOpenedProblem(this._state, ref));
  }
  getResumeRef(planId) { return this._state ? model.getResumeRef(this._state, planId) : null; }
  dispose() { this.disposed = true; this.operation++; }
}

module.exports = { StudyMembershipController, STORAGE_KEY };
