'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StudyEnvironmentUI } = require('../src/study-environment-ui');
const { STUDY_FOLDER_KEY } = require('../src/study-workspace');
const uri = file => ({ scheme: 'file', authority: '', fsPath: file, toString: () => 'file://' + file });
function emitter() {
  const listeners = new Set();
  return { event: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    fire: value => { for (const listener of [...listeners]) listener(value); }, get size() { return listeners.size; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function managedReady(h) {
  h.inspected = { exists: true, managed: true, ready: true, marker: { state: 'ready' },
    environmentPath: '/extension-storage/python-envs/id', interpreterPath: '/extension-storage/python-envs/id/bin/python' };
  return h.inspected;
}
function harness(options = {}) {
  const folder = uri('/study');
  const state = new Map([[STUDY_FOLDER_KEY, folder.toString()]]);
  const h = { state, calls: [], prompts: [], choices: ['Set up study environment'], cancelled: false,
    inspected: { exists: false, managed: false }, active: '/system/python' };
  h.events = { workspace: emitter(), configuration: emitter(), extensions: emitter(), active: emitter() };
  const environments = {
    async updateActiveEnvironmentPath(interpreter, scope) { h.calls.push(['select', interpreter, scope]); if (h.onSelect) return h.onSelect(interpreter, scope); h.active = interpreter; h.events.active.fire({ path: interpreter, resource: scope }); },
    async getActiveEnvironmentPath(scope) { h.calls.push(['active', scope]); return h.onActive ? h.onActive(scope) : { path: h.active }; },
    onDidChangeActiveEnvironmentPath: h.events.active.event,
  };
  h.python = { isActive: true, exports: { environments }, async activate() { h.calls.push(['activate']); if (h.onActivate) return h.onActivate(); this.isActive = true; return this.exports; } };
  h.vscode = {
    UIKind: { Desktop: 1 }, ProgressLocation: { Notification: 15 }, env: { uiKind: 1 },
    Uri: { parse: text => uri(text.replace('file://', '')) },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: folder }], onDidChangeWorkspaceFolders: h.events.workspace.event,
      onDidGrantWorkspaceTrust: () => ({ dispose() {} }), onDidChangeConfiguration: h.events.configuration.event },
    extensions: { getExtension: () => h.python, onDidChange: h.events.extensions.event },
    commands: { async executeCommand(...args) { h.calls.push(['command', ...args]); } },
    window: {
      async showInformationMessage(...args) { h.prompts.push(args); if (h.onPrompt) return h.onPrompt(args); return h.choices.shift(); },
      async withProgress(options, callback) {
        h.calls.push(['progress', options]);
        return callback({ report: value => h.calls.push(['report', value]) }, {
          isCancellationRequested: h.cancelled,
          onCancellationRequested: callback => { h.cancel = callback; return { dispose() {} }; },
        });
      },
    },
  };
  h.context = { globalStorageUri: uri('/extension-storage'), globalState: {
    get: key => state.get(key), async update(key, value) { h.calls.push(['save', key, value]); state.set(key, value); },
  } };
  h.environment = {
    async inspect() { h.calls.push(['inspect']); return h.onInspect ? h.onInspect() : h.inspected; },
    async ensure(options) {
      h.calls.push(['ensure', options]);
      if (h.onEnsure) return h.onEnsure(options);
      if (options.signal.aborted) { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
      return { interpreterPath: '/extension-storage/python-envs/id/bin/python', environmentPath: '/extension-storage/python-envs/id', reused: false, pythonVersion: '3.13.1', packages: ['torch', 'numpy'] };
    },
  };
  h.ui = new StudyEnvironmentUI(h.vscode, h.context, { ...options, factory: value => { h.factoryOptions = value; return h.environment; } });
  return h;
}
test('constructing setup controller is inert; consent cancel starts no process or settings writes', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  h.choices = [undefined]; assert.equal((await h.ui.offer()).status, 'cancelled');
  assert.deepEqual(h.calls, [['inspect']]);
  assert.match(h.prompts[0][1].detail, /PyPI/);
  assert.match(h.prompts[0][1].detail, /Existing .venv folders/);
});
test('explicit consent creates private environment and selects only the exact study folder via Python API', async () => {
  const h = harness(); const result = await h.ui.setup(); assert.equal(result.status, 'ready');
  assert.deepEqual(h.factoryOptions, { managedRoot: '/extension-storage/python-envs', workspaceRoot: '/study' });
  const ensure = h.calls.find(x => x[0] === 'ensure')[1]; assert.equal(ensure.confirmed, true);
  const selected = h.calls.find(x => x[0] === 'select'); assert.equal(selected[2], h.vscode.workspace.workspaceFolders[0].uri);
  assert.ok(!h.calls.some(x => x[0] === 'command'));
  assert.equal(h.state.get(h.ui.readyKey(uri('/study'))).selected, true);
});
test('completed setup exposes Ready without waiting for an informational notification to close', async () => {
  const h = harness(), notification = deferred();
  h.onPrompt = args => args[0].startsWith('TensorTonic study Python is ready:') ? notification.promise : 'Set up study environment';
  h.onEnsure = async () => { const inspected = managedReady(h); return { ...inspected, packages: ['torch', 'numpy'] }; };
  const pending = h.ui.setup();
  try {
    const result = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve('still-running')))]);
    assert.notEqual(result, 'still-running');
    assert.equal(result.status, 'ready');
    assert.equal(h.ui.running, undefined);
    assert.equal((await h.ui.status()).state, 'ready');
  } finally { notification.resolve(); await pending; h.ui.dispose(); }
});
test('ordinary development, untrusted, remote, multi-root and saved-workspace windows do not run setup', async () => {
  for (const change of [h => h.state.clear(), h => { h.vscode.workspace.isTrusted = false; }, h => { h.vscode.env.remoteName = 'ssh'; }, h => { h.vscode.workspace.workspaceFolders.push({ uri: uri('/other') }); }, h => { h.vscode.workspace.workspaceFile = uri('/study.code-workspace'); }]) {
    const h = harness(); change(h); assert.equal((await h.ui.setup()).status, 'not-study-window'); assert.deepEqual(h.calls, []);
  }
});
test('missing Python extension only offers a normal extension search; no install/download happens', async () => {
  const h = harness(); h.python = undefined; h.choices = ['Find Python extension'];
  assert.equal((await h.ui.setup()).status, 'python-extension-missing');
  assert.ok(h.calls.some(x => x[0] === 'command' && x[1] === 'workbench.extensions.search'));
  assert.ok(!h.calls.some(x => x[0] === 'ensure' || x[0] === 'select'));
});
test('setup failure never selects interpreter or marks ready and can be retried', async () => {
  const h = harness(); h.onEnsure = async () => { throw new Error('Synthetic download failure'); };
  await assert.rejects(h.ui.setup(), /download/); assert.ok(!h.calls.some(x => x[0] === 'select' || x[0] === 'save'));
  h.onEnsure = undefined; h.choices = ['Set up study environment']; assert.equal((await h.ui.setup()).status, 'ready');
});
test('cancel before work and disposal during work prevent selection', async () => {
  const h = harness(); h.cancelled = true; assert.equal((await h.ui.setup()).status, 'cancelled');
  assert.ok(!h.calls.some(x => x[0] === 'select'));
  const other = harness(); let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  other.onEnsure = options => new Promise((resolve, reject) => { entered(); options.signal.addEventListener('abort', () => { const e = new Error('cancel'); e.name = 'AbortError'; reject(e); }); });
  const pending = other.ui.setup(); await ready; other.ui.dispose(); assert.equal((await pending).status, 'cancelled');
  assert.ok(!other.calls.some(x => x[0] === 'select' || x[0] === 'save'));
});
test('workspace/trust change while setup runs cannot select or persist readiness', async () => {
  const h = harness(); h.onEnsure = async () => { h.vscode.workspace.isTrusted = false; return { interpreterPath: '/managed/python' }; };
  assert.equal((await h.ui.setup()).status, 'cancelled'); assert.ok(!h.calls.some(x => x[0] === 'select' || x[0] === 'save'));
});
test('missing selection API reports actual limitation instead of writing defaultInterpreterPath', async () => {
  const h = harness(); h.python.exports = {}; h.choices = ['Set up study environment', 'Select interpreter'];
  assert.equal((await h.ui.setup()).status, 'selection-unavailable');
  assert.ok(h.calls.some(x => x[0] === 'command' && x[1] === 'python.setInterpreter'));
  assert.ok(!h.calls.some(x => x[0] === 'save'));
});
test('saved setup is skipped only when managed path and active interpreter still match', async () => {
  const h = harness(); const interpreterPath = '/managed/python';
  h.inspected = { exists: true, managed: true, interpreterPath }; h.active = interpreterPath;
  h.state.set(h.ui.readyKey(uri('/study')), { interpreterPath, selected: true });
  assert.equal((await h.ui.offer()).status, 'already-configured'); assert.equal(h.prompts.length, 0);
  h.active = '/different/python'; h.choices = [undefined]; assert.equal((await h.ui.offer()).status, 'cancelled'); assert.equal(h.prompts.length, 1);
});
test('repair requires its own explicit choice and forwards repair mode only after acceptance', async () => {
  const h = harness(); h.choices = ['Repair study environment']; assert.equal((await h.ui.repair()).status, 'ready');
  assert.equal(h.calls.find(x => x[0] === 'ensure')[1].repair, true);
});
test('repeated clicks share one consent/setup operation', async () => {
  const h = harness(); let release; h.onPrompt = () => new Promise(resolve => { release = resolve; });
  const first = h.ui.setup(); const second = h.ui.repair(); assert.equal(first, second);
  await new Promise(setImmediate); h.onPrompt = undefined; release('Set up study environment');
  await first; assert.equal(h.calls.filter(x => x[0] === 'ensure').length, 1);
});

