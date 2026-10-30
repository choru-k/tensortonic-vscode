'use strict';
// Original local numerical explorations. No platform source, content, or assets.
const {number, integer, vector, softmax, mean, random, field, table} = require('./math');
const num = (key,label,value,min,max,step=1) => field(key,label,value,{type:'number',min,max,step});
const select = (key,label,value,values) => field(key,label,value,{type:'select',options:values.map(value=>({value,label:value}))});
function choice(value, values, label) { if(!values.includes(value)) throw new Error(`${label} is not a supported option.`); return value; }
function equalLength(a,b) { if(a.length!==b.length) throw new Error('Feature and target lengths must match.'); }
function bounded(value) { if(!Number.isFinite(value)||Math.abs(value)>1e12) throw new Error('Calculation diverged. Reduce the learning rate or input magnitude.'); return value; }
const sum = a => a.reduce((s,x)=>s+x,0);
const cards = [
  {
    id:'softmax', title:'Stable probability explorer', description:'Edit two logit vectors independently and compare temperature-scaled probability distributions.',
    inputs:[field('first','First logits','-2, 0.5, 1.5'),field('second','Second logits','4, 3, -1'),num('temperature','Temperature',1,0.01,100,0.1)],
    compute(v) {
      const t=number(v.temperature,'Temperature',0.01,100), a=vector(v.first,'First logits'), b=vector(v.second,'Second logits');
      const p=softmax(a.map(x=>x/t)), q=softmax(b.map(x=>x/t));
      return {summary:'Subtracting the largest scaled logit keeps exponentiation stable. Each vector is normalized separately.',metrics:[{label:'First probability sum',value:sum(p)},{label:'Second probability sum',value:sum(q)}],tables:[table('First vector',['Index','Logit','Probability'],a.map((x,i)=>[i,x,p[i]])),table('Second vector',['Index','Logit','Probability'],b.map((x,i)=>[i,x,q[i]]))],series:[{label:'First probabilities',values:p},{label:'Second probabilities',values:q}]};
    }
  },
  {
    id:'training-loop',title:'Scalar regression training',description:'Run a bounded number of full-batch gradient steps for prediction y = weight × x and mean squared error. Reset restores the original inputs.',
    inputs:[field('x','Features','-1, 0, 1, 2'),field('y','Targets','-1.5, 0, 1.5, 3'),num('weight','Initial weight',0,-100,100,0.1),num('rate','Learning rate',0.1,0,1,0.01),num('steps','Steps',8,0,200)],
    compute(v) {
      const x=vector(v.x,'Features'),y=vector(v.y,'Targets'); equalLength(x,y);
      let w=number(v.weight,'Initial weight',-100,100); const rate=number(v.rate,'Learning rate',0,1), steps=integer(v.steps,'Steps',0,200),rows=[],losses=[];
      for(let i=0;i<=steps;i++) {
        const residual=x.map((z,j)=>bounded(w*z-y[j])),loss=bounded(mean(residual.map(z=>z*z))),gradient=bounded(2*mean(residual.map((z,j)=>z*x[j])));
        rows.push([i,w,loss,gradient]); losses.push(loss);
        if(i<steps) w=bounded(w-rate*gradient);
      }
      return {metrics:[{label:'Final weight',value:w},{label:'Final MSE',value:losses.at(-1)}],tables:[table('Optimization trace',['Step','Weight','MSE','Gradient'],rows)],series:[{label:'MSE by step',values:losses}]};
    }
  },
  {
    id:'gradient-accumulation',title:'Microbatch gradient accounting',description:'Compare a full-batch MSE gradient with size-weighted microbatch gradients without updating parameters between batches.',
    inputs:[field('x','Features','1, 2, 3, 4, 5'),field('y','Targets','2, 4, 6, 8, 10'),num('weight','Current weight',0.5,-100,100,0.1),num('batch','Microbatch size',2,1,64)],
    compute(v) {
      const x=vector(v.x,'Features'),y=vector(v.y,'Targets'); equalLength(x,y);
      const w=number(v.weight,'Weight',-100,100),n=integer(v.batch,'Microbatch size',1,64),contributions=x.map((z,i)=>2*(w*z-y[i])*z),rows=[]; let weighted=0,naive=0;
      for(let i=0;i<x.length;i+=n) { const a=contributions.slice(i,i+n),g=mean(a),c=g*a.length/x.length; weighted+=c;naive+=g;rows.push([rows.length+1,a.length,g,c]); }
      return {summary:'For uneven microbatches, weight each mean gradient by its sample count. Simply adding mean gradients changes the scale.',metrics:[{label:'Full-batch gradient',value:mean(contributions)},{label:'Weighted accumulated gradient',value:weighted},{label:'Unweighted sum (comparison)',value:naive}],tables:[table('Microbatches',['Batch','Samples','Mean gradient','Weighted contribution'],rows)]};
    }
  },
  {
    id:'weight-update',title:'One gradient update',description:'Apply weight − learning rate × gradient element by element.',
    inputs:[field('weights','Weights','1, -2, 0.5'),field('gradients','Gradients','0.4, -0.2, 1'),num('rate','Learning rate',0.1,0,100,0.01)],
    compute(v) { const w=vector(v.weights,'Weights'),g=vector(v.gradients,'Gradients');equalLength(w,g);const r=number(v.rate,'Learning rate',0,100),next=w.map((x,i)=>x-r*g[i]);return {tables:[table('Update',['Index','Old weight','Gradient','Change','New weight'],w.map((x,i)=>[i,x,g[i],-r*g[i],next[i]]))],series:[{label:'Updated weights',values:next}]}; }
  },
  {
    id:'early-stopping',title:'Patience and improvement',description:'Scan validation losses. An improvement must beat the best loss by more than min delta; stop after patience consecutive misses. Best qualifying loss is the min-delta anchor, not necessarily the smallest observed loss. This experiment does not save or restore model weights.',
    inputs:[field('losses','Validation losses','1.2, 0.9, 0.7, 0.71, 0.69, 0.7, 0.72'),num('patience','Patience',2,1,64),num('delta','Minimum improvement',0.02,0,100,0.01)],
    compute(v) { const losses=vector(v.losses,'Validation losses');if(losses.some(x=>x<0))throw new Error('Losses must be nonnegative.');const patience=integer(v.patience,'Patience',1,64),delta=number(v.delta,'Minimum improvement',0,100);let best=Infinity,bestEpoch=0,misses=0,stopped=0;const rows=[];losses.forEach((loss,i)=>{if(stopped){rows.push([i+1,loss,'Not evaluated after stop',best,misses]);return;}const improved=loss<best-delta;if(improved){best=loss;bestEpoch=i+1;misses=0;}else misses++;if(misses>=patience)stopped=i+1;rows.push([i+1,loss,stopped?'Stop':improved?'Improved':'No improvement',best,misses]);});return {metrics:[{label:'Best qualifying epoch',value:bestEpoch},{label:'Best qualifying loss',value:best},{label:'Stop epoch',value:stopped||'Not reached'}],tables:[table('Validation trace',['Epoch','Loss','Decision','Best qualifying','Misses'],rows)],series:[{label:'Supplied losses',values:losses}]}; }
  },
  {
    id:'optimizer-scheduler',title:'Learning-rate schedule',description:'Compare step decay and exponential decay before optimizer updates. Step zero uses the base learning rate.',
    inputs:[select('mode','Schedule','step',['step','exponential']),num('base','Base learning rate',0.2,0,100,0.01),num('gamma','Decay factor',0.5,0,1,0.05),num('interval','Step interval',4,1,200),num('steps','Schedule length',16,1,200)],
    compute(v) { const mode=choice(v.mode,['step','exponential'],'Schedule'),base=number(v.base,'Base learning rate',0,100),gamma=number(v.gamma,'Decay factor',0,1),interval=integer(v.interval,'Step interval',1,200),steps=integer(v.steps,'Schedule length',1,200),rates=Array.from({length:steps},(_,i)=>base*Math.pow(gamma,mode==='step'?Math.floor(i/interval):i));return {summary:mode==='step'?'Rate drops at multiples of the interval.':'Rate decays every step; the interval control is unused in exponential mode.',tables:[table('Schedule',['Step','Learning rate'],rates.map((r,i)=>[i,r]))],series:[{label:'Learning rate',values:rates}]}; }
  },
  {
    id:'weight-initialization',title:'Seeded initialization samples',description:'Sample independent uniform or normal weights. The seed makes repeated runs reproducible; empirical variance differs from its target.',
    inputs:[select('mode','Distribution','uniform',['uniform','normal']),num('scale','Target standard deviation',0.5,0,100,0.1),num('count','Sample count',32,1,64),num('seed','Seed',73,0,2147483647)],
    compute(v) { const mode=choice(v.mode,['uniform','normal'],'Distribution'),scale=number(v.scale,'Target standard deviation',0,100),count=integer(v.count,'Sample count',1,64),rng=random(v.seed),samples=Array.from({length:count},()=>mode==='uniform'?(2*rng()-1)*Math.sqrt(3)*scale:Math.sqrt(-2*Math.log(Math.max(rng(),1e-12)))*Math.cos(2*Math.PI*rng())*scale),m=mean(samples),variance=mean(samples.map(x=>(x-m)**2)); const low=Math.min(...samples),high=Math.max(...samples),width=(high-low)/8||1,bins=Array(8).fill(0);samples.forEach(x=>bins[Math.min(7,Math.floor((x-low)/width))]++);return {metrics:[{label:'Sample mean',value:m},{label:'Population variance of samples',value:variance},{label:'Target variance',value:scale*scale}],tables:[table('Samples',['Index','Weight'],samples.map((x,i)=>[i,x])),table('Histogram',['Lower bound','Upper bound','Count'],bins.map((n,i)=>[low+i*width,low+(i+1)*width,n]))],series:[{label:'Histogram bin counts',values:bins}]}; }
  },
  {
    id:'dataset',title:'Indexed dataset lookup',description:'Explore a local one-feature dataset and retrieve one zero-based sample/target pair.',
    inputs:[field('features','Features','-3, -1, 2, 4'),field('targets','Targets','0, 0, 1, 1'),num('index','Sample index',2,0,63)],
    compute(v) { const x=vector(v.features,'Features'),y=vector(v.targets,'Targets');equalLength(x,y);const i=integer(v.index,'Sample index',0,x.length-1);return {metrics:[{label:'Dataset length',value:x.length},{label:'Selected feature',value:x[i]},{label:'Selected target',value:y[i]}],tables:[table('Dataset',['Index','Feature','Target','Selected'],x.map((z,j)=>[j,z,y[j],i===j?'Yes':'']))]}; }
  },
  {
    id:'balanced-loader',title:'Inverse-frequency sampling',description:'Assign each sample weight 1 / its class frequency, normalize, then draw with replacement. Counts fluctuate; balancing is in expectation.',
    inputs:[field('labels','Integer class labels','0, 0, 0, 1, 2, 2'),num('draws','Draw count',24,1,200),num('seed','Seed',19,0,2147483647)],
    compute(v) { const labels=vector(v.labels,'Labels');labels.forEach(x=>integer(x,'Class label',-10000,10000));const draws=integer(v.draws,'Draw count',1,200),rng=random(v.seed),counts=new Map();labels.forEach(x=>counts.set(x,(counts.get(x)||0)+1));const weights=labels.map(x=>1/counts.get(x)),total=sum(weights),prob=weights.map(x=>x/total),hits=new Map([...counts.keys()].map(x=>[x,0])),selected=[];for(let n=0;n<draws;n++){const u=rng();let c=0,i=0;for(;i<prob.length-1;i++){c+=prob[i];if(u<c)break;}selected.push([n,i,labels[i]]);hits.set(labels[i],hits.get(labels[i])+1);}return {tables:[table('Per-sample probability',['Index','Class','Class frequency','Weight','Probability'],labels.map((x,i)=>[i,x,counts.get(x),weights[i],prob[i]])),table('Class outcomes',['Class','Expected probability','Observed draws'],[...counts.keys()].map(x=>[x,1/counts.size,hits.get(x)])),table('Draw sequence',['Draw','Sample index','Class'],selected)],series:[{label:'Draw counts by class order',values:[...hits.values()]}]}; }
  },
  {
    id:'transforms',title:'Ordered numeric transform pipeline',description:'Apply scaling, shifting, and clipping in the selected order. Reordering changes results when clipping is involved.',
    inputs:[field('values','Input values','-2, -0.5, 1, 3'),select('order','Transform order','scale → shift → clip',['scale → shift → clip','clip → scale → shift','shift → clip → scale']),num('scale','Scale',2,-100,100,0.1),num('shift','Shift',0.5,-100,100,0.1),num('low','Clip lower bound',-1,-10000,10000,0.1),num('high','Clip upper bound',1,-10000,10000,0.1)],
    compute(v) { const input=vector(v.values,'Input values'),order=choice(v.order,['scale → shift → clip','clip → scale → shift','shift → clip → scale'],'Transform order').split(' → '),scale=number(v.scale,'Scale',-100,100),shift=number(v.shift,'Shift',-100,100),low=number(v.low,'Lower bound'),high=number(v.high,'Upper bound');if(low>high)throw new Error('Clip lower bound cannot exceed its upper bound.');const operations={scale:x=>x*scale,shift:x=>x+shift,clip:x=>Math.max(low,Math.min(high,x))};let current=input;const stages=order.map(name=>{current=current.map(operations[name]);return current;});return {tables:[table('Pipeline',['Index','Input',...order],input.map((x,i)=>[i,x,...stages.map(a=>a[i])]))],series:[{label:'Final values',values:current}]}; }
  }
];
module.exports=cards;
