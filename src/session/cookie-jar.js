'use strict';

const { fault } = require('./fault');
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const COOKIE_FIELDS = ['name','value','domain','path','hostOnly','secure','httpOnly','sameSite','expiresAt','created','persistent'];
const MAX_COOKIE_TIME=8640000000000000;
function domainMatch(host, domain) { return host === domain || host.endsWith('.' + domain); }
function pathMatch(path, scope) { return path === scope || path.startsWith(scope) && (scope.endsWith('/') || path[scope.length] === '/'); }
function defaultPath(path) { const end = path.lastIndexOf('/'); return !path.startsWith('/') || end <= 0 ? '/' : path.slice(0, end); }
function host(value) {
  if (typeof value !== 'string' || value.length > 253 || !HOST.test(value) || value !== value.toLowerCase()) throw fault('COOKIE_POLICY');
  return value;
}
function cookieScope({ names, requiredNames = names, hosts, domains, retention='bounded',maxLocalAgeMs, requireSecure = true, requireHttpOnly = true, attributes }) {
  if (!Array.isArray(names) || !names.length || names.length > 16 || names.some(x => typeof x !== 'string' || !TOKEN.test(x)) || new Set(names).size !== names.length) throw fault('SESSION_SCOPE_UNVERIFIED');
  if (!Array.isArray(requiredNames) || !requiredNames.length || requiredNames.some(x => !names.includes(x))) throw fault('COOKIE_POLICY');
  if (!Array.isArray(hosts) || !hosts.length || !Array.isArray(domains) || !domains.length) throw fault('COOKIE_POLICY');
  hosts.forEach(host); domains.forEach(host);
  if(domains.some(d=>!hosts.some(h=>domainMatch(h,d)))||!['bounded','server'].includes(retention))throw fault('COOKIE_POLICY');
  if(retention==='bounded'){
    maxLocalAgeMs??=8*60*60*1000;
    if(!Number.isSafeInteger(maxLocalAgeMs)||maxLocalAgeMs<1000||maxLocalAgeMs>24*60*60*1000)throw fault('COOKIE_POLICY');
  }else{
    if(maxLocalAgeMs!==undefined&&maxLocalAgeMs!==null||!requireSecure||!requireHttpOnly)throw fault('COOKIE_POLICY');maxLocalAgeMs=null;
  }
  if(attributes!==undefined){
    if(!attributes||typeof attributes!=='object'||Array.isArray(attributes)||Object.keys(attributes).some(key=>!['path','hostOnly','secure','httpOnly','sameSite'].includes(key)))throw fault('COOKIE_POLICY');
    if('path' in attributes&&(typeof attributes.path!=='string'||!attributes.path.startsWith('/')||/[\x00-\x20\x7f;]/.test(attributes.path))||['hostOnly','secure','httpOnly'].some(key=>key in attributes&&typeof attributes[key]!=='boolean')||'sameSite' in attributes&&!['Strict','Lax','None',null].includes(attributes.sameSite))throw fault('COOKIE_POLICY');
    attributes=Object.freeze({...attributes});
  }
  // Domains are an exact reviewed allowlist, never a guessed public-suffix rule.
  return Object.freeze({ names: Object.freeze([...names]), requiredNames: Object.freeze([...requiredNames]), hosts: Object.freeze([...hosts]), domains: Object.freeze([...domains]), retention,maxLocalAgeMs, requireSecure, requireHttpOnly, ...(attributes?{attributes}:{}) });
}
function scopedURL(value, scope) {
  let url; try { url = new URL(value); } catch { throw fault('UNSUPPORTED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !scope.hosts.includes(url.hostname)) throw fault('UNSUPPORTED');
  return url;
}
class CookieJar {
  constructor(scope, { now = Date.now, record } = {}) {
    this.scope = scope; this.now = now; this.changed = false;
    this.serverExpiry=scope.retention==='server';
    this.expiresAt = this.serverExpiry?null:record?.expiresAt ?? now() + scope.maxLocalAgeMs;
    this.cookies = [];
    if(!this.serverExpiry&&(!Number.isFinite(this.expiresAt)||this.expiresAt>now()+scope.maxLocalAgeMs))throw fault('COOKIE_POLICY');
    if (record) {
      if((this.serverExpiry?(record.version!==2||record.retention!=='server'||record.expiresAt!==null):record.version!==1)||!Array.isArray(record.cookies)||record.cookies.length>16)throw fault('COOKIE_POLICY');
      for (const cookie of record.cookies) this._put(this._validate(cookie));
      this.changed = false;
    }
    this._prune();
  }
  _validate(c) {
    if (!c || typeof c !== 'object' || Object.keys(c).some(k => !COOKIE_FIELDS.includes(k)) || !this.scope.names.includes(c.name) || !TOKEN.test(c.name) || typeof c.value !== 'string' || c.value.length > 8192 || !VALUE.test(c.value)) throw fault('COOKIE_POLICY');
    host(c.domain);
    if (!this.scope.domains.includes(c.domain) || typeof c.path !== 'string' || !c.path.startsWith('/') || /[\x00-\x20\x7f;]/.test(c.path) || c.path.length > 1024 || typeof c.hostOnly !== 'boolean' || typeof c.secure !== 'boolean' || typeof c.httpOnly !== 'boolean' || !['Strict','Lax','None',null].includes(c.sameSite) || !Number.isFinite(c.expiresAt) || c.expiresAt>MAX_COOKIE_TIME || this.expiresAt!==null&&c.expiresAt>this.expiresAt || !Number.isSafeInteger(c.created) || c.created < 0 || c.persistent!==undefined&&typeof c.persistent!=='boolean' || this.serverExpiry&&c.persistent!==true) throw fault('COOKIE_POLICY');
    if (this.scope.requireSecure && !c.secure || this.scope.requireHttpOnly && !c.httpOnly || c.sameSite === 'None' && !c.secure) throw fault('COOKIE_POLICY');
    if (/^__Secure-/i.test(c.name) && !c.secure || /^__Host-/i.test(c.name) && (!c.secure || !c.hostOnly || c.path !== '/')) throw fault('COOKIE_POLICY');
    if (c.hostOnly && !this.scope.hosts.includes(c.domain)) throw fault('COOKIE_POLICY');
    if(this.scope.attributes&&Object.entries(this.scope.attributes).some(([key,value])=>c[key]!==value))throw fault('COOKIE_POLICY');
    return { ...c };
  }
  _put(cookie) {
    const index = this.cookies.findIndex(c => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path);
    if (index >= 0) cookie.created = this.cookies[index].created;
    if (cookie.expiresAt <= this.now()) { if (index >= 0) this.cookies.splice(index,1); this.changed = true; return; }
    if (index >= 0) this.cookies[index] = cookie; else this.cookies.push(cookie);
    if (this.cookies.length > 16) throw fault('COOKIE_POLICY');
    this.changed = true;
  }
  _prune() {
    const before = this.cookies.length;
    this.cookies = this.cookies.filter(c => c.expiresAt > this.now() && (this.expiresAt===null||this.expiresAt > this.now()));
    if (before !== this.cookies.length) this.changed = true;
  }
  importCookies(cookies, sourceURL) {
    const url = scopedURL(sourceURL,this.scope);
    if (!Array.isArray(cookies) || cookies.length > 16) throw fault('COOKIE_POLICY');
    for (const raw of cookies) {
      const c = this._validate({ ...raw, expiresAt: this.expiresAt===null?raw.expiresAt:Math.min(raw.expiresAt,this.expiresAt) });
      if (c.hostOnly ? c.domain !== url.hostname : !domainMatch(url.hostname,c.domain)) throw fault('COOKIE_POLICY');
      this._put(c);
    }
  }
  applySetCookie(headers, sourceURL) {
    const url = scopedURL(sourceURL,this.scope);
    if (!Array.isArray(headers) || headers.length > 64) throw fault('COOKIE_POLICY');
    for (const line of headers) {
      if (typeof line !== 'string' || line.length > 16384 || /[\r\n\x00]/.test(line)) throw fault('COOKIE_POLICY');
      const parts = line.split(';'); const pair = parts.shift(); const equal = pair.indexOf('=');
      if (equal < 1) continue;
      const name = pair.slice(0,equal).trim();
      if (!this.scope.names.includes(name)) continue;
      let value = pair.slice(equal+1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1,-1);
      const attrs = new Map();
      for (const part of parts) { const at=part.indexOf('='); attrs.set((at<0?part:part.slice(0,at)).trim().toLowerCase(),at<0?'':part.slice(at+1).trim()); }
      const hostOnly = !attrs.has('domain');
      const domain = hostOnly ? url.hostname : attrs.get('domain').toLowerCase().replace(/^\./,'');
      host(domain);
      if (!this.scope.domains.includes(domain) || !domainMatch(url.hostname,domain) || !hostOnly && /^(?:\d+\.){3}\d+$/.test(domain)) throw fault('COOKIE_POLICY');
      const path = attrs.get('path')?.startsWith('/') ? attrs.get('path') : defaultPath(url.pathname);
      let expiresAt = this.expiresAt,persistent=false;
      const maxAge = attrs.get('max-age');
      if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) {
        const age = Number(maxAge);if(!Number.isSafeInteger(age))throw fault('COOKIE_POLICY');persistent=true;
        const serverTime=age<=0?0:this.now()+(this.serverExpiry?age:Math.min(age,86400))*1000;
        if(!Number.isFinite(serverTime)||serverTime>MAX_COOKIE_TIME)throw fault('COOKIE_POLICY');expiresAt=this.serverExpiry?serverTime:Math.min(this.expiresAt,serverTime);
      } else if (attrs.has('expires') && Number.isFinite(Date.parse(attrs.get('expires')))) {persistent=true;const serverTime=Date.parse(attrs.get('expires'));expiresAt=this.serverExpiry?serverTime:Math.min(this.expiresAt,serverTime);}
      if(this.serverExpiry&&!persistent)throw fault('COOKIE_POLICY');
      if (expiresAt <= this.now()) {
        this.cookies = this.cookies.filter(c => !(c.name===name&&c.domain===domain&&c.path===path));this.changed=true;continue;
      }
      const sameSite = { strict:'Strict',lax:'Lax',none:'None' }[attrs.get('samesite')?.toLowerCase()] ?? null;
      this._put(this._validate({ name,value,domain,path,hostOnly,secure:attrs.has('secure'),httpOnly:attrs.has('httponly'),sameSite,expiresAt,created:this.cookies.length,persistent }));
    }
    this._prune();
  }
  matching(value) {
    const url = scopedURL(value,this.scope); this._prune();
    return this.cookies.filter(c => (c.hostOnly?c.domain===url.hostname:domainMatch(url.hostname,c.domain)) && pathMatch(url.pathname,c.path) && (!c.secure||url.protocol==='https:')).sort((a,b)=>b.path.length-a.path.length||a.created-b.created);
  }
  canAuthenticate(value) { const cookies=this.matching(value);return this.scope.requiredNames.every(name=>cookies.some(c=>c.name===name&&c.value.length>0)); }
  header(value) { return this.matching(value).map(c=>`${c.name}=${c.value}`).join('; '); }
  record() { this._prune(); return { version:this.serverExpiry?2:1,...(this.serverExpiry?{retention:'server'}:{}), expiresAt:this.expiresAt, cookies:this.cookies.map(c=>({...c})) }; }
}
module.exports = { CookieJar, cookieScope, domainMatch, pathMatch };
