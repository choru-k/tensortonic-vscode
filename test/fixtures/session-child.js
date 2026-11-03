'use strict';
const {SessionVault}=require('../../src/session/vault');
const {SessionMutex}=require('../../src/session/mutex');
const {SessionHttpTransport}=require('../../src/session/http');
const {scope,ORIGIN,routePolicy}=require('./session');
const waiting=new Map();let id=0;
process.on('message',message=>{const p=waiting.get(message.id);if(!p)return;waiting.delete(message.id);message.ok?p.resolve(message.value):p.reject(new Error('Synthetic IPC operation failed'));});
const rpc=(operation,args)=>new Promise((resolve,reject)=>{const n=++id;waiting.set(n,{resolve,reject});process.send({id:n,operation,args});});
async function run(){
  const directory=process.argv[2];
  if(process.argv[3]==='hold')return new SessionMutex(directory).run(async()=>{process.send({lockHeld:true});await new Promise(()=>{});});
  const secrets={get:key=>rpc('get',[key]),store:(key,value)=>rpc('store',[key,value]),delete:key=>rpc('delete',[key])};
  const vault=new SessionVault(secrets,{scope:scope(),directory,authURL:ORIGIN+'/me'});
  if(process.argv[3]==='acquire-wait'){
    const expectedEpoch=await vault.captureAcquisitionFence();const captured=await rpc('acquire',[]);
    try{await vault.importCookies(captured.cookies,{sourceURL:captured.sourceURL,confirmed:true,expectedEpoch});process.send({done:true,canceled:false});}
    catch(e){process.send({done:true,canceled:e.code==='CANCELED'});}return;
  }
  const dispatch=async({url,method,headers,body,maxBytes,onDispatch})=>{onDispatch();const response=await rpc('http',[{url:url.href,method,headers,body,maxBytes}]);return{...response,body:Buffer.from(response.body,'base64')};};
  const transport=new SessionHttpTransport(vault,{routePolicy,dispatch});
  for(let i=0;i<(process.argv[3]==='rotate-once'?1:3);i++)await transport.request('/rotate');
  const result=await transport.request('/me');process.send({done:true,authenticated:result.authenticated===true});
}
run().then(()=>{if(process.argv[3]!=='hold')process.disconnect();},()=>{process.send({done:true,failed:true});process.disconnect();});
