'use strict';
// IDs were checked against the saved public curriculum metadata on 2026-10-30.
// These are original learning explorations, not first-party card implementations.
const cards = [...require('./foundations'), ...require('./training'), ...require('./advanced')];
const ids = [
 ['pytorch-tensor-creation','tensor-factory'], ['pytorch-tensor-arithmetic','tensor-operations'],
 ['pytorch-tensor-reshape','tensor-shape'], ['pytorch-basic-autograd','autograd'],
 ['pytorch-activation-function-from-scratch','activations'], ['pytorch-build-simple-nn-from-scratch','neural-network'],
 ['pytorch-custom-linear-layer','linear-layer'], ['pytorch-loss-functions','losses'],
 ['pytorch-batch-normalization','batch-normalization'], ['pytorch-dropout-from-scratch','dropout'],
 ['pytorch-softmax-from-scratch','softmax'], ['pytorch-mini-training','training-loop'],
 ['pytorch-gradient-accumulation','gradient-accumulation'], ['pytorch-manual-weight-update','weight-update'],
 ['pytorch-early-stopping','early-stopping'], ['pytorch-optimizer-scheduler','optimizer-scheduler'],
 ['pytorch-weight-initialization','weight-initialization'], ['pytorch-custom-dataclass','dataset'],
 ['pytorch-balanced-dataloader','balanced-loader'], ['pytorch-transforms-pipeline','transforms'],
 ['pytorch-custom-optimizer','momentum'], ['pytorch-conv2d-from-scratch','convolution'],
 ['pytorch-rnn-cell-from-scratch','rnn'], ['pytorch-attention-from-scratch','attention'],
 ['pytorch-lr-warmup-scheduler','warmup'], ['pytorch-lstm-cell-from-scratch','lstm'],
 ['pytorch-multi-head-attention','multihead-attention'], ['pytorch-masked-causal-attention','causal-attention'],
 ['pytorch-residual-block','residual'], ['pytorch-beam-search','beam-search'],
];
const byId = new Map(cards.map(card => [card.id,card]));
const mappings = new Map(ids);
function resolveCard(problem) {
 const ref = problem && (problem.ref || problem);
 if (!ref || ref.planId !== 'pytorch-basics') return undefined;
 // API identity is authoritative: a renamed browser alias must not select another card.
 const key = typeof ref.apiId === 'string' && ref.apiId ? ref.apiId : ref.slug;
 return byId.get(mappings.get(key));
}
function defaults(card) { return Object.fromEntries(card.inputs.map(input=>[input.key,input.value])); }
function evaluate(card, values) {
 if (!card || !byId.has(card.id)) throw new Error('This exploration is not available.');
 const safe = {};
 for(const input of card.inputs) {
  const value = values && values[input.key];
  if(typeof value !== 'string' || value.length>4096) throw new Error(`${input.label} is missing or too long.`);
  if(input.type==='select' && !input.options.some(option=>option.value===value)) throw new Error(`${input.label} has an invalid option.`);
  safe[input.key] = value;
 }
 const result=card.compute(safe);
 let count=0;
 function inspect(value) {
  if(++count>20000) throw new Error('Result is too large.');
  if(typeof value==='number' && !Number.isFinite(value)) throw new Error('These settings overflow; use smaller values.');
  if(typeof value==='string' && value.length>16000) throw new Error('Result is too large.');
  if(Array.isArray(value)) value.forEach(inspect);
  else if(value && typeof value==='object') Object.values(value).forEach(inspect);
 }
 inspect(result);
 return result;
}
module.exports={cards,ids,resolveCard,defaults,evaluate};
