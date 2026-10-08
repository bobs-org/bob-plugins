// Review-walk text identity: position comes only from this gesture's
// rows, and neighbours resolve by note and text (`docs/freshness.md`
// §6). Earlier answers, today's accumulator, and prior anchor keys only
// exclude rows; they never move the anchor. A handled key excludes only
// the same row (key plus recorded line text). Pure helpers only, so no
// mixin install is needed. Nothing here throws.
function reviewAdvanceLineTaskStatus(line) {
  try {
    const status = getObsidianTaskCheckboxStatus(line);
    return typeof status === "string" ? status.toLowerCase() : null;
  } catch (error) {
    return null;
  }
}

function reviewAdvanceLineIsClosed(line) {
  const status = reviewAdvanceLineTaskStatus(line);
  return status === "x" || status === "-";
}

// First `YYYY-MM-DD` value of one inline `[field:: date]` / `(field:: date)`
// on the line, or null. Compared as strings: both sides are validated
// `YYYY-MM-DD`, so lexicographic order is calendar order.
function reviewAdvanceLineInlineDate(line, field) {
  try {
    const pattern = new RegExp(
      `[\\[(]\\s*${field}\\s*::\\s*(\\d{4}-\\d{2}-\\d{2})`,
      "i",
    );
    const match = pattern.exec(String(line || ""));
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

function reviewAdvanceLineDependsOnIds(line) {
  const ids = new Set();
  try {
    const pattern = /[\[(]\s*dependsOn\s*::([^\]\)\n]*)[\]\)]/gi;
    let match = pattern.exec(String(line || ""));
    while (match) {
      for (const segment of String(match[1] || "").split(",")) {
        for (const part of String(segment || "").split(/\s+/)) {
          const id = part.trim();
          if (id) {
            ids.add(id);
          }
        }
      }
      match = pattern.exec(String(line || ""));
    }
  } catch (error) {
    // An unparseable line simply carries no ids below.
  }
  return ids;
}

// Pure outcome predicate: did this gesture's committed write take its row
// out of today's walk? `tier` is the landing's machine tier, `outcome` one
// of the `{ kind }` shapes below, and `todayText` is `YYYY-MM-DD`. When in
// doubt this returns false: a missed advance costs one `]s`, while a wrong
// advance loses context.
function reviewOutcomeResolves(tier, outcome, todayText) {
  try {
    if (!outcome || typeof outcome !== "object") {
      return false;
    }
    const kind = String(outcome.kind || "");
    const checklist = tier === "pre" || tier === "post";
    const recurring = tier === "recurring";
    if (kind === "complete") {
      return true;
    }
    if (kind === "lane" || kind === "route") {
      return recurring ? false : !checklist;
    }
    if (kind === "link-today") {
      return recurring ? true : !checklist;
    }
    if (kind !== "card") {
      return false;
    }
    const before = String(outcome.beforeLine ?? "");
    const after = String(outcome.afterLine ?? "");
    if (!after || after === before) {
      return false;
    }
    if (reviewAdvanceLineIsClosed(after)) {
      return true;
    }
    const day =
      typeof todayText === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayText.trim())
        ? todayText.trim()
        : "";
    if (recurring) {
      // A card resolves a RECURRING landing when the row closed (above),
      // its scheduled date moved past today, a new dependency id
      // appeared, or the earliest valid inline scheduled/due/start moved
      // past today. A freshness stamp never resolves it.
      const scheduled = reviewAdvanceLineInlineDate(after, "scheduled");
      if (scheduled && day && scheduled > day) {
        return true;
      }
      const beforeIds = reviewAdvanceLineDependsOnIds(before);
      for (const id of reviewAdvanceLineDependsOnIds(after)) {
        if (!beforeIds.has(id)) {
          return true;
        }
      }
      const due = reviewAdvanceLineInlineDate(after, "due");
      const start = reviewAdvanceLineInlineDate(after, "start");
      const dates = [scheduled, due, start].filter(
        (value) => typeof value === "string" && value,
      );
      if (dates.length > 0 && day) {
        let earliest = dates[0];
        for (const value of dates.slice(1)) {
          if (value < earliest) {
            earliest = value;
          }
        }
        if (earliest > day) {
          return true;
        }
      }
      return false;
    }
    const scheduled = reviewAdvanceLineInlineDate(after, "scheduled");
    if (scheduled && day && scheduled > day) {
      return true;
    }
    if (checklist) {
      const beforeIds = reviewAdvanceLineDependsOnIds(before);
      for (const id of reviewAdvanceLineDependsOnIds(after)) {
        if (!beforeIds.has(id)) {
          return true;
        }
      }
      return false;
    }
    const fresh = reviewAdvanceLineInlineDate(after, "fresh");
    return Boolean(fresh && day && fresh === day);
  } catch (error) {
    return false;
  }
}

