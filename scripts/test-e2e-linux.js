'use strict';

// Dependency-free, disconnected extension-host smoke on native Linux x64.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = '1.144.0';
const vscodeCommit = '2c33b50b16c472efe58357d1d2a8a5414bc23fbf';
const archiveSha256 = '17b72a7e6f40a5b5dce9850f10eea13ce734a63052b67fa021cc01e715ad4cf1';
const archiveUrl = `https://update.code.visualstudio.com/${version}/linux-x64/stable`;
const base = path.join(root, '.agent/linux-e2e');
const timeoutSeconds = Number(process.env.TENSORTONIC_E2E_TIMEOUT_SECONDS || 120);
const active = new Set();
let interrupted = false;

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    for (const pid of active) killGroup(pid, 'SIGTERM');
  });
}

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid() === 0) {
    throw new Error('Requires native Linux x64 as an unprivileged user.');
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) {
    throw new Error('TENSORTONIC_E2E_TIMEOUT_SECONDS must be between 1 and 600.');
  }
  await fs.mkdir(base, { recursive: true });
  const reportDir = await fs.mkdtemp(path.join(base, 'run-'));
  const scratch = path.join(reportDir, 'scratch');
  await fs.mkdir(scratch);
  // AF_UNIX socket paths are limited to 107 bytes; checkout paths can be long.
  // This short directory holds disposable IPC only, never execution evidence.
  const runtime = await fs.mkdtemp('/tmp/tensortonic-e2e-');
  const metadata = {
    started: new Date().toISOString(), node: process.version,
    platform: process.platform, arch: process.arch, uid: process.getuid(),
    version, vscodeCommit, archiveUrl, archiveSha256, timeoutSeconds, commands: [],
    status: 'preparing', exitCode: 1,
  };
  console.log(`Linux E2E evidence: ${reportDir}`);

  // Every command owns a process group. Never signal unrelated desktop processes.
  async function run(command, args, options = {}) {
    if (interrupted) throw new Error('Interrupted');
    const entry = { command, args, log: options.log || 'setup.log', timeoutSeconds: options.timeout || 180 };
    metadata.commands.push(entry);
    const log = await fs.open(path.join(reportDir, entry.log), 'a');
    await log.write(`\n$ ${JSON.stringify([command, ...args])}\n`);
    let output = '';
    let timedOut = false;
    let writes = Promise.resolve();
    const child = spawn(command, args, {
      cwd: options.cwd || root, env: options.env || process.env,
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid) active.add(child.pid);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => { output += chunk; writes = writes.then(() => log.write(chunk)); });
    }
    let forceTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        killGroup(child.pid, 'SIGTERM');
        forceTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 2000);
      }
    }, entry.timeoutSeconds * 1000);
    try {
      const result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      entry.exitCode = timedOut ? 124 : interrupted ? 130 : result.code ?? 1;
      entry.signal = result.signal;
      entry.timedOut = timedOut;
    } finally {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      if (child.pid) { killGroup(child.pid, 'SIGKILL'); active.delete(child.pid); }
      try { await writes; } finally { await log.close(); }
    }
    if (entry.exitCode !== 0) {
      const error = new Error(`${command} ${timedOut ? 'timed out' : 'failed'} (${entry.exitCode}); see ${entry.log}`);
      error.exitCode = entry.exitCode;
      throw error;
    }
    return output.trim();
  }

  try {
    metadata.sha = await run('git', ['rev-parse', 'HEAD']);
    metadata.trackedStatus = await run('git', ['status', '--porcelain', '--untracked-files=no']);
    if (metadata.trackedStatus) throw new Error('Commit tracked changes first; only committed source is staged.');
    const cache = path.join(base, 'cache');
    await fs.mkdir(cache, { recursive: true });
    const archive = path.join(cache, `vscode-${version}.tar.gz`);
    try { await fs.access(archive); } catch {
      const partial = path.join(scratch, 'download.tar.gz');
      await run('curl', ['--fail', '--location', '--connect-timeout', '15', '--max-time', '180', '--output', partial, archiveUrl], { timeout: 185 });
      await fs.rename(partial, archive);
    }
    const { createReadStream } = require('node:fs');
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    metadata.actualArchiveSha256 = hash.digest('hex');
    if (metadata.actualArchiveSha256 !== archiveSha256) throw new Error(`Archive checksum mismatch; remove only ${archive} before retrying.`);
    await run('tar', ['-xzf', archive, '-C', scratch]);
    const codeRoot = path.join(scratch, 'VSCode-linux-x64');
    const product = JSON.parse(await fs.readFile(path.join(codeRoot, 'resources/app/product.json'), 'utf8'));
    const app = JSON.parse(await fs.readFile(path.join(codeRoot, 'resources/app/package.json'), 'utf8'));
    if (app.version !== version || product.commit !== vscodeCommit) throw new Error('Extracted VS Code identity mismatch.');

    // Use distro tools if installed, otherwise extract only Xvfb in user space.
    let xvfbBin = '/usr/bin';
    try { await fs.access('/usr/bin/Xvfb'); } catch {
      const packages = path.join(scratch, 'packages');
      await fs.mkdir(packages);
      await run('apt-get', ['-o', 'Acquire::Retries=0', '-o', 'Acquire::http::Timeout=30', 'download', 'xvfb'], { cwd: packages, timeout: 90 });
      const deb = (await fs.readdir(packages)).find(name => name.endsWith('.deb'));
      if (!deb) throw new Error('apt-get did not download Xvfb.');
      metadata.xvfbPackage = deb;
      await run('dpkg-deb', ['-x', path.join(packages, deb), path.join(scratch, 'xvfb')]);
      xvfbBin = path.join(scratch, 'xvfb/usr/bin');
    }
    const extension = path.join(scratch, 'extension');
    await fs.mkdir(extension);
    const sourceArchive = path.join(scratch, 'source.tar');
    await run('git', ['archive', '--format=tar', `--output=${sourceArchive}`, metadata.sha]);
    await run('tar', ['-xf', sourceArchive, '-C', extension]);
    await fs.rm(path.join(extension, 'dist/vscode-smoke-result.json'), { force: true });
    const dirs = {};
    for (const name of ['home', 'workspace', 'profile', 'extensions', 'config', 'cache', 'data', 'state']) {
      dirs[name] = path.join(scratch, name);
      await fs.mkdir(dirs[name], { mode: 0o700 });
    }
    await fs.mkdir(path.join(dirs.profile, 'User'));
    await fs.writeFile(path.join(dirs.profile, 'User/settings.json'), JSON.stringify({
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
    }));
    // Allowlist the child's environment: no inherited app/session/credential forwarding.
    const env = {
      PATH: `${xvfbBin}:/usr/bin:/bin`, LANG: 'C.UTF-8', HOME: dirs.home,
      XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache, XDG_DATA_HOME: dirs.data,
      XDG_STATE_HOME: dirs.state, XDG_RUNTIME_DIR: runtime, TMPDIR: runtime,
    };
    metadata.status = 'running';
    await run(path.join(xvfbBin, 'xvfb-run'), [
      '--auto-servernum', '--auth-file', path.join(scratch, 'Xauthority'),
      '--server-args=-screen 0 1280x800x24 -nolisten tcp',
      'dbus-run-session', '--', path.join(codeRoot, 'code'),
      '--user-data-dir', dirs.profile, '--extensions-dir', dirs.extensions,
      '--extensionDevelopmentPath', extension, '--extensionTestsPath', path.join(extension, 'test/vscode-smoke.js'),
      '--new-window', '--skip-welcome', '--skip-release-notes',
    ], { cwd: dirs.workspace, env, log: 'vscode.log', timeout: timeoutSeconds });
    metadata.status = 'validating';
    const result = JSON.parse(await fs.readFile(path.join(extension, 'dist/vscode-smoke-result.json'), 'utf8'));
    if (result.success !== true || result.activated !== true || result.connected !== false || result.vscode !== version) {
      throw new Error('Missing or invalid fresh smoke evidence.');
    }
    await fs.writeFile(path.join(reportDir, 'smoke.json'), JSON.stringify(result, null, 2));
    metadata.status = 'passed';
    metadata.exitCode = 0;
  } catch (error) {
    metadata.failurePhase = metadata.status;
    metadata.status = 'failed';
    metadata.error = error.message;
    metadata.exitCode = error.exitCode || (interrupted ? 130 : 1);
    console.error(error.message);
  } finally {
    const logs = path.join(scratch, 'profile/logs');
    try { await fs.cp(logs, path.join(reportDir, 'host-logs'), { recursive: true }); } catch (error) {
      if (error.code !== 'ENOENT') metadata.logCopyError = error.message;
    }
    await fs.rm(scratch, { recursive: true, force: true });
    await fs.rm(runtime, { recursive: true, force: true });
    metadata.finished = new Date().toISOString();
    await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify(metadata, null, 2));
    process.exitCode = metadata.exitCode;
    console.log(`Linux E2E ${metadata.status} (exit ${metadata.exitCode}): ${reportDir}/report.json`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
