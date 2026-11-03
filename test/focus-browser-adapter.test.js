'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FocusBrowserAdapter, isProblemUrl } = require('../src/focus-browser-adapter');
const { FOCUS_CONTRACT } = require('../src/focus-contract');

const page = patch => Object.freeze({ id: 'owned-tab', url: 'https://www.tensortonic.com/problems/synthetic', documentId: 'document-1', frameId: 'frame-1', owned: true, ...patch });
const contract = patch => ({ id: 'synthetic-reviewed-v1', verified: true, surface: 'problem-content', hidesSecurityUI: false,
  targets: [{ id: 'synthetic-editor', selector: '[data-synthetic-editor]', count: 1 }, { id: 'synthetic-content', selector: '.synthetic-content', count: 1 }],
  cssText: '[data-synthetic-editor] { display: none !important; }\n.synthetic-content { width: 100%; grid-template-columns: minmax(0, 1fr); }', ...patch });
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function harness() {
  const h = { page: page(), contract: contract(), calls: [], styles: new Map([['site-style', '.site { color: blue; }']]), next: 0 };
  h.port = {
    async getPage() { h.calls.push(['page']); return h.onPage ? h.onPage() : h.page; },
    async inspect(value) {
      h.calls.push(['inspect', value]);
      return h.onInspect ? h.onInspect(value) : Object.freeze({ ...h.page, contractId: value.id, counts: Object.freeze(Object.fromEntries(value.targets.map(target => [target.id, target.count]))) });
    },
    async createStyleSheet(options, controls) {
      h.calls.push(['create', options, controls]);
      if (h.onCreate) return h.onCreate(options, controls);
      const id = `own-sheet-${++h.next}`; h.styles.set(id, ''); return { styleSheetId: id };
    },
    async setStyleSheetText(id, text, controls) {
      h.calls.push(['set', id, text, controls]);
      if (h.onSet) return h.onSet(id, text, controls);
      if (!h.styles.has(id)) throw new Error('Unknown sheet');
      h.styles.set(id, text);
    },
    async styleSheetExists(id, controls) {
      h.calls.push(['exists', id, controls]);
      if (h.onExists) return h.onExists(id, controls);
      return { exists: h.styles.has(id) };
    },
  };
  h.adapter = new FocusBrowserAdapter(h.port);
  h.verify = () => h.adapter.verify(h.page, h.contract);
  return h;
}

function mutations(h) { return h.calls.filter(call => ['create', 'set'].includes(call[0])); }
function snapshotOf(value) { return { id: value.id, url: value.url, documentId: value.documentId }; }

test('strict URL scope accepts only canonical WWW problem pages and one validated studyPlan', () => {
  for (const url of ['https://www.tensortonic.com/problems/x', 'https://www.tensortonic.com/problems/Train-123?studyPlan=plan-1']) assert.equal(isProblemUrl(url), true);
  for (const url of [undefined, {}, 'http://www.tensortonic.com/problems/x', 'https://tensortonic.com/problems/x', 'https://www.tensortonic.com.evil.invalid/problems/x', 'https://user@www.tensortonic.com/problems/x', 'https://www.tensortonic.com:443/problems/x', 'https://www.tensortonic.com/problems/x/', 'https://www.tensortonic.com/problems/x#', 'https://www.tensortonic.com/problems/x#part', 'https://www.tensortonic.com/problems/x?', 'https://www.tensortonic.com/problems/x?studyPlan=', 'https://www.tensortonic.com/problems/x?studyPlan=one&studyPlan=two', 'https://www.tensortonic.com/problems/x?session=secret', 'https://www.tensortonic.com/problems/x?study%50lan=one', 'https://www.tensortonic.com/problems/x?studyPlan=%61', 'https://www.tensortonic.com/study-plans/plan/problems/x', 'https://www.tensortonic.com/login', 'https://www.tensortonic.com/problems/../login', 'https://www.tensortonic.com/problems/a%2fb', 'https://www.tensortonic.com/problems/x\n', 'https://www.tensortonic.com/problems/x\u2028']) assert.equal(isProblemUrl(url), false, String(url));
});

