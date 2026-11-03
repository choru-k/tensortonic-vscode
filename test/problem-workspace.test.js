'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { ProblemWorkspace } = require('../src/problem-workspace');
const { renderResult } = require('../src/results');

const A = Object.freeze({ planId: 'plan-a', apiId: 'api-a', slug: 'shared', title: 'Problem A' });
const B = Object.freeze({ planId: 'plan-b', apiId: 'api-a', slug: 'shared', title: 'Problem B' });

function harness(onAction, workspaceOptions = {}, nativeOptions = {}) {
  const panels = [];
  const actions = [];
  const vscode = {
    ViewColumn: { Beside: -2, One: 1 },
    window: {
      createWebviewPanel(type, title, placement, options) {
        let markup = '';
        const messageListeners = [];
        const disposeListeners = [];
        const viewListeners = [];
        const panel = {
          type, title, placement, options, disposed: false, reveals: [], updates: [], htmlWrites: 0, disposalErrors: [],
          viewColumn: placement.viewColumn === -2 ? 2 : placement.viewColumn,
          webview: {
            get html() { return markup; },
            set html(value) { markup = value; panel.htmlWrites++; panel.updates = []; panel.localTab = undefined; },
            postMessage(update) { panel.updates.push(update); if (panel.deliver) panel.deliver(update); if (update.tab) panel.localTab = update.tab; return Promise.resolve(true); },
            onDidReceiveMessage(listener) { messageListeners.push(listener); return { dispose() {} }; },
          },
          reveal(column, preserveFocus) { this.reveals.push({ column, preserveFocus }); },
          onDidDispose(listener) { disposeListeners.push(listener); return { dispose() {} }; },
          onDidChangeViewState(listener) { viewListeners.push(listener); return { dispose() {} }; },
          dispose() { if (this.disposed) return; this.disposed = true; disposeListeners.forEach(listener => { if (!nativeOptions.disposedGettersThrow) return listener(); try { listener(); } catch (error) { this.disposalErrors.push(error.message); } }); },
          emit(message) { messageListeners.forEach(listener => listener(message)); },
          move(column) { this.viewColumn = column; viewListeners.forEach(listener => listener({ webviewPanel: this })); },
        };
        if (nativeOptions.disposedGettersThrow) {
          // Native WebviewPanel properties are already invalid when its dispose
          // event is delivered. The native emitter reports listener failures
          // without making dispose() itself reject, matching the smoke trace.
          const nativeWebview = panel.webview;
          let nativeColumn = panel.viewColumn;
          let nativeTitle = panel.title;
          const alive = () => { if (panel.disposed) throw new Error('Webview is disposed'); };
          Object.defineProperties(panel, {
            viewColumn: { get() { alive(); return nativeColumn; }, set(value) { alive(); nativeColumn = value; } },
            title: { get() { alive(); return nativeTitle; }, set(value) { alive(); nativeTitle = value; } },
            webview: { get() { alive(); return nativeWebview; } },
          });
        }
        panels.push(panel);
        return panel;
      },
    },
  };
  const workspace = new ProblemWorkspace(vscode, { ...workspaceOptions, onAction: payload => { actions.push(payload); return onAction && onAction(payload); } });
  return { vscode, workspace, panels, actions, get panel() { return panels[panels.length - 1]; } };
}

function script(panel) {
  const html = panel.webview.html;
  const start = html.lastIndexOf('<script nonce=');
  return html.slice(start).match(/<script nonce="[a-f0-9]+">([\s\S]*)<\/script>/)[1];
}

function config(panel) {
  return JSON.parse(script(panel).match(/^  const config = (.+);$/m)[1]);
}

function send(panel, message, captured = config(panel)) {
  if (message.type === 'tab' && ['description', 'tests', 'results'].includes(message.tab) && captured.token === config(panel).token && captured.modelKey === config(panel).modelKey) panel.localTab = message.tab;
  panel.emit({ token: captured.token, modelKey: captured.modelKey, ...message });
}

function tabIs(panel, tab) {
  return (panel.localTab || config(panel).tab) === tab;
}

