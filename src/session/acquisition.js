'use strict';

const {CookieJar,cookieScope}=require('./cookie-jar');
const {fault}=require('./fault');
const plans=new WeakSet();
function exactURL(value){
  let url;try{url=new URL(value);}catch{throw fault('SESSION_SCOPE_UNVERIFIED');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.href!==value)throw fault('SESSION_SCOPE_UNVERIFIED');
  return url;
}
function acquisitionPlan({scope,entryURL,returnURLs,returnOrigin,sources,authURL}={}){
  if(!scope||!Array.isArray(scope.names)||!Array.isArray(returnURLs)||!returnURLs.length||returnURLs.length>4||!Array.isArray(sources)||!sources.length||sources.length>3)throw fault('SESSION_SCOPE_UNVERIFIED');
  scope=cookieScope(scope);
  const entry=exactURL(entryURL);const returns=returnURLs.map(value=>exactURL(value).href);
  if(new Set(returns).size!==returns.length||returns.some(value=>new URL(value).origin!==entry.origin))throw fault('SESSION_SCOPE_UNVERIFIED');
  if(returnOrigin!==undefined&&returnOrigin!==entry.origin)throw fault('SESSION_SCOPE_UNVERIFIED');
  const origins=new Set();const covered=new Set();
  const reads=sources.map(source=>{
    const url=exactURL(source.url);
    if(!scope.hosts.includes(url.hostname)||origins.has(url.origin)||!Array.isArray(source.names)||!source.names.length||new Set(source.names).size!==source.names.length||source.names.some(name=>!scope.names.includes(name)))throw fault('SESSION_SCOPE_UNVERIFIED');
    origins.add(url.origin);source.names.forEach(name=>covered.add(name));
    return Object.freeze({url:url.href,names:Object.freeze([...source.names])});
  });
  if(scope.names.some(name=>!covered.has(name))||!reads.some(source=>source.url===exactURL(authURL).href))throw fault('SESSION_SCOPE_UNVERIFIED');
  const plan=Object.freeze({scope,entryURL:entry.href,returnURLs:Object.freeze(returns),...(returnOrigin?{returnOrigin}:{}),sources:Object.freeze(reads),authURL});plans.add(plan);return plan;
}
function isAcquisitionPlan(plan){return plans.has(plan);}
function ownedReturnURL(plan,value){
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||String(value).length>4096)return undefined;return(plan.returnOrigin?url.origin===plan.returnOrigin:plan.returnURLs.includes(url.href))?url.href:undefined;}catch{return undefined;}
}
function bounded(promise,{signal,timeoutMs=10000}={}){
  return new Promise((resolve,reject)=>{
    let timer,done=false;
    const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
    const abort=()=>finish(reject,fault('CANCELED'));
    Promise.resolve(promise).then(value=>finish(resolve,value),()=>finish(reject,fault('ACQUISITION_FAILED')));
    timer=setTimeout(()=>finish(reject,fault('TIMEOUT')),timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

// A source may expose only a newly owned tab, exact-URL cookie reads, and close.
// Production supplies a fixed verified policy; tests supply synthetic sources.
class BrowserSessionAcquirer{
  constructor({plan,source,confirm,waitForLogin,timeoutMs=10000,userTimeoutMs=300000}={}){
    if(!isAcquisitionPlan(plan)||typeof source?.openOwned!=='function'||typeof confirm!=='function'||typeof waitForLogin!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isFinite(userTimeoutMs)||userTimeoutMs<1||userTimeoutMs>600000)throw fault('SESSION_SCOPE_UNVERIFIED');
    Object.assign(this,{plan,source,confirm,waitForLogin,timeoutMs,userTimeoutMs});this.resources=new Set();this.background=new Set();
  }
  get hasOwnedResources(){return this.resources.size>0||!!this.source.hasOwnedResources;}
  get cleanupPending(){return this.hasOwnedResources;}
  async _close(resource){
    if(!resource.handle)return;
    await bounded(Promise.resolve().then(()=>resource.handle.close()),{timeoutMs:this.timeoutMs});this.resources.delete(resource);
  }
  async close(){
    const results=await Promise.allSettled([...this.resources].map(resource=>this._close(resource)));
    let sourceFailed=false;try{if(this.source.close)await bounded(Promise.resolve().then(()=>this.source.close()),{timeoutMs:this.timeoutMs});}catch{sourceFailed=true;}
    if(sourceFailed||results.some(result=>result.status==='rejected')||this.hasOwnedResources)throw fault('ACQUISITION_CLEANUP_PENDING');
  }
  async acquire({confirmed=false,signal}={}){
    if(!confirmed)throw fault('CONSENT_REQUIRED');if(signal?.aborted)throw fault('CANCELED');
    if(this.acquiring||this.resources.size)throw fault('ACQUISITION_CLEANUP_PENDING');this.acquiring=true;
    const externalSignal=signal,controller=new AbortController(),abort=()=>controller.abort();externalSignal?.addEventListener('abort',abort,{once:true});if(externalSignal?.aborted)abort();signal=controller.signal;
    let resource;const batches=[];
    try{
      // The consent payload contains scope metadata only, never credentials.
      const consent={loginOrigin:new URL(this.plan.entryURL).origin,sources:this.plan.sources.map(s=>({url:s.url,names:[...s.names]})),domains:[...this.plan.scope.domains],attributes:this.plan.scope.attributes,requireSecure:this.plan.scope.requireSecure,requireHttpOnly:this.plan.scope.requireHttpOnly,retention:this.plan.scope.retention,maxLocalAgeMs:this.plan.scope.maxLocalAgeMs};
      if(await bounded(Promise.resolve().then(()=>this.confirm(consent,{signal})),{signal,timeoutMs:this.userTimeoutMs})!==true)throw fault('CANCELED');
      if(signal?.aborted)throw fault('CANCELED');
      resource={};this.resources.add(resource);let abandoned=false;
      const opened=Promise.resolve().then(()=>this.source.openOwned(this.plan.entryURL,{signal})).then(async handle=>{
        resource.handle=handle;if(abandoned)await this._close(resource);return handle;
      },error=>{this.resources.delete(resource);throw error;});
      try{await bounded(opened,{signal,timeoutMs:this.timeoutMs});}
      catch(error){abandoned=true;const cleanup=opened.catch(()=>{});this.background.add(cleanup);cleanup.finally(()=>this.background.delete(cleanup));throw error;}
      const handle=resource.handle;
      if(!['getURL','readCookies','close'].every(name=>typeof handle?.[name]==='function'))throw fault('ACQUISITION_FAILED');
      if(await bounded(Promise.resolve().then(()=>this.waitForLogin({getURL:()=>handle.getURL(),...(handle.onDidClose?{onDidClose:listener=>handle.onDidClose(listener)}:{})},{signal})),{signal,timeoutMs:this.userTimeoutMs})!==true)throw fault('CANCELED');
      const guard=()=>{if(signal?.aborted)throw fault('CANCELED');if(!ownedReturnURL(this.plan,handle.getURL()))throw fault('ACQUISITION_PAGE_CHANGED');};
      const jar=new CookieJar(this.plan.scope);const seen=new Map();
      for(const source of this.plan.sources){
        guard();const cookies=await bounded(Promise.resolve().then(()=>handle.readCookies({url:source.url,names:[...source.names],signal})),{signal,timeoutMs:this.timeoutMs});guard();
        if(!Array.isArray(cookies)||cookies.length>16||cookies.some(cookie=>!source.names.includes(cookie?.name)))throw fault('COOKIE_POLICY');
        const selected=[];
        for(const cookie of cookies){
          const key=JSON.stringify([cookie.name,cookie.domain,cookie.path]);const encoded=JSON.stringify(cookie);
          if(seen.has(key)&&seen.get(key)!==encoded)throw fault('COOKIE_POLICY');
          if(!seen.has(key)){seen.set(key,encoded);selected.push({...cookie});}
        }
        jar.importCookies(selected,source.url);batches.push({sourceURL:source.url,cookies:selected});
      }
      if(!jar.canAuthenticate(this.plan.authURL))throw fault('AUTH_REQUIRED');guard();
      return{batches,close:async()=>{try{await this._close(resource);}catch{throw fault('ACQUISITION_CLEANUP_PENDING');}finally{for(const batch of batches)batch.cookies.length=0;}}};
    }catch(error){
      if(resource?.handle)try{await this._close(resource);}catch{const cleanup=fault('ACQUISITION_CLEANUP_PENDING');cleanup.causeCode=['CONSENT_REQUIRED','CANCELED','TIMEOUT','COOKIE_POLICY','ACQUISITION_CLEANUP_PENDING','ACQUISITION_PAGE_CHANGED'].includes(error.code)?error.code:'ACQUISITION_FAILED';throw cleanup;}
      if(['AUTH_REQUIRED','CONSENT_REQUIRED','CANCELED','TIMEOUT','COOKIE_POLICY','ACQUISITION_CLEANUP_PENDING','ACQUISITION_PAGE_CHANGED'].includes(error.code))throw error;
      throw fault('ACQUISITION_FAILED');
    }finally{controller.abort();externalSignal?.removeEventListener('abort',abort);this.acquiring=false;}
  }
}
module.exports={acquisitionPlan,isAcquisitionPlan,ownedReturnURL,BrowserSessionAcquirer,bounded};
