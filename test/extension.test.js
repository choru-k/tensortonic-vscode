'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

const EXTENSION_PATH = path.resolve(__dirname, '../src/extension.js');
const DEFAULT_REF = { slug: 'pytorch-mini-training', planId: 'pytorch-basics', technology: 'PyTorch' };
const SECOND_REF = { slug: 'pytorch-dropout', planId: 'pytorch-basics', technology: 'PyTorch' };

class Uri {
  constructor(filePath) { this.fsPath = filePath; this.path = filePath; this.scheme = 'file'; }
  static file(value) { return new Uri(path.resolve(value)); }
  static parse(value) { return value.startsWith('file:') ? Uri.file(decodeURIComponent(new URL(value).pathname)) : { scheme: 'https', toString: () => value }; }
  static joinPath(base, ...parts) { return Uri.file(path.join(base.fsPath, ...parts)); }
  with(changes) { return Uri.file(changes.path || this.fsPath); }
  toString() { return `file://${this.fsPath}`; }
}

function disposable() { return { dispose() {} }; }

async function harness(t, { connected = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tensortonic-ui-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const documents = new Map();
  const commands = new Map();
  const contexts = new Map();
  const webviews = [];
  const errors = [];
  const output = [];
  const statuses = [];
  const trees = [];
  const codeLens = [];
  const configuration = new Map([['studyPlan', 'pytorch-basics'], ['solutionDirectory', 'tensortonic']]);
  const calls = { list: [], get: [], run: [], submit: [] };
  const fixtures = new Map([DEFAULT_REF, SECOND_REF].map((ref, i) => [ref.slug, {
    ref,
    title: i ? 'Dropout' : 'Mini training',
    description: '<p>Implement the requested operation.</p>',
    starterCode: `def solution_${i}(x):\n    pass\n`,
    examples: [{ input: { x: [1, 2] }, expected: [1, 2] }],
    testCases: [{ input: { x: [1, 2] }, expected: [1, 2] }],
  }]));

  async function openDocument(input) {
    if (!(input instanceof Uri)) {
      const id = `untitled:${documents.size}`;
      const document = { uri: { scheme: 'untitled', toString: () => id }, languageId: input.language, getText: () => input.content };
      documents.set(id, document);
      return document;
    }
    const key = input.toString();
    if (documents.has(key)) return documents.get(key);
    let content = await fs.readFile(input.fsPath, 'utf8');
    const document = {
      uri: input,
      languageId: input.path.endsWith('.py') ? 'python' : 'json',
      getText() { return content; },
      setText(value) { content = value; },
      async save() { await fs.writeFile(input.fsPath, content); return true; },
    };
    documents.set(key, document);
    return document;
  }

  class EventEmitter {
    constructor() { this.listeners = []; this.event = listener => { this.listeners.push(listener); return disposable(); }; }
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners = []; }
  }
  class WorkspaceEdit {
    constructor() { this.operations = []; }
    createFile(uri, options) { this.operations.push({ type: 'create', uri, options }); }
    insert(uri, position, text) { this.operations.push({ type: 'insert', uri, position, text }); }
  }
  const vscode = {
    Uri, EventEmitter, WorkspaceEdit,
    Position: class Position { constructor(line, character) { this.line = line; this.character = character; } },
    Range: class Range { constructor(...args) { this.values = args; } },
    CodeLens: class CodeLens { constructor(range, command) { this.range = range; this.command = command; } },
    ThemeIcon: class ThemeIcon { constructor(id) { this.id = id; } },
    TreeItem: class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    TreeItemCollapsibleState: { None: 0 },
    StatusBarAlignment: { Left: 1 },
    ViewColumn: { One: 1, Beside: -2 },
    ConfigurationTarget: { Workspace: 2, Global: 1 },
    ProgressLocation: { Notification: 15 },
    workspace: {
      workspaceFolders: [{ name: 'fixture', uri: Uri.file(root) }],
      fs: {
        async stat(uri) {
          try { return await fs.stat(uri.fsPath); }
          catch (error) { if (error.code === 'ENOENT') error.code = 'FileNotFound'; throw error; }
        },
        createDirectory: uri => fs.mkdir(uri.fsPath, { recursive: true }),
      },
      openTextDocument: openDocument,
      getConfiguration: () => ({ get: (key, fallback) => configuration.has(key) ? configuration.get(key) : fallback, update: async (key, value) => configuration.set(key, value) }),
      onDidChangeConfiguration: () => disposable(),
      async applyEdit(edit) {
        try {
          for (const operation of edit.operations) {
            if (operation.type === 'create') {
              assert.equal(operation.options.overwrite, false, 'Solution creation must explicitly prohibit overwrite');
              const handle = await fs.open(operation.uri.fsPath, 'wx');
              await handle.close();
            } else {
              const document = await openDocument(operation.uri);
              document.setText(operation.text + document.getText());
            }
          }
          return true;
        } catch (error) {
          if (error.code === 'EEXIST') return false;
          throw error;
        }
      },
    },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem() { const status = { show() {}, dispose() {} }; statuses.push(status); return status; },
      createOutputChannel() { return { appendLine: line => output.push(line), dispose() {} }; },
      createTreeView(id, options) { const tree = { id, options, dispose() {} }; trees.push(tree); return tree; },
      createWebviewPanel(type, title, column, options) {
        const panel = { type, title, options, webview: { html: '' }, onDidDispose: () => disposable(), reveal() {} };
        webviews.push(panel);
        return panel;
      },
      async showTextDocument(document) { this.activeTextEditor = { document }; return this.activeTextEditor; },
      showErrorMessage: async message => { errors.push(message); },
      showInformationMessage: async () => undefined,
      showQuickPick: async items => items[0],
      showInputBox: async () => undefined,
      withProgress: async (_, action) => action(),
    },
    commands: {
      registerCommand(id, handler) { commands.set(id, handler); return disposable(); },
      async executeCommand(id, ...args) {
        if (id === 'setContext') { contexts.set(args[0], args[1]); return; }
        if (!commands.has(id)) throw new Error(`Unknown command ${id}`);
        return commands.get(id)(...args);
      },
    },
    languages: { registerCodeLensProvider(selector, provider) { codeLens.push({ selector, provider }); return disposable(); } },
    env: { openExternal: async () => true },
  };

  class BrowserBridge {
    constructor() { this.connected = connected; }
    async start() {}
    async stop() { this.connected = false; }
    connectionCode() { return '/* local connection fixture */'; }
    request() { throw new Error('The UI should use the injected client in this test.'); }
  }
  class TensorTonicClient {
    async listProblems(planId) {
      calls.list.push(planId);
      return [...fixtures.values()].map(problem => ({ ...problem.ref, title: problem.title, difficulty: 'Easy' }));
    }
    async getProblem(ref) { calls.get.push(ref); return structuredClone(fixtures.get(ref.slug)); }
    async run(problem, code, cases) {
      calls.run.push({ problem, code, cases });
      return { passed: true, stdout: '</pre><script>globalThis.compromised = true</script>' };
    }
    async submit(problem, code) { calls.submit.push({ problem, code }); return { accepted: true }; }
  }

  const originalLoad = Module._load;
  let extension;
  try {
    Module._load = function load(request, parent, ...args) {
      if (parent && parent.filename === EXTENSION_PATH) {
        if (request === 'vscode') return vscode;
        if (request === './bridge') return { BrowserBridge };
        if (request === './client') return { TensorTonicClient };
      }
      return originalLoad.call(this, request, parent, ...args);
    };
    const freshModule = new Module(EXTENSION_PATH, module);
    freshModule.filename = EXTENSION_PATH;
    freshModule.paths = Module._nodeModulePaths(path.dirname(EXTENSION_PATH));
    freshModule._compile(await fs.readFile(EXTENSION_PATH, 'utf8'), EXTENSION_PATH);
    extension = freshModule.exports;
  } finally {
    Module._load = originalLoad;
  }
  const savedState = new Map();
  const context = { subscriptions: [], workspaceState: { get: key => savedState.get(key), update: async (key, value) => savedState.set(key, value) } };
  const api = extension.activate(context);
  t.after(() => { for (const subscription of context.subscriptions.reverse()) subscription.dispose(); });
  return { root, extension, api, vscode, documents, commands, contexts, webviews, errors, output, statuses, trees, codeLens, calls, fixtures, configuration };
}

