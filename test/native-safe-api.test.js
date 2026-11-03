'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {validateSafeAPI}=require('./fixtures/native-safe-api');
function fixture(){let calls=0;const api={sessionReady:Promise.resolve(true),sessionStatus:()=>({connected:true,readOnly:true,cleanupPending:false,ownedResources:false}),async smokeTest(options){calls++;assert.equal(options.ref.slug,'pytorch-softmax-from-scratch');return{connected:true,accountVerified:true,readOnly:true,transport:'direct-https',problemCount:30,problem:{slug:options.ref.slug,title:'not copied',hasStatement:true,hasStarterCode:true,testCaseCount:3},unneeded:'private-sentinel'};}};return{api,get calls(){return calls;}};}
test('native helper uses only the safe facade and copies a bounded summary, not payloads',async()=>{
 const h=fixture(),result=await validateSafeAPI(h.api);assert.equal(h.calls,1);assert.equal(result.accountVerified,true);assert.equal(result.browserNeeded,false);assert.equal(JSON.stringify(result).includes('private-sentinel'),false);assert.equal(JSON.stringify(result).includes('not copied'),false);
});
test('missing session, existing owned resources and old capability exports block before any reads',async()=>{
 for(const patch of [{sessionStatus:()=>({connected:false})},{sessionStatus:()=>({connected:true,readOnly:true,ownedResources:true})},{bridge:{}},{client:{}},{vault:{}}]){const h=fixture();Object.assign(h.api,patch);await assert.rejects(validateSafeAPI(h.api));assert.equal(h.calls,0);}
});
test('native helper cancellation is propagated and never retries or imports',async()=>{
 const h=fixture(),controller=new AbortController();controller.abort();await assert.rejects(validateSafeAPI(h.api,{signal:controller.signal}),{code:'CANCELED'});assert.equal(h.calls,0);
 const active=fixture();active.api.smokeTest=async({signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('Canceled'),{code:'CANCELED'})),{once:true});});const second=new AbortController();const pending=validateSafeAPI(active.api,{signal:second.signal});await new Promise(r=>setImmediate(r));second.abort();await assert.rejects(pending,{code:'CANCELED'});
});
