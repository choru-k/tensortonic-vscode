'use strict';

const FOCUS_SCOPE = 'Focus preference stays on across verified extension-opened Web problems until Off. Extension reload or a session change resets it. Browser refresh/navigation clears application without automatically hiding the changed page. It changes only the verified website Prev/Next links, desktop/narrow Browse problems launchers, floating Ask Toni button and guarded top navigation capsule on the extension-owned Web problem page. The capsule reappears conservatively if its content or surrounding structure changes.';
const FOCUS_RESET_REASONS = new Map([
  ['reload-default', 'Focus mode starts off after an extension reload.'],
  ['page-changed', 'Focus application was cleared after the owned Web page changed, reloaded, or closed.'],
  ['session-changed', 'Focus mode was reset after the session changed.'],
  ['no-owned-page', 'No extension-owned Web problem page is open.'],
]);

const ENVIRONMENT = new Map([
  ['missing', {
    description: 'Create', icon: 'add', context: 'Create',
    command: 'tensortonic.setupStudyEnvironment', title: 'Create study environment',
    detail: 'Review setup of the dedicated study Python environment. The existing setup flow asks for confirmation before creating it or installing packages.',
  }],
  ['use', {
    description: 'Use', icon: 'snake', context: 'Use',
    command: 'tensortonic.useStudyEnvironment', title: 'Use study environment',
    detail: 'Select the existing managed study Python environment for this study folder. Existing terminals are unchanged.',
  }],
  ['repair', {
    description: 'Repair', icon: 'tools', context: 'Repair',
    command: 'tensortonic.repairStudyEnvironment', title: 'Repair study environment',
    detail: 'Review repair of the extension-owned study Python environment. The existing repair flow asks for confirmation before making changes.',
  }],
  ['ready', {
    description: 'Ready', icon: 'check', context: 'Ready',
    detail: 'The recorded study Python environment is selected for this study folder. Existing terminals are unchanged; open a new Python terminal when terminal activation is needed.',
  }],
  ['checking', {
    description: 'Checking', icon: 'loading', context: 'Checking',
    detail: 'Study environment status is being checked or an explicit environment action is in progress.',
  }],
  ['not-study-window', {
    description: 'Choose workspace', icon: 'folder-opened', context: 'Choose',
    command: 'tensortonic.startStudying', title: 'Choose study workspace',
    detail: 'Choose a TensorTonic study workspace before using a study environment.',
  }],
  ['unavailable', {
    description: 'Unavailable', icon: 'info', context: 'Unavailable',
    detail: 'Study environment status is unavailable. Use the existing environment commands after the study workspace is ready.',
  }],
]);

const ENVIRONMENT_REASONS = new Map([
  ['unsupported-window', 'Study environment setup requires a trusted local desktop study workspace.'],
  ['inspection-failed', 'The managed study environment could not be inspected.'],
  ['unmanaged-environment', 'The environment could not be confirmed as extension-owned.'],
  ['health-unknown', 'Recorded environment health is incomplete; review repair before selecting it.'],
  ['python-extension-missing', 'The Python extension is needed to select the study environment.'],
  ['python-inactive', 'Select Use to activate Python and select the existing study environment.'],
  ['selection-api-unavailable', 'The Python extension cannot currently confirm or update the selected interpreter.'],
  ['selection-unknown', 'The selected Python interpreter could not be confirmed.'],
  ['selection-unavailable', 'The Python extension could not confirm the selected study interpreter.'],
]);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function focusPresentation(snapshot) {
  const focus = record(snapshot.focus);
  const display = record(snapshot.display);
  const enabled = focus.enabled === true;
  const open = display.open === true;
  const confirmed = enabled && focus.status === 'applied' && focus.applied === true &&
    open && display.navigating !== true && display.mismatch !== true;
  const details = [];
  let description;
  let icon = 'circle-outline';
  let title = 'Toggle Focus mode';

  if (focus.status === 'restore-pending') {
    description = 'Cleanup pending';
    icon = 'history';
    title = 'Retry Focus mode cleanup';
    details.push('Restoration of the owned page styles is pending. Select to retry Original view cleanup.');
  } else if (focus.busy === true) {
    description = 'Updating';
    icon = 'loading';
    details.push('Focus mode is updating. Current application is not yet confirmed.');
  } else if (!enabled) {
    description = 'Off';
    details.push(FOCUS_RESET_REASONS.get(focus.reason) || 'Focus mode is off.');
  } else if (!open) {
    description = 'On · No owned page';
    icon = 'info';
    details.push('Focus mode is on, but no extension-owned Web problem page is open. Current application is not confirmed.');
  } else if (display.navigating === true) {
    description = 'On · Navigating';
    icon = 'loading';
    details.push('The owned Web page is navigating. Current application is not confirmed.');
  } else if (display.mismatch === true) {
    description = 'On · Page mismatch';
    icon = 'info';
    details.push('The owned Web page does not match the current problem. Current application is not confirmed.');
  } else if (confirmed) {
    description = display.otherBrowserActive === true ? 'On · Other tab active'
      : snapshot.problemView === 'markdown' ? 'On · Web tab only' : 'On · Applied';
    icon = 'check';
    details.push('Focus mode is applied to the extension-owned Web problem page.');
  } else if (focus.status === 'off') {
    description = 'On · Not applied';
    icon = 'info';
    details.push('Focus preference is still on. No styles are confirmed on the current page; the next extension-opened Web problem will be verified independently.');
  } else {
    description = 'On · Unavailable';
    icon = 'info';
    details.push('Focus mode is on, but application to the owned Web page could not be confirmed. Website controls may remain visible.');
  }

  if (!open && description !== 'On · No owned page') {
    details.push('No extension-owned Web problem page is open.');
  }
  if (open && display.navigating === true && description !== 'On · Navigating') {
    details.push('The owned Web page is navigating.');
  }
  if (open && display.mismatch === true && description !== 'On · Page mismatch') {
    details.push('The owned Web page does not match the current problem.');
  }
  if (display.otherBrowserActive === true) {
    details.push('Another browser tab is active. Focus mode never changes that other tab; only the extension-owned Web page can be styled.');
  }
  if (snapshot.problemView === 'markdown') {
    details.push('Markdown is the default for future problem opens. It is a local representation and is not styled by website Focus mode; an existing owned Web tab may remain open.');
  }
  if (focus.status === 'awaiting-dom-verification') {
    details.push('The fixed website controls have not been verified for Focus mode.');
  }
  details.push(FOCUS_SCOPE);
  return { description, icon, title, detail: details.join('\n') };
}