test('public API may identify the selected managed environment by its directory', async () => {
  const h = harness();
  h.python.exports.environments.getActiveEnvironmentPath = async () => ({ path: '/extension-storage/python-envs/id' });
  assert.equal((await h.ui.setup()).status, 'ready');
});

test('cancel remains responsive while the Python extension activation is pending', async () => {
  const h = harness(); let began;
  const started = new Promise(resolve => { began = resolve; });
  h.python.isActive = false;
  h.python.activate = () => { began(); return new Promise(() => {}); };
  const pending = h.ui.setup(); await started; h.cancel();
  assert.equal((await pending).status, 'cancelled');
  assert.ok(!h.calls.some(x => x[0] === 'select' || x[0] === 'save'));
});

test('status offers Create for a missing environment using filesystem inspection only', async () => {
  const h = harness();
  assert.deepEqual(await h.ui.status(), { state: 'missing', label: 'Create study environment', command: 'tensortonic.setupStudyEnvironment' });
  assert.deepEqual(h.calls, [['inspect']]);
  assert.deepEqual(h.prompts, []);
});

test('status uses scoped Python selection rather than remembered selection or shell activation', async () => {
  const h = harness(); const inspected = managedReady(h);
  h.state.set(h.ui.readyKey(uri('/study')), { interpreterPath: inspected.interpreterPath, selected: true });
  h.vscode.env.VIRTUAL_ENV = inspected.environmentPath;
  assert.deepEqual(await h.ui.status(), { state: 'use', label: 'Use study environment', command: 'tensortonic.useStudyEnvironment', health: 'recorded' });
  assert.deepEqual(h.calls, [['inspect'], ['active', h.vscode.workspace.workspaceFolders[0].uri]]);
  assert.deepEqual(h.prompts, []);
});

