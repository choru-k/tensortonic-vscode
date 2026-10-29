'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TensorTonicClient } = require('../src/client');

const ok = data => ({ status: 'success', data });
function detail(extra = {}) {
  return { id: 'api-id', title: '# <span>Example</span>', description: 'Statement', requirements: '- Requirement', constraints: '- Constraint',
    starterCode: 'def example(x):\n    pass\n', examples: ['Input: x=0'], functionMetadata: { runtime: 'pytorch' },
    testCases: [{ id: 'public', inputs: { x: 0 }, isPublic: true }, { id: 'private', inputs: { x: 999 }, isPublic: false }],
    solution: 'DO NOT SHOW ANSWERS', theory: 'DO NOT COPY THEORY', ...extra };
}

test('catalog paginates, deduplicates and retains API id separately from canonical browser slug', async () => {
  const requests = [];
  const python = { slug: 'browser-slug', id: 'api-id', sourceId: 'api-id', source: 'python', category: 'pytorch', planId: 'pytorch-basics', title: 'Example', solved: true };
  const client = new TensorTonicClient(async path => {
    requests.push(path);
    return ok({ problems: requests.length === 1 ? [python, { ...python, slug: 'gpu-problem', source: 'cuda' }] : [python], pagination: { hasMore: requests.length === 1, totalPages: 2 } });
  });
  const problems = await client.listProblems('pytorch-basics');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].slug, 'browser-slug'); assert.equal(problems[0].apiId, 'api-id');
  assert.equal(problems[0].solved, true);
  assert.deepEqual(requests, ['/api/problems/list?page=1&limit=100&planId=pytorch-basics', '/api/problems/list?page=2&limit=100&planId=pytorch-basics']);
});

test('free catalog does not accidentally mix premium study-plan problems', async () => {
  const client = new TensorTonicClient(async () => ok({ problems: [
    { slug: 'free-problem', id: 'free-problem', source: 'free', category: 'numpy', title: 'Free' },
    { slug: 'plan-problem', id: 'plan-problem', source: 'python', planId: 'pytorch-basics', category: 'pytorch' },
  ], pagination: { hasMore: false } }));
  assert.deepEqual((await client.listProblems()).map(p => p.slug), ['free-problem']);
});

test('detail includes requirements and constraints, omits private cases and answer material', async () => {
  const requests = [];
  const client = new TensorTonicClient(async path => { requests.push(path); return ok(detail()); });
  const problem = await client.getProblem({ slug: 'browser-slug', apiId: 'api-id', planId: 'pytorch-basics' });
  assert.deepEqual(requests, ['/api/study-plans/pytorch-basics/problems/api-id']);
  assert.equal(problem.title, 'Example');
  assert.match(problem.description, /Requirement/); assert.match(problem.description, /Constraint/);
  assert.deepEqual(problem.testCases.map(t => t.id), ['public']);
  assert.doesNotMatch(JSON.stringify(problem), /DO NOT|private|999/);
});

test('Run uses the exact observed website wrapper and does not lose scalar zero inputs', async () => {
  const calls = [];
  const result = { status: 'success', data: { passed: false, output: 0 } };
  const client = new TensorTonicClient(async (path, options) => { calls.push({ path, options }); return result; });
  const problem = { ref: { slug: 'softmax', apiId: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics' }, raw: { functionMetadata: { runtime: 'pytorch' } } };
  assert.strictEqual(await client.run(problem, 'current code', [{ id: 'case-1', name: 'Zero', inputs: { x: 0 }, isPublic: true }]), result);
  assert.deepEqual(calls, [{ path: '/api/study-plans/pytorch-basics/problems/pytorch-softmax-from-scratch/run', options: { method: 'POST', body: { code: 'current code', testCases: [{ id: 'case-1', inputs: { x: 0 } }] } } }]);
});

test('free Run/Submit carry problemType and Submit is sent exactly once', async () => {
  const calls = [];
  const client = new TensorTonicClient(async (path, options) => { calls.push({ path, options }); return { status: 'error', message: 'Wrong answer' }; });
  const problem = { ref: { slug: 'sigmoid-numpy' }, testCases: [{ inputs: { x: 0 } }] };
  await client.run(problem, 'pass'); await client.submit(problem, 'pass');
  assert.deepEqual(calls.map(c => c.path), ['/api/problems/sigmoid-numpy/run-cases', '/api/problems/sigmoid-numpy/submit']);
  assert.deepEqual(calls[1].options.body, { code: 'pass', problemType: 'free' });
});

test('unsupported runtimes and malformed cases fail before any grading request', async () => {
  let count = 0;
  const client = new TensorTonicClient(async () => { count++; });
  for (const ref of [{ slug: 'x', planId: 'cuda-basics' }, { slug: 'x', technology: 'SQL' }, { slug: 'x', source: 'triton' }]) await assert.rejects(client.run({ ref }, 'code', []), /not supported/);
  await assert.rejects(client.submit({ ref: { slug: 'x' }, raw: { functionMetadata: { runtime: 'cuda' } } }, 'code'), /not supported/);
  await assert.rejects(client.run({ ref: { slug: 'x' } }, 'code', [{ x: 0 }]), /inputs object/);
  await assert.rejects(client.getProblem({ slug: '../billing' }), /Invalid/);
  assert.equal(count, 0);
});

test('authentication and invalid catalog pagination errors are surfaced', async () => {
  const unauthorized = new TensorTonicClient(async () => ({ status: 'error', message: 'Authentication required' }));
  await assert.rejects(unauthorized.getProblem({ slug: 'x' }), /Authentication required/);
  const bad = new TensorTonicClient(async () => ok({ problems: [], pagination: { hasMore: true, totalPages: 2 } }));
  await assert.rejects(bad.listProblems(), /pagination/);
});
