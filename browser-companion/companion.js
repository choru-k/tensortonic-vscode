'use strict';

// Injected into the top frame's ISOLATED world only, after an extension action.
// No DOM reads, cookie access, page messages, external messages or storage.
(function installCompanion(root) {
  if (root.__tensorTonicCompanion) return;
  const shared = root.TensorTonicCompanionShared;
  let phase = 'idle';
  let errorCode;
  let generation = 0;
  let pairingController;
  let session;

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
    try {
      requirePage();
      pairing = shared.parseTicket(ticket);
      if (typeof connectTensorTonic !== 'function') throw new Error('CONNECTOR_UNAVAILABLE');
    } catch (_) {
      return { phase: 'error', errorCode: 'INVALID_TICKET_OR_PAGE' };
    } finally { ticket = ''; }
    if (pairingController || session) return { phase, errorCode: 'ALREADY_ACTIVE' };

    const attempt = ++generation;
    const controller = new AbortController();
    pairingController = controller;
    phase = 'pairing';
    errorCode = undefined;
    try {
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
      if (attempt !== generation || controller.signal.aborted) return status();
      session = config;
      phase = 'connecting';
      pairingController = undefined;
      // Callback is optional in the canonical connector. Without it, the UI
      // honestly remains "connecting" instead of claiming a successful poll.
      const connection = connectTensorTonic({
        ...config,
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

  Object.defineProperty(root, '__tensorTonicCompanion', {
    value: Object.freeze({ connect, disconnect, status }),
  });
})(globalThis);
