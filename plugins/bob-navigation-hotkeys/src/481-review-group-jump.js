// Pure review-group planner for `[S` / `]S`: land on the first due task
// of the previous / next occupied review tier, cycling. Reuses review
// identity helpers; never writes and never walks the `]w` lane model.
const REVIEW_GROUP_TIER_ORDER = Object.freeze([
  "pre",
  "new",
  "projects",
  "pending",
  "next",
  "recurring",
  "tickler",
  "references",
  "rotten",
  "post",
]);

function reviewGroupOccupiedTiers(rows) {
  const present = new Set();
  for (const entry of Array.isArray(rows) ? rows : []) {
    const tier = reviewEntryMachineTier(entry);
    if (tier) {
      present.add(tier);
    }
  }
  return REVIEW_GROUP_TIER_ORDER.filter((tier) => present.has(tier));
}

function reviewGroupFirstIndex(rows, tier) {
  const list = Array.isArray(rows) ? rows : [];
  for (let index = 0; index < list.length; index += 1) {
    if (reviewEntryMachineTier(list[index]) === tier) {
      return index;
    }
  }
  return -1;
}

function reviewNormalizeGroupTier(tier) {
  const raw = typeof tier === "string" ? tier.trim().toLowerCase() : "";
  if (!raw) {
    return null;
  }
  if (raw === "returned") {
    return "tickler";
  }
  return raw;
}

