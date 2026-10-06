// Review-walk auto-advance core: the landing-scoped capture/continue
// helper, the gesture lock, and the shared advance tail
// (`docs/freshness.md` §6).
//
// The rule: a gesture that started on the row `]s` just landed on, and that
// committed a write taking that row out of today's walk, advances the walk
// exactly once to the next remaining review item. Capture runs synchronously
// when the gesture starts (taking the gesture lock); continue runs after the
// write, plans anchor-only from the pre-write queue, records a Vim jump,
// and composes one toast. Nothing here throws: capture returns null off a
// landing (behave normally) or REVIEW_WALK_BUSY while locked (swallow the
// key, write nothing), and continue resolves `{ ok, advanced, stopped }`.

const REVIEW_GESTURE_LOCK_MS = 3000;
const REVIEW_ADVANCE_SETTLE_MS = 350;
const REVIEW_WALK_BUSY = Object.freeze({ busy: true });

// nav api v3 `reviewWalk` (`docs/task-dependencies.md` §9). Synchronous
// `capture` never throws (null off a landing, REVIEW_WALK_BUSY while
// locked, otherwise a frozen origin that took the gesture lock); async
// `continue` never throws and resolves `{ ok, advanced, stopped }`. With a
// null plugin (after unload) capture returns null and continue shows
// `outcome.notice`, if any, resolving `{ ok: false, advanced: false }`.
function createReviewWalkApi(plugin) {
  const showAlone = (outcome) => {
    try {
      const notice =
        outcome && typeof outcome === "object" && typeof outcome.notice === "string"
          ? outcome.notice
          : "";
      if (notice) {
        new Notice(notice);
      }
    } catch (error) {
      // Best effort: Obsidian is tearing down.
    }
  };
  return Object.freeze({
    version: 1,
    capture(editor) {
      try {
        if (!plugin || typeof plugin.captureReviewGesture !== "function") {
          return null;
        }
        return plugin.captureReviewGesture(editor);
      } catch (error) {
        return null;
      }
    },
    continue(origin, outcome) {
      try {
        if (!plugin || typeof plugin.continueReviewWalkAfter !== "function") {
          showAlone(outcome);
          return Promise.resolve(
            Object.freeze({ ok: false, advanced: false, stopped: false }),
          );
        }
        return Promise.resolve(
          plugin.continueReviewWalkAfter(origin, outcome),
        ).then(
          (result) =>
            result && typeof result === "object"
              ? result
              : Object.freeze({ ok: false, advanced: false, stopped: false }),
          () => Object.freeze({ ok: false, advanced: false, stopped: false }),
        );
      } catch (error) {
        showAlone(outcome);
        return Promise.resolve(
          Object.freeze({ ok: false, advanced: false, stopped: false }),
        );
      }
    },
  });
}

class BobNavigationHotkeysReviewAdvanceMixin {
  // Overridable clock so tests can expire the gesture lock and settle
  // window without sleeping.
  reviewAdvanceNow() {
    return Date.now();
  }

