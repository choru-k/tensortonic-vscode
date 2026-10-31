'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MARKER = '.tensortonic-managed.json';
const PACKAGES = Object.freeze(['torch', 'numpy']);
const SUPPORTED_MINORS = Object.freeze([14, 13, 12, 11]);
const PROBE = 'import json,sys; print(json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable,"prefix":sys.prefix,"base_prefix":sys.base_prefix}))';
const HEALTH = 'import json,sys,torch,numpy; print(json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable,"prefix":sys.prefix,"base_prefix":sys.base_prefix,"torch":torch.__version__,"numpy":numpy.__version__}))';

function canceled() { const error = new Error('Study environment setup was canceled. No global Python environment was changed.'); error.name = 'AbortError'; return error; }
function checkSignal(signal) { if (signal && signal.aborted) throw canceled(); }
function contained(parent, child) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
function cleanEnvironment(platform = process.platform, source = process.env) {
  const env = {};
  for (const key of ['HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (typeof source[key] === 'string') env[key] = source[key];
  }
  // Do not inherit PATH, PYTHONPATH, pip indexes, proxy URLs, loader injection,
  // user site packages, or shell hooks from the study workspace's terminal.
  env.PATH = platform === 'win32' ? `${source.SystemRoot || 'C:\\Windows'}\\System32` : '/usr/bin:/bin';
  env.PIP_CONFIG_FILE = platform === 'win32' ? 'NUL' : '/dev/null';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  env.PIP_NO_INPUT = '1';
  env.PYTHONNOUSERSITE = '1';
  return env;
}
function defaultCandidates(platform = process.platform, source = process.env) {
  if (platform === 'win32') {
    const roots = ['C:\\', source.LOCALAPPDATA && path.join(source.LOCALAPPDATA, 'Programs', 'Python')].filter(Boolean);
    return roots.flatMap(root => SUPPORTED_MINORS.map(minor => path.join(root, `Python3${minor}`, 'python.exe')));
  }
  const roots = platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'] : ['/usr/bin', '/usr/local/bin'];
  return roots.flatMap(root => [...SUPPORTED_MINORS.map(minor => path.join(root, `python3.${minor}`)), path.join(root, 'python3')]);
}
function runProcess(executable, args, options, driver = {}) {
  return new Promise((resolve, reject) => {
    checkSignal(options.signal);
    let teardown; let failure; let finished = false;
    let stdout = ''; let stderr = ''; let bytes = 0;
    const launch = driver.spawn || spawn;
    const sendSignal = driver.kill || process.kill.bind(process);
    const schedule = driver.setTimeout || setTimeout;
    const grouped = (driver.platform || process.platform) !== 'win32';
    // spawn, rather than execFile, forwards detached to the operating system.
    // Every argument is a separate array entry; no shell or terminal is used.
    const child = launch(executable, args, { cwd: options.cwd, env: options.env, shell: false,
      windowsHide: true, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => {
      failure = new Error('Python operation timed out. Wait for cleanup, then retry Setup or Repair.');
      beginTeardown();
    }, options.timeout || 120000);
    timeout.unref();
    function terminate(signal) {
      try {
        // Only this operation's newly created process group is addressed.
        if (grouped && Number.isInteger(child.pid)) sendSignal(-child.pid, signal);
        else child.kill(signal);
        return true;
      } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    }
    function beginTeardown() {
      if (teardown) return;
      if (!terminate('SIGTERM')) { teardown = Promise.resolve(); return; }
      teardown = new Promise((done, fail) => {
        // Keep this referenced even after the leader exits: descendants may
        // ignore TERM. The setup lock stays held until escalation completes.
        schedule(() => { try { terminate('SIGKILL'); done(); } catch (error) { fail(error); } }, 2000);
      });
    }
    function abort() { beginTeardown(); }
    async function finish(error, code) {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      try {
        if (options.signal && options.signal.aborted) beginTeardown();
        if (teardown) await teardown;
        if (options.signal) options.signal.removeEventListener('abort', abort);
        if (options.signal && options.signal.aborted) return reject(canceled());
        if (failure) return reject(failure);
        if (error || code !== 0) return reject(new Error('Python operation failed. Check the installed runtime, network access, free disk space, and available package wheels; then retry Setup or Repair.'));
        resolve({ stdout, stderr });
      } catch (_) { reject(new Error('Could not confirm setup subprocess cleanup. Wait for the operation to stop before retrying.')); }
    }
    function output(chunk, stream) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) {
        failure = new Error('Python operation produced excessive output. Setup was stopped safely.');
        beginTeardown(); return;
      }
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    }
    child.stdout.on('data', chunk => output(chunk, 'stdout'));
    child.stderr.on('data', chunk => output(chunk, 'stderr'));
    child.once('error', error => { void finish(error); });
    child.once('close', code => { void finish(undefined, code); });
    if (grouped && Number.isInteger(child.pid)) {
      try { sendSignal(-child.pid, 0); }
      catch (_) {
        failure = new Error('This runtime cannot create an isolated setup process group. Automatic installation was stopped; create a virtual environment manually and use Python: Select Interpreter.');
        failure.code = 'UNSAFE_PROCESS_GROUP';
        child.kill('SIGTERM');
      }
    }
    if (options.signal) options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal && options.signal.aborted) abort();
  });
}

