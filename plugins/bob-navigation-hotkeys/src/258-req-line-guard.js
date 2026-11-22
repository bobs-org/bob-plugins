// Requirement-line guard for nav task gestures (bob-cli-on.10.1.5).
// Asks the RQ twin about the cursor line. A line is a req exactly when it
// is a node of taskReqForest, so fenced, quoted, frontmatter, drawer, and
// note-nested checkboxes never are. Cache the forest per document text and
// prefilter cheaply: only a checkbox list item without #task can be a req.
// Guards fail open to today's behavior only on an internal error, never on
// a recognized req.

const NAV_REQ_LANE_COPY =
  "Requirements have no lane or schedule — Ctrl+Shift+T makes it a task";
const NAV_REQ_CARRIED_COPY = "Carried — open the linked task";

let navReqForestCache = { text: null, forest: null };

function navReqForestCached(text) {
  if (navReqForestCache.text === text) {
    return navReqForestCache.forest;
  }
  const forest = taskReqForest(text);
  navReqForestCache = { text, forest };
  return forest;
}

function navReqInfoAtLine(content, lineIndex) {
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
    const forest = navReqForestCached(text);
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

function navReqIsCarried(info) {
  return Boolean(
    info &&
      (info.mark === "carried" ||
        info.state === "carried" ||
        info.markChar === ">"),
  );
}

function navReqRefuseCopy(info) {
  return navReqIsCarried(info) ? NAV_REQ_CARRIED_COPY : NAV_REQ_LANE_COPY;
}

class BobNavigationHotkeysReqLineGuardMixin {
  navReqInfoAtCursor(editor, content, lineIndex) {
    try {
      const text =
        content != null
          ? String(content)
          : editor && typeof editor.getValue === "function"
            ? String(editor.getValue() || "")
            : "";
      let line = lineIndex;
      if (!Number.isInteger(line)) {
        const cursor = getEditorCursor(editor);
        line = cursor ? cursor.line : null;
      }
      if (!Number.isInteger(line)) {
        return null;
      }
      return navReqInfoAtLine(text, line);
    } catch (_error) {
      return null;
    }
  }

  navReqRefuseAtCursor(editor, content, lineIndex) {
    try {
      const info = this.navReqInfoAtCursor(editor, content, lineIndex);
      if (!info) {
        return false;
      }
      new Notice(navReqRefuseCopy(info));
      return true;
    } catch (_error) {
      return false;
    }
  }

  navReqRefuseTargets(content, targets) {
    try {
      const text = String(content == null ? "" : content);
      const list = Array.isArray(targets) ? targets : [];
      for (let index = 0; index < list.length; index += 1) {
        const target = list[index];
        const line =
          target && Number.isInteger(target.line) ? target.line : target;
        if (!Number.isInteger(line)) {
          continue;
        }
        const info = navReqInfoAtLine(text, line);
        if (info) {
          new Notice(navReqRefuseCopy(info));
          return true;
        }
      }
      return false;
    } catch (_error) {
      return false;
    }
  }

  // Ctrl+Shift+P and the Task Card stage shortcuts: a req line (including a
  // carried stub) opens the owning task's card, like the managed-line redirect.
  openReqOwnerTaskCard(cm, content, cursor, options = {}) {
    try {
      if (options && options.taskSession) {
        return null;
      }
      if (!cursor || !Number.isInteger(cursor.line)) {
        return null;
      }
      const info = navReqInfoAtLine(content, cursor.line);
      if (!info || !Number.isInteger(info.ownerIndex)) {
        return null;
      }
      setEditorCursorSafely(cm, info.ownerIndex, 0);
      return this.openBulletPropertyPicker(cm, { ...options });
    } catch (_error) {
      return null;
    }
  }
}
