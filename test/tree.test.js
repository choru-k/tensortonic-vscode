'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProblemTreeProvider } = require('../src/tree');

class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }; }
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
const vscode = {
  EventEmitter,
  TreeItem: class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
  ThemeIcon: class ThemeIcon { constructor(id) { this.id = id; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
};
const ref = (slug, overrides = {}) => ({
  slug, apiId: `api-${slug}`, planId: 'pytorch-basics', studyPlanTitle: 'PyTorch Basics',
  title: slug, difficulty: 'Easy', technology: 'PyTorch', solved: false,
  section: { id: 'basics', title: 'Tensor Basics', order: 0 }, ...overrides,
});
function fixture(problems = [ref('tensor')], overrides = {}) {
  const state = { bridge: { connected: true }, problems, selectedPlanId: 'pytorch-basics', loading: false, ...overrides };
  return { state, tree: new ProblemTreeProvider(vscode, state) };
}
function leaves(tree) {
  const visit = item => item.problemRef ? [item] : tree.getChildren(item).flatMap(visit);
  return tree.getChildren().flatMap(visit);
}

test('study plan root, sections and problem leaves retain the supplied service order', () => {
  const problems = [
    ref('z-last-alphabetically', { section: { id: 'vectors', title: 'Vector operations', order: 3 } }),
    ref('a-first-alphabetically', { section: { id: 'vectors', title: 'Vector operations', order: 3 } }),
    ref('middle', { section: { id: 'autograd', title: 'Automatic differentiation', order: 8 } }),
  ];
  const { tree } = fixture(problems);
  const [root] = tree.getChildren();
  assert.equal(root.label, 'PyTorch Basics');
  assert.equal(root.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  const sections = tree.getChildren(root);
  assert.deepEqual(sections.map(item => item.label), ['Vector operations', 'Automatic differentiation']);
  assert.ok(sections.every(item => item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed));
  assert.deepEqual(leaves(tree).map(item => item.problemRef), problems);
  assert.equal(root.command, undefined);
  assert.equal(sections[0].command, undefined);
});

test('duplicate section and problem titles do not collide, and stable IDs survive refresh', () => {
  const problems = [ref('one', { title: 'Same', section: { id: 'one', title: 'Same', order: 0 } }),
    ref('two', { title: 'Same', section: { id: 'two', title: 'Same', order: 1 } })];
  const { state, tree } = fixture(problems);
  const root = tree.getChildren()[0];
  const nodes = [root, ...tree.getChildren(root), ...leaves(tree)];
  const ids = nodes.map(item => item.id);
  assert.equal(new Set(ids).size, nodes.length);
  state.problems = problems.map(problem => ({ ...problem, title: 'Renamed', studyPlanTitle: 'Renamed plan' }));
  tree.refresh();
  const updatedRoot = tree.getChildren()[0];
  assert.deepEqual([updatedRoot, ...tree.getChildren(updatedRoot), ...leaves(tree)].map(item => item.id), ids);
});

test('progress and solved icons are separate from the current problem marker', () => {
  const problems = [ref('one', { solved: true }), ref('two'), ref('three', { solved: 'true', section: { id: 'later', title: 'Later', order: 1 } })];
  const { tree } = fixture(problems, { activeRef: { slug: 'browser-alias', apiId: 'api-one', planId: 'pytorch-basics' } });
  const root = tree.getChildren()[0];
  assert.equal(root.description, '1 / 3 solved');
  assert.deepEqual(tree.getChildren(root).map(item => item.description), ['1 / 2 solved', '0 / 1 solved']);
  const items = leaves(tree);
  assert.equal(items[0].description, 'Current · Easy · PyTorch');
  assert.equal(items[0].iconPath.id, 'pass-filled');
  assert.equal(items[1].iconPath.id, 'circle-outline');
  assert.equal(items[2].iconPath.id, 'circle-outline');
  assert.match(items[0].tooltip, /Current problem/);
  assert.match(items[0].accessibilityInformation.label, /Solved.*Current problem/);
  assert.ok(!items[1].description.includes('Current'));
});

test('findProblem prefers explicit plan-scoped API identity and safely supports legacy browser slugs', () => {
  const problem = ref('browser-alias', { apiId: 'canonical-id' });
  const { tree } = fixture([problem]);
  const leaf = leaves(tree)[0];
  assert.equal(tree.findProblem({ planId: problem.planId, slug: 'old-alias', apiId: problem.apiId }), leaf);
  assert.equal(tree.findProblem({ planId: problem.planId, slug: 'canonical-id' }), undefined);
  assert.equal(tree.findProblem({ planId: problem.planId, slug: 'browser-alias' }), leaf);
  assert.equal(tree.findProblem({ problemRef: problem }), leaf);
  assert.equal(tree.findProblem({ ref: problem }), leaf);
  assert.equal(tree.findProblem({ ...problem, apiId: 'different-id' }), undefined);
  assert.equal(tree.findProblem({ ...problem, planId: 'another-plan' }), undefined);
  assert.equal(tree.findProblem({ slug: problem.slug }), undefined);
  assert.equal(tree.findProblem(undefined), undefined);
  assert.equal(tree.findProblem('browser-alias'), undefined);
});

test('legacy browser slugs cannot accidentally select another row with a matching API ID', () => {
  const problems = [ref('other', { apiId: 'browser-a' }), ref('browser-a', { apiId: 'stable-b' })];
  const { tree } = fixture(problems, { activeRef: { slug: 'browser-a', planId: 'pytorch-basics' } });
  const items = leaves(tree);
  assert.equal(tree.findProblem({ slug: 'browser-a', planId: 'pytorch-basics' }), items[1]);
  assert.equal(tree.findProblem({ slug: 'browser-a', apiId: 'browser-a', planId: 'pytorch-basics' }), items[0]);
  assert.ok(!items[0].description.includes('Current'));
  assert.ok(items[1].description.includes('Current'));
});

test('ambiguous identities never produce a current marker or non-unique item IDs', () => {
  const first = ref('same'), second = ref('same', { section: { id: 'other', title: 'Other', order: 1 } });
  const { tree } = fixture([first, second], { activeRef: first });
  const items = leaves(tree);
  assert.notEqual(items[0].id, items[1].id);
  assert.equal(tree.findProblem(first), undefined);
  assert.ok(items.every(item => !item.description.includes('Current')));
  const other = fixture([ref('same', { apiId: 'id-one' }), ref('same', { apiId: 'id-two' })]).tree;
  assert.equal(other.findProblem({ slug: 'same', planId: 'pytorch-basics' }), undefined);
  assert.equal(other.findProblem({ slug: 'same', apiId: 'id-two', planId: 'pytorch-basics' }), leaves(other)[1]);
});

test('legacy refs without sections use an explicit Problems group without colliding with real IDs', () => {
  const problems = [ref('legacy', { studyPlanTitle: undefined, section: undefined }),
    ref('real', { studyPlanTitle: undefined, section: { id: 'legacy', title: 'Problems', order: 1 } })];
  const { tree } = fixture(problems);
  const root = tree.getChildren()[0];
  assert.equal(root.label, 'pytorch-basics');
  const sections = tree.getChildren(root);
  assert.deepEqual(sections.map(item => item.label), ['Problems', 'Problems']);
  assert.notEqual(sections[0].id, sections[1].id);
  assert.deepEqual(leaves(tree).map(item => item.problemRef), problems);
});

test('free mode has a Free problems root and direct leaves with progress', () => {
  const problems = [ref('free-one', { planId: undefined, solved: true }), ref('free-two', { planId: undefined })];
  const { tree } = fixture(problems, { selectedPlanId: '', activeRef: { slug: 'free-two' } });
  const [root] = tree.getChildren();
  assert.equal(root.label, 'Free problems');
  assert.equal(root.description, '1 / 2 solved');
  assert.equal(root.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  assert.deepEqual(tree.getChildren(root).map(item => item.problemRef), problems);
  assert.equal(tree.getParent(tree.findProblem({ slug: 'free-two' })), root);
  assert.equal(leaves(tree)[1].description, 'Current · Easy · PyTorch');
});

test('disconnected, loading and empty states expose only appropriate actions', () => {
  const { state, tree } = fixture([ref('old')], { bridge: { connected: false }, loading: true });
  let [item] = tree.getChildren();
  assert.equal(item.command.command, 'tensortonic.connect');
  assert.equal(item.contextValue, undefined);
  assert.equal(tree.findProblem(state.problems[0]), undefined);
  state.bridge.connected = true;
  tree.refresh();
  [item] = tree.getChildren();
  assert.equal(item.label, 'Loading problems…');
  assert.equal(item.command, undefined);
  assert.deepEqual(tree.getChildren(item), []);
  assert.equal(tree.findProblem(state.problems[0]), undefined);
  state.loading = false;
  state.problems = [];
  tree.refresh();
  [item] = tree.getChildren();
  assert.equal(item.command.command, 'tensortonic.refresh');
  assert.equal(item.description, 'No problems found');
});

test('cached children and parents are consistent until refresh, then stale nodes are detached', () => {
  const { state, tree } = fixture([ref('one'), ref('two')]);
  const roots = tree.getChildren();
  const [root] = roots;
  const sections = tree.getChildren(root);
  const [section] = sections;
  const children = tree.getChildren(section);
  assert.equal(tree.getChildren(), roots);
  assert.equal(tree.getChildren(root), sections);
  assert.equal(tree.getChildren(section), children);
  assert.equal(tree.getTreeItem(children[0]), children[0]);
  assert.equal(tree.getParent(children[0]), section);
  assert.equal(tree.getParent(section), root);
  assert.equal(tree.getParent(root), undefined);
  assert.deepEqual(tree.getChildren(children[0]), []);
  assert.deepEqual(tree.getChildren({ id: root.id }), []);
  let events = 0;
  tree.onDidChangeTreeData(value => { assert.equal(value, undefined); events += 1; assert.equal(leaves(tree)[0].problemRef.slug, 'new'); });
  state.problems = [ref('new')];
  tree.refresh();
  assert.equal(events, 1);
  for (const stale of [root, section, ...children]) {
    assert.deepEqual(tree.getChildren(stale), []);
    assert.equal(tree.getParent(stale), undefined);
  }
  assert.equal(tree.findProblem(children[0].problemRef), undefined);
  assert.notEqual(tree.getChildren(), roots);
});

test('refresh updates current state and solved progress without retaining stale descendants', () => {
  const problems = [ref('one'), ref('two')];
  const { state, tree } = fixture(problems, { activeRef: problems[0] });
  const oldCurrent = tree.findProblem(problems[0]);
  state.activeRef = problems[1];
  state.problems = problems.map(problem => ({ ...problem, solved: true }));
  tree.refresh();
  assert.ok(!tree.findProblem(problems[0]).description.includes('Current'));
  assert.ok(tree.findProblem(problems[1]).description.includes('Current'));
  assert.equal(tree.getParent(oldCurrent), undefined);
  assert.equal(tree.getChildren()[0].description, '2 / 2 solved');
});

test('problem leaves retain the original command reference and the existing context menu contract', () => {
  const problem = ref('one');
  const { tree } = fixture([problem]);
  const leaf = leaves(tree)[0];
  assert.equal(leaf.problemRef, problem);
  assert.equal(leaf.contextValue, 'tensortonicProblem');
  assert.deepEqual(leaf.command, { command: 'tensortonic.openProblem', title: 'Open problem', arguments: [problem] });
  assert.equal(leaf.command.arguments[0], problem);
  assert.equal(leaf.collapsibleState, vscode.TreeItemCollapsibleState.None);
});

test('untrusted labels, tooltips and accessibility remain bounded plain text, never Markdown or HTML objects', () => {
  const hostile = '<img src=x onerror=alert(1)> [click](command:evil) $(zap)';
  const problem = ref('one', { title: hostile + '\n\u202etest', studyPlanTitle: hostile,
    difficulty: { toString() { throw new Error('Do not call'); } },
    technology: 'x'.repeat(1000), section: { id: 'odd:[]/id', title: hostile, order: 0 } });
  const { tree } = fixture([problem]);
  const [root] = tree.getChildren(), [section] = tree.getChildren(root), [leaf] = leaves(tree);
  for (const item of [root, section, leaf]) {
    assert.equal(typeof item.label, 'string');
    assert.equal(typeof item.tooltip, 'string');
    assert.equal(typeof item.accessibilityInformation.label, 'string');
    assert.ok(item.label.includes(hostile));
    assert.ok(!/[\r\n\u202e]/.test(item.label));
    assert.ok(item.label.length <= 300);
    assert.equal(item.tooltip.isTrusted, undefined);
  }
  assert.equal(leaf.description.length, 300);
});

test('dispose releases cached nodes and listeners without emitting later refreshes', () => {
  const { tree } = fixture();
  const root = tree.getChildren()[0];
  const leaf = leaves(tree)[0];
  tree.onDidChangeTreeData(() => assert.fail('disposed provider emitted'));
  tree.dispose();
  assert.deepEqual(tree.getChildren(), []);
  assert.deepEqual(tree.getChildren(root), []);
  assert.equal(tree.getParent(leaf), undefined);
  assert.equal(tree.findProblem(leaf.problemRef), undefined);
  tree.refresh();
  assert.deepEqual(tree.getChildren(), []);
});
