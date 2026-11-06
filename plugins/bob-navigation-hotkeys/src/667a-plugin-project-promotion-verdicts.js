// Project-promotion successor verdicts (cycler api v5,
// plan:202611/successor_card_verdicts.md promotion phase).
//
// The promotion card attaches the cycler's close descriptors to its rows and
// applies returned closes after the picks. The task-merge card (429a) never
// attaches close descriptors and stays pull-in-only: its model carries no
// `close.supported`, so the picker keeps today's pull-in-only card.

// Feature detection for the cycler's public offer-close surface.
function promotionOfferCloseCyclerApi(app) {
  try {
    const plugins = (app && app.plugins && app.plugins.plugins) || {};
    const cycler = plugins["task-status-cycler"];
    const api = cycler && cycler.api;
    if (!api || !(Number(api.version) >= 5)) return null;
    if (typeof api.describeOfferCloses !== "function") return null;
    if (typeof api.applyOfferCloses !== "function") return null;
    return api;
  } catch (_error) {
    return null;
  }
}

// E5 (nav side): our own successors picker must speak v4 closes.
function promotionSuccessorPickerCloseCapable(plugin) {
  try {
    const api = plugin && plugin.api;
    const successors = api && api.successors;
    if (!successors || !(Number(successors.version) >= 4)) return false;
    if (plugin && typeof plugin.pickSuccessorOffers === "function") return true;
    return successors && typeof successors.pick === "function";
  } catch (_error) {
    return false;
  }
}

// Plain engine rows for `describeOfferCloses`. Only selectable rows with a
// card line go out; muted rows have no verdict slot.
function promotionSuccessorCloseRows(offerPlan) {
  const out = [];
  try {
    const rows = offerPlan && Array.isArray(offerPlan.rows) ? offerPlan.rows : [];
    for (const row of rows) {
      if (!row || row.selectable !== true) continue;
      if (typeof row.key !== "string" || !row.key) continue;
      if (!Number.isInteger(row.line) || row.line < 0) continue;
      if (typeof row.rawLine !== "string" || !row.rawLine) continue;
      out.push({
        key: row.key,
        text: typeof row.text === "string" ? row.text : row.rawLine,
        notePath: String(row.notePath || ""),
        status: typeof row.status === "string" ? row.status : " ",
        selectable: true,
        line: row.line,
        rawLine: row.rawLine,
        blockId: typeof row.blockId === "string" && row.blockId ? row.blockId : null,
      });
    }
  } catch (_error) {
    // Rows stay empty; the card falls back to pull-in-only.
  }
  return out;
}

function promotionCloseDescriptorEligible(descriptor) {
  try {
    return Boolean(
      descriptor && typeof descriptor === "object" &&
      (descriptor.complete === true || descriptor.cancel === true),
    );
  } catch (_error) {
    return false;
  }
}

// Clone the promotion picker model with the described `close` rows. Sets
// `close.supported` only when at least one row is eligible (rule 11); the
// picker itself re-checks visible rows before showing hints or chords.
function promotionModelWithOfferCloses(model, descriptors) {
  try {
    if (!model || typeof model !== "object") return model;
    const source = descriptors && typeof descriptors === "object" ? descriptors : {};
    const groups = Array.isArray(model.groups) ? model.groups : [];
    let eligible = 0;
    const nextGroups = groups.map((group) => ({
      ...(group && typeof group === "object" ? group : {}),
      rows: (Array.isArray(group && group.rows) ? group.rows : []).map((row) => {
        const descriptor = row && typeof row.key === "string" ? source[row.key] : null;
        if (descriptor && typeof descriptor === "object") {
          if (promotionCloseDescriptorEligible(descriptor)) eligible += 1;
          return { ...row, close: { ...descriptor } };
        }
        return row && typeof row === "object" ? { ...row } : row;
      }),
    }));
    if (eligible <= 0) return model;
    return { ...model, groups: nextGroups, close: { supported: true } };
  } catch (_error) {
    return model;
  }
}