test('status shows non-actionable readiness when recorded health and scoped selection both match', async () => {
  for (const selection of ['interpreterPath', 'environmentPath']) {
    const h = harness(); const inspected = managedReady(h); h.active = inspected[selection];
    assert.deepEqual(await h.ui.status(), { state: 'ready', label: 'Study environment ready', command: undefined, health: 'recorded' });
    assert.ok(!h.calls.some(call => ['ensure', 'activate', 'select', 'save', 'command', 'progress'].includes(call[0])));
    assert.deepEqual(h.prompts, []);
  }
});

test('unknown, incomplete, or broken managed health offers Repair without testing imports', async () => {
  for (const change of [value => { value.ready = false; }, value => { delete value.ready; }, value => { delete value.marker; }, value => { value.marker.state = 'installing'; }, value => { delete value.interpreterPath; }, value => { value.interpreterPath = '/system/python'; }, value => { value.environmentPath = '/study/.venv'; value.interpreterPath = '/study/.venv/bin/python'; }]) {
    const h = harness(); change(managedReady(h));
    assert.deepEqual(await h.ui.status(), { state: 'repair', label: 'Repair study environment', command: 'tensortonic.repairStudyEnvironment', reason: 'health-unknown' });
    assert.deepEqual(h.calls, [['inspect']]);
    assert.deepEqual(h.prompts, []);
  }
});