function rendered(panel) {
  const state = {};
  for (const update of panel.updates) {
    if (update.results) state.results = { ...state.results, ...update.results };
    for (const key of ['descriptionHtml', 'testsHtml', 'notice', 'operation']) if (Object.prototype.hasOwnProperty.call(update, key)) state[key] = update[key];
  }
  let html = panel.webview.html;
  if (state.descriptionHtml !== undefined) html = html.replace(/(<div class="description-body">)[\s\S]*?(<\/div><\/section><section role="tabpanel" id="workspace-panel-tests")/, (_, start, end) => start + state.descriptionHtml + end);
  if (state.testsHtml !== undefined) html = html.replace(/(<div class="tests-content">)[\s\S]*?(<\/div><\/section><section role="tabpanel" id="workspace-panel-results")/, (_, start, end) => start + state.testsHtml + end);
  for (const [action, result] of Object.entries(state.results || {})) {
    const label = action === 'run' ? 'Run — remote public-case results' : 'Submit — remote grading verdict';
    html = html.replace(new RegExp(`(<article class="execution-result" aria-label="${label}">)[\\s\\S]*?(</article>)`), (_, start, end) => start + result + end);
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  for (const value of [state.notice, state.operation]) if (value) html += `<p>${escape(value.message)}</p>`;
  return html;
}

test('one retained panel reuses its group and preserves focus on every explicit show', () => {
  const h = harness(undefined, { getViewColumn: () => 2 });
  assert.equal(h.workspace.show(A), true);
  h.workspace.show(B, { tab: 'tests' });
  h.workspace.show(A, { tab: 'results' });
  assert.equal(h.panels.length, 1);
  assert.equal(h.panel.options.retainContextWhenHidden, true);
  assert.equal(h.panel.options.enableScripts, true);
  assert.equal(h.panel.options.enableForms, false);
  assert.equal(h.panel.options.enableCommandUris, false);
  assert.deepEqual(h.panel.options.localResourceRoots, []);
  assert.deepEqual(h.panel.placement, { viewColumn: 2, preserveFocus: true });
  assert.deepEqual(h.panel.reveals, Array(3).fill({ column: 2, preserveFocus: true }));
  h.panel.move(4);
  h.workspace.show(B);
  assert.deepEqual(h.panel.reveals.at(-1), { column: 4, preserveFocus: true });
  h.panel.dispose();
  h.workspace.show(A);
  assert.equal(h.panels.length, 2);
  assert.deepEqual(h.panel.placement, { viewColumn: 4, preserveFocus: true });
});

test('layout hooks validate the initial left-group choice and retain only owned column feedback', () => {
  const columns = [];
  let desired = 3;
  let requests = 0;
  const h = harness(undefined, {
    getViewColumn: () => { requests++; return desired; },
    onDidChangeColumn: column => columns.push(column),
  });
  h.workspace.show(A);
  assert.deepEqual(h.panel.placement, { viewColumn: 3, preserveFocus: true });
  assert.deepEqual(columns, [3]);
  h.workspace.show(B);
  assert.deepEqual(columns, [3]);
  h.panel.move(5);
  h.panel.move(5);
  assert.deepEqual(columns, [3, 5]);
  const oldPanel = h.panel;
  desired = 2;
  oldPanel.dispose();
  h.workspace.show(A);
  assert.equal(requests, 1);
  assert.deepEqual(h.panel.placement, { viewColumn: 5, preserveFocus: true });
  assert.deepEqual(columns, [3, 5, 5, 5]);
  oldPanel.move(7);
  assert.deepEqual(columns, [3, 5, 5, 5]);
  h.workspace.resetSession();
  h.workspace.show(B);
  assert.deepEqual(h.panel.placement, { viewColumn: 5, preserveFocus: true });
  assert.deepEqual(columns, [3, 5, 5, 5, 5, 5]);
  h.workspace.dispose();
  assert.deepEqual(columns, [3, 5, 5, 5, 5, 5, 5]);
  for (const invalid of [undefined, 0, -2, 10, '2', NaN]) {
    const fallback = harness(undefined, { getViewColumn: () => invalid });
    fallback.workspace.show(A);
    assert.deepEqual(fallback.panel.placement, { viewColumn: 1, preserveFocus: true });
    fallback.workspace.dispose();
  }
  const failedHook = harness(undefined, { getViewColumn: () => { throw new Error('synthetic layout failure'); }, onDidChangeColumn: () => { throw new Error('synthetic feedback failure'); } });
  assert.equal(failedHook.workspace.show(A), true);
  assert.equal(failedHook.panel.placement.viewColumn, 1);
  failedHook.workspace.dispose();
});

test('a guarded late description cannot replace the selected problem or create a panel', () => {
  const h = harness();
  assert.equal(h.workspace.show(A, { descriptionHtml: '<p>late A</p>', isCurrent: () => false }), false);
  assert.equal(h.panels.length, 0);
  h.workspace.show(B, { descriptionHtml: '<p>Current B</p>' });
  const before = rendered(h.panel);
  h.workspace.show(A, { descriptionHtml: '<p>late A</p>', isCurrent: () => false });
  assert.equal(rendered(h.panel), before);
  let checks = 0;
  h.workspace.show(A, { isCurrent: () => ++checks === 1 });
  assert.equal(rendered(h.panel), before);
  h.workspace.show(A, { isCurrent: () => { throw new Error('guard expired'); } });
  assert.equal(rendered(h.panel), before);
});

test('Run and Submit have separate labelled results and reuse the shared renderer', () => {
  const h = harness();
  const run = { status: 'failed', passed: 1, total: 2, tests: [{ status: 'failed', actual: 'wrong' }] };
  const submit = { status: 'accepted', passed: 10, total: 10 };
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'run-1', action: 'Run' });
  assert.deepEqual(h.workspace.recordResult(A, 'run', run, { operationId: 'run-1' }), { stored: true, presented: true });
  h.workspace.setExecution(A, { id: 'submit-1', action: 'submit' });
  h.workspace.recordResult(A, 'Submit', submit, { operationId: 'submit-1' });
  const html = rendered(h.panel);
  assert.match(html, /Run — remote public-case results/);
  assert.match(html, /Submit — remote grading verdict/);
  assert.match(html, /Results for <strong>Problem A<\/strong>/);
  assert.ok(html.includes(renderResult(run)));
  assert.ok(html.includes(renderResult(submit)));
  assert.ok(html.indexOf('aria-label="Grading summary"') < html.indexOf('class="result-cases"'));
  assert.match(script(h.panel), /details\.open = false/);
  assert.ok(!/<details class="result-debug" open/.test(html));
});

test('cross-plan completion stays cached and offers an explicit owner-result control', () => {
  const h = harness();
  const solutionA = Object.freeze({ path: '/synthetic/plan-a/shared.py' });
  const solutionB = Object.freeze({ path: '/synthetic/plan-b/shared.py' });
  h.workspace.show(A, { descriptionHtml: '<p>description A</p>', solutionUri: solutionA });
  const presentation = h.workspace.capturePresentation();
  h.workspace.setExecution(A, { id: 'a-run', action: 'run' });
  h.workspace.show(B, { descriptionHtml: '<p>description B</p>', solutionUri: solutionB });
  const reveals = h.panel.reveals.length;
  assert.deepEqual(h.workspace.recordResult(A, 'run', { status: 'failed', message: 'Only A result' }, { operationId: 'a-run', presentation }), { stored: true, presented: false });
  assert.equal(h.panel.title, 'TensorTonic · Problem B');
  assert.ok(rendered(h.panel).includes('<p>description B</p>'));
  assert.ok(!rendered(h.panel).includes('Only A result'));
  assert.match(rendered(h.panel), /Run public-case results ready for Problem A/);
  assert.equal(h.panel.reveals.length, reveals);
  const current = config(h.panel);
  assert.equal(current.modelKey, JSON.stringify(['plan-b', 'api', 'api-a']));
  send(h.panel, { type: 'viewResultOwner', ownerKey: JSON.stringify(['plan-a', 'api', 'api-a']) });
  assert.equal(h.panel.title, 'TensorTonic · Problem A');
  assert.equal(tabIs(h.panel, 'results'), true);
  assert.match(rendered(h.panel), /Only A result/);
  assert.equal(h.actions.length, 0);
  send(h.panel, { type: 'action', action: 'editTests', solutionUri: '/wrong/problem.py', problem: B });
  assert.equal(h.actions[0].solutionUri, solutionA);
  assert.equal(h.actions[0].problem, A);
});

