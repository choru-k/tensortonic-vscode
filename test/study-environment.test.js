'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { StudyEnvironment, cleanEnvironment, defaultCandidates, environmentPrompt } = require('../src/study-environment');

async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tt-env-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'study files;$(echo bad)');
  const managedRoot = path.join(root, 'extension data');
  const base = path.join(root, 'system-python');
  await fs.mkdir(workspaceRoot); await fs.writeFile(base, 'synthetic executable never run');
  const calls = []; let installed = false;
  let healthFailure = false;
  const runner = async (executable, args, opts) => {
    calls.push({ executable, args, opts });
    assert.equal(opts.shell, false);
    assert.equal(opts.cwd, managedRoot);
    assert.equal(opts.env.PYTHONPATH, undefined);
    if (options.run) return options.run({ executable, args, opts, calls, base, managedRoot, workspaceRoot });
    if (args.includes('venv')) {
      installed = false;
      const target = args.at(-1); await fs.mkdir(path.join(target, 'bin'), { recursive: true });
      try { await fs.symlink(executable, path.join(target, 'bin/python')); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await fs.writeFile(path.join(target, 'pyvenv.cfg'), 'include-system-site-packages = false\n');
      return { stdout: '' };
    }
    if (args.includes('pip')) {
      if (args.includes('--version')) return { stdout: 'pip fixture' };
      if (options.failInstall) throw new Error('Synthetic download failure');
      installed = true; return { stdout: '' };
    }
    if (args.at(-1).includes('import json,sys,torch,numpy')) {
      if (!installed || healthFailure) throw new Error('Synthetic missing package');
      return { stdout: JSON.stringify({ version: [3, 13, 2], executable, prefix: path.dirname(path.dirname(executable)), base_prefix: path.dirname(base), torch: 'test', numpy: 'test' }) };
    }
    return { stdout: JSON.stringify({ version: options.version || [3, 13, 2], executable, prefix: args.includes('-S') ? path.dirname(executable) : path.dirname(path.dirname(executable)), base_prefix: path.dirname(base) }) };
  };
  const env = new StudyEnvironment({ managedRoot, workspaceRoot, candidates: [base], run: runner, env: { PATH: workspaceRoot, PYTHONPATH: workspaceRoot, PIP_EXTRA_INDEX_URL: 'https://evil.test', LD_PRELOAD: 'evil' } });
  return { root, workspaceRoot, managedRoot, base, env, calls, runner, setHealthFailure(value) { healthFailure = value; } };
}

test('explicit confirmation is required before processes or filesystem creation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.env.ensure({}), /confirmation/);
  assert.equal(f.calls.length, 0); await assert.rejects(fs.stat(f.managedRoot), { code: 'ENOENT' });
});

test('environment labels identify TensorTonic and bound safe workspace context without exposing storage IDs', () => {
  assert.equal(environmentPrompt('/study/tensortonic'), 'TensorTonic');
  assert.equal(environmentPrompt('/study/ML Practice'), 'TensorTonic (ML Practice)');
  assert.equal(environmentPrompt('/study/학습'), 'TensorTonic (학습)');
  const label = environmentPrompt('/study/bad\n\u001b[31m$(echo bad)');
  assert.ok(label.startsWith('TensorTonic ('));
  assert.doesNotMatch(label, /[\n\u001b$]/);
  assert.ok(environmentPrompt('/study/' + 'x'.repeat(100)).length < 60);
});

test('creation supplies the supported venv prompt while retaining the stable hashed path and installed environment', async t => {
  const f = await fixture(t);
  const original = f.env.environmentPath;
  await f.env.ensure({ confirmed: true });
  const create = f.calls.find(call => call.args.includes('venv'));
  assert.equal(create.args[create.args.indexOf('--prompt') + 1], f.env.prompt);
  assert.equal(create.args.at(-1), original);
  assert.match(path.basename(original), /^[a-f0-9]{64}$/);
  f.calls.length = 0;
  await f.env.ensure({ confirmed: true });
  assert.equal(f.env.environmentPath, original);
  assert.equal(f.calls.filter(call => call.args.includes('venv') || call.args.includes('install')).length, 0);
});

