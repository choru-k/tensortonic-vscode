'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createFocusDiagnostics,emitDiagnostic}=require('../src/focus-diagnostics');
test('diagnostics are bounded, enum-only, copied and memory-local',()=>{
 const d=createFocusDiagnostics(),t=d.begin(true);
 t.record({stage:'lookup',outcome:'fail',code:'https://private.invalid/secret',target:'private-problem',url:'secret',error:new Error('private')});
 for(let i=0;i<100;i++)t.emit('loading',i%2?'wait':'ok','document');
 const s=d.snapshot();assert.equal(s.automatic.events.length,64);assert.equal(s.automatic.dropped,37);assert.ok(Object.isFrozen(s.automatic.events));
 assert.doesNotMatch(JSON.stringify(s),/private|secret|https|Error/);assert.equal(createFocusDiagnostics().snapshot().automatic,undefined);
});
test('new attempts isolate stale callbacks and preserve manual versus automatic comparison',()=>{
 const d=createFocusDiagnostics(),old=d.begin(true);old.emit('lookup','start');const current=d.begin(true);current.emit('readiness','start');old.emit('result','applied');
 const manual=d.begin(false);manual.emit('result','applied');
 assert.deepEqual(d.snapshot().automatic.events,[{stage:'readiness',outcome:'start'}]);assert.equal(d.snapshot().manual.events[0].outcome,'applied');
});
test('diagnostics reject arbitrary stage/outcome/targets and never allow callback failures to escape',()=>{
 const events=[];emitDiagnostic(e=>events.push(e),'lookup','fail','TOKEN_PRIVATE','TOKEN_PRIVATE');emitDiagnostic(e=>events.push(e),'TOKEN_PRIVATE','fail');emitDiagnostic(e=>events.push(e),'lookup','TOKEN_PRIVATE');
 assert.deepEqual(events,[{stage:'lookup',outcome:'fail',code:'OTHER'}]);assert.doesNotThrow(()=>emitDiagnostic(()=>{throw Error('private');},'lookup','ok'));
});
test('diagnostic error extraction cannot invoke serialization or leak throwing accessors',()=>{
 const {diagnosticErrorCode}=require('../src/focus-diagnostics');
 assert.equal(diagnosticErrorCode({get code(){throw Error('PRIVATE');},toString(){throw Error('PRIVATE');}}),'OTHER');
 assert.equal(diagnosticErrorCode({code:'TIMEOUT',message:'PRIVATE'}),'TIMEOUT');
});