test('exact quoted attribute selectors are accepted while target IDs remain bounded and literal', async () => {
  const h = harness();
  h.contract = contract({ targets: [{ id: 'synthetic-editor', selector: '[data-synthetic-kind="editor"]', count: 1 }], cssText: '[data-synthetic-kind="editor"] { display:none !important; }' });
  const lease = await h.adapter.apply(await h.verify(), h.contract); await lease.restore();
  for (const patch of [{ id: 'bad\n' }, { targets: [{ id: 'bad\n', selector: '.synthetic', count: 1 }], cssText: '.synthetic{display:none}' }]) {
    const other = harness(); await assert.rejects(other.adapter.verify(other.page, contract(patch)), { code: 'INVALID_CONTRACT' }); assert.deepEqual(other.calls, []);
  }
});

test('the inspected production contract verifies and applies its precise child selectors through a fake owned port', async () => {
  const h = harness(); h.contract = FOCUS_CONTRACT;
  h.onInspect = async value => {
    assert.equal(value.id, FOCUS_CONTRACT.id);
    assert.equal(value.cssText, FOCUS_CONTRACT.cssText);
    assert.deepEqual(value.targets, FOCUS_CONTRACT.targets.map(({ id, selector, count }) => ({ id, selector, count })));
    return Object.freeze({ ...h.page, contractId: value.id, counts: Object.freeze(Object.fromEntries(value.targets.map(target => [target.id, 1]))) });
  };
  const proof = await h.verify();
  assert.equal(Object.keys(proof.counts).length, FOCUS_CONTRACT.targets.length);
  const lease = await h.adapter.apply(proof, FOCUS_CONTRACT);
  assert.equal(h.styles.get('own-sheet-1'), FOCUS_CONTRACT.cssText);
  assert.equal(h.calls.filter(call => call[0] === 'inspect').length, 2);
  await lease.restore();
  assert.equal(h.styles.get('own-sheet-1'), '');
  assert.equal(h.styles.get('site-style'), '.site { color: blue; }');
});

test('direct-child combinators permit precise selectors while malformed, broad, and markup-like selectors remain blocked', async () => {
  for (const selector of ['.synthetic-parent > a:first-child', '[data-synthetic-parent]>a[title="Previous problem"]']) {
    const h = harness(); h.contract = contract({ targets: [{ id: 'synthetic-child', selector, count: 1 }], cssText: `${selector}{display:none!important;}` });
    const lease = await h.adapter.apply(await h.verify(), h.contract); await lease.restore();
  }
  for (const selector of ['> .synthetic', '.synthetic >', '.synthetic >> a', '.synthetic > > a', '.synthetic > + a', '.synthetic + > a', '.synthetic > *', '.synthetic > <script>', '<div class="synthetic">', 'header', 'footer', '*']) {
    const h = harness(); const value = contract({ targets: [{ id: 'bad-child', selector, count: 1 }], cssText: `${selector}{display:none}` });
    await assert.rejects(h.adapter.verify(h.page, value), { code: 'INVALID_CONTRACT' }); assert.deepEqual(h.calls, []);
  }
});

test('verify returns a frozen owned proof with exact counts and no stylesheet changes', async () => {
  const h = harness(); const proof = await h.adapter.verify(snapshotOf(h.page), h.contract);
  assert.equal(proof.contractId, h.contract.id); assert.equal(proof.frameId, h.page.frameId); assert.equal(proof.owned, true);
  assert.equal(Object.isFrozen(proof), true); assert.equal(Object.isFrozen(proof.counts), true);
  assert.equal(proof.counts['synthetic-editor'], 1); assert.deepEqual(mutations(h), []);
  const inspectedContract = h.calls.find(call => call[0] === 'inspect')[1];
  assert.equal(Object.isFrozen(inspectedContract), true); assert.equal(Object.isFrozen(inspectedContract.targets[0]), true);
});

