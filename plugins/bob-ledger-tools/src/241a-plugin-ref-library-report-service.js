// Shared ref-library report service (bob-cli-qp ref-service): one lazily
// subscribed, stale-while-revalidate `bob ref list -A -R all -f json`
// snapshot indexed by path and shared by every mounted card. Narrow,
// debounced revalidation triggers; never spawns from paint. Later phases
// fill the lifecycle; this stub names the argv, decode, and accessors.
const REF_LIBRARY_REPORT_ARGV = Object.freeze(["ref", "list", "-A", "-R", "all", "-f", "json"]);
const REF_LIBRARY_REPORT_SCHEMA_VERSION = 1;
const REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS = 1500;

function refLibraryReportArgs() {
  return REF_LIBRARY_REPORT_ARGV.slice();
}

function refLibraryReportRow(snapshot, path) {
  try {
    if (!snapshot || typeof snapshot !== "object") return null;
    const rows = snapshot.rows;
    const key = refNoteCardPath(path);
    if (rows instanceof Map) return rows.get(key) ?? null;
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      return Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function refLibraryReportDecode(payload) {
  try {
    const data = payload && typeof payload === "object" ? payload : {};
    if (data.schema_version !== REF_LIBRARY_REPORT_SCHEMA_VERSION) return null;
    const rows = new Map();
    return Object.freeze({ rows, coverage: data.coverage ?? null, generatedAt: null });
  } catch (_) {
    return null;
  }
}

function apiRefLibrarySubscribe(subscriber) {
  try {
    if (typeof subscriber !== "function") return () => {};
    return () => {};
  } catch (_) {
    return () => {};
  }
}