// Second line of a stopped advance: `]s → {LABEL}[ · {c} commitments due]`.
// Shared with the PRE group-end notice so both read the same.
function formatReviewAdvanceStopLine(options = {}) {
  const nextLabel = String(options.nextLabel || "").trim();
  const commitments = Number.isInteger(options.commitments)
    ? Math.max(0, options.commitments)
    : 0;
  return `]s → ${nextLabel}${commitments > 0 ? ` · ${commitments} commitments due` : ""}`;
}

function reviewVerifiedHandledKeys(list, anchor) {
  try {
    if (!anchor || typeof anchor !== "object") {
      return new Set();
    }
    const keys = Array.isArray(anchor.keys) ? anchor.keys : [];
    if (keys.length === 0) {
      return new Set();
    }
    const wanted = new Set(keys);
    const texts =
      anchor.keyTexts && typeof anchor.keyTexts === "object"
        ? anchor.keyTexts
        : {};
    const out = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      let key = "";
      try {
        key = reviewQueueEntryKey(entry);
      } catch (error) {
        continue;
      }
      if (!wanted.has(key)) {
        continue;
      }
      const recorded = texts[key];
      if (typeof recorded === "string" && recorded) {
        if (String(entry.originalMarkdown || "") !== recorded) {
          continue;
        }
      }
      out.add(key);
    }
    return out;
  } catch (error) {
    return new Set();
  }
}

function verifyReviewKeyRefs(queue, refs) {
  try {
    const list = Array.isArray(queue) ? queue : [];
    const targets = Array.isArray(refs) ? refs : [];
    if (list.length === 0 || targets.length === 0) {
      return Object.freeze([]);
    }
    const byKey = new Map();
    for (const entry of list) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      let key = "";
      try {
        key = reviewQueueEntryKey(entry);
      } catch (error) {
        continue;
      }
      if (key && !byKey.has(key)) {
        byKey.set(key, entry);
      }
    }
    const out = [];
    for (const ref of targets) {
      if (!ref || typeof ref !== "object") {
        continue;
      }
      const key = typeof ref.key === "string" ? ref.key : "";
      if (!key || out.includes(key)) {
        continue;
      }
      const entry = byKey.get(key);
      if (!entry) {
        continue;
      }
      const text = ref.text;
      if (typeof text === "string" && text) {
        if (String(entry.originalMarkdown || "") !== text) {
          continue;
        }
      }
      out.push(key);
    }
    return Object.freeze(out);
  } catch (error) {
    return Object.freeze([]);
  }
}

