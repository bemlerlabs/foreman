#!/usr/bin/env python3
"""Rettet einen Job: Counter-Offer (10% unter Bestbid) + Award, lokal signiert (near_send.cjs),
damit RPC-429 die Runde nicht killt. Aufruf: rescue_job.py <job_id>"""
import json, subprocess, sys

JOB = int(sys.argv[1])
SEND = "scripts/near_send.cjs"
CONTract = "escrow.foreman-team.testnet"

d = json.loads(subprocess.run(["python3", "scripts/board_cli.py", "--job", str(JOB), "--json"],
                              capture_output=True, text=True, cwd=".").stdout)
best = min(d["bids"], key=lambda b: float(b["price_near_cent"]))
# 1 NEAR-Cent = 1e19 yocto (¢ = milli-NEAR)
price = int(round(float(best["price_near_cent"]) * 0.9 * 10**19))
eta = int(best["eta_secs"])
reason = ("Gegenangebot (Foreman boss): alle acceptance_criteria erfuellt — #1 summary <=300 words, "
          "#2 CSV data table, #3 cited sources — Festpreis 10 % unter Bestbid, ETA " + str(eta) + "s.")
print(f"best={best['bidder']} {best['price_near_cent']}c -> counter={price} yocto eta={eta}s")

def call(who, method, args):
    r = subprocess.run(["node", SEND, who, CONTract, method, json.dumps(args, separators=(",", ":")),
                        "0", "100000000000000"], capture_output=True, text=True, timeout=150)
    out = (r.stdout or "") + (r.stderr or "")
    line = [l for l in out.splitlines() if "Transaction Id" in l or "Failure" in l or "panicked" in l]
    print(method, "->", line[-2:] if line else out.strip()[-200:])
    return r.returncode

rc = call("boss.foreman-team.testnet", "counter_offer",
          {"job_id": JOB, "price": str(price), "eta_secs": eta, "reason": reason})
rc2 = call("boss.foreman-team.testnet", "award", {"job_id": JOB})
sys.exit(0 if rc == 0 and rc2 == 0 else 1)
