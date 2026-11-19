#!/usr/bin/env python3
"""Read-only Record Card key coverage. Requires Python 3 and PyYAML.

Only `bob albums list` and `bob records show` are executed. Reports contain paths,
keys, hashes and finding codes, never frontmatter values or subprocess output.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode


def digest(data):
    return hashlib.sha256(data).hexdigest()


def problem(code, **detail):
    return {"code": code, **detail}


def frontmatter(data):
    """Compose YAML nodes: retain duplicate keys without constructing user objects."""
    result = {"keys": [], "types": [], "parents": [], "errors": []}
    try:
        lines = data.decode("utf-8-sig").splitlines()
    except UnicodeError:
        result["errors"].append(problem("invalid_utf8"))
        return result
    if not lines or lines[0].strip() != "---":
        return result
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        result["errors"].append(problem("unclosed_frontmatter"))
        return result
    try:
        node = yaml.compose("\n".join(lines[1:end]), Loader=yaml.SafeLoader)
    except yaml.YAMLError as error:
        mark = getattr(error, "problem_mark", None)
        result["errors"].append(problem("malformed_frontmatter", line=mark.line + 2 if mark else None))
        return result
    if node is None:  # An empty YAML document has no authored keys.
        return result
    if not isinstance(node, MappingNode):
        result["errors"].append(problem("frontmatter_not_mapping"))
        return result

    def walk(value, ancestors):
        if id(value) in ancestors:
            result["errors"].append(problem("yaml_alias_cycle"))
            return
        ancestors = ancestors | {id(value)}
        if isinstance(value, MappingNode):
            seen = set()
            for key, child in value.value:
                if not isinstance(key, ScalarNode) or key.tag != "tag:yaml.org,2002:str":
                    result["errors"].append(problem("unsupported_yaml_key", line=key.start_mark.line + 2))
                elif key.value in seen:
                    result["errors"].append(problem("duplicate_yaml_key", key=key.value, line=key.start_mark.line + 2))
                else:
                    seen.add(key.value)
                walk(child, ancestors)
        elif isinstance(value, SequenceNode):
            for child in value.value:
                walk(child, ancestors)
        elif value.tag not in {
            "tag:yaml.org,2002:str", "tag:yaml.org,2002:null", "tag:yaml.org,2002:bool",
            "tag:yaml.org,2002:int", "tag:yaml.org,2002:float", "tag:yaml.org,2002:timestamp",
        }:
            result["errors"].append(problem("unsupported_yaml_tag", line=value.start_mark.line + 2))

    walk(node, set())
    for key, value in node.value:
        if isinstance(key, ScalarNode) and key.tag == "tag:yaml.org,2002:str":
            result["keys"].append(key.value)
            if isinstance(value, ScalarNode) and value.tag == "tag:yaml.org,2002:str":
                if key.value == "type":
                    result["types"].append(value.value.strip())
                if key.value == "parent":
                    result["parents"].append(value.value.strip())
    return result


def snapshot(vault):
    """Include non-hidden Markdown everywhere, not just successful Bob reads."""
    notes, errors = {}, []
    def onerror(error):
        errors.append(problem("scan_failed", path=os.path.relpath(error.filename, vault)))
    for directory, dirs, files in os.walk(vault, followlinks=False, onerror=onerror):
        for name in list(dirs):
            full = Path(directory, name)
            if name.startswith("."):
                dirs.remove(name)
            elif full.is_symlink():
                errors.append(problem("symlink_directory", path=full.relative_to(vault).as_posix()))
                dirs.remove(name)
        for name in sorted(files):
            if name.startswith(".") or not name.endswith(".md"):
                continue
            full = Path(directory, name)
            relative = full.relative_to(vault).as_posix()
            if full.is_symlink():
                errors.append(problem("symlink_markdown", path=relative))
                continue
            try:
                data = full.read_bytes()
                notes[relative] = {"sha256": digest(data),
                                   "frontmatter_sha256": frontmatter_digest(data),
                                   **frontmatter(data)}
            except OSError:
                errors.append(problem("read_failed", path=relative))
    return dict(sorted(notes.items())), errors


def frontmatter_digest(data):
    """Hash all metadata bytes, conservatively hashing invalid/unclosed documents."""
    try:
        lines = data.decode("utf-8-sig").splitlines(keepends=True)
    except UnicodeError:
        return digest(data)
    if not lines or lines[0].strip() != "---":
        return digest(b"")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    return digest("".join(lines[:end + 1]).encode()) if end is not None else digest(data)


def read_dependencies(notes, albums, candidates):
    """Only ordinary-note body changes permit reuse within this invocation.

    Every path and every frontmatter byte participates (including link resolution
    and album ownership inputs), as do complete album/record bytes (schema, peer
    suggestions and record-body findings). Any such change invalidates all reads.
    The next full scan still has to settle, so reuse never hides vault activity.
    """
    inputs = [(p, n["sha256"] if p in candidates or p.removesuffix(".md") in albums
               else n["frontmatter_sha256"]) for p, n in sorted(notes.items())]
    return digest(json.dumps([str(datetime.now().astimezone().date()), inputs]).encode())


def run_bob(binary, vault, args, timeout):
    """Fixed read-only argv; do not leak values from stdout/stderr into reports."""
    allowed = args[:2] in (["albums", "list"], ["records", "show"])
    if not allowed:
        raise ValueError("Only list/show reads are allowed")
    try:
        proc = subprocess.run(
            [str(binary), *args, "-b", str(vault), "-f", "json"],
            env={**os.environ, "BOB_DIR": str(vault), "NO_COLOR": "1"},
            capture_output=True, timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return {"exit_code": None, "error": "process_timeout"}
    except OSError:
        return {"exit_code": None, "error": "process_launch_failed"}
    try:
        payload = json.loads(proc.stdout)
    except (ValueError, UnicodeError):
        return {"exit_code": proc.returncode, "error": "invalid_json"}
    return {"exit_code": proc.returncode, "payload": payload}


def coverage(keys, record):
    errors, homes, optional = [], {}, []
    authored = set(keys)
    for home in ("properties", "identity", "other"):
        rows = record.get(home)
        if not isinstance(rows, list):
            errors.append(problem("invalid_home", home=home))
            continue
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("key"), str):
                errors.append(problem("invalid_home_row", home=home))
                continue
            key = row["key"]
            homes.setdefault(key, []).append(home)
            if key not in authored:
                # Optional absent schema rows are placeholders, not authored keys.
                if (home == "properties" and row.get("state") in ("none", "missing")
                        and row.get("line") is None and row.get("raw") is None):
                    optional.append(key)
                else:
                    errors.append(problem("unexpected_home", key=key, home=home))
    for key in sorted(authored):
        count = len(homes.get(key, []))
        if count == 0:
            errors.append(problem("missing_home", key=key))
        elif count > 1:
            errors.append(problem("duplicate_home", key=key, homes=homes[key]))
    # Duplicate placeholders still indicate a malformed response.
    for key in sorted(set(optional)):
        if len(homes[key]) > 1:
            errors.append(problem("duplicate_home", key=key, homes=homes[key]))
    return {"keys": sorted(authored), "homes": homes, "absent_schema_keys": sorted(set(optional)), "errors": errors}


def validate_expectations(rows):
    if not isinstance(rows, list):
        raise ValueError("Expected findings must be a JSON array")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "code", "field", "reason"}:
            raise ValueError("Each expected finding needs path, code, field, reason")
        if any(not isinstance(row[k], str) or not row[k].strip() for k in ("path", "code", "reason")):
            raise ValueError("Expected finding path, code and reason must be nonempty strings")
        if row["field"] is not None and not isinstance(row["field"], str):
            raise ValueError("Expected finding field must be a string or null")
        key = (row["path"], row["code"], row["field"])
        if key in seen or "*" in row["path"]:
            raise ValueError("Expected findings must be unique exact paths, never wildcards")
        seen.add(key)
    return { (r["path"], r["code"], r["field"]): r["reason"] for r in rows }


def record_route(relative, note, albums):
    folder = relative.split("/")[0] if "/" in relative else ""
    parent = next((p[2:-2].split("|")[0].removesuffix(".md") for p in note["parents"]
                   if p.startswith("[[") and p.endswith("]]")), "")
    album = folder if folder in albums else parent
    return folder, album


def read_batch(requests, execute, cache, signature, workers):
    """Read independent routes concurrently; collect/cache results on one thread.

    Deduplicate routes, not records: each discovered path is still inspected, so a
    misplaced same-stem record cannot disappear behind a successful routed read.
    Cache keys and final snapshot requirements are identical to serial reads.
    """
    routes = sorted(set(requests))
    pending = [route for route in routes if (signature, route) not in cache]
    results = {route: cache[(signature, route)] for route in routes if (signature, route) in cache}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for route, result in zip(pending, pool.map(lambda route: execute(list(route)), pending)):
            results[route] = result
            if result.get("exit_code") == 0 and not result.get("error"):
                cache[(signature, route)] = result
    return results, {"executed": len(pending), "reused": len(routes) - len(pending)}


def inspect_record(relative, note, albums, execute, expectations, used):
    folder, album = record_route(relative, note, albums)
    errors = list(note["errors"])
    canonical = "[[record]]" in note["types"]
    if not canonical:
        errors.append(problem("noncanonical_folder_occupant"))
    if folder not in albums or relative.count("/") != 1:
        errors.append(problem("record_outside_album_folder"))
    if not album or album not in albums:
        errors.append(problem("unresolved_album"))
    row = {"path": relative, "album": album or None, "canonical": canonical,
           "sha256_before": note["sha256"], "errors": errors, "attempted": False,
           "show_succeeded": False, "findings": [], "keys": sorted(set(note["keys"]))}
    # Even bad YAML and misplaced files get a read attempt when a route is known.
    if album not in albums:
        return row
    row["attempted"] = True
    result = execute(["records", "show", album, Path(relative).stem])
    row["exit_code"] = result["exit_code"]
    payload = result.get("payload")
    if result.get("error") or result["exit_code"] != 0:
        detail = {}
        rejection = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(rejection, dict) and isinstance(rejection.get("code"), str):
            detail["bob_code"] = rejection["code"]
        errors.append(problem(result.get("error", "show_failed"), **detail))
        return row
    if not isinstance(payload, dict) or payload.get("schema_version") != 1 or not isinstance(payload.get("record"), dict):
        errors.append(problem("invalid_show_payload"))
        return row
    record = payload["record"]
    if record.get("path") != relative:
        errors.append(problem("show_path_mismatch", returned_path=record.get("path")))
        return row
    row["show_succeeded"] = True
    checked = coverage(note["keys"], record)
    errors.extend(checked.pop("errors"))
    row.update(checked)
    findings = record.get("findings")
    if not isinstance(findings, list):
        errors.append(problem("invalid_findings"))
        return row
    for finding in findings:
        if not isinstance(finding, dict) or not isinstance(finding.get("code"), str):
            errors.append(problem("invalid_finding"))
            continue
        key = (relative, finding["code"], finding.get("field"))
        reason = expectations.get(key)
        item = {"code": finding["code"], "field": finding.get("field"),
                "severity": finding.get("severity"), "expected": reason is not None}
        if reason:
            item["reason"] = reason
            used.add(key)
        else:
            errors.append(problem("unexpected_finding", finding_code=finding["code"], field=finding.get("field")))
        row["findings"].append(item)
    return row


def audit(vault, execute, expected=(), retries=2, scan=snapshot, workers=8):
    if not 1 <= workers <= 8:
        raise ValueError("workers must be in [1, 8]")
    expectations = validate_expectations(list(expected))
    unstable = []
    read_cache, read_attempts = {}, []
    for attempt in range(retries + 1):
        before, scan_errors = scan(vault)
        listed = execute(["albums", "list"])
        errors = list(scan_errors)
        payload = listed.get("payload")
        album_rows = payload.get("albums") if isinstance(payload, dict) else None
        if listed.get("error") or listed["exit_code"] != 0 or not isinstance(album_rows, list):
            errors.append(problem("album_list_failed", cause=listed.get("error"), exit_code=listed["exit_code"]))
            album_rows = []
        elif payload.get("schema_version") != 1 or "record_values_v1" not in payload.get("capabilities", []):
            errors.append(problem("missing_record_values_capability"))
        declared = {p[:-3] for p, n in before.items() if "/" not in p and "[[album]]" in n["types"]}
        reported = set()
        counts = {}
        for album in album_rows:
            if (not isinstance(album, dict) or not isinstance(album.get("stem"), str)
                    or not album["stem"] or "/" in album["stem"]
                    or album.get("path") != album["stem"] + ".md"):
                errors.append(problem("invalid_album_payload"))
                continue
            stem = album["stem"]
            if stem in reported:
                errors.append(problem("duplicate_album", album=stem))
            reported.add(stem)
            counts[stem] = album.get("records")
        for album in sorted(declared ^ reported):
            errors.append(problem("album_enumeration_mismatch", album=album, declared=album in declared, reported=album in reported))
        albums = declared | reported
        candidates = {p: n for p, n in before.items() if "[[record]]" in n["types"]
                      or ("/" in p and p.split("/")[0] in albums)}
        for relative, note in before.items():
            if relative not in candidates:
                errors.extend({**e, "path": relative} for e in note["errors"])
        used = set()
        signature = read_dependencies(before, albums, candidates)
        requests = [("records", "show", album, Path(p).stem) for p, n in candidates.items()
                    for _, album in [record_route(p, n, albums)] if album in albums]
        results, counts_this_attempt = read_batch(requests, execute, read_cache, signature, workers)
        read_attempts.append({"attempt": attempt + 1, **counts_this_attempt})
        def read_record(argv):
            return results[tuple(argv)]
        rows = [inspect_record(p, n, albums, read_record, expectations, used) for p, n in candidates.items()]
        after, after_errors = scan(vault)
        changed = sorted(p for p in before.keys() | after.keys()
                         if before.get(p, {}).get("sha256") != after.get(p, {}).get("sha256"))
        if changed or after_errors != scan_errors:
            unstable.append({"attempt": attempt + 1, "changed_paths": changed,
                             "scan_errors_changed": after_errors != scan_errors})
            if attempt < retries:
                continue
            errors.append(problem("unstable_read", paths=changed))
        for row in rows:
            row["sha256_after"] = after.get(row["path"], {}).get("sha256")
        for key in sorted(expectations.keys() - used, key=str):
            errors.append(problem("unused_expected_finding", path=key[0], finding_code=key[1], field=key[2]))
        album_summary = []
        for album in sorted(albums):
            occupants = [r for r in rows if r["path"].startswith(album + "/") and r["path"].count("/") == 1]
            canonical = sum(r["canonical"] for r in occupants)
            if album in counts and counts[album] != len(occupants):
                errors.append(problem("album_record_count_mismatch", album=album, reported=counts[album], observed=len(occupants)))
            album_summary.append({"album": album, "folder_records": len(occupants),
                                  "canonical_records": canonical, "reported_records": counts.get(album)})
        error_counts = Counter(e["code"] for e in errors)
        error_counts.update(e["code"] for row in rows for e in row["errors"])
        finding_counts = Counter(f["code"] for row in rows for f in row["findings"])
        hashes_before = {p: n["sha256"] for p, n in before.items()}
        hashes_after = {p: n["sha256"] for p, n in after.items()}
        return {
            "schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
            "pass": not error_counts, "read_only_commands": ["bob albums list", "bob records show"],
            "scope": "All non-hidden .md files; symlinks refused; album folders cross-checked",
            "totals": {"markdown_scanned": len(before), "enumerated": len(rows),
                       "canonical": sum(r["canonical"] for r in rows),
                       "attempted": sum(r["attempted"] for r in rows),
                       "succeeded": sum(r["show_succeeded"] for r in rows),
                       "failed": sum(not r["show_succeeded"] for r in rows),
                       "coverage_failed": sum(bool(r["errors"]) for r in rows),
                       "authored_keys": sum(len(r["keys"]) for r in rows),
                       "covered_keys": sum(len(r["keys"]) for r in rows if r["show_succeeded"] and not r["errors"]),
                       "expected_findings": sum(f["expected"] for r in rows for f in r["findings"]),
                       "unexpected_findings": sum(not f["expected"] for r in rows for f in r["findings"])},
            "albums": album_summary, "errors": errors, "error_counts": dict(sorted(error_counts.items())),
            "finding_counts": dict(sorted(finding_counts.items())), "records": rows,
            "stability": {"status": "unstable" if changed or after_errors != scan_errors else "stable",
                          "workers": workers,
                          "unchanged_entire_run": not unstable, "unstable_reads": unstable,
                          "record_reads": read_attempts,
                          "attempts": attempt + 1, "hashes_before": hashes_before, "hashes_after": hashes_after},
        }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--bob", default=os.environ.get("BOB_BIN", "bob"))
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--expected-findings", type=Path, help="Exact path/code/field/reason JSON array")
    parser.add_argument("--timeout", type=float, default=30, help="Maximum seconds per Bob process")
    parser.add_argument("--retries", type=int, default=2, help="Snapshot retries; reuse successful reads only across ordinary-note body changes")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent read-only Bob processes, 1 to 8 (default: 8)")
    args = parser.parse_args(argv)
    vault = args.vault.resolve(strict=True)
    report_path = args.report.resolve()
    if report_path == vault or vault in report_path.parents:
        parser.error("Report must be outside the read-only vault")
    if not 0 < args.timeout <= 300 or not 0 <= args.retries <= 5:
        parser.error("timeout must be in (0, 300], retries in [0, 5]")
    if not 1 <= args.workers <= 8:
        parser.error("workers must be in [1, 8]")
    binary_path = shutil.which(args.bob)
    if binary_path is None:
        parser.error("Bob binary was not found")
    binary = Path(binary_path).resolve(strict=True)
    before_hash = digest(binary.read_bytes())
    expected = json.loads(args.expected_findings.read_text()) if args.expected_findings else []
    try:
        result = audit(vault, lambda argv: run_bob(binary, vault, argv, args.timeout), expected, args.retries,
                       workers=args.workers)
    except ValueError as error:
        parser.error(str(error))
    after_hash = digest(binary.read_bytes())
    result["binary"] = {"path": str(binary), "sha256_before": before_hash, "sha256_after": after_hash}
    if before_hash != after_hash:
        result["pass"] = False
        result["errors"].append(problem("binary_changed"))
        result["error_counts"]["binary_changed"] = 1
    result["parser"] = {"name": "PyYAML SafeLoader compose", "version": yaml.__version__}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"pass": result["pass"], "totals": result["totals"],
                      "error_counts": result["error_counts"], "report": str(report_path)}, sort_keys=True))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
