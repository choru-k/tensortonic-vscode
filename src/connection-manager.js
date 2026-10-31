'use strict';

const normalizeMode = value => value === 'browserCompanion' ? value : 'native';
class ConnectionManager {
  constructor({ native, legacy, mode = 'native' }) {
    this.native = native; this.legacy = legacy; this.mode = normalizeMode(mode);
    this.onDidChange = undefined; this.switching = undefined; this.disposed = false;
    for (const transport of [native, legacy]) transport.onDidChange = () => {
      if (transport === this.active && !this.switching && this.onDidChange) this.onDidChange();
    };
  }
  get active() { return this.mode === 'native' ? this.native : this.legacy; }
  get connected() { return !this.switching && !this.disposed && this.active.connected; }
  set connected(value) { this.active.connected = value; }
  get token() { return this.switching || this.disposed ? undefined : this.active.token; }
  set token(value) { this.active.token = value; }
  get port() { return this.mode === 'browserCompanion' ? this.legacy.port : undefined; }
  get starts() { return this.active.starts; }
  get pairings() { return this.active.pairings; }
  async setMode(value) {
    const mode = normalizeMode(value);
    if (this.switching) { await this.switching; return this.setMode(mode); }
    if (mode === this.mode) return;
    const previous = this.active;
    const task = Promise.resolve().then(() => typeof previous.shutdown === 'function' ? previous.shutdown() : previous.stop());
    this.switching = task;
    if (this.onDidChange) this.onDidChange();
    try { await task; this.mode = mode; }
    finally { this.switching = undefined; if (this.onDidChange) this.onDidChange(); }
  }
  async start() {
    if (this.switching) await this.switching;
    if (this.disposed) throw new Error('TensorTonic connection is closed.');
    return this.active.start();
  }
  async restore() {
    // Native browser sessions always require explicit Connect after activation.
    if (this.mode !== 'browserCompanion') return false;
    return typeof this.legacy.restore === 'function' ? this.legacy.restore() : false;
  }
  pairingCode() {
    if (this.mode !== 'browserCompanion' || this.switching) throw new Error('Native browser connection does not use pairing codes.');
    return this.legacy.pairingCode();
  }
  async request(apiPath, options = {}) {
    if (this.switching || this.disposed) throw new Error('The connection is changing. Review the selected connection before trying again.');
    const transport = this.active;
    const result = await transport.request(apiPath, options);
    if (transport !== this.active || this.switching || this.disposed) throw new Error('Connection changed while the request was running. Its result is uncertain; check the website before submitting again.');
    return result;
  }
  async openProblemPage(url) {
    if (this.mode !== 'native' || this.switching || this.disposed) throw new Error('The native connection is not active.');
    return this.native.openProblemPage(url);
  }
  async revoke() {
    if (this.switching) await this.switching;
    return typeof this.active.revoke === 'function' ? this.active.revoke() : this.active.stop();
  }
  async stop() { return this.revoke(); }
  async shutdown() {
    this.disposed = true;
    if (this.switching) { try { await this.switching; } catch (_) {} }
    const results = await Promise.allSettled([this.native, this.legacy].map(bridge => bridge === this.native && typeof bridge.dispose === 'function' ? bridge.dispose() : typeof bridge.shutdown === 'function' ? bridge.shutdown() : bridge.stop()));
    if (this.onDidChange) this.onDidChange();
    if (results.some(result => result.status === 'rejected')) throw new Error('Some owned TensorTonic connection resources could not be closed.');
  }
}
module.exports = { ConnectionManager, normalizeMode };
