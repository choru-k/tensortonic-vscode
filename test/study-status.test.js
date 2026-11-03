'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { StudyStatusProvider } = require('../src/study-status');

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.disposals = 0;
    this.event = listener => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.disposals++; this.listeners.clear(); }
}

const vscode = {
  EventEmitter,
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
  },
  ThemeIcon: class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } },
  TreeItemCollapsibleState: { None: 0 },
};

function snapshot(overrides = {}) {
  return {
    focus: { enabled: false, status: 'off', applied: false, busy: false },
    problemView: 'web',
    display: { open: true, otherBrowserActive: false, navigating: false, mismatch: false },
    environment: { state: 'ready', label: 'Study environment ready' },
    ...overrides,
  };
}

function fixture(initial = snapshot()) {
  let current = initial;
  let reads = 0;
  const provider = new StudyStatusProvider(vscode, { getSnapshot: () => { reads++; return current; } });
  return { provider, reads: () => reads, set: value => { current = value; } };
}

function focusRow(focus, display = {}, problemView = 'web') {
  return fixture(snapshot({ focus, display: { open: true, ...display }, problemView })).provider.getChildren()[0];
}

const appliedFocus = { enabled: true, status: 'applied', applied: true, busy: false };

test('status is three native leaf rows with stable contexts, commands, and accessible text', () => {
  const { provider } = fixture();
  const rows = provider.getChildren();
  assert.deepEqual(rows.map(item => item.label), ['Focus mode', 'Problem view', 'Study environment']);
  assert.deepEqual(rows.map(item => item.contextValue), [
    'tensortonicStatusFocus', 'tensortonicStatusProblemView', 'tensortonicStatusEnvironmentReady',
  ]);
  assert.equal(rows[0].command.command, 'tensortonic.toggleFocusMode');
  assert.equal(rows[1].command.command, 'tensortonic.chooseProblemView');
  assert.equal(rows[2].command, undefined);
  assert.equal(provider.summary, 'Focus Off · Web');
  for (const row of rows) {
    assert.ok(row instanceof vscode.TreeItem);
    assert.equal(row.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.equal(provider.getTreeItem(row), row);
    assert.deepEqual(provider.getChildren(row), []);
    assert.ok(row.iconPath instanceof vscode.ThemeIcon);
    assert.equal(row.iconPath.color, undefined);
    assert.match(row.tooltip, new RegExp(row.label));
    assert.ok(row.accessibilityInformation.label.includes(row.description));
  }
});

test('rendering and refresh need no IO dependencies or host services beyond native tree types', () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/study-status'), 'utf8'), {
    module,
    require: name => { assert.fail(`Status provider loaded dependency ${name}`); },
  });
  const nativeOnly = new Proxy(vscode, {
    get(target, name) {
      assert.ok(Object.hasOwn(target, name), `Status provider accessed host service ${String(name)}`);
      return target[name];
    },
  });
  let reads = 0;
  const state = Object.freeze(snapshot({
    focus: Object.freeze({ ...appliedFocus }),
    display: Object.freeze({ open: true }),
    environment: Object.freeze({ state: 'missing', command: 'tensortonic.setupStudyEnvironment' }),
  }));
  const provider = new module.exports.StudyStatusProvider(nativeOnly, {
    getSnapshot: () => { reads++; return state; },
  });
  provider.getChildren().forEach(item => { provider.getTreeItem(item); provider.getChildren(item); });
  assert.equal(provider.summary, 'Focus On · Applied · Web');
  assert.equal(reads, 1);
  provider.refresh();
  assert.equal(reads, 2);
  assert.equal(provider.getChildren()[2].command.command, 'tensortonic.setupStudyEnvironment');
  provider.dispose();
  assert.equal(reads, 2);
});

test('refresh replaces the cached snapshot before notifying without mutating stale rows', () => {
  const h = fixture();
  const previous = h.provider.getChildren();
  const events = [];
  h.provider.onDidChangeTreeData(value => {
    events.push(value);
    assert.equal(h.provider.summary, 'Focus On · Applied · Web');
    assert.equal(h.provider.getChildren()[0].description, 'On · Applied');
  });
  h.set(snapshot({ focus: appliedFocus }));
  assert.equal(h.provider.getChildren(), previous);
  assert.equal(h.provider.summary, 'Focus Off · Web');
  assert.equal(h.reads(), 1);
  h.provider.refresh();
  const current = h.provider.getChildren();
  assert.notEqual(current, previous);
  assert.equal(h.reads(), 2);
  assert.deepEqual(events, [undefined]);
  assert.deepEqual(current.map(item => item.id), previous.map(item => item.id));
  assert.equal(previous[0].description, 'Off');
  assert.deepEqual(h.provider.getChildren(previous[0]), []);
});

