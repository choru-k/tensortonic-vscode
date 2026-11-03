'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createResultFreshness, resultFreshnessLabel } = require('../src/result-freshness-ui');
// Stand-in fixture only: integration must inject the production client export.
function normalize(cases) {
  return cases.filter(c => c.isPublic !== false).map((c, i) => {
    if (!c.inputs || typeof c.inputs !== 'object') throw Error('invalid');
    return { id: c.id == null ? `custom-${i + 1}` : String(c.id), inputs: c.inputs };
  });
}
const base = () => ({ action: 'run', problem: { slug: 'sum', planId: 'python', apiId: 'sum-id' }, solutionUri: 'file:///synthetic/sum.py', solutionText: 'return x + 1\n', testCases: [{ id: 1, inputs: { x: 2 }, expected: 3, name: 'public' }] });
const adapter = () => createResultFreshness({ normalizeRunCases: normalize, now: () => 1000 });
test('capture hashes only effective case payload and does not retain source or cases', () => {
 const a=adapter(),value=base(),snapshot=a.capture(value);assert.equal(snapshot.submittedAt,1000);
 assert.equal(a.compare(snapshot,{...value,testCases:[{id:'1',inputs:{x:2},name:'renamed',expected:99},{isPublic:false,inputs:{x:9}}]}).status,'unchanged');
 assert.equal(JSON.stringify(snapshot).includes('return x'),false);assert.equal(JSON.stringify(snapshot).includes('inputs'),false);
});
test('unsaved code and effective test changes stale Run; exact revert restores unchanged', () => {
 const a=adapter(),v=base(),s=a.capture(v);assert.equal(a.compare(s,{...v,solutionText:'new unsaved text'}).status,'changed');assert.equal(a.compare(s,{...v,testCases:[{id:1,inputs:{x:99}}]}).status,'changed');assert.equal(a.compare(s,v).status,'unchanged');
});
test('Submit freshness ignores all test changes including absent or invalid tests', () => {
 const a=adapter(),v={...base(),action:'submit'},s=a.capture(v);for(const testCases of [undefined,null,[{invalid:true}],[]])assert.equal(a.compare(s,{...v,testCases}).status,'unchanged');assert.equal(a.compare(s,{...v,solutionText:'changed'}).status,'changed');
});
test('missing or malformed Run content is unknown, not empty cases', () => {
 const a=adapter(),v=base(),s=a.capture(v);for(const testCases of [undefined,null,[],[{bad:true}]])assert.equal(a.compare(s,{...v,testCases}).status,testCases?.length===0?'changed':'unknown');assert.equal(a.compare(s,{...v,solutionText:undefined}).status,'unknown');
});
test('plan, problem, URI and action mismatches do not show a stale verdict for another owner', () => {
 const a=adapter(),v=base(),s=a.capture(v);for(const patch of [{problem:{...v.problem,planId:'other'}},{problem:{...v.problem,apiId:'other'}},{solutionUri:'file:///other.py'},{action:'submit'}])assert.equal(a.compare(s,{...v,...patch}).status,'unknown');assert.equal(a.compare(undefined,v).status,'unknown');
});
test('capture/comparison share one injected normalizer; Submit never invokes it', () => {
 let calls=0;const a=createResultFreshness({normalizeRunCases:cases=>{calls++;return normalize(cases);},now:()=>0});const v=base(),s=a.capture(v);a.compare(s,v);assert.equal(calls,2);const sub=a.capture({...v,action:'submit'});a.compare(sub,{...v,action:'submit'});assert.equal(calls,2);
});
test('labels include request snapshot timestamp, no hash/URI or outcome claim', () => {
 const a=adapter(),s=a.capture(base());assert.deepEqual(resultFreshnessLabel(s,{status:'unchanged'}),{status:'unchanged',label:'Unchanged since this run',timestamp:'1970-01-01T00:00:01.000Z'});assert.match(resultFreshnessLabel(s,{status:'changed'}).label,/previous content/);assert.equal(JSON.stringify(resultFreshnessLabel(s,{status:'changed'})).includes(s.contentHash),false);assert.equal(resultFreshnessLabel(undefined,{}).status,'unknown');
 const sub=a.capture({...base(),action:'submit'});assert.match(resultFreshnessLabel(sub,{status:'unchanged'}).label,/submission/);
});
test('invalid capture input rejects without side effects and normalization errors compare unknown', () => {
 assert.throws(()=>createResultFreshness(),TypeError);const a=adapter();assert.throws(()=>a.capture({...base(),testCases:undefined}),TypeError);assert.throws(()=>a.capture({...base(),action:'delete'}),TypeError);
});
