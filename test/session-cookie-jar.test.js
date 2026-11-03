'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CookieJar,cookieScope,pathMatch}=require('../src/session/cookie-jar');
const {scope,ORIGIN}=require('./fixtures/session');
const line=(extra='')=>'synthetic_session=synthetic-value; Secure; HttpOnly; Path=/; '+extra;
test('cookie policy requires a reviewed nonempty name scope',()=>{
  for(const names of [[],null,['bad name'],['a','a']])assert.throws(()=>cookieScope({names,hosts:['api.example.test'],domains:['example.test']}),{code:'SESSION_SCOPE_UNVERIFIED'});
});
test('host-only cookies never reach a sibling host; domain cookies can reach reviewed hosts',()=>{
  const jar=new CookieJar(scope());jar.applySetCookie([line()],ORIGIN+'/login');
  assert.ok(jar.canAuthenticate(ORIGIN+'/me'));assert.equal(jar.header('https://www.session-test.invalid/me'),'');
  jar.applySetCookie([line('Domain=session-test.invalid')],ORIGIN+'/login');
  assert.ok(jar.canAuthenticate('https://www.session-test.invalid/me'));
});
test('path matching follows path boundaries and default directory',()=>{
  assert.equal(pathMatch('/api2','/api'),false);assert.equal(pathMatch('/api/a','/api'),true);
  const jar=new CookieJar(scope());jar.applySetCookie(['synthetic_session=synthetic-value; Secure; HttpOnly'],ORIGIN+'/api/login');
  assert.ok(jar.canAuthenticate(ORIGIN+'/api/me'));assert.equal(jar.header(ORIGIN+'/me'),'');
});
test('unapproved/public suffix, sibling and trailing-dot Domain attributes are rejected',()=>{
  for(const domain of ['invalid','com','evil.invalid','api.session-test.invalid.','other.session-test.invalid']){
    const jar=new CookieJar(scope());assert.throws(()=>jar.applySetCookie([line('Domain='+domain)],ORIGIN+'/login'),{code:'COOKIE_POLICY'});
  }
});
test('HTTPS, host and port boundaries reject a cookie-header request before exposing a value',()=>{
  const jar=new CookieJar(scope());jar.applySetCookie([line()],ORIGIN);
  for(const url of ['http://api.session-test.invalid/me','https://external.invalid/me','https://api.session-test.invalid:444/me','https://user:pass@api.session-test.invalid/me'])assert.throws(()=>jar.header(url),{code:'UNSUPPORTED'});
});
test('Secure, HttpOnly, SameSite and cookie prefixes fail closed',()=>{
  for(const cookie of ['synthetic_session=x; HttpOnly','synthetic_session=x; Secure','synthetic_session=x; SameSite=None; HttpOnly'])assert.throws(()=>new CookieJar(scope()).applySetCookie([cookie],ORIGIN),{code:'COOKIE_POLICY'});
  const prefixed=cookieScope({names:['__Host-session'],hosts:['api.session-test.invalid'],domains:['api.session-test.invalid','session-test.invalid']});
  for(const attributes of ['Domain=session-test.invalid; Path=/','Path=/api'])assert.throws(()=>new CookieJar(prefixed).applySetCookie(['__Host-session=x; Secure; HttpOnly; '+attributes],ORIGIN),{code:'COOKIE_POLICY'});
});
test('Max-Age overrides Expires and local consent lifetime bounds rotation',()=>{
  let now=1700000000000;const jar=new CookieJar(scope(),{now:()=>now});
  jar.applySetCookie([line('Max-Age=10; Expires=Fri, 01 Jan 2100 00:00:00 GMT')],ORIGIN);
  now+=11000;assert.equal(jar.canAuthenticate(ORIGIN+'/me'),false);
  const fresh=new CookieJar(scope(),{now:()=>now});const cap=fresh.expiresAt;
  fresh.applySetCookie([line('Max-Age=99999999')],ORIGIN);assert.equal(fresh.record().cookies[0].expiresAt,cap);
});
test('deletion and expiration remove required authentication, including deletion without Secure attributes',()=>{
  const jar=new CookieJar(scope());jar.applySetCookie([line()],ORIGIN);jar.applySetCookie(['synthetic_session=; Max-Age=0; Path=/'],ORIGIN);assert.equal(jar.canAuthenticate(ORIGIN+'/me'),false);
  jar.applySetCookie([line()],ORIGIN);jar.applySetCookie([line('Expires=Thu, 01 Jan 1970 00:00:00 GMT')],ORIGIN);assert.equal(jar.canAuthenticate(ORIGIN+'/me'),false);
});
test('scope excludes unrelated cookies and header injection; records reject tampering',()=>{
  const jar=new CookieJar(scope());jar.applySetCookie(['analytics=unrelated; Path=/'],ORIGIN);assert.equal(jar.record().cookies.length,0);
  for(const cookie of [line()+'\r\nInjected: value','synthetic_session=bad,value; Secure; HttpOnly'])assert.throws(()=>jar.applySetCookie([cookie],ORIGIN),{code:'COOKIE_POLICY'});
  jar.applySetCookie([line()],ORIGIN);const record=jar.record();record.cookies[0].domain='external.invalid';assert.throws(()=>new CookieJar(scope(),{record}),{code:'COOKIE_POLICY'});
});
test('cookie headers order specific paths before broad paths without combining Set-Cookie Expires commas',()=>{
  const jar=new CookieJar(scope());jar.applySetCookie([line(),line('Path=/api; Expires=Fri, 01 Jan 2100 00:00:00 GMT')],ORIGIN);
  const cookies=jar.matching(ORIGIN+'/api/me');assert.equal(cookies.length,2);assert.equal(cookies[0].path,'/api');
});