test('unreviewed, security-hiding, empty, generic, or resource-bearing contracts fail before port access', async () => {
  const invalid = [undefined, contract({ verified: false }), contract({ surface: 'browser-chrome' }), contract({ hidesSecurityUI: true }), contract({ targets: [] }), contract({ cssText: '' }), contract({ cssText: '@import url(https://example.invalid/x);' }), contract({ cssText: '[data-synthetic-editor]{background-image:url(https://example.invalid/x)} .synthetic-content{width:100%}' })];
  for (const selector of ['*', 'header', 'footer', 'nav', 'main', 'body.synthetic', ':root', '.synthetic, header', '.synthetic *', ':has(.synthetic)', '.synthetic::before']) invalid.push(contract({ targets: [{ id: 'bad', selector, count: 1 }], cssText: `${selector}{display:none}` }));
  for (const value of invalid) {
    const h = harness();
    await assert.rejects(h.adapter.verify(h.page, value), { code: 'INVALID_CONTRACT' });
    assert.deepEqual(h.calls, []);
  }
});

test('count ranges, duplicate targets, unrelated CSS selectors and non-layout declarations are rejected', async () => {
  for (const patch of [{ targets: [{ id: 'target', selector: '.synthetic', count: 0 }], cssText: '.synthetic{display:none}' },
    { targets: [{ id: 'same', selector: '.a', count: 1 }, { id: 'same', selector: '.b', count: 1 }], cssText: '.a{display:none}.b{display:none}' },
    { targets: [{ id: 'one', selector: '.same', count: 1 }, { id: 'two', selector: '.same', count: 1 }], cssText: '.same{display:none}' },
    { cssText: '.unverified-selector { display:none; }' }, { cssText: '[data-synthetic-editor] { position:fixed; } .synthetic-content{width:100%}' },
    { cssText: '[data-synthetic-editor] { display:none; } .synthetic-content{width:var(--unknown)}' }]) {
    const h = harness(); await assert.rejects(h.adapter.verify(h.page, contract(patch)), { code: 'INVALID_CONTRACT' }); assert.deepEqual(h.calls, []);
  }
});

test('foreign routes, mismatched tabs/documents/frames, and unowned pages cannot be inspected or changed', async () => {
  for (const patch of [{ owned: false }, { id: 'another-tab' }, { documentId: 'new-document' }, { frameId: 'iframe' }, { url: 'https://www.tensortonic.com/login' }, { url: 'https://evil.invalid/problems/x' }]) {
    const h = harness(); const snapshot = h.page; h.page = page(patch);
    await assert.rejects(h.adapter.verify(snapshot, h.contract), { code: 'PAGE_CHANGED' });
    assert.equal(h.calls.filter(call => call[0] === 'inspect').length, 0); assert.deepEqual(mutations(h), []);
  }
});

test('selector proof identity and exact positive counts must match the current owned document', async () => {
  for (const patch of [{ contractId: 'other' }, { owned: false }, { documentId: 'other' }, { frameId: 'other' }, { counts: { 'synthetic-editor': 0, 'synthetic-content': 1 } }, { counts: { 'synthetic-editor': 2, 'synthetic-content': 1 } }, { counts: { 'synthetic-editor': 1 } }, { counts: { 'synthetic-editor': 1, 'synthetic-content': 1, unexpected: 1 } }]) {
    const h = harness(); h.onInspect = async () => ({ ...h.page, contractId: h.contract.id, counts: { 'synthetic-editor': 1, 'synthetic-content': 1 }, ...patch });
    await assert.rejects(h.verify(), { code: 'INVALID_PROOF' }); assert.deepEqual(mutations(h), []);
  }
});

test('navigation or cancellation during verification cannot produce a reusable proof', async () => {
  for (const mode of ['navigate', 'cancel']) {
    const h = harness(); const waiting = deferred(); const entered = deferred(); const controller = new AbortController();
    h.onInspect = async value => { entered.resolve(); return waiting.promise; };
    const pending = h.adapter.verify(h.page, h.contract, { signal: controller.signal }); await entered.promise;
    const oldPage = h.page;
    if (mode === 'navigate') h.page = page({ documentId: 'next-document' }); else controller.abort();
    waiting.resolve({ ...oldPage, contractId: h.contract.id, counts: { 'synthetic-editor': 1, 'synthetic-content': 1 } });
    await assert.rejects(pending, { code: mode === 'cancel' ? 'CANCELED' : 'PAGE_CHANGED' }); assert.deepEqual(mutations(h), []);
  }
});