test('inspect is filesystem-only and setup uses dedicated external managed storage and fixed package source', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.env.inspect(), { exists: false, managed: false, environmentPath: f.env.environmentPath });
  assert.equal(f.calls.length, 0);
  const originalVenv = path.join(f.workspaceRoot, '.venv'); await fs.mkdir(originalVenv); await fs.writeFile(path.join(originalVenv, 'keep'), 'unchanged');
  const result = await f.env.ensure({ confirmed: true });
  assert.equal(result.reused, false); assert.equal(result.pythonVersion, '3.13.2');
  assert.deepEqual(result.packages, ['torch', 'numpy']); assert.equal(await fs.readFile(path.join(originalVenv, 'keep'), 'utf8'), 'unchanged');
  assert.ok(!result.environmentPath.startsWith(f.workspaceRoot));
  const install = f.calls.find(c => c.args.includes('install'));
  assert.equal(install.executable, result.interpreterPath);
  assert.deepEqual(install.args.slice(-2), ['torch', 'numpy']);
  assert.ok(install.args.includes('--only-binary=:all:')); assert.ok(install.args.includes('--require-virtualenv'));
  assert.equal(install.args[install.args.indexOf('--index-url') + 1], 'https://pypi.org/simple');
  assert.equal(install.opts.env.PIP_CONFIG_FILE, '/dev/null'); assert.equal(install.opts.env.PIP_EXTRA_INDEX_URL, undefined);
  assert.equal(install.opts.env.LD_PRELOAD, undefined); assert.equal(install.opts.env.PATH, '/usr/bin:/bin');
  assert.equal((await f.env.inspect()).managed, true);
});

test('healthy owned environment is checked and reused without installation', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); f.calls.length = 0;
  const result = await f.env.ensure({ confirmed: true });
  assert.equal(result.reused, true); assert.equal(f.calls.length, 2); assert.ok(f.calls[1].args.at(-1).includes('torch,numpy'));
});

test('explicit repair installs only fixed package list and does not delete existing files', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true });
  const extra = path.join(f.env.environmentPath, 'preserve.txt'); await fs.writeFile(extra, 'keep'); f.calls.length = 0;
  await f.env.ensure({ confirmed: true, repair: true });
  assert.ok(f.calls.find(c => c.args.includes('install')).args.includes('--upgrade'));
  assert.equal(await fs.readFile(extra, 'utf8'), 'keep');
});

test('unmanaged target and symlinked managed root are never overwritten', async t => {
  const f = await fixture(t); await fs.mkdir(f.env.environmentPath, { recursive: true }); await fs.writeFile(path.join(f.env.environmentPath, 'user.txt'), 'keep');
  await assert.rejects(f.env.ensure({ confirmed: true }), /unmanaged/); assert.equal(f.calls.length, 0);
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, 'user.txt'), 'utf8'), 'keep');
  const link = path.join(f.root, 'linked-managed'); await fs.symlink(f.managedRoot, link);
  const linked = new StudyEnvironment({ managedRoot: link, workspaceRoot: f.workspaceRoot, candidates: [f.base], run: f.runner });
  await assert.rejects(linked.ensure({ confirmed: true }), /symbolic link/);
});

test('workspace-local or redirected runtime candidates are never executed', async t => {
  const f = await fixture(t); const bad = path.join(f.workspaceRoot, 'python'); await fs.writeFile(bad, 'not executed');
  const link = path.join(f.root, 'candidate-link'); await fs.symlink(bad, link);
  const env = new StudyEnvironment({ managedRoot: f.managedRoot, workspaceRoot: f.workspaceRoot, candidates: [bad, link], run: f.runner });
  await assert.rejects(env.ensure({ confirmed: true }), /No supported installed Python/); assert.equal(f.calls.length, 0);
});

test('unsupported Python is not used to create a venv or install packages', async t => {
  const f = await fixture(t, { version: [3, 15, 0] });
  await assert.rejects(f.env.ensure({ confirmed: true }), /3.11–3.14/);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].args.includes('-S'));
});

