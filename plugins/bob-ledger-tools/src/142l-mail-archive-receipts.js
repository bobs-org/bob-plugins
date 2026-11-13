// --- Gmail archive receipts: closed-task chip core -----------------------
// Display-only projection of bob's offline `gmail list -a -f json` data.
// Ownership comes from active archive receipts; frontmatter supplies only
// the newest archive timestamp and the exact note identity.

const MAIL_ARCHIVE_CHIP_CLASS = "bob-mail-archive-chip";
const MAIL_ARCHIVE_CHIP_SIDE = 1;
const MAIL_ARCHIVE_LIST_ARGS = Object.freeze(["gmail", "list", "-a", "-f", "json"]);

function mailArchiveReceiptDatePart(value) {
  try {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
    if (!match || !Number.isFinite(Date.parse(text))) return null;
    if (typeof parseFreshDateStrict === "function") {
      return parseFreshDateStrict(match[1]);
    }
    const date = new Date(`${match[1]}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]
      ? null
      : match[1];
  } catch (error) {
    return null;
  }
}

function mailArchiveReceiptIsValid(entry) {
  try {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (typeof entry.archive_event_id !== "string" || !entry.archive_event_id) return false;
    if (!mailArchiveReceiptDatePart(entry.archived_at)) return false;
    if (!Number.isInteger(entry.message_count) || entry.message_count < 1) return false;
    const label = entry.label;
    return Boolean(
      label && typeof label === "object" && !Array.isArray(label) &&
      typeof label.name === "string" && label.name.trim() &&
      (typeof label.id === "string" || label.id === null),
    );
  } catch (error) {
    return false;
  }
}

function mailArchiveNoteIdentityFromFrontmatter(frontmatter) {
  try {
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return null;
    if (typeof blockMarkIsMailFrontmatter === "function" && !blockMarkIsMailFrontmatter(frontmatter)) return null;
    const account = typeof frontmatter.gmail_account === "string" ? frontmatter.gmail_account.trim() : "";
    const threadId = typeof frontmatter.gmail_thread_id === "string" ? frontmatter.gmail_thread_id.trim() : "";
    const archivedAt = typeof frontmatter.gmail_archived === "string" ? frontmatter.gmail_archived.trim() : "";
    if (!account || !threadId) return null;
    return { account, threadId, archivedAt };
  } catch (error) {
    return null;
  }
}

function mailArchiveReceiptTaskStatus(lineText) {
  try {
    const status = typeof freshnessTaskStatus === "function"
      ? freshnessTaskStatus(String(lineText || ""))
      : null;
    if (status !== "x" && status !== "X" && status !== "-") return null;
    if (typeof taskTagMarkTokenRanges !== "function" || taskTagMarkTokenRanges(String(lineText || "")).length === 0) {
      return null;
    }
    return status;
  } catch (error) {
    return null;
  }
}

function mailArchiveReceiptTooltip(receipts) {
  try {
    if (!Array.isArray(receipts) || receipts.length === 0) return "";
    const detail = receipts.map((entry) => {
      const count = entry.message_count;
      const messages = `${count} saved message${count === 1 ? "" : "s"}`;
      return `${entry.archived_at}: ${messages} under ${entry.label.name}`;
    }).join("; ");
    return `Bob archived this mail. ${detail}. Move it back to Inbox with Bob Mail, or run bob gmail unarchive for this note.`;
  } catch (error) {
    return "Bob archived this mail. Move it back to Inbox with Bob Mail.";
  }
}

function mailArchiveReceiptChipModel(lineText, frontmatter, state, today) {
  try {
    if (!mailArchiveReceiptTaskStatus(lineText)) return null;
    const identity = mailArchiveNoteIdentityFromFrontmatter(frontmatter);
    if (!identity || !identity.archivedAt) return null;
    if (!state || state.kind !== "receipts" || state.status !== "ready" || !Array.isArray(state.receipts)) return null;
    const receipts = state.receipts.filter(mailArchiveReceiptIsValid).slice();
    if (receipts.length === 0 || receipts.length !== state.receipts.length) return null;
    const newest = receipts.reduce((latest, receipt) => {
      return Date.parse(receipt.archived_at) > Date.parse(latest.archived_at) ? receipt : latest;
    }, receipts[0]);
    if (Date.parse(newest.archived_at) !== Date.parse(identity.archivedAt)) return null;
    const date = mailArchiveReceiptDatePart(identity.archivedAt);
    if (!date) return null;
    const shortDate = typeof freshnessShortDate === "function"
      ? freshnessShortDate(date, String(today || ""))
      : date;
    const tooltip = mailArchiveReceiptTooltip(receipts);
    if (!tooltip) return null;
    return Object.freeze({
      text: `⤓ archived ${shortDate || date}`,
      tooltip,
      account: identity.account,
      threadId: identity.threadId,
      date,
      receipts: Object.freeze(receipts),
    });
  } catch (error) {
    return null;
  }
}

function mailArchiveReceiptModelsForTask(lineText, targets, today) {
  try {
    if (!mailArchiveReceiptTaskStatus(lineText) || !Array.isArray(targets)) return Object.freeze([]);
    const seen = new Set();
    const models = [];
    for (const target of targets) {
      try {
        const notePath = String(target && target.notePath || "");
        const identity = target && target.identity;
        if (!notePath || !identity) continue;
        const key = `${notePath}\u0000${String(identity.account || "").toLowerCase()}\u0000${String(identity.threadId || "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const model = mailArchiveReceiptChipModel(lineText, {
          type: "[[mail]]",
          gmail_account: identity.account,
          gmail_thread_id: identity.threadId,
          gmail_archived: identity.archivedAt,
        }, target.state, today);
        if (model) models.push(Object.freeze({ ...model, notePath }));
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(models);
  } catch (error) {
    return Object.freeze([]);
  }
}

function mailArchiveReceiptDecodeList(document) {
  try {
    if (!document || typeof document !== "object" || Array.isArray(document) ||
        document.schema_version !== 1 || document.ok !== true || !Array.isArray(document.threads)) {
      return { ok: false, code: "bad-shape" };
    }
    const byNote = new Map();
    const unavailable = new Set();
    for (const row of document.threads) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, code: "bad-shape" };
      const notePath = typeof row.path === "string" ? row.path : "";
      const account = typeof row.account === "string" ? row.account.trim() : "";
      const threadId = typeof row.thread_id === "string" ? row.thread_id.trim() : "";
      if (!notePath || !account || !threadId || byNote.has(notePath) || unavailable.has(notePath)) {
        return { ok: false, code: "bad-shape" };
      }
      const raw = row.archive_receipts;
      if (!Array.isArray(raw) || raw.some((entry) => !mailArchiveReceiptIsValid(entry))) {
        unavailable.add(notePath);
        continue;
      }
      byNote.set(notePath, {
        account,
        threadId,
        receipts: raw.map((entry) => ({
          archive_event_id: entry.archive_event_id,
          archived_at: entry.archived_at,
          message_count: entry.message_count,
          label: { name: entry.label.name, id: entry.label.id },
        })),
      });
    }
    return { ok: true, byNote, unavailable };
  } catch (error) {
    return { ok: false, code: "bad-shape" };
  }
}

