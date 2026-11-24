'use strict';

const { NAVBAR_GUARD, NAVBAR_MARKER } = require('./focus-navbar');

// The problem workspace header introduced in November 2026 contains its own
// list and navigation controls. The Problem/Theory/etc. row is in main.
const HEADER_BASE = 'div.h-dvh.flex.flex-col.overflow-hidden.relative.bg-background > header.relative.z-50.flex-shrink-0.border-b.border-border';
const HEADER_CANDIDATE = HEADER_BASE + NAVBAR_GUARD;
const HEADER_SELECTOR = `html[${NAVBAR_MARKER}="guarded"] ${HEADER_CANDIDATE}`;
const TONI_SELECTOR = 'main.flex-1.overflow-hidden.relative button.fixed.rounded-full[type="button"][aria-label="Ask Toni"][data-tour="toni-button"]';

// Both verifiers run inside the owned document. Only a boolean leaves it.
function verifyWorkspaceHeader(header) {
  const oneIcon = (node, name) => node.children.length === 1 && node.firstElementChild.matches('svg.lucide-' + name);
  const plain = node => node.children.length === 0 && !!node.textContent.trim();
  if (header.tagName !== 'HEADER' || header.children.length !== 1) return false;
  const bar = header.firstElementChild;
  if (!bar.matches('div.flex.h-14.items-center.justify-between') || bar.children.length !== 3) return false;
  const [left, center, right] = bar.children;
  if (!left.matches('div.flex.flex-shrink-0.items-center') || !center.matches('div.hidden.min-w-0.items-center') ||
      !right.matches('div.flex.min-w-0.items-center.justify-end') || right.children.length !== 1) return false;

  const [logo, ...navigation] = left.children;
  if (!logo?.matches('a[href="/problems"][aria-label="TensorTonic problems"]') ||
      logo.children.length !== 1 || !logo.firstElementChild.matches('img[alt="TensorTonic"]') || logo.textContent.trim()) return false;
  let i = 0;
  if (navigation[i]?.matches('button[type="button"][aria-label="Open problem list"][title="Problem list"], button[type="button"][aria-label="Open My Prep list"][title="My Prep"]')) {
    if (!oneIcon(navigation[i], 'panel-left') || navigation[i].textContent.trim()) return false;
    i++;
  }
  if (navigation[i]?.tagName === 'A') {
    for (const [label, icon] of [['Previous problem','chevron-left'], ['Next problem','chevron-right']]) {
      const link = navigation[i++];
      if (!link?.matches('a') || link.title !== label || link.getAttribute('aria-label') !== label ||
          link.textContent.trim() || !oneIcon(link, icon)) return false;
      const href = link.getAttribute('href');
      if (href === '#') {
        if (link.getAttribute('aria-disabled') !== 'true' || link.tabIndex !== -1) return false;
      } else if (!/^\/problems\/[a-zA-Z0-9-]+(?:\?studyPlan=[a-zA-Z0-9-]+)?$/.test(href)) {
        // Before the catalog resolves, the site links directly to the same plan's task.
        const task = /^\/study-plans\/([a-zA-Z0-9-]+)\/(?:(?:cuda|triton|sql)\/)?[a-zA-Z0-9-]+$/.exec(href);
        if (!task || task[1] !== new URL(header.ownerDocument.URL).searchParams.get('studyPlan')) return false;
      }
    }
  }
  if (navigation[i]?.matches('span.tabular-nums') && plain(navigation[i]) && /^\d+\s*\/\s*\d+$/.test(navigation[i].textContent.trim())) i++;
  if (i !== navigation.length) return false;

  // Breadcrumb, problem title and difficulty are the only text in the center.
  const trail = [...center.children];
  if (trail[0]?.tagName === 'A') {
    const crumb = trail.shift();
    if (!plain(crumb) || !/^\/(?:problems|prep|roadmap|study-plans\/[a-zA-Z0-9-]+)$/.test(crumb.getAttribute('href'))) return false;
    if (trail[0]?.matches('span') && trail[0].textContent.trim() === '/' && plain(trail[0])) trail.shift();
  }
  const title = trail.shift();
  if (!title?.matches('span.truncate.font-medium') || !title.textContent.trim() ||
      [...title.querySelectorAll('*')].some(node => !node.matches('strong,em,code,sub,sup,span') || node.attributes.length > 0)) return false;
  if (trail.length && !(trail.length === 2 && trail[0].matches('span[aria-hidden="true"]') &&
      plain(trail[0]) && trail[0].textContent.trim() === '·' && trail[1].matches('span.font-medium') &&
      plain(trail[1]) && /^(Easy|Medium|Hard)$/.test(trail[1].textContent.trim()))) return false;

  const actions = right.firstElementChild;
  if (!actions.matches('div.flex.items-center.flex-shrink-0') || ![3,4].includes(actions.children.length)) return false;
  const [discord, theme, ...user] = actions.children;
  if (!discord.matches('a[href="https://discord.gg/n7ruMwyJMA"][title="Join our Discord"]') ||
      discord.textContent.trim() || discord.children.length !== 1 || !discord.firstElementChild.matches('svg')) return false;
  if (!theme.matches('button') || theme.disabled || theme.children.length !== 2 ||
      !theme.firstElementChild.matches('svg.lucide-moon,svg.lucide-sun') ||
      !theme.lastElementChild.matches('span.sr-only') || theme.textContent.trim() !== 'Toggle theme') return false;
  if (user.length === 2) {
    const starred = user.shift();
    if (!starred.matches('a[href="/starred"][aria-label="Starred problems"]') || starred.textContent.trim() || !oneIcon(starred,'star')) return false;
  }
  const avatar = user[0];
  if (!avatar.matches('button.rounded-full.border[aria-haspopup="menu"][aria-expanded="false"][data-state="closed"]') ||
      avatar.textContent.trim().length > 2 || avatar.querySelector('a,button,[tabindex]')) return false;
  // A notice added as bare text to an otherwise known container must remain visible.
  for (const node of [header,bar,left,center,right,actions]) {
    if ([...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) return false;
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

module.exports = { HEADER_BASE, HEADER_CANDIDATE, HEADER_SELECTOR, TONI_SELECTOR, verifyWorkspaceHeader, verifyToniLauncher };
