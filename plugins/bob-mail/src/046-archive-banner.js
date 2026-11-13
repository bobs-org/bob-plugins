// Bob Mail archived-banner core: trusted-span recognition, receipt cache,
// tooltip copy, and explicit-undo argv/outcome helpers.
//
// Pure and synchronous except for the injected cache runner: no Obsidian or
// CodeMirror globals, no vault writes, no process spawns. Bob's folded
// archive journal stays authoritative; the banner span and frontmatter are
// repairable projections. Every helper is defensive and never throws.

const MAIL_ARCHIVE_BEGIN = "<!-- bob:gmail:receipt:begin v1 -->";
const MAIL_ARCHIVE_END = "<!-- bob:gmail:receipt:end -->";
const MAIL_ARCHIVE_HOST_CLASS = "bob-mail-archive-banner";
const MAIL_ARCHIVE_BUTTON_CLASS = "bob-mail-archive-unarchive";
const MAIL_ARCHIVE_UNDO_LABEL = "Move back to Inbox";
const MAIL_ARCHIVE_POSTPROCESSOR_ORDER = 63;
const MAIL_ARCHIVE_API_VERSION = 1;
const MAIL_ARCHIVE_LIST_ARGS = ["gmail", "list", "-a", "-f", "json"];
const MAIL_ARCHIVE_FALLBACK_TOOLTIP_DATE = "date unknown";

function mailArchiveBannerDate(lineText) {
  try {
    const text = String(lineText || "").trim().replace(/^>\s*/, "");
    const match = text.match(
      /^🗄️\s+Archived by Bob on (\d{4})-(\d{2})-(\d{2})\s+—\s+to move it back, use Move to Inbox in Gmail\.\s*$/u,
    );
    if (!match) return null;
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  } catch (error) {
    return null;
  }
}

// Trusted banner spans in a full note text: a banner line with the exact
// begin marker directly above and the exact end marker directly below.
// Duplicated or unbalanced markers mean a damaged note, so nothing is
// trusted rather than guessing which span Bob owns. Never throws.
function mailArchiveTrustedBannerDates(lines) {
  try {
    const list = Array.isArray(lines) ? lines : String(lines || "").split("\n");
    const found = [];
    let begins = 0;
    let ends = 0;
    for (const line of list) {
      const trimmed = String(line || "").trim();
      if (trimmed === MAIL_ARCHIVE_BEGIN) begins += 1;
      else if (trimmed === MAIL_ARCHIVE_END) ends += 1;
    }
    for (let index = 1; index + 1 < list.length; index += 1) {
      const date = mailArchiveBannerDate(list[index]);
      if (!date) continue;
      if (
        String(list[index - 1] || "").trim() === MAIL_ARCHIVE_BEGIN &&
        String(list[index + 1] || "").trim() === MAIL_ARCHIVE_END
      ) {
        found.push({ line: index, date });
      }
    }
    if (begins !== found.length || ends !== found.length) return [];
    return found;
  } catch (error) {
    return [];
  }
}

function mailArchiveHasTrustedBanner(text) {
  try {
    return mailArchiveTrustedBannerDates(String(text || "").split("\n")).length > 0;
  } catch (error) {
    return false;
  }
}

// Explicit undo argv: exact recorded identity only. Options come first and
// `--` immediately precedes the note operand, so hostile paths never parse
// as flags and nothing after `--` becomes an extra operand.
function mailArchiveUnarchiveArgs(notePath) {
  const target = String(notePath || "");
  return ["gmail", "unarchive", "-f", "json", "--", target];
}

function mailArchiveIsValidReceipt(entry) {
  try {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (typeof entry.archive_event_id !== "string" || !entry.archive_event_id) return false;
    if (typeof entry.archived_at !== "string" || !entry.archived_at) return false;
    if (!Number.isInteger(entry.message_count) || entry.message_count < 0) return false;
    const label = entry.label;
    if (!label || typeof label !== "object" || Array.isArray(label)) return false;
    if (typeof label.name !== "string" || !label.name) return false;
    if (typeof label.id !== "string") return false;
    return true;
  } catch (error) {
    return false;
  }
}

