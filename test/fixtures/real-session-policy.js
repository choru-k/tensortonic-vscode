'use strict';
// One-time experiment policy only. Not packaged and not wired to production.
const {selectedCDPCookies}=require('../../src/session/browser-cookie-source');
const {cookieScope}=require('../../src/session/cookie-jar');
const WWW='https://www.tensortonic.com/',API='https://api.tensortonic.com';
const ME=API+'/api/me',PROBLEM=API+'/api/study-plans/pytorch-basics/problems/pytorch-softmax-from-scratch';
const TOKEN_NAMES=['__Secure-better-auth.session_token','better-auth.session_token'];
function fail(code){const error=new Error(code);error.code=code;throw error;}
function metadata(cookies){
 if(!Array.isArray(cookies)||cookies.length>256)fail('COOKIE_SCOPE_REQUIRES_REVIEW');
 const auth=[];let ignored=0;
 for(const cookie of cookies){
  const name=cookie?.name;
  if(typeof name!=='string'||!/(session|auth|token)/i.test(name)||!/^[A-Za-z0-9_.-]{1,100}$/.test(name)){ignored++;continue;}
  const domain=typeof cookie.domain==='string'&&/^\.?[a-z0-9.-]{1,253}$/.test(cookie.domain)?cookie.domain:'unrecognized';
  auth.push({name,domain,path:['/','/api','/api/auth'].includes(cookie.path)?cookie.path:'other',secure:cookie.secure===true,httpOnly:cookie.httpOnly===true,sameSite:['Lax','Strict','None'].includes(cookie.sameSite)?cookie.sameSite:'unspecified',session:cookie.session===true,partitioned:!!cookie.partitionKey||cookie.partitionKeyOpaque===true});
 }
 return{authMetadata:auth,otherApplicableCookieCount:ignored};
}
function selectMinimum(apiCookies){
 if(!Array.isArray(apiCookies)||apiCookies.length>256)fail('COOKIE_SCOPE_REQUIRES_REVIEW');
 const candidates=apiCookies.filter(cookie=>TOKEN_NAMES.includes(cookie?.name));
 if(candidates.length!==1)fail(candidates.length?'COOKIE_SCOPE_REQUIRES_REVIEW':'SESSION_COOKIE_NOT_FOUND');
 const cookie=candidates[0];
 if(!['.tensortonic.com','api.tensortonic.com','.api.tensortonic.com'].includes(cookie.domain)||cookie.path!=='/'||cookie.secure!==true||cookie.httpOnly!==true||!['Lax','Strict','None',undefined].includes(cookie.sameSite)||cookie.partitionKey||cookie.partitionKeyOpaque||cookie.sameParty===true)fail('COOKIE_SCOPE_REQUIRES_REVIEW');
 const selected=selectedCDPCookies({cookies:[cookie]},[cookie.name]);
 const scope=cookieScope({names:[cookie.name],hosts:['api.tensortonic.com'],domains:[selected[0].domain],maxLocalAgeMs:15*60*1000});
 return{scope,batches:[{sourceURL:ME,cookies:selected}],metadata:metadata([cookie]).authMetadata[0]};
}
function accountSchema(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return{recognized:false};
 const data=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;
 const user=data.user&&typeof data.user==='object'&&!Array.isArray(data.user)?data.user:data;
 const identifier=typeof user.id==='string'&&user.id.length>0||typeof user.userId==='string'&&user.userId.length>0;
 const identityField=typeof user.email==='string'&&user.email.length>0||typeof user.name==='string'&&user.name.length>0;
 const explicitFailure=body.authenticated===false||data.authenticated===false||body.success===false||typeof body.status==='string'&&!['success','ok'].includes(body.status);
 return{recognized:identifier&&identityField&&!explicitFailure,userIdentifierPresent:identifier,identityFieldPresent:identityField};
}
function problemSchema(body){
 const data=body?.data;return{recognized:body?.status==='success'&&!!data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.starterCode==='string'&&typeof data.title==='string',starterCodePresent:typeof data?.starterCode==='string',descriptionPresent:typeof data?.description==='string',publicTestCaseCount:Array.isArray(data?.testCases)?data.testCases.filter(item=>item&&item.isPublic!==false).length:0};
}
module.exports={WWW,API,ME,PROBLEM,TOKEN_NAMES,metadata,selectMinimum,accountSchema,problemSchema};