test('apply creates a forced dedicated sheet and Off empties only that sheet with its captured page', async () => {
  const h = harness(); const controller = new AbortController(); const proof = await h.verify();
  const lease = await h.adapter.apply(proof, h.contract, { signal: controller.signal });
  const created = h.calls.find(call => call[0] === 'create');
  assert.deepEqual(created[1], { frameId: h.page.frameId, force: true, page: h.page }); assert.strictEqual(created[2].signal, controller.signal);
  const nonempty = h.calls.find(call => call[0] === 'set' && call[2]);
  assert.equal(nonempty[1], 'own-sheet-1'); assert.equal(nonempty[2], h.contract.cssText); assert.deepEqual(nonempty[3].page, h.page); assert.strictEqual(nonempty[3].signal, controller.signal);
  controller.abort(); assert.deepEqual(await lease.restore(), { restored: true, reason: 'emptied' });
  const empty = h.calls.find(call => call[0] === 'set' && call[2] === '');
  assert.equal(empty[1], 'own-sheet-1'); assert.deepEqual(empty[3], { page: h.page });
  assert.equal(h.styles.get('site-style'), '.site { color: blue; }'); assert.equal(h.styles.get('own-sheet-1'), '');
  assert.equal(h.calls.some(call => String(call[0]).includes('disable')), false);
});

test('proof forgery, replay, contract CSS mutation, and selector mutation cannot apply styles', async () => {
  const h = harness(); const proof = await h.verify();
  await assert.rejects(h.adapter.apply({ ...proof }, h.contract), { code: 'INVALID_PROOF' });
  await assert.rejects(h.adapter.apply(proof, { ...h.contract, cssText: h.contract.cssText.replace('100%', '90%') }), { code: 'INVALID_PROOF' });
  const mutated = contract(); mutated.targets[0].count = 2;
  await assert.rejects(h.adapter.apply(proof, mutated), { code: 'INVALID_PROOF' });
  assert.deepEqual(mutations(h), []);
  const lease = await h.adapter.apply(proof, h.contract); await lease.restore();
  await assert.rejects(h.adapter.apply(proof, h.contract), { code: 'INVALID_PROOF' });
});

test('apply reinspects target counts and document identity before any stylesheet is created', async () => {
  for (const mode of ['counts', 'document', 'inspect-failed']) {
    const h = harness(); const proof = await h.verify();
    if (mode === 'document') h.page = page({ documentId: 'next' });
    if (mode === 'counts') h.onInspect = async () => ({ ...h.page, contractId: h.contract.id, counts: { 'synthetic-editor': 0, 'synthetic-content': 1 } });
    if (mode === 'inspect-failed') h.onInspect = async () => { throw new Error('Private DOM details'); };
    await assert.rejects(h.adapter.apply(proof, h.contract), { code: mode === 'document' ? 'PAGE_CHANGED' : mode === 'counts' ? 'INVALID_PROOF' : 'UNAVAILABLE' });
    assert.deepEqual(mutations(h), []);
  }
});

test('unsupported force creation or an invalid response fails open without writing CSS', async () => {
  for (const value of [undefined, {}, { styleSheetId: '' }, { styleSheetId: 'bad\nidentifier' }, 'throw']) {
    const h = harness(); const proof = await h.verify(); h.onCreate = async () => { if (value === 'throw') throw new Error('force unsupported'); return value; };
    await assert.rejects(h.adapter.apply(proof, h.contract), { code: 'UNAVAILABLE' });
    assert.equal(h.calls.filter(call => call[0] === 'set').length, 0); assert.equal(h.styles.size, 1);
  }
});

test('pre-canceled verification and apply perform no new port calls or mutations', async () => {
  const h = harness(); const proof = await h.verify(); const before = h.calls.length; const controller = new AbortController(); controller.abort();
  await assert.rejects(h.adapter.verify(h.page, h.contract, { signal: controller.signal }), { code: 'CANCELED' });
  await assert.rejects(h.adapter.apply(proof, h.contract, { signal: controller.signal }), { code: 'CANCELED' });
  assert.equal(h.calls.length, before); assert.deepEqual(mutations(h), []);
});

