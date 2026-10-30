'use strict';

// The sidebar is a cached presentation of extension state, never another data
// source. Refresh replaces the snapshot so old async reveals cannot walk it.
function text(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 300) || fallback;
}

function refOf(value) {
  const ref = value && (value.problemRef || value.ref || value);
  return ref && typeof ref === 'object' ? ref : undefined;
}

function key(planId, value) { return JSON.stringify([planId || '', value]); }
function progress(problems) {
  return { solved: problems.filter(problem => problem.solved === true).length, total: problems.length };
}

class ProblemTreeProvider {
  constructor(vscode, state) {
    this.vscode = vscode;
    this.state = state;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.disposed = false;
    this.rebuild();
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.emitter.dispose();
  }

  clear() {
    this.roots = [];
    this.children = new Map();
    this.parents = new Map();
    this.identityIndex = new Map();
    this.slugIndex = new Map();
  }

  refresh() {
    if (this.disposed) return;
    this.rebuild();
    this.emitter.fire(undefined);
  }

  getTreeItem(element) { return element; }
  getChildren(element) { return element ? this.children.get(element) || [] : this.roots; }
  getParent(element) { return this.parents.get(element); }

  findProblem(value) {
    const ref = refOf(value);
    if (!ref) return undefined;
    const apiId = typeof ref.apiId === 'string' && ref.apiId ? ref.apiId : undefined;
    const slug = typeof ref.slug === 'string' && ref.slug ? ref.slug : undefined;
    if (!apiId && !slug) return undefined;
    if (apiId) {
      const exact = this.identityIndex.get(key(ref.planId, apiId)) || [];
      if (exact.length) return exact.length === 1 ? exact[0] : undefined;
    }
    const aliases = this.slugIndex.get(key(ref.planId, slug)) || [];
    // An explicitly different API identifier must not silently match an alias.
    // A legacy slug alone is not proof of API identity: another row can use
    // that same string as its API ID while having a different browser slug.
    const matches = apiId ? aliases.filter(item => !item.problemRef.apiId) : aliases;
    return matches.length === 1 ? matches[0] : undefined;
  }

  node(label, id, collapsibleState, parent) {
    const item = new this.vscode.TreeItem(label, collapsibleState);
    item.id = id;
    this.children.set(item, []);
    if (parent) {
      this.parents.set(item, parent);
      this.children.get(parent).push(item);
    } else this.roots.push(item);
    return item;
  }

  placeholder(label, id, icon, command, description) {
    const item = this.node(label, `tensortonic:state:${id}`, this.vscode.TreeItemCollapsibleState.None);
    item.iconPath = new this.vscode.ThemeIcon(icon);
    item.description = description;
    item.tooltip = description ? `${label}\n${description}` : label;
    item.accessibilityInformation = { label: [label, description].filter(Boolean).join(', ') };
    if (command) item.command = { command: `tensortonic.${command}`, title: label };
  }

  setProgress(item, problems, kind) {
    const counts = progress(problems);
    item.description = `${counts.solved} / ${counts.total} solved`;
    item.tooltip = `${item.label}\n${counts.solved} of ${counts.total} problems solved`;
    item.accessibilityInformation = { label: `${item.label}, ${kind}, ${counts.solved} of ${counts.total} problems solved` };
  }

  rebuild() {
    this.clear();
    if (!this.state.bridge || !this.state.bridge.connected) {
      this.placeholder('Connect your TensorTonic browser companion', 'disconnected', 'plug', 'connect');
      return;
    }
    if (this.state.loading) {
      this.placeholder('Loading problems…', 'loading', 'loading');
      return;
    }
    const problems = Array.isArray(this.state.problems)
      ? this.state.problems.filter(problem => problem && typeof problem === 'object') : [];
    if (!problems.length) {
      this.placeholder('Refresh problems', 'empty', 'refresh', 'refresh', 'No problems found');
      return;
    }
    const planId = typeof this.state.selectedPlanId === 'string' ? this.state.selectedPlanId : '';
    const planTitle = planId ? text(problems.find(problem => text(problem.studyPlanTitle))?.studyPlanTitle, planId) : 'Free problems';
    const root = this.node(planTitle, `tensortonic:root:${key(planId, planId ? 'plan' : 'free')}`,
      this.vscode.TreeItemCollapsibleState.Expanded);
    root.contextValue = planId ? 'tensortonicStudyPlan' : 'tensortonicFreeProblems';
    root.iconPath = new this.vscode.ThemeIcon(planId ? 'book' : 'list-unordered');
    this.setProgress(root, problems, planId ? 'study plan' : 'free problems');

    const sections = new Map();
    const ids = new Map();
    for (const problem of problems) {
      let parent = root;
      if (planId) {
        const section = problem.section;
        const hasSection = section && typeof section.id === 'string' && section.id.length > 0;
        const sectionKey = JSON.stringify(hasSection ? ['section', section.id] : ['legacy']);
        if (!sections.has(sectionKey)) {
          const label = hasSection ? text(section.title, 'Untitled section') : 'Problems';
          const item = this.node(label, `${root.id}:section:${sectionKey}`,
            this.vscode.TreeItemCollapsibleState.Collapsed, root);
          item.contextValue = 'tensortonicStudyPlanSection';
          item.iconPath = new this.vscode.ThemeIcon('folder');
          sections.set(sectionKey, { item, problems: [] });
        }
        const group = sections.get(sectionKey);
        group.problems.push(problem);
        parent = group.item;
      }

      // Refs are already in the service's section/problem order. Preserve it;
      // neither alphabetical order nor catalogue-global sortOrder is relevant.
      const identity = key(problem.planId, problem.apiId || problem.slug);
      const occurrence = ids.get(identity) || 0;
      ids.set(identity, occurrence + 1);
      const label = text(problem.title, text(problem.slug, 'Untitled problem'));
      const item = this.node(label, `${root.id}:problem:${identity}:${occurrence}`,
        this.vscode.TreeItemCollapsibleState.None, parent);
      item.problemRef = problem;
      item.contextValue = 'tensortonicProblem';
      item.iconPath = new this.vscode.ThemeIcon(problem.solved === true ? 'pass-filled' : 'circle-outline');
      item.command = { command: 'tensortonic.openProblem', title: 'Open problem', arguments: [problem] };
      item.description = [text(problem.difficulty), text(problem.technology)].filter(Boolean).join(' · ');
      item.tooltip = [label, planId ? `Study plan: ${planTitle}` : '', planId ? `Section: ${parent.label}` : '',
        problem.solved === true ? 'Solved' : 'Not solved', item.description].filter(Boolean).join('\n');
      item.accessibilityInformation = { label: [label, problem.solved === true ? 'Solved' : 'Not solved', item.description].filter(Boolean).join(', ') };
      for (const [index, indexKey] of [[this.identityIndex, identity], [this.slugIndex, key(problem.planId, problem.slug)]]) {
        if (!index.has(indexKey)) index.set(indexKey, []);
        index.get(indexKey).push(item);
      }
    }
    for (const group of sections.values()) this.setProgress(group.item, group.problems, 'section');
    const active = this.findProblem(this.state.activeRef);
    if (active) {
      active.description = ['Current', active.description].filter(Boolean).join(' · ');
      active.tooltip += '\nCurrent problem';
      active.accessibilityInformation.label += ', Current problem';
    }
  }
}

module.exports = { ProblemTreeProvider };