test('legacy slug identities never collide with API ids or equal slugs in other plans', () => {
  const h = harness();
  const legacy = { planId: 'plan-a', slug: 'api-a', title: 'Legacy slug' };
  h.workspace.show(legacy);
  h.workspace.recordResult(legacy, 'run', { message: 'legacy-only' });
  h.workspace.show(A);
  assert.equal(config(h.panel).modelKey, JSON.stringify(['plan-a', 'api', 'api-a']));
  assert.ok(!rendered(h.panel).includes('legacy-only'));
  h.workspace.recordResult(A, 'run', { message: 'plan-a-only' });
  h.workspace.show(B);
  assert.ok(!rendered(h.panel).includes('plan-a-only'));
  assert.ok(!rendered(h.panel).includes('legacy-only'));
  h.workspace.show(legacy);
  assert.equal(config(h.panel).modelKey, JSON.stringify(['plan-a', 'slug', 'api-a']));
  assert.match(rendered(h.panel), /legacy-only/);
  const longPrefix = 'x'.repeat(1000);
  h.workspace.show({ planId: 'plan-a', slug: `${longPrefix}a`, title: 'Long A' });
  h.workspace.recordResult({ planId: 'plan-a', slug: `${longPrefix}a` }, 'run', { message: 'long-a-only' });
  h.workspace.show({ planId: 'plan-a', slug: `${longPrefix}b`, title: 'Long B' });
  assert.ok(!rendered(h.panel).includes('long-a-only'));
});

test('closing while executing stores completion without reopening and explicit reopen restores it', () => {
  const h = harness();
  h.workspace.show(A, { descriptionHtml: '<p>cached description</p>', tests: { userCases: [{ input: 'cached input' }] } });
  const presentation = h.workspace.capturePresentation();
  assert.equal(Object.isFrozen(presentation), true);
  h.workspace.setExecution(A, { id: 'running', action: 'run' });
  const oldPanel = h.panel;
  oldPanel.dispose();
  assert.equal(h.workspace.capturePresentation().closeEpoch, presentation.closeEpoch + 1);
  const oldHtml = oldPanel.webview.html;
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'completion after close' }, { operationId: 'running', presentation }), { stored: true, presented: false });
  assert.equal(h.panels.length, 1);
  assert.equal(oldPanel.webview.html, oldHtml);
  assert.equal(h.workspace.showTab('results', A), false);
  h.workspace.show(A, { tab: 'results' });
  assert.equal(h.panels.length, 2);
  assert.match(rendered(h.panel), /completion after close/);
  assert.match(rendered(h.panel), /cached description/);
  assert.match(rendered(h.panel), /cached input/);
});

test('native disposal invalidates panel getters before callbacks; late results cache and a reopened panel runs again', () => {
  const columns = [];
  const h = harness(undefined, { onDidChangeColumn: column => columns.push(column) }, { disposedGettersThrow: true });
  h.workspace.show(A, { descriptionHtml: '<p>retained description</p>' });
  h.panel.move(4);
  const first = h.panel;
  const captured = config(first);
  const presentation = h.workspace.capturePresentation();
  h.workspace.setExecution(A, { id: 'native-delayed-1', action: 'run' });
  first.dispose();
  assert.throws(() => first.viewColumn, /Webview is disposed/);
  assert.deepEqual(first.disposalErrors, []);
  assert.equal(h.workspace.capturePresentation().closeEpoch, presentation.closeEpoch + 1);
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'first result after native close' }, { operationId: 'native-delayed-1', presentation }), { stored: true, presented: false });
  assert.equal(h.panels.length, 1);
  assert.equal(h.workspace.show(A, { tab: 'results' }), true);
  assert.equal(h.panels.length, 2);
  assert.notEqual(h.panel, first);
  assert.equal(h.panel.placement.viewColumn, 4);
  assert.match(rendered(h.panel), /first result after native close/);
  assert.match(rendered(h.panel), /retained description/);
  first.emit({ token: captured.token, modelKey: captured.modelKey, type: 'action', action: 'discuss' });
  assert.equal(h.actions.length, 0);
  h.workspace.setExecution(A, { id: 'native-delayed-2', action: 'run' });
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'second run completed' }, { operationId: 'native-delayed-2' }), { stored: true, presented: true });
  assert.match(rendered(h.panel), /second run completed/);
  assert.equal(h.panels.length, 2);
  assert.deepEqual(columns, [1, 4, 4, 4]);
  h.workspace.dispose();
  assert.deepEqual(h.panel.disposalErrors, []);
});

test('old presentation cannot change a tab after close and explicit reopen', () => {
  const h = harness();
  h.workspace.show(A);
  const old = h.workspace.capturePresentation();
  h.workspace.setExecution(A, { id: 1, action: 'run' });
  h.panel.dispose();
  h.workspace.show(A, { tab: 'tests' });
  const reveals = h.panel.reveals.length;
  h.workspace.recordResult(A, 'run', { status: 'passed' }, { operationId: 1, presentation: old });
  assert.equal(tabIs(h.panel, 'tests'), true);
  assert.equal(h.panel.reveals.length, reveals);
  h.workspace.setExecution(A, { id: 2, action: 'run' });
  const current = h.workspace.capturePresentation();
  h.workspace.recordResult(A, 'run', { status: 'passed' }, { operationId: 2, presentation: current });
  assert.equal(tabIs(h.panel, 'results'), true);
});

test('a newer operation owns its result and duplicate or missing-id completions are ignored', () => {
  const h = harness();
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'old', action: 'run' });
  h.workspace.setExecution(A, { id: 'new', action: 'run' });
  const before = rendered(h.panel);
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'stale' }, { operationId: 'old' }), { stored: false, presented: false });
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'no id' }), { stored: false, presented: false });
  assert.equal(rendered(h.panel), before);
  h.workspace.recordResult(A, 'run', { message: 'new outcome' }, { operationId: 'new' });
  const accepted = rendered(h.panel);
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'duplicate' }, { operationId: 'new' }), { stored: false, presented: false });
  assert.equal(rendered(h.panel), accepted);
  assert.match(accepted, /new outcome/);
  assert.ok(!accepted.includes('stale'));
});

