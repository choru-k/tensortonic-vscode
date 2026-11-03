'use strict';

// Navigation anchors and the desktop problem Browse/search launcher were
// observed on an owned canonical problem page on 2026-11-02/03. Each target
// must still match its exact structure and semantics. A changed/boundary page
// stays visible. The drawer input, mobile launcher and global navbar stay intact.
const mobile = 'div[class~="md:hidden"] > div.flex-shrink-0.flex.items-center.justify-between.px-4.py-2.border-t.border-border.bg-card > a';
const desktopNav = 'nav.flex.gap-4.px-4.h-12.items-end.border-b.border-border.text-sm';
const desktop = desktopNav + ' > div.ml-auto.flex.items-center.gap-1.pb-2.flex-shrink-0 > a';
const targets = [
  { id: 'mobile-prev', selector: mobile + ':first-child', text: 'Prev', title: '' },
  { id: 'mobile-next', selector: mobile + ':last-child', text: 'Next', title: '' },
  { id: 'desktop-prev', selector: desktop + '[title="Previous problem"]', text: '', title: 'Previous problem' },
  { id: 'desktop-next', selector: desktop + '[title="Next problem"]', text: '', title: 'Next problem' },
].map(({ id, selector, text, title }) => Object.freeze({ id, selector, count: 1,
  expectation: Object.freeze({ tag: 'a', text, title, href: 'owned-problem' }) }));
targets.push(Object.freeze({ id: 'desktop-browse', selector: desktopNav + ' > button[title="Browse problems"]', count: 1,
  expectation: Object.freeze({ tag: 'button', text: '', title: 'Browse problems', icon: 'lucide-panel-left', href: null, type: null, inForm: false }) }));

const FOCUS_CONTRACT = Object.freeze({
  id: 'tt-problem-navigation-2026-11-03', verified: true,
  surface: 'problem-content', hidesSecurityUI: false,
  targets: Object.freeze(targets),
  cssText: targets.map(target => `${target.selector}{display:none!important;}`).join('\n'),
});

module.exports = { FOCUS_CONTRACT };
