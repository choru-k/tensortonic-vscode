'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { StudyPlanPicker, normalizePlans, loadPublicStudyPlans } = require('../src/study-plans');

const tick = () => new Promise(setImmediate);
const envelope = data => ({ status: 'success', data });
const PUBLIC_PLANS = [
  { id: 'pytorch-basics', title: '# <b>PyTorch</b> **Basics**', subtitle: 'Build tensors', difficulty: 'Beginner', category: 'PyTorch', estimatedDays: 7, problemCount: 24 },
  { id: 'numpy-basics', title: 'NumPy Basics', description: 'Arrays and math', problemCount: 12 },
  { id: 'sql-basics', title: 'Database foundations', problemCount: 10 },
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function event() {
  const listeners = new Set();
  return {
    subscribe(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
    fire() { for (const callback of [...listeners]) callback(); },
    size() { return listeners.size; },
  };
}

function harness({ loadCatalog, native = true, ttlMs, now } = {}) {
  const h = { picks: [], loads: [], warnings: [], inputs: [], fallbackPicks: [], tokens: [], inputValue: undefined, fallbackChoice: undefined };
  h.vscode = {
    // Any configuration/file access would fail: this module only returns a choice.
    workspace: new Proxy({}, { get() { throw new Error('No workspace access is authorized.'); } }),
    CancellationTokenSource: class {
      constructor() { this.token = { isCancellationRequested: false }; h.tokens.push(this); }
      cancel() { this.token.isCancellationRequested = true; }
      dispose() { this.disposed = true; }
    },
    window: {
      async showWarningMessage(message) { h.warnings.push(message); },
      async showInputBox(options, token) { h.inputs.push({ options, token }); return h.onInput ? h.onInput(options, token) : h.inputValue; },
      async showQuickPick(items, options, token) {
        h.fallbackPicks.push({ items, options, token });
        return h.onFallback ? h.onFallback(items, options, token) : items.find(item => item.action === h.fallbackChoice);
      },
    },
  };
  if (native) h.vscode.window.createQuickPick = () => {
    const accept = event(), hide = event();
    const quickPick = {
      items: [], selectedItems: [], activeItems: [], value: '',
      onDidAccept: callback => accept.subscribe(callback),
      onDidHide: callback => hide.subscribe(callback),
      show() { this.shown = true; },
      hide() { this.hidden = true; hide.fire(); },
      dispose() { this.disposed = true; },
      choose(action, id) {
        const item = this.items.find(candidate => candidate.action === action && (id === undefined || candidate.id === id));
        assert.ok(item, `Missing ${action} ${id || ''}`);
        this.selectedItems = [item];
        accept.fire();
      },
      subscriptions() { return accept.size() + hide.size(); },
    };
    h.picks.push(quickPick);
    return quickPick;
  };
  h.picker = new StudyPlanPicker(h.vscode, {
    loadCatalog: options => {
      h.loads.push(options);
      return loadCatalog ? loadCatalog(options) : envelope(PUBLIC_PLANS);
    },
    ...(ttlMs === undefined ? {} : { ttlMs }),
    ...(now ? { now } : {}),
  });
  return h;
}

async function open(h, current = 'pytorch-basics') {
  const result = h.picker.pick(current);
  await tick();
  return { result, quickPick: h.picks.at(-1) };
}

test('normalization converts Markdown/HTML to bounded plain metadata and ignores icon/style/account fields', () => {
  const plans = normalizePlans(envelope([{
    id: 'safe-plan',
    title: '# <b>PyTorch</b> **Basics** &amp; [arrays](https://example.invalid) $(zap)\u202e',
    subtitle: '<script>secret()</script>Tensor `math`',
    description: '&lt;style&gt;hidden&lt;/style&gt;Safe description\nnext line',
    difficulty: 'Beginner', category: 'Python', estimatedDays: 0, problemCount: 0,
    icon: '<img src=x onerror=bad()>', gradient: 'url(https://foreign.invalid)', accentColor: 'red',
    solved: 900, completedCount: 42, seoTitle: 'Unnecessary metadata',
  }]));
  assert.equal(plans[0].title, 'PyTorch Basics & arrays');
  assert.equal(plans[0].subtitle, 'Tensor math');
  assert.equal(plans[0].description, 'Safe description next line');
  assert.equal(plans[0].problemCount, 0);
  assert.equal(plans[0].estimatedDays, 0);
  assert.equal(plans[0].supported, true);
  for (const key of ['icon', 'gradient', 'accentColor', 'solved', 'completedCount', 'seoTitle']) assert.equal(key in plans[0], false);
  assert.equal(Array.from(normalizePlans([{ id: 'long', title: '😀'.repeat(500) }])[0].title).length, 240);
});

test('normalization accepts the observed envelope or injected rows and rejects unexpected responses', () => {
  assert.deepEqual(normalizePlans([]), []);
  for (const response of [null, {}, { status: 'error', data: [] }, { status: 'success', data: {} }, { data: [] }]) {
    assert.throws(() => normalizePlans(response), /unexpected study-plan/);
  }
});

test('normalization preserves API order, skips invalid/duplicate IDs, and marks incomplete metadata', () => {
  const rows = [null, 'bad', [], { id: '../escape', title: 'Bad' }, { id: 'numpy-basics', title: 'First', problemCount: -1 }, { id: 'numpy-basics', title: 'Duplicate' }, { id: 'new-plan', title: '<b></b>', estimatedDays: '5', category: {} }];
  const normalized = normalizePlans(rows);
  assert.deepEqual(normalized.map(plan => plan.id), ['numpy-basics', 'new-plan']);
  assert.equal(normalized[0].title, 'First');
  assert.equal(normalized[1].title, 'new-plan');
  assert.ok(normalized.every(plan => plan.incomplete));
  assert.equal('problemCount' in normalized[0], false);
  assert.equal('estimatedDays' in normalized[1], false);
});

test('support uses the existing client ID exclusion rule and never guesses from a display title', () => {
  const plans = normalizePlans([
    { id: 'ordinary-plan', title: 'SQL, CUDA and Triton overview' },
    { id: 'sql-basics', title: 'Database foundations' },
    { id: 'advanced-cuda', title: 'GPU foundations' },
    { id: 'triton', title: 'Kernel foundations' },
    { id: 'sqlish', title: 'Python' },
  ]);
  assert.deepEqual(plans.map(plan => plan.supported), [true, false, false, false, true]);
});

test('normalization is pure and does not retain raw row objects', () => {
  const row = Object.freeze({ id: 'safe', title: '**Safe**', problemCount: 4 });
  const input = Object.freeze({ status: 'success', data: Object.freeze([row]) });
  const normalized = normalizePlans(input);
  normalized[0].title = 'Changed';
  assert.equal(row.title, '**Safe**');
  assert.equal(normalized[0].problemCount, 4);
});

test('construction is inert and invalid cache settings are rejected', () => {
  const h = harness();
  assert.equal(h.loads.length, 0);
  assert.equal(h.picks.length, 0);
  assert.throws(() => new StudyPlanPicker(h.vscode, { ttlMs: -1 }), /TTL/);
  assert.throws(() => new StudyPlanPicker(h.vscode, { ttlMs: Infinity }), /TTL/);
});

test('native picker immediately shows searchable loading UI and current selection', async () => {
  const pending = deferred();
  const h = harness({ loadCatalog: () => pending.promise });
  const result = h.picker.pick('pytorch-basics');
  const quickPick = h.picks[0];
  assert.equal(quickPick.shown, true);
  assert.equal(quickPick.busy, true);
  assert.equal(quickPick.canSelectMany, false);
  assert.equal(quickPick.matchOnDescription, true);
  assert.equal(quickPick.matchOnDetail, true);
  assert.match(quickPick.placeholder, /Loading public study plans/);
  assert.equal(quickPick.activeItems[0].id, 'pytorch-basics');
  assert.ok(quickPick.items.some(item => item.action === 'free'));
  assert.ok(quickPick.items.some(item => item.action === 'manual'));
  await tick();
  assert.deepEqual(Object.keys(h.loads[0]), ['signal']);
  pending.resolve(envelope(PUBLIC_PLANS));
  await tick();
  assert.equal(quickPick.busy, false);
  assert.equal(quickPick.activeItems[0].label, 'PyTorch Basics');
  assert.match(quickPick.activeItems[0].description, /Current selection.*24 problems.*7 days/);
  quickPick.choose('plan', 'numpy-basics');
  assert.deepEqual(await result, { id: 'numpy-basics', title: 'NumPy Basics' });
  assert.equal(quickPick.disposed, true);
  assert.equal(quickPick.subscriptions(), 0);
});

test('free problems can be chosen during loading and late results cannot populate the cache', async () => {
  const pending = deferred();
  const h = harness({ loadCatalog: () => pending.promise });
  const first = h.picker.pick('pytorch-basics');
  await tick();
  h.picks[0].choose('free');
  assert.deepEqual(await first, { id: undefined, title: 'Free problems' });
  assert.equal(h.loads[0].signal.aborted, true);
  const snapshot = h.picks[0].items;
  pending.resolve(envelope(PUBLIC_PLANS));
  await tick();
  assert.equal(h.picks[0].items, snapshot);
  assert.equal(h.picker.cache, undefined);
  const second = h.picker.pick();
  await tick();
  assert.equal(h.loads.length, 2);
  h.picks[1].choose('free');
  await second;
});

test('Escape returns undefined, aborts public loading, and removes UI listeners', async () => {
  const h = harness({ loadCatalog: () => new Promise(() => {}) });
  const result = h.picker.pick('pytorch-basics');
  await tick();
  h.picks[0].hide();
  assert.equal(await result, undefined);
  assert.equal(h.loads[0].signal.aborted, true);
  assert.equal(h.picks[0].subscriptions(), 0);
  assert.deepEqual(h.warnings, []);
});

test('successful public metadata is cached only within the configured TTL', async () => {
  let timestamp = 1000;
  const h = harness({ ttlMs: 100, now: () => timestamp });
  const first = await open(h);
  first.quickPick.choose('free'); await first.result;
  timestamp += 99;
  const second = await open(h);
  assert.equal(h.loads.length, 1);
  second.quickPick.choose('free'); await second.result;
  timestamp += 1;
  const third = await open(h);
  assert.equal(h.loads.length, 2);
  third.quickPick.choose('free'); await third.result;
});

test('clock rollback and zero TTL do not retain an indefinitely fresh cache', async () => {
  for (const ttlMs of [0, 100]) {
    let timestamp = 1000;
    const h = harness({ ttlMs, now: () => timestamp });
    const first = await open(h); first.quickPick.choose('free'); await first.result;
    timestamp = 999;
    const second = await open(h); second.quickPick.choose('free'); await second.result;
    assert.equal(h.loads.length, 2);
  }
});

test('invalidate cancels pending UI, clears cached metadata, and permits a fresh explicit pick', async () => {
  const stale = deferred();
  let attempts = 0;
  const h = harness({ loadCatalog: () => ++attempts === 1 ? stale.promise : envelope(PUBLIC_PLANS) });
  const first = h.picker.pick('pytorch-basics');
  await tick();
  h.picker.invalidate();
  assert.equal(await first, undefined);
  assert.equal(h.loads[0].signal.aborted, true);
  const second = await open(h);
  stale.resolve(envelope([{ id: 'stale-plan', title: 'Stale' }]));
  await tick();
  assert.equal(second.quickPick.items.some(item => item.id === 'stale-plan'), false);
  assert.equal(second.quickPick.items.some(item => item.id === 'numpy-basics'), true);
  second.quickPick.choose('free'); await second.result;
  h.picker.invalidate();
  assert.equal(h.picker.cache, undefined);
});

test('dispose cancels pending work and prevents future UI or network operations', async () => {
  const h = harness({ loadCatalog: () => new Promise(() => {}) });
  const result = h.picker.pick();
  await tick();
  h.picker.dispose();
  assert.equal(await result, undefined);
  assert.equal(h.loads[0].signal.aborted, true);
  assert.equal(await h.picker.pick('numpy-basics'), undefined);
  assert.equal(h.picks.length, 1);
  assert.equal(h.loads.length, 1);
});

test('repeated clicks share a single UI and public request', async () => {
  const h = harness({ loadCatalog: () => new Promise(() => {}) });
  const first = h.picker.pick('pytorch-basics');
  const second = h.picker.pick('numpy-basics');
  assert.equal(first, second);
  await tick();
  assert.equal(h.picks.length, 1);
  assert.equal(h.loads.length, 1);
  h.picks[0].choose('free'); await first;
});

test('a failed stale loader remains handled after cancellation and cannot show an error', async () => {
  const pending = deferred();
  const h = harness({ loadCatalog: () => pending.promise });
  const result = h.picker.pick();
  await tick();
  h.picker.invalidate();
  assert.equal(await result, undefined);
  const items = h.picks[0].items;
  pending.reject(new Error('Synthetic late failure'));
  await tick();
  assert.equal(h.picks[0].items, items);
  assert.deepEqual(h.warnings, []);
});

test('a current plan absent from the public catalogue remains visible and selectable', async () => {
  const h = harness();
  const { result, quickPick } = await open(h, 'private-plan');
  const current = quickPick.items.find(item => item.id === 'private-plan');
  assert.match(current.description, /Current selection.*Not listed/);
  assert.equal(quickPick.activeItems[0], current);
  quickPick.choose('plan', 'private-plan');
  assert.deepEqual(await result, { id: 'private-plan', title: 'private-plan' });
});

test('unsupported API plans are visible but refused while a supported selection remains possible', async () => {
  const h = harness();
  const { result, quickPick } = await open(h);
  assert.match(quickPick.items.find(item => item.id === 'sql-basics').description, /Execution unsupported/);
  quickPick.choose('plan', 'sql-basics');
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /SQL, CUDA and Triton execution is not supported/);
  assert.equal(quickPick.disposed, undefined);
  quickPick.choose('plan', 'numpy-basics');
  assert.deepEqual(await result, { id: 'numpy-basics', title: 'NumPy Basics' });
});

test('public errors show a safe fallback state and explicit reload can recover', async () => {
  let attempts = 0;
  const h = harness({ loadCatalog: () => {
    if (++attempts === 1) throw new Error('SECRET_INTERNAL_ERROR');
    return envelope(PUBLIC_PLANS);
  } });
  const { result, quickPick } = await open(h);
  assert.equal(quickPick.busy, false);
  assert.ok(quickPick.items.some(item => /could not be loaded/.test(item.label)));
  assert.equal(JSON.stringify(quickPick.items).includes('SECRET_INTERNAL_ERROR'), false);
  assert.ok(quickPick.items.some(item => item.action === 'manual'));
  quickPick.choose('retry');
  assert.equal(quickPick.busy, true);
  await tick();
  assert.equal(h.loads.length, 2);
  quickPick.choose('plan', 'numpy-basics');
  assert.deepEqual(await result, { id: 'numpy-basics', title: 'NumPy Basics' });
});

test('empty catalogues show an empty state without invented plans or progress', async () => {
  const h = harness({ loadCatalog: () => envelope([]) });
  const { result, quickPick } = await open(h, '');
  assert.ok(quickPick.items.some(item => /No public study plans are available/.test(item.label)));
  assert.equal(quickPick.items.filter(item => item.action === 'plan').length, 0);
  assert.doesNotMatch(JSON.stringify(quickPick.items), /completed|solved|progress|%/i);
  quickPick.choose('free'); await result;
});

test('incomplete catalogues disclose missing metadata and retain usable identifiers', async () => {
  const h = harness({ loadCatalog: () => envelope([{ id: 'new-plan' }, { id: 'bad/id', title: 'Bad' }, { id: 'new-plan', title: 'Duplicate' }]) });
  const { result, quickPick } = await open(h, 'new-plan');
  assert.ok(quickPick.items.some(item => /metadata is incomplete/.test(item.label)));
  assert.equal(quickPick.items.filter(item => item.action === 'plan').length, 1);
  quickPick.choose('plan', 'new-plan');
  assert.deepEqual(await result, { id: 'new-plan', title: 'new-plan' });
});

test('an entirely invalid catalogue shows the incomplete rather than successful-empty state', async () => {
  const h = harness({ loadCatalog: () => envelope([{}, null, { id: '../bad' }]) });
  const { result, quickPick } = await open(h, '');
  assert.ok(quickPick.items.some(item => /No usable public study-plan metadata/.test(item.label)));
  quickPick.choose('free'); await result;
});

test('manual input accepts strict slugs and established canonical TensorTonic URLs', async () => {
  const examples = [
    ['pytorch-basics', 'pytorch-basics', 'PyTorch Basics'],
    ['unknown-private-plan', 'unknown-private-plan', 'unknown-private-plan'],
    [' https://www.tensortonic.com/study-plans/numpy-basics ', 'numpy-basics', 'NumPy Basics'],
    ['https://www.tensortonic.com/study-plans/new-plan/', 'new-plan', 'new-plan'],
    ['https://www.tensortonic.com/problems/array-sum?studyPlan=numpy-basics', 'numpy-basics', 'NumPy Basics'],
    ['', undefined, 'Free problems'],
  ];
  for (const [input, id, title] of examples) {
    const h = harness(); h.inputValue = input;
    const { result, quickPick } = await open(h);
    quickPick.choose('manual');
    assert.deepEqual(await result, { id, title });
    assert.equal(h.inputs[0].options.value, 'pytorch-basics');
    assert.equal(h.inputs[0].options.validateInput(input), undefined);
    assert.equal(quickPick.disposed, true);
    assert.equal(h.loads.length, 1);
  }
});

test('manual validation rejects foreign, credentialed, encoded, ambiguous, and noncanonical URLs', async () => {
  const invalid = [
    '../bad', 'bad_slug', '-bad', 'a'.repeat(201),
    'http://www.tensortonic.com/study-plans/numpy-basics',
    'https://tensortonic.com/study-plans/numpy-basics',
    'https://www.tensortonic.com.evil.invalid/study-plans/numpy-basics',
    'https://user:pass@www.tensortonic.com/study-plans/numpy-basics',
    'https://www.tensortonic.com:443/study-plans/numpy-basics',
    'https://%77ww.tensortonic.com/study-plans/numpy-basics',
    'https://www.tensortonic.com/study-plans/%6eumpy-basics',
    'https://www.tensortonic.com/study-plans/../numpy-basics',
    'https://www.tensortonic.com/study-plans/numpy-basics?next=evil',
    'https://www.tensortonic.com/study-plans/numpy-basics#fragment',
    'https://www.tensortonic.com/problems/sum',
    'https://www.tensortonic.com/problems/sum?studyPlan=numpy-basics&studyPlan=pytorch-basics',
    'https://www.tensortonic.com/problems/sum?studyPlan=numpy-basics&next=evil',
    'https://www.tensortonic.com/problems/sum?studyPlan=numpy%2dbasics',
    'https://www.tensortonic.com/problems/sum?studyPlan=numpy-basics#fragment',
  ];
  const h = harness(); h.inputValue = undefined;
  const { result, quickPick } = await open(h);
  quickPick.choose('manual'); await result;
  const validate = h.inputs[0].options.validateInput;
  for (const input of invalid) assert.match(validate(input), /Use a study-plan slug/, input);
  // Also enforce validation if a simple harness bypasses VS Code's input validation.
  const bypass = harness(); bypass.inputValue = invalid[5];
  const other = await open(bypass); other.quickPick.choose('manual');
  assert.equal(await other.result, undefined);
});

test('unsupported manual IDs are rejected by validation and by the final selection guard', async () => {
  const h = harness(); h.inputValue = 'cuda-basics';
  const { result, quickPick } = await open(h);
  quickPick.choose('manual');
  assert.equal(await result, undefined);
  assert.match(h.inputs[0].options.validateInput('cuda-basics'), /not supported/);
  assert.match(h.inputs[0].options.validateInput('https://www.tensortonic.com/study-plans/triton'), /not supported/);
  assert.equal(h.warnings.length, 1);
});

test('manual cancellation leaves the caller without a new selection', async () => {
  const h = harness();
  const { result, quickPick } = await open(h);
  quickPick.choose('manual');
  assert.equal(await result, undefined);
  assert.equal(h.inputs.length, 1);
  assert.deepEqual(h.warnings, []);
});

test('invalidate remains responsive during pending manual input and ignores a later answer', async () => {
  const pending = deferred();
  const h = harness(); h.onInput = () => pending.promise;
  const { result, quickPick } = await open(h);
  quickPick.choose('manual');
  h.picker.invalidate();
  assert.equal(await result, undefined);
  assert.equal(h.inputs[0].token.isCancellationRequested, true);
  pending.resolve('numpy-basics');
  await tick();
  assert.equal(h.picker.active, undefined);
  assert.equal(h.picker.cache, undefined);
});

test('showQuickPick fallback is searchable and marks current metadata', async () => {
  const h = harness({ native: false });
  h.onFallback = items => items.find(item => item.id === 'numpy-basics');
  assert.deepEqual(await h.picker.pick('numpy-basics'), { id: 'numpy-basics', title: 'NumPy Basics' });
  const shown = h.fallbackPicks[0];
  assert.equal(shown.options.matchOnDescription, true);
  assert.equal(shown.options.matchOnDetail, true);
  assert.equal(shown.items.find(item => item.id === 'numpy-basics').picked, true);
  assert.equal(shown.token.isCancellationRequested, true);
});

test('fallback load errors retain manual input and unknown plan slugs', async () => {
  const h = harness({ native: false, loadCatalog: () => { throw new Error('Synthetic failure'); } });
  h.fallbackChoice = 'manual'; h.inputValue = 'private-plan';
  assert.deepEqual(await h.picker.pick('pytorch-basics'), { id: 'private-plan', title: 'private-plan' });
  assert.ok(h.fallbackPicks[0].items.some(item => /could not be loaded/.test(item.label)));
  assert.equal(h.loads.length, 1);
});

test('fallback unsupported choice informs and returns no replacement selection', async () => {
  const h = harness({ native: false });
  h.onFallback = items => items.find(item => item.id === 'sql-basics');
  assert.equal(await h.picker.pick('pytorch-basics'), undefined);
  assert.equal(h.warnings.length, 1);
});

test('fallback pending UI is cancelled even if a simple harness ignores its token', async () => {
  const pending = deferred();
  const h = harness({ native: false });
  h.onFallback = () => pending.promise;
  const result = h.picker.pick('pytorch-basics');
  await tick();
  h.picker.invalidate();
  assert.equal(await result, undefined);
  assert.equal(h.fallbackPicks[0].token.isCancellationRequested, true);
  pending.resolve(h.fallbackPicks[0].items.find(item => item.id === 'numpy-basics'));
  await tick();
  assert.equal(h.picker.active, undefined);
});

test('an input-only harness keeps manual selection available without a catalogue request', async () => {
  const h = harness({ native: false });
  delete h.vscode.window.showQuickPick;
  delete h.vscode.CancellationTokenSource;
  h.inputValue = 'private-plan';
  assert.deepEqual(await h.picker.pick('pytorch-basics'), { id: 'private-plan', title: 'private-plan' });
  assert.equal(h.loads.length, 0);
});

function stubHttps(t, respond) {
  const state = { calls: [], requests: [], responses: [] };
  t.mock.method(https, 'get', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => { request.destroyed = true; };
    const response = new EventEmitter();
    response.headers = {};
    response.statusCode = 200;
    response.destroy = () => { response.destroyed = true; };
    state.calls.push({ url, options });
    state.requests.push(request); state.responses.push(response);
    queueMicrotask(() => respond({ request, response, callback }));
    return request;
  });
  return state;
}

