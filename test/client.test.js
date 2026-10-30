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
function planData(problems, extra = {}) {
  return { id: 'pytorch-basics', sections: [{ sortOrder: 1, problems: problems.map((slug, index) => ({ slug, type: 'python', sortOrder: index + 1 })) }], ...extra };
}

test('catalog paginates, deduplicates and retains API id separately from canonical browser slug', async () => {
  const requests = [];
  const python = { slug: 'browser-slug', id: 'api-id', sourceId: 'api-id', source: 'python', category: 'pytorch', planId: 'pytorch-basics', title: 'Example', solved: true };
  const client = new TensorTonicClient(async path => {
    requests.push(path);
    if (path === '/api/study-plans/pytorch-basics') return ok(planData(['api-id']));
    return ok({ problems: requests.length === 1 ? [python, { ...python, slug: 'gpu-problem', source: 'cuda' }] : [python], pagination: { hasMore: requests.length === 1, totalPages: 2 } });
  });
  const problems = await client.listProblems('pytorch-basics');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].slug, 'browser-slug'); assert.equal(problems[0].apiId, 'api-id');
  assert.equal(problems[0].solved, true);
  assert.deepEqual(requests, ['/api/problems/list?page=1&limit=100&planId=pytorch-basics', '/api/problems/list?page=2&limit=100&planId=pytorch-basics', '/api/study-plans/pytorch-basics']);
});

test('study plans use section and problem sortOrder, retaining progress and API/browser identities', async () => {
  const item = (id, extra = {}) => ({ id, slug: id, source: 'python', planId: 'pytorch-basics', category: 'pytorch', ...extra });
  const catalogue = [item('last', { sortOrder: 1 }), item('second', { sortOrder: 999 }), item('first', { sourceId: 'api-first', solved: true, title: 'First' }), item('other-plan', { planId: 'numpy-basics' })];
  const plan = planData([], { sections: [
    { sortOrder: 2, problems: [{ slug: 'last', type: 'python', sortOrder: 1 }] },
    { sortOrder: 1, problems: [{ slug: 'second', type: 'python', sortOrder: 2 }, { slug: 'api-first', type: 'python', sortOrder: 1 }] },
  ] });
  const calls = [];
  const client = new TensorTonicClient(async (path, options) => {
    calls.push({ path, options });
    return ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : plan);
  });
  const result = await client.listProblems('pytorch-basics');
  assert.deepEqual(result.map(p => p.slug), ['first', 'second', 'last']);
  assert.deepEqual(result[0], { slug: 'first', apiId: 'api-first', catalogSlug: 'first', source: 'python', technology: 'pytorch', planId: 'pytorch-basics', title: 'First', difficulty: '', solved: true,
    studyPlanTitle: 'pytorch-basics', section: { id: 'index:1', title: 'Section 1', order: 1 } });
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.equal(plan.sections[0].sortOrder, 2, 'ordering must not mutate the service response');
});

test('study-plan metadata preserves stable section identities and sanitizes display titles', async () => {
  const catalogue = ['a', 'b', 'c'].map(slug => ({ slug, id: slug, source: 'python', planId: 'pytorch-basics', solved: slug === 'b' }));
  const plan = planData([], { title: '# <span>PyTorch\n Sheet</span>\u202e', sections: [
    { id: 'training', title: '<b>Repeated</b>\t title', sortOrder: 2, problems: [{ slug: 'c', type: 'python', sortOrder: 1 }] },
    { id: 'foundations', title: '# Repeated\u0000 title', sortOrder: 1, problems: [{ slug: 'a', type: 'python', sortOrder: 1 }, { slug: 'b', type: 'python', sortOrder: 2 }] },
  ] });
  const client = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : plan));
  const result = await client.listProblems('pytorch-basics');
  assert.deepEqual(result.map(p => [p.slug, p.studyPlanTitle, p.section]), [
    ['a', 'PyTorch Sheet', { id: 'foundations', title: 'Repeated title', order: 1 }],
    ['b', 'PyTorch Sheet', { id: 'foundations', title: 'Repeated title', order: 1 }],
    ['c', 'PyTorch Sheet', { id: 'training', title: 'Repeated title', order: 2 }],
  ]);
  assert.equal(result[1].solved, true);
  assert.notStrictEqual(result[0].section, result[1].section, 'metadata must not share mutable objects between references');
  assert.equal(plan.sections[0].title, '<b>Repeated</b>\t title', 'source metadata remains untouched');
  plan.sections.reverse();
  assert.deepEqual((await client.listProblems('pytorch-basics')).map(p => p.section.id), ['foundations', 'foundations', 'training']);
});

