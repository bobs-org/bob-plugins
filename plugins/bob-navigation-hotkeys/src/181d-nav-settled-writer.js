// Shared final-write helpers for navigation dependency and relation writers.
// Callers stage the complete gesture before handing it to taskSettle.
function navApplySettledEditorPostimage(plugin, editor, path, expected, contents, options = {}) {
  const before = String(expected == null ? "" : expected);
  const staged = String(contents == null ? "" : contents);
  if (plugin && typeof plugin.applyNavSettledEditorWrite === "function") {
    let outcome = null;
    try {
      outcome = plugin.applyNavSettledEditorWrite(editor, path, {
        expected: before,
        contents: staged,
        cursor: options.cursor || null,
        identity: options.identity || null,
        annotation: options.annotation || null,
        today: options.today,
      });
    } catch (_error) {
      outcome = null;
    }
    const live = editor && typeof editor.getValue === "function"
      ? String(editor.getValue() || "")
      : staged;
    return Object.freeze({
      ok: Boolean(outcome && outcome.applied === true),
      contents: outcome && typeof outcome.contents === "string" ? outcome.contents : live,
      outcome,
    });
  }
  const ok = applyEditorContentTransaction(
    editor,
    before,
    staged,
    options.cursor || null,
    options.annotation || null,
  );
  return Object.freeze({
    ok,
    contents: editor && typeof editor.getValue === "function"
      ? String(editor.getValue() || "")
      : staged,
    outcome: null,
  });
}

function navPrepareSettledFilePostimage(plugin, path, contents, options = {}) {
  const staged = String(contents == null ? "" : contents);
  try {
    const prepared = plugin && typeof plugin.prepareNavSettledFilePostimage === "function"
      ? plugin.prepareNavSettledFilePostimage(path, staged, options)
      : null;
    if (prepared && typeof prepared.contents === "string") {
      return prepared;
    }
  } catch (_error) {
    // A failed or unavailable provider preserves the existing gesture write.
  }
  return Object.freeze({ contents: staged, changed: false, lineMap: Object.freeze({}), provider: "none" });
}

async function navApplySettledVaultPostimage(plugin, vault, file, path, expected, contents, options = {}) {
  const before = String(expected == null ? "" : expected);
  const prepared = navPrepareSettledFilePostimage(plugin, path, contents, options);
  let applied = false;
  try {
    await vault.process(file, (data) => {
      if (String(data || "") !== before) return data;
      applied = true;
      return prepared.contents;
    });
  } catch (_error) {
    applied = false;
  }
  return Object.freeze({
    ok: applied,
    contents: prepared.contents,
    provider: prepared.provider || "none",
  });
}
