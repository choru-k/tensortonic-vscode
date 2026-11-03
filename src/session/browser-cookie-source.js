'use strict';

const {isAcquisitionPlan,ownedReturnURL,bounded}=require('./acquisition');
const {fault}=require('./fault');

// CDP has no name-filter parameter. Query only the exact reviewed URL, then
// discard non-session names before returning any cookie to the acquirer.
function selectedCDPCookies(reply,names,{now=Date.now(),sessionLifetimeMs}={}){
  if(!Array.isArray(reply?.cookies)||reply.cookies.length>256)throw fault('COOKIE_POLICY');
  const selected=reply.cookies.filter(cookie=>names.includes(cookie?.name));
  if(selected.length>16)throw fault('COOKIE_POLICY');
  return selected.map((cookie,created)=>{
    if(typeof cookie.domain!=='string'||cookie.partitionKey||cookie.partitionKeyOpaque||cookie.sameParty===true||typeof cookie.session!=='boolean'||!Number.isFinite(cookie.expires))throw fault('COOKIE_POLICY');
    if(cookie.session&&(!Number.isSafeInteger(sessionLifetimeMs)||sessionLifetimeMs<1000||sessionLifetimeMs>86400000))throw fault('COOKIE_POLICY');
    // Chromium represents host-only cookies by a domain without a leading dot.
    // Partitioned cookies need a separate context-aware design and are refused.
    return{name:cookie.name,value:cookie.value,domain:cookie.domain.replace(/^\./,''),hostOnly:!cookie.domain.startsWith('.'),path:cookie.path,secure:cookie.secure,httpOnly:cookie.httpOnly,sameSite:cookie.sameSite??null,expiresAt:cookie.session?now+sessionLifetimeMs:cookie.expires*1000,persistent:!cookie.session,created};
  });
}

