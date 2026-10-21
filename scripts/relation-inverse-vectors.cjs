// Shared inverse-phrase vectors (ledger-chips). The display-only
// inverse table in docs/task-relations.md §10 is pinned here and used
// from the ledger test suite; the nav suite adopts it with nav-stage
// (its `inverseRelationPhrase` still renders `‹label› → this` for
// unknown labels until then, while the ledger copy already returns
// null). Matching is case-insensitive; storage stays verbatim.
"use strict";

const RELATION_INVERSE_VECTORS = Object.freeze([
  ["merged into", "merged from"],
  ["duplicate of", "duplicated by"],
  ["follow-up of", "followed up by"],
  ["superseded by", "supersedes"],
  ["split from", "split into"],
]);

// Probes: [input label, expected inverse or null for unknown].
const RELATION_INVERSE_PROBES = Object.freeze([
  ["merged into", "merged from"],
  ["Merged Into", "merged from"],
  ["DUPLICATE OF", "duplicated by"],
  ["follow-up of", "followed up by"],
  ["Follow-Up Of", "followed up by"],
  ["superseded by", "supersedes"],
  ["split from", "split into"],
  ["see", null],
  ["related", null],
  ["", null],
  ["  ", null],
]);

module.exports = { RELATION_INVERSE_VECTORS, RELATION_INVERSE_PROBES };