// Walk anchor: where the walk is. Recorded on every successful landing
// and every Alt+F / Ctrl+Alt+F stamp. Holds the handled entry keys, the
// handled task's path/line/tier, and the ordered keys after and before
// them in the queue they came from, so `]s` after an Alt+N release,
// Ctrl+Shift+Enter, or a roll continues from the successor (and `[s` from
// the predecessor) instead of restarting at rank 1.
//
// Position (`at`) comes only from `handledKeys`: the rows this gesture
// handled. `options.excludeKeys` joins the exclusion set without moving
// `at`. Neighbours resolve by note and text through `afterRefs` and
// `beforeRefs` (aligned index-for-index with `afterKeys`/`beforeKeys`).
// `keyTexts` records each handled key's line text for R2 verification.
function buildReviewAnchor(queue, handledKeys, fallbackRank, day, options = {}) {
  try {
    const list = Array.isArray(queue) ? queue.slice() : [];
    const queueKeys = list.map((entry) => {
      try {
        return reviewQueueEntryKey(entry);
      } catch (error) {
        return "";
      }
    });
    const handled = new Set(Array.isArray(handledKeys) ? handledKeys : []);
    const exclude =
      options && Array.isArray(options.excludeKeys)
        ? new Set(options.excludeKeys.filter((key) => typeof key === "string" && key))
        : new Set();
    const positions = [];
    queueKeys.forEach((key, index) => {
      if (handled.has(key)) {
        positions.push(index);
      }
    });
    if (positions.length === 0) {
      return null;
    }
    const at = Math.max(...positions);
    const holder = list[at];
    const combined = new Set([...handled, ...exclude]);
    const afterEntries = list.slice(at + 1);
    const afterKeys = afterEntries.map((entry, offset) => queueKeys[at + 1 + offset]);
    const beforeEntries = [];
    const beforeKeys = [];
    for (let index = 0; index < at; index += 1) {
      if (combined.has(queueKeys[index])) {
        continue;
      }
      beforeEntries.push(list[index]);
      beforeKeys.push(queueKeys[index]);
    }
    const keyTexts = {};
    for (const key of combined) {
      const found = list.find((entry) => {
        try {
          return reviewQueueEntryKey(entry) === key;
        } catch (error) {
          return false;
        }
      });
      const text =
        found && typeof found.originalMarkdown === "string"
          ? found.originalMarkdown
          : "";
      if (text) {
        keyTexts[key] = text;
      }
    }
    const afterRefs = afterEntries.map((entry) => {
      try {
        return reviewResumeRef(entry);
      } catch (error) {
        return null;
      }
    });
    const beforeRefs = beforeEntries.map((entry) => {
      try {
        return reviewResumeRef(entry);
      } catch (error) {
        return null;
      }
    });
    const rank =
      holder && Number.isInteger(holder.rank)
        ? holder.rank
        : Number.isInteger(fallbackRank)
          ? fallbackRank
          : at + 1;
    const dayText =
      typeof day === "string" && day.trim() ? day.trim() : null;
    return Object.freeze({
      keys: Object.freeze(Array.from(combined)),
      rank,
      count: combined.size,
      path: holder && typeof holder.path === "string" ? holder.path : "",
      line: holder && Number.isInteger(holder.line) ? holder.line : null,
      tier: reviewEntryMachineTier(holder) || null,
      day: dayText,
      afterKeys: Object.freeze(afterKeys),
      beforeKeys: Object.freeze(beforeKeys),
      keyTexts: Object.freeze(keyTexts),
      afterRefs: Object.freeze(afterRefs),
      beforeRefs: Object.freeze(beforeRefs),
    });
  } catch (error) {
    return null;
  }
}

// Resolve one anchor step over `remaining` (the queue minus the handled
// keys). Forward takes the first surviving `afterKeys` entry, backward
// the last surviving `beforeKeys` entry, wrapping to the first/last
// remaining entry. Ranks count over `remaining` (1-based). Text refs
// resolve by path and exact text first; a ref that does not resolve is
// skipped and never falls back to its line key. A `null` ref resolves
// its aligned key exactly as before; anchors without refs keep the
// key-only path.
function resolveReviewAnchorTarget(remaining, anchor, direction) {
  try {
    const rest = Array.isArray(remaining) ? remaining : [];
    if (rest.length === 0) {
      return null;
    }
    const atRest = (key) => {
      try {
        return rest.findIndex((entry) => reviewQueueEntryKey(entry) === key);
      } catch (error) {
        return -1;
      }
    };
    if (direction < 0) {
      const before =
        anchor && Array.isArray(anchor.beforeKeys) ? anchor.beforeKeys : [];
      const beforeRefs =
        anchor && Array.isArray(anchor.beforeRefs) ? anchor.beforeRefs : null;
      if (beforeRefs) {
        for (let index = beforeRefs.length - 1; index >= 0; index -= 1) {
          const ref = beforeRefs[index];
          if (ref && typeof ref === "object") {
            let found = -1;
            try {
              found = findReviewResumeIndex(rest, ref);
            } catch (error) {
              found = -1;
            }
            if (found >= 0) {
              return Object.freeze({
                entry: rest[found],
                rank: found + 1,
                total: rest.length,
                wrapped: false,
              });
            }
            continue;
          }
          const key = index < before.length ? before[index] : undefined;
          if (typeof key === "string") {
            const found = atRest(key);
            if (found >= 0) {
              return Object.freeze({
                entry: rest[found],
                rank: found + 1,
                total: rest.length,
                wrapped: false,
              });
            }
          }
        }
        return Object.freeze({
          entry: rest[rest.length - 1],
          rank: rest.length,
          total: rest.length,
          wrapped: true,
        });
      }
      for (let index = before.length - 1; index >= 0; index -= 1) {
        const found = atRest(before[index]);
        if (found >= 0) {
          return Object.freeze({
            entry: rest[found],
            rank: found + 1,
            total: rest.length,
            wrapped: false,
          });
        }
      }
      return Object.freeze({
        entry: rest[rest.length - 1],
        rank: rest.length,
        total: rest.length,
        wrapped: true,
      });
    }
    const after = anchor && Array.isArray(anchor.afterKeys) ? anchor.afterKeys : [];
    const afterRefs =
      anchor && Array.isArray(anchor.afterRefs) ? anchor.afterRefs : null;
    if (afterRefs) {
      for (let index = 0; index < afterRefs.length; index += 1) {
        const ref = afterRefs[index];
        if (ref && typeof ref === "object") {
          let found = -1;
          try {
            found = findReviewResumeIndex(rest, ref);
          } catch (error) {
            found = -1;
          }
          if (found >= 0) {
            return Object.freeze({
              entry: rest[found],
              rank: found + 1,
              total: rest.length,
              wrapped: false,
            });
          }
          continue;
        }
        const key = index < after.length ? after[index] : undefined;
        if (typeof key === "string") {
          const found = atRest(key);
          if (found >= 0) {
            return Object.freeze({
              entry: rest[found],
              rank: found + 1,
              total: rest.length,
              wrapped: false,
            });
          }
        }
      }
      return Object.freeze({
        entry: rest[0],
        rank: 1,
        total: rest.length,
        wrapped: true,
      });
    }
    for (const key of after) {
      const found = atRest(key);
      if (found >= 0) {
        return Object.freeze({
          entry: rest[found],
          rank: found + 1,
          total: rest.length,
          wrapped: false,
        });
      }
    }
    return Object.freeze({
      entry: rest[0],
      rank: 1,
      total: rest.length,
      wrapped: true,
    });
  } catch (error) {
    return null;
  }
}

