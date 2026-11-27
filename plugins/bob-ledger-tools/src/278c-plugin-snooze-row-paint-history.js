// Snooze history row paint for Live Preview (visual-proof phase).
// Struck history rows are provenance, never classifier membership, so the
// live row loop has no classified entry for them. This shared-scope helper
// paints them from the parsed section rows so the wake label survives.
// Contract: bob-cli `docs/snooze-marks.md`. Split from
// `278a-plugin-snooze-row-paint.js` to keep each hand-edited fragment at or
// below 1,000 lines; fragments share one script scope.
function snoozeRowPaintHistoryLive(builder, doc, model, byLine, inRange) {
  try {
    if (!builder || !doc || !model) {
      return;
    }
    const lines = typeof byLine !== "undefined" ? byLine : new Map();
    const inView = typeof inRange === "function" ? inRange : () => true;
    const parsedRows =
      model.parsed && Array.isArray(model.parsed.rows)
        ? model.parsed.rows
        : [];
    for (const parsedRow of parsedRows) {
      try {
        if (
          !parsedRow ||
          parsedRow.embedded ||
          parsedRow.kind !== "history" ||
          !Number.isInteger(parsedRow.line) ||
          parsedRow.line < 1
        ) {
          continue;
        }
        if (lines instanceof Map && lines.has(parsedRow.line)) {
          continue;
        }
        let line = null;
        try {
          line = doc.line(parsedRow.line);
        } catch (error) {
          line = null;
        }
        if (!line) {
          continue;
        }
        if (!inView(line.from)) {
          continue;
        }
        const presentation = snoozeRowPaintPresentation(
          "woken",
          null,
          typeof parsedRow.wokeHhmm === "string"
            ? parsedRow.wokeHhmm
            : null,
        );
        if (!presentation || presentation.paint === "none") {
          continue;
        }
        try {
          builder.add(
            line.from,
            line.from,
            Decoration.line({
              class:
                "bob-snooze-row bob-snooze-row--" +
                presentation.paint,
            }),
          );
        } catch (error) {
          // Line paint is best-effort.
        }
        if (presentation.timePill || presentation.statusText) {
          try {
            const chip = buildSnoozeRowChipElement(
              typeof document !== "undefined" ? document : null,
              {
                paint: presentation.paint,
                timePill: presentation.timePill,
                statusText: presentation.statusText,
              },
            );
            if (chip && typeof WidgetType === "function") {
              const widgetKey = [
                presentation.paint,
                presentation.timePill,
                presentation.statusText,
                parsedRow.line,
              ].join("|");
              const widget = new (class extends WidgetType {
                constructor() {
                  super();
                  this.key = widgetKey;
                }
                eq(other) {
                  return Boolean(other && other.key === this.key);
                }
                toDOM() {
                  return chip;
                }
              })();
              builder.add(
                line.to,
                line.to,
                Decoration.widget({ widget, side: 1 }),
              );
            }
          } catch (error) {
            // Chip paint is best-effort.
          }
        }
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    // History paint is best-effort.
  }
}
