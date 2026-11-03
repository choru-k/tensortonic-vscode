'use strict';

const https = require('node:https');

const CATALOG_URL = 'https://api.tensortonic.com/api/study-plans';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
// Match client.js requirePython: names in display metadata never determine support.
const UNSUPPORTED = /(?:^|[\s_/-])(sql|cuda|triton)(?:$|[\s_/-])/i;
const UNSUPPORTED_MESSAGE = 'This version supports Python, NumPy, Pandas and PyTorch problems. SQL, CUDA and Triton execution is not supported.';
const FREE_TITLE = 'Free problems';
const INPUT_MESSAGE = 'Use a study-plan slug, a canonical https://www.tensortonic.com/study-plans/slug URL, or a TensorTonic problem URL with one studyPlan value.';

function abortError() {
  const error = new Error('Study-plan selection cancelled.');
  error.name = 'AbortError';
  return error;
}

function plainText(value, limit = 240) {
  if (typeof value !== 'string') return '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = value
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] || match;
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
    })
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\$\([^)]*\)/g, '')
    .replace(/(^|\s)[#>]+\s*/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\\([\\[\]()!#*`_~>])/g, '$1')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, limit).join('');
}

function catalogRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && payload.status === 'success' && Array.isArray(payload.data)) return payload.data;
  throw new Error('TensorTonic returned an unexpected study-plan catalogue.');
}

/** Normalize public metadata only. Invalid/duplicate identifiers are omitted. */
function normalizePlans(payload) {
  const seen = new Set();
  const result = [];
  for (const raw of catalogRows(payload)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !SLUG.test(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const title = plainText(raw.title);
    const plan = {
      id: raw.id,
      title: title || raw.id,
      subtitle: plainText(raw.subtitle, 320),
      description: plainText(raw.description, 480),
      difficulty: plainText(raw.difficulty, 80),
      category: plainText(raw.category, 80),
      supported: !UNSUPPORTED.test(raw.id),
      incomplete: !title,
    };
    for (const name of ['estimatedDays', 'problemCount']) {
      if (Number.isSafeInteger(raw[name]) && raw[name] >= 0) plan[name] = raw[name];
      else if (raw[name] != null) plan.incomplete = true;
    }
    for (const name of ['subtitle', 'description', 'difficulty', 'category']) {
      if (raw[name] != null && typeof raw[name] !== 'string') plan.incomplete = true;
    }
    result.push(plan);
  }
  return result;
}

/** Fixed anonymous GET. This loader never accepts a target URL or caller headers. */
function loadPublicStudyPlans({ signal } = {}) {
  if (signal && signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) {
        if (response) response.destroy();
        if (request) request.destroy();
        reject(error);
      } else resolve(value);
    };
    const onAbort = () => finish(abortError());
    timer = setTimeout(() => finish(new Error('The public study-plan request timed out.')), REQUEST_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      request = https.get(CATALOG_URL, {
        agent: false,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
      }, incoming => {
        response = incoming;
        if (settled) { incoming.destroy(); return; }
        // Node HTTPS does not follow redirects; explicitly refuse every non-200 response.
        if (incoming.statusCode !== 200) {
          finish(new Error('The public study-plan catalogue is unavailable.'));
          return;
        }
        const declaredSize = incoming.headers && incoming.headers['content-length'];
        if (declaredSize != null && /^\d+$/.test(String(declaredSize)) && Number(declaredSize) > MAX_BODY_BYTES) {
          finish(new Error('The public study-plan catalogue exceeded the size limit.'));
          return;
        }
        const chunks = [];
        let length = 0;
        incoming.on('data', chunk => {
          if (settled) return;
          try {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            length += bytes.length;
            if (length > MAX_BODY_BYTES) {
              finish(new Error('The public study-plan catalogue exceeded the size limit.'));
              return;
            }
            chunks.push(bytes);
          } catch {
            finish(new Error('TensorTonic returned an invalid study-plan catalogue.'));
          }
        });
        incoming.on('end', () => {
          if (settled) return;
          try {
            finish(undefined, JSON.parse(Buffer.concat(chunks, length).toString('utf8')));
          } catch {
            finish(new Error('TensorTonic returned an invalid study-plan catalogue.'));
          }
        });
        incoming.on('error', () => finish(new Error('The public study-plan request failed.')));
        incoming.on('aborted', () => finish(new Error('The public study-plan request was interrupted.')));
      });
      request.on('error', () => finish(new Error('The public study-plan request failed.')));
      // Covers a signal aborted synchronously by an injected transport.
      if (settled) request.destroy();
      else if (signal && signal.aborted) onAbort();
    } catch {
      finish(new Error('The public study-plan request failed.'));
    }
  });
}

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    // Attach handlers even when already aborted, so late loader failures remain handled.
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function manualId(value) {
  if (typeof value !== 'string') throw new Error(INPUT_MESSAGE);
  const text = value.trim();
  if (!text) return undefined;
  if (SLUG.test(text)) return text;
  // Exact route patterns reject encoded hosts/paths, credentials, ports, duplicate
  // query values, redirects, foreign origins, and unrelated query parameters.
  const plan = /^https:\/\/www\.tensortonic\.com\/study-plans\/([a-zA-Z0-9][a-zA-Z0-9-]{0,199})\/?$/.exec(text);
  if (plan) return plan[1];
  const problem = /^https:\/\/www\.tensortonic\.com\/problems\/[a-zA-Z0-9][a-zA-Z0-9-]{0,199}\?studyPlan=([a-zA-Z0-9][a-zA-Z0-9-]{0,199})$/.exec(text);
  if (problem) return problem[1];
  throw new Error(INPUT_MESSAGE);
}