test('status reports unmanaged storage or inspection failure as unavailable without exposing exceptions', async () => {
  for (const mode of ['unmanaged', 'failed']) {
    const h = harness(); h.inspected = { exists: true, managed: false };
    if (mode === 'failed') h.onInspect = async () => { throw new Error('PRIVATE PATH/CONTENTS'); };
    const result = await h.ui.status();
    assert.equal(result.state, 'unavailable');
    assert.equal(result.command, undefined);
    assert.equal(result.reason, mode === 'failed' ? 'inspection-failed' : 'unmanaged-environment');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE PATH/);
    assert.deepEqual(h.calls, [['inspect']]);
    assert.deepEqual(h.prompts, []);
  }
});

test('status never activates Python and reports unavailable or unknown selection truthfully', async () => {
  for (const mode of ['missing', 'inactive', 'no-api', 'no-read', 'unknown', 'throws', 'read-only']) {
    const h = harness(); managedReady(h);
    if (mode === 'missing') h.python = undefined;
    else if (mode === 'inactive') h.python.isActive = false;
    else if (mode === 'no-api') h.python.exports = {};
    else if (mode === 'no-read') h.python.exports.environments.getActiveEnvironmentPath = undefined;
    else if (mode === 'unknown') h.onActive = async () => undefined;
    else if (mode === 'throws') h.onActive = async () => { throw new Error('Selection inaccessible'); };
    else if (mode === 'read-only') h.python.exports.environments.updateActiveEnvironmentPath = undefined;
    const result = await h.ui.status();
    assert.equal(result.state, ['inactive', 'unknown'].includes(mode) ? 'use' : 'unavailable');
    assert.equal(result.command, ['inactive', 'unknown'].includes(mode) ? 'tensortonic.useStudyEnvironment' : undefined);
    assert.ok(!h.calls.some(call => ['activate', 'ensure', 'select', 'save', 'command', 'progress'].includes(call[0])));
    assert.deepEqual(h.prompts, []);
  }
});

test('status offers workspace choice for unrecognized local folders and never bypasses unsupported scope', async () => {
  for (const [change, expected] of [
    [h => h.state.clear(), 'choose'], [h => { h.vscode.workspace.isTrusted = false; }, 'unsupported'],
    [h => { h.vscode.env.remoteName = 'ssh'; }, 'unsupported'], [h => { h.vscode.env.uiKind = 2; }, 'unsupported'],
    [h => { h.vscode.workspace.workspaceFolders.push({ uri: uri('/other') }); }, 'choose'],
    [h => { h.vscode.workspace.workspaceFile = uri('/project.code-workspace'); }, 'choose'], [h => h.ui.dispose(), 'disposed'],
  ]) {
    const h = harness(); managedReady(h); change(h);
    assert.deepEqual(await h.ui.status(), expected === 'choose' ? { state: 'not-study-window', label: 'Choose study workspace', command: 'tensortonic.startStudying' } : expected === 'unsupported' ? { state: 'unavailable', label: 'Study environment unavailable', command: undefined, reason: 'unsupported-window' } : { state: 'not-study-window', label: '', command: undefined });
    assert.deepEqual(h.calls, []); assert.deepEqual(h.prompts, []);
  }
});

