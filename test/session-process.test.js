'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process');const {once}=require('node:events');
const {SessionVault}=require('../src/session/vault');const {SessionHttpTransport}=require('../src/session/http');
const {fixture,scope,memorySecrets,ORIGIN,routePolicy}=require('./fixtures/session');
const childPath=path.join(__dirname,'fixtures/session-child.js');
test('independent processes share the OS lock and rotate without stale credential overwrites',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-session-process-'));const server=await fixture();const secrets=memorySecrets();
  t.after(async()=>{await server.close();await fs.rm(directory,{recursive:true,force:true});});
  const vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});const expectedEpoch=await vault.captureAcquisitionFence();const captured=await server.login();await vault.importCookies(captured.cookies,{sourceURL:captured.sourceURL,confirmed:true,expectedEpoch});
  const run=()=>new Promise((resolve,reject)=>{
    const child=fork(childPath,[directory],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(child.connected)child.kill();});
    child.on('error',reject);child.on('message',async message=>{
      if(message.done){message.failed?reject(new Error('Synthetic child failed')):resolve(message.authenticated);return;}
      try{
        let value;
        if(['get','store','delete'].includes(message.operation))value=await secrets[message.operation](...message.args);
        else if(message.operation==='http'){const options=message.args[0];const result=await server.dispatch({...options,url:new URL(options.url),onDispatch(){}});value={...result,body:result.body.toString('base64')};}
        else throw Error();
        if(child.connected)child.send({id:message.id,ok:true,value});
      }catch{if(child.connected)child.send({id:message.id,ok:false});}
    });
  });
  assert.ok((await Promise.all([run(),run()])).every(Boolean));assert.equal(server.counts['/rotate'],6);
  assert.equal((await new SessionHttpTransport(vault,{routePolicy,dispatch:server.dispatch}).request('/me')).authenticated,true);
});
test('an owned test-process crash releases the SQLite lock without stealing a live lease',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-session-crash-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const child=fork(childPath,[directory,'hold'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(child.connected)child.kill();});
  const message=await once(child,'message');assert.equal(message[0].lockHeld,true);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const {SessionMutex}=require('../src/session/mutex');let entered=false;await new SessionMutex(directory).run(async()=>{entered=true;});assert.equal(entered,true);
});
test('a shared Clear fences an acquisition held in another process',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-session-epoch-'));const server=await fixture();const secrets=memorySecrets();
  t.after(async()=>{await server.close();await fs.rm(directory,{recursive:true,force:true});});
  const vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});
  const child=fork(childPath,[directory,'acquire-wait'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(child.connected)child.kill();});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('message',async message=>{
    if(message.done){resolve(message.canceled);return;}
    if(message.operation==='acquire'){await vault.clear();const captured=await server.login();child.send({id:message.id,ok:true,value:captured});}
  });});
  assert.equal(await done,true);assert.equal(await vault.ready(),false);assert.equal(secrets.data.size,0);
});
test('late secure-provider completion after an owned caller crash cannot overwrite a newer session',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tt-session-provider-crash-'));const server=await fixture();const secrets=memorySecrets();
  t.after(async()=>{await server.close();await fs.rm(directory,{recursive:true,force:true});});
  const vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});const epoch=await vault.captureAcquisitionFence();const initial=await server.login();await vault.importCookies(initial.cookies,{sourceURL:initial.sourceURL,confirmed:true,expectedEpoch:epoch});
  const child=fork(childPath,[directory,'rotate-once'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(child.connected)child.kill();});
  let late;const held=new Promise(resolve=>{child.on('message',async message=>{
    if(message.operation==='store'){const [key,value]=message.args;late=()=>secrets.data.set(key,value);resolve();return;}
    try{let value;if(['get','delete'].includes(message.operation))value=await secrets[message.operation](...message.args);else if(message.operation==='http'){const options=message.args[0];const response=await server.dispatch({...options,url:new URL(options.url),onDispatch(){}});value={...response,body:response.body.toString('base64')};}else return;if(child.connected)child.send({id:message.id,ok:true,value});}catch{if(child.connected)child.send({id:message.id,ok:false});}
  });});
  await held;const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const expectedEpoch=await vault.captureAcquisitionFence();const next=await server.login();await vault.importCookies(next.cookies,{sourceURL:next.sourceURL,confirmed:true,expectedEpoch});
  const before=JSON.parse(await fs.readFile(path.join(directory,'session-index.json'),'utf8')).activeKey;late();
  const transport=new SessionHttpTransport(vault,{routePolicy,dispatch:server.dispatch});assert.equal((await transport.request('/me')).authenticated,true);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,'session-index.json'),'utf8')).activeKey,before);
  const cleanup=await vault.clear();assert.equal(cleanup.activeCredentialCleared,true);assert.equal(cleanup.credentialsDeleted,false);assert.ok(cleanup.uncertainNativeWriteCount>0);assert.equal(await vault.ready(),false);assert.equal(secrets.data.size,0);
});
