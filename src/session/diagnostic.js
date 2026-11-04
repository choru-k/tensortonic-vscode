'use strict';
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const {CookieJar}=require('./cookie-jar');
const {dispatchHttps}=require('./http');
const AUTH_URL='https://api.tensortonic.com/api/me';
const KEY=/^tensortonic\.http-session\.v1\.[a-f0-9-]{36}$/;
const OUTCOMES=Object.freeze(['VERIFIED','UNSUPPORTED','AUTH_REQUIRED','SESSION_BUSY','OWNED_RESOURCES','CLEANUP_PENDING','STORAGE_UNAVAILABLE','STORAGE_TIMEOUT','SESSION_CHANGED','COOKIE_POLICY','ROTATION_UNVERIFIED','ACCOUNT_SCHEMA_UNVERIFIED','CANCELED','TIMEOUT','REDIRECT_REFUSED','HTTP_ERROR','INVALID_RESPONSE','TRANSPORT_ERROR']);
const fail=code=>{throw Object.assign(new Error('Session diagnostic did not verify the account.'),{code});};
function summary(outcome,requestCount=0){return Object.freeze({accountVerified:outcome==='VERIFIED',outcome:OUTCOMES.includes(outcome)?outcome:'TRANSPORT_ERROR',requestCount:requestCount===1?1:0});}
// Deliberately does not use SessionVault._read/ready/withSession or mutex.run:
// even those apparent reads can write an index, delete secrets or create locks.
async function readIndex(vault){
  try{
    const dir=await fs.lstat(vault.directory);if(!dir.isDirectory()||dir.isSymbolicLink())fail('STORAGE_UNAVAILABLE');
    const stat=await fs.lstat(vault.index);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>20000)fail('STORAGE_UNAVAILABLE');
    let text;const file=await fs.open(vault.index,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const opened=await file.stat();if(!opened.isFile()||opened.size>20000)fail('STORAGE_UNAVAILABLE');
      const buffer=Buffer.alloc(20001);const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>20000)fail('STORAGE_UNAVAILABLE');
      text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead));
    }finally{await file.close();}
    const s=JSON.parse(text);
    if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['version','epoch','activeKey','pending'].includes(k))||s.version!==2||!Number.isSafeInteger(s.epoch)||s.epoch<0||s.activeKey!==null&&(typeof s.activeKey!=='string'||!KEY.test(s.activeKey))||!Array.isArray(s.pending)||s.pending.length>64||s.pending.some(x=>!x||Object.keys(x).some(k=>!['key','uncertain'].includes(k))||typeof x.key!=='string'||!KEY.test(x.key)||typeof x.uncertain!=='boolean')||new Set(s.pending.map(x=>x.key)).size!==s.pending.length||s.pending.some(x=>x.key===s.activeKey))fail('STORAGE_UNAVAILABLE');
    return {text,state:s};
  }catch(error){if(error?.code==='ENOENT')fail('AUTH_REQUIRED');fail('STORAGE_UNAVAILABLE');}
}
function bounded(work,signal,ms,code){
  return new Promise((resolve,reject)=>{
    let timer,done=false;
    const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>finish(reject,{code:signal?.reason?.code==='TIMEOUT'?'TIMEOUT':'CANCELED'});
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(reject,{code}),ms);
    if(signal?.aborted){abort();return;}
    Promise.resolve().then(work).then(value=>finish(resolve,value),()=>finish(reject,{code:'STORAGE_UNAVAILABLE'}));
  });
}
function createSessionDiagnostic(vault,{dispatch=dispatchHttps,authenticatedAccount,timeoutMs=20000,maxBytes=1024*1024}={}){
  if(typeof authenticatedAccount!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid session diagnostic configuration.');
  return async function diagnose({signal,assertCurrent=()=>{}}={}){
    let requestCount=0;const controller=new AbortController();
    const abort=()=>controller.abort({code:'CANCELED'});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(()=>controller.abort({code:'TIMEOUT'}),timeoutMs);
    const check=()=>{if(controller.signal.aborted)fail(controller.signal.reason?.code==='TIMEOUT'?'TIMEOUT':'CANCELED');assertCurrent();};
    const work=async()=>{
      check();const first=await readIndex(vault);check();
      if(first.state.pending.length||vault.cleanupPending)fail('CLEANUP_PENDING');
      if(!first.state.activeKey)fail('AUTH_REQUIRED');
      const encoded=await bounded(()=>vault.secrets.get(first.state.activeKey),controller.signal,vault.providerTimeoutMs,'STORAGE_TIMEOUT');check();
      if(typeof encoded!=='string'||encoded.length>150000)fail('AUTH_REQUIRED');
      let jar;try{jar=new CookieJar(vault.scope,{now:vault.now,record:JSON.parse(encoded)});}catch{fail('COOKIE_POLICY');}
      if(!jar.canAuthenticate(AUTH_URL))fail('AUTH_REQUIRED');
      const fence=async()=>{const current=await readIndex(vault);check();if(current.text!==first.text||current.state.activeKey!==first.state.activeKey||current.state.epoch!==first.state.epoch)fail('SESSION_CHANGED');};
      await fence();check();
      const response=await dispatch({url:new URL(AUTH_URL),method:'GET',headers:{Accept:'application/json',Cookie:jar.header(AUTH_URL)},body:undefined,signal:controller.signal,maxBytes,onDispatch:()=>{check();requestCount=1;}});
      check();await fence();check();
      if(!response||!Number.isSafeInteger(response.status)||response.status<100||response.status>599||!Buffer.isBuffer(response.body)||response.body.length>maxBytes)fail('INVALID_RESPONSE');
      if(response.status===401)fail('AUTH_REQUIRED');
      // Do not parse, adopt or persist even a valid renewal. GET may change the
      // remote session; byte-identical local storage cannot guarantee otherwise.
      if(response.setCookie!==undefined&&(!Array.isArray(response.setCookie)||response.setCookie.length))fail('ROTATION_UNVERIFIED');
      if(response.status>=300&&response.status<400)fail('REDIRECT_REFUSED');
      if(response.status<200||response.status>=300)fail('HTTP_ERROR');
      let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.body));}catch{fail('INVALID_RESPONSE');}
      if(!authenticatedAccount(body))fail('ACCOUNT_SCHEMA_UNVERIFIED');
      return summary('VERIFIED',requestCount);
    };
    try{
      // Race the entire read/dispatch pipeline, including filesystem/providers
      // that ignore cancellation. Late continuations check before dispatch.
      return await new Promise((resolve,reject)=>{
        const cancel=()=>reject({code:controller.signal.reason?.code==='TIMEOUT'?'TIMEOUT':'CANCELED'});
        controller.signal.addEventListener('abort',cancel,{once:true});
        if(controller.signal.aborted)cancel();
        Promise.resolve().then(work).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',cancel));
      });
    }catch(error){return summary(error?.code,requestCount);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
}
module.exports={createSessionDiagnostic,summary,OUTCOMES};
