'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const COMMENTS = Object.freeze({ '.py': '#', '.sql': '--', '.cpp': '//', '.cu': '//' });
const LIMITS = Object.freeze({ entries: 512, plans: 32, candidates: 64, headerBytes: 8192, sourceBytes: 2 * 1024 * 1024, sidecarBytes: 512 * 1024 });

function configuredDirectory(value = 'tensortonic') {
  if (typeof value !== 'string' || !value || value.length > 1024 || path.isAbsolute(value) || /^[a-z]:/i.test(value) || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) return undefined;
  const segments = value.split(/[\\/]/);
  if (segments.length > 8 || segments.some(part => !part || part === '.' || part === '..' || part.includes(':'))) return undefined;
  return segments;
}

function metadata(header, filename, plan) {
  const extension = path.extname(filename);
  const comment = COMMENTS[extension];
  if (!comment) return undefined;
  const lines = header.split(/\r?\n/).slice(0, 9);
  for (let index = 0; index < Math.min(lines.length, 8); index++) {
    if (!lines[index].startsWith(comment + ' tensortonic: ')) continue;
    let ref;
    try { ref = JSON.parse(lines[index].slice((comment + ' tensortonic: ').length)); } catch (_) { return undefined; }
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).some(key => !['slug', 'apiId', 'planId', 'technology'].includes(key)) ||
        typeof ref.slug !== 'string' || !SLUG.test(ref.slug) || ref.apiId !== undefined && (typeof ref.apiId !== 'string' || !SLUG.test(ref.apiId)) ||
        ref.planId !== undefined && ref.planId !== '' && (typeof ref.planId !== 'string' || !SLUG.test(ref.planId)) ||
        ref.technology !== undefined && (typeof ref.technology !== 'string' || ref.technology.length > 80 || /[\u0000-\u001f\u007f]/.test(ref.technology)) ||
        path.basename(filename, extension) !== ref.slug || plan !== (ref.planId || 'free')) return undefined;
    const url = `https://www.tensortonic.com/problems/${ref.slug}${ref.planId ? `?studyPlan=${ref.planId}` : ''}`;
    const source = lines[index + 1] || '';
    if (source === `${comment} ${url}`) return { url, source: true };
    // A conflicting source cannot be repaired by a separate marker.
    if (source.startsWith(comment + ' http')) return undefined;
    return { url, source: false };
  }
  return undefined;
}

function generatedSidecar(content, url) {
  const match = /^<!-- TensorTonic generated problem context -->\n<!-- sha256:([a-f0-9]{64}) -->\n\n([\s\S]*)$/.exec(content);
  return !!match && crypto.createHash('sha256').update(match[2]).digest('hex') === match[1] &&
    match[2].split('\n').slice(0, 8).includes(`[Original TensorTonic problem](${url})`);
}

// Only reads local files. It never imports a workspace module, discovers Python,
// creates a marker, registers a folder, or traverses arbitrary subdirectories.
async function recognizeStudyFolder({ workspaceRoot, solutionDirectory = 'tensortonic', fs: filesystem = fs, isCurrent = () => true } = {}) {
  const segments = configuredDirectory(solutionDirectory);
  if (!segments || typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || /[\u0000-\u001f\u007f]/.test(workspaceRoot)) return false;
  const root = path.resolve(workspaceRoot);
  const current = () => { try { return isCurrent() === true; } catch (_) { return false; } };
  const check = () => { if (!current()) throw new Error('STALE_STUDY_FOLDER'); };
  let entries = 0, plans = 0, candidates = 0;
  async function directory(file) {
    check();
    const stat = await filesystem.lstat(file);
    check();
    if (!stat.isDirectory() || stat.isSymbolicLink() || await filesystem.realpath(file) !== file) return false;
    check();
    return true;
  }
  async function read(file, maximum, prefix = false) {
    check();
    const stat = await filesystem.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > (prefix ? LIMITS.sourceBytes : maximum)) return undefined;
    if (await filesystem.realpath(file) !== file) return undefined;
    check();
    const handle = await filesystem.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      const live = await filesystem.lstat(file);
      if (!opened.isFile() || opened.nlink > 1 || opened.size > (prefix ? LIMITS.sourceBytes : maximum) || opened.dev !== stat.dev || opened.ino !== stat.ino || live.dev !== opened.dev || live.ino !== opened.ino || live.isSymbolicLink() || await filesystem.realpath(file) !== file) return undefined;
      check();
      const buffer = Buffer.alloc(Math.min(maximum, opened.size));
      let offset = 0, reads = 0;
      while (offset < buffer.length && reads++ < 8) {
        check();
        const part = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!part.bytesRead) break;
        offset += part.bytesRead;
      }
      check();
      if (offset < buffer.length) return undefined;
      const completed = await handle.stat();
      const final = await filesystem.lstat(file);
      if (completed.size !== opened.size || completed.mtimeMs !== opened.mtimeMs || final.dev !== opened.dev || final.ino !== opened.ino || final.isSymbolicLink() || await filesystem.realpath(file) !== file) return undefined;
      check();
      return buffer.subarray(0, offset).toString('utf8');
    } finally { await handle.close(); }
  }
  async function* children(file) {
    check();
    const handle = await filesystem.opendir(file);
    try {
      while (entries < LIMITS.entries) {
        check();
        const entry = await handle.read();
        check();
        if (!entry) break;
        entries++;
        yield entry;
      }
    } finally { await handle.close(); }
  }
  try {
    if (!await directory(root)) return false;
    let solutions = root;
    for (const segment of segments) {
      solutions = path.join(solutions, segment);
      if (!await directory(solutions)) return false;
    }
    for await (const plan of children(solutions)) {
      if (!plan.isDirectory() || plan.isSymbolicLink() || !SLUG.test(plan.name)) continue;
      if (++plans > LIMITS.plans) break;
      const planPath = path.join(solutions, plan.name);
      if (!await directory(planPath)) continue;
      for await (const item of children(planPath)) {
        if (!item.isFile() || item.isSymbolicLink() || !COMMENTS[path.extname(item.name)]) continue;
        if (++candidates > LIMITS.candidates) return false;
        const file = path.join(planPath, item.name);
        let header;
        try { header = await read(file, LIMITS.headerBytes, true); } catch (_) { check(); continue; }
        const ref = typeof header === 'string' && metadata(header, item.name, plan.name);
        if (!ref) continue;
        if (ref.source) { check(); return true; }
        const sidecar = path.join(planPath, path.basename(item.name, path.extname(item.name)) + '.problem.md');
        let content;
        try { content = await read(sidecar, LIMITS.sidecarBytes); } catch (_) { check(); continue; }
        if (typeof content === 'string' && generatedSidecar(content, ref.url)) { check(); return true; }
      }
    }
  } catch (_) { return false; }
  return false;
}

module.exports = { recognizeStudyFolder, configuredDirectory, LIMITS };