function mailArchiveReceiptDecodeListOutput(stdout) {
  try {
    const document = JSON.parse(String(stdout || ""));
    return mailArchiveReceiptDecodeList(document).ok
      ? { ok: true, document }
      : { ok: false, code: "bad-shape", message: "bob gmail list returned unavailable archive receipt data." };
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob gmail list returned invalid JSON." };
  }
}

function mailArchiveReceiptCacheCreate() {
  return { status: "unloaded", byNote: new Map(), unavailable: new Set(), promise: null, revision: 0, refreshAgain: false };
}

function mailArchiveReceiptCacheInvalidate(cache) {
  try {
    if (!cache || typeof cache !== "object") return false;
    cache.revision = (Number(cache.revision) || 0) + 1;
    cache.status = "unloaded";
    cache.byNote = new Map();
    cache.unavailable = new Set();
    if (cache.promise) cache.refreshAgain = true;
    return true;
  } catch (error) {
    return false;
  }
}

function mailArchiveReceiptCacheRefresh(cache, runList) {
  try {
    if (!cache || typeof cache !== "object") return Promise.resolve(null);
    if (cache.promise) return cache.promise;
    if (typeof runList !== "function") {
      cache.status = "unavailable";
      return Promise.resolve(cache);
    }
    const revision = Number(cache.revision) || 0;
    cache.status = "loading";
    cache.promise = Promise.resolve()
      .then(() => runList())
      .then((result) => {
        const decoded = result && result.ok && result.document
          ? mailArchiveReceiptDecodeList(result.document)
          : { ok: false };
        if (revision === (Number(cache.revision) || 0)) {
          cache.status = decoded.ok ? "ready" : result && result.oldBob ? "old-bob" : "unavailable";
          cache.byNote = decoded.ok ? decoded.byNote : new Map();
          cache.unavailable = decoded.ok ? decoded.unavailable : new Set();
        }
        const again = cache.refreshAgain;
        cache.refreshAgain = false;
        cache.promise = null;
        return again ? mailArchiveReceiptCacheRefresh(cache, runList) : cache;
      })
      .catch(() => {
        if (revision === (Number(cache.revision) || 0)) {
          cache.status = "unavailable";
          cache.byNote = new Map();
          cache.unavailable = new Set();
        }
        const again = cache.refreshAgain;
        cache.refreshAgain = false;
        cache.promise = null;
        return again ? mailArchiveReceiptCacheRefresh(cache, runList) : cache;
      });
    return cache.promise;
  } catch (error) {
    return Promise.resolve(null);
  }
}

