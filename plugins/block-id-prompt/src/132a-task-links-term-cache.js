// Share the accessor across sessions and queries so public rows retain one
// compact shape. Weak keys keep deferred titles alive only with their rows;
// the renderer captures the query, and its base retains the snapshot title.
const taskLinksLazyTitleStates = new WeakMap();
const taskLinksTitlePartsDescriptor = {
  enumerable: true,
  get() {
    const state = taskLinksLazyTitleStates.get(this);
    return state.render(state.base);
  },
};

// The prose session reuses unchanged query terms while typing. Keep this
// single-term scorer equivalent to the editor's fused hot loop in 032;
// differential tests pin its prunes and Unicode/subsequence semantics.
function taskLinksTermTier(fields, term) {
  let best = -1;
  for (let f = 0; f < fields.length; f += 1) {
    const field = fields[f];
    if (field.startsWith(term)) return 3;
    if (best >= 2) continue;
    let tier = -1;
    let at = field.indexOf(term, 1);
    while (at !== -1) {
      tier = 1;
      const prev = field.charCodeAt(at - 1);
      const wordChar = prev < 128
        ? (prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122)
        : taskWikilinkIsWordChar(field[at - 1]);
      if (!wordChar) {
        tier = 2;
        break;
      }
      at = field.indexOf(term, at + 1);
    }
    if (tier === -1 && best === -1 && taskWikilinkIsSubsequence(field, term)) tier = 0;
    if (tier > best) best = tier;
  }
  return best;
}

function taskLinksTermTiers(cache, rows, term) {
  const hit = cache.get(term);
  if (hit) {
    cache.delete(term);
    cache.set(term, hit);
    return hit;
  }
  // Narrow by prefix, preserving the editor's two subsequence modes. A
  // prefix with a lone surrogate uses code-point iteration; completing the
  // pair may switch to code-unit searches, which can match rows that the
  // prefix rejected. Do not narrow across that switch.
  const codePointTerm = /[\uD800-\uDFFF]/u.test(term);
  let prefixLength = 0;
  let prefixTiers = null;
  for (const [prefix, tiers] of cache) {
    if (prefix.length > prefixLength && term.startsWith(prefix) &&
        (codePointTerm || !/[\uD800-\uDFFF]/u.test(prefix))) {
      prefixLength = prefix.length;
      prefixTiers = tiers;
    }
  }
  const tiers = new Int8Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    tiers[i] = prefixTiers && prefixTiers[i] === -1
      ? -1
      : taskLinksTermTier(loweredTaskWikilinkSearchFields(rows[i]), term);
  }
  if (cache.size >= 32) cache.delete(cache.keys().next().value);
  cache.set(term, tiers);
  return tiers;
}
