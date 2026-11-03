'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyNavbar, installNavbarGuard, NAVBAR_MARKER, NAVBAR_SELECTOR, NAVBAR_GUARD } = require('../src/focus-navbar');
const { makeNavbar } = require('./helpers/focus-navbar-fixture');
test('capsule structural guard accepts only the reviewed closed signed-in shape', () => {
  const f = makeNavbar(); assert.equal(verifyNavbar(f.nav), true);
  f.nav.children.push(f.element('DIV', [], 'Security warning')); assert.equal(verifyNavbar(f.nav), false);
  assert.equal(verifyNavbar({}), false); assert.equal(verifyNavbar(null), false);
});
test('capsule CSS has continuous semantic/auth/menu exclusions, not a bare nav rule', () => {
  assert.ok(NAVBAR_SELECTOR.startsWith('html[data-tensortonic-focus-capsule="guarded"] div.h-dvh.flex.flex-col.overflow-hidden.relative.bg-background > nav.'));
  for (const text of ['form','input','dialog','[role="alert"]','[aria-live]','[data-state="open"]','a[href^="/auth"]']) assert.ok(NAVBAR_GUARD.includes(text));
});

test('direct NAV warning text cannot bypass the descendant text allowlist', () => {
  const f = makeNavbar(); f.nav.childNodes.push({ nodeType: 3, textContent: 'Session expired' });
  assert.equal(verifyNavbar(f.nav), false);
});

test('observer is installed before proof and revokes on arbitrary text, structure or replacement changes', () => {
  for (const change of ['characterData','childList','attributes','replacement']) {
    const f = makeNavbar(), attrs = new Map(), observed = []; let callback, disconnected = false;
    const root = { parentNode: null, hasAttribute: key => attrs.has(key), getAttribute: key => attrs.get(key), setAttribute: (key,value) => attrs.set(key,value), removeAttribute: key => attrs.delete(key) };
    const doc = { documentElement: root, querySelectorAll: () => [f.nav] };
    root.parentNode = doc; f.nav.parentNode = root; f.nav.isConnected = true;
    class Observer { constructor(fn) { callback = fn; } observe(node, options) { observed.push([node, options]); } disconnect() { disconnected = true; } takeRecords() { return []; } }
    assert.equal(installNavbarGuard(doc, 'candidate', NAVBAR_MARKER, node => { assert.equal(observed.length, 3); return verifyNavbar(node); }, Observer), 1);
    assert.equal(attrs.get(NAVBAR_MARKER), 'guarded'); callback([{type:change}]);
    assert.equal(attrs.has(NAVBAR_MARKER), false); assert.equal(disconnected, true);
    assert.equal(observed[0][1].characterData, true); assert.equal(observed[0][1].subtree, true);
  }
});
test('root replacement clears a cloned gate and cannot keep a replacement capsule hidden', () => {
  const f = makeNavbar(); let callback;
  const makeRoot = () => ({ attrs: new Map(), hasAttribute(k) { return this.attrs.has(k); }, getAttribute(k) { return this.attrs.get(k); }, setAttribute(k,v) { this.attrs.set(k,v); }, removeAttribute(k) { this.attrs.delete(k); } });
  const root = makeRoot(), doc = { documentElement: root, querySelectorAll: () => [f.nav] };
  f.nav.parentNode = root; f.nav.isConnected = true;
  class Observer { constructor(fn) { callback = fn; } observe() {} disconnect() {} takeRecords() {} }
  assert.equal(installNavbarGuard(doc, 'candidate', NAVBAR_MARKER, verifyNavbar, Observer), 1);
  doc.documentElement = makeRoot(); doc.documentElement.setAttribute(NAVBAR_MARKER,'guarded');
  callback(); assert.equal(root.hasAttribute(NAVBAR_MARKER),false); assert.equal(doc.documentElement.hasAttribute(NAVBAR_MARKER),false);
});
