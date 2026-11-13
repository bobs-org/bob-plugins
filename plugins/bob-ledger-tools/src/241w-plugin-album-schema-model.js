// Presentation helpers for the album schema summary, chip rows, and
// YAML jump targets. Report strings stay plain text; counts are optional
// so older list JSON without report-additions still paints.
function albumHeaderSummaryText(model) {
  if (!model) return "";
  if (model.schemaInvalid) {
    const error = (model.issues || []).find((issue) => issue.severity === "error");
    return String(error?.message || "The album schema is invalid.");
  }
  if (model.emptySchema) {
    const sample = model.captureText || "Name @album/";
    return `No fields yet — add one so ${sample} can collect facts.`;
  }
  const parts = [model.schemaLabel || "Album"];
  const count = (model.fields || []).length;
  parts.push(`${count} field${count === 1 ? "" : "s"}`);
  if (model.datedNotes) parts.push("dated notes");
  if (model.groupingClause) parts.push(model.groupingClause);
  return parts.join(" · ");
}

function albumHeaderRecordCountPhrase(model) {
  const count = Number.isInteger(model?.records) ? model.records : 0;
  const noun = String(model?.noun || "record");
  const singular = String(model?.singular || noun);
  const plural = String(model?.plural || `${noun}s`);
  return `${count} ${count === 1 ? singular : plural}`;
}

function albumHeaderStatsText(model) {
  if (!model) return "";
  const parts = [albumHeaderRecordCountPhrase(model)];
  if (model.datedNotes) parts.push("dated notes");
  if (model.groupingClause) parts.push(model.groupingClause);
  return parts.join(" · ");
}

function albumHeaderKindText(field) {
  if (!field) return "";
  const bits = [];
  const kind = String(field.kind || "text");
  const hasChoices = Array.isArray(field.choices) && field.choices.length > 0;
  if (!hasChoices) {
    if (field.list) bits.push(`list of ${kind || "text"}`);
    else if (kind === "number" && (field.min != null || field.max != null)) {
      const min = field.min == null ? "…" : String(field.min);
      const max = field.max == null ? "…" : String(field.max);
      bits.push(`number ${min}–${max}`);
    } else bits.push(kind);
  }
  if (field.suggest) bits.push("suggest");
  return bits.join(" · ");
}

function albumHeaderChoiceDisplay(choice) {
  const label = String(choice?.label || choice?.value || "");
  if (!label) return "";
  return Number.isInteger(choice?.count) ? `${label} ${choice.count}` : label;
}

function albumHeaderFilledText(field, records) {
  if (!Number.isInteger(field?.filled) || !Number.isInteger(records)) return "";
  return `set on ${field.filled} of ${records}`;
}

function albumHeaderPresentField(field, model) {
  const key = String(field?.key || "");
  const indexBy = String(model?.indexBy || "");
  const facets = Array.isArray(model?.indexFacets) ? model.indexFacets : [];
  return {
    ...field,
    kindText: albumHeaderKindText(field),
    filledText: albumHeaderFilledText(field, model?.records),
    groupsIndex: Boolean(key) && key === indexBy,
    subgroupsIndex: Boolean(key) && key !== indexBy && facets.includes(key),
    choices: (Array.isArray(field?.choices) ? field.choices : []).map((choice) => ({
      ...choice,
      display: albumHeaderChoiceDisplay(choice),
    })),
  };
}

function albumHeaderYamlLine(model, target = {}) {
  if (Number.isInteger(target.line) && target.line > 0) return target.line;
  if (target.fieldKey) {
    const field = (model?.fields || []).find((item) => item.key === target.fieldKey);
    if (Number.isInteger(field?.line) && field.line > 0) return field.line;
  }
  if (target.issue) {
    if (Number.isInteger(target.issue.line) && target.issue.line > 0) return target.issue.line;
  }
  const firstIssue = (model?.issues || []).find((issue) => Number.isInteger(issue.line) && issue.line > 0);
  if (firstIssue) return firstIssue.line;
  const firstField = (model?.fields || []).find((field) => Number.isInteger(field.line) && field.line > 0);
  return firstField ? firstField.line : null;
}

function albumHeaderDefaultExpanded(model) {
  return Boolean(model && model.schemaInvalid);
}

function albumHeaderIsDesktopPlatform(platform) {
  try {
    const host = platform === undefined ? Platform : platform;
    return Boolean(host && host.isDesktopApp === true);
  } catch (_) {
    return false;
  }
}