// This provider only presents a synchronous host DTO. It never discovers pages,
// checks Python, runs commands, or reads settings while rendering or refreshing.
class StudyStatusProvider {
  constructor(vscode, { getSnapshot }) {
    this.vscode = vscode;
    this.getSnapshot = getSnapshot;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.disposed = false;
    this.rebuild();
  }

  row(label, id, context, description, icon, detail, command) {
    const item = new this.vscode.TreeItem(label, this.vscode.TreeItemCollapsibleState.None);
    item.id = `tensortonic:status:${id}`;
    item.contextValue = context;
    item.description = description;
    item.iconPath = new this.vscode.ThemeIcon(icon);
    item.tooltip = `${label}: ${description}\n${detail}`;
    item.accessibilityInformation = { label: `${label}, ${description}. ${detail.replace(/\n/g, ' ')}` };
    if (command) item.command = command;
    return item;
  }

  rebuild() {
    const snapshot = record(this.getSnapshot());
    const focus = focusPresentation(snapshot);
    const mode = snapshot.problemView === 'markdown' ? 'Markdown' : 'Web';
    const environment = record(snapshot.environment);
    const checking = !environment.state || environment.reason === 'operation-in-progress' || environment.reason === 'stale';
    const state = ENVIRONMENT.get(checking ? 'checking' : environment.state) || ENVIRONMENT.get('unavailable');
    const environmentCommand = state.command && environment.command === state.command
      ? { command: state.command, title: state.title } : undefined;
    const reason = ENVIRONMENT_REASONS.get(environment.reason);
    this.summaryText = `Focus ${focus.description} · ${mode}`;
    this.roots = [
      this.row('Focus mode', 'focus', 'tensortonicStatusFocus', focus.description, focus.icon, focus.detail,
        { command: 'tensortonic.toggleFocusMode', title: focus.title }),
      this.row('Problem view', 'problem-view', 'tensortonicStatusProblemView', mode,
        mode === 'Markdown' ? 'markdown' : 'browser',
        `${mode} is the default for future explicit problem opens. Markdown changes only the local problem representation. Changing this setting does not close or restyle an existing owned Web tab.`,
        { command: 'tensortonic.chooseProblemView', title: 'Choose problem view' }),
      this.row('Study environment', 'environment', `tensortonicStatusEnvironment${state.context}`,
        state.description, state.icon, [state.detail, reason].filter(Boolean).join('\n'), environmentCommand),
    ];
  }

  refresh() {
    if (this.disposed) return;
    this.rebuild();
    this.emitter.fire(undefined);
  }

  get summary() { return this.summaryText; }
  getTreeItem(element) { return element; }
  getChildren(element) { return element || this.disposed ? [] : this.roots; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.roots = [];
    this.summaryText = '';
    this.emitter.dispose();
  }
}

module.exports = { StudyStatusProvider };