test('cancellation during sheet creation keeps the late blank sheet owned and empties it', async () => {
  const h = harness(); const proof = await h.verify(); const waiting = deferred(); const entered = deferred(); const controller = new AbortController();
  h.onCreate = async () => { entered.resolve(); return waiting.promise; };
  const pending = h.adapter.apply(proof, h.contract, { signal: controller.signal }); await entered.promise; controller.abort();
  h.styles.set('late-sheet', ''); waiting.resolve('late-sheet');
  await assert.rejects(pending, { code: 'CANCELED' });
  assert.deepEqual(h.calls.filter(call => call[0] === 'set').map(call => [call[1], call[2]]), [['late-sheet', '']]);
  assert.equal(h.styles.get('late-sheet'), '');
});

test('late CSS mutation after cancellation is awaited and then emptied before apply rejects', async () => {
  const h = harness(); const proof = await h.verify(); const waiting = deferred(); const entered = deferred(); const controller = new AbortController();
  h.onSet = async (id, text) => { if (text) { entered.resolve(); await waiting.promise; } h.styles.set(id, text); };
  const pending = h.adapter.apply(proof, h.contract, { signal: controller.signal }); await entered.promise; controller.abort();
  assert.equal(h.calls.filter(call => call[0] === 'set').length, 1); waiting.resolve();
  await assert.rejects(pending, { code: 'CANCELED' });
  assert.equal(h.styles.get('own-sheet-1'), '');
  assert.deepEqual(h.calls.filter(call => call[0] === 'set').map(call => call[2]), [h.contract.cssText, '']);
});

test('navigation between page check and mutation is rejected by the page-scoped port and cleaned', async () => {
  const h = harness(); const proof = await h.verify();
  h.onSet = async (id, text, { page: expected }) => {
    if (text) { h.page = page({ documentId: 'next-document' }); assert.equal(expected.documentId, 'document-1'); throw new Error('Epoch changed at dispatch'); }
    h.styles.set(id, '');
  };
  await assert.rejects(h.adapter.apply(proof, h.contract), { code: 'APPLY_FAILED' });
  assert.equal(h.styles.get('own-sheet-1'), ''); assert.equal(h.styles.get('site-style'), '.site { color: blue; }');
});

test('rejected or uncertain nonempty writes trigger cleanup and expose no raw protocol error', async () => {
  const h = harness(); const proof = await h.verify();
  h.onSet = async (id, text) => { h.styles.set(id, text); if (text) throw new Error('PRIVATE CONTENT/TOKEN'); };
  await assert.rejects(h.adapter.apply(proof, h.contract), error => error.code === 'APPLY_FAILED' && !error.message.includes('PRIVATE'));
  assert.equal(h.styles.get('own-sheet-1'), '');
});

test('failed rollback returns its retained lease so Off can retry rather than losing owned CSS', async () => {
  const h = harness(); const proof = await h.verify();
  h.onSet = async (id, text) => { if (text) h.styles.set(id, text); throw new Error('Transport uncertain'); };
  let retained;
  await assert.rejects(h.adapter.apply(proof, h.contract), error => { retained = error.lease; return error.code === 'RESTORE_PENDING' && typeof retained?.restore === 'function'; });
  assert.equal(h.styles.get('own-sheet-1'), h.contract.cssText);
  const nextProof = await h.verify(); await assert.rejects(h.adapter.apply(nextProof, h.contract), { code: 'RESTORE_PENDING' });
  h.onSet = undefined; await retained.restore(); assert.equal(h.styles.get('own-sheet-1'), '');
  const nextLease = await h.adapter.apply(nextProof, h.contract); await nextLease.restore();
});

test('arbitrary transport errors, bare false, wrong identity, or unauthoritative absence never mean restored', async () => {
  for (const existence of [false, undefined, { exists: false }, { exists: false, authoritative: false, reason: 'document-destroyed' }, { exists: false, authoritative: true, reason: 'transport-error' }, { exists: false, authoritative: true, reason: 'sheet-removed', styleSheetId: 'site-style' }, { exists: false, authoritative: true, reason: 'document-destroyed', documentId: 'other-document' }, 'throw']) {
    const h = harness(); const lease = await h.adapter.apply(await h.verify(), h.contract);
    h.onSet = async () => { throw new Error('disconnected'); };
    h.onExists = async () => { if (existence === 'throw') throw new Error('closed?'); return existence; };
    await assert.rejects(lease.restore(), { code: 'RESTORE_PENDING' });
    assert.equal(h.styles.get('own-sheet-1'), h.contract.cssText);
    h.onSet = undefined; await lease.restore();
  }
});

