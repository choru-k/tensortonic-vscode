'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SessionBridge}=require('../src/session-bridge');
const {createSessionDiagnostic}=require('../src/session/diagnostic');
const {verifiedScope,authenticatedAccount,SESSION_NAME,AUTH_URL}=require('../src/session/tensortonic');
// Exercise real bridge lifecycle methods. Only their external storage, transport
// and owned-display dependencies are synthetic; no network/browser is opened.
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-diagnostic-lifecycle-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const key='tensortonic.http-session.v1.00000000-0000-0000-0000-000000000000';
 const index=path.join(directory,'session-index.json');await fs.writeFile(index,JSON.stringify({version:2,epoch:0,activeKey:key,pending:[]}));
 const encoded=JSON.stringify({version:2,retention:'server',expiresAt:null,cookies:[{name:SESSION_NAME,value:'synthetic-lifecycle-only',domain:'tensortonic.com',path:'/',hostOnly:false,secure:true,httpOnly:true,sameSite:'Lax',persistent:true,expiresAt:Date.now()+60000,created:0}]});
 const calls={clear:0,request:0,open:0,stop:0};
 const vault={directory,index,scope:verifiedScope(),now:Date.now,providerTimeoutMs:1000,cleanupPending:false,secrets:{get:async()=>encoded},captureAcquisitionFence:async()=>0,assertAcquisitionFence:async()=>true,ready:async()=>true,clear:async()=>{calls.clear++;return{activeCredentialCleared:true,credentialsDeleted:true};}};
 let entered,release,wireSignal;const dispatched=new Promise(resolve=>entered=resolve);
 const diagnostic=createSessionDiagnostic(vault,{authenticatedAccount,dispatch:options=>{assert.equal(options.url.href,AUTH_URL);assert.equal(options.method,'GET');options.onDispatch();wireSignal=options.signal;entered();return new Promise(resolve=>release=resolve);}});
 const transport={request:async()=>{calls.request++;return {synthetic:true};}};
 const display={hasOwnedResources:false,cleanupPending:false,openProblemPage:async()=>{calls.open++;return true;},stop:async()=>{calls.stop++;}};
 const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault,transport,display,diagnostic});bridge.connected=true;
 return {bridge,calls,index,dispatched,wireSignal:()=>wireSignal,release:()=>release({status:200,setCookie:[],body:Buffer.from(JSON.stringify({user:{id:'synthetic-id',name:'synthetic-name'}}))})};
}
for(const action of ['start','request','restore','stop','revoke','openProblemPage'])test('real bridge '+action+' interrupts an in-flight diagnostic without a late verification',async t=>{
 const h=await fixture(t);const before=await fs.readFile(h.index,'utf8');
 const diagnostic=h.bridge.diagnoseStoredSession();await h.dispatched;
 assert.equal(h.bridge.pending,true);assert.equal(h.wireSignal().aborted,false);
 const operation=action==='request'?h.bridge.request('/api/me'):action==='openProblemPage'?h.bridge.openProblemPage('https://www.tensortonic.com/problems/synthetic'):h.bridge[action]();
 const result=await diagnostic;
 assert.deepEqual(result,{accountVerified:false,outcome:'CANCELED',requestCount:1});assert.equal(h.wireSignal().aborted,true);assert.equal(h.bridge.pending,false);
 await operation;h.release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await diagnostic,result);assert.equal(await fs.readFile(h.index,'utf8'),before);
 assert.equal(h.calls.clear,action==='revoke'?1:0);assert.equal(h.calls.request,action==='request'?1:0);assert.equal(h.calls.open,action==='openProblemPage'?1:0);assert.equal(h.calls.stop,['stop','revoke'].includes(action)?1:0);
});
