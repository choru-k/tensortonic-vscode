'use strict';

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const SUPPORTED_SOURCES = new Set(['free', 'python']);
const UNSUPPORTED = /(?:^|[\s_/-])(sql|cuda|triton)(?:$|[\s_/-])/i;

function plainTitle(value, fallback) {
  return (typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/^#+\s*/, '').trim() : '') || fallback;
}

function slug(value, field) {
  if (typeof value !== 'string' || !SLUG.test(value)) throw new Error(`Invalid TensorTonic ${field}.`);
  return value;
}

function refOf(input) {
  const value = input && input.ref ? input.ref : input;
  const ref = typeof value === 'string' ? { slug: value } : value;
  if (!ref || typeof ref !== 'object') throw new Error('Select a TensorTonic problem first.');
  const result = { slug: slug(ref.slug, 'problem slug') };
  if (ref.apiId != null) result.apiId = slug(ref.apiId, 'problem API identifier');
  if (ref.planId != null && ref.planId !== '') result.planId = slug(ref.planId, 'study-plan slug');
  if (typeof ref.technology === 'string') result.technology = ref.technology;
  if (typeof ref.source === 'string') result.source = ref.source;
  if (typeof ref.catalogSlug === 'string' && SLUG.test(ref.catalogSlug)) result.catalogSlug = ref.catalogSlug;
  return result;
}

function requirePython(input) {
  const ref = refOf(input);
  const runtime = input && input.raw && input.raw.functionMetadata && input.raw.functionMetadata.runtime;
  if ((ref.source && !SUPPORTED_SOURCES.has(ref.source)) ||
      UNSUPPORTED.test(ref.technology || '') || UNSUPPORTED.test(runtime || '') ||
      UNSUPPORTED.test(ref.planId || '')) {
    throw new Error('This version supports Python, NumPy, Pandas and PyTorch problems. SQL, CUDA and Triton execution is not supported.');
  }
  return ref;
}

function successData(response, label) {
  if (!response || response.status !== 'success' || response.data == null) {
    throw new Error(response && response.message || `TensorTonic returned an unexpected ${label} response.`);
  }
  return response.data;
}

function visibleCases(cases) {
  if (!Array.isArray(cases)) return [];
  return cases.filter(item => item && typeof item === 'object' && item.isPublic !== false);
}

function runCases(cases) {
  if (!Array.isArray(cases)) throw new Error('Test cases must be a JSON array.');
  return cases.filter(item => !(item && item.isPublic === false)).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !Object.prototype.hasOwnProperty.call(item, 'inputs') || item.inputs == null ||
        typeof item.inputs !== 'object' || Array.isArray(item.inputs)) {
      throw new Error(`Test case ${index + 1} must contain an inputs object, such as {"id":"custom-1","inputs":{"x":[0,1]}}.`);
    }
    return { id: item.id == null ? `custom-${index + 1}` : String(item.id), inputs: item.inputs };
  });
}

class TensorTonicClient {
  constructor(request) {
    if (typeof request !== 'function') throw new TypeError('A TensorTonic request function is required.');
    this.request = request;
  }

