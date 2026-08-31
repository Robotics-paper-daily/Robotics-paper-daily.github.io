# 标签词表 (taxonomy)

Consistent labels are what make the vault countable — if the same idea is tagged
`world-model` in one note and `world_models` in another, statistics break. So:

- **Reuse before you invent.** Pick from the lists below. If nothing fits, use a
  deliberate new label in the note (lowercase-kebab-case, singular) and keep that
  spelling consistent across the vault.
- **Before tagging, also check what the vault already uses** — read a couple of
  recent notes' frontmatter (or grep `field:` / `topics:` / `methods:` across the
  vault) and match existing spellings rather than introducing a synonym.
- Keep `field` to **one** primary value. `topics` and `methods` are lists.

This bundled file is a versioned baseline, not a persistent user-editable source
of truth: an App upgrade may replace it. Do not edit the installed copy. Vault
frontmatter is authoritative for labels already in use.

## field (主领域, 单选)
- `VLM` — vision-language model (perception / understanding / multimodal LLM)
- `VLA` — vision-language-action (policy that outputs actions)
- `WAM` — world / world-action model (learns dynamics, predicts futures, rollout)
- `LLM` — language model centric (incl. reasoning, agents) without vision core
- `MLLM` — multimodal LLM where the LLM is the backbone (overlaps VLM; use when
  the emphasis is the unified LLM, not a perception encoder)
- `RL` — reinforcement-learning centric
- `robotics` — systems / hardware / control centric, not primarily a learned model
- `generative` — image/video/3D generation centric
- `other`

## topics (子方向 / 任务, 多选)
manipulation · navigation · locomotion · grasping · dexterous · humanoid ·
mobile-manipulation · autonomous-driving · embodied-qa · instruction-following ·
long-horizon · planning · reasoning · spatial-reasoning · world-model · video-generation ·
video-prediction · novel-view-synthesis · 3d-scene · affordance · sim2real · data-scaling ·
self-supervised · imitation-learning · representation-learning · benchmark · dataset · survey · perspective ·
model-compression · model-pruning · self-play · self-improvement · closed-loop ·
inference-runtime · edge-deployment · quantization ·
driver-monitoring · selective-prediction · test-time-adaptation ·
domain-adaptation · one-shot-adaptation · cross-embodiment ·
tactile-sensing · tactile-simulation · contact-rich · soft-body · data-curation ·
visual-encoder · dynamic-resolution

## methods (架构 / 模块 / 技巧, 多选)
transformer · diffusion · diffusion-policy · flow-matching · autoregressive ·
action-chunking · vq-tokenizer · discrete-tokens · cross-attention · moe ·
vit · clip · siglip · dino · llm-backbone · llama · qwen · t5 ·
contrastive · masked-modeling · rlhf · dpo · ppo · grpo · agentic · tool-use · chain-of-thought ·
retrieval · co-training · latent-action · hierarchical · multi-task ·
inverse-dynamics · forward-dynamics · fast-tokenizer · two-stage-pretraining ·
layer-pruning · cka · training-free · calibration · dagger · distillation ·
teacher-student · lqr · lora · frequency-domain · dct · sobolev-regularization ·
energy-based · mppi · open-vocabulary · region-proposal · gru ·
fem · hyperelastic · ipc · physics-based · neo-hookean ·
mixture-of-transformers · world-model-supervision · cross-embodiment ·
multi-timescale · fast-slow · counterfactual · causal-inference ·
mamba · state-space-model · anchor-based · cdit · attentional-pooling ·
linear-attention · rope · gated-attention · swiglu · rmsnorm · super-class · sigmoid-loss ·
memory · generalist · system2 · sparse-attention · top-k-attention · straight-through-estimator ·
snn · spiking-neuron · ann-to-snn · differential-coding · population-coding · event-driven ·
neuromorphic · energy-efficient · surrogate-gradient · integrate-and-fire ·
test-time-guidance · self-training · rehearsal · soft-min · kmeans ·
model-editing · concept-erasure · classifier-guidance · preference-learning ·
task-arithmetic · weight-arithmetic · subspace-alignment · svd · model-merging

> 提示：标签宁少而准, 不要硬塞。一篇 VLA 操作论文常见: field=VLA,
> topics=[manipulation, imitation-learning], methods=[flow-matching, action-chunking, llm-backbone]。
