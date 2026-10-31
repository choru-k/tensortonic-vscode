'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedRequest, validateBody } = require('../src/request-policy');

test('only observed Python problem endpoints and bounded catalog parameters are permitted', () => {
  for (const p of ['/api/study-plans', '/api/study-plans/pytorch-basics', '/api/problems/sigmoid-numpy', '/api/study-plans/pytorch-basics/problems/pytorch-mini-training', '/api/problems/list?page=1&limit=100&planId=pytorch-basics']) assert.equal(isAllowedRequest(p), true, p);
  for (const p of ['/api/problems/sigmoid-numpy/run-cases', '/api/problems/sigmoid-numpy/submit', '/api/study-plans/pytorch-basics/problems/pytorch-mini-training/run', '/api/study-plans/pytorch-basics/problems/pytorch-mini-training/submit']) assert.equal(isAllowedRequest(p, 'POST'), true, p);
  for (const p of ['https://evil.example/api/problems/x', '//evil.example/api/problems/x', '/api/me', '/api/billing', '/api/problems/x/solution', '/api/problems/../me', '/api/problems/%2e%2e/me', '/api/study-plans/gpu/cuda/x/run', '/api/problems/list?redirect=evil', '/api/problems/list?limit=99999', '/api/problems/x#ignore']) {
    assert.equal(isAllowedRequest(p), false, p); assert.equal(isAllowedRequest(p, 'POST'), false, p);
  }
});

test('grading body rejects additional destinations, huge code and non-free problemType', () => {
  assert.equal(validateBody({ code: 'pass', testCases: [] }, '/api/problems/x/run-cases'), true);
  assert.equal(validateBody({ code: 'pass', problemType: 'free' }, '/api/problems/x/submit'), true);
  for (const body of [{ code: 'pass', testCases: {}, }, { code: 'x'.repeat(600000), testCases: [] }, { code: 'pass', testCases: [], url: 'https://evil.example' }, { code: 'pass', testCases: [], problemType: 'cuda' }]) assert.equal(validateBody(body, '/api/problems/x/run-cases'), false);
});
