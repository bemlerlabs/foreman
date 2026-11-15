#!/usr/bin/env python3
"""check_hygiene.py — repo gates that a reviewer would otherwise have to remember.

    python3 scripts/check_hygiene.py            # all checks
    python3 scripts/check_hygiene.py --links    # just dead links
    python3 scripts/check_hygiene.py --tables   # just markdown table shape
    python3 scripts/check_hygiene.py --language # just the English-surface check
    python3 scripts/check_hygiene.py --tools    # just unreferenced scripts

Stdlib only, read-only, exits non-zero on a finding. Six groups:

  links    relative links and `path/to/file.ext` mentions in markdown that resolve to nothing,
           which is how documentation silently rots after a rename. A name git considers ignored
           (`.state/…`, the venv) is exempt: that is a file a run creates, not one the repo ships.
           So is a line under a `Removed` heading, whose whole job is to name what no longer
           exists, and any single line may say so out loud with a `hygiene:links` marker.
  leaks    operator home directories, e-mail addresses, token-shaped strings and private-key
           headers in tracked files
  media    tracked files above the per-file size GitHub will serve, and the total payload a
           judge has to download to see the demos
  tables   markdown rows whose cell count differs from their header, which is how a `|` inside a
           long evidence-log claim makes the row stop lining up with the columns it belongs to
  language German reaching the shipped surface — code, scripts, plugin pack, docs. The recorded
           evidence under `web/board/sidecar/` and `artifacts/` is deliberately not scanned:
           those files say what the run said, and some of it is on chain and cannot be edited.
  tools    a script under `scripts/` that nothing in the repository calls or documents, which is
           how a half-finished helper survives a cleanup

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

# The narrow escape hatch the failure message offers: a line carrying this marker states that its
# unresolvable path is deliberate. It is per line, not per file, so it cannot hide the next rot.
LINKS_ALLOW = re.compile(r"hygiene:links")

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


def _line_sections(text: str) -> list[str]:
    """The nearest markdown heading above every line, for rules that depend on where a line sits."""
    sections, current = [], ""
    for line in text.splitlines():
        if re.match(r"^#{1,6}\s", line):
            current = line.lstrip("#").strip()
        sections.append(current)
    return sections


def check_links(files: list[str]) -> list[str]:
    problems = []
    for path in files:
        if not path.endswith(".md") or skipped(path):
            continue
        text = open(os.path.join(ROOT, path), encoding="utf-8", errors="replace").read()
        lines = text.splitlines()
        sections = _line_sections(text)

        def exempt(idx: int) -> bool:
            """A changelog entry naming what it deleted is the opposite of a stale reference."""
            if idx < len(sections) and sections[idx].strip().lower() == "removed":
                return True
            return idx < len(lines) and LINKS_ALLOW.search(lines[idx])

        def line_of(pos: int) -> int:
            return text.count("\n", 0, pos)

        for m in MD_LINK.finditer(text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "#", "tel:")):
                continue
            if exempt(line_of(m.start())):
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
            if exempt(line_of(m.start())):
                continue
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


def _text_of(path: str) -> str | None:
    """Work-tree text of a file, or None if it is binary, oversized, or outside the root."""
    full = os.path.realpath(os.path.join(ROOT, path))
    if not full.startswith(ROOT + os.sep):
        return None
    try:
        if os.path.getsize(full) > MAX_SCAN_BYTES:
            return None
        data = open(full, "rb").read()
    except OSError:
        return None
    if b"\0" in data[:4096]:
        return None
    return data.decode("utf-8", errors="replace")


# Recorded evidence keeps the language it was produced in. `web/board/sidecar/` and `artifacts/`
# mirror what the chain and the run actually said — job 18's counter-offer reason is on-chain text —
# and the rule for those files is to keep the record rather than edit it. Generated dependency
# lockfiles are someone else's text as well.
RECORDED_PREFIXES = ("web/board/sidecar/", "artifacts/")
LANG_SKIP = RECORDED_PREFIXES + SKIP_PREFIXES
LANG_SKIP_NAMES = (".lock", "-lock.json")

# German words, matched case-sensitively so the MIT licence is not a finding. Homographs that
# English also uses (war, so, an, in, der, die, das, was, wie, hat, kann, muss) stay out on
# purpose: a gate that flags English prose teaches people to ignore the gate.
GERMAN_WORDS = [  # hygiene:lang — the detector has to name the words it detects
    "und", "nicht", "mit", "von", "zum", "zur", "beim", "durch", "fuer", "für", "ueber", "über",  # hygiene:lang
    "jedoch", "daher", "deshalb", "ebenfalls", "ebenso", "somit", "bereits", "deutlich",  # hygiene:lang
    "identisch", "diese", "dieser", "dieses", "solche", "solchen", "werden", "wurde", "wurden",  # hygiene:lang
    "sind", "keine", "kein", "manuell", "vollständig", "vollstaendig", "durchgeführt",  # hygiene:lang
    "durchgefuehrt", "einschließlich", "einschliesslich", "innerhalb", "oberhalb", "unterhalb",  # hygiene:lang
    "runden", "runde", "zeile", "zeilen", "gegenangebot", "festpreis", "verändert", "veraendert",  # hygiene:lang
    "aufgenommen", "gleichfalls", "derartig", "doku", "bzw", "usw", "etwas", "mehrfach", "sowie",  # hygiene:lang
    "wobei", "nachfolgend", "hiermit", "hierzu", "deswegen", "oben", "unten",  # hygiene:lang
]
GERMAN = re.compile(
    r"\b(?:" + "|".join(sorted(set(GERMAN_WORDS) | {w.capitalize() for w in GERMAN_WORDS}))
    + r")\b")
LANG_ALLOW = re.compile(r"hygiene:lang")  # hygiene:lang


def check_language(files: list[str]) -> list[str]:
    """The product surface — code, scripts, plugin pack, docs — is English, because that ships."""
    problems = []
    for path in files:
        if path.startswith(LANG_SKIP) or skipped(path):
            continue
        if path.endswith(LANG_SKIP_NAMES):
            continue
        text = _text_of(path)
        if text is None:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if LANG_ALLOW.search(line):
                continue
            m = GERMAN.search(line)
            if m:
                problems.append(f"{path}:{lineno}: German in the shipped surface ("
                                f"“{m.group(0)}”); this repo publishes in English")
    return problems


def check_orphans(files: list[str]) -> list[str]:
    """Every helper under `scripts/` must be named by something that calls or documents it.

    An unreferenced script is not spare weight, it is an unanswered question: a reviewer cannot tell
    whether it is dead code or the one file that shows how the demo was actually run. Either name it
    in the docs that use it, or delete it.
    """
    texts: dict[str, str] = {}
    for p in files:
        if p.startswith(SKIP_PREFIXES) or p.endswith(".lock"):
            continue
        text = _text_of(p)
        if text is not None:
            texts[p] = text
    problems = []
    for path in files:
        if not path.startswith("scripts/") or not os.path.isfile(os.path.join(ROOT, path)):
            continue
        base = os.path.basename(path)
        named = any(base in (t or "") for q, t in texts.items() if q != path)
        if not named:
            problems.append(f"{path}: nothing in the repository calls or documents it")
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
    ap.add_argument("--language", action="store_true", help="run the English-surface check only")
    ap.add_argument("--tools", action="store_true", help="run the unreferenced-script check only")
    ap.add_argument("--quiet", action="store_true", help="print findings only")
    args = ap.parse_args()

    files = scan_files()
    if args.links:
        groups = [("links", check_links(files))]
    elif args.tables:
        groups = [("tables", check_tables(files))]
    elif args.language:
        groups = [("language", check_language(files))]
    elif args.tools:
        groups = [("tool references", check_orphans(files))]
    else:
        groups = [("links", check_links(files)),
                  ("tables", check_tables(files)),
                  ("leaks", check_leaks(files)),
                  ("language", check_language(files)),
                  ("tool references", check_orphans(tracked_files())),
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
