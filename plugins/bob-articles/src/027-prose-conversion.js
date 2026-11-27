const ARTICLE_PROSE_CONVERSION_SCHEMA_VERSION = 1;
const ARTICLE_PROSE_CONVERSION_PREVIEW_TIMEOUT_MS = 10000;
const ARTICLE_PROSE_CONVERSION_WRITE_TIMEOUT_MS = 30000;

// Marker searched by the prose-sections epic: bob-prose-sections-v1
function articleDecodeProseConversion(stdout) {
  let value;
  try {
    value = JSON.parse(String(stdout || ""));
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob returned invalid prose-conversion JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "bad-shape", message: "bob returned an invalid prose-conversion response." };
  }
  if (value.schema_version !== ARTICLE_PROSE_CONVERSION_SCHEMA_VERSION) {
    return { ok: false, code: "schema-mismatch", message: "bob returned an unsupported prose-conversion version." };
  }
  if (value.contract !== "prose-conversion") {
    return { ok: false, code: "contract-mismatch", message: "bob returned an unsupported prose-conversion contract." };
  }
  if (
    !["extract", "inline"].includes(value.command) ||
    !["preview", "written", "refused"].includes(value.status) ||
    !Array.isArray(value.changes) || !Array.isArray(value.findings) ||
    !value.counts || typeof value.counts !== "object" || Array.isArray(value.counts)
  ) {
    return { ok: false, code: "bad-shape", message: "bob returned an incomplete prose-conversion response." };
  }
  if (value.status !== "refused" && typeof value.fingerprint !== "string") {
    return { ok: false, code: "bad-shape", message: "bob returned a prose conversion without a fingerprint." };
  }
  if (value.status === "refused" && (!value.refusal || typeof value.refusal !== "object")) {
    return { ok: false, code: "bad-shape", message: "bob returned a prose refusal without its reason." };
  }
  return { ok: true, plan: value };
}

function articleProseConversionArgs(command, path, options = {}) {
  const args = ["prose", command, path];
  if (command === "extract" && Number.isInteger(options.line) && options.line > 0) {
    args.push("-l", String(options.line));
  }
  if (options.write === true) {
    args.push("-w");
    if (typeof options.expect === "string" && options.expect) args.push("-e", options.expect);
  }
  if (command === "extract" && typeof options.name === "string" && options.name.trim()) {
    args.push("-n", options.name.trim());
  }
  args.push("-f", "json");
  return args;
}

function articleProseConversionRefusalText(plan) {
  const refusal = plan && plan.refusal || {};
  return [refusal.message, refusal.hint].filter((part) => typeof part === "string" && part.trim()).join("\n");
}

function articleProseConversionSummary(plan) {
  const counts = plan && plan.counts || {};
  const parts = [];
  if (Number.isFinite(counts.notes)) parts.push(`${counts.notes} notes`);
  if (Number.isFinite(counts.links)) parts.push(`${counts.links} links repaired`);
  if (Number.isFinite(counts.layout)) parts.push(`${counts.layout} layout edits`);
  if (Number.isFinite(counts.replaced)) parts.push(`${counts.replaced} numbers replaced`);
  return parts.join(" · ");
}
