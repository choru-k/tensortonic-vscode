'use strict';
// DOM-only presentation. No extension API, network, remote HTML, or code execution.
function mount(document, registry) {
 const root = document.getElementById('exploration');
 const card = registry.cards.find(item=>item.id===root.dataset.card);
 if(!card) { root.textContent='No local exploration is available for this problem.'; return; }
 const element=(tag,text,parent)=>{const e=document.createElement(tag); if(text!==undefined)e.textContent=String(text); if(parent)parent.appendChild(e); return e;};
 element('h1',card.title,root);
 element('p','Independent local exploration — illustrative examples, not TensorTonic’s original cards or a reference solution.',root).className='notice';
 element('p',card.description,root);
 const form=element('form',undefined,root); form.noValidate=true; const controls={};
 for(const spec of card.inputs) {
  const label=element('label',undefined,form); element('span',spec.label,label);
  const input=element(spec.type==='select'?'select':'input',undefined,label);
  input.id=`card-${spec.key}`; input.name=spec.key;
  if(spec.type==='select') for(const option of spec.options) { const o=element('option',option.label,input); o.value=option.value; }
  else {input.type=spec.type==='number'?'number':'text';input.maxLength=4096;for(const attr of ['min','max','step'])if(spec[attr]!==undefined)input.setAttribute(attr,String(spec[attr]));}
  input.value=spec.value; controls[spec.key]=input;
 }
 const buttons=element('div',undefined,form);buttons.className='buttons';
 element('button','Calculate',buttons).type='submit';
 const reset=element('button','Reset example',buttons);reset.type='button';
 const error=element('p','',root);error.setAttribute('role','alert');error.className='error';
 const output=element('section',undefined,root);output.setAttribute('aria-live','polite');output.setAttribute('aria-label','Calculated results');
 const format=value=>typeof value==='number'?(Number.isInteger(value)?String(value):Number(value.toPrecision(7)).toString()):String(value);
 function render(result) {
  output.replaceChildren();
  if(result.summary)element('p',result.summary,output);
  if(result.metrics) {const list=element('dl',undefined,output);for(const metric of result.metrics){element('dt',metric.label,list);element('dd',format(metric.value),list);}}
  for(const data of result.tables||[]) {
   const wrap=element('div',undefined,output);wrap.className='table-wrap';
   const table=element('table',undefined,wrap);element('caption',data.title,table);
   const head=element('tr',undefined,element('thead',undefined,table));for(const column of data.columns)element('th',column,head).scope='col';
   const body=element('tbody',undefined,table);for(const values of data.rows){const row=element('tr',undefined,body);for(const value of values)element('td',format(value),row);}
  }
  if(result.diagram) {
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 240');svg.setAttribute('role','img');svg.setAttribute('aria-label','Network architecture and forward flow');
   const nodes=result.diagram.nodes.slice(0,24);const byId=new Map(nodes.map(n=>[n.id,n]));
   for(const edge of result.diagram.edges.slice(0,64)){const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b)continue;const line=document.createElementNS('http://www.w3.org/2000/svg','line');for(const [k,v] of Object.entries({x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'currentColor','stroke-width':2}))line.setAttribute(k,String(v));svg.appendChild(line);}
   for(const node of nodes){const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [k,v] of Object.entries({x:node.x-50,y:node.y-25,width:100,height:50,rx:8,fill:'var(--vscode-editor-background,#202020)',stroke:'currentColor'}))rect.setAttribute(k,String(v));svg.appendChild(rect);const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x',String(node.x));text.setAttribute('y',String(node.y+5));text.setAttribute('text-anchor','middle');text.setAttribute('fill','currentColor');text.setAttribute('font-size','11');text.setAttribute('textLength','90');text.setAttribute('lengthAdjust','spacingAndGlyphs');text.textContent=node.label;svg.appendChild(text);}
   output.appendChild(svg);
  }
  for(const series of result.series||[]) {
   if(!Array.isArray(series.values)||!series.values.length)continue;
   const values=series.values.slice(0,256);element('h2',series.label,output);
   const min=Math.min(0,...values),max=Math.max(0,...values),range=max-min||1;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 180');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${series.label}: ${values.map(format).join(', ')}`);
   const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',values.map((v,i)=>`${20+i*560/Math.max(1,values.length-1)},${160-(v-min)/range*140}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','3');svg.appendChild(line);if(values.length===1){const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx','20');dot.setAttribute('cy',String(160-(values[0]-min)/range*140));dot.setAttribute('r','4');dot.setAttribute('fill','currentColor');svg.appendChild(dot);}output.appendChild(svg);
   element('p',`Range ${format(min)} to ${format(max)} · ${values.length} points in input order`,output).className='meta';
  }
 }
 function calculate() {try{const result=registry.evaluate(card,Object.fromEntries(Object.entries(controls).map(([key,input])=>[key,input.value])));error.textContent='';render(result);}catch(e){output.replaceChildren();error.textContent=e instanceof Error?e.message:'Please check the inputs.';}}
 form.addEventListener('submit',event=>{event.preventDefault();calculate();});
 reset.addEventListener('click',()=>{for(const spec of card.inputs)controls[spec.key].value=spec.value;calculate();});
 calculate();
 return {calculate,controls,output,error,reset,form};
}
module.exports={mount};
