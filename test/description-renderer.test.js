'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDescription } = require('../src/description-renderer');

const problem = (overrides = {}) => ({ ref: { slug: 'synthetic-local-problem' }, title: 'Synthetic local problem', description: 'A **formatted** statement.', examples: [], ...overrides });
const math = (tex = 'x^2', body = '<msup><mi>x</mi><mn>2</mn></msup>', display = '') => `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"${display}><semantics>${body}<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span style="height:1em">UNSTYLED DUPLICATE</span></span></span>`;

function harness() {
  const h = { calls: [], rendered: '<p>A <strong>formatted</strong> statement.</p>' };
  const forbidden = () => { throw new Error('Renderer cannot create UI, read/write files, open URIs, or move focus.'); };
  const unavailable = new Proxy({}, { get: forbidden });
  h.extension = {
    async activate() { h.calls.push(['activate']); if (h.onActivate) return h.onActivate(); return undefined; },
    get exports() { throw new Error('Do not depend on application internals.'); },
  };
  h.vscode = {
    extensions: { getExtension(id) { h.calls.push(['extension', id]); return h.extension; } },
    commands: {
      async getCommands(filterInternal) { h.calls.push(['commands', filterInternal]); if (h.onCommands) return h.onCommands(); return ['markdown.api.render', 'markdown.showPreviewToSide']; },
      async executeCommand(command, source) { h.calls.push(['render', command, source]); assert.equal(command, 'markdown.api.render'); assert.equal(typeof source, 'string'); return h.render ? h.render(source) : h.rendered; },
    },
    window: unavailable, workspace: unavailable, env: unavailable, Uri: unavailable,
  };
  return h;
}

