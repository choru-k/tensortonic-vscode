'use strict';

// Public /problems/relu SSR and Navbar bundle 2xv1uplc4nzzv.js, reviewed
// 2026-11-03. This is the outer capsule, not the problem tabs or a drawer.
const NAVBAR_BASE = 'div.h-dvh.flex.flex-col.overflow-hidden.relative.bg-background > nav.text-foreground.sticky.top-0.z-50.w-full.pt-3.pb-1';
// CSS keeps semantic notices/authentication and opened menus visible even if
// they appear after the pre-apply check. This exact suffix is the only allowed
// functional selector exception in the generic adapter.
const NAVBAR_GUARD = ':not([role]):not([aria-live]):not(:has(form,input,textarea,select,iframe,dialog,[form],[role="alert"],[role="alertdialog"],[role="dialog"],[role="status"],[role="tablist"],[role="tab"],[aria-live],[aria-modal],[aria-expanded="true"],[data-state="open"],a[href^="/auth"],button[aria-label="Close menu"]))';
const NAVBAR_CANDIDATE = NAVBAR_BASE + NAVBAR_GUARD;
const NAVBAR_MARKER = 'data-tensortonic-focus-capsule';
const NAVBAR_SELECTOR = 'html[' + NAVBAR_MARKER + '="guarded"] ' + NAVBAR_CANDIDATE;

// Self-contained for execution inside the already-owned page. No state reads,
// DOM writes, credentials, account names or avatar URLs cross the browser port.
function verifyNavbar(e) {
  try {
    const one = (root, selector) => { const nodes = root.querySelectorAll(selector); return nodes.length === 1 ? nodes[0] : null; };
    if (e.tagName !== 'NAV' || e.children.length !== 1 || !e.firstElementChild.matches('div.px-3')) return false;
    const wrapper = e.firstElementChild;
    if (wrapper.children.length !== 1) return false;
    const capsule = wrapper.firstElementChild;
    if (!capsule.matches('div.h-14.flex.items-center.justify-between.pl-5.pr-3.rounded-full.border.backdrop-blur-2xl.border-border') || capsule.children.length !== 2) return false;
    const [left, right] = capsule.children;
    if (!left.matches('div.flex.items-center.gap-2.flex-shrink-0') || left.children.length !== 2 || !right.matches('div.flex.items-center.flex-shrink-0')) return false;
    const brand = left.children[0], links = left.children[1];
    if (!brand.matches('div.flex.items-center.gap-2') || brand.children.length !== 2 || !links.matches('div.hidden.items-center.gap-6')) return false;
    const menu = brand.children[0], logo = brand.children[1];
    if (!menu.matches('button[aria-label="Open menu"]') || menu.textContent.trim() || !one(menu, 'svg.lucide-menu')) return false;
    if (!logo.matches('a[href="/problems"]') || logo.textContent.trim() !== 'TensorTonic' || !one(logo, 'img[alt="TensorTonic"]')) return false;
    const expectedLinks = new Map([['/problems','Problems'],['/study-plans','Study Plans'],['/projects','Projects'],['/assessments','Interview'],['/pricing','Pricing'],['/feedback','Feedback']]);
    for (const child of links.children) {
      if (child.tagName === 'A') { if (expectedLinks.get(child.getAttribute('href')) !== child.textContent.trim()) return false; expectedLinks.delete(child.getAttribute('href')); }
      else if (!child.matches('div.relative') || child.children.length !== 1 || !child.firstElementChild.matches('button') || child.textContent.trim() !== 'Explore' || !one(child, 'svg.lucide-chevron-down')) return false;
    }
    if (links.querySelectorAll('a').length !== 6 || links.querySelectorAll('button').length !== 1) return false;
    const children = [...right.children];
    if (![4,5].includes(children.length)) return false;
    const [news, discord, theme] = children, avatar = children.at(-1);
    if (!news.matches('a[href="/changelog"][title="What\'s new"]') || !["What's new", "What's new, unread updates"].includes(news.getAttribute('aria-label')) || news.textContent.trim() || !one(news, 'svg.lucide-megaphone')) return false;
    if (!discord.matches('a[href="https://discord.gg/n7ruMwyJMA"][title="Join our Discord"]') || discord.textContent.trim() || !one(discord, 'svg')) return false;
    if (!theme.matches('button') || theme.textContent.trim() !== 'Toggle theme' || theme.disabled || theme.querySelectorAll('svg.lucide-moon,svg.lucide-sun').length !== 1) return false;
    if (children.length === 5 && (!children[3].matches('a[href="/starred"][aria-label="Starred problems"]') || children[3].textContent.trim() || !one(children[3], 'svg.lucide-star'))) return false;
    if (!avatar.matches('button.rounded-full.border[aria-haspopup="menu"][aria-expanded="false"][data-state="closed"]') || avatar.textContent.trim().length > 2) return false;
    // Reject unrelated content, login actions, warning text, forms and dialogs.
    const safeText = new Set(['TensorTonic','Problems','Roadmap','Explore','Study Plans','Projects','Interview','Pricing','Feedback','Toggle theme']);
    for (const node of [e, ...e.querySelectorAll('*')]) {
      if (node !== e && !['DIV','SPAN','A','BUTTON','IMG','svg','path','circle','rect','line','polyline','polygon','g'].includes(node.tagName)) return false;
      if (node.closest('button[aria-haspopup="menu"]') === avatar) continue;
      for (const child of node.childNodes) if (child.nodeType === 3 && child.textContent.trim() && !safeText.has(child.textContent.trim())) return false;
    }
    return true;
  } catch (_) { return false; }
}

module.exports = { NAVBAR_BASE, NAVBAR_GUARD, NAVBAR_CANDIDATE, NAVBAR_MARKER, NAVBAR_SELECTOR, verifyNavbar };

// The marker gates CSS on the document root, never on a replaceable/clonable
// navbar node. Any observed change irrevocably opens the capsule again.
function installNavbarGuard(doc, candidateSelector, marker, verify, Observer) {
  const root = doc.documentElement;
  if (!root || root.hasAttribute(marker) || typeof Observer !== 'function') return 0;
  const nodes = doc.querySelectorAll(candidateSelector);
  if (nodes.length !== 1) return 0;
  const nav = nodes[0]; let observer;
  const revoke = () => {
    observer?.disconnect();
    if (root.getAttribute(marker) === 'guarded') root.removeAttribute(marker);
    const currentRoot = doc.documentElement;
    if (currentRoot !== root && currentRoot?.getAttribute(marker) === 'guarded') currentRoot.removeAttribute(marker);
  };
  try {
    observer = new Observer(revoke);
    observer.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true });
    for (let parent = nav.parentNode; parent; parent = parent.parentNode) observer.observe(parent, { childList: true, attributes: true });
    if (!nav.isConnected || !verify(nav)) { revoke(); return 0; }
    root.setAttribute(marker, 'guarded');
    observer.takeRecords(); // Only our synchronous root-marker write.
    return 1;
  } catch (_) { revoke(); return 0; }
}
module.exports.installNavbarGuard = installNavbarGuard;
