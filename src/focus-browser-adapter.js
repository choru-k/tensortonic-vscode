'use strict';
const { NAVBAR_SELECTOR, NAVBAR_BASE } = require('./focus-navbar');

// This module contains no production selectors, browser discovery, CDP access,
// or page script. The root supplies a port restricted to its exact owned page.
const SLUG = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';
const PROBLEM_URL = new RegExp(`^https://www\\.tensortonic\\.com/problems/${SLUG}(?:\\?studyPlan=${SLUG})?$`);
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const GONE_REASONS = new Set(['document-destroyed', 'page-closed', 'sheet-removed']);
const LAYOUT_PROPERTIES = new Set(['display', 'visibility', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'grid-template-columns', 'grid-column', 'grid-column-start', 'grid-column-end', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'overflow', 'overflow-x', 'overflow-y', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'gap', 'column-gap', 'row-gap']);

function fault(code, lease) {
  const messages = {
    INVALID_CONTRACT: 'Focus mode has no valid reviewed content contract.',
    INVALID_PROOF: 'Focus mode page verification is missing or changed.',
    PAGE_CHANGED: 'The owned problem page changed. Focus mode was not applied to another page.',
    CANCELED: 'Focus mode was canceled.',
    UNAVAILABLE: 'The owned problem page does not support this focus operation.',
    APPLY_FAILED: 'Focus mode could not confirm its stylesheet change.',
    RESTORE_PENDING: 'Focus mode cleanup is pending. Retry Off before detaching the owned page.',
  };
  const error = new Error(messages[code] || messages.UNAVAILABLE);
  error.code = code;
  if (lease) error.lease = lease;
  return error;
}

function isProblemUrl(value) {
  return typeof value === 'string' && value.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(value) && PROBLEM_URL.test(value);
}

function boundedString(value, max = 1024) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0020\u007f]/.test(value);
}

function pageSnapshot(value) {
  if (!value || value.owned !== true || !boundedString(value.id) || !boundedString(value.documentId) ||
      !boundedString(value.frameId) || !isProblemUrl(value.url)) throw fault('PAGE_CHANGED');
  return Object.freeze({ id: value.id, url: value.url, documentId: value.documentId, frameId: value.frameId, owned: true });
}

function samePage(left, right) {
  return !!left && !!right && left.id === right.id && left.url === right.url && left.documentId === right.documentId && left.frameId === right.frameId && right.owned === true;
}