  async listProblems(planId) {
    if (planId != null && planId !== '') {
      slug(planId, 'study-plan slug');
      requirePython({ slug: 'catalog', planId });
    }
    const result = [];
    const seen = new Set();
    for (let page = 1; page <= 1000; page += 1) {
      const query = new URLSearchParams({ page: String(page), limit: '100' });
      if (planId) query.set('planId', planId);
      const data = successData(await this.request(`/api/problems/list?${query}`, { method: 'GET' }), 'problem catalogue');
      if (!Array.isArray(data.problems)) throw new Error('TensorTonic returned an unexpected problem catalogue.');
      for (const item of data.problems) {
        if (!item || !SUPPORTED_SOURCES.has(item.source)) continue;
        if (!planId && item.source !== 'free') continue;
        const apiId = item.sourceId || item.id;
        if (typeof apiId !== 'string' || !SLUG.test(apiId)) continue;
        if (typeof item.slug !== 'string' || !SLUG.test(item.slug)) continue;
        const ref = {
          slug: item.slug,
          apiId,
          title: plainTitle(item.title, apiId),
          difficulty: item.difficulty || '',
          technology: item.category || 'python',
          source: item.source,
          solved: item.solved === true,
        };
        if (item.planId) ref.planId = slug(item.planId, 'study-plan slug');
        if (item.slug && SLUG.test(item.slug)) ref.catalogSlug = item.slug;
        const key = `${ref.planId || ''}/${ref.slug}`;
        if (!seen.has(key)) { result.push(ref); seen.add(key); }
      }
      if (!data.pagination || data.pagination.hasMore !== true) return result;
      if (data.problems.length === 0 || !Number.isInteger(data.pagination.totalPages) || data.pagination.totalPages <= page) {
        throw new Error('TensorTonic returned invalid catalogue pagination.');
      }
    }
    throw new Error('TensorTonic catalogue exceeded the supported pagination limit.');
  }

  async listStudyPlans() {
    const data = successData(await this.request('/api/study-plans', { method: 'GET' }), 'study-plan');
    if (!Array.isArray(data)) throw new Error('TensorTonic returned an unexpected study-plan list.');
    return data;
  }

  async getProblem(input) {
    const ref = requirePython(input);
    const id = ref.apiId || ref.slug;
    const path = ref.planId ? `/api/study-plans/${ref.planId}/problems/${id}` : `/api/problems/${id}`;
    const raw = successData(await this.request(path, { method: 'GET' }), 'problem');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.starterCode !== 'string') {
      throw new Error('TensorTonic returned an unexpected problem detail.');
    }
    const title = plainTitle(raw.title, ref.slug);
    const description = [
      raw.description,
      typeof raw.requirements === 'string' && raw.requirements ? `## Requirements\n\n${raw.requirements}` : '',
      typeof raw.constraints === 'string' && raw.constraints ? `## Constraints\n\n${raw.constraints}` : '',
    ].filter(value => typeof value === 'string' && value.length).join('\n\n');
    const problem = {
      ref,
      title,
      description,
      starterCode: raw.starterCode,
      examples: Array.isArray(raw.examples) ? raw.examples : [],
      testCases: visibleCases(raw.testCases),
      // Keep only the observed detail fields used by the adapter. Never retain answers or theory.
      raw: {
        id: raw.id,
        title: raw.title,
        description: raw.description,
        requirements: raw.requirements,
        constraints: raw.constraints,
        starterCode: raw.starterCode,
        examples: Array.isArray(raw.examples) ? raw.examples : [],
        testCases: visibleCases(raw.testCases),
        functionMetadata: raw.functionMetadata,
      },
    };
    requirePython(problem);
    return problem;
  }

  async run(problem, code, testCases) {
    const ref = requirePython(problem);
    if (typeof code !== 'string') throw new Error('Solution code must be a string.');
    const body = { code, testCases: runCases(testCases === undefined ? problem.testCases : testCases) };
    const id = ref.apiId || ref.slug;
    const path = ref.planId ? `/api/study-plans/${ref.planId}/problems/${id}/run` : `/api/problems/${id}/run-cases`;
    if (!ref.planId) body.problemType = 'free';
    return this.request(path, { method: 'POST', body });
  }

  async submit(problem, code) {
    const ref = requirePython(problem);
    if (typeof code !== 'string') throw new Error('Solution code must be a string.');
    const body = { code };
    const id = ref.apiId || ref.slug;
    const path = ref.planId ? `/api/study-plans/${ref.planId}/problems/${id}/submit` : `/api/problems/${id}/submit`;
    if (!ref.planId) body.problemType = 'free';
    return this.request(path, { method: 'POST', body });
  }
}

module.exports = { TensorTonicClient };