test('disposal is idempotent and prevents refresh reads or further events', () => {
  const h = fixture();
  let events = 0;
  h.provider.onDidChangeTreeData(() => { events++; });
  h.provider.dispose();
  h.provider.dispose();
  h.provider.refresh();
  assert.equal(h.reads(), 1);
  assert.equal(events, 0);
  assert.equal(h.provider.emitter.disposals, 1);
  assert.deepEqual(h.provider.getChildren(), []);
  assert.equal(h.provider.summary, '');
});

test('Applied requires strict enabled, applied status, applied lease, and a current owned display', () => {
  assert.equal(focusRow(appliedFocus).description, 'On · Applied');
  for (const patch of [
    { enabled: false }, { enabled: 'true' }, { status: 'unavailable' },
    { status: 'awaiting-dom-verification' }, { applied: false }, { applied: 'true' },
  ]) {
    assert.doesNotMatch(focusRow({ ...appliedFocus, ...patch }).description, /Applied/, JSON.stringify(patch));
  }
  assert.equal(focusRow(appliedFocus, { open: false }).description, 'On · No owned page');
  assert.equal(focusRow(appliedFocus, { open: 'true' }).description, 'On · No owned page');
  assert.match(focusRow(appliedFocus, { open: false }).tooltip, /application is not confirmed/);
});

test('busy, navigation, and mismatch report uncertainty instead of stale application', () => {
  const busy = focusRow({ ...appliedFocus, busy: true });
  assert.equal(busy.description, 'Updating');
  assert.match(busy.tooltip, /not yet confirmed/);
  assert.equal(focusRow(appliedFocus, { navigating: true }).description, 'On · Navigating');
  assert.equal(focusRow(appliedFocus, { mismatch: true }).description, 'On · Page mismatch');
  for (const display of [{ navigating: true }, { mismatch: true }]) {
    assert.match(focusRow(appliedFocus, display).tooltip, /application is not confirmed/);
  }
  const off = { enabled: false, status: 'off', applied: false };
  assert.match(focusRow(off, { open: false }).tooltip, /No extension-owned Web problem page is open/);
  assert.match(focusRow(off, { navigating: true }).tooltip, /owned Web page is navigating/);
  assert.match(focusRow(off, { mismatch: true }).tooltip, /does not match the current problem/);
});

test('unavailable and canceled attempts never claim website styles were applied', () => {
  for (const status of ['unavailable', 'awaiting-dom-verification', 'canceled', 'cancelled']) {
    const row = focusRow({ enabled: true, status, applied: false });
    assert.equal(row.description, 'On · Unavailable');
    assert.match(row.tooltip, /could not be confirmed/);
    assert.doesNotMatch(row.tooltip, /Focus mode is applied/);
  }
  const h = fixture(snapshot({ focus: appliedFocus }));
  h.set(snapshot({ focus: { enabled: false, status: 'off', applied: false } }));
  h.provider.refresh();
  assert.equal(h.provider.getChildren()[0].description, 'Off');
  assert.doesNotMatch(h.provider.summary, /Applied/);
});

test('pending cleanup remains explicit even after Off or while another update is busy', () => {
  for (const enabled of [false, true]) {
    const row = focusRow({ enabled, status: 'restore-pending', applied: true, busy: true });
    assert.equal(row.description, 'Cleanup pending');
    assert.match(row.tooltip, /retry Original view cleanup/);
    assert.equal(row.command.command, 'tensortonic.toggleFocusMode');
    assert.equal(row.command.title, 'Retry Focus mode cleanup');
    assert.equal(row.iconPath.color, undefined);
  }
});

test('another active browser tab is distinguished from the owned styled page', () => {
  const row = focusRow(appliedFocus, { otherBrowserActive: true });
  assert.equal(row.description, 'On · Other tab active');
  assert.match(row.tooltip, /applied to the extension-owned Web problem page/);
  assert.match(row.tooltip, /never changes that other tab/);
  assert.match(row.accessibilityInformation.label, /Another browser tab is active/);
  assert.equal(focusRow(appliedFocus, { otherBrowserActive: false }).description, 'On · Applied');
  const noOwnedPage = focusRow(appliedFocus, { open: false, otherBrowserActive: true });
  assert.equal(noOwnedPage.description, 'On · No owned page');
  assert.match(noOwnedPage.tooltip, /Another browser tab is active/);
});

