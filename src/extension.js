'use strict';

const vscode = require('vscode');
const crypto = require('node:crypto');
const { TensorTonicClient } = require('./client');
const { BrowserBridge } = require('./bridge');
const { NativeBrowserBridge } = require('./native-browser-bridge');
const { ConnectionManager } = require('./connection-manager');
const { rememberedOptions } = require('./remembered-pairing');
const { buildProblemMarkdown, buildDiscussionPrompt, formatAgentContext } = require('./context');
const { renderResult } = require('./results');
const { ProblemTreeProvider } = require('./tree');
const { StudyWorkspace } = require('./study-workspace');
const { StudyEnvironmentUI } = require('./study-environment-ui');
const { resolveCard } = require('./cards');
const { buildCardHtml } = require('./cards/webview');

const COMMANDS = [
  'connect', 'disconnect', 'openProblem', 'search', 'refresh', 'run', 'submit',
  'description', 'interactiveExplanation', 'openOriginalInVSCode', 'offlineExploration', 'openTests', 'openInBrowser', 'chooseStudyPlan', 'smokeTest',
  'openAgentContext', 'discussWithAgent', 'discussWithCodex', 'previousProblem', 'nextProblem', 'showStudyPlan', 'startStudying', 'changeStudyFolder', 'setupStudyEnvironment', 'repairStudyEnvironment', 'chooseConnectionMode', 'chooseProblemView',
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
.result-summary{border:1px solid var(--vscode-panel-border);border-left:4px solid var(--vscode-descriptionForeground);padding:20px 24px;border-radius:8px;margin:22px 0}
.result-summary h2{font-size:28px;line-height:1.2;margin:0 0 20px}.result-passed{--result-color:var(--vscode-testing-iconPassed,#73c991)}.result-failed,.result-error{--result-color:var(--vscode-testing-iconFailed,#f48771)}.result-pending,.result-unknown{--result-color:var(--vscode-descriptionForeground,#aaa)}
.result-summary{border-left-color:var(--result-color)}.result-summary h2,.result-badge{color:var(--result-color)}
.result-metrics{display:flex;flex-wrap:wrap;gap:18px 40px;margin:0}.result-metrics dt{color:var(--vscode-descriptionForeground);font-size:12px}.result-metrics dd{font-size:22px;font-weight:600;margin:4px 0 0;font-variant-numeric:tabular-nums}
.result-cases>h3{font-size:16px;margin:28px 0 12px}.result-case,.result-debug{border:1px solid var(--vscode-panel-border);border-radius:6px;margin:10px 0;overflow:hidden}
.result-case summary,.result-debug summary{padding:12px 14px;cursor:pointer;line-height:1.5}.result-case summary:focus-visible,.result-debug summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
.case-title{font-weight:600;margin-right:12px;overflow-wrap:anywhere}.result-badge{font-weight:600;margin-right:12px}.result-case[open]>summary,.result-debug[open]>summary{border-bottom:1px solid var(--vscode-panel-border)}
.result-value{margin:16px 14px}.result-value h4{font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 6px}.result-value pre{margin:0;max-height:360px;overflow:auto;tab-size:2}.result-case>.notice,.result-case>.meta{margin:14px}
.result-debug{margin-top:24px;color:var(--vscode-descriptionForeground)}.result-debug>pre{margin:0;border:0;max-height:420px;overflow:auto;color:var(--vscode-foreground)}
@media(max-width:480px){body{padding:16px}h1{font-size:20px}.result-summary{padding:16px}.result-summary h2{font-size:24px}.result-metrics{gap:16px 24px}.result-metrics dd{font-size:20px}}
</style></head><body>${body}</body></html>`;
}

class SolutionCodeLensProvider {
  provideCodeLenses(document) {
    let ref;
    try {
      ref = readRef(document.getText());
    } catch (_) {
      return [];
    }
    const range = new vscode.Range(0, 0, 0, 0);
    const actions = ['run', 'submit', 'description', 'interactiveExplanation', 'openTests', 'discussWithAgent'];
    if (ref.planId) actions.push('previousProblem', 'nextProblem');
    return actions.map(name => new vscode.CodeLens(range, {
      title: { run: 'Run', submit: 'Submit', description: 'Description', interactiveExplanation: 'Interactive explanation', openTests: 'Test cases', discussWithAgent: 'Discuss with Agent', previousProblem: 'Previous problem', nextProblem: 'Next problem' }[name],
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
  const nativeBridge = new NativeBrowserBridge(vscode);
  const legacyBridge = new BrowserBridge(rememberedOptions(vscode, context));
  const bridge = new ConnectionManager({ native: nativeBridge, legacy: legacyBridge, mode: vscode.workspace.getConfiguration('tensortonic').get('connectionMode', 'native') });
  const client = new TensorTonicClient((path, options) => bridge.request(path, options));
  const state = { bridge, problems: [], loading: false, refreshGeneration: 0, openGeneration: 0, cardGeneration: 0, cardPanel: undefined, lastSolutionUri: undefined, statementPanel: undefined, resultsPanel: undefined, currentProblem: undefined, activeRef: undefined, selectedPlanId: undefined };
  const tree = new ProblemTreeProvider(vscode, state);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'tensortonic.connect';
  status.show();
  const output = vscode.window.createOutputChannel('TensorTonic');
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(tree, status, output, treeView);
  let disposed = false;
  let revealPending = false;
  let revealRunning = false;
  // Do not open this view or move keyboard focus away from code/Agent. Serialize
  // reveals so a slow older reveal is followed by the newest selected solution.
  function revealCurrentProblem() {
    revealPending = true;
    if (revealRunning || disposed) return;
    revealRunning = true;
    void Promise.resolve().then(async () => {
      while (revealPending && !disposed) {
        revealPending = false;
        if (!treeView.visible || !bridge.connected || state.loading) continue;
        const item = tree.findProblem(state.activeRef);
        if (!item) continue;
        try { await treeView.reveal(item, { select: true, focus: false, expand: true }); }
        catch (_) { /* A hidden/disposed view must not interrupt editing. */ }
      }
    }).finally(() => {
      revealRunning = false;
      if (revealPending && !disposed) revealCurrentProblem();
    });
  }
  context.subscriptions.push(treeView.onDidChangeVisibility(event => {
    if (event.visible) revealCurrentProblem();
  }));
  context.subscriptions.push({ dispose() { disposed = true; revealPending = false; state.cardGeneration++; if (state.cardPanel) state.cardPanel.dispose(); } });


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
    status.tooltip = bridge.connected ? `TensorTonic ${bridge.mode === 'native' ? 'built-in browser' : 'legacy companion'} connected; website login may still be required` : 'Connect the built-in TensorTonic browser (or choose the legacy companion)';
    status.command = bridge.connected ? 'tensortonic.search' : 'tensortonic.connect';
    tree.refresh();
    vscode.commands.executeCommand('setContext', 'tensortonic.connected', bridge.connected);
  }
  updateConnection();
  bridge.onDidChange = () => {
    if (!bridge.connected) invalidateProblems();
    updateConnection();
    if (bridge.connected && bridge.mode === 'browserCompanion') refresh().catch(showError);
  };

  function showError(error) {
    const message = error && error.message ? error.message : String(error);
    output.appendLine(message);
    vscode.window.showErrorMessage(`TensorTonic: ${message}`);
  }

  function requireConnection() {
    if (!bridge.connected) throw new Error('Use “TensorTonic: Connect browser” first, then sign in normally on the TensorTonic page.');
  }

  function invalidateProblems() {
    state.refreshGeneration += 1;
    state.openGeneration += 1;
    state.problems = [];
    state.loading = false;
    treeView.description = undefined;
    treeView.message = undefined;
    tree.refresh();
  }

  async function refresh() {
    requireConnection();
    const planId = getPlanId();
    const generation = ++state.refreshGeneration;
    const connection = bridge.token;
    const isCurrent = () => generation === state.refreshGeneration && bridge.connected &&
      bridge.token === connection && getPlanId() === planId;
    state.selectedPlanId = planId;
    state.problems = [];
    state.loading = true;
    treeView.message = undefined;
    tree.refresh();
    try {
      const problems = await client.listProblems(planId);
      // A previous plan/session may finish after a newer refresh. Never publish
      // stale rows, labels or loading state into the current selection.
      if (!isCurrent()) return state.problems;
      if (!Array.isArray(problems)) throw new Error('TensorTonic returned an unexpected problem list.');
      state.problems = problems.filter(problem => {
        try { normalizeRef(problem); return true; } catch (_) { return false; }
      });
      treeView.description = planId || 'Free problems';
      treeView.message = state.problems.length ? undefined : 'No problems found. Try another study plan or refresh.';
      return state.problems;
    } catch (error) {
      if (!isCurrent()) return state.problems;
      treeView.message = 'Could not load problems. Refresh to try again.';
      throw error;
    } finally {
      if (generation === state.refreshGeneration) {
        state.loading = false;
        tree.refresh();
        revealCurrentProblem();
      }
    }
  }

  async function showStudyPlan() {
    // Only this explicit user command opens the sidebar; automatic selection
    // synchronization never replaces Explorer or another currently visible view.
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    if (bridge.connected && !state.loading) await refresh();
  }

  function getProblemView() {
    // A workspace value can choose only a local renderer or canonical site route.
    // It is never used as a URL, command identifier, script, or file path.
    return vscode.workspace.getConfiguration('tensortonic').get('problemView', 'markdown') === 'web' ? 'web' : 'markdown';
  }

  async function chooseProblemView() {
    const chosen = await vscode.window.showQuickPick([
      { label: 'Markdown', description: 'Local formatted statement and math', mode: 'markdown' },
      { label: 'Web', description: 'Original TensorTonic page and interactive cards', mode: 'web' },
    ], { title: 'TensorTonic problem view', placeHolder: 'Choose the default for future problem opens and navigation' });
    if (!chosen || !['markdown', 'web'].includes(chosen.mode)) return;
    const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length;
    const target = hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('tensortonic').update('problemView', chosen.mode, target);
    // Changing this preference alone must not reload/write a learner's files or
    // open a page. It applies on the next explicit open/Previous/Next action.
    await vscode.window.showInformationMessage(`TensorTonic problem view is now ${chosen.mode === 'web' ? 'Web' : 'Markdown'} for ${hasWorkspace ? 'this workspace' : 'your user settings'}. Open a problem or use Previous/Next to apply it. Description remains available as Markdown.`);
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
    invalidateProblems();
    if (bridge.connected) await refresh();
  }

  async function companionGuide() {
    const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'browser-companion.md');
    return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
  }

  let pairingPromptInProgress = false;
  async function connect() {
    if (pairingPromptInProgress) return undefined;
    pairingPromptInProgress = true;
    try {
      await bridge.setMode(vscode.workspace.getConfiguration('tensortonic').get('connectionMode', 'native'));
      if (bridge.mode === 'native') {
        if (vscode.workspace.isTrusted !== true || vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) throw new Error('The native connection requires a trusted local VS Code desktop window.');
        if (!bridge.connected) {
          const choice = await vscode.window.showInformationMessage('Connect TensorTonic in VS Code’s built-in browser?', {
            modal: true,
            detail: 'Open a dedicated TensorTonic browser page and attach only this extension’s own browser debug session. Sign in normally in that page. Problem access and explicit Run/Submit use the website session without copying cookies, passwords, or tokens. No pairing code or Chrome/Helium companion is needed. Disconnect stops only this owned connection. Native connection is a release candidate; the legacy companion remains available as an explicit fallback.',
          }, 'Connect built-in browser', 'Choose connection mode');
          if (choice === 'Choose connection mode') return chooseConnectionMode();
          if (choice !== 'Connect built-in browser') return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Connecting the TensorTonic built-in browser', cancellable: true }, async (_progress, token) => {
          const cancel = token.onCancellationRequested(() => { void nativeBridge.stop().catch(() => {}); });
          try { if (token.isCancellationRequested) return; await bridge.start(); }
          finally { cancel.dispose(); }
        });
        if (!bridge.connected) return;
        try { await refresh(); } catch (error) { if (error.code !== 'AUTH_REQUIRED') throw error; }
        // Notifications can pause the integrated browser while the user signs in.
        // Keep guidance discoverable without showing a toast or moving focus.
        output.appendLine('TensorTonic browser connected. Sign in normally on the dedicated page if needed, then use Refresh problems or Connect again. No companion pairing code is required.');
        return { nativeConnected: true };
      }
      if (bridge.connected) {
        await refresh();
        return vscode.window.showInformationMessage('TensorTonic browser is already connected. Disconnect before pairing another tab or account.');
      }
      const chosen = await vscode.window.showInformationMessage('Connect with the TensorTonic browser companion', {
        modal: true,
        detail: 'Sign in normally on TensorTonic on this computer. Pairing will be remembered for 30 days in VS Code SecretStorage and the browser companion, with automatic reconnection. No passwords or website cookies are stored. Disconnect revokes remembered access. Copy the one-use code and paste it into the companion within two minutes; approve its TensorTonic-only permission if you agree.',
      }, 'Copy pairing code', 'Companion setup');
      if (chosen === 'Companion setup') return companionGuide();
      if (chosen !== 'Copy pairing code') return undefined;
      if (vscode.workspace.isTrusted === false) throw new Error('Review workspace trust before connecting TensorTonic.');
      await rememberedConnectionReady;
      await bridge.start();
      if (bridge.connected) return vscode.window.showInformationMessage('TensorTonic browser is already connected.');
      // Clipboard writes happen only after the explicit Copy action. Never
      // put the ticket or longer-lived capability in a document, log or URL.
      const ticket = bridge.pairingCode();
      await vscode.env.clipboard.writeText(ticket);
      const next = await vscode.window.showInformationMessage('Pairing code copied. Paste it into companion 0.2.0 or newer within two minutes. The connection can be remembered for 30 days.', 'Open TensorTonic', 'Companion setup');
      if (next === 'Open TensorTonic') await vscode.env.openExternal(vscode.Uri.parse('https://www.tensortonic.com/'));
      if (next === 'Companion setup') await companionGuide();
      return { pairingRequested: true };
    } finally {
      pairingPromptInProgress = false;
    }
  }

  async function chooseConnectionMode() {
    const selected = await vscode.window.showQuickPick([
      { label: 'Built-in browser', description: 'Native connection — no browser companion or pairing code', mode: 'native' },
      { label: 'Legacy browser companion', description: 'Existing Chrome/Helium companion and remembered pairing', mode: 'browserCompanion' },
    ], { title: 'TensorTonic connection mode', placeHolder: 'Changing mode disconnects the current owned connection; requests are never replayed.' });
    if (!selected || !['native', 'browserCompanion'].includes(selected.mode)) return;
    await bridge.setMode(selected.mode);
    const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('tensortonic').update('connectionMode', selected.mode, target);
    invalidateProblems(); updateConnection();
    await vscode.window.showInformationMessage(`TensorTonic now uses ${selected.mode === 'native' ? 'the built-in browser' : 'the legacy browser companion'}. Run Connect browser when ready. No request was replayed.`);
  }

  async function disconnect() {
    await rememberedConnectionReady;
    invalidateProblems();
    if (typeof bridge.revoke === 'function') await bridge.revoke();
    else await bridge.stop();
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

  async function showDescription(problem, solutionUri, isCurrent = () => true) {
    if (solutionUri) {
      const uri = await writeProblemContext(problem, solutionUri);
      if (!isCurrent()) return;
      // A fresh Code window may not have activated Markdown yet. Checking only
      // getCommands() races activation and incorrectly selects the plain-text
      // fallback on first use. Use the built-in, local Markdown/math renderer;
      // never inject downloaded HTML or load a renderer from a remote CDN.
      try {
        const markdown = vscode.extensions.getExtension('vscode.markdown-language-features');
        if (markdown) await markdown.activate();
        if (!isCurrent()) return;
        const commands = await vscode.commands.getCommands(true);
        if (!isCurrent()) return;
        if (commands.includes('markdown.showPreviewToSide')) {
          await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
          if (!isCurrent()) return;
          // Do not leave an earlier degraded preview beside the formatted one.
          const previousPanel = state.statementPanel;
          state.statementPanel = undefined;
          if (previousPanel) previousPanel.dispose();
          return;
        }
      } catch (_) {
        // Disabled/unavailable Markdown must not prevent opening the solution.
        // Avoid printing renderer exceptions that can contain downloaded text.
        output.appendLine('Markdown preview is unavailable; showing an inert plain-text problem description.');
      }
    }
    if (!isCurrent()) return;
    const ref = normalizeRef(problem.ref || problem);
    if (!state.statementPanel) {
      const panel = vscode.window.createWebviewPanel('tensortonic.description', 'TensorTonic problem', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: false, localResourceRoots: [] });
      state.statementPanel = panel;
      panel.onDidDispose(() => { if (state.statementPanel === panel) state.statementPanel = undefined; }, null, context.subscriptions);
    }
    const title = problem.title || ref.slug;
    state.statementPanel.title = title;
    const exampleText = Array.isArray(problem.examples) && problem.examples.length ? `<h2>Examples</h2><pre>${escapeHtml(JSON.stringify(problem.examples, null, 2))}</pre>` : '';
    const notice = '<p class="notice">Plain-text fallback: VS Code\'s Markdown preview is unavailable. Enable the built-in Markdown Language Features extension and reopen Description for formatted Markdown and math.</p>';
    state.statementPanel.webview.html = buildHtml(title, `<h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(ref.planId || 'Free problem')}</p><p><a href="${escapeHtml(problemUrl(ref))}">Open original problem</a></p>${notice}<div class="statement">${escapeHtml(htmlToText(problem.description) || 'This problem has no readable statement. Open the original problem for its full formatting.')}</div>${exampleText}`);
    state.statementPanel.reveal(vscode.ViewColumn.Beside, true);
  }

  async function openProblem(input) {
    if (!input) return search();
    requireConnection();
    const ref = normalizeRef(input);
    const generation = ++state.openGeneration;
    const connection = bridge.token;
    const isCurrent = () => generation === state.openGeneration && bridge.connected && bridge.token === connection;
    const problem = await client.getProblem(ref);
    if (!isCurrent()) return undefined;
    if (!problem || typeof problem !== 'object') throw new Error('TensorTonic returned an unexpected problem response.');
    problem.ref = normalizeRef(problem.ref || ref);
    const root = await solutionRoot();
    if (!root || !isCurrent()) return undefined;
    const folder = vscode.Uri.joinPath(root, problem.ref.planId || 'free');
    await vscode.workspace.fs.createDirectory(folder);
    if (!isCurrent()) return undefined;
    const settings = fileSettings(problem.ref);
    const uri = vscode.Uri.joinPath(folder, `${problem.ref.slug}.${settings.extension}`);
    const starter = typeof problem.starterCode === 'string' ? problem.starterCode : '';
    await createTextFile(uri, `${settings.comment} tensortonic: ${JSON.stringify(problem.ref)}\n${settings.comment} ${problemUrl(problem.ref)}\n\n${starter}${starter.endsWith('\n') ? '' : '\n'}`);
    if (!isCurrent()) return undefined;
    const testCases = Array.isArray(problem.testCases) ? problem.testCases : Array.isArray(problem.examples) ? problem.examples : [];
    await createTextFile(testsUriFor(uri), JSON.stringify(testCases, null, 2) + '\n');
    if (!isCurrent()) return undefined;
    const document = await vscode.workspace.openTextDocument(uri);
    if (!isCurrent()) return undefined;
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    if (!isCurrent()) return undefined;
    state.lastSolutionUri = uri;
    state.currentProblem = problem;
    const contextUri = await writeProblemContext(problem, uri);
    if (!isCurrent()) return undefined;
    const mode = getProblemView();
    const presentationCurrent = () => isCurrent() && getProblemView() === mode;
    if (mode === 'web') {
      const opened = await interactiveExplanation(problem.ref, { studyNavigation: true, isCurrentNavigation: presentationCurrent });
      if (!presentationCurrent()) return undefined;
      if (!opened || !opened.requested) await showDescription(problem, uri, presentationCurrent);
      else if (state.statementPanel) { const previous = state.statementPanel; state.statementPanel = undefined; previous.dispose(); }
    } else {
      await showDescription(problem, uri, presentationCurrent);
    }
    if (!isCurrent()) return undefined;
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
    let solutionUri;
    if (input instanceof vscode.Uri) solutionUri = input;
    else if (input && input.uri instanceof vscode.Uri) solutionUri = input.uri;
    else if (!input) solutionUri = (await managedDocument(input)).document.uri;
    else if (state.lastSolutionUri) {
      // Cached problem identity and last-selected editor can intentionally
      // differ. Match the actual document before writing its context file.
      const selected = await managedDocument(state.lastSolutionUri);
      if (selected.ref.slug === ref.slug && selected.ref.planId === ref.planId) solutionUri = selected.document.uri;
    }
    const problem = await client.getProblem(ref);
    problem.ref = normalizeRef(problem.ref || ref);
    await showDescription(problem, solutionUri);
    return problem;
  }

  async function interactiveExplanation(input, { studyNavigation = false, isCurrentNavigation = () => true } = {}) {
    // Delegate normal top-level navigation to VS Code's native Chromium browser.
    // Never frame/proxy the page, alter headers, or transfer browser credentials.
    const generation = ++state.cardGeneration;
    const navigation = state.openGeneration;
    const isCurrent = () => !disposed && generation === state.cardGeneration && navigation === state.openGeneration && isCurrentNavigation();
    let ref;
    try { ref = await refFrom(input || state.lastSolutionUri); }
    catch (error) { if (!isCurrent()) return; throw error; }
    if (!isCurrent()) return;
    const url = problemUrl(ref);
    if (bridge.mode === 'native' && bridge.connected) {
      await bridge.openProblemPage(url);
      return isCurrent() ? { ref, target: 'owned-native', requested: true } : undefined;
    }
    let available;
    try { available = await vscode.commands.getCommands(true); }
    catch (error) { if (!isCurrent()) return; throw error; }
    if (!isCurrent()) return;
    const nativeCommand = 'workbench.action.browser.open';
    let unavailable = !available.includes(nativeCommand);
    if (!unavailable) {
      try {
        // Reuse only the exact canonical URL last requested by study navigation.
        // Never match all TensorTonic pages: a manually navigated/login tab must
        // not be redirected. If the user navigated away, native Code opens a tab.
        const reuseUrlFilter = studyNavigation && state.studyBrowserUrl ? state.studyBrowserUrl : url;
        await vscode.commands.executeCommand(nativeCommand, { url, openToSide: true, reuseUrlFilter });
        if (studyNavigation && isCurrent()) state.studyBrowserUrl = url;
        // Dispatch is not proof of page loading, authentication or entitlement.
        return isCurrent() ? { ref, target: 'integrated', requested: true } : undefined;
      } catch (_) {
        if (!isCurrent()) return;
        unavailable = true;
      }
    }
    if (unavailable) {
      if (studyNavigation) {
        await vscode.window.showInformationMessage('Web view is unavailable in this VS Code window. Showing Markdown instead; use Interactive explanation for an explicit external-browser option. The Web preference is unchanged.');
        return isCurrent() ? { ref, target: 'none', requested: false } : undefined;
      }
      const choice = await vscode.window.showInformationMessage(
        'The original page could not be opened in VS Code’s Integrated Browser. Use a desktop VS Code version with Integrated Browser, or open your normal browser. Sign in on the website yourself; browser sessions are separate.',
        'Open in external browser');
      if (!isCurrent() || choice !== 'Open in external browser') return { ref, target: 'none', requested: false };
      const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
      return { ref, target: 'external', requested: opened === true };
    }
  }

  async function offlineExploration(input) {
    // Independent experiments use only a validated local identity, never account data.
    const generation = ++state.cardGeneration;
    const navigation = state.openGeneration;
    const isCurrent = () => !disposed && generation === state.cardGeneration && navigation === state.openGeneration;
    let ref;
    try { ref = await refFrom(input || state.lastSolutionUri); }
    catch (error) { if (!isCurrent()) return; throw error; }
    if (!isCurrent()) return;
    const card = resolveCard(ref);
    if (!state.cardPanel) {
      const panel = vscode.window.createWebviewPanel('tensortonic.explanation', 'Offline learning exploration',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [] });
      state.cardPanel = panel;
      panel.onDidDispose(() => {
        if (state.cardPanel === panel) { state.cardPanel = undefined; state.cardGeneration++; }
      }, null, context.subscriptions);
    }
    state.cardPanel.title = card ? `${card.title} — offline exploration` : 'Offline exploration unavailable';
    state.cardPanel.webview.html = buildCardHtml(ref);
    state.cardPanel.reveal(vscode.ViewColumn.Beside, true);
    return { ref, supported: !!card, cardId: card && card.id };
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

  async function navigateProblem(direction, input) {
    requireConnection();
    const connection = bridge.token;
    const generation = ++state.openGeneration;
    const isCurrent = () => generation === state.openGeneration && bridge.connected && bridge.token === connection;
    const { ref } = await managedDocument(input);
    if (!isCurrent()) return;
    if (!ref.planId) {
      await vscode.window.showInformationMessage('Previous and Next are available for study-plan problems.');
      return;
    }
    // The open solution determines the plan, not a possibly different sidebar
    // setting. Always use the server's current ordered plan catalogue.
    let catalogue;
    try { catalogue = await client.listProblems(ref.planId); }
    catch (error) {
      if (!isCurrent()) return;
      throw error;
    }
    if (!isCurrent()) return;
    if (!Array.isArray(catalogue)) throw new Error('TensorTonic returned an unexpected problem list.');
    const problems = catalogue.filter(problem => {
      try { return normalizeRef(problem).planId === ref.planId; } catch (_) { return false; }
    });
    // API identity wins over browser aliases, which can be renamed/reused.
    let matches = ref.apiId ? problems.filter(problem => problem.apiId === ref.apiId) : [];
    if (!matches.length) matches = problems.filter(problem => problem.slug === ref.slug &&
      (!ref.apiId || !problem.apiId));
    const index = matches.length === 1 ? problems.indexOf(matches[0]) : -1;
    if (index < 0) {
      await vscode.window.showInformationMessage('This problem was not found in the current study-plan list. Refresh the plan and try again.');
      return;
    }
    const next = index + direction;
    if (next < 0 || next >= problems.length) {
      await vscode.window.showInformationMessage(`This is the ${direction < 0 ? 'first' : 'last'} problem in this study plan.`);
      return;
    }
    // openProblem preserves existing files and unsaved editor changes. Reuse
    // its navigation/session guards rather than writing files in this command.
    return openProblem(problems[next]);
  }

  function showResults(action, problem, result, options) {
    if (!state.resultsPanel) {
      state.resultsPanel = vscode.window.createWebviewPanel('tensortonic.results', 'TensorTonic result', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: false, localResourceRoots: [] });
      state.resultsPanel.onDidDispose(() => { state.resultsPanel = undefined; }, null, context.subscriptions);
    }
    const title = `${action === 'submit' ? 'Submission' : 'Run'} · ${problem.title || problem.ref.slug}`;
    state.resultsPanel.title = title;
    state.resultsPanel.webview.html = buildHtml(title, `<h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(new Date().toLocaleString())}</p>${renderResult(result, options)}`);
    state.resultsPanel.reveal(vscode.ViewColumn.Beside, true);
  }

  let executionInProgress = false;
  async function execute(action, input) {
    if (executionInProgress) throw new Error('A TensorTonic Run or Submit is already in progress.');
    // Cover metadata/test reads as well as the POST: otherwise a second click
    // can wait on its GET, then submit again after the first grading completes.
    executionInProgress = true;
    try {
      return await executeOnce(action, input);
    } finally {
      executionInProgress = false;
    }
  }

  async function executeOnce(action, input) {
    requireConnection();
    const connection = bridge.token;
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
    let result;
    try {
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: action === 'submit' ? 'Submitting to TensorTonic…' : 'Running TensorTonic test cases…', cancellable: false }, () => {
        requireConnection();
        if (bridge.token !== connection) throw new Error('The browser connection changed. Review the selected account before running or submitting again.');
        return action === 'submit' ? client.submit(problem, code) : client.run(problem, code, testCases);
      });
    } catch (error) {
      showResults(action, problem, {
        status: 'error',
        message: 'No confirmed grading result was received. Check TensorTonic before submitting again.',
        error: error instanceof Error ? error.message : String(error),
      }, { localError: true });
      throw error;
    }
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

  const studyEnvironment = new StudyEnvironmentUI(vscode, context);
  context.subscriptions.push(studyEnvironment);
  const studyWorkspace = new StudyWorkspace(vscode, context, { showStudyPlan, offerEnvironment: () => studyEnvironment.offer().catch(showError) });

  const handlers = {
    connect, disconnect, openProblem, search, refresh, description, interactiveExplanation, offlineExploration, openOriginalInVSCode: interactiveExplanation, openTests, openInBrowser,
    chooseStudyPlan, chooseProblemView, showStudyPlan,
    startStudying: () => studyWorkspace.start(),
    changeStudyFolder: () => studyWorkspace.start({ chooseFolder: true }),
    chooseConnectionMode,
    setupStudyEnvironment: () => studyEnvironment.setup(),
    repairStudyEnvironment: () => studyEnvironment.repair(),
    run: input => execute('run', input), submit: input => execute('submit', input), smokeTest,
    openAgentContext, discussWithAgent, discussWithCodex,
    previousProblem: input => navigateProblem(-1, input), nextProblem: input => navigateProblem(1, input),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    context.subscriptions.push(vscode.commands.registerCommand(`tensortonic.${name}`, async (...args) => {
      try { return await handler(...args); }
      catch (error) { showError(error); return undefined; }
    }));
  }
  context.subscriptions.push(vscode.languages.registerCodeLensProvider([{ scheme: 'file', language: 'python' }, { scheme: 'file', language: 'sql' }, { scheme: 'file', language: 'cpp' }, { scheme: 'file', pattern: '**/*.cu' }], new SolutionCodeLensProvider()));
  function rememberSelectedSolution(editor) {
    if (!editor || editor.document.uri.scheme !== 'file') return;
    try {
      const selectedRef = readRef(editor.document.getText());
      if (JSON.stringify(selectedRef) !== JSON.stringify(state.activeRef)) state.cardGeneration++;
      state.activeRef = selectedRef;
      state.lastSolutionUri = editor.document.uri;
      tree.refresh();
      revealCurrentProblem();
    } catch (_) { /* Description, tests and chat must not replace the selection. */ }
  }
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(rememberSelectedSolution));
  rememberSelectedSolution(vscode.window.activeTextEditor);
  context.subscriptions.push({ dispose() { (typeof bridge.shutdown === 'function' ? bridge.shutdown() : bridge.stop()).catch(() => {}); } });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('tensortonic.connectionMode')) {
      void bridge.setMode(vscode.workspace.getConfiguration('tensortonic').get('connectionMode', 'native')).then(() => { invalidateProblems(); updateConnection(); }).catch(showError);
    }
    if (event.affectsConfiguration('tensortonic.studyPlan')) {
      invalidateProblems();
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

  // Startup may consume a recent explicit Start Studying request for this exact
  // local folder. It never opens a window or redirects existing solution files.
  const rememberedConnectionReady = vscode.workspace.isTrusted !== false && typeof bridge.restore === 'function'
    ? bridge.restore().catch(() => {
      output.appendLine('Remembered connection could not be restored. Another window may own its local port, or secure storage may be unavailable. Use the original study window; never change security settings to bypass this.');
      return false;
    }) : Promise.resolve(false);
  const studyWorkspaceReady = studyWorkspace.restorePendingStudyView().catch(() => {
    output.appendLine('The study sidebar could not be restored. Use Show study plan sidebar to open it.');
    return false;
  });
  return { bridge, client, refresh, openProblem, smokeTest, currentContext, discussWithAgent, studyWorkspaceReady, rememberedConnectionReady, commands: COMMANDS.slice() };
}

function deactivate() {}

module.exports = { activate, deactivate, escapeHtml, htmlToText, normalizeRef, readRef, problemUrl, testsUriFor, contextUriFor };