test('status discards stale inspection and selection results after folder changes or disposal', async () => {
  for (const stage of ['inspect', 'selection', 'dispose']) {
    const h = harness(); const inspected = managedReady(h); const waiting = deferred(); const entered = deferred();
    if (stage === 'inspect') h.onInspect = async () => { entered.resolve(); return waiting.promise; };
    else h.onActive = async () => { entered.resolve(); return waiting.promise; };
    const pending = h.ui.status(); await entered.promise;
    if (stage === 'dispose') h.ui.dispose();
    else { h.vscode.workspace.workspaceFolders = [{ uri: uri('/other') }]; h.events.workspace.fire(); }
    waiting.resolve(stage === 'inspect' ? inspected : { path: inspected.interpreterPath });
    assert.deepEqual(await pending, { state: 'not-study-window', label: '', command: undefined, reason: 'stale' });
    assert.ok(!h.calls.some(call => ['select', 'save', 'ensure', 'activate'].includes(call[0])));
  }
});

test('explicit Use selects the inspected interpreter for the study folder without ensures, prompts, or terminal commands', async () => {
  const h = harness(); const inspected = managedReady(h);
  assert.deepEqual(await h.ui.use(), { status: 'ready', interpreterPath: inspected.interpreterPath });
  assert.deepEqual(h.calls.find(call => call[0] === 'select'), ['select', inspected.interpreterPath, h.vscode.workspace.workspaceFolders[0].uri]);
  assert.ok(!h.calls.some(call => ['ensure', 'progress', 'command'].includes(call[0])));
  assert.deepEqual(h.prompts, []);
  assert.equal((await h.ui.status()).state, 'ready');
});

test('Use may explicitly activate Python and await its public API readiness', async () => {
  const h = harness(); const inspected = managedReady(h); h.python.isActive = false;
  const waiting = deferred(); const entered = deferred();
  h.python.exports.ready = waiting.promise;
  h.onActivate = async () => { h.python.isActive = true; entered.resolve(); return h.python.exports; };
  const pending = h.ui.use(); await entered.promise;
  assert.ok(!h.calls.some(call => call[0] === 'select'));
  waiting.resolve();
  assert.deepEqual(await pending, { status: 'ready', interpreterPath: inspected.interpreterPath });
  assert.equal(h.calls.filter(call => call[0] === 'activate').length, 1);
  assert.ok(!h.calls.some(call => call[0] === 'ensure'));
  assert.deepEqual(h.prompts, []);
});

test('Use does not rewrite an already selected environment and refuses missing or unknown health', async () => {
  const h = harness(); const inspected = managedReady(h); h.active = inspected.environmentPath;
  assert.equal((await h.ui.use()).status, 'ready');
  assert.ok(!h.calls.some(call => call[0] === 'select'));
  for (const mode of ['missing', 'partial']) {
    const other = harness(); if (mode === 'partial') { managedReady(other); other.inspected.ready = false; }
    assert.equal((await other.ui.use()).status, mode === 'missing' ? 'missing-environment' : 'repair-required');
    assert.deepEqual(other.calls, [['inspect']]);
    assert.deepEqual(other.prompts, []);
  }
});

test('Use reports absent API or unverified selection without creating or installing an environment', async () => {
  for (const mode of ['missing', 'no-api', 'no-write', 'unverified']) {
    const h = harness(); managedReady(h);
    if (mode === 'missing') h.python = undefined;
    else if (mode === 'no-api') h.python.exports = {};
    else if (mode === 'no-write') h.python.exports.environments.updateActiveEnvironmentPath = undefined;
    else h.onSelect = async () => {};
    const result = await h.ui.use();
    assert.equal(result.status, mode === 'missing' ? 'python-extension-missing' : mode === 'unverified' ? 'selection-unverified' : 'selection-unavailable');
    assert.ok(!h.calls.some(call => ['ensure', 'save', 'command', 'progress'].includes(call[0])));
    assert.deepEqual(h.prompts, []);
  }
});

