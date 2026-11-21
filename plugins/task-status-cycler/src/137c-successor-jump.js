// Resolve a staged successor-card pin to its post-write task identity. A
// closed row uses the close writer's postimage; a picked or left row uses the
// successor plan's staged recovery text when it changed the task line.
function buildSuccessorJumpIdentity(key, originalOfferByKey, plan, closeResult) {
  try {
    const wanted = typeof key === "string" ? key.trim() : "";
    const offers = originalOfferByKey instanceof Map ? originalOfferByKey : new Map();
    const offer = wanted ? offers.get(wanted) : null;
    if (!offer) return null;

    const task = offer.task && typeof offer.task === "object" ? offer.task : {};
    const originalPath = String(offer.notePath || task.path || "");
    const originalLine = Number.isInteger(task.line)
      ? task.line
      : Number.isInteger(offer.line) ? offer.line : null;
    const originalText = typeof task.rawLine === "string"
      ? task.rawLine
      : typeof task.lineText === "string" ? task.lineText : null;
    const description = String(offer.text || task.description || "task").trim() || "task";
    const edits = Array.isArray(plan && plan.edits) ? plan.edits : [];
    const editAt = (path, line) => Number.isInteger(line) && edits.find((edit) => edit &&
      String(edit.path || "") === String(path || "") &&
      Number(edit.line) === Number(line) && typeof edit.after === "string");

    const closeReceipt = (closeResult && Array.isArray(closeResult.offer_closes)
      ? closeResult.offer_closes
      : []).find((entry) => entry && String(entry.key || "") === wanted);
    let target = null;
    if (closeReceipt) {
      const resolved = (Array.isArray(closeResult.resolved) ? closeResult.resolved : [])
        .find((entry) => entry && String(entry.key || "") === wanted) || {};
      target = {
        outcome: closeReceipt.outcome === "cancelled" ? "cancelled" : "done",
        path: String(resolved.path || originalPath),
        line: Number.isInteger(resolved.line) ? resolved.line : originalLine,
        blockId: String(resolved.blockId || task.blockId || ""),
        text: typeof resolved.afterLine === "string" ? resolved.afterLine : null,
      };
    } else {
      const rows = typeof successorPlanRows === "function" ? successorPlanRows(plan) : [];
      const picked = rows.find((row) => row && row.offer &&
        String(row.offer.key || "") === wanted && row.offer.selected === true);
      if (picked) {
        const path = String(picked.note_path || originalPath);
        const edit = editAt(path, picked.line);
        target = {
          outcome: "picked",
          path,
          line: originalLine,
          blockId: String(picked.block_id || task.blockId || ""),
          text: edit ? edit.after : originalText,
        };
      } else {
        // Left identity comes from the fresh plan's row for the same offer
        // key: after a replan a shifted note can give another task's line as
        // text when the stale card-open line is reused. Fall back to the
        // original offer only when the fresh plan lacks the key (a refused
        // stale pick still lands as Left from its fresh unpicked row).
        const freshRow = rows.find((row) => row && row.offer &&
          String(row.offer.key || "") === wanted);
        if (freshRow) {
          const freshPath = String(
            freshRow.note_path || freshRow.notePath || originalPath,
          );
          const freshLine = Number.isInteger(freshRow.line)
            ? freshRow.line
            : originalLine;
          const freshBlockId = String(
            freshRow.block_id || freshRow.blockId || task.blockId || "",
          );
          const freshFallback = typeof freshRow.text === "string"
            ? freshRow.text
            : originalText;
          const edit = editAt(freshPath, freshLine);
          target = {
            outcome: "left",
            path: freshPath,
            line: freshLine,
            blockId: freshBlockId,
            text: edit ? edit.after : freshFallback,
          };
        } else {
          const edit = editAt(originalPath, originalLine);
          target = {
            outcome: "left",
            path: originalPath,
            line: originalLine,
            blockId: String(task.blockId || ""),
            text: edit ? edit.after : originalText,
          };
        }
      }
    }

    if (!target.path) return null;
    return {
      key: wanted,
      outcome: target.outcome,
      label: description,
      path: target.path,
      ...(target.blockId ? { blockId: target.blockId } : {}),
      ...(typeof target.text === "string" ? { text: target.text } : {}),
      ...(Number.isInteger(target.line) ? { line: target.line } : {}),
      description,
    };
  } catch (_error) {
    return null;
  }
}

// Task Link Ctrl+Enter jump ordering: finalize in return mode so the jump
// lands only after the strike write. Returns {finalized, box, wantsReturn}.
// Walk callers that already asked for return reuse their box (nav lands via
// follow); others get a local box to land after the strike. Never throws.
async function finalizeTaskLinkCloseForJump(plugin, closed, baseContext, options) {
  const opts = options && typeof options === "object" ? options : {};
  const wantsReturn = opts.successorJumpTarget === "return";
  const callerBox = wantsReturn && opts.successorJumpBox &&
    typeof opts.successorJumpBox === "object" ? opts.successorJumpBox : null;
  const box = callerBox || {};
  const ctx = { ...baseContext, successorJumpTarget: "return", successorJumpBox: box };
  if (wantsReturn && opts.successorNoticeTarget) ctx.successorNoticeTarget = opts.successorNoticeTarget;
  if (wantsReturn && opts.successorNoticeBox) ctx.successorNoticeBox = opts.successorNoticeBox;
  try {
    const finalized = await plugin.finalizeClosedTasks(closed, ctx);
    return { finalized, box, wantsReturn };
  } catch (_error) {
    return { finalized: null, box, wantsReturn };
  }
}

async function landTaskLinkCloseJump(plugin, order, baseContext) {
  try {
    if (!order || order.wantsReturn) return order && order.box ? order.box.jump || null : null;
    const jump = order.box && order.box.jump;
    if (!jump) return null;
    await plugin.landSuccessorJump({ jump }, baseContext || {});
    return jump;
  } catch (_error) {
    return null;
  }
}

function taskLinkCloseJumpResult(order, changed) {
  const jump = order && order.box && order.box.jump;
  const out = { resolved: true, changed: !!changed };
  if (jump) out.jump = jump;
  if (order && order.finalized && order.finalized.successorNotice) {
    out.successorNotice = order.finalized.successorNotice;
  }
  return out;
}