test('finishing one action does not clear another current execution', () => {
  const h = harness();
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'run', action: 'run' });
  const submit = h.workspace.setExecution(A, { id: 'submit', action: 'submit', title: 'Submit current solution' });
  h.workspace.recordResult(A, 'run', { status: 'passed' }, { operationId: 'run' });
  send(h.panel, { type: 'action', action: 'cancelExecution', operationId: 'submit' });
  assert.equal(h.actions[0].operation, submit);
});

test('only the current panel token and owned model may dispatch fixed actions', () => {
  const h = harness();
  const solution = Object.freeze({ fsPath: '/synthetic/a.py' });
  h.workspace.show(A, { solutionUri: solution });
  const old = config(h.panel);
  h.workspace.show(B);
  send(h.panel, { type: 'action', action: 'editTests' }, old);
  send(h.panel, { type: 'action', action: 'editTests', token: 'wrong' });
  send(h.panel, { type: 'action', action: 'editTests', modelKey: old.modelKey });
  for (const action of ['run', 'submit', 'openUri', 'executeCommand', '__proto__']) send(h.panel, { type: 'action', action, uri: 'command:evil' });
  send(h.panel, { type: 'tab', tab: 'anything' });
  assert.equal(h.actions.length, 0);
  const oldPanel = h.panel;
  const oldToken = config(oldPanel);
  oldPanel.dispose();
  h.workspace.show(A);
  send(oldPanel, { type: 'action', action: 'discuss' }, oldToken);
  assert.equal(h.actions.length, 0);
  for (const action of ['editTests', 'openOriginal', 'discuss']) send(h.panel, { type: 'action', action, problem: B, solutionUri: '/evil' });
  assert.deepEqual(h.actions.map(action => action.action), ['editTests', 'openOriginal', 'discuss']);
  for (const payload of h.actions) {
    assert.equal(payload.problem, A);
    assert.equal(payload.solutionUri, solution);
    assert.equal(Object.isFrozen(payload), true);
    assert.equal(Object.isFrozen(payload.ref), true);
  }
});

test('cancel requires the current operation and fires once without clearing it prematurely', () => {
  const h = harness();
  h.workspace.show(A);
  const operation = h.workspace.setExecution(A, { id: 'op-1', action: 'run', title: 'Run public cases' });
  assert.equal(Object.isFrozen(operation), true);
  const captured = config(h.panel);
  send(h.panel, { type: 'action', action: 'cancelExecution', operationId: 'old' });
  assert.equal(h.actions.length, 0);
  send(h.panel, { type: 'action', action: 'cancelExecution', operationId: 'op-1' });
  assert.equal(h.actions.length, 1);
  assert.equal(h.actions[0].operation, operation);
  assert.match(rendered(h.panel), /cancellation requested/);
  send(h.panel, { type: 'action', action: 'cancelExecution', operationId: 'op-1' }, captured);
  send(h.panel, { type: 'action', action: 'cancelExecution', operationId: 'op-1' });
  assert.equal(h.actions.length, 1);
  h.workspace.recordResult(A, 'run', { message: 'Cancelled locally' }, { operationId: 'op-1', localError: true });
  assert.match(rendered(h.panel), /Request error/);
  assert.match(rendered(h.panel), /Cancelled locally/);
  send(h.panel, { type: 'action', action: 'cancelExecution', operationId: 'op-1' });
  assert.equal(h.actions.length, 1);
});

test('case preview is read-only, escaped, bounded, and supports public and user cases', () => {
  const h = harness();
  const evil = '</pre><script>alert("x")</script><img src="https://evil.invalid/x">';
  h.workspace.show(A, { tab: 'tests', tests: { publicCases: [{ name: evil, inputs: { value: evil }, expected_output: evil }], userCases: [{ input: 'user-input', expected: 'user-output' }] }, testsError: evil });
  const html = rendered(h.panel);
  assert.match(html, /Public cases <span class="meta">\(1\)/);
  assert.match(html, /User cases <span class="meta">\(1\)/);
  assert.match(html, /user-input/);
  assert.match(html, /user-output/);
  assert.ok(!html.includes(evil));
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.ok(!/<(?:textarea|input|form)\b/i.test(html));
  assert.equal(h.actions.length, 0);
  send(h.panel, { type: 'action', action: 'editTests' });
  assert.equal(h.actions.length, 1);
  h.workspace.show(A, { tests: { public: Array.from({ length: 102 }, (_, index) => ({ input: index })) }, testsError: '' });
  assert.match(rendered(h.panel), /Showing 100 of 102 cases/);
  assert.equal((rendered(h.panel).match(/class="test-case"/g) || []).length, 100);
});

test('titles, identifiers, operation names, and results are escaped under a strict local CSP', () => {
  const h = harness();
  const injection = '</script><script src="https://evil.invalid/a.js"></script>\u2028&"';
  const problem = { planId: injection, apiId: injection, slug: injection, title: injection };
  h.workspace.show(problem);
  h.workspace.setExecution(problem, { id: injection, action: 'submit', title: injection });
  h.workspace.recordResult(problem, 'submit', { status: 'error', error: injection }, { operationId: injection });
  const html = rendered(h.panel);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  for (const directive of ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "object-src 'none'", "img-src 'none'", "font-src 'none'", "connect-src 'none'"]) assert.ok(csp.includes(directive));
  assert.ok(!csp.includes('unsafe-inline'));
  assert.ok(!/<(?:iframe|img)\b/i.test(html));
  assert.ok(!/<script\b[^>]*\bsrc=/i.test(html));
  assert.ok(!html.includes(injection));
  const nonce = html.match(/script-src 'nonce-([a-f0-9]+)'/)[1];
  assert.match(html, new RegExp(`<style nonce="${nonce}">`));
  assert.match(html, new RegExp(`<script nonce="${nonce}">`));
  assert.equal(config(h.panel).modelKey, JSON.stringify([injection, 'api', injection]));
  assert.ok(!script(h.panel).includes('</script>'));
});

