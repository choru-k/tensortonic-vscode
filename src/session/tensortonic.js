'use strict';
const path=require('node:path');
const {cookieScope}=require('./cookie-jar');
const {acquisitionPlan}=require('./acquisition');
const {createConfirmedBrowserAcquirer}=require('./acquisition-ui');
const {SessionVault}=require('./vault');
const {SessionHttpTransport,tensorTonicPostContract}=require('./http');
const {fault}=require('./fault');
const SESSION_NAME='__Secure-better-auth.session_token';
const LOGIN_URL='https://www.tensortonic.com/';
const AUTH_URL='https://api.tensortonic.com/api/me';
function verifiedScope(){
  return cookieScope({names:[SESSION_NAME],hosts:['api.tensortonic.com'],domains:['tensortonic.com'],retention:'server',attributes:{path:'/',hostOnly:false,secure:true,httpOnly:true,sameSite:'Lax'}});
}
function verifiedPlan(){
  return acquisitionPlan({scope:verifiedScope(),entryURL:LOGIN_URL,returnURLs:[LOGIN_URL],returnOrigin:'https://www.tensortonic.com',authURL:AUTH_URL,sources:[{url:AUTH_URL,names:[SESSION_NAME]}]});
}
function authenticatedAccount(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  const data=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;
  const user=data.user&&typeof data.user==='object'&&!Array.isArray(data.user)?data.user:data;
  const identifier=typeof user.id==='string'&&user.id.length>0||typeof user.userId==='string'&&user.userId.length>0;
  const identity=typeof user.email==='string'&&user.email.length>0||typeof user.name==='string'&&user.name.length>0;
  return identifier&&identity&&body.authenticated!==false&&data.authenticated!==false&&body.success!==false&&(typeof body.status!=='string'||['success','ok'].includes(body.status));
}
function createSessionBridge(vscode,context){
  const {SessionBridge}=require('../session-bridge');
  if(typeof context?.globalStorageUri?.fsPath!=='string'||!context.secrets)throw fault('STORAGE_UNAVAILABLE');
  // This stable production directory never migrates or reads experiment vaults.
  const vault=new SessionVault(context.secrets,{scope:verifiedScope(),directory:path.join(context.globalStorageUri.fsPath,'saved-session-v1'),authURL:AUTH_URL});
  // Frontend-compatible route/body contract, not a claim of live server grading validation.
  const transport=new SessionHttpTransport(vault,{postContract:tensorTonicPostContract,postTimeoutMs:150000});
  const acquisition=createConfirmedBrowserAcquirer(vscode,{plan:verifiedPlan(),gradingAvailable:transport.supportsGrading});
  return new SessionBridge(vscode,context,{vault,transport,acquisition,verifySession:async({signal})=>{
    const account=await transport.request('/api/me',{signal});
    if(!authenticatedAccount(account)){
      const credentials=await vault.clear();const error=fault(credentials.credentialsDeleted?'ACCOUNT_SCHEMA_UNVERIFIED':'STORAGE_CLEANUP_PENDING');error.cleanup={credentials};throw error;
    }
  }});
}
module.exports={SESSION_NAME,LOGIN_URL,AUTH_URL,verifiedScope,verifiedPlan,authenticatedAccount,createSessionBridge};
