'use strict';
const http=require('node:http'),crypto=require('node:crypto');
const {fixture}=require('./session');
const ENTRY='https://www.session-test.invalid/login',RETURN='https://www.session-test.invalid/return',API='https://api.session-test.invalid';
async function browserFixture({expectedDigest}={}){
 // Separate auth page sets a synthetic cookie in the real browser. The existing
 // independent mock transport checks its hash; no credential leaves this test.
 const value=crypto.randomBytes(24).toString('hex'),digest=crypto.createHash('sha256').update(value).digest('hex');
 const route='/owned-'+crypto.randomBytes(12).toString('hex'),sockets=new Set();let loginCount=0;
 const server=http.createServer((req,res)=>{
  if(req.url===route+'/login'){
   loginCount++;res.writeHead(303,{'Location':route+'/return','Set-Cookie':[`synthetic_session=${value}; HttpOnly; SameSite=Strict; Path=${route}; Max-Age=3600`,'synthetic_analytics=discard-me; HttpOnly; SameSite=Strict; Path='+route], 'Cache-Control':'no-store'});res.end();return;
  }
  if(req.url===route+'/return'){
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'"});res.end('<h1>Owned synthetic session only</h1><p>No real account is used.</p>');return;
  }
  res.writeHead(404);res.end();
 });
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 // The fake HTTP transport validates this browser-created synthetic credential.
 const auth=await fixture({expectedDigest:expectedDigest||digest,maxAgeSeconds:3600});
 const evidence={tabOpenCount:0,tabClosedEventCount:0,groupClosedEventCount:0,cookieReads:0,requestedPhysicalURLs:0,browserSyntheticCookiesCleared:false};
 const facade=vscode=>({workspace:vscode.workspace,env:vscode.env,window:{
  onDidCloseBrowserTab:listener=>vscode.window.onDidCloseBrowserTab(tab=>{const mapped=tabs.get(tab);if(mapped){evidence.tabClosedEventCount++;listener(mapped);}}),
  openBrowserTab:async(url,options)=>{
   if(url!==ENTRY)throw Error('Synthetic scope required');const tab=await vscode.window.openBrowserTab(origin+route+'/login',options);evidence.tabOpenCount++;
   const mapURL=url=>url===origin+route+'/return'?RETURN:url===origin+route+'/login'?ENTRY:url;
   let cleanupPromise;const wrapped={get url(){return mapURL(tab.url);},close:async()=>{await cleanupPromise;return tab.close();},startCDPSession:async()=>{
    const group=await tab.startCDPSession(),requests=new Map(),cleanupRequests=new Map();let pageSession,cleanupId=1000000;
    const cleanupRequest=async(method,params)=>{
     const id=++cleanupId;let resolve,reject;const reply=new Promise((yes,no)=>{resolve=yes;reject=no;});cleanupRequests.set(id,{resolve,reject});
     try{await group.sendMessage({id,method,params,sessionId:pageSession});return await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Synthetic cleanup timeout')),5000);reply.then(value=>{clearTimeout(timer);yes(value);},error=>{clearTimeout(timer);no(error);});});}finally{cleanupRequests.delete(id);}
    };
    return{
     onDidClose:listener=>group.onDidClose(()=>{evidence.groupClosedEventCount++;listener();}),
     onDidReceiveMessage:listener=>group.onDidReceiveMessage(message=>{
      if(cleanupRequests.has(message.id)){const request=cleanupRequests.get(message.id);message.error?request.reject(Error('Synthetic cleanup rejected')):request.resolve(message.result);return;}
      if(message.id&&requests.has(message.id)&&message.result){
       const method=requests.get(message.id);requests.delete(message.id);
       if(method==='Page.getFrameTree'){
        const frame=message.result.frameTree?.frame;if(frame&&frame.url===origin+route+'/return')message={...message,result:{...message.result,frameTree:{...message.result.frameTree,frame:{...frame,url:RETURN}}}};
       }else if(method==='Network.getCookies'){
        const cookies=message.result.cookies;
        if(!Array.isArray(cookies))throw Error('Synthetic cookie schema');
        message={...message,result:{cookies:cookies.map(cookie=>{
         if(cookie.name==='synthetic_session'){
          if(cookie.domain!=='127.0.0.1'||cookie.path!==route||cookie.httpOnly!==true)throw Error('Synthetic cookie scope');
          return{...cookie,domain:'api.session-test.invalid',path:'/'};
         }return cookie;
        })}};
       }
      }listener(message);
     }),
     sendMessage:async message=>{
      if(!tab.url.startsWith(origin+route+'/'))throw Error('Owned physical page changed');
      const allowed=['Target.setAutoAttach','Page.getFrameTree','Network.getCookies'];if(!allowed.includes(message.method))throw Error('Synthetic CDP allowlist');
      requests.set(message.id,message.method);
      if(message.method==='Network.getCookies'){
       if(JSON.stringify(message.params.urls)!==JSON.stringify([API+'/me']))throw Error('Synthetic URL scope');evidence.cookieReads++;evidence.requestedPhysicalURLs++;
       pageSession=message.sessionId;message={...message,params:{urls:[origin+route+'/me']}};
      }await group.sendMessage(message);
     },close:()=>{
      cleanupPromise??=(async()=>{
       if(pageSession){
        if(!tab.url.startsWith(origin+route+'/'))throw Error('Owned synthetic cleanup page changed');
        for(const name of ['synthetic_session','synthetic_analytics'])await cleanupRequest('Network.deleteCookies',{name,url:origin+route+'/me'});
        const after=await cleanupRequest('Network.getCookies',{urls:[origin+route+'/me']});if(after.cookies.some(cookie=>['synthetic_session','synthetic_analytics'].includes(cookie.name)))throw Error('Synthetic browser cookie cleanup incomplete');evidence.browserSyntheticCookiesCleared=true;
       }await group.close();
      })();return cleanupPromise;
     },
    };
   }};tabs.set(tab,wrapped);return wrapped;
  },
 }});
 const tabs=new Map();
 return{facade,evidence,dispatch:auth.dispatch,get loginCount(){return loginCount;},credentialDigest:expectedDigest||digest,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await auth.close();}};
}
module.exports={browserFixture,ENTRY,RETURN,API};