// Match stamped `{ path, line, raw }` refs (0-based lines) against a
// pre-write queue read: the keys still present, the highest pre-write rank,
// and how many were NEW. Every queued entry is due, so `count` is also the
// number of due tasks just stamped. Text matches by path and exact line
// text first (nearest line on duplicates); only with no text hit does a
// ref fall back to its path and line.
function matchFreshStampRefs(queueBefore, refs) {
  try {
    const list = Array.isArray(queueBefore) ? queueBefore : [];
    const targets = Array.isArray(refs) ? refs : [];
    const keys = [];
    let rank = 0;
    let newCount = 0;
    for (const ref of targets) {
      if (!ref || typeof ref !== "object") {
        continue;
      }
      const refPath = String(ref.path || "");
      const refLine = Math.floor(numericOrDefault(ref.line, Number.NaN));
      const refRaw = String(ref.raw || "");
      let foundIndex = -1;
      if (refPath && refRaw) {
        const hits = [];
        for (let index = 0; index < list.length; index += 1) {
          const entry = list[index];
          if (!entry || String(entry.path || "") !== refPath) {
            continue;
          }
          if (String(entry.originalMarkdown || "") !== refRaw) {
            continue;
          }
          hits.push({
            index,
            line: Number.isInteger(entry.line) ? entry.line : null,
          });
        }
        if (hits.length === 1) {
          foundIndex = hits[0].index;
        } else if (hits.length > 1) {
          const want = Number.isInteger(refLine) ? refLine + 1 : null;
          if (want === null) {
            foundIndex = hits[0].index;
          } else {
            let nearest = hits[0];
            let nearestDist =
              nearest.line === null
                ? Number.MAX_SAFE_INTEGER
                : Math.abs(nearest.line - want);
            for (const hit of hits.slice(1)) {
              const dist =
                hit.line === null
                  ? Number.MAX_SAFE_INTEGER
                  : Math.abs(hit.line - want);
              if (dist < nearestDist || (dist === nearestDist && hit.index < nearest.index)) {
                nearest = hit;
                nearestDist = dist;
              }
            }
            foundIndex = nearest.index;
          }
        }
      }
      if (foundIndex < 0 && refPath && Number.isInteger(refLine)) {
        foundIndex = list.findIndex((entry) => {
          if (!entry || String(entry.path || "") !== refPath) {
            return false;
          }
          return Number(entry.line) === refLine + 1;
        });
      }
      if (foundIndex < 0) {
        continue;
      }
      const found = list[foundIndex];
      let key = "";
      try {
        key = reviewQueueEntryKey(found);
      } catch (error) {
        continue;
      }
      keys.push(key);
      const foundRank = Number.isInteger(found.rank)
        ? found.rank
        : foundIndex + 1;
      if (foundRank > rank) {
        rank = foundRank;
      }
      if (found.state === "new") {
        newCount += 1;
      }
    }
    return Object.freeze({
      keys: Object.freeze(keys),
      rank,
      count: keys.length,
      newCount,
    });
  } catch (error) {
    return Object.freeze({
      keys: Object.freeze([]),
      rank: 0,
      count: 0,
      newCount: 0,
    });
  }
}

