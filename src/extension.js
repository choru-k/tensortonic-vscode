'use strict';

const vscode = require('vscode');
const crypto = require('node:crypto');
const { TensorTonicClient } = require('./client');
const { BrowserBridge } = require('./bridge');
const { buildProblemMarkdown, buildDiscussionPrompt, formatAgentContext } = require('./context');

const COMMANDS = [
  'connect', 'disconnect', 'openProblem', 'search', 'refresh', 'run', 'submit',
  'description', 'openTests', 'openInBrowser', 'chooseStudyPlan', 'smokeTest',
  'openAgentContext', 'discussWithAgent', 'discussWithCodex',
].map(name => `tensortonic.${name}`);
const VIEW_ID = 'tensortonicProblems';
const METADATA_PATTERN = /^(?:#|\/\/|--)\s*tensortonic:\s*(\{[^\r\n]*\})\s*$/m;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/i;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function htmlToText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) || '';
  return text
    .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|pre|blockquote|tr|ul|ol)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, entity => ({
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
      '&quot;': '"', '&apos;': "'", '&#39;': "'",
    }[entity]))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, number) => {
      const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function normalizeRef(value) {
  const original = value && value.problemRef ? value.problemRef : value;
  const ref = typeof original === 'string' ? { slug: original } : original;
  if (!ref || typeof ref.slug !== 'string' || !SLUG_PATTERN.test(ref.slug)) {
    throw new Error('Select a TensorTonic problem or open a solution created by this extension.');
  }
  const result = { slug: ref.slug };
  if (ref.apiId != null) {
    if (typeof ref.apiId !== 'string' || !SLUG_PATTERN.test(ref.apiId)) throw new Error('Invalid TensorTonic API problem id.');
    result.apiId = ref.apiId;
  }
  if (ref.planId != null && ref.planId !== '') {
    if (typeof ref.planId !== 'string' || !SLUG_PATTERN.test(ref.planId)) {
      throw new Error('The study plan must be a TensorTonic study-plan slug, such as pytorch-basics.');
    }
    result.planId = ref.planId;
  }
  if (typeof ref.technology === 'string') result.technology = ref.technology.slice(0, 80);
  return result;
}

function readRef(text) {
  const match = String(text).split('\n').slice(0, 8).join('\n').match(METADATA_PATTERN);
  if (!match) throw new Error('This file has no TensorTonic metadata. Open a problem from the TensorTonic sidebar first.');
  try {
    return normalizeRef(JSON.parse(match[1]));
  } catch (error) {
    throw new Error(`Invalid TensorTonic metadata: ${error.message}`);
  }
}

function problemUrl(value) {
  const ref = normalizeRef(value);
  return `https://www.tensortonic.com/problems/${encodeURIComponent(ref.slug)}` +
    (ref.planId ? `?studyPlan=${encodeURIComponent(ref.planId)}` : '');
}

function fileSettings(ref) {
  const technology = (ref.technology || '').toLowerCase();
  if (technology.includes('sql')) return { extension: 'sql', comment: '--' };
  if (technology.includes('cuda')) return { extension: 'cu', comment: '//' };
  if (technology === 'cpp' || technology === 'c++') return { extension: 'cpp', comment: '//' };
  return { extension: 'py', comment: '#' };
}

function testsUriFor(uri) {
  return uri.with({ path: uri.path.replace(/\.[^/.]+$/, '') + '.tests.json' });
}

function contextUriFor(uri) {
  return uri.with({ path: uri.path.replace(/\.[^/.]+$/, '') + '.problem.md' });
}

const CONTEXT_MARKER = '<!-- TensorTonic generated problem context -->';
const contextHash = text => crypto.createHash('sha256').update(text).digest('hex');

function buildHtml(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>${escapeHtml(title)}</title><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px 28px;max-width:960px;line-height:1.6}
h1{font-size:24px;line-height:1.3}h2{font-size:17px;margin-top:28px}.meta{color:var(--vscode-descriptionForeground)}
a{color:var(--vscode-textLink-foreground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;border:1px solid var(--vscode-panel-border);border-radius:6px;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}
.statement{white-space:pre-wrap;overflow-wrap:anywhere}.notice{border-left:3px solid var(--vscode-focusBorder);padding:8px 14px;background:var(--vscode-textBlockQuote-background)}
</style></head><body>${body}</body></html>`;
}

class ProblemTreeProvider {
  constructor(state) {
    this.state = state;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  dispose() { this.emitter.dispose(); }
  refresh() { this.emitter.fire(undefined); }
  getTreeItem(element) { return element; }
  getChildren(element) {
    if (element) return [];
    if (!this.state.bridge.connected) {
      const item = new vscode.TreeItem('Connect your TensorTonic browser tab');
      item.command = { command: 'tensortonic.connect', title: 'Connect browser' };
      item.iconPath = new vscode.ThemeIcon('plug');
      return [item];
    }
    if (!this.state.problems.length) {
      const item = new vscode.TreeItem(this.state.loading ? 'Loading problems…' : 'Refresh problems');
      item.command = { command: 'tensortonic.refresh', title: 'Refresh problems' };
      item.iconPath = new vscode.ThemeIcon('refresh');
      return [item];
    }
    return this.state.problems.map(problem => {
      const item = new vscode.TreeItem(problem.title || problem.slug, vscode.TreeItemCollapsibleState.None);
      item.problemRef = problem;
      item.id = `${problem.planId || ''}/${problem.slug}`;
      item.description = [problem.difficulty, problem.technology].filter(Boolean).join(' · ');
      item.tooltip = [problem.title || problem.slug, problem.planId ? `Study plan: ${problem.planId}` : '', problem.difficulty || ''].filter(Boolean).join('\n');
      item.contextValue = 'tensortonicProblem';
      item.iconPath = new vscode.ThemeIcon(problem.solved ? 'pass-filled' : 'circle-outline');
      item.command = { command: 'tensortonic.openProblem', title: 'Open problem', arguments: [problem] };
      return item;
    });
  }
}

class SolutionCodeLensProvider {
  provideCodeLenses(document) {
    try {
      readRef(document.getText());
    } catch (_) {
      return [];
    }
    const range = new vscode.Range(0, 0, 0, 0);
    return ['run', 'submit', 'description', 'openTests', 'discussWithAgent'].map(name => new vscode.CodeLens(range, {
      title: { run: 'Run', submit: 'Submit', description: 'Description', openTests: 'Test cases', discussWithAgent: 'Discuss with Agent' }[name],
      command: `tensortonic.${name}`,
      arguments: [document.uri],
    }));
  }
}

async function fileExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error && error.code === 'FileNotFound') return false;
    throw error;
  }
}

// WorkspaceEdit's overwrite:false also protects against a file appearing after stat().
async function createTextFile(uri, content) {
  if (await fileExists(uri)) return false;
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
  edit.insert(uri, new vscode.Position(0, 0), content);
  if (!await vscode.workspace.applyEdit(edit)) {
    if (await fileExists(uri)) return false;
    throw new Error(`Could not create ${uri.fsPath || uri.path}.`);
  }
  const document = await vscode.workspace.openTextDocument(uri);
  if (!await document.save()) throw new Error(`Could not save ${uri.fsPath || uri.path}.`);
  return true;
}

function activate(context) {
  const bridge = new BrowserBridge();
  const client = new TensorTonicClient((path, options) => bridge.request(path, options));
  const state = { bridge, problems: [], loading: false, lastSolutionUri: undefined, statementPanel: undefined, resultsPanel: undefined, currentProblem: undefined };
  const tree = new ProblemTreeProvider(state);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'tensortonic.connect';
  status.show();
  const output = vscode.window.createOutputChannel('TensorTonic');
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: false });
  context.subscriptions.push(tree, status, output, treeView);

  function getPlanId() {
    const value = vscode.workspace.getConfiguration('tensortonic').get('studyPlan', 'pytorch-basics');
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
      throw new Error('Set tensortonic.studyPlan to a study-plan slug such as pytorch-basics, or leave it empty for free problems.');
    }
    return value;
  }

  function updateConnection() {
    status.text = bridge.connected ? '$(check) TensorTonic' : '$(plug) TensorTonic';
    status.tooltip = bridge.connected ? 'TensorTonic browser connected' : 'Connect a signed-in TensorTonic browser tab';
    status.command = bridge.connected ? 'tensortonic.search' : 'tensortonic.connect';
    tree.refresh();
    vscode.commands.executeCommand('setContext', 'tensortonic.connected', bridge.connected);
  }
  updateConnection();
  bridge.onDidChange = () => {
    updateConnection();
    if (bridge.connected) refresh().catch(showError);
  };

  function showError(error) {
    const message = error && error.message ? error.message : String(error);
    output.appendLine(message);
    vscode.window.showErrorMessage(`TensorTonic: ${message}`);
  }

  function requireConnection() {
    if (!bridge.connected) throw new Error('Connect a signed-in TensorTonic browser tab using “TensorTonic: Connect browser” first.');
  }

  async function refresh() {
    requireConnection();
    state.loading = true;
    tree.refresh();
    try {
      const problems = await client.listProblems(getPlanId());
      if (!Array.isArray(problems)) throw new Error('TensorTonic returned an unexpected problem list.');
      state.problems = problems.filter(problem => {
        try { normalizeRef(problem); return true; } catch (_) { return false; }
      });
      treeView.description = getPlanId() || 'Free problems';
      treeView.message = state.problems.length ? undefined : 'No problems found. Try another study plan or refresh.';
      return state.problems;
    } finally {
      state.loading = false;
      tree.refresh();
    }
  }

  async function chooseStudyPlan() {
    const chosen = await vscode.window.showInputBox({
      title: 'TensorTonic study plan',
      prompt: 'Enter the studyPlan value from a TensorTonic problem URL. Leave empty for free problems.',
      value: getPlanId() || '',
      placeHolder: 'pytorch-basics',
      validateInput: value => value === '' || SLUG_PATTERN.test(value) ? undefined : 'Use a study-plan slug, such as pytorch-basics.',
    });
    if (chosen === undefined) return;
    const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('tensortonic').update('studyPlan', chosen, target);
    state.problems = [];
    tree.refresh();
    if (bridge.connected) await refresh();
  }

  async function connect() {
    await bridge.start();
    if (bridge.connected) {
      await refresh();
      return vscode.window.showInformationMessage('TensorTonic browser is connected.');
    }
    const content = [
      '// Connect TensorTonic to VS Code',
      '// 1. Open https://www.tensortonic.com in your browser and sign in normally.',
      '// 2. Open Developer Tools → Console on that TensorTonic tab.',
      '// 3. Paste and run the connection code below. Keep the tab open.',
      '// This code forwards only TensorTonic API requests through your own signed-in tab.',
      '// Your login cookies stay in the browser. Do not share this connection code.',
      '// If your browser asks about local-network access, allow it for this connection.',
      '',
      bridge.connectionCode(),
      '',
    ].join('\n');
    const document = await vscode.workspace.openTextDocument({ language: 'javascript', content });
    await vscode.window.showTextDocument(document, { preview: false });
    const chosen = await vscode.window.showInformationMessage('Run the connection code in the Console of your signed-in TensorTonic tab. Keep that tab open.', 'Open TensorTonic');
    if (chosen === 'Open TensorTonic') await vscode.env.openExternal(vscode.Uri.parse('https://www.tensortonic.com/'));
  }

  async function disconnect() {
    await bridge.stop();
    state.problems = [];
    updateConnection();
  }

  async function search() {
    requireConnection();
    if (!state.problems.length) await refresh();
    const selected = await vscode.window.showQuickPick(state.problems.map(problem => ({
      label: `${problem.solved ? '$(check) ' : ''}${problem.title || problem.slug}`,
      description: [problem.difficulty, problem.technology].filter(Boolean).join(' · '),
      detail: problem.slug,
      problemRef: problem,
    })), { title: 'TensorTonic problems', placeHolder: 'Search problems by title or slug', matchOnDescription: true, matchOnDetail: true });
    if (selected) return openProblem(selected.problemRef);
  }

  async function solutionRoot() {
    let base;
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 1) base = folders[0].uri;
    else if (folders.length > 1) {
      const selected = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, uri: folder.uri })), {
        title: 'Choose the workspace for TensorTonic solutions',
      });
      if (!selected) return undefined;
      base = selected.uri;
    } else {
      const saved = context.workspaceState.get('tensortonic.solutionBase');
      if (saved) base = vscode.Uri.parse(saved);
      else {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: 'Choose a folder for TensorTonic solutions', openLabel: 'Use folder' });
        if (!picked || !picked.length) return undefined;
        base = picked[0];
        await context.workspaceState.update('tensortonic.solutionBase', base.toString());
      }
    }
    const directory = vscode.workspace.getConfiguration('tensortonic').get('solutionDirectory', 'tensortonic');
    if (typeof directory !== 'string' || !directory || directory.startsWith('/') || directory.startsWith('\\') || /^[a-z]:/i.test(directory) || directory.split(/[\\/]/).some(part => part === '..' || part === '.')) {
      throw new Error('tensortonic.solutionDirectory must be a relative folder inside your workspace, such as tensortonic.');
    }
    const root = vscode.Uri.joinPath(base, ...directory.split(/[\\/]/).filter(Boolean));
    await vscode.workspace.fs.createDirectory(root);
    return root;
  }

  async function showDescription(problem, solutionUri) {
    const commands = await vscode.commands.getCommands(true);
    if (solutionUri && commands.includes('markdown.showPreviewToSide')) {
      const uri = await writeProblemContext(problem, solutionUri);
      await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
      return;
    }
    const ref = normalizeRef(problem.ref || problem);
    if (!state.statementPanel) {
      state.statementPanel = vscode.window.createWebviewPanel('tensortonic.description', 'TensorTonic problem', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: false, localResourceRoots: [] });
      state.statementPanel.onDidDispose(() => { state.statementPanel = undefined; }, null, context.subscriptions);
    }
    const title = problem.title || ref.slug;
    state.statementPanel.title = title;
    const exampleText = Array.isArray(problem.examples) && problem.examples.length ? `<h2>Examples</h2><pre>${escapeHtml(JSON.stringify(problem.examples, null, 2))}</pre>` : '';
    state.statementPanel.webview.html = buildHtml(title, `<h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(ref.planId || 'Free problem')}</p><p><a href="${escapeHtml(problemUrl(ref))}">Open original problem</a></p><div class="statement">${escapeHtml(htmlToText(problem.description) || 'This problem has no readable statement. Open the original problem for its full formatting.')}</div>${exampleText}`);
    state.statementPanel.reveal(vscode.ViewColumn.Beside, true);
  }

  async function openProblem(input) {
    if (!input) return search();
    requireConnection();
    const ref = normalizeRef(input);
    const problem = await client.getProblem(ref);
    if (!problem || typeof problem !== 'object') throw new Error('TensorTonic returned an unexpected problem response.');
    problem.ref = normalizeRef(problem.ref || ref);
    const root = await solutionRoot();
    if (!root) return undefined;
    const folder = vscode.Uri.joinPath(root, problem.ref.planId || 'free');
    await vscode.workspace.fs.createDirectory(folder);
    const settings = fileSettings(problem.ref);
    const uri = vscode.Uri.joinPath(folder, `${problem.ref.slug}.${settings.extension}`);
    const starter = typeof problem.starterCode === 'string' ? problem.starterCode : '';
    await createTextFile(uri, `${settings.comment} tensortonic: ${JSON.stringify(problem.ref)}\n${settings.comment} ${problemUrl(problem.ref)}\n\n${starter}${starter.endsWith('\n') ? '' : '\n'}`);
    const testCases = Array.isArray(problem.testCases) ? problem.testCases : Array.isArray(problem.examples) ? problem.examples : [];
    await createTextFile(testsUriFor(uri), JSON.stringify(testCases, null, 2) + '\n');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    state.lastSolutionUri = uri;
    state.currentProblem = problem;
    const contextUri = await writeProblemContext(problem, uri);
    await showDescription(problem, uri);
    return { problem, uri, testsUri: testsUriFor(uri), contextUri };
  }

  async function writeProblemContext(problem, solutionUri) {
    const uri = contextUriFor(solutionUri);
    const markdown = buildProblemMarkdown(problem);
    const content = `${CONTEXT_MARKER}\n<!-- sha256:${contextHash(markdown)} -->\n\n${markdown}`;
    if (!await fileExists(uri)) {
      await createTextFile(uri, content);
    } else {
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.getText() === content) return uri;
      // A generated context must never replace a learner's notes or unsaved edits.
      const existing = document.getText().match(/^<!-- TensorTonic generated problem context -->\n<!-- sha256:([a-f0-9]{64}) -->\n\n([\s\S]*)$/);
      if (!existing || contextHash(existing[2]) !== existing[1] || document.isDirty) {
        throw new Error('The generated .problem.md file has been edited. Save your notes in another file before refreshing its problem context.');
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)), content);
      if (!await vscode.workspace.applyEdit(edit) || !await document.save()) throw new Error('Could not refresh the generated problem context.');
    }
    return uri;
  }

  async function currentContext(input) {
    let selected = input;
    if (!selected) {
      const active = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
      try { if (active) readRef(active.getText()); else throw new Error(); selected = active.uri; }
      catch (_) { selected = state.lastSolutionUri; }
    }
    const { document, ref } = await managedDocument(selected);
    let problem = state.currentProblem;
    const same = problem && JSON.stringify(normalizeRef(problem.ref)) === JSON.stringify(ref);
    if (!same) {
      requireConnection();
      problem = await client.getProblem(ref);
      problem.ref = normalizeRef(problem.ref || ref);
    }
    state.currentProblem = problem;
    state.lastSolutionUri = document.uri;
    const problemUri = await writeProblemContext(problem, document.uri);
    return { document, ref, problem, problemUri };
  }

  async function openAgentContext(input) {
    const context = await currentContext(input);
    return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(context.problemUri), { viewColumn: vscode.ViewColumn.Beside, preview: false });
  }

  async function discussWithAgent(input) {
    const { document, ref, problemUri } = await currentContext(input);
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('workbench.action.chat.open')) {
      await openAgentContext(document.uri);
      throw new Error('VS Code Chat is unavailable. The .problem.md file is ready to attach in your coding agent.');
    }
    const attachFiles = [problemUri, document.uri];
    const testsUri = testsUriFor(document.uri);
    if (await fileExists(testsUri)) attachFiles.push(testsUri);
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      mode: 'agent', isPartialQuery: true,
      query: buildDiscussionPrompt(ref, document.uri.fsPath, problemUri.fsPath),
      attachFiles,
    });
    return { problemUri, solutionUri: document.uri, attachedFiles: attachFiles };
  }

  async function discussWithCodex(input) {
    const { document, problemUri } = await currentContext(input);
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('chatgpt.addFileToThread')) {
      throw new Error('The Codex VS Code extension is not installed or does not expose file attachment. Use Discuss with Agent or attach the .problem.md file manually.');
    }
    for (const uri of [problemUri, document.uri]) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
      await vscode.commands.executeCommand('chatgpt.addFileToThread');
    }
    if (commands.includes('chatgpt.openSidebar')) await vscode.commands.executeCommand('chatgpt.openSidebar');
    return { problemUri, solutionUri: document.uri };
  }

  async function managedDocument(input) {
    let uri;
    if (input instanceof vscode.Uri) uri = input;
    else if (input && input.uri instanceof vscode.Uri) uri = input.uri;
    else if (vscode.window.activeTextEditor) uri = vscode.window.activeTextEditor.document.uri;
    else uri = state.lastSolutionUri;
    if (!uri) throw new Error('Open a TensorTonic solution first.');
    if (/\.tests\.json$/i.test(uri.path)) {
      throw new Error('Open the solution code file to run or submit it. Test cases are edited separately.');
    }
    const document = await vscode.workspace.openTextDocument(uri);
    return { document, ref: readRef(document.getText()) };
  }

  async function refFrom(input) {
    if (input && !(input instanceof vscode.Uri) && (typeof input === 'string' || input.slug || input.problemRef)) return normalizeRef(input);
    return (await managedDocument(input)).ref;
  }

  async function description(input) {
    requireConnection();
    const ref = await refFrom(input);
    const problem = await client.getProblem(ref);
    problem.ref = normalizeRef(problem.ref || ref);
    const same = state.currentProblem && JSON.stringify(normalizeRef(state.currentProblem.ref)) === JSON.stringify(ref);
    await showDescription(problem, same ? state.lastSolutionUri : undefined);
    return problem;
  }

  async function openTests(input) {
    const { document } = await managedDocument(input);
    const uri = testsUriFor(document.uri);
    if (!await fileExists(uri)) await createTextFile(uri, '[]\n');
    return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
  }

  async function openInBrowser(input) {
    return vscode.env.openExternal(vscode.Uri.parse(problemUrl(await refFrom(input))));
  }

  function showResults(action, problem, result) {
    if (!state.resultsPanel) {
      state.resultsPanel = vscode.window.createWebviewPanel('tensortonic.results', 'TensorTonic result', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: false, localResourceRoots: [] });
      state.resultsPanel.onDidDispose(() => { state.resultsPanel = undefined; }, null, context.subscriptions);
    }
    const title = `${action === 'submit' ? 'Submission' : 'Run'} · ${problem.title || problem.ref.slug}`;
    state.resultsPanel.title = title;
    state.resultsPanel.webview.html = buildHtml(title, `<h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(new Date().toLocaleString())}</p><pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`);
    state.resultsPanel.reveal(vscode.ViewColumn.Beside, true);
  }

  async function execute(action, input) {
    requireConnection();
    const { document, ref } = await managedDocument(input);
    const code = document.getText();
    const problem = await client.getProblem(ref);
    problem.ref = normalizeRef(problem.ref || ref);
    let testCases;
    if (action === 'run') {
      const uri = testsUriFor(document.uri);
      if (await fileExists(uri)) {
        const tests = await vscode.workspace.openTextDocument(uri);
        try { testCases = JSON.parse(tests.getText()); }
        catch (error) { throw new Error(`Test cases must be valid JSON: ${error.message}`); }
        if (!Array.isArray(testCases)) throw new Error('The .tests.json file must contain a JSON array of test cases.');
      } else testCases = Array.isArray(problem.testCases) ? problem.testCases : [];
    }
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: action === 'submit' ? 'Submitting to TensorTonic…' : 'Running TensorTonic test cases…', cancellable: false }, () =>
      action === 'submit' ? client.submit(problem, code) : client.run(problem, code, testCases));
    showResults(action, problem, result);
    if (action === 'submit') refresh().catch(showError);
    return result;
  }

  async function smokeTest(options) {
    const result = { activated: true, connected: bridge.connected, viewId: VIEW_ID, commands: COMMANDS.slice(), planId: getPlanId() || null };
    if (bridge.connected) {
      const problems = await refresh();
      result.problemCount = problems.length;
      const ref = options && options.ref ? normalizeRef(options.ref) : problems[0];
      if (ref) {
        const problem = await client.getProblem(ref);
        result.problem = { slug: ref.slug, title: problem.title, hasStatement: !!problem.description, hasStarterCode: typeof problem.starterCode === 'string' && problem.starterCode.length > 0, testCaseCount: Array.isArray(problem.testCases) ? problem.testCases.length : 0 };
      }
    }
    output.appendLine(JSON.stringify(result, null, 2));
    return result;
  }

  const handlers = {
    connect, disconnect, openProblem, search, refresh, description, openTests, openInBrowser,
    chooseStudyPlan, run: input => execute('run', input), submit: input => execute('submit', input), smokeTest,
    openAgentContext, discussWithAgent, discussWithCodex,
  };
  for (const [name, handler] of Object.entries(handlers)) {
    context.subscriptions.push(vscode.commands.registerCommand(`tensortonic.${name}`, async (...args) => {
      try { return await handler(...args); }
      catch (error) { showError(error); return undefined; }
    }));
  }
  context.subscriptions.push(vscode.languages.registerCodeLensProvider([{ scheme: 'file', language: 'python' }, { scheme: 'file', language: 'sql' }, { scheme: 'file', language: 'cpp' }, { scheme: 'file', pattern: '**/*.cu' }], new SolutionCodeLensProvider()));
  context.subscriptions.push({ dispose() { bridge.stop().catch(() => {}); } });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('tensortonic.studyPlan')) {
      state.problems = [];
      tree.refresh();
    }
  }));

  if (vscode.lm && typeof vscode.lm.registerTool === 'function') {
    context.subscriptions.push(vscode.lm.registerTool('tensortonic_current_problem', {
      async invoke() {
        const { document, problem } = await currentContext();
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(formatAgentContext(problem, document.getText()))]);
      },
      async prepareInvocation() {
        return { invocationMessage: 'Reading the selected TensorTonic problem and current editor code' };
      },
    }));
  }

  return { bridge, client, refresh, openProblem, smokeTest, currentContext, discussWithAgent, commands: COMMANDS.slice() };
}

function deactivate() {}

module.exports = { activate, deactivate, escapeHtml, htmlToText, normalizeRef, readRef, problemUrl, testsUriFor, contextUriFor };