test('managed storage inside workspace is rejected before process execution', async t => {
  const f = await fixture(t);
  const env = new StudyEnvironment({ managedRoot: path.join(f.workspaceRoot, '.managed'), workspaceRoot: f.workspaceRoot, candidates: [f.base], run: f.runner });
  await assert.rejects(env.ensure({ confirmed: true }), /outside the study workspace/); assert.equal(f.calls.length, 0);
});

test('changed managed interpreter refuses arbitrary executable without import or pip', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); f.calls.length = 0;
  await fs.unlink(f.env.interpreterPath); await fs.writeFile(f.env.interpreterPath, 'workspace attacker replacement');
  await assert.rejects(f.env.ensure({ confirmed: true }), /original system Python/); assert.equal(f.calls.length, 0);
});

test('failed package install leaves owned retryable environment and releases setup lock', async t => {
  const f = await fixture(t, { failInstall: true });
  await assert.rejects(f.env.ensure({ confirmed: true }), /Synthetic download failure/);
  assert.equal((await f.env.inspect()).managed, true);
  const names = await fs.readdir(f.managedRoot); assert.ok(!names.some(name => name.endsWith('.setup-lock')));
  await assert.rejects(f.env.ensure({ confirmed: true }), /Synthetic download failure/);
  assert.equal(f.calls.filter(c => c.args.includes('venv')).length, 1);
});

test('already canceled setup does not create managed folders or execute anything', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.env.ensure({ confirmed: true, signal: controller.signal }), { name: 'AbortError' }); assert.equal(f.calls.length, 0);
  await assert.rejects(fs.stat(f.managedRoot), { code: 'ENOENT' });
});

test('two instances cannot mutate the same managed environment concurrently', async t => {
  let release; let started = false;
  const f = await fixture(t, { run: async () => { started = true; await new Promise(resolve => { release = resolve; }); throw new Error('Synthetic end'); } });
  const first = f.env.ensure({ confirmed: true }); const failed = assert.rejects(first, /No supported installed Python/);
  while (!started) await new Promise(resolve => setTimeout(resolve, 1));
  const second = new StudyEnvironment({ managedRoot: f.managedRoot, workspaceRoot: f.workspaceRoot, candidates: [f.base], run: f.runner });
  await assert.rejects(second.ensure({ confirmed: true }), /Another setup/);
  release(); await failed;
});

test('environment sanitization and fixed candidate discovery never use PATH or caller packages', () => {
  const env = cleanEnvironment('linux', { PATH: '/workspace/bin', PYTHONPATH: '/workspace', NODE_OPTIONS: 'bad', DYLD_INSERT_LIBRARIES: 'bad', PIP_INDEX_URL: 'bad', HOME: '/home/test' });
  assert.equal(env.HOME, '/home/test'); assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.DYLD_INSERT_LIBRARIES, undefined); assert.equal(env.PIP_INDEX_URL, undefined);
  assert.ok(defaultCandidates('darwin').includes('/opt/homebrew/bin/python3.13'));
  for (const root of ['/opt/homebrew', '/usr/local']) {
    assert.ok(defaultCandidates('darwin').includes(root + '/opt/python@3.13/bin/python3.13'));
  }
  assert.ok(defaultCandidates('linux').every(candidate => path.isAbsolute(candidate)));
});

test('inspect never advertises a missing or replaced ready interpreter', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true });
  assert.equal((await f.env.inspect()).ready, true);
  await fs.unlink(f.env.interpreterPath);
  let result = await f.env.inspect(); assert.equal(result.ready, false); assert.equal(result.interpreterPath, undefined);
  await fs.writeFile(f.env.interpreterPath, 'not an owned interpreter');
  result = await f.env.inspect(); assert.equal(result.ready, false); assert.equal(result.interpreterPath, undefined);
});

test('cancellation after a subprocess returns stops before next installation step and releases owned lock', async t => {
  const controller = new AbortController();
  const f = await fixture(t, { run: async ({ base }) => { controller.abort(); return { stdout: JSON.stringify({ version: [3, 13, 2], executable: base }) }; } });
  await assert.rejects(f.env.ensure({ confirmed: true, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 1);
  assert.ok(!(await fs.readdir(f.managedRoot)).some(name => name.endsWith('.setup-lock')));
});

test('missing venv configuration is repaired before any pip/bootstrap mutation', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true });
  await fs.unlink(path.join(f.env.environmentPath, 'pyvenv.cfg')); f.calls.length = 0;
  assert.equal((await f.env.inspect()).ready, false);
  await f.env.ensure({ confirmed: true });
  const create = f.calls.findIndex(c => c.args.includes('venv'));
  const mutate = f.calls.findIndex(c => c.args.includes('install') || c.args.includes('ensurepip'));
  assert.ok(create >= 0 && mutate > create);
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, 'pyvenv.cfg'), 'utf8'), 'include-system-site-packages = false\n');
});

