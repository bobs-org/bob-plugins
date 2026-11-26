// Daily NEXT/PENDING presentation uses the dashboard section budget.
// A supplied budget (including unavailable nulls) is used as-is and
// never replaced with an ungated whole-lane fallback. Standalone
// callers without a prepared budget compute the same section through
// dashboardLaneBudgetFromTasks when Tasks data is present. The section
// excludes planned-today (`isToday || isSnoozed`); the whole-lane count
// keeps its usual lane predicate (`docs/plan.md`, "Snoozed forecast").
function unavailablePlanDashboardBudget(effective, lane) {
  return {
    section: null,
    lane: null,
    count: null,
    laneCount: null,
    cap: lane === "next" ? effective.maxNext : effective.maxPending,
    over: false,
    today: null,
  };
}

function resolvePlanDashboardBudget(
  supplied,
  taskList,
  day,
  effective,
  lane,
  isTodayPredicate,
  hasTasks,
  isSnoozedPredicate,
) {
  if (supplied !== undefined) {
    if (!supplied || typeof supplied !== "object") {
      return unavailablePlanDashboardBudget(effective, lane);
    }
    return supplied;
  }
  if (!hasTasks) {
    return unavailablePlanDashboardBudget(effective, lane);
  }
  try {
    return dashboardLaneBudgetFromTasks(
      taskList,
      day,
      effective,
      lane,
      isTodayPredicate,
      typeof isSnoozedPredicate === "function" ? isSnoozedPredicate : () => false,
    );
  } catch (error) {
    return unavailablePlanDashboardBudget(effective, lane);
  }
}
