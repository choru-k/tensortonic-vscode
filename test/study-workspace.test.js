'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { StudyWorkspace, STUDY_FOLDER_KEY, PENDING_STUDY_VIEW_KEY, CONSUMED_STUDY_VIEW_KEY, PENDING_TTL_MS } = require('../src/study-workspace');

class TestUri {
  constructor(text) {
    this.url = new URL(text);
    this.scheme = this.url.protocol.slice(0, -1);
    this.authority = this.url.host;
    this.path = decodeURIComponent(this.url.pathname);
    this.query = this.url.search.slice(1);
    this.fragment = this.url.hash.slice(1);
  }
  toString() { return this.url.href; }
  with({ path }) { const url = new URL(this.toString()); url.pathname = path; return new TestUri(url.href); }
}
const uri = value => new TestUri(value.startsWith('/') ? `file://${value}` : value);
const NOW = 1800000000000;
const NONCE = '12345678-1234-1234-1234-123456789abc';
const marker = (extra = {}) => ({ uri: 'file:///study', createdAt: NOW, nonce: NONCE, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const state = new Map();
  if ('remembered' in options) state.set(STUDY_FOLDER_KEY, options.remembered);
  if ('pending' in options) state.set(PENDING_STUDY_VIEW_KEY, options.pending);
  const h = { state, workspaceValues: new Map(), workspaceUpdates: [], now: NOW, updates: [], opens: [], pickers: [], stats: [], shows: 0, types: new Map(), pick: [uri('/study')] };
  const forbidden = () => { throw new Error('Unexpected project or settings mutation'); };
  h.vscode = {
    UIKind: { Desktop: 1, Web: 2 }, FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    Uri: { parse: text => new TestUri(text), isUri: value => value instanceof TestUri },
    env: { uiKind: 1, remoteName: undefined },
    workspace: {
      isTrusted: true, workspaceFolders: [{ uri: uri(options.current || '/development') }], workspaceFile: undefined,
      updateWorkspaceFolders: forbidden, getConfiguration: forbidden,
      fs: { stat: async value => { h.stats.push(value.toString()); if (h.onStat) return h.onStat(value); const type = h.types.get(value.toString()); if (type === 'missing') throw new Error('Not found'); return { type: type === undefined ? 2 : type }; }, writeFile: forbidden, createDirectory: forbidden, delete: forbidden, rename: forbidden, copy: forbidden },
    },
    window: { showOpenDialog: async options => { h.pickers.push(options); return h.onPick ? h.onPick() : h.pick; } },
    commands: { executeCommand: async (...args) => { h.opens.push(args); if (h.onOpen) return h.onOpen(...args); } },
  };
  h.context = { workspaceState: { get: key => h.workspaceValues.get(key), update: async (key, value) => { h.workspaceUpdates.push([key, value]); if (h.onWorkspaceUpdate) await h.onWorkspaceUpdate(key, value); h.workspaceValues.set(key, value); } }, globalState: {
    get: key => state.get(key), setKeysForSync: forbidden,
    update: async (key, value) => { h.updates.push([key, value]); if (h.onUpdate) await h.onUpdate(key, value); if (value === undefined) state.delete(key); else state.set(key, value); },
  } };
  h.controller = new StudyWorkspace(h.vscode, h.context, { now: () => h.now, createNonce: () => NONCE, showStudyPlan: async () => { h.shows++; if (h.onShow) return h.onShow(); } });
  return h;
}

test('first explicit start picks and remembers a folder, then requests a separate window without project mutation', async () => {
  const h = harness();
  const originalFolders = h.vscode.workspace.workspaceFolders;
  assert.deepEqual(await h.controller.start(), { status: 'open-requested' });
  assert.equal(h.pickers.length, 1);
  assert.deepEqual(h.pickers[0], { canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: 'Choose a TensorTonic study folder — opens in a new window', openLabel: 'Study here' });
  assert.equal(h.state.get(STUDY_FOLDER_KEY), 'file:///study');
  assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), marker());
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0][0], 'vscode.openFolder');
  assert.equal(h.opens[0][1].toString(), 'file:///study');
  assert.deepEqual(h.opens[0][2], { forceNewWindow: true });
  assert.strictEqual(h.vscode.workspace.workspaceFolders, originalFolders);
  assert.equal(h.shows, 0);
});

