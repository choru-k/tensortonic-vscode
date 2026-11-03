'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SessionHttpTransport,tensorTonicRoute,tensorTonicPostContract}=require('../src/session/http');
const {verifiedScope,SESSION_NAME,AUTH_URL}=require('../src/session/tensortonic');
const {CookieJar}=require('../src/session/cookie-jar');
const {fault}=require('../src/session/fault');
function setup(options={}){
  const jar=new CookieJar(verifiedScope());
  jar.importCookies([{name:SESSION_NAME,value:'synthetic-post-policy-only',domain:'tensortonic.com',path:'/',hostOnly:false,secure:true,httpOnly:true,sameSite:'Lax',persistent:true,expiresAt:Date.now()+3600000,created:0}],AUTH_URL);
  const h={calls:[],vaultReads:0,clears:0,saves:0};
  h.vault={authURL:AUTH_URL,async withSession(work,{signal}){h.vaultReads++;if(signal.aborted)throw fault('CANCELED');return work(jar,{clear:async()=>{h.clears++;},save:async()=>{h.saves++;if(h.saveError)throw h.saveError;}});}};
  h.transport=new SessionHttpTransport(h.vault,{postContract:tensorTonicPostContract,dispatch:async request=>{h.calls.push(request);request.onDispatch();if(h.respond)return h.respond(request);return{status:200,setCookie:[],body:Buffer.from('{"status":"success","data":{"synthetic":true}}')};},...options});return h;
}
const cases=[
 ['/api/problems/synthetic/run-cases',{code:'pass',testCases:[],problemType:'free'}],
 ['/api/problems/synthetic/submit',{code:'pass',problemType:'free'}],
 ['/api/study-plans/synthetic-plan/problems/synthetic/run',{code:'pass',testCases:[]}],
 ['/api/study-plans/synthetic-plan/problems/synthetic/submit',{code:'pass'}],
];
test('fixed production contract sends only four Python shapes with scoped cookie and JSON; never browser metadata',async()=>{
 const h=setup();assert.equal(h.transport.supportsGrading,true);
 for(const [route,body] of cases){assert.equal((await h.transport.request(route,{method:'POST',body})).status,'success');const request=h.calls.at(-1);assert.equal(request.url.origin,'https://api.tensortonic.com');assert.deepEqual(JSON.parse(request.body),body);assert.deepEqual(Object.keys(request.headers).sort(),['Accept','Content-Type','Cookie']);assert.equal(request.headers['Content-Type'],'application/json');assert.match(request.headers.Cookie,/^__Secure-better-auth\.session_token=/);}
 assert.equal(h.calls.length,4);
});
test('capability is explicit fixed production policy, not arbitrary injected contract presence',()=>{
 const h=setup();assert.equal(new SessionHttpTransport(h.vault).supportsGrading,false);
 assert.equal(new SessionHttpTransport(h.vault,{postContract:()=>({})}).supportsGrading,false);
 assert.equal(new SessionHttpTransport(h.vault,{postContract:tensorTonicPostContract,routePolicy:()=>new URL(AUTH_URL)}).supportsGrading,false);
});
test('account/auth/sql/cuda/project routes and arbitrary browser headers fail before vault access',async()=>{
 const h=setup();for(const route of ['/api/me','/api/auth/sign-out','/api/projects/x/problems/y/submit','/api/study-plans/x/sql/y/submit','/api/study-plans/x/cuda/y/run','https://external.invalid/api/problems/x/submit','/api/problems/x/submit?x=1','/api/problems/%2ex/submit'])await assert.rejects(h.transport.request(route,{method:'POST',body:{code:'pass'}}),{code:'UNSUPPORTED'});
 await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1],headers:{Origin:'https://www.tensortonic.com'}}),{code:'UNSUPPORTED'});assert.equal(h.vaultReads,0);assert.equal(h.calls.length,0);
});
test('production contract itself refuses any URL/route disagreement and other origins',()=>{
 for(const url of ['https://external.invalid/api/problems/x/submit','https://api.tensortonic.com/api/problems/y/submit','http://api.tensortonic.com/api/problems/x/submit'])assert.throws(()=>tensorTonicPostContract(new URL(url),'/api/problems/x/submit',{code:'pass'}),{code:'UNSUPPORTED'});
 assert.deepEqual(tensorTonicPostContract(tensorTonicRoute(cases[1][0],'POST',cases[1][1]),...cases[1]),{});
});
test('wire snapshot revalidation prevents non-enumerable toJSON bypass and bounds total payload',async()=>{
 const h=setup(),body={code:'pass'};Object.defineProperty(body,'toJSON',{value:()=>({sql:'unapproved'})});
 await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body}),{code:'UNSUPPORTED'});
 await assert.rejects(h.transport.request(cases[0][0],{method:'POST',body:{code:'x'.repeat(512*1024+1),testCases:[]}}),{code:'UNSUPPORTED'});
 await assert.rejects(h.transport.request(cases[0][0],{method:'POST',body:{code:'pass',testCases:['x'.repeat(1024*1024)]}}),{code:'UNSUPPORTED'});
 assert.equal(h.vaultReads,0);assert.equal(h.calls.length,0);
});
test('real server CSRF/Origin rejection stays a single rejection: no retry or forged fallback',async()=>{
 const h=setup();h.respond=async()=>({status:403,setCookie:[],body:Buffer.from('private-response-do-not-echo')});
 await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1]}),e=>e.code==='HTTP_ERROR'&&e.status===403&&!e.message.includes('private-response'));
 assert.equal(h.calls.length,1);assert.equal(h.clears,0);assert.equal(h.calls[0].headers.Origin,undefined);
});
test('HTTP401 invalidates session without replay or automated login',async()=>{
 const h=setup();h.respond=async()=>({status:401,setCookie:[],body:Buffer.from('{}')});
 await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1]}),{code:'AUTH_REQUIRED'});assert.equal(h.clears,1);assert.equal(h.calls.length,1);
});
test('every ambiguous dispatched response failure is uncertain including malformed rotation metadata',async()=>{
 for(const response of [{status:500,body:Buffer.from('{}')},{status:302,body:Buffer.from('{}')},{status:200,body:Buffer.from('{')},{status:999,body:Buffer.from('{}')},{status:200,body:Buffer.alloc(1025)},{status:200,body:Buffer.from('{}'),setCookie:[SESSION_NAME+'=synthetic; Domain=external.invalid; Path=/; Secure; HttpOnly; SameSite=Lax']}]){
  const h=setup({maxBytes:1024});h.respond=async()=>response;
  await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1]}),{code:'UNCERTAIN_RESULT'});assert.equal(h.calls.length,1);
 }
});
test('pre-dispatch cancellation has no cookie access; post-dispatch cancellation is uncertain',async()=>{
 const h=setup(),c=new AbortController();c.abort();await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1],signal:c.signal}),{code:'CANCELED'});assert.equal(h.vaultReads,0);
 const next=new AbortController();h.respond=async()=>{next.abort();return{status:200,body:Buffer.from('{}')};};await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1],signal:next.signal}),{code:'UNCERTAIN_RESULT'});assert.equal(h.calls.length,1);
});
test('POST has independently bounded timeout without replay',async()=>{
 const h=setup({timeoutMs:1000,postTimeoutMs:5});h.respond=async request=>new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(fault('TIMEOUT')),{once:true}));
 await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1]}),{code:'UNCERTAIN_RESULT'});assert.equal(h.calls.length,1);
});

