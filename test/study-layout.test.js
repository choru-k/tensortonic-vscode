'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StudyLayout } = require('../src/study-layout');

const solution = slug => ({ uri: { scheme: 'file', path: `/study/${slug}.py`, toString: () => `file:///study/${slug}.py` }, getText: () => `# tensortonic: {"slug":"${slug}","planId":"python-basics"}\npass\n` });
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture({ columns = [1], layout = { orientation: 0, groups: [{}] }, unknownGroups = false } = {}) {
  const commands = [], shows = [], activeListeners = new Set(), visibleListeners = new Set();
  const vscode = {
    ViewColumn: { One: 1, Two: 2, Beside: -2 },
    commands: { async executeCommand(id, value) {
      commands.push({ id, value });
      if (id === 'vscode.getEditorLayout') return layout;
      if (id === 'vscode.setEditorLayout' && !unknownGroups) vscode.window.tabGroups.all = [{ viewColumn: 1 }, { viewColumn: 2 }];
    } },
    window: {
      ...(unknownGroups ? {} : { tabGroups: { all: columns.map(viewColumn => ({ viewColumn })) } }),
      visibleTextEditors: [], activeTextEditor: undefined,
      onDidChangeActiveTextEditor(listener) { activeListeners.add(listener); return { dispose: () => activeListeners.delete(listener) }; },
      onDidChangeVisibleTextEditors(listener) { visibleListeners.add(listener); return { dispose: () => visibleListeners.delete(listener) }; },
      async showTextDocument(document, options) {
        shows.push({ document, options });
        const editor = { document, viewColumn: options.viewColumn };
        vscode.window.activeTextEditor = editor;
        vscode.window.visibleTextEditors = [editor];
        for (const listener of activeListeners) listener(editor);
        return editor;
      },
    },
  };
  const helper = new StudyLayout(vscode);
  return { vscode, helper, commands, shows, activeListeners, visibleListeners,
    setColumns(values) { vscode.window.tabGroups = { all: values.map(viewColumn => ({ viewColumn })) }; },
    move(editor, viewColumn) {
      editor.viewColumn = viewColumn;
      vscode.window.visibleTextEditors = [editor];
      for (const listener of visibleListeners) listener([editor]);
    },
  };
}

test('constructor is inert and first explicit single-group open puts code right and problem left', async () => {
  const h = fixture();
  assert.equal(h.commands.length + h.shows.length + h.activeListeners.size, 0);
  const document = solution('first');
  const editor = await h.helper.showSolution(document);
  assert.equal(editor.document, document);
  assert.deepEqual(h.commands, [
    { id: 'vscode.getEditorLayout', value: undefined },
    { id: 'vscode.setEditorLayout', value: { orientation: 0, groups: [{}, {}] } },
  ]);
  assert.deepEqual(h.shows[0].options, { viewColumn: 2, preview: false, preserveFocus: false });
  assert.equal(h.helper.problemColumn, 1);
});

test('pre-existing multi-group and complex layouts are preserved', async () => {
  for (const layout of [
    { orientation: 1, groups: [{}, {}] },
    { orientation: 0, groups: [{ groups: [{}, {}] }, {}] },
    { orientation: 1, groups: [{ groups: [{}] }] },
  ]) {
    const h = fixture({ columns: [1, 2, 3], layout });
    await h.helper.showSolution(solution('first'));
    assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 0);
    assert.equal(h.shows[0].options.viewColumn, 3);
    assert.equal(h.helper.problemColumn, 1);
  }
});

test('existing recognized solution group wins in an existing manual layout', async () => {
  const h = fixture({ columns: [1, 2, 3, 4], layout: { groups: [{}, {}, {}, {}] } });
  const document = solution('already-open');
  h.vscode.window.visibleTextEditors = [{ document, viewColumn: 3 }];
  await h.helper.showSolution(document);
  assert.equal(h.shows[0].options.viewColumn, 3);
  assert.equal(h.commands.length, 1);
});

test('manual code moves and panel feedback are retained on later problem opens', async () => {
  const h = fixture();
  const editor = await h.helper.showSolution(solution('first'));
  h.setColumns([1, 2, 3, 4]);
  h.move(editor, 4);
  h.helper.rememberProblemColumn(3);
  assert.equal(h.helper.problemColumn, 3);
  await h.helper.showSolution(solution('next'));
  assert.equal(h.shows.at(-1).options.viewColumn, 4);
  assert.equal(h.helper.problemColumn, 3);
  assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 1);
});

test('closed groups fall back to surviving groups without re-splitting', async () => {
  const h = fixture();
  await h.helper.showSolution(solution('first'));
  h.setColumns([1]);
  h.vscode.window.visibleTextEditors = [];
  h.vscode.window.activeTextEditor = undefined;
  h.helper.rememberProblemColumn(4);
  await h.helper.showSolution(solution('second'));
  await h.helper.showSolution(solution('third'));
  assert.deepEqual(h.shows.map(show => show.options.viewColumn), [2, 1, 1]);
  assert.equal(h.helper.problemColumn, 1);
  assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 1);
});

