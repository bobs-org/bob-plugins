// reviewWalk v2 follow: a pinned close parks the walk, then lands on the
// jump target. Parking runs before focus because opening another note
// would clear the `]s` landing. Without `outcome.follow`, continue stays
// on the v1 path byte for byte.
class BobNavigationHotkeysReviewWalkFollowMixin {
  async followReviewWalkAfter(origin, outcome, options = {}) {
    const input = outcome && typeof outcome === "object" ? outcome : {};
    const follow =
      input.follow && typeof input.follow === "object" ? input.follow : null;
    const notice = [input.notice, input.successorNotice]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim())
      .join("\n");
    const label = taskLandingTargetLabel(follow);
    const jumpLine = formatSuccessorJumpReceipt(label);
    const lostLine = formatSuccessorJumpLostNotice(label);
    const show = (text) => {
      const message = String(text || "");
      if (!message) {
        return;
      }
      try {
        new Notice(message);
      } catch (_error) {
        // Best effort: Obsidian is tearing down.
      }
    };
    const compose = (...parts) => parts.filter(Boolean).join("\n");

    const seq = Math.floor(numericOrDefault(this.reviewGestureSeq, 0));
    const epoch = Math.floor(numericOrDefault(this.reviewLandingEpoch, 0));
    let todayText = "";
    try {
      todayText = this.laneReleaseDateText({});
    } catch (_error) {
      todayText = "";
    }
    const offLanding =
      origin && typeof origin === "object" && origin.offLanding === true;
    const stale =
      !origin ||
      typeof origin !== "object" ||
      origin.seq !== seq ||
      origin.epoch !== epoch ||
      (!offLanding &&
        (!this.reviewLanding || this.reviewLanding.key !== origin.key)) ||
      todayText !== origin.day;

    let vimJumpContext = null;
    try {
      if (origin && typeof origin === "object" && Number.isInteger(origin.line)) {
        vimJumpContext = this.createVimJumpContextWithOrigin({
          path: origin.path,
          line: origin.line,
          ch: 0,
        });
      }
    } catch (_error) {
      vimJumpContext = null;
    }

    const land = async () => {
      if (!follow || typeof this.landOnTask !== "function") {
        return { ok: false, reason: "lost" };
      }
      try {
        return await this.landOnTask(follow, {
          vimJumpContext,
          silent: true,
        });
      } catch (_error) {
        return { ok: false, reason: "lost" };
      }
    };

    const settleOwnLock = () => {
      try {
        if (origin && typeof origin === "object" && origin.seq === seq) {
          this.settleReviewWalkLock(false);
        }
      } catch (_error) {
        // Best effort only.
      }
    };

    if (stale || offLanding) {
      const landed = await land();
      settleOwnLock();
      show(compose(notice, landed && landed.ok ? jumpLine : lostLine));
      return Object.freeze({
        ok: true,
        advanced: false,
        parked: false,
        landed: Boolean(landed && landed.ok),
      });
    }

    // The checklist claim owns PRE/POST completion and has already recorded
    // its answer. Only that internal caller may bypass continue's mixed-version
    // complete guard; public reviewWalk.continue keeps the v1 resolve rules.
    const answeredChecklist = options.answeredChecklist === true &&
      input.kind === "complete" && (origin.tier === "pre" || origin.tier === "post");
    if (!answeredChecklist && !reviewWalkOutcomeResolves(origin, input, todayText)) {
      const landed = await land();
      settleOwnLock();
      show(compose(notice, landed && landed.ok ? jumpLine : lostLine));
      return Object.freeze({
        ok: true,
        advanced: false,
        parked: false,
        landed: Boolean(landed && landed.ok),
      });
    }

    try {
      this.takeReviewWalkLock(REVIEW_GESTURE_LOCK_MS);
    } catch (_error) {
      // Keep whatever lock capture already took.
    }
    if (!answeredChecklist) {
      reviewWalkRecordAnswer(this, origin, input, todayText);
    }
    const handledRefs = Array.isArray(input.handledRefs) ? input.handledRefs : [];
    let parked = false;
    try {
      parked =
        this.parkReviewWalkAfterMove(origin, handledRefs, {
          excludeRefs: Array.isArray(input.excludeRefs) ? input.excludeRefs : [],
          settle: false,
        }) === true;
    } catch (_error) {
      parked = false;
    }
    const landed = await land();
    show(compose(notice, landed && landed.ok ? jumpLine : lostLine));
    try {
      this.settleReviewWalkLock(false);
    } catch (_error) {
      // Best effort only.
    }
    return Object.freeze({
      ok: true,
      advanced: false,
      parked,
      landed: Boolean(landed && landed.ok),
    });
  }
}
