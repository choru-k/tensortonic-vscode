'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {SessionVault,SECRET_KEY}=require('../src/session/vault');
const {SessionHttpTransport,tensorTonicRoute}=require('../src/session/http');
const {SessionBridge}=require('../src/session-bridge');
const {fixture,scope,memorySecrets,ORIGIN,routePolicy,postContract}=require('./fixtures/session');
async function setup(t,options={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-session-unit-'));
  const server=await fixture();t.after(async()=>{await vault?.waitForCleanup().catch(()=>{});await server.close();await fs.rm(directory,{recursive:true,force:true});});
  const secrets=memorySecrets(),vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me',...options});
  const transport=new SessionHttpTransport(vault,{routePolicy,dispatch:server.dispatch,postContract,...options.transport});
  const expectedEpoch=await vault.captureAcquisitionFence();const captured=await server.login();await vault.importCookies(captured.cookies,{sourceURL:captured.sourceURL,confirmed:true,expectedEpoch});
  return{directory,server,secrets,vault,transport,captured};
}
test('login imports synthetic HttpOnly cookies into SecretStorage and reconstructed transport works after browser/CDP close',async t=>{
  const h=await setup(t);let browserClosed=false,cdpClosed=false;
  const browser={close(){browserClosed=true;}},cdp={close(){cdpClosed=true;}};cdp.close();browser.close();
  const vault=new SessionVault(h.secrets,{scope:scope(),directory:h.directory,authURL:ORIGIN+'/me'});
  const transport=new SessionHttpTransport(vault,{routePolicy,dispatch:h.server.dispatch});
  const result=await transport.request('/me');assert.ok(result.authenticated===true&&browserClosed&&cdpClosed);
  assert.ok([...h.secrets.data.keys()].some(k=>k.startsWith(SECRET_KEY+'.')));
  for(const filename of await fs.readdir(h.directory)){const content=await fs.readFile(path.join(h.directory,filename));assert.equal(h.captured.cookies.some(c=>content.includes(Buffer.from(c.value))),false,'No credential in coordination files');}
});
test('rotation is persisted before the next window sends a request',async t=>{
  const h=await setup(t);const vault2=new SessionVault(h.secrets,{scope:scope(),directory:h.directory,authURL:ORIGIN+'/me'});const second=new SessionHttpTransport(vault2,{routePolicy,dispatch:h.server.dispatch});
  await h.transport.request('/rotate');assert.equal((await second.request('/me')).authenticated,true);
});
test('deletion and server revocation invalidate local storage and never replay authentication',async t=>{
  const h=await setup(t);await assert.rejects(h.transport.request('/delete'),{code:'AUTH_REQUIRED'});assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);
  const expectedEpoch=await h.vault.captureAcquisitionFence();const next=await h.server.login();await h.vault.importCookies(next.cookies,{sourceURL:next.sourceURL,confirmed:true,expectedEpoch});h.server.revoke();
  await assert.rejects(h.transport.request('/me'),{code:'AUTH_REQUIRED'});assert.equal(await h.vault.ready(),false);assert.equal(h.server.counts['/me'],1);
});
test('expiry denies dispatch and clears the saved session',async t=>{
  let now=Date.now();const h=await setup(t,{now:()=>now});now+=61000;
  await assert.rejects(h.transport.request('/me'),{code:'AUTH_REQUIRED'});assert.equal(h.server.counts['/me']||0,0);assert.equal(h.secrets.data.size,0);
});
test('redirects are not followed and no request reaches an external destination',async t=>{
  const h=await setup(t);await assert.rejects(h.transport.request('/redirect'),{code:'REDIRECT_REFUSED'});assert.equal(h.server.counts['/redirect'],1);assert.equal(h.server.requests.length,2);
});
test('unapproved paths/HTTP origins and caller-controlled headers cannot obtain a cookie',async t=>{
  const h=await setup(t);
  for(const route of ['/account','https://external.invalid/me'])await assert.rejects(h.transport.request(route),{code:'UNSUPPORTED'});
  await assert.rejects(h.transport.request('/me',{headers:{Cookie:'injected'}}),{code:'UNSUPPORTED'});
  const insecure=new SessionHttpTransport(h.vault,{routePolicy:()=>new URL('http://api.session-test.invalid/me'),dispatch:h.server.dispatch});await assert.rejects(insecure.request('/me'),{code:'UNSUPPORTED'});
  assert.equal(h.server.counts['/me']||0,0);
});
test('production routes exclude fake endpoints and real POST is disabled without reviewed CSRF contract',async t=>{
  for(const route of ['/me','/login','/api/account','/api/auth/sign-out','/api/../me','https://external.invalid/api/me'])assert.throws(()=>tensorTonicRoute(route,'GET'),{code:'UNSUPPORTED'});
  assert.equal(tensorTonicRoute('/api/me','GET').origin,'https://api.tensortonic.com');
  const h=await setup(t);const transport=new SessionHttpTransport(h.vault,{routePolicy,dispatch:h.server.dispatch});await assert.rejects(transport.request('/post',{method:'POST',body:{synthetic:true}}),{code:'POST_CONTRACT_UNVERIFIED'});assert.equal(h.server.posts,0);
});
test('server POST origin/CSRF denial is surfaced without retry or cookie weakening',async t=>{
  const h=await setup(t);const transport=new SessionHttpTransport(h.vault,{routePolicy,dispatch:h.server.dispatch,postContract:()=>({Origin:'https://wrong.invalid','X-CSRF-Token':'synthetic-csrf'})});
  await assert.rejects(transport.request('/post',{method:'POST',body:{synthetic:true}}),{code:'HTTP_ERROR',status:403});assert.equal(h.server.posts,1);assert.equal(await h.vault.ready(),true);
});
test('pre-dispatch cancellation sends nothing; ambiguous POST disconnect is never retried',async t=>{
  const h=await setup(t);const c=new AbortController();c.abort();await assert.rejects(h.transport.request('/post',{method:'POST',body:{synthetic:true},signal:c.signal}),{code:'CANCELED'});assert.equal(h.server.posts,0);
  await assert.rejects(h.transport.request('/drop-post',{method:'POST',body:{synthetic:true}}),{code:'UNCERTAIN_RESULT'});assert.equal(h.server.posts,1);
});
test('cancel after POST dispatch and timeout preserve ambiguous outcomes without replay',async t=>{
  const h=await setup(t);const c=new AbortController();const p=h.transport.request('/hang-post',{method:'POST',body:{synthetic:true},signal:c.signal});p.catch(()=>{});
  const deadline=Date.now()+2000;while(!h.server.posts&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.ok(h.server.posts>0);c.abort();await assert.rejects(p,{code:'UNCERTAIN_RESULT'});assert.equal(h.server.posts,1);
  const short=new SessionHttpTransport(h.vault,{routePolicy,dispatch:h.server.dispatch,postContract,timeoutMs:30});await assert.rejects(short.request('/hang-post',{method:'POST',body:{synthetic:true}}),{code:'UNCERTAIN_RESULT'});assert.equal(h.server.posts,2);
});
test('concurrent windows serialize rotating requests and logout cannot be overwritten',async t=>{
  const h=await setup(t);const other=new SessionVault(h.secrets,{scope:scope(),directory:h.directory,authURL:ORIGIN+'/me'});const second=new SessionHttpTransport(other,{routePolicy,dispatch:h.server.dispatch});
  await Promise.all([h.transport.request('/rotate'),second.request('/rotate'),h.transport.request('/me')]);
  const outcomes=await Promise.allSettled([h.transport.request('/rotate'),other.clear()]);
  assert.ok(outcomes[0].status==='fulfilled'||outcomes[0].reason?.code==='AUTH_REQUIRED');assert.equal(outcomes[1].status,'fulfilled');
  assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);
});
test('failed secure-storage rotation leaves a durable nonsecret invalidation marker',async t=>{
  const h=await setup(t);h.secrets.store=async()=>{throw Error('synthetic provider failure');};
  await assert.rejects(h.transport.request('/rotate'),{code:'STORAGE_UNAVAILABLE'});assert.equal(await h.vault.ready(),false);
  const index=JSON.parse(await fs.readFile(path.join(h.directory,'session-index.json'),'utf8'));assert.equal(index.activeKey,null);
});
test('local clear has no server logout side effect and invalidation survives deletion failure',async t=>{
  const h=await setup(t);const before=h.server.requests.length;h.secrets.delete=async()=>{throw Error('synthetic deletion failure');};const cleanup=await h.vault.clear();assert.equal(cleanup.activeCredentialCleared,true);assert.equal(cleanup.credentialsDeleted,false);assert.equal(await h.vault.ready(),false);assert.equal(h.server.requests.length,before);
});
test('rotation deletion failure reports a committed active session separately from revocation cleanup',async t=>{
  const h=await setup(t);const original=h.secrets.delete.bind(h.secrets);h.secrets.delete=async()=>{throw Error('synthetic retired-key deletion failure');};
  const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault:h.vault,transport:h.transport});await bridge.start();
  let error;try{await bridge.request('/rotate');}catch(e){error=e;}
  assert.equal(error?.code,'ROTATION_CLEANUP_PENDING');assert.match(error.message,/newer saved session is active/);assert.doesNotMatch(error.message,/session is cleared/);
  assert.equal(error.cleanup.activeSessionCommitted,true);assert.equal(error.cleanup.activeCredentialCleared,false);assert.ok(error.cleanup.pendingDeleteCount>0);
  assert.equal(bridge.connected,true);assert.equal(await h.vault.ready(),true);assert.ok(JSON.parse(await fs.readFile(path.join(h.directory,'session-index.json'),'utf8')).activeKey);
  const other=new SessionVault(h.secrets,{scope:scope(),directory:h.directory,authURL:ORIGIN+'/me'});
  assert.equal((await new SessionHttpTransport(other,{routePolicy,dispatch:h.server.dispatch}).request('/me')).authenticated,true);
  h.secrets.delete=original;assert.equal((await h.vault.clear()).credentialsDeleted,true);assert.equal(await h.vault.ready(),false);
});
test('invalid/oversized response errors do not echo credentials or response content',async t=>{
  const h=await setup(t);for(const route of ['/invalid-json','/large']){
    const transport=new SessionHttpTransport(h.vault,{routePolicy,dispatch:h.server.dispatch,maxBytes:10000});
    let error;try{await transport.request(route);}catch(e){error=e;}
    assert.ok(error);assert.equal(h.captured.cookies.some(c=>String(error.stack).includes(c.value)),false);
  }
});
test('session ownership is independent of display tabs and clear does not perform server logout',async t=>{
  const h=await setup(t);let displayClosed=false;const display={async openProblemPage(){return{requested:true,target:'native-owned'};},async stop(){displayClosed=true;},async dispose(){}};
  const vscode={workspace:{isTrusted:true},env:{uiKind:1}};
  const bridge=new SessionBridge(vscode,{}, {vault:h.vault,transport:h.transport,display});await bridge.start();await bridge.openProblemPage('https://www.tensortonic.com/problems/synthetic');await display.stop();assert.ok(bridge.connected&&displayClosed);assert.equal((await bridge.request('/me')).authenticated,true);
  await bridge.stop();const again=new SessionBridge(vscode,{}, {vault:h.vault,transport:h.transport});await again.start();assert.equal((await again.request('/me')).authenticated,true);await again.revoke();assert.equal(await h.vault.ready(),false);
});
test('real acquisition fails closed before any stored credentials or browser access',async()=>{
  let calls=0;const vscode={workspace:{isTrusted:true},env:{uiKind:1},window:{openBrowserTab(){calls++;}}};
  await assert.rejects(new SessionBridge(vscode,{}).start({confirmed:true}),{code:'SESSION_SCOPE_UNVERIFIED'});assert.equal(calls,0);
});
test('a late provider completion cannot replace a newer active generation and local clear reports uncertainty',async t=>{
  const h=await setup(t,{providerTimeoutMs:60});const store=h.secrets.store.bind(h.secrets);let late;
  h.secrets.store=(key,value)=>new Promise(resolve=>{late=()=>{h.secrets.data.set(key,value);resolve();};});
  await assert.rejects(h.transport.request('/rotate'),{code:'STORAGE_TIMEOUT'});assert.equal(await h.vault.ready(),false);
  h.secrets.store=store;const expectedEpoch=await h.vault.captureAcquisitionFence();const next=await h.server.login();await h.vault.importCookies(next.cookies,{sourceURL:next.sourceURL,confirmed:true,expectedEpoch});
  const before=JSON.parse(await fs.readFile(path.join(h.directory,'session-index.json'),'utf8')).activeKey;
  assert.equal((await h.transport.request('/me')).authenticated,true);
  const after=JSON.parse(await fs.readFile(path.join(h.directory,'session-index.json'),'utf8')).activeKey;assert.equal(before,after);
  const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault:h.vault,transport:h.transport});await bridge.start();
  await assert.rejects(bridge.revoke(),{code:'STORAGE_CLEANUP_PENDING'});assert.equal(bridge.connected,false);assert.equal(await h.vault.ready(),false);assert.equal(bridge.cleanupPending,true);
  late();await h.vault.waitForCleanup();assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);assert.equal(h.vault.cleanupPending,false);
});
test('canceling acquisition before it returns closes the stand-in and never imports a late session',async t=>{
  const h=await setup(t);await h.vault.clear();let resolve;let closed=0;
  const captured=await h.server.login();const acquire=()=>new Promise(r=>{resolve=r;});
  const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault:h.vault,transport:h.transport,acquire});
  const pending=bridge.start({confirmed:true});pending.catch(()=>{});while(!resolve)await new Promise(r=>setTimeout(r,1));
  await bridge.stop();resolve({...captured,close:async()=>{closed++;}});await assert.rejects(pending,{code:'CANCELED'});assert.equal(closed,1);assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);
});
