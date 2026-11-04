'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SessionVault}=require('../src/session/vault');
const {SessionBridge}=require('../src/session-bridge');
const {createSessionDiagnostic,OUTCOMES}=require('../src/session/diagnostic');
const {verifiedScope,authenticatedAccount,SESSION_NAME,AUTH_URL}=require('../src/session/tensortonic');
const key='tensortonic.http-session.v1.00000000-0000-0000-0000-000000000000';
const secret='synthetic-secret-never-output',identity='synthetic-private-identity';
const response=(status=200,setCookie=[])=>({status,setCookie,body:Buffer.from(JSON.stringify({user:{id:identity,name:identity}}))});
async function setup(t,{timeoutMs=1000}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-diagnostic-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const data=new Map([[key,JSON.stringify({version:2,retention:'server',expiresAt:null,cookies:[{name:SESSION_NAME,value:secret,domain:'tensortonic.com',path:'/',hostOnly:false,secure:true,httpOnly:true,sameSite:'Lax',persistent:true,expiresAt:Date.now()+60000,created:0}]})]]);
 let writes=0,reads=0,requests=0;const secrets={get:async k=>{reads++;return data.get(k);},store:async()=>{writes++;throw Error(secret);},delete:async()=>{writes++;throw Error(secret);}};
 const vault=new SessionVault(secrets,{scope:verifiedScope(),directory,authURL:AUTH_URL,providerTimeoutMs:30,mutex:{run(){throw Error('Mutex must never run');}}});
 const index={version:2,epoch:0,activeKey:key,pending:[]};await fs.writeFile(vault.index,JSON.stringify(index));
 const vscode={workspace:{isTrusted:true},env:{uiKind:1}};let handler=async()=>response();
 const diagnostic=createSessionDiagnostic(vault,{authenticatedAccount,timeoutMs,dispatch:async o=>{requests++;assert.equal(o.url.href,AUTH_URL);assert.equal(o.method,'GET');assert.equal(o.body,undefined);assert.equal(o.headers.Cookie,SESSION_NAME+'='+secret);o.onDispatch();return handler(o);}});
 const bridge=new SessionBridge(vscode,{}, {vault,transport:{},diagnostic});bridge.connected=true;bridge.token='unchanged-token';
 for(const name of ['start','restore','checkStoredSession','stop','revoke'])bridge[name]=()=>{throw Error(name+' forbidden');};
 const snapshot=async()=>({files:await fs.readdir(directory),index:await fs.readFile(vault.index,'utf8'),data:[...data],pendingDeletes:vault.pendingDeletes,pendingNativeWrites:vault.pendingNativeWrites,connected:bridge.connected,token:bridge.token});
 return {bridge,vault,secrets,data,index,vscode,snapshot,handler:f=>handler=f,counts:()=>({writes,reads,requests})};
}
for(const [label,make,outcome] of [
 ['valid account',()=>response(),'VERIFIED'],['unauthorized',()=>response(401),'AUTH_REQUIRED'],['wrong schema',()=>({...response(),body:Buffer.from('{}')}),'ACCOUNT_SCHEMA_UNVERIFIED'],
 ['valid renewal',()=>response(200,[SESSION_NAME+'=synthetic-rotated; Secure; HttpOnly']),'ROTATION_UNVERIFIED'],['invalid renewal',()=>response(200,['\r\n'+secret]),'ROTATION_UNVERIFIED'],
 ['invalid cookie container',()=>response(200,secret),'ROTATION_UNVERIFIED'],['redirect',()=>response(302),'REDIRECT_REFUSED'],['server failure',()=>response(500),'HTTP_ERROR'],['bad JSON',()=>({...response(),body:Buffer.from(secret)}),'INVALID_RESPONSE'],
 ['transport exception',()=>{throw Error(secret);},'TRANSPORT_ERROR']])test('diagnostic preserves every local byte on '+label,async t=>{
 const h=await setup(t);h.handler(make);const before=await h.snapshot();const result=await h.bridge.diagnoseStoredSession();assert.deepEqual(result,{accountVerified:outcome==='VERIFIED',outcome,requestCount:1});assert.ok(Object.isFrozen(result));assert.deepEqual(await h.snapshot(),before);assert.equal(h.counts().writes,0);assert.equal(h.counts().requests,1);assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes(identity));
});
for(const kind of ['missing','invalid','expired'])test('diagnostic preserves '+kind+' credential without dispatch',async t=>{
 const h=await setup(t);if(kind==='missing')h.data.delete(key);else if(kind==='invalid')h.data.set(key,secret);else {const r=JSON.parse(h.data.get(key));r.cookies[0].expiresAt=1;h.data.set(key,JSON.stringify(r));}
 const before=await h.snapshot();const r=await h.bridge.diagnoseStoredSession();assert.equal(r.accountVerified,false);assert.equal(r.requestCount,0);assert.deepEqual(await h.snapshot(),before);assert.equal(h.counts().writes,0);
});
for(const [kind,change,outcome] of [
 ['untrusted',h=>h.vscode.workspace.isTrusted=false,'UNSUPPORTED'],['remote',h=>h.vscode.env.remoteName='ssh','UNSUPPORTED'],['web',h=>h.vscode.env.uiKind=2,'UNSUPPORTED'],['disconnected',h=>h.bridge.connected=false,'AUTH_REQUIRED'],['starting',h=>h.bridge.starting=Promise.resolve(),'SESSION_BUSY'],['restoring',h=>h.bridge.restoring=Promise.resolve(),'SESSION_BUSY'],['request pending',h=>h.bridge.controllers.add(new AbortController()),'SESSION_BUSY'],['owned acquisition',h=>h.bridge.acquisitionOwners.add({}),'OWNED_RESOURCES'],['owned display',h=>h.bridge.display={hasOwnedResources:true},'OWNED_RESOURCES'],['cleanup',h=>h.vault.pendingDeletes=1,'CLEANUP_PENDING']])test('diagnostic gate '+kind,async t=>{
 const h=await setup(t);change(h);const before=await h.snapshot();assert.equal((await h.bridge.diagnoseStoredSession()).outcome,outcome);assert.deepEqual(h.counts(),{writes:0,reads:0,requests:0});assert.deepEqual(await h.snapshot(),before);
});
test('diagnostic blocks indexed pending cleanup without updating cached status',async t=>{
 const h=await setup(t);h.index.pending=[{key:key.replace(/0$/,'1'),uncertain:true}];await fs.writeFile(h.vault.index,JSON.stringify(h.index));const before=await h.snapshot();assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'CLEANUP_PENDING');assert.deepEqual(await h.snapshot(),before);
});
test('diagnostic refuses arbitrary route/body/options',async t=>{const h=await setup(t);for(const options of [{route:'/api/problems'},{method:'POST'},{body:{}},{url:'https://example.invalid'},null])assert.equal((await h.bridge.diagnoseStoredSession(options)).outcome,'UNSUPPORTED');assert.equal(h.counts().requests,0);});
test('diagnostic detects epoch changes before dispatch',async t=>{
 const h=await setup(t);h.secrets.get=async()=>{h.index.epoch++;await fs.writeFile(h.vault.index,JSON.stringify(h.index));return h.data.get(key);};assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'SESSION_CHANGED');assert.equal(h.counts().requests,0);assert.equal(h.counts().writes,0);
});
test('diagnostic detects rotation after dispatch without overwriting external change',async t=>{
 const h=await setup(t);h.handler(async()=>{h.index.activeKey=null;h.index.epoch++;await fs.writeFile(h.vault.index,JSON.stringify(h.index));return response();});assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'SESSION_CHANGED');assert.equal(JSON.parse(await fs.readFile(h.vault.index)).activeKey,null);assert.equal(h.counts().writes,0);
});
test('diagnostic rechecks host and bridge generation after dispatch',async t=>{
 for(const change of [h=>h.vscode.workspace.isTrusted=false,h=>h.bridge.generation++]){const h=await setup(t);h.handler(()=>{change(h);return response();});assert.equal((await h.bridge.diagnoseStoredSession()).accountVerified,false);assert.equal(h.counts().writes,0);}
});
test('diagnostic timeout bounds an uncooperative transport and leaves storage unchanged',async t=>{
 const h=await setup(t,{timeoutMs:20});h.handler(()=>new Promise(()=>{}));const before=await h.snapshot();assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'TIMEOUT');assert.deepEqual(await h.snapshot(),before);assert.equal(h.bridge.pending,false);
});
test('diagnostic provider timeout does not dispatch even when secret read resolves late',async t=>{
 const h=await setup(t);let release;h.secrets.get=()=>new Promise(r=>release=r);const before=await h.snapshot();assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'STORAGE_TIMEOUT');release(h.data.get(key));await new Promise(r=>setTimeout(r,10));assert.equal(h.counts().requests,0);assert.deepEqual(await h.snapshot(),before);
});
test('diagnostic cancellation before and during request is sanitized and nonmutating',async t=>{
 const h=await setup(t);let c=new AbortController();c.abort();assert.equal((await h.bridge.diagnoseStoredSession({signal:c.signal})).outcome,'CANCELED');assert.equal(h.counts().requests,0);
 c=new AbortController();h.handler(()=>{c.abort();return response();});const before=await h.snapshot();assert.equal((await h.bridge.diagnoseStoredSession({signal:c.signal})).outcome,'CANCELED');assert.deepEqual(await h.snapshot(),before);
});
test('diagnostic refuses simultaneous diagnostic calls',async t=>{
 const h=await setup(t);let entered,release;const ready=new Promise(r=>entered=r);h.handler(()=>{entered();return new Promise(r=>release=r);});const first=h.bridge.diagnoseStoredSession();await ready;assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'SESSION_BUSY');release(response());assert.equal((await first).outcome,'VERIFIED');assert.equal(h.counts().requests,1);
});
test('diagnostic enum contains only fixed public strings',()=>assert.ok(OUTCOMES.every(v=>/^[A-Z_]+$/.test(v))));
for(const [name,text] of [['malformed',secret],['oversized',' '.repeat(20001)],['negative epoch',JSON.stringify({version:2,epoch:-1,activeKey:key,pending:[]})],['unknown fields',JSON.stringify({version:2,epoch:0,activeKey:key,pending:[],cookie:secret})]])test('diagnostic preserves '+name+' index without credential reads',async t=>{
 const h=await setup(t);await fs.writeFile(h.vault.index,text);const before=await h.snapshot();assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'STORAGE_UNAVAILABLE');assert.deepEqual(await h.snapshot(),before);assert.deepEqual(h.counts(),{writes:0,reads:0,requests:0});
});
test('diagnostic leaves missing index absent without creating locks',async t=>{
 const h=await setup(t);await fs.unlink(h.vault.index);assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'AUTH_REQUIRED');assert.deepEqual(await fs.readdir(h.vault.directory),[]);assert.deepEqual(h.counts(),{writes:0,reads:0,requests:0});
});
test('diagnostic rejects symlink index without reading secrets',async t=>{
 const h=await setup(t);const original=h.vault.index+'.original';await fs.rename(h.vault.index,original);await fs.symlink(original,h.vault.index);assert.equal((await h.bridge.diagnoseStoredSession()).outcome,'STORAGE_UNAVAILABLE');assert.ok((await fs.lstat(h.vault.index)).isSymbolicLink());assert.deepEqual(h.counts(),{writes:0,reads:0,requests:0});
});
test('diagnostic rejects a provider exception without leaking it',async t=>{
 const h=await setup(t);h.secrets.get=async()=>{throw Error(secret);};const before=await h.snapshot();const result=await h.bridge.diagnoseStoredSession();assert.deepEqual(result,{accountVerified:false,outcome:'STORAGE_UNAVAILABLE',requestCount:0});assert.deepEqual(await h.snapshot(),before);
});