test('authoritative document destruction, tab close or exact sheet removal resolves cleanup after an empty attempt', async () => {
  for (const reason of ['document-destroyed', 'page-closed', 'sheet-removed']) {
    const h = harness(); const lease = await h.adapter.apply(await h.verify(), h.contract); const captured = h.page;
    h.page = undefined; h.styles.delete('own-sheet-1');
    h.onSet = async () => { throw new Error('Original document gone'); };
    h.onExists = async (id, controls) => { assert.deepEqual(controls, { page: captured }); return { exists: false, authoritative: true, reason, styleSheetId: id, documentId: captured.documentId }; };
    assert.deepEqual(await lease.restore(), { restored: true, reason });
    const last = h.calls.filter(call => ['set', 'exists'].includes(call[0])).slice(-2);
    assert.equal(last[0][0], 'set'); assert.equal(last[0][2], ''); assert.equal(last[1][0], 'exists');
    assert.equal(h.styles.get('site-style'), '.site { color: blue; }');
  }
});

test('restore survives SPA route changes by emptying the captured dedicated sheet without adopting the new page', async () => {
  const h = harness(); const original = h.page; const lease = await h.adapter.apply(await h.verify(), h.contract);
  h.page = page({ url: 'https://www.tensortonic.com/account' });
  await lease.restore();
  const cleanup = h.calls.filter(call => call[0] === 'set').at(-1);
  assert.equal(cleanup[2], ''); assert.deepEqual(cleanup[3], { page: original }); assert.equal(h.styles.get('own-sheet-1'), '');
});

test('concurrent restores share one empty write and repeated Off is idempotent', async () => {
  const h = harness(); const lease = await h.adapter.apply(await h.verify(), h.contract); const waiting = deferred(); const entered = deferred();
  h.onSet = async (id, text) => { assert.equal(text, ''); entered.resolve(); await waiting.promise; h.styles.set(id, text); };
  const first = lease.restore(); const second = lease.restore(); assert.strictEqual(first, second); await entered.promise;
  waiting.resolve(); await first; const before = h.calls.length; await lease.restore(); assert.equal(h.calls.length, before);
  assert.equal(h.calls.filter(call => call[0] === 'set' && call[2] === '').length, 1);
});

test('only one apply can own a sheet while creation or cleanup is pending', async () => {
  const h = harness(); const firstProof = await h.verify(); const secondProof = await h.verify(); const waiting = deferred(); const entered = deferred();
  h.onCreate = async () => { entered.resolve(); await waiting.promise; h.styles.set('pending-sheet', ''); return 'pending-sheet'; };
  const pending = h.adapter.apply(firstProof, h.contract); await entered.promise;
  await assert.rejects(h.adapter.apply(secondProof, h.contract), { code: 'RESTORE_PENDING' });
  waiting.resolve(); const lease = await pending; await lease.restore();
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1);
});

test('late lease cleanup retains its originating diagnostic callback, never the newer attempt',async()=>{
 const {createFocusDiagnostics}=require('../src/focus-diagnostics');const d=createFocusDiagnostics(),old=d.begin(true),h=harness();
 h.onSet=async(id,text,options)=>{assert.equal(options.onDiagnostic,old.record);options.onDiagnostic({stage:text?'write-sheet':'restore-sheet',outcome:'ok'});h.styles.set(id,text);};
 const proof=await h.adapter.verify(h.page,h.contract,{onDiagnostic:old.record});
 const lease=await h.adapter.apply(proof,h.contract,{onDiagnostic:old.record});
 const newer=d.begin(true);newer.emit('readiness','start');await lease.restore();
 assert.deepEqual(d.snapshot().automatic.events,[{stage:'readiness',outcome:'start'}]);
});
