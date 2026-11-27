---
type: "[[ref]]"
title: "Attention Is All You Need"
summary: "Why transformers replaced recurrence: the paper behind every LLM."
author: "Vaswani et al."
source_url: "https://arxiv.org/abs/1706.03762"
published: 2017-06
ref_type: papers
created: 2026-10-01
source_pdf: "lib/attention-is-all-you-need.pdf"
highlights_count: 12
highlights_synced_at: "2026-11-20T09:00:00"
earlier:
  - "ref/papers/attention-is-all-you-need__v1"
  - "ref_history/attention-flyby"
---

# Attention Is All You Need

## Highlights

<!-- highlights:begin -->

### Page 1

> [!quote] The architecture is based solely on attention mechanisms.
>
> > [!note] Comment This is the central design claim.
^h-aaaaaaaaaaaa

> [!quote] The encoder and decoder are stacks of self-attention layers.
^h-bbbbbbbbbbbb

> [!quote] Attention can connect distant positions in constant steps.
>
> > [!note] Comment This explains why parallel training is practical.
^h-cccccccccccc

> [!quote] Multi-head attention attends to information from different subspaces.
^h-dddddddddddd

> [!quote] Positional encoding supplies the order that recurrence used to carry.
^h-eeeeeeeeeeee

> [!quote] The model uses residual connections and layer normalization.
>
> > [!note] Comment Keep the normalization detail with the architecture summary.
^h-ffffffffffff

### Page 2

> [!quote] The decoder masks future positions during training.
^h-111111111112

> [!quote] The attention weights provide a useful inspection surface.
^h-111111111113

> [!quote] The model improves translation quality with less training time.
^h-111111111114

> [!quote] The base model uses six layers in both encoder and decoder.
>
> > [!note] Comment Preserve this as the familiar configuration.
^h-111111111115

> [!quote] Beam search is used for decoding.
^h-111111111116

> [!quote] The paper compares quality, cost, and training throughput.
^h-111111111117

<!-- highlights:end -->