test('tabs have accessible relationships, visible focus, and keyboard handlers', () => {
  const h = harness();
  h.workspace.show(A, { tab: 'tests' });
  const html = rendered(h.panel);
  assert.match(html, /role="tablist" aria-label="Problem workspace"/);
  for (const tab of ['description', 'tests', 'results']) {
    assert.match(html, new RegExp(`role="tab" id="workspace-tab-${tab}" aria-controls="workspace-panel-${tab}"`));
    assert.match(html, new RegExp(`role="tabpanel" id="workspace-panel-${tab}" aria-labelledby="workspace-tab-${tab}" tabindex="0"`));
  }
  assert.match(html, /:focus-visible/);
  assert.match(html, /outline: 3px solid/);
  assert.match(html, /aria-live="polite"/);
  assert.equal(tabIs(h.panel, 'tests'), true);
});

class Element {
  constructor(children = [], tagName = 'DIV') {
    this.children = children; this.tagName = tagName; this.listeners = {}; this.attributes = {};
    this.hidden = false; this.focused = false; this.textContent = ''; this.className = ''; this.innerHTMLWrites = 0;
  }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  get innerHTML() { return this.markup || ''; }
  set innerHTML(value) {
    this.innerHTMLWrites++;
    this.markup = value;
    if (this.ownerDocument && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = undefined;
    this.children = Array.from(value.matchAll(/<details class="([^"]+)"[^>]*><summary>([\s\S]*?)<\/summary>/g), match => {
      const summary = new Element([], 'SUMMARY');
      summary.textContent = match[2].replace(/<[^>]*>/g, '');
      const detail = new Element([summary], 'DETAILS');
      detail.className = match[1];
      detail.open = true;
      return detail;
    });
    this.attach(this.ownerDocument);
  }
  attach(document) { this.ownerDocument = document; this.children.forEach(child => child.attach(document)); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  focus(options) { this.focused = true; this.focusOptions = options; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return all;
    if (selector === 'details') return all.filter(child => child.tagName === 'DETAILS');
    return all.filter(child => ['A', 'BUTTON', 'SUMMARY'].includes(child.tagName) || child.attributes.tabindex !== undefined);
  }
  click() { if (this.listeners.click) this.listeners.click({ target: this }); }
}

function runLocalScript(panel) {
  const buttons = [new Element([], 'BUTTON'), new Element([], 'BUTTON')];
  const header = new Element([new Element([new Element([], 'H1'), new Element([], 'P')]), new Element(buttons)]);
  const tabs = [new Element([], 'BUTTON'), new Element([], 'BUTTON'), new Element([], 'BUTTON')];
  const tablist = new Element(tabs);
  const viewOwner = new Element([], 'BUTTON');
  const notice = new Element([new Element(), viewOwner]);
  const cancel = new Element([], 'BUTTON');
  const operation = new Element([new Element(), cancel]);
  const edit = new Element([], 'BUTTON');
  const attacker = new Element();
  const details = [new Element([new Element([], 'SUMMARY')], 'DETAILS'), new Element([new Element([], 'SUMMARY')], 'DETAILS')];
  details.forEach((detail, index) => { detail.className = 'result-debug'; detail.open = true; detail.firstElementChild.textContent = `Detail ${index}`; });
  const articles = [new Element([details[0]], 'ARTICLE'), new Element([details[1]], 'ARTICLE')];
  const panels = [new Element([new Element([attacker])]), new Element([new Element([new Element(), edit]), new Element()]), new Element([new Element(), ...articles])];
  const shell = new Element([header, tablist, notice, operation, new Element(panels)]);
  const posted = [];
  const states = [];
  const document = { currentScript: { previousElementSibling: shell }, activeElement: undefined };
  shell.attach(document);
  const listeners = {};
  const window = {
    scrollX: 0, scrollY: 0, scrolls: [],
    addEventListener(type, listener) { listeners[type] = listener; },
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; this.scrolls.push({ x, y }); },
  };
  vm.runInNewContext(script(panel), {
    document, window,
    acquireVsCodeApi: () => ({ postMessage: value => posted.push(value), setState: value => states.push(value) }),
  });
  const bootPosted = posted.splice(0);
  const receive = update => listeners.message({ data: update });
  panel.updates.forEach(receive);
  panel.deliver = receive;
  return { buttons, tabs, tablist, panels, edit, attacker, cancel, viewOwner, notice, operation, posted, bootPosted, states, details, articles, document, window, receive };
}

test('local tab script implements arrow/Home/End roving focus and closes diagnostics', () => {
  const h = harness();
  h.workspace.show(A);
  const ui = runLocalScript(h.panel);
  function key(target, keyName) {
    let prevented = false;
    ui.tablist.listeners.keydown({ target, key: keyName, preventDefault() { prevented = true; } });
    return prevented;
  }
  assert.deepEqual(ui.details.map(detail => detail.open), [false, false]);
  assert.equal(key(ui.tabs[0], 'ArrowRight'), true);
  assert.equal(ui.tabs[1].focused, true);
  assert.equal(ui.tabs[1].tabIndex, 0);
  assert.equal(ui.panels[1].hidden, false);
  assert.equal(ui.panels[0].hidden, true);
  assert.equal(ui.posted.at(-1).tab, 'tests');
  assert.equal(key(ui.tabs[0], 'ArrowLeft'), true);
  assert.equal(ui.posted.at(-1).tab, 'results');
  assert.equal(key(ui.tabs[1], 'Home'), true);
  assert.equal(ui.posted.at(-1).tab, 'description');
  assert.equal(key(ui.tabs[0], 'End'), true);
  assert.equal(ui.posted.at(-1).tab, 'results');
  assert.equal(key(ui.tabs[0], 'Escape'), false);
  assert.equal(key(ui.attacker, 'End'), false);
  ui.tabs[0].click();
  assert.equal(ui.posted.at(-1).type, 'tab');
  assert.equal(ui.posted.at(-1).tab, 'description');
});

