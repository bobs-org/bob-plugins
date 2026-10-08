// Review-walk return to the current review task: `]s` / `[s` (and the
// same commands via Ctrl+Alt+J/K or the footer click) away from the
// current review task first land back on it.
//
// The current review task is the row the walk last landed on today. Any
// landing sets it through `setReviewLanding`; unlike the landing
// (`reviewLanding`) it survives cursor moves and opening other notes. It
// ends when a new landing replaces it, an answer on its landing resolves
// the row, a landed Ctrl+Shift+M parks the walk, a stamp or applied
// decision-card choice targets the current row itself, a walk key finds
// the queue empty, the day changes or the plugin reloads, or its row is
// no longer a live queue entry with the same note path and exact line
// text (checked lazily on the next `]s` / `[s`). A stamp or answer on
// some other row does not end it.
//
// On a relative walk key, when a live current review task exists and is
// not selected, the press lands on the current task exactly once: `[s`
// returns too, a count is consumed and ignored, there is no boundary
// preamble and no wrap, the toast is `Back to current review task` plus
// the normal landing notice, a `<C-o>` jump is recorded, and the landing
// is re-armed. The next press steps exactly as today. `[S` / `]S`
// endpoint jumps never return. Nothing here throws.
const REVIEW_RETURN_NOTICE_HEAD = "Back to current review task";

// Frozen `{ path, line, text, key, tier, day }` for the row the walk last
// landed on. `line` is the queue row's 1-based `line`, `text` is its
// `originalMarkdown`, and `tier` is `reviewEntryMachineTier(entry)`.
// Returns null when the path or text is empty. Never throws.
function reviewWalkCurrentRef(entry, path, day) {
  try {
    const ref = reviewResumeRef(entry);
    if (!ref) {
      return null;
    }
    const refPath = typeof path === "string" ? path : "";
    const text =
      entry && typeof entry.originalMarkdown === "string"
        ? entry.originalMarkdown
        : "";
    if (!refPath || !text) {
      return null;
    }
    const line = entry && Number.isInteger(entry.line) ? entry.line : null;
    let key = "";
    try {
      key = reviewQueueEntryKey(entry);
    } catch (error) {
      key = "";
    }
    let tier = null;
    try {
      tier = reviewEntryMachineTier(entry) || null;
    } catch (error) {
      tier = null;
    }
    return Object.freeze({
      path: refPath,
      line,
      text,
      key,
      tier,
      day: typeof day === "string" ? day : "",
    });
  } catch (error) {
    return null;
  }
}

// Frozen return decision over a freshly read queue. `current` is the
// stored current review task, `cursor` is `{ path, line, text }`, and
// `todayText` is `YYYY-MM-DD`. `none` means plan as today, `gone` means
// the current task ended (clear it, then plan as today), `selected`
// means the cursor is already on it (plan as today), and `return` means
// land on the live entry exactly once. Never throws.
function planReviewWalkReturn(queue, current, cursor, todayText) {
  try {
    if (!current || typeof current !== "object") {
      return Object.freeze({ kind: "none" });
    }
    const day = typeof current.day === "string" ? current.day.trim() : "";
    const today = typeof todayText === "string" ? todayText.trim() : "";
    if (day && today && day !== today) {
      return Object.freeze({ kind: "gone" });
    }
    const list = Array.isArray(queue) ? queue : [];
    let index = -1;
    try {
      index = findReviewResumeIndex(list, current);
    } catch (error) {
      return Object.freeze({ kind: "none" });
    }
    if (index < 0) {
      return Object.freeze({ kind: "gone" });
    }
    if (
      cursor &&
      typeof cursor === "object" &&
      String(cursor.path || "") === String(current.path || "") &&
      String(cursor.text || "") === String(current.text || "")
    ) {
      return Object.freeze({ kind: "selected", index });
    }
    return Object.freeze({
      kind: "return",
      entry: list[index],
      rank: index + 1,
      total: list.length,
    });
  } catch (error) {
    return Object.freeze({ kind: "none" });
  }
}

