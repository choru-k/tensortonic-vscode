'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ORIGINS = new Set(['https://www.tensortonic.com', 'https://tensortonic.com']);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAIRING_BYTES = 1024;
const MAX_PAIRING_ATTEMPTS = 8;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SLUG = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';

// The bridge cannot call arbitrary URLs, account settings, billing, or solutions.
function isAllowedRequest(apiPath, method = 'GET') {
  if (typeof apiPath !== 'string' || apiPath.length > 1000 || /[\\#%]/.test(apiPath)) return false;
  const url = new URL(apiPath, 'https://api.tensortonic.com');
  if (url.origin !== 'https://api.tensortonic.com' || !apiPath.startsWith('/api/')) return false;
  if (method === 'GET') {
    if (url.pathname === '/api/problems/list') {
      return [...url.searchParams].every(([k, v]) =>
        ['page', 'limit'].includes(k) ? /^\d{1,4}$/.test(v) : k === 'planId' && new RegExp(`^${SLUG}$`).test(v));
    }
    if (url.search) return false;
    return new RegExp(`^/api/(?:study-plans(?:/${SLUG}(?:/problems/${SLUG})?)?|problems/${SLUG})$`).test(url.pathname);
  }
  return method === 'POST' && !url.search && new RegExp(`^/api/(?:study-plans/${SLUG}/problems/${SLUG}/(?:run|submit)|problems/${SLUG}/(?:run-cases|submit))$`).test(url.pathname);
}

function validateBody(body, apiPath) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.code !== 'string') return false;
  if (Buffer.byteLength(body.code) > 512 * 1024) return false;
  const run = /\/(?:run|run-cases)$/.test(apiPath);
  const keys = run ? ['code', 'testCases', 'problemType'] : ['code', 'problemType'];
  return Object.keys(body).every(k => keys.includes(k)) &&
    (!run || Array.isArray(body.testCases)) &&
    (body.problemType == null || body.problemType === 'free');
}

class BrowserBridge {
  constructor(options = {}) {
    this.server = undefined;
    this.token = undefined;
    this.port = undefined;
    this.connected = false;
    this.onDidChange = undefined;
    this.pending = new Map();
    this.queue = [];
    this.pollResponse = undefined;
    this.requestTimeout = options.requestTimeout || 180000;
    this.serverFactory = options.serverFactory || http.createServer;
    this.pairingTtl = options.pairingTtl ?? 120000;
    this.now = options.now || Date.now;
    this.pairingTicket = undefined;
    this.persistence = options.persistence;
    this.preferredPort = options.preferredPort || 0;
    this.lease = undefined;
    this.persistenceTail = Promise.resolve();
    this.generation = 0;
    this.loaded = false;
  }

  _persist(operation) {
    const task = this.persistenceTail.then(operation);
    this.persistenceTail = task.catch(() => {});
    return task;
  }