class StudyEnvironment {
  constructor({ managedRoot, workspaceRoot, fs: filesystem = fs, run = runProcess,
    platform = process.platform, candidates = defaultCandidates(platform), env = process.env } = {}) {
    if (!path.isAbsolute(managedRoot || '') || !path.isAbsolute(workspaceRoot || '')) throw new Error('Study and managed environment folders must be absolute local paths.');
    this.fs = filesystem; this.run = run; this.platform = platform;
    this.managedRoot = path.resolve(managedRoot); this.workspaceRoot = path.resolve(workspaceRoot);
    this.id = crypto.createHash('sha256').update(this.workspaceRoot).digest('hex');
    this.environmentPath = path.join(this.managedRoot, this.id);
    this.interpreterPath = path.join(this.environmentPath, platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python');
    this.candidates = candidates.slice(); this.env = cleanEnvironment(platform, env);
    this.active = undefined;
  }

  async _stat(file) { try { return await this.fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } }
  async _roots(create = false) {
    const workspace = await this.fs.realpath(this.workspaceRoot);
    if (contained(this.workspaceRoot, this.managedRoot) || contained(workspace, this.managedRoot)) throw new Error('Managed Python environments must be outside the study workspace.');
    if (create) await this.fs.mkdir(this.managedRoot, { recursive: true, mode: 0o700 });
    const rootStat = await this._stat(this.managedRoot);
    if (!rootStat) return { workspace, root: undefined };
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Managed environment storage must be a real directory, not a symbolic link.');
    const root = await this.fs.realpath(this.managedRoot);
    if (contained(workspace, root)) throw new Error('Managed Python environments must be outside the study workspace.');
    return { workspace, root };
  }

  async inspect() {
    const roots = await this._roots(false);
    const stat = await this._stat(this.environmentPath);
    if (!stat) return { exists: false, managed: false, environmentPath: this.environmentPath };
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { exists: true, managed: false, environmentPath: this.environmentPath };
    const markerPath = path.join(this.environmentPath, MARKER);
    const markerStat = await this._stat(markerPath);
    if (!markerStat || !markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 16384) return { exists: true, managed: false, environmentPath: this.environmentPath };
    let marker;
    try { marker = JSON.parse(await this.fs.readFile(markerPath, 'utf8')); } catch (_) { return { exists: true, managed: false, environmentPath: this.environmentPath }; }
    const managed = marker && marker.schema === 1 && marker.workspaceRoot === this.workspaceRoot && marker.id === this.id &&
      typeof marker.basePython === 'string' && path.isAbsolute(marker.basePython) && typeof marker.pythonVersion === 'string';
    let ready = false;
    if (managed && marker.state === 'ready') {
      try { ready = await this._validateInterpreter(marker, roots.workspace) && await this._configValid(); } catch (_) { /* Changed/missing interpreter is not selected. */ }
    }
    return { exists: true, managed: !!managed, ready, environmentPath: this.environmentPath,
      ...(managed ? { marker, pythonVersion: marker.pythonVersion } : {}),
      ...(ready ? { interpreterPath: this.interpreterPath } : {}) };
  }

  async _invoke(executable, args, signal, timeout = 120000) {
    checkSignal(signal);
    const result = await this.run(executable, args, { signal, timeout, cwd: this.managedRoot, env: this.env, shell: false });
    checkSignal(signal);
    return result;
  }
  _json(result) {
    try { return JSON.parse(result.stdout.trim()); } catch (_) { throw new Error('Python returned an invalid environment check. No interpreter was selected.'); }
  }
  async _canonicalCandidate(candidate, workspace) {
    if (!path.isAbsolute(candidate) || contained(this.workspaceRoot, candidate) || contained(workspace, candidate)) return undefined;
    let real;
    try { real = await this.fs.realpath(candidate); } catch (_) { return undefined; }
    if (contained(workspace, real) || contained(this.managedRoot, real)) return undefined;
    const stat = await this.fs.stat(real);
    return stat.isFile() ? real : undefined;
  }
  async _discover(workspace, signal, report) {
    const visited = new Set();
    for (const candidate of this.candidates) {
      checkSignal(signal);
      const real = await this._canonicalCandidate(candidate, workspace);
      if (!real || visited.has(real)) continue;
      visited.add(real);
      try {
        report('Checking an installed Python runtime…');
        const info = this._json(await this._invoke(real, ['-I', '-S', '-c', PROBE], signal, 15000));
        if (!Array.isArray(info.version) || info.version[0] !== 3 || !SUPPORTED_MINORS.includes(info.version[1])) continue;
        if (await this.fs.realpath(info.executable) !== real) continue;
        return { basePython: real, pythonVersion: info.version.join('.') };
      } catch (error) { if (error.name === 'AbortError' || error.code === 'UNSAFE_PROCESS_GROUP') throw error; }
    }
    throw new Error('No supported installed Python 3.11–3.14 was found in standard system locations. Install a supported Python from python.org or your usual trusted package manager, then run Setup again. No Python was downloaded or globally modified.');
  }
  async _validateInterpreter(marker, workspace) {
    const stat = await this._stat(this.interpreterPath);
    if (!stat) return false;
    const bin = await this._stat(path.dirname(this.interpreterPath));
    if (!bin || !bin.isDirectory() || bin.isSymbolicLink()) throw new Error('The managed interpreter directory was replaced. Refusing to execute it.');
    const base = await this._canonicalCandidate(marker.basePython, workspace);
    if (!base || base !== marker.basePython) throw new Error(`The original system Python is unavailable or changed. This managed environment cannot be rebuilt automatically in place. Choose a different study folder for a fresh environment, or manually review/remove only this extension-owned environment (${this.environmentPath}) and run Setup again. Study files and other Python environments were not changed.`);
    const real = await this.fs.realpath(this.interpreterPath);
    if (this.platform !== 'win32') {
      if (real !== base) throw new Error('The managed interpreter does not point to its original system Python. Refusing to execute it.');
    } else {
      // Windows venv launchers may differ from python.exe: never execute an
      // unverified copy. Its identity is recorded immediately after creation.
      const digest = crypto.createHash('sha256').update(await this.fs.readFile(this.interpreterPath)).digest('hex');
      if (!marker.interpreterSha256 || digest !== marker.interpreterSha256) throw new Error('The managed Windows interpreter changed. Refusing to execute it.');
    }
    return true;
  }
  async _configValid() {
    const cfg = await this._stat(path.join(this.environmentPath, 'pyvenv.cfg'));
    if (!cfg) return false;
    if (!cfg.isFile() || cfg.isSymbolicLink()) throw new Error('The managed virtual environment configuration was replaced. Refusing to modify it.');
    const configuration = await this.fs.readFile(path.join(this.environmentPath, 'pyvenv.cfg'), 'utf8');
    return /^include-system-site-packages\s*=\s*false\s*$/im.test(configuration);
  }
  async _prefixValid(signal) {
    if (!await this._configValid()) return false;
    try {
      const info = this._json(await this._invoke(this.interpreterPath, ['-I', '-c', PROBE], signal, 15000));
      return await this.fs.realpath(info.prefix) === await this.fs.realpath(this.environmentPath) &&
        await this.fs.realpath(info.prefix) !== await this.fs.realpath(info.base_prefix);
    } catch (error) { if (error.name === 'AbortError') throw error; return false; }
  }
  async _health(marker, workspace, signal) {
    if (!await this._validateInterpreter(marker, workspace) || !await this._prefixValid(signal)) return false;
    try {
      const info = this._json(await this._invoke(this.interpreterPath, ['-I', '-c', HEALTH], signal, 60000));
      if (await this.fs.realpath(info.prefix) !== await this.fs.realpath(this.environmentPath) || info.prefix === info.base_prefix ||
          !info.torch || !info.numpy || !Array.isArray(info.version) || !SUPPORTED_MINORS.includes(info.version[1])) return false;
      return true;
    } catch (error) { if (error.name === 'AbortError') throw error; return false; }
  }
  async _writeMarker(marker) {
    const file = path.join(this.environmentPath, MARKER);
    const existing = await this._stat(file);
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Managed environment ownership marker changed.');
    await this.fs.writeFile(file, JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
  }

  async ensure({ confirmed = false, signal, onProgress = () => {}, repair = false } = {}) {
    if (confirmed !== true) throw new Error('Explicit setup confirmation is required before running Python or installing packages.');
    if (this.platform === 'win32') throw new Error('Automatic study environment setup currently supports macOS and Linux only. On Windows, create a dedicated virtual environment manually and select it with Python: Select Interpreter. No installer or Python process was started.');
    if (this.active) throw new Error('Study environment setup is already running for this workspace.');
    const task = this._ensure({ signal, report: onProgress, repair });
    this.active = task;
    try { return await task; } finally { if (this.active === task) this.active = undefined; }
  }
  async _ensure({ signal, report, repair }) {
    checkSignal(signal);
    const roots = await this._roots(true);
    const lockPath = path.join(this.managedRoot, this.id + '.setup-lock');
    const nonce = crypto.randomUUID();
    let lock;
    try { lock = await this.fs.open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Another setup owns this study environment. Wait for it to finish. If an editor crashed, review its managed-storage setup lock before retrying; no process or lock was removed automatically.'); throw error; }
    try {
      await lock.writeFile(nonce);
      return await this._ensureLocked({ signal, report, repair, roots });
    } finally {
      await lock.close();
      const stat = await this._stat(lockPath);
      if (stat && stat.isFile() && !stat.isSymbolicLink() && await this.fs.readFile(lockPath, 'utf8') === nonce) await this.fs.unlink(lockPath);
    }
  }
  async _ensureLocked({ signal, report, repair, roots }) {
    checkSignal(signal);
    const inspected = await this.inspect();
    if (inspected.exists && !inspected.managed) throw new Error('The environment path already contains unmanaged data. It was not changed. Choose another study folder or review managed storage manually.');
    let marker = inspected.marker;
    if (marker && !repair && await this._health(marker, roots.workspace, signal)) {
      report('The existing dedicated environment is ready.');
      return { interpreterPath: this.interpreterPath, environmentPath: this.environmentPath, reused: true, pythonVersion: marker.pythonVersion, packages: PACKAGES.slice() };
    }
    if (!marker) {
      const runtime = await this._discover(roots.workspace, signal, report);
      checkSignal(signal);
      // Exclusive directory creation refuses another window's setup or any
      // unmanaged contents. No recursive deletion or replacement is performed.
      await this.fs.mkdir(this.environmentPath, { mode: 0o700 });
      marker = { schema: 1, id: this.id, workspaceRoot: this.workspaceRoot, ...runtime, state: 'creating' };
      await this._writeMarker(marker);
    }
    checkSignal(signal);
    const exists = await this._validateInterpreter(marker, roots.workspace);
    const validPrefix = exists && await this._prefixValid(signal);
    if (!exists || !validPrefix) {
      const base = await this._canonicalCandidate(marker.basePython, roots.workspace);
      if (!base || base !== marker.basePython) throw new Error(`The selected system Python is no longer available. This partial environment cannot be rebuilt automatically with another runtime. Choose a different study folder, or manually review/remove only this extension-owned environment (${this.environmentPath}) before Setup. No study files were changed.`);
      report('Creating the dedicated virtual environment outside your study files…');
      await this._invoke(base, ['-I', '-m', 'venv', ...(this.platform === 'win32' ? [] : ['--symlinks']), this.environmentPath], signal);
      if (this.platform === 'win32') marker.interpreterSha256 = crypto.createHash('sha256').update(await this.fs.readFile(this.interpreterPath)).digest('hex');
      marker.state = 'installing'; await this._writeMarker(marker);
      if (!await this._validateInterpreter(marker, roots.workspace)) throw new Error('Virtual environment creation did not produce the expected interpreter.');
    }
    // A canceled venv/ensurepip can leave a valid executable without pip.
    // Validate the isolated prefix before ANY bootstrap/package mutation so
    // a missing pyvenv.cfg can never redirect ensurepip into global Python.
    if (!await this._prefixValid(signal)) throw new Error('The interpreter is not an isolated managed virtual environment. No packages were installed.');
    try { await this._invoke(this.interpreterPath, ['-I', '-m', 'pip', '--version'], signal, 15000); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      report('Restoring pip from Python’s bundled ensurepip into the dedicated environment…');
      await this._invoke(this.interpreterPath, ['-I', '-m', 'ensurepip', '--upgrade'], signal);
      if (!await this._prefixValid(signal)) throw new Error('Managed interpreter validation changed during pip recovery.');
    }
    report('Installing torch and numpy from PyPI into the dedicated environment (download size may be large)…');
    await this._invoke(this.interpreterPath, ['-I', '-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple',
      '--only-binary=:all:', '--no-input', '--disable-pip-version-check', '--no-cache-dir', '--require-virtualenv',
      ...(repair ? ['--upgrade'] : []), ...PACKAGES], signal, 20 * 60 * 1000);
    report('Verifying the dedicated Python interpreter and package imports…');
    if (!await this._health(marker, roots.workspace, signal)) throw new Error('The dedicated environment did not pass its torch/numpy import check. No interpreter was selected. Use Setup or Repair to retry.');
    marker.state = 'ready'; await this._writeMarker(marker);
    return { interpreterPath: this.interpreterPath, environmentPath: this.environmentPath, reused: false, pythonVersion: marker.pythonVersion, packages: PACKAGES.slice() };
  }
}
module.exports = { StudyEnvironment, runProcess, cleanEnvironment, defaultCandidates, SUPPORTED_MINORS, PACKAGES };
