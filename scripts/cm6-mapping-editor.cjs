// An editor double with CodeMirror 6's position mapping. The plain
// `TransactionEditor` doubles keep the cursor when a transaction carries no
// `selection`; real CM6 maps it through the changes with `assoc = -1`, which
// sends any position inside a replaced range to the start of that range. That
// difference hid the whole-document-replacement bug (cursor and viewport jump
// to the top of the note), so tests of cursor and viewport behaviour use this.
//
// Changes arrive in original-document coordinates (`{line, ch}` pairs), like
// Obsidian's `editor.transaction`. `scrollAnchorLine` tracks the line at the
// top of the viewport the way CM6's scroll anchor does: the start of that line
// mapped through the same changes.

class Cm6MappingEditor {
  constructor(content, cursor = { line: 0, ch: 0 }, scrollAnchorLine = 0) {
    this.content = String(content);
    this.cursor = { ...cursor };
    this.scrollAnchorLine = scrollAnchorLine;
    this.transactions = [];
    this.undoGroups = 0;
  }

  getValue() {
    return this.content;
  }

  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }

  lineCount() {
    return this.content.split(/\r?\n/).length;
  }

  lastLine() {
    return this.lineCount() - 1;
  }

  getCursor() {
    return { ...this.cursor };
  }

  setCursor(lineOrPosition, ch) {
    this.cursor =
      typeof lineOrPosition === "object"
        ? { ...lineOrPosition }
        : { line: lineOrPosition, ch };
  }

  getScrollInfo() {
    return { left: 0, top: this.scrollAnchorLine * 20 };
  }

  scrollTo() {}

  offsetOf(position, content = this.content) {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    return (
      content
        .split(/\r?\n/)
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + newline.length, 0) +
      position.ch
    );
  }

  positionOf(offset, content = this.content) {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    let start = 0;
    const lines = content.split(/\r?\n/);
    for (let line = 0; line < lines.length; line += 1) {
      const end = start + lines[line].length;
      if (offset <= end) {
        return { line, ch: offset - start };
      }
      start = end + newline.length;
    }
    const last = lines.length - 1;
    return { line: last, ch: lines[last].length };
  }

  transaction(transaction) {
    this.transactions.push(JSON.parse(JSON.stringify(transaction)));
    const changes = (transaction.changes || [])
      .map((change) => ({
        from: this.offsetOf(change.from),
        to: this.offsetOf(change.to || change.from),
        text: String(change.text),
      }))
      .sort((left, right) => left.from - right.from || left.to - right.to);
    for (let index = 1; index < changes.length; index += 1) {
      if (changes[index].from < changes[index - 1].to) {
        throw new Error("overlapping editor changes");
      }
    }
    if (changes.length > 0) {
      this.undoGroups += 1;
    }

    // CM6 `ChangeSet.mapPos(pos, -1)`: before a pure insertion stays before it;
    // inside or at the start of a non-empty replaced range maps to its start;
    // at its end maps after the inserted text.
    const mapPos = (pos) => {
      let delta = 0;
      for (const change of changes) {
        const length = change.to - change.from;
        if (pos < change.from) break;
        if (change.to > pos || (change.to === pos && length === 0)) {
          return change.from + delta;
        }
        delta += change.text.length - length;
      }
      return pos + delta;
    };
    const cursorOffset = mapPos(this.offsetOf(this.cursor));
    const anchorOffset = mapPos(
      this.offsetOf({ line: this.scrollAnchorLine, ch: 0 }),
    );

    let next = "";
    let at = 0;
    for (const change of changes) {
      next += this.content.slice(at, change.from) + change.text;
      at = change.to;
    }
    next += this.content.slice(at);
    this.content = next;

    this.scrollAnchorLine = this.positionOf(anchorOffset).line;
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    } else {
      this.cursor = this.positionOf(cursorOffset);
    }
  }
}

module.exports = { Cm6MappingEditor };
