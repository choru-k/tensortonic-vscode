'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FocusModeController,canonicalProblem}=require('../src/focus-mode');
const page={id:'owned',owned:true,url:'https://www.tensortonic.com/problems/synthetic',documentId:'doc-1',frameId:'frame-1'};
const verifiedContract=Object.freeze({id:'synthetic-reviewed-dom-v1',verified:true,surface:'problem-content',hidesSecurityUI:false});
function setup(){const calls={verify:0,apply:0,restore:0};const adapter={async verify(p,c){calls.verify++;return{...p,owned:true,contractId:c.id};},async apply(){calls.apply++;return{restore:async()=>{calls.restore++;}};}};return{adapter,calls};}
test('default off and no production DOM contract means zero adapter calls',async()=>{const h=setup(),c=new FocusModeController({adapter:h.adapter});assert.deepEqual(c.state,{enabled:false,status:'off',applied:false});assert.equal((await c.setEnabled(true,{page})).status,'awaiting-dom-verification');assert.deepEqual(h.calls,{verify:0,apply:0,restore:0});});
test('unverified/security-hiding contract is never applied',async()=>{for(const patch of [{verified:false},{surface:'browser-chrome'},{hidesSecurityUI:true}]){const h=setup(),c=new FocusModeController({adapter:h.adapter,verifiedContract:{...verifiedContract,...patch}});assert.equal((await c.setEnabled(true,{page})).status,'awaiting-dom-verification');assert.equal(h.calls.apply,0);}});
test('foreign, login, queried, credentialed and unowned pages fail open untouched',async()=>{for(const url of ['https://evil.invalid/problems/x','https://www.tensortonic.com/login','https://www.tensortonic.com/problems/x?session=1','https://user@www.tensortonic.com/problems/x'])assert.equal(canonicalProblem(url),false);for(const p of [{...page,owned:false},{...page,documentId:undefined},{...page,url:'https://evil.invalid/problems/x'}]){const h=setup(),c=new FocusModeController({adapter:h.adapter,verifiedContract});assert.equal((await c.setEnabled(true,{page:p})).status,'unavailable');assert.equal(h.calls.apply,0);}});
test('valid reviewed adapter applies and restores only its own lease',async()=>{const h=setup(),c=new FocusModeController({adapter:h.adapter,verifiedContract});assert.equal((await c.setEnabled(true,{page})).applied,true);assert.equal((await c.setEnabled(false)).status,'off');assert.deepEqual(h.calls,{verify:1,apply:1,restore:1});});
test('mismatched current document proof cannot style a navigated page',async()=>{const h=setup();h.adapter.verify=async p=>({...p,owned:true,contractId:verifiedContract.id,documentId:'new'});const c=new FocusModeController({adapter:h.adapter,verifiedContract});assert.equal((await c.setEnabled(true,{page})).status,'unavailable');assert.equal(h.calls.apply,0);});
test('disabled while verification waits prevents late apply',async()=>{const h=setup();let resolve;h.adapter.verify=p=>new Promise(r=>resolve=()=>r({...p,owned:true,contractId:verifiedContract.id}));const c=new FocusModeController({adapter:h.adapter,verifiedContract}),pending=c.setEnabled(true,{page});await new Promise(r=>setImmediate(r));const off=c.setEnabled(false);resolve();await pending;await off;assert.equal(h.calls.apply,0);assert.equal(c.state.status,'off');});
test('disabled while apply waits restores late owned styles',async()=>{const h=setup();let resolve;h.adapter.apply=()=>new Promise(r=>resolve=()=>r({restore:async()=>h.calls.restore++}));const c=new FocusModeController({adapter:h.adapter,verifiedContract}),pending=c.setEnabled(true,{page});await new Promise(r=>setImmediate(r));const off=c.setEnabled(false);resolve();await pending;await off;assert.equal(h.calls.restore,1);assert.equal(c.state.applied,false);});
test('cleanup failure retains owned lease for explicit retry rather than losing it',async()=>{const h=setup();let fail=true;h.adapter.apply=async()=>({restore:async()=>{if(fail)throw Error('synthetic');h.calls.restore++;}});const c=new FocusModeController({adapter:h.adapter,verifiedContract});await c.setEnabled(true,{page});assert.equal((await c.setEnabled(false)).status,'restore-pending');assert.equal(c.state.applied,true);fail=false;assert.equal((await c.setEnabled(false)).status,'off');assert.equal(c.state.applied,false);});
test('navigation and dispose turn focus off without adopting any other tab',async()=>{const h=setup(),c=new FocusModeController({adapter:h.adapter,verifiedContract});await c.setEnabled(true,{page});await c.pageChanged();await c.dispose();assert.equal((await c.setEnabled(true,{page})).status,'off');assert.equal(h.calls.apply,1);});
test('canceled request does not call adapter',async()=>{const h=setup(),c=new FocusModeController({adapter:h.adapter,verifiedContract}),a=new AbortController();a.abort();await c.setEnabled(true,{page,signal:a.signal});assert.equal(h.calls.verify,0);});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function within(promise,ms=250){let timer;try{return await Promise.race([promise,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Controller did not settle within its bound')),ms);})]);}finally{clearTimeout(timer);}}

test('strict WWW problem scope permits only one optional validated studyPlan',()=>{
 for(const url of ['https://www.tensortonic.com/problems/x','https://www.tensortonic.com/problems/A-9?studyPlan=P-2','https://www.tensortonic.com/problems/'+ 'a'.repeat(200)+'?studyPlan='+'p'.repeat(200)])assert.equal(canonicalProblem(url),true,url);
 for(const url of [undefined,new URL(page.url),' https://www.tensortonic.com/problems/x',page.url+'\n','http://www.tensortonic.com/problems/x','https://tensortonic.com/problems/x','https://www.tensortonic.com:443/problems/x','https://user@www.tensortonic.com/problems/x','https://www.tensortonic.com/study-plans/p/problems/x',page.url+'/',page.url+'#',page.url+'#details',page.url+'?',page.url+'?studyPlan=',page.url+'?studyPlan=p&studyPlan=q',page.url+'?studyPlan=p&',page.url+'?studyPlan=p&session=1',page.url+'?study%50lan=p',page.url+'?studyPlan=%70','https://www.tensortonic.com/problems/%78','https://www.tensortonic.com/problems/-x','https://www.tensortonic.com/problems/a_b','https://www.tensortonic.com/problems/'+ 'a'.repeat(201)])assert.equal(canonicalProblem(url),false,String(url));
});

test('snapshot and proof bind the exact frame as well as document and page',async()=>{
 for(const frameId of [undefined,'',5]){
  const h=setup(),c=new FocusModeController({adapter:h.adapter,verifiedContract});
  assert.equal((await c.setEnabled(true,{page:{...page,frameId}})).status,'unavailable');assert.equal(h.calls.verify,0);
 }
 const h=setup();let captured;
 h.adapter.verify=async snapshot=>{captured=snapshot;return{...snapshot,owned:true,contractId:verifiedContract.id,frameId:'different-frame'};};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract});
 assert.equal((await c.setEnabled(true,{page})).status,'unavailable');assert.equal(h.calls.apply,0);assert.equal(captured.frameId,page.frameId);assert.equal(Object.isFrozen(captured),true);
});

test('navigation aborts an internally signaled hung verification without waiting on its promise',async()=>{
 const h=setup(),started=deferred();let received;
 h.adapter.verify=(_page,_contract,{signal})=>{received=signal;started.resolve();return new Promise(()=>{});};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:30});
 const pending=c.setEnabled(true,{page});await started.promise;
 assert.equal((await within(c.pageChanged())).status,'off');assert.equal(received.aborted,true);await within(pending);assert.equal(h.calls.apply,0);
});

