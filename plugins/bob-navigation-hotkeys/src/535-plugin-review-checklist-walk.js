function reviewChecklistGroupScan(queue, entry, handledKeys) {
  const list = Array.isArray(queue) ? queue : [];
  const key = reviewQueueEntryKey(entry);
  const index = list.findIndex((candidate) => reviewQueueEntryKey(candidate) === key);
  if (index < 0) {
    return Object.freeze({ after: Object.freeze([]), before: Object.freeze([]) });
  }
  const tier = reviewEntryMachineTier(entry);
  const handled =
    handledKeys instanceof Set
      ? handledKeys
      : new Set(Array.isArray(handledKeys) ? handledKeys : []);
  const inGroup = (candidate) =>
    reviewEntryMachineTier(candidate) === tier &&
    !handled.has(reviewQueueEntryKey(candidate));
  return Object.freeze({
    after: Object.freeze(list.slice(index + 1).filter(inGroup)),
    before: Object.freeze(list.slice(0, index).filter(inGroup)),
  });
}

function formatReviewCtrlEnterDoneLine(taskText, tier) {
  const text = String(taskText || "").trim() || "task";
  const label = String(tier || "").toUpperCase();
  return `✓ Done · ${text} · Ctrl+Enter → next ${label}`;
}

function formatReviewChecklistGroupEndNotice(options = {}) {
  const taskText = String(options.taskText || "").trim() || "task";
  const label = String(options.tier || "").toUpperCase();
  const skipped = Number.isInteger(options.skipped)
    ? Math.max(0, options.skipped)
    : 0;
  const ending = skipped > 0 ? `end of ${label} · ${skipped} skipped` : `${label} done`;
  const lines = [`✓ Done · ${taskText} · ${ending}`];
  const nextLabel = String(options.nextLabel || "").trim();
  if (nextLabel) {
    lines.push(
      formatReviewAdvanceStopLine({
        nextLabel,
        commitments: options.commitments,
      }),
    );
  }
  return lines.join("\n");
}

function formatReviewClosedNotice(options = {}) {
  const commitments = Number.isInteger(options.commitments)
    ? Math.max(0, options.commitments)
    : 0;
  const postSkipped = Number.isInteger(options.postSkipped)
    ? Math.max(0, options.postSkipped)
    : 0;
  const rotten = Number.isInteger(options.rotten)
    ? Math.max(0, options.rotten)
    : 0;
  const prefix =
    (postSkipped > 0 ? `${postSkipped} POST still due · ` : "") +
    (commitments > 0 ? `${commitments} commitments still due · ` : "");
  return `${prefix}Review closed — ${rotten} ROTTEN left for later`;
}

class BobNavigationHotkeysChecklistWalkMixin {
  claimReviewWalkCtrlEnter(editor) {
    try {
      // While an answer is in flight or settling, the claim is swallowed
      // silently: the cycler treats the settled Promise as consumed.
      if (this.reviewWalkBusy()) {
        return Promise.resolve({ ok: false, reason: "busy" });
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
      const api = getReviewFreshnessApi(this.app);
      if (!reviewFreshnessSupportsChecklistTiers(api)) {
        return null;
      }
      if (!getReviewCyclerApi(this.app)) {
        return null;
      }
      const queue = this.readFreshnessQueue(api);
      const entry = matchReviewChecklistCursor(queue, {
        path: landing.path,
        line: cursor.line + 1,
        text: String(text),
      });
      const tier = reviewEntryMachineTier(entry);
      if (
        !entry ||
        (tier !== "pre" && tier !== "post") ||
        entry.path !== landing.path ||
        entry.originalMarkdown !== landing.text ||
        landing.tier !== tier
      ) {
        return null;
      }
      // The completion holds the gesture lock, settling afterwards.
      this.takeReviewWalkLock(REVIEW_GESTURE_LOCK_MS);
      return Promise.resolve(
        this.completeReviewChecklistRow(editor, {
          api,
          queueBefore: queue,
          entry,
          filePath: landing.path,
          dateText: todayText,
          advance: true,
          withinGroup: true,
        }),
      )
        .then((ok) => {
          this.settleReviewWalkLock(ok === true);
          return ok === true
            ? { ok: true }
            : { ok: false, reason: "not-completed" };
        })
        .catch(() => {
          this.settleReviewWalkLock(false);
          return { ok: false, reason: "not-completed" };
        });
    } catch (error) {
      return null;
    }
  }

  async filterLiveReviewEntries(entries, editor, activePath) {
    const contentByPath = new Map();
    const live = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const path = entry && typeof entry.path === "string" ? entry.path : "";
      if (!path) {
        continue;
      }
      if (!contentByPath.has(path)) {
        if (
          path === activePath &&
          editor &&
          typeof editor.getValue === "function"
        ) {
          contentByPath.set(path, String(editor.getValue() || ""));
        } else {
          const vault = this.app && this.app.vault;
          const file =
            vault && typeof vault.getAbstractFileByPath === "function"
              ? vault.getAbstractFileByPath(path)
              : null;
          contentByPath.set(
            path,
            file ? this.readLinkPickerNoteContent(path, file) : null,
          );
        }
      }
      const content = await contentByPath.get(path);
      if (content !== null && resolveReviewQueueLine(content, entry).ok) {
        live.push(entry);
      }
    }
    return live;
  }

