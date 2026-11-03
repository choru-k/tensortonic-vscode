'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createSessionBridge,verifiedScope,verifiedPlan,SESSION_NAME,AUTH_URL}=require('../src/session/tensortonic');
const {SessionVault}=require('../src/session/vault');const {CookieJar}=require('../src/session/cookie-jar');
const {ownedReturnURL}=require('../src/session/acquisition');const {memorySecrets}=require('./fixtures/session');
const cookie=()=>({name:SESSION_NAME,value:'synthetic-production-policy-only',domain:'tensortonic.com',path:'/',hostOnly:false,secure:true,httpOnly:true,sameSite:'Lax',persistent:true,expiresAt:Date.now()+3600000,created:0});
async function setup(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-production-session-'));const secrets=memorySecrets(),counts={browser:0,consent:0,http:0};t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const vscode={workspace:{isTrusted:true},env:{uiKind:1},window:{async openBrowserTab(){counts.browser++;throw Error('Synthetic browser must not be opened in restore tests');},async showInformationMessage(){counts.consent++;return undefined;}}};
 const context={globalStorageUri:{fsPath:directory},secrets};const bridge=createSessionBridge(vscode,context);
 const respond=(body,status=200,setCookie=[])=>{bridge.transport.dispatch=async options=>{counts.http++;options.onDispatch();return{status,body:Buffer.from(JSON.stringify(body)),setCookie};};};
 const seed=async()=>{const epoch=await bridge.vault.captureAcquisitionFence();await bridge.vault.importCookies([cookie()],{sourceURL:AUTH_URL,confirmed:true,expectedEpoch:epoch});};
 t.after(()=>bridge.dispose());return{directory,secrets,counts,vscode,context,bridge,respond,seed};
}
test('production policy fixes the observed minimum cookie and API host with server-controlled expiry',()=>{
 const scope=verifiedScope();assert.deepEqual(scope.names,[SESSION_NAME]);assert.deepEqual(scope.hosts,['api.tensortonic.com']);assert.deepEqual(scope.domains,['tensortonic.com']);assert.deepEqual(scope.attributes,{path:'/',hostOnly:false,secure:true,httpOnly:true,sameSite:'Lax'});assert.equal(scope.retention,'server');assert.equal(scope.maxLocalAgeMs,null);
 const plan=verifiedPlan();assert.deepEqual(plan.sources,[{url:AUTH_URL,names:[SESSION_NAME]}]);assert.equal(ownedReturnURL(plan,'https://www.tensortonic.com/problems'),'https://www.tensortonic.com/problems');for(const value of ['https://github.com/','https://tensortonic.com/','https://www.tensortonic.com/callback?code=synthetic','https://www.tensortonic.com/#token=synthetic'])assert.equal(ownedReturnURL(plan,value),undefined);
});
test('production cookie attributes reject changed paths, host-only semantics, SameSite, Domain and names',()=>{
 for(const patch of [{path:'/api'},{hostOnly:true},{sameSite:'None'},{domain:'api.tensortonic.com'},{name:'__Secure-better-auth.state'},{secure:false},{httpOnly:false}])assert.throws(()=>new CookieJar(verifiedScope()).importCookies([{...cookie(),...patch}],AUTH_URL),{code:'COOKIE_POLICY'});
 const jar=new CookieJar(verifiedScope());jar.importCookies([cookie()],AUTH_URL);assert.throws(()=>jar.applySetCookie([SESSION_NAME+'=synthetic-rotation; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Strict'],AUTH_URL),{code:'COOKIE_POLICY'});
});
test('fresh activation restore opens no browser, sends no HTTP and never migrates experiment vaults',async t=>{
 const h=await setup(t);await fs.mkdir(path.join(h.directory,'temporary-real-session-old'),{recursive:true});await fs.writeFile(path.join(h.directory,'temporary-real-session-old/session-index.json'),'untrusted-experiment-marker');
 assert.equal(await h.bridge.restore(),false);assert.equal(h.bridge.supportsGrading,true);assert.equal(path.basename(h.bridge.vault.directory),'saved-session-v1');assert.deepEqual(h.counts,{browser:0,consent:0,http:0});assert.equal(h.secrets.data.size,0);
});
test('reconstructed production bridge restores encrypted session without browser or startup HTTP',async t=>{
 const h=await setup(t);await h.seed();const second=createSessionBridge(h.vscode,h.context);t.after(()=>second.dispose());assert.equal(await second.restore(),true);assert.equal(second.connected,true);assert.deepEqual(h.counts,{browser:0,consent:0,http:0});await second.stop();assert.equal(await h.bridge.vault.ready(),true);await second.revoke();assert.equal(h.secrets.data.size,0);assert.equal(await h.bridge.vault.ready(),false);
});
test('explicit saved-session Connect verifies account over direct HTTPS without opening or recapturing a tab',async t=>{
 const h=await setup(t);await h.seed();h.respond({status:'success',data:{user:{id:'synthetic-account',email:'synthetic@example.invalid'}}});await h.bridge.start({confirmed:true});assert.equal(h.bridge.connected,true);assert.deepEqual(h.counts,{browser:0,consent:0,http:1});
 h.respond({status:'success',data:{synthetic:true}});assert.deepEqual(await h.bridge.request('/api/study-plans/pytorch-basics/problems/synthetic-problem/run',{method:'POST',body:{code:'synthetic',testCases:[]}}),{status:'success',data:{synthetic:true}});assert.equal(h.counts.http,2);assert.equal(h.counts.browser,0);await h.bridge.revoke();
});
test('changed account schema clears locally and never logs or returns identity fields',async t=>{
 const h=await setup(t);await h.seed();h.respond({status:'success',data:{unexpected:'private-response-sentinel'}});let error;try{await h.bridge.start({confirmed:true});}catch(e){error=e;}assert.equal(error.code,'ACCOUNT_SCHEMA_UNVERIFIED');assert.equal(error.stack.includes('private-response-sentinel'),false);assert.equal(await h.bridge.vault.ready(),false);assert.equal(h.secrets.data.size,0);assert.equal(h.bridge.connected,false);
});
test('revoked and expired production sessions disconnect without automatic login or replay',async t=>{
 const h=await setup(t);await h.seed();assert.equal(await h.bridge.restore(),true);h.respond({authenticated:false},401);await assert.rejects(h.bridge.request('/api/me'),{code:'AUTH_REQUIRED'});assert.equal(h.bridge.connected,false);assert.equal(h.secrets.data.size,0);assert.equal(h.counts.browser,0);assert.equal(h.counts.http,1);
 const expired=new SessionVault(h.secrets,{scope:verifiedScope(),directory:h.bridge.vault.directory,authURL:AUTH_URL,now:()=>Date.now()+2*86400000});const epoch=await h.bridge.vault.captureAcquisitionFence();await h.bridge.vault.importCookies([cookie()],{sourceURL:AUTH_URL,confirmed:true,expectedEpoch:epoch});assert.equal(await expired.ready(),false);assert.equal(h.secrets.data.size,0);
});
test('unexpected rotation metadata invalidates the production jar and connection',async t=>{
 const h=await setup(t);await h.seed();await h.bridge.restore();h.respond({status:'success',data:{}},200,[SESSION_NAME+'=synthetic-only; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=None']);await assert.rejects(h.bridge.request('/api/me'),{code:'COOKIE_POLICY'});assert.equal(h.bridge.connected,false);assert.equal(h.secrets.data.size,0);
});
test('untrusted or remote production restoration never reads a secret or opens a browser',async t=>{
 const h=await setup(t);let reads=0;h.secrets.get=async()=>{reads++;throw Error('must not read');};h.vscode.workspace.isTrusted=false;await assert.rejects(h.bridge.restore(),{code:'UNSUPPORTED'});h.vscode.workspace.isTrusted=true;h.vscode.env.remoteName='ssh';await assert.rejects(h.bridge.restore(),{code:'UNSUPPORTED'});assert.equal(reads,0);assert.equal(h.counts.browser,0);
});
test('stored-session diagnostic verification never opens an acquisition UI or imports missing credentials',async t=>{
 const h=await setup(t);await assert.rejects(h.bridge.checkStoredSession(),{code:'AUTH_REQUIRED'});assert.deepEqual(h.counts,{browser:0,consent:0,http:0});await h.seed();h.respond({status:'success',data:{user:{id:'synthetic-id',email:'synthetic@example.invalid'}}});assert.equal(await h.bridge.checkStoredSession(),true);assert.deepEqual(h.counts,{browser:0,consent:0,http:1});await h.bridge.revoke();
});
