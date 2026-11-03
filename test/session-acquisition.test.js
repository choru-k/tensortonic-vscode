'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {cookieScope}=require('../src/session/cookie-jar');
const {acquisitionPlan,BrowserSessionAcquirer}=require('../src/session/acquisition');
const {ProposedBrowserCookieSource,selectedCDPCookies}=require('../src/session/browser-cookie-source');
const {SessionVault}=require('../src/session/vault');const {SessionBridge}=require('../src/session-bridge');
const {fixture,memorySecrets,ORIGIN}=require('./fixtures/session');
const ENTRY='https://www.session-test.invalid/login',RETURN='https://www.session-test.invalid/return';
const scope=()=>cookieScope({names:['synthetic_session'],hosts:['api.session-test.invalid'],domains:['api.session-test.invalid']});
const plan=()=>acquisitionPlan({scope:scope(),entryURL:ENTRY,returnURLs:[RETURN],authURL:ORIGIN+'/me',sources:[{url:ORIGIN+'/me',names:['synthetic_session']}]});
const cookie=()=>({name:'synthetic_session',value:'fixed-synthetic-only',domain:'api.session-test.invalid',hostOnly:true,path:'/',secure:true,httpOnly:true,sameSite:'Strict',expiresAt:Date.now()+60000,created:0});
function harness(options={}){
 const state={opened:0,reads:0,closed:0,url:RETURN,consents:[]};
 const handle={getURL:()=>state.url,async readCookies(args){state.reads++;state.readArgs=args;return[cookie()];},async close(){state.closed++;}};
 const source={async openOwned(url){state.opened++;assert.equal(url,ENTRY);return handle;}};
 const acquirer=new BrowserSessionAcquirer({plan:plan(),source,confirm:async value=>{state.consents.push(value);return true;},waitForLogin:async()=>true,...options});return{state,handle,source,acquirer};
}
test('acquisition plan requires exact HTTPS origins, per-origin names and complete reviewed scope',()=>{
 const valid={scope:scope(),entryURL:ENTRY,returnURLs:[RETURN],authURL:ORIGIN+'/me',sources:[{url:ORIGIN+'/me',names:['synthetic_session']}]};
 for(const patch of [{entryURL:'http://www.session-test.invalid/login'},{entryURL:ENTRY+'?token=x'},{returnURLs:['https://github.com/return']},{sources:[{url:'https://unapproved.invalid/me',names:['synthetic_session']}]},{sources:[{url:ORIGIN+'/me',names:['unapproved']}]},{sources:[]}])assert.throws(()=>acquisitionPlan({...valid,...patch}),{code:'SESSION_SCOPE_UNVERIFIED'});
 assert.ok(Object.isFrozen(plan().sources[0].names));
});
test('consent is required before opening or reading and exposes scope metadata only',async()=>{
 const h=harness();await assert.rejects(h.acquirer.acquire(),{code:'CONSENT_REQUIRED'});assert.equal(h.state.opened,0);
 const captured=await h.acquirer.acquire({confirmed:true});assert.equal(h.state.opened,1);assert.equal(h.state.reads,1);assert.equal(h.state.consents[0].sources[0].url,ORIGIN+'/me');assert.equal(JSON.stringify(h.state.consents).includes(cookie().value),false);assert.deepEqual(h.state.readArgs.names,['synthetic_session']);await captured.close();assert.equal(h.acquirer.hasOwnedResources,false);assert.equal(captured.batches[0].cookies.length,0);
});
test('declining scoped consent does not open a tab or access cookies',async()=>{
 const h=harness({confirm:async()=>false});await assert.rejects(h.acquirer.acquire({confirmed:true}),{code:'CANCELED'});assert.equal(h.state.opened,0);assert.equal(h.state.reads,0);
});
test('canceled human handoff closes its owned tab without reading cookies',async()=>{
 const h=harness({waitForLogin:async()=>false});await assert.rejects(h.acquirer.acquire({confirmed:true}),{code:'CANCELED'});assert.equal(h.state.closed,1);assert.equal(h.state.reads,0);
});
test('foreign return page and navigation during cookie read refuse import and close the owned tab',async()=>{
 for(const duringRead of [false,true]){
  const h=harness();if(duringRead)h.handle.readCookies=async()=>{h.state.url='https://external.invalid/';return[cookie()];};else h.state.url='https://external.invalid/';
  await assert.rejects(h.acquirer.acquire({confirmed:true}),{code:'ACQUISITION_PAGE_CHANGED'});assert.equal(h.state.closed,1);
 }
});
test('unselected names, unsafe cookie metadata and missing required session fail closed',async()=>{
 for(const cookies of [[{...cookie(),name:'other_cookie'}],[{...cookie(),httpOnly:false}],[{...cookie(),domain:'external.invalid'}],[]]){
  const h=harness();h.handle.readCookies=async()=>cookies;await assert.rejects(h.acquirer.acquire({confirmed:true}),{code:cookies.length?'COOKIE_POLICY':'AUTH_REQUIRED'});assert.equal(h.state.closed,1);
 }
});
test('canceling a late scoped read closes the tab and never returns its cookie',async()=>{
 const h=harness();let finish,entered;const gate=new Promise(r=>{entered=r;});h.handle.readCookies=()=>new Promise(r=>{finish=r;entered();});
 const c=new AbortController();const pending=h.acquirer.acquire({confirmed:true,signal:c.signal});pending.catch(()=>{});await gate;c.abort();await assert.rejects(pending,{code:'CANCELED'});finish([cookie()]);assert.equal(h.state.closed,1);assert.equal(h.acquirer.hasOwnedResources,false);
});
test('a timed-out late tab remains owned and is closed when the opener settles',async()=>{
 let resolve;const h=harness({timeoutMs:15,source:{openOwned:()=>new Promise(r=>{resolve=r;})}});await assert.rejects(h.acquirer.acquire({confirmed:true}),{code:'TIMEOUT'});assert.equal(h.acquirer.hasOwnedResources,true);resolve(h.handle);await Promise.allSettled([...h.acquirer.background]);assert.equal(h.state.closed,1);assert.equal(h.acquirer.hasOwnedResources,false);
});
test('failed browser cleanup remains visible and an explicit cleanup retry can complete',async()=>{
 const h=harness();const captured=await h.acquirer.acquire({confirmed:true});h.handle.close=async()=>{throw Error('synthetic');};await assert.rejects(captured.close());assert.equal(h.acquirer.cleanupPending,true);h.handle.close=async()=>{h.state.closed++;};await h.acquirer.close();assert.equal(h.acquirer.cleanupPending,false);
});
test('shared Clear fences batches captured by the new adapter before atomic import',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-acquire-fence-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const secrets=memorySecrets(),vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});const h=harness();let release,entered;const gate=new Promise(r=>{entered=r;});
 h.handle.readCookies=()=>new Promise(r=>{release=r;entered();});const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {},{vault,transport:{},acquire:options=>h.acquirer.acquire(options)});
 const pending=bridge.start({confirmed:true});pending.catch(()=>{});await gate;await new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'}).clear();release([cookie()]);await assert.rejects(pending,{code:'CANCELED'});assert.equal(await vault.ready(),false);assert.equal(h.state.closed,1);assert.equal(secrets.data.size,0);
});
test('batch import is atomic when a later origin returns invalid metadata',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-acquire-atomic-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const secrets=memorySecrets(),vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});const epoch=await vault.captureAcquisitionFence();
 await assert.rejects(vault.importCookieBatches([{sourceURL:ORIGIN+'/me',cookies:[cookie()]},{sourceURL:'https://foreign.invalid/me',cookies:[cookie()]}],{confirmed:true,expectedEpoch:epoch}),{code:'UNSUPPORTED'});assert.equal(secrets.data.size,0);assert.equal(await vault.ready(),false);
});
test('CDP cookie normalization filters unrelated names and rejects partitioned selected cookies',()=>{
 const raw={...cookie(),domain:'.session-test.invalid',expires:(Date.now()+60000)/1000,session:false};delete raw.hostOnly;delete raw.expiresAt;
 const selected=selectedCDPCookies({cookies:[{...raw,name:'analytics',value:'unrelated'},raw]},['synthetic_session']);assert.equal(selected.length,1);assert.equal(selected[0].hostOnly,false);assert.equal(selected[0].domain,'session-test.invalid');
 assert.throws(()=>selectedCDPCookies({cookies:[{...raw,partitionKey:{topLevelSite:ORIGIN}}]},['synthetic_session']),{code:'COOKIE_POLICY'});
});
function cdpHarness(){
 const calls=[];let receive,closed=false,tabClosed=false;
 const group={onDidReceiveMessage(fn){receive=fn;return{dispose(){}};},onDidClose(){return{dispose(){}};},async sendMessage(message){calls.push(message);let result={};
  if(message.method==='Target.setAutoAttach'&&message.params.autoAttach)receive({method:'Target.attachedToTarget',params:{sessionId:'owned',targetInfo:{type:'page',vscodeBrowserViewId:'owned'}}});
  if(message.method==='Page.getFrameTree')result={frameTree:{frame:{id:'top',url:RETURN}}};
  if(message.method==='Network.getCookies')result={cookies:[{name:'analytics',value:'not-exported'},{...cookie(),domain:'api.session-test.invalid',session:false,expires:(Date.now()+60000)/1000}]};
  receive({id:message.id,...(message.sessionId?{sessionId:message.sessionId}:{}),result});},async close(){closed=true;}};
 const tab={url:RETURN,async startCDPSession(){return group;},async close(){tabClosed=true;}};
 const vscode={workspace:{isTrusted:true},env:{uiKind:1},window:{async openBrowserTab(){return tab;}}};const source=new ProposedBrowserCookieSource(vscode,{plan:plan()});return{source,tab,calls,get closed(){return closed&&tabClosed;}};
}
test('proposed source targets only its owned page and issues one explicit URL cookie request',async()=>{
 const h=cdpHarness(),handle=await h.source.openOwned(ENTRY);const cookies=await handle.readCookies({url:ORIGIN+'/me',names:['synthetic_session']});assert.equal(cookies.length,1);assert.equal(cookies[0].httpOnly,true);
 assert.deepEqual(h.calls.filter(c=>c.method==='Network.getCookies').map(c=>({session:c.sessionId,urls:c.params.urls})),[{session:'owned',urls:[ORIGIN+'/me']}]);
 for(const method of ['Storage.getCookies','Network.getAllCookies','Network.enable','Runtime.evaluate'])assert.equal(h.calls.some(c=>c.method===method),false);
 await assert.rejects(handle.readCookies({url:'https://github.com/',names:['synthetic_session']}),{code:'UNSUPPORTED'});await handle.close();assert.equal(h.closed,true);assert.equal(h.source.hasOwnedResources,false);
});
test('source cannot be opened from untrusted or remote hosts',async()=>{
 let calls=0;for(const v of [{workspace:{isTrusted:false}},{workspace:{isTrusted:true},env:{remoteName:'ssh'}}]){
  const source=new ProposedBrowserCookieSource({...v,window:{openBrowserTab(){calls++;}}},{plan:plan()});await assert.rejects(source.openOwned(ENTRY),{code:'SESSION_SCOPE_UNVERIFIED'});
 }assert.equal(calls,0);
});
test('raw provider codes cannot leak through a simultaneous acquisition/cleanup failure',async()=>{
 const h=harness();h.handle.readCookies=async()=>{const e=new Error(cookie().value);e.code=cookie().value;throw e;};h.handle.close=async()=>{throw Error(cookie().value);};
 let error;try{await h.acquirer.acquire({confirmed:true});}catch(e){error=e;}assert.equal(error.code,'ACQUISITION_CLEANUP_PENDING');assert.equal(error.causeCode,'ACQUISITION_FAILED');assert.equal(JSON.stringify(error).includes(cookie().value),false);assert.equal(error.stack.includes(cookie().value),false);
 h.handle.close=async()=>{};await h.acquirer.close();
});
test('scoped UI consent and capture action leave no temporary command or status item',async t=>{
 const {createConfirmedBrowserAcquirer}=require('../src/session/acquisition-ui');const h=harness(),commands=new Map();let shown=0,disposed=0,consent;
 const v={StatusBarAlignment:{Right:2},window:{async showInformationMessage(...args){consent=args;return 'Save approved session';},createStatusBarItem(){return{show(){shown++;},dispose(){disposed++;}};}},commands:{registerCommand(id,fn){commands.set(id,fn);return{dispose(){commands.delete(id);}};}}};
 const acquirer=createConfirmedBrowserAcquirer(v,{plan:plan(),source:h.source}),controller=new AbortController();t.after(()=>controller.abort());const pending=acquirer.acquire({confirmed:true,signal:controller.signal});pending.catch(()=>{});
 const end=Date.now()+1000;while(!shown&&Date.now()<end)await new Promise(r=>setTimeout(r,1));assert.equal(shown,2);assert.match(consent[1].detail,/synthetic_session at https:\/\/api.session-test.invalid\/me/);assert.match(consent[1].detail,/all cookies applicable to each exact URL into memory before local name filtering/);assert.match(consent[1].detail,/Only the selected session names are persisted/);assert.match(consent[1].detail,/immediately discarded and never logged/);assert.match(consent[1].detail,/No other sites are queried/);assert.equal(h.state.reads,0);
 commands.values().next().value();const captured=await pending;assert.equal(disposed,2);assert.equal(commands.size,0);await captured.close();
});
test('canceling the human UI handoff disposes its action and closes without cookie access',async t=>{
 const {createConfirmedBrowserAcquirer}=require('../src/session/acquisition-ui');const h=harness(),commands=new Map();let shown=0,disposed=0;
 const v={StatusBarAlignment:{Right:2},window:{async showInformationMessage(){return 'Save approved session';},createStatusBarItem(){return{show(){shown++;},dispose(){disposed++;}};}},commands:{registerCommand(id,fn){commands.set(id,fn);return{dispose(){commands.delete(id);}};}}};
 const acquirer=createConfirmedBrowserAcquirer(v,{plan:plan(),source:h.source});const c=new AbortController();t.after(()=>c.abort());const pending=acquirer.acquire({confirmed:true,signal:c.signal});pending.catch(()=>{});
 const end=Date.now()+1000;while(!shown&&Date.now()<end)await new Promise(r=>setTimeout(r,1));assert.equal(shown,2);c.abort();await assert.rejects(pending,{code:'CANCELED'});assert.equal(disposed,2);assert.equal(commands.size,0);assert.equal(h.state.reads,0);assert.equal(h.state.closed,1);
});
async function failedCapturedClose(t,{objectOwner=true}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-owner-cleanup-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const secrets=memorySecrets(),vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});const h=harness();h.handle.close=async()=>{throw Error('Synthetic close failed');};
 const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault,transport:{},...(objectOwner?{acquisition:h.acquirer}:{acquire:options=>h.acquirer.acquire(options)})});
 let error;try{await bridge.start({confirmed:true});}catch(e){error=e;}
 assert.equal(error?.code,'ACQUISITION_CLEANUP_PENDING');assert.equal(error.acquisition.storedSession,true);assert.equal(error.acquisition.closed,false);assert.equal(await vault.ready(),true);assert.equal(bridge.connected,false);assert.equal(bridge.cleanupPending,true);assert.equal(bridge.hasOwnedResources,true);assert.equal(h.acquirer.cleanupPending,true);return{h,bridge,vault};
}
test('failed post-import capture close is retained and Clear reports pending ownership until retry succeeds',async t=>{
 const {h,bridge,vault}=await failedCapturedClose(t,{objectOwner:false});let error;try{await bridge.revoke();}catch(e){error=e;}
 assert.equal(error?.code,'ACQUISITION_CLEANUP_PENDING');assert.equal(error.cleanup.credentials.activeCredentialCleared,true);assert.equal(error.cleanup.credentials.credentialsDeleted,true);assert.equal(error.cleanup.acquisition.closed,false);assert.equal(await vault.ready(),false);assert.equal(bridge.cleanupPending,true);assert.equal(bridge.hasOwnedResources,true);
 h.handle.close=async()=>{h.state.closed++;};await bridge.revoke();assert.equal(bridge.cleanupPending,false);assert.equal(bridge.hasOwnedResources,false);assert.equal(h.acquirer.hasOwnedResources,false);
});
test('Stop and Dispose retry retained acquisition owners independently of saved-session lifetime',async t=>{
 for(const operation of ['stop','dispose']){
  const {h,bridge,vault}=await failedCapturedClose(t);h.handle.close=async()=>{h.state.closed++;};await bridge[operation]();assert.equal(bridge.cleanupPending,false);assert.equal(bridge.hasOwnedResources,false);assert.equal(await vault.ready(),true);assert.equal(h.acquirer.hasOwnedResources,false);await vault.clear();
 }
});
test('pre-capture failure cleanup is aggregated through the acquisition owner even without a captured handle',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-owner-before-capture-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const vault=new SessionVault(memorySecrets(),{scope:scope(),directory,authURL:ORIGIN+'/me'});const h=harness();
 h.handle.readCookies=async()=>{throw Error('Synthetic read failed');};h.handle.close=async()=>{throw Error('Synthetic close failed');};
 const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault,transport:{},acquisition:h.acquirer});await assert.rejects(bridge.start({confirmed:true}),{code:'ACQUISITION_CLEANUP_PENDING'});assert.equal(await vault.ready(),false);assert.equal(bridge.cleanupPending,true);assert.equal(bridge.hasOwnedResources,true);
 h.handle.close=async()=>{};await bridge.stop();assert.equal(bridge.cleanupPending,false);assert.equal(bridge.hasOwnedResources,false);
});
test('a new session and transient Stop never reuse an earlier Clear credential report',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-owner-status-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const vault=new SessionVault(memorySecrets(),{scope:scope(),directory,authURL:ORIGIN+'/me'});const h=harness();
 const bridge=new SessionBridge({workspace:{isTrusted:true},env:{uiKind:1}}, {}, {vault,transport:{},acquisition:h.acquirer});await bridge.start({confirmed:true});await bridge.revoke();assert.equal(bridge.lastCleanup.credentials.activeCredentialCleared,true);
 await bridge.start({confirmed:true});assert.equal(bridge.lastCleanup,undefined);assert.equal(await vault.ready(),true);await bridge.stop();assert.equal(bridge.lastCleanup.credentials,undefined);assert.equal(await vault.ready(),true);await vault.clear();
});
test('the explicit Cancel sign-in action closes the owned page without reading a cookie',async t=>{
 const {createConfirmedBrowserAcquirer}=require('../src/session/acquisition-ui');const h=harness(),commands=new Map();let shown=0,disposed=0;
 const v={StatusBarAlignment:{Right:2},window:{async showInformationMessage(){return 'Save approved session';},createStatusBarItem(){return{show(){shown++;},dispose(){disposed++;}};}},commands:{registerCommand(id,fn){commands.set(id,fn);return{dispose(){commands.delete(id);}};}}};
 const acquirer=createConfirmedBrowserAcquirer(v,{plan:plan(),source:h.source}),controller=new AbortController();t.after(()=>controller.abort());const pending=acquirer.acquire({confirmed:true,signal:controller.signal});pending.catch(()=>{});
 const end=Date.now()+1000;while(shown!==2&&Date.now()<end)await new Promise(r=>setTimeout(r,1));assert.equal(shown,2);[...commands].find(([id])=>id.endsWith('.cancel'))[1]();await assert.rejects(pending,{code:'CANCELED'});assert.equal(disposed,2);assert.equal(commands.size,0);assert.equal(h.state.reads,0);assert.equal(h.state.closed,1);
});
test('closing the owned login tab automatically cancels and removes both handoff actions',async t=>{
 const {createConfirmedBrowserAcquirer}=require('../src/session/acquisition-ui');const h=harness(),commands=new Map();let shown=0,disposed=0,closed,unsubscribed=0;
 h.handle.onDidClose=listener=>{closed=listener;return{dispose(){unsubscribed++;}};};const v={StatusBarAlignment:{Right:2},window:{async showInformationMessage(){return 'Save approved session';},createStatusBarItem(){return{show(){shown++;},dispose(){disposed++;}};}},commands:{registerCommand(id,fn){commands.set(id,fn);return{dispose(){commands.delete(id);}};}}};
 const acquirer=createConfirmedBrowserAcquirer(v,{plan:plan(),source:h.source}),controller=new AbortController();t.after(()=>controller.abort());const pending=acquirer.acquire({confirmed:true,signal:controller.signal});pending.catch(()=>{});
 const end=Date.now()+1000;while(shown!==2&&Date.now()<end)await new Promise(r=>setTimeout(r,1));assert.equal(shown,2);closed();await assert.rejects(pending,{code:'CANCELED'});assert.equal(disposed,2);assert.equal(unsubscribed,1);assert.equal(commands.size,0);assert.equal(h.state.reads,0);assert.equal(h.state.closed,1);
});
test('production consent describes server expiry and never promises a daily or monthly reconnect',async()=>{
 const {createConfirmedBrowserAcquirer}=require('../src/session/acquisition-ui');const {verifiedPlan}=require('../src/session/tensortonic');let detail;
 const v={window:{async showInformationMessage(_title,options){detail=options.detail;return undefined;}}};const acquirer=createConfirmedBrowserAcquirer(v,{plan:verifiedPlan(),source:{openOwned(){throw Error('Must not open after declined consent');}}});await assert.rejects(acquirer.acquire({confirmed:true}),{code:'CANCELED'});assert.match(detail,/until the server cookie expires/);assert.match(detail,/never invents a longer lifetime/);assert.match(detail,/Session-only cookies with no explicit expiry are not retained/);assert.doesNotMatch(detail,/at most 24|1440 minutes/);
});

test('session consent accurately discloses explicit grading only for capable production transport',async()=>{
 const {createConfirmedBrowserAcquirer}=require('../src/session/acquisition-ui');
 for(const gradingAvailable of [false,true]){let detail;const h=harness(),v={window:{showInformationMessage:async(_message,options)=>{detail=options.detail;return undefined;}}};const acquirer=createConfirmedBrowserAcquirer(v,{plan:plan(),source:h.source,gradingAvailable});await assert.rejects(acquirer.acquire({confirmed:true}),{code:'CANCELED'});if(gradingAvailable){assert.match(detail,/Explicit Run and Submit can send your selected Python solution/);assert.doesNotMatch(detail,/unavailable/);}else assert.match(detail,/unavailable for this read-only transport/);assert.equal(h.state.reads,0);}
});
