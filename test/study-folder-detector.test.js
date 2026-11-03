'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { recognizeStudyFolder, configuredDirectory, LIMITS } = require('../src/study-folder-detector');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tt-study-folder-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'study');
  await fs.mkdir(workspace);
  return { root, workspace };
}
const ref = { slug: 'pytorch-mini-training', apiId: 'synthetic-id', planId: 'pytorch-basics', technology: 'python' };
const url = value => `https://www.tensortonic.com/problems/${value.slug}${value.planId ? '?studyPlan=' + value.planId : ''}`;
async function solution(workspace, { directory = 'tensortonic', reference = ref, filename = reference.slug + '.py', plan = reference.planId || 'free', source = true, header } = {}) {
  const folder = path.join(workspace, directory, plan);
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, filename);
  await fs.writeFile(file, header === undefined ? `# tensortonic: ${JSON.stringify(reference)}\n${source ? '# ' + url(reference) : '# Learner notes'}\n\npass\n` : header);
  return file;
}
async function sidecar(file, source = url(ref), corrupt = false) {
  const body = `# Synthetic problem\n\n[Original TensorTonic problem](${source})\n\nSynthetic statement.\n`;
  const hash = corrupt ? '0'.repeat(64) : crypto.createHash('sha256').update(body).digest('hex');
  await fs.writeFile(file.replace(/\.[^.]+$/, '.problem.md'), `<!-- TensorTonic generated problem context -->\n<!-- sha256:${hash} -->\n\n${body}`);
}

test('recognizes an existing extension solution tree without registration or writes', async t => {
  const f = await fixture(t), file = await solution(f.workspace);
  const before = await fs.readFile(file);
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), true);
  assert.deepEqual(await fs.readFile(file), before);
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), [path.basename(file)]);
});

test('supports a contained configured directory and free problems', async t => {
  const f = await fixture(t);
  await solution(f.workspace, { directory: 'solutions/tensortonic', reference: { slug: 'synthetic-free' } });
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace, solutionDirectory: 'solutions/tensortonic' }), true);
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
});

test('missing source comment requires a hash-valid generated sidecar with the same canonical source', async t => {
  const f = await fixture(t), file = await solution(f.workspace, { source: false });
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
  await sidecar(file); assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), true);
  await sidecar(file, url(ref), true); assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
  await sidecar(file, 'https://evil.invalid/problems/' + ref.slug); assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
});

test('arbitrary folders, loose metadata, wrong plan/name, and conflicting sources are rejected', async t => {
  const f = await fixture(t);
  for (const [index, options] of [
    { header: 'print("tensortonic")\n' },
    { header: '# tensortonic: {"slug":"pytorch-mini-training","planId":"pytorch-basics"}\n' },
    { filename: 'some-other-file.py' },
    { plan: 'other-plan' },
    { reference: { ...ref, apiId: '../../outside' } },
    { reference: { ...ref, extra: 'unreviewed' } },
    { header: `# tensortonic: ${JSON.stringify(ref)}\n# https://tensortonic.com/problems/${ref.slug}?studyPlan=${ref.planId}\n` },
  ].entries()) {
    const workspace = path.join(f.workspace, 'case' + index); await fs.mkdir(workspace);
    const file = await solution(workspace, options); await sidecar(file);
    const expected = index === 1; // Valid metadata plus a verified generated sidecar is sufficient.
    assert.equal(await recognizeStudyFolder({ workspaceRoot: workspace }), expected, String(index));
  }
});

test('unsafe solution paths fail closed before filesystem access', async () => {
  const filesystem = new Proxy({}, { get() { throw Error('filesystem must remain untouched'); } });
  for (const value of ['../outside', '/outside', 'x/../outside', '.', './x', 'C:\\outside', '\\outside', 'file:///outside', 'x//y', 'x\u0000y', 'x/./y']) {
    assert.equal(configuredDirectory(value), undefined, value);
    assert.equal(await recognizeStudyFolder({ workspaceRoot: '/synthetic', solutionDirectory: value, fs: filesystem }), false);
  }
});

test('workspace, configured directory, plan, and solution symlinks never authorize a study folder', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
  const outsideFile = await solution(outside);
  const alias = path.join(f.root, 'workspace-link'); await fs.symlink(outside, alias);
  assert.equal(await recognizeStudyFolder({ workspaceRoot: alias }), false);
  await fs.symlink(path.join(outside, 'tensortonic'), path.join(f.workspace, 'tensortonic'));
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
  await fs.unlink(path.join(f.workspace, 'tensortonic')); await fs.mkdir(path.join(f.workspace, 'tensortonic'));
  await fs.symlink(path.dirname(outsideFile), path.join(f.workspace, 'tensortonic', ref.planId));
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
  await fs.unlink(path.join(f.workspace, 'tensortonic', ref.planId)); await fs.mkdir(path.join(f.workspace, 'tensortonic', ref.planId));
  await fs.symlink(outsideFile, path.join(f.workspace, 'tensortonic', ref.planId, path.basename(outsideFile)));
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
});

test('symlinked sidecars and hard-linked source files are rejected', async t => {
  const f = await fixture(t), file = await solution(f.workspace, { source: false });
  const target = path.join(f.root, 'outside.problem.md'); await sidecar(target.replace('.problem.md', '.py'));
  await fs.symlink(target, file.replace('.py', '.problem.md'));
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
  await fs.writeFile(file, `# tensortonic: ${JSON.stringify(ref)}\n# ${url(ref)}\n`);
  await fs.link(file, path.join(f.root, 'hard-linked.py'));
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
});

test('oversized candidates and sidecars are not read', async t => {
  const f = await fixture(t), file = await solution(f.workspace);
  await fs.truncate(file, LIMITS.sourceBytes + 1);
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
  await solution(f.workspace, { source: false }); await sidecar(file);
  await fs.truncate(file.replace('.py', '.problem.md'), LIMITS.sidecarBytes + 1);
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace }), false);
});

test('a source replaced or grown between stat and opening is rejected', async t => {
  const f = await fixture(t), file = await solution(f.workspace);
  const filesystem = Object.create(fs);
  filesystem.open = async (...args) => {
    const handle = await fs.open(...args);
    if (args[0] === file) await fs.truncate(file, LIMITS.sourceBytes + 1);
    return handle;
  };
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace, fs: filesystem }), false);
});

test('candidate scanning and file reads have fixed budgets', async t => {
  const f = await fixture(t), folder = path.join(f.workspace, 'tensortonic', ref.planId); await fs.mkdir(folder, { recursive: true });
  for (let index = 0; index < LIMITS.candidates + 10; index++) await fs.writeFile(path.join(folder, `case-${index}.py`), '# no metadata\n');
  let reads = 0;
  const filesystem = Object.create(fs); filesystem.open = (...args) => { reads++; return fs.open(...args); };
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace, fs: filesystem }), false);
  assert.equal(reads, LIMITS.candidates);
});

test('stale or throwing generation guards discard recognition without opening a source file', async t => {
  const f = await fixture(t); await solution(f.workspace);
  let active = true, opened = 0;
  const filesystem = Object.create(fs);
  filesystem.lstat = async file => { const stat = await fs.lstat(file); active = false; return stat; };
  filesystem.open = (...args) => { opened++; return fs.open(...args); };
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace, fs: filesystem, isCurrent: () => active }), false);
  assert.equal(opened, 0);
  assert.equal(await recognizeStudyFolder({ workspaceRoot: f.workspace, isCurrent: () => { throw Error('expired'); } }), false);
});
