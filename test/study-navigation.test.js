'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { problemKey, findProblemIndex, navigationTargets, recognizedSolution } = require('../src/study-navigation');

const PLAN = 'pytorch-basics';
const ref = (slug, overrides = {}) => ({ slug, apiId: `api-${slug}`, planId: PLAN, solved: false, ...overrides });
const document = (metadata, { filePath = '/study/solution.py', scheme = 'file', prefix = '', suffix = '\npass\n', ...overrides } = {}) => ({
  uri: { scheme, path: filePath },
  languageId: filePath.endsWith('.py') ? 'python' : 'plaintext',
  getText: () => `${prefix}# tensortonic: ${JSON.stringify(metadata)}${suffix}`,
  ...overrides,
});
const emptyTargets = { previous: undefined, next: undefined, nextUnsolved: undefined, index: -1 };

test('problem keys prefer API identity, scope plans and keep legacy slugs distinct', () => {
  const problem = ref('browser-alias', { apiId: 'stable-id' });
  assert.equal(problemKey(problem), problemKey({ ...problem, slug: 'renamed-alias' }));
  assert.equal(problemKey({ problemRef: problem }), problemKey(problem));
  assert.equal(problemKey({ ref: problem }), problemKey(problem));
  assert.notEqual(problemKey(problem), problemKey({ ...problem, planId: 'numpy-basics' }));
  assert.notEqual(problemKey({ slug: 'stable-id', planId: PLAN }), problemKey(problem));
  assert.equal(problemKey({ slug: 'free' }), problemKey({ slug: 'free', planId: '' }));
  for (const invalid of [undefined, null, 'plain-slug', {}, { slug: 1 }, { slug: 'x', planId: {} }]) {
    assert.equal(problemKey(invalid), undefined);
  }
});

test('findProblemIndex uses API IDs before renamed browser aliases and preserves original indices', () => {
  const problems = [null, ref('other'), ref('browser-alias', { apiId: 'stable-id' })];
  assert.equal(findProblemIndex(problems, { slug: 'old-alias', apiId: 'stable-id', planId: PLAN }), 2);
  assert.equal(findProblemIndex(problems, { problemRef: problems[2] }), 2);
  assert.equal(findProblemIndex(problems, { ref: problems[2] }), 2);
  assert.equal(findProblemIndex(problems, { slug: 'browser-alias', planId: PLAN }), 2);
  assert.equal(findProblemIndex(problems, { slug: 'stable-id', planId: PLAN }), -1);
  assert.equal(findProblemIndex(problems, { ...problems[2], planId: 'numpy-basics' }), -1);
  assert.equal(findProblemIndex(problems, { slug: 'browser-alias' }), -1);
});

test('legacy slugs cannot select a different browser row whose API ID happens to match', () => {
  const problems = [ref('different-browser-slug', { apiId: 'browser-a' }), ref('browser-a', { apiId: 'stable-b' })];
  assert.equal(findProblemIndex(problems, { slug: 'browser-a', planId: PLAN }), 1);
  assert.equal(findProblemIndex(problems, { slug: 'browser-a', apiId: 'browser-a', planId: PLAN }), 0);
});

test('API-less rows do not impersonate API identities when their browser slugs collide', () => {
  const problems = [ref('browser-alias', { apiId: 'stable-id' }), ref('stable-id', { apiId: undefined })];
  assert.equal(findProblemIndex(problems, { slug: 'renamed-alias', apiId: 'stable-id', planId: PLAN }), 0);
  assert.equal(findProblemIndex(problems, { slug: 'stable-id', planId: PLAN }), 1);
  assert.equal(findProblemIndex([problems[1]], { slug: 'renamed-alias', apiId: 'stable-id', planId: PLAN }), -1);
});

test('an explicit conflicting API ID cannot fall back to a browser alias', () => {
  const problems = [ref('same-alias', { apiId: 'actual-id' })];
  assert.equal(findProblemIndex(problems, { slug: 'same-alias', apiId: 'different-id', planId: PLAN }), -1);
  const legacy = ref('legacy-alias', { apiId: undefined });
  assert.equal(findProblemIndex([legacy], { ...legacy, apiId: 'new-api-id' }), 0);
  assert.equal(findProblemIndex([legacy, { ...legacy }], { ...legacy, apiId: 'new-api-id' }), -1);
});