  async _load() {
    if (!this.persistence || this.loaded) return;
    if (!this.loading) this.loading = (async () => {
      const raw = await this.persistence.load();
      this.lease = undefined;
      if (raw) {
        let value;
        try { value = JSON.parse(raw); } catch (_) { value = undefined; }
        if (value && /^[a-f0-9]{64}$/.test(value.resumeKey) &&
            Number.isInteger(value.port) && value.port === this.preferredPort &&
            Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt) &&
            value.expiresAt - value.issuedAt === REMEMBER_MS && value.issuedAt <= this.now() && value.expiresAt > this.now()) {
          this.lease = value;
        }
      }
      this.loaded = true;
    })();
    try { await this.loading; } finally { this.loading = undefined; }
  }

  async restore() {
    const generation = this.generation;
    await this._load();
    if (generation !== this.generation) return false;
    if (!this.lease) return false;
    await this.start();
    return true;
  }

  _expired() { return !!this.lease && this.now() >= this.lease.expiresAt; }

  async _forget() {
    this.generation++;
    this.revocationPending = this.lease || this.revocationPending;
    this.lease = undefined;
    this.resumeReservedUntil = 0;
    this._revokeSession();
    if (this.persistence) await this._persist(() => this.persistence.delete());
    this.revocationPending = undefined;
  }

  async revoke() {
    // Only the listener owner may revoke a workspace's persisted lease.
    // A second VS Code window failing to bind must not erase its owner's key.
    if (!this.server || !this.port) throw new Error('This window does not own the remembered connection. Disconnect in the owning study window.');
    await this._forget();
    await this.stop();
  }

  async shutdown() {
    // Editor shutdown is not an explicit Disconnect: retain the bounded lease.
    if (this.revocationPending) await this._forget();
    await this.stop();
  }

  async _smallBody(req) {
    let size = 0; const parts = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_PAIRING_BYTES) throw new Error('Body too large');
      parts.push(chunk);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }

  async _remembered(req, res) {
    if (req.method !== 'POST' || !['/resume', '/revoke'].includes(req.url) ||
        req.headers.host !== `127.0.0.1:${this.port}` || this.stopping) return this._json(res, 403, { error: 'Remembered pairing rejected' });
    const lease = req.url === '/revoke' ? this.lease || this.revocationPending : this.lease;
    let body;
    try { body = await this._smallBody(req); } catch (_) { return this._json(res, 400, { error: 'Invalid remembered request' }); }
    if (!lease || (lease !== this.lease && !(req.url === '/revoke' && lease === this.revocationPending)) || this.stopping || !body || Object.keys(body).length !== 1 ||
        typeof body.resumeKey !== 'string' || !/^[a-f0-9]{64}$/.test(body.resumeKey) ||
        !crypto.timingSafeEqual(Buffer.from(body.resumeKey), Buffer.from(lease.resumeKey))) return this._json(res, 403, { error: 'Remembered pairing rejected' });
    if (req.url === '/revoke') {
      await this._forget();
      return this._json(res, 200, { ok: true });
    }
    if (this._expired()) { await this._forget(); return this._json(res, 403, { error: 'Remembered pairing expired' }); }
    if (this.connected || this.pairingTicket || this.now() < (this.resumeReservedUntil || 0)) return this._json(res, 409, { error: 'Another browser connection is active' });
    this._revokeSession(new Error('Browser reconnected. Previous requests were canceled; check the website before submitting again.'));
    this.token = crypto.randomBytes(32).toString('hex');
    this.resumeReservedUntil = this.now() + 45000;
    return this._json(res, 200, { base: `http://127.0.0.1:${this.port}`, token: this.token, resumeKey: lease.resumeKey, expiresAt: lease.expiresAt });
  }

  _connection(value) {
    if (value === this.connected) return;
    this.connected = value;
    if (this.onDidChange) this.onDidChange();
  }

  async start() {
    // A reconnect requested while disconnect is closing the old listener must
    // wait for that listener (and any canceled startup) to finish first.
    const generation = this.generation;
    if (this.persistence) await this._load();
    if (generation !== this.generation) throw new Error('Browser connection startup was canceled.');
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    if (this.server && this.port) return;
    const starting = this._start();
    this.starting = starting;
    try { await starting; } finally { if (this.starting === starting) this.starting = undefined; }
  }

  async _start() {
    this.pairingTicket = undefined;
    this.token = crypto.randomBytes(32).toString('hex');
    const server = this.serverFactory((req, res) => {
      this._handle(req, res).catch(() => this._json(res, 400, { error: 'Invalid local request' }));
    });
    this.server = server;
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          server.removeListener('error', onError);
          server.removeListener('close', onClose);
        };
        const onError = error => { cleanup(); reject(error); };
        const onClose = () => onError(new Error('Browser connection startup was canceled.'));
        server.once('error', onError);
        server.once('close', onClose);
        try {
          server.listen(this.preferredPort, '127.0.0.1', () => { cleanup(); resolve(); });
        } catch (error) { onError(error); }
      });
      // stop() can revoke this listener after its callback but before this
      // continuation. Never publish a port or watchdog for a canceled session.
      if (this.server !== server || this.stopping) throw new Error('Browser connection startup was canceled.');
      // Re-read only after exclusive port ownership. A failed second window
      // must never resurrect a lease revoked by the former owner meanwhile.
      if (this.persistence) { this.loaded = false; await this._load(); }
      if (this.server !== server || this.stopping) throw new Error('Browser connection startup was canceled.');
      this.port = server.address().port;
      server.unref();
      this.watchdog = setInterval(() => {
        if (this._expired()) { void this._forget().catch(() => {}); return; }
        if (this.connected && ![...this.pending.values()].some(item => item.dispatched) && Date.now() - this.lastSeen > 45000) {
          this._connection(false);
          this._rejectAll(new Error('Browser disconnected. Reconnect your TensorTonic tab.'));
        }
      }, 15000);
      this.watchdog.unref();
    } catch (error) {
      if (this.persistence) { this.lease = undefined; this.loaded = false; }
      if (this.server === server && !this.stopping) {
        try { server.close(() => {}); server.closeAllConnections(); } catch (_) { /* Not listening. */ }
        this.server = undefined;
        this.token = undefined;
        this.port = undefined;
        this.pairingTicket = undefined;
      }
      throw new Error(`Could not start the local TensorTonic connection: ${error.message}`);
    }
  }

  connectionCode() {
    if (!this.server || !this.port) throw new Error('Start the browser connection first.');
    const source = fs.readFileSync(path.join(__dirname, 'browser-connector.js'), 'utf8');
    return `(${source})(${JSON.stringify({ base: `http://127.0.0.1:${this.port}`, token: this.token })});`;
  }

  pairingCode() {
    if (!this.server || !this.port || !this.token || this.stopping) throw new Error('Start the browser connection first.');
    if (this.connected) throw new Error('A browser is already connected. Disconnect it before creating another pairing code.');
    // A newly displayed code supersedes both earlier tickets and a redeemed
    // capability whose browser has not yet polled. Never replay old work.
    this.generation++;
    this._revokeSession(new Error('Browser pairing was renewed. Reconnect with the new pairing code.'));
    this.token = crypto.randomBytes(32).toString('hex');
    const key = crypto.randomBytes(16).toString('hex');
    this.pairingTicket = { key, port: this.port, token: this.token, expiresAt: this.now() + this.pairingTtl, attempts: 0 };
    return `TT1:${this.port}:${key}`;
  }

  _rejectPairing(res, ticket, status = 403) {
    if (ticket && this.pairingTicket === ticket) {
      ticket.attempts += 1;
      if (ticket.attempts >= MAX_PAIRING_ATTEMPTS || this.now() >= ticket.expiresAt) this.pairingTicket = undefined;
    }
    return this._json(res, status, { error: 'Pairing request rejected. Create a new pairing code and try again.' });
  }

  async _pair(req, res) {
    // Do not let other websites, forwarded hosts, URLs, or methods consume a
    // legitimate ticket. Origin alone never authorizes redemption.
    if (req.method !== 'POST' || req.url !== '/pair' || req.headers.host !== `127.0.0.1:${this.port}` || this.stopping) {
      return this._rejectPairing(res);
    }
    const ticket = this.pairingTicket;
    let body;
    try {
      let size = 0;
      const parts = [];
      // Do not destroy the request/socket until a size-limit response has been
      // flushed. Buffer at most 1 KiB even when the sender streams a larger body.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > MAX_PAIRING_BYTES) {
          res.once('finish', () => req.destroy());
          return this._rejectPairing(res, ticket, 413);
        }
        parts.push(chunk);
      }
      body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch (_) { return this._rejectPairing(res, ticket); }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof body.pairingKey !== 'string' || !/^[a-f0-9]{32}$/.test(body.pairingKey) ||
        !ticket || this.pairingTicket !== ticket || this.stopping || this.connected ||
        ticket.port !== this.port || ticket.token !== this.token || this.now() >= ticket.expiresAt ||
        !crypto.timingSafeEqual(Buffer.from(body.pairingKey), Buffer.from(ticket.key))) {
      return this._rejectPairing(res, ticket);
    }
    // No awaits between validation and consumption: simultaneous tabs cannot
    // redeem the same ticket twice, and a rotated ticket cannot revive a token.
    this.pairingTicket = undefined;
    if (this.persistence) {
      const generation = ++this.generation;
      const issuedAt = this.now();
      const lease = { resumeKey: crypto.randomBytes(32).toString('hex'), issuedAt, expiresAt: issuedAt + REMEMBER_MS, port: this.port };
      this.lease = lease;
      try { await this._persist(async () => { await this.persistence.delete(); await this.persistence.save(JSON.stringify(lease)); }); }
      catch (_) { if (this.generation === generation) { this.lease = undefined; this._revokeSession(); } return this._json(res, 500, { error: 'Could not securely save pairing. Try again.' }); }
      if (this.generation !== generation || this.stopping || this.lease !== lease || !this.token) return this._json(res, 403, { error: 'Pairing canceled' });
      this.resumeReservedUntil = this.now() + 45000;
      return this._json(res, 200, { base: `http://127.0.0.1:${this.port}`, token: this.token, resumeKey: lease.resumeKey, expiresAt: lease.expiresAt });
    }
    return this._json(res, 200, { base: `http://127.0.0.1:${this.port}`, token: this.token });
  }

  _json(res, status, value) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  async _handle(req, res) {
    const origin = req.headers.origin;
    if (!ORIGINS.has(origin)) return this._json(res, 403, { error: 'TensorTonic origin required' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return this._json(res, 200, {});
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch (_) { return this._json(res, 400, { error: 'Invalid local request' }); }
    if (['/resume', '/revoke'].includes(url.pathname)) return this._remembered(req, res);
    if (this.persistence && req.headers.host !== `127.0.0.1:${this.port}`) return this._json(res, 403, { error: 'Loopback host required' });
    if (this._expired()) { await this._forget(); return this._json(res, 403, { error: 'Remembered pairing expired' }); }
    if (url.pathname === '/pair') return this._pair(req, res);
    const supplied = url.searchParams.get('key') || '';
    if (!this.token || this.stopping || !/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== this.token.length ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token))) {
      return this._json(res, 403, { error: 'Pairing key rejected' });
    }
    const requestToken = this.token;
    this.lastSeen = Date.now();
    if (url.pathname === '/disconnect' && req.method === 'POST') {
      const acknowledged = new Promise(resolve => {
        res.once('finish', resolve);
        res.once('close', resolve);
      });
      // Revoke synchronously, but close sockets only after this acknowledgement
      // is flushed (or the requester goes away). start() waits for this teardown.
      if (this.persistence) {
        await this._forget();
      }
      void this._stopAfter(acknowledged);
      return this._json(res, 200, { ok: true });
    }
    if (url.pathname === '/poll' && req.method === 'GET') {
      this._connection(true);
      if (this.pollResponse) this._json(this.pollResponse, 409, { error: 'Another browser tab connected' });
      if (this.queue.length) return this._deliver(res, this.queue.shift());
      this.pollResponse = res;
      const timer = setTimeout(() => {
        if (this.pollResponse === res) this.pollResponse = undefined;
        this._json(res, 200, { heartbeat: true });
      }, 20000);
      res.once('close', () => { clearTimeout(timer); if (this.pollResponse === res) this.pollResponse = undefined; });
      return;
    }
    if (url.pathname === '/result' && req.method === 'POST') {
      let size = 0;
      const parts = [];
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BYTES) { this._json(res, 413, { error: 'Response too large' }); req.destroy(); return; }
          parts.push(chunk);
        }
        if (this.token !== requestToken || this.stopping || this._expired()) return this._json(res, 403, { error: 'Connection changed' });
        const result = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const pending = this.pending.get(result.id);
        if (!pending) return this._json(res, 404, { error: 'Request expired' });
        clearTimeout(pending.timer);
        this.pending.delete(result.id);
        if (result.error || result.status >= 400) {
          const body = result.data;
          const detail = body && (body.message || body.detail || body.error);
          pending.reject(new Error(result.error || (typeof detail === 'string' ? detail : `TensorTonic request failed (${result.status})`)));
        } else pending.resolve(result.data);
        return this._json(res, 200, { ok: true });
      } catch (_) { return this._json(res, 400, { error: 'Invalid browser response' }); }
    }
    return this._json(res, 404, { error: 'Not found' });
  }

  _deliver(res, item) {
    const pending = this.pending.get(item.id);
    if (pending) pending.dispatched = true;
    this._json(res, 200, item);
  }

  request(apiPath, options = {}) {
    if (this._expired()) {
      void this._forget().catch(() => {});
      return Promise.reject(new Error('Remembered pairing expired. Connect again.'));
    }
    const method = options.method || 'GET';
    if (!isAllowedRequest(apiPath, method) || (method === 'POST' && !validateBody(options.body, apiPath))) {
      return Promise.reject(new Error('Unsupported TensorTonic request. Only Python problem browsing, Run and Submit are allowed.'));
    }
    if (!this.connected || this.stopping) return Promise.reject(new Error('Connect a signed-in TensorTonic browser tab first.'));
    // One grading operation at a time; never replay an uncertain submission.
    if (method === 'POST' && [...this.pending.values()].some(x => x.method === 'POST')) {
      return Promise.reject(new Error('A TensorTonic Run or Submit is already in progress.'));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queue = this.queue.filter(x => x.id !== id);
        reject(new Error('TensorTonic request timed out. Check the website before submitting again.'));
      }, this.requestTimeout);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer, method });
      const item = { id, path: apiPath, method, body: options.body };
      if (this.pollResponse) { const res = this.pollResponse; this.pollResponse = undefined; this._deliver(res, item); }
      else this.queue.push(item);
    });
  }

  _rejectAll(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.queue.length = 0;
  }

  _revokeSession(error = new Error('TensorTonic browser disconnected.')) {
    this.pairingTicket = undefined;
    this.token = undefined;
    if (this.pollResponse) { this._json(this.pollResponse, 200, { stop: true }); this.pollResponse = undefined; }
    this._rejectAll(error);
    this._connection(false);
  }

  stop() { return this._stopAfter(); }

  async _stopAfter(acknowledged) {
    if (this.stopping) return this.stopping;
    // Install the latch before running teardown so even an onDidChange
    // callback that immediately reconnects cannot reuse the old listener.
    const stopping = Promise.resolve(acknowledged).then(() => this._stop());
    this.generation++;
    this.stopping = stopping;
    this._revokeSession();
    try { await stopping; } finally { if (this.stopping === stopping) this.stopping = undefined; }
  }

  async _stop() {
    const starting = this.starting;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    this._revokeSession();
    const server = this.server;
    this.server = undefined; this.token = undefined; this.port = undefined;
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    // Closing a listener before its listen callback rejects its startup. Wait
    // for that cancellation to clear starting before a new connection begins.
    if (starting) await starting.catch(() => {});
  }
  dispose() { void this.stop(); }
}

module.exports = { BrowserBridge, isAllowedRequest, validateBody, ORIGINS, REMEMBER_MS };
