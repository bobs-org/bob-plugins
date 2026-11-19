// Copy card's optional C row. The API result is a frozen v1 copy-chip
// selection; keep its literal payload and source coordinates for copying.
function buildCopyCardChipRow(spec, result) {
  const resolved = result && typeof result === "object" ? result : null;
  const chip = resolved && resolved.state === "ready" && resolved.chip &&
      typeof resolved.chip === "object"
    ? resolved.chip
    : null;
  const text = chip && typeof chip.text === "string" ? chip.text : "";
  if (chip && /\S/.test(text)) {
    const label = typeof chip.label === "string" ? chip.label.trim() : "";
    const payloadPreview = copyCardPreviewText(text);
    return buildCopyCardRow({
      id: spec.id,
      group: "file",
      key: spec.key,
      label: spec.label,
      value: text,
      preview: label ? `${label} · ${payloadPreview}` : payloadPreview,
      state: "ready",
      reason: null,
      copyChip: chip,
    });
  }

  let reason = resolved && typeof resolved.reason === "string"
    ? resolved.reason
    : null;
  if (!reason && resolved && resolved.state === "ambiguous") {
    const count = Number.isInteger(resolved.count) ? resolved.count : 0;
    reason = `${count} chips on this line · move onto one`;
  }
  if (!reason) {
    reason = "No copy chip at the cursor";
  }
  return buildCopyCardRow({
    id: spec.id,
    group: "file",
    key: spec.key,
    label: spec.label,
    value: null,
    preview: reason,
    state: "unavailable",
    reason,
    isPath: false,
  });
}