test('duplicate API identities and ambiguous browser aliases never choose an arbitrary row', () => {
  const duplicateIds = [ref('first-alias', { apiId: 'same-id' }), ref('second-alias', { apiId: 'same-id' })];
  assert.equal(findProblemIndex(duplicateIds, duplicateIds[0]), -1);
  const duplicateAliases = [ref('same-alias', { apiId: 'one' }), ref('same-alias', { apiId: 'two' })];
  assert.equal(findProblemIndex(duplicateAliases, { slug: 'same-alias', planId: PLAN }), -1);
  assert.equal(findProblemIndex(duplicateAliases, duplicateAliases[1]), 1);
  assert.deepEqual(navigationTargets(duplicateIds, duplicateIds[0], { selectedPlanId: PLAN }), emptyTargets);
  assert.deepEqual(navigationTargets(duplicateAliases, { slug: 'same-alias', planId: PLAN }, { selectedPlanId: PLAN }), emptyTargets);
});

test('duplicate API target identities cannot become Next or Next Unsolved destinations', () => {
  const problems = [ref('current', { solved: true }), ref('duplicate-one', { apiId: 'duplicate' }), ref('duplicate-two', { apiId: 'duplicate' })];
  assert.deepEqual(navigationTargets(problems, problems[0], { selectedPlanId: PLAN }), { ...emptyTargets, index: 0 });
  assert.deepEqual(navigationTargets(problems, undefined, { selectedPlanId: PLAN }), emptyTargets);
});

test('navigation skips ambiguous target rows in either direction without wrapping or reordering safe rows', () => {
  const problems = [
    ref('first', { solved: true }), ref('duplicate-one', { apiId: 'duplicate' }),
    ref('unknown', { solved: undefined }), ref('duplicate-two', { apiId: 'duplicate' }), ref('last'),
  ];
  assert.deepEqual(navigationTargets(problems, problems[0], { selectedPlanId: PLAN }), {
    previous: undefined, next: problems[2], nextUnsolved: problems[4], index: 0,
  });
  assert.deepEqual(navigationTargets(problems, problems[4], { selectedPlanId: PLAN }), {
    previous: problems[2], next: undefined, nextUnsolved: undefined, index: 4,
  });
  assert.equal(navigationTargets(problems, undefined, { selectedPlanId: PLAN }).nextUnsolved, problems[4]);
  for (const current of [undefined, ...problems]) {
    const targets = navigationTargets(problems, current, { selectedPlanId: PLAN });
    for (const target of [targets.previous, targets.next, targets.nextUnsolved]) {
      if (target) assert.equal(findProblemIndex(problems, target), problems.indexOf(target));
    }
  }
});

test('legacy aliases are quarantined when ambiguous, while explicit unique API targets remain usable', () => {
  const problems = [
    ref('current', { solved: true }), ref('duplicate-alias', { apiId: undefined }),
    ref('duplicate-alias', { apiId: undefined }), ref('shared-alias', { apiId: undefined }),
    ref('shared-alias', { apiId: 'explicit-one' }), ref('shared-alias', { apiId: 'explicit-two' }),
  ];
  assert.deepEqual(navigationTargets(problems, problems[0], { selectedPlanId: PLAN }), {
    previous: undefined, next: problems[4], nextUnsolved: problems[4], index: 0,
  });
  assert.deepEqual(navigationTargets(problems, problems[4], { selectedPlanId: PLAN }), {
    previous: problems[0], next: problems[5], nextUnsolved: problems[5], index: 4,
  });
  assert.deepEqual(navigationTargets(problems, problems[5], { selectedPlanId: PLAN }), {
    previous: problems[4], next: undefined, nextUnsolved: undefined, index: 5,
  });
});

test('duplicate IDs in another plan do not make a selected-plan problem ambiguous', () => {
  const problems = [ref('one', { apiId: 'same-id' }), ref('other-plan', { apiId: 'same-id', planId: 'numpy-basics' })];
  assert.equal(findProblemIndex(problems, problems[0]), 0);
  assert.equal(findProblemIndex(problems, problems[1]), 1);
  const current = ref('current', { solved: true });
  assert.deepEqual(navigationTargets([current, ...problems], current, { selectedPlanId: PLAN }), {
    previous: undefined, next: problems[0], nextUnsolved: problems[0], index: 0,
  });
});

