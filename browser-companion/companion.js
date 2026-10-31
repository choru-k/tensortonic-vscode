'use strict';

// Injected into the top frame's ISOLATED world only, after an extension action.
// No DOM reads, cookie access, page messages, or direct storage access.
// Remembered capabilities travel only through authenticated extension messages.
(function installCompanion(root) {
  if (root.__tensorTonicCompanion) return;
  const shared = root.TensorTonicCompanionShared;
  let phase = 'idle';
  let errorCode;
  let generation = 0;
  let pairingController;
  let session;
  let remembered;
  let resumeInProgress = false;
  let suspended = false;
  const runtime = typeof chrome !== 'undefined' && chrome.runtime;
  async function message(value) {
    if (!runtime) throw new Error('REMEMBERING_UNAVAILABLE');
    const result = await runtime.sendMessage(value);
    if (!result || result.error) throw new Error('PAIRING_STORAGE_OR_PERMISSION_ERROR');
    return result;
  }
  function startConnector(config, attempt) {
    session = config;
    phase = 'connecting';
    const connection = connectTensorTonic({
      base: config.base, token: config.token,
      onState(next) {
        if (attempt !== generation) return;
        if (next === 'connected') phase = 'connected';
        else if (next === 'disconnected') phase = 'disconnected';
      },
    });
    Promise.resolve(connection).catch(() => {
      if (attempt === generation) errorCode = 'CONNECTION_ENDED';
    }).finally(() => {
      if (attempt !== generation) return;
      session = undefined;
      phase = 'disconnected';
    });
  }
  function stopLocally() {
    generation += 1;
    if (pairingController) pairingController.abort();
    pairingController = undefined;
    if (window.__tensorTonicVSCode) window.__tensorTonicVSCode.abort();
    session = undefined;
    remembered = undefined;
    phase = 'disconnected';
    errorCode = undefined;
  }
  async function revokePending(pending) {
    if (!pending) return;
    const record = shared.validateRecord({ base: pending.base, resumeKey: pending.resumeKey, expiresAt: pending.expiresAt });
    const response = await fetch(record.base + '/revoke', {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeKey: record.resumeKey }),
      signal: AbortSignal.timeout(5000),
    });
    // A rejected capability is already unusable, so its tombstone can be removed.
    if (response.ok || response.status === 403 || response.status === 410) {
      await message({ type: 'revoked', resumeKey: record.resumeKey });
    }
  }
  async function revokeAll(result) {
    const pending = result.pendings || (result.pending ? [result.pending] : []);
    await Promise.allSettled(pending.map(record => revokePending(record)));
  }
  async function resume() {
    if (!runtime || resumeInProgress || pairingController || suspended) return;
    requirePage();
    resumeInProgress = true;
    const attempt = generation;
    try {
      const result = await message({ type: 'claim' });
      if (attempt !== generation) return;
      if (result.pending) { stopLocally(); await revokeAll(result); return; }
      if (!result.record) {
        if (remembered) stopLocally();
        return;
      }
      const record = shared.validateRecord({ base: result.record.base, resumeKey: result.record.resumeKey, expiresAt: result.record.expiresAt });
      if (session) {
        if (!remembered || remembered.resumeKey !== record.resumeKey) stopLocally();
        return;
      }
      remembered = record;
      const response = await fetch(record.base + '/resume', {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeKey: record.resumeKey }),
        signal: AbortSignal.timeout(15000),
      });
      if (attempt !== generation) return;
      if (response.status === 403 || response.status === 410) {
        await message({ type: 'invalid', resumeKey: record.resumeKey });
        remembered = undefined; phase = 'disconnected'; errorCode = 'PAIRING_EXPIRED_OR_REVOKED';
        return;
      }
      if (!response.ok) return; // Busy editor or transient outage: never take over.
      const text = await response.text();
      if (text.length > 2048) throw new Error('INVALID_PAIRING_RESPONSE');
      const config = shared.validateConnection(JSON.parse(text), record.base);
      if (config.resumeKey !== record.resumeKey || config.expiresAt !== record.expiresAt) throw new Error('INVALID_PAIRING_RESPONSE');
      if (attempt !== generation) return;
      startConnector(config, attempt);
    } catch (_) {
      // No network errors, URLs, capabilities, or account data are logged.
      if (remembered && remembered.expiresAt <= Date.now()) stopLocally();
    } finally { resumeInProgress = false; }
  }

  function requirePage() {
    if (window !== window.top || !shared.isTensorTonicPage(location.href) ||
        !['https://www.tensortonic.com', 'https://tensortonic.com'].includes(location.origin)) {
      throw new Error('WRONG_PAGE');
    }
  }

  function status() {
    return { phase, ...(errorCode ? { errorCode } : {}) };
  }

  async function connect(ticket) {
    let pairing;
    let reservation;
    try {
      requirePage();
      pairing = shared.parseTicket(ticket);
      if (typeof connectTensorTonic !== 'function') throw new Error('CONNECTOR_UNAVAILABLE');
    } catch (_) {
      return { phase: 'error', errorCode: 'INVALID_TICKET_OR_PAGE' };
    } finally { ticket = ''; }
    if (pairingController || session) return { phase, errorCode: 'ALREADY_ACTIVE' };

    suspended = false;
    const attempt = ++generation;
    const controller = new AbortController();
    pairingController = controller;
    phase = 'pairing';
    errorCode = undefined;
    try {
      if (runtime) reservation = (await message({ type: 'reserve', base: pairing.base })).reservation;
      if (attempt !== generation || controller.signal.aborted) return status();
      const response = await fetch(pairing.base + '/pair', {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingKey: pairing.pairingKey }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      pairing.pairingKey = undefined;
      if (!response.ok) throw new Error('PAIRING_REJECTED');
      const text = await response.text();
      if (text.length > 2048) throw new Error('INVALID_PAIRING_RESPONSE');
      const config = shared.validateConnection(JSON.parse(text), pairing.base);
      if (attempt !== generation || controller.signal.aborted) {
        if (config.resumeKey) {
          const record = { base: config.base, resumeKey: config.resumeKey, expiresAt: config.expiresAt };
          try { await message({ type: 'abandon', record }); await revokePending(record); } catch (_) {}
        }
        return status();
      }
      if (config.resumeKey) {
        const record = { base: config.base, resumeKey: config.resumeKey, expiresAt: config.expiresAt };
        try { await message({ type: 'save', record, reservation }); }
        catch (_) {
          // Keep a revoke-only tombstone if cancellation raced the store.
          try { await message({ type: 'abandon', record }); } catch (_) {}
          try {
            await fetch(config.base + '/revoke', { method: 'POST', credentials: 'omit', redirect: 'error',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resumeKey: config.resumeKey }),
              signal: AbortSignal.timeout(5000) });
          } catch (_) { /* Fail closed locally; server has an absolute expiry. */ }
          throw new Error('PAIRING_SAVE_FAILED');
        }
        if (attempt !== generation || controller.signal.aborted) return status();
        remembered = record;
      }
      pairingController = undefined;
      startConnector(config, attempt);
      return status();
    } catch (_) {
      if (attempt === generation) {
        session = undefined;
        phase = controller.signal.aborted ? 'disconnected' : 'error';
        errorCode = controller.signal.aborted ? undefined : 'PAIRING_FAILED';
      }
      return status();
    } finally {
      pairing.pairingKey = undefined;
      if (pairingController === controller) pairingController = undefined;
    }
  }

  async function disconnect() {
    try { requirePage(); }
    catch (_) { return { phase: 'error', errorCode: 'WRONG_PAGE' }; }
    if (runtime) {
      suspended = true;
      stopLocally();
      await message({ type: 'forget' });
      suspended = false;
      stopLocally();
      try { await revokeAll(await message({ type: 'revocations' })); } catch (_) {}
      return status();
    }
    generation += 1;
    if (pairingController) pairingController.abort();
    pairingController = undefined;
    const previous = session;
    session = undefined;
    phase = 'disconnected';
    errorCode = undefined;
    // Stop the page-side operation immediately. Never retry an uncertain POST.
    if (window.__tensorTonicVSCode) window.__tensorTonicVSCode.abort();
    if (previous) {
      try {
        await fetch(previous.base + '/disconnect?key=' + previous.token, {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
      } catch (_) { /* Editor also detects lost polling; no credentials are logged. */ }
      finally { previous.token = undefined; }
    }
    return status();
  }

  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((request, sender) => {
      if (sender.id !== runtime.id || !request || request.type !== 'forget-pairing') return;
      stopLocally();
      message({ type: 'revocations' }).then(result => revokeAll(result)).catch(() => {});
    });
    // Reconnect transport only. No Run/Submit request is ever replayed here.
    setInterval(() => { void resume(); }, 15000);
    void resume();
  }

  Object.defineProperty(root, '__tensorTonicCompanion', {
    value: Object.freeze({ connect, disconnect, status }),
  });
})(globalThis);
