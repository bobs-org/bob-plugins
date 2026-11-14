// Bank-walk runtime: `]b` / `[b` step rows and `]B` / `[B` jump days.
// The ledger owns membership and planning; navigation only lands and records
// the session anchor. This path never writes the vault or starts bob.
const BANK_WALK_REQUIRED_API_VERSION = 1;
const BANK_WALK_API_REQUIRED_NOTICE = "Bob Ledger Tools bank walk api required";
const BANK_WALK_INDEXING_NOTICE = "Bank walk unavailable — still indexing";
const BANK_WALK_EMPTY_NOTICE = "No bank rows — bob bank import";
const BANK_WALK_STALE_NOTICE = "Bank rows changed — try again";
const BANK_WALK_JUMP_FAILURE_NOTICE = "Could not jump to bank row";

function getBankWalkApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const owner = plugins && plugins["bob-ledger-tools"];
    const api = owner && owner.api;
    const bankWalk = api && api.bankWalk;
    if (!bankWalk || typeof bankWalk !== "object") {
      return null;
    }
    if (
      !Number.isInteger(bankWalk.version) ||
      bankWalk.version < BANK_WALK_REQUIRED_API_VERSION ||
      typeof bankWalk.snapshot !== "function" ||
      typeof bankWalk.plan !== "function" ||
      typeof bankWalk.resolve !== "function" ||
      typeof bankWalk.anchor !== "function" ||
      typeof bankWalk.setAnchor !== "function"
    ) {
      return null;
    }
    return bankWalk;
  } catch (_error) {
    return null;
  }
}

function bankWalkSnapshot(api) {
  try {
    const snapshot = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    return snapshot && typeof snapshot === "object" ? snapshot : null;
  } catch (_error) {
    return null;
  }
}

function bankWalkScope(snapshot) {
  return snapshot && snapshot.scope === "all" ? "all" : "waiting";
}

class BobNavigationHotkeysBankWalkMixin {
  consumePendingBankWalkRepeat(options) {
    if (options && options.repeat !== undefined && options.repeat !== null) {
      return normalizeVimRepeat(options.repeat);
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
      resetPendingVimInputState(cm, "counted-bank-walk");
      return normalizeVimRepeat(pending.repeat);
    } catch (_error) {
      return 1;
    }
  }

  bankWalkCursor() {
    try {
      const cursor = this.getReviewJumpCursor();
      if (!cursor || typeof cursor.path !== "string" || !Number.isInteger(cursor.line)) {
        return null;
      }
      return { path: cursor.path, line0: Math.max(0, cursor.line - 1) };
    } catch (_error) {
      return null;
    }
  }

  bankWalkIsBusy(api) {
    try {
      return Boolean(this.reviewWalkBusy()) || Boolean(api && typeof api.busy === "function" && api.busy());
    } catch (_error) {
      return true;
    }
  }

  bankWalkObserveScope(scope) {
    const normalized = scope === "all" ? "all" : "waiting";
    const previous = this.lastBankWalkScope;
    this.lastBankWalkScope = normalized;
    if (!previous || previous === normalized) {
      return;
    }
    try {
      new Notice(normalized === "all"
        ? "Nothing waiting — ]b now walks every row"
        : "Bank rows waiting — ]b now walks the queue");
    } catch (_error) {
      // Scope feedback never blocks navigation.
    }
  }

  bankWalkUnavailable(snapshot) {
    if (!snapshot || snapshot.available === false) {
      try {
        new Notice(BANK_WALK_INDEXING_NOTICE);
      } catch (_error) {}
      return true;
    }
    return false;
  }

  bankWalkPlan(api, snapshot, options) {
    try {
      return api.plan(snapshot, options);
    } catch (_error) {
      return null;
    }
  }

  async landBankWalkPlan(api, plan, jumpOrigin) {
    const entry = plan && plan.entry;
    if (!entry || typeof entry.path !== "string") {
      return { ok: false, stale: true };
    }
    const resolveLine = (content) => {
      try {
        const result = api.resolve({ path: entry.path, content, entry });
        if (!result || result.ok !== true || !Number.isInteger(result.line0)) {
          return { ok: false };
        }
        return { ok: true, line: result.line0, ch: result.ch };
      } catch (_error) {
        return { ok: false };
      }
    };
    let landed = null;
    try {
      landed = await this.landOnWalkEntry(entry, { jumpOrigin, resolveLine });
    } catch (_error) {
      return { ok: false, stale: false };
    }
    if (!landed || landed.ok !== true) {
      return landed || { ok: false, stale: false };
    }
    if (landed.settled && typeof landed.settled.then === "function") {
      let settled = false;
      try {
        settled = await landed.settled;
      } catch (_error) {
        settled = false;
      }
      if (!settled) {
        return { ok: false, stale: true };
      }
    }
    return { ok: true, stale: false };
  }