// Decode `bob gmail list -a -f json` into a per-note receipt map. A null
// `archive_receipts` row means unavailable for that note, never confirmed
// empty; only a ready snapshot with a present, empty array means no
// ownership. Anything unexpected is unavailable, never a fabricated zero.
function mailArchiveDecodeList(document) {
  try {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      return { ok: false, code: "bad-shape" };
    }
    if (document.schema_version !== 1) return { ok: false, code: "bad-shape" };
    if (!Array.isArray(document.threads)) return { ok: false, code: "bad-shape" };
    const byNote = new Map();
    const unavailable = new Set();
    for (const thread of document.threads) {
      try {
        const notePath = thread && typeof thread.path === "string" ? thread.path : "";
        if (!notePath) continue;
        const receipts = thread ? thread.archive_receipts : undefined;
        if (receipts === null || receipts === undefined) {
          unavailable.add(notePath);
          continue;
        }
        if (!Array.isArray(receipts)) {
          unavailable.add(notePath);
          continue;
        }
        const kept = [];
        let valid = true;
        for (const entry of receipts) {
          if (!mailArchiveIsValidReceipt(entry)) {
            valid = false;
            break;
          }
          kept.push({
            archive_event_id: entry.archive_event_id,
            archived_at: entry.archived_at,
            message_count: entry.message_count,
            label: { name: entry.label.name, id: entry.label.id },
          });
        }
        if (!valid) {
          unavailable.add(notePath);
          continue;
        }
        byNote.set(notePath, kept);
      } catch (error) {
        continue;
      }
    }
    return { ok: true, byNote, unavailable };
  } catch (error) {
    return { ok: false, code: "bad-shape" };
  }
}

function mailArchiveReceiptSummary(receipts) {
  try {
    if (!Array.isArray(receipts) || receipts.length === 0) return null;
    let count = 0;
    let latestAt = null;
    let latestTime = NaN;
    const labels = [];
    for (const receipt of receipts) {
      count += Number(receipt && receipt.message_count) || 0;
      const at = receipt && typeof receipt.archived_at === "string" ? receipt.archived_at : "";
      const time = Date.parse(at);
      if (Number.isFinite(time) && !(time <= latestTime)) {
        latestTime = time;
        latestAt = at;
      }
      const name = receipt && receipt.label && typeof receipt.label.name === "string"
        ? receipt.label.name
        : "";
      if (name && !labels.includes(name)) labels.push(name);
    }
    return {
      count,
      latestAt,
      labelName: labels.length === 1 ? labels[0] : null,
      labelCount: labels.length,
    };
  } catch (error) {
    return null;
  }
}

// Tooltip copy for the banner button. Receipt details add the exact
// recorded message count and label; anything else falls back to the inert
// banner guidance without guessing counts or labels. Text only, never HTML.
function mailArchiveTooltipFor(date, state) {
  try {
    const day = typeof date === "string" && date ? date : MAIL_ARCHIVE_FALLBACK_TOOLTIP_DATE;
    const base = `Archived by Bob on ${day}`;
    if (!state || state.kind !== "receipts") {
      return `${base} — details unavailable; ${MAIL_ARCHIVE_UNDO_LABEL} tries an explicit undo`;
    }
    const summary = mailArchiveReceiptSummary(state.receipts);
    if (!summary) return `${base} — ${MAIL_ARCHIVE_UNDO_LABEL} to undo`;
    const messages = `${summary.count} message${summary.count === 1 ? "" : "s"}`;
    const label = summary.labelName
      ? ` under ${summary.labelName}`
      : summary.labelCount > 1
        ? ` under ${summary.labelCount} labels`
        : "";
    return `${base} · ${messages}${label} — ${MAIL_ARCHIVE_UNDO_LABEL} to undo`;
  } catch (error) {
    return "Archived by Bob — details unavailable";
  }
}

function mailArchiveCreateCache() {
  return { status: "unloaded", byNote: new Map(), unavailable: new Set(), promise: null, updatedAt: 0 };
}

// Coalesced snapshot refresh over one offline `bob gmail list -a -f json`
// call. Concurrent callers share the in-flight promise; failures settle as
// unavailable (or old-bob) without throwing, keeping stale rows out of
// reach. Never throws.
function mailArchiveRefreshCache(cache, runList) {
  try {
    if (!cache || typeof cache !== "object") return Promise.resolve(null);
    if (cache.promise) return cache.promise;
    const runner = typeof runList === "function" ? runList : null;
    if (!runner) {
      cache.status = "unavailable";
      return Promise.resolve(cache);
    }
    cache.status = "loading";
    cache.promise = Promise.resolve()
      .then(() => runner())
      .then((result) => {
        try {
          if (result && result.ok && result.document) {
            const decoded = mailArchiveDecodeList(result.document);
            if (decoded.ok) {
              cache.byNote = decoded.byNote;
              cache.unavailable = decoded.unavailable;
              cache.status = "ready";
            } else {
              cache.status = "unavailable";
            }
          } else if (result && result.oldBob) {
            cache.byNote = new Map();
            cache.unavailable = new Set();
            cache.status = "old-bob";
          } else {
            cache.status = "unavailable";
          }
        } catch (error) {
          cache.status = "unavailable";
        }
        try {
          cache.updatedAt = Date.now();
        } catch (error) {
          cache.updatedAt = 0;
        }
        cache.promise = null;
        return cache;
      })
      .catch(() => {
        try {
          cache.status = "unavailable";
          cache.promise = null;
        } catch (error) {
          // Cache bookkeeping is best effort.
        }
        return cache;
      });
    return cache.promise;
  } catch (error) {
    return Promise.resolve(null);
  }
}

