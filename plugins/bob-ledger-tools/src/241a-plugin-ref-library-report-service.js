// Compatibility accessors for the Ref Card scaffolding. The full shared
// report lifecycle and decoder live in 241ak-plugin-ref-library-report.js.
const REF_LIBRARY_REPORT_ARGV = Object.freeze(["ref", "list", "-A", "-R", "all", "-f", "json"]);

function refLibraryReportRow(snapshot, path) {
  try {
    if (!snapshot || typeof snapshot !== "object") return null;
    const report = snapshot.snapshot && typeof snapshot.snapshot === "object"
      ? snapshot.snapshot
      : snapshot;
    const rows = report.rowsByPath || report.rows;
    const key = refLibraryReportPath(path);
    if (rows instanceof Map) return rows.get(key) ?? null;
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      return Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}