test('verification timeout aborts the adapter and late proof never applies',async()=>{
 const h=setup(),verification=deferred();let received;
 h.adapter.verify=(_page,_contract,{signal})=>{received=signal;return verification.promise;};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:15});
 assert.equal((await within(c.setEnabled(true,{page}))).status,'unavailable');assert.equal(received.aborted,true);
 verification.resolve({...page,owned:true,contractId:verifiedContract.id});await tick();assert.equal(h.calls.apply,0);await c.dispose();
 assert.equal(new FocusModeController().operationTimeoutMs,8000);assert.equal(new FocusModeController({operationTimeoutMs:Infinity}).operationTimeoutMs,8000);assert.equal(new FocusModeController({operationTimeoutMs:20000}).operationTimeoutMs,8000);
});

test('new toggle cancels an old verification and stale failure cannot overwrite the latest owned page',async()=>{
 const h=setup(),old=deferred(),started=deferred(),applied=[];let oldSignal;
 h.adapter.verify=(snapshot,contract,{signal})=>{if(snapshot.id===page.id){oldSignal=signal;started.resolve();return old.promise;}return Promise.resolve({...snapshot,owned:true,contractId:contract.id});};
 h.adapter.apply=async proof=>{applied.push(proof.id);return{restore:async()=>{h.calls.restore++;}};};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:30});
 const first=c.setEnabled(true,{page});await started.promise;
 const next={...page,id:'next-owned',documentId:'next-document',frameId:'next-frame',url:'https://www.tensortonic.com/problems/next?studyPlan=p'};
 assert.equal((await within(c.setEnabled(true,{page:next}))).status,'applied');await first;assert.equal(oldSignal.aborted,true);
 old.reject(Error('late old verification failure'));await tick();assert.deepEqual(applied,['next-owned']);assert.equal(c.state.status,'applied');await c.dispose();
});