function preciseSelector(value) {
  if (value === NAVBAR_SELECTOR) value = NAVBAR_BASE;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 1024 || /[\u0000-\u001f\u007f{},;@\\*<]/.test(value)) return false;
  // '>' is a CSS child combinator, not markup. Require an actual selector on
  // both sides; '<', escapes, declaration delimiters and universal targets stay
  // forbidden. This intentionally does not accept relative/empty combinators.
  if (value.split('>').some(part => !part.trim() || /^[+~]|[+~]$/.test(part.trim()))) return false;
  if (/^(?:html|body|:root)(?:$|[#.[:])/i.test(value) || /^(?:header|footer|nav|main|aside)$/i.test(value)) return false;
  // A reviewed ID, class, or exact attribute must anchor each target. Broad
  // functional selectors can silently expand to unrelated/security UI.
  return /[#.[]/.test(value) && !/:(?:has|is|where|not|host|root)\b|::/i.test(value);
}

function validateCss(cssText, selectors) {
  if (typeof cssText !== 'string' || !cssText.trim() || cssText.length > 16384 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f@\\<]|\/\*/.test(cssText)) throw fault('INVALID_CONTRACT');
  const seen = new Set();
  let offset = 0;
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  for (let match; (match = rules.exec(cssText));) {
    if (cssText.slice(offset, match.index).trim()) throw fault('INVALID_CONTRACT');
    const selector = match[1].trim();
    if (!selectors.has(selector)) throw fault('INVALID_CONTRACT');
    const declarations = match[2].split(';').filter(item => item.trim());
    if (!declarations.length) throw fault('INVALID_CONTRACT');
    for (const declaration of declarations) {
      const parsed = /^\s*([a-z-]+)\s*:\s*([-a-zA-Z0-9\s.%(),!]+)\s*$/.exec(declaration);
      if (!parsed || !LAYOUT_PROPERTIES.has(parsed[1]) || !parsed[2].trim()) throw fault('INVALID_CONTRACT');
      for (const call of parsed[2].matchAll(/([a-zA-Z-]+)\s*\(/g)) {
        if (!['calc', 'min', 'max', 'minmax', 'clamp', 'repeat', 'fit-content'].includes(call[1].toLowerCase())) throw fault('INVALID_CONTRACT');
      }
    }
    seen.add(selector); offset = rules.lastIndex;
  }
  if (cssText.slice(offset).trim() || seen.size !== selectors.size) throw fault('INVALID_CONTRACT');
}

function reviewedContract(value) {
  if (!value || value.verified !== true || value.surface !== 'problem-content' || value.hidesSecurityUI !== false ||
      !boundedString(value.id, 128) || !IDENTIFIER.test(value.id) || !Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 32) throw fault('INVALID_CONTRACT');
  const ids = new Set(); const selectors = new Set();
  const targets = value.targets.map(target => {
    if (!target || !boundedString(target.id, 128) || !IDENTIFIER.test(target.id) || ids.has(target.id) ||
        !preciseSelector(target.selector) || selectors.has(target.selector) || !Number.isSafeInteger(target.count) || target.count < 1 || target.count > 100) throw fault('INVALID_CONTRACT');
    ids.add(target.id); selectors.add(target.selector);
    return Object.freeze({ id: target.id, selector: target.selector, count: target.count });
  });
  validateCss(value.cssText, selectors);
  const contract = Object.freeze({ id: value.id, verified: true, surface: 'problem-content', hidesSecurityUI: false, targets: Object.freeze(targets), cssText: value.cssText });
  return { contract, fingerprint: JSON.stringify(contract) };
}

function checkedCounts(value, page, contract) {
  if (!samePage(page, value) || value.contractId !== contract.id || !value.counts || typeof value.counts !== 'object' || Array.isArray(value.counts) ||
      Object.keys(value.counts).length !== contract.targets.length) throw fault('INVALID_PROOF');
  const counts = Object.create(null);
  for (const target of contract.targets) {
    if (!Object.prototype.hasOwnProperty.call(value.counts, target.id) || value.counts[target.id] !== target.count) throw fault('INVALID_PROOF');
    counts[target.id] = target.count;
  }
  return Object.freeze(counts);
}

function checkSignal(signal) { if (signal?.aborted) throw fault('CANCELED'); }

class FocusBrowserAdapter {
  constructor(port) {
    if (!port || !['getPage', 'inspect', 'createStyleSheet', 'setStyleSheetText'].every(name => typeof port[name] === 'function')) throw fault('UNAVAILABLE');
    this.port = port;
    this.proofs = new WeakMap();
    this.sheets = new Set();
    this.applying = false;
  }

  async current(expected, signal, onDiagnostic) {
    checkSignal(signal);
    let page;
    try { page = pageSnapshot(await this.port.getPage(onDiagnostic ? { onDiagnostic } : undefined)); }
    catch (_) { checkSignal(signal); throw fault('PAGE_CHANGED'); }
    checkSignal(signal);
    if (expected && !samePage(expected, page)) throw fault('PAGE_CHANGED');
    return page;
  }

  async inspect(page, contract, signal, onDiagnostic) {
    checkSignal(signal);
    let result;
    try { result = await this.port.inspect(contract, onDiagnostic ? { onDiagnostic } : undefined); }
    catch (_) { checkSignal(signal); throw fault('UNAVAILABLE'); }
    checkSignal(signal);
    const counts = checkedCounts(result, page, contract);
    await this.current(page, signal, onDiagnostic);
    return counts;
  }

  async verify(snapshot, contractValue, { signal, onDiagnostic } = {}) {
    checkSignal(signal);
    const { contract, fingerprint } = reviewedContract(contractValue);
    if (!snapshot || !boundedString(snapshot.id) || !boundedString(snapshot.documentId) || !isProblemUrl(snapshot.url) || snapshot.owned === false) throw fault('PAGE_CHANGED');
    const page = await this.current(undefined, signal, onDiagnostic);
    if (snapshot.id !== page.id || snapshot.url !== page.url || snapshot.documentId !== page.documentId ||
        (snapshot.frameId !== undefined && snapshot.frameId !== page.frameId)) throw fault('PAGE_CHANGED');
    const counts = await this.inspect(page, contract, signal, onDiagnostic);
    const proof = Object.freeze({ ...page, contractId: contract.id, counts });
    this.proofs.set(proof, { page, fingerprint, used: false });
    return proof;
  }

  async apply(proof, contractValue, { signal, onDiagnostic } = {}) {
    checkSignal(signal);
    const { contract, fingerprint } = reviewedContract(contractValue);
    const verified = proof && this.proofs.get(proof);
    if (!verified || verified.used || verified.fingerprint !== fingerprint) throw fault('INVALID_PROOF');
    if (this.applying || this.sheets.size) throw fault('RESTORE_PENDING');
    verified.used = true; this.applying = true;
    let sheet;
    try {
      await this.current(verified.page, signal, onDiagnostic);
      await this.inspect(verified.page, contract, signal, onDiagnostic);
      let created;
      try { created = await this.port.createStyleSheet({ frameId: verified.page.frameId, force: true, page: verified.page }, { signal, onDiagnostic }); }
      catch (_) { checkSignal(signal); throw fault('UNAVAILABLE'); }
      const id = typeof created === 'string' ? created : created?.styleSheetId;
      if (!boundedString(id)) throw fault('UNAVAILABLE');
      sheet = { id, page: verified.page, onDiagnostic, restored: false, restoring: undefined, lease: undefined };
      sheet.lease = Object.freeze({ restore: () => this.restore(sheet) });
      this.sheets.add(sheet);
      await this.current(verified.page, signal, onDiagnostic);
      // Never race an abort against a dispatched mutation. Its late completion
      // stays owned and is emptied before apply can settle as canceled/failed.
      try { await this.port.setStyleSheetText(id, contract.cssText, { page: verified.page, signal, onDiagnostic }); }
      catch (_) { checkSignal(signal); throw fault('APPLY_FAILED'); }
      await this.current(verified.page, signal, onDiagnostic);
      return sheet.lease;
    } catch (error) {
      if (sheet) {
        try { await sheet.lease.restore(); }
        catch (_) { throw fault('RESTORE_PENDING', sheet.lease); }
      }
      if (['CANCELED', 'PAGE_CHANGED', 'UNAVAILABLE', 'INVALID_PROOF', 'APPLY_FAILED'].includes(error.code)) throw error;
      throw fault('UNAVAILABLE');
    } finally { this.applying = false; }
  }

  restore(sheet) {
    if (sheet.restored) return Promise.resolve(Object.freeze({ restored: true }));
    if (sheet.restoring) return sheet.restoring;
    const task = this.restoreOnce(sheet);
    sheet.restoring = task;
    task.then(() => { if (sheet.restoring === task) sheet.restoring = undefined; }, () => { if (sheet.restoring === task) sheet.restoring = undefined; });
    return task;
  }

  async restoreOnce(sheet) {
    let reason = 'emptied';
    try {
      // Off empties this dedicated stylesheet before the root may detach. Do not
      // use CSS.disable: detaching/disabling does not undo an inspector sheet.
      await this.port.setStyleSheetText(sheet.id, '', { page: sheet.page, ...(sheet.onDiagnostic ? { onDiagnostic: sheet.onDiagnostic } : {}) });
    } catch (_) {
      let proof;
      try { if (typeof this.port.styleSheetExists === 'function') proof = await this.port.styleSheetExists(sheet.id, { page: sheet.page }); }
      catch (_) { /* A protocol error does not prove that CSS disappeared. */ }
      if (!proof || proof.exists !== false || proof.authoritative !== true || !GONE_REASONS.has(proof.reason) ||
          (proof.styleSheetId !== undefined && proof.styleSheetId !== sheet.id) ||
          (proof.documentId !== undefined && proof.documentId !== sheet.page.documentId)) throw fault('RESTORE_PENDING', sheet.lease);
      reason = proof.reason;
    }
    sheet.restored = true; this.sheets.delete(sheet);
    return Object.freeze({ restored: true, reason });
  }
}

module.exports = { FocusBrowserAdapter, isProblemUrl };