  // True while an answer is in flight or settling. An expired lock reads
  // free. The lock only exists during a review answer, so daytime use
  // never sees it.
  reviewWalkBusy() {
    try {
      const until = this.reviewWalkLock;
      if (until === null || until === undefined) {
        return false;
      }
      if (this.reviewAdvanceNow() >= until) {
        this.reviewWalkLock = null;
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  takeReviewWalkLock(ms) {
    try {
      const duration = Math.max(
        0,
        Math.floor(numericOrDefault(ms, REVIEW_GESTURE_LOCK_MS)),
      );
      this.reviewWalkLock = this.reviewAdvanceNow() + duration;
    } catch (error) {
      this.reviewWalkLock = null;
    }
  }

  // End the gesture lock: start the settle window when the gesture wrote,
  // otherwise free the lock immediately.
  settleReviewWalkLock(wrote) {
    try {
      if (wrote === true) {
        this.takeReviewWalkLock(REVIEW_ADVANCE_SETTLE_MS);
      } else {
        this.reviewWalkLock = null;
      }
    } catch (error) {
      this.reviewWalkLock = null;
    }
  }

  // One landing setter: every walk landing replaces the landing and bumps
  // the epoch, so a stale `continue` can never move the cursor.
  setReviewLanding(entry, path) {
    try {
      this.reviewLandingEpoch =
        Math.floor(numericOrDefault(this.reviewLandingEpoch, 0)) + 1;
    } catch (error) {
      this.reviewLandingEpoch = 1;
    }
    this.reviewLanding = Object.freeze({
      path,
      text: entry.originalMarkdown,
      key: reviewQueueEntryKey(entry),
      tier: reviewEntryMachineTier(entry) || null,
      day: this.laneReleaseDateText({}),
    });
  }

  // Accumulate today's answered keys (the accumulator resets on day
  // change). Accepts `{ key, text }` refs and plain string keys (stored
  // without text). Never throws.
  addReviewAnsweredKeys(keys, dayText) {
    try {
      const day = String(dayText || "");
      if (
        !this.reviewAnsweredKeys ||
        typeof this.reviewAnsweredKeys !== "object" ||
        this.reviewAnsweredKeys.day !== day
      ) {
        this.reviewAnsweredKeys = { day, keys: new Set(), texts: new Map() };
      }
      const set =
        this.reviewAnsweredKeys.keys instanceof Set
          ? this.reviewAnsweredKeys.keys
          : new Set();
      this.reviewAnsweredKeys.keys = set;
      const texts =
        this.reviewAnsweredKeys.texts instanceof Map
          ? this.reviewAnsweredKeys.texts
          : new Map();
      this.reviewAnsweredKeys.texts = texts;
      for (const item of Array.isArray(keys) ? keys : []) {
        if (typeof item === "string" && item) {
          set.add(item);
        } else if (item && typeof item === "object") {
          const key = typeof item.key === "string" ? item.key : "";
          if (!key) {
            continue;
          }
          set.add(key);
          const text = typeof item.text === "string" ? item.text : "";
          if (text) {
            texts.set(key, text);
          }
        }
      }
    } catch (error) {
      // Best effort: answering never depends on the accumulator.
    }
  }

  // Pre-landing cursor for the `<C-o>` jump record, or null. Read before
  // the landing moves the cursor.
  getReviewWalkOriginCursor() {
    try {
      const view = this.getActiveMarkdownView();
      if (
        !view ||
        !view.file ||
        typeof view.file.path !== "string" ||
        !view.editor ||
        typeof view.editor.getCursor !== "function"
      ) {
        return null;
      }
      const cursor = normalizePosition(view.editor.getCursor());
      if (!cursor) {
        return null;
      }
      return { path: view.file.path, line: cursor.line, ch: cursor.ch };
    } catch (error) {
      return null;
    }
  }

  // Synchronous landing check when a gesture starts. Null means "not on a
  // landing, behave normally"; REVIEW_WALK_BUSY means "swallow the key,
  // write nothing"; otherwise the frozen origin, which took the gesture
  // lock and must be settled exactly once via continueReviewWalkAfter.
  captureReviewGesture(editor) {
    try {
      if (this.reviewWalkBusy()) {
        return REVIEW_WALK_BUSY;
      }
      const landing = this.reviewLanding;
      if (!landing) {
        return null;
      }
      const todayText = this.laneReleaseDateText({});
      if (landing.day !== todayText) {
        return null;
      }
      const view = this.getActiveMarkdownView();
      if (
        !view ||
        !view.file ||
        !view.editor ||
        view.editor !== editor ||
        view.file.path !== landing.path
      ) {
        return null;
      }
      const cursor = getEditorCursor(editor);
      const text = cursor ? getEditorLine(editor, cursor.line) : null;
      if (text === null || String(text) !== landing.text) {
        return null;
      }
      const queueBefore = this.readFreshnessQueue(
        getReviewFreshnessApi(this.app),
      );
      let found = null;
      try {
        const textIndex = findReviewResumeIndex(queueBefore, {
          path: landing.path,
          text: landing.text,
          line: cursor.line + 1,
        });
        if (textIndex >= 0) {
          found = queueBefore[textIndex];
        }
      } catch (error) {
        found = null;
      }
      if (!found) {
        found = queueBefore.find(
          (candidate) => {
            try {
              return reviewQueueEntryKey(candidate) === landing.key;
            } catch (error) {
              return false;
            }
          },
        );
      }
      if (!found) {
        return null;
      }
      this.reviewGestureSeq =
        Math.floor(numericOrDefault(this.reviewGestureSeq, 0)) + 1;
      this.takeReviewWalkLock(REVIEW_GESTURE_LOCK_MS);
      const anchor = this.reviewAnchor;
      const priorKeys =
        anchor &&
        reviewAnchorIsCurrentDay(anchor, todayText) &&
        Array.isArray(anchor.keys)
          ? anchor.keys.slice()
          : [];
      const priorKeyTexts =
        anchor &&
        reviewAnchorIsCurrentDay(anchor, todayText) &&
        anchor.keyTexts &&
        typeof anchor.keyTexts === "object"
          ? Object.freeze({ ...anchor.keyTexts })
          : Object.freeze({});
      const taskText =
        found && typeof found.text === "string" && found.text.trim()
          ? found.text.trim()
          : "task";
      let rowKey = landing.key;
      try {
        rowKey = reviewQueueEntryKey(found);
      } catch (error) {
        rowKey = landing.key;
      }
      return Object.freeze({
        seq: this.reviewGestureSeq,
        epoch: Math.floor(numericOrDefault(this.reviewLandingEpoch, 0)),
        day: todayText,
        path: landing.path,
        line: cursor.line,
        text: landing.text,
        key: landing.key,
        rowKey,
        tier: landing.tier || null,
        taskText,
        rank: Number.isInteger(found.rank) ? found.rank : null,
        queueBefore: Object.freeze(
          queueBefore.map((row) => Object.freeze({ ...(row || {}) })),
        ),
        priorKeys: Object.freeze(priorKeys),
        priorKeyTexts,
      });
    } catch (error) {
      return null;
    }
  }

  // After the gesture's write: refuse stale origins, stay on
  // non-resolving outcomes, and otherwise consume the landing and advance
  // exactly once through the shared tail. Never throws. `outcome.notice`
  // is shown exactly once: composed into the landing toast, or on its own.
  async continueReviewWalkAfter(origin, outcome) {
    let notice = "";
    let shown = false;
    const showNotice = (text) => {
      if (shown) {
        return;
      }
      const message = String(text || "");
      if (!message) {
        return;
      }
      shown = true;
      try {
        new Notice(message);
      } catch (error) {
        // Best effort: Obsidian is tearing down.
      }
    };
    try {
      // Yield one macrotask before doing anything, so a modal submit has
      // closed and focus has returned before the state is read.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const input = outcome && typeof outcome === "object" ? outcome : null;
      if (input && typeof input.notice === "string" && input.notice) {
        notice = input.notice;
      }
      const seq = Math.floor(numericOrDefault(this.reviewGestureSeq, 0));
      const epoch = Math.floor(numericOrDefault(this.reviewLandingEpoch, 0));
      const todayText = this.laneReleaseDateText({});
      const stale =
        !origin ||
        typeof origin !== "object" ||
        origin.seq !== seq ||
        origin.epoch !== epoch ||
        !this.reviewLanding ||
        this.reviewLanding.key !== origin.key ||
        todayText !== origin.day;
      if (stale) {
        showNotice(notice);
        // Settle only our own lock: a stale origin means a newer gesture
        // or landing owns it now.
        if (origin && typeof origin === "object" && origin.seq === seq) {
          this.settleReviewWalkLock(false);
        }
        return Object.freeze({ ok: true, advanced: false, stopped: false });
      }
      const kind = input ? String(input.kind || "") : "";
      const tier = typeof origin.tier === "string" ? origin.tier : "";
      // A checklist completion that reaches continue (the claim declined
      // on mixed versions) stays: the claim owns checklist rows.
      const resolves =
        kind === "complete" && (tier === "pre" || tier === "post")
          ? false
          : reviewOutcomeResolves(tier, input, todayText);
      if (!resolves) {
        showNotice(notice);
        this.settleReviewWalkLock(false);
        return Object.freeze({ ok: true, advanced: false, stopped: false });
      }
      // Consume synchronously: the landing is gone and the walk anchor
      // covers the answered row before any await can interleave.
      this.reviewLanding = null;
      const handledRefs =
        input && Array.isArray(input.handledRefs) ? input.handledRefs : [];
      const answerKeys = collectReviewAnswerKeys(
        origin,
        handledRefs,
        this.reviewAnsweredKeys,
        todayText,
      );
      const positionKeys = Array.isArray(answerKeys.positionKeys)
        ? answerKeys.positionKeys
        : [];
      const excludeKeys = Array.isArray(answerKeys.excludeKeys)
        ? answerKeys.excludeKeys
        : [];
      const handled =
        answerKeys.handled instanceof Set
          ? answerKeys.handled
          : new Set(positionKeys.concat(excludeKeys));
      this.addReviewAnsweredKeys(
        Array.isArray(answerKeys.answeredRefs) ? answerKeys.answeredRefs : [],
        todayText,
      );
      const before = Array.isArray(origin.queueBefore) ? origin.queueBefore : [];
      const originRowKey =
        typeof origin.rowKey === "string" && origin.rowKey
          ? origin.rowKey
          : origin.key;
      const landedEntry = before.find(
        (row) => {
          try {
            return reviewQueueEntryKey(row) === originRowKey;
          } catch (error) {
            return false;
          }
        },
      );
      const entryRank = Number.isInteger(origin.rank)
        ? origin.rank
        : Number.isInteger(landedEntry && landedEntry.rank)
          ? landedEntry.rank
          : 1;
      const anchor = buildReviewAnchor(
        before,
        positionKeys,
        entryRank,
        todayText,
        { excludeKeys },
      );
      this.reviewAnchor = anchor;
      const remaining = reviewWalkRemaining(before, handled);
      const preamble =
        notice || (kind === "complete" ? `✓ Done · ${origin.taskText || "task"}` : "");
      const tailed = await this.advanceReviewWalkAfterAnswer({
        anchor,
        preamble,
        originTier: tier || null,
        stopBeforeChecklist: kind === "complete",
        closeOnPostWrap: tier === "post",
        remaining,
      });
      return Object.freeze({
        ok: true,
        advanced: tailed.advanced === true,
        stopped: tailed.stopped === true,
      });
    } catch (error) {
      showNotice(notice);
      return Object.freeze({ ok: false, advanced: false, stopped: false });
    }
  }

  // One composed toast from the preamble and the tail lines.
  composeReviewAdvanceNotice(preamble, ...parts) {
    return [preamble].concat(parts).filter(Boolean).join("\n");
  }

  // The advance gates for one plan: the Ctrl+Enter checklist-boundary stop
  // and the POST no-wrap close. Returns the stop notice, or null to land.
  checkReviewAdvanceStop(plan, settings, remaining) {
    const entry = plan && plan.entry ? plan.entry : null;
    if (
      settings.stopBeforeChecklist === true &&
      reviewIsChecklistTier(reviewEntryMachineTier(entry))
    ) {
      return formatReviewAdvanceStopLine({
        nextLabel: reviewEntryTierLabel(entry),
        commitments: remaining.commitments,
      });
    }
    if (settings.closeOnPostWrap === true && plan.wrapped === true) {
      return formatReviewClosedNotice({
        commitments: remaining.commitments,
        postSkipped: remaining.post,
        rotten: remaining.rotten,
      });
    }
    return null;
  }

  // Shared advance tail. Plans anchor-only from the pre-write queue (never
  // from the post-write cursor, which can sit on a different due row after
  // a move or a line-shifting write), holds the in-flight lock, records
  // the Vim jump at landing, and shows one composed toast. Resolves
  // `{ advanced, stopped }`; `jumpToDueTask` narrows that to a boolean.
  async advanceReviewWalkAfterAnswer(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    this.takeReviewWalkLock(REVIEW_GESTURE_LOCK_MS);
    try {
      const preamble =
        typeof settings.preamble === "string" && settings.preamble
          ? settings.preamble
          : "";
      const api = getReviewFreshnessApi(this.app);
      if (!api) {
        new Notice(preamble || REVIEW_FRESHNESS_API_REQUIRED_NOTICE);
        return { advanced: false, stopped: false };
      }
      const todayText = this.laneReleaseDateText({});
      const anchor =
        settings.anchor && typeof settings.anchor === "object"
          ? settings.anchor
          : settings.fromStamp && typeof settings.fromStamp === "object"
            ? settings.fromStamp
            : null;
      let queue = this.readFreshnessQueue(api);
      const counts = this.readFreshnessCounts(api);
      if (queue.length === 0) {
        this.reviewLanding = null;
        new Notice(
          this.composeReviewAdvanceNotice(preamble, buildReviewEmptyNotice(counts)),
        );
        return { advanced: false, stopped: false };
      }
      const planOnce = (walkQueue) =>
        planReviewJump(walkQueue, {
          direction: 1,
          cursor: null,
          anchor,
          todayText,
        });
      let plan = planOnce(queue);
      if (plan.kind === "empty") {
        this.reviewLanding = null;
        new Notice(
          this.composeReviewAdvanceNotice(preamble, buildReviewEmptyNotice(counts)),
        );
        return { advanced: false, stopped: false };
      }
      const remaining =
        settings.remaining && typeof settings.remaining === "object"
          ? settings.remaining
          : reviewWalkRemaining(
              queue,
              anchor && Array.isArray(anchor.keys) ? anchor.keys : [],
            );
      const stopped = this.checkReviewAdvanceStop(plan, settings, remaining);
      if (stopped !== null) {
        new Notice(this.composeReviewAdvanceNotice(preamble, stopped));
        return { advanced: false, stopped: true };
      }
      let landed = await this.landOnReviewQueueEntry(plan.entry, {
        jumpOrigin: this.getReviewWalkOriginCursor(),
      });
      if (!landed.ok && landed.stale) {
        queue = this.readFreshnessQueue(api);
        plan = planOnce(queue);
        if (plan.kind === "empty") {
          this.reviewLanding = null;
          const emptyNotice = buildReviewEmptyNotice(counts);
          new Notice(this.composeReviewAdvanceNotice(preamble, emptyNotice));
          return { advanced: false, stopped: false };
        }
        const restopped = this.checkReviewAdvanceStop(plan, settings, remaining);
        if (restopped !== null) {
          new Notice(this.composeReviewAdvanceNotice(preamble, restopped));
          return { advanced: false, stopped: true };
        }
        landed = await this.landOnReviewQueueEntry(plan.entry, {
          jumpOrigin: this.getReviewWalkOriginCursor(),
        });
      }
      if (!landed.ok) {
        new Notice(
          this.composeReviewAdvanceNotice(
            preamble,
            landed.stale
              ? REVIEW_QUEUE_CHANGED_NOTICE
              : "Could not jump to task",
          ),
        );
        return { advanced: false, stopped: false };
      }
      // The walk anchor follows every successful landing, so a later
      // gesture continues from here.
      this.reviewAnchor = buildReviewAnchor(
        queue,
        [reviewQueueEntryKey(plan.entry)],
        plan.rank,
        todayText,
      );
      let landingNotice = buildReviewJumpNotice(
        plan.entry,
        plan.rank,
        plan.total,
        {
          wrapped: plan.wrapped,
          todayText,
          trackers: reviewFreshnessSupportsTrackers(api),
          reviewEntryView:
            api && typeof api.reviewEntryView === "function"
              ? (noticeEntry, noticeOptions) =>
                  api.reviewEntryView(noticeEntry, noticeOptions)
              : null,
        },
      );
      const destTier = reviewEntryMachineTier(plan.entry);
      const originTier =
        typeof settings.originTier === "string" && settings.originTier
          ? settings.originTier
          : plan && typeof plan.originTier === "string"
            ? plan.originTier
            : null;
      const boundary = buildReviewBoundaryNotice({
        originTier,
        destTier,
        commitmentsLeft: remaining.commitments,
        rottenLeft: remaining.rotten,
        postLeft: remaining.post,
      });
      if (destTier === "post") {
        landingNotice = appendReviewPostLandingTail(landingNotice, remaining);
      }
      new Notice(
        this.composeReviewAdvanceNotice(preamble, boundary, landingNotice),
      );
      return { advanced: true, stopped: false };
    } finally {
      this.settleReviewWalkLock(true);
    }
  }

  // Land on one queue entry without writing: resolve its line in the target
  // note, then put the cursor there and center it. Same-note landings write
  // the cursor directly; cross-note landings reuse the leaf-reuse open plus
  // the shared jump-or-defer retry so the cursor lands after the new leaf
  // renders. Returns `{ ok, stale }`; `stale` means the queue moved and the
  // caller should rebuild once and try again. `options.jumpOrigin` is the
  // pre-landing cursor: every walk landing records a Vim jump from it to
  // the landed row, so `<C-o>` returns to the answered row. Recording never
  // blocks the landing.
  async landOnReviewQueueEntry(entry, options = {}) {
    const jumpOrigin =
      options && typeof options === "object" ? options.jumpOrigin : null;
    const path = entry && typeof entry.path === "string" ? entry.path : "";
    if (!path) {
      return { ok: false, stale: true };
    }
    const activeView = this.getActiveMarkdownView();
    const activeEditor = activeView && activeView.editor;
    const sameNote = Boolean(
      activeView &&
        activeView.file &&
        activeView.file.path === path &&
        activeEditor &&
        typeof activeEditor.getValue === "function",
    );
    let content = null;
    let file =
      activeView && activeView.file && activeView.file.path === path
        ? activeView.file
        : null;
    if (sameNote) {
      content = String(activeEditor.getValue() || "");
    } else {
      const vault = this.app && this.app.vault;
      file =
        file ||
        (vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(path)
          : null);
      if (!file) {
        return { ok: false, stale: true };
      }
      content = await this.readLinkPickerNoteContent(path, file);
      if (content === null) {
        return { ok: false, stale: true };
      }
    }
    const resolved = resolveReviewQueueLine(content, entry);
    if (!resolved.ok) {
      return { ok: false, stale: true };
    }
    if (sameNote) {
      if (!setEditorCursor(activeEditor, { line: resolved.line, ch: 0 })) {
        return { ok: false, stale: false };
      }
      scheduleOpenTaskJumpCenter(this, activeEditor, resolved.line, 0);
      if (jumpOrigin) {
        try {
          const jumpContext =
            this.createVimJumpContextWithOrigin(jumpOrigin);
          if (jumpContext) {
            const settled = this.enqueueVimJumpContextTransition(
              jumpContext,
              { path, line: resolved.line, ch: 0 },
              { expectedPath: path },
            );
            if (settled && typeof settled.catch === "function") {
              settled.catch(() => false);
            }
          }
        } catch (error) {
          // Jump history is best-effort after a successful landing.
        }
      }
      this.setReviewLanding(entry, path);
      return { ok: true, stale: false };
    }
    const opened = await openMarkdownFileWithLeafReuse(
      this,
      file,
      `Review jump, but could not open ${path}`,
    );
    if (!opened) {
      return { ok: false, stale: false };
    }
    if (jumpOrigin) {
      let jumpContext = null;
      try {
        jumpContext = this.createVimJumpContextWithOrigin(jumpOrigin);
      } catch (error) {
        jumpContext = null;
      }
      if (jumpContext) {
        const completion = {
          token: jumpContext.token,
          resolve: (result) => {
            try {
              if (result && result.ok && result.destination) {
                const settled = this.enqueueVimJumpContextTransition(
                  jumpContext,
                  result.destination,
                  { expectedPath: path },
                );
                if (settled && typeof settled.catch === "function") {
                  settled.catch(() => false);
                }
              }
            } catch (error) {
              // Jump history is best-effort after a successful landing.
            }
          },
        };
        this.jumpOrDeferTaskMoveDestination(
          path,
          { line: resolved.line, text: entry.originalMarkdown },
          TASK_MOVE_DESTINATION_JUMP_RETRIES,
          completion,
        );
      } else {
        this.jumpOrDeferTaskMoveDestination(path, {
          line: resolved.line,
          text: entry.originalMarkdown,
        });
      }
    } else {
      this.jumpOrDeferTaskMoveDestination(path, {
        line: resolved.line,
        text: entry.originalMarkdown,
      });
    }
    this.setReviewLanding(entry, path);
    return { ok: true, stale: false };
  }

  // Capture a Vim count for `]s` / `[s` before any await. An explicit
  // `options.repeat` is the whole count and skips Vim. Endpoint jumps
  // ignore a pending prefix. Otherwise a Vim-normal editor with an
  // explicit prefix is N queue steps; reset that state immediately so
  // CodeMirror cannot drop it across the landing await.
  consumePendingReviewJumpRepeat(options, endpoint) {
    if (options && options.repeat !== undefined && options.repeat !== null) {
      return normalizeVimRepeat(options.repeat);
    }
    if (endpoint) {
      return 1;
    }
    try {
      const view = this.getActiveMarkdownView();
      const editor = view && view.editor;
      if (!editor || !this.isVimNormalModeEditor(editor, view)) {
        return 1;
      }
      const cm = this.resolveVimCodeMirror(editor, view);
      const pending = getPendingVimRepeat(cm);
      if (!pending.explicit) {
        return 1;
      }
      resetPendingVimInputState(cm, "counted-review-jump");
      return normalizeVimRepeat(pending.repeat);
    } catch {
      return 1;
    }
  }

  // Vault-wide jump to the next (direction +1) or previous (direction -1)
  // task due for freshness review. From a queued task go to the following
  // (or preceding) entry; from a just-stamped task go to the entry after
  // its remembered rank tuple; otherwise go to the first (or last) entry.
  // Wraps with a Notice; an empty queue shows the refreshed-today count.
  // With `options.endpoint` ("first"/"last") jump to that queue endpoint
  // instead, ignoring cursor, anchor, and a typed count, without a
  // boundary preamble. A Vim count on a relative jump is N queue steps
  // in one landing.
  async jumpToDueTask(direction, options = {}) {
    // While an answer is in flight or settling, every external walk key
    // (`]s` `[s` `]S` `[S` Ctrl+Alt+J/K) is swallowed silently with no
    // write. The shared advance tail sets `fromAdvance` to bypass this.
    const fromAdvance = options && options.fromAdvance === true;
    if (!fromAdvance && this.reviewWalkBusy()) {
      return false;
    }
    // The shared advance tail: anchor-only planning, the in-flight lock,
    // jump recording, and one composed toast. Ctrl+Alt+F and the decay
    // card advance through here with their preamble.
    if (fromAdvance) {
      const tailed = await this.advanceReviewWalkAfterAnswer(options);
      return tailed.advanced === true;
    }
    const api = this.requireFreshnessApi();
    if (!api) {
      return false;
    }
    const step = direction < 0 ? -1 : 1;
    const endpointRaw =
      options && typeof options.endpoint === "string"
        ? options.endpoint.trim().toLowerCase()
        : "";
    const endpoint =
      endpointRaw === "first" || endpointRaw === "last" ? endpointRaw : null;
    const repeat = this.consumePendingReviewJumpRepeat(options, endpoint);
    const jumpOrigin = this.getReviewWalkOriginCursor();
    let queue = this.readFreshnessQueue(api);
    if (queue.length === 0) {
      this.reviewLanding = null;
      new Notice(buildReviewEmptyNotice(this.readFreshnessCounts(api)));
      return false;
    }
    const cursor = this.getReviewJumpCursor();
    const todayText = this.laneReleaseDateText({});
    let anchor =
      options.fromStamp !== undefined
        ? options.fromStamp
        : this.reviewAnchor || null;
    if (anchor && !reviewAnchorIsCurrentDay(anchor, todayText)) {
      anchor = null;
    }
    let plan = planReviewJump(queue, {
      direction: step,
      cursor,
      stamped: anchor,
      anchor,
      todayText,
      endpoint,
      repeat,
    });
    if (plan.kind === "empty") {
      this.reviewLanding = null;
      new Notice(buildReviewEmptyNotice(this.readFreshnessCounts(api)));
      return false;
    }
    let landed = await this.landOnReviewQueueEntry(plan.entry, { jumpOrigin });
    if (!landed.ok && landed.stale) {
      queue = this.readFreshnessQueue(api);
      plan = planReviewJump(queue, {
        direction: step,
        cursor,
        stamped: anchor,
        anchor,
        todayText,
        endpoint,
        repeat,
      });
      if (plan.kind === "empty") {
        this.reviewLanding = null;
        new Notice(buildReviewEmptyNotice(this.readFreshnessCounts(api)));
        return false;
      }
      landed = await this.landOnReviewQueueEntry(plan.entry, { jumpOrigin });
    }
    if (!landed.ok) {
      new Notice(
        landed.stale ? REVIEW_QUEUE_CHANGED_NOTICE : "Could not jump to task",
      );
      return false;
    }
    // The walk anchor follows every successful landing, so a later
    // release, roll, or stamp continues from here.
    this.reviewAnchor = buildReviewAnchor(
      queue,
      [reviewQueueEntryKey(plan.entry)],
      plan.rank,
      todayText,
    );
    let notice = buildReviewJumpNotice(plan.entry, plan.rank, plan.total, {
      wrapped: plan.wrapped,
      todayText,
      trackers: reviewFreshnessSupportsTrackers(api),
      reviewEntryView:
        api && typeof api.reviewEntryView === "function"
          ? (noticeEntry, noticeOptions) =>
              api.reviewEntryView(noticeEntry, noticeOptions)
          : null,
    });
    const destTier = reviewEntryMachineTier(plan.entry);
    const handled = reviewVerifiedHandledKeys(queue, anchor);
    const remaining = reviewWalkRemaining(queue, handled);
    // A forward step out of the commitments into ROTTEN or POST names
    // the boundary (v4 tier entries only; v3 keeps the plain jump
    // notice). Endpoint jumps never carry the relative-walk boundary
    // preamble. Landing on POST always appends remaining counts.
    if (!endpoint && step > 0 && reviewFreshnessSupportsTiers(api)) {
      const boundary = buildReviewBoundaryNotice({
        originTier:
          plan && typeof plan.originTier === "string" ? plan.originTier : null,
        destTier,
        commitmentsLeft: remaining.commitments,
        rottenLeft: remaining.rotten,
        postLeft: remaining.post,
      });
      if (boundary) {
        notice = `${boundary}\n${notice}`;
      }
    }
    if (destTier === "post") {
      notice = appendReviewPostLandingTail(notice, remaining);
    }
    new Notice(notice);
    return true;
  }
}
