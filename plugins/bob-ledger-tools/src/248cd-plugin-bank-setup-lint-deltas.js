// Line-shift deltas between two document texts, for lint-mark mapping.
// Pure and testable: each delta marks the 1-based line where saved bytes
// changed, with the net line-count shift below it.
function bankSetupLintDeltas(beforeText, afterText) {
  const before = String(beforeText === null || beforeText === undefined ? "" : beforeText).split("\n");
  const after = String(afterText === null || afterText === undefined ? "" : afterText).split("\n");
  if (before.join("\n") === after.join("\n")) {
    return [];
  }
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix += 1;
  }
  return [{
    fromLine: prefix + 1,
    delta: (after.length - suffix) - (before.length - suffix),
  }];
}
