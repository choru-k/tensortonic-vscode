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

async function harness(t, { connected = true, externalCommands = ['workbench.action.chat.open', 'chatgpt.addFileToThread', 'chatgpt.openSidebar'] } = {}) {
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
  const tools = new Map();
  const commandExecutions = [];
  const configuration = new Map([['studyPlan', 'pytorch-basics'], ['solutionDirectory', 'tensortonic']]);
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
    Uri, EventEmitter, WorkspaceEdit,
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
    lm: { registerTool(name, tool) { tools.set(name, tool); return { dispose() { tools.delete(name); } }; } },
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
  return { root, extension, api, vscode, documents, commands, contexts, webviews, errors, output, statuses, trees, codeLens, calls, fixtures, configuration, tools, commandExecutions };
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
  assert.match(options.query, /저장하지 않은 변경/);
  assert.match(options.query, /한 번에 한 단계/);
  assert.match(options.query, /요청하기 전에는 완성된 정답/);
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
