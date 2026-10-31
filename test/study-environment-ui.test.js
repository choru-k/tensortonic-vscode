'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { StudyEnvironmentUI } = require('../src/study-environment-ui');
const { STUDY_FOLDER_KEY } = require('../src/study-workspace');
const uri = file => ({ scheme: 'file', authority: '', fsPath: file, toString: () => 'file://' + file });
function harness() {
  const folder = uri('/study');
  const state = new Map([[STUDY_FOLDER_KEY, folder.toString()]]);
  const h = { state, calls: [], prompts: [], choices: ['Set up study environment'], cancelled: false,
    inspected: { exists: false, managed: false }, active: '/system/python' };
  const environments = {
    async updateActiveEnvironmentPath(interpreter, scope) { h.calls.push(['select', interpreter, scope]); h.active = interpreter; },
    async getActiveEnvironmentPath() { return { path: h.active }; },
  };
  h.python = { isActive: true, exports: { environments }, async activate() { return this.exports; } };
  h.vscode = {
    UIKind: { Desktop: 1 }, ProgressLocation: { Notification: 15 }, env: { uiKind: 1 },
    Uri: { parse: text => uri(text.replace('file://', '')) },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: folder }] },
    extensions: { getExtension: () => h.python },
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
    async inspect() { h.calls.push(['inspect']); return h.inspected; },
    async ensure(options) {
      h.calls.push(['ensure', options]);
      if (h.onEnsure) return h.onEnsure(options);
      if (options.signal.aborted) { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
      return { interpreterPath: '/extension-storage/python-envs/id/bin/python', environmentPath: '/extension-storage/python-envs/id', reused: false, pythonVersion: '3.13.1', packages: ['torch', 'numpy'] };
    },
  };
  h.ui = new StudyEnvironmentUI(h.vscode, h.context, { factory: options => { h.factoryOptions = options; return h.environment; } });
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