test('local script wires only static controls to fixed host actions', () => {
  const h = harness();
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'script-op', action: 'run' });
  const ui = runLocalScript(h.panel);
  ui.attacker.click();
  assert.equal(ui.posted.length, 0);
  ui.buttons[0].click();
  ui.buttons[1].click();
  ui.edit.click();
  ui.cancel.click();
  assert.deepEqual(ui.posted.map(value => value.action), ['openOriginal', 'discuss', 'editTests', 'cancelExecution']);
  assert.equal(ui.posted.at(-1).operationId, 'script-op');
  for (const value of ui.posted) {
    assert.equal(value.token, config(h.panel).token);
    assert.equal(value.modelKey, config(h.panel).modelKey);
  }
});

test('tab messages persist the selection without rerendering or revealing', () => {
  const h = harness();
  h.workspace.show(A);
  const before = rendered(h.panel);
  const reveals = h.panel.reveals.length;
  send(h.panel, { type: 'tab', tab: 'tests' });
  assert.equal(rendered(h.panel), before);
  h.workspace.setExecution(A, { id: 1, action: 'run' });
  assert.equal(tabIs(h.panel, 'tests'), true);
  assert.equal(h.panel.reveals.length, reveals);
  assert.equal(h.workspace.showTab('results', B), false);
  assert.equal(h.workspace.showTab('invalid', A), false);
  assert.equal(h.workspace.showTab('results', A), true);
  assert.equal(h.panel.reveals.length, reveals);
});

test('FOCUS2: a user tab switch after execution starts prevents automatic Results selection', () => {
  const h = harness();
  h.workspace.show(A);
  const presentation = h.workspace.capturePresentation();
  h.workspace.setExecution(A, { id: 'focus-run', action: 'run' });
  send(h.panel, { type: 'tab', tab: 'tests' });
  assert.ok(h.workspace.capturePresentation().interactionEpoch > presentation.interactionEpoch);
  const writes = h.panel.htmlWrites;
  h.workspace.recordResult(A, 'run', { status: 'passed' }, { operationId: 'focus-run', presentation });
  assert.equal(tabIs(h.panel, 'tests'), true);
  assert.equal(h.panel.htmlWrites, writes);
  assert.equal(Object.prototype.hasOwnProperty.call(h.panel.updates.at(-1), 'tab'), false);
  assert.match(h.panel.updates.at(-1).results.run, /Grading summary/);
  h.workspace.setExecution(A, { id: 'next-run', action: 'run' });
  const next = h.workspace.capturePresentation();
  h.workspace.showTab('description', A);
  h.workspace.recordResult(A, 'run', {}, { operationId: 'next-run', presentation: next });
  assert.equal(tabIs(h.panel, 'description'), true);
  h.workspace.showTab('tests', A);
  const editing = h.workspace.capturePresentation();
  h.workspace.setExecution(A, { id: 'editing-run', action: 'run' });
  send(h.panel, { type: 'action', action: 'editTests' });
  h.workspace.recordResult(A, 'run', {}, { operationId: 'editing-run', presentation: editing });
  assert.equal(tabIs(h.panel, 'tests'), true);
});

test('FOCUS2: a background owner completion preserves the visible DOM, focus, scroll, and disclosures', () => {
  const h = harness();
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'background-a', action: 'run' });
  h.workspace.show(B, { tab: 'tests' });
  const ui = runLocalScript(h.panel);
  ui.edit.focus();
  ui.details[1].open = true;
  ui.window.scrollX = 7;
  ui.window.scrollY = 642;
  const writes = h.panel.htmlWrites;
  const reveals = h.panel.reveals.length;
  const markup = h.panel.webview.html;
  h.workspace.recordResult(A, 'run', { message: 'A completion' }, { operationId: 'background-a' });
  assert.equal(h.panel.htmlWrites, writes);
  assert.equal(h.panel.webview.html, markup);
  assert.equal(h.panel.reveals.length, reveals);
  assert.equal(h.panel.title, 'TensorTonic · Problem B');
  assert.equal(ui.document.activeElement, ui.edit);
  assert.deepEqual([ui.window.scrollX, ui.window.scrollY], [7, 642]);
  assert.equal(ui.details[1].open, true);
  assert.deepEqual(ui.articles.map(article => article.innerHTMLWrites), [0, 0]);
  assert.equal(ui.panels[0].firstElementChild.innerHTMLWrites, 0);
  assert.equal(ui.panels[1].children[1].innerHTMLWrites, 0);
  assert.deepEqual(Object.keys(h.panel.updates.at(-1)).sort(), ['interactionEpoch', 'modelKey', 'notice', 'token', 'type']);
  assert.match(ui.notice.firstElementChild.textContent, /ready for Problem A/);
  ui.viewOwner.click();
  assert.equal(ui.posted.at(-1).ownerKey, JSON.stringify(['plan-a', 'api', 'api-a']));
  assert.equal(h.actions.length, 0);
});

test('FOCUS2: relevant status and result patches preserve the other result and native Edit JSON control', () => {
  const h = harness();
  h.workspace.show(A, { tab: 'tests' });
  h.workspace.recordResult(A, 'submit', { status: 'failed' });
  const ui = runLocalScript(h.panel);
  const submitDetails = ui.articles[1].querySelectorAll('details')[0];
  submitDetails.open = true;
  ui.edit.focus();
  ui.window.scrollY = 377;
  const writes = h.panel.htmlWrites;
  const submitWrites = ui.articles[1].innerHTMLWrites;
  h.workspace.setExecution(A, { id: 'local-run', action: 'run' });
  assert.equal(ui.document.activeElement, ui.edit);
  assert.match(ui.operation.firstElementChild.textContent, /Run public cases/);
  h.workspace.recordResult(A, 'run', { status: 'passed' }, { operationId: 'local-run' });
  assert.equal(h.panel.htmlWrites, writes);
  assert.equal(ui.document.activeElement, ui.edit);
  assert.equal(ui.window.scrollY, 377);
  assert.equal(ui.articles[1].innerHTMLWrites, submitWrites);
  assert.equal(ui.articles[1].querySelectorAll('details')[0], submitDetails);
  assert.equal(submitDetails.open, true);
  assert.equal(ui.articles[0].querySelectorAll('details')[0].open, false);
  h.workspace.show(A, { tests: { userCases: [{ input: 'updated local JSON' }] } });
  assert.equal(h.panel.htmlWrites, writes);
  assert.equal(ui.document.activeElement, ui.edit);
  assert.equal(typeof ui.edit.listeners.click, 'function');
  ui.edit.click();
  assert.equal(ui.posted.at(-1).action, 'editTests');
});

