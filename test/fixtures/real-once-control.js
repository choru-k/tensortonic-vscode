'use strict';
const {WWW,ME,PROBLEM}=require('./real-session-policy');
function fail(code){const e=new Error(code);e.code=code;throw e;}
function canonicalOwnedURL(value){try{const url=new URL(value);return url.origin==='https://www.tensortonic.com'&&!url.username&&!url.password&&!url.search&&!url.hash?url.href:undefined;}catch{return undefined;}}
async function readOwnedSnapshot(source,handle,url,{signal}={}){
 if(![WWW,ME].includes(url))fail('COOKIE_URL_OUTSIDE_APPROVAL');
 const resource=[...source.resources][0];if(source.resources.size!==1||!resource||resource.targets.size!==1)fail('OWNED_PAGE_AMBIGUOUS');
 const guard=()=>{if(signal?.aborted||!canonicalOwnedURL(handle.getURL())||resource.closed||resource.tabClosed||resource.targets.size!==1)fail('OWNED_PAGE_CHANGED');};
 const sessionId=[...resource.targets][0];let cookies;
 try{
  guard();const before=await source._request(resource,'Page.getFrameTree',{},sessionId,signal);guard();if(canonicalOwnedURL(before?.frameTree?.frame?.url)!==canonicalOwnedURL(handle.getURL())||before.frameTree.frame.parentId)fail('OWNED_PAGE_CHANGED');
  const reply=await source._request(resource,'Network.getCookies',{urls:[url]},sessionId,signal);cookies=reply?.cookies;guard();
  const after=await source._request(resource,'Page.getFrameTree',{},sessionId,signal);guard();if(canonicalOwnedURL(after?.frameTree?.frame?.url)!==canonicalOwnedURL(handle.getURL())||after.frameTree.frame.parentId)fail('OWNED_PAGE_CHANGED');
  if(!Array.isArray(cookies)||cookies.length>256)fail('COOKIE_SCOPE_REQUIRES_REVIEW');return cookies;
 }catch(error){if(Array.isArray(cookies))cookies.length=0;throw error;}
}
function readOnlyDispatch(dispatch,records){
 return async options=>{
  if(options.method!=='GET'||options.body!==undefined||![ME,PROBLEM].includes(options.url.href))fail('HTTP_OUTSIDE_ONCE_APPROVAL');
  const record={method:'GET',host:options.url.hostname,path:options.url.pathname,status:null,sent:false};records.push(record);
  const response=await dispatch({...options,onDispatch:()=>{record.sent=true;options.onDispatch();}});record.status=response.status;return response;
 };
}
module.exports={canonicalOwnedURL,readOwnedSnapshot,readOnlyDispatch};