test('caller cancellation also aborts hung verification through the internal signal',async()=>{
 const h=setup(),started=deferred(),external=new AbortController();let received;
 h.adapter.verify=(_page,_contract,{signal})=>{received=signal;started.resolve();return new Promise(()=>{});};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:30}),pending=c.setEnabled(true,{page,signal:external.signal});await started.promise;
 assert.notEqual(received,external.signal);external.abort();assert.equal((await within(pending)).status,'unavailable');assert.equal(received.aborted,true);await c.dispose();
});

test('timed-out apply blocks reapplication and its late lease is cleaned even after dispose',async()=>{
 const h=setup(),application=deferred(),started=deferred();let received;
 h.adapter.apply=(_proof,_contract,{signal})=>{h.calls.apply++;received=signal;started.resolve();return application.promise;};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:15}),pending=c.setEnabled(true,{page});await started.promise;
 assert.equal((await within(pending)).status,'restore-pending');assert.equal(received.aborted,true);
 assert.equal((await within(c.setEnabled(true,{page}))).status,'restore-pending');assert.equal(h.calls.apply,1);
 assert.equal((await within(c.dispose())).status,'restore-pending');
 application.resolve({restore:async()=>{h.calls.restore++;}});await tick();await tick();
 assert.equal(h.calls.restore,1);assert.deepEqual(c.state,{enabled:false,status:'off',applied:false});assert.equal((await c.setEnabled(true,{page})).status,'off');
});

test('RESTORE_PENDING error lease stays owned until an explicit successful cleanup retry',async()=>{
 const h=setup();let fail=true;
 const lease={restore:async()=>{h.calls.restore++;if(fail)throw Error('synthetic restore failure');}};
 h.adapter.apply=async()=>{const error=Error('adapter cleanup incomplete');error.code='RESTORE_PENDING';error.lease=lease;throw error;};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:30});
 assert.equal((await c.setEnabled(true,{page})).status,'restore-pending');assert.equal(c.lease,lease);assert.equal(c.state.applied,true);assert.equal(h.calls.restore,0);
 assert.equal((await c.pageChanged()).status,'restore-pending');assert.equal(c.lease,lease);fail=false;
 assert.equal((await c.setEnabled(false)).status,'off');assert.equal(h.calls.restore,2);assert.equal(c.lease,undefined);
});

