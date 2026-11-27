// Section-header jump and the unbound Show section map peek. Lives in its
// own fragment so 610 stays under the 1000-line cap. Jump first, map second.
function sectionMapJumpWasWrapped(entries, cursorLine, targetLine, direction) {
  if (!Array.isArray(entries) || entries.length < 2) return false;
  if (!Number.isFinite(cursorLine) || !Number.isFinite(targetLine)) return false;
  if (direction > 0) return !(targetLine > cursorLine);
  if (direction < 0) return !(targetLine < cursorLine);
  return false;
}

function sectionMapFallbackScroll(editor, targetLine) {
  if (!editor || typeof editor.scrollIntoView !== "function") return false;
  const position = { line: targetLine, ch: 0 };
  try {
    editor.scrollIntoView({ from: position, to: position }, true);
    return true;
  } catch (_error) {
    try {
      editor.scrollIntoView(position);
      return true;
    } catch (_ignored) {
      return false;
    }
  }
}

class BobNavigationHotkeysSectionJumpMixin {
  jumpToSectionHeader(editor, direction, ctx) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    const lines = String(editor.getValue()).split(/\r?\n/);
    let entries;
    try {
      entries = typeof this.getSectionMapHeadingEntries === "function"
        ? this.getSectionMapHeadingEntries(editor, lines)
        : getSectionHeadingEntries(lines);
    } catch (_error) {
      entries = getSectionHeadingEntries(lines);
    }
    const targetLine = getSectionHeaderJumpLineFromEntries(
      entries,
      cursor.line,
      direction,
    );

    if (targetLine === null) {
      new Notice(
        direction < 0 ? "No previous section header" : "No next section header",
      );
      return false;
    }

    const wrapped = sectionMapJumpWasWrapped(
      entries,
      cursor.line,
      targetLine,
      direction,
    );

    const skipMap = sectionMapIsMobile();
    if (!skipMap && typeof this.armSectionMapSelection === "function") {
      try {
        this.armSectionMapSelection(editor, targetLine);
      } catch (_error) {
        // Map arming is optional; the jump still moves the cursor.
      }
    }

    if (!setEditorCursorWithoutScroll(editor, { line: targetLine, ch: 0 })) {
      new Notice("No active markdown editor");
      return false;
    }

    if (!scrollEditorLineToTop(editor, targetLine)) {
      sectionMapFallbackScroll(editor, targetLine);
    }

    if (typeof this.flashEditorLandingLine === "function") {
      try {
        this.flashEditorLandingLine(editor, targetLine);
      } catch (_error) {
        // The flash is best-effort; the cursor already moved.
      }
    }

    if (!skipMap) {
      try {
        if (typeof this.showSectionMapAfterJump === "function") {
          this.showSectionMapAfterJump(editor, ctx, {
            fromLine: cursor.line,
            cursorLine: targetLine,
            direction,
            wrapped,
            entries,
            lines,
          });
        }
      } catch (_error) {
        // A map failure never blocks, alters, or undoes a jump, and never
        // becomes a toast.
      }
    }

    return true;
  }

  showSectionMap(editor, ctx) {
    const cursor = getEditorCursor(editor);
    if (!cursor || !editor || typeof editor.getValue !== "function") {
      new Notice("No active markdown editor");
      return false;
    }

    const lines = String(editor.getValue()).split(/\r?\n/);
    let entries;
    try {
      entries = typeof this.getSectionMapHeadingEntries === "function"
        ? this.getSectionMapHeadingEntries(editor, lines)
        : getSectionHeadingEntries(lines);
    } catch (_error) {
      entries = getSectionHeadingEntries(lines);
    }

    if (!entries.length) {
      new Notice("No section headers");
      return false;
    }

    if (sectionMapIsMobile()) return true;

    if (typeof this.armSectionMapSelection === "function") {
      try {
        this.armSectionMapSelection(editor, cursor.line);
      } catch (_error) {
        // Peek arming is optional and never moves the cursor.
      }
    }

    try {
      if (typeof this.showSectionMapPeek === "function") {
        this.showSectionMapPeek(editor, ctx, {
          cursorLine: cursor.line,
          entries,
          lines,
        });
      }
    } catch (_error) {
      // Peek failures never move the cursor and never become a toast.
    }

    return true;
  }
}