test('default loader uses exactly the anonymous public GET without caller-controlled headers or target', async t => {
  const payload = envelope(PUBLIC_PLANS);
  const state = stubHttps(t, ({ response, callback }) => {
    response.headers['set-cookie'] = ['ignored=public-response-cookie'];
    callback(response);
    const bytes = Buffer.from(JSON.stringify(payload));
    response.emit('data', bytes.subarray(0, 30));
    response.emit('data', bytes.subarray(30));
    response.emit('end');
  });
  assert.deepEqual(await loadPublicStudyPlans({ url: 'https://foreign.invalid', headers: { Cookie: 'forbidden', Authorization: 'forbidden' } }), payload);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].url, 'https://api.tensortonic.com/api/study-plans');
  assert.deepEqual(state.calls[0].options, { agent: false, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' } });
});

test('default loader refuses redirects without issuing a follow-up request', async t => {
  const state = stubHttps(t, ({ response, callback }) => {
    response.statusCode = 302;
    response.headers.location = 'https://foreign.invalid/capture';
    callback(response);
  });
  await assert.rejects(loadPublicStudyPlans(), /unavailable/);
  assert.equal(state.calls.length, 1);
  assert.equal(state.requests[0].destroyed, true);
  assert.equal(state.responses[0].destroyed, true);
});

