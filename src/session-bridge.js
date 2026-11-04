'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {NativeBrowserBridge}=require('./native-browser-bridge');
const {SessionVault}=require('./session/vault');
const {SessionHttpTransport}=require('./session/http');
const {fault}=require('./session/fault');
const {summary:diagnosticSummary}=require('./session/diagnostic');

// Phase-one candidate: no real cookie names/domains or acquisition adapter are
// guessed. Explicitly reviewed production scope/acquisition is a later change.
// Tests supply a synthetic vault/transport/acquirer; no test route is added to
// the production allowlist or exposed through user configuration.
class SessionBridge {
  constructor(vscode,context,{vault,transport,acquire,acquisition,display,verifySession,diagnostic}={}){
    this.vscode=vscode;this.context=context;this.vault=vault;this.transport=transport;
    this.acquisition=acquisition;this.acquire=acquisition?options=>acquisition.acquire(options):acquire;this.acquisitionOwners=new Set();this.display=display;this.connected=false;this.generation=0;
    this.diagnostic=diagnostic;this.verifySession=verifySession;this.supportsGrading=transport?.supportsGrading===true;this.controllers=new Set();this.disposed=false;
  }
  _trusted(){if(this.disposed||this.vscode.workspace?.isTrusted!==true||this.vscode.env?.remoteName||this.vscode.env?.uiKind===2)throw fault('UNSUPPORTED');}
  _configured(){
    if(!this.vault||!this.transport)throw fault('SESSION_SCOPE_UNVERIFIED');
  }
  _connected(value){if(this.connected!==value){this.connected=value;this.onDidChange?.();}}
  async start(options={}){
    this.diagnosticController?.abort();
    if(this.restoring)await this.restoring;
    if(this.starting)return this.starting;
    const task=this._start(options);this.starting=task;
    try{return await task;}finally{if(this.starting===task)this.starting=undefined;}
  }
  async _start({signal,confirmed=false}={}){
    this._trusted();this._configured();if(signal?.aborted)throw fault('CANCELED');
    if(this.acquisitionOwners.size||this.acquisition?.cleanupPending||this.lastCleanup?.acquisition?.closed===false)throw fault('ACQUISITION_CLEANUP_PENDING');
    this.lastCleanup=undefined;
    this.token=undefined;this._connected(false);
    const externalSignal=signal,generation=this.generation,controller=new AbortController();this.connectController=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    signal=controller.signal;
    try{
    const expectedEpoch=await this.vault.captureAcquisitionFence({signal});
    const ready=await this.vault.ready({signal});
    if(signal?.aborted||generation!==this.generation)throw fault('CANCELED');
    if(!ready){
      if(!confirmed)throw fault('CONSENT_REQUIRED');
      if(typeof this.acquire!=='function')throw fault('SESSION_SCOPE_UNVERIFIED');
      const captured=await this.acquire({signal,confirmed:true});
      if(typeof captured?.close==='function')this.acquisitionOwners.add(captured);
      let importError,storedSession=false;
      try{
        if(signal?.aborted||generation!==this.generation)throw fault('CANCELED');
        if(captured.batches)await this.vault.importCookieBatches(captured.batches,{confirmed:true,expectedEpoch,signal});
        else await this.vault.importCookies(captured.cookies,{sourceURL:captured.sourceURL,confirmed:true,expectedEpoch,signal});
        storedSession=true;
      }catch(error){importError=error;storedSession=error.cleanup?.activeSessionCommitted===true;}
      try{await this._closeAcquisitionOwner(captured);}
      catch{
        this.lastCleanup={...this.lastCleanup,acquisition:{closed:false,errorCode:'ACQUISITION_CLEANUP_PENDING'}};
        const error=fault('ACQUISITION_CLEANUP_PENDING');error.acquisition={storedSession,closed:false,...(importError?{importCode:fault(importError.code).code}:{})};error.cleanup=this.lastCleanup;throw error;
      }
      if(importError)throw importError;
    }
    if(signal?.aborted||generation!==this.generation)throw fault('CANCELED');
    await this.vault.assertAcquisitionFence(expectedEpoch,{signal});
    if(this.verifySession)await this.verifySession({signal});
    if(signal?.aborted||generation!==this.generation)throw fault('CANCELED');
    await this.vault.assertAcquisitionFence(expectedEpoch,{signal});
    this.token=crypto.randomUUID();this._connected(true);return true;
    }finally{externalSignal?.removeEventListener('abort',abort);if(this.connectController===controller)this.connectController=undefined;}
  }
  connect(options){return this.start(options);}
  async checkStoredSession({signal}={}){
    try{return await this.start({confirmed:false,signal});}
    catch(error){if(error.code==='CONSENT_REQUIRED')throw fault('AUTH_REQUIRED');throw error;}
  }
  get hasOwnedResources(){return this.acquisitionOwners.size>0||!!this.acquisition?.hasOwnedResources||!!this.display?.hasOwnedResources;}
  get pending(){return this.controllers.size>0||!!this.diagnosticController;}
  get cleanupPending(){return this.acquisitionOwners.size>0||!!this.acquisition?.cleanupPending||this.lastCleanup?.acquisition?.closed===false||this.lastCleanup?.presentation?.closed===false||!!this.display?.cleanupPending||!!this.vault?.cleanupPending;}
  confirmConnection(options){return this.start(options);}
  restore(){
    this.diagnosticController?.abort();
    if(this.restoring)return this.restoring;if(this.starting||this.connected)return Promise.resolve(this.connected);
    const controller=new AbortController(),generation=this.generation;this.restoreController=controller;
    const task=(async()=>{
      this._trusted();this._configured();const ready=await this.vault.ready({signal:controller.signal});
      if(controller.signal.aborted||generation!==this.generation)throw fault('CANCELED');
      this.token=ready?crypto.randomUUID():undefined;this._connected(ready);return ready;
    })();this.restoring=task;
    task.finally(()=>{if(this.restoring===task)this.restoring=undefined;if(this.restoreController===controller)this.restoreController=undefined;}).catch(()=>{});return task;
  }
  async request(route,options={}){
    this.diagnosticController?.abort();
    this._trusted();this._configured();if(!this.connected)throw fault('AUTH_REQUIRED');
    const controller=new AbortController(),generation=this.generation;
    const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    this.controllers.add(controller);
    try{
      const value=await this.transport.request(route,{...options,signal:controller.signal});
      if(generation!==this.generation)throw fault(options.method==='POST'?'UNCERTAIN_RESULT':'CANCELED');
      return value;
    }catch(error){if(error.sessionInvalid===true||['AUTH_REQUIRED','COOKIE_POLICY','STORAGE_TIMEOUT','STORAGE_UNAVAILABLE','STORAGE_CLEANUP_PENDING'].includes(error.code)){this.token=undefined;this._connected(false);}throw error;}
    finally{this.controllers.delete(controller);options.signal?.removeEventListener('abort',abort);}
  }
  async diagnoseStoredSession(options={}){
    let controller,externalSignal,abort;
    try{
      if(!options||typeof options!=='object'||Object.keys(options).some(key=>key!=='signal'))return diagnosticSummary('UNSUPPORTED');
      externalSignal=options.signal;
      if(externalSignal&&(!(externalSignal instanceof AbortSignal)))return diagnosticSummary('UNSUPPORTED');
      const generation=this.generation;
      const check=()=>{
        this._trusted();
        if(generation!==this.generation)throw {code:'SESSION_CHANGED'};
        if(!this.connected)throw {code:'AUTH_REQUIRED'};
        if(this.starting||this.restoring||this.controllers.size||this.diagnosticController&&this.diagnosticController!==controller)throw {code:'SESSION_BUSY'};
        if(this.hasOwnedResources)throw {code:'OWNED_RESOURCES'};
        if(this.cleanupPending)throw {code:'CLEANUP_PENDING'};
        if(typeof this.diagnostic!=='function')throw {code:'UNSUPPORTED'};
      };
      check();controller=new AbortController();this.diagnosticController=controller;
      abort=()=>controller.abort();externalSignal?.addEventListener('abort',abort,{once:true});if(externalSignal?.aborted)abort();
      return await this.diagnostic({signal:controller.signal,assertCurrent:check});
    }catch(error){return diagnosticSummary(error?.code);}
    finally{externalSignal?.removeEventListener?.('abort',abort);if(controller&&this.diagnosticController===controller)this.diagnosticController=undefined;}
  }
  async openProblemPage(url,options){
    this.diagnosticController?.abort();
    this._trusted();
    // Optional Web presentation owns its own page/CDP lifetime. Closing every
    // display tab never invalidates or refreshes the independently stored jar.
    this.display??=new NativeBrowserBridge(this.vscode);
    return this.display.openProblemPage(url,options);
  }
  _cancelAndDisconnect(){
    this.generation++;this.diagnosticController?.abort();this.connectController?.abort();this.restoreController?.abort();for(const controller of this.controllers)controller.abort();
    this.token=undefined;this._connected(false);
  }
  async _cleanupOperation(work,code){
    let timer;try{await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault(code)),5000);})]);return{closed:true};}
    catch{return{closed:false,errorCode:code};}finally{clearTimeout(timer);}
  }
  async _closeAcquisitionOwner(owner){
    if(typeof owner?.close!=='function')return;
    const result=await this._cleanupOperation(()=>owner.close(),'ACQUISITION_CLEANUP_PENDING');
    if(!result.closed)throw fault('ACQUISITION_CLEANUP_PENDING');this.acquisitionOwners.delete(owner);
  }
  async _cleanupAcquisition(){
    const results=await Promise.allSettled([...this.acquisitionOwners].map(owner=>this._closeAcquisitionOwner(owner)));
    const source=await this._cleanupOperation(()=>this.acquisition?.close(),'ACQUISITION_CLEANUP_PENDING');
    const closed=results.every(result=>result.status==='fulfilled')&&source.closed&&!this.acquisitionOwners.size&&!this.acquisition?.hasOwnedResources&&!this.acquisition?.cleanupPending;
    return closed?{closed:true}:{closed:false,errorCode:'ACQUISITION_CLEANUP_PENDING'};
  }
  async stop(){
    this._cancelAndDisconnect();
    const [acquisition,presentation]=await Promise.all([this._cleanupAcquisition(),this._cleanupOperation(()=>this.display?.stop(),'DISPLAY_CLEANUP_PENDING')]);
    this.lastCleanup={acquisition,presentation};
    if(!acquisition.closed||!presentation.closed){const error=fault(!acquisition.closed?'ACQUISITION_CLEANUP_PENDING':'DISPLAY_CLEANUP_PENDING');error.cleanup=this.lastCleanup;throw error;}
  }
  async revoke(){
    this._cancelAndDisconnect();
    const credentials=Promise.resolve().then(()=>this.vault?this.vault.clear():{activeCredentialCleared:true,credentialsDeleted:true,pendingDeleteCount:0,uncertainNativeWriteCount:0}).catch(()=>({activeCredentialCleared:false,credentialsDeleted:false,errorCode:'STORAGE_UNAVAILABLE'}));
    const presentation=this._cleanupOperation(()=>this.display?.stop(),'DISPLAY_CLEANUP_PENDING');
    const [credentialResult,presentationResult,acquisitionResult]=await Promise.all([credentials,presentation,this._cleanupAcquisition()]);
    this.lastCleanup={credentials:credentialResult,presentation:presentationResult,acquisition:acquisitionResult};
    let code;if(!credentialResult.activeCredentialCleared)code='STORAGE_UNAVAILABLE';else if(!credentialResult.credentialsDeleted)code='STORAGE_CLEANUP_PENDING';else if(!acquisitionResult.closed)code='ACQUISITION_CLEANUP_PENDING';else if(!presentationResult.closed)code='DISPLAY_CLEANUP_PENDING';
    if(code){const error=fault(code);error.cleanup=this.lastCleanup;throw error;}return this.lastCleanup;
  }
  shutdown(){return this.stop();}
  async dispose(){this.disposed=true;try{await this.stop();}finally{await this.display?.dispose();}}
}

// Kept explicit for the next reviewed phase. Not called by phase-one activation.
// A reviewed cookieScope must be provided; no arbitrary-origin setting exists.
function configuredSessionBridge(vscode,context,{scope,acquire,acquisition}={}){
  if(!scope)throw fault('SESSION_SCOPE_UNVERIFIED');
  const directory=path.join(context.globalStorageUri.fsPath,'session-state');
  const vault=new SessionVault(context.secrets,{scope,directory,authURL:'https://api.tensortonic.com/api/me'});
  return new SessionBridge(vscode,context,{vault,transport:new SessionHttpTransport(vault),acquire,acquisition});
}
module.exports={SessionBridge,configuredSessionBridge};