test('missing or unsafe section metadata uses deterministic distinct fallbacks and bounded plain labels', async () => {
  const catalogue = ['a', 'b', 'c'].map(slug => ({ slug, id: slug, source: 'python', planId: 'pytorch-basics' }));
  const plan = planData([], { title: {}, sections: [
    { id: '../unsafe', title: null, sortOrder: 2, problems: [{ slug: 'b', type: 'python', sortOrder: 1 }] },
    { title: '<span></span>\n', sortOrder: 1, problems: [{ slug: 'a', type: 'python', sortOrder: 1 }] },
    { id: 'section-1', title: '📚'.repeat(300), sortOrder: 3, problems: [{ slug: 'c', type: 'python', sortOrder: 1 }] },
  ] });
  const client = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : plan));
  const result = await client.listProblems('pytorch-basics');
  assert.ok(result.every(p => p.studyPlanTitle === 'pytorch-basics'));
  assert.deepEqual(result.slice(0, 2).map(p => p.section), [{ id: 'index:1', title: 'Section 1', order: 1 }, { id: 'index:0', title: 'Section 2', order: 2 }]);
  assert.equal(Array.from(result[2].section.title).length, 240);
  assert.equal(result[2].section.id, 'section-1');
});

test('duplicate service section IDs fail instead of merging different curriculum sections', async () => {
  const catalogue = ['a', 'b'].map(slug => ({ slug, id: slug, source: 'python', planId: 'pytorch-basics' }));
  const plan = planData([], { sections: ['a', 'b'].map((slug, index) => ({ id: 'duplicate', title: 'Title', sortOrder: index + 1, problems: [{ slug, type: 'python', sortOrder: 1 }] })) });
  const client = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : plan));
  await assert.rejects(client.listProblems('pytorch-basics'), /duplicate study-plan section/);
});

test('study-plan stable ties and repeated entries preserve service sequence without duplicates', async () => {
  const catalogue = ['b', 'a'].map(slug => ({ slug, id: slug, source: 'python', planId: 'pytorch-basics' }));
  const plan = planData([], { sections: [
    { sortOrder: 1, problems: [{ slug: 'a', type: 'python', sortOrder: 1 }, { slug: 'b', type: 'python', sortOrder: 1 }] },
    { sortOrder: 1, problems: [{ slug: 'a', type: 'python', sortOrder: 1 }, { slug: 'unsupported', type: 'cuda', sortOrder: 2 }] },
  ] });
  const client = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : plan));
  assert.deepEqual((await client.listProblems('pytorch-basics')).map(p => p.slug), ['a', 'b']);
});

test('missing or mismatched study-plan order fails explicitly instead of silently showing catalogue order', async () => {
  const catalogue = [{ slug: 'a', id: 'a', source: 'python', planId: 'pytorch-basics' }];
  for (const plan of [
    {}, planData(['a'], { id: 'wrong-plan' }), planData([], { sections: [{ problems: [] }] }),
    planData([], { sections: [{ sortOrder: 1, problems: null }] }),
    planData([], { sections: [{ sortOrder: 1, problems: [{ slug: 'a', type: 'python' }] }] }),
    planData(['missing']), planData([]),
  ]) {
    const client = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : plan));
    await assert.rejects(client.listProblems('pytorch-basics'), /study-plan/);
  }
  const client = new TensorTonicClient(async path => path.startsWith('/api/problems/list?') ? ok({ problems: catalogue }) : { status: 'error', message: 'Plan access denied' });
  await assert.rejects(client.listProblems('pytorch-basics'), /Plan access denied/);
});

test('ambiguous API identities are rejected rather than navigating to the wrong problem', async () => {
  const catalogue = ['browser-a', 'browser-b'].map(slug => ({ slug, sourceId: 'shared-id', source: 'python', planId: 'pytorch-basics' }));
  const client = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: catalogue } : planData(['shared-id'])));
  await assert.rejects(client.listProblems('pytorch-basics'), /do not match/);
});

test('empty study plans remain empty and plan metadata transport errors are surfaced', async () => {
  const empty = new TensorTonicClient(async path => ok(path.startsWith('/api/problems/list?') ? { problems: [] } : planData([])));
  assert.deepEqual(await empty.listProblems('pytorch-basics'), []);
  const unavailable = new TensorTonicClient(async path => {
    if (path.startsWith('/api/problems/list?')) return ok({ problems: [] });
    throw new Error('Bridge disconnected');
  });
  await assert.rejects(unavailable.listProblems('pytorch-basics'), /Bridge disconnected/);
});

test('free catalog does not accidentally mix premium study-plan problems', async () => {
  const client = new TensorTonicClient(async () => ok({ problems: [
    { slug: 'free-problem', id: 'free-problem', source: 'free', category: 'numpy', title: 'Free' },
    { slug: 'plan-problem', id: 'plan-problem', source: 'python', planId: 'pytorch-basics', category: 'pytorch' },
  ], pagination: { hasMore: false } }));
  const result = await client.listProblems();
  assert.deepEqual(result.map(p => p.slug), ['free-problem']);
  assert.equal('studyPlanTitle' in result[0], false);
  assert.equal('section' in result[0], false);
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