test('activation exposes the commands promised by the manifest and connection state', async t => {
  const h = await harness(t);
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8'));
  for (const command of manifest.contributes.commands) assert.ok(h.commands.has(command.command), `${command.command} must be registered`);
  assert.equal(h.contexts.get('tensortonic.connected'), true);
  assert.equal(h.trees[0].id, 'tensortonicProblems');
  assert.equal(h.codeLens.length, 1);
  await h.api.refresh();
  const problems = h.trees[0].options.treeDataProvider.getChildren();
  assert.equal(problems.length, 2);
  assert.equal(problems[0].command.command, 'tensortonic.openProblem');
  assert.deepEqual(h.calls.list, ['pytorch-basics']);
});

test('reopening a problem preserves the learner’s solution and edited test cases on disk', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  assert.equal(opened.uri.fsPath, path.join(h.root, 'tensortonic', 'pytorch-basics', `${DEFAULT_REF.slug}.py`));
  const original = await fs.readFile(opened.uri.fsPath, 'utf8');
  assert.match(original, /^# tensortonic: /);
  assert.match(original, /def solution_0/);
  const document = await h.vscode.workspace.openTextDocument(opened.uri);
  const learnerCode = original.replace('    pass', '    return x * 17');
  document.setText(learnerCode);
  await document.save();
  const tests = await h.vscode.workspace.openTextDocument(opened.testsUri);
  const learnerTests = '[{"input":{"x":[99]},"expected":[1683]}]\n';
  tests.setText(learnerTests);
  await tests.save();
  h.fixtures.get(DEFAULT_REF.slug).starterCode = 'replacement_from_new_server_version = True\n';
  const reopened = await h.api.openProblem(DEFAULT_REF);
  assert.equal(reopened.uri.toString(), opened.uri.toString());
  assert.equal(await fs.readFile(opened.uri.fsPath, 'utf8'), learnerCode);
  assert.equal(await fs.readFile(opened.testsUri.fsPath, 'utf8'), learnerTests);
  assert.equal(document.getText(), learnerCode);
});