class ProposedBrowserCookieSource{
  constructor(vscode,{plan,timeoutMs=10000}={}){
    if(!isAcquisitionPlan(plan)||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw fault('SESSION_SCOPE_UNVERIFIED');
    Object.assign(this,{vscode,plan,timeoutMs});this.resources=new Set();this.nextId=0;
  }
  get hasOwnedResources(){return this.resources.size>0;}
  _notifyClosed(r){for(const listener of r.closeListeners)listener();r.closeListeners.clear();}
  async _step(r,key,create,signal){
    const raw=Promise.resolve().then(create).then(value=>{r[key]=value;return value;});
    r.opening.add(raw);const settled=()=>{r.opening.delete(raw);if(r.abandoned)void this._close(r).catch(()=>{});};raw.then(settled,settled);
    return bounded(raw,{signal,timeoutMs:this.timeoutMs});
  }
  _onMessage(r,message){
    if(!message||typeof message!=='object')return;
    if(Number.isSafeInteger(message.id)){
      const request=r.requests.get(message.id);if(!request||request.sessionId!==message.sessionId)return;
      if(message.error)request.reject(fault('ACQUISITION_FAILED'));else request.resolve(message.result);return;
    }
    if(message.method==='Target.attachedToTarget'&&!message.sessionId&&message.params?.targetInfo?.type==='page'&&typeof message.params.targetInfo.vscodeBrowserViewId==='string'&&typeof message.params.sessionId==='string')r.targets.add(message.params.sessionId);
    if(message.method==='Target.detachedFromTarget'&&!message.sessionId)r.targets.delete(message.params?.sessionId);
  }
  async _request(r,method,params,sessionId,signal){
    if(r.closed||!r.group||signal?.aborted)throw fault('CANCELED');
    if(method==='Target.setAutoAttach'){
      if(sessionId||params.flatten!==true||params.waitForDebuggerOnStart!==false||typeof params.autoAttach!=='boolean')throw fault('UNSUPPORTED');
    }else if(!['Page.getFrameTree','Network.getCookies'].includes(method)||r.targets.size!==1||!r.targets.has(sessionId))throw fault('ACQUISITION_PAGE_CHANGED');
    if(method==='Network.getCookies'&&(!Array.isArray(params.urls)||params.urls.length!==1||!this.plan.sources.some(source=>source.url===params.urls[0])))throw fault('UNSUPPORTED');
    const id=++this.nextId;let resolve,reject;const reply=new Promise((yes,no)=>{resolve=yes;reject=no;});reply.catch(()=>{});r.requests.set(id,{sessionId,resolve,reject});
    try{
      await bounded(Promise.resolve().then(()=>r.group.sendMessage({id,method,params,...(sessionId?{sessionId}:{})})),{signal,timeoutMs:this.timeoutMs});
      return await bounded(reply,{signal,timeoutMs:this.timeoutMs});
    }finally{r.requests.delete(id);}
  }
  async _close(r){
    r.abandoned=true;for(const request of r.requests.values())request.reject(fault('CANCELED'));r.requests.clear();
    const tasks=[];
    if(r.group&&!r.groupClosed)tasks.push(bounded(Promise.resolve().then(()=>r.group.close()),{timeoutMs:this.timeoutMs}).then(()=>{r.groupClosed=true;}));
    if(r.tab&&!r.tabClosed)tasks.push(bounded(Promise.resolve().then(()=>r.tab.close()),{timeoutMs:this.timeoutMs}).then(()=>{r.tabClosed=true;}));
    const results=await Promise.allSettled(tasks);
    if(results.some(result=>result.status==='rejected'))throw fault('ACQUISITION_CLEANUP_PENDING');
    if(r.opening.size)throw fault('ACQUISITION_CLEANUP_PENDING');
    r.closed=true;this._notifyClosed(r);for(const listener of r.listeners)listener.dispose();r.listeners=[];this.resources.delete(r);
  }
  async close(){
    const results=await Promise.allSettled([...this.resources].map(r=>this._close(r)));
    if(results.some(result=>result.status==='rejected')||this.resources.size)throw fault('ACQUISITION_CLEANUP_PENDING');
  }
  async openOwned(entryURL,{signal}={}){
    if(entryURL!==this.plan.entryURL||this.resources.size||this.vscode.workspace?.isTrusted!==true||this.vscode.env?.remoteName||this.vscode.env?.uiKind===2||typeof this.vscode.window?.openBrowserTab!=='function')throw fault('SESSION_SCOPE_UNVERIFIED');
    if(signal?.aborted)throw fault('CANCELED');
    const r={targets:new Set(),requests:new Map(),opening:new Set(),listeners:[],closeListeners:new Set(),closed:false};this.resources.add(r);
    try{
      await this._step(r,'tab',()=>this.vscode.window.openBrowserTab(entryURL,{preserveFocus:false,background:false}),signal);
      if(this.vscode.window.onDidCloseBrowserTab)r.listeners.push(this.vscode.window.onDidCloseBrowserTab(tab=>{if(tab===r.tab){r.tabClosed=true;this._notifyClosed(r);}}));
      await this._step(r,'group',()=>r.tab.startCDPSession(),signal);
      r.listeners.push(r.group.onDidReceiveMessage(message=>this._onMessage(r,message)));
      r.listeners.push(r.group.onDidClose(()=>{r.groupClosed=true;this._notifyClosed(r);for(const request of r.requests.values())request.reject(fault('CANCELED'));r.requests.clear();}));
      await this._request(r,'Target.setAutoAttach',{autoAttach:true,flatten:true,waitForDebuggerOnStart:false},undefined,signal);
      const deadline=Date.now()+this.timeoutMs;
      while(r.targets.size===0&&Date.now()<deadline){if(signal?.aborted)throw fault('CANCELED');await new Promise(resolve=>setTimeout(resolve,10));}
      if(r.targets.size!==1)throw fault('ACQUISITION_PAGE_CHANGED');
      return{
        getURL:()=>r.tab.url,
        onDidClose:listener=>{if(r.closed||r.tabClosed||r.groupClosed)listener();else r.closeListeners.add(listener);return{dispose:()=>r.closeListeners.delete(listener)};},
        readCookies:async({url,names,signal})=>{
          const source=this.plan.sources.find(source=>source.url===url);
          if(!source||JSON.stringify(names)!==JSON.stringify(source.names)||r.closed||r.tabClosed||r.groupClosed||r.targets.size!==1)throw fault('UNSUPPORTED');
          const guard=()=>{if(r.abandoned||signal?.aborted||!ownedReturnURL(this.plan,r.tab.url)||r.targets.size!==1)throw fault('ACQUISITION_PAGE_CHANGED');};
          guard();const sessionId=[...r.targets][0];const tree=await this._request(r,'Page.getFrameTree',{},sessionId,signal);guard();
          if(ownedReturnURL(this.plan,tree?.frameTree?.frame?.url)!==ownedReturnURL(this.plan,r.tab.url)||tree.frameTree.frame.parentId)throw fault('ACQUISITION_PAGE_CHANGED');
          const reply=await this._request(r,'Network.getCookies',{urls:[source.url]},sessionId,signal);guard();
          // Check top-frame ownership again after the secret-bearing response.
          const after=await this._request(r,'Page.getFrameTree',{},sessionId,signal);guard();
          if(ownedReturnURL(this.plan,after?.frameTree?.frame?.url)!==ownedReturnURL(this.plan,r.tab.url)||after.frameTree.frame.parentId)throw fault('ACQUISITION_PAGE_CHANGED');
          return selectedCDPCookies(reply,source.names,{sessionLifetimeMs:this.plan.scope.retention==='bounded'?this.plan.scope.maxLocalAgeMs:undefined});
        },
        close:()=>this._close(r),
      };
    }catch(error){r.abandoned=true;try{await this._close(r);}catch{throw fault('ACQUISITION_CLEANUP_PENDING');}if(['CANCELED','TIMEOUT','ACQUISITION_PAGE_CHANGED','UNSUPPORTED','SESSION_SCOPE_UNVERIFIED'].includes(error.code))throw error;throw fault('ACQUISITION_FAILED');}
  }
}
module.exports={ProposedBrowserCookieSource,selectedCDPCookies};