test('Markdown default does not falsely remove application from an existing owned Web tab', () => {
  const h = fixture(snapshot({ focus: appliedFocus, problemView: 'markdown' }));
  const [focus, problem] = h.provider.getChildren();
  assert.equal(focus.description, 'On · Web tab only');
  assert.match(focus.tooltip, /applied to the extension-owned Web problem page/);
  assert.match(focus.tooltip, /not styled by website Focus mode/);
  assert.equal(problem.description, 'Markdown');
  assert.match(problem.tooltip, /default for future explicit problem opens/);
  assert.match(problem.tooltip, /only the local problem representation/);
  assert.match(problem.tooltip, /does not close or restyle an existing owned Web tab/);
  assert.equal(h.provider.summary, 'Focus On · Web tab only · Markdown');
  assert.equal(focusRow(appliedFocus, { open: false }, 'markdown').description, 'On · No owned page');
});

test('Focus hover explains scope, reset behavior, and curated reset reasons', () => {
  for (const [reason, expected] of [
    ['reload-default', /starts off after an extension reload/],
    ['page-changed', /reset after the owned Web page changed/],
    ['session-changed', /reset after the session changed/],
    ['no-owned-page', /No extension-owned Web problem page is open/],
  ]) {
    const row = focusRow({ enabled: false, status: 'off', applied: false, reason });
    assert.equal(row.description, 'Off');
    assert.match(row.tooltip, expected);
    assert.match(row.tooltip, /resets on reload and navigation/);
    assert.match(row.tooltip, /only the verified website Prev\/Next links, desktop\/narrow Browse problems launchers and floating Ask Toni button/);
  }
});

test('environment states use fixed native text and only their matching existing commands', () => {
  const cases = [
    ['missing', 'Create', 'Create', 'tensortonic.setupStudyEnvironment'],
    ['use', 'Use', 'Use', 'tensortonic.useStudyEnvironment'],
    ['repair', 'Repair', 'Repair', 'tensortonic.repairStudyEnvironment'],
    ['ready', 'Ready', 'Ready', undefined],
    ['checking', 'Checking', 'Checking', undefined],
    ['not-study-window', 'Choose workspace', 'Choose', 'tensortonic.startStudying'],
    ['unavailable', 'Unavailable', 'Unavailable', undefined],
  ];
  for (const [state, description, context, command] of cases) {
    const row = fixture(snapshot({ environment: { state, command } })).provider.getChildren()[2];
    assert.equal(row.label, 'Study environment');
    assert.equal(row.description, description, state);
    assert.equal(row.contextValue, `tensortonicStatusEnvironment${context}`);
    assert.equal(row.command && row.command.command, command);
    assert.ok(row.accessibilityInformation.label.includes(description));
  }
});

test('environment checks and stale cancellation are non-actionable until replaced', () => {
  for (const environment of [
    undefined,
    { state: 'unavailable', reason: 'operation-in-progress', command: 'tensortonic.setupStudyEnvironment' },
    { state: 'not-study-window', reason: 'stale', command: 'tensortonic.startStudying' },
  ]) {
    const row = fixture(snapshot({ environment })).provider.getChildren()[2];
    assert.equal(row.description, 'Checking');
    assert.equal(row.command, undefined);
  }
  const h = fixture(snapshot({ environment: { state: 'checking' } }));
  h.set(snapshot({ environment: { state: 'missing', command: 'tensortonic.setupStudyEnvironment' } }));
  h.provider.refresh();
  assert.equal(h.provider.getChildren()[2].description, 'Create');
});

test('Ready and unknown or mismatched environment commands cannot become actions', () => {
  for (const environment of [
    { state: 'ready', command: 'tensortonic.repairStudyEnvironment' },
    { state: 'missing', command: 'workbench.action.terminal.new' },
    { state: 'missing', command: 'tensortonic.useStudyEnvironment' },
    { state: 'checking', command: 'tensortonic.setupStudyEnvironment' },
    { state: 'unknown', command: 'tensortonic.setupStudyEnvironment' },
    { state: 'not-study-window', command: 'tensortonic.setupStudyEnvironment' },
  ]) {
    assert.equal(fixture(snapshot({ environment })).provider.getChildren()[2].command, undefined);
  }
});

test('raw paths, URLs, tokens, and control text from DTO labels or reasons are never rendered', () => {
  const untrusted = '/Users/student/private https://example.invalid/?token=secret TOKEN_SYNTHETIC\u202e\n';
  const h = fixture(snapshot({
    focus: { enabled: false, status: 'off', applied: false, reason: untrusted },
    environment: { state: 'missing', label: untrusted, reason: untrusted, command: 'tensortonic.setupStudyEnvironment' },
  }));
  const rendered = JSON.stringify(h.provider.getChildren());
  assert.doesNotMatch(rendered, /Users\/student|example\.invalid|TOKEN_SYNTHETIC|secret|\u202e/);
  assert.match(h.provider.getChildren()[0].tooltip, /Focus mode is off/);
  const unavailable = fixture(snapshot({ environment: { state: 'unavailable', reason: 'unsupported-window' } })).provider.getChildren()[2];
  assert.match(unavailable.tooltip, /trusted local desktop study workspace/);
});
