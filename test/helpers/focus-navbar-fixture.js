'use strict';
function makeNavbar() {
  const element = (tag, matches, text = '', attrs = {}, children = []) => ({
    tagName: tag, textContent: text, attrs, children, childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    get firstElementChild() { return this.children[0]; }, matches(selector) { return matches.includes(selector); },
    getAttribute(name) { return this.attrs[name] ?? null; }, closest() { return null; },
    querySelectorAll(selector) { return this.queries?.[selector] || []; },
  });
  const icon = () => element('svg', []);
  const menu = element('BUTTON', ['button[aria-label="Open menu"]']); menu.queries = { 'svg.lucide-menu': [icon()] };
  const logo = element('A', ['a[href="/problems"]'], 'TensorTonic'); logo.queries = { 'img[alt="TensorTonic"]': [element('IMG', [])] };
  const brand = element('DIV', ['div.flex.items-center.gap-2'], '', {}, [menu, logo]);
  const paths = [['/problems','Problems'],['/study-plans','Study Plans'],['/projects','Projects'],['/assessments','Interview'],['/pricing','Pricing'],['/feedback','Feedback']];
  const links = element('DIV', ['div.hidden.items-center.gap-6'], '', {}, paths.map(([href,text]) => element('A', [], text, {href})));
  const explore = element('DIV', ['div.relative'], 'Explore', {}, [element('BUTTON', ['button'], 'Explore')]); explore.queries = { 'svg.lucide-chevron-down': [icon()] };
  links.children.push(explore); links.queries = { a: links.children.slice(0,-1), button: explore.children };
  const left = element('DIV', ['div.flex.items-center.gap-2.flex-shrink-0'], '', {}, [brand, links]);
  const news = element('A', ['a[href="/changelog"][title="What\'s new"]'], '', {'aria-label':"What's new"}); news.queries = { 'svg.lucide-megaphone': [icon()] };
  const discord = element('A', ['a[href="https://discord.gg/n7ruMwyJMA"][title="Join our Discord"]']); discord.queries = { svg: [icon()] };
  const theme = element('BUTTON', ['button'], 'Toggle theme'); theme.queries = { 'svg.lucide-moon,svg.lucide-sun': [icon()] };
  const avatar = element('BUTTON', ['button.rounded-full.border[aria-haspopup="menu"][aria-expanded="false"][data-state="closed"]']);
  const right = element('DIV', ['div.flex.items-center.flex-shrink-0'], '', {}, [news, discord, theme, avatar]);
  const capsule = element('DIV', ['div.h-14.flex.items-center.justify-between.pl-5.pr-3.rounded-full.border.backdrop-blur-2xl.border-border'], '', {}, [left, right]);
  const wrapper = element('DIV', ['div.px-3'], '', {}, [capsule]);
  const nav = element('NAV', [], '', {}, [wrapper]);
  nav.querySelectorAll = selector => selector === '*' ? (function walk(node) { return node.children.flatMap(child => [child, ...walk(child)]); })(nav) : [];
  return { nav, wrapper, capsule, left, right, menu, logo, links, explore, news, discord, theme, avatar, element };
}
module.exports = { makeNavbar };