test('default loader enforces the 2 MiB limit from response headers', async t => {
  const state = stubHttps(t, ({ response, callback }) => {
    response.headers['content-length'] = String(2 * 1024 * 1024 + 1);
    callback(response);
  });
  await assert.rejects(loadPublicStudyPlans(), /size limit/);
  assert.equal(state.requests[0].destroyed, true);
});

test('default loader enforces the 2 MiB limit while streaming without a declared length', async t => {
  const state = stubHttps(t, ({ response, callback }) => {
    callback(response);
    response.emit('data', Buffer.alloc(2 * 1024 * 1024));
    response.emit('data', Buffer.from('x'));
    response.emit('end');
  });
  await assert.rejects(loadPublicStudyPlans(), /size limit/);
  assert.equal(state.responses[0].destroyed, true);
});

test('default loader rejects malformed JSON and interrupted responses', async t => {
  const state = stubHttps(t, ({ response, callback }) => {
    callback(response);
    if (state.calls.length === 1) { response.emit('data', Buffer.from('<html>not JSON</html>')); response.emit('end'); }
    else response.emit('aborted');
  });
  await assert.rejects(loadPublicStudyPlans(), /invalid study-plan catalogue/);
  await assert.rejects(loadPublicStudyPlans(), /interrupted/);
});