test('missing pip after partial setup recovers through bundled ensurepip only after isolated-prefix validation', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); f.calls.length = 0;
  let pipReady = false;
  f.env.run = async (exe, args, opts) => {
    if (args.includes('pip') && args.includes('--version') && !pipReady) {
      f.calls.push({ executable: exe, args, opts }); throw new Error('Synthetic partial ensurepip');
    }
    if (args.includes('ensurepip')) { f.calls.push({ executable: exe, args, opts }); pipReady = true; return { stdout: '' }; }
    return f.runner(exe, args, opts);
  };
  await f.env.ensure({ confirmed: true, repair: true });
  const bootstrap = f.calls.findIndex(c => c.args.includes('ensurepip'));
  assert.ok(bootstrap > 0); assert.ok(f.calls.slice(0, bootstrap).some(c => c.args.includes('-c') && c.args.at(-1).includes('base_prefix')));
  assert.ok(f.calls.findIndex(c => c.args.includes('install')) > bootstrap);
});

test('symlinked pyvenv configuration is refused rather than overwritten by repair', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); f.calls.length = 0;
  const victim = path.join(f.workspaceRoot, 'do-not-modify.cfg'); await fs.writeFile(victim, 'keep');
  await fs.unlink(path.join(f.env.environmentPath, 'pyvenv.cfg')); await fs.symlink(victim, path.join(f.env.environmentPath, 'pyvenv.cfg'));
  await assert.rejects(f.env.ensure({ confirmed: true, repair: true }), /configuration was replaced/);
  assert.equal(await fs.readFile(victim, 'utf8'), 'keep'); assert.equal(f.calls.length, 0);
});

test('removed original Python without a compatible runtime gives actionable guidance without moving any content', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true });
  const marker = await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8');
  await fs.unlink(f.base); f.calls.length = 0;
  await assert.rejects(f.env.ensure({ confirmed: true, repair: true }), /No supported installed Python/);
  assert.equal(f.calls.length, 0); assert.equal((await f.env.inspect()).managed, true);
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8'), marker);
  assert.deepEqual(await fs.readdir(f.managedRoot), [f.env.id]);
  const mac = new StudyEnvironment({ managedRoot: f.managedRoot, workspaceRoot: f.workspaceRoot, platform: 'darwin', candidates: [] });
  await assert.rejects(mac.ensure({ confirmed: true }), /brew install python@3.13.*same folder.*3.15 is not supported/);
});

async function replaceBase(f) {
  await fs.unlink(f.base);
  const replacement = path.join(f.root, 'compatible-python');
  await fs.writeFile(replacement, 'synthetic compatible runtime');
  f.env.candidates.push(replacement);
  return replacement;
}

test('Setup and Repair preserve a stale owned environment and rebuild in the same workspace at its stable path', async t => {
  for (const repair of [false, true]) {
    const f = await fixture(t); await f.env.ensure({ confirmed: true });
    const originalPath = f.env.environmentPath;
    const marker = await fs.readFile(path.join(originalPath, '.tensortonic-managed.json'), 'utf8');
    await fs.writeFile(path.join(originalPath, 'user-notes.txt'), 'preserve');
    const replacement = await replaceBase(f); f.calls.length = 0;
    const result = await f.env.ensure({ confirmed: true, repair });
    assert.equal(result.environmentPath, originalPath);
    assert.equal(result.reused, false);
    assert.ok(result.previousEnvironment.startsWith(path.join(f.managedRoot, f.env.id + '.backup-')));
    assert.equal(await fs.readFile(path.join(result.previousEnvironment, 'user-notes.txt'), 'utf8'), 'preserve');
    assert.equal(await fs.readFile(path.join(result.previousEnvironment, '.tensortonic-managed.json'), 'utf8'), marker);
    assert.equal(await fs.readlink(path.join(result.previousEnvironment, 'bin/python')), f.base);
    assert.equal(await fs.realpath(result.interpreterPath), replacement);
    assert.equal((await f.env.inspect()).ready, true);
    assert.ok(f.calls.every(call => call.executable !== f.base));
    assert.equal(f.calls.filter(call => call.args.includes('venv')).length, 1);
  }
});