  async completeReviewChecklistRow(cm, options = {}) {
    const api = options.api;
    const entry = options.entry;
    const queueBefore = Array.isArray(options.queueBefore) ? options.queueBefore : [];
    const filePath = options.filePath;
    const advance = options.advance === true;
    const withinGroup = options.withinGroup === true;
    const todayText =
      typeof options.dateText === "string" && options.dateText
        ? options.dateText
        : this.laneReleaseDateText({});
    const tier = reviewEntryMachineTier(entry);
    if (!reviewFreshnessSupportsChecklistTiers(api)) {
      new Notice(REVIEW_CHECKLIST_UPDATE_LEDGER_NOTICE);
      return false;
    }
    const cycler = getReviewCyclerApi(this.app);
    if (!cycler) {
      new Notice(REVIEW_CHECKLIST_UPDATE_CYCLER_NOTICE);
      return false;
    }
    const prior =
      this.reviewAnchor &&
      reviewAnchorIsCurrentDay(this.reviewAnchor, todayText) &&
      Array.isArray(this.reviewAnchor.keys)
        ? this.reviewAnchor.keys
        : [];
    const handled = new Set(prior);
    handled.add(reviewQueueEntryKey(entry));
    let nextPlan = null;
    if (advance && tier !== "post" && !withinGroup) {
      nextPlan = planReviewJump(queueBefore, {
        direction: 1,
        cursor: { path: filePath, line: entry.line, text: entry.originalMarkdown },
        anchor: buildReviewAnchor(queueBefore, Array.from(handled), entry.rank, todayText),
        todayText,
      });
    }
    let result;
    try {
      result = await cycler.completeTaskAtCursor(cm);
    } catch (error) {
      new Notice("Not completed — not-closed");
      return false;
    }
    if (!result || result.ok !== true) {
      new Notice(`Not completed — ${result && result.reason ? result.reason : "not-closed"}`);
      return false;
    }

    this.reviewLanding = null;
    this.addReviewAnsweredKeys([reviewQueueEntryKey(entry)], todayText);
    // The pre-landing cursor for the `<C-o>` jump record: the completed row.
    const jumpOrigin = {
      path: filePath,
      line: Number.isInteger(entry.line) ? entry.line - 1 : 0,
      ch: 0,
    };
    const taskText =
      entry && typeof entry.text === "string" && entry.text.trim()
        ? entry.text.trim()
        : "task";
    const groupWalk = withinGroup && tier === "pre" || tier === "post";
    let liveGroup = { after: [], before: [] };
    if (groupWalk) {
      const scan = reviewChecklistGroupScan(queueBefore, entry, handled);
      const liveEntries = await this.filterLiveReviewEntries(
        scan.after.concat(scan.before),
        cm,
        filePath,
      );
      const liveKeys = new Set(liveEntries.map((row) => reviewQueueEntryKey(row)));
      liveGroup = {
        after: scan.after.filter((row) => liveKeys.has(reviewQueueEntryKey(row))),
        before: scan.before.filter((row) => liveKeys.has(reviewQueueEntryKey(row))),
      };
    }
    if (groupWalk) {
      const liveGroupKeys = new Set(
        liveGroup.after.concat(liveGroup.before).map((row) => reviewQueueEntryKey(row)),
      );
      const scanned = reviewChecklistGroupScan(queueBefore, entry, handled);
      for (const row of scanned.after.concat(scanned.before)) {
        if (!liveGroupKeys.has(reviewQueueEntryKey(row))) {
          handled.add(reviewQueueEntryKey(row));
        }
      }
    }
    this.reviewAnchor = buildReviewAnchor(
      queueBefore,
      Array.from(handled),
      entry.rank,
      todayText,
    );
    const remaining = reviewWalkRemaining(queueBefore, handled);

    if (groupWalk && advance) {
      for (const successor of liveGroup.after) {
        let landed;
        try {
          landed = await this.landOnReviewQueueEntry(successor, {
            jumpOrigin,
          });
        } catch (error) {
          landed = { ok: false, stale: true };
        }
        if (landed && landed.ok) {
          this.reviewAnchor = buildReviewAnchor(
            queueBefore,
            [reviewQueueEntryKey(successor)],
            successor.rank,
            todayText,
          );
          const postLanding = tier === "post";
          const successorIndex = queueBefore.findIndex(
            (candidate) => reviewQueueEntryKey(candidate) === reviewQueueEntryKey(successor),
          );
          let landingNotice = buildReviewJumpNotice(
            successor,
            successorIndex >= 0 ? successorIndex + 1 : successor.rank,
            queueBefore.length,
            {
              todayText,
              trackers: reviewFreshnessSupportsTrackers(api),
              omitActionHint: withinGroup || postLanding,
              reviewEntryView:
                api && typeof api.reviewEntryView === "function"
                  ? (noticeEntry, noticeOptions) =>
                      api.reviewEntryView(noticeEntry, noticeOptions)
                  : null,
            },
          );
          if (postLanding) {
            landingNotice = appendReviewPostLandingTail(landingNotice, remaining);
          }
          const doneLine = withinGroup
            ? formatReviewCtrlEnterDoneLine(taskText, tier)
            : `✓ Done · ${taskText}`;
          new Notice([doneLine, landingNotice].filter(Boolean).join("\n"));
          return true;
        }
        if (landed && landed.stale !== true) {
          new Notice(`✓ Done · ${taskText}\nCould not jump to task`);
          return true;
        }
      }
    }

    if (withinGroup && tier === "pre") {
      const anchor = buildReviewAnchor(
        queueBefore,
        Array.from(handled),
        entry.rank,
        todayText,
      );
      const next = planReviewJump(queueBefore, {
        direction: 1,
        anchor,
        todayText,
      });
      const nextLabel =
        next && next.kind === "jump" ? reviewEntryTierLabel(next.entry) : "";
      new Notice(
        formatReviewChecklistGroupEndNotice({
          taskText,
          tier,
          skipped: liveGroup.before.length,
          nextLabel,
          commitments: remaining.commitments,
        }),
      );
      return true;
    }

    if (tier === "post") {
      if (!advance && liveGroup.after.length + liveGroup.before.length > 0) {
        const postLeft = liveGroup.after.length + liveGroup.before.length;
        new Notice(`✓ Done · ${postLeft} POST left`);
      } else {
        new Notice(
          formatReviewClosedNotice({
            commitments: remaining.commitments,
            postSkipped: liveGroup.before.length,
            rotten: remaining.rotten,
          }),
        );
      }
      return true;
    }

    if (!advance) {
      new Notice(`✓ Done · ${remaining.pre} PRE left`);
      return true;
    }
    const doneLine = `✓ Done · ${taskText}`;
    if (!nextPlan || nextPlan.kind !== "jump") {
      new Notice(doneLine);
      return true;
    }
    const landed = await this.landOnReviewQueueEntry(nextPlan.entry, {
      jumpOrigin,
    });
    if (!landed.ok) {
      new Notice(doneLine);
      return true;
    }
    this.reviewAnchor = buildReviewAnchor(
      queueBefore, [reviewQueueEntryKey(nextPlan.entry)], nextPlan.rank, todayText,
    );
    let landingNotice = buildReviewJumpNotice(
      nextPlan.entry, nextPlan.rank, nextPlan.total, {
        wrapped: nextPlan.wrapped,
        todayText,
        trackers: reviewFreshnessSupportsTrackers(api),
        reviewEntryView:
          api && typeof api.reviewEntryView === "function"
            ? (noticeEntry, noticeOptions) => api.reviewEntryView(noticeEntry, noticeOptions)
            : null,
      },
    );
    const destTier = reviewEntryMachineTier(nextPlan.entry);
    const boundary = buildReviewBoundaryNotice({
      originTier: tier, destTier,
      commitmentsLeft: remaining.commitments,
      rottenLeft: remaining.rotten, postLeft: remaining.post,
    });
    if (destTier === "post") {
      landingNotice = appendReviewPostLandingTail(landingNotice, remaining);
    }
    new Notice([doneLine, boundary, landingNotice].filter(Boolean).join("\n"));
    return true;
  }
}