test('default loader reports a transport failure without exposing transport details', async t => {
  stubHttps(t, ({ request }) => request.emit('error', new Error('SECRET_TRANSPORT_DETAIL')));
  await assert.rejects(loadPublicStudyPlans(), error => /request failed/.test(error.message) && !error.message.includes('SECRET'));
});

test('default loader handles abort before and during a request without waiting for the timeout', async t => {
  const state = stubHttps(t, () => {});
  const before = new AbortController(); before.abort();
  await assert.rejects(loadPublicStudyPlans({ signal: before.signal }), { name: 'AbortError' });
  assert.equal(state.calls.length, 0);
  const during = new AbortController();
  const pending = loadPublicStudyPlans({ signal: during.signal });
  during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(state.requests[0].destroyed, true);
});

test('a response arriving after transport cancellation is closed immediately', async t => {
  const state = stubHttps(t, ({ response, callback }) => callback(response));
  const controller = new AbortController();
  const pending = loadPublicStudyPlans({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(state.responses[0].destroyed, true);
  assert.equal(state.responses[0].listenerCount('data'), 0);
});

test('default loader has a ten-second absolute bound even when the transport stalls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = stubHttps(t, () => {});
  let finished = false;
  const pending = loadPublicStudyPlans();
  const rejected = assert.rejects(pending, /timed out/).then(() => { finished = true; });
  t.mock.timers.tick(9999);
  await Promise.resolve();
  assert.equal(finished, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(state.requests[0].destroyed, true);
});
