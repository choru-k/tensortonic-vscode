'use strict';

// These controls were observed on an owned canonical problem page at desktop
// and narrow widths on 2026-11-03. Each must retain its exact structure and
// semantics. A changed/boundary page stays visible. No drawer content, assistant
// conversation, global navbar, login or security notice is a hide target.
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

const FOCUS_CONTRACT = Object.freeze({
  id: 'tt-problem-focus-controls-2026-11-03', verified: true,
  surface: 'problem-content', hidesSecurityUI: false,
  targets: Object.freeze(targets),
  cssText: targets.map(target => `${target.selector}{display:none!important;}`).join('\n'),
});

module.exports = { FOCUS_CONTRACT };
