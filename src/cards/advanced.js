'use strict';
// Original small-scale numerical explorations, not copies of website widgets.
const { number, integer, vector, matrix, softmax, dot, field: f, table } = require('./math');
const nf = (key, label, value, min, max, step = 'any') => f(key,label,value,{type:'number',min,max,step});
const grid = (title, rows) => table(title, ['Row', ...rows[0].map((_,i)=>`Column ${i+1}`)], rows.map((r,i)=>[i+1,...r]));
const sigmoid = x => x >= 0 ? 1/(1+Math.exp(-x)) : Math.exp(x)/(1+Math.exp(x));
function attention(q,k,v,causal=false,scale=1) {
  if(q[0].length !== k[0].length || k.length !== v.length) throw new Error('Q/K feature widths and K/V row counts must match.');
  if(causal && q.length !== k.length) throw new Error('Causal self-attention needs equal Q and K row counts.');
  const scores=q.map(row=>k.map(key=>dot(row,key)*scale/Math.sqrt(row.length)));
  const probabilities=scores.map((row,i)=> { const allowed=causal?row.slice(0,i+1):row; const p=softmax(allowed); return row.map((_,j)=>j<p.length?p[j]:0); });
  const output=probabilities.map(row=>v[0].map((_,j)=>row.reduce((s,p,i)=>s+p*v[i][j],0)));
  return { scores, probabilities, output };
}
const attentionInputs = () => [f('q','Queries Q (rows separated by ;)','1,0;0,1'),f('k','Keys K','1,0;0,1'),f('v','Values V','2,1;0,3')];
const cards = [
  { id:'momentum', title:'Momentum optimizer', description:'Follow gradient descent on the toy loss L(w)=w²/2. Velocity uses v = momentum × v + gradient; w = w − learning rate × v.',
    inputs:[nf('weight','Initial weight',3,-100,100),nf('velocity','Initial velocity',0,-100,100),nf('rate','Learning rate',0.2,0,1),nf('momentum','Momentum',0.8,0,0.99),nf('steps','Updates',8,1,100,1)],
    compute(p) { let w=number(p.weight,'Weight',-100,100),v=number(p.velocity,'Velocity',-100,100); const lr=number(p.rate,'Learning rate',0,1),mu=number(p.momentum,'Momentum',0,0.99),steps=integer(p.steps,'Updates',1,100),rows=[[0,w,v,w*w/2]];
      for(let i=1;i<=steps;i++){v=mu*v+w;w-=lr*v;rows.push([i,w,v,w*w/2]);} return {tables:[table('Optimization trace',['Step','Weight','Velocity','Loss'],rows)],series:[{label:'Loss',values:rows.map(r=>r[3])}]}; }
  },
  { id:'convolution',title:'Sliding 2D kernel',description:'Compute cross-correlation, the operation used by neural-network Conv2d layers. Padding is zero-filled; no kernel reversal is applied. This single-channel example omits bias and dilation.',
    inputs:[f('input','Input grid','1,2,0;0,1,3;2,0,1'),f('kernel','Kernel','1,0;0,-1'),nf('stride','Stride',1,1,4,1),nf('padding','Zero padding',0,0,2,1)],
    compute(p){const x=matrix(p.input,'Input'),k=matrix(p.kernel,'Kernel',5),s=integer(p.stride,'Stride',1,4),pad=integer(p.padding,'Padding',0,2); const h=Math.floor((x.length+2*pad-k.length)/s)+1,w=Math.floor((x[0].length+2*pad-k[0].length)/s)+1;
      if(h<1||w<1)throw new Error('Kernel is larger than the padded input.'); const out=Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>k.reduce((sum,row,a)=>sum+row.reduce((sub,z,b)=>sub+z*((x[i*s+a-pad]||[])[j*s+b-pad]||0),0),0)));
      return {metrics:[{label:'Output shape',value:`${h} × ${w}`}],tables:[grid('Input',x),grid('Kernel',k),grid('Output',out)]}; }
  },
  {id:'rnn',title:'Recurrent state trace',description:'A scalar recurrent cell: hₜ=tanh(input weight × xₜ + recurrent weight × hₜ₋₁ + bias).',
    inputs:[f('sequence','Input sequence','0.5,-0.2,0.8,0'),nf('inputWeight','Input weight',0.7,-10,10),nf('recurrentWeight','Recurrent weight',0.6,-10,10),nf('bias','Bias',0.1,-10,10),nf('initial','Initial hidden state',0,-10,10)],
    compute(p){const xs=vector(p.sequence,'Sequence'),wx=number(p.inputWeight,'Input weight',-10,10),wh=number(p.recurrentWeight,'Recurrent weight',-10,10),b=number(p.bias,'Bias',-10,10);let h=number(p.initial,'Initial state',-10,10);const rows=xs.map((x,i)=>{const previous=h,z=wx*x+wh*h+b;h=Math.tanh(z);return[i+1,x,previous,z,h];});return{tables:[table('State unroll',['Time','Input','Previous hidden','Preactivation','Hidden'],rows)],series:[{label:'Hidden state',values:rows.map(r=>r[4])}]};}
  },
  {id:'attention',title:'Scaled dot-product attention',description:'Compare query-key scores, row-normalized weights and weighted value outputs. Each row is a token.',inputs:attentionInputs(),
    compute(p){const a=attention(matrix(p.q,'Q'),matrix(p.k,'K'),matrix(p.v,'V'));return{tables:[grid('Scores / √d',a.scores),grid('Attention probabilities',a.probabilities),grid('Weighted values',a.output)]};}
  },
  {id:'warmup',title:'Warmup and decay',description:'A toy schedule ramps linearly from zero to the peak, then decays linearly to zero at the final step.',
    inputs:[nf('peak','Peak learning rate',0.01,0,10),nf('warmup','Warmup steps',3,1,99,1),nf('total','Total steps',12,2,100,1)],
    compute(p){const peak=number(p.peak,'Peak',0,10),warm=integer(p.warmup,'Warmup',1,99),total=integer(p.total,'Total',2,100);if(warm>=total)throw new Error('Warmup must be shorter than total steps.'); const rows=Array.from({length:total+1},(_,i)=>[i,i<=warm?peak*i/warm:peak*(total-i)/(total-warm)]);return{tables:[table('Schedule',['Step','Learning rate'],rows)],series:[{label:'Learning rate',values:rows.map(r=>r[1])}]};}
  },
  {id:'lstm',title:'LSTM gate trace',description:'An original scalar LSTM example. Gate vectors are ordered input, forget, candidate, output; the candidate uses tanh and other gates use sigmoid.',
    inputs:[f('sequence','Input sequence','0.4,-0.3,0.7'),f('inputWeights','Four input weights','0.8,0.5,0.9,0.6'),f('hiddenWeights','Four hidden weights','0.2,0.3,0.4,0.1'),f('biases','Four biases','0,0.5,0,0'),nf('cell','Initial cell',0,-10,10),nf('hidden','Initial hidden',0,-10,10)],
    compute(p){const xs=vector(p.sequence,'Sequence'),wx=vector(p.inputWeights,'Input weights',4),wh=vector(p.hiddenWeights,'Hidden weights',4),bs=vector(p.biases,'Biases',4);if([wx,wh,bs].some(a=>a.length!==4))throw new Error('Each gate vector needs exactly four values.');let c=number(p.cell,'Cell',-10,10),h=number(p.hidden,'Hidden',-10,10);const rows=xs.map((x,t)=>{const z=wx.map((w,i)=>w*x+wh[i]*h+bs[i]);const ig=sigmoid(z[0]),fg=sigmoid(z[1]),g=Math.tanh(z[2]),og=sigmoid(z[3]);c=fg*c+ig*g;h=og*Math.tanh(c);return[t+1,x,ig,fg,g,og,c,h];});return{tables:[table('Gate and state trace',['Time','Input','Input gate','Forget gate','Candidate','Output gate','Cell','Hidden'],rows)],series:[{label:'Cell state',values:rows.map(r=>r[6])},{label:'Hidden state',values:rows.map(r=>r[7])}]};}
  },
  {id:'multihead-attention',title:'Two attention heads',description:'Split even-width Q/K/V features into two heads; independently adjust each head’s score scale, then concatenate their value outputs. This toy omits a final output projection.',
    inputs:[...attentionInputs(),nf('head1','Head 1 score scale',1,0,10),nf('head2','Head 2 score scale',0.5,0,10)],
    compute(p){const q=matrix(p.q,'Q'),k=matrix(p.k,'K'),v=matrix(p.v,'V');if(q[0].length%2||k[0].length%2||v[0].length%2)throw new Error('Q/K/V feature widths must be even for two heads.');const scales=[number(p.head1,'Head 1 scale',0,10),number(p.head2,'Head 2 scale',0,10)];const split=(m,i)=>m.map(r=>r.slice(i*r.length/2,(i+1)*r.length/2));const heads=scales.map((s,i)=>attention(split(q,i),split(k,i),split(v,i),false,s));return{tables:[grid('Head 1 probabilities',heads[0].probabilities),grid('Head 2 probabilities',heads[1].probabilities),grid('Concatenated outputs',heads[0].output.map((r,i)=>[...r,...heads[1].output[i]]))]};}
  },
  {id:'causal-attention',title:'Causal attention mask',description:'Future tokens are excluded before softmax, so their probabilities are exactly zero. Toggle the mask to compare full attention.',
    inputs:[...attentionInputs(),f('mask','Attention mask','causal',{type:'select',options:[{value:'causal',label:'Causal'},{value:'none',label:'None'}]})],
    compute(p){if(!['causal','none'].includes(p.mask))throw new Error('Choose a valid mask.');const causal=p.mask==='causal',a=attention(matrix(p.q,'Q'),matrix(p.k,'K'),matrix(p.v,'V'),causal);return{tables:[grid('Allowed positions (1 = allowed)',a.scores.map((r,i)=>r.map((_,j)=>!causal||j<=i?1:0))),grid('Attention probabilities',a.probabilities),grid('Weighted values',a.output)]};}
  },
  {id:'residual',title:'Residual addition',description:'A compact elementwise residual block: output = x + scale × activation(weight × x + bias). This is a toy transform, not a full network architecture.',
    inputs:[f('input','Input vector','-2,-0.5,1,3'),nf('weight','Transform weight',0.6,-10,10),nf('bias','Transform bias',0.2,-10,10),nf('scale','Residual scale',1,-10,10),f('activation','Activation','relu',{type:'select',options:[{value:'relu',label:'ReLU'},{value:'tanh',label:'Tanh'},{value:'linear',label:'Linear'}]})],
    compute(p){const x=vector(p.input,'Input'),w=number(p.weight,'Weight',-10,10),b=number(p.bias,'Bias',-10,10),s=number(p.scale,'Scale',-10,10);if(!['relu','tanh','linear'].includes(p.activation))throw new Error('Choose a valid activation.');const rows=x.map((v,i)=>{const z=w*v+b,a=p.activation==='relu'?Math.max(0,z):p.activation==='tanh'?Math.tanh(z):z;return[i+1,v,z,a,s*a,v+s*a];});return{tables:[table('Skip plus residual',['Index','Skip x','Preactivation','Activation','Scaled residual','Output'],rows)],series:[{label:'Input',values:x},{label:'Output',values:rows.map(r=>r[5])}]};}
  },
  {id:'beam-search',title:'Beam search on a tiny vocabulary',description:'Rows give next-token probabilities for the current token (tokens 0, 1, …). Keep the highest joint log-probability sequences after each expansion. Fixed-length toy decoding has no end token or length penalty.',
    inputs:[f('transitions','Transition probabilities','0.1,0.6,0.3;0.5,0.2,0.3;0.2,0.4,0.4'),nf('start','Starting token',0,0,3,1),nf('width','Beam width',2,1,5,1),nf('depth','Generated tokens',3,1,6,1)],
    compute(p){const m=matrix(p.transitions,'Transitions',4);if(m.length!==m[0].length||m.some(r=>r.some(x=>x<0||x>1)||Math.abs(r.reduce((s,x)=>s+x,0)-1)>1e-6))throw new Error('Transitions must be square probability rows, each summing to one.');const start=integer(p.start,'Start',0,m.length-1),width=integer(p.width,'Beam width',1,5),depth=integer(p.depth,'Generated tokens',1,6);let beam=[{tokens:[start],log:0}],rows=[];
      for(let step=1;step<=depth;step++){const candidates=[];for(const item of beam)m[item.tokens.at(-1)].forEach((prob,t)=>{if(prob>0)candidates.push({tokens:[...item.tokens,t],log:item.log+Math.log(prob)});});candidates.sort((a,b)=>b.log-a.log||a.tokens.join(',').localeCompare(b.tokens.join(',')));beam=candidates.slice(0,width);beam.forEach((item,rank)=>rows.push([step,rank+1,item.tokens.join(' → '),item.log,Math.exp(item.log)]));}return{tables:[table('Retained beams after each expansion',['Step','Rank','Sequence','Log probability','Joint probability'],rows)],metrics:[{label:'Best sequence',value:beam[0].tokens.join(' → ')}]};}
  },
];
module.exports = cards;
