'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {summary,observeApprovedRequests,BASE}=require('./fixtures/real-acceptance-policy');
test('real acceptance gate requires terminal passing evidence, not HTTP or envelope success',()=>{
 for(const value of [undefined,{status:'success'},{status:'passed'},{status:'pending',passed:3,total:3},{status:'passed',passed:2,total:3},{status:'passed',tests:[{ok:false}]}])assert.equal(summary(value).unambiguousPass,false);
 assert.equal(summary({status:'passed',tests:[{ok:true}]}).unambiguousPass,true);assert.equal(summary({status:'success',data:{status:'passed',passed:43,total:43}}).unambiguousPass,true);
});
test('observer records only approved path/status and never reads headers or changes request arguments',()=>{
 let calls=0,last,observed=0;const request=function(url,options,cb){calls++;last={url,options};cb({statusCode:200});return'synthetic-request';};const https={request},events=[];const restore=observeApprovedRequests(https,events,{beforePost:()=>observed++});
 const url=new URL('https://api.tensortonic.com'+BASE+'/run'),options={method:'POST',get headers(){throw Error('must not inspect');}};let callback=false;assert.equal(https.request(url,options,()=>{callback=true;}),'synthetic-request');assert.equal(last.url,url);assert.equal(last.options,options);assert.equal(callback,true);assert.equal(observed,1);assert.deepEqual(events,[{method:'POST',path:BASE+'/run',status:200}]);
 https.request(new URL('https://other.invalid'+BASE+'/run'),options,()=>{});https.request(new URL('https://api.tensortonic.com/api/billing'),{method:'GET'},()=>{});assert.equal(calls,3);assert.equal(events.length,1);assert.equal(restore(),true);assert.equal(https.request,request);
});
test('observer can reject a second intent before it reaches native HTTPS',()=>{
 let calls=0;const https={request(){calls++;}},events=[];let count=0;const restore=observeApprovedRequests(https,events,{beforePost(){if(++count>1)throw Error('No replay');}});const args=[new URL('https://api.tensortonic.com'+BASE+'/submit'),{method:'POST'},()=>{}];https.request(...args);assert.throws(()=>https.request(...args),/No replay/);assert.equal(calls,1);restore();
});
