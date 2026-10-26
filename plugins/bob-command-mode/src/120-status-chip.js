// Bob Command Mode: live status-bar chip. Runner state stays authoritative.

function cmRenderStatusChip(element, records, nowMs = Date.now(), onOpen = () => {}, progressFor = () => "") {
  if (!element) return { visible: false, runs: 0 };
  const active = (Array.isArray(records) ? records : []).filter((record) => record && (record.outcome === "running" || record.outcome === "queued"));
  if (!active.length) {
    element.style.display = "none";
    element.classList.remove("is-overdue");
    element.textContent = "";
    element.removeAttribute("title");
    return { visible: false, runs: 0 };
  }
  const ages = active.map((record) => Math.max(0, nowMs - (Date.parse(record.started_at) || nowMs)));
  if (ages.every((age) => age < 400)) {
    element.style.display = "none";
    element.classList.remove("is-overdue");
    element.textContent = "";
    element.removeAttribute("title");
    return { visible: false, runs: active.length };
  }
  const longest = Math.max(...ages);
  const overdue = active.some((record, index) => record.overdue || (
    record.effect !== "reads" && Number(record.budget_secs) > 0 && ages[index] >= Number(record.budget_secs) * 1000
  ));
  const overdueRecord = active.find((record, index) => record.overdue || (
    record.effect !== "reads" && Number(record.budget_secs) > 0 && ages[index] >= Number(record.budget_secs) * 1000
  ));
  const newest = active[active.length - 1];
  const name = active.length === 1 ? String(newest.title || newest.entry_id || "bob") : "bob ×" + active.length;
  element.style.display = "";
  element.classList.toggle("is-overdue", overdue);
  const budgetMins = overdueRecord ? Math.max(1, Math.round(Number(overdueRecord.budget_secs) / 60)) : 0;
  element.textContent = overdue
    ? name + " · still running past ~" + budgetMins + " min"
    : name + " · " + cmFormatClock(longest);
  const detail = active.map((record) => {
    const argv = Array.isArray(record.argv) ? [...record.argv] : [];
    if (argv.length && (argv[0] === "bob" || /(?:^|\/)bob$/.test(String(argv[0])))) argv.shift();
    const progress = String(progressFor(record.id) || "").trim();
    return [cmFormatArgv(["bob", ...argv]), progress ? "Last: " + progress : ""].filter(Boolean).join("\n");
  }).join("\n\n");
  element.setAttribute("title", detail);
  element.setAttribute("aria-label", "Open output for " + name);
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.onclick = () => onOpen(newest.id);
  return { visible: true, runs: active.length, overdue, runId: newest.id };
}