class StudyPlanPicker {
  constructor(vscode, { loadCatalog = loadPublicStudyPlans, now = Date.now, ttlMs = 300000 } = {}) {
    if (!vscode || !vscode.window || typeof loadCatalog !== 'function' || typeof now !== 'function') throw new TypeError('A VS Code window and study-plan catalogue loader are required.');
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new TypeError('Study-plan catalogue TTL must be a non-negative number.');
    this.vscode = vscode;
    this.loadCatalog = loadCatalog;
    this.now = now;
    this.ttlMs = ttlMs;
    this.cache = undefined;
    this.active = undefined;
    this.disposed = false;
  }

  pick(currentPlanId) {
    if (this.disposed) return Promise.resolve(undefined);
    if (this.active) return this.active.promise;
    const operation = {
      controller: new AbortController(),
      currentId: typeof currentPlanId === 'string' && SLUG.test(currentPlanId) ? currentPlanId : undefined,
      subscriptions: [],
      phase: 'picker',
      state: { status: 'loading', plans: [] },
    };
    operation.promise = new Promise(resolve => { operation.resolve = resolve; });
    if (typeof this.vscode.CancellationTokenSource === 'function') operation.tokenSource = new this.vscode.CancellationTokenSource();
    this.active = operation;
    try {
      if (typeof this.vscode.window.createQuickPick === 'function') this.startNative(operation);
      else void this.startFallback(operation).catch(() => this.finish(operation));
    } catch {
      this.finish(operation);
    }
    return operation.promise;
  }

  live(operation) {
    return this.active === operation && !operation.completed && !this.disposed && !operation.controller.signal.aborted;
  }

  invalidate() {
    this.cache = undefined;
    if (this.active) this.finish(this.active);
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
  }

  closeQuickPick(operation) {
    const quickPick = operation.quickPick;
    operation.quickPick = undefined;
    for (const subscription of operation.subscriptions.splice(0)) subscription.dispose();
    if (quickPick) {
      quickPick.hide();
      quickPick.dispose();
    }
  }

  finish(operation, result) {
    if (operation.completed) return;
    operation.completed = true;
    operation.controller.abort();
    if (operation.tokenSource) operation.tokenSource.cancel();
    this.closeQuickPick(operation);
    if (operation.tokenSource) operation.tokenSource.dispose();
    if (this.active === operation) this.active = undefined;
    operation.resolve(result);
  }