// Authoritative per-note state. `receipts` serves only from a ready
// snapshot that contains this exact note; `none` is a safely confirmed
// empty array. Every other case is unavailable with its reason, so the
// renderer never invents ownership. Never throws.
function mailArchiveStateForNote(cache, notePath) {
  try {
    const target = String(notePath || "");
    if (!cache || typeof cache !== "object" || !target) {
      return { kind: "unavailable", status: "unavailable" };
    }
    if (cache.status !== "ready") {
      return { kind: "unavailable", status: String(cache.status || "unavailable") };
    }
    if (cache.unavailable && cache.unavailable.has(target)) {
      return { kind: "unavailable", status: "unavailable" };
    }
    if (!cache.byNote || !cache.byNote.has(target)) {
      return { kind: "unavailable", status: "unknown-note" };
    }
    const receipts = cache.byNote.get(target) || [];
    if (receipts.length === 0) return { kind: "none", status: "ready", receipts: [] };
    return { kind: "receipts", status: "ready", receipts: receipts.slice() };
  } catch (error) {
    return { kind: "unavailable", status: "unavailable" };
  }
}

// Interpret one `bob gmail unarchive -f json` document for the note the
// banner button acted on. Matches the exact note first, then the raw input,
// then a single-row document. Never throws.
function mailArchiveUndoOutcome(document, notePath) {
  try {
    const target = String(notePath || "");
    const results = document && Array.isArray(document.results) ? document.results : null;
    if (!results || results.length === 0 || !target) return { kind: "unknown", note: target };
    let row = results.find((entry) => entry && entry.note === target) || null;
    if (!row) row = results.find((entry) => entry && entry.input === target) || null;
    if (!row && results.length === 1) row = results[0];
    if (!row) return { kind: "unknown", note: target };
    const action = String(row.action || "");
    const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
    const note = typeof row.note === "string" && row.note ? row.note : target;
    if (action === "restored") return { kind: "restored", note, threadId };
    if (action === "would_restore") return { kind: "would_restore", note, threadId };
    if (action === "unchanged") {
      const reason = typeof row.reason === "string" && row.reason ? row.reason : "no owned receipt";
      return { kind: "unchanged", note, threadId, message: reason };
    }
    if (action === "failed") {
      const problem = row.error && typeof row.error === "object" ? row.error : {};
      const message = typeof problem.message === "string" && problem.message
        ? problem.message
        : "unarchive failed";
      const hint = typeof problem.hint === "string" ? problem.hint : "";
      const errorKind = typeof problem.kind === "string" ? problem.kind : "";
      return { kind: "failed", note, threadId, message, hint, errorKind };
    }
    return { kind: "unknown", note, threadId };
  } catch (error) {
    return { kind: "unknown", note: String(notePath || "") };
  }
}

function mailArchiveUndoNotice(outcome) {
  try {
    if (!outcome || typeof outcome !== "object") return "Move back to Inbox finished";
    if (outcome.kind === "restored") {
      return outcome.threadId
        ? `Moved back to Inbox · ${outcome.threadId}`
        : "Moved back to Inbox";
    }
    if (outcome.kind === "unchanged") {
      return `Nothing to move back — ${outcome.message || "no owned receipt"}`;
    }
    if (outcome.kind === "failed") return `Move back to Inbox failed: ${outcome.message || "unarchive failed"}`;
    return "Move back to Inbox finished";
  } catch (error) {
    return "Move back to Inbox finished";
  }
}

// DOM builder shared by both hosts. Text APIs only: hostile subjects and
// paths travel through textContent, never HTML. The button carries no note
// identity in markup; the caller closes over the exact note path. Returns
// null without a document host. Never throws.
function buildMailArchiveBannerElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model) return null;
    const host = doc.createElement("span");
    host.setAttribute("class", MAIL_ARCHIVE_HOST_CLASS);
    const button = doc.createElement("button");
    button.setAttribute("class", MAIL_ARCHIVE_BUTTON_CLASS);
    button.setAttribute("type", "button");
    const tooltip = typeof model.tooltip === "string" && model.tooltip
      ? model.tooltip
      : MAIL_ARCHIVE_UNDO_LABEL;
    button.setAttribute("aria-label", tooltip);
    button.setAttribute("data-tooltip-position", "top");
    button.textContent = typeof model.label === "string" && model.label
      ? model.label
      : MAIL_ARCHIVE_UNDO_LABEL;
    if (model.pending === true) {
      button.setAttribute("disabled", "true");
      button.setAttribute("aria-disabled", "true");
    }
    if (typeof model.onClick === "function" && typeof button.addEventListener === "function") {
      button.addEventListener("click", (event) => {
        try {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
        } catch (ignore) {
          // A missing preventDefault never blocks the undo.
        }
        model.onClick();
      });
    }
    host.appendChild(button);
    return host;
  } catch (error) {
    return null;
  }
}