test('cancelled initial or change-folder selection leaves remembered folder and pending state untouched', async () => {
  for (const options of [{}, { remembered: 'file:///old', pending: marker({ uri: 'file:///old' }) }]) {
    const h = harness(options); h.pick = undefined;
    const before = [...h.state];
    assert.deepEqual(await h.controller.start({ chooseFolder: true }), { status: 'cancelled' });
    assert.deepEqual([...h.state], before);
    assert.deepEqual(h.updates, []); assert.deepEqual(h.opens, []);
  }
});

test('remembered single study folder is reused, including trailing-slash equivalence, without new-window handoff', async () => {
  for (const current of ['/study', '/study/']) {
    const h = harness({ current, remembered: 'file:///study' });
    assert.deepEqual(await h.controller.start(), { status: 'reused' });
    assert.equal(h.shows, 1); assert.equal(h.pickers.length, 0); assert.equal(h.opens.length, 0); assert.deepEqual(h.updates, []);
  }
});

test('explicit change uses the previous local folder as picker default and remembers only validated selection', async () => {
  const h = harness({ remembered: 'file:///old' });
  await h.controller.start({ chooseFolder: true });
  assert.equal(h.pickers[0].defaultUri.toString(), 'file:///old');
  assert.equal(h.state.get(STUDY_FOLDER_KEY), 'file:///study');
});

test('missing, malformed, nonlocal and non-directory remembered folders prompt only on explicit start', async () => {
  for (const remembered of [undefined, {}, 'not a URI', 'vscode-remote://ssh-remote/study', 'file://server/study', 'file:////server/study', 'file:///study%5cnetwork', 'file:///study?query', 'file:///study#fragment', 'file:///missing', 'file:///a-file']) {
    const h = harness({ remembered });
    h.types.set('file:///missing', 'missing'); h.types.set('file:///a-file', 1);
    assert.equal(await h.controller.restorePendingStudyView(), false);
    assert.equal(h.pickers.length, 0); assert.equal(h.opens.length, 0);
    await h.controller.start();
    assert.equal(h.pickers.length, 1); assert.equal(h.state.get(STUDY_FOLDER_KEY), 'file:///study');
    assert.ok(h.stats.every(value => value.startsWith('file:///')));
  }
});

test('invalid selected URI, file, missing path or multiple selections cannot update state or open a window', async () => {
  for (const selected of [[uri('vscode-remote://ssh-remote/study')], [uri('file://server/study')], [uri('file:////server/study')], [uri('file:///study%5cnetwork')], [uri('https://example.com/study')], [uri('/a-file')], [uri('/missing')], [uri('/one'), uri('/two')]]) {
    const h = harness(); h.pick = selected; h.types.set('file:///a-file', 1); h.types.set('file:///missing', 'missing');
    await assert.rejects(h.controller.start(), /existing local folder/);
    assert.deepEqual(h.updates, []); assert.deepEqual(h.opens, []);
  }
});

test('multi-root and saved-workspace windows are not reused even if they contain the study folder', async () => {
  for (const savedWorkspace of [false, true]) {
    const h = harness({ current: '/study', remembered: 'file:///study' });
    if (savedWorkspace) h.vscode.workspace.workspaceFile = uri('/study.code-workspace');
    else h.vscode.workspace.workspaceFolders.push({ uri: uri('/development') });
    await h.controller.start(); assert.equal(h.opens.length, 1); assert.equal(h.shows, 0);
  }
});

test('untrusted, browser and remote windows reject explicit start and quietly ignore startup restore', async () => {
  for (const mode of ['untrusted', 'web', 'remote']) {
    const h = harness({ pending: marker(), current: '/study' });
    if (mode === 'untrusted') h.vscode.workspace.isTrusted = false;
    if (mode === 'web') h.vscode.env.uiKind = 2;
    if (mode === 'remote') h.vscode.env.remoteName = 'ssh-remote';
    await assert.rejects(h.controller.start(), /trusted, local VS Code desktop/);
    assert.equal(await h.controller.restorePendingStudyView(), false);
    assert.deepEqual(h.updates, []); assert.deepEqual(h.opens, []); assert.deepEqual(h.pickers, []); assert.deepEqual(h.stats, []);
  }
});

test('startup without an explicit pending gesture never prompts, opens a folder or focuses the view', async () => {
  const h = harness({ remembered: 'file:///study', current: '/study' });
  assert.equal(await h.controller.restorePendingStudyView(), false);
  assert.equal(h.shows, 0); assert.deepEqual(h.opens, []); assert.deepEqual(h.pickers, []); assert.deepEqual(h.updates, []);
});