test('navigation preserves service order across sections without changing source objects', () => {
  const problems = [
    ref('z-last-alphabetically', { sortOrder: 99, section: { id: 'tensors', order: 3 } }),
    ref('a-first-alphabetically', { sortOrder: 1, section: { id: 'tensors', order: 3 } }),
    ref('middle', { sortOrder: 0, section: { id: 'autograd', order: 8 } }),
  ];
  const snapshot = structuredClone(problems);
  Object.freeze(problems);
  for (const problem of problems) Object.freeze(problem);
  const targets = navigationTargets(problems, problems[1], { selectedPlanId: PLAN });
  assert.equal(targets.previous, problems[0]);
  assert.equal(targets.next, problems[2]);
  assert.equal(targets.nextUnsolved, problems[2]);
  assert.equal(targets.index, 1);
  assert.deepEqual(problems, snapshot);
});

test('first, last, singleton and empty plans have undefined boundary targets', () => {
  const problems = [ref('one'), ref('two')];
  assert.deepEqual(navigationTargets(problems, problems[0], { selectedPlanId: PLAN }), {
    previous: undefined, next: problems[1], nextUnsolved: problems[1], index: 0,
  });
  assert.deepEqual(navigationTargets(problems, problems[1], { selectedPlanId: PLAN }), {
    previous: problems[0], next: undefined, nextUnsolved: undefined, index: 1,
  });
  assert.deepEqual(navigationTargets([problems[0]], problems[0], { selectedPlanId: PLAN }), { ...emptyTargets, index: 0 });
  assert.deepEqual(navigationTargets([], problems[0], { selectedPlanId: PLAN }), emptyTargets);
});

test('Next Unsolved skips solved and unknown progress and never wraps', () => {
  const problems = [
    ref('earlier-unsolved'), ref('current', { solved: true }), ref('unknown', { solved: undefined }),
    ref('missing', { solved: undefined }), ref('null', { solved: null }), ref('string', { solved: 'false' }),
    ref('zero', { solved: 0 }), ref('solved', { solved: true }), ref('next-unsolved'), ref('last', { solved: true }),
  ];
  delete problems[3].solved;
  assert.equal(navigationTargets(problems, problems[1], { selectedPlanId: PLAN }).nextUnsolved, problems[8]);
  assert.equal(navigationTargets(problems, problems[8], { selectedPlanId: PLAN }).nextUnsolved, undefined);
  assert.equal(navigationTargets(problems, problems[9], { selectedPlanId: PLAN }).nextUnsolved, undefined);
});

test('missing and old-plan current documents can only start Next Unsolved in the selected plan', () => {
  const problems = [ref('solved', { solved: true }), ref('unknown', { solved: undefined }), ref('first-unsolved'), ref('last-unsolved')];
  for (const current of [undefined, ref('not-in-plan'), ref('old-dirty', { planId: 'previous-plan' })]) {
    assert.deepEqual(navigationTargets(problems, current, { selectedPlanId: PLAN }), {
      previous: undefined, next: undefined, nextUnsolved: problems[2], index: -1,
    });
  }
});

test('a plan switch never exposes old-plan Previous or Next targets', () => {
  const oldProblems = [ref('old-first'), ref('old-second')];
  const current = { ...oldProblems[0] };
  assert.deepEqual(navigationTargets(oldProblems, current, { selectedPlanId: 'numpy-basics' }), emptyTargets);
  const newProblems = [ref('new-first', { planId: 'numpy-basics' }), ref('new-second', { planId: 'numpy-basics' })];
  assert.deepEqual(navigationTargets(newProblems, current, { selectedPlanId: 'numpy-basics' }), {
    previous: undefined, next: undefined, nextUnsolved: newProblems[0], index: -1,
  });
});

