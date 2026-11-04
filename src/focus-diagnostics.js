'use strict';
// Local, bounded, enum-only evidence. Never persist or serialize caller objects.
const STAGES = new Set(['lookup','url','same-document','readiness','identity-target','identity-url','identity-frame','identity-location','loading','contract','contract-target','controller','create-sheet','write-sheet','restore-sheet','guard-install','visibility','result']);
const OUTCOMES = new Set(['start','ok','fail','skip','wait','canceled','applied','unavailable','off','restore-pending','awaiting-dom-verification']);
const CODES = new Set(['PAGE_CHANGED','INVALID_PROOF','INVALID_CONTRACT','INVALID_RESPONSE','CANCELED','TIMEOUT','TRANSPORT_ERROR','UNAVAILABLE','APPLY_FAILED','RESTORE_PENDING','FOCUS_NOT_APPLIED','AMBIGUOUS_TARGET','document','account-theme','body','controls-incomplete','blocked','ready','missing','count','shape','anchor-tag','anchor-text','anchor-title','anchor-contract','href-missing','href-placeholder','href-parse','href-origin','href-credentials','href-fragment','href-path','href-study-plan-path','href-query','metadata','mismatch','no-page','OTHER']);
const TARGETS = new Set(['mobile-prev','mobile-next','desktop-prev','desktop-next','desktop-browse','mobile-browse','ask-toni','top-navbar']);
function diagnosticErrorCode(error) { try { return typeof error?.code === 'string' && CODES.has(error.code) ? error.code : 'OTHER'; } catch (_) { return 'OTHER'; } }
function emitDiagnostic(callback, stage, outcome, code, target) {
  if (typeof callback !== 'function' || !STAGES.has(stage) || !OUTCOMES.has(outcome)) return;
  const event = { stage, outcome };
  if (code !== undefined) event.code = typeof code === 'string' && CODES.has(code) ? code : 'OTHER';
  if (typeof target === 'string' && TARGETS.has(target)) event.target = target;
  try { callback(Object.freeze(event)); } catch (_) { /* Diagnostics cannot affect work. */ }
}
function createFocusDiagnostics() {
  const latest = { automatic: undefined, manual: undefined };
  function begin(automatic) {
    const mode = automatic ? 'automatic' : 'manual', trace = { mode, events: [], dropped: 0 };
    latest[mode] = trace;
    const record = event => {
      if (latest[mode] !== trace) return;
      emitDiagnostic(safe => {
        const previous = trace.events.at(-1);
        if (previous && JSON.stringify(previous) === JSON.stringify(safe)) return;
        if (trace.events.length === 64) { trace.events.shift(); trace.dropped = Math.min(999, trace.dropped + 1); }
        trace.events.push(safe);
      }, event?.stage, event?.outcome, event?.code, event?.target);
    };
    return Object.freeze({ record, emit: (stage,outcome,code,target) => emitDiagnostic(record,stage,outcome,code,target), summary: () => JSON.stringify(copy(trace)) });
  }
  function copy(trace) { return trace ? Object.freeze({ mode: trace.mode, dropped: trace.dropped, events: Object.freeze(trace.events.map(event=>Object.freeze({...event}))) }) : undefined; }
  return Object.freeze({ begin, snapshot: () => Object.freeze({ automatic: copy(latest.automatic), manual: copy(latest.manual) }) });
}
module.exports = { createFocusDiagnostics, emitDiagnostic, diagnosticErrorCode };