test('Run uses the selected solution and current unsaved code and test cases', async t => {
  const h = await harness(t);
  const first = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(first.uri);
  const persistedCode = document.getText();
  const unsavedCode = persistedCode.replace('    pass', '    return x + 123');
  document.setText(unsavedCode);
  const tests = await h.vscode.workspace.openTextDocument(first.testsUri);
  const unsavedCases = [{ input: { x: [7] }, expected: [130] }];
  tests.setText(JSON.stringify(unsavedCases));
  await h.api.openProblem(SECOND_REF); // A different solution now has editor focus.
  const result = await h.commands.get('tensortonic.run')(first.uri);
  assert.equal(result.passed, true);
  assert.equal(h.calls.run.length, 1);
  assert.equal(h.calls.run[0].problem.ref.slug, DEFAULT_REF.slug);
  assert.equal(h.calls.run[0].code, unsavedCode);
  assert.deepEqual(h.calls.run[0].cases, unsavedCases);
  assert.equal(await fs.readFile(first.uri.fsPath, 'utf8'), persistedCode, 'Run must not save or replace the learner’s file');
  const panel = h.webviews.find(panel => panel.type === 'tensortonic.results');
  assert.equal(panel.options.enableScripts, false);
  assert.ok(panel.webview.html.includes('&lt;script&gt;'));
  assert.ok(!panel.webview.html.includes('<script>'));
  assert.deepEqual(h.errors, []);
});