test('discovery skips Python 3.15 and finds a compatible versioned keg even when it is not linked into bin', async t => {
  const f = await fixture(t);
  const runtime = path.join(f.root, 'cellar-python3.13'); await fs.writeFile(runtime, 'synthetic');
  const keg = path.join(f.root, 'opt/python@3.13/bin/python3.13');
  await fs.mkdir(path.dirname(keg), { recursive: true }); await fs.symlink(runtime, keg);
  f.env.candidates.push(keg);
  f.env.run = (exe, args, options) => args.includes('-S') && exe === f.base ?
    Promise.resolve({ stdout: JSON.stringify({ version: [3, 15, 0], executable: exe }) }) : f.runner(exe, args, options);
  const result = await f.env.ensure({ confirmed: true });
  assert.equal(await fs.realpath(result.interpreterPath), runtime);
  assert.equal(f.calls.find(call => call.args.includes('venv')).executable, runtime);
});

test('failed replacement installation keeps its backup and retries without another move or venv recreation', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true });
  await fs.writeFile(path.join(f.env.environmentPath, 'keep'), 'original'); await replaceBase(f); f.calls.length = 0;
  f.env.run = (exe, args, options) => args.includes('install') ? Promise.reject(new Error('Replacement download failed')) : f.runner(exe, args, options);
  await assert.rejects(f.env.ensure({ confirmed: true }), /Replacement download failed/);
  const partial = await f.env.inspect();
  assert.equal(partial.ready, false);
  assert.equal(await fs.readFile(path.join(partial.marker.previousEnvironment, 'keep'), 'utf8'), 'original');
  assert.ok(!(await fs.readdir(f.managedRoot)).some(name => name.endsWith('.setup-lock')));
  f.env.run = f.runner;
  const retried = await f.env.ensure({ confirmed: true });
  assert.equal(retried.previousEnvironment, partial.marker.previousEnvironment);
  assert.equal(f.calls.filter(call => call.args.includes('venv')).length, 1);
  assert.equal((await fs.readdir(f.managedRoot)).filter(name => name.includes('.backup-')).length, 1);
  assert.equal((await f.env.inspect()).ready, true);
});

