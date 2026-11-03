'use strict';

const crypto = require('node:crypto');
const { renderResult, formatValue } = require('./results');

const TABS = Object.freeze(['description', 'tests', 'results']);
const ACTIONS = new Set(['editTests', 'openOriginal', 'discuss', 'discussFailure', 'cancelExecution']);
const MAX_CASES = 100;

function field(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch (_) { return undefined; }
}

function text(value, fallback = '') {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 1000) : fallback;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function scriptValue(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function identity(problem) {
  // Identifiers must remain complete: display truncation must never merge two
  // otherwise distinct owners in the cache.
  const identifier = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const apiId = identifier(field(problem, 'apiId'));
  const slug = identifier(field(problem, 'slug'));
  if (!apiId && !slug) throw new TypeError('A problem workspace needs a problem apiId or slug.');
  const planId = identifier(field(problem, 'planId')) || identifier(field(problem, 'plan'));
  const key = JSON.stringify([planId, apiId ? 'api' : 'slug', apiId || slug]);
  return Object.freeze({ key, planId, apiId, slug });
}

function actionName(action) {
  const name = typeof action === 'string' ? action.toLowerCase() : '';
  if (name !== 'run' && name !== 'submit') throw new TypeError('Execution action must be run or submit.');
  return name;
}

function operationId(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1000) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new TypeError('An execution needs a string or integer operation id.');
}

function allowedCurrent(check) {
  try { return typeof check !== 'function' || check() === true; } catch (_) { return false; }
}

function viewColumn(value) { return Number.isSafeInteger(value) && value >= 1 && value <= 9; }

