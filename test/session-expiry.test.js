'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CookieJar,cookieScope}=require('../src/session/cookie-jar');const {selectedCDPCookies}=require('../src/session/browser-cookie-source');const {verifiedScope,SESSION_NAME,AUTH_URL}=require('../src/session/tensortonic');
const DAY=86400000,BASE=1800000000000;
const cookie=()=>({name:SESSION_NAME,value:'synthetic-expiry-only',domain:'tensortonic.com',hostOnly:false,path:'/',secure:true,httpOnly:true,sameSite:'Lax',expiresAt:BASE+45*DAY,persistent:true,created:0});
test('server-expiry sessions survive daily and monthly restart boundaries without extending the issued expiry',()=>{
 const original=new CookieJar(verifiedScope(),{now:()=>BASE});original.importCookies([cookie()],AUTH_URL);const record=original.record();assert.equal(record.version,2);assert.equal(record.expiresAt,null);assert.equal(record.cookies[0].expiresAt,BASE+45*DAY);
 for(const days of [1,2,31,44]){const restored=new CookieJar(verifiedScope(),{now:()=>BASE+days*DAY,record:JSON.parse(JSON.stringify(record))});assert.equal(restored.canAuthenticate(AUTH_URL),true);assert.equal(restored.record().cookies[0].expiresAt,BASE+45*DAY);}
 const expired=new CookieJar(verifiedScope(),{now:()=>BASE+45*DAY,record});assert.equal(expired.canAuthenticate(AUTH_URL),false);
});
test('only a real Set-Cookie expiry can renew or shorten the server-controlled lifetime',()=>{
 let now=BASE;const jar=new CookieJar(verifiedScope(),{now:()=>now});jar.importCookies([cookie()],AUTH_URL);now+=30*DAY;
 jar.applySetCookie([SESSION_NAME+'=synthetic-renewal; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000'],AUTH_URL);assert.equal(jar.record().cookies[0].expiresAt,now+30*DAY);
 const exact=new Date(now+3*DAY).toUTCString();jar.applySetCookie([SESSION_NAME+'=synthetic-shorter; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Lax; Expires='+exact],AUTH_URL);assert.equal(jar.record().cookies[0].expiresAt,now+3*DAY);
});
test('no-expiry cookies never receive an invented persistent or monthly lifetime',()=>{
 const raw={...cookie(),domain:'.tensortonic.com',session:true,expires:-1};assert.throws(()=>selectedCDPCookies({cookies:[raw]},[SESSION_NAME]),{code:'COOKIE_POLICY'});
 const jar=new CookieJar(verifiedScope(),{now:()=>BASE});assert.throws(()=>jar.importCookies([{...cookie(),persistent:false}],AUTH_URL),{code:'COOKIE_POLICY'});assert.throws(()=>jar.importCookies([{...cookie(),persistent:undefined}],AUTH_URL),{code:'COOKIE_POLICY'});
 assert.throws(()=>jar.applySetCookie([SESSION_NAME+'=synthetic-session-only; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Lax'],AUTH_URL),{code:'COOKIE_POLICY'});
});
test('bounded mock policy may explicitly consent to a finite session-cookie lifetime',()=>{
 const raw={...cookie(),domain:'.tensortonic.com',session:true,expires:-1};const [normalized]=selectedCDPCookies({cookies:[raw]},[SESSION_NAME],{now:BASE,sessionLifetimeMs:60000});assert.equal(normalized.expiresAt,BASE+60000);assert.equal(normalized.persistent,false);
 const scope=cookieScope({names:[SESSION_NAME],hosts:['api.tensortonic.com'],domains:['tensortonic.com'],maxLocalAgeMs:60000});const jar=new CookieJar(scope,{now:()=>BASE});jar.importCookies([normalized],AUTH_URL);assert.equal(jar.record().version,1);assert.equal(jar.canAuthenticate(AUTH_URL),true);
});
test('server revocation/deletion and invalid huge expirations fail closed',()=>{
 const jar=new CookieJar(verifiedScope(),{now:()=>BASE});jar.importCookies([cookie()],AUTH_URL);jar.applySetCookie([SESSION_NAME+'=; Domain=.tensortonic.com; Path=/; Max-Age=0'],AUTH_URL);assert.equal(jar.canAuthenticate(AUTH_URL),false);
 for(const age of ['999999999999999999999','9007199254740991'])assert.throws(()=>jar.applySetCookie([SESSION_NAME+'=synthetic; Domain=.tensortonic.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age],AUTH_URL),{code:'COOKIE_POLICY'});
});
test('server-expiry record policy cannot silently adopt a bounded record or a missing expiry',()=>{
 const jar=new CookieJar(verifiedScope(),{now:()=>BASE});for(const patch of [{version:1},{retention:'bounded'},{expiresAt:BASE+DAY},{cookies:[{...cookie(),expiresAt:null}]}])assert.throws(()=>new CookieJar(verifiedScope(),{now:()=>BASE,record:{version:2,retention:'server',expiresAt:null,cookies:[cookie()],...patch}}),{code:'COOKIE_POLICY'});
 assert.throws(()=>cookieScope({names:[SESSION_NAME],hosts:['api.tensortonic.com'],domains:['tensortonic.com'],retention:'server',maxLocalAgeMs:30*DAY}),{code:'COOKIE_POLICY'});
});
