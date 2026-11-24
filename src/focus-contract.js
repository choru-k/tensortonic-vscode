'use strict';
const { NAVBAR_SELECTOR, NAVBAR_MARKER } = require('./focus-navbar');
const { HEADER_SELECTOR, TONI_SELECTOR, WORKSPACE_CONTROLS } = require('./focus-workspace-header');

// These controls were observed on an owned canonical problem page at desktop
// and narrow widths on 2026-11-03. Each must retain its exact structure and
// semantics. A changed/boundary page stays visible. No drawer content, assistant
// conversation, login or security notice is a hide target. The top capsule
// uses a separate public-source-reviewed structural and semantic guard.
const mobile = 'div[class~="md:hidden"] > div.flex-shrink-0.flex.items-center.justify-between.px-4.py-2.border-t.border-border.bg-card > a';
const mobileNav = 'div[class~="md:hidden"] > nav.flex.flex-shrink-0.border-b.border-border.overflow-x-auto.scrollbar-hide.bg-card';
const desktopNav = 'nav.flex.gap-4.px-4.h-12.items-end.border-b.border-border.text-sm';
const desktop = desktopNav + ' > div.ml-auto.flex.items-center.gap-1.pb-2.flex-shrink-0 > a';
const targets = [
  { id: 'mobile-prev', selector: mobile + ':first-child', text: 'Prev', title: '' },
  { id: 'mobile-next', selector: mobile + ':last-child', text: 'Next', title: '' },
  { id: 'desktop-prev', selector: desktop + '[title="Previous problem"]', text: '', title: 'Previous problem' },
  { id: 'desktop-next', selector: desktop + '[title="Next problem"]', text: '', title: 'Next problem' },
].map(({ id, selector, text, title }) => Object.freeze({ id, selector, count: 1,
  expectation: Object.freeze({ tag: 'a', text, title, href: 'owned-problem' }) }));
for (const [id, selector] of [['desktop-browse', desktopNav], ['mobile-browse', mobileNav]]) {
  targets.push(Object.freeze({ id, selector: selector + ' > button[title="Browse problems"]', count: 1,
    expectation: Object.freeze({ tag: 'button', text: '', title: 'Browse problems', ariaLabel: '', icon: 'lucide-panel-left', href: null, type: null, inForm: false }) }));
}
targets.push(Object.freeze({ id: 'ask-toni', selector: 'main.flex-1.overflow-hidden.relative > button.fixed.bottom-5.right-5[aria-label="Ask Toni"][type="button"]', count: 1,
  expectation: Object.freeze({ tag: 'button', text: 'AskToni', title: '', ariaLabel: 'Ask Toni', icon: 'lucide-sparkles', href: null, type: 'button', inForm: false }) }));

targets.push(Object.freeze({ id: 'top-navbar', selector: NAVBAR_SELECTOR, count: 1, expectation: Object.freeze({ tag: 'nav', kind: 'top-navbar' }) }));

const FOCUS_CONTRACT = Object.freeze({
  id: 'tt-problem-focus-capsule-2026-11-04', verified: true,
  surface: 'problem-content', hidesSecurityUI: false,
  targets: Object.freeze(targets),
  cssText: targets.map(target => `${target.selector}{display:none!important;}`).join('\n'),
});

const workspaceTargets = [
  { id: 'top-navbar', selector: HEADER_SELECTOR, kind: 'top-navbar', tag: 'header' },
  { id: 'ask-toni', selector: TONI_SELECTOR, kind: 'toni-launcher', tag: 'button' },
].map(({ id, selector, kind, tag }) => Object.freeze({ id, selector, count: 1, expectation: Object.freeze({ kind, tag }) }));
const WORKSPACE_FOCUS_CONTRACT = Object.freeze({
  id: 'tt-problem-workspace-2026-11-24', verified: true,
  surface: 'problem-content', hidesSecurityUI: false,
  targets: Object.freeze(workspaceTargets),
  cssText: workspaceTargets.map(target => `${target.selector}{display:none!important;}`).join('\n'),
});

// A workspace may add account actions or change its breadcrumb independently
// of its problem controls. Each possible subset has a fixed reviewed stylesheet.
const workspaceControlContracts = Object.freeze(Array.from({ length: 1 << WORKSPACE_CONTROLS.length }, (_, mask) => {
  const controls = WORKSPACE_CONTROLS.filter((_, i) => mask & (1 << i));
  const targets = [...controls, { id: 'ask-toni', candidate: TONI_SELECTOR }].map(({ id, candidate }) => Object.freeze({
    id, candidate, selector: `html[${NAVBAR_MARKER}="guarded"] ${candidate}`, count: 1,
    expectation: Object.freeze({ kind: id === 'ask-toni' ? 'toni-launcher' : 'workspace-control' }),
  }));
  return Object.freeze({ id: 'tt-problem-workspace-controls-' + mask, verified: true, surface: 'problem-content',
    hidesSecurityUI: false, scope: 'controls', targets: Object.freeze(targets),
    cssText: targets.map(t => `${t.selector}{display:none!important;}`).join('\n') });
}));
module.exports = { FOCUS_CONTRACT, WORKSPACE_FOCUS_CONTRACT, workspaceControlContracts };
