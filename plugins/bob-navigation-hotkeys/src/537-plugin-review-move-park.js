// A Ctrl+Shift+M move never advances the walk. A move that started on a
// landing consumes the landing and parks the walk on a text-identified
// resume, so the next `]s`/`[s` continues at the moved row's walk neighbour
// despite the line shift.
function reviewResumeRef(entry) {
  try {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const path = typeof entry.path === "string" ? entry.path : "";
    const text =
      typeof entry.originalMarkdown === "string" ? entry.originalMarkdown : "";
    if (!path || !text) {
      return null;
    }
    const line = Number.isInteger(entry.line) ? entry.line : null;
    return Object.freeze({
      path,
      line,
      text,
      key: reviewQueueEntryKey(entry),
    });
  } catch (error) {
    return null;
  }
}

function findReviewResumeIndex(list, ref) {
  try {
    const rows = Array.isArray(list) ? list : null;
    if (!rows || !ref || typeof ref !== "object") {
      return -1;
    }
    const refPath = typeof ref.path === "string" ? ref.path : "";
    const refText = typeof ref.text === "string" ? ref.text : "";
    if (!refPath || !refText) {
      return -1;
    }
    const refLine = Number.isInteger(ref.line) ? ref.line : null;
    const hits = [];
    for (let index = 0; index < rows.length; index += 1) {
      const entry = rows[index];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if (String(entry.path || "") !== refPath) {
        continue;
      }
      if (String(entry.originalMarkdown || "") !== refText) {
        continue;
      }
      hits.push({
        index,
        line: Number.isInteger(entry.line) ? entry.line : null,
      });
    }
    if (hits.length === 0) {
      return -1;
    }
    if (hits.length === 1) {
      return hits[0].index;
    }
    if (refLine === null) {
      return hits[0].index;
    }
    let nearest = hits[0];
    let nearestDist =
      nearest.line === null ? Number.MAX_SAFE_INTEGER : Math.abs(nearest.line - refLine);
    for (const hit of hits.slice(1)) {
      const dist =
        hit.line === null ? Number.MAX_SAFE_INTEGER : Math.abs(hit.line - refLine);
      if (dist < nearestDist || (dist === nearestDist && hit.index < nearest.index)) {
        nearest = hit;
        nearestDist = dist;
      }
    }
    return nearest.index;
  } catch (error) {
    return -1;
  }
}

function buildReviewMoveAnchor(queueBefore, handledKeys, fallbackRank, day) {
  try {
    const anchor = buildReviewAnchor(
      queueBefore,
      handledKeys,
      fallbackRank,
      day,
    );
    if (!anchor || typeof anchor !== "object") {
      return null;
    }
    const list = Array.isArray(queueBefore) ? queueBefore : [];
    const keyOf = (entry) => {
      try {
        return reviewQueueEntryKey(entry);
      } catch (error) {
        return "";
      }
    };
    let resumeNext = null;
    try {
      const afterKeys = Array.isArray(anchor.afterKeys) ? anchor.afterKeys : [];
      if (afterKeys.length > 0) {
        const found = list.find((entry) => keyOf(entry) === afterKeys[0]);
        resumeNext = found ? reviewResumeRef(found) : null;
      }
    } catch (error) {
      resumeNext = null;
    }
    let resumePrev = null;
    try {
      const beforeKeys = Array.isArray(anchor.beforeKeys) ? anchor.beforeKeys : [];
      if (beforeKeys.length > 0) {
        const found = list.find(
          (entry) => keyOf(entry) === beforeKeys[beforeKeys.length - 1],
        );
        resumePrev = found ? reviewResumeRef(found) : null;
      }
    } catch (error) {
      resumePrev = null;
    }
    return Object.freeze({
      ...anchor,
      keys: anchor.keys,
      afterKeys: anchor.afterKeys,
      beforeKeys: anchor.beforeKeys,
      resumeNext,
      resumePrev,
    });
  } catch (error) {
    return null;
  }
}

function planReviewResume(list, anchor, cursor, direction) {
  try {
    const rows = Array.isArray(list) ? list : [];
    if (!anchor || typeof anchor !== "object") {
      return Object.freeze({
        resumeRef: null,
        resumeIndex: -1,
        cursorOnResume: false,
        requireTextHit: false,
      });
    }
    const rawRef = direction < 0 ? anchor.resumePrev : anchor.resumeNext;
    const resumeRef =
      rawRef && typeof rawRef === "object" ? rawRef : null;
    if (!resumeRef) {
      return Object.freeze({
        resumeRef: null,
        resumeIndex: -1,
        cursorOnResume: false,
        requireTextHit: false,
      });
    }
    const resumeIndex = findReviewResumeIndex(rows, resumeRef);
    let cursorOnResume = false;
    try {
      if (
        resumeIndex >= 0 &&
        cursor &&
        typeof cursor === "object" &&
        String(cursor.path || "") === String(resumeRef.path || "") &&
        String(cursor.text || "") === String(resumeRef.text || "")
      ) {
        cursorOnResume = true;
      }
    } catch (error) {
      cursorOnResume = false;
    }
    return Object.freeze({
      resumeRef,
      resumeIndex,
      cursorOnResume,
      requireTextHit: true,
    });
  } catch (error) {
    return Object.freeze({
      resumeRef: null,
      resumeIndex: -1,
      cursorOnResume: false,
      requireTextHit: false,
    });
  }
}

class BobNavigationHotkeysReviewMoveMixin {
  parkReviewWalkAfterMove(origin, handledRefs) {
    try {
      const seq = Math.floor(numericOrDefault(this.reviewGestureSeq, 0));
      const epoch = Math.floor(numericOrDefault(this.reviewLandingEpoch, 0));
      let todayText = "";
      try {
        todayText = this.laneReleaseDateText({});
      } catch (error) {
        todayText = "";
      }
      const stale =
        !origin ||
        typeof origin !== "object" ||
        origin.seq !== seq ||
        origin.epoch !== epoch ||
        !this.reviewLanding ||
        this.reviewLanding.key !== origin.key ||
        todayText !== origin.day;
      if (stale) {
        try {
          if (origin && typeof origin === "object" && origin.seq === seq) {
            this.settleReviewWalkLock(false);
          }
        } catch (error) {
          // Best effort only.
        }
        return false;
      }
      this.reviewLanding = null;
      const refs = Array.isArray(handledRefs) ? handledRefs : [];
      let matchedKeys = [];
      try {
        const matched = matchFreshStampRefs(origin.queueBefore, refs);
        matchedKeys = Array.isArray(matched.keys) ? matched.keys : [];
      } catch (error) {
        matchedKeys = [];
      }
      const handled = new Set(
        [origin.key]
          .concat(Array.isArray(origin.priorKeys) ? origin.priorKeys : [])
          .concat(matchedKeys),
      );
      try {
        const stored = this.reviewAnsweredKeys;
        if (
          stored &&
          typeof stored === "object" &&
          stored.day === todayText &&
          stored.keys instanceof Set
        ) {
          for (const key of stored.keys) {
            handled.add(key);
          }
        }
      } catch (error) {
        // The accumulator is advisory; the handled set above still walks.
      }
      try {
        const before = Array.isArray(origin.queueBefore)
          ? origin.queueBefore
          : [];
        const anchor = buildReviewMoveAnchor(
          before,
          Array.from(handled),
          origin.rank,
          origin.day,
        );
        if (anchor !== null) {
          this.reviewAnchor = anchor;
        }
      } catch (error) {
        // Keep the previous anchor on a planning failure.
      }
      try {
        this.settleReviewWalkLock(false);
      } catch (error) {
        // Best effort only.
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