test('Use cancels before selection when its folder changes, even if the same folder returns', async () => {
  for (const stage of ['inspect', 'activate', 'active']) {
    const h = harness(); const inspected = managedReady(h); const waiting = deferred(); const entered = deferred();
    const hold = async value => { entered.resolve(); await waiting.promise; return value; };
    if (stage === 'inspect') h.onInspect = () => hold(inspected);
    if (stage === 'activate') { h.python.isActive = false; h.onActivate = () => hold(h.python.exports); }
    if (stage === 'active') h.onActive = () => hold({ path: '/system/python' });
    const pending = h.ui.use(); await entered.promise;
    h.events.workspace.fire(); waiting.resolve();
    assert.equal((await pending).status, 'cancelled');
    assert.ok(!h.calls.some(call => ['select', 'save', 'ensure'].includes(call[0])));
  }
});

test('Use disposal remains responsive while extension activation is pending', async () => {
  const h = harness(); managedReady(h); h.python.isActive = false; const entered = deferred();
  h.onActivate = () => { entered.resolve(); return new Promise(() => {}); };
  const pending = h.ui.use(); await entered.promise; h.ui.dispose();
  assert.equal((await pending).status, 'cancelled');
  assert.ok(!h.calls.some(call => ['select', 'save', 'ensure'].includes(call[0])));
});

test('repeated Use clicks share one selection and status never starts work while it runs', async () => {
  const h = harness(); const inspected = managedReady(h); const waiting = deferred(); const entered = deferred();
  h.onInspect = async () => { entered.resolve(); return waiting.promise; };
  const first = h.ui.use(); const second = h.ui.use(); assert.equal(first, second); await entered.promise;
  assert.equal((await h.ui.status()).reason, 'operation-in-progress');
  waiting.resolve(inspected); await first;
  assert.equal(h.calls.filter(call => call[0] === 'inspect').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'select').length, 1);
});

test('known failed setup invalidates recorded readiness until an explicit successful retry', async () => {
  const h = harness(); const inspected = managedReady(h); h.active = inspected.interpreterPath;
  h.choices = ['Repair study environment']; h.onEnsure = async () => { throw new Error('Synthetic import failure'); };
  await assert.rejects(h.ui.repair(), /Synthetic import failure/);
  assert.equal((await h.ui.status()).state, 'repair');
  h.onEnsure = undefined; h.choices = ['Set up study environment'];
  assert.equal((await h.ui.setup()).status, 'ready');
  assert.equal((await h.ui.status()).state, 'ready');
});

test('change subscriptions refresh selection state and dispose without side effects', async () => {
  const h = harness(); managedReady(h); let changes = 0;
  const registered = []; const listener = h.ui.onDidChange(() => { changes++; }, undefined, registered);
  assert.equal(registered[0], listener);
  await h.ui.status(); assert.equal(h.events.active.size, 1);
  const before = h.calls.length;
  h.events.active.fire(); h.events.configuration.fire({ affectsConfiguration: key => key === 'python' }); h.events.extensions.fire(); h.events.workspace.fire();
  assert.equal(changes, 4); assert.equal(h.calls.length, before);
  assert.equal(h.events.active.size, 0);
  await h.ui.status(); assert.equal(h.events.active.size, 1);
  listener.dispose(); h.events.active.fire(); assert.equal(changes, 4);
  h.ui.dispose(); assert.equal(h.events.active.size, 0); assert.equal(h.events.workspace.size, 0); assert.equal(h.events.configuration.size, 0); assert.equal(h.events.extensions.size, 0);
  h.events.active.fire(); assert.equal(changes, 4);
});