// Ask the cycler for descriptors, or null when either side is too old.
async function promotionDescribeOfferCloses(plugin, offerPlan) {
  try {
    const api = promotionOfferCloseCyclerApi(plugin && plugin.app);
    if (!api || !promotionSuccessorPickerCloseCapable(plugin)) return null;
    const rows = promotionSuccessorCloseRows(offerPlan);
    if (rows.length === 0) return null;
    const described = await api.describeOfferCloses({ rows, gesture: "promotion" });
    if (!described || described.supported !== true) return null;
    const descriptors = described.descriptors && typeof described.descriptors === "object"
      ? described.descriptors
      : null;
    if (!descriptors || Object.keys(descriptors).length === 0) return null;
    return descriptors;
  } catch (_error) {
    return null;
  }
}

function promotionExpectedCloseLines(offerPlan) {
  const out = {};
  try {
    const rows = offerPlan && Array.isArray(offerPlan.rows) ? offerPlan.rows : [];
    for (const row of rows) {
      if (row && typeof row.key === "string" && row.key &&
          typeof row.rawLine === "string" && row.rawLine) {
        out[row.key] = row.rawLine;
      }
    }
  } catch (_error) {
    // Lines stay empty; the apply refuses without preimages.
  }
  return out;
}

function promotionOfferCloseReceiptEmpty(receipt) {
  try {
    if (!receipt || typeof receipt !== "object") return true;
    if (Array.isArray(receipt.offer_closes) && receipt.offer_closes.length > 0) return false;
    if (receipt.offer_close_refused && Number(receipt.offer_close_refused.count) > 0) return false;
    if (Array.isArray(receipt.failures) && receipt.failures.length > 0) return false;
    return true;
  } catch (_error) {
    return true;
  }
}

// Apply returned closes through the cycler and report the receipt with the
// nav notice v4 card (guarded Undo included). Resolves the receipt, or null
// when there is nothing to report.
async function promotionApplyOfferCloses(plugin, offerPlan, closes) {
  try {
    const list = Array.isArray(closes) ? closes.filter((close) =>
      close && typeof close.key === "string" && close.key &&
      (close.outcome === "done" || close.outcome === "cancelled")) : [];
    if (list.length === 0) return null;
    const api = promotionOfferCloseCyclerApi(plugin && plugin.app);
    if (!api) return null;
    const receipt = await api.applyOfferCloses({
      closes: list.map((close) => {
        const entry = { key: close.key, outcome: close.outcome };
        if (close.outcome === "cancelled" && typeof close.reason === "string" && close.reason) {
          entry.reason = close.reason;
        }
        return entry;
      }),
      expectedLines: promotionExpectedCloseLines(offerPlan),
      rows: promotionSuccessorCloseRows(offerPlan),
    });
    if (promotionOfferCloseReceiptEmpty(receipt)) return null;
    return receipt;
  } catch (_error) {
    return null;
  }
}

function promotionOfferCloseNoticeModel(receipt, plugin) {
  try {
    if (promotionOfferCloseReceiptEmpty(receipt)) return null;
    return {
      offer_closes: Array.isArray(receipt.offer_closes) ? receipt.offer_closes : [],
      offer_close_refused: receipt.offer_close_refused || null,
      undo: receipt.undo || null,
      failures: Array.isArray(receipt.failures) ? receipt.failures : [],
      __noticePlugin: plugin || null,
    };
  } catch (_error) {
    return null;
  }
}

// Show the closes receipt through `api.notice` v4. Returns true when a card
// was shown; falls back to a plain notice when the host cannot render one.
function showPromotionOfferCloseReceipt(plugin, receipt) {
  try {
    const model = promotionOfferCloseNoticeModel(receipt, plugin);
    if (!model) return false;
    const app = plugin && plugin.app ? plugin.app : null;
    if (app && typeof showUnblockedNotice === "function") {
      try {
        if (showUnblockedNotice(app, model)) return true;
      } catch (_error) {
        // Fall through to the plain notice.
      }
    }
    const lines = [];
    for (const row of model.offer_closes) {
      if (row && (row.message || row.text)) lines.push(String(row.message || row.text));
    }
    if (model.offer_close_refused && Number(model.offer_close_refused.count) > 0) {
      lines.push(`${model.offer_close_refused.count} not closed · changed since the card opened`);
    }
    if (lines.length === 0) return false;
    new Notice(lines.join("\n"));
    return true;
  } catch (_error) {
    return false;
  }
}
