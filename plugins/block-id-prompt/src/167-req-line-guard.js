// Requirement-line guard for Block ID Prompt Ctrl+Shift+Enter
// (bob-cli-on.10.1.5). A req line or carried stub is never linked or
// unlinked: refuse with the contract copy before review-walk capture and
// before task-link mode can delete a stub's link. Fail open only on an
// internal error, never on a recognized req.

const BLOCK_ID_REQ_LANE_COPY =
  "Requirements have no lane or schedule — Ctrl+Shift+T makes it a task";
const BLOCK_ID_REQ_CARRIED_COPY = "Carried — open the linked task";

let blockIdReqForestCache = { text: null, forest: null };

function blockIdReqForestCached(text) {
  if (blockIdReqForestCache.text === text) {
    return blockIdReqForestCache.forest;
  }
  const forest = taskReqForest(text);
  blockIdReqForestCache = { text, forest };
  return forest;
}

function blockIdReqInfoAtLine(content, lineIndex) {
  try {
    const text = String(content == null ? "" : content);
    if (!Number.isInteger(lineIndex) || lineIndex < 0) {
      return null;
    }
    const line = taskReqDocument(text).texts[lineIndex];
    if (typeof line !== "string") {
      return null;
    }
    if (taskReqCheckboxMarkWithoutFilter(line) === null) {
      return null;
    }
    const forest = blockIdReqForestCached(text);
    for (let index = 0; index < forest.length; index += 1) {
      if (forest[index].lineIndex === lineIndex) {
        return forest[index];
      }
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function blockIdReqIsCarried(info) {
  return Boolean(
    info &&
      (info.mark === "carried" ||
        info.state === "carried" ||
        info.markChar === ">"),
  );
}

function blockIdReqRefuseCopy(info) {
  return blockIdReqIsCarried(info)
    ? BLOCK_ID_REQ_CARRIED_COPY
    : BLOCK_ID_REQ_LANE_COPY;
}

class BlockIdPromptReqLineGuardMixin {
  blockIdReqRefuseAtEditor(editor) {
    try {
      if (!editor || typeof editor.getValue !== "function") {
        return false;
      }
      const cursor =
        typeof editor.getCursor === "function" ? editor.getCursor() : null;
      if (!cursor || !Number.isInteger(cursor.line)) {
        return false;
      }
      const info = blockIdReqInfoAtLine(String(editor.getValue() || ""), cursor.line);
      if (!info) {
        return false;
      }
      new Notice(blockIdReqRefuseCopy(info));
      return true;
    } catch (_error) {
      return false;
    }
  }
}