test('preexisting generated study files expose Create when the legacy folder key and environment are absent', async t => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tt-environment-ui-')));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const workspace = path.join(temp, 'tensortonic');
  const directory = path.join(workspace, 'tensortonic', 'pytorch-basics');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'pytorch-mini-training.py');
  const source = '# tensortonic: {"slug":"pytorch-mini-training","apiId":"synthetic-id","planId":"pytorch-basics","technology":"python"}\n# https://www.tensortonic.com/problems/pytorch-mini-training?studyPlan=pytorch-basics\n\npass\n';
  await fs.writeFile(file, source);
  const h = harness(); h.state.clear(); h.state.set(STUDY_FOLDER_KEY, null);
  h.vscode.workspace.workspaceFolders = [{ uri: uri(workspace) }];
  h.active = '/opt/homebrew/bin/python3.14'; h.python.isActive = false;
  assert.deepEqual(await h.ui.status(), { state: 'missing', label: 'Create study environment', command: 'tensortonic.setupStudyEnvironment' });
  assert.equal(h.ui.studyFolder(), h.vscode.workspace.workspaceFolders[0].uri);
  assert.deepEqual(h.calls, [['inspect']]); assert.deepEqual(h.prompts, []);
  assert.equal(h.active, '/opt/homebrew/bin/python3.14');
  assert.equal(h.state.get(STUDY_FOLDER_KEY), null);
  assert.equal(h.state.has(h.ui.readyKey(uri(workspace))), false);
  assert.equal(await fs.readFile(file, 'utf8'), source);
  assert.deepEqual(await fs.readdir(directory), [path.basename(file)]);
  h.choices = [undefined];
  assert.equal((await h.ui.setup()).status, 'cancelled');
  assert.ok(!h.calls.some(call => ['ensure', 'activate', 'select', 'save', 'command'].includes(call[0])));
});

test('unknown and empty local workspaces expose only the explicit Choose study workspace action', async () => {
  const h = harness({ recognize: async () => false }); h.state.clear();
  const expected = { state: 'not-study-window', label: 'Choose study workspace', command: 'tensortonic.startStudying' };
  assert.deepEqual(await h.ui.status(), expected);
  h.vscode.workspace.workspaceFolders = undefined;
  assert.deepEqual(await h.ui.status(), expected);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.prompts, []);
});

test('unsupported windows and unsafe solutionDirectory do not invoke recognition or environment inspection', async () => {
  for (const change of [
    h => { h.vscode.workspace.isTrusted = false; }, h => { h.vscode.env.remoteName = 'ssh-remote'; },
    h => { h.vscode.env.uiKind = 2; }, h => { h.vscode.workspace.workspaceFolders.push({ uri: uri('/other') }); },
    h => { h.vscode.workspace.workspaceFolders[0].uri = { ...uri('/remote'), scheme: 'vscode-remote', authority: 'host' }; },
    h => { h.vscode.workspace.getConfiguration = () => ({ get: () => '../outside' }); },
  ]) {
    let detections = 0;
    const h = harness({ recognize: async () => { detections++; return true; } }); h.state.clear(); change(h);
    assert.notEqual((await h.ui.status()).state, 'missing');
    assert.equal((await h.ui.use()).status, 'not-study-window');
    assert.equal(detections, 0); assert.deepEqual(h.calls, []);
  }
});

test('recognition is fenced across workspace, trust, configuration, session, and disposal changes', async () => {
  for (const mode of ['workspace-return', 'trust-return', 'configuration-return', 'session', 'session-hook', 'dispose']) {
    let epoch = 0, directory = 'tensortonic';
    const waiting = deferred(), entered = deferred(); let guard;
    const h = harness({ getSessionEpoch: () => epoch, recognize: async options => { guard = options.isCurrent; entered.resolve(); return waiting.promise; } });
    h.state.clear(); h.vscode.workspace.getConfiguration = () => ({ get: () => directory });
    const pending = h.ui.status(); await entered.promise;
    if (mode === 'workspace-return') { h.vscode.workspace.workspaceFolders = [{ uri: uri('/other') }]; h.events.workspace.fire(); h.vscode.workspace.workspaceFolders = [{ uri: uri('/study') }]; h.events.workspace.fire(); }
    else if (mode === 'trust-return') { h.vscode.workspace.isTrusted = false; h.events.workspace.fire(); h.vscode.workspace.isTrusted = true; h.events.workspace.fire(); }
    else if (mode === 'configuration-return') { directory = 'other'; h.events.configuration.fire({ affectsConfiguration: key => key === 'tensortonic.solutionDirectory' }); directory = 'tensortonic'; h.events.configuration.fire({ affectsConfiguration: key => key === 'tensortonic.solutionDirectory' }); }
    else if (mode === 'session') epoch++;
    else if (mode === 'session-hook') h.ui.invalidateSession();
    else h.ui.dispose();
    assert.equal(guard(), false, mode); waiting.resolve(true);
    assert.deepEqual(await pending, { state: 'not-study-window', label: '', command: undefined, reason: 'stale' });
    assert.equal(h.ui.studyFolder(), undefined); assert.deepEqual(h.calls, []);
  }
});

