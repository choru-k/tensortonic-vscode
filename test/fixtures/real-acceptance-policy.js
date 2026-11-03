'use strict';
const {renderResult}=require('../../src/results');
const BASE='/api/study-plans/pytorch-basics/problems/pytorch-softmax-from-scratch';
function summary(result){
 const value=result?.status==='success'&&result.data&&typeof result.data==='object'?result.data:result;
 const kind=/<section class="result-summary result-([a-z]+)"/.exec(renderResult(result))?.[1]||'unknown';
 const counts=Number.isSafeInteger(value?.passed)&&Number.isSafeInteger(value?.total)&&value.total>0&&value.passed===value.total;
 const cases=['tests','results','testResults','test_results','testCases','cases'].map(key=>value?.[key]).find(Array.isArray);
 const everyCase=!!cases?.length&&cases.every(item=>item&&[item.ok,item.passed,item.accepted].includes(true)&&![item.ok,item.passed,item.accepted].includes(false)&&!item.error&&!item.traceback);
 return{kind,unambiguousPass:kind==='passed'&&(counts||everyCase),...(Number.isSafeInteger(value?.passed)?{passed:value.passed}:{}),...(Number.isSafeInteger(value?.total)?{total:value.total}:{}),returnedCaseCount:Array.isArray(cases)?cases.length:0};
}
function observeApprovedRequests(https,events,{beforePost=()=>{},changed=()=>{}}={}){
 const original=https.request;
 const wrapped=function(url,options,callback){
  const scoped=url instanceof URL&&url.origin==='https://api.tensortonic.com'&&!url.username&&!url.password&&!url.hash;
  const action=scoped&&options?.method==='POST'&&(url.pathname===BASE+'/run'?'run':url.pathname===BASE+'/submit'?'submit':undefined);
  const read=scoped&&options?.method==='GET'&&[BASE,'/api/me','/api/problems/list','/api/study-plans/pytorch-basics'].includes(url.pathname);
  if(!action&&!read)return original.apply(this,arguments);
  if(action)beforePost(action);
  const event={method:options.method,path:url.pathname,status:null};events.push(event);changed();
  // Values, headers, bodies, cookies and response streams are never inspected.
  // Forward the original request/options and callback response unchanged.
  return original.call(this,url,options,function(response){event.status=response.statusCode;changed();return callback.call(this,response);});
 };
 https.request=wrapped;return()=>{if(https.request!==wrapped)return false;https.request=original;return true;};
}
module.exports={summary,observeApprovedRequests,BASE};
