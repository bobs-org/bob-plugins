// Copy card and Bob Copy Chips share this synchronous, pure task resolver.
function createCopyCardTaskScopeApi() {
  return Object.freeze({
    version: 1,
    at(request) {
      try {
        const req = request && typeof request === "object" ? request : {};
        const lines = req.lines;
        const line = req.line;
        if (
          !Array.isArray(lines) ||
          !Number.isInteger(line) ||
          line < 0 ||
          line >= lines.length
        ) {
          return null;
        }
        const cursor = Object.freeze({ line, ch: 0 });
        const task = resolveCopyCardTask(lines, [
          Object.freeze({ anchor: cursor, head: cursor }),
        ]);
        if (!task || (task.state !== "ready" && task.state !== "no-id")) {
          return null;
        }
        const scopeLines = copyCardTaskScopeLines(lines, task.line);
        if (!scopeLines.includes(line)) return null;
        return Object.freeze({ ownerLine: task.line, lines: scopeLines });
      } catch (_error) {
        return null;
      }
    },
  });
}
