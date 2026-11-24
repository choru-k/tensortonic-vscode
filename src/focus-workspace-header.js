'use strict';

const { NAVBAR_GUARD, NAVBAR_MARKER } = require('./focus-navbar');

// The problem workspace header introduced in November 2026 contains its own
// list and navigation controls. The Problem/Theory/etc. row is in main.
const HEADER_BASE = 'div.h-dvh.flex.flex-col.overflow-hidden.relative.bg-background > header.relative.z-50.flex-shrink-0.border-b.border-border';
const HEADER_CANDIDATE = HEADER_BASE + NAVBAR_GUARD;
const HEADER_SELECTOR = `html[${NAVBAR_MARKER}="guarded"] ${HEADER_CANDIDATE}`;
const TONI_SELECTOR = 'main.flex-1.overflow-hidden.relative button.fixed.rounded-full[type="button"][aria-label="Ask Toni"][data-tour="toni-button"]';

// The site changes its navigation and signed-in action slots independently.
// Identify the entire branded toolbar, keeping other page content outside it.
// This function also runs inside the owned document when the toolbar updates.
function verifyWorkspaceHeader(header, reject = () => false) {
  if (header.tagName !== 'HEADER') return reject('header-layout');
  const rows = header.querySelectorAll('div.flex.h-14.items-center.justify-between');
  if (rows.length !== 1) return reject('header-layout');
  const row = rows[0];
  // Frameworks may wrap the toolbar or mount an empty portal beside it.
  // A second visible region inside the header has a different purpose.
  const inertSibling = 'script,style,template,[hidden],:is(div,span):empty:not([role]):not([aria-label]):not([tabindex])';
  for (let child = row; child !== header; child = child.parentElement) {
    const parent = child.parentElement;
    if (!parent) return reject('header-layout');
    const otherRegion = [...parent.children].some(sibling => sibling !== child && !sibling.matches(inertSibling));
    const looseText = [...parent.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    if (otherRegion || looseText) return reject('header-layout');
  }
  if (row.querySelectorAll('a[href="/problems"][aria-label="TensorTonic problems"] img[alt="TensorTonic"]').length !== 1)
    return reject('header-navigation');
  if (!row.querySelector('a[href="/starred"],button[aria-haspopup="menu"][aria-expanded="false"]'))
    return reject('header-account');
  if (row.querySelector('main,article,section,nav[aria-label="Problem tabs"],[role="main"],[role="tabpanel"]'))
    return reject('header-layout');

  // Account controls can acquire badges, wrappers or extra links. Allow their
  // labels plus the normal breadcrumb, title, difficulty and position. A bare
  // notice inserted alongside the controls must still be able to surface.
  for (const node of [header, row, ...row.querySelectorAll('*')]) {
    if (node.closest('a,button,script,style,template,svg,span.truncate')) continue;
    for (const child of node.childNodes) {
      if (child.nodeType !== 3) continue;
      const text = child.textContent.trim();
      if (text && !/^(?:\d+\s*\/\s*\d+|\/|·|Easy|Medium|Hard)$/.test(text)) return reject('header-text');
    }
  }
  return true;
}

function verifyToniLauncher(button) {
  if (button.closest('form') || button.form || button.textContent.trim() !== 'Ask Toni' ||
      button.children.length !== 3 || button.querySelector('[role],[aria-live],[aria-modal],input,iframe,button,a,form')) return false;
  const [grip, bot, label] = button.children;
  return grip.matches('svg.lucide-grip-vertical') && bot.matches('svg.lucide-bot') &&
    label.matches('span') && !label.children.length && label.textContent.trim() === 'Ask Toni';
}

// Selectors identify candidates. The browser also checks each control's label,
// content and destination before including it in the stylesheet.
const WORKSPACE_CONTROLS = Object.freeze([
  ['workspace-list', 'button[type="button"]:is([aria-label="Open problem list"][title="Problem list"],[aria-label="Open My Prep list"][title="My Prep"])'],
  ['workspace-prev', 'a[aria-label="Previous problem"][title="Previous problem"]'],
  ['workspace-next', 'a[aria-label="Next problem"][title="Next problem"]'],
].map(([id, selector]) => Object.freeze({ id, candidate: HEADER_CANDIDATE + ' ' + selector })));

function verifyWorkspaceControl(node, id) {
  const icon = { 'workspace-list': 'panel-left', 'workspace-prev': 'chevron-left', 'workspace-next': 'chevron-right' }[id];
  if (!icon || node.textContent.trim() || node.children.length !== 1 || !node.firstElementChild.matches('svg.lucide-' + icon) ||
      node.closest('form') || node.hasAttribute('role') || node.hasAttribute('aria-live') ||
      node.querySelector('title,desc,foreignObject,[role],[aria-live],[tabindex],a,button')) return false;
  if (id === 'workspace-list') return node.tagName === 'BUTTON' && !node.form;
  if (node.tagName !== 'A') return false;
  const href = node.getAttribute('href');
  if (href === '#') return node.getAttribute('aria-disabled') === 'true' && node.tabIndex === -1;
  if (!href) return false;
  let url;
  try { url = new URL(href, node.ownerDocument.URL); } catch { return false; }
  if (url.origin !== 'https://www.tensortonic.com' || url.username || url.password || url.hash) return false;
  if (/^\/problems\/[a-zA-Z0-9-]+$/.test(url.pathname)) return !url.search || /^\?studyPlan=[a-zA-Z0-9-]+$/.test(url.search);
  const task = /^\/study-plans\/([a-zA-Z0-9-]+)\/(?:(?:cuda|triton|sql)\/)?[a-zA-Z0-9-]+$/.exec(url.pathname);
  return !!task && !url.search && task[1] === new URL(node.ownerDocument.URL).searchParams.get('studyPlan');
}

// Watch the proven controls themselves. An account badge or a timer elsewhere
// in the header may change without invalidating a separately verified button.
function installWorkspaceControlGuard(doc, headerSelector, targets, marker, verifyControl, verifyToni, Observer) {
  const root = doc.documentElement;
  if (!root || root.hasAttribute(marker) || typeof Observer !== 'function') return 0;
  const headers = doc.querySelectorAll(headerSelector);
  if (headers.length !== 1) return 0;
  const elements = targets.map(({ candidate }) => doc.querySelectorAll(candidate)[0]);
  let observer;
  function valid() {
    const current = doc.querySelectorAll(headerSelector);
    return root === doc.documentElement && current.length === 1 && current[0] === headers[0] &&
      targets.every(({ id, candidate }, index) => {
        const nodes = doc.querySelectorAll(candidate), node = elements[index];
        return nodes.length === 1 && nodes[0] === node && node.isConnected &&
          (id === 'ask-toni' ? verifyToni(node) : verifyControl(node, id));
      });
  }
  function revoke() {
    observer?.disconnect();
    for (const element of [root, doc.documentElement]) {
      if (element?.getAttribute(marker) === 'guarded') element.removeAttribute(marker);
    }
  }
  try {
    if (!valid()) return 0;
    observer = new Observer(() => {
      if (root.getAttribute(marker) !== 'guarded') { observer.disconnect(); return; }
      try { if (!valid()) revoke(); } catch { revoke(); }
    });
    // Recheck uniqueness even if a duplicate is inserted on another branch.
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    observer.observe(doc, { childList: true });
    root.setAttribute(marker, 'guarded');
    observer.takeRecords();
    return 1;
  } catch { revoke(); return 0; }
}

module.exports = { HEADER_BASE, HEADER_CANDIDATE, HEADER_SELECTOR, TONI_SELECTOR, WORKSPACE_CONTROLS,
  verifyWorkspaceHeader, verifyToniLauncher, verifyWorkspaceControl, installWorkspaceControlGuard };