test('mixed-plan lists retain source indices but never return a foreign-plan target', () => {
  const problems = [ref('one'), ref('foreign', { planId: 'numpy-basics' }), ref('two'), ref('foreign-last', { planId: 'numpy-basics' })];
  assert.deepEqual(navigationTargets(problems, problems[0], { selectedPlanId: PLAN }), {
    previous: undefined, next: problems[2], nextUnsolved: problems[2], index: 0,
  });
  assert.deepEqual(navigationTargets(problems, problems[2], { selectedPlanId: PLAN }), {
    previous: problems[0], next: undefined, nextUnsolved: undefined, index: 2,
  });
});

test('free problems have no study-plan Previous or Next but can find following explicit unsolved progress', () => {
  const problems = [ref('one', { planId: undefined }), ref('two', { planId: '' })];
  assert.deepEqual(navigationTargets(problems, problems[0], { selectedPlanId: '' }), {
    previous: undefined, next: undefined, nextUnsolved: problems[1], index: 0,
  });
  assert.deepEqual(navigationTargets(problems, undefined, { selectedPlanId: '' }), {
    previous: undefined, next: undefined, nextUnsolved: problems[0], index: -1,
  });
});

test('omitting a selected plan only infers a unique supplied plan, never an old document plan', () => {
  const problems = [ref('one'), ref('two')];
  assert.equal(navigationTargets(problems, problems[0]).next, problems[1]);
  assert.deepEqual(navigationTargets([problems[0], ref('other', { planId: 'numpy-basics' })], problems[0]), emptyTargets);
  assert.deepEqual(navigationTargets([], problems[0]), emptyTargets);
});

test('invalid navigation input is inert and malformed rows are skipped', () => {
  const problem = ref('one');
  for (const invalid of [undefined, null, {}, 'problems']) {
    assert.equal(findProblemIndex(invalid, problem), -1);
    assert.deepEqual(navigationTargets(invalid, problem, { selectedPlanId: PLAN }), emptyTargets);
  }
  for (const invalid of [undefined, null, 'one', {}, { planId: PLAN }]) assert.equal(findProblemIndex([problem], invalid), -1);
  assert.deepEqual(navigationTargets([null, {}, { solved: false }, problem], undefined, { selectedPlanId: PLAN }), {
    previous: undefined, next: undefined, nextUnsolved: problem, index: -1,
  });
});

test('recognizedSolution reads valid Python metadata and returns the normalized reference only', () => {
  const metadata = { slug: 'browser-alias', apiId: 'stable-api-id', planId: PLAN, technology: 'PyTorch', unexpected: 'discard' };
  assert.deepEqual(recognizedSolution(document(metadata)), { slug: metadata.slug, apiId: metadata.apiId, planId: PLAN, technology: 'PyTorch' });
  assert.deepEqual(recognizedSolution(document({ slug: 'legacy' })), { slug: 'legacy' });
  assert.deepEqual(recognizedSolution(document({ slug: 'legacy', planId: 'custom-learning-plan' })), { slug: 'legacy', planId: 'custom-learning-plan' });
  for (const technology of ['Python', 'python3', 'NumPy', 'Pandas', 'PyTorch']) {
    assert.equal(recognizedSolution(document({ slug: 'valid', technology })).technology, technology);
  }
  assert.equal(recognizedSolution(document({ slug: 'valid' }, { filePath: '/study/solution.PY' })).slug, 'valid');
});

test('metadata is recognized within the first eight lines, including CRLF, but never later', () => {
  const metadata = { slug: 'line-eight', planId: PLAN };
  const recognized = document(metadata, { prefix: '# header\r\n'.repeat(7), suffix: '\r\npass\r\n' });
  assert.equal(recognizedSolution(recognized).slug, 'line-eight');
  assert.equal(recognizedSolution(document(metadata, { prefix: '# header\n'.repeat(8) })), undefined);
  assert.equal(recognizedSolution(document(metadata, { getText: () => 'pass\n' })), undefined);
});

test('protected and foreign documents are rejected before reading editor content', () => {
  for (const filePath of ['/study/solution.tests.json', '/study/solution.problem.md', '/study/plain.txt', '/study/solution.sql', '/study/solution.cu', '/study/solution.cpp', '/study/solution.py.bak']) {
    const foreign = document({ slug: 'valid' }, { filePath, getText: () => assert.fail('protected file content was read') });
    assert.equal(recognizedSolution(foreign), undefined);
  }
  for (const scheme of ['untitled', 'vscode-remote', 'git', 'https']) {
    assert.equal(recognizedSolution(document({ slug: 'valid' }, { scheme, getText: () => assert.fail('foreign document content was read') })), undefined);
  }
});

