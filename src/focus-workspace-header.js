'use strict';

const { NAVBAR_GUARD, NAVBAR_MARKER } = require('./focus-navbar');

// The problem workspace header introduced in November 2026 contains its own
// list and navigation controls. The Problem/Theory/etc. row is in main.
const HEADER_BASE = 'div.h-dvh.flex.flex-col.overflow-hidden.relative.bg-background > header.relative.z-50.flex-shrink-0.border-b.border-border';
const HEADER_CANDIDATE = HEADER_BASE + NAVBAR_GUARD;
const HEADER_SELECTOR = `html[${NAVBAR_MARKER}="guarded"] ${HEADER_CANDIDATE}`;
const TONI_SELECTOR = 'main.flex-1.overflow-hidden.relative button.fixed.rounded-full[type="button"][aria-label="Ask Toni"][data-tour="toni-button"]';

// Both verifiers run inside the owned document. Only a boolean leaves it.
function verifyWorkspaceHeader(header, reject = () => false) {
  const oneIcon = (node, name) => node.children.length === 1 && node.firstElementChild.matches('svg.lucide-' + name);
  const plain = node => node.children.length === 0 && !!node.textContent.trim();
  if (header.tagName !== 'HEADER' || header.children.length !== 1) return reject('header-layout');
  const bar = header.firstElementChild;
  if (!bar.matches('div.flex.h-14.items-center.justify-between') || bar.children.length !== 3) return reject('header-layout');
  const [left, center, right] = bar.children;
  if (!left.matches('div.flex.flex-shrink-0.items-center') || !center.matches('div.hidden.min-w-0.items-center') ||
      !right.matches('div.flex.min-w-0.items-center.justify-end') || right.children.length !== 1) return reject('header-layout');

  const [logo, ...navigation] = left.children;
  if (!logo?.matches('a[href="/problems"][aria-label="TensorTonic problems"]') ||
      logo.children.length !== 1 || !logo.firstElementChild.matches('img[alt="TensorTonic"]') || logo.textContent.trim()) return reject('header-navigation');
  let i = 0;
  if (navigation[i]?.matches('button[type="button"][aria-label="Open problem list"][title="Problem list"], button[type="button"][aria-label="Open My Prep list"][title="My Prep"]')) {
    if (!oneIcon(navigation[i], 'panel-left') || navigation[i].textContent.trim()) return reject('header-navigation');
    i++;
  }
  if (navigation[i]?.tagName === 'A') {
    for (const [label, icon] of [['Previous problem','chevron-left'], ['Next problem','chevron-right']]) {
      const link = navigation[i++];
      if (!link?.matches('a') || link.title !== label || link.getAttribute('aria-label') !== label ||
          link.textContent.trim() || !oneIcon(link, icon)) return reject('header-navigation');
      const href = link.getAttribute('href');
      if (href === '#') {
        if (link.getAttribute('aria-disabled') !== 'true' || link.tabIndex !== -1) return reject('header-navigation');
      } else if (!/^\/problems\/[a-zA-Z0-9-]+(?:\?studyPlan=[a-zA-Z0-9-]+)?$/.test(href)) {
        // Before the catalog resolves, the site links directly to the same plan's task.
        const task = /^\/study-plans\/([a-zA-Z0-9-]+)\/(?:(?:cuda|triton|sql)\/)?[a-zA-Z0-9-]+$/.exec(href);
        if (!task || task[1] !== new URL(header.ownerDocument.URL).searchParams.get('studyPlan')) return reject('header-navigation');
      }
    }
  }
  if (navigation[i]?.matches('span.tabular-nums') && plain(navigation[i]) && /^\d+\s*\/\s*\d+$/.test(navigation[i].textContent.trim())) i++;
  if (i !== navigation.length) return reject('header-navigation');

  // Breadcrumb, problem title and difficulty are the only text in the center.
  const trail = [...center.children];
  if (trail[0]?.tagName === 'A') {
    const crumb = trail.shift();
    if (!plain(crumb) || !/^\/(?:problems|prep|roadmap|study-plans\/[a-zA-Z0-9-]+)$/.test(crumb.getAttribute('href'))) return reject('header-title');
    if (trail[0]?.matches('span') && trail[0].textContent.trim() === '/' && plain(trail[0])) trail.shift();
  }
  const title = trail.shift();
  if (!title?.matches('span.truncate.font-medium') || !title.textContent.trim() ||
      [...title.querySelectorAll('*')].some(node => !node.matches('strong,em,code,sub,sup,span') || node.attributes.length > 0)) return reject('header-title');
  if (trail.length && !(trail.length === 2 && trail[0].matches('span[aria-hidden="true"]') &&
      plain(trail[0]) && trail[0].textContent.trim() === '·' && trail[1].matches('span.font-medium') &&
      plain(trail[1]) && /^(Easy|Medium|Hard)$/.test(trail[1].textContent.trim()))) return reject('header-title');

  const actions = right.firstElementChild;
  if (!actions.matches('div.flex.items-center.flex-shrink-0') || ![3,4].includes(actions.children.length)) return reject('header-actions');
  const [discord, theme, ...user] = actions.children;
  if (!discord.matches('a[href="https://discord.gg/n7ruMwyJMA"][title="Join our Discord"]') ||
      discord.textContent.trim() || discord.children.length !== 1 || !discord.firstElementChild.matches('svg')) return reject('header-actions');
  if (!theme.matches('button') || theme.disabled || theme.children.length !== 2 ||
      !theme.firstElementChild.matches('svg.lucide-moon,svg.lucide-sun') ||
      !theme.lastElementChild.matches('span.sr-only') || theme.textContent.trim() !== 'Toggle theme') return reject('header-actions');
  if (user.length === 2) {
    const starred = user.shift();
    if (!starred.matches('a[href="/starred"][aria-label="Starred problems"]') || starred.textContent.trim() || !oneIcon(starred,'star')) return reject('header-actions');
  }
  const avatar = user[0];
  if (!avatar.matches('button.rounded-full.border[aria-haspopup="menu"][aria-expanded="false"][data-state="closed"]') ||
      avatar.textContent.trim().length > 2 || avatar.querySelector('a,button,[tabindex]')) return reject('header-account');
  // A notice added as bare text to an otherwise known container must remain visible.
  for (const node of [header,bar,left,center,right,actions]) {
    if ([...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) return reject('header-text');
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