test('valid handoff focuses only the matching single local folder and is consumed once before focus', async () => {
  const h = harness({ current: '/study', pending: marker() });
  h.onShow = () => { assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), marker()); assert.equal(h.workspaceValues.get(CONSUMED_STUDY_VIEW_KEY), NONCE); };
  const first = h.controller.restorePendingStudyView();
  assert.strictEqual(first, h.controller.restorePendingStudyView());
  assert.equal(await first, true);
  assert.equal(await h.controller.restorePendingStudyView(), false);
  assert.equal(h.shows, 1); assert.deepEqual(h.opens, []); assert.deepEqual(h.pickers, []);
});

test('fresh pending marker stays available for the intended window, not unrelated or multi-root windows', async () => {
  for (const mode of ['different', 'multi-root', 'saved-workspace']) {
    const h = harness({ current: mode === 'different' ? '/development' : '/study', pending: marker() });
    if (mode === 'multi-root') h.vscode.workspace.workspaceFolders.push({ uri: uri('/development') });
    if (mode === 'saved-workspace') h.vscode.workspace.workspaceFile = uri('/study.code-workspace');
    assert.equal(await h.controller.restorePendingStudyView(), false);
    assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), marker()); assert.equal(h.shows, 0); assert.deepEqual(h.opens, []);
  }
});

test('expired, future or malformed pending markers are quietly ignored without shared writes or startup opens', async () => {
  for (const pending of [null, false, [], 'bad', {}, marker({ createdAt: NOW - PENDING_TTL_MS }), marker({ createdAt: NOW + 1 }), marker({ createdAt: 'now' }), marker({ nonce: 'invalid' }), marker({ uri: 'file://server/study' }), marker({ uri: 'https://example.com/study' })]) {
    const h = harness({ current: '/study', pending });
    assert.equal(await h.controller.restorePendingStudyView(), false);
    assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), pending); assert.deepEqual(h.updates, []); assert.equal(h.shows, 0); assert.deepEqual(h.opens, []); assert.deepEqual(h.pickers, []);
  }
});

test('missing pending folder is ignored without shared writes, while symlink-to-directory remains a valid selected directory', async () => {
  const h = harness({ current: '/study', pending: marker() }); h.types.set('file:///study', 'missing');
  assert.equal(await h.controller.restorePendingStudyView(), false);
  assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), marker()); assert.deepEqual(h.updates, []); assert.equal(h.shows, 0);
  const linked = harness(); linked.types.set('file:///study', 66);
  await linked.controller.start(); assert.equal(linked.opens.length, 1);
});

test('failed or uncertain open is never retried and never cleans shared state or clobbers a newer handoff', async () => {
  for (const superseded of [false, true]) {
    const h = harness();
    const newer = marker({ nonce: 'ffffffff-ffff-ffff-ffff-ffffffffffff', uri: 'file:///another' });
    h.onOpen = () => { if (superseded) h.state.set(PENDING_STUDY_VIEW_KEY, newer); throw new Error('Open outcome uncertain'); };
    await assert.rejects(h.controller.start(), /Open outcome uncertain/);
    assert.equal(h.opens.length, 1); assert.equal(h.state.get(STUDY_FOLDER_KEY), 'file:///study');
    assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), superseded ? newer : marker());
    assert.equal(await h.controller.restorePendingStudyView(), false); assert.equal(h.opens.length, 1);
  }
});

test('concurrent start gestures coalesce into one selection and one open request', async () => {
  const h = harness(); const picker = deferred(); h.onPick = () => picker.promise;
  const first = h.controller.start(); const second = h.controller.start({ chooseFolder: true });
  assert.strictEqual(first, second);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.pickers.length, 1);
  picker.resolve([uri('/study')]); await Promise.all([first, second]);
  assert.equal(h.opens.length, 1); assert.equal(h.updates.filter(([key]) => key === STUDY_FOLDER_KEY).length, 1);
});

test('start and restoration serialize, without discarding an explicit start queued behind view restoration', async () => {
  const h = harness({ current: '/study', remembered: 'file:///study', pending: marker() });
  const shown = deferred(); h.onShow = () => h.shows === 1 ? shown.promise : undefined;
  const restore = h.controller.restorePendingStudyView();
  await new Promise(resolve => setImmediate(resolve));
  const start = h.controller.start();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.shows, 1);
  shown.resolve(); assert.equal(await restore, true); assert.deepEqual(await start, { status: 'reused' });
  assert.equal(h.shows, 2); assert.deepEqual(h.opens, []);
});