test('canceling replacement discovery leaves the original in place and releases the lock', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await replaceBase(f);
  const original = await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8');
  const controller = new AbortController();
  f.env.run = async (...args) => { const result = await f.runner(...args); controller.abort(); return result; };
  await assert.rejects(f.env.ensure({ confirmed: true, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8'), original);
  assert.deepEqual(await fs.readdir(f.managedRoot), [f.env.id]);
});

test('canceling replacement venv creation keeps the prior environment and allows a later retry', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await replaceBase(f); f.calls.length = 0;
  const controller = new AbortController();
  f.env.run = async (exe, args, options) => { const result = await f.runner(exe, args, options); if (args.includes('venv')) controller.abort(); return result; };
  await assert.rejects(f.env.ensure({ confirmed: true, signal: controller.signal }), { name: 'AbortError' });
  const partial = await f.env.inspect();
  assert.equal(partial.ready, false); assert.equal(partial.marker.state, 'creating');
  await fs.stat(partial.marker.previousEnvironment);
  assert.ok(!f.calls.some(call => call.args.includes('install')));
  f.env.run = f.runner;
  assert.equal((await f.env.ensure({ confirmed: true })).previousEnvironment, partial.marker.previousEnvironment);
  assert.equal((await fs.readdir(f.managedRoot)).filter(name => name.includes('.backup-')).length, 1);
});

test('replacement remains under the workspace lock across the move and installation', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await replaceBase(f);
  let started, release;
  const ready = new Promise(resolve => { started = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  f.env.run = async (exe, args, options) => { if (args.includes('venv')) { started(); await paused; } return f.runner(exe, args, options); };
  const pending = f.env.ensure({ confirmed: true }); await ready;
  const second = new StudyEnvironment({ managedRoot: f.managedRoot, workspaceRoot: f.workspaceRoot, candidates: f.env.candidates, run: f.runner });
  try { await assert.rejects(second.ensure({ confirmed: true }), /Another setup/); }
  finally { release(); }
  await pending;
  assert.equal((await fs.readdir(f.managedRoot)).filter(name => name.includes('.backup-')).length, 1);
});

test('failure to write a replacement ownership marker restores the original without deleting partial data', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await replaceBase(f);
  const original = await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8');
  let fail = true;
  f.env.fs = { ...fs, async writeFile(file, ...args) {
    if (fail && file === path.join(f.env.environmentPath, '.tensortonic-managed.json')) { fail = false; throw new Error('Synthetic marker write failure'); }
    return fs.writeFile(file, ...args);
  } };
  await assert.rejects(f.env.ensure({ confirmed: true }), /Synthetic marker write failure/);
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8'), original);
  const saved = (await fs.readdir(f.managedRoot)).find(name => name.includes('.backup-'));
  await fs.stat(path.join(f.managedRoot, saved, 'partial-replacement'));
  assert.ok(!(await fs.readdir(f.managedRoot)).some(name => name.endsWith('.setup-lock')));
  assert.equal((await f.env.ensure({ confirmed: true })).reused, false);
});

function homebrewFixture(f, { real = '/opt/homebrew/bin/brew', install } = {}) {
  const brew = '/opt/homebrew/bin/brew';
  f.env.platform = 'darwin';
  f.env.fs = { ...fs,
    async realpath(file) {
      if (file === brew) return real;
      if (file === '/usr/local/bin/brew') { const error = new Error('Not installed'); error.code = 'ENOENT'; throw error; }
      return fs.realpath(file);
    },
    async stat(file) { return file === real ? { isFile: () => true } : fs.stat(file); },
  };
  const runtime = path.join(f.root, 'homebrew-python3.13');
  f.env.candidates.push(runtime);
  const calls = [];
  f.env.run = async (exe, args, options) => {
    if (exe !== brew && exe !== real) return f.runner(exe, args, options);
    calls.push({ executable: exe, args, options });
    if (install) return install({ runtime, options });
    await fs.writeFile(runtime, 'synthetic installed Python'); return { stdout: '' };
  };
  return { brew, runtime, calls };
}

test('missing runtime may install the fixed Homebrew formula only after affirmative consent and continues without another Setup', async t => {
  const f = await fixture(t); await fs.unlink(f.base); const b = homebrewFixture(f);
  let confirmations = 0;
  const result = await f.env.ensure({ confirmed: true, confirmPythonInstall: async request => {
    confirmations++; assert.deepEqual(request, { executable: b.brew, formula: 'python@3.13' });
    assert.equal(b.calls.length, 0); await assert.rejects(fs.stat(f.env.environmentPath), { code: 'ENOENT' });
    return true;
  } });
  assert.equal(confirmations, 1); assert.equal(b.calls.length, 1);
  assert.equal(await fs.realpath(result.interpreterPath), b.runtime);
  assert.deepEqual(b.calls[0].args, ['install', 'python@3.13']);
  const options = b.calls[0].options;
  assert.equal(options.shell, false); assert.equal(options.cwd, f.managedRoot);
  assert.equal(options.env.PATH, '/usr/bin:/bin'); assert.equal(options.env.PYTHONPATH, undefined);
  assert.equal(options.env.HOMEBREW_NO_AUTO_UPDATE, '1');
  assert.equal(options.env.HOMEBREW_NO_INSTALL_CLEANUP, '1');
  assert.equal(options.env.HOMEBREW_NO_ANALYTICS, '1');
  assert.equal((await f.env.inspect()).ready, true);
});

test('compatible installed Python always wins without asking for or executing Homebrew', async t => {
  const f = await fixture(t); const b = homebrewFixture(f);
  await f.env.ensure({ confirmed: true, confirmPythonInstall: () => assert.fail('Unexpected install confirmation') });
  assert.equal(b.calls.length, 0);
});

test('declining runtime installation keeps the old environment unchanged and retry can install and rebuild', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await fs.unlink(f.base);
  const original = await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8');
  const b = homebrewFixture(f);
  await assert.rejects(f.env.ensure({ confirmed: true, confirmPythonInstall: async () => false }), { name: 'AbortError' });
  assert.equal(b.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.managedRoot), [f.env.id]);
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8'), original);
  const result = await f.env.ensure({ confirmed: true, confirmPythonInstall: async () => true });
  assert.equal(b.calls.length, 1);
  assert.equal(await fs.readFile(path.join(result.previousEnvironment, '.tensortonic-managed.json'), 'utf8'), original);
  assert.equal((await f.env.inspect()).ready, true);
});

