'use strict';
const { createFocusDiagnostics, emitDiagnostic, diagnosticErrorCode } = require('./focus-diagnostics');

const vscode = require('vscode');
const crypto = require('node:crypto');
const { TensorTonicClient, runCases } = require('./client');
const { createResultFreshness, resultFreshnessLabel } = require('./result-freshness-ui');
const { StudyMembershipController } = require('./study-membership-ui');
const { recoveryFor, selectedFailureContext } = require('./result-recovery');
const { FocusModeController } = require('./focus-mode');
const { FocusBrowserAdapter } = require('./focus-browser-adapter');
const { FOCUS_CONTRACT } = require('./focus-contract');
const { createSessionBridge } = require('./session/tensortonic');
const { fault: sessionFault } = require('./session/fault');
const { buildProblemMarkdown, buildDiscussionPrompt, formatAgentContext } = require('./context');
const { ProblemWorkspace } = require('./problem-workspace');
const { StudyPlanPicker } = require('./study-plans');
const { navigationTargets, findProblemIndex, problemKey, recognizedSolution } = require('./study-navigation');
const { renderDescription } = require('./description-renderer');
const { StudyLayout } = require('./study-layout');
const { ProblemTreeProvider } = require('./tree');
const { StudyStatusProvider } = require('./study-status');
const { StudyWorkspace } = require('./study-workspace');
const { StudyEnvironmentUI } = require('./study-environment-ui');
const { resolveCard } = require('./cards');
const { buildCardHtml } = require('./cards/webview');

const COMMANDS = [
  'manageStudyPlans', 'removeStudyPlan', 'resumeStudyPlan', 'discussSelectedFailure', 'toggleFocusMode', 'showStudyStatus',
  'connect', 'disconnect', 'openProblem', 'search', 'refresh', 'run', 'submit', 'gradingStatus',
  'description', 'testsView', 'resultsView', 'cancelExecution', 'interactiveExplanation', 'openOriginalInVSCode', 'offlineExploration', 'openTests', 'openInBrowser', 'chooseStudyPlan', 'smokeTest',
  'openAgentContext', 'discussWithAgent', 'discussWithCodex', 'previousProblem', 'nextProblem', 'nextUnsolved', 'showStudyPlan', 'startStudying', 'changeStudyFolder', 'setupStudyEnvironment', 'useStudyEnvironment', 'repairStudyEnvironment', 'chooseProblemView',
].map(name => `tensortonic.${name}`);
const VIEW_ID = 'tensortonicProblems';
const STATUS_VIEW_ID = 'tensortonicStudyStatus';
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


