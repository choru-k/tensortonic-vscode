'use strict';
// Real loopback HTTP only. No browser, remote API, login, or real submission.
const test=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');const {setTimeout:delay}=require('node:timers/promises');
const {BrowserBridge}=require('../src/bridge');
const origin='https://www.tensortonic.com';
async function setup(t){const b=new BrowserBridge({requestTimeout:1000});await b.start();t.after(()=>b.stop());const base=`http://127.0.0.1:${b.port}`;return {b,base};}
const keyOf=b=>b.pairingCode().split(':')[2];
const post=(base,path,body,headers={})=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function until(fn){for(let n=0;n<200&&!fn();n++)await delay(5);assert.ok(fn());}

test('real TCP pairing is single-use; unauthorized origin/host cannot obtain a token',async t=>{
 const {b,base}=await setup(t);const key=keyOf(b);
 assert.equal((await post(base,'/pair',{pairingKey:key},{Origin:'https://evil.example'})).status,403);
 const wrongHost=await new Promise((resolve,reject)=>{const req=http.request(base+'/pair',{method:'POST',headers:{Origin:origin,Host:'localhost:'+b.port,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify({pairingKey:key}));});
 assert.equal(wrongHost,403);
 const response=await post(base,'/pair',{pairingKey:key});assert.equal(response.status,200);const capability=await response.json();
 assert.equal(capability.base,base);assert.equal(capability.token,b.token);assert.equal(b.connected,false);
 assert.equal((await post(base,'/pair',{pairingKey:key})).status,403);
});

test('real TCP oversized pairing body returns readable HTTP 413, with bounded acceptance at 1 KiB',async t=>{
 const {b,base}=await setup(t);let key=keyOf(b);
 const oversized=await fetch(base+'/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({pairingKey:key})+' '.repeat(10000)});
 assert.equal(oversized.status,413);assert.match((await oversized.json()).error,/Pairing request rejected/);
 key=keyOf(b);const exact=await fetch(base+'/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({pairingKey:key}).padEnd(1024)});assert.equal(exact.status,200);
});

test('real TCP concurrent redemption yields one capability; stale disconnect cannot stop new session',async t=>{
 const {b,base}=await setup(t);const key=keyOf(b);
 const both=await Promise.all([post(base,'/pair',{pairingKey:key}),post(base,'/pair',{pairingKey:key})]);
 assert.deepEqual(both.map(r=>r.status).sort(),[200,403]);const old=(await both.find(r=>r.status===200).json()).token;
 const fresh=keyOf(b);const current=await post(base,'/pair',{pairingKey:fresh});assert.equal(current.status,200);const token=(await current.json()).token;
 assert.equal((await post(base,'/disconnect?key='+old,{})).status,403);assert.equal(b.token,token);assert.ok(b.server);
});

test('real TCP disconnect acknowledgement survives shutdown and rejects pending work exactly once',async t=>{
 const {b,base}=await setup(t);const paired=await post(base,'/pair',{pairingKey:keyOf(b)});const {token}=await paired.json();
 const poll=fetch(base+'/poll?key='+token,{headers:{Origin:origin}});await until(()=>b.connected);
 const requested=b.request('/api/problems/mock');const work=await(await poll).json();
 const res=await post(base,'/result?key='+token,{id:work.id,status:200,data:{mock:true}});assert.equal(res.status,200);assert.deepEqual(await requested,{mock:true});
 const pending=b.request('/api/problems/mock/submit',{method:'POST',body:{code:'not executed'}});const rejected=assert.rejects(pending,/disconnected/);
 const disconnected=await post(base,'/disconnect?key='+token,{});assert.equal(disconnected.status,200);assert.deepEqual(await disconnected.json(),{ok:true});
 await rejected;await until(()=>!b.server);assert.equal(b.token,undefined);assert.equal(b.pairingTicket,undefined);assert.equal(b.pending.size,0);
});

test('real TCP slow redemption cannot redeem a ticket rotated while its body was in flight',async t=>{
 const {b,base}=await setup(t);const old=keyOf(b);const data=JSON.stringify({pairingKey:old});
 let request;const response=new Promise((resolve,reject)=>{
  request=http.request(base+'/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});request.on('error',reject);
 });
 request.write(data.slice(0,10));await delay(20);const fresh=keyOf(b);request.end(data.slice(10));
 assert.equal((await response).status,403);assert.equal((await post(base,'/pair',{pairingKey:fresh})).status,200);
});
