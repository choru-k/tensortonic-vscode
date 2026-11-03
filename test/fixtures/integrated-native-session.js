'use strict';
// External synthetic harness only. Never imported by packaged production code.
const http=require('node:http'),crypto=require('node:crypto');
const {browserFixture,ENTRY,RETURN,API}=require('./browser-session');
const NAME='__Secure-better-auth.session_token',WWW='https://www.tensortonic.com/',AUTH='https://api.tensortonic.com/api/me';
const PLAN='pytorch-basics',SLUG='pytorch-softmax-from-scratch',NEXT='synthetic-next';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function fail(code){const error=new Error(code);error.code=code;throw error;}
function mapCookie(cookie){
 if(cookie.name!=='synthetic_session')return cookie;
 if(cookie.domain!=='api.session-test.invalid'||cookie.path!=='/'||cookie.httpOnly!==true||cookie.session!==false)fail('SYNTHETIC_COOKIE_SCOPE');
 return{...cookie,name:NAME,domain:'.tensortonic.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'};
}
async function apiFixture({expectedDigest,mayRead=()=>true}={}){
 const sockets=new Set(),evidence={requests:[],posts:0,run:0,submit:0,rejected:0,beforeBrowserClosure:0};let expectedCode,onPost,hang=false;
 const refs=[SLUG,NEXT].map((slug,index)=>({id:slug,sourceId:slug,slug,source:'python',planId:PLAN,title:index?'Synthetic next':'Synthetic Softmax',category:'pytorch',difficulty:'Easy',solved:true}));
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),route=url.pathname;
  if(!mayRead())evidence.beforeBrowserClosure++;
  evidence.requests.push({method:req.method,path:route,hasOrigin:!!req.headers.origin,hasCSRF:!!req.headers['x-csrf-token']});
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const cookie=(req.headers.cookie||'').split('; ').find(x=>x.startsWith(NAME+'='));
  if(!cookie||digest(cookie.slice(NAME.length+1))!==expectedDigest){evidence.rejected++;return reply(401,{authenticated:false});}
  if(req.method==='GET'){
   if(route==='/api/me')return reply(200,{status:'success',data:{user:{id:'synthetic-native-user',email:'synthetic@example.invalid'}}});
   if(route==='/api/problems/list')return reply(200,{status:'success',data:{problems:refs,pagination:{hasMore:false}}});
   if(route==='/api/study-plans')return reply(200,{status:'success',data:[{id:PLAN,title:'Synthetic plan'}]});
   if(route==='/api/study-plans/'+PLAN)return reply(200,{status:'success',data:{id:PLAN,title:'Synthetic plan',sections:[{id:'synthetic-section',title:'Synthetic section',sortOrder:1,problems:refs.map((p,index)=>({slug:p.slug,type:'python',sortOrder:index+1}))}]}});
   if(refs.some(p=>route==='/api/study-plans/'+PLAN+'/problems/'+p.slug))return reply(200,{status:'success',data:{id:route.split('/').at(-1),title:'Synthetic problem',description:'Synthetic local statement only.',starterCode:'def synthetic_identity(x):\n    return x\n',testCases:[{id:'synthetic-case',inputs:{x:4},isPublic:true}]}});
  }
  if(req.method==='POST'&&[...refs].some(p=>['run','submit'].some(action=>route==='/api/study-plans/'+PLAN+'/problems/'+p.slug+'/'+action))){
   evidence.posts++;const action=route.split('/').at(-1);evidence[action]++;
   let text='';req.on('data',chunk=>{text+=chunk;if(text.length>1048576)req.destroy();});req.on('end',()=>{
    let body;try{body=JSON.parse(text);}catch{return reply(400,{error:'synthetic JSON'});}
    if(req.headers['content-type']!=='application/json'||req.headers.origin||req.headers['x-csrf-token']||body.code!==expectedCode||JSON.stringify(Object.keys(body).sort())!==JSON.stringify((action==='run'?['code','testCases']:['code']).sort())||action==='run'&&JSON.stringify(body.testCases)!==JSON.stringify([{id:'synthetic-case',inputs:{x:4}}]))return reply(400,{error:'synthetic contract'});
    onPost?.();if(hang)return;
    reply(200,{status:'success',data:{passed:1,total:1,allPassed:true,testResults:[{id:'synthetic-case',passed:true,actual:4,expected:4}]}});
   });return;
  }
  reply(404,{error:'synthetic route'});
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const httpsRequest=(url,options,callback)=>{
  if(!(url instanceof URL)||url.origin!=='https://api.tensortonic.com'||url.username||url.password||url.hash)fail('SYNTHETIC_HTTPS_SCOPE');
  return http.request({hostname:'127.0.0.1',port:server.address().port,path:url.pathname+url.search,...options},callback);
 };
 return{httpsRequest,evidence,setExpectedCode(code){expectedCode=code;},armPostCancel(callback){hang=true;onPost=callback;},async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
async function integratedFixture(vscode,{expectedDigest,phase,control}={}){
 const browser=await browserFixture({expectedDigest}),inner=browser.facade(vscode),tabs=new Map();let latest;
 const api=await apiFixture({expectedDigest:browser.credentialDigest,mayRead:()=>phase==='phase2'||browser.evidence.tabClosedEventCount===1&&browser.evidence.groupClosedEventCount===1});
 const windowOverrides={
  openBrowserTab:async(url,options)=>{
   if(url!==WWW)fail('SYNTHETIC_ENTRY_SCOPE');const tab=await inner.window.openBrowserTab(ENTRY,options);
   const outer={get url(){return tab.url===RETURN||tab.url===ENTRY?WWW:tab.url;},close:()=>tab.close(),startCDPSession:async()=>{
    const group=await tab.startCDPSession();return{
     onDidClose:listener=>group.onDidClose(listener),close:()=>group.close(),
     onDidReceiveMessage:listener=>group.onDidReceiveMessage(message=>{
      const frame=message.result?.frameTree?.frame;
      if(frame?.url===RETURN)message={...message,result:{...message.result,frameTree:{...message.result.frameTree,frame:{...frame,url:WWW}}}};
      if(Array.isArray(message.result?.cookies))message={...message,result:{...message.result,cookies:message.result.cookies.map(mapCookie)}};
      listener(message);
     }),
     sendMessage:message=>{
      if(message.method==='Network.getCookies'){
       if(JSON.stringify(message.params.urls)!==JSON.stringify([AUTH]))fail('SYNTHETIC_COOKIE_URL');
       message={...message,params:{urls:[API+'/me']}};
      }return group.sendMessage(message);
     },
    };
   }};tabs.set(tab,outer);latest=tab;return outer;
  },
  onDidCloseBrowserTab:listener=>inner.window.onDidCloseBrowserTab(tab=>{const outer=tabs.get(tab);if(outer)listener(outer);}),
  showInformationMessage:async(message,...args)=>{
   if(message==='Save the reviewed website session?'){
    const detail=args[0]?.detail||'';if(!detail.includes('all cookies applicable')||!detail.includes(NAME)||!detail.includes('server cookie expires'))fail('SYNTHETIC_CONSENT_MISMATCH');control.consent++;return'Save approved session';
   }return vscode.window.showInformationMessage(message,...args);
  },
  showErrorMessage:async()=>{control.errorNotifications++;return undefined;},
  withProgress:async(options,task)=>{
   if(!/^(?:Running TensorTonic|Submitting to TensorTonic)/.test(options.title||''))return vscode.window.withProgress(options,task);
   const token=new vscode.CancellationTokenSource();control.progress++;
   if(control.cancelMode==='before')token.cancel();
   if(control.cancelMode==='after')api.armPostCancel(()=>token.cancel());
   try{return await task({report(){}},token.token);}finally{token.dispose();}
  },
  createWebviewPanel:(...args)=>{
   const panel=vscode.window.createWebviewPanel(...args);if(args[0]!=='tensortonic.results')return panel;
   const webview=new Proxy({},{get(_target,key){const value=Reflect.get(panel.webview,key,panel.webview);return typeof value==='function'?value.bind(panel.webview):value;},set(_target,key,value){if(key==='html'){control.resultRenders++;if(String(value).includes('outcome is uncertain'))control.uncertainRendered=true;}return Reflect.set(panel.webview,key,value,panel.webview);}});
   return new Proxy({},{get(_target,key){if(key==='webview')return webview;const value=Reflect.get(panel,key,panel);return typeof value==='function'?value.bind(panel):value;},set(_target,key,value){return Reflect.set(panel,key,value,panel);}});
  },
 };
 const commands=new Proxy({},{get(_target,key){
  if(key==='registerCommand')return(id,callback,...rest)=>{
   const disposable=vscode.commands.registerCommand(id,callback,...rest);
   if(id.startsWith('tensortonic.captureApprovedSession.')&&!id.endsWith('.cancel')){
    const deadline=Date.now()+15000;
    const poll=async()=>{if(latest?.url===RETURN){control.capture++;await vscode.commands.executeCommand(id);}else if(Date.now()<deadline)setTimeout(poll,20);};setTimeout(poll,20);
   }return disposable;
  };
  const value=Reflect.get(vscode.commands,key,vscode.commands);return typeof value==='function'?value.bind(vscode.commands):value;
 }});
 const window=new Proxy({},{get(_target,key){if(key in windowOverrides)return windowOverrides[key];const value=Reflect.get(vscode.window,key,vscode.window);return typeof value==='function'?value.bind(vscode.window):value;}});
 const facade=new Proxy({},{get(_target,key){return key==='window'?window:key==='commands'?commands:Reflect.get(vscode,key,vscode);}});
 return{facade,browser,api,credentialDigest:browser.credentialDigest,async close(){await api.close();await browser.close();}};
}
module.exports={apiFixture,integratedFixture,mapCookie,NAME,WWW,AUTH,PLAN,SLUG,NEXT,digest};