class SolutionCodeLensProvider {
  constructor(gradingAvailable=false) { this.gradingAvailable=gradingAvailable; }
  provideCodeLenses(document) {
    if (!recognizedSolution(document, { readRef })) return [];
    const range = new vscode.Range(0, 0, 0, 0);
    const actions = ['description', 'testsView', 'discussWithAgent'];
    return actions.map(name => new vscode.CodeLens(range, {
      title: { description: 'Problem', testsView: 'Tests', discussWithAgent: 'Discuss with Agent' }[name],
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

let stopActiveSession=()=>Promise.resolve();
function activate(context) {
  const bridge = createSessionBridge(vscode, context);
  let studyEnvironment;
  const client = new TensorTonicClient((path, options) => bridge.request(path, options));
  const state = { bridge, problems: [], loading: false, refreshGeneration: 0, openGeneration: 0, planPickGeneration: 0, cardGeneration: 0, sessionEpoch: 0, cardPanel: undefined, lastSolutionUri: undefined, currentProblem: undefined, activeRef: undefined, selectedPlanId: undefined };
  state.environmentInStatusView = true;
  state.focusReason = 'reload-default';
  state.difficultyDisplay = vscode.workspace.getConfiguration('tensortonic').get('difficultyDisplay', 'text');
  const tree = new ProblemTreeProvider(vscode, state);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'tensortonic.connect';
  status.show();
  const output = vscode.window.createOutputChannel('TensorTonic');
  const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
  const planPicker = new StudyPlanPicker(vscode);
  const membership = new StudyMembershipController(vscode, context, { legacyPlanId: getPlanId, onError: showError });
  const freshness = createResultFreshness({ normalizeRunCases: runCases });
  const resultSnapshots = new Map();
  function focusDisplay() {
    const display = bridge.display;
    if (!display || typeof display.setFocusContract !== 'function') throw new Error('The owned problem display is unavailable.');
    display.setFocusContract(FOCUS_CONTRACT);
    return display;
  }
  const focusDiagnostics = createFocusDiagnostics();
  async function focusDiagnosticCall(stage, onDiagnostic, call) {
    emitDiagnostic(onDiagnostic, stage, 'start');
    try { const value = await call(); emitDiagnostic(onDiagnostic, stage, 'ok'); return value; }
    catch (error) { emitDiagnostic(onDiagnostic, stage, 'fail', diagnosticErrorCode(error)); throw error; }
  }
  const focusPort = {
    getPage: options => focusDiagnosticCall('lookup', options?.onDiagnostic, () => focusDisplay().getFocusPage(options)),
    inspect: (contract, options) => focusDiagnosticCall('contract', options?.onDiagnostic, () => focusDisplay().inspectFocusContract(contract, options)),
    createStyleSheet: (options, request) => focusDiagnosticCall('create-sheet', request?.onDiagnostic, () => focusDisplay().createFocusStyleSheet(options, request)),
    setStyleSheetText: (id, text, options) => focusDiagnosticCall(text ? 'write-sheet' : 'restore-sheet', options?.onDiagnostic, () => focusDisplay().setFocusStyleSheetText(id, text, options)),
    styleSheetExists: (id, options) => focusDisplay().focusStyleSheetExists(id, options),
  };
  let studyStatus;
  // Session-only user intent is separate from the current document's CSS lease.
  let focusRequested = false;
  let lastFocusPage;
  let focusRecovery;
  const focusMode = new FocusModeController({ adapter: new FocusBrowserAdapter(focusPort), verifiedContract: FOCUS_CONTRACT, onChange: () => studyStatus?.refresh() });
  function presentationSnapshot() {
    let display = { open: state.webPageOpen === true, otherBrowserActive: false };
    try {
      if (bridge.display?.presentationState) display = bridge.display.presentationState;
      else display.otherBrowserActive = !!vscode.window.activeBrowserTab;
    } catch (_) { /* Unavailable host APIs cannot imply ownership. */ }
    return Object.freeze({
      focus: Object.freeze({ ...focusMode.state, enabled: focusRequested, busy: focusMode.busy || !!focusRecovery, reason: state.focusReason }),
      problemView: getProblemView(),
      display: Object.freeze({ open: display.open === true, otherBrowserActive: display.otherBrowserActive === true, navigating: !!state.webNavigating, mismatch: displayMismatch(state.activeRef) }),
      environment: state.environment ? Object.freeze({ ...state.environment }) : undefined,
    });
  }
  studyStatus = new StudyStatusProvider(vscode, { getSnapshot: presentationSnapshot });
  const studyStatusView = vscode.window.createTreeView(STATUS_VIEW_ID, { treeDataProvider: studyStatus, showCollapseAll: false });
  const updateStatusDescription = () => { studyStatusView.description = studyStatus.summary; };
  context.subscriptions.push(studyStatus, studyStatusView, studyStatus.onDidChangeTreeData(updateStatusDescription));
  updateStatusDescription();
  for (const event of ['onDidChangeActiveBrowserTab', 'onDidChangeBrowserTabState', 'onDidCloseBrowserTab']) {
    try {
      const subscribe = vscode.window[event];
      if (typeof subscribe === 'function') context.subscriptions.push(subscribe.call(vscode.window, () => studyStatus.refresh()));
    } catch (_) { /* Status and Markdown remain usable without the browser proposal. */ }
  }
  let focusedPage;
  let focusObservation = 0;
  let focusAction = 0;
  function invalidateFocusAction() {
    focusAction++;
    focusRecovery?.controller.abort();
    focusRecovery = undefined;
  }
  async function observeFocusPage(closed = false) {
    // Even when Focus is still Off, a pending explicit recovery must not
    // outlive a newer owned-page observation.
    if (state.webNavigating) return; // This explicit navigation owns restore/reapply.
    if (focusRecovery) invalidateFocusAction();
    if (!focusMode.enabled && focusMode.state.status !== 'restore-pending') return;
    if (!focusMode.enabled && focusMode.state.status === 'restore-pending') {
      // A late owned-sheet removal or tab closure may now supply positive
      // cleanup proof. Retry Off only; this never discovers or styles a page.
      if (!focusMode.busy) await focusMode.pageChanged();
      return;
    }
    const observation = ++focusObservation;
    let page;
    try { if (!closed) page = await focusPort.getPage(); } catch (_) { /* Unknown structures stay visible. */ }
    if (observation !== focusObservation || !focusedPage) return;
    if (!page || ['id', 'url', 'documentId', 'frameId'].some(key => page[key] !== focusedPage[key])) {
      focusedPage = undefined;
      state.focusReason = 'page-changed';
      await focusMode.pageChanged();
    }
  }
  context.subscriptions.push(focusMode);
  const studyLayout = new StudyLayout(vscode);
  const problemWorkspace = new ProblemWorkspace(vscode, { getViewColumn: () => studyLayout.problemColumn, onDidChangeColumn: column => studyLayout.rememberProblemColumn(column), onAction: async payload => {
    if (payload.action === 'cancelExecution') return cancelExecution(payload.operation?.id);
    const epoch = state.sessionEpoch;
    // The panel supplies a captured URI. Never resolve actions through whichever
    // editor happens to be active after a panel click or Agent interaction.
    if (!payload.solutionUri) {
      if (payload.action === 'openOriginal') return interactiveExplanation(payload.ref);
      throw new Error('Open this problem as a solution before editing tests or discussing its code.');
    }
    const selected = await managedDocument(payload.solutionUri);
    synchronizeSession();
    if (epoch !== state.sessionEpoch) return;
    if (findProblemIndex([payload.ref], selected.ref) !== 0) throw new Error('The solution no longer matches this problem panel. Reopen the problem.');
    if (payload.action === 'editTests') return openTests(selected.document.uri);
    if (payload.action === 'discuss') return discussWithAgent(selected.document.uri);
    if (payload.action === 'discussFailure') return discussSelectedFailure(selected.document.uri, payload.resultAction);
    if (payload.action === 'openOriginal') return interactiveExplanation(selected.document.uri);
  } });
  context.subscriptions.push(tree, status, output, treeView, planPicker, problemWorkspace, studyLayout, membership);
  let disposed = false;
  let observedConnection = bridge.connected;
  let observedToken = bridge.token;
  function clearSessionPresentation() {
    focusRequested = false; lastFocusPage = undefined;
    invalidateFocusAction();
    state.sessionEpoch++;
    studyEnvironment?.invalidateSession?.();
    state.currentProblem = undefined;
    state.webRef = undefined;
    state.webPageOpen = false;
    state.webNavigating = false;
    resultSnapshots.clear();
    focusedPage = undefined;
    focusObservation++;
    state.focusReason = 'session-changed';
    void focusMode.pageChanged();
    problemWorkspace.resetSession();
    invalidateProblems();
  }
  function synchronizeSession() {
    if (observedConnection === bridge.connected && observedToken === bridge.token) return;
    observedConnection = bridge.connected;
    observedToken = bridge.token;
    clearSessionPresentation();
  }
  let executionInProgress = false;
  let activeExecution;
  const knownDocuments = new Map();
  const closedDocuments = new Set();
  function displayMismatch(ref) {
    if (!ref) return false;
    if (state.webPageOpen && !state.webRef) return true;
    if (!state.webRef) return false;
    const webIndex = findProblemIndex(state.problems, state.webRef);
    const codeIndex = findProblemIndex(state.problems, ref);
    if (webIndex >= 0 && codeIndex >= 0) return webIndex !== codeIndex;
    return (state.webRef.planId || '') !== (ref.planId || '') || state.webRef.slug !== ref.slug;
  }
  function updateActions() {
    studyStatus?.refresh();
    const targets = navigationTargets(state.problems, state.activeRef, { selectedPlanId: membership.initialized ? state.activeRef?.planId || '' : state.selectedPlanId || '' });
    for (const [name, value] of Object.entries({
      hasPrevious: !!targets.previous && !state.loading && bridge.connected,
      hasNext: !!targets.next && !state.loading && bridge.connected,
      hasNextUnsolved: !!targets.nextUnsolved && !state.loading && bridge.connected,
      executing: executionInProgress,
      displayMismatch: displayMismatch(state.activeRef),
      displayNavigating: !!state.webNavigating,
      executingResources: activeExecution?.uri ? [activeExecution.uri.toString()] : [],
      solutionResources: [...new Map([...(vscode.workspace.textDocuments || []), ...knownDocuments.values()]
        .filter(document => recognizedSolution(document, { readRef }))
        .map(document => [document.uri.toString(), document])).keys()],
    })) void vscode.commands.executeCommand('setContext', `tensortonic.${name}`, value);
  }
  function presentationCurrent(captured) {
    const current = problemWorkspace.capturePresentation();
    return !disposed && captured.closeEpoch === current.closeEpoch && captured.selectedKey === current.selectedKey && captured.interactionEpoch === current.interactionEpoch && captured.sessionEpoch === current.sessionEpoch;
  }
  const panelProblem = problem => ({ ...problem, ...normalizeRef(problem.ref || problem) });
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
        try {
          const ancestors = []; let parent = tree.getParent(item);
          while (parent) { ancestors.unshift(parent); parent = tree.getParent(parent); }
          for (const ancestor of ancestors) {
            if (tree.findProblem(state.activeRef) !== item || disposed) break;
            await treeView.reveal(ancestor, { select: false, focus: false, expand: true });
          }
          if (tree.findProblem(state.activeRef) === item && !disposed) await treeView.reveal(item, { select: true, focus: false, expand: true });
        }
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
  context.subscriptions.push({ dispose() { disposed = true; invalidateFocusAction(); revealPending = false; state.cardGeneration++; if (state.cardPanel) state.cardPanel.dispose(); } });


  function getPlanId() {
    const value = vscode.workspace.getConfiguration('tensortonic').get('studyPlan', 'pytorch-basics');
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
      throw new Error('Set tensortonic.studyPlan to a study-plan slug such as pytorch-basics, or leave it empty for free problems.');
    }
    return value;
  }

  function updateConnection() {
    synchronizeSession();
    status.text = bridge.cleanupPending ? '$(warning) TensorTonic cleanup pending' : bridge.connected ? '$(check) TensorTonic' : '$(plug) TensorTonic';
    status.tooltip = bridge.cleanupPending ? 'Retry Clear saved session to confirm credential and owned-page cleanup' : bridge.connected ? 'Choose a TensorTonic study plan. Saved sessions may expire or be revoked; uncertain Run/Submit actions are never replayed.' : 'Connect a securely stored TensorTonic session';
    status.command = bridge.cleanupPending ? 'tensortonic.disconnect' : bridge.connected ? 'tensortonic.chooseStudyPlan' : 'tensortonic.connect';
    tree.refresh();
    updateActions();
    vscode.commands.executeCommand('setContext', 'tensortonic.connected', bridge.connected);
    vscode.commands.executeCommand('setContext', 'tensortonic.cleanupPending', !!bridge.cleanupPending);
    vscode.commands.executeCommand('setContext', 'tensortonic.gradingAvailable', bridge.supportsGrading===true);
  }
  updateConnection();
  bridge.onDidChange = () => {
    if (!bridge.connected) invalidateProblems();
    updateConnection();
  };

  function showError(error) {
    const message = error && error.message ? error.message : String(error);
    output.appendLine(message);
    const recovery = recoveryFor(error, { grading: executionInProgress });
    const ref = state.activeRef && { ...state.activeRef };
    const recoveryEpoch = state.sessionEpoch, recoveryToken = bridge.token, recoveryKey = problemKey(state.activeRef);
    Promise.resolve(vscode.window.showErrorMessage(`TensorTonic: ${message}`, ...recovery.actions.map(action => action.label))).then(choice => {
      const action = recovery.actions.find(item => item.label === choice);
      if (!action || disposed) return;
      if (action.id !== 'openOutput' && (state.sessionEpoch !== recoveryEpoch || bridge.token !== recoveryToken)) return;
      if (action.id === 'checkWebsite' && problemKey(state.activeRef) !== recoveryKey) return;
      if (action.id === 'openOutput') output.show?.(true);
      else if (action.id === 'connect') return vscode.commands.executeCommand('tensortonic.connect');
      else if (action.id === 'clearSession') return vscode.commands.executeCommand('tensortonic.disconnect');
      else if (action.id === 'checkWebsite' && ref) return interactiveExplanation(ref);
    }).catch(() => {});
  }

  function requireConnection() {
    synchronizeSession();
    if (!bridge.connected) throw new Error('Use “TensorTonic: Connect session” first. A missing or expired session requires explicit sign-in.');
  }

  function invalidateProblems() {
    state.refreshGeneration += 1;
    state.openGeneration += 1;
    state.problems = [];
    state.planGroups = undefined;
    state.loading = false;
    state.selectedPlanId = getPlanId();
    treeView.description = undefined;
    treeView.message = undefined;
    tree.refresh();
    updateActions();
  }

  async function refresh() {
    requireConnection();
    const planId = getPlanId();
    const memberIds = membership.planIds;
    const memberKey = JSON.stringify(memberIds);
    const generation = ++state.refreshGeneration;
    const connection = bridge.token;
    const isCurrent = () => generation === state.refreshGeneration && bridge.connected &&
      bridge.token === connection && getPlanId() === planId && JSON.stringify(membership.planIds) === memberKey;
    state.selectedPlanId = planId;
    state.problems = [];
    state.loading = true;
    treeView.message = undefined;
    tree.refresh();
    updateActions();
    try {
      let groups;
      if (memberIds) groups = await Promise.all(memberIds.map(async id => { try { return { planId: id, problems: await client.listProblems(id) }; } catch (_) { return { planId: id, problems: [], error: true }; } }));
      const problems = groups ? groups.flatMap(group => group.problems) : await client.listProblems(planId);
      // A previous plan/session may finish after a newer refresh. Never publish
      // stale rows, labels or loading state into the current selection.
      if (!isCurrent()) return state.problems;
      if (!Array.isArray(problems)) throw new Error('TensorTonic returned an unexpected problem list.');
      state.planGroups = groups;
      state.problems = problems.filter(problem => {
        try { normalizeRef(problem); return true; } catch (_) { return false; }
      });
      treeView.description = groups ? `${groups.length} study plans · remote progress` : planId || 'Free problems';
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
        updateActions();
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
    return vscode.workspace.getConfiguration('tensortonic').get('problemView', 'web') === 'web' ? 'web' : 'markdown';
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
    studyStatus.refresh();
    output.appendLine(`TensorTonic problem view is now ${chosen.mode === 'web' ? 'Web' : 'Markdown'} for ${hasWorkspace ? 'this workspace' : 'your user settings'}. Open a problem or use Previous/Next to apply it. Description remains available as Markdown.`);
  }

  async function chooseStudyPlan() {
    if (membership.initialized) return manageStudyPlans();
    const generation = ++state.planPickGeneration;
    const originalPlan = getPlanId();
    const chosen = await planPicker.pick(originalPlan);
    if (!chosen || disposed || generation !== state.planPickGeneration || getPlanId() !== originalPlan) return;
    if (chosen.id === originalPlan) return;
    const target = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('tensortonic').update('studyPlan', chosen.id || '', target);
    if (disposed || generation !== state.planPickGeneration) return;
    invalidateProblems();
    if (bridge.connected) await refresh();
  }

  let connectPromptInProgress = false;
  async function connect() {
    if (connectPromptInProgress) return undefined;
    connectPromptInProgress = true;
    try {
      if (vscode.workspace.isTrusted !== true || vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) throw new Error('Connect requires a trusted local VS Code desktop.');
      // The acquirer owns exact-scope consent and nonblocking Capture/Cancel
      // actions. An action notification here could pause the login browser.
      await bridge.start({ confirmed: true });
      if (!bridge.connected) return;
      try { await refresh(); } catch (error) { if (error.code !== 'AUTH_REQUIRED') throw error; }
      // Notifications can pause the integrated browser during normal login.
      output.appendLine('TensorTonic session connected. Requests use encrypted local session storage independently of optional browser presentation.');
      return { sessionConnected: true, readOnly: bridge.supportsGrading!==true };
    } finally { connectPromptInProgress = false; updateConnection(); }
  }

  async function disconnect() {
    clearSessionPresentation();
    try {
      if (typeof bridge.revoke === 'function') await bridge.revoke();
      else await bridge.stop();
      output.appendLine('Saved session deleted from local secure storage. Existing website login was not revoked.');
    } catch (error) {
      if (error.cleanup) output.appendLine('Session cleanup: ' + JSON.stringify(error.cleanup));
      throw error;
    } finally { updateConnection(); }
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

  async function panelTests(problem, solutionUri) {
    const publicCases = (Array.isArray(problem.testCases) ? problem.testCases : []).filter(item => item && item.isPublic !== false);
    if (!solutionUri || !await fileExists(testsUriFor(solutionUri))) return { tests: { publicCases, userCases: [] } };
    const document = await vscode.workspace.openTextDocument(testsUriFor(solutionUri));
    try {
      const userCases = JSON.parse(document.getText());
      if (!Array.isArray(userCases)) throw new Error();
      return { tests: { publicCases, userCases: userCases.filter(item => !item || item.isPublic !== false) } };
    } catch (_) {
      return { tests: { publicCases, userCases: [] }, testsError: 'The editable test file is not a JSON array. Use Edit test JSON to correct it; unsaved edits are preserved.' };
    }
  }

  async function showDescription(problem, solutionUri, isCurrent = () => true, tab = 'description') {
    if (!isCurrent()) return;
    if (solutionUri) await writeProblemContext(problem, solutionUri);
    if (!isCurrent()) return;
    const rendered = await renderDescription(vscode, problem, { solutionUri, isCurrent });
    if (!isCurrent()) return;
    const tests = await panelTests(problem, solutionUri);
    if (!isCurrent()) return;
    return problemWorkspace.show(panelProblem(problem), { solutionUri, descriptionHtml: rendered.html, ...tests, tab, isCurrent });
  }

  async function openProblem(input) {
    if (!input) return search();
    requireConnection();
    const ref = normalizeRef(input);
    invalidateFocusAction();
    const generation = ++state.openGeneration;
    const presentation = problemWorkspace.capturePresentation();
    const connection = bridge.token;
    const isCurrent = () => !disposed && generation === state.openGeneration && bridge.connected && bridge.token === connection;
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
    await studyLayout.showSolution(document, { isCurrent });
    if (!isCurrent()) return undefined;
    state.lastSolutionUri = uri;
    state.currentProblem = problem;
    const contextUri = await writeProblemContext(problem, uri);
    if (!isCurrent()) return undefined;
    const mode = getProblemView();
    const presentationCurrent = () => isCurrent() && getProblemView() === mode && presentation.closeEpoch === problemWorkspace.capturePresentation().closeEpoch;
    if (mode === 'web') {
      const opened = await interactiveExplanation(problem.ref, { studyNavigation: true, isCurrentNavigation: presentationCurrent });
      if (!presentationCurrent()) return undefined;
      if (!opened || !opened.requested) await showDescription(problem, uri, presentationCurrent);

    } else {
      await showDescription(problem, uri, presentationCurrent);
    }
    if (!isCurrent()) return undefined;
    if (membership.initialized) await membership.recordOpened(problem.ref).catch(showError);
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

  async function description(input, tab = 'description') {
    requireConnection();
    const generation = ++state.openGeneration;
    const connection = bridge.token;
    const presentation = problemWorkspace.capturePresentation();
    const isCurrent = () => !disposed && generation === state.openGeneration && bridge.connected && bridge.token === connection && presentationCurrent(presentation);
    try {
      const ref = await refFrom(input);
      if (!isCurrent()) return;
      let solutionUri;
      if (input instanceof vscode.Uri) solutionUri = input;
      else if (input && input.uri instanceof vscode.Uri) solutionUri = input.uri;
      else if (!input) solutionUri = (await managedDocument(input)).document.uri;
      else if (state.lastSolutionUri) {
        const selected = await managedDocument(state.lastSolutionUri);
        if (problemKey(selected.ref) === problemKey(ref)) solutionUri = selected.document.uri;
      }
      if (!isCurrent()) return;
      let problem;
      try { problem = await client.getProblem(ref); }
      catch (error) { if (!isCurrent()) return; throw error; }
      if (!isCurrent()) return;
      problem.ref = normalizeRef(problem.ref || ref);
      const shown = await showDescription(problem, solutionUri, isCurrent, tab);
      return shown ? problem : undefined;
    } catch (error) { if (!isCurrent()) return; throw error; }
  }

  async function interactiveExplanation(input, { studyNavigation = false, isCurrentNavigation = () => true } = {}) {
    invalidateFocusAction();
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
    if (bridge.connected) {
      if (state.webNavigating) {
        if (studyNavigation) return { ref, target: 'none', requested: false };
        throw new Error('Wait for the owned problem page navigation before opening another page.');
      }
      const epoch = state.sessionEpoch;
      const navigation = {};
      state.webNavigating = navigation;
      updateActions();
      try {
        const previousFocusPage = focusedPage || lastFocusPage;
        const previousWebUrl = state.webRef ? problemUrl(state.webRef) : undefined;
        invalidateFocusAction();
        focusedPage = undefined;
        focusObservation++;
        state.focusReason = 'page-changed';
        const restored = await focusMode.pageChanged();
        if (restored.status === 'restore-pending') throw new Error('Focus mode cleanup is pending. Retry Original view before navigating this owned page.');
        if (!isCurrent() || epoch !== state.sessionEpoch) return;
        await bridge.openProblemPage(url, { viewColumn: studyLayout.problemColumn, onDidChangePage: page => {
          if (disposed || epoch !== state.sessionEpoch) return;
          state.webPageOpen = !page.closed;
          void observeFocusPage(page.closed);
          state.webRef = page.closed ? undefined : page.ref;
          updateActions();
        } });
        if (!isCurrent() || epoch !== state.sessionEpoch) return;
        if (focusRequested && getProblemView() === 'web' && (previousFocusPage || previousWebUrl !== url)) {
          await applyFocusRequest({ expectedUrl: url, previousPage: previousFocusPage, automatic: true, isCurrentNavigation: isCurrent });
        }
        return isCurrent() && epoch === state.sessionEpoch ? { ref, target: 'owned-native', requested: true } : undefined;
      } catch (error) {
        if (!isCurrent()) return;
        if (!studyNavigation) throw error;
        // Keep the existing owned page and dirty editor untouched. Never open a
        // second browser or retry navigation after an uncertain/busy result.
        output.appendLine('Web navigation was unavailable. Showing Markdown; the owned browser and Web preference are unchanged.');
        return { ref, target: 'none', requested: false };
      } finally { if (state.webNavigating === navigation) { state.webNavigating = false; updateActions(); } }
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
    let planId = membership.initialized ? state.activeRef?.planId : getPlanId();
    const connection = bridge.token;
    const generation = ++state.openGeneration;
    const currentKey = problemKey(state.activeRef);
    const isCurrent = () => !disposed && generation === state.openGeneration && bridge.connected && bridge.token === connection && (membership.initialized || getPlanId() === planId) && currentKey === problemKey(state.activeRef);
    let ref = state.activeRef;
    try {
      if (input instanceof vscode.Uri || input?.uri instanceof vscode.Uri) ref = (await managedDocument(input)).ref;
    } catch (error) { if (!isCurrent()) return; throw error; }
    if (!isCurrent()) return;
    if (membership.initialized) planId = ref?.planId;
    let catalogue;
    try { catalogue = await client.listProblems(planId); }
    catch (error) { if (!isCurrent()) return; throw error; }
    if (!isCurrent()) return;
    if (!Array.isArray(catalogue)) throw new Error('TensorTonic returned an unexpected problem list.');
    const targets = navigationTargets(catalogue, ref, { selectedPlanId: planId || '' });
    const target = direction === 'unsolved' ? targets.nextUnsolved : direction < 0 ? targets.previous : targets.next;
    if (!target) {
      await vscode.window.showInformationMessage(direction === 'unsolved' ? 'No later unsolved problem is known in this study plan.' : 'No adjacent problem is available for the current selection. Choose a problem in this study plan.');
      return;
    }
    return openProblem(target);
  }

  function cancelExecution(id) {
    if (!activeExecution || id !== undefined && id !== activeExecution.id) return false;
    activeExecution.controller.abort();
    return true;
  }

  async function execute(action, input) {
    if (bridge.supportsGrading !== true) throw sessionFault('POST_CONTRACT_UNVERIFIED');
    if (executionInProgress) throw new Error('A TensorTonic Run or Submit is already in progress.');
    // Acquire before metadata, test-file or network awaits. A stale completion
    // never releases another operation's cancellation handle.
    executionInProgress = true;
    const operation = { id: crypto.randomBytes(12).toString('hex'), controller: new AbortController() };
    activeExecution = operation;
    updateActions();
    try { return await executeOnce(action, input, operation); }
    finally {
      if (activeExecution === operation) activeExecution = undefined;
      executionInProgress = false;
      updateActions();
    }
  }

  async function executeOnce(action, input, operation) {
    requireConnection();
    const connection = bridge.token;
    const sessionEpoch = state.sessionEpoch;
    const sameSession = () => {
      synchronizeSession();
      return sessionEpoch === state.sessionEpoch && bridge.connected && bridge.token === connection;
    };
    const presentation = problemWorkspace.capturePresentation();
    const { document, ref } = await managedDocument(input);
    if (!recognizedSolution(document, { readRef })) throw new Error('TensorTonic Run and Submit require a recognized Python solution file.');
    operation.uri = document.uri;
    updateActions();
    const code = document.getText();
    const check = () => {
      requireConnection();
      if (!sameSession()) throw new Error('The session connection changed. Review the selected account before running or submitting again.');
      if (operation.controller.signal.aborted) throw sessionFault('CANCELED');
      if (state.webNavigating) throw new Error('Wait for the owned problem page to finish navigating before Run or Submit.');
      if (displayMismatch(ref)) throw new Error(state.webRef ? 'The website is showing another problem. Reopen this solution from the study sidebar to align it before Run or Submit.' : 'The owned website page has no verified problem target. Finish its navigation, reopen this solution from the study sidebar, or close that browser tab before Run or Submit.');
    };
    check();
    const problem = await client.getProblem(ref, { signal: operation.controller.signal });
    check();
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
    check();
    const owner = panelProblem(problem);
    // Create a results location before dispatch only when no auxiliary owner is
    // visible and the user has not closed/navigated it during preflight.
    let resultPresentation = presentation;
    if (!presentation.selectedKey && presentationCurrent(presentation)) {
      const tests = await panelTests(problem, document.uri);
      if (presentationCurrent(presentation)) {
        problemWorkspace.show(owner, { solutionUri: document.uri, ...tests, tab: 'results' });
        resultPresentation = problemWorkspace.capturePresentation();
      }
    }
    problemWorkspace.setExecution(owner, { id: operation.id, action, title: `${action === 'submit' ? 'Submitting' : 'Running public cases'} · ${problem.title || ref.slug}` });
    let result, snapshot;
    try {
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `TensorTonic ${action === 'submit' ? 'Submit' : 'Run'} · ${problem.title || ref.slug}`, cancellable: true }, async (_progress, cancellation) => {
        const listener = cancellation?.onCancellationRequested(() => operation.controller.abort());
        if (cancellation?.isCancellationRequested) operation.controller.abort();
        try {
          check();
          snapshot = freshness.capture({ action, problem: problem.ref, solutionUri: document.uri.toString(), solutionText: code, testCases });
          const options = { signal: operation.controller.signal };
          return await (action === 'submit' ? client.submit(problem, code, options) : client.run(problem, code, testCases, options));
        } finally { listener?.dispose(); }
      });
    } catch (error) {
      if (!sameSession()) return undefined;
      problemWorkspace.recordResult(owner, action, { status: 'error', message: 'No confirmed grading result was received. Check TensorTonic before submitting again.', error: error instanceof Error ? error.message : String(error) }, { operationId: operation.id, localError: true, presentation: resultPresentation });
      throw error;
    }
    if (!sameSession()) return undefined;
    problemWorkspace.recordResult(owner, action, result, { operationId: operation.id, presentation: resultPresentation, freshness: resultFreshnessLabel(snapshot, {status: 'unchanged'}) });
    resultSnapshots.set(JSON.stringify([document.uri.toString(), action]), { owner, action, snapshot, document, problem, result, operationId: operation.id });
    void updateFreshness();
    if (action === 'submit') refresh().catch(showError);
    return result;
  }

  function readRefSafely(document) { try { return readRef(document.getText()); } catch (_) { return undefined; } }
  let freshnessGeneration = 0;
  async function updateFreshness() {
    const generation = ++freshnessGeneration, epoch = state.sessionEpoch;
    for (const entry of resultSnapshots.values()) {
      let testCases;
      if (entry.action === 'run') {
        try { const uri = testsUriFor(entry.document.uri); testCases = await fileExists(uri) ? JSON.parse((await vscode.workspace.openTextDocument(uri)).getText()) : entry.problem.testCases; } catch (_) { testCases = undefined; }
      }
      if (generation !== freshnessGeneration || epoch !== state.sessionEpoch || disposed) return;
      const uri = entry.document.uri.toString();
      const document = closedDocuments.has(uri) ? undefined : knownDocuments.get(uri) || (vscode.workspace.textDocuments || []).find(item => item.uri.toString() === uri && !item.isClosed);
      const current = { action: entry.action, problem: document ? readRefSafely(document) : entry.problem.ref, solutionUri: uri, solutionText: document?.getText(), testCases };
      problemWorkspace.updateFreshness(entry.owner, entry.action, resultFreshnessLabel(entry.snapshot, freshness.compare(entry.snapshot, current)), entry.operationId);
    }
  }
  async function manageStudyPlans() { const result = await membership.manage(); if (result?.status === 'committed' && bridge.connected) await refresh(); return result; }
  async function removeStudyPlan(input) { const id = typeof input === 'string' ? input : input?.planId; if (!id) return; await membership.remove(id); if (bridge.connected) await refresh(); }
  async function resumeStudyPlan(input) {
    requireConnection();
    const id = typeof input === 'string' ? input : input?.planId; if (!id) return;
    const generation = ++state.openGeneration, epoch = state.sessionEpoch, token = bridge.token;
    const membershipRevision = membership.state?.revision, activeKey = problemKey(state.activeRef);
    const current = () => !disposed && bridge.connected && bridge.token === token && state.sessionEpoch === epoch && generation === state.openGeneration && membership.state?.revision === membershipRevision && problemKey(state.activeRef) === activeKey;
    const rows = await client.listProblems(id); if (!current()) return;
    const ref = membership.getResumeRef(id);
    const match = ref && rows.find(row => row.slug === ref.slug && row.planId === id);
    if (match) return openProblem(match);
    const chosen = await vscode.window.showQuickPick(rows.map(row => ({label:row.title || row.slug, ref:row})), { title: 'Choose a problem to resume' });
    if (chosen && current()) return openProblem(chosen.ref);
  }

  async function discussSelectedFailure(input, selectedAction) {
    const {document,ref} = await managedDocument(input), epoch = state.sessionEpoch;
    const entries = [...resultSnapshots.values()].filter(entry => entry.document.uri.toString() === document.uri.toString() && findProblemIndex([entry.problem.ref], ref) === 0 && (!selectedAction || selectedAction === entry.action));
    const items = [];
    for (const entry of entries) {
      const raw = entry.result?.data && typeof entry.result.data === 'object' ? entry.result.data : entry.result;
      const cases = raw?.tests || raw?.testCases || raw?.results || [];
      if (!Array.isArray(cases)) continue;
      for (const failure of cases.slice(0,200)) {
        try { selectedFailureContext(failure,{explicit:true,problemRef:ref}); } catch (_) { continue; }
        items.push({label:String(failure.name || failure.id || 'Failed case').slice(0,120),description:entry.action === 'run' ? 'Run · public/user case' : 'Submit · public/user case',entry,failure});
      }
    }
    if (!items.length) return vscode.window.showInformationMessage('No explicitly public or user-provided failed case is available to discuss. Hidden grading details are not shared.');
    const selected = await vscode.window.showQuickPick(items,{title:'Discuss one selected failed case',placeHolder:'Only this case is included; nothing is run or submitted'});
    if (!selected || epoch !== state.sessionEpoch || disposed || ![...resultSnapshots.values()].includes(selected.entry)) return;
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('workbench.action.chat.open')) throw new Error('VS Code Chat is unavailable. Inspect the selected failure locally.');
    if (epoch !== state.sessionEpoch || disposed || ![...resultSnapshots.values()].includes(selected.entry) || findProblemIndex([ref], readRef(document.getText())) !== 0) return;
    const freshnessState = freshness.compare(selected.entry.snapshot,{action:selected.entry.action,problem:ref,solutionUri:document.uri.toString(),solutionText:document.getText(),testCases:undefined});
    await vscode.commands.executeCommand('workbench.action.chat.open',{mode:'agent',isPartialQuery:true,query:selectedFailureContext(selected.failure,{explicit:true,problemRef:ref,stale:freshnessState.status!=='unchanged'})});
  }
  async function applyFocusRequest({ expectedUrl, previousPage, automatic = false, isCurrentNavigation = () => true } = {}) {
    if (!focusRequested || disposed) return focusMode.state;
    invalidateFocusAction();
    const action = focusAction, epoch = state.sessionEpoch, navigation = state.openGeneration, card = state.cardGeneration;
    const controller = new AbortController();
    const current = () => focusRequested && !disposed && !controller.signal.aborted && action === focusAction && epoch === state.sessionEpoch && navigation === state.openGeneration && card === state.cardGeneration && isCurrentNavigation() && (!automatic || getProblemView() === 'web');
    const trace = focusDiagnostics.begin(automatic);
    const operation = { enabled: true, automatic, controller, trace };
    focusRecovery = operation;
    studyStatus.refresh();
    try {
      let page;
      trace.emit('lookup', 'start');
      try {
        const display = focusDisplay();
        page = !automatic && typeof display.recoverFocusPage === 'function'
          ? await display.recoverFocusPage({ signal: controller.signal, onDiagnostic: trace.record })
          : await focusPort.getPage({ signal: controller.signal, onDiagnostic: trace.record });
      } catch (error) { trace.emit('lookup', 'fail', diagnosticErrorCode(error)); }
      if (!current()) { trace.emit('result', 'canceled'); return focusMode.state; }
      trace.emit('lookup', page ? 'ok' : 'fail', page ? undefined : 'no-page');
      if (expectedUrl && page && page.url !== expectedUrl) { trace.emit('url', 'fail', 'mismatch'); page = undefined; }
      // A title/state notification or same-document open must not re-arm the
      // navbar after its conservative mutation guard has revoked it.
      if (automatic && page && previousPage && ['id','url','documentId','frameId'].every(key => page[key] === previousPage[key])) { trace.emit('same-document', 'skip'); return focusMode.state; }
      if (automatic && page && typeof focusDisplay().waitForFocusReady === 'function') {
        trace.emit('readiness', 'start');
        try { page = await focusDisplay().waitForFocusReady(page, { signal: controller.signal, onDiagnostic: trace.record }); trace.emit('readiness', 'ok'); }
        catch (error) { trace.emit('readiness', 'fail', diagnosticErrorCode(error)); page = undefined; }
        if (!current()) { trace.emit('result', 'canceled'); return focusMode.state; }
        if (expectedUrl && page && page.url !== expectedUrl) { trace.emit('url', 'fail', 'mismatch'); page = undefined; }
      }
      state.focusReason = !page ? 'no-owned-page' : undefined;
      focusedPage = page;
      if (page) lastFocusPage = page;
      focusObservation++;
      trace.emit('controller', 'start');
      const result = await focusMode.setEnabled(true, { page, signal: controller.signal, onDiagnostic: trace.record });
      trace.emit('result', current() ? result.status : 'canceled');
      if (automatic && current() && result.status !== 'applied') output.appendLine('Focus diagnostic: ' + trace.summary());
      return result;
    } finally {
      if (focusRecovery === operation) focusRecovery = undefined;
      studyStatus.refresh();
    }
  }

  async function toggleFocusMode() {
    // The button toggles user intent, not a temporary navigation/cleanup gap.
    // Retrying uncertain cleanup is always an explicit Off, never reapply.
    const enabled = focusMode.state.status === 'restore-pending' ? false : !focusRequested;
    focusRequested = enabled;
    invalidateFocusAction();
    let result;
    if (!enabled) {
      lastFocusPage = undefined;
      focusedPage = undefined; focusObservation++;
      state.focusReason = undefined;
      result = await focusMode.setEnabled(false);
    } else if (state.webNavigating) {
      // An explicit On during the current authorized navigation is applied only
      // after that destination has completed and passed its own fresh proof.
      state.focusReason = 'page-changed';
      result = focusMode.state;
      studyStatus.refresh();
    } else {
      result = await applyFocusRequest();
    }
    result = focusMode.state;
    if (focusRequested !== enabled || disposed) return Object.freeze({ ...result, enabled: focusRequested });
    output.appendLine(result.status === 'applied'
      ? 'Focus mode: verified controls and guarded top navigation capsule hidden. New Web problems will be checked independently.'
      : result.status === 'off' && !focusRequested ? 'Focus mode: original website styles restored.'
      : result.status === 'restore-pending' ? 'Focus mode: stylesheet restoration is pending. Retry Original view or close the owned problem tab.'
      : 'Focus preference is on, but application to the current page is not confirmed. Website controls remain visible until verification succeeds.');
    return Object.freeze({ ...result, enabled: focusRequested });
  }

  async function smokeTest(options) {
    const result = { activated: true, connected: bridge.connected, readOnly: bridge.supportsGrading!==true, transport: 'direct-https', viewId: VIEW_ID, commands: COMMANDS.slice(), planId: getPlanId() || null };
    if (bridge.connected) {
      result.accountVerified=typeof bridge.checkStoredSession==='function'?await bridge.checkStoredSession({signal:options?.signal}):false;
      const diagnosticClient=new TensorTonicClient((path,requestOptions)=>bridge.request(path,{...requestOptions,...(options?.signal?{signal:options.signal}:{})}));
      const problems = await diagnosticClient.listProblems(getPlanId());
      result.problemCount = problems.length;
      const ref = options && options.ref ? normalizeRef(options.ref) : problems[0];
      if (ref) {
        const problem = await diagnosticClient.getProblem(ref);
        result.problem = { slug: ref.slug, title: problem.title, hasStatement: !!problem.description, hasStarterCode: typeof problem.starterCode === 'string' && problem.starterCode.length > 0, testCaseCount: Array.isArray(problem.testCases) ? problem.testCases.length : 0 };
      }
    }
    output.appendLine(JSON.stringify(result, null, 2));
    return result;
  }

  studyEnvironment = new StudyEnvironmentUI(vscode, context, { getSessionEpoch: () => state.sessionEpoch });
  context.subscriptions.push(studyEnvironment);
  let environmentGeneration = 0;
  async function refreshStudyEnvironment() {
    const generation = ++environmentGeneration;
    const result = await studyEnvironment.status();
    if (disposed || generation !== environmentGeneration) return;
    state.environment = result;
    studyStatus.refresh();
    tree.refresh();
    updateActions();
    revealCurrentProblem();
  }
  if (typeof studyEnvironment.onDidChange === 'function') context.subscriptions.push(studyEnvironment.onDidChange(() => { void refreshStudyEnvironment().catch(() => {}); }));
  // Metadata + selected-interpreter inspection only. No automatic setup,
  // imports, downloads, terminal activation or interpreter selection.
  void refreshStudyEnvironment().catch(() => {});
  async function environmentAction(action) {
    try { return await studyEnvironment[action](); }
    finally { await refreshStudyEnvironment(); }
  }
  const studyWorkspace = new StudyWorkspace(vscode, context, { showStudyPlan, offerEnvironment: () => studyEnvironment.offer().catch(showError) });

  const handlers = {
    connect, disconnect, openProblem, search, refresh, description, interactiveExplanation, offlineExploration, openOriginalInVSCode: interactiveExplanation, openTests, openInBrowser,
    chooseStudyPlan, chooseProblemView, showStudyPlan,
    testsView: input => description(input, 'tests'), resultsView: input => description(input, 'results'), cancelExecution: () => cancelExecution(),
    startStudying: () => studyWorkspace.start(),
    changeStudyFolder: () => studyWorkspace.start({ chooseFolder: true }),
    setupStudyEnvironment: () => environmentAction('setup'),
    useStudyEnvironment: () => environmentAction('use'),
    repairStudyEnvironment: () => environmentAction('repair'),
    run: input => execute('run', input), submit: input => execute('submit', input), smokeTest,
    gradingStatus: () => vscode.window.showInformationMessage(bridge.supportsGrading===true ? 'Explicit Python Run and Submit use direct HTTPS. Canceled or uncertain actions are never replayed.' : 'Run and Submit are unavailable in this read-only candidate. Grading compatibility must be verified before they return.'),
    manageStudyPlans, removeStudyPlan, resumeStudyPlan, discussSelectedFailure, toggleFocusMode,
    showStudyStatus: () => vscode.commands.executeCommand(`${STATUS_VIEW_ID}.focus`),
    openAgentContext, discussWithAgent, discussWithCodex,
    previousProblem: input => navigateProblem(-1, input), nextProblem: input => navigateProblem(1, input), nextUnsolved: () => navigateProblem('unsolved'),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    context.subscriptions.push(vscode.commands.registerCommand(`tensortonic.${name}`, async (...args) => {
      try { return await handler(...args); }
      catch (error) { if(error.code!=='CANCELED')showError(error); return undefined; }
    }));
  }
  context.subscriptions.push(vscode.languages.registerCodeLensProvider([{ scheme: 'file', language: 'python' }, { scheme: 'file', language: 'sql' }, { scheme: 'file', language: 'cpp' }, { scheme: 'file', pattern: '**/*.cu' }], new SolutionCodeLensProvider(bridge.supportsGrading===true)));
  function rememberSelectedSolution(editor) {
    if (!editor || editor.document.uri.scheme !== 'file') return;
    try {
      const selectedRef = recognizedSolution(editor.document, { readRef });
      if (!selectedRef) { updateActions(); return; }
      if (JSON.stringify(selectedRef) !== JSON.stringify(state.activeRef)) state.cardGeneration++;
      knownDocuments.set(editor.document.uri.toString(), editor.document);
      state.activeRef = selectedRef;
      state.lastSolutionUri = editor.document.uri;
      tree.refresh();
      updateActions();
      revealCurrentProblem();
    } catch (_) { updateActions(); /* Description, tests and chat must not replace the selection. */ }
  }
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(rememberSelectedSolution));
  rememberSelectedSolution(vscode.window.activeTextEditor);
  for (const name of ['onDidOpenTextDocument', 'onDidChangeTextDocument', 'onDidCloseTextDocument']) {
    if (typeof vscode.workspace[name] !== 'function') continue;
    context.subscriptions.push(vscode.workspace[name](event => {
      const document = event.document || event;
      if (document.uri) {
        if (name === 'onDidCloseTextDocument') { knownDocuments.delete(document.uri.toString()); closedDocuments.add(document.uri.toString()); }
        else { knownDocuments.set(document.uri.toString(), document); closedDocuments.delete(document.uri.toString()); }
      }
      updateActions();
      void updateFreshness();
    }));
  }
  let shutdown;stopActiveSession=()=>shutdown??=(async()=>{
    disposed = true;
    focusRequested = false; lastFocusPage = undefined;
    invalidateFocusAction();
    try { await focusMode.dispose(); }
    finally { await bridge.dispose().catch(()=>{}); }
  })();
  context.subscriptions.push({ dispose() { void stopActiveSession(); } });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('tensortonic.problemView')) {
      if (focusRecovery?.automatic && getProblemView() !== 'web') {
        invalidateFocusAction(); focusedPage = undefined; focusObservation++;
        void focusMode.pageChanged();
      }
      studyStatus.refresh();
    }
    if (event.affectsConfiguration('tensortonic.difficultyDisplay')) { state.difficultyDisplay = vscode.workspace.getConfiguration('tensortonic').get('difficultyDisplay', 'text'); tree.refresh(); }
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
  const studyWorkspaceReady = studyWorkspace.restorePendingStudyView().catch(() => {
    output.appendLine('The study sidebar could not be restored. Use Show study plan sidebar to open it.');
    return false;
  });
  // Restore encrypted state only: no startup browser, HTTP, login or migration.
  const sessionReady=Promise.resolve().then(()=>typeof bridge.restore==='function'?bridge.restore():false).catch(()=>{
    output.appendLine('The saved session could not be restored. Use Connect session to retry; no plaintext fallback was used.');return false;
  }).finally(updateConnection);
  // Do not export a vault, SecretStorage object, raw transport or CDP capability.
  return { sessionStatus:()=>Object.freeze({connected:bridge.connected,cleanupPending:!!bridge.cleanupPending,ownedResources:!!bridge.hasOwnedResources,readOnly:bridge.supportsGrading!==true}), presentationStatus: presentationSnapshot, focusDiagnostics: focusDiagnostics.snapshot, diagnoseStoredSession: options => bridge.diagnoseStoredSession(options), sessionReady, refresh, openProblem, smokeTest, currentContext, discussWithAgent, studyWorkspaceReady, commands: COMMANDS.slice() };
}

function deactivate() {return stopActiveSession();}

module.exports = { activate, deactivate, escapeHtml, htmlToText, normalizeRef, readRef, problemUrl, testsUriFor, contextUriFor };
