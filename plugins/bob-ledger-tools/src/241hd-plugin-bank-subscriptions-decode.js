// JSON boundaries for the bank subscription report and the Category card's
// explicit records-new action. Both use argv-based bobSpawnJson callers.

function bankDecodeSubscriptions(stdout, stderr) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_) {
    return bankFail("bad-json", "bob bank subscriptions returned output that is not JSON.", stderr);
  }
  if (!bankJsonObject(body)) {
    return bankFail("bad-shape", "bob bank subscriptions returned an unexpected JSON shape.", stderr);
  }
  if (body.schema_version !== 1) {
    return bankFail("schema-mismatch", `bob bank subscriptions returned schema ${String(body.schema_version)}.`, stderr);
  }
  if (body.ok !== true) {
    const inner = bankJsonObject(body.error) ? body.error : {};
    return bankFail(
      bankText(inner.code) || "bob-error",
      bankText(inner.message) || (typeof body.error === "string" && body.error) || "bob bank subscriptions reported an error.",
      stderr,
    );
  }
  if (body.teaching_empty !== true && !Array.isArray(body.subscriptions)) {
    return bankFail("bad-shape", "bob bank subscriptions returned no records list.", stderr);
  }
  const subscriptions = (Array.isArray(body.subscriptions) ? body.subscriptions : [])
    .filter((entry) => bankJsonObject(entry) && bankText(entry.path) && bankText(entry.title));
  return { ok: true, report: { ...body, command: "subscriptions", subscriptions } };
}

function bankDecodeRecordCreation(stdout, stderr, exitCode = null) {
  let body = null;
  try {
    body = JSON.parse(String(stdout === undefined ? "" : stdout));
  } catch (_) {
    return bankFail("bad-json", "bob records new subscription returned output that is not JSON.", stderr);
  }
  if (!bankJsonObject(body)) {
    return bankFail("bad-shape", "bob records new subscription returned an unexpected JSON shape.", stderr);
  }
  const path = bankText(body.path);
  const validPath = path && /^subscriptions\/[^/\\]+\.md$/i.test(path) && !path.includes("..")
    ? path
    : null;
  if ((exitCode === 0 || exitCode === null) && body.status === "written" && validPath) {
    return { ok: true, report: { ...body, path: validPath } };
  }
  const inner = bankJsonObject(body.error) ? body.error : {};
  return bankFail(
    bankText(inner.code) || bankText(body.code) || "record-create-failed",
    bankText(inner.message) || bankText(body.message) || "bob records new subscription did not create a record.",
    stderr,
  );
}
