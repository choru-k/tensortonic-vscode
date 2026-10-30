'use strict';
// VM-only integration: unchanged bridge and connector, real localhost TCP HTTP.
// Remote TensorTonic API calls are always mocked. This is NOT a Chromium/CORS test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setTimeout: delay}=require('node:timers/promises');
const {BrowserBridge}=require('../src/bridge');
const {TensorTonicClient}=require('../src/client');
const source=fs.readFileSync(require.resolve('../src/browser-connector'),'utf8');
const ORIGIN='https://www.tensortonic.com';
async function until(check, ms=3000){ const deadline=Date.now()+ms; while(!check()){if(Date.now()>deadline)throw Error('Timed out waiting for test condition');await delay(5);} }
async function setup(options={}) {
 const bridge=new BrowserBridge({requestTimeout:options.requestTimeout||1000});
 await bridge.start();
 const base=`http://127.0.0.1:${bridge.port}`;
 const calls=[], local=[], logs=[], windows=[];
 const client=new TensorTonicClient((p,o)=>bridge.request(p,o));
 async function connect(origin=ORIGIN, responder=options.responder||((p)=>({status:'success',data:{path:p,zero:0,flag:false}}))){
   const window={};windows.push(window);
   const sandbox={location:{origin},window,URL,AbortController,AbortSignal,console:Object.fromEntries(['info','warn','error'].map(k=>[k,(...a)=>logs.push({type:k,text:a.join(' ')})])),
    async fetch(url,init={}) {
     const u=new URL(url);
     if(u.origin===base){
       local.push({path:u.pathname,method:init.method||'GET'});
       return fetch(url,{...init,headers:{...init.headers,Origin:origin}});
     }
     assert.equal(u.origin,'https://api.tensortonic.com','No unrecognized outbound destination');
     calls.push({path:u.pathname+u.search,method:init.method||'GET',credentials:init.credentials,redirect:init.redirect,headers:init.headers,body:init.body&&JSON.parse(init.body)});
     const data=await responder(u.pathname+u.search,init,calls.length);
     return data instanceof Response?data:new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    }};
   const task=vm.runInNewContext(`(${source})(${JSON.stringify({base,token:bridge.token})})`,sandbox);
   // Prevent test failures creating unhandled asynchronous rejections.
   task.catch(()=>{});
   return {window,task};
 }
 async function close(){for(const w of windows)w.__tensorTonicVSCode?.abort();await bridge.stop();}
 return {bridge,base,calls,local,logs,client,connect,close};
}