test('FOCUS2: a local tab click still in flight wins over a queued automatic result tab', () => {
  const h = harness();
  h.workspace.show(A);
  const presentation = h.workspace.capturePresentation();
  const ui = runLocalScript(h.panel);
  h.workspace.setExecution(A, { id: 'in-flight', action: 'run' });
  ui.tabs[1].click(); // Deliberately do not deliver its host message yet.
  assert.equal(ui.panels[1].hidden, false);
  const pendingTabMessage = ui.posted.at(-1);
  h.workspace.recordResult(A, 'run', { status: 'passed' }, { operationId: 'in-flight', presentation });
  assert.equal(h.panel.updates.at(-1).tab, 'results');
  assert.equal(ui.panels[1].hidden, false);
  assert.equal(ui.panels[2].hidden, true);
  send(h.panel, pendingTabMessage);
  assert.equal(tabIs(h.panel, 'tests'), true);
  assert.ok(h.workspace.capturePresentation().interactionEpoch > presentation.interactionEpoch);
});

test('FOCUS2: replacing a relevant result restores matching open disclosure and focused summary', () => {
  const h = harness();
  h.workspace.show(A, { tab: 'results' });
  h.workspace.recordResult(A, 'run', { status: 'passed', message: 'first response' });
  const ui = runLocalScript(h.panel);
  const oldDetails = ui.articles[0].querySelectorAll('details')[0];
  const oldSummary = oldDetails.firstElementChild;
  oldDetails.open = true;
  oldSummary.focus();
  ui.window.scrollY = 900;
  const writes = h.panel.htmlWrites;
  const reveals = h.panel.reveals.length;
  h.workspace.setExecution(A, { id: 'replacement', action: 'run' });
  h.workspace.recordResult(A, 'run', { status: 'failed', message: 'second response' }, { operationId: 'replacement' });
  const newDetails = ui.articles[0].querySelectorAll('details')[0];
  assert.notEqual(newDetails, oldDetails);
  assert.equal(newDetails.open, true);
  assert.equal(ui.document.activeElement, newDetails.firstElementChild);
  assert.equal(newDetails.firstElementChild.focusOptions.preventScroll, true);
  assert.equal(ui.window.scrollY, 900);
  assert.equal(h.panel.htmlWrites, writes);
  assert.equal(h.panel.reveals.length, reveals);
  const before = ui.articles[0].innerHTMLWrites;
  ui.receive({ ...h.panel.updates.at(-1), token: 'stale-token', results: { run: '<p>wrong owner</p>' } });
  ui.receive({ ...h.panel.updates.at(-1), modelKey: 'wrong-owner', results: { run: '<p>wrong owner</p>' } });
  assert.equal(ui.articles[0].innerHTMLWrites, before);
});

test('the local ready handshake restores early updates without replacing HTML', () => {
  const h = harness();
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'early-run', action: 'run' });
  h.workspace.recordResult(A, 'run', { message: 'finished before listener ready' }, { operationId: 'early-run' });
  const ui = runLocalScript(h.panel);
  assert.equal(ui.bootPosted.length, 1);
  assert.equal(ui.bootPosted[0].type, 'ready');
  const writes = h.panel.htmlWrites;
  send(h.panel, ui.bootPosted[0]);
  assert.equal(h.panel.htmlWrites, writes);
  assert.match(h.panel.updates.at(-1).results.run, /finished before listener ready/);
  assert.equal(ui.operation.hidden, true);
});

test('session reset clears cached account content and retires delayed successes and errors', () => {
  const h = harness();
  h.workspace.show(A, { descriptionHtml: '<p>account A description</p>', tests: { userCases: [{ input: 'account A input' }] } });
  h.workspace.recordResult(A, 'submit', { status: 'accepted', message: 'account A verdict' });
  const oldRun = h.workspace.setExecution(A, { id: 'account-a-run', action: 'run' });
  h.workspace.setExecution(A, { id: 'account-a-submit', action: 'submit' });
  const oldPresentation = h.workspace.capturePresentation();
  const oldPanel = h.panel;
  const oldToken = config(oldPanel);
  oldPanel.move(4);
  assert.equal(oldRun.sessionEpoch, oldPresentation.sessionEpoch);
  assert.equal(h.workspace.resetSession(), true);
  const reset = h.workspace.capturePresentation();
  assert.equal(reset.sessionEpoch, oldPresentation.sessionEpoch + 1);
  assert.equal(reset.closeEpoch, oldPresentation.closeEpoch + 1);
  assert.equal(reset.selectedKey, undefined);
  assert.equal(oldPanel.disposed, true);
  assert.equal(h.panels.length, 1);
  for (const [action, options] of [
    ['run', { operationId: 'account-a-run' }],
    ['submit', { operationId: 'account-a-submit', localError: true }],
    ['run', { operationId: 'account-a-run', presentation: oldPresentation }],
    ['submit', { localError: true }],
    ['run', { presentation: oldPresentation }],
    ['submit', { sessionEpoch: oldRun.sessionEpoch }],
  ]) {
    assert.deepEqual(h.workspace.recordResult(A, action, { message: 'late account A content' }, options), { stored: false, presented: false });
  }
  assert.equal(h.panels.length, 1);
  assert.equal(h.workspace.showTab('results', A), false);
  h.workspace.show(A, { tab: 'results' });
  assert.deepEqual(h.panel.placement, { viewColumn: 4, preserveFocus: true });
  assert.ok(!rendered(h.panel).includes('account A'));
  assert.match(rendered(h.panel), /No result recorded/);
  send(oldPanel, { type: 'action', action: 'editTests' }, oldToken);
  assert.equal(h.actions.length, 0);
  assert.throws(() => h.workspace.setExecution(A, { id: 'account-a-run', action: 'run' }), /fresh operation id/);
  const currentPresentation = h.workspace.capturePresentation();
  const currentRun = h.workspace.setExecution(A, { id: 'account-b-run', action: 'run' });
  assert.equal(currentRun.sessionEpoch, reset.sessionEpoch);
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'old snapshot completion' }, { operationId: 'account-b-run', presentation: oldPresentation }), { stored: false, presented: false });
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'account B result' }, { operationId: 'account-b-run', presentation: currentPresentation }), { stored: true, presented: true });
  assert.match(rendered(h.panel), /account B result/);
  assert.ok(!rendered(h.panel).includes('late account A content'));
  assert.ok(!rendered(h.panel).includes('old snapshot completion'));
});