test('SQL, CUDA, Triton and C++ metadata cannot become Python solution controls by using a .py suffix', () => {
  for (const technology of ['SQL', 'PostgreSQL', 'CUDA', 'Triton', 'PyTorch / CUDA', 'cpp', 'C++']) {
    assert.equal(recognizedSolution(document({ slug: 'valid', technology })), undefined, technology);
  }
  for (const planId of ['sql-basics', 'cuda-basics', 'triton-basics', 'advanced-sql', 'cpp-basics']) {
    assert.equal(recognizedSolution(document({ slug: 'valid', planId })), undefined, planId);
  }
});

test('invalid and forged metadata never recognizes a solution', () => {
  for (const metadata of [null, [], 'slug', {}, { slug: '../outside' }, { slug: 'https://evil.example' }, { slug: 'x', apiId: '' }, { slug: 'x', apiId: {} }, { slug: 'x', planId: '../outside' }, { slug: 'x', planId: 1 }]) {
    assert.equal(recognizedSolution(document(metadata)), undefined);
  }
  for (const text of ['# tensortonic: {broken}', '# tensortonic: {"slug":"valid"} trailing text', 'print("# tensortonic: {\\"slug\\":\\"valid\\"}")', 'tensortonic: {"slug":"valid"}']) {
    assert.equal(recognizedSolution(document({}, { getText: () => text })), undefined, text);
  }
  assert.equal(recognizedSolution(undefined), undefined);
  assert.equal(recognizedSolution({ uri: { scheme: 'file', path: '/study/x.py' } }), undefined);
  assert.equal(recognizedSolution(document({}, { getText: () => { throw new Error('closed document'); } })), undefined);
});

test('injected readRef receives only the metadata header and cannot bypass file or metadata checks', () => {
  const metadata = { slug: 'safe', planId: PLAN };
  let calls = 0;
  const readRef = header => {
    calls += 1;
    assert.ok(header.split('\n').length <= 8);
    assert.ok(!header.includes('PRIVATE_BODY_SENTINEL'));
    return { ...metadata, unexpected: 'discard' };
  };
  const solution = document(metadata, { suffix: '\n# header\n'.repeat(8) + 'PRIVATE_BODY_SENTINEL\n' });
  assert.deepEqual(recognizedSolution(solution, { readRef }), metadata);
  assert.equal(calls, 1);
  assert.equal(recognizedSolution(document(metadata, { filePath: '/study/solution.tests.json' }), { readRef }), undefined);
  assert.equal(recognizedSolution(document(metadata, { getText: () => 'pass\n' }), { readRef }), undefined);
  assert.equal(calls, 1);
  assert.equal(recognizedSolution(solution, { readRef: () => { throw new Error('invalid metadata'); } }), undefined);
  assert.equal(recognizedSolution(solution, { readRef: () => ({ slug: '../unsafe' }) }), undefined);
  assert.equal(recognizedSolution(solution, { readRef: () => ({ slug: 'safe', technology: 'CUDA' }) }), undefined);
  assert.equal(recognizedSolution(document({}, { getText: () => '# tensortonic: {broken}' }), { readRef }), undefined);
  assert.equal(recognizedSolution(document({ slug: 'safe', technology: 'x'.repeat(90) + ' CUDA' }), { readRef }), undefined);
  assert.equal(calls, 1, 'invalid or unsupported metadata must not reach the injected reader');
});

test('metadata normalization ignores unexpected properties and retains the existing technology length limit', () => {
  const metadata = JSON.parse('{"slug":"safe","planId":"","technology":"PyTorch","__proto__":{"polluted":true},"unexpected":"discard"}');
  const solution = recognizedSolution(document(metadata));
  assert.deepEqual(solution, { slug: 'safe', technology: 'PyTorch' });
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(recognizedSolution(document({ slug: 'safe', technology: 'x'.repeat(100) })).technology.length, 80);
});