// True when any `{ path, raw }` ref names the current review task's row
// (same note path and exact pre-write line text). Never throws.
function reviewRefsTouchWalkCurrent(current, refs) {
  try {
    if (!current || typeof current !== "object") {
      return false;
    }
    const path = String(current.path || "");
    const text = String(current.text || "");
    if (!path || !text) {
      return false;
    }
    for (const ref of Array.isArray(refs) ? refs : []) {
      if (!ref || typeof ref !== "object") {
        continue;
      }
      if (
        String(ref.path || "") === path &&
        String(ref.raw || "") === text
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

class BobNavigationHotkeysReviewReturnMixin {
  clearReviewWalkCurrent() {
    try {
      this.reviewWalkCurrent = null;
    } catch (error) {
      // Best effort: the walk plans as today without it.
    }
  }

  endReviewWalkCurrentForRefs(refs) {
    try {
      if (reviewRefsTouchWalkCurrent(this.reviewWalkCurrent, refs)) {
        this.reviewWalkCurrent = null;
      }
    } catch (error) {
      // Best effort: a stale current is dropped lazily on the next key.
    }
  }

  // Land back on the live, unselected current review task exactly once.
  // Resolves `{ handled, result }`; `handled: false` means the caller
  // plans as today. A stale landing clears the current task and falls
  // through in the same press; any other landing failure keeps it.
  // Never throws.
  async returnToReviewWalkCurrent(options = {}) {
    try {
      const opts =
        options && typeof options === "object" ? options : {};
      const api = opts.api;
      const queue = Array.isArray(opts.queue) ? opts.queue : [];
      const cursor =
        opts.cursor && typeof opts.cursor === "object" ? opts.cursor : null;
      const anchor =
        opts.anchor && typeof opts.anchor === "object" ? opts.anchor : null;
      const todayText =
        typeof opts.todayText === "string" ? opts.todayText : "";
      const jumpOrigin =
        opts.jumpOrigin && typeof opts.jumpOrigin === "object"
          ? opts.jumpOrigin
          : null;
      let plan = null;
      try {
        plan = planReviewWalkReturn(
          queue,
          this.reviewWalkCurrent,
          cursor,
          todayText,
        );
      } catch (error) {
        return Object.freeze({ handled: false });
      }
      if (!plan || typeof plan !== "object") {
        return Object.freeze({ handled: false });
      }
      if (plan.kind === "gone") {
        try {
          this.reviewWalkCurrent = null;
        } catch (error) {
          // Best effort only.
        }
        return Object.freeze({ handled: false });
      }
      if (plan.kind !== "return") {
        return Object.freeze({ handled: false });
      }
      let landed = null;
      try {
        landed = await this.landOnReviewQueueEntry(plan.entry, {
          jumpOrigin,
        });
      } catch (error) {
        return Object.freeze({ handled: false });
      }
      if (landed && landed.ok) {
        try {
          this.reviewAnchor = buildReviewAnchor(
            queue,
            [reviewQueueEntryKey(plan.entry)],
            plan.rank,
            todayText,
          );
        } catch (error) {
          // The landing re-armed the walk; the anchor is best effort.
        }
        let landingNotice = "";
        try {
          landingNotice = buildReviewJumpNotice(
            plan.entry,
            plan.rank,
            plan.total,
            {
              wrapped: false,
              todayText,
              trackers: reviewFreshnessSupportsTrackers(api),
              reviewEntryView:
                api && typeof api.reviewEntryView === "function"
                  ? (noticeEntry, noticeOptions) =>
                      api.reviewEntryView(noticeEntry, noticeOptions)
                  : null,
            },
          );
        } catch (error) {
          landingNotice = "";
        }
        try {
          if (reviewEntryMachineTier(plan.entry) === "post") {
            const remaining = reviewWalkRemaining(
              queue,
              reviewVerifiedHandledKeys(queue, anchor),
            );
            landingNotice = appendReviewPostLandingTail(
              landingNotice,
              remaining,
            );
          }
        } catch (error) {
          // The return toast without the POST tail still lands.
        }
        try {
          new Notice(`${REVIEW_RETURN_NOTICE_HEAD}\n${landingNotice}`);
        } catch (error) {
          // Best effort: Obsidian is tearing down.
        }
        return Object.freeze({ handled: true, result: true });
      }
      if (landed && landed.stale === true) {
        try {
          this.reviewWalkCurrent = null;
        } catch (error) {
          // Best effort only.
        }
        return Object.freeze({ handled: false });
      }
      try {
        new Notice("Could not jump to task");
      } catch (error) {
        // Best effort: Obsidian is tearing down.
      }
      return Object.freeze({ handled: true, result: false });
    } catch (error) {
      return Object.freeze({ handled: false });
    }
  }
}
