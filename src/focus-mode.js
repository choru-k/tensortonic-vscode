'use strict';

const SLUG = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';
const PROBLEM_URL = new RegExp(`^https://www\\.tensortonic\\.com/problems/${SLUG}(?:\\?studyPlan=${SLUG})?$`);
const DEFAULT_OPERATION_TIMEOUT = 8000;

// Match the reviewed presentation grammar without URL normalization admitting
// alternate origins, paths, encodings, queries, or empty fragments.
function canonicalProblem(url) { return typeof url === 'string' && PROBLEM_URL.test(url); }
function ownedLease(value) { return value && typeof value.restore === 'function'; }
function fault(code) { const error = new Error(code); error.code = code; return error; }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }

// The adapter owns the reviewed DOM/CSS contract. This controller grants only
// an exact owned-document proof and retains every returned cleanup lease.
class FocusModeController {
  constructor({ adapter, verifiedContract, operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT, onChange = () => {} } = {}) {
    this.adapter = adapter;
    this.contract = verifiedContract ? Object.freeze({ ...verifiedContract }) : undefined;
    this.operationTimeoutMs = Number.isFinite(operationTimeoutMs) && operationTimeoutMs > 0 ? Math.min(operationTimeoutMs, DEFAULT_OPERATION_TIMEOUT) : DEFAULT_OPERATION_TIMEOUT;
    this.enabled = false;
    this.generation = 0;
    this.lease = undefined;
    this.status = 'off';
    this.disposed = false;
    this.queue = Promise.resolve();
    this._leases = new Set();
    this._restores = new Map();
    this._pendingApplies = new Set();
    this._activeLease = undefined;
    this._operation = undefined;
    this._running = undefined;
    this.onChange = onChange;
    this._pendingOperations = new Set();
    this._lastNotification = undefined;
  }

  get state() { return Object.freeze({ enabled: this.enabled, status: this.status, applied: this._leases.size > 0 }); }
  get busy() { return this._pendingOperations.size > 0; }
  _notify() {
    const value = Object.freeze({ ...this.state, busy: this.busy });
    const key = JSON.stringify(value);
    if (key === this._lastNotification) return;
    this._lastNotification = key;
    try { this.onChange(value); } catch (_) { /* Presentation listeners cannot interrupt cleanup. */ }
  }
  _current(operation) { return this._operation === operation && operation.generation === this.generation; }
  _needsCleanup() { return this._pendingApplies.size > 0 || [...this._leases].some(lease => lease !== this._activeLease); }

  _remember(lease) {
    if (!ownedLease(lease)) return false;
    this._leases.add(lease);
    if (!this.lease) this.lease = lease;
    return true;
  }

  _forget(lease) {
    this._leases.delete(lease);
    if (this._activeLease === lease) this._activeLease = undefined;
    if (this.lease === lease) this.lease = this._leases.values().next().value;
  }

  _refreshCleanupStatus() {
    if (this._running) return;
    if (this._needsCleanup()) this.status = 'restore-pending';
    else if (!this.enabled || this.disposed) this.status = 'off';
    else if (this._activeLease) this.status = 'applied';
    else if (this.status === 'restore-pending') this.status = 'unavailable';
    this._notify();
  }