  async jumpToBankRow(direction, options = {}) {
    try {
      if (this.reviewWalkBusy()) {
        return false;
      }
    } catch (_error) {
      return false;
    }
    const api = getBankWalkApi(this.app);
    if (!api) {
      new Notice(BANK_WALK_API_REQUIRED_NOTICE);
      return false;
    }
    if (this.bankWalkIsBusy(api)) {
      return false;
    }
    const repeat = this.consumePendingBankWalkRepeat(options);
    const jumpOrigin = this.getReviewWalkOriginCursor();
    const cursor = this.bankWalkCursor();
    let anchor = null;
    try {
      anchor = api.anchor();
    } catch (_error) {
      anchor = null;
    }
    const request = {
      direction: direction < 0 ? -1 : 1,
      dayJump: Boolean(options && options.dayJump === true),
      repeat,
      cursor,
      anchor,
    };
    const snapshotAtPress = bankWalkSnapshot(api);
    const capturedScope = bankWalkScope(snapshotAtPress);
    const queued = (this.bankWalkPendingCount || 0) > 0;
    this.bankWalkPendingCount = (this.bankWalkPendingCount || 0) + 1;

    const run = async () => {
      if (this.bankWalkIsBusy(api)) {
        return false;
      }
      let snapshot = snapshotAtPress;
      if (queued) {
        const latest = bankWalkSnapshot(api);
        if (this.bankWalkUnavailable(latest)) {
          return false;
        }
        this.bankWalkObserveScope(bankWalkScope(latest));
        if (bankWalkScope(latest) !== capturedScope) {
          return false;
        }
        snapshot = latest;
      } else {
        if (this.bankWalkUnavailable(snapshot)) {
          return false;
        }
        this.bankWalkObserveScope(bankWalkScope(snapshot));
      }
      if (this.bankWalkUnavailable(snapshot)) {
        return false;
      }

      let plan = this.bankWalkPlan(api, snapshot, request);
      if (!plan || plan.kind !== "jump") {
        try {
          showBankWalkEmptyNotice(this, BANK_WALK_EMPTY_NOTICE);
        } catch (_error) {
          new Notice(BANK_WALK_EMPTY_NOTICE);
        }
        return false;
      }

      let landed = await this.landBankWalkPlan(api, plan, jumpOrigin);
      if (!landed.ok && landed.stale) {
        snapshot = bankWalkSnapshot(api);
        if (this.bankWalkUnavailable(snapshot)) {
          return false;
        }
        this.bankWalkObserveScope(bankWalkScope(snapshot));
        plan = this.bankWalkPlan(api, snapshot, request);
        if (!plan || plan.kind !== "jump") {
          showBankWalkEmptyNotice(this, BANK_WALK_EMPTY_NOTICE);
          return false;
        }
        landed = await this.landBankWalkPlan(api, plan, jumpOrigin);
      }
      if (!landed.ok) {
        new Notice(landed.stale ? BANK_WALK_STALE_NOTICE : BANK_WALK_JUMP_FAILURE_NOTICE);
        return false;
      }
      try {
        api.setAnchor(plan.entry);
      } catch (_error) {
        // The ledger anchor is session-only convenience.
      }
      try {
        showBankWalkNotice(this, buildBankWalkNoticeModel(snapshot, plan));
      } catch (_error) {
        new Notice(BANK_WALK_JUMP_FAILURE_NOTICE);
      }
      return true;
    };

    const previous = this.bankWalkChain || Promise.resolve();
    const chained = previous.then(run, run);
    const result = chained.finally(() => {
      this.bankWalkPendingCount = Math.max(0, (this.bankWalkPendingCount || 1) - 1);
    });
    this.bankWalkChain = result.then(() => undefined, () => undefined);
    return result;
  }
}
