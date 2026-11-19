"""Offline coverage and failure tests; no Bob installation or live vault required."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("coverage_audit", Path(__file__).with_name("record-card-vault-coverage.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)
        (self.vault / "movies").mkdir()
        (self.vault / "movies.md").write_text('---\ntype: "[[album]]"\n---\n')
        self.record = self.vault / "movies/a.md"
        self.record.write_text('---\ntype: "[[record]]"\nparent: "[[movies]]"\ntitle: A\nstatus: watched\n---\n')
        self.payload = {"schema_version": 1, "record": {
            "path": "movies/a.md", "identity": [{"key": k} for k in ("type", "parent", "title")],
            "properties": [{"key": "status", "state": "set"},
                           {"key": "url", "state": "none", "line": None, "raw": None}],
            "other": [], "findings": []}}
        self.calls = []

    def execute(self, argv):
        self.calls.append(argv)
        if argv == ["albums", "list"]:
            return {"exit_code": 0, "payload": {"schema_version": 1, "capabilities": ["record_values_v1"],
                "albums": [{"stem": "movies", "path": "movies.md", "records": 1}]}}
        return {"exit_code": 0, "payload": copy.deepcopy(self.payload)}

    def run_audit(self, **kwargs):
        kwargs.setdefault("workers", 1)
        return audit.audit(self.vault, self.execute, **kwargs)

    def test_healthy_and_absent_optional_schema_row(self):
        result = self.run_audit()
        self.assertTrue(result["pass"], result)
        self.assertEqual(result["totals"]["authored_keys"], 4)
        self.assertEqual(result["records"][0]["absent_schema_keys"], ["url"])
        self.assertEqual(result["stability"]["hashes_before"], result["stability"]["hashes_after"])
        self.assertEqual(self.calls, [["albums", "list"], ["records", "show", "movies", "a"]])
        self.assertNotIn("watched", json.dumps(result))

    def test_omitted_key_fails(self):
        self.payload["record"]["identity"].pop()
        self.assertEqual(self.run_audit()["error_counts"], {"missing_home": 1})

    def test_duplicate_home_fails(self):
        self.payload["record"]["other"].append({"key": "status"})
        self.assertEqual(self.run_audit()["error_counts"], {"duplicate_home": 1})

    def test_extra_authored_looking_row_fails(self):
        self.payload["record"]["other"].append({"key": "made_up"})
        self.assertIn("unexpected_home", self.run_audit()["error_counts"])

    def test_duplicate_absent_rows_fail(self):
        self.payload["record"]["properties"].append({"key": "url", "state": "none"})
        self.assertIn("duplicate_home", self.run_audit()["error_counts"])

    def test_show_failure_does_not_disappear(self):
        real = self.execute
        self.execute = lambda argv: real(argv) if argv[:2] == ["albums", "list"] else {"exit_code": 2}
        result = self.run_audit()
        self.assertEqual([result["totals"][k] for k in ("enumerated", "attempted", "succeeded", "failed")], [1, 1, 0, 1])
        self.assertIn("show_failed", result["error_counts"])

    def test_rejected_read_retains_code_without_publishing_message(self):
        real = self.execute
        self.execute = lambda argv: real(argv) if argv[:2] == ["albums", "list"] else {
            "exit_code": 2, "payload": {"error": {
                "code": "record_parent_mismatch", "message": "private value"}}}
        result = self.run_audit()
        self.assertEqual(result["records"][0]["errors"], [
            {"code": "show_failed", "bob_code": "record_parent_mismatch"}])
        self.assertEqual(result["totals"]["covered_keys"], 0)
        self.assertNotIn("private value", json.dumps(result))

    def test_timeout_reported_per_record(self):
        real = self.execute
        self.execute = lambda argv: real(argv) if argv[:2] == ["albums", "list"] else {"exit_code": None, "error": "process_timeout"}
        self.assertIn("process_timeout", self.run_audit()["error_counts"])

    def test_malformed_in_album_folder_is_counted_and_attempted(self):
        self.record.write_text('---\ntype: "[[record]]"\nvalue: [broken\n---\n')
        result = self.run_audit()
        self.assertEqual(result["totals"]["enumerated"], 1)
        self.assertEqual(result["totals"]["attempted"], 1)
        self.assertIn("malformed_frontmatter", result["error_counts"])

    def test_bad_yaml_outside_album_makes_discovery_incomplete(self):
        (self.vault / "unknown.md").write_text('---\ntype: [broken\n---\n')
        result = self.run_audit()
        self.assertIn("malformed_frontmatter", result["error_counts"])

    def test_nested_quoted_lists_and_multiline_keys(self):
        parsed = audit.frontmatter(b'---\n"type": "[[record]]"\n"a:b": {nested: [one, "two, three"]}\n? "multi key"\n: |\n  content\n---\n')
        self.assertEqual(parsed["keys"], ["type", "a:b", "multi key"])
        self.assertEqual(parsed["errors"], [])
        self.assertEqual(parsed["types"], ["[[record]]"])

    def test_empty_frontmatter_is_valid_but_not_a_record(self):
        self.assertEqual(audit.frontmatter(b"---\n---\n"), {"keys": [], "types": [], "parents": [], "errors": []})

    def test_duplicate_top_and_nested_yaml_keys(self):
        parsed = audit.frontmatter(b'---\ntype: "[[record]]"\ntype: ordinary\nextra: {a: 1, a: 2}\n---\n')
        self.assertEqual(parsed["keys"].count("type"), 2)
        self.assertEqual([e["code"] for e in parsed["errors"]], ["duplicate_yaml_key"] * 2)
        self.assertIn("[[record]]", parsed["types"])

    def test_unsupported_yaml_keys_tags_and_cycles_are_explicit(self):
        for data, code in [(b'---\n1: value\n---\n', "unsupported_yaml_key"),
                           (b'---\nfoo: !unsafe value\n---\n', "unsupported_yaml_tag"),
                           (b'---\nfoo: &self [*self]\n---\n', "yaml_alias_cycle"),
                           (b'---\n<<: {a: b}\n---\n', "unsupported_yaml_key")]:
            with self.subTest(code=code):
                self.assertIn(code, [e["code"] for e in audit.frontmatter(data)["errors"]])

    def test_misplaced_canonical_record_is_not_hidden_by_same_stem(self):
        (self.vault / "elsewhere").mkdir()
        (self.vault / "elsewhere/a.md").write_bytes(self.record.read_bytes())
        result = self.run_audit()
        self.assertEqual(result["totals"]["canonical"], 2)
        self.assertEqual(result["totals"]["attempted"], 2)
        self.assertIn("show_path_mismatch", result["error_counts"])
        self.assertIn("record_outside_album_folder", result["error_counts"])

    def test_unresolved_record_still_counts_as_failed(self):
        (self.vault / "lost.md").write_text('---\ntype: "[[record]]"\n---\n')
        result = self.run_audit()
        self.assertEqual(result["totals"]["enumerated"], 2)
        self.assertEqual(result["totals"]["failed"], 1)
        self.assertIn("unresolved_album", result["error_counts"])

    def test_album_enumeration_and_count_cross_check(self):
        (self.vault / "ghost.md").write_text('---\ntype: "[[album]]"\n---\n')
        (self.vault / "movies/b.md").write_bytes(self.record.read_bytes())
        result = self.run_audit()
        self.assertIn("album_enumeration_mismatch", result["error_counts"])
        self.assertIn("album_record_count_mismatch", result["error_counts"])

    def test_findings_require_exact_rationale_and_no_stale_allowlist(self):
        self.payload["record"]["findings"] = [{"code": "record_legacy_field", "field": "old", "severity": "warning", "message": "private data"}]
        unexpected = self.run_audit()
        self.assertFalse(unexpected["pass"])
        self.assertEqual(unexpected["totals"]["unexpected_findings"], 1)
        expected = [{"path": "movies/a.md", "code": "record_legacy_field", "field": "old", "reason": "Preserved migration metadata; cleanup is deferred."}]
        accepted = self.run_audit(expected=expected)
        self.assertTrue(accepted["pass"], accepted)
        self.assertEqual(accepted["totals"]["expected_findings"], 1)
        self.assertNotIn("private data", json.dumps(accepted))
        self.payload["record"]["findings"] = []
        self.assertIn("unused_expected_finding", self.run_audit(expected=expected)["error_counts"])
        expected[0]["reason"] = ""
        with self.assertRaises(ValueError):
            self.run_audit(expected=expected)

    def test_concurrent_change_retries_and_never_claims_original_neutrality(self):
        real = self.execute
        once = False
        def execute(argv):
            nonlocal once
            if argv[:2] == ["records", "show"] and not once:
                self.record.write_text(self.record.read_text() + "\nConcurrent body edit\n")
                once = True
            return real(argv)
        self.execute = execute
        result = self.run_audit()
        self.assertTrue(result["pass"])
        self.assertEqual(result["stability"]["attempts"], 2)
        self.assertFalse(result["stability"]["unchanged_entire_run"])
        self.assertEqual(result["stability"]["unstable_reads"][0]["changed_paths"], ["movies/a.md"])
        self.assertEqual(sum(a[:2] == ["records", "show"] for a in self.calls), 2)

    def test_persistent_change_fails_after_bounded_retries(self):
        real = self.execute
        def execute(argv):
            if argv[:2] == ["records", "show"]:
                self.record.write_text(self.record.read_text() + "\nEdit\n")
            return real(argv)
        self.execute = execute
        result = self.run_audit(retries=1)
        self.assertFalse(result["pass"])
        self.assertIn("unstable_read", result["error_counts"])
        self.assertEqual(result["stability"]["attempts"], 2)

    def test_ordinary_body_change_reuses_reads_but_rescans_all_markdown(self):
        ordinary = self.vault / "ordinary.md"
        ordinary.write_text('---\ntitle: Ordinary\n---\nFirst body\n')
        real = self.execute
        def execute(argv):
            if argv[:2] == ["records", "show"]:
                ordinary.write_text(ordinary.read_text() + "Body activity\n")
            return real(argv)
        self.execute = execute
        result = self.run_audit()
        self.assertTrue(result["pass"])
        self.assertFalse(result["stability"]["unchanged_entire_run"])
        self.assertEqual(result["stability"]["attempts"], 2)
        self.assertEqual(result["stability"]["hashes_before"], result["stability"]["hashes_after"])
        self.assertEqual(result["stability"]["record_reads"], [
            {"attempt": 1, "executed": 1, "reused": 0},
            {"attempt": 2, "executed": 0, "reused": 1}])

    def test_dependency_changes_invalidate_record_reads(self):
        for change in ("metadata", "album_body", "new_path", "removed_path", "peer_body"):
            with self.subTest(change=change):
                ordinary = self.vault / "ordinary.md"
                ordinary.write_text('---\ntitle: Original\n---\nBody\n')
                peer = self.vault / "movies/peer.md"
                peer.write_text('---\ntype: ordinary\n---\nBody\n')
                calls = []
                changed = False
                def execute(argv):
                    nonlocal changed
                    calls.append(argv)
                    if argv[:2] == ["records", "show"] and not changed:
                        changed = True
                        if change == "metadata":
                            ordinary.write_text('---\ntitle: Renamed\n---\nBody\n')
                        elif change == "album_body":
                            album = self.vault / "movies.md"
                            album.write_text(album.read_text() + "Changed schema\n")
                        elif change == "new_path":
                            (self.vault / "new.md").write_text("New link target\n")
                        elif change == "removed_path":
                            ordinary.unlink()
                        else:
                            peer.write_text(peer.read_text() + "Changed peer\n")
                    return self.execute(argv)
                result = audit.audit(self.vault, execute, workers=1)
                self.assertEqual(sum(a == ["records", "show", "movies", "a"] for a in calls), 2)
                self.assertEqual(result["stability"]["record_reads"][1]["reused"], 0)

    def test_failed_read_is_not_reused_on_retry(self):
        ordinary = self.vault / "ordinary.md"
        ordinary.write_text("Body\n")
        real = self.execute
        show_calls = 0
        def execute(argv):
            nonlocal show_calls
            if argv[:2] == ["records", "show"]:
                show_calls += 1
                if show_calls == 1:
                    ordinary.write_text("Edited body\n")
                    return {"exit_code": 2}
            return real(argv)
        self.execute = execute
        result = self.run_audit()
        self.assertTrue(result["pass"])
        self.assertEqual(show_calls, 2)

    def test_ordinary_body_churn_still_fails_when_no_snapshot_settles(self):
        ordinary = self.vault / "ordinary.md"
        ordinary.write_text("Body\n")
        real = self.execute
        def execute(argv):
            ordinary.write_text(ordinary.read_text() + "Edit\n")
            return real(argv)
        self.execute = execute
        result = self.run_audit(retries=1)
        self.assertIn("unstable_read", result["error_counts"])
        self.assertEqual(result["stability"]["record_reads"][1]["reused"], 1)

    def test_hashes_include_album_and_ordinary_markdown(self):
        (self.vault / "ordinary.md").write_text("Not a record\n")
        result = self.run_audit()
        self.assertEqual(set(result["stability"]["hashes_before"]), {"movies.md", "movies/a.md", "ordinary.md"})

    def test_parallel_reads_are_bounded_and_failed_routes_are_retried(self):
        routes = [("records", "show", "movies", str(i)) for i in range(6)]
        barrier = threading.Barrier(2, timeout=3)
        lock = threading.Lock()
        active = peak = 0
        calls = []
        def execute(argv):
            nonlocal active, peak
            with lock:
                calls.append(tuple(argv))
                active += 1
                peak = max(peak, active)
            try:
                barrier.wait()
                return {"exit_code": 2 if argv[-1] == "0" else 0, "payload": argv[-1]}
            finally:
                with lock:
                    active -= 1
        cache = {}
        results, counts = audit.read_batch(routes + routes[:1], execute, cache, "same", 2)
        self.assertEqual(peak, 2)
        self.assertCountEqual(calls, routes)
        self.assertEqual(counts, {"executed": 6, "reused": 0})
        self.assertEqual([results[r]["payload"] for r in routes], [str(i) for i in range(6)])
        retried = []
        def retry(argv):
            retried.append(tuple(argv))
            return {"exit_code": 2}
        _, counts = audit.read_batch(routes, retry, cache, "same", 2)
        self.assertEqual(retried, routes[:1])
        self.assertEqual(counts, {"executed": 1, "reused": 5})
        retried.clear()
        audit.read_batch(routes, retry, cache, "changed", 2)
        self.assertCountEqual(retried, routes)

    def test_parallel_full_audit_matches_serial_and_keeps_rejected_records(self):
        for stem in ("b", "c", "d"):
            (self.vault / f"movies/{stem}.md").write_bytes(self.record.read_bytes())
        def execute(argv):
            result = self.execute(argv)
            if argv[:2] == ["albums", "list"]:
                result["payload"]["albums"][0]["records"] = 4
            elif argv[-1] == "c":
                return {"exit_code": 2, "payload": {"error": {"code": "record_parent_mismatch"}}}
            else:
                result["payload"]["record"]["path"] = f"movies/{argv[-1]}.md"
            return result
        serial = audit.audit(self.vault, execute, workers=1)
        parallel = audit.audit(self.vault, execute, workers=3)
        for result in (serial, parallel):
            result.pop("generated_at")
            result["stability"].pop("workers")
        self.assertEqual(parallel, serial)
        self.assertEqual(parallel["totals"]["enumerated"], 4)
        self.assertEqual(parallel["totals"]["failed"], 1)
        self.assertEqual(parallel["error_counts"], {"show_failed": 1})

    def test_worker_count_is_bounded(self):
        for count in (0, 9):
            with self.assertRaises(ValueError):
                self.run_audit(workers=count)

    def test_no_symlink_following_and_no_hidden_vault_state_scan(self):
        (self.vault / "link.md").symlink_to(self.record)
        (self.vault / ".obsidian").mkdir()
        (self.vault / ".obsidian/private.md").write_text('---\ninvalid: [yaml\n---\n')
        notes, errors = audit.snapshot(self.vault)
        self.assertEqual([e["code"] for e in errors], ["symlink_markdown"])
        self.assertEqual(set(notes), {"movies.md", "movies/a.md"})

    def test_subprocess_guard_and_timeout(self):
        with self.assertRaises(ValueError):
            audit.run_bob("not-installed", self.vault, ["records", "tidy"], 1)
        with patch.object(audit.subprocess, "run", side_effect=subprocess.TimeoutExpired("bob", 2)) as run:
            result = audit.run_bob("not-installed", self.vault, ["records", "show", "movies", "a"], 2)
        self.assertEqual(result["error"], "process_timeout")
        self.assertEqual(run.call_args.kwargs["timeout"], 2)
        self.assertEqual(run.call_args.args[0][-4:], ["-b", str(self.vault), "-f", "json"])

    def test_cannot_write_report_into_vault(self):
        with self.assertRaises(SystemExit) as exited:
            audit.main(["--vault", str(self.vault), "--report", str(self.vault / "report.json")])
        self.assertEqual(exited.exception.code, 2)
        self.assertFalse((self.vault / "report.json").exists())


if __name__ == "__main__":
    unittest.main()
