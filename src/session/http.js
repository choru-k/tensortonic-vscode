'use strict';
const https=require('node:https');const {fault}=require('./fault');
const {isAllowedRequest,validateBody}=require('../request-policy');
const API_ORIGIN='https://api.tensortonic.com';
function tensorTonicRoute(route,method,body){
  if(typeof route!=='string'||route.length>1000||/[\\#%\r\n]/.test(route)||/\/\.{1,2}(?:\/|$)/.test(route)||!route.startsWith('/api/'))throw fault('UNSUPPORTED');
  const allowed=method==='GET'&&route==='/api/me'||isAllowedRequest(route,method);
  if(!allowed||!['GET','POST'].includes(method)||method==='POST'&&!validateBody(body,route))throw fault('UNSUPPORTED');
  const url=new URL(route,API_ORIGIN);if(url.origin!==API_ORIGIN||url.username||url.password)throw fault('UNSUPPORTED');return url;
}
// Reviewed anonymous public frontend, 2026-11-02:
// https://www.tensortonic.com/_next/static/immutable/chunks/1mh93pi4i6t73.js
// These four Python endpoints send JSON with browser credentials, without an
// application CSRF header. This is NOT evidence that nonbrowser requests will
// be accepted. Never manufacture Origin/Referer/Sec-Fetch headers to pass checks.
function tensorTonicPostContract(url,route,body){
  const expected=tensorTonicRoute(route,'POST',body);
  if(!(url instanceof URL)||url.href!==expected.href)throw fault('UNSUPPORTED');
  return Object.freeze({});
}
function dispatchHttps({url,method,headers,body,signal,maxBytes,onDispatch}){
  if(url.protocol!=='https:')return Promise.reject(fault('UNSUPPORTED'));
  if(signal?.aborted)return Promise.reject(fault('CANCELED'));
  return new Promise((resolve,reject)=>{
    let settled=false;const finish=(fn,value)=>{if(settled)return;settled=true;fn(value);};let req;
    try{req=https.request(url,{method,headers,signal},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){res.destroy();req.destroy();finish(reject,fault('INVALID_RESPONSE'));}else chunks.push(chunk);});
      res.on('end',()=>finish(resolve,{status:res.statusCode,setCookie:res.headers['set-cookie']||[],body:Buffer.concat(chunks)}));
      res.on('error',()=>finish(reject,fault('TRANSPORT_ERROR')));
    });
    req.on('error',()=>finish(reject,fault(signal?.aborted?'CANCELED':'TRANSPORT_ERROR')));
    if(signal?.aborted){req.destroy();finish(reject,fault('CANCELED'));return;}
    onDispatch();req.end(body);
    }catch{req?.destroy();finish(reject,fault('TRANSPORT_ERROR'));}
  });
}
class SessionHttpTransport {
  constructor(vault,{routePolicy=tensorTonicRoute,dispatch=dispatchHttps,postContract,timeoutMs=20000,postTimeoutMs=timeoutMs,maxBytes=8*1024*1024}={}){
    Object.assign(this,{vault,routePolicy,dispatch,postContract,timeoutMs,postTimeoutMs,maxBytes});
  }
  get supportsGrading(){return this.postContract===tensorTonicPostContract&&this.routePolicy===tensorTonicRoute;}
  async request(route,{method='GET',body,signal,...other}={}){
    if(Object.keys(other).length||!['GET','POST'].includes(method))throw fault('UNSUPPORTED');
    const url=this.routePolicy(route,method,body);
    if(url.protocol!=='https:'||url.username||url.password||url.hash)throw fault('UNSUPPORTED');
    // Generic transports remain read-only unless a contract is explicitly wired.
    if(method==='POST'&&!this.postContract)throw fault('POST_CONTRACT_UNVERIFIED');
    if(signal?.aborted)throw fault('CANCELED');
    let payload,postHeaders;
    if(method==='POST'){
      try{
        payload=JSON.stringify(body);
        if(typeof payload!=='string'||Buffer.byteLength(payload)>1024*1024)throw Error();
        // Validate the actual wire snapshot too: inherited/non-enumerable toJSON
        // must not replace an approved body after the initial policy check.
        const snapshot=JSON.parse(payload);
        if(this.routePolicy(route,method,snapshot).href!==url.href)throw Error();
        postHeaders=this.postContract(url,route,snapshot);
        if(!postHeaders||typeof postHeaders!=='object'||Array.isArray(postHeaders)||Object.keys(postHeaders).some(k=>!['Origin','X-CSRF-Token'].includes(k))||Object.values(postHeaders).some(v=>typeof v!=='string'||/[\r\n]/.test(v)))throw Error();
        // Only synthetic/injected contracts may supply their fixed CSRF fixture
        // headers. The production contract above returns no browser metadata.
        if(this.postContract!==tensorTonicPostContract){
          const origin=new URL(postHeaders.Origin);
          if(origin.protocol!=='https:'||origin.origin!==postHeaders.Origin)throw Error();
        }else if(Object.keys(postHeaders).length)throw Error();
      }catch{throw fault('UNSUPPORTED');}
    }
    const controller=new AbortController();let timedOut=false,dispatched=false,sessionInvalid=false,unauthorized=false;
    const abort=()=>controller.abort(fault('CANCELED'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(()=>{timedOut=true;controller.abort(fault('TIMEOUT'));},method==='POST'?this.postTimeoutMs:this.timeoutMs);
    try{return await this.vault.withSession(async(jar,actions)=>{
      if(controller.signal.aborted)throw fault(timedOut?'TIMEOUT':'CANCELED');
      const headers={Accept:'application/json',Cookie:jar.header(url)};
      if(method==='POST')Object.assign(headers,postHeaders,{'Content-Type':'application/json'});
        const response=await this.dispatch({url,method,headers,body:payload,signal:controller.signal,maxBytes:this.maxBytes,onDispatch:()=>{dispatched=true;}});
        if(controller.signal.aborted)throw fault(timedOut?'TIMEOUT':'CANCELED');
        if(!response||!Number.isSafeInteger(response.status)||response.status<100||response.status>599||!Buffer.isBuffer(response.body)||response.body.length>this.maxBytes)throw fault('INVALID_RESPONSE');
        if(response.status===401){unauthorized=true;sessionInvalid=true;await actions.clear();throw fault('AUTH_REQUIRED');}
        try{jar.applySetCookie(response.setCookie||[],url);}catch{sessionInvalid=true;await actions.clear();throw fault('COOKIE_POLICY');}
        if(!jar.canAuthenticate(this.vault.authURL)){sessionInvalid=true;await actions.clear();throw fault('AUTH_REQUIRED');}
        if(jar.changed)await actions.save();
        if(response.status>=300&&response.status<400)throw fault('REDIRECT_REFUSED');
        if(response.status>=500)throw fault('TRANSPORT_ERROR');
        if(response.status<200||response.status>=300){const e=fault('HTTP_ERROR');e.status=response.status;throw e;}
        try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.body));}catch{throw fault('INVALID_RESPONSE');}
    },{signal:controller.signal});}catch(error){
        if(method==='POST'&&dispatched&&!(error?.code==='HTTP_ERROR'||unauthorized&&error?.code==='AUTH_REQUIRED')){
          const uncertain=fault('UNCERTAIN_RESULT');
          if(sessionInvalid||['COOKIE_POLICY','AUTH_REQUIRED','STORAGE_UNAVAILABLE','STORAGE_TIMEOUT','STORAGE_CLEANUP_PENDING'].includes(error?.code))uncertain.sessionInvalid=true;
          // No raw server payload, cookie, or nested exception is exposed.
          throw uncertain;
        }
        if(sessionInvalid&&error&&typeof error==='object')error.sessionInvalid=true;
        if(['AUTH_REQUIRED','HTTP_ERROR','COOKIE_POLICY','STORAGE_UNAVAILABLE','STORAGE_BUSY','STORAGE_TIMEOUT','STORAGE_CLEANUP_PENDING','ROTATION_CLEANUP_PENDING','UNSUPPORTED','CANCELED','TIMEOUT','REDIRECT_REFUSED','INVALID_RESPONSE','TRANSPORT_ERROR'].includes(error?.code))throw error;
        throw fault(timedOut?'TIMEOUT':controller.signal.aborted?'CANCELED':'TRANSPORT_ERROR');
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
}
module.exports={SessionHttpTransport,dispatchHttps,tensorTonicRoute,tensorTonicPostContract,API_ORIGIN};