// The one place that computes an answer's keys. Position comes only from
// this gesture's rows (the origin row plus its matched handled refs);
// earlier answers, today's accumulator, and prior anchor keys only
// exclude rows and never move the anchor. Returns `{ positionKeys,
// excludeKeys, handled, answeredRefs }`. Never throws.
function collectReviewAnswerKeys(origin, handledRefs, stored, todayText) {
  try {
    const queueBefore =
      origin && Array.isArray(origin.queueBefore) ? origin.queueBefore : [];
    const originKey =
      origin && typeof origin.rowKey === "string" && origin.rowKey
        ? origin.rowKey
        : origin && typeof origin.key === "string"
          ? origin.key
          : "";
    const positionSet = new Set();
    if (originKey) {
      positionSet.add(originKey);
    }
    try {
      const matched = matchFreshStampRefs(queueBefore, handledRefs);
      for (const key of Array.isArray(matched.keys) ? matched.keys : []) {
        if (typeof key === "string" && key) {
          positionSet.add(key);
        }
      }
    } catch (error) {
      // The origin key alone still walks.
    }
    const positionKeys = Object.freeze(Array.from(positionSet));
    const verifyTargets = [];
    try {
      const priorKeys =
        origin && Array.isArray(origin.priorKeys) ? origin.priorKeys : [];
      const priorTexts =
        origin && origin.priorKeyTexts && typeof origin.priorKeyTexts === "object"
          ? origin.priorKeyTexts
          : {};
      for (const key of priorKeys) {
        if (typeof key !== "string" || !key) {
          continue;
        }
        const text = priorTexts[key];
        verifyTargets.push({
          key,
          text: typeof text === "string" ? text : "",
        });
      }
    } catch (error) {
      // Unverified prior keys are dropped below.
    }
    try {
      const day = typeof todayText === "string" ? todayText : "";
      if (
        stored &&
        typeof stored === "object" &&
        stored.day === day &&
        stored.keys instanceof Set
      ) {
        const texts = stored.texts instanceof Map ? stored.texts : null;
        for (const key of stored.keys) {
          if (typeof key !== "string" || !key || positionSet.has(key)) {
            continue;
          }
          let text = "";
          try {
            const recorded = texts ? texts.get(key) : undefined;
            text = typeof recorded === "string" ? recorded : "";
          } catch (error) {
            text = "";
          }
          verifyTargets.push({ key, text });
        }
      }
    } catch (error) {
      // The accumulator is advisory; verified priors still exclude.
    }
    let verified = [];
    try {
      verified = verifyReviewKeyRefs(queueBefore, verifyTargets);
    } catch (error) {
      verified = [];
    }
    const excludeSet = new Set();
    for (const key of Array.isArray(verified) ? verified : []) {
      if (typeof key === "string" && key && !positionSet.has(key)) {
        excludeSet.add(key);
      }
    }
    const excludeKeys = Object.freeze(Array.from(excludeSet));
    const handled = new Set([...positionSet, ...excludeSet]);
    const answeredRefs = [];
    try {
      const byKey = new Map();
      for (const entry of queueBefore) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        let key = "";
        try {
          key = reviewQueueEntryKey(entry);
        } catch (error) {
          continue;
        }
        if (key && !byKey.has(key)) {
          byKey.set(key, entry);
        }
      }
      for (const key of positionSet) {
        const entry = byKey.get(key);
        const text =
          entry && typeof entry.originalMarkdown === "string"
            ? entry.originalMarkdown
            : "";
        answeredRefs.push(Object.freeze({ key, text }));
      }
    } catch (error) {
      // answeredRefs stays partial; the position keys still walk.
    }
    return Object.freeze({
      positionKeys,
      excludeKeys,
      handled,
      answeredRefs: Object.freeze(answeredRefs),
    });
  } catch (error) {
    const fallback =
      origin && typeof origin.key === "string" && origin.key
        ? [origin.key]
        : [];
    return Object.freeze({
      positionKeys: Object.freeze(fallback),
      excludeKeys: Object.freeze([]),
      handled: new Set(fallback),
      answeredRefs: Object.freeze([]),
    });
  }
}