function caseGroups(tests) {
  if (Array.isArray(tests)) return { publicCases: tests, userCases: [] };
  function firstArray(keys) {
    for (const key of keys) {
      const candidate = field(tests, key);
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }
  return {
    publicCases: firstArray(['publicCases', 'public', 'publicTests', 'tests']),
    userCases: firstArray(['userCases', 'user', 'userTests']),
  };
}

function renderCases(cases, heading) {
  const shown = [];
  for (let index = 0; index < Math.min(cases.length, MAX_CASES); index++) {
    const item = field(cases, String(index));
    const name = text(field(item, 'name'), text(field(item, 'id'), `Case ${index + 1}`));
    const input = field(item, 'input') === undefined ? field(item, 'inputs') : field(item, 'input');
    const expected = field(item, 'expected') === undefined ?
      (field(item, 'expectedOutput') === undefined ? field(item, 'expected_output') : field(item, 'expectedOutput')) : field(item, 'expected');
    // Keep the complete structured case visible when the local schema differs.
    const values = input === undefined && expected === undefined ?
      `<div><dt>Case data</dt><dd><pre>${escapeHtml(formatValue(item))}</pre></dd></div>` :
      `${input === undefined ? '' : `<div><dt>Input</dt><dd><pre>${escapeHtml(formatValue(input))}</pre></dd></div>`}${expected === undefined ? '' : `<div><dt>Expected</dt><dd><pre>${escapeHtml(formatValue(expected))}</pre></dd></div>`}`;
    shown.push(`<li class="test-case"><h3>${escapeHtml(name)}</h3><dl>${values}</dl></li>`);
  }
  return `<section class="case-group"><h2>${heading} <span class="meta">(${cases.length})</span></h2>${shown.length ? `<ol class="case-list">${shown.join('')}</ol>` : '<p class="meta">No cases available.</p>'}${cases.length > MAX_CASES ? `<p class="notice">Showing ${MAX_CASES} of ${cases.length} cases. Open Edit JSON to inspect all local cases.</p>` : ''}</section>`;
}

function renderTestsContent(model) {
  const groups = caseGroups(model.tests);
  return `${model.testsError ? `<p class="notice" role="status">${escapeHtml(model.testsError)}</p>` : ''}${renderCases(groups.publicCases, 'Public cases')}${renderCases(groups.userCases, 'User cases')}`;
}

function renderTests(model) {
  return `<div class="tests-toolbar"><p class="meta">Read-only case preview. Edit JSON opens the native editor; changes are saved there.</p><button type="button">Edit JSON</button></div><div class="tests-content">${renderTestsContent(model)}</div>`;
}

function renderResultContent(model, action) {
  const entry = model.results[action];
  const title = action === 'run' ? 'Run — remote public-case results' : 'Submit — remote grading verdict';
  const explanation = action === 'run' ? 'Run checks the public cases. It does not confirm the Submit verdict.' : 'Submit reports the grading response for this problem.';
  return `<h2>${title}</h2><p class="meta">${explanation}</p>${entry?.freshness ? `<p class="meta">Local content: ${escapeHtml(entry.freshness.label)}${entry.freshness.timestamp ? ' · '+escapeHtml(entry.freshness.timestamp) : ''}</p>` : ''}${entry ? renderResult(entry.result, { localError: entry.localError }) + `<button type="button" data-discuss-failure="${action}">Discuss a selected failed case</button>` : '<p class="meta">No result recorded.</p>'}`;
}

function renderResults(model) {
  const entries = ['run', 'submit'].map(action => {
    const title = action === 'run' ? 'Run — remote public-case results' : 'Submit — remote grading verdict';
    return `<article class="execution-result" aria-label="${escapeHtml(title)}">${renderResultContent(model, action)}</article>`;
  });
  return `<p class="result-owner">Results for <strong>${escapeHtml(model.title)}</strong>${model.ref.planId ? ` · ${escapeHtml(model.ref.planId)}` : ''}</p>${entries.join('')}`;
}

const STYLES = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); line-height: 1.55; }
* { box-sizing: border-box; }
.workspace-shell { max-width: 1050px; margin: 0 auto; }
h1 { margin: 0; font-size: 1.6em; line-height: 1.3; overflow-wrap: anywhere; }
h2 { margin: 0 0 8px; font-size: 1.2em; } h3 { font-size: 1em; margin: 0 0 8px; } h4 { margin: 12px 0 4px; }
p { margin: 8px 0; }
.workspace-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.owner-meta, .meta { color: var(--vscode-descriptionForeground); } .owner-meta { margin: 5px 0 0; }
.header-actions, .tabs, .tests-toolbar, .operation-status, .workspace-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
button { color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground)); background: var(--vscode-button-secondaryBackground, transparent); border: 1px solid var(--vscode-contrastBorder, var(--vscode-widget-border, transparent)); border-radius: 3px; font: inherit; padding: 6px 10px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); } button:disabled { opacity: .65; cursor: default; }
button:focus-visible, a:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 3px solid var(--vscode-focusBorder, #007fd4); outline-offset: 3px; }
.tabs { gap: 0; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, #888)); margin-bottom: 16px; }
.tabs button { border-radius: 0; border: 0; border-bottom: 3px solid transparent; padding: 9px 14px; background: transparent; }
.tabs button[aria-selected="true"] { border-bottom-color: var(--vscode-focusBorder, #007fd4); font-weight: 600; color: var(--vscode-tab-activeForeground, var(--vscode-editor-foreground)); }
[hidden] { display: none !important; }
.workspace-notice, .operation-status { border: 1px solid var(--vscode-widget-border, var(--vscode-contrastBorder, #888)); border-radius: 4px; padding: 8px 12px; margin: 10px 0; }
.workspace-notice p, .operation-status p { flex: 1; margin: 0; min-width: 160px; }
.description-body { overflow-wrap: anywhere; } .description-body img, .description-body iframe { display: none; }
pre, code { font-family: var(--vscode-editor-font-family, monospace); } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 5px 0; padding: 10px; background: var(--vscode-textCodeBlock-background); border-radius: 3px; }
table { border-collapse: collapse; max-width: 100%; } th, td { padding: 6px 10px; border: 1px solid var(--vscode-widget-border, #888); }
.tests-toolbar { justify-content: space-between; margin-bottom: 16px; } .tests-toolbar p { flex: 1; min-width: 190px; }
.case-group { margin-top: 20px; } .case-list { list-style: none; margin: 0; padding: 0; } .test-case { border: 1px solid var(--vscode-widget-border, #888); border-radius: 4px; margin: 10px 0; padding: 12px; }
dl { margin: 0; } dt { font-weight: 600; } dd { margin: 0 0 8px; }
.execution-result { border-top: 1px solid var(--vscode-widget-border, #888); margin: 20px 0 0; padding-top: 16px; } .execution-result > h2 { margin-bottom: 4px; }
.result-summary { border-left: 4px solid var(--vscode-focusBorder, #007fd4); padding: 10px 14px; margin: 12px 0; background: var(--vscode-textCodeBlock-background); }
.result-passed { border-color: var(--vscode-testing-iconPassed, #388a34); } .result-failed, .result-error { border-color: var(--vscode-testing-iconFailed, #c74e39); }
.result-metrics { display: flex; flex-wrap: wrap; gap: 12px 24px; } .result-metrics dd { font-size: 1.15em; margin: 0; }
.result-case, .result-debug { border: 1px solid var(--vscode-widget-border, #888); border-radius: 3px; margin: 10px 0; padding: 8px 12px; } summary { cursor: pointer; } .result-badge { font-weight: 600; margin-left: 8px; }
.notice { overflow-wrap: anywhere; } .result-owner { margin-bottom: 12px; }
@media (max-width: 480px) { body { padding: 12px; } .tabs button { padding: 9px 10px; } }
`;

/** One local auxiliary panel; execution and JSON editing remain host-owned. */
class ProblemWorkspace {
  constructor(vscode, { onAction, getViewColumn, onDidChangeColumn } = {}) {
    this._vscode = vscode;
    this._onAction = typeof onAction === 'function' ? onAction : () => {};
    this._getViewColumn = typeof getViewColumn === 'function' ? getViewColumn : () => undefined;
    this._onDidChangeColumn = typeof onDidChangeColumn === 'function' ? onDidChangeColumn : () => {};
    this._models = new Map();
    this._panel = undefined;
    this._panelColumn = undefined;
    this._selectedKey = undefined;
    this._token = undefined;
    this._closeEpoch = 0;
    this._interactionEpoch = 0;
    this._sessionEpoch = 0;
    this._operations = new Map();
    this._retiredOperationIds = new Set();
    this._sequence = 0;
    this._notice = undefined;
    this._disposed = false;
  }

  _model(problem) {
    const ref = identity(problem);
    let model = this._models.get(ref.key);
    if (!model) {
      model = {
        ref, problem, sessionEpoch: this._sessionEpoch, title: text(field(problem, 'title'), text(field(problem, 'name'), ref.slug || ref.apiId)),
        solutionUri: undefined, descriptionHtml: '<p class="meta">Description is not loaded.</p>',
        tests: undefined, testsError: '', tab: 'description', results: { run: undefined, submit: undefined },
        latest: { run: undefined, submit: undefined }, execution: undefined,
      };
      this._models.set(ref.key, model);
    }
    return model;
  }

  show(problem, options = {}) {
    if (this._disposed || !allowedCurrent(options.isCurrent)) return false;
    const model = this._model(problem);
    // Recheck before presentation: a host guard can change while resolving refs.
    if (!allowedCurrent(options.isCurrent)) return false;
    const sameOwner = Boolean(this._panel && this._selectedKey === model.ref.key);
    const expectedInteractionEpoch = this._interactionEpoch;
    const explicitTab = TABS.includes(options.tab);
    const descriptionChanged = Object.prototype.hasOwnProperty.call(options, 'descriptionHtml') && model.descriptionHtml !== options.descriptionHtml;
    const testsChanged = Object.prototype.hasOwnProperty.call(options, 'tests') || Object.prototype.hasOwnProperty.call(options, 'testsError');
    if (!sameOwner || explicitTab) this._interactionEpoch++;
    model.problem = problem;
    model.title = text(field(problem, 'title'), text(field(problem, 'name'), model.ref.slug || model.ref.apiId));
    if (Object.prototype.hasOwnProperty.call(options, 'solutionUri')) model.solutionUri = options.solutionUri;
    if (Object.prototype.hasOwnProperty.call(options, 'descriptionHtml')) model.descriptionHtml = typeof options.descriptionHtml === 'string' ? options.descriptionHtml : '<p class="meta">Description is not loaded.</p>';
    if (Object.prototype.hasOwnProperty.call(options, 'tests')) model.tests = options.tests;
    if (Object.prototype.hasOwnProperty.call(options, 'testsError')) model.testsError = text(options.testsError, text(field(options.testsError, 'message')));
    if (explicitTab) model.tab = options.tab;
    this._selectedKey = model.ref.key;
    if (this._notice && this._notice.ownerKey === model.ref.key) this._notice = undefined;
    if (!this._panel) this._createPanel();
    this._panel.title = `TensorTonic · ${model.title}`;
    if (sameOwner) this._patch({
      title: model.title, ...this._status(),
      ...(descriptionChanged ? { descriptionHtml: model.descriptionHtml } : {}),
      ...(testsChanged ? { testsHtml: renderTestsContent(model) } : {}),
      ...(explicitTab ? { tab: model.tab, expectedInteractionEpoch } : {}),
    });
    else this._render();
    this._panel.reveal(this._columnOf(this._panel), true);
    return true;
  }

  capturePresentation() {
    return Object.freeze({ closeEpoch: this._closeEpoch, selectedKey: this._selectedKey, interactionEpoch: this._interactionEpoch, sessionEpoch: this._sessionEpoch });
  }

  setExecution(problem, { id, action, title } = {}) {
    if (this._disposed) return undefined;
    const name = actionName(action);
    const validId = operationId(id);
    if (this._retiredOperationIds.has(validId)) throw new TypeError('An execution needs a fresh operation id after a session reset.');
    const model = this._model(problem);
    const operation = Object.freeze({ id: validId, action: name, title: text(title, name === 'run' ? 'Run public cases' : 'Submit for grading'), sessionEpoch: this._sessionEpoch });
    const pending = { operation, sequence: ++this._sequence, settled: false, cancelRequested: false };
    this._operations.set(validId, { key: model.ref.key, action: name, sessionEpoch: this._sessionEpoch });
    model.latest[name] = pending;
    model.execution = pending;
    if (this._panel && this._selectedKey === model.ref.key) this._patch(this._status());
    return operation;
  }

  recordResult(problem, action, result, { operationId: id, localError = false, presentation, sessionEpoch, freshness } = {}) {
    if (this._disposed) return { stored: false, presented: false };
    const name = actionName(action);
    const presentationEpoch = field(presentation, 'sessionEpoch');
    if (sessionEpoch !== undefined && sessionEpoch !== this._sessionEpoch ||
        presentationEpoch !== undefined && presentationEpoch !== this._sessionEpoch ||
        this._retiredOperationIds.has(id)) return { stored: false, presented: false };
    const ref = identity(problem);
    const registration = this._operations.get(id);
    // Reject unknown, cross-owner, or retired operations before creating a
    // model. After a reset, unregistered results need explicit current-session
    // evidence; a missing operation id must not revive old account content.
    if (id !== undefined && (!registration || registration.key !== ref.key || registration.action !== name || registration.sessionEpoch !== this._sessionEpoch) ||
        this._sessionEpoch > 0 && !registration && sessionEpoch !== this._sessionEpoch && presentationEpoch !== this._sessionEpoch) return { stored: false, presented: false };
    const model = this._model(problem);
    const latest = model.latest[name];
    if (latest && (latest.settled || id !== undefined && latest.operation.id !== id)) return { stored: false, presented: false };
    // A completion must not silently settle a different current operation.
    if (latest && id === undefined) return { stored: false, presented: false };
    if (latest) latest.settled = true;
    model.results[name] = Object.freeze({ result, localError: localError === true, freshness, operationId: id, sequence: latest ? latest.sequence : ++this._sequence });
    if (model.execution === latest) model.execution = undefined;
    const selected = Boolean(this._panel && this._selectedKey === model.ref.key);
    if (selected) {
      const selectResults = presentation && presentation.sessionEpoch === this._sessionEpoch && presentation.closeEpoch === this._closeEpoch &&
        presentation.selectedKey === model.ref.key && presentation.interactionEpoch === this._interactionEpoch;
      if (selectResults) model.tab = 'results';
      this._patch({ ...this._status(), results: { [name]: renderResultContent(model, name) },
        ...(selectResults ? { tab: 'results', expectedInteractionEpoch: presentation.interactionEpoch } : {}) });
    } else if (this._panel) {
      this._notice = { ownerKey: model.ref.key, message: `${name === 'run' ? 'Run public-case results' : 'Submit grading verdict'} ready for ${model.title}.`, ownerTitle: model.title };
      // Leave the selected owner's DOM, focus, scroll, and disclosures intact.
      this._patch({ notice: this._notice });
    }
    return { stored: true, presented: selected };
  }

  showTab(tab, problem) {
    if (this._disposed || !TABS.includes(tab) || !this._panel) return false;
    const key = problem === undefined ? this._selectedKey : identity(problem).key;
    // Explicit owner changes use show(), or the trusted result-owner control.
    if (key !== this._selectedKey) return false;
    const model = this._models.get(key);
    if (!model) return false;
    const expectedInteractionEpoch = this._interactionEpoch++;
    model.tab = tab;
    this._patch({ tab, expectedInteractionEpoch });
    return true;
  }

  updateFreshness(problem, action, freshness, operationId) {
    const model = this._models.get(identity(problem).key), entry = model?.results[action];
    if (!entry || entry.operationId !== operationId || this._disposed) return false;
    model.results[action] = Object.freeze({ ...entry, freshness });
    if (this._panel && this._selectedKey === model.ref.key) this._patch({results:{[action]:renderResultContent(model, action)}});
    return true;
  }

  _createPanel() {
    let column = this._panelColumn;
    const groups = this._vscode.window.tabGroups?.all;
    const columns = Array.isArray(groups) ? groups.map(group => group.viewColumn).filter(viewColumn) : [];
    if (columns.length && !columns.includes(column)) column = undefined;
    if (!viewColumn(column)) {
      let desired;
      try { desired = this._getViewColumn(); } catch (_) { /* Use the local default. */ }
      column = viewColumn(desired) ? desired : viewColumn(this._vscode.ViewColumn.One) ? this._vscode.ViewColumn.One : 1;
      if (columns.length && !columns.includes(column)) column = columns[0];
    }
    const panel = this._vscode.window.createWebviewPanel('tensorTonic.problemWorkspace', 'TensorTonic Problem', { viewColumn: column, preserveFocus: true }, { enableScripts: true, enableForms: false, enableCommandUris: false, retainContextWhenHidden: true, localResourceRoots: [] });
    this._panel = panel;
    this._rememberColumn(this._columnOf(panel, column));
    panel.webview.onDidReceiveMessage(message => this._message(panel, message));
    panel.onDidDispose(() => {
      if (this._panel !== panel) return;
      // Native panel getters can already throw inside onDidDispose. Invalidate
      // ownership first and use the last live column; never query the dead panel.
      const column = this._panelColumn;
      this._panel = undefined;
      this._token = undefined;
      this._closeEpoch++;
      this._rememberColumn(column);
    });
    if (typeof panel.onDidChangeViewState === 'function') panel.onDidChangeViewState(() => {
      if (this._panel !== panel) return;
      const column = this._columnOf(panel);
      if (viewColumn(column) && column !== this._panelColumn) this._rememberColumn(column);
    });
  }

  _columnOf(panel, fallback = this._panelColumn) {
    try { const column = panel.viewColumn; return viewColumn(column) ? column : fallback; }
    catch (_) { return fallback; }
  }

  _rememberColumn(column) {
    if (!viewColumn(column)) return;
    this._panelColumn = column;
    try {
      const remembered = this._onDidChangeColumn(column);
      if (remembered && typeof remembered.then === 'function') Promise.resolve(remembered).catch(() => {});
    } catch (_) { /* Layout feedback must not interrupt the owned panel. */ }
  }

  _message(panel, message) {
    if (this._disposed || this._panel !== panel || !message || typeof message !== 'object' || Array.isArray(message)) return;
    if (field(message, 'token') !== this._token || field(message, 'modelKey') !== this._selectedKey) return;
    const model = this._models.get(this._selectedKey);
    if (!model) return;
    const type = field(message, 'type');
    if (type === 'ready') {
      // A webview can finish loading after an early execution update. Send the
      // owned model once its local listener is ready, without recreating it.
      this._patch({ ...this._status(), title: model.title, descriptionHtml: model.descriptionHtml,
        testsHtml: renderTestsContent(model), results: { run: renderResultContent(model, 'run'), submit: renderResultContent(model, 'submit') },
        tab: model.tab, expectedInteractionEpoch: this._interactionEpoch });
      return;
    }
    if (type === 'tab') {
      const tab = field(message, 'tab');
      if (TABS.includes(tab)) {
        model.tab = tab;
        this._interactionEpoch++;
        this._patch({});
      }
      return;
    }
    if (type === 'viewResultOwner') {
      if (!this._notice || field(message, 'ownerKey') !== this._notice.ownerKey) return;
      const owner = this._models.get(this._notice.ownerKey);
      if (!owner) return;
      this._selectedKey = owner.ref.key;
      this._interactionEpoch++;
      owner.tab = 'results';
      this._notice = undefined;
      this._render();
      return;
    }
    const action = field(message, 'action');
    if (type !== 'action' || !ACTIONS.has(action)) return;
    const resultAction = field(message, 'resultAction');
    if (action === 'discussFailure' && (!['run','submit'].includes(resultAction) || !model.results[resultAction])) return;
    let operation;
    if (action === 'cancelExecution') {
      const pending = model.execution;
      if (!pending || pending.settled || pending.cancelRequested || field(message, 'operationId') !== pending.operation.id) return;
      operation = pending.operation;
      pending.cancelRequested = true;
    }
    this._interactionEpoch++;
    this._patch(operation ? this._status() : {});
    const payload = Object.freeze({ action, problem: model.problem, ref: model.ref, solutionUri: model.solutionUri, sessionEpoch: this._sessionEpoch, ...(action === 'discussFailure' ? { resultAction } : {}), ...(operation ? { operation } : {}) });
    try {
      const response = this._onAction(payload);
      if (response && typeof response.then === 'function') Promise.resolve(response).catch(() => this._actionError(model));
    } catch (_) { this._actionError(model); }
  }

  _actionError(model) {
    if (this._disposed || !this._panel || this._selectedKey !== model.ref.key || this._models.get(model.ref.key) !== model || model.sessionEpoch !== this._sessionEpoch) return;
    this._notice = { message: 'The requested action could not be completed.' };
    this._patch({ notice: this._notice });
  }

  _status() {
    const model = this._models.get(this._selectedKey);
    const pending = model && model.execution;
    return {
      notice: this._notice || null,
      operation: pending ? {
        id: pending.operation.id, cancelRequested: pending.cancelRequested,
        message: `${pending.operation.title} for ${model.title}${pending.cancelRequested ? ' — cancellation requested.' : '…'}`,
      } : null,
    };
  }

  _patch(update) {
    if (!this._panel || !this._token) return;
    try {
      const webview = this._panel.webview;
      if (typeof webview.postMessage !== 'function') return;
      const posted = webview.postMessage({ type: 'workspaceUpdate', token: this._token,
        modelKey: this._selectedKey, interactionEpoch: this._interactionEpoch, ...update });
      if (posted && typeof posted.then === 'function') Promise.resolve(posted).catch(() => {});
    } catch (_) { /* Cached model will be restored when explicitly reopened. */ }
  }

  _render() {
    if (!this._panel) return;
    const model = this._models.get(this._selectedKey);
    if (!model) return;
    const nonce = crypto.randomBytes(24).toString('hex');
    this._token = crypto.randomBytes(24).toString('hex');
    const pending = model.execution;
    const notice = this._notice;
    const state = { token: this._token, modelKey: model.ref.key, tab: model.tab, interactionEpoch: this._interactionEpoch, ownerKey: notice && notice.ownerKey, operationId: pending && pending.operation.id };
    this._panel.title = `TensorTonic · ${model.title}`;
    this._panel.webview.html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>${escapeHtml(model.title)}</title><style nonce="${nonce}">${STYLES}</style></head><body>
<main class="workspace-shell">
<header class="workspace-header"><div><h1>${escapeHtml(model.title)}</h1><p class="owner-meta">${escapeHtml(model.ref.planId || 'TensorTonic problem')} · ${escapeHtml(model.ref.slug || model.ref.apiId)}</p></div><div class="header-actions" aria-label="Problem actions"><button type="button">Open original</button><button type="button">Discuss</button></div></header>
<nav class="tabs" role="tablist" aria-label="Problem workspace">${TABS.map(tab => `<button type="button" role="tab" id="workspace-tab-${tab}" aria-controls="workspace-panel-${tab}" aria-selected="${model.tab === tab}" tabindex="${model.tab === tab ? '0' : '-1'}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}</nav>
<div class="workspace-notice" role="status" aria-live="polite"${notice ? '' : ' hidden'}><p>${notice ? escapeHtml(notice.message) : ''}</p><button type="button"${notice && notice.ownerKey ? '' : ' hidden'}>View results for ${notice ? escapeHtml(notice.ownerTitle || '') : ''}</button></div>
<div class="operation-status" role="status" aria-live="polite"${pending ? '' : ' hidden'}><p>${pending ? `${escapeHtml(pending.operation.title)} for ${escapeHtml(model.title)}${pending.cancelRequested ? ' — cancellation requested.' : '…'}` : ''}</p><button type="button"${pending && !pending.cancelRequested ? '' : ' disabled'}>Cancel execution</button></div>
<div class="workspace-content"><section role="tabpanel" id="workspace-panel-description" aria-labelledby="workspace-tab-description" tabindex="0"${model.tab === 'description' ? '' : ' hidden'}><div class="description-body">${model.descriptionHtml}</div></section><section role="tabpanel" id="workspace-panel-tests" aria-labelledby="workspace-tab-tests" tabindex="0"${model.tab === 'tests' ? '' : ' hidden'}>${renderTests(model)}</section><section role="tabpanel" id="workspace-panel-results" aria-labelledby="workspace-tab-results" tabindex="0"${model.tab === 'results' ? '' : ' hidden'}>${renderResults(model)}</section></div>
</main><script nonce="${nonce}">
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const config = ${scriptValue(state)};
  // Resolve trusted controls by their static structure, never selectors inside
  // the supplied description. Description markup cannot opt into host actions.
  const shell = document.currentScript.previousElementSibling;
  const header = shell.children[0];
  const tablist = shell.children[1];
  const notice = shell.children[2];
  const operation = shell.children[3];
  const content = shell.children[4];
  const tabs = Array.from(tablist.children);
  const panels = Array.from(content.children);
  const names = ['description', 'tests', 'results'];
  const send = payload => vscode.postMessage(Object.assign({ token: config.token, modelKey: config.modelKey }, payload));
  const applyTab = name => {
    const selected = names.indexOf(name);
    if (selected < 0) return false;
    tabs.forEach((tab, index) => { tab.setAttribute('aria-selected', String(index === selected)); tab.tabIndex = index === selected ? 0 : -1; panels[index].hidden = index !== selected; });
    config.tab = name;
    vscode.setState({ modelKey: config.modelKey, tab: name, interactionEpoch: config.interactionEpoch });
    return true;
  };
  const selectTab = (name, focus) => {
    config.interactionEpoch++;
    if (!applyTab(name)) return;
    if (focus) tabs[names.indexOf(name)].focus();
    send({ type: 'tab', tab: name });
  };
  tabs.forEach((tab, index) => tab.addEventListener('click', () => selectTab(names[index], false)));
  tablist.addEventListener('keydown', event => {
    const current = tabs.indexOf(event.target);
    if (current < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(names[next], true);
  });
  const actions = header.lastElementChild.children;
  const sendAction = payload => { config.interactionEpoch++; send(Object.assign({ type: 'action' }, payload)); };
  actions[0].addEventListener('click', () => sendAction({ action: 'openOriginal' }));
  actions[1].addEventListener('click', () => sendAction({ action: 'discuss' }));
  panels[2].addEventListener('click', event => { const button = event.target.closest?.('button[data-discuss-failure]'); if (button && panels[2].contains(button)) sendAction({ action:'discussFailure', resultAction:button.dataset.discussFailure }); });
  panels[1].firstElementChild.lastElementChild.addEventListener('click', () => sendAction({ action: 'editTests' }));
  operation.lastElementChild.addEventListener('click', () => sendAction({ action: 'cancelExecution', operationId: config.operationId }));
  notice.lastElementChild.addEventListener('click', () => send({ type: 'viewResultOwner', ownerKey: config.ownerKey }));
  // Reuse the shared renderer; start all diagnostic disclosures collapsed.
  panels[2].querySelectorAll('details').forEach(details => { details.open = false; });
  const nodeKey = element => element.tagName + '|' + (element.getAttribute('href') || '') + '|' + element.textContent;
  const detailKey = details => details.className + '|' + (details.firstElementChild ? details.firstElementChild.textContent : '');
  const replaceContent = (target, html) => {
    const disclosures = new Map();
    target.querySelectorAll('details').forEach(details => {
      const key = detailKey(details);
      if (!disclosures.has(key)) disclosures.set(key, []);
      disclosures.get(key).push(details.open);
    });
    const active = document.activeElement;
    const focusKey = active && target.contains(active) ? nodeKey(active) : undefined;
    target.innerHTML = html;
    target.querySelectorAll('details').forEach(details => {
      const saved = disclosures.get(detailKey(details));
      details.open = saved && saved.length ? saved.shift() : false;
    });
    if (focusKey !== undefined) {
      const replacement = Array.from(target.querySelectorAll('a,button,summary,[tabindex]')).find(element => nodeKey(element) === focusKey);
      if (replacement) replacement.focus({ preventScroll: true });
    }
  };
  window.addEventListener('message', event => {
    const update = event.data;
    if (!update || update.type !== 'workspaceUpdate' || update.token !== config.token || update.modelKey !== config.modelKey) return;
    const x = window.scrollX, y = window.scrollY;
    if (Object.prototype.hasOwnProperty.call(update, 'notice')) {
      const value = update.notice;
      notice.hidden = !value;
      notice.firstElementChild.textContent = value ? value.message : '';
      notice.lastElementChild.hidden = !value || !value.ownerKey;
      notice.lastElementChild.textContent = 'View results for ' + (value && value.ownerTitle || '');
      config.ownerKey = value && value.ownerKey;
    }
    if (Object.prototype.hasOwnProperty.call(update, 'operation')) {
      const value = update.operation;
      operation.hidden = !value;
      operation.firstElementChild.textContent = value ? value.message : '';
      operation.lastElementChild.disabled = !value || value.cancelRequested;
      config.operationId = value && value.id;
    }
    if (typeof update.title === 'string') {
      header.firstElementChild.firstElementChild.textContent = update.title;
      document.title = update.title;
    }
    if (typeof update.descriptionHtml === 'string') replaceContent(panels[0].firstElementChild, update.descriptionHtml);
    if (typeof update.testsHtml === 'string') replaceContent(panels[1].children[1], update.testsHtml);
    if (update.results && typeof update.results === 'object') ['run', 'submit'].forEach((action, index) => {
      if (typeof update.results[action] === 'string') replaceContent(panels[2].children[index + 1], update.results[action]);
    });
    // A local click can precede its host message. Do not overwrite that intent
    // with a result-tab update already travelling in the opposite direction.
    if (names.includes(update.tab) && update.expectedInteractionEpoch === config.interactionEpoch) applyTab(update.tab);
    if (Number.isSafeInteger(update.interactionEpoch)) config.interactionEpoch = Math.max(config.interactionEpoch, update.interactionEpoch);
    window.scrollTo(x, y);
  });
  send({ type: 'ready' });
})();
</script></body></html>`;
  }

  resetSession() {
    if (this._disposed) return false;
    for (const id of this._operations.keys()) this._retiredOperationIds.add(id);
    this._operations.clear();
    this._models.clear();
    this._notice = undefined;
    this._selectedKey = undefined;
    this._token = undefined;
    this._sessionEpoch++;
    this._interactionEpoch++;
    this._closeEpoch++;
    const panel = this._panel;
    this._panel = undefined;
    if (panel) {
      this._rememberColumn(this._columnOf(panel));
      panel.dispose();
    }
    return true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const panel = this._panel;
    this._panel = undefined;
    this._token = undefined;
    this._closeEpoch++;
    if (panel) {
      this._rememberColumn(this._columnOf(panel));
      panel.dispose();
    }
    this._models.clear();
    this._operations.clear();
    this._retiredOperationIds.clear();
    this._notice = undefined;
  }
}

module.exports = { ProblemWorkspace };