test('a late apply rejection carrying a lease is retained rather than silently discarded',async()=>{
 const h=setup(),application=deferred();h.adapter.apply=()=>application.promise;
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:15});
 assert.equal((await within(c.setEnabled(true,{page}))).status,'restore-pending');await c.pageChanged();
 const lease={restore:async()=>{h.calls.restore++;}},error=Error('late cleanup incomplete');error.code='RESTORE_PENDING';error.lease=lease;application.reject(error);await tick();
 assert.equal(c.state.status,'restore-pending');assert.equal(c.lease,lease);assert.equal(h.calls.restore,0);
 assert.equal((await c.setEnabled(false)).status,'off');assert.equal(h.calls.restore,1);
});

test('failed restoration of a late successful apply keeps its lease for an explicit retry',async()=>{
 const h=setup(),application=deferred(),started=deferred();let fail=true;
 h.adapter.apply=()=>{started.resolve();return application.promise;};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:30}),pending=c.setEnabled(true,{page});await started.promise;
 assert.equal((await within(c.pageChanged())).status,'restore-pending');await pending;
 const lease={restore:async()=>{h.calls.restore++;if(fail)throw Error('late restore failed');}};
 application.resolve(lease);await tick();await tick();
 assert.equal(c.lease,lease);assert.equal(c.state.status,'restore-pending');assert.equal(c.state.applied,true);assert.equal(h.calls.restore,1);
 fail=false;assert.equal((await c.setEnabled(false)).status,'off');assert.equal(h.calls.restore,2);assert.equal(c.lease,undefined);
});

test('hung restore is bounded, retained, and shared with retries until late cleanup succeeds',async()=>{
 const h=setup(),restoration=deferred();let received;
 h.adapter.apply=async()=>({restore:({signal})=>{h.calls.restore++;received=signal;return restoration.promise;}});
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:15});await c.setEnabled(true,{page});
 assert.equal((await within(c.pageChanged())).status,'restore-pending');assert.equal(received.aborted,true);assert.equal(c.state.applied,true);
 assert.equal((await within(c.setEnabled(false))).status,'restore-pending');assert.equal(h.calls.restore,1);
 restoration.resolve();await tick();assert.deepEqual(c.state,{enabled:false,status:'off',applied:false});assert.equal((await c.dispose()).status,'off');
});

test('status observers receive pending, applied and navigation reset states without controlling the adapter',async()=>{
 const h=setup(),events=[],gate=deferred();h.adapter.verify=async p=>{await gate.promise;return{...p,owned:true,contractId:verifiedContract.id};};
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,onChange:value=>events.push(value)}),pending=c.setEnabled(true,{page});
 assert.equal(events[0].busy,true);assert.equal(events[0].applied,false);gate.resolve();await pending;
 assert.deepEqual(events.at(-1),{enabled:true,status:'applied',applied:true,busy:false});
 await c.pageChanged();assert.deepEqual(events.at(-1),{enabled:false,status:'off',applied:false,busy:false});assert.equal(h.calls.apply,1);assert.equal(h.calls.restore,1);
});

test('late cleanup completion updates status observers and broken observers cannot prevent restoration',async()=>{
 const h=setup(),gate=deferred(),events=[];h.adapter.apply=async()=>({restore:()=>gate.promise});
 const c=new FocusModeController({adapter:h.adapter,verifiedContract,operationTimeoutMs:15,onChange:value=>{events.push(value);throw Error('synthetic UI listener');}});
 await c.setEnabled(true,{page});assert.equal((await within(c.setEnabled(false))).status,'restore-pending');assert.equal(events.at(-1).status,'restore-pending');
 gate.resolve();await tick();await tick();assert.deepEqual(events.at(-1),{enabled:false,status:'off',applied:false,busy:false});await c.dispose();
});
