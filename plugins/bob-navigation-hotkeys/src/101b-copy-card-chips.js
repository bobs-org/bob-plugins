// Copy card's optional C row. The API result is a frozen v1 copy-chip
// selection; keep its literal payload and source coordinates for copying.
function buildCopyCardChipRow(spec, result) {
  const resolved = result && typeof result === "object" ? result : null;
  if (!resolved) {
    return null;
  }
  if (resolved.state === "ready") {
    const chip = resolved.chip && typeof resolved.chip === "object" ? resolved.chip : null;
    const text = chip && typeof chip.text === "string" ? chip.text : "";
    if (!chip || !/\S/.test(text)) {
      return null;
    }
    const rawLabel = typeof chip.label === "string" ? chip.label.trim() : "";
    const faceSource = rawLabel !== "" ? rawLabel : text;
    const face = copyCardMiddleTruncate(copyCardPreviewText(faceSource), 40);
    return buildCopyCardRow({
      id: spec.id,
      group: "chip",
      key: spec.key,
      label: `Chip · ${face}`,
      value: text,
      preview: copyCardPreviewText(text),
      state: "ready",
      reason: null,
      copyChip: chip,
    });
  }
  if (resolved.state === "ambiguous") {
    const count = Number.isInteger(resolved.count) ? resolved.count : 0;
    const reason = `${count} chips on this line · move onto one`;
    return buildCopyCardRow({
      id: spec.id,
      group: "chip",
      key: spec.key,
      label: "Chip",
      value: null,
      preview: reason,
      state: "unavailable",
      reason,
      isPath: false,
    });
  }
  return null;
}