test('an unrelated file or invalid test JSON is never sent for execution', async t => {
  const h = await harness(t);
  const unrelated = Uri.file(path.join(h.root, 'unrelated.py'));
  await fs.writeFile(unrelated.fsPath, 'private_local_data = "must not be sent"\n');
  await h.commands.get('tensortonic.run')(unrelated);
  assert.equal(h.calls.run.length, 0);
  assert.match(h.errors.at(-1), /no TensorTonic metadata/);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const tests = await h.vscode.workspace.openTextDocument(opened.testsUri);
  tests.setText('{broken');
  await h.commands.get('tensortonic.run')(opened.uri);
  assert.equal(h.calls.run.length, 0);
  assert.match(h.errors.at(-1), /valid JSON/);
  tests.setText('{"not":"an array"}');
  await h.commands.get('tensortonic.run')(opened.uri);
  assert.equal(h.calls.run.length, 0);
  assert.match(h.errors.at(-1), /JSON array/);
});

test('remote statements and examples remain inert text with browser scripts disabled', async t => {
  const h = await harness(t);
  const fixture = h.fixtures.get(DEFAULT_REF.slug);
  fixture.title = '<img src=x onerror="alert(1)">';
  fixture.description = '<p>Hello &amp; welcome</p><script>globalThis.compromised = true</script><img src=x onerror="alert(1)"><p>&#60;script&#62;encoded&#60;/script&#62;</p>';
  fixture.examples = [{ input: '</pre><script>alert(2)</script>' }];
  await h.api.openProblem(DEFAULT_REF);
  const panel = h.webviews.find(panel => panel.type === 'tensortonic.description');
  assert.equal(panel.options.enableScripts, false);
  assert.deepEqual(panel.options.localResourceRoots, []);
  assert.ok(!panel.webview.html.includes('<script'));
  assert.ok(!panel.webview.html.includes('<img'));
  assert.ok(!panel.webview.html.includes('globalThis.compromised'));
  assert.ok(panel.webview.html.includes('Hello &amp; welcome'));
  assert.ok(panel.webview.html.includes('&lt;script&gt;encoded&lt;/script&gt;'));
  assert.ok(panel.webview.html.includes("default-src 'none'"));
});

test('problem references cannot escape the solution folder or retain untrusted metadata', async t => {
  const h = await harness(t);
  await assert.rejects(h.api.openProblem({ slug: '../outside' }), /Select a TensorTonic problem/);
  await assert.rejects(h.api.openProblem({ slug: 'safe', planId: '../outside' }), /study plan/);
  assert.equal(h.calls.get.length, 0, 'Reject path traversal before contacting the service');
  h.configuration.set('solutionDirectory', '../outside');
  await assert.rejects(h.api.openProblem(DEFAULT_REF), /relative folder inside your workspace/);
  assert.deepEqual(await fs.readdir(h.root), []);
  const metadata = h.extension.readRef('# tensortonic: {"slug":"safe","planId":"pytorch-basics","unexpected":"discard","__proto__":{"polluted":true}}');
  assert.deepEqual(metadata, { slug: 'safe', planId: 'pytorch-basics' });
  assert.equal({}.polluted, undefined);
});

test('disconnected browsing has a connection action and sends no API requests', async t => {
  const h = await harness(t, { connected: false });
  const rows = h.trees[0].options.treeDataProvider.getChildren();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].command.command, 'tensortonic.connect');
  assert.equal(h.contexts.get('tensortonic.connected'), false);
  await assert.rejects(h.api.refresh(), /Connect a signed-in/);
  assert.deepEqual(h.calls.list, []);
  const report = await h.api.smokeTest();
  assert.equal(report.activated, true);
  assert.equal(report.connected, false);
  assert.deepEqual(h.calls.get, []);
});
