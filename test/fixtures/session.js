'use strict';
const http=require('node:http'),crypto=require('node:crypto');
const {cookieScope,CookieJar}=require('../../src/session/cookie-jar');
const ORIGIN='https://api.session-test.invalid';
const scope=()=>cookieScope({names:['synthetic_session','optional'],requiredNames:['synthetic_session'],hosts:['api.session-test.invalid','www.session-test.invalid'],domains:['api.session-test.invalid','www.session-test.invalid','session-test.invalid'],maxLocalAgeMs:60000});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function memorySecrets(){const data=new Map();return{async get(k){return data.get(k);},async store(k,v){data.set(k,v);},async delete(k){data.delete(k);},data};}
async function fixture({expectedDigest,maxAgeSeconds=60,cookieScopeFactory=scope}={}){
  let credential=crypto.randomBytes(24).toString('hex'),validDigest=expectedDigest||digest(credential);
  const counts={},requests=[];let posts=0;const sockets=new Set();
  const cookie=value=>`synthetic_session=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
  const server=http.createServer((req,res)=>{
    const route=new URL(req.url,'http://127.0.0.1').pathname;counts[route]=(counts[route]||0)+1;
    const header=req.headers.cookie||'';const match=/(?:^|; )synthetic_session=([^;]*)/.exec(header);
    requests.push({route,method:req.method,cookiePresent:!!match,originPresent:!!req.headers.origin});
    const reply=(status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(body));};
    if(route==='/login'&&req.method==='POST'){credential=crypto.randomBytes(24).toString('hex');validDigest=digest(credential);return reply(200,{synthetic:true},{'Set-Cookie':cookie(credential)});}
    if(!match||digest(match[1])!==validDigest)return reply(401,{authenticated:false});
    if(route==='/rotate'){credential=crypto.randomBytes(24).toString('hex');validDigest=digest(credential);return reply(200,{authenticated:true},{'Set-Cookie':cookie(credential)});}
    if(route==='/delete'){validDigest='revoked';return reply(200,{authenticated:false},{'Set-Cookie':'synthetic_session=; Path=/; Max-Age=0'});}
    if(route==='/redirect')return reply(302,{redirect:true},{Location:'https://external.invalid/leak'});
    if(route==='/post'||route==='/drop-post'||route==='/hang-post'){
      posts++;
      if(req.headers.origin!=='https://www.session-test.invalid'||req.headers['x-csrf-token']!=='synthetic-csrf')return reply(403,{securityCheckFailed:true});
      if(route==='/drop-post'){req.socket.destroy();return;}
      if(route==='/hang-post')return;
      return reply(200,{accepted:true});
    }
    if(route==='/invalid-json'){res.writeHead(200);return res.end('{');}
    if(route==='/large'){res.writeHead(200);return res.end('x'.repeat(300000));}
    return reply(200,{authenticated:true,status:'success',data:{synthetic:true}});
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  const dispatch=({url,method,headers={},body,signal,maxBytes=1024*1024,onDispatch=()=>{}})=>new Promise((resolve,reject)=>{
    // Test-only wire adapter: logical HTTPS origin policy is evaluated by the
    // production code; only this fixture driver uses loopback HTTP. Not packaged.
    const req=http.request({hostname:'127.0.0.1',port,path:url.pathname+url.search,method,headers,signal},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();req.destroy();const e=new Error('Fixture size limit');e.code='INVALID_RESPONSE';reject(e);}else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,setCookie:res.headers['set-cookie']||[],body:Buffer.concat(chunks)}));res.on('error',()=>reject(new Error('Fixture response closed')));
    });req.on('error',()=>reject(new Error('Fixture request failed')));onDispatch();req.end(body);
  });
  const login=async()=>{
    const response=await dispatch({url:new URL('/login',ORIGIN),method:'POST'});
    const jar=new CookieJar(cookieScopeFactory());jar.applySetCookie(response.setCookie,ORIGIN+'/login');
    return{cookies:jar.record().cookies,sourceURL:ORIGIN+'/login'};
  };
  return{dispatch,login,counts,requests,get posts(){return posts;},get credentialDigest(){return validDigest;},revoke(){validDigest='revoked';},async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function routePolicy(route,method){if(!['GET','POST'].includes(method)||!/^\/(?:me|rotate|delete|redirect|post|drop-post|hang-post|invalid-json|large)$/.test(route)){const e=new Error('Unsupported fixture route');e.code='UNSUPPORTED';throw e;}return new URL(route,ORIGIN);}
const postContract=()=>({Origin:'https://www.session-test.invalid','X-CSRF-Token':'synthetic-csrf'});
module.exports={fixture,scope,memorySecrets,ORIGIN,routePolicy,postContract,digest};
