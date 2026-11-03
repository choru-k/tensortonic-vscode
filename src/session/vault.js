'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {CookieJar}=require('./cookie-jar');const {SessionMutex}=require('./mutex');const {fault}=require('./fault');
const SECRET_KEY='tensortonic.http-session.v1';
const KEY=/^tensortonic\.http-session\.v1\.[a-f0-9-]{36}$/;
function abortFault(signal){return fault(signal?.reason?.code==='TIMEOUT'?'TIMEOUT':'CANCELED');}

// Values/attributes live ONLY in immutable SecretStorage generations. This
// nonsecret index holds local key references and a shared revocation epoch.
// A timed-out/dead native caller can never commit a late active generation.
class SessionVault {
  constructor(secrets,{scope,directory,authURL,now=Date.now,mutex,providerTimeoutMs=5000}={}){
    if(!secrets||!['get','store','delete'].every(k=>typeof secrets[k]==='function')||!scope||typeof directory!=='string'||!Number.isFinite(providerTimeoutMs)||providerTimeoutMs<1||providerTimeoutMs>60000)throw fault('STORAGE_UNAVAILABLE');
    Object.assign(this,{secrets,scope,directory,authURL,now,providerTimeoutMs});this.mutex=mutex||new SessionMutex(directory);
    this.index=path.join(directory,'session-index.json');this.background=new Set();this.pendingNativeWrites=0;this.pendingDeletes=0;
  }
  async _read(){
    let text;
    try{const stat=await fs.lstat(this.index);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>20000)throw Error();text=await fs.readFile(this.index,'utf8');}
    catch(e){if(e.code==='ENOENT')return{version:2,epoch:0,activeKey:null,pending:[]};throw fault('STORAGE_UNAVAILABLE');}
    try{
      const s=JSON.parse(text);
      if(s.version!==2||!Number.isSafeInteger(s.epoch)||s.epoch<0||s.activeKey!==null&&!KEY.test(s.activeKey)||!Array.isArray(s.pending)||s.pending.length>64||s.pending.some(x=>!x||!KEY.test(x.key)||typeof x.uncertain!=='boolean')||new Set(s.pending.map(x=>x.key)).size!==s.pending.length||s.pending.some(x=>x.key===s.activeKey))throw Error();
      this._status(s);return s;
    }catch{throw fault('STORAGE_UNAVAILABLE');}
  }
  _status(s){this.pendingNativeWrites=s.pending.filter(x=>x.uncertain).length;this.pendingDeletes=s.pending.length;}
  async _write(s){
    if(s.pending.length>64)throw fault('STORAGE_UNAVAILABLE');
    const temporary=path.join(this.directory,'.index-'+crypto.randomUUID());
    try{const file=await fs.open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(s)+'\n');await file.sync();}finally{await file.close();}await fs.rename(temporary,this.index);this._status(s);}
    catch{throw fault('STORAGE_UNAVAILABLE');}finally{await fs.unlink(temporary).catch(()=>{});}
  }
  _retired(s){return[...s.pending,...(s.activeKey?[{key:s.activeKey,uncertain:false}]:[])];}
  _raw(kind,key,value){return Promise.resolve().then(()=>kind==='store'?this.secrets.store(key,value):this.secrets[kind](key));}
  _await(raw,{signal,timeoutMs=this.providerTimeoutMs}={}){
    return new Promise((resolve,reject)=>{
      let done=false,timer;const finish=(fn,v)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(v);};
      const abort=()=>finish(reject,abortFault(signal));
      raw.then(value=>finish(resolve,value),()=>finish(reject,fault('STORAGE_UNAVAILABLE')));
      timer=setTimeout(()=>finish(reject,fault('STORAGE_TIMEOUT')),Math.max(1,timeoutMs));
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  }
  _track(promise){this.background.add(promise);promise.catch(()=>{}).finally(()=>this.background.delete(promise));}
  _watchStore(raw,key){
    this._track(raw.then(()=>this._settledStore(key),()=>this._settledStore(key)));
  }
  async _settledStore(key){
    await this.mutex.run(async()=>{
      const s=await this._read(),entry=s.pending.find(x=>x.key===key);
      if(!entry||s.activeKey===key)return;
      entry.uncertain=false;await this._write(s);await this._collect(s);
    });
  }
  _watchDelete(raw,key){
    this._track(raw.then(()=>this.mutex.run(async()=>{
      const s=await this._read();if(s.activeKey===key)return;
      // A confirmed delete cannot fence a still-pending store. Its durable
      // reference remains until that store settles or a future host cleans it.
      s.pending=s.pending.filter(x=>x.key!==key||x.uncertain);await this._write(s);
    }),()=>{}));
  }
  async _collect(s,{signal}={}){
    const keep=[],errors=[];const start=performance.now();
    for(const entry of s.pending){
      const remaining=this.providerTimeoutMs-(performance.now()-start);
      if(signal?.aborted||remaining<=0){keep.push(entry);errors.push(signal?.aborted?abortFault(signal).code:'STORAGE_TIMEOUT');continue;}
      const raw=this._raw('delete',entry.key);
      try{await this._await(raw,{signal,timeoutMs:remaining});if(entry.uncertain)keep.push(entry);}
      catch(error){keep.push(entry);errors.push(error.code);this._watchDelete(raw,entry.key);}
    }
    s.pending=keep;await this._write(s);
    return{pendingDeleteCount:keep.length,uncertainNativeWriteCount:keep.filter(x=>x.uncertain).length,errorCodes:[...new Set(errors)]};
  }
  async _save(jar,{signal}={}){
    const previous=await this._read(),key=SECRET_KEY+'.'+crypto.randomUUID(),pending=this._retired(previous);
    if(signal?.aborted)throw abortFault(signal);
    await this._write({version:2,epoch:previous.epoch,activeKey:null,pending:[...pending,{key,uncertain:true}]});
    const raw=this._raw('store',key,JSON.stringify(jar.record()));
    try{await this._await(raw,{signal});if(signal?.aborted)throw abortFault(signal);}
    catch(error){this._watchStore(raw,key);throw error;}
    const committed={version:2,epoch:previous.epoch,activeKey:key,pending};await this._write(committed);
    const cleanup=await this._collect(committed,{signal});jar.changed=false;
    if(cleanup.errorCodes.length){const error=fault('ROTATION_CLEANUP_PENDING');error.cleanup={activeSessionCommitted:true,activeCredentialCleared:false,...cleanup};throw error;}
  }
  async _clear({signal}={}){
    const s=await this._read();if(!Number.isSafeInteger(s.epoch+1))throw fault('STORAGE_UNAVAILABLE');
    s.pending=this._retired(s);s.activeKey=null;s.epoch++;
    // Revocation commits before any optional/native provider deletion, even
    // when deletion hangs, is canceled, or the display page cannot close.
    await this._write(s);const cleanup=await this._collect(s,{signal});
    return{activeCredentialCleared:true,credentialsDeleted:cleanup.pendingDeleteCount===0,...cleanup};
  }
  captureAcquisitionFence({signal}={}){return this.mutex.run(async()=>{if(signal?.aborted)throw abortFault(signal);return(await this._read()).epoch;},{signal});}
  assertAcquisitionFence(epoch,{signal}={}){return this.mutex.run(async()=>{if((await this._read()).epoch!==epoch)throw fault('CANCELED');return true;},{signal});}
  async importCookies(cookies,{sourceURL,confirmed=false,expectedEpoch,signal}={}){
    return this.importCookieBatches([{cookies,sourceURL}],{confirmed,expectedEpoch,signal});
  }
  async importCookieBatches(batches,{confirmed=false,expectedEpoch,signal}={}){
    if(!confirmed)throw fault('CONSENT_REQUIRED');
    if(!Number.isSafeInteger(expectedEpoch)||expectedEpoch<0)throw fault('ACQUISITION_FENCE_REQUIRED');
    if(!Array.isArray(batches)||!batches.length||batches.length>3)throw fault('COOKIE_POLICY');
    return this.mutex.run(async()=>{
      if(signal?.aborted)throw abortFault(signal);
      if((await this._read()).epoch!==expectedEpoch)throw fault('CANCELED');
      const jar=new CookieJar(this.scope,{now:this.now});for(const batch of batches)jar.importCookies(batch.cookies,batch.sourceURL);
      if(!jar.canAuthenticate(this.authURL))throw fault('COOKIE_POLICY');await this._save(jar,{signal});return true;
    },{signal});
  }
  async withSession(work,{signal}={}){
    return this.mutex.run(async()=>{
      if(signal?.aborted)throw abortFault(signal);
      const s=await this._read();if(!s.activeKey)throw fault('AUTH_REQUIRED');
      const encoded=await this._await(this._raw('get',s.activeKey),{signal});
      if(typeof encoded!=='string'){await this._clear({signal});throw fault('AUTH_REQUIRED');}
      let jar;try{if(encoded.length>150000)throw Error();jar=new CookieJar(this.scope,{now:this.now,record:JSON.parse(encoded)});}catch{await this._clear({signal});throw fault('AUTH_REQUIRED');}
      if(!jar.canAuthenticate(this.authURL)){await this._clear({signal});throw fault('AUTH_REQUIRED');}
      return work(jar,{save:()=>this._save(jar,{signal}),clear:()=>this._clear({signal})});
    },{signal});
  }
  async ready({signal}={}){try{return await this.withSession(()=>true,{signal});}catch(e){if(e.code==='AUTH_REQUIRED')return false;throw e;}}
  clear(options={}){return this.mutex.run(()=>this._clear(options));}
  get cleanupPending(){return this.pendingDeletes>0;}
  knownKeys(){return this.mutex.run(async()=>{const s=await this._read();return[...new Set([s.activeKey,...s.pending.map(x=>x.key)].filter(Boolean))];});}
  async waitForCleanup(){await this._await(Promise.allSettled([...this.background]));}
}
module.exports={SessionVault,SECRET_KEY};