test('restore cannot consume a superseding marker or focus after the current folder changes', async () => {
  for (const change of ['marker', 'folder', 'trust']) {
    const h = harness({ current: '/study', pending: marker() }); const stat = deferred(); h.onStat = () => stat.promise;
    const restoring = h.controller.restorePendingStudyView(); await new Promise(resolve => setImmediate(resolve));
    const newer = marker({ nonce: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
    if (change === 'marker') h.state.set(PENDING_STUDY_VIEW_KEY, newer);
    if (change === 'folder') h.vscode.workspace.workspaceFolders = [{ uri: uri('/other') }];
    if (change === 'trust') h.vscode.workspace.isTrusted = false;
    stat.resolve({ type: 2 });
    assert.equal(await restoring, false); assert.equal(h.shows, 0); assert.equal(h.updates.length, 0);
  }
});

test('restore rechecks trust, folder, marker and expiry after awaited workspace acknowledgement', async () => {
  for (const change of ['trust', 'folder', 'marker', 'expiry']) {
    const h = harness({ current: '/study', pending: marker() }); const acknowledgement = deferred();
    h.onWorkspaceUpdate = () => acknowledgement.promise;
    const restoring = h.controller.restorePendingStudyView(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.workspaceUpdates.length, 1);
    if (change === 'trust') h.vscode.workspace.isTrusted = false;
    if (change === 'folder') h.vscode.workspace.workspaceFolders = [{ uri: uri('/other') }];
    if (change === 'marker') h.state.set(PENDING_STUDY_VIEW_KEY, marker({ nonce: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }));
    if (change === 'expiry') h.now += PENDING_TTL_MS;
    acknowledgement.resolve();
    assert.equal(await restoring, false); assert.equal(h.shows, 0); assert.deepEqual(h.updates, []);
  }
});

test('startup never invokes shared whole-object Memento writes, including when another window has newer state', async () => {
  const h = harness({ current: '/study', remembered: 'file:///study', pending: marker() });
  const newer = marker({ nonce: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
  h.onUpdate = () => { throw new Error('A stale whole-object globalState write would overwrite the other window'); };
  h.onWorkspaceUpdate = () => { h.state.set(PENDING_STUDY_VIEW_KEY, newer); h.state.set(STUDY_FOLDER_KEY, 'file:///new-choice'); };
  assert.equal(await h.controller.restorePendingStudyView(), false);
  assert.deepEqual(h.state.get(PENDING_STUDY_VIEW_KEY), newer);
  assert.equal(h.state.get(STUDY_FOLDER_KEY), 'file:///new-choice');
  assert.deepEqual(h.updates, []); assert.deepEqual(h.opens, []);
});

test('consumed nonce survives controller recreation, and a failed focus is not retried automatically', async () => {
  const h = harness({ current: '/study', pending: marker() }); h.onShow = () => { throw new Error('View unavailable'); };
  assert.equal(await h.controller.restorePendingStudyView(), false);
  const next = new StudyWorkspace(h.vscode, h.context, { now: () => NOW, showStudyPlan: () => { h.shows++; } });
  assert.equal(await next.restorePendingStudyView(), false);
  assert.equal(h.shows, 1); assert.equal(h.workspaceValues.get(CONSUMED_STUDY_VIEW_KEY), NONCE);
  assert.deepEqual(h.updates, []);
});

test('trust revoked during selection prevents persistence and opening', async () => {
  const h = harness(); h.onPick = () => { h.vscode.workspace.isTrusted = false; return [uri('/study')]; };
  await assert.rejects(h.controller.start(), /trusted, local/);
  assert.deepEqual(h.updates, []); assert.deepEqual(h.opens, []);
});

test('failed pending-state persistence prevents the open request and does not poison later explicit gestures', async () => {
  const h = harness(); h.onUpdate = (key, value) => { if (key === PENDING_STUDY_VIEW_KEY && value) throw new Error('Storage unavailable'); };
  await assert.rejects(h.controller.start(), /Storage unavailable/); assert.deepEqual(h.opens, []);
  h.onUpdate = undefined;
  await h.controller.start(); assert.equal(h.opens.length, 1);
});