test('session changes discard even registered-folder inspection and explicit Use results', async () => {
  for (const action of ['status', 'use']) {
    let epoch = 0;
    const h = harness({ getSessionEpoch: () => epoch }); const inspected = managedReady(h), waiting = deferred(), entered = deferred();
    h.onInspect = async () => { entered.resolve(); return waiting.promise; };
    const pending = h.ui[action](); await entered.promise; epoch++; waiting.resolve(inspected);
    const result = await pending;
    assert.equal(action === 'status' ? result.reason : result.status, action === 'status' ? 'stale' : 'cancelled');
    assert.deepEqual(h.calls, [['inspect']]);
  }
});

test('configuration change during setup consent cancels rather than creating or selecting', async () => {
  const h = harness(), waiting = deferred(), entered = deferred();
  h.onPrompt = async () => { entered.resolve(); return waiting.promise; };
  const pending = h.ui.setup(); await entered.promise;
  h.events.configuration.fire({ affectsConfiguration: key => key === 'tensortonic.solutionDirectory' });
  waiting.resolve('Set up study environment');
  assert.equal((await pending).status, 'cancelled');
  assert.ok(!h.calls.some(call => ['ensure', 'select', 'save', 'activate'].includes(call[0])));
});

test('a rejected setup inspection after session invalidation stays cancelled without an old notification', async () => {
  let rejectInspection;
  const h = harness(), waiting = { promise: new Promise((resolve, reject) => { rejectInspection = reject; }) }, entered = deferred();
  h.onInspect = async () => { entered.resolve(); return waiting.promise; };
  const pending = h.ui.setup(); await entered.promise;
  h.ui.invalidateSession(); rejectInspection(new Error('old-scope-inspection-error'));
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.deepEqual(h.prompts, []);
  assert.ok(!h.calls.some(call => ['ensure', 'select', 'save', 'activate'].includes(call[0])));
});

test('vscode-userdata storage uses only the documented local globalStoragePath without URI conversion', async () => {
  const h = harness();
  h.context.globalStorageUri = { scheme: 'vscode-userdata', authority: '', fsPath: '/not-the-local-storage' };
  h.context.globalStoragePath = '/documented/Code/User/globalStorage/choru-local.tensortonic-vscode';
  Object.defineProperty(h.context, 'secrets', { get() { throw Error('Secrets must not be touched'); } });
  assert.equal((await h.ui.status()).state, 'missing');
  assert.equal(h.factoryOptions.managedRoot, h.context.globalStoragePath + '/python-envs');
  assert.deepEqual(h.calls, [['inspect']]); assert.deepEqual(h.prompts, []);
});

test('unavailable or unsafe userdata local storage remains unavailable without guessing a physical path', async () => {
  for (const mode of ['missing', 'relative', 'uri-string', 'traversal', 'authority', 'query', 'other-scheme']) {
    const h = harness();
    h.context.globalStorageUri = { scheme: 'vscode-userdata', authority: '', fsPath: '/must-not-use-this' };
    if (mode === 'relative') h.context.globalStoragePath = 'relative/storage';
    if (mode === 'uri-string') h.context.globalStoragePath = 'file:///outside';
    if (mode === 'traversal') h.context.globalStoragePath = '/storage/../outside';
    if (mode === 'authority') { h.context.globalStorageUri.authority = 'remote'; h.context.globalStoragePath = '/outside'; }
    if (mode === 'query') { h.context.globalStorageUri.query = 'target=outside'; h.context.globalStoragePath = '/outside'; }
    if (mode === 'other-scheme') { h.context.globalStorageUri.scheme = 'vscode-remote'; h.context.globalStoragePath = '/outside'; }
    assert.deepEqual(await h.ui.status(), { state: 'unavailable', label: 'Study environment unavailable', command: undefined, reason: 'inspection-failed' });
    assert.equal(h.factoryOptions, undefined); assert.deepEqual(h.calls, []);
  }
});