// Landing anchors record the current row in `keys` so lowercase `]s`
// can step from that position. Group jumps must not treat that as an
// answer: only answer/move/stamp anchors (and today's verified
// accumulator) exclude rows.
function reviewAnchorIsAnswerEvidence(anchor) {
  try {
    if (!anchor || typeof anchor !== "object") {
      return false;
    }
    if (anchor.answered === true) {
      return true;
    }
    if (anchor.resumeNext || anchor.resumePrev) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function reviewGroupExcludedKeys(list, options = {}) {
  const excluded = new Set();
  const todayText =
    options && typeof options.todayText === "string" ? options.todayText : "";
  const anchor =
    options && options.anchor && typeof options.anchor === "object"
      ? options.anchor
      : null;
  if (
    anchor &&
    reviewAnchorIsCurrentDay(anchor, todayText) &&
    reviewAnchorIsAnswerEvidence(anchor)
  ) {
    try {
      for (const key of reviewVerifiedHandledKeys(list, anchor)) {
        excluded.add(key);
      }
    } catch (error) {
      // Unverified keys stay included.
    }
  }
  const stored = options && options.answeredKeys;
  if (stored && typeof stored === "object" && stored.day === todayText) {
    const refs = [];
    try {
      const keys =
        stored.keys instanceof Set
          ? stored.keys
          : Array.isArray(stored.keys)
            ? stored.keys
            : [];
      const texts = stored.texts instanceof Map ? stored.texts : null;
      for (const key of keys) {
        if (typeof key !== "string" || !key) {
          continue;
        }
        let text = "";
        try {
          const recorded = texts ? texts.get(key) : undefined;
          text = typeof recorded === "string" ? recorded : "";
        } catch (error) {
          text = "";
        }
        refs.push({ key, text });
      }
    } catch (error) {
      // The accumulator is advisory.
    }
    try {
      for (const key of verifyReviewKeyRefs(list, refs)) {
        excluded.add(key);
      }
    } catch (error) {
      // Unverified accumulator keys stay included.
    }
  }
  return excluded;
}

function resolveReviewGroupOriginTier(rows, options = {}) {
  if (options && options.originResolved === true) {
    return reviewNormalizeGroupTier(options.originTier);
  }
  const todayText =
    options && typeof options.todayText === "string" ? options.todayText : "";
  const list = Array.isArray(rows) ? rows : [];
  const cursor =
    options && options.cursor && typeof options.cursor === "object"
      ? options.cursor
      : null;
  if (cursor) {
    let index = -1;
    try {
      index = findReviewResumeIndex(list, cursor);
    } catch (error) {
      index = -1;
    }
    if (index >= 0) {
      return reviewEntryMachineTier(list[index]) || null;
    }
  }
  const current =
    options && options.current && typeof options.current === "object"
      ? options.current
      : null;
  if (current && reviewAnchorIsCurrentDay(current, todayText)) {
    let index = -1;
    try {
      index = findReviewResumeIndex(list, current);
    } catch (error) {
      index = -1;
    }
    if (index >= 0) {
      return reviewEntryMachineTier(list[index]) || null;
    }
  }
  const anchor =
    options && options.anchor && typeof options.anchor === "object"
      ? options.anchor
      : null;
  if (anchor && reviewAnchorIsCurrentDay(anchor, todayText)) {
    return reviewNormalizeGroupTier(anchor.tier);
  }
  return null;
}

// Modular occupied-group step. `steps` is the total group count (default 1).
// Never loops over the count: wrap uses remainder arithmetic so a huge
// Vim prefix stays O(occupied groups).
function reviewGroupStep(occupied, originTier, direction, steps) {
  const n = Array.isArray(occupied) ? occupied.length : 0;
  if (n === 0) {
    return { tier: null, wrapped: false };
  }
  const count = Math.max(1, Math.floor(numericOrDefault(steps, 1)));
  const step = direction < 0 ? -1 : 1;
  if (!originTier) {
    if (step > 0) {
      const raw = count - 1;
      const idx = ((raw % n) + n) % n;
      return { tier: occupied[idx], wrapped: raw >= n || raw < 0 };
    }
    const raw = n - count;
    const idx = ((raw % n) + n) % n;
    return { tier: occupied[idx], wrapped: raw < 0 };
  }
  const occupiedIndex = occupied.indexOf(originTier);
  if (occupiedIndex >= 0) {
    const raw = occupiedIndex + step * count;
    const idx = ((raw % n) + n) % n;
    const wrapped = step > 0 ? raw >= n || raw < 0 : raw < 0;
    return { tier: occupied[idx], wrapped };
  }
  const ring = REVIEW_GROUP_TIER_ORDER;
  const start = ring.indexOf(originTier);
  const fromIndex = start >= 0 ? start : step > 0 ? -1 : ring.length;
  let firstTier = occupied[0];
  let firstWrapped = false;
  for (let offset = 1; offset <= ring.length; offset += 1) {
    let idx = fromIndex + step * offset;
    if (idx >= ring.length || idx < 0) {
      firstWrapped = true;
      idx = ((idx % ring.length) + ring.length) % ring.length;
    }
    const tier = ring[idx];
    if (occupied.includes(tier)) {
      firstTier = tier;
      break;
    }
  }
  if (count === 1) {
    return { tier: firstTier, wrapped: firstWrapped };
  }
  const rest = reviewGroupStep(occupied, firstTier, step, count - 1);
  return {
    tier: rest.tier,
    wrapped: firstWrapped || rest.wrapped,
  };
}

function planReviewGroupJump(queue, options = {}) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const direction = options && options.direction < 0 ? -1 : 1;
  if (list.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const excluded = reviewGroupExcludedKeys(list, options);
  const remaining = [];
  for (const entry of list) {
    let key = "";
    try {
      key = reviewQueueEntryKey(entry);
    } catch (error) {
      key = "";
    }
    if (key && excluded.has(key)) {
      continue;
    }
    remaining.push(entry);
  }
  if (remaining.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const occupied = reviewGroupOccupiedTiers(remaining);
  if (occupied.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const originTier = resolveReviewGroupOriginTier(remaining, options);
  const steps = Math.max(1, normalizeVimRepeat(options && options.repeat));
  const stepped = reviewGroupStep(occupied, originTier, direction, steps);
  if (!stepped.tier) {
    return Object.freeze({ kind: "empty" });
  }
  const index = reviewGroupFirstIndex(remaining, stepped.tier);
  if (index < 0) {
    return Object.freeze({ kind: "empty" });
  }
  return Object.freeze({
    kind: "jump",
    entry: remaining[index],
    rank: index + 1,
    total: remaining.length,
    wrapped: Boolean(stepped.wrapped),
    originTier,
  });
}
