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
  constructor(filePath) { this.fsPath = filePath; this.path = filePath; this.scheme = 'file'; this.authority = ''; this.query = ''; this.fragment = ''; }
  static file(value) { return new Uri(path.resolve(value)); }
  static isUri(value) { return value instanceof Uri; }
  static parse(value) { return value.startsWith('file:') ? Uri.file(decodeURIComponent(new URL(value).pathname)) : { scheme: 'https', toString: () => value }; }
  static joinPath(base, ...parts) { return Uri.file(path.join(base.fsPath, ...parts)); }
  with(changes) { return Uri.file(changes.path || this.fsPath); }
  toString() { return `file://${this.fsPath}`; }
}

function disposable() { return { dispose() {} }; }

async function harness(t, { connected = true, externalCommands = ['workbench.action.chat.open', 'chatgpt.addFileToThread', 'chatgpt.openSidebar'], markdownExtension, globalStateForRoot = () => new Map(), trusted = true, connectionMode = 'browserCompanion', nativeTransport } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tensortonic-ui-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const documents = new Map();
  const commands = new Map();
  const contexts = new Map();
  const webviews = [];
  const errors = [];
  const information = [];
  const informationChoices = [];
  const clipboardWrites = [];
  const output = [];
  const statuses = [];
  const trees = [];
  const codeLens = [];
  const tools = new Map();
  const commandExecutions = [];
  const configuration = new Map([['studyPlan', 'pytorch-basics'], ['solutionDirectory', 'tensortonic']]);
  const configurationListeners = [];
  const activeEditorListeners = [];
  const fireConfiguration = key => configurationListeners.forEach(listener => listener({ affectsConfiguration: name => name === `tensortonic.${key}` }));
  const calls = { list: [], get: [], run: [], submit: [] };
  const fixtures = new Map([DEFAULT_REF, SECOND_REF].map((ref, i) => [ref.slug, {
    ref,
    title: i ? 'Dropout' : 'Mini training',
    description: '<p>Implement the requested operation.</p>\n\n## Requirements\nUse float32.\n\n## Constraints\nPreserve shape.',
    starterCode: `def solution_${i}(x):\n    pass\n`,
    examples: ['Input: x=[1,2]\nOutput: [1,2]'],
    testCases: [
      { id: 'public-1', name: 'Public example', inputs: { x: [1, 2] }, isPublic: true },
      { id: 'private-1', inputs: { x: 'PRIVATE_CASE_SENTINEL' }, isPublic: false },
    ],
    solution: 'ANSWER_SENTINEL',
    theory: 'THEORY_SENTINEL',
    raw: { solution: 'RAW_ANSWER_SENTINEL', auth: 'COOKIE_SENTINEL' },
  }]));

  async function openDocument(input) {
    if (!(input instanceof Uri)) {
      const id = `untitled:${documents.size}`;
      const document = { uri: { scheme: 'untitled', toString: () => id }, languageId: input.language, isDirty: true, getText: () => input.content };
      documents.set(id, document);
      return document;
    }
    const key = input.toString();
    if (documents.has(key)) return documents.get(key);
    let content = await fs.readFile(input.fsPath, 'utf8');
    let persistedContent = content;
    const document = {
      uri: input,
      languageId: input.path.endsWith('.py') ? 'python' : input.path.endsWith('.md') ? 'markdown' : 'json',
      get isDirty() { return content !== persistedContent; },
      getText() { return content; },
      setText(value) { content = value; },
      positionAt(offset) {
        const prefix = content.slice(0, Math.max(0, Math.min(offset, content.length)));
        const lines = prefix.split('\n');
        return new vscode.Position(lines.length - 1, lines.at(-1).length);
      },
      offsetAt(position) {
        const lines = content.split('\n');
        const line = Math.max(0, Math.min(position.line, lines.length - 1));
        return lines.slice(0, line).reduce((length, value) => length + value.length + 1, 0) +
          Math.max(0, Math.min(position.character, lines[line].length));
      },
      async save() { await fs.writeFile(input.fsPath, content); persistedContent = content; return true; },
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
    replace(uri, range, text) { this.operations.push({ type: 'replace', uri, range, text }); }
  }
  const vscode = {
    Uri, EventEmitter, WorkspaceEdit, ProgressLocation: { Notification: 15 },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    UIKind: { Desktop: 1, Web: 2 },
    Position: class Position { constructor(line, character) { this.line = line; this.character = character; } },
    Range: class Range {
      constructor(...args) {
        this.values = args;
        this.start = args.length === 2 ? args[0] : { line: args[0], character: args[1] };
        this.end = args.length === 2 ? args[1] : { line: args[2], character: args[3] };
      }
    },
    LanguageModelToolResult: class LanguageModelToolResult { constructor(content) { this.content = content; } },
    LanguageModelTextPart: class LanguageModelTextPart { constructor(value) { this.value = value; } },
    CodeLens: class CodeLens { constructor(range, command) { this.range = range; this.command = command; } },
    ThemeIcon: class ThemeIcon { constructor(id) { this.id = id; } },
    TreeItem: class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1 },
    ViewColumn: { One: 1, Beside: -2 },
    ConfigurationTarget: { Workspace: 2, Global: 1 },
    ProgressLocation: { Notification: 15 },
    workspace: {
      workspaceFolders: [{ name: 'fixture', uri: Uri.file(root) }],
      isTrusted: trusted,
      fs: {
        async stat(uri) {
          try { const stat = await fs.stat(uri.fsPath); return { type: stat.isDirectory() ? 2 : 1, size: stat.size }; }
          catch (error) { if (error.code === 'ENOENT') error.code = 'FileNotFound'; throw error; }
        },
        createDirectory: uri => fs.mkdir(uri.fsPath, { recursive: true }),
      },
      openTextDocument: openDocument,
      getConfiguration: () => ({ get: (key, fallback) => configuration.has(key) ? configuration.get(key) : key === 'connectionMode' ? connectionMode : fallback, update: async (key, value) => { configuration.set(key, value); fireConfiguration(key); } }),
      onDidChangeConfiguration: listener => { configurationListeners.push(listener); return disposable(); },
      async applyEdit(edit) {
        try {
          for (const operation of edit.operations) {
            if (operation.type === 'create') {
              assert.equal(operation.options.overwrite, false, 'Solution creation must explicitly prohibit overwrite');
              const handle = await fs.open(operation.uri.fsPath, 'wx');
              await handle.close();
            } else if (operation.type === 'replace') {
              const document = await openDocument(operation.uri);
              const content = document.getText();
              const start = document.offsetAt(operation.range.start);
              const end = document.offsetAt(operation.range.end);
              document.setText(content.slice(0, start) + operation.text + content.slice(end));
            } else {
              const document = await openDocument(operation.uri);
              const offset = document.offsetAt(operation.position);
              document.setText(document.getText().slice(0, offset) + operation.text + document.getText().slice(offset));
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
      createTreeView(id, options) {
        let changed;
        const tree = { id, options, visible: true, reveals: [], dispose() {},
          onDidChangeVisibility(listener) { changed = listener; return disposable(); },
          setVisible(visible) { this.visible = visible; if (changed) changed({visible}); },
          async reveal(item, options) { this.reveals.push({item, options}); },
        };
        trees.push(tree); return tree;
      },
      createWebviewPanel(type, title, column, options) {
        let onDispose;
        const panel = { type, title, options, webview: { html: '' },
          onDidDispose(listener) { onDispose = listener; return disposable(); },
          dispose() { this.disposed = true; if (onDispose) onDispose(); }, reveal() {} };
        webviews.push(panel);
        return panel;
      },
      async showTextDocument(document) {
        this.activeTextEditor = { document };
        for (const listener of activeEditorListeners) listener(this.activeTextEditor);
        return this.activeTextEditor;
      },
      onDidChangeActiveTextEditor: listener => { activeEditorListeners.push(listener); return disposable(); },
      showErrorMessage: async message => { errors.push(message); },
      showInformationMessage: async (...args) => { information.push(args); return informationChoices.shift(); },
      showQuickPick: async items => items[0],
      showInputBox: async () => undefined,
      showOpenDialog: async () => undefined,
      withProgress: async (_, action) => action(),
    },
    commands: {
      registerCommand(id, handler) { commands.set(id, handler); return disposable(); },
      async getCommands() { return [...commands.keys(), ...externalCommands]; },
      async executeCommand(id, ...args) {
        if (id === 'setContext') { contexts.set(args[0], args[1]); return; }
        commandExecutions.push({ id, args, activeDocument: vscode.window.activeTextEditor && vscode.window.activeTextEditor.document });
        if (externalCommands.includes(id)) {
          if (id === 'workbench.action.chat.open' || id === 'chatgpt.openSidebar') vscode.window.activeTextEditor = undefined;
          return;
        }
        if (!commands.has(id)) throw new Error(`Unknown command ${id}`);
        return commands.get(id)(...args);
      },
    },
    languages: { registerCodeLensProvider(selector, provider) { codeLens.push({ selector, provider }); return disposable(); } },
    extensions: { getExtension: id => id === 'vscode.markdown-language-features' ? markdownExtension : undefined },
    lm: { registerTool(name, tool) { tools.set(name, tool); return { dispose() { tools.delete(name); } }; } },
    env: { uiKind: 1, remoteName: undefined, openExternal: async () => true, clipboard: { writeText: async value => { clipboardWrites.push(value); } } },
  };

  vscode.window.withProgress = async (_options, callback) => callback({ report() {} }, { isCancellationRequested: false, onCancellationRequested() { return disposable(); } });

  class BrowserBridge {
    constructor() { this.connected = connected; this.starts = 0; this.pairings = 0; }
    async start() { this.starts++; }
    async stop() { this.connected = false; }
    connectionCode() { return '/* local connection fixture */'; }
    pairingCode() { this.pairings++; return 'TT1:43210:' + 'a'.repeat(32); }
    request() { throw new Error('The UI should use the injected client in this test.'); }
  }
  class TensorTonicClient {
    async listProblems(planId) {
      calls.list.push(planId);
      return [...fixtures.values()].map((problem,index) => ({ ...problem.ref, title: problem.title, difficulty: 'Easy', solved: index===0, studyPlanTitle:'PyTorch Sheet', section:{id:index===0?'foundations':'training',title:index===0?'Foundations':'Training',order:index+1} }));
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
        if (request === './native-browser-bridge' && nativeTransport) return { NativeBrowserBridge: class { constructor() { return nativeTransport; } } };
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
  const globalValues = globalStateForRoot(root);
  const globalState = { keys: () => [...globalValues.keys()], get: key => globalValues.get(key), update: async (key,value) => { if(value===undefined) globalValues.delete(key); else globalValues.set(key,value); } };
  const context = { globalState, subscriptions: [], extensionUri: Uri.file(path.resolve(__dirname, '..')), workspaceState: { get: key => savedState.get(key), update: async (key, value) => savedState.set(key, value) } };
  const api = extension.activate(context);
  await api.studyWorkspaceReady;
  t.after(() => { for (const subscription of context.subscriptions.reverse()) subscription.dispose(); });
  return { root, extension, api, vscode, documents, commands, contexts, webviews, errors, output, statuses, trees, codeLens, calls, fixtures, configuration, tools, commandExecutions, fireConfiguration, information, informationChoices, clipboardWrites, globalValues };
}

function problemRows(view) {
  const provider = view.options.treeDataProvider;
  const collect = node => provider.getChildren(node).flatMap(item => item.problemRef ? [item] : collect(item));
  return collect(undefined);
}

const flushReveals = () => new Promise(resolve => setImmediate(resolve));

test('a late previous-plan refresh cannot replace the current plan catalogue', async t => {
  const h = await harness(t);
  let completeOld;
  h.api.client.listProblems = plan => plan === 'pytorch-basics'
    ? new Promise(resolve => { completeOld = resolve; })
    : Promise.resolve([{ slug: 'new-plan-problem', planId: plan, title: 'New plan' }]);
  const oldRefresh = h.api.refresh();
  await h.vscode.workspace.getConfiguration('tensortonic').update('studyPlan', 'numpy-basics');
  await h.api.refresh();
  completeOld([{ ...DEFAULT_REF, title: 'Stale plan' }]);
  await oldRefresh;
  const tree = h.trees[0];
  assert.equal(tree.description, 'numpy-basics');
  assert.deepEqual(problemRows(tree).map(item => item.label), ['New plan']);
});

test('an older refresh finishing cannot clear a newer refresh loading state', async t => {
  const h = await harness(t);
  const completions = [];
  h.api.client.listProblems = () => new Promise(resolve => completions.push(resolve));
  const older = h.api.refresh();
  const newer = h.api.refresh();
  completions[0]([{ ...DEFAULT_REF, title: 'Stale' }]);
  await older;
  assert.equal(h.trees[0].options.treeDataProvider.getChildren()[0].label, 'Loading problems…');
  completions[1]([{ ...SECOND_REF, title: 'Current' }]);
  await newer;
  assert.equal(problemRows(h.trees[0])[0].label, 'Current');
});

test('disconnect invalidates an in-flight catalogue without stale rows or errors', async t => {
  const h = await harness(t);
  let rejectOld;
  h.api.client.listProblems = () => new Promise((resolve, reject) => { rejectOld = reject; });
  const oldRefresh = h.api.refresh();
  await h.commands.get('tensortonic.disconnect')();
  rejectOld(new Error('Canceled old connection'));
  assert.deepEqual(await oldRefresh, []);
  h.api.bridge.connected = true;
  h.trees[0].options.treeDataProvider.refresh();
  assert.equal(h.trees[0].options.treeDataProvider.getChildren()[0].label, 'Refresh problems');
  assert.equal(h.trees[0].description, undefined);
  assert.deepEqual(h.errors, []);
});

test('activation exposes the commands promised by the manifest and connection state', async t => {
  const h = await harness(t);
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8'));
  for (const command of manifest.contributes.commands) assert.ok(h.commands.has(command.command), `${command.command} must be registered`);
  assert.equal(h.contexts.get('tensortonic.connected'), true);
  assert.equal(h.trees[0].id, 'tensortonicProblems');
  assert.equal(h.codeLens.length, 1);
  await h.api.refresh();
  const problems = problemRows(h.trees[0]);
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
  assert.match(await fs.readFile(reopened.contextUri.fsPath, 'utf8'), /replacement_from_new_server_version/);
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

test('observed Run and Submit response shapes become readable, script-free result panels', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  h.api.client.run = async () => ({ status: 'passed', tests: [{
    id: 'test-1', name: 'Case 1', ok: true, isPublic: true, msg: '',
    inputs: { logits: [[1, 2, 3]] }, expected: [[0.09, 0.2447, 0.6652]],
    actual: [[0.09, 0.2447, 0.6652]], logs: '',
  }] });
  await h.commands.get('tensortonic.run')(opened.uri);
  const panel = h.webviews.find(value => value.type === 'tensortonic.results');
  assert.match(panel.webview.html, /<h2>Passed<\/h2>/);
  for (const label of ['Case 1', 'Input', 'Expected', 'Actual']) assert.ok(panel.webview.html.includes(label));
  assert.match(panel.webview.html, /<details class="result-case result-passed">/);
  assert.match(panel.webview.html, /<details class="result-debug"><summary>Raw response \(JSON\)<\/summary>/);
  assert.doesNotMatch(panel.webview.html, /0 \/ 0/);
  h.api.client.submit = async () => ({ status: 'passed', tests: [], passed: 43, total: 43, duration_ms: 1006, newBadges: [] });
  await h.commands.get('tensortonic.submit')(opened.uri);
  assert.match(panel.webview.html, /43 \/ 43/);
  assert.match(panel.webview.html, /1006 ms/);
  assert.match(panel.webview.html, /Individual test details were not returned/);
  assert.doesNotMatch(panel.webview.html, /zero test cases|No tests executed/);
  assert.equal(panel.options.enableScripts, false);
  assert.deepEqual(panel.options.localResourceRoots, []);
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.doesNotMatch(panel.webview.html, /<script|<iframe|<img/);
});

test('a failed grading request replaces an earlier pass with a visible uncertain-outcome error without retry', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  await h.commands.get('tensortonic.submit')(opened.uri);
  const panel = h.webviews.find(value => value.type === 'tensortonic.results');
  assert.match(panel.webview.html, /<h2>Passed<\/h2>/);
  let requests = 0;
  h.api.client.submit = async () => { requests++; throw new Error('Timed out <script>alert(1)</script>'); };
  assert.equal(await h.commands.get('tensortonic.submit')(opened.uri), undefined);
  assert.equal(requests, 1);
  assert.match(panel.webview.html, /Request error/);
  assert.match(panel.webview.html, /No confirmed grading result was received/);
  assert.match(panel.webview.html, /Check TensorTonic before submitting again/);
  assert.match(panel.webview.html, /&lt;script&gt;/);
  assert.doesNotMatch(panel.webview.html, /<script|<h2>Passed<\/h2>|Raw response \(JSON\)|0 \/ 0/);
  assert.equal(h.errors.length, 1, 'the existing error notification is retained');
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
  await assert.rejects(h.api.refresh(), /Connect browser/);
  assert.deepEqual(h.calls.list, []);
  const report = await h.api.smokeTest();
  assert.equal(report.activated, true);
  assert.equal(report.connected, false);
  assert.deepEqual(h.calls.get, []);
});

test('opening a problem writes an attachable statement with the correct source and no answers or private data', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  assert.equal(opened.contextUri.fsPath, path.join(h.root, 'tensortonic', 'pytorch-basics', `${DEFAULT_REF.slug}.problem.md`));
  const content = await fs.readFile(opened.contextUri.fsPath, 'utf8');
  assert.match(content, /^<!-- TensorTonic generated problem context/);
  assert.match(content, /# Mini training/);
  assert.match(content, /https:\/\/www\.tensortonic\.com\/problems\/pytorch-mini-training\?studyPlan=pytorch-basics/);
  assert.match(content, /## Requirements/);
  assert.match(content, /Preserve shape/);
  assert.match(content, /Input: x=\[1,2\]/);
  assert.match(content, /public-1/);
  assert.match(content, /def solution_0/);
  assert.doesNotMatch(content, /SENTINEL|private-1|"raw"|"solution"|"theory"/);
  const document = await h.vscode.workspace.openTextDocument(opened.contextUri);
  assert.equal(document.isDirty, false, 'Generated statement must be available to agents as a saved file');
  assert.deepEqual(h.errors, []);
});

test('Discuss with Agent attaches the selected problem, solution and tests without saving current edits', async t => {
  const h = await harness(t);
  const selected = await h.api.openProblem(DEFAULT_REF);
  const solution = await h.vscode.workspace.openTextDocument(selected.uri);
  const persisted = solution.getText();
  const unsaved = persisted.replace('    pass', '    return x + 731 # CURRENT_UNSAVED_STUDENT_CODE');
  solution.setText(unsaved);
  const tests = await h.vscode.workspace.openTextDocument(selected.testsUri);
  const savedTests = tests.getText();
  tests.setText('[{"id":"mine","inputs":{"x":[731]}}]');
  await h.api.openProblem(SECOND_REF);
  const result = await h.commands.get('tensortonic.discussWithAgent')(selected.uri);
  const chat = h.commandExecutions.find(call => call.id === 'workbench.action.chat.open');
  assert.ok(chat, 'Agent chat must be opened through the VS Code command');
  const options = chat.args[0];
  assert.equal(options.mode, 'agent');
  assert.equal(options.isPartialQuery, true, 'Opening context must leave the tutoring prompt available for review');
  assert.deepEqual(options.attachFiles.map(uri => uri.fsPath), [selected.contextUri.fsPath, selected.uri.fsPath, selected.testsUri.fsPath]);
  assert.deepEqual(result.attachedFiles.map(uri => uri.fsPath), options.attachFiles.map(uri => uri.fsPath));
  assert.ok(options.query.includes(selected.uri.fsPath));
  assert.ok(options.query.includes(selected.contextUri.fsPath));
  assert.match(options.query, /pytorch-mini-training\?studyPlan=pytorch-basics/);
  assert.match(options.query, /unsaved editor changes/);
  assert.match(options.query, /one step at a time/);
  assert.match(options.query, /Do not show a complete answer or full implementation unless/);
  assert.equal(solution.getText(), unsaved);
  assert.equal(solution.isDirty, true);
  assert.equal(await fs.readFile(selected.uri.fsPath, 'utf8'), persisted);
  assert.equal(await fs.readFile(selected.testsUri.fsPath, 'utf8'), savedTests);
  assert.equal(tests.isDirty, true);
  assert.equal(h.calls.run.length, 0);
  assert.equal(h.calls.submit.length, 0);
  assert.deepEqual(h.errors, []);
});

test('the language-model tool returns the last selected problem and unsaved code while the Agent panel has focus', async t => {
  const h = await harness(t);
  const first = await h.api.openProblem(DEFAULT_REF);
  const firstDocument = await h.vscode.workspace.openTextDocument(first.uri);
  firstDocument.setText(firstDocument.getText().replace('    pass', '    return FIRST_STUDENT_CODE'));
  const second = await h.api.openProblem(SECOND_REF);
  const secondDocument = await h.vscode.workspace.openTextDocument(second.uri);
  const secondCode = secondDocument.getText().replace('    pass', '    return SECOND_UNSAVED_CODE');
  secondDocument.setText(secondCode);
  h.vscode.window.activeTextEditor = undefined;
  const tool = h.tools.get('tensortonic_current_problem');
  assert.ok(tool, 'The problem context must be registered as an explicit LM tool');
  const prepared = await tool.prepareInvocation();
  assert.match(prepared.invocationMessage, /selected TensorTonic problem/);
  const result = await tool.invoke({ input: {} }, { isCancellationRequested: false });
  assert.ok(result instanceof h.vscode.LanguageModelToolResult);
  assert.ok(result.content[0] instanceof h.vscode.LanguageModelTextPart);
  const text = result.content.map(part => part.value).join('\n');
  assert.match(text, /# Dropout/);
  assert.match(text, /pytorch-dropout\?studyPlan=pytorch-basics/);
  assert.ok(text.includes(secondCode));
  assert.doesNotMatch(text, /FIRST_STUDENT_CODE|SENTINEL|private-1/);
  assert.equal(secondDocument.isDirty, true);

  // A context/Agent editor with no solution metadata must also keep that selection.
  const unrelated = await h.vscode.workspace.openTextDocument({ language: 'markdown', content: 'Agent scratch notes without problem metadata' });
  await h.vscode.window.showTextDocument(unrelated);
  const again = await tool.invoke({ input: {} }, { isCancellationRequested: false });
  assert.ok(again.content[0].value.includes(secondCode));
  assert.doesNotMatch(again.content[0].value, /FIRST_STUDENT_CODE/);
  assert.deepEqual(h.errors, []);
});

test('dirty edits to generated problem context are preserved instead of overwritten on refresh', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(opened.contextUri);
  const original = document.getText();
  const notes = original + '\nMy unsaved personal notes\n';
  document.setText(notes);
  h.fixtures.get(DEFAULT_REF.slug).description = 'Server changed statement';
  await assert.rejects(h.api.openProblem(DEFAULT_REF), /has been edited/);
  assert.equal(document.getText(), notes);
  assert.equal(document.isDirty, true);
  assert.equal(await fs.readFile(opened.contextUri.fsPath, 'utf8'), original);
});

test('saved personal edits retaining the generated marker are preserved on context refresh', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(opened.contextUri);
  const notes = document.getText() + '\nMy saved personal notes\n';
  document.setText(notes);
  await document.save();
  assert.equal(document.isDirty, false);
  h.fixtures.get(DEFAULT_REF.slug).description = 'Server changed statement';
  await assert.rejects(h.api.openProblem(DEFAULT_REF), /has been edited/);
  assert.equal(document.getText(), notes);
  assert.equal(await fs.readFile(opened.contextUri.fsPath, 'utf8'), notes);
});

test('Codex integration attaches the corresponding problem and current solution through its registered commands', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const solution = await h.vscode.workspace.openTextDocument(opened.uri);
  const saved = solution.getText();
  solution.setText(saved.replace('    pass', '    return UNSAVED_CODEX_CODE'));
  await h.commands.get('tensortonic.discussWithCodex')(opened.uri);
  const attachments = h.commandExecutions.filter(call => call.id === 'chatgpt.addFileToThread');
  assert.deepEqual(attachments.map(call => call.activeDocument.uri.fsPath), [opened.contextUri.fsPath, opened.uri.fsPath]);
  assert.ok(attachments[1].activeDocument.getText().includes('UNSAVED_CODEX_CODE'));
  assert.ok(h.commandExecutions.some(call => call.id === 'chatgpt.openSidebar'));
  assert.equal(await fs.readFile(opened.uri.fsPath, 'utf8'), saved);
  assert.equal(solution.isDirty, true);
  assert.deepEqual(h.errors, []);
});

test('switching back to an earlier solution updates Agent context before chat takes focus', async t => {
  const h = await harness(t);
  const first = await h.api.openProblem(DEFAULT_REF);
  const firstDocument = await h.vscode.workspace.openTextDocument(first.uri);
  firstDocument.setText(firstDocument.getText().replace('    pass', '    return FIRST_RESELECTED_UNSAVED_CODE'));
  await h.api.openProblem(SECOND_REF);
  await h.vscode.window.showTextDocument(firstDocument); // A -> B -> A, via editor tabs.
  h.vscode.window.activeTextEditor = undefined; // Agent now has focus.
  const result = await h.tools.get('tensortonic_current_problem').invoke({ input: {} });
  const text = result.content.map(part => part.value).join('\n');
  assert.match(text, /FIRST_RESELECTED_UNSAVED_CODE/);
  assert.match(text, /# Mini training/);
  assert.doesNotMatch(text, /# Dropout/);
  assert.equal(firstDocument.isDirty, true);
  assert.deepEqual(h.errors, []);
});

test('a delayed old problem response cannot replace the latest clicked problem or create stale files', async t => {
  const h = await harness(t);
  const getProblem = h.api.client.getProblem.bind(h.api.client);
  let completeFirst;
  h.api.client.getProblem = ref => ref.slug === DEFAULT_REF.slug
    ? new Promise(resolve => { completeFirst = resolve; })
    : getProblem(ref);
  const first = h.api.openProblem(DEFAULT_REF);
  const second = await h.api.openProblem(SECOND_REF);
  completeFirst(await getProblem(DEFAULT_REF));
  assert.equal(await first, undefined);
  assert.equal(h.vscode.window.activeTextEditor.document.uri.fsPath, second.uri.fsPath);
  assert.equal((await h.api.currentContext()).ref.slug, SECOND_REF.slug);
  const files = await fs.readdir(path.dirname(second.uri.fsPath));
  assert.equal(files.some(name => name.startsWith(DEFAULT_REF.slug)), false);
});

test('disconnect cancels a pending problem open before file and editor side effects', async t => {
  const h = await harness(t);
  let complete;
  h.api.client.getProblem = () => new Promise(resolve => { complete = resolve; });
  const opening = h.api.openProblem(DEFAULT_REF);
  await h.commands.get('tensortonic.disconnect')();
  complete(structuredClone(h.fixtures.get(DEFAULT_REF.slug)));
  assert.equal(await opening, undefined);
  assert.deepEqual(await fs.readdir(h.root), []);
  assert.equal(h.vscode.window.activeTextEditor, undefined);
});

test('repeated Submit is rejected across the full command lifecycle, including metadata GETs', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  let finishGrading;
  let startedGrading;
  const gradingStarted = new Promise(resolve => { startedGrading = resolve; });
  h.api.client.submit = async (problem, code) => {
    h.calls.submit.push({ problem, code });
    startedGrading();
    return new Promise(resolve => { finishGrading = resolve; });
  };
  const first = h.commands.get('tensortonic.submit')(opened.uri);
  await gradingStarted;
  const getCount = h.calls.get.length;
  assert.equal(await h.commands.get('tensortonic.submit')(opened.uri), undefined);
  assert.equal(await h.commands.get('tensortonic.run')(opened.uri), undefined);
  assert.equal(h.calls.get.length, getCount, 'Duplicate clicks must not enqueue metadata GETs');
  assert.equal(h.calls.submit.length, 1);
  assert.equal(h.calls.run.length, 0);
  assert.match(h.errors.at(-1), /already in progress/);
  finishGrading({ status: 'passed' });
  assert.equal((await first).status, 'passed');
  h.api.client.submit = async () => ({ status: 'passed', newAttempt: true });
  assert.equal((await h.commands.get('tensortonic.submit')(opened.uri)).newAttempt, true, 'Lock releases after completion');
});

test('grading command lock releases on validation errors and upstream failures', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const tests = await h.vscode.workspace.openTextDocument(opened.testsUri);
  tests.setText('not-json');
  assert.equal(await h.commands.get('tensortonic.run')(opened.uri), undefined);
  tests.setText('[]');
  h.api.client.run = async () => { throw new Error('Upstream failed'); };
  assert.equal(await h.commands.get('tensortonic.run')(opened.uri), undefined);
  h.api.client.run = async () => ({ status: 'passed' });
  assert.equal((await h.commands.get('tensortonic.run')(opened.uri)).status, 'passed');
});

test('explicit Description targets its own solution after another editor was selected', async t => {
  const h = await harness(t, { externalCommands: ['markdown.showPreviewToSide'] });
  const first = await h.api.openProblem(DEFAULT_REF);
  const firstDocument = await h.vscode.workspace.openTextDocument(first.uri);
  const firstContext = await fs.readFile(first.contextUri.fsPath, 'utf8');
  const second = await h.api.openProblem(SECOND_REF);
  await h.vscode.window.showTextDocument(firstDocument);
  await h.commands.get('tensortonic.description')(second.uri);
  assert.equal(await fs.readFile(first.contextUri.fsPath, 'utf8'), firstContext);
  const preview = h.commandExecutions.filter(call => call.id === 'markdown.showPreviewToSide').at(-1);
  assert.equal(preview.args[0].fsPath, second.contextUri.fsPath);
  assert.match(await fs.readFile(second.contextUri.fsPath, 'utf8'), /# Dropout/);
});

test('first problem open activates native Markdown before checking its preview command', async t => {
  const externalCommands = [];
  let activations = 0;
  const markdownExtension = { async activate() {
    activations++;
    externalCommands.push('markdown.showPreviewToSide');
  } };
  const h = await harness(t, { externalCommands, markdownExtension });
  h.fixtures.get(DEFAULT_REF.slug).description = '## Requirements\n\nKeep $y_0$.\n\n$$\ns(y)=\\sum_{t=1}^{T} \\log P(y_t)\n$$';
  assert.ok(!(await h.vscode.commands.getCommands()).includes('markdown.showPreviewToSide'));
  const opened = await h.api.openProblem(DEFAULT_REF);
  assert.equal(activations, 1);
  const preview = h.commandExecutions.find(call => call.id === 'markdown.showPreviewToSide');
  assert.equal(preview.args[0].fsPath, opened.contextUri.fsPath);
  const markdown = await fs.readFile(opened.contextUri.fsPath, 'utf8');
  assert.match(markdown, /## Requirements/);
  assert.ok(markdown.includes('$y_0$'));
  assert.ok(markdown.includes('$$\ns(y)=\\sum_{t=1}^{T} \\log P(y_t)\n$$'));
  assert.equal(h.webviews.length, 0, 'first use must not silently select the unformatted fallback');
});

test('unavailable native Markdown clearly labels its inert plain-text fallback', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  assert.ok(opened.uri && opened.contextUri);
  const panel = h.webviews[0];
  assert.match(panel.webview.html, /Plain-text fallback/);
  assert.match(panel.webview.html, /Enable the built-in Markdown Language Features extension/);
  assert.equal(panel.options.enableScripts, false);
  assert.deepEqual(panel.options.localResourceRoots, []);
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.doesNotMatch(panel.webview.html, /<script|<iframe|<link\b/);
});

test('native Markdown activation or preview failure does not prevent opening a solution', async t => {
  for (const stage of ['activate', 'preview']) {
    await t.test(stage, async t => {
      const externalCommands = ['markdown.showPreviewToSide'];
      const h = await harness(t, { externalCommands, markdownExtension: { async activate() {
        if (stage === 'activate') throw new Error('UNTRUSTED_RENDERER_EXCEPTION');
      } } });
      const execute = h.vscode.commands.executeCommand;
      h.vscode.commands.executeCommand = async (id, ...args) => {
        if (id === 'markdown.showPreviewToSide') throw new Error('UNTRUSTED_RENDERER_EXCEPTION');
        return execute(id, ...args);
      };
      const opened = await h.api.openProblem(DEFAULT_REF);
      assert.ok(opened.uri && opened.testsUri && opened.contextUri);
      assert.match(h.webviews[0].webview.html, /Plain-text fallback/);
      assert.doesNotMatch(h.output.join('\n'), /UNTRUSTED_RENDERER_EXCEPTION/);
      assert.equal(h.errors.length, 0);
    });
  }
});

test('late native Markdown activation cannot show an older problem after newer navigation', async t => {
  let finishActivation, startedActivation;
  let count = 0;
  const started = new Promise(resolve => { startedActivation = resolve; });
  const externalCommands = [];
  const h = await harness(t, { externalCommands, markdownExtension: { async activate() {
    if (++count === 1) {
      startedActivation();
      await new Promise(resolve => { finishActivation = resolve; });
    } else externalCommands.push('markdown.showPreviewToSide');
  } } });
  const old = h.api.openProblem(DEFAULT_REF);
  await started;
  const current = await h.api.openProblem(SECOND_REF);
  finishActivation();
  assert.equal(await old, undefined);
  const previews = h.commandExecutions.filter(call => call.id === 'markdown.showPreviewToSide');
  assert.deepEqual(previews.map(call => call.args[0].fsPath), [current.contextUri.fsPath]);
  assert.equal(h.webviews.length, 0);
});

test('a recovered native preview disposes the previous degraded problem panel', async t => {
  const externalCommands = [];
  const h = await harness(t, { externalCommands });
  const opened = await h.api.openProblem(DEFAULT_REF);
  const fallback = h.webviews[0];
  externalCommands.push('markdown.showPreviewToSide');
  await h.commands.get('tensortonic.description')(opened.uri);
  assert.equal(fallback.disposed, true);
  assert.equal(h.commandExecutions.filter(call => call.id === 'markdown.showPreviewToSide').length, 1);
});

test('reconnecting while a grading command reads inputs cannot send code to a new session', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const openDocument = h.vscode.workspace.openTextDocument;
  let finishRead, reading;
  const started = new Promise(resolve => { reading = resolve; });
  h.vscode.workspace.openTextDocument = async uri => {
    const document = await openDocument(uri);
    if (uri.fsPath === opened.testsUri.fsPath) {
      reading();
      await new Promise(resolve => { finishRead = resolve; });
    }
    return document;
  };
  const running = h.commands.get('tensortonic.run')(opened.uri);
  await started;
  h.api.bridge.token = 'different-session';
  finishRead();
  assert.equal(await running, undefined);
  assert.equal(h.calls.run.length, 0);
  assert.match(h.errors.at(-1), /browser connection changed/);
});

test('companion connection writes a ticket only after explicit Copy and never creates a secret document', async t => {
  const h = await harness(t, { connected: false });
  assert.equal(await h.commands.get('tensortonic.connect')(), undefined);
  assert.equal(h.api.bridge.starts, 0);
  assert.deepEqual(h.clipboardWrites, []);
  h.informationChoices.push('Copy pairing code', undefined);
  assert.deepEqual(await h.commands.get('tensortonic.connect')(), { pairingRequested: true });
  assert.equal(h.api.bridge.starts, 1);
  assert.equal(h.api.bridge.pairings, 1);
  assert.deepEqual(h.clipboardWrites, ['TT1:43210:' + 'a'.repeat(32)]);
  assert.equal(h.documents.size, 0);
  assert.equal(h.output.some(line => /TT1:/.test(line)), false);
  assert.equal(h.information.some(args => args.some(value => typeof value === 'string' && value.includes('TT1:'))), false);
  assert.deepEqual(h.errors, []);
});

test('already connected and overlapping Connect gestures cannot rotate pairing or overwrite clipboard', async t => {
  const connected = await harness(t);
  await connected.commands.get('tensortonic.connect')();
  assert.equal(connected.api.bridge.pairings, 0);
  assert.deepEqual(connected.clipboardWrites, []);
  assert.match(connected.information[0][0], /already connected/);
  const h = await harness(t, { connected: false });
  let choose;
  h.informationChoices.push(new Promise(resolve => { choose = resolve; }));
  const first = h.commands.get('tensortonic.connect')();
  assert.equal(await h.commands.get('tensortonic.connect')(), undefined);
  assert.equal(h.information.length, 1);
  choose('Copy pairing code');
  await first;
  assert.equal(h.api.bridge.pairings, 1);
  assert.equal(h.clipboardWrites.length, 1);
});

test('companion setup guide is nonsecret and does not start pairing', async t => {
  const h = await harness(t, { connected: false });
  h.informationChoices.push('Companion setup');
  await h.commands.get('tensortonic.connect')();
  assert.equal(h.api.bridge.starts, 0);
  assert.deepEqual(h.clipboardWrites, []);
  assert.match(h.vscode.window.activeTextEditor.document.getText(), /no-console connection/);
  assert.deepEqual(h.errors, []);
});

test('Previous and Next follow the active solution plan and preserve unsaved work', async t => {
  const h = await harness(t);
  const first = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(first.uri);
  const cases = await h.vscode.workspace.openTextDocument(first.testsUri);
  const code = document.getText() + '\n# My unsaved work\n';
  const tests = '[{"id":"mine","inputs":{"x":42}}]';
  document.setText(code); cases.setText(tests);
  h.configuration.set('studyPlan', 'unrelated-sidebar-plan');
  const next = await h.commands.get('tensortonic.nextProblem')(first.uri);
  assert.equal(h.calls.list.at(-1), DEFAULT_REF.planId);
  assert.equal(next.problem.ref.slug, SECOND_REF.slug);
  const previous = await h.commands.get('tensortonic.previousProblem')(next.uri);
  assert.equal(previous.problem.ref.slug, DEFAULT_REF.slug);
  assert.equal(document.getText(), code);
  assert.equal(cases.getText(), tests);
  assert.equal(h.configuration.get('studyPlan'), 'unrelated-sidebar-plan', 'navigation must not silently change sidebar settings');
  assert.equal(h.calls.run.length + h.calls.submit.length, 0);
});

test('study-plan navigation has non-wrapping boundaries and handles missing current problems', async t => {
  const h = await harness(t);
  const first = await h.api.openProblem(DEFAULT_REF);
  let reads = h.calls.get.length;
  assert.equal(await h.commands.get('tensortonic.previousProblem')(first.uri), undefined);
  assert.equal(h.calls.get.length, reads);
  assert.match(h.information.at(-1)[0], /first problem/);
  const last = await h.api.openProblem(SECOND_REF);
  reads = h.calls.get.length;
  assert.equal(await h.commands.get('tensortonic.nextProblem')(last.uri), undefined);
  assert.equal(h.calls.get.length, reads);
  assert.match(h.information.at(-1)[0], /last problem/);
  h.api.client.listProblems = async () => [{ ...DEFAULT_REF, planId: 'other-plan' }];
  assert.equal(await h.commands.get('tensortonic.nextProblem')(last.uri), undefined);
  assert.match(h.information.at(-1)[0], /not found/);
  assert.equal(h.calls.get.length, reads);
});

test('free problem files have no study-plan navigation CodeLens or catalogue request', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(opened.uri);
  const provider = h.codeLens[0].provider;
  assert.ok(provider.provideCodeLenses(document).some(lens => lens.command.command === 'tensortonic.nextProblem'));
  document.setText('# tensortonic: {"slug":"free-problem"}\npass\n');
  assert.ok(!provider.provideCodeLenses(document).some(lens => /(?:previous|next)Problem/.test(lens.command.command)));
  const requests = h.calls.list.length;
  assert.equal(await h.commands.get('tensortonic.nextProblem')(document.uri), undefined);
  assert.equal(h.calls.list.length, requests);
  assert.match(h.information.at(-1)[0], /available for study-plan problems/);
});

test('late navigation responses cannot override a newer problem open or a changed connection', async t => {
  for (const interruption of ['navigation', 'connection']) {
    await t.test(interruption, async t => {
      const h = await harness(t);
      const opened = await h.api.openProblem(DEFAULT_REF);
      let finish, started;
      const waiting = new Promise(resolve => { started = resolve; });
      h.api.client.listProblems = async () => { started(); return new Promise(resolve => { finish = resolve; }); };
      const pending = h.commands.get('tensortonic.nextProblem')(opened.uri);
      await waiting;
      if (interruption === 'navigation') await h.api.openProblem(DEFAULT_REF);
      else h.api.bridge.token = 'new-session';
      const reads = h.calls.get.length;
      finish([DEFAULT_REF, SECOND_REF]);
      assert.equal(await pending, undefined);
      assert.equal(h.calls.get.length, reads);
      assert.ok(!h.commandExecutions.some(call => call.id === 'tensortonic.submit'));
    });
  }
});


test('late navigation errors do not interrupt a newer selection', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem(DEFAULT_REF);
  let reject, started;
  const waiting = new Promise(resolve => { started = resolve; });
  h.api.client.listProblems = async () => { started(); return new Promise((_, fail) => { reject = fail; }); };
  const pending = h.commands.get('tensortonic.nextProblem')(opened.uri);
  await waiting;
  await h.api.openProblem(SECOND_REF);
  reject(new Error('An older plan request failed'));
  assert.equal(await pending, undefined);
  assert.deepEqual(h.errors, []);
});


test('study navigation prefers API identity over a reused browser slug', async t => {
  const h = await harness(t);
  const opened = await h.api.openProblem({...DEFAULT_REF, apiId: 'stable-api-id'});
  const document = await h.vscode.workspace.openTextDocument(opened.uri);
  document.setText('# tensortonic: '+JSON.stringify({...DEFAULT_REF,apiId:'stable-api-id'})+'\npass\n');
  h.api.client.listProblems = async () => [
    {...DEFAULT_REF, apiId:'different-api-id'},
    {...DEFAULT_REF, slug:'renamed-browser-alias', apiId:'stable-api-id'},
    SECOND_REF,
  ];
  const next = await h.commands.get('tensortonic.nextProblem')(opened.uri);
  assert.equal(next.problem.ref.slug,SECOND_REF.slug);
  h.api.client.listProblems = async () => [{...DEFAULT_REF,apiId:'different-api-id'},SECOND_REF];
  assert.equal(await h.commands.get('tensortonic.nextProblem')(opened.uri),undefined);
  assert.match(h.information.at(-1)[0],/not found/);
});

test('Study plan tree exposes ordered sections, solved progress and clickable problems without Explorer changes', async t => {
  const h = await harness(t);
  await h.api.refresh();
  const view = h.trees[0], tree = view.options.treeDataProvider;
  const root = tree.getChildren()[0];
  assert.equal(root.label, 'PyTorch Sheet');
  assert.match(root.description, /1\s*\/\s*2/);
  const sections = tree.getChildren(root);
  assert.deepEqual(sections.map(item => item.label), ['Foundations', 'Training']);
  assert.equal(tree.getParent(sections[0]), root);
  const rows = problemRows(view);
  assert.equal(rows[0].iconPath.id, 'pass-filled');
  assert.equal(rows[1].iconPath.id, 'circle-outline');
  const first = await h.commands.get(rows[0].command.command)(...rows[0].command.arguments);
  const document = await h.vscode.workspace.openTextDocument(first.uri);
  const tests = await h.vscode.workspace.openTextDocument(first.testsUri);
  document.setText(document.getText()+'\n# Unsaved sidebar work\n');
  tests.setText('[{"id":"mine","inputs":{"x":0}}]');
  const code = document.getText(), cases = tests.getText();
  await h.commands.get(rows[1].command.command)(...rows[1].command.arguments);
  await h.commands.get(rows[0].command.command)(...rows[0].command.arguments);
  assert.equal(document.getText(),code);assert.equal(tests.getText(),cases);
  assert.deepEqual([...h.configuration.keys()],['studyPlan','solutionDirectory']);
  assert.equal(h.calls.run.length+h.calls.submit.length,0);
});

test('Current problem follows solution tabs and reveals only a visible Study plan view without stealing focus', async t => {
  const h = await harness(t);
  const view = h.trees[0], tree = view.options.treeDataProvider;
  view.setVisible(false);
  await h.api.refresh();
  const first = await h.api.openProblem(DEFAULT_REF);
  await flushReveals();
  assert.equal(view.reveals.length,0,'hidden sidebar must not be forced open');
  assert.match(tree.findProblem(DEFAULT_REF).description,/Current/);
  const selectedEditor = h.vscode.window.activeTextEditor;
  view.setVisible(true);
  await flushReveals();
  assert.equal(view.reveals.at(-1).item.problemRef.slug,DEFAULT_REF.slug);
  assert.deepEqual(view.reveals.at(-1).options,{select:true,focus:false,expand:true});
  assert.equal(h.vscode.window.activeTextEditor,selectedEditor);
  await h.api.openProblem(SECOND_REF);
  await flushReveals();
  assert.match(tree.findProblem(SECOND_REF).description,/Current/);
  assert.doesNotMatch(tree.findProblem(DEFAULT_REF).description,/Current/);
  await h.vscode.window.showTextDocument(await h.vscode.workspace.openTextDocument(first.uri));
  await flushReveals();
  assert.equal(view.reveals.at(-1).item.problemRef.slug,DEFAULT_REF.slug);
  const revealCount = view.reveals.length;
  const unrelated = await h.vscode.workspace.openTextDocument({language:'python',content:'# unrelated'});
  await h.vscode.window.showTextDocument(unrelated);
  await flushReveals();
  assert.equal(view.reveals.length,revealCount);
  assert.ok(!h.commandExecutions.some(call=>/focus|workbench\.view/.test(call.id)));
});

test('slow sidebar reveals finish on the newest selected problem and rejected reveals do not interrupt editing', async t => {
  const h = await harness(t);
  await h.api.refresh();
  const view = h.trees[0];
  let finishFirst;
  view.reveal = async (item,options) => {
    view.reveals.push({item,options});
    if(view.reveals.length===1) await new Promise(resolve=>{finishFirst=resolve;});
  };
  await h.api.openProblem(DEFAULT_REF);
  await h.api.openProblem(SECOND_REF);
  assert.equal(view.reveals.length,1);
  finishFirst();await flushReveals();
  assert.equal(view.reveals.at(-1).item.problemRef.slug,SECOND_REF.slug);
  view.reveal = async () => {throw new Error('view was closed');};
  await h.api.openProblem(DEFAULT_REF);await flushReveals();
  assert.deepEqual(h.errors,[]);
  assert.equal(h.vscode.window.activeTextEditor.document.getText().includes(DEFAULT_REF.slug),true);
});

test('plan selection replaces the section tree and does not highlight another plan with the same slug', async t => {
  const h = await harness(t);
  await h.api.refresh();
  await h.api.openProblem(DEFAULT_REF);
  h.vscode.window.showInputBox = async () => 'numpy-basics';
  h.api.client.listProblems = async planId => [{...DEFAULT_REF,planId,studyPlanTitle:'NumPy Sheet',section:{id:'arrays',title:'Arrays',order:1},title:'Another plan problem'}];
  await h.commands.get('tensortonic.chooseStudyPlan')();
  await flushReveals();
  const tree = h.trees[0].options.treeDataProvider;
  assert.equal(tree.getChildren()[0].label,'NumPy Sheet');
  assert.equal(tree.getChildren(tree.getChildren()[0])[0].label,'Arrays');
  assert.equal(tree.findProblem(DEFAULT_REF),undefined);
  assert.doesNotMatch(problemRows(h.trees[0])[0].description,/Current/);
  assert.equal(h.configuration.get('studyPlan'),'numpy-basics');
  assert.equal(h.vscode.window.activeTextEditor.document.getText().includes(DEFAULT_REF.planId),true);
});

test('refresh loading and failure cannot leave clickable rows from an older sidebar snapshot', async t => {
  const h = await harness(t);
  await h.api.refresh();
  const view = h.trees[0], tree = view.options.treeDataProvider;
  const previousRoot = tree.getChildren()[0];
  let fail;
  h.api.client.listProblems = async () => new Promise((_,reject)=>{fail=reject;});
  const refreshing = h.api.refresh();
  const loading = tree.getChildren()[0];
  assert.match(loading.label,/Loading/);assert.equal(loading.command,undefined);
  assert.deepEqual(tree.getChildren(previousRoot),[]);
  fail(new Error('Synthetic unavailable service'));
  await assert.rejects(refreshing,/unavailable/);
  assert.equal(problemRows(view).length,0);
  assert.match(view.message,/Could not load/);
  assert.equal(tree.getChildren()[0].command.command,'tensortonic.refresh');
});


test('only the explicit Show study plan command focuses its sidebar; Explorer settings remain unchanged', async t => {
  const h = await harness(t,{externalCommands:['tensortonicProblems.focus']});
  assert.equal(h.commandExecutions.length,0);
  await h.commands.get('tensortonic.showStudyPlan')();
  assert.equal(h.commandExecutions[0].id,'tensortonicProblems.focus');
  assert.equal(h.calls.list.length,1);
  assert.deepEqual([...h.configuration.keys()],['studyPlan','solutionDirectory']);
  h.api.bridge.connected=false;
  await h.commands.get('tensortonic.showStudyPlan')();
  assert.equal(h.calls.list.length,1,'disconnected sidebar shows connection action without an API request');
});


test('sidebar refresh updates solved progress while retaining the selected solution and unsaved content', async t => {
  const h = await harness(t);
  await h.api.refresh();
  const opened = await h.api.openProblem(SECOND_REF);
  const document = await h.vscode.workspace.openTextDocument(opened.uri);
  document.setText(document.getText()+'\n# keep progress refresh unsaved\n');
  const code = document.getText(), list = h.api.client.listProblems.bind(h.api.client);
  h.api.client.listProblems = async planId => (await list(planId)).map(ref=>({...ref,solved:true}));
  await h.api.refresh();await flushReveals();
  const tree = h.trees[0].options.treeDataProvider;
  assert.match(tree.getChildren()[0].description,/2\s*\/\s*2/);
  assert.equal(tree.findProblem(SECOND_REF).iconPath.id,'pass-filled');
  assert.match(tree.findProblem(SECOND_REF).description,/Current/);
  assert.equal(document.getText(),code);assert.equal(document.isDirty,true);
});


test('Start studying opens a dedicated folder in a new window without redirecting existing project files', async t => {
  const h = await harness(t,{externalCommands:['vscode.openFolder']});
  const { STUDY_FOLDER_KEY } = require('../src/study-workspace');
  const opened = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(opened.uri);
  document.setText(document.getText()+'\n# Original project stays unsaved\n');
  const code = document.getText(), editor = h.vscode.window.activeTextEditor;
  const studyRoot = path.join(h.root,'dedicated-study');await fs.mkdir(studyRoot);
  h.vscode.window.showOpenDialog = async options => {
    assert.equal(options.canSelectFolders,true);assert.equal(options.canSelectFiles,false);
    return [Uri.file(studyRoot)];
  };
  await h.commands.get('tensortonic.startStudying')();
  const action = h.commandExecutions.find(call=>call.id==='vscode.openFolder');
  assert.equal(action.args[0].fsPath,studyRoot);
  assert.deepEqual(action.args[1],{forceNewWindow:true});
  assert.equal(h.globalValues.get(STUDY_FOLDER_KEY),Uri.file(studyRoot).toString());
  assert.equal(h.vscode.workspace.workspaceFolders[0].uri.fsPath,h.root);
  assert.equal(h.vscode.window.activeTextEditor,editor);
  assert.equal(document.getText(),code);assert.equal(document.isDirty,true);
  assert.deepEqual(await fs.readdir(studyRoot),[],'Start must not create, move or copy problem files');
  const next = await h.api.openProblem(SECOND_REF);
  assert.equal(path.dirname(next.uri.fsPath),path.join(h.root,'tensortonic',DEFAULT_REF.planId));
  assert.deepEqual([...h.configuration.keys()],['studyPlan','solutionDirectory']);
  assert.equal(h.calls.run.length+h.calls.submit.length,0);
});

test('canceling first study-folder selection leaves extension storage and the current workspace unchanged', async t => {
  const h = await harness(t,{externalCommands:['vscode.openFolder']});
  await h.commands.get('tensortonic.startStudying')();
  assert.equal(h.globalValues.size,0);
  assert.equal(h.commandExecutions.length,0);
  assert.equal(h.vscode.workspace.workspaceFolders[0].uri.fsPath,h.root);
  assert.deepEqual(await fs.readdir(h.root),[]);
});

test('remembered folder alone cannot trigger startup navigation; explicit Start reuses the current study folder', async t => {
  const { STUDY_FOLDER_KEY } = require('../src/study-workspace');
  const h = await harness(t,{externalCommands:['vscode.openFolder','tensortonicProblems.focus'],
    globalStateForRoot:root=>new Map([[STUDY_FOLDER_KEY,Uri.file(root).toString()]])});
  assert.equal(h.commandExecutions.length,0);
  h.vscode.window.showOpenDialog = async () => {throw new Error('Remembered valid folder must not prompt again');};
  await h.commands.get('tensortonic.startStudying')();
  assert.ok(h.commandExecutions.some(call=>call.id==='tensortonicProblems.focus'));
  assert.ok(!h.commandExecutions.some(call=>call.id==='vscode.openFolder'));
  assert.equal(h.vscode.workspace.workspaceFolders[0].uri.fsPath,h.root);
});

test('a recent matching Start request restores only the new study sidebar, never opens another window', async t => {
  const { STUDY_FOLDER_KEY, PENDING_STUDY_VIEW_KEY } = require('../src/study-workspace');
  const nonce = require('node:crypto').randomUUID();
  const h = await harness(t,{connected:false,externalCommands:['vscode.openFolder','tensortonicProblems.focus'],
    globalStateForRoot:root=>new Map([
      [STUDY_FOLDER_KEY,Uri.file(root).toString()],
      [PENDING_STUDY_VIEW_KEY,{uri:Uri.file(root).toString(),createdAt:Date.now(),nonce}],
    ])});
  assert.equal(h.commandExecutions.filter(call=>call.id==='tensortonicProblems.focus').length,1);
  assert.ok(!h.commandExecutions.some(call=>call.id==='vscode.openFolder'));
  assert.equal(h.globalValues.get(PENDING_STUDY_VIEW_KEY).nonce,nonce,'startup must not erase shared handoff state');
  assert.equal(h.api.bridge.starts,0,'restoring a view must not start authentication/pairing');
  assert.equal(h.calls.list.length,0,'a fresh unpaired study window must not request account data');
});

test('interactive explanation is explicit, offline, isolated, and does not touch statement/solution/network',async t=>{
 const h=await harness(t,{connected:false});const command=h.commands.get('tensortonic.offlineExploration');
 const result=await command(DEFAULT_REF);assert.equal(result.cardId,'training-loop');assert.equal(result.supported,true);
 const panel=h.webviews[0];assert.equal(panel.type,'tensortonic.explanation');assert.deepEqual(panel.options,{enableScripts:true,localResourceRoots:[]});assert.match(panel.webview.html,/data-card="training-loop"/);
 assert.deepEqual(h.calls,{list:[],get:[],run:[],submit:[]});assert.deepEqual(await fs.readdir(h.root),[]);
 await command({slug:'pytorch-softmax-from-scratch',planId:'pytorch-basics'});assert.equal(h.webviews.length,1);assert.match(panel.webview.html,/data-card="softmax"/);
 panel.dispose();await command(DEFAULT_REF);assert.equal(h.webviews.length,2);panel.dispose();await command(DEFAULT_REF);assert.equal(h.webviews.length,2,'late old disposal cannot clear replacement');
});
test('unsupported explanation is honest, inert, and refuses misleading aliases',async t=>{
 const h=await harness(t);const result=await h.commands.get('tensortonic.offlineExploration')({...DEFAULT_REF,apiId:'unknown'});
 assert.equal(result.supported,false);assert.match(h.webviews[0].webview.html,/not a completed interactive card/);assert.doesNotMatch(h.webviews[0].webview.html,/<script/);assert.deepEqual(h.calls.get,[]);
});
test('explanation is discoverable from code lens and sidebar and remains usable from generated context',async t=>{
 const h=await harness(t);const opened=await h.api.openProblem(DEFAULT_REF);const document=await h.vscode.workspace.openTextDocument(opened.uri);
 const lenses=h.codeLens[0].provider.provideCodeLenses(document);assert.ok(lenses.some(l=>l.command.command==='tensortonic.interactiveExplanation'));
 const manifest=JSON.parse(await fs.readFile(path.resolve(__dirname,'../package.json'),'utf8'));assert.ok(manifest.contributes.menus['view/item/context'].some(m=>m.command==='tensortonic.offlineExploration'));
 assert.match(await fs.readFile(opened.contextUri.fsPath,'utf8'),/Interactive explanation/);
 await h.vscode.window.showTextDocument(await h.vscode.workspace.openTextDocument(opened.contextUri));
 const count=h.calls.get.length;assert.equal((await h.commands.get('tensortonic.offlineExploration')()).cardId,'training-loop');assert.equal(h.calls.get.length,count);
});
test('newer explanation wins over slow local metadata reads',async t=>{
 const h=await harness(t);const opened=await h.api.openProblem(DEFAULT_REF);const original=h.vscode.workspace.openTextDocument;
 let finish;h.vscode.workspace.openTextDocument=async uri=>{await new Promise(resolve=>{finish=resolve;});return original(uri);};
 const command=h.commands.get('tensortonic.offlineExploration');const older=command(opened.uri);await command({slug:'pytorch-softmax-from-scratch',planId:'pytorch-basics'});finish();await older;
 const panels=h.webviews.filter(p=>p.type==='tensortonic.explanation');assert.equal(panels.length,1);assert.match(panels[0].webview.html,/data-card="softmax"/);
});
test('navigation and disconnect invalidate pending explanations without stale errors',async t=>{
 const h=await harness(t);const opened=await h.api.openProblem(DEFAULT_REF);const original=h.vscode.workspace.openTextDocument;
 let reject;h.vscode.workspace.openTextDocument=()=>new Promise((_,r)=>{reject=r;});
 const pending=h.commands.get('tensortonic.offlineExploration')(opened.uri);await h.commands.get('tensortonic.disconnect')();reject(new Error('stale metadata failure'));await pending;
 assert.deepEqual(h.errors,[]);assert.equal(h.webviews.filter(p=>p.type==='tensortonic.explanation').length,0);
 h.vscode.workspace.openTextDocument=original;
 assert.equal((await h.commands.get('tensortonic.offlineExploration')(DEFAULT_REF)).supported,true,'new explicit offline request works after disconnect');
});
test('closing the card or navigating to a newer problem cancels a pending card open',async t=>{
 const h=await harness(t);const opened=await h.api.openProblem(DEFAULT_REF);const command=h.commands.get('tensortonic.offlineExploration');await command(DEFAULT_REF);const panel=h.webviews.find(p=>p.type==='tensortonic.explanation');
 const original=h.vscode.workspace.openTextDocument;let finish;h.vscode.workspace.openTextDocument=async uri=>{await new Promise(r=>{finish=r;});return original(uri);};
 const pending=command(opened.uri);panel.dispose();finish();await pending;assert.equal(h.webviews.filter(p=>p.type==='tensortonic.explanation').length,1);
 const pending2=command(opened.uri);h.vscode.workspace.openTextDocument=original;await h.api.openProblem(SECOND_REF);finish();await pending2;assert.equal(h.webviews.filter(p=>p.type==='tensortonic.explanation').length,1);assert.deepEqual(h.errors,[]);
});

test('primary explanation opens the live original page via native browser only after an explicit gesture',async t=>{
 const native='workbench.action.browser.open';const h=await harness(t,{connected:false,externalCommands:[native]});
 assert.deepEqual(h.commandExecutions,[]);const command=h.commands.get('tensortonic.interactiveExplanation');
 const result=await command({slug:'pytorch-softmax-from-scratch',planId:'pytorch-basics'});
 assert.deepEqual(result,{ref:{slug:'pytorch-softmax-from-scratch',planId:'pytorch-basics'},target:'integrated',requested:true});
 const url='https://www.tensortonic.com/problems/pytorch-softmax-from-scratch?studyPlan=pytorch-basics';
 assert.deepEqual(h.commandExecutions,[{id:native,args:[{url,openToSide:true,reuseUrlFilter:url}],activeDocument:undefined}]);
 assert.equal(h.webviews.length,0);assert.deepEqual(h.calls,{list:[],get:[],run:[],submit:[]});assert.deepEqual(await fs.readdir(h.root),[]);
 await h.commands.get('tensortonic.openOriginalInVSCode')({slug:'another-problem',planId:'another-plan'});
 assert.equal(h.commandExecutions[1].args[0].url,'https://www.tensortonic.com/problems/another-problem?studyPlan=another-plan');
 assert.equal(h.commandExecutions[1].args[0].reuseUrlFilter,h.commandExecutions[1].args[0].url);
});
test('native URL/filter never accept arbitrary destinations, glob metacharacters or downloaded fields',async t=>{
 const native='workbench.action.browser.open';const h=await harness(t,{externalCommands:[native]});const command=h.commands.get('tensortonic.interactiveExplanation');
 for(const ref of [{slug:'https://evil.example'},{slug:'../auth'},{slug:'problem*'},{slug:'valid',planId:'x?redirect=evil'}])await command(ref);
 assert.equal(h.commandExecutions.length,0);assert.equal(h.errors.length,4);
 await command({...DEFAULT_REF,url:'https://evil.example',reuseUrlFilter:'**',visualizationComponent:'evil'});
 assert.equal(h.commandExecutions[0].args[0].url,'https://www.tensortonic.com/problems/pytorch-mini-training?studyPlan=pytorch-basics');
});
test('missing native browser offers an explicit external choice; cancel never launches anything',async t=>{
 const h=await harness(t,{connected:false,externalCommands:[]});let opened=[];h.vscode.env.openExternal=async uri=>{opened.push(uri.toString());return true;};
 const command=h.commands.get('tensortonic.interactiveExplanation');assert.equal((await command(DEFAULT_REF)).target,'none');assert.deepEqual(opened,[]);
 assert.match(h.information[0][0],/sessions are separate/);h.informationChoices.push('Open in external browser');assert.equal((await command(DEFAULT_REF)).target,'external');
 assert.deepEqual(opened,['https://www.tensortonic.com/problems/pytorch-mini-training?studyPlan=pytorch-basics']);assert.equal(h.webviews.length,0);
});
test('failed native dispatch is not replayed and requires a user choice for external fallback',async t=>{
 const native='workbench.action.browser.open';const h=await harness(t,{externalCommands:[native]});const execute=h.vscode.commands.executeCommand;let attempts=0,external=0;
 h.vscode.commands.executeCommand=async(id,...args)=>{if(id===native){attempts++;throw new Error('unavailable');}return execute(id,...args);};h.vscode.env.openExternal=async()=>{external++;return true;};
 const result=await h.commands.get('tensortonic.interactiveExplanation')(DEFAULT_REF);assert.equal(result.target,'none');assert.equal(attempts,1);assert.equal(external,0);assert.deepEqual(h.errors,[]);
});
test('newer native request supersedes older command discovery; disconnect cancels stale fallback',async t=>{
 const native='workbench.action.browser.open';const h=await harness(t,{externalCommands:[native]});const command=h.commands.get('tensortonic.interactiveExplanation');const get=h.vscode.commands.getCommands;
 let finish,started;const waiting=new Promise(r=>{started=r;});h.vscode.commands.getCommands=async()=>{started();await new Promise(r=>{finish=r;});return[native];};
 const pending=command(DEFAULT_REF);await waiting;h.vscode.commands.getCommands=get;await command({slug:'second',planId:'pytorch-basics'});finish();await pending;
 assert.equal(h.commandExecutions.filter(c=>c.id===native).length,1);assert.match(h.commandExecutions.find(c=>c.id===native).args[0].url,/\/second\?/);
 h.vscode.commands.getCommands=async()=>[];let choose,prompted;const shown=new Promise(r=>{prompted=r;});h.vscode.window.showInformationMessage=async()=>{prompted();return new Promise(r=>{choose=r;});};let external=0;h.vscode.env.openExternal=async()=>{external++;return true;};
 const fallback=command(DEFAULT_REF);await shown;await h.commands.get('tensortonic.disconnect')();choose('Open in external browser');await fallback;assert.equal(external,0);
});
test('ordinary problem opening and next navigation never open original pages automatically',async t=>{
 const native='workbench.action.browser.open';const h=await harness(t,{externalCommands:[native]});await h.api.openProblem(DEFAULT_REF);await h.commands.get('tensortonic.nextProblem')();
 assert.equal(h.commandExecutions.filter(c=>c.id===native).length,0);assert.equal(h.webviews.some(p=>p.type==='tensortonic.explanation'),false);
 const manifest=JSON.parse(await fs.readFile(path.resolve(__dirname,'../package.json'),'utf8'));assert.equal(manifest.contributes.commands.find(c=>c.command==='tensortonic.offlineExploration').title,'Offline learning exploration');
});

test('Web preference opens canonical page beside existing solution and reuses only the previous study URL', async t => {
  const native = 'workbench.action.browser.open';
  const h = await harness(t, { externalCommands: [native] });
  h.configuration.set('problemView', 'web');
  assert.equal(h.commandExecutions.length, 0, 'configuration alone never opens a page');
  const first = await h.api.openProblem(SECOND_REF);
  const document = await h.vscode.workspace.openTextDocument(first.uri);
  document.setText(document.getText().replace('    pass', '    return x # UNSAVED_STUDY'));
  const dirty = document.getText();
  const firstCall = h.commandExecutions.find(call => call.id === native);
  const firstUrl = 'https://www.tensortonic.com/problems/pytorch-dropout?studyPlan=pytorch-basics';
  assert.deepEqual(firstCall.args[0], { url: firstUrl, openToSide: true, reuseUrlFilter: firstUrl });
  assert.strictEqual(firstCall.activeDocument, document);
  await h.commands.get('tensortonic.previousProblem')();
  const pages = h.commandExecutions.filter(call => call.id === native);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].args[0].url, 'https://www.tensortonic.com/problems/pytorch-mini-training?studyPlan=pytorch-basics');
  assert.equal(pages[1].args[0].reuseUrlFilter, firstUrl);
  assert.equal(document.getText(), dirty);
  assert.equal(document.isDirty, true);
  assert.equal(h.webviews.some(panel => panel.type === 'tensortonic.description'), false);
  assert.equal(h.calls.run.length + h.calls.submit.length, 0);
});

test('Web preference falls back locally to Markdown when native browser is unavailable without external launch', async t => {
  const h = await harness(t, { externalCommands: [] });
  h.configuration.set('problemView', 'web');
  let external = 0; h.vscode.env.openExternal = async () => { external++; return true; };
  const result = await h.api.openProblem(DEFAULT_REF);
  assert.ok(result.uri);
  assert.equal(h.webviews.filter(panel => panel.type === 'tensortonic.description').length, 1);
  assert.match(h.information.at(-1)[0], /Showing Markdown instead/);
  assert.equal(h.configuration.get('problemView'), 'web');
  assert.equal(external, 0);
});

test('Web preference keeps explicit Description as Markdown and returning to Markdown stops native requests', async t => {
  const native = 'workbench.action.browser.open';
  const h = await harness(t, { externalCommands: [native] });
  h.configuration.set('problemView', 'web');
  const first = await h.api.openProblem(DEFAULT_REF);
  await h.commands.get('tensortonic.description')(first.uri);
  assert.ok(h.webviews.some(panel => panel.type === 'tensortonic.description'));
  assert.equal(h.commandExecutions.filter(call => call.id === native).length, 1);
  h.configuration.set('problemView', 'markdown');
  await h.commands.get('tensortonic.nextProblem')();
  assert.equal(h.commandExecutions.filter(call => call.id === native).length, 1);
});

test('Choose problem view saves only requested preference and does not reopen or rewrite dirty solutions', async t => {
  const native = 'workbench.action.browser.open';
  const h = await harness(t, { externalCommands: [native] });
  const first = await h.api.openProblem(DEFAULT_REF);
  const document = await h.vscode.workspace.openTextDocument(first.uri);
  document.setText(document.getText() + '# UNSAVED_VIEW_CHOICE\n');
  const before = document.getText(); const getCount = h.calls.get.length;
  h.vscode.window.showQuickPick = async items => items.find(item => item.mode === 'web');
  const updates = []; const getConfig = h.vscode.workspace.getConfiguration;
  h.vscode.workspace.getConfiguration = (...args) => {
    const config = getConfig(...args); const update = config.update;
    return { ...config, update: async (...values) => { updates.push(values); return update(...values); } };
  };
  await h.commands.get('tensortonic.chooseProblemView')();
  assert.deepEqual(updates, [['problemView', 'web', h.vscode.ConfigurationTarget.Workspace]]);
  assert.equal(document.getText(), before); assert.equal(document.isDirty, true);
  assert.equal(h.calls.get.length, getCount);
  assert.equal(h.commandExecutions.filter(call => call.id === native).length, 0);
  h.vscode.window.showQuickPick = async () => undefined;
  await h.commands.get('tensortonic.chooseProblemView')(); assert.equal(updates.length, 1);
});

test('Web preference never dispatches a stale page after mode changes during native command discovery', async t => {
  const native = 'workbench.action.browser.open';
  const h = await harness(t, { externalCommands: [native] });
  h.configuration.set('problemView', 'web');
  let release, announce;
  const started = new Promise(resolve => { announce = resolve; });
  h.vscode.commands.getCommands = async () => { announce(); await new Promise(resolve => { release = resolve; }); return [native]; };
  const opening = h.api.openProblem(DEFAULT_REF); await started;
  h.configuration.set('problemView', 'markdown'); release(); await opening;
  assert.equal(h.commandExecutions.filter(call => call.id === native).length, 0);
});

test('problem view setting is discoverable, bounded, Markdown by default, and cannot inject URLs', async t => {
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8'));
  const setting = manifest.contributes.configuration.properties['tensortonic.problemView'];
  assert.equal(setting.default, 'markdown'); assert.deepEqual(setting.enum, ['markdown', 'web']);
  assert.equal(setting.scope, 'window');
  assert.ok(manifest.contributes.menus['view/title'].some(item => item.command === 'tensortonic.chooseProblemView'));
  const native = 'workbench.action.browser.open'; const h = await harness(t, { externalCommands: [native] });
  h.configuration.set('problemView', 'https://evil.example');
  await h.api.openProblem(DEFAULT_REF);
  assert.equal(h.commandExecutions.filter(call => call.id === native).length, 0);
  assert.ok(h.webviews.some(panel => panel.type === 'tensortonic.description'));
});

function nativeUiFixture() {
  return { connected: false, token: undefined, starts: 0, pages: [], stops: 0,
    async start() { this.starts++; this.connected = true; this.token = 'owned-native-fixture'; this.onDidChange?.(); },
    async stop() { this.stops++; this.connected = false; this.token = undefined; this.onDidChange?.(); },
    async shutdown() { return this.stop(); }, async revoke() { return this.stop(); },
    async openProblemPage(url) { this.pages.push(url); }, async request() { throw new Error('Unexpected direct transport request'); },
  };
}
test('native mode is inert on activation and explicit Connect never creates/copies companion pairing code', async t => {
  const native = nativeUiFixture(); const h = await harness(t, { connectionMode: 'native', nativeTransport: native });
  assert.equal(native.starts, 0); assert.deepEqual(h.clipboardWrites, []);
  h.informationChoices.push('Connect built-in browser');
  await h.commands.get('tensortonic.connect')();
  assert.equal(native.starts, 1); assert.equal(h.api.bridge.mode, 'native'); assert.equal(h.api.bridge.connected, true);
  assert.deepEqual(h.clipboardWrites, []); assert.ok(h.calls.list.length > 0);
  assert.ok(h.information.some(x => JSON.stringify(x).includes('No pairing code')));
});
test('native Connect and reconnect log guidance without a post-launch notification that pauses login', async t => {
  const native = nativeUiFixture(); const h = await harness(t, { connectionMode: 'native', nativeTransport: native });
  h.informationChoices.push('Connect built-in browser');
  await h.commands.get('tensortonic.connect')();
  assert.equal(h.information.length, 1, 'only the pre-launch consent is shown');
  assert.ok(h.output.some(line => line.includes('Sign in normally on the dedicated page')));
  await h.commands.get('tensortonic.connect')();
  assert.equal(h.information.length, 1, 'reconnect must not pause the browser with another notification');
  assert.equal(h.output.filter(line => line.includes('TensorTonic browser connected.')).length, 2);
});
test('canceling native Connect does not launch a browser or affect an unrelated legacy transport', async t => {
  const native = nativeUiFixture(); const h = await harness(t, { connectionMode: 'native', nativeTransport: native });
  await h.commands.get('tensortonic.connect')(); assert.equal(native.starts, 0);
  assert.deepEqual(h.clipboardWrites, []); assert.deepEqual(h.errors, []);
});
test('native Web mode uses the owned browser page and never dispatches a broad browser open command', async t => {
  const native = nativeUiFixture(); const h = await harness(t, { connectionMode: 'native', nativeTransport: native });
  await native.start(); h.configuration.set('problemView', 'web');
  const opened = await h.api.openProblem(DEFAULT_REF); assert.ok(opened.uri);
  assert.equal(native.pages.length, 1); assert.match(native.pages[0], /^https:\/\/www\.tensortonic\.com\/problems\//);
  assert.ok(!h.commandExecutions.some(x => x.id === 'workbench.action.browser.open'));
});
test('native connection selection is explicit and does not automatically start chosen legacy connection', async t => {
  const native = nativeUiFixture(); const h = await harness(t, { connectionMode: 'native', nativeTransport: native });
  await native.start(); h.vscode.window.showQuickPick = async () => ({ mode: 'browserCompanion' });
  await h.commands.get('tensortonic.chooseConnectionMode')();
  assert.equal(h.api.bridge.mode, 'browserCompanion'); assert.ok(native.stops > 0);
  assert.equal(h.api.bridge.starts, 0); assert.deepEqual(h.clipboardWrites, []);
});
