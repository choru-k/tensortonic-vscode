'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {metadata,selectMinimum,accountSchema,problemSchema}=require('./fixtures/real-session-policy');
const cookie=()=>({name:'__Secure-better-auth.session_token',value:'synthetic-sensitive-value',domain:'.tensortonic.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax',session:false,expires:(Date.now()+60000)/1000});
test('one-time policy selects only a conventional secure HttpOnly API-applicable session and caps retention',()=>{
 const result=selectMinimum([{name:'analytics',value:'must-not-retain'},cookie()]);assert.deepEqual(result.scope.names,[cookie().name]);assert.deepEqual(result.scope.hosts,['api.tensortonic.com']);assert.equal(result.scope.maxLocalAgeMs,900000);assert.equal(result.batches[0].cookies.length,1);assert.equal(JSON.stringify(result.metadata).includes(cookie().value),false);
});
test('unknown, duplicate, wrong-domain/path, insecure and partitioned sessions stop without fallback',()=>{
 for(const cookies of [[{...cookie(),name:'unknown.session'}],[cookie(),cookie()],[{...cookie(),domain:'www.tensortonic.com'}],[{...cookie(),path:'/api'}],[{...cookie(),secure:false}],[{...cookie(),httpOnly:false}],[{...cookie(),partitionKey:{topLevelSite:'https://www.tensortonic.com'}}]])assert.throws(()=>selectMinimum(cookies));
});
test('scope diagnostics contain auth metadata only, never values or unneeded cookie names',()=>{
 const result=metadata([cookie(),{name:'analytics',value:'other-sensitive-value',domain:'.tensortonic.com',path:'/'}]);assert.equal(result.otherApplicableCookieCount,1);assert.equal(result.authMetadata.length,1);const text=JSON.stringify(result);for(const secret of ['synthetic-sensitive-value','other-sensitive-value','analytics'])assert.equal(text.includes(secret),false);
});
test('account and problem schema summaries omit identity and code contents',()=>{
 const account={status:'success',data:{user:{id:'private-id',email:'private@example.invalid',name:'Private Name'}}};assert.equal(accountSchema(account).recognized,true);assert.equal(accountSchema({status:'success',data:{authenticated:false,user:account.data.user}}).recognized,false);assert.equal(accountSchema({status:'success',data:{}}).recognized,false);
 const result=problemSchema({status:'success',data:{title:'Public title',starterCode:'private-like-code',description:'Text',testCases:[{isPublic:true},{isPublic:false}]}});assert.equal(result.recognized,true);assert.equal(result.publicTestCaseCount,1);const text=JSON.stringify([accountSchema(account),result]);for(const secret of ['private-id','private@example.invalid','Private Name','private-like-code'])assert.equal(text.includes(secret),false);
});
test('one-time discovery guards owned top frame and only the two approved cookie URLs',async()=>{
 const {readOwnedSnapshot}=require('./fixtures/real-once-control');const {WWW,ME}=require('./fixtures/real-session-policy');const calls=[];
 const resource={targets:new Set(['owned'])},source={resources:new Set([resource]),async _request(r,method,params,sessionId){calls.push({method,params,sessionId});return method==='Page.getFrameTree'?{frameTree:{frame:{url:WWW}}}:{cookies:[cookie()]};}},handle={getURL:()=>WWW};
 assert.equal((await readOwnedSnapshot(source,handle,ME)).length,1);assert.deepEqual(calls.filter(c=>c.method==='Network.getCookies'),[{method:'Network.getCookies',params:{urls:[ME]},sessionId:'owned'}]);
 await assert.rejects(readOwnedSnapshot(source,handle,'https://github.com/'),{code:'COOKIE_URL_OUTSIDE_APPROVAL'});
 resource.targets.add('foreign');await assert.rejects(readOwnedSnapshot(source,handle,WWW),{code:'OWNED_PAGE_AMBIGUOUS'});
});
test('navigation during one-time discovery discards its secret-bearing response',async()=>{
 const {readOwnedSnapshot}=require('./fixtures/real-once-control');const {WWW,ME}=require('./fixtures/real-session-policy');let url=WWW;const response=[cookie()],resource={targets:new Set(['owned'])};
 const source={resources:new Set([resource]),async _request(r,method){if(method==='Page.getFrameTree')return{frameTree:{frame:{url:WWW}}};url='https://external.invalid/';return{cookies:response};}};
 await assert.rejects(readOwnedSnapshot(source,{getURL:()=>url},ME),{code:'OWNED_PAGE_CHANGED'});assert.equal(response.length,0);
});
test('one-time dispatcher refuses POST, redirects as targets and unapproved reads without exposing headers',async()=>{
 const {readOnlyDispatch}=require('./fixtures/real-once-control');const {ME}=require('./fixtures/real-session-policy');const records=[];let calls=0;
 const dispatch=readOnlyDispatch(async options=>{calls++;options.onDispatch();return{status:200,body:Buffer.from('{}')};},records);const options={method:'GET',url:new URL(ME),headers:{Cookie:'synthetic-sensitive-value'},onDispatch(){}};
 await dispatch(options);assert.equal(calls,1);assert.equal(records[0].status,200);assert.equal(JSON.stringify(records).includes('synthetic-sensitive-value'),false);
 for(const change of [{method:'POST'},{url:new URL('https://external.invalid/api/me')},{url:new URL('https://api.tensortonic.com/api/study-plans')},{body:'{}'}])await assert.rejects(dispatch({...options,...change}),{code:'HTTP_OUTSIDE_ONCE_APPROVAL'});assert.equal(calls,1);
});
test('ordinary canonical same-origin routes retain the exact approved cookie read URLs',async()=>{
 const {canonicalOwnedURL,readOwnedSnapshot}=require('./fixtures/real-once-control');const {ME}=require('./fixtures/real-session-policy');const top='https://www.tensortonic.com/problems',calls=[];const resource={targets:new Set(['owned'])};
 assert.equal(canonicalOwnedURL(top),top);for(const url of ['https://github.com/','https://www.tensortonic.com/auth/callback?code=synthetic','https://www.tensortonic.com/#token=synthetic','https://user@www.tensortonic.com/'])assert.equal(canonicalOwnedURL(url),undefined);
 const source={resources:new Set([resource]),async _request(r,method,params){calls.push({method,params});return method==='Page.getFrameTree'?{frameTree:{frame:{url:top}}}:{cookies:[cookie()]};}};
 assert.equal((await readOwnedSnapshot(source,{getURL:()=>top},ME)).length,1);assert.deepEqual(calls.find(x=>x.method==='Network.getCookies').params,{urls:[ME]});
});