test('a manually changed layout during the initial read is not replaced', async () => {
  const h = fixture();
  const read = gate();
  h.vscode.commands.executeCommand = id => { h.commands.push({ id }); return read.promise; };
  const pending = h.helper.showSolution(solution('first'));
  h.setColumns([1, 2, 3]);
  read.resolve({ groups: [{}] });
  await pending;
  assert.deepEqual(h.commands, [{ id: 'vscode.getEditorLayout' }]);
  assert.equal(h.shows[0].options.viewColumn, 3);
});

test('canceling before or during layout inspection makes no layout or editor mutation', async () => {
  const h = fixture();
  assert.equal(await h.helper.showSolution(solution('canceled'), { isCurrent: () => false }), undefined);
  assert.equal(h.commands.length + h.shows.length, 0);
  const read = gate();
  h.vscode.commands.executeCommand = id => { h.commands.push({ id }); return read.promise; };
  let current = true;
  const pending = h.helper.showSolution(solution('pending'), { isCurrent: () => current });
  current = false;
  read.resolve({ groups: [{}] });
  assert.equal(await pending, undefined);
  assert.equal(h.shows.length, 0);
  assert.deepEqual(h.commands, [{ id: 'vscode.getEditorLayout' }]);
});

test('a newer explicit open supersedes a pending old layout decision', async () => {
  const h = fixture();
  const read = gate();
  const original = h.vscode.commands.executeCommand;
  let firstRead = true;
  h.vscode.commands.executeCommand = (id, value) => {
    if (id === 'vscode.getEditorLayout' && firstRead) { firstRead = false; return read.promise; }
    return original(id, value);
  };
  const old = h.helper.showSolution(solution('old'));
  const newest = solution('newest');
  const next = h.helper.showSolution(newest);
  read.resolve({ groups: [{}] });
  assert.equal(await old, undefined);
  assert.equal((await next).document, newest);
  assert.deepEqual(h.shows.map(show => show.document), [newest]);
  assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 1);
});

test('layout command failures fall back to existing groups and are never retried', async () => {
  for (const failedCommand of ['vscode.getEditorLayout', 'vscode.setEditorLayout']) {
    const h = fixture();
    const original = h.vscode.commands.executeCommand;
    h.vscode.commands.executeCommand = (id, value) => {
      if (id === failedCommand) { h.commands.push({ id }); return Promise.reject(new Error('unavailable')); }
      return original(id, value);
    };
    await h.helper.showSolution(solution('first'));
    await h.helper.showSolution(solution('second'));
    assert.deepEqual(h.shows.map(show => show.options.viewColumn), [1, 1]);
    assert.equal(h.commands.filter(call => call.id === failedCommand).length, 1);
  }
});

test('unknown tabGroups use bounded absolute columns without repeated layout commands', async () => {
  const h = fixture({ unknownGroups: true });
  await h.helper.showSolution(solution('first'));
  await h.helper.showSolution(solution('second'));
  assert.deepEqual(h.shows.map(show => show.options.viewColumn), [2, 2]);
  assert.equal(h.helper.problemColumn, 1);
  assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 1);
  h.vscode.window.visibleTextEditors = [];
  h.vscode.window.activeTextEditor = undefined;
  await h.helper.showSolution(solution('after-close'));
  assert.equal(h.shows.at(-1).options.viewColumn, 1, 'a missing group must not be recreated from stale memory');
  assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 1);
});

test('a canceled open after layout dispatch does not open code or repeat the layout decision', async () => {
  const h = fixture({ unknownGroups: true });
  const apply = gate();
  const original = h.vscode.commands.executeCommand;
  h.vscode.commands.executeCommand = (id, value) => {
    if (id === 'vscode.setEditorLayout') { h.commands.push({ id, value }); return apply.promise; }
    return original(id, value);
  };
  let current = true;
  const pending = h.helper.showSolution(solution('old'), { isCurrent: () => current });
  await Promise.resolve();
  current = false;
  apply.resolve();
  assert.equal(await pending, undefined);
  assert.equal(h.shows.length, 0);
  await h.helper.showSolution(solution('new'));
  assert.equal(h.shows[0].options.viewColumn, 2);
  assert.equal(h.commands.filter(call => call.id === 'vscode.setEditorLayout').length, 1);
});

test('dispose cancels a pending decision and removes lazy listeners without UI actions', async () => {
  const h = fixture();
  const read = gate();
  h.vscode.commands.executeCommand = id => { h.commands.push({ id }); return read.promise; };
  const pending = h.helper.showSolution(solution('pending'));
  assert.equal(h.activeListeners.size, 1);
  h.helper.dispose();
  read.resolve({ groups: [{}] });
  assert.equal(await pending, undefined);
  assert.equal(h.activeListeners.size + h.visibleListeners.size + h.shows.length, 0);
  assert.equal(await h.helper.showSolution(solution('after-dispose')), undefined);
});

test('editor failures propagate only for the current explicit open', async () => {
  const h = fixture({ columns: [1, 2], layout: { groups: [{}, {}] } });
  h.vscode.window.showTextDocument = async () => { throw new Error('cannot open'); };
  await assert.rejects(h.helper.showSolution(solution('current')), /cannot open/);
  const show = gate();
  h.vscode.window.showTextDocument = () => show.promise;
  let current = true;
  const pending = h.helper.showSolution(solution('stale'), { isCurrent: () => current });
  await Promise.resolve();
  await Promise.resolve();
  current = false;
  show.reject(new Error('stale failure'));
  assert.equal(await pending, undefined);
});
