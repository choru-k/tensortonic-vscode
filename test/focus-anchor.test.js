'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { focusAnchorFailure } = require('../src/focus-anchor');
const origin = 'https://www.tensortonic.com';
const expected = { tag: 'a', text: 'Prev', title: '', href: 'owned-problem' };
function element(href, overrides={}) { return { tagName:'A',textContent:' Prev ',getAttribute:name=>name==='href'?href:name==='title'?'':null,...overrides }; }
function original(element) {
 if(element.tagName.toLowerCase()!==expected.tag||(element.textContent||'').replace(/\s+/g,'')!==expected.text||(element.getAttribute('title')||'')!==expected.title)return false;
 try { const u=new URL(element.getAttribute('href'),origin);return expected.href==='owned-problem'&&u.origin===origin&&!u.username&&!u.password&&!u.hash&&/^\/problems\/[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(u.pathname)&&u.searchParams.getAll('studyPlan').length<=1&&[...u.searchParams].every(([k,v])=>k==='studyPlan'&&/^[a-zA-Z0-9][a-zA-Z0-9-]{0,199}$/.test(v)); }catch{return false;}
}
test('anchor diagnostic categories preserve original URL acceptance',()=>{
 const cases=[null,'','#','/problems/next','/problems/next?studyPlan=pytorch','/problems/next?studyPlan=','/problems/next?studyPlan=a&studyPlan=b','/problems/next?x=PRIVATE','/problems/next#PRIVATE','/problems/next#','/problems/next?','/problems/a_b','/study-plans/x','https://evil.invalid/PRIVATE','https://user:PRIVATE@www.tensortonic.com/problems/a','javascript:PRIVATE','http://[bad','//www.tensortonic.com/problems/a','/problems/'+ 'a'.repeat(201),'/problems/Next-A'];
 for(const href of cases)assert.equal(focusAnchorFailure(element(href),expected,origin)===null,original(element(href)));
 for(const suffix of ['', '?studyPlan=pytorch','?private=SECRET','#SECRET','?studyPlan=a&studyPlan=b'])for(const path of ['/problems/a','/problems/a_b','/problems/a/','/login',''])for(const prefix of ['',origin,'https://other.invalid']){const e=element(prefix+path+suffix);assert.equal(focusAnchorFailure(e,expected,origin)===null,original(e));}
});
test('anchor failures export fixed categories without page values',()=>{
 const cases=[[null,'href-missing'],['','href-missing'],['#','href-placeholder'],['http://[bad','href-parse'],['https://evil.invalid/PRIVATE','href-origin'],['https://u:PRIVATE@www.tensortonic.com/problems/a','href-credentials'],['/problems/a#PRIVATE','href-fragment'],['/PRIVATE','href-path'],['/study-plans/PRIVATE','href-study-plan-path'],['/problems/a?PRIVATE=SECRET','href-query']];
 for(const [href,reason] of cases)assert.equal(focusAnchorFailure(element(href),expected,origin),reason);
 assert.equal(focusAnchorFailure(element('/problems/a',{tagName:'BUTTON'}),expected,origin),'anchor-tag');
 assert.equal(focusAnchorFailure(element('/problems/a',{textContent:'PRIVATE warning'}),expected,origin),'anchor-text');
 assert.equal(focusAnchorFailure(element('/problems/a',{getAttribute:n=>n==='title'?'PRIVATE':'/problems/a'}),expected,origin),'anchor-title');
 assert.equal(focusAnchorFailure(element('/problems/a'),{...expected,href:'PRIVATE'},origin),'anchor-contract');
});