function mailArchiveReceiptCacheStateForNote(cache, notePath, account, threadId) {
  try {
    const path = String(notePath || "");
    if (!cache || cache.status !== "ready" || !path) return { kind: "unavailable", status: cache && cache.status || "unavailable" };
    if (cache.unavailable && cache.unavailable.has(path)) return { kind: "unavailable", status: "unavailable" };
    const row = cache.byNote && cache.byNote.get(path);
    if (!row) return { kind: "unavailable", status: "unknown-note" };
    if (String(row.account || "").toLowerCase() !== String(account || "").toLowerCase() ||
        String(row.threadId || "").toLowerCase() !== String(threadId || "").toLowerCase()) {
      return { kind: "unavailable", status: "identity-mismatch" };
    }
    return row.receipts.length
      ? { kind: "receipts", status: "ready", receipts: row.receipts.slice() }
      : { kind: "none", status: "ready", receipts: [] };
  } catch (error) {
    return { kind: "unavailable", status: "unavailable" };
  }
}

function buildMailArchiveChipElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || !model.text) return null;
    const host = doc.createElement("span");
    host.setAttribute("class", MAIL_ARCHIVE_CHIP_CLASS);
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", String(model.tooltip || model.text));
    host.setAttribute("data-tooltip-position", "top");
    host.textContent = String(model.text);
    return host;
  } catch (error) {
    return null;
  }
}

function buildMailArchiveChipGroupElement(doc, models) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !Array.isArray(models) || models.length === 0) return null;
    const group = doc.createElement("span");
    group.setAttribute("class", "bob-mail-archive-chip-group");
    for (const model of models) {
      const chip = buildMailArchiveChipElement(doc, model);
      if (chip && typeof group.appendChild === "function") group.appendChild(chip);
    }
    return group;
  } catch (error) {
    return null;
  }
}

let MailArchiveChipWidget = null;
if (typeof WidgetType === "function") {
  MailArchiveChipWidget = class extends WidgetType {
    constructor(models) {
      super();
      this.models = Array.isArray(models) ? models.map((model) => ({ ...model })) : [];
      this.key = this.models.map((model) => `${model.text}\u0000${model.tooltip}`).join("\u0001");
    }

    eq(other) {
      return Boolean(other && other instanceof MailArchiveChipWidget && other.key === this.key);
    }

    toDOM() {
      const doc = typeof document !== "undefined" ? document : null;
      return buildMailArchiveChipGroupElement(doc, this.models);
    }
  };
}
