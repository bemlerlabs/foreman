#!/usr/bin/env python3
"""check_hygiene.py — repo gates that a reviewer would otherwise have to remember.

    python3 scripts/check_hygiene.py            # all checks
    python3 scripts/check_hygiene.py --links    # just dead links
    python3 scripts/check_hygiene.py --tables   # just markdown table shape

Stdlib only, read-only, exits non-zero on a finding. Four groups:

  links    relative links and `path/to/file.ext` mentions in markdown that resolve to nothing,
           which is how documentation silently rots after a rename. A name git considers ignored
           (`.state/…`, the venv) is exempt: that is a file a run creates, not one the repo ships.
  leaks    operator home directories, e-mail addresses, token-shaped strings and private-key
           headers in tracked files
  media    tracked files above the per-file size GitHub will serve, and the total payload a
           judge has to download to see the demos
  tables   markdown rows whose cell count differs from their header, which is how a `|` inside a
           long evidence-log claim makes the row stop lining up with the columns it belongs to

Known limitation: the vendored upstream readme (vendor/README.ephemora-cell.md) is kept
byte-for-byte, so its links are relative to the upstream repository, not this one.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import urllib.parse

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                      capture_output=True, text=True, check=True).stdout.strip()

# Files whose contents are someone else's, verbatim: scanning them would only produce noise we
# would then be tempted to explain away.
SKIP_PREFIXES = ("vendor/", "node_modules/", ".venv", "core/intents/vendor/")
SKIP_EXACT = {"vendor/README.ephemora-cell.md", ".pytest_cache/README.md"}

LEAK_PATTERNS = [
    (re.compile(r"/Users/[A-Za-z0-9._-]+/"), "operator home directory"),
    (re.compile(r"[A-Za-z0-9._%+-]+@(?:gmail|outlook|googlemail|hotmail|icloud|proton)\.[a-z]{2,}"),
     "e-mail address"),
    (re.compile(r"\b(?:naa_|aat_)[A-Za-z0-9_-]{16,}"), "token-shaped string"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}"), "JWT-shaped string"),
    (re.compile(r"-----BEGIN (?:EC |RSA |OPENSSH |PGP )?PRIVATE KEY-----"), "private key material"),
]

# Deliberate placeholders: short, obviously fake, and referenced by name in the docs.
LEAK_ALLOW = re.compile(r"TESTREDACTED|EXAMPLE|placeholder|redacted", re.I)

MD_LINK = re.compile(r"\[[^\]]{0,120}\]\(([^)\s]+)\)")
BACKTICK_PATH = re.compile(r"`([A-Za-z0-9_./-]+\.(?:md|py|rs|toml|json|sh|wasm|go|html|js|cjs|mjs|ts|yaml|yml|cff|svg|png|gif|mp4))`")

PER_FILE_LIMIT = 95 * 1024 * 1024  # GitHub's hard cap is 100 MiB; stop well before it
MAX_SCAN_BYTES = 8 * 1024 * 1024   # text files only; recorded media is not scanned line-by-line


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True,
                         check=True).stdout
    return [p for p in out.split("\0") if p]


def scan_files() -> list[str]:
    """Tracked plus untracked-but-not-ignored.

    Links and leaks are properties of the text in front of us, so the gate reads the work tree:
    a secret in a file that has not been added yet is still a secret one commit away. The media
    budget stays on tracked files only, because the number it protects is what the repository
    actually ships."""
    others = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "-z"],
                            capture_output=True, text=True, check=True).stdout
    seen, ordered = set(), []
    for p in tracked_files() + [p for p in others.split("\0") if p]:
        if p not in seen:
            seen.add(p)
            ordered.append(p)
    return ordered


def skipped(path: str) -> bool:
    return path in SKIP_EXACT or path.startswith(SKIP_PREFIXES)


_ignore_cache: dict[str, bool] = {}


def git_ignored(rel: str) -> bool:
    """Whether git considers this path ignored, so a document may name a file a run creates.

    `.state/operations.json` and the venv are documented because the demo writes them; they are
    deliberately not in the repository, and a fresh clone has every right to lack them. Ignored is
    the test that separates "runtime product" from "file this document still thinks we ship": a
    tracked path that was deleted is not ignored, so it stays a finding.
    """
    if rel not in _ignore_cache:
        rc = subprocess.run(["git", "check-ignore", "-q", "--", rel],
                            cwd=ROOT, capture_output=True).returncode
        _ignore_cache[rel] = rc == 0
    return _ignore_cache[rel]


def check_links(files: list[str]) -> list[str]:
    problems = []
    for path in files:
        if not path.endswith(".md") or skipped(path):
            continue
        text = open(os.path.join(ROOT, path), encoding="utf-8", errors="replace").read()
        for m in MD_LINK.finditer(text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "#", "tel:")):
                continue
            rel = urllib.parse.unquote(target.split("#")[0].split("?")[0])
            if rel and not os.path.exists(os.path.join(ROOT, os.path.dirname(path), rel)):
                if git_ignored(os.path.join(os.path.dirname(path), rel)):
                    continue
                problems.append(f"{path}: broken link -> {target}")
        for m in BACKTICK_PATH.finditer(text):
            rel = m.group(1)
            # A bare filename in prose ("run `gen_artifact.py`") is not a path claim; only tokens
            # that look like paths are checked, root-relative or relative to the document.
            if rel.startswith("/") or "/" not in rel or rel.startswith(("http", "tel:")):
                continue  # leading slash = an API endpoint path, not a file in this repo
            root_cand = os.path.join(ROOT, rel)
            doc_cand = os.path.join(ROOT, os.path.dirname(path), rel)
            if os.path.exists(root_cand) or os.path.exists(doc_cand):
                continue
            if git_ignored(rel) or git_ignored(os.path.relpath(doc_cand, ROOT)):
                continue  # a file the run creates, named on purpose
            problems.append(f"{path}: mentions a file that is not in the repo -> {rel}")
    return problems


def check_leaks(files: list[str]) -> list[str]:
    problems = []
    for path in files:
        if skipped(path):
            continue
        full = os.path.realpath(os.path.join(ROOT, path))
        if not full.startswith(ROOT + os.sep):
            problems.append(f"{path}: escapes the repository root — refusing to read it")
            continue
        try:
            if os.path.getsize(full) > MAX_SCAN_BYTES:
                continue
            data = open(full, "rb").read()
        except OSError:
            continue
        if b"\0" in data[:4096]:
            continue  # binary: the wheel and the media files are covered by vendor/NOTICE
        text = data.decode("utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            for pattern, label in LEAK_PATTERNS:
                for m in pattern.finditer(line):
                    if LEAK_ALLOW.search(line):
                        continue
                    # Length only, never the content: a hygiene gate must not put the secret it
                    # found into the CI log.
                    problems.append(f"{path}:{lineno}: {label} ({len(m.group(0))} chars)")
    return problems


def _cells(line: str) -> list[str]:
    """Split a markdown table row on its unescaped pipes."""
    body = line.strip().strip("|")
    out, buf, i = [], [], 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body) and body[i + 1] == "|":
            buf.append("|")
            i += 2
            continue
        if ch == "|":
            out.append("".join(buf).strip())
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    out.append("".join(buf).strip())
    return out


def check_tables(files: list[str]) -> list[str]:
    """Every row of a markdown table must carry the header's cell count.

    A stray `|` inside a long claim raises nothing anywhere: GitHub renders the surplus as text and
    shifts every column after it, so the rows holding the most evidence are the ones most likely to
    be misread. This is the check that catches it, because the file still looks right in an editor.
    """
    problems = []
    for path in files:
        if not path.endswith(".md") or skipped(path):
            continue
        lines = open(os.path.join(ROOT, path), encoding="utf-8", errors="replace").read().splitlines()
        fence, width = None, None
        for lineno, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("```") or stripped.startswith("~~~"):
                fence, width = (None if fence else stripped[:3]), None
                continue
            if fence or not (stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 1):
                width = None
                continue
            cells = _cells(line)
            if width is None:
                nxt = lines[lineno].strip() if lineno < len(lines) else ""
                if "-" in nxt and re.fullmatch(r"\|[\s:|-]+\|", nxt):
                    width = len(cells)
                continue
            if len(cells) != width:
                problems.append(f"{path}:{lineno}: row has {len(cells)} cells, the header has {width}")
    return problems


def check_media(files: list[str]) -> list[str]:
    problems = []
    total = 0
    for path in files:
        size = os.path.getsize(os.path.join(ROOT, path))
        total += size
        if size > PER_FILE_LIMIT:
            problems.append(f"{path}: {size/1e6:.1f} MB exceeds the {PER_FILE_LIMIT/1e6:.0f} MB gate")
    print(f"  tracked payload: {total/1e6:.1f} MB in {len(files)} files")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--links", action="store_true", help="run the dead-link check only")
    ap.add_argument("--tables", action="store_true", help="run the table-shape check only")
    ap.add_argument("--quiet", action="store_true", help="print findings only")
    args = ap.parse_args()

    files = scan_files()
    if args.links:
        groups = [("links", check_links(files))]
    elif args.tables:
        groups = [("tables", check_tables(files))]
    else:
        groups = [("links", check_links(files)),
                  ("tables", check_tables(files)),
                  ("leaks", check_leaks(files)),
                  ("media", check_media(tracked_files()))]

    failed = False
    for name, problems in groups:
        if problems:
            failed = True
            print(f"{name}: {len(problems)} finding(s)")
            for p in problems:
                print(f"  {p}")
        elif not args.quiet and name != "media":
            print(f"{name}: clean")
    if failed:
        print("\nFix the findings above, or add a narrow allow-comment if the string is deliberate.")
        return 1
    if not args.quiet:
        print("hygiene: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
