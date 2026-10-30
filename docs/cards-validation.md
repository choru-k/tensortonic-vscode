# 0.4.0 interactive exploration verification — 2026-10-30 UTC

Built on the exact published 0.3.2 source tree `81a5ebda0a24db6c440745af004ca061df4f89ff` (local base `605ba5031621683874aba9a6d400aa8ba8c5fffd`). The dedicated study-window/sidebar implementation remains intact.

## Scope and provenance

The 30 problem identities below were checked against previously saved public PyTorch basics curriculum metadata. These are original, small mathematical explorations; no TensorTonic JavaScript, proprietary artwork, layouts, original card defaults, reference answers or hidden tests were copied. The [public plan](https://www.tensortonic.com/study-plans/pytorch-basics) identifies 30 problems. The [site terms](https://www.tensortonic.com/terms) do not establish a redistribution/embedding permission for its visualizations; this implementation does not vendor or frame them.

Coverage means that each listed identity has editable parameters and its own computed numerical results. It does **not** mean pixel/behavior parity with first-party cards, a complete implementation of each PyTorch API, or coverage of other plans. Unknown identities show an explicitly unsupported page. Authoritative API IDs take precedence over potentially renamed browser aliases.

## Implemented inventory

| Problem API identity | Independent exploration | Editable parameters |
| --- | --- | --- |
| pytorch-tensor-creation | Tensor construction lab | Rows; Columns; Construction; Fill / sequence start |
| pytorch-tensor-arithmetic | Elementwise arithmetic lab | First vector; Second vector; Operation |
| pytorch-tensor-reshape | Shape and index lab | Flat values; Rows before transpose; Operation |
| pytorch-basic-autograd | Derivative check lab | x; a; b; Finite-difference step |
| pytorch-activation-function-from-scratch | Activation and slope lab | Activation; Sample center; Sample half-width |
| pytorch-build-simple-nn-from-scratch | Network forward-pass lab | Input vector; Layer widths; Activation; Weight seed |
| pytorch-custom-linear-layer | Affine transform lab | Input vector; Weight matrix; Bias vector |
| pytorch-loss-functions | Loss comparison lab | Predictions / logits; Targets; Loss |
| pytorch-batch-normalization | Batch normalization lab | Feature values; Scale (gamma); Offset (beta); Epsilon |
| pytorch-dropout-from-scratch | Seeded dropout lab | Input values; Drop probability; Mask seed; Mode |
| pytorch-softmax-from-scratch | Stable probability explorer | First logits; Second logits; Temperature |
| pytorch-mini-training | Scalar regression training | Features; Targets; Initial weight; Learning rate; Steps |
| pytorch-gradient-accumulation | Microbatch gradient accounting | Features; Targets; Current weight; Microbatch size |
| pytorch-manual-weight-update | One gradient update | Weights; Gradients; Learning rate |
| pytorch-early-stopping | Patience and improvement | Validation losses; Patience; Minimum improvement |
| pytorch-optimizer-scheduler | Learning-rate schedule | Schedule; Base learning rate; Decay factor; Step interval; Schedule length |
| pytorch-weight-initialization | Seeded initialization samples | Distribution; Target standard deviation; Sample count; Seed |
| pytorch-custom-dataclass | Indexed dataset lookup | Features; Targets; Sample index |
| pytorch-balanced-dataloader | Inverse-frequency sampling | Integer class labels; Draw count; Seed |
| pytorch-transforms-pipeline | Ordered numeric transform pipeline | Input values; Transform order; Scale; Shift; Clip lower bound; Clip upper bound |
| pytorch-custom-optimizer | Momentum optimizer | Initial weight; Initial velocity; Learning rate; Momentum; Updates |
| pytorch-conv2d-from-scratch | Sliding 2D kernel | Input grid; Kernel; Stride; Zero padding |
| pytorch-rnn-cell-from-scratch | Recurrent state trace | Input sequence; Input weight; Recurrent weight; Bias; Initial hidden state |
| pytorch-attention-from-scratch | Scaled dot-product attention | Queries Q (rows separated by ;); Keys K; Values V |
| pytorch-lr-warmup-scheduler | Warmup and decay | Peak learning rate; Warmup steps; Total steps |
| pytorch-lstm-cell-from-scratch | LSTM gate trace | Input sequence; Four input weights; Four hidden weights; Four biases; Initial cell; Initial hidden |
| pytorch-multi-head-attention | Two attention heads | Queries Q (rows separated by ;); Keys K; Values V; Head 1 score scale; Head 2 score scale |
| pytorch-masked-causal-attention | Causal attention mask | Queries Q (rows separated by ;); Keys K; Values V; Attention mask |
| pytorch-residual-block | Residual addition | Input vector; Transform weight; Transform bias; Residual scale; Activation |
| pytorch-beam-search | Beam search on a tiny vocabulary | Transition probabilities; Starting token; Beam width; Generated tokens |

## Important simplified semantics

- The network is a small seeded feedforward example, not a copied architecture or problem solution. Its SVG diagram and forward values respond to inputs, layer widths, seed and activation.
- Batch normalization demonstrates one-feature training normalization using population variance; no running statistics or evaluation-mode behavior. Dropout uses a local deterministic PRNG, not PyTorch's RNG sequence.
- Initialization distinguishes empirical from target variance. Balanced sampling uses replacement and balances classes in expectation, not necessarily per draw/batch.
- Early stopping uses a min-delta-qualified anchor and traces decisions only; it does not save/restore model weights.
- Convolution is single-channel cross-correlation with stride/zero padding, without bias/dilation. Recurrent/LSTM cells are scalar examples. Two-head attention omits final output projection. Beam search is fixed length, without end tokens/length penalties.

## Security and lifecycle

Explicit CodeLens, sidebar context and command actions open a separate panel. Native Markdown/math is not replaced. The generated context note advertises the action without command URIs or a relaxation of Markdown trust. A known identity can open offline with no detail fetch; no reference solution, private tests, account data or student code enters the card runtime.

The card-only panel has scripts enabled but no local resource roots. Its CSP is default/connect/frame/img none, with per-render cryptographic nonces for bundled scripts/styles only. A fixed source-file allowlist builds a local module bundle; remote metadata never chooses module paths. No eval, network API, VS Code messaging or downloaded HTML is used. Labels use DOM textContent. Inputs/output size, numerical finiteness, shapes and iteration counts are bounded. Invalid settings clear stale output. Reset restores deterministic defaults. A new open resets the example; state persistence across reopening is not claimed.

Generation checks reject stale metadata completions/errors after a newer request, editor selection/navigation, disconnect, close or extension disposal. Old panel disposal cannot clear a replacement. Offline opening remains available after disconnection via a new explicit request.

## Checks completed

- Full integrated suite: **241 passed**, no failures/skips.
- Loopback transport suite: **15 passed**, no failures/skips; no live account requests.
- **47 card tests** cover 30 complete registry mappings, default numerical outputs/determinism/bounds, all-card mock-DOM calculate/error/reset/recalculate, source escaping/CSP and local bundle execution.
- **6 integration tests** cover explicit offline actions/no writes, unsupported authoritative IDs, CodeLens/sidebar/context discovery, repeated open/close/reopen, stale metadata, newer navigation/disconnect and old disposal.
- Independent numerical review checked hand-derived Conv2d results [[37,47],[67,77]], LSTM cell [1,.5]/hidden [.38079707798,.23105857863], attention probabilities [.25,.75]/output 5, beam width2 optimum .4851 versus greedy .2601, autograd y25/dx30. Persistent regression fixtures cover representative calculations; reviewers also examined dropout, normalization, weighted sampling and initialization semantics.
- Independent source review cleared the standalone card runtime's static-module/CSP boundary, safe text rendering and bounded calculations. Integration review is tracked separately by the parent task.
- JavaScript syntax and git diff whitespace checks passed. The 0.4.0 VSIX passed archive integrity and exact source-byte parity for integration and card modules; it does not include tests or local research/account files. Historical artifacts are unchanged.

## Verification limits

DOM tests use a lightweight fake document and Node VM: they are **not real-browser layout, CSP enforcement or accessibility audits**. Native VS Code/Chromium visual execution was not run for this change. Earlier cloud host/browser attempts were blocked; no alternate policy bypass was attempted. No Mac access, new browser grant, live authentication, grading/submit or website solutions were used. The generated VSIX is not evidence of a rendered UI check.