test('session reset clears pending owner notices while ordinary close retains current-session cache', () => {
  const h = harness();
  h.workspace.show(A);
  h.workspace.setExecution(A, { id: 'old-notice-run', action: 'run' });
  h.workspace.show(B);
  h.workspace.recordResult(A, 'run', { message: 'old notice owner result' }, { operationId: 'old-notice-run' });
  assert.match(rendered(h.panel), /ready for Problem A/);
  h.panel.dispose();
  h.workspace.resetSession();
  h.workspace.show(B);
  assert.ok(!rendered(h.panel).includes('ready for Problem A'));
  assert.ok(!config(h.panel).ownerKey);
  assert.deepEqual(h.workspace.recordResult(B, 'run', { message: 'unowned old error' }, { localError: true }), { stored: false, presented: false });
  const presentation = h.workspace.capturePresentation();
  assert.deepEqual(h.workspace.recordResult(B, 'run', { message: 'current session local result' }, { sessionEpoch: presentation.sessionEpoch }), { stored: true, presented: true });
  h.panel.dispose();
  h.workspace.show(B, { tab: 'results' });
  assert.match(rendered(h.panel), /current session local result/);
  assert.ok(!rendered(h.panel).includes('unowned old error'));
  h.workspace.resetSession();
  assert.deepEqual(h.workspace.recordResult(A, 'run', { message: 'two sessions late' }, { operationId: 'old-notice-run' }), { stored: false, presented: false });
  h.workspace.show(A, { tab: 'results' });
  assert.ok(!rendered(h.panel).includes('old notice owner result'));
  assert.ok(!rendered(h.panel).includes('two sessions late'));
});

test('a delayed action failure from an old session cannot add a notice to the same problem in a new session', async () => {
  let reject;
  const h = harness(() => new Promise((resolve, failure) => { reject = failure; }));
  h.workspace.show(A);
  send(h.panel, { type: 'action', action: 'discuss' });
  const oldEpoch = h.actions[0].sessionEpoch;
  h.workspace.resetSession();
  h.workspace.show(A);
  assert.ok(h.workspace.capturePresentation().sessionEpoch > oldEpoch);
  const updates = h.panel.updates.length;
  reject(new Error('delayed old account failure'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.panel.updates.length, updates);
  assert.ok(!rendered(h.panel).includes('could not be completed'));
});

test('callback failures are contained and cannot present an error on a new owner', async () => {
  let reject;
  const h = harness(() => new Promise((resolve, failure) => { reject = failure; }));
  h.workspace.show(A);
  send(h.panel, { type: 'action', action: 'discuss' });
  h.workspace.show(B);
  reject(new Error('synthetic callback failure'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.panel.title, 'TensorTonic · Problem B');
  assert.ok(!rendered(h.panel).includes('could not be completed'));
  const synchronous = harness(() => { throw new Error('private synthetic error'); });
  synchronous.workspace.show(A);
  send(synchronous.panel, { type: 'action', action: 'openOriginal' });
  assert.match(rendered(synchronous.panel), /requested action could not be completed/);
  assert.ok(!rendered(synchronous.panel).includes('private synthetic error'));
});

test('invalid identities and actions fail clearly, and dispose prevents resurrection', () => {
  const h = harness();
  assert.throws(() => h.workspace.show({ title: 'missing id' }), /apiId or slug/);
  assert.throws(() => h.workspace.setExecution(A, { id: 'a', action: 'delete' }), /run or submit/);
  assert.throws(() => h.workspace.setExecution(A, { action: 'run' }), /operation id/);
  h.workspace.show(A);
  const captured = config(h.panel);
  h.workspace.dispose();
  h.workspace.dispose();
  assert.equal(h.workspace.resetSession(), false);
  send(h.panel, { type: 'action', action: 'editTests' }, captured);
  assert.equal(h.panel.disposed, true);
  assert.equal(h.workspace.show(A), false);
  assert.equal(h.workspace.showTab('results', A), false);
  assert.equal(h.workspace.setExecution(A, { id: 'a', action: 'run' }), undefined);
  assert.deepEqual(h.workspace.recordResult(A, 'run', {}), { stored: false, presented: false });
  assert.equal(h.panels.length, 1);
  assert.equal(h.actions.length, 0);
});

test('reopening the auxiliary workspace cannot recreate a manually closed editor group',()=>{
 const h=harness(undefined,{getViewColumn:()=>2});h.vscode.window.tabGroups={all:[{viewColumn:1},{viewColumn:2}]};h.workspace.show(A);assert.equal(h.panel.viewColumn,2);h.panel.dispose();h.vscode.window.tabGroups.all=[{viewColumn:1}];h.workspace.show(A);assert.equal(h.panel.viewColumn,1);
});

test('freshness patches only matching operation and never opens a closed result panel',()=>{
 const h=harness();h.workspace.show(A,{tab:'results'});h.workspace.setExecution(A,{id:'fresh-1',action:'run'});h.workspace.recordResult(A,'run',{status:'passed'},{operationId:'fresh-1'});
 assert.equal(h.workspace.updateFreshness(A,'run',{label:'Changed <unsafe>',timestamp:'2026-11-02T00:00:00Z'},'other'),false);
 assert.equal(h.workspace.updateFreshness(A,'run',{label:'Changed <unsafe>',timestamp:'2026-11-02T00:00:00Z'},'fresh-1'),true);assert.match(rendered(h.panel),/Changed &lt;unsafe&gt;/);const count=h.panels.length;h.panel.dispose();h.workspace.updateFreshness(A,'run',{label:'Unchanged'},'fresh-1');assert.equal(h.panels.length,count);
});