test('Homebrew install failure preserves the original and releases the lock for clean retry', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await fs.unlink(f.base);
  const original = await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8');
  let fail = true;
  const b = homebrewFixture(f, { install: async ({ runtime }) => {
    if (fail) throw new Error('Synthetic Homebrew failure');
    await fs.writeFile(runtime, 'synthetic'); return { stdout: '' };
  } });
  await assert.rejects(f.env.ensure({ confirmed: true, confirmPythonInstall: async () => true }), /Homebrew could not finish.*preserved/);
  assert.equal(await fs.readFile(path.join(f.env.environmentPath, '.tensortonic-managed.json'), 'utf8'), original);
  assert.deepEqual(await fs.readdir(f.managedRoot), [f.env.id]);
  fail = false;
  await f.env.ensure({ confirmed: true, confirmPythonInstall: async () => true });
  assert.equal(b.calls.length, 2); assert.equal((await f.env.inspect()).ready, true);
});

test('a successful Homebrew exit without a verifiable runtime preserves the original and reports the actual verification gap', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await fs.unlink(f.base);
  const b = homebrewFixture(f, { install: async () => ({ stdout: '' }) });
  await assert.rejects(f.env.ensure({ confirmed: true, confirmPythonInstall: async () => true }), /Homebrew finished.*could not be verified/);
  assert.equal(b.calls.length, 1); assert.deepEqual(await fs.readdir(f.managedRoot), [f.env.id]);
});

