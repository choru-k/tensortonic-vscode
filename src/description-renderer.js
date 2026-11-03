'use strict';

// The installed Markdown extension registers markdown.api.render and accepts a
// Markdown string. Use that command through VS Code, never require its bundle or
// open a Markdown preview. Its math plugin emits MathML as well as styled HTML;
// retain the native MathML so this fragment needs no CSS, fonts, or network.
const MARKDOWN_EXTENSION = 'vscode.markdown-language-features';
const RENDER_COMMAND = 'markdown.api.render';
const MAX_SOURCE = 1024 * 1024;
const MAX_RENDERED = 4 * MAX_SOURCE;
const MAX_NODES = 100000;
const MAX_DEPTH = 100;
const HTML = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 's', 'del', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'dl', 'dt', 'dd', 'sup', 'sub']);
const MATH = new Set(['math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'ms', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'menclose', 'mstyle', 'mpadded', 'mphantom', 'mmultiscripts', 'mprescripts', 'none']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'foreignobject', 'annotation-xml', 'audio', 'video', 'source', 'track', 'canvas', 'template', 'noscript', 'form', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base']);
const MATH_BOOLEAN = new Set(['displaystyle', 'accent', 'accentunder', 'stretchy', 'symmetric', 'largeop', 'movablelimits', 'fence', 'separator']);
const MATH_LENGTH = new Set(['lspace', 'rspace', 'width', 'height', 'depth', 'voffset', 'linethickness']);
const MATH_VARIANTS = new Set(['normal', 'bold', 'italic', 'bold-italic', 'double-struck', 'bold-fraktur', 'script', 'bold-script', 'fraktur', 'sans-serif', 'bold-sans-serif', 'sans-serif-italic', 'sans-serif-bold-italic', 'monospace']);
const NOTATIONS = new Set(['longdiv', 'actuarial', 'radical', 'box', 'roundedbox', 'circle', 'left', 'right', 'top', 'bottom', 'updiagonalstrike', 'downdiagonalstrike', 'verticalstrike', 'horizontalstrike', 'madruwb']);

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderedText(value) {
  // Renderer character references stay text when reparsed. Do not double escape
  // them (which would visibly corrupt code, comparisons, and MathML operators).
  return value.replace(/&(?!(?:#[0-9]{1,8}|#x[0-9a-f]{1,8}|[a-z][a-z0-9]{1,40});)/gi, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeAttribute(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' })[entity.toLowerCase()];
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}

function escapedAt(text, index) {
  let slashes = 0;
  while (index > 0 && text[--index] === '\\') slashes++;
  return slashes % 2 === 1;
}

function findClosing(text, delimiter, start) {
  for (let index = text.indexOf(delimiter, start); index >= 0; index = text.indexOf(delimiter, index + delimiter.length)) {
    if (!escapedAt(text, index)) return index;
  }
  return -1;
}

function prepareMarkdown(text) {
  text = text.replace(/\r\n?/g, '\n');
  const output = [];
  let fence;
  let mathCount = 0;
  for (let index = 0; index < text.length;) {
    if (index === 0 || text[index - 1] === '\n') {
      const end = text.indexOf('\n', index);
      const lineEnd = end < 0 ? text.length : end;
      const line = text.slice(index, lineEnd);
      // A fenced sample may live inside a quote or list item. These prefixes
      // belong to Markdown structure, rather than to the code or equation.
      const fenceLine = line.replace(/^(?: {0,3}>[ \t]?)+/, '').replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/, '');
      const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(fenceLine);
      if (match && (!fence || (match[1][0] === fence.character && match[1].length >= fence.length && !match[2].trim()))) {
        if (fence) fence = undefined;
        else {
          fence = { character: match[1][0], length: match[1].length };
          if (match[2].trim().toLowerCase() === 'math') mathCount++;
        }
        output.push(text.slice(index, lineEnd)); index = lineEnd;
        if (text[index] === '\n') { output.push('\n'); index++; }
        continue;
      }
      if (fence || /^(?: {4}|\t)/.test(line)) {
        output.push(line); index = lineEnd;
        if (text[index] === '\n') { output.push('\n'); index++; }
        continue;
      }
    }
    if (text[index] === '`' && !escapedAt(text, index)) {
      const run = /^`+/.exec(text.slice(index))[0];
      let close = text.indexOf(run, index + run.length);
      while (close >= 0 && (text[close - 1] === '`' || text[close + run.length] === '`')) close = text.indexOf(run, close + run.length);
      if (close >= 0) { output.push(text.slice(index, close + run.length)); index = close + run.length; continue; }
    }
    if (text[index] === '$' && !escapedAt(text, index) && text[index - 1] !== '$') {
      const delimiter = text[index + 1] === '$' ? '$$' : '$';
      const close = findClosing(text, delimiter, index + delimiter.length);
      const before = text[index - 1];
      const after = text[close + delimiter.length];
      const boundary = delimiter === '$$' || ((!before || !/\w/.test(before)) && (!after || !/\w/.test(after)));
      if (close > index + delimiter.length && boundary) {
        output.push(text.slice(index, close + delimiter.length)); index = close + delimiter.length; mathCount++; continue;
      }
    }
    // Normalize the other common TeX delimiters to the builtin plugin's syntax.
    if (text[index] === '\\' && !escapedAt(text, index) && /[([]/.test(text[index + 1] || '')) {
      const block = text[index + 1] === '[';
      const close = findClosing(text, block ? '\\]' : '\\)', index + 2);
      if (close > index + 2) {
        const delimiter = block ? '$$' : '$';
        output.push(delimiter, text.slice(index + 2, close), delimiter); index = close + 2; mathCount++; continue;
      }
    }
    // Raw HTML is literal learning material. Leave TeX and code literals intact;
    // escaping their '<' or '&' would change comparisons and matrix alignment.
    output.push(text[index] === '<' ? '&lt;' : text[index] === '>' ? '&gt;' : text[index]);
    index++;
  }
  return { markdown: output.join(''), mathCount };
}

function parseRendered(html) {
  if (typeof html !== 'string' || html.length > MAX_RENDERED) throw new Error('Invalid renderer output.');
  const root = { children: [] };
  const stack = [root];
  let nodes = 0;
  for (let index = 0; index < html.length;) {
    if (++nodes > MAX_NODES) throw new Error('Renderer output is too complex.');
    if (html[index] !== '<') {
      const next = html.indexOf('<', index);
      const end = next < 0 ? html.length : next;
      stack.at(-1).children.push(html.slice(index, end)); index = end; continue;
    }
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      if (end < 0) throw new Error('Malformed comment.');
      index = end + 3; continue;
    }
    const opening = /^<(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(html.slice(index));
    if (!opening) throw new Error('Malformed tag.');
    let end = index + opening[0].length;
    let quote;
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) { if (character === quote) quote = undefined; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
      else if (character === '<') throw new Error('Malformed tag.');
    }
    if (end === html.length || quote) throw new Error('Unterminated tag.');
    const name = opening[2].toLowerCase();
    let attributes = html.slice(index + opening[0].length, end);
    index = end + 1;
    if (opening[1]) {
      if (attributes.trim() || stack.length === 1 || stack.at(-1).name !== name) throw new Error('Unbalanced tag.');
      stack.pop(); continue;
    }
    const selfClosing = /\/\s*$/.test(attributes);
    if (selfClosing) attributes = attributes.replace(/\/\s*$/, '');
    const attrs = Object.create(null);
    let position = 0;
    while (position < attributes.length) {
      if (!attributes.slice(position).trim()) break;
      const attribute = /^\s+([a-z_:][a-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/i.exec(attributes.slice(position));
      if (!attribute) throw new Error('Malformed attribute.');
      const key = attribute[1].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(attrs, key)) throw new Error('Duplicate attribute.');
      attrs[key] = decodeAttribute(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      position += attribute[0].length;
    }
    const node = { name, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClosing && !VOID.has(name)) {
      if (stack.length >= MAX_DEPTH) throw new Error('Renderer output is too deeply nested.');
      stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error('Unclosed tag.');
  return root;
}

function integer(value, min, max) {
  return /^-?\d{1,8}$/.test(value) && Number(value) >= min && Number(value) <= max;
}

function lengthValue(value) {
  const match = /^(-?(?:\d{1,3}(?:\.\d{1,6})?|\.\d{1,6}))(em|ex|px|pt|mu|%)?$/.exec(value);
  return !!match && Math.abs(Number(match[1])) <= (match[2] === '%' ? 100 : 32);
}

function safeAttributes(node, inMath) {
  const output = [];
  if (node.name === 'math') output.push('xmlns="http://www.w3.org/1998/Math/MathML"');
  for (const [name, value] of Object.entries(node.attrs)) {
    let allowed = false;
    if (inMath) {
      if (name === 'display') allowed = node.name === 'math' && /^(block|inline)$/.test(value);
      else if (name === 'encoding') allowed = node.name === 'annotation' && value === 'application/x-tex';
      else if (name === 'mathvariant') allowed = MATH_VARIANTS.has(value);
      else if (MATH_BOOLEAN.has(name)) allowed = /^(true|false)$/.test(value);
      else if (MATH_LENGTH.has(name)) allowed = lengthValue(value);
      else if (name === 'scriptlevel') allowed = integer(value, -2, 8);
      else if (name === 'form') allowed = /^(prefix|infix|postfix)$/.test(value);
      else if (name === 'notation') allowed = value.length <= 200 && value.split(/\s+/).every(item => NOTATIONS.has(item));
      else if (name === 'rowalign') allowed = /^(top|bottom|center|baseline|axis)( (top|bottom|center|baseline|axis))*$/.test(value) && value.length <= 200;
      else if (name === 'columnalign') allowed = /^(left|center|right)( (left|center|right))*$/.test(value) && value.length <= 200;
      else if (name === 'rowspacing' || name === 'columnspacing') allowed = value.length <= 200 && value.split(/\s+/).every(lengthValue);
      else if (name === 'rowlines' || name === 'columnlines') allowed = /^(none|solid|dashed)( (none|solid|dashed))*$/.test(value) && value.length <= 200;
    } else if (name === 'start') allowed = node.name === 'ol' && integer(value, -1000000, 1000000);
    else if (name === 'colspan' || name === 'rowspan') allowed = (node.name === 'th' || node.name === 'td') && integer(value, 1, 100);
    else if (name === 'align') allowed = (node.name === 'th' || node.name === 'td') && /^(left|center|right)$/.test(value);
    if (allowed) output.push(`${name}="${escapeHtml(value)}"`);
  }
  return output.length ? ` ${output.join(' ')}` : '';
}

function sanitizeRendered(html) {
  const root = parseRendered(html);
  let mathCount = 0;
  let mathError = false;
  function hasPresentation(node) {
    if (typeof node === 'string' || !MATH.has(node.name) || node.name === 'annotation') return false;
    if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(node.name)) return node.children.some(child => typeof child === 'string' && child.trim());
    if (node.name === 'mspace') return lengthValue(node.attrs.width || '');
    return node.children.some(hasPresentation);
  }
  function serialize(node, inMath = false) {
    if (typeof node === 'string') return renderedText(node);
    const classes = (node.attrs.class || '').split(/\s+/);
    if (classes.includes('katex-error')) mathError = true;
    if (DROP.has(node.name) || classes.includes('katex-html')) return '';
    if (node.name === 'img') return node.attrs.alt ? `[Image: ${escapeHtml(node.attrs.alt)}]` : '';
    if (node.name === 'input') return Object.prototype.hasOwnProperty.call(node.attrs, 'checked') ? '[x] ' : '[ ] ';
    const isMath = node.name === 'math';
    if (isMath && !inMath && hasPresentation(node)) mathCount++;
    const nextMath = inMath || isMath;
    const allowed = nextMath ? MATH.has(node.name) : HTML.has(node.name);
    const children = node.children.map(child => serialize(child, nextMath)).join('');
    // Inert containers and all links are unwrapped. In particular no command:,
    // file:, data:, vscode:, remote, or fragment URI enters the returned HTML.
    if (!allowed) return children;
    const attributes = safeAttributes(node, nextMath);
    return `<${node.name}${attributes}>${children}${VOID.has(node.name) ? '' : `</${node.name}>`}`;
  }
  return { html: root.children.map(node => serialize(node)).join(''), mathCount, mathError };
}

function problemContent(problem) {
  const ref = problem && typeof problem.ref === 'object' && problem.ref ? problem.ref : problem;
  const title = typeof problem?.title === 'string' ? problem.title : typeof ref?.title === 'string' ? ref.title : typeof ref?.slug === 'string' ? ref.slug : 'TensorTonic problem';
  const parts = [typeof problem?.description === 'string' && problem.description.trim() ? problem.description : 'Problem statement is unavailable. Open the original problem to check it.'];
  if (Array.isArray(problem?.examples) && problem.examples.length) {
    parts.push('## Examples');
    for (let index = 0; index < problem.examples.length; index++) {
      const example = problem.examples[index];
      if (typeof example === 'string') parts.push(`### Example ${index + 1}\n\n${example}`);
      else if (example && typeof example === 'object') {
        try {
          const text = JSON.stringify(example, null, 2);
          let longest = 2;
          for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
          const fence = '`'.repeat(longest + 1);
          parts.push(`### Example ${index + 1}\n\n${fence}json\n${text}\n${fence}`);
        } catch { parts.push(`### Example ${index + 1}\n\nExample is unavailable.`); }
      }
    }
  }
  return { title: title.slice(0, 1024), source: parts.join('\n\n') };
}

function fallback(content, reason) {
  const notices = {
    'renderer-unavailable': 'Formatted Markdown and math are unavailable. Enable the built-in Markdown Language Features extension and reopen Description.',
    'renderer-failed': 'The local Markdown renderer could not format this description. The source is shown below.',
    'invalid-render': 'The local Markdown output could not be displayed safely. The source is shown below.',
    'math-unavailable': 'Some equations could not be formatted as local MathML. The source is shown below; the original problem has the full formatting.',
    'content-too-large': 'This description exceeds the local rendering limit. The beginning of its source is shown below.',
  };
  return {
    html: `<article class="description-content"><h1>${escapeHtml(content.title)}</h1><p class="notice">${notices[reason]}</p><pre>${escapeHtml(content.source.slice(0, MAX_SOURCE))}</pre></article>`,
    formatted: false,
    reason,
  };
}

async function renderDescription(vscode, problem, { solutionUri, isCurrent = () => true } = {}) {
  // solutionUri intentionally does not grant access to a document or file. This
  // renderer is a pure fragment adapter; its caller owns context files and focus.
  void solutionUri;
  const stale = () => ({ html: '', formatted: false, reason: 'stale' });
  const current = () => { try { return isCurrent() === true; } catch { return false; } };
  if (!current()) return stale();
  const content = problemContent(problem);
  if (content.source.length > MAX_SOURCE) return fallback(content, 'content-too-large');
  let extension;
  try {
    extension = vscode?.extensions?.getExtension(MARKDOWN_EXTENSION);
    if (!extension || typeof extension.activate !== 'function' || typeof vscode?.commands?.getCommands !== 'function' || typeof vscode?.commands?.executeCommand !== 'function') return fallback(content, 'renderer-unavailable');
    await extension.activate();
    if (!current()) return stale();
    const commands = await vscode.commands.getCommands(true);
    if (!current()) return stale();
    if (!Array.isArray(commands) || !commands.includes(RENDER_COMMAND)) return fallback(content, 'renderer-unavailable');
  } catch {
    return current() ? fallback(content, 'renderer-unavailable') : stale();
  }
  const prepared = prepareMarkdown(content.source);
  let rendered;
  try {
    rendered = await vscode.commands.executeCommand(RENDER_COMMAND, prepared.markdown);
  } catch {
    return current() ? fallback(content, 'renderer-failed') : stale();
  }
  if (!current()) return stale();
  let safe;
  try { safe = sanitizeRendered(rendered); }
  catch { return fallback(content, 'invalid-render'); }
  if (safe.mathError || safe.mathCount < prepared.mathCount) return fallback(content, 'math-unavailable');
  return { html: `<article class="description-content"><h1>${escapeHtml(content.title)}</h1>${safe.html}</article>`, formatted: true };
}

module.exports = { renderDescription };