  items(operation) {
    const { plans, status, incomplete } = operation.state;
    const current = operation.currentId;
    const items = [{ label: FREE_TITLE, description: current ? 'Browse the free problem catalogue' : 'Current selection', picked: !current, action: 'free' }];
    if (current && !plans.some(plan => plan.id === current)) {
      items.push({ label: current, description: `Current selection · ${status === 'loading' ? 'Loading catalogue' : 'Not listed in the public catalogue'}`, action: 'plan', id: current, title: current, picked: true });
    }
    for (const plan of plans) {
      const metadata = [plan.id, plan.difficulty, plan.category];
      if (plan.problemCount !== undefined) metadata.push(`${plan.problemCount} problems`);
      if (plan.estimatedDays !== undefined) metadata.push(`${plan.estimatedDays} days`);
      if (!plan.supported) metadata.push('Execution unsupported in this version');
      if (plan.id === current) metadata.unshift('Current selection');
      items.push({ label: plan.title, description: metadata.filter(Boolean).join(' · '), detail: plan.subtitle || plan.description || undefined, picked: plan.id === current, action: 'plan', id: plan.id, title: plan.title });
    }
    if (status === 'loading') items.push({ label: 'Loading public study plans…', alwaysShow: true, action: 'status' });
    else if (status === 'error') items.push({ label: 'Public study plans could not be loaded', detail: 'You can retry, use free problems, or enter a plan URL or slug.', alwaysShow: true, action: 'status' });
    else if (!plans.length) items.push({ label: incomplete ? 'No usable public study-plan metadata was returned' : 'No public study plans are available', detail: 'Free problems and manual plan input are still available.', alwaysShow: true, action: 'status' });
    else if (incomplete) items.push({ label: 'Some public study-plan metadata is incomplete', detail: 'Available plans are listed above; you can also enter a plan URL or slug.', alwaysShow: true, action: 'status' });
    if (status !== 'loading') items.push({ label: 'Reload public study plans', action: 'retry', alwaysShow: true });
    items.push({ label: 'Enter a plan URL or slug…', detail: 'Use a canonical TensorTonic URL or a study-plan slug. Leave it empty for free problems.', action: 'manual', alwaysShow: true });
    return items;
  }

  render(operation) {
    if (!this.live(operation) || operation.phase !== 'picker' || !operation.quickPick) return;
    const quickPick = operation.quickPick;
    quickPick.busy = operation.state.status === 'loading';
    quickPick.placeholder = quickPick.busy ? 'Loading public study plans; free problems and manual input are available' : 'Search study plans by title, slug, difficulty, or category';
    quickPick.items = this.items(operation);
    if (!quickPick.value) {
      const selected = quickPick.items.find(item => item.picked);
      if (selected) quickPick.activeItems = [selected];
    }
  }

  async load(operation, force = false) {
    const cached = this.cache;
    const timestamp = this.now();
    if (!force && cached && timestamp >= cached.loadedAt && timestamp - cached.loadedAt < this.ttlMs) {
      operation.state = cached.state;
      this.render(operation);
      return;
    }
    operation.state = { status: 'loading', plans: [] };
    this.render(operation);
    try {
      const payload = await withAbort(Promise.resolve().then(() => {
        if (!this.live(operation)) throw abortError();
        return this.loadCatalog({ signal: operation.controller.signal });
      }), operation.controller.signal);
      if (!this.live(operation)) return;
      const plans = normalizePlans(payload);
      const incomplete = catalogRows(payload).length !== plans.length || plans.some(plan => plan.incomplete);
      const state = { status: 'ready', plans, incomplete };
      this.cache = { loadedAt: this.now(), state };
      operation.state = state;
    } catch {
      if (!this.live(operation)) return;
      operation.state = { status: 'error', plans: [] };
    }
    this.render(operation);
  }

