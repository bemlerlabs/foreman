#!/usr/bin/env python3
"""Probe: does an English chat message auto-activate the foreman plugin?
Streams POST /api/chat/stream and prints the relevant events (skill route, tools, answer).
Usage: probe_chat.py "<message>" [seconds]
"""
import json, sys, time, urllib.request

BASE = "http://127.0.0.1:8765"
msg = sys.argv[1] if len(sys.argv) > 1 else "Show me the live bid board for job 35"
limit = float(sys.argv[2]) if len(sys.argv) > 2 else 90.0

payload = {
    "message": msg,
    "history": [],
    "session_id": f"probe-{int(time.time())}",
    "mode": "code",
    "autonomous": True,
    "profile": "full",
}
req = urllib.request.Request(BASE + "/api/chat/stream", data=json.dumps(payload).encode(),
                             headers={"Content-Type": "application/json"}, method="POST")
start = time.time()
seen = {}
try:
    with urllib.request.urlopen(req, timeout=limit + 30) as resp:
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            body = line[5:].strip()
            if not body or body == "[DONE]":
                continue
            try:
                ev = json.loads(body)
            except Exception:
                continue
            t = ev.get("type", "?")
            seen[t] = seen.get(t, 0) + 1
            if t in ("skill", "skill_route", "route", "tool_start", "tool_done", "activity", "answer", "done", "error", "ask_mode"):
                snippet = json.dumps(ev, ensure_ascii=False)[:220]
                print(f"[{time.time()-start:5.1f}s] {t}: {snippet}")
            if time.time() - start > limit:
                print("… limit reached")
                break
except Exception as exc:
    print("STREAM ERROR:", type(exc).__name__, exc)
print("\nEVENT COUNTS:", json.dumps(seen))
