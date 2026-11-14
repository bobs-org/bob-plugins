// Fence adapters for the Bank Badge: a sibling host after every Day and
// period strip so a strip repaint never blanks the badge.

function bankBadgeCopyOwnerDocument(from, node) {
  try {
    if (from && node && from.ownerDocument && !node.ownerDocument) node.ownerDocument = from.ownerDocument;
  } catch (error) {
    // Fake-DOM tests set ownerDocument after createElement.
  }
  return node;
}

class BobLedgerToolsBankBadgeHostsMixin {
  bankBadgeAttachFenceHosts(fenceEl) {
    if (!fenceEl) return null;
    try {
      if (typeof fenceEl.empty === "function") fenceEl.empty();
      else if (typeof fenceEl.replaceChildren === "function") fenceEl.replaceChildren();
      else if (Array.isArray(fenceEl.children)) {
        for (const child of fenceEl.children.slice()) {
          try { child.parentNode = null; } catch (error) {}
        }
        fenceEl.children.length = 0;
        try { fenceEl.textContent = ""; } catch (error) {}
      } else if ("textContent" in fenceEl) {
        fenceEl.textContent = "";
      }
    } catch (error) {
      // Clearing a detached fence is best-effort.
    }
    const doc = statsDocFor(fenceEl);
    const stripHost = bankBadgeCopyOwnerDocument(fenceEl, statsEl(doc, "div", { class: "bob-stats-strip-host" }));
    const badgeHost = bankBadgeCopyOwnerDocument(fenceEl, statsEl(doc, "div", { class: "bob-bank-badge-host" }));
    if (!stripHost || !badgeHost || typeof fenceEl.appendChild !== "function") return null;
    try {
      fenceEl.appendChild(stripHost);
      fenceEl.appendChild(badgeHost);
    } catch (error) {
      return null;
    }
    return { stripHost, badgeHost };
  }

  bankBadgeFenceIsVisible(record) {
    try {
      if (record && record.visible === false) return false;
    } catch (error) {}
    try {
      if (record && record.observer) return record.badgeSeen === true;
    } catch (error) {}
    try {
      return statsBlockViewIsShown({ el: record && (record.fenceEl || record.el) });
    } catch (error) {
      return true;
    }
  }

  bankBadgeMarkFenceVisible(record) {
    try {
      if (!record) return;
      record.visible = true;
      record.badgeSeen = true;
    } catch (error) {}
    try {
      this.bankSyncFenceBadge(record);
    } catch (error) {
      // Badge subscribe is best-effort.
    }
  }

  bankSyncFenceBadge(record) {
    if (!record || !record.badgeHost) return;
    const kind = record.badgeKind || (record.day ? "day" : record.kind);
    const id = record.badgeId || record.day || record.periodId;
    const today = typeof this.bankBadgeLocalToday === "function" ? this.bankBadgeLocalToday() : bankLocalDate();
    const start = bankBadgePeriodStart(kind, id);
    const future = Boolean(start && today && start > today);
    const spawnOk = typeof this.dayStripCanSpawn !== "function" || this.dayStripCanSpawn();
    const gatedOff = future
      || !this.bankBadgeEnabled()
      || !this.bankBadgeHubExists()
      || !spawnOk
      || this.bankDataActive === false
      || !this.bankBadgeFenceIsVisible(record);
    if (gatedOff) {
      this.bankReleaseFenceBadge(record, { keepHost: true });
      return;
    }
    const spec = bankBadgeSpecForStrip(kind, id);
    if (!spec) {
      this.bankReleaseFenceBadge(record, { keepHost: true });
      return;
    }
    const key = bankCacheKey(bankBuildArgs(spec));
    const existing = record.bankBadgeRecord || null;
    if (existing && existing.key === key && existing.host === record.badgeHost && existing.unloaded !== true) return;

    this.bankReleaseFenceBadge(record, { keepHost: true });
    const badgeRecord = {
      host: record.badgeHost,
      kind,
      id,
      key,
      spec,
      parent: record,
      unsubscribe: null,
      result: null,
      state: null,
      unloaded: false,
      sync: () => this.bankBadgePaintFenceRecord(badgeRecord),
    };
    record.bankBadgeRecord = badgeRecord;
    this.bankBadgeRegisterHost(badgeRecord);
    if (typeof this.apiBankSubscribe !== "function") return;
    badgeRecord.unsubscribe = this.apiBankSubscribe(spec, (state) => {
      if (badgeRecord.unloaded) return;
      badgeRecord.state = state;
      badgeRecord.result = state && state.results ? state.results[key] || null : null;
      badgeRecord.sync();
    });
  }

  bankBadgePaintFenceRecord(record) {
    if (!record || record.unloaded || !record.host) return;
    const result = record.result;
    const args = record.spec ? bankBuildArgs(record.spec) : [];
    if (result && result.error && bankBadgeOlderBobRefusal(result.error, args)) {
      if (this.bankBadgeOlderBobWarned !== true) {
        this.bankBadgeOlderBobWarned = true;
        try {
          console.warn("Bank badges for quarter, year, and all-time need a bob with `bank report -p`.");
        } catch (error) {}
      }
      bankBadgePaint(record.host, { state: "hidden", reason: "older-bob" });
      return;
    }
    if (!result || !result.report) {
      const model = result && result.error
        ? { state: "unavailable", reason: "fetch-failed", hint: bankErrorModel(result.error).hint }
        : null;
      bankBadgePaint(record.host, model);
      return;
    }
    const model = bankBadgeModel(result.report, {
      kind: record.kind,
      day: record.kind === "day" ? record.id : undefined,
      today: record.state && record.state.today || bankLocalDate(),
      stale: result.stale === true,
      refreshFailed: Boolean(result.error),
    });
    bankBadgePaint(record.host, model, {
      activate: (target, newLeaf) => {
        if (!record.unloaded) void this.bankBadgeNavigate(target, newLeaf);
      },
    });
  }

  bankReleaseFenceBadge(record, opts = {}) {
    if (!record) return;
    const badge = record.bankBadgeRecord || null;
    if (badge) {
      badge.unloaded = true;
      this.bankBadgeUnregisterHost(badge);
      try { if (typeof badge.unsubscribe === "function") badge.unsubscribe(); } catch (error) {}
    }
    record.bankBadgeRecord = null;
    if (opts.keepHost === true && record.badgeHost) {
      try { bankCardClear(record.badgeHost); } catch (error) {}
    }
  }
}
