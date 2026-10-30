'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const registry=require('../src/cards');const {buildCardHtml,bundle}=require('../src/cards/webview');const {mount}=require('../src/cards/runtime');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.listeners={};this.dataset={};this.value='';this.textContent='';}
 appendChild(child){this.children.push(child);return child;}
 replaceChildren(...children){this.children=children;this.textContent='';}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,fn){this.listeners[name]=fn;}
}
function documentFor(id){const root=new Element('main');root.dataset.card=id;return {root,getElementById:()=>root,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};}
function textTree(node){return [node.textContent,...node.children.map(textTree)].join(' ');}
test('exact, exhaustive 30-entry registry; authoritative API identity; unknown is unsupported',()=>{
 assert.equal(registry.cards.length,30);assert.equal(new Set(registry.cards.map(c=>c.id)).size,30);assert.equal(registry.ids.length,30);
 for(const [slug,id] of registry.ids)assert.equal(registry.resolveCard({ref:{slug,planId:'pytorch-basics'}}).id,id);
 assert.equal(registry.resolveCard({slug:registry.ids[0][0],planId:'other'}),undefined);
 assert.equal(registry.resolveCard({slug:registry.ids[0][0],apiId:'unknown',planId:'pytorch-basics'}),undefined);
 assert.equal(registry.resolveCard({slug:'__proto__',planId:'pytorch-basics'}),undefined);
});
test('every card produces bounded, deterministic numerical output and rejects oversized input',()=>{
 for(const card of registry.cards){const defaults=registry.defaults(card);const result=registry.evaluate(card,defaults);assert.deepEqual(registry.evaluate(card,defaults),result,card.id);assert.ok(result.tables?.length||result.series?.length||result.metrics?.length,card.id);const key=card.inputs[0].key;assert.throws(()=>registry.evaluate(card,{...defaults,[key]:'x'.repeat(4097)}));}
});
test('every card mounts, calculates on repeated submit, and resets invalid settings without stale output',()=>{
 for(const card of registry.cards){const document=documentFor(card.id);const ui=mount(document,registry);assert.equal(ui.error.textContent,'',card.id);const initial=textTree(ui.output);assert.ok(initial.length>0,card.id);const first=card.inputs[0].key;ui.controls[first].value='bad'.repeat(2000);ui.form.listeners.submit({preventDefault(){}});assert.ok(ui.error.textContent,card.id);assert.equal(ui.output.children.length,0,card.id);ui.reset.listeners.click();assert.equal(ui.error.textContent,'',card.id);assert.equal(textTree(ui.output),initial,card.id);ui.form.listeners.submit({preventDefault(){}});assert.equal(textTree(ui.output),initial,card.id);}
});
test('webview CSP is nonce-only, independent of remote/problem metadata; bundle is executable locally',()=>{
 const ref={planId:'pytorch-basics',slug:'pytorch-softmax-from-scratch'};
 const html=buildCardHtml({ref,title:'</script><script>alert(1)</script>',description:'REMOTE HTML'});
 assert.match(html,/default-src &#39;none&#39;/);assert.match(html,/connect-src &#39;none&#39;/);assert.match(html,/frame-src &#39;none&#39;/);assert.doesNotMatch(html,/REMOTE HTML|alert\(1\)|<script[^>]+src=/);assert.doesNotMatch(html,/unsafe-inline|unsafe-eval|<iframe|onerror=/);
 const nonce=html.match(/<script nonce="([^"]+)"/)[1];assert.match(html,new RegExp(`<style nonce="${nonce.replace(/[+]/g,'\\+')}"`));assert.notEqual(html,buildCardHtml({ref}));
 const doc=documentFor('softmax');vm.runInNewContext(bundle(),{document:doc});assert.match(textTree(doc.root),/Independent local exploration/);
});
test('unsupported problem is visibly incomplete and gets no active script',()=>{const html=buildCardHtml({ref:{planId:'pytorch-basics',slug:'not-implemented'}});assert.match(html,/not a completed interactive card/);assert.doesNotMatch(html,/<script/);});
test('renderer treats data labels as inert text, never innerHTML',()=>{const doc=documentFor('custom');const fake={cards:[{id:'custom',title:'<img onerror=evil>',description:'<script>evil</script>',inputs:[]}],evaluate:()=>({tables:[{title:'<script>',columns:['<img>'],rows:[['<a onclick=evil>']]}]})};mount(doc,fake);assert.match(textTree(doc.root),/<img onerror=evil>/);assert.ok(!doc.root.children.some(x=>x.tag==='img'));});

test('independent review hand-derived domain fixtures agree with the calculators',()=>{
 const run=(id,values)=>{const card=registry.cards.find(c=>c.id===id);return registry.evaluate(card,{...registry.defaults(card),...values});};
 const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} ≠ ${expected}`);
 const conv=run('convolution',{input:'1,2,3;4,5,6;7,8,9',kernel:'1,2;3,4',stride:'1',padding:'0'});assert.deepEqual(conv.tables[2].rows.map(r=>r.slice(1)),[[37,47],[67,77]]);
 const lstm=run('lstm',{sequence:'0,0',inputWeights:'0,0,0,0',hiddenWeights:'0,0,0,0',biases:'0,0,0,0',cell:'2',hidden:'0'});near(lstm.tables[0].rows[0][6],1);near(lstm.tables[0].rows[1][6],.5);near(lstm.tables[0].rows[0][7],.3807970779778824);near(lstm.tables[0].rows[1][7],.23105857863000487);
 const att=run('attention',{q:'1',k:`0;${Math.log(3)}`,v:'2;6'});near(att.tables[1].rows[0][1],.25);near(att.tables[1].rows[0][2],.75);near(att.tables[2].rows[0][1],5);
 const beam=run('beam-search',{transitions:'.51,.49;.99,.01',start:'0',width:'2',depth:'2'});assert.equal(beam.metrics[0].value,'0 → 1 → 0');near(beam.tables[0].rows.find(r=>r[0]===2&&r[1]===1)[4],.4851);
 const grad=run('autograd',{x:'2',a:'3',b:'-1'});near(grad.metrics.find(m=>m.label==='y').value,25);near(grad.metrics.find(m=>m.label==='dy/dx').value,30);
});
