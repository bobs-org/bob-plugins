class BobLedgerToolsPlanBudgetOffClockMixin {
  planBudgetOffClockPredicate(dailyPath, content) {
    try {
      const sourcePath = String(dailyPath || "");
      const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
      const memo = new Map();
      let canonicalDaily = null;
      try {
        canonicalDaily = planCanonicalTarget("", sourcePath);
      } catch (error) {
        canonicalDaily = null;
      }
      return (target, blockId) => {
        try {
          const key = `${String(target || "")}\u0000${String(blockId || "")}`;
          if (memo.has(key)) {
            return memo.get(key);
          }
          let pathPart = String(target || "");
          if (canonicalDaily !== null && pathPart === canonicalDaily) {
            pathPart = "";
          }
          const link = {
            pathPart,
            blockId: String(blockId || ""),
            token: `[[${pathPart}#^${String(blockId || "")}]]`,
          };
          const facts = pomodoroClockLinkFacts(
            lines,
            [link],
            (item) =>
              this.pomodoroClockResolveTaskLineFrom(item, sourcePath),
            (item, line) =>
              this.pomodoroClockResolveLinkClockFrom(item, line, sourcePath),
          );
          const off =
            !!(facts && facts[0] && facts[0].offClock === true);
          memo.set(key, off);
          return off;
        } catch (error) {
          return false;
        }
      };
    } catch (error) {
      return () => false;
    }
  }
}
