'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SessionVault}=require('../src/session/vault');const {SessionHttpTransport}=require('../src/session/http');const {SessionBridge}=require('../src/session-bridge');
const {fixture,scope,memorySecrets,ORIGIN,routePolicy}=require('./fixtures/session');
const vscode={workspace:{isTrusted:true},env:{uiKind:1}};
async function setup(t,{providerTimeoutMs=60}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-session-fence-'));const server=await fixture();const secrets=memorySecrets();
  const vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me',providerTimeoutMs});
  t.after(async()=>{await vault.waitForCleanup().catch(()=>{});await server.close();await fs.rm(directory,{recursive:true,force:true});});
  const expectedEpoch=await vault.captureAcquisitionFence();const captured=await server.login();await vault.importCookies(captured.cookies,{sourceURL:captured.sourceURL,confirmed:true,expectedEpoch});
  const transport=new SessionHttpTransport(vault,{routePolicy,dispatch:server.dispatch});return{directory,server,secrets,vault,transport};
}
test('shared revocation epoch prevents a different window from importing an acquisition begun before Clear',async t=>{
  const h=await setup(t);await h.vault.clear();let resolve,closed=0;
  const other=new SessionVault(h.secrets,{scope:scope(),directory:h.directory,authURL:ORIGIN+'/me'});
  const a=new SessionBridge(vscode,{}, {vault:h.vault,transport:h.transport,acquire:()=>new Promise(r=>{resolve=r;})});
  const pending=a.start({confirmed:true});pending.catch(()=>{});
  const end=Date.now()+1000;while(!resolve&&Date.now()<end)await new Promise(r=>setTimeout(r,1));assert.ok(resolve);
  await other.clear();const captured=await h.server.login();resolve({...captured,close:async()=>{closed++;}});
  await assert.rejects(pending,{code:'CANCELED'});assert.equal(closed,1);assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);
});
test('an import without a pre-acquisition shared fence is rejected',async t=>{
  const h=await setup(t);const captured=await h.server.login();await assert.rejects(h.vault.importCookies(captured.cookies,{sourceURL:captured.sourceURL,confirmed:true}),{code:'ACQUISITION_FENCE_REQUIRED'});
});
test('request deadline bounds a hung secure get and releases the mutex for local clear',async t=>{
  const h=await setup(t,{providerTimeoutMs:1000});h.secrets.get=()=>new Promise(()=>{});
  const transport=new SessionHttpTransport(h.vault,{routePolicy,dispatch:h.server.dispatch,timeoutMs:25});const start=performance.now();
  await assert.rejects(transport.request('/me'),{code:'TIMEOUT'});assert.ok(performance.now()-start<700);
  const cleanup=await h.vault.clear();assert.equal(cleanup.activeCredentialCleared,true);assert.equal(cleanup.credentialsDeleted,true);assert.equal(await h.vault.ready(),false);assert.equal(h.server.counts['/me']||0,0);
});
test('cancellation bounds a hung get without leaving the mutex locked',async t=>{
  const h=await setup(t,{providerTimeoutMs:1000});let called=false;h.secrets.get=()=>{called=true;return new Promise(()=>{});};
  const controller=new AbortController();const pending=h.transport.request('/me',{signal:controller.signal});pending.catch(()=>{});
  const end=Date.now()+1000;while(!called&&Date.now()<end)await new Promise(r=>setTimeout(r,1));assert.ok(called);controller.abort();
  await assert.rejects(pending,{code:'CANCELED'});assert.equal((await h.vault.clear()).activeCredentialCleared,true);assert.equal(await h.vault.ready(),false);
});
test('hung delete commits local revocation first and reports incomplete cleanup until deletion settles',async t=>{
  const h=await setup(t);const bridge=new SessionBridge(vscode,{}, {vault:h.vault,transport:h.transport});await bridge.start();
  let finish;h.secrets.delete=key=>new Promise(resolve=>{finish=()=>{h.secrets.data.delete(key);resolve();};});
  const start=performance.now();let error;try{await bridge.revoke();}catch(e){error=e;}
  assert.equal(error?.code,'STORAGE_CLEANUP_PENDING');assert.ok(performance.now()-start<700);assert.equal(error.cleanup.credentials.activeCredentialCleared,true);assert.equal(error.cleanup.credentials.credentialsDeleted,false);assert.equal(await h.vault.ready(),false);
  finish();await h.vault.waitForCleanup();assert.equal(h.secrets.data.size,0);assert.equal(h.vault.cleanupPending,false);
});
test('optional display close failure cannot prevent credential revocation',async t=>{
  const h=await setup(t);const display={async stop(){const e=new Error('Synthetic owned display close failed');e.code='CLEANUP_PENDING';throw e;}};
  const bridge=new SessionBridge(vscode,{}, {vault:h.vault,transport:h.transport,display});await bridge.start();const calls=h.server.requests.length;
  let error;try{await bridge.revoke();}catch(e){error=e;}
  assert.equal(error?.code,'DISPLAY_CLEANUP_PENDING');assert.equal(error.cleanup.credentials.activeCredentialCleared,true);assert.equal(error.cleanup.credentials.credentialsDeleted,true);assert.equal(error.cleanup.presentation.closed,false);assert.equal(bridge.cleanupPending,true);assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);assert.equal(h.server.requests.length,calls);
  display.stop=async()=>{};await bridge.stop();assert.equal(bridge.cleanupPending,false);
});
test('revocation reports storage and presentation failures independently and attempts both',async t=>{
  const h=await setup(t);let clearCalls=0,stopCalls=0;
  const vault={captureAcquisitionFence:()=>h.vault.captureAcquisitionFence(),ready:()=>h.vault.ready(),assertAcquisitionFence:epoch=>h.vault.assertAcquisitionFence(epoch),clear:async()=>{clearCalls++;throw new Error('Synthetic storage unavailable');}};
  const display={async stop(){stopCalls++;throw new Error('Synthetic display unavailable');}};
  const bridge=new SessionBridge(vscode,{}, {vault,transport:h.transport,display});await bridge.start();
  let error;try{await bridge.revoke();}catch(e){error=e;}
  assert.equal(clearCalls,1);assert.equal(stopCalls,1);assert.equal(error?.code,'STORAGE_UNAVAILABLE');assert.equal(error.cleanup.credentials.activeCredentialCleared,false);assert.equal(error.cleanup.presentation.closed,false);assert.equal(bridge.connected,false);assert.equal(await h.vault.ready(),true);
  await h.vault.clear();
});
test('controlled in-flight rotation completes before queued Clear and cannot revive the cleared jar',async t=>{
  const h=await setup(t);let release,entered;
  const held=new Promise(r=>{entered=r;});const gate=new Promise(r=>{release=r;});
  const dispatch=async options=>{const response=await h.server.dispatch(options);if(options.url.pathname==='/rotate'){entered();await gate;}return response;};
  const transport=new SessionHttpTransport(h.vault,{routePolicy,dispatch});const rotation=transport.request('/rotate');await held;
  const clear=h.vault.clear();release();await rotation;assert.equal((await clear).credentialsDeleted,true);assert.equal(await h.vault.ready(),false);assert.equal(h.secrets.data.size,0);
});