function assertInert(html) {
  assert.doesNotMatch(html, /<(?:script|iframe|object|embed|svg|foreignobject|style|link|img|form|input|button|textarea|video|audio|annotation-xml)\b/i);
  assert.doesNotMatch(html, /<[^>]+\s(?:on\w+|style|href|src|srcset|xlink:href|id|tabindex|autofocus|contenteditable|nonce|data-\w+|mathcolor|mathbackground)\s*=/i);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('uses only the activated public render command with Markdown text and no UI/file side effects', async () => {
  const h = harness();
  h.onActivate = async () => { await Promise.resolve(); };
  h.render = async () => { await Promise.resolve(); return h.rendered; };
  const result = await renderDescription(h.vscode, problem(), { solutionUri: { get fsPath() { throw new Error('No file access'); } } });
  assert.equal(result.formatted, true);
  assert.equal(result.reason, undefined);
  assert.deepEqual(h.calls.slice(0, 3), [['extension', 'vscode.markdown-language-features'], ['activate'], ['commands', true]]);
  assert.deepEqual(h.calls[3], ['render', 'markdown.api.render', 'A **formatted** statement.']);
  assert.match(result.html, /<article class="description-content"><h1>Synthetic local problem<\/h1><p>A <strong>formatted<\/strong> statement\.<\/p><\/article>/);
});

test('preserves common Markdown structure while discarding downloaded classes and attributes', async () => {
  const h = harness();
  h.rendered = '<h2 id="goal" class="user-theme" onclick="bad()">Goal</h2><blockquote><p><em>Emphasis</em> and <del>old</del></p></blockquote><ol start="3"><li><code>value &lt; 3 &amp; 4</code></li></ol><hr><pre><code class="language-python">return x &gt; 0\n</code></pre><table><thead><tr><th align="right" colspan="2">Value</th></tr></thead><tbody><tr><td rowspan="2">One</td></tr></tbody></table>';
  const result = await renderDescription(h.vscode, problem());
  assert.equal(result.formatted, true);
  assert.match(result.html, /<h2>Goal<\/h2>/);
  assert.match(result.html, /<ol start="3">/);
  assert.match(result.html, /<code>value &lt; 3 &amp; 4<\/code>/);
  assert.match(result.html, /<th align="right" colspan="2">Value<\/th>/);
  assert.match(result.html, /<td rowspan="2">One<\/td>/);
  assert.doesNotMatch(result.html, /user-theme|language-python/);
  assertInert(result.html);
});

test('escapes the title as literal text without passing it to Markdown', async () => {
  const h = harness();
  const result = await renderDescription(h.vscode, problem({ title: '<img src=x onerror=bad()> **Title** & "quoted"' }));
  assert.match(result.html, /<h1>&lt;img src=x onerror=bad\(\)&gt; \*\*Title\*\* &amp; &quot;quoted&quot;<\/h1>/);
  assert.equal(h.calls.at(-1)[2], 'A **formatted** statement.');
  assertInert(result.html);
});

test('escapes raw source HTML while leaving inline and fenced code literal for the renderer', async () => {
  const h = harness();
  const source = '<h2 onclick="bad()">raw</h2> &amp;\n\n`<em>code</em>`\n\n```python\nx = "<script> & $not_math$"\n```';
  await renderDescription(h.vscode, problem({ description: source }));
  const renderedSource = h.calls.at(-1)[2];
  assert.match(renderedSource, /&lt;h2 onclick="bad\(\)"&gt;raw&lt;\/h2&gt; &amp;/);
  assert.ok(renderedSource.includes('`<em>code</em>`'));
  assert.ok(renderedSource.includes('x = "<script> & $not_math$"'));
});

test('preserves TeX comparisons and matrix alignment while retaining only native MathML', async () => {
  const h = harness();
  const source = 'Require $x<0$ and $a>b$.\n\n$$\n\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}\n$$';
  h.rendered = `<p>Require ${math('x&lt;0', '<mrow><mi>x</mi><mo>&lt;</mo><mn>0</mn></mrow>')} and ${math('a&gt;b', '<mrow><mi>a</mi><mo>&gt;</mo><mi>b</mi></mrow>')}.</p><p class="katex-block">${math('\\begin{pmatrix}a &amp; b \\\\ c &amp; d\\end{pmatrix}', '<mrow><mo fence="true" stretchy="true">(</mo><mtable rowspacing="0.16em" columnalign="center center"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo fence="true" stretchy="true">)</mo></mrow>', ' display="block"')}</p>`;
  const result = await renderDescription(h.vscode, problem({ description: source }));
  assert.equal(result.formatted, true);
  assert.equal(h.calls.at(-1)[2], source);
  assert.equal((result.html.match(/<math\b/g) || []).length, 3);
  assert.match(result.html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML" display="block">/);
  assert.match(result.html, /<mo>&lt;<\/mo>/);
  assert.match(result.html, /<mo>&gt;<\/mo>/);
  assert.match(result.html, /<mtable rowspacing="0\.16em" columnalign="center center">/);
  assert.match(result.html, /<annotation encoding="application\/x-tex">/);
  assert.doesNotMatch(result.html, /katex|UNSTYLED DUPLICATE/);
  assertInert(result.html);
});

test('normalizes common escaped TeX delimiters without touching code samples', async () => {
  const h = harness();
  h.rendered = `<p>${math()} ${math('a+b', '<mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow>', ' display="block"')} <code>\\(literal\\)</code></p>`;
  const result = await renderDescription(h.vscode, problem({ description: '\\(x^2\\)\n\n\\[a+b\\]\n\n`\\(literal\\)`' }));
  assert.equal(result.formatted, true);
  assert.equal(h.calls.at(-1)[2], '$x^2$\n\n$$a+b$$\n\n`\\(literal\\)`');
});

test('fenced math requires native MathML; dollar text inside ordinary code does not', async () => {
  const h = harness(); h.rendered = `<p>${math()}</p>`;
  assert.equal((await renderDescription(h.vscode, problem({ description: '```math\nx^2\n```' }))).formatted, true);
  h.rendered = '<pre><code>price = "$x^2$"</code></pre>';
  for (const description of ['```python\nprice = "$x^2$"\n```', '`$x^2$`', '    price = "$x^2$"', '\\$5 and \\$10']) {
    assert.equal((await renderDescription(h.vscode, problem({ description }))).formatted, true);
  }
});

test('Windows newlines and fenced examples nested in lists or quotes preserve literal code', async () => {
  const h = harness();
  for (const source of ['```python\r\nvalue = "$x<0$"\r\n```', '> ```python\n> value = "$x<0$"\n> ```', '- ```python\n  value = "$x<0$"\n  ```']) {
    const result = await renderDescription(h.vscode, problem({ description: source }));
    assert.equal(result.formatted, true);
    assert.ok(h.calls.at(-1)[2].includes('value = "$x<0$"'));
    assert.doesNotMatch(h.calls.at(-1)[2], /\r/);
  }
});

test('missing, partial, or erroneous local math output explicitly falls back to escaped source', async () => {
  const h = harness();
  for (const rendered of ['<p>$x^2$ and $y^2$</p>', `<p>${math()} and $y^2$</p>`, '<p><span class="katex-error" title="untrusted">bad math</span></p>', '<span class="katex"><span class="katex-html">x2</span></span>', '<math></math><math><annotation encoding="application/x-tex">y^2</annotation></math>']) {
    h.rendered = rendered;
    const result = await renderDescription(h.vscode, problem({ description: '$x^2$ and $y^2$' }));
    assert.equal(result.formatted, false);
    assert.equal(result.reason, 'math-unavailable');
    assert.match(result.html, /Some equations could not be formatted as local MathML/);
    assert.match(result.html, /<pre>\$x\^2\$ and \$y\^2\$<\/pre>/);
    assertInert(result.html);
  }
});

test('all downloaded links, resource URLs, focus controls, executable tags, and styles are inert', async () => {
  const h = harness();
  h.rendered = '<p><a href="command:danger?%5B1%5D" tabindex="0" autofocus>Command</a> <a href="java&#x73;cript:bad()">Bad</a> <a href="https://example.invalid/">Remote</a> <a href="file:///private">File</a> <a href="#goal">Jump</a><img src="https://example.invalid/track" srcset="data:danger" onerror="bad()" alt="A &quot;diagram&quot;"></p><script>bad()</script><style>*{color:red}</style><iframe src="https://example.invalid/"></iframe><object data="data:bad"></object><svg><foreignObject><p>Injected</p></foreignObject></svg><form><button>Execute</button></form><input type="checkbox" checked disabled><span contenteditable="true" style="color:red" data-command="submit" id="description">Text</span>';
  const result = await renderDescription(h.vscode, problem());
  assert.equal(result.formatted, true);
  assert.match(result.html, /Command Bad Remote File Jump\[Image: A &quot;diagram&quot;\]/);
  assert.match(result.html, /\[x\] Text/);
  assert.doesNotMatch(result.html, /bad\(\)|Injected|Execute|example\.invalid|data-command/);
  assertInert(result.html);
});

test('MathML loses URI, color, namespace, event, and annotation-xml attack surfaces', async () => {
  const h = harness();
  h.rendered = '<math xmlns="https://evil.invalid/ns" href="javascript:bad()" style="color:red" onload="bad()" display="block"><semantics><mstyle mathcolor="red" mathbackground="black" displaystyle="true" scriptlevel="0"><mrow><mi mathvariant="bold" id="focus">x</mi><mo href="command:submit" stretchy="true">=</mo><mspace width="1em" height="999999em"/><mn>2</mn></mrow></mstyle><annotation encoding="application/x-tex">x=2 &amp; &lt;safe&gt;</annotation><annotation-xml encoding="text/html"><img src="x" onerror="bad()"></annotation-xml></semantics></math>';
  const result = await renderDescription(h.vscode, problem({ description: '$x=2$' }));
  assert.equal(result.formatted, true);
  assert.match(result.html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML" display="block">/);
  assert.match(result.html, /<mstyle displaystyle="true" scriptlevel="0">/);
  assert.match(result.html, /<mi mathvariant="bold">x<\/mi>/);
  assert.match(result.html, /<mspace width="1em"><\/mspace>/);
  assert.doesNotMatch(result.html, /evil\.invalid|999999|bad\(\)|mathcolor|mathbackground|text\/html/);
  assertInert(result.html);
});

test('malformed or excessively nested renderer output fails closed to escaped original content', async () => {
  const h = harness();
  for (const rendered of [undefined, {}, '<p>missing close', '<p><em>x</p></em>', '<p id="a" id="b">duplicate</p>', '<p title="unterminated>oops</p>', '<p title=x<y>oops</p>', '<!DOCTYPE html><p>unexpected document</p>', '<span>'.repeat(110) + 'deep' + '</span>'.repeat(110)]) {
    h.rendered = rendered;
    const result = await renderDescription(h.vscode, problem({ description: '<script>not executable</script>\n$x<0$' }));
    assert.equal(result.formatted, false);
    assert.equal(result.reason, 'invalid-render');
    assert.match(result.html, /&lt;script&gt;not executable&lt;\/script&gt;/);
    assertInert(result.html);
  }
});

test('comments and unapproved containers never create application controls or foreign HTML', async () => {
  const h = harness();
  h.rendered = '<!-- <button data-command="submit">hidden</button> --><div role="button" tabindex="0"><span class="toolbar">Ordinary text</span></div><math><mtext><a href="command:submit"><strong>label</strong></a></mtext><annotation-xml><div>foreign</div></annotation-xml></math>';
  const result = await renderDescription(h.vscode, problem());
  assert.equal(result.formatted, true);
  assert.match(result.html, /Ordinary text<math[^>]*><mtext>label<\/mtext>/);
  assert.doesNotMatch(result.html, /hidden|toolbar|foreign|role=|tabindex|data-command/);
  assertInert(result.html);
});

test('examples are included safely, with no duplication of solution code or public tests', async () => {
  const h = harness();
  await renderDescription(h.vscode, problem({ examples: ['Use **one** item.', { note: '```\n<img src=x>', value: 2 }], testCases: [{ inputs: 'PUBLIC_TEST_MARKER' }], starterCode: 'STARTER_CODE_MARKER' }));
  const source = h.calls.at(-1)[2];
  assert.match(source, /## Examples\n\n### Example 1\n\nUse \*\*one\*\* item\./);
  assert.match(source, /### Example 2\n\n````json/);
  assert.ok(source.includes('<img src=x>'), 'JSON code fences are left intact for Markdown to escape');
  assert.doesNotMatch(source, /PUBLIC_TEST_MARKER|STARTER_CODE_MARKER/);
});

test('unavailable or disabled builtin renderer reports a clear fallback without opening another preview', async () => {
  for (const state of ['missing', 'no-activate', 'activation-failed', 'command-missing', 'command-enumeration-failed', 'commands-unavailable']) {
    const h = harness();
    if (state === 'missing') h.extension = undefined;
    if (state === 'no-activate') h.extension.activate = undefined;
    if (state === 'activation-failed') h.onActivate = async () => { throw new Error('PRIVATE DOWNLOADED EXCEPTION'); };
    if (state === 'command-missing') h.onCommands = async () => ['markdown.showPreviewToSide'];
    if (state === 'command-enumeration-failed') h.onCommands = async () => { throw new Error('PRIVATE DOWNLOADED EXCEPTION'); };
    if (state === 'commands-unavailable') h.vscode.commands.getCommands = undefined;
    const result = await renderDescription(h.vscode, problem({ description: '<img src=x> $x<0$' }));
    assert.equal(result.formatted, false);
    assert.equal(result.reason, 'renderer-unavailable');
    assert.match(result.html, /Enable the built-in Markdown Language Features extension/);
    assert.match(result.html, /&lt;img src=x&gt; \$x&lt;0\$/);
    assert.doesNotMatch(result.html, /PRIVATE DOWNLOADED EXCEPTION/);
    assert.ok(!h.calls.some(call => call[0] === 'render'));
    assertInert(result.html);
  }
});

test('renderer rejection uses an inert fallback without exposing exception text', async () => {
  const h = harness(); h.render = async () => { throw new Error('<script>PRIVATE ERROR</script>'); };
  const result = await renderDescription(h.vscode, problem());
  assert.equal(result.formatted, false);
  assert.equal(result.reason, 'renderer-failed');
  assert.doesNotMatch(result.html, /PRIVATE ERROR/);
  assertInert(result.html);
});

test('stale or closed callers cannot receive a previous description after any async boundary', async () => {
  for (const stage of ['activate', 'commands', 'render']) {
    const h = harness();
    const waiting = deferred();
    const entered = deferred();
    let current = true;
    const hold = async value => { entered.resolve(); await waiting.promise; return value; };
    if (stage === 'activate') h.onActivate = () => hold(undefined);
    if (stage === 'commands') h.onCommands = () => hold(['markdown.api.render']);
    if (stage === 'render') h.render = () => hold('<p>Old problem</p>');
    const pending = renderDescription(h.vscode, problem(), { isCurrent: () => current });
    await entered.promise;
    current = false; waiting.resolve();
    assert.deepEqual(await pending, { html: '', formatted: false, reason: 'stale' });
    assert.equal(h.calls.filter(call => call[0] === 'render').length, stage === 'render' ? 1 : 0);
  }
});

test('initial staleness and thrown generation guards are inert before activation', async () => {
  for (const isCurrent of [() => false, () => { throw new Error('Disposed'); }]) {
    const h = harness();
    assert.deepEqual(await renderDescription(h.vscode, problem(), { isCurrent }), { html: '', formatted: false, reason: 'stale' });
    assert.deepEqual(h.calls, []);
  }
});

test('staleness also wins over renderer and activation failures', async () => {
  for (const stage of ['activate', 'render']) {
    const h = harness(); let current = true;
    const fail = async () => { current = false; throw new Error('Disposed while pending'); };
    if (stage === 'activate') h.onActivate = fail; else h.render = fail;
    assert.deepEqual(await renderDescription(h.vscode, problem(), { isCurrent: () => current }), { html: '', formatted: false, reason: 'stale' });
  }
});

test('large descriptions and invalid renderer return values remain bounded and explicit', async () => {
  const h = harness();
  const result = await renderDescription(h.vscode, problem({ description: '<'.repeat(1024 * 1024 + 1) }));
  assert.equal(result.formatted, false);
  assert.equal(result.reason, 'content-too-large');
  assert.equal(h.calls.length, 0);
  assert.match(result.html, /beginning of its source/);
  assertInert(result.html);
  h.rendered = 'x'.repeat(4 * 1024 * 1024 + 1);
  const invalid = await renderDescription(h.vscode, problem());
  assert.equal(invalid.reason, 'invalid-render');
  assertInert(invalid.html);
});