  startNative(operation) {
    const quickPick = this.vscode.window.createQuickPick();
    operation.quickPick = quickPick;
    quickPick.title = 'TensorTonic study plans';
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    operation.subscriptions.push(quickPick.onDidHide(() => this.finish(operation)));
    operation.subscriptions.push(quickPick.onDidAccept(() => {
      if (!this.live(operation) || operation.phase !== 'picker') return;
      const item = quickPick.selectedItems[0] || quickPick.activeItems[0];
      if (!item || !quickPick.items.includes(item)) return;
      if (item.action === 'retry') {
        if (operation.state.status !== 'loading') void this.load(operation, true);
      } else if (item.action === 'manual') {
        operation.phase = 'manual';
        this.closeQuickPick(operation);
        void this.manual(operation).then(result => {
          if (this.live(operation)) this.finish(operation, result);
        }, () => this.finish(operation));
      } else if (item.action === 'free') this.finish(operation, { id: undefined, title: FREE_TITLE });
      else if (item.action === 'plan') {
        if (UNSUPPORTED.test(item.id)) this.informUnsupported();
        else this.finish(operation, { id: item.id, title: item.title });
      }
    }));
    this.render(operation);
    quickPick.show();
    void this.load(operation);
  }

  async startFallback(operation) {
    if (typeof this.vscode.window.showQuickPick !== 'function') {
      this.finish(operation, await this.manual(operation));
      return;
    }
    await this.load(operation);
    while (this.live(operation)) {
      const items = this.items(operation);
      const item = await withAbort(this.vscode.window.showQuickPick(items, {
        title: 'TensorTonic study plans',
        placeHolder: 'Search study plans by title, slug, difficulty, or category',
        matchOnDescription: true,
        matchOnDetail: true,
      }, operation.tokenSource && operation.tokenSource.token), operation.controller.signal);
      if (!this.live(operation)) return;
      if (!item || !items.includes(item)) { this.finish(operation); return; }
      if (item.action === 'status') continue;
      if (item.action === 'retry') { await this.load(operation, true); continue; }
      if (item.action === 'free') { this.finish(operation, { id: undefined, title: FREE_TITLE }); return; }
      if (item.action === 'manual') { this.finish(operation, await this.manual(operation)); return; }
      if (item.action === 'plan') {
        if (UNSUPPORTED.test(item.id)) { this.informUnsupported(); this.finish(operation); }
        else this.finish(operation, { id: item.id, title: item.title });
        return;
      }
    }
  }

  informUnsupported() {
    const show = this.vscode.window.showWarningMessage || this.vscode.window.showInformationMessage;
    if (typeof show === 'function') Promise.resolve(show.call(this.vscode.window, UNSUPPORTED_MESSAGE)).catch(() => {});
  }

  async manual(operation) {
    if (!this.live(operation) || typeof this.vscode.window.showInputBox !== 'function') return undefined;
    const value = await withAbort(this.vscode.window.showInputBox({
      title: 'TensorTonic study plan',
      prompt: 'Enter a canonical TensorTonic study-plan or problem URL, or a study-plan slug. Leave empty for free problems.',
      value: operation.currentId || '',
      placeHolder: 'pytorch-basics or https://www.tensortonic.com/study-plans/pytorch-basics',
      validateInput: input => {
        try { const id = manualId(input); return id && UNSUPPORTED.test(id) ? UNSUPPORTED_MESSAGE : undefined; }
        catch { return INPUT_MESSAGE; }
      },
    }, operation.tokenSource && operation.tokenSource.token), operation.controller.signal);
    if (!this.live(operation) || value === undefined) return undefined;
    let id;
    try { id = manualId(value); }
    catch { return undefined; }
    if (id && UNSUPPORTED.test(id)) { this.informUnsupported(); return undefined; }
    const plan = operation.state.plans.find(item => item.id === id);
    return { id, title: id ? (plan ? plan.title : id) : FREE_TITLE };
  }
}

module.exports = { StudyPlanPicker, normalizePlans, loadPublicStudyPlans };