  _wait(promise, operation) {
    const { signal } = operation.controller;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        callback(value);
      };
      const aborted = () => finish(reject, fault('CANCELED'));
      // Keep observing detached native work, including its later rejection.
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) { aborted(); return; }
      const remaining = operation.deadline - Date.now();
      if (remaining <= 0) {
        finish(reject, fault('TIMEOUT'));
        operation.controller.abort();
        return;
      }
      timer = setTimeout(() => {
        finish(reject, fault('TIMEOUT'));
        operation.controller.abort();
      }, remaining);
    });
  }

  _restoreLease(lease, operation) {
    let pending = this._restores.get(lease);
    if (!pending) {
      pending = Promise.resolve().then(() => lease.restore({ signal: operation.controller.signal })).then(() => {
        this._forget(lease);
      }, error => {
        this._remember(error && error.lease);
        throw error;
      });
      this._restores.set(lease, pending);
      const settled = () => {
        if (this._restores.get(lease) === pending) this._restores.delete(lease);
        this._refreshCleanupStatus();
      };
      pending.then(settled, settled);
    }
    return this._wait(pending, operation);
  }

  async _restoreAll(operation) {
    for (const lease of [...this._leases]) {
      try { await this._restoreLease(lease, operation); }
      catch (_) { return false; }
      if (!this._current(operation)) return false;
    }
    return this._pendingApplies.size === 0;
  }

  async _cleanupLate(lease) {
    const operation = { controller: new AbortController(), deadline: Date.now() + this.operationTimeoutMs };
    try { await this._restoreLease(lease, operation); }
    catch (_) { /* Keep this exact lease available for an explicit retry. */ }
    this._refreshCleanupStatus();
  }

  async _apply(proof, operation) {
    const attempt = { detached: false };
    this._pendingApplies.add(attempt);
    const pending = Promise.resolve().then(() => {
      if (operation.controller.signal.aborted || !this._current(operation)) throw fault('CANCELED');
      return this.adapter.apply(proof, this.contract, { signal: operation.controller.signal, onDiagnostic: operation.onDiagnostic });
    }).then(lease => {
      this._pendingApplies.delete(attempt);
      if (!this._remember(lease)) throw fault('MISSING_OWNED_LEASE');
      if (attempt.detached || !this._current(operation) || operation.controller.signal.aborted) void this._cleanupLate(lease);
      return lease;
    }, error => {
      this._pendingApplies.delete(attempt);
      // A dispatched style mutation can fail to restore before returning.
      // RESTORE_PENDING carries its owned lease across that adapter error.
      this._remember(error && error.lease);
      this._refreshCleanupStatus();
      throw error;
    });
    try { return await this._wait(pending, operation); }
    catch (error) { attempt.detached = true; throw error; }
  }

  async _run(operation, page) {
    if (!this._current(operation)) return this.state;
    operation.deadline = Date.now() + this.operationTimeoutMs;
    this._running = operation;
    try {
      if (!await this._restoreAll(operation)) {
        if (this._current(operation)) this.status = this._needsCleanup() ? 'restore-pending' : this.enabled ? 'unavailable' : 'off';
        return this.state;
      }
      if (!this._current(operation)) return this.state;
      if (!this.enabled || this.disposed) { this.status = 'off'; return this.state; }
      // Reviewed extension code grants the contract, never settings or the page.
      if (!this.contract || this.contract.verified !== true || this.contract.surface !== 'problem-content' || this.contract.hidesSecurityUI !== false || !nonempty(this.contract.id) || typeof this.adapter?.verify !== 'function' || typeof this.adapter?.apply !== 'function') {
        this.status = 'awaiting-dom-verification';
        return this.state;
      }
      if (operation.controller.signal.aborted || page?.owned !== true || !nonempty(page.id) || !canonicalProblem(page.url) || !nonempty(page.documentId) || !nonempty(page.frameId)) {
        this.status = 'unavailable';
        return this.state;
      }
      const snapshot = Object.freeze({ id: page.id, url: page.url, documentId: page.documentId, frameId: page.frameId });
      const verification = Promise.resolve().then(() => {
        if (operation.controller.signal.aborted || !this._current(operation)) throw fault('CANCELED');
        return this.adapter.verify(snapshot, this.contract, { signal: operation.controller.signal, onDiagnostic: operation.onDiagnostic });
      });
      const proof = await this._wait(verification, operation);
      if (!this._current(operation)) return this.state;
      if (!proof || proof.id !== snapshot.id || proof.url !== snapshot.url || proof.documentId !== snapshot.documentId || proof.frameId !== snapshot.frameId || proof.contractId !== this.contract.id || proof.owned !== true) {
        this.status = 'unavailable';
        return this.state;
      }
      const lease = await this._apply(proof, operation);
      if (!this._current(operation) || operation.controller.signal.aborted) {
        try { await this._restoreLease(lease, operation); } catch (_) { /* Retained. */ }
        return this.state;
      }
      this._activeLease = lease;
      this.status = 'applied';
      return this.state;
    } catch (error) {
      this._remember(error && error.lease);
      if (this._current(operation)) this.status = this._needsCleanup() ? 'restore-pending' : !this.enabled || this.disposed ? 'off' : 'unavailable';
      return this.state;
    } finally {
      if (this._running === operation) this._running = undefined;
    }
  }

  setEnabled(enabled, { page, signal, onDiagnostic } = {}) {
    this._operation?.controller.abort();
    this._activeLease = undefined;
    this.enabled = enabled === true && !this.disposed;
    const operation = { generation: ++this.generation, controller: new AbortController(), onDiagnostic };
    this._operation = operation;
    this._pendingOperations.add(operation);
    this._notify();
    const cancel = () => operation.controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const task = () => this._run(operation, page);
    const result = this.queue.then(task, task).finally(() => {
      signal?.removeEventListener('abort', cancel);
      this._pendingOperations.delete(operation);
      this._notify();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  // Navigation never adopts a replacement page. Disposal still owns cleanup.
  pageChanged() { return this.setEnabled(false); }
  dispose() { this.disposed = true; return this.setEnabled(false); }
}

module.exports = { FocusModeController, canonicalProblem };
