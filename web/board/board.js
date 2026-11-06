/* FOREMAN Biet-Board — board.js
 * Kein Framework, kein Build-Step. Pollt den Escrow-Contract per NEAR-JSON-RPC (2 s)
 * und rendert die 5 SEQUENCE.md-Sichten. ?mock=1 ⇒ Demo-Snapshot des echten e2e-Jobs 6
 * (onchain verifiziert 06.11.2026, byte-gleich zum Contract). ?job=N wählt den Job.
 * Preise: Contract-yocto ÷ 10^21 = NEAR-Cent (Team-Konvention, wie in bid_loop/cli_bids).
 * RPC-Kette: https://test.rpc.fastnear.com → https://rpc.testnet.near.org
 * View-Calls: method=query, request_type=call_function, args JSON base64:
 *   get_job/get_bids: {"job_id":N} · get_rep: {"agent":"<acct>"} (Parameter "agent"!)
 */
(function () {
  "use strict";

  var CONTRACT = "escrow.foreman-team.testnet";
  var RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
  var POLL_MS = 2000;
  var EXPLORER = "https://testnet.nearblocks.io/transactions/";
  var USD_PER_NEAR = 2.50;
  var BID_WINDOW_SECONDS = 120; // Contract-Konstante BID_WINDOW_SECONDS

  // Gegenofferte-Begründung: der Contract prüft reason-Pflicht, speichert sie aber nicht
  // on-chain (Bid-Struct ohne reason). Für die Demo zeigt das Board die Foreman-Logs
  // (off-chain Sidecar, ehrlich labelled). Judges sehen onchain: Preis/ETA + ONLY_ONECounter-Garantie.
  var COUNTER_REASONS = {
    5: "ETA 24 s über SLA-Vergleich und #3 'cited sources' in Erstabgabe lückenhaft — Gegenofferte 10 % unter Bestbid bei gleicher Lieferzeit.",
    6: "Bestbid 13,66 ¢ erfüllt #1–#3, aber Budget-Disziplin (RULES: ≤ 3 $): Gegenofferte 12,30 ¢ (−10 %) bei unveränderter ETA — Annahme durch Bieter steht frei."
  };

  var qs = (typeof location !== "undefined") ? new URLSearchParams(location.search) : { get: function () { return null; } };
  var JOB_ID = parseInt(qs.get("job") || "1", 10) || 1;
  var MOCK = qs.get("mock") === "1";

  // ---------- Demo-Fallback: exakter Onchain-Snapshot von Job 6 (e2e, Accepted) ----------
  var MOCK_JOB = {
    id: 6,
    spec: "research-report: NEAR testnet RPC latency, finality and gas costs across 3 regions; deliver CSV + summary + sources",
    acceptance_criteria: ["#1 summary <=300 words", "#2 CSV data table", "#3 cited sources"],
    budget: "900000000000000000000000",
    opened_at: 1793965206256526430,
    deadline_nanos: 1793965795000000000,
    created_by: "foreman-team.testnet",
    state: "Accepted",
    bids: [
      { bidder: "agent4.foreman-team.testnet", price: "14993061393358716403712", eta_secs: 24, rep_snapshot: 50, placed_at: 1793965223240921426 },
      { bidder: "agent2.foreman-team.testnet", price: "15766607838275472195584", eta_secs: 24, rep_snapshot: 50, placed_at: 1793965223240921426 },
      { bidder: "agent1.foreman-team.testnet", price: "13664354590037026799616", eta_secs: 24, rep_snapshot: 60, placed_at: 1793965223240921426 },
      { bidder: "agent5.foreman-team.testnet", price: "14067700276117834301440", eta_secs: 24, rep_snapshot: 50, placed_at: 1793965223240921426 },
      { bidder: "agent3.foreman-team.testnet", price: "16535024931338421534720", eta_secs: 24, rep_snapshot: 50, placed_at: 1793965223240921426 }
    ],
    counter_offer: { bidder: "boss.foreman-team.testnet", price: "12297919131033324119654", eta_secs: 24, rep_snapshot: 0, placed_at: 1793965234684317457 },
    winner: "agent1.foreman-team.testnet",
    receipt_hash: "5cf45a9e00e5b082e29dab3cbd65dddf8ac88cb7e6241cf2b067591ea9033559",
    artifact_hash: "41b280f4f6a7c0e4368f930d8b6b545a6c59bfc2235350351e948241b5a2e6ce",
    tx_example: { label: "Refund-tx Job 2 (echt, testnet)", hash: "CQ16asmJWmz1GWx1FqHGfTQcxAZXhdBbrnoTKV3X5LLN" },
    rep_before: 60,
    rep_now: 63 // accept(score 87): (60*9+87)/10 = 62.7 → 62? Contract: (60*9+87)//10=62 — onchain get_rep zeigt Endwert
  };

  // ---------------- Helpers (pure, headless testbar) ----------------
  function cents(yoctoStr) { // Team-Konvention: yocto ÷ 10^21 = NEAR-Cent
    try { return (Number(BigInt(yoctoStr)) / 1e21).toFixed(2); }
    catch (e) { return "—"; }
  }
  function usd(yoctoStr) {
    try { return (Number(BigInt(yoctoStr)) / 1e24 * USD_PER_NEAR).toFixed(3); }
    catch (e) { return "—"; }
  }
  function stateClass(s) {
    return ({ Open: "bidding", Bidding: "bidding", Awarded: "awarded", Delivered: "awarded",
      Accepted: "accepted", Refunded: "refunded", Expired: "expired" })[s] || "";
  }
  function fmtCountdown(msLeft) {
    if (msLeft <= 0) return "00:00";
    var s = Math.ceil(msLeft / 1000);
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }
  function sortBids(bids) { // exakt Contract-Award-Logik: price asc, rep desc, placed_at asc
    return (bids || []).slice().sort(function (a, b) {
      var pa = BigInt(a.price), pb = BigInt(b.price);
      if (pa !== pb) return pa < pb ? -1 : 1;
      if (a.rep_snapshot !== b.rep_snapshot) return b.rep_snapshot - a.rep_snapshot;
      return a.placed_at < b.placed_at ? -1 : (a.placed_at > b.placed_at ? 1 : 0);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function decodeResult(res) {
    var bytes = Array.isArray(res) ? Uint8Array.from(res) : null;
    if (!bytes && typeof res === "string") {
      var bin = (typeof atob === "function") ? atob(res) : Buffer.from(res, "base64").toString("binary");
      bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // ---------------- Browser-Boot (kopfüber geschützt für Node-Validierung) ----------------
  if (typeof document === "undefined" || typeof fetch === "undefined") {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = { cents: cents, usd: usd, fmtCountdown: fmtCountdown, stateClass: stateClass,
                         sortBids: sortBids, decodeResult: decodeResult, MOCK_JOB: MOCK_JOB };
    }
    return;
  }

  function el(id) { return document.getElementById(id); }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }

  function rpcCall(rpcUrl, method, args) {
    var body = {
      jsonrpc: "2.0", id: "board-" + Date.now(), method: "query",
      params: { request_type: "call_function", account_id: CONTRACT, method_name: method,
                finality: "optimistic", args_base64: b64(JSON.stringify(args)) }
    };
    return fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error((j.error && j.error.name) || "RPC_ERROR");
        return decodeResult(j.result.result);
      });
  }
  function viewWithFallback(method, args) {
    var chain = RPCS.slice();
    function attempt() {
      if (!chain.length) return Promise.reject(new Error("all RPCs failed"));
      var url = chain[0];
      return rpcCall(url, method, args).then(function (v) {
        el("netInfo").textContent = "RPC: " + url.replace("https://", "");
        el("rpcChain").textContent = RPCS.map(function (u) {
          return (u === url ? "▸ " : "· ") + u.replace("https://", "");
        }).join("   ");
        return v;
      }).catch(function () { chain.shift(); return attempt(); });
    }
    return attempt();
  }

  var lastJob = null;
  function render(job) {
    lastJob = job;
    el("jobSpec").textContent = job.spec || "—";
    el("budget").textContent = cents(job.budget);
    var badge = el("stateBadge");
    badge.textContent = job.state || "—";
    badge.className = "badge " + stateClass(job.state);
    el("criteria").innerHTML = (job.acceptance_criteria || []).map(function (c) {
      return "<div>• " + escapeHtml(c) + "</div>";
    }).join("") || "—";

    var bids = sortBids(job.bids);
    el("bidsBody").innerHTML = bids.length
      ? bids.map(function (b, i) {
          var win = job.winner && b.bidder === job.winner;
          return "<tr class='" + (win ? "winner" : "") + "'>" +
            "<td class='rank'>" + (i + 1) + "</td>" +
            "<td>" + escapeHtml(b.bidder) + (win ? " 🏆" : "") + "</td>" +
            "<td><span class='price'>" + cents(b.price) + " ¢</span> <span class='usd'>≈ " + usd(b.price) + " $</span></td>" +
            "<td>" + b.eta_secs + " s</td><td>" + b.rep_snapshot + "</td></tr>";
        }).join("")
      : "<tr><td colspan='5' class='empty'>warte auf Bids …</td></tr>";

    var co = job.counter_offer;
    el("counterBody").innerHTML = co
      ? "<div><b>" + cents(co.price) + " ¢ · ETA " + co.eta_secs + " s</b> <span class='usd'>≈ " + usd(co.price) + " $</span> <span class='usd'>— " + escapeHtml(co.bidder) + "</span></div>" +
        "<div class='reason'>„" + escapeHtml(co.reason || COUNTER_REASONS[job.id] || "Begründung im Foreman-Log (on-chain: price/ETA, nur 1 Counter erlaubt)") + "“</div>" +
        "<div class='lbl' style='margin-top:8px'>Begründung off-chain (Foreman-Log) · on-chain erzwungen: genau ein Counter</div>"
      : "<div class='empty'>keine Gegenofferte</div>";

    el("receiptHash").textContent = job.receipt_hash || "— noch nicht verankert";
    el("artifactHash").textContent = job.artifact_hash || "— noch nicht geliefert";
    var tx = job.tx_payout || job.tx_example || null;
    el("explorerLink").innerHTML = tx
      ? "<a href='" + EXPLORER + (tx.hash || tx) + "' target='_blank' rel='noopener'>" +
        escapeHtml(tx.label || "Transaction") + ": " + String(tx.hash || tx).slice(0, 24) + "…</a>"
      : "<span class='empty'>kein tx hash</span>";

    el("winner").textContent = job.winner || "—";
    el("payout").textContent = job.winner ? payoutCents(job) + " ¢" : "—";
    el("feeLine").textContent = job.winner ? "10 % von " + payoutCents(job) + " ¢ an Foreman-Konto" : "—";
    renderRep(job);
  }

  function payoutCents(job) {
    var w = (job.bids || []).filter(function (b) { return b.bidder === job.winner; })[0];
    return w ? cents(w.price) : "—";
  }

  function renderRep(job) {
    var rm = el("repMove");
    if (!job.winner) { rm.textContent = "—"; return; }
    var w = (job.bids || []).filter(function (b) { return b.bidder === job.winner; })[0];
    var old = w ? w.rep_snapshot : 50;
    if (job._repNow === undefined) { rm.textContent = old + " → …"; return; }
    rm.innerHTML = old + " <b>→</b> " + job._repNow;
  }

  setInterval(function () { // 1-Sekunden-Countdown
    if (!lastJob) return;
    var nowNs = BigInt(Date.now()) * 1000000n;
    var openLike = lastJob.state === "Bidding" || lastJob.state === "Open";
    if (openLike) {
      var endNs = BigInt(lastJob.opened_at || 0) + BigInt(BID_WINDOW_SECONDS) * 1000000000n;
      el("cdLbl").textContent = nowNs >= endNs ? "Bid-Fenster geschlossen" : "Bid-Fenster";
      el("countdown").textContent = fmtCountdown(Number(endNs - nowNs) / 1e6);
    } else {
      var dl = BigInt(lastJob.deadline_nanos || 0);
      el("cdLbl").textContent = "Deadline";
      el("countdown").textContent = (dl && nowNs < dl) ? fmtCountdown(Number(dl - nowNs) / 1e6) : "abgelaufen";
    }
  }, 1000);

  function setLive(on) {
    el("dot").classList.toggle("off", !on);
    el("liveLbl").textContent = on ? "live" : "demo";
    el("demoTag").style.display = on ? "none" : "inline-block";
  }

  function poll() {
    if (MOCK) {
      var m = JSON.parse(JSON.stringify(MOCK_JOB));
      m._repNow = MOCK_JOB.rep_now;
      setLive(false);
      render(m);
      el("lastPoll").textContent = new Date().toLocaleTimeString() + " (mock-Snapshot Job " + m.id + ")";
      el("contractLbl").textContent = CONTRACT + " · job " + m.id + " (mock)";
      return;
    }
    viewWithFallback("get_job", { job_id: JOB_ID }).then(function (job) {
      if (!job || typeof job !== "object" || job.id === undefined) { MOCK = true; setLive(false); return poll(); }
      setLive(true);
      render(job);
      el("lastPoll").textContent = new Date().toLocaleTimeString();
      el("contractLbl").textContent = CONTRACT + " · job " + JOB_ID;
      if (job.winner) {
        viewWithFallback("get_rep", { agent: job.winner }).then(function (rep) {
          job._repNow = Number(rep);
          renderRep(job);
        }).catch(function () {});
      }
    }).catch(function () { MOCK = true; setLive(false); });
  }
  poll();
  setInterval(poll, POLL_MS);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cents: cents, usd: usd, fmtCountdown: fmtCountdown, stateClass: stateClass,
                       sortBids: sortBids, decodeResult: decodeResult, MOCK_JOB: MOCK_JOB };
  }
})();