test('actual TCP server rejects foreign origin/wrong capability and emits CORS preflight headers', async()=>{
 const s=await setup();try{
  const valid=`${s.base}/poll?key=${s.bridge.token}`;
  const wrongOrigin=await fetch(valid,{headers:{Origin:'https://evil.example'}});
  assert.equal(wrongOrigin.status,403);assert.equal(wrongOrigin.headers.get('access-control-allow-origin'),null);
  const wrongKey=await fetch(s.base+'/poll?key=wrong',{headers:{Origin:ORIGIN}});assert.equal(wrongKey.status,403);
  const missingOrigin=await fetch(valid);assert.equal(missingOrigin.status,403);
  const preflight=await fetch(s.base+'/result',{method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type','Access-Control-Request-Private-Network':'true'}});
  assert.equal(preflight.status,200);assert.equal(preflight.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
  assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);assert.equal(s.bridge.connected,false);
 }finally{await s.close();}
});

test('unchanged connector + real HTTP bridge + client browse/detail/public tests succeed against fake API only',async()=>{
 const s=await setup({responder:path=>path.startsWith('/api/problems/list')?{status:'success',data:{problems:[{id:'mock-api-id',sourceId:'mock-api-id',slug:'mock-exercise',title:'Mock exercise',source:'python',planId:'pytorch-basics'}],pagination:{hasMore:false}}}:path==='/api/study-plans/pytorch-basics'?{status:'success',data:{id:'pytorch-basics',sections:[{sortOrder:1,problems:[{slug:'mock-api-id',type:'python',sortOrder:1}]}]}}:{status:'success',data:{id:'mock-api-id',title:'Mock exercise',starterCode:'def mock(x):\n    pass\n',description:'Mock statement',testCases:[{id:'public',inputs:{x:1},isPublic:true},{id:'hidden',inputs:{x:2},isPublic:false}]}}});
 try{await s.connect();await until(()=>s.bridge.connected);const list=await s.client.listProblems('pytorch-basics');assert.equal(list.length,1);const detail=await s.client.getProblem(list[0]);assert.equal(detail.testCases.length,1);assert.equal(detail.testCases[0].id,'public');assert.equal(s.calls[1].path,'/api/study-plans/pytorch-basics');assert.equal(s.calls[2].path,'/api/study-plans/pytorch-basics/problems/mock-api-id');assert.ok(s.calls.every(x=>x.credentials==='include'&&x.redirect==='error'));assert.ok(s.local.some(x=>x.path==='/result'&&x.method==='POST'));}finally{await s.close();}
});

test('fake Run and Submit preserve exact bodies and no operation is replayed',async()=>{
 const s=await setup();try{await s.connect();await until(()=>s.bridge.connected);
  const run={code:'def fake(x): return x',testCases:[{id:'custom-1',inputs:{x:0}}]};const submit={code:'def fake(x): return x'};
  const result=await s.bridge.request('/api/study-plans/pytorch-basics/problems/mock-exercise/run',{method:'POST',body:run});assert.equal(result.data.zero,0);assert.equal(result.data.flag,false);
  await s.bridge.request('/api/study-plans/pytorch-basics/problems/mock-exercise/submit',{method:'POST',body:submit});
  assert.deepEqual(s.calls.map(c=>c.body),[run,submit]);assert.equal(s.calls.length,2);assert.equal(s.bridge.pending.size,0);
 }finally{await s.close();}
});

test('HTTP 401 from fake API reaches caller once; no Submit retry',async()=>{
 const s=await setup({responder:()=>new Response(JSON.stringify({message:'Synthetic sign-in required'}),{status:401})});try{await s.connect();await until(()=>s.bridge.connected);await assert.rejects(s.bridge.request('/api/problems/mock-exercise/submit',{method:'POST',body:{code:'pass',problemType:'free'}}),/Synthetic sign-in required/);await delay(50);assert.equal(s.calls.length,1);assert.equal(s.bridge.pending.size,0);}finally{await s.close();}
});

test('malformed JSON and network failure are propagated through real HTTP response transport',async()=>{
 let n=0;const s=await setup({responder:()=>{if(n++===0)return new Response('not JSON',{status:200});throw Error('Synthetic network failure');}});try{await s.connect();await until(()=>s.bridge.connected);await assert.rejects(s.bridge.request('/api/problems/mock-exercise'),/JSON|Unexpected token/);await assert.rejects(s.bridge.request('/api/problems/mock-exercise'),/Synthetic network failure/);assert.equal(s.calls.length,2);}finally{await s.close();}
});

test('simultaneous grading operations rejected while first fake API request is in flight',async()=>{
 let release;const paused=new Promise(r=>release=r);const s=await setup({responder:async()=>{await paused;return {status:'success',data:{status:'passed'}}}});try{await s.connect();await until(()=>s.bridge.connected);const first=s.bridge.request('/api/problems/mock-exercise/run-cases',{method:'POST',body:{code:'pass',testCases:[]}});await until(()=>s.calls.length===1);await assert.rejects(s.bridge.request('/api/problems/mock-exercise/submit',{method:'POST',body:{code:'pass'}}),/already in progress/);release();await first;assert.equal(s.calls.length,1);}finally{release();await s.close();}
});

test('request timeout does not replay; late result is rejected and connector remains usable',async()=>{
 let n=0;const s=await setup({requestTimeout:60,responder:async()=>{if(n++===0)await delay(120);return {status:'success',data:{ok:true}}}});try{await s.connect();await until(()=>s.bridge.connected);await assert.rejects(s.bridge.request('/api/problems/mock-exercise/submit',{method:'POST',body:{code:'pass'}}),/timed out/);await until(()=>s.logs.some(x=>x.type==='warn'));assert.equal(s.calls.length,1);assert.equal(s.bridge.pending.size,0);assert.equal((await s.bridge.request('/api/problems/mock-exercise')).data.ok,true);assert.equal(s.calls.length,2);}finally{await s.close();}
});

test('bridge stop revokes key and connection; fresh start can reconnect with new key',async()=>{
 const s=await setup();try{const first=await s.connect();await until(()=>s.bridge.connected);const old=s.bridge.token;await s.bridge.stop();await first.task;assert.equal(s.bridge.connected,false);assert.equal(s.bridge.token,undefined);await assert.rejects(s.bridge.request('/api/problems/mock-exercise'),/Connect/);await s.bridge.start();assert.notEqual(s.bridge.token,old);
 // Fresh URL is necessary because the OS assigns a new loopback port.
 const base2=`http://127.0.0.1:${s.bridge.port}`;const poll=fetch(base2+'/poll?key='+s.bridge.token,{headers:{Origin:ORIGIN}});await until(()=>s.bridge.connected);await s.bridge.stop();assert.deepEqual(await(await poll).json(),{stop:true});
 }finally{await s.close();}
});

test('connector rejects foreign website origin before any local or upstream request',async()=>{
 const s=await setup();try{const c=await s.connect('https://evil.example');await assert.rejects(c.task,/only on your signed-in TensorTonic website/);assert.equal(s.local.length,0);assert.equal(s.calls.length,0);}finally{await s.close();}
});

test('forbidden destinations and extra payload fields rejected before network dispatch',async()=>{
 const s=await setup();try{await s.connect();await until(()=>s.bridge.connected);for(const p of ['/api/me','/api/billing','/api/problems/mock-exercise/solution','https://evil.example/api/problems/x'])await assert.rejects(s.bridge.request(p),/Unsupported/);await assert.rejects(s.bridge.request('/api/problems/mock-exercise/submit',{method:'POST',body:{code:'pass',url:'https://evil.example'}}),/Unsupported/);assert.equal(s.calls.length,0);}finally{await s.close();}
});