test('post-dispatch cookie invalidation and storage failure expose only sanitized sessionInvalid flag',async()=>{
 for(const mode of ['invalid','deleted','storage']){
  const h=setup();
  const cookie=mode==='invalid'?SESSION_NAME+'=synthetic; Domain=external.invalid; Path=/; Secure; HttpOnly; SameSite=Lax':SESSION_NAME+'=synthetic-rotation; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+(mode==='deleted'?'0':'3600');
  if(mode==='storage')h.saveError=fault('STORAGE_UNAVAILABLE');
  h.respond=async()=>({status:200,setCookie:[cookie],body:Buffer.from('{"status":"success"}')});
  await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1]}),e=>e.code==='UNCERTAIN_RESULT'&&e.sessionInvalid===true&&e.cause===undefined&&!e.message.includes('synthetic'));
  assert.equal(h.calls.length,1);
 }
});
test('committed rotation cleanup uncertainty does not falsely invalidate the active session',async()=>{
 const h=setup();h.saveError=fault('ROTATION_CLEANUP_PENDING');h.respond=async()=>({status:200,setCookie:[SESSION_NAME+'=synthetic-rotation; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600'],body:Buffer.from('{}')});
 await assert.rejects(h.transport.request(cases[1][0],{method:'POST',body:cases[1][1]}),e=>e.code==='UNCERTAIN_RESULT'&&e.sessionInvalid!==true);assert.equal(h.calls.length,1);
});