test('canceling Homebrew installation preserves the original and retry discovers a completed runtime before offering install again', async t => {
  const f = await fixture(t); await f.env.ensure({ confirmed: true }); await fs.unlink(f.base);
  const controller = new AbortController();
  const b = homebrewFixture(f, { install: async ({ runtime }) => {
    await fs.writeFile(runtime, 'synthetic'); controller.abort(); return { stdout: '' };
  } });
  await assert.rejects(f.env.ensure({ confirmed: true, signal: controller.signal, confirmPythonInstall: async () => true }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(f.managedRoot), [f.env.id]);
  const result = await f.env.ensure({ confirmed: true, confirmPythonInstall: () => assert.fail('Runtime is now available') });
  assert.equal(b.calls.length, 1); assert.ok(result.previousEnvironment);
});

test('untrusted Homebrew symlinks and non-macOS hosts never offer or run runtime installation', async t => {
  for (const variant of ['redirect', 'linux']) {
    const f = await fixture(t); await fs.unlink(f.base);
    const b = homebrewFixture(f, { real: variant === 'redirect' ? path.join(f.root, 'arbitrary-brew') : undefined });
    if (variant === 'linux') f.env.platform = 'linux';
    await assert.rejects(f.env.ensure({ confirmed: true, confirmPythonInstall: () => assert.fail('Unexpected confirmation') }), /No supported installed Python/);
    assert.equal(b.calls.length, 0);
  }
});

test('Homebrew identity is checked again after consent and the study lock covers the confirmation', async t => {
  const f = await fixture(t); await fs.unlink(f.base); const b = homebrewFixture(f);
  await assert.rejects(f.env.ensure({ confirmed: true, confirmPythonInstall: async () => {
    const second = new StudyEnvironment({ managedRoot: f.managedRoot, workspaceRoot: f.workspaceRoot, candidates: [], run: f.runner });
    await assert.rejects(second.ensure({ confirmed: true }), /Another setup/);
    const realpath = f.env.fs.realpath;
    f.env.fs.realpath = file => file === b.brew ? Promise.resolve(path.join(f.root, 'changed-brew')) : realpath(file);
    return true;
  } }), /Homebrew executable changed/);
  assert.equal(b.calls.length, 0);
  assert.ok(!(await fs.readdir(f.managedRoot)).some(name => name.endsWith('.setup-lock')));
});

test('Windows automation fails before executing anything with an honest manual setup boundary', async t => {
  const f = await fixture(t); const env = new StudyEnvironment({ managedRoot: f.managedRoot, workspaceRoot: f.workspaceRoot, platform: 'win32', run: f.runner });
  await assert.rejects(env.ensure({ confirmed: true }), /macOS and Linux only/); assert.equal(f.calls.length, 0);
});

test('canceling a real benign subprocess waits for its SIGTERM-ignoring descendant cleanup', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const { runProcess } = require('../src/study-environment');
  const probe = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  let isolated = true; try { process.kill(-probe.pid, 0); } catch (_) { isolated = false; }
  const probeExit = new Promise(resolve => probe.once('exit', resolve));
  if (isolated) process.kill(-probe.pid, 'SIGTERM'); else probe.kill('SIGTERM');
  await probeExit;
  if (!isolated) { t.skip('Execution sandbox does not provide detached POSIX process groups; deterministic cancellation driver test covers cleanup.'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-process-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'descendant-live'); const ready = path.join(root, 'ready');
  const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(Date.now())),30);`;
  const leader = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ['-e', leader], { cwd: root, env: cleanEnvironment(), signal: controller.signal, timeout: 8000 });
  const failure = assert.rejects(promise, { name: 'AbortError' });
  for (let n=0;n<200;n++) { try { await fs.stat(ready); break; } catch (_) { await new Promise(r=>setTimeout(r,10)); } }
  await fs.stat(ready); const start = Date.now(); controller.abort();
  await failure; assert.ok(Date.now()-start >= 1800, 'promise must retain cleanup grace despite leader exit');
  const first = await fs.readFile(marker, 'utf8'); await new Promise(r=>setTimeout(r,120));
  assert.equal(await fs.readFile(marker, 'utf8'), first, 'no descendant writes after canceled operation settles');
});

test('owned process-group cancellation retains the operation until KILL even after leader exits', async () => {
  const { runProcess } = require('../src/study-environment');
  const events = []; let timer; let settled = false;
  const { EventEmitter } = require('node:events');
  const controller = new AbortController();
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: signal => events.push(['child', signal]) });
  const driver = {
    platform: 'linux',
    spawn(exe, args, options) { assert.equal(options.detached, true); return child; },
    kill(pid, signal) { events.push([pid, signal]); },
    setTimeout(fn, delay) { assert.equal(delay, 2000); timer = fn; },
  };
  const pending = runProcess('/usr/bin/python3.14', ['-I', '-m', 'venv', '/managed/env'], { cwd: '/managed', env: {}, signal: controller.signal }, driver);
  const rejected = assert.rejects(pending, { name: 'AbortError' }).then(() => { settled = true; });
  controller.abort(); child.emit('close', null); await Promise.resolve();
  assert.equal(settled, false); assert.deepEqual(events, [[-12345, 0], [-12345, 'SIGTERM']]);
  timer(); await rejected; assert.deepEqual(events.at(-1), [-12345, 'SIGKILL']);
});

test('runner fails closed when sandbox cannot establish an owned process group', async () => {
  const { runProcess } = require('../src/study-environment');
  const { EventEmitter } = require('node:events'); const signals = [];
  const child = Object.assign(new EventEmitter(), { pid: 9, stdout: new EventEmitter(), stderr: new EventEmitter(), kill(signal) { signals.push(signal); setImmediate(() => child.emit('close', null)); } });
  const driver = { platform: 'linux', spawn() { return child; }, kill() { const e=new Error(); e.code='ESRCH'; throw e; } };
  await assert.rejects(runProcess('/usr/bin/python3.14', ['-I', '-c', 'pass'], { cwd: '/managed', env: {} }, driver), /cannot create an isolated setup process group/);
  assert.deepEqual(signals, ['SIGTERM']);
});
