//! Phase-1 unit tests (near_sdk test_utils / VMContextBuilder + testing_env!):
//! all 11 public methods + every require! rejection of the escrow machine.
//! testing_env! carries storage across context switches => clean SEQUENCE tests.
use foreman::{Contract, JobState, BID_WINDOW_SECONDS, MAX_BIDS};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

const T0: u64 = 1_700_000_000_000_000_000; // ns base time
const SEC: u64 = 1_000_000_000;

fn acct(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn owner() -> AccountId {
    acct("owner.testnet")
}
fn treasury() -> AccountId {
    acct("treasury.testnet")
}
fn foreman_acct() -> AccountId {
    acct("foreman.testnet")
}
fn agent(n: u8) -> AccountId {
    acct(&format!("agent{}.testnet", n))
}

/// Mock context for the next call: who calls when with which deposit?
fn ctx(now: u64, who: &AccountId, deposit: u128) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(who.clone())
        .current_account_id(acct("escrow.testnet"))
        .signer_account_id(who.clone())
        .block_timestamp(now)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}

fn init() -> Contract {
    ctx(T0, &owner(), 0);
    Contract::new(owner(), treasury(), foreman_acct())
}

/// Owner posts a job with escrow; returns the JobId.
fn post(c: &mut Contract, now: u64, budget: u128, deadline_nanos: u64) -> u64 {
    ctx(now, &owner(), budget);
    c.post_job("spec".into(), vec!["criterion".into()], deadline_nanos)
}

fn bid(c: &mut Contract, job: u64, who: &AccountId, price: u128, now: u64) {
    ctx(now, who, 0);
    c.place_bid(job, NearToken::from_yoctonear(price), 60);
}

fn as_foreman(now: u64) {
    ctx(now, &foreman_acct(), 0);
}

/// expect_panic: f must abort with a require! panic containing `code` (hook silenced).
fn expect_panic<F: FnOnce()>(f: F, code: &str) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    std::panic::set_hook(prev);
    let payload = result
        .err()
        .unwrap_or_else(|| panic!("expected panic '{}', got Ok", code));
    let msg = payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(
        msg.contains(code),
        "panic was '{}', expected '{}'",
        msg,
        code
    );
}

// ---------- new / post_job ----------

#[test]
fn new_defaults_rep_50() {
    let c = init();
    assert_eq!(c.get_rep(agent(1)), 50);
}

#[test]
fn post_job_ok_by_owner() {
    let mut c = init();
    let id = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    assert_eq!(id, 1);
    let job = c.get_job(1);
    assert_eq!(job.state, JobState::Bidding);
    assert_eq!(job.budget, NearToken::from_yoctonear(1_000));
    assert_eq!(
        job.opened_at, T0,
        "opened_at must be the real per-job timestamp"
    );
    assert_eq!(job.created_by, owner());
}

#[test]
fn post_job_by_foreman_ok() {
    let mut c = init();
    ctx(T0, &foreman_acct(), 500);
    let id = c.post_job("s".into(), vec![], T0 + 10 * SEC);
    assert_eq!(id, 1);
}

#[test]
fn post_job_ids_increment() {
    let mut c = init();
    assert_eq!(post(&mut c, T0, 1_000, T0 + 3_600 * SEC), 1);
    assert_eq!(post(&mut c, T0, 1_000, T0 + 3_600 * SEC), 2);
}

#[test]
fn post_job_escrow_required() {
    let mut c = init();
    expect_panic(
        || {
            post(&mut c, T0, 0, T0 + 10 * SEC);
        },
        "ESCROW_REQUIRED",
    );
}

#[test]
fn post_job_only_owner_or_foreman() {
    let mut c = init();
    expect_panic(
        || {
            ctx(T0, &agent(1), 1_000);
            c.post_job("s".into(), vec![], T0 + 10 * SEC);
        },
        "ONLY_OWNER_OR_FOREMAN",
    );
}

// ---------- place_bid ----------

#[test]
fn place_bid_ok_snapshots_rep_and_time() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 900, T0 + 5 * SEC);
    let bids = c.get_bids(job);
    assert_eq!(bids.len(), 1);
    assert_eq!(bids[0].bidder, agent(1));
    assert_eq!(bids[0].price, NearToken::from_yoctonear(900));
    assert_eq!(bids[0].rep_snapshot, 50);
    assert_eq!(bids[0].placed_at, T0 + 5 * SEC);
}

#[test]
fn place_bid_permissionless_outside_swarm() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    // Openness (S2): an identity outside the seeded swarm and outside owner/foreman
    // may bid — place_bid has no identity gate, only window/price/max/duplicate.
    let guest = acct("guest.notforeman.testnet");
    bid(&mut c, job, &guest, 700, T0 + 5 * SEC);
    let bids = c.get_bids(job);
    assert_eq!(bids.len(), 1);
    assert_eq!(bids[0].bidder, guest);
    // and the open entrant can win: award picks the guest (cheapest/only bid).
    as_foreman(T0 + 6 * SEC);
    c.award(job);
    assert_eq!(c.get_job(job).winner, Some(guest));
}

#[test]
fn place_bid_not_bidding_after_award() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    expect_panic(
        || bid(&mut c, job, &agent(2), 800, T0 + 3 * SEC),
        "NOT_BIDDING",
    );
}

#[test]
fn place_bid_window_closed() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(
        || {
            bid(
                &mut c,
                job,
                &agent(1),
                900,
                T0 + (BID_WINDOW_SECONDS + 1) * SEC,
            )
        },
        "BID_WINDOW_CLOSED",
    );
}

/// Proof against the old T0 hack: the window hangs on the real job.opened_at,
/// not on the system time of the first job.
#[test]
fn bid_window_is_per_job_not_global_t0() {
    let mut c = init();
    let job_a = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    let late = T0 + (BID_WINDOW_SECONDS + 10) * SEC;
    let job_b = post(&mut c, late, 1_000, T0 + 3_600 * SEC); // job B opens LATE
    expect_panic(
        || bid(&mut c, job_a, &agent(1), 900, late + SEC),
        "BID_WINDOW_CLOSED",
    );
    bid(&mut c, job_b, &agent(2), 900, late + SEC); // B is fresh => window open
    assert_eq!(c.get_bids(job_b).len(), 1);
}

#[test]
fn place_bid_expired() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 2 * SEC); // deadline inside the window
    expect_panic(|| bid(&mut c, job, &agent(1), 900, T0 + 3 * SEC), "EXPIRED");
}

#[test]
fn place_bid_price_zero_rejected() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(|| bid(&mut c, job, &agent(1), 0, T0 + SEC), "PRICE_RANGE");
}

#[test]
fn place_bid_price_over_budget_rejected() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(
        || bid(&mut c, job, &agent(1), 1_001, T0 + SEC),
        "PRICE_RANGE",
    );
}

#[test]
fn place_bid_already_bid_rejected() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 900, T0 + SEC);
    expect_panic(
        || bid(&mut c, job, &agent(1), 800, T0 + 2 * SEC),
        "ALREADY_BID",
    );
}

#[test]
fn place_bid_max_bids_enforced() {
    let mut c = init();
    let job = post(&mut c, T0, 100_000, T0 + 3_600 * SEC);
    for i in 1..=MAX_BIDS as u8 {
        bid(&mut c, job, &agent(i), 1_000, T0 + (i as u64) * SEC);
    }
    assert_eq!(c.get_bids(job).len(), MAX_BIDS);
    expect_panic(
        || bid(&mut c, job, &agent(99), 1_000, T0 + 100 * SEC),
        "MAX_BIDS_REACHED",
    );
}

// ---------- counter_offer ----------

#[test]
fn counter_offer_only_foreman() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(
        || {
            ctx(T0 + SEC, &owner(), 0);
            c.counter_offer(job, NearToken::from_yoctonear(500), 60, "ok".into());
        },
        "ONLY_FOREMAN",
    );
}

#[test]
fn counter_offer_only_one_counter() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    as_foreman(T0 + SEC);
    c.counter_offer(job, NearToken::from_yoctonear(500), 60, "reason".into());
    expect_panic(
        || {
            as_foreman(T0 + 2 * SEC);
            c.counter_offer(job, NearToken::from_yoctonear(400), 60, "again".into());
        },
        "ONLY_ONE_COUNTER",
    );
}

#[test]
fn counter_offer_reason_required() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(
        || {
            as_foreman(T0 + SEC);
            c.counter_offer(job, NearToken::from_yoctonear(500), 60, "   ".into());
        },
        "REASON_REQUIRED",
    );
}

#[test]
fn counter_offer_not_bidding_after_award() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    expect_panic(
        || {
            as_foreman(T0 + 3 * SEC);
            c.counter_offer(job, NearToken::from_yoctonear(500), 60, "late".into());
        },
        "NOT_BIDDING",
    );
}

#[test]
fn counter_offer_stored_with_foreman_identity() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    as_foreman(T0 + SEC);
    c.counter_offer(
        job,
        NearToken::from_yoctonear(500),
        42,
        "criterion #1 cheaper".into(),
    );
    let co = c.get_job(job).counter_offer.expect("counter present");
    assert_eq!(co.bidder, foreman_acct());
    assert_eq!(co.eta_secs, 42);
}

// ---------- award ----------

/// Helper path: owner posts, agent1 bids, foreman awards. Winner = agent1.
fn award_one_bid(c: &mut Contract) -> u64 {
    let job = post(c, T0, 1_000, T0 + 3_600 * SEC);
    bid(c, job, &agent(1), 900, T0 + SEC);
    as_foreman(T0 + 2 * SEC);
    c.award(job);
    job
}

#[test]
fn award_only_foreman() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 900, T0 + SEC);
    expect_panic(
        || {
            ctx(T0 + 2 * SEC, &owner(), 0);
            c.award(job);
        },
        "ONLY_FOREMAN",
    );
}

#[test]
fn award_no_bids_rejected() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(
        || {
            as_foreman(T0 + SEC);
            c.award(job);
        },
        "NO_BIDS",
    );
}

#[test]
fn award_not_bidding_twice() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    expect_panic(
        || {
            as_foreman(T0 + 3 * SEC);
            c.award(job);
        },
        "NOT_BIDDING",
    );
}

#[test]
fn award_cheapest_price_wins() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 900, T0 + SEC);
    bid(&mut c, job, &agent(2), 500, T0 + 2 * SEC);
    bid(&mut c, job, &agent(3), 700, T0 + 3 * SEC);
    as_foreman(T0 + 4 * SEC);
    c.award(job);
    assert_eq!(c.get_job(job).winner, Some(agent(2)));
    assert_eq!(c.get_job(job).state, JobState::Awarded);
}

#[test]
fn award_tie_goes_to_earlier_bid() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 500, T0 + SEC);
    bid(&mut c, job, &agent(2), 500, T0 + 2 * SEC);
    as_foreman(T0 + 3 * SEC);
    c.award(job);
    assert_eq!(c.get_job(job).winner, Some(agent(1)));
}

/// Rep tiebreak: agent1 delivers job1 cleanly (rep 50→55), beats agent2
/// in job2 at the same price despite a later bid (RULES: price → rep → time).
#[test]
fn award_tie_higher_rep_wins() {
    let mut c = init();
    let job1 = award_one_bid(&mut c);
    ctx(T0 + 3 * SEC, &agent(1), 0);
    c.attach_receipt(job1, "r1".into());
    c.submit_work(job1, "a1".into());
    as_foreman(T0 + 4 * SEC);
    c.accept(job1, 100);
    assert_eq!(c.get_rep(agent(1)), 55, "sliding avg (50*9+100)/10");

    let job2 = post(&mut c, T0 + 400 * SEC, 1_000, T0 + 4000 * SEC);
    bid(&mut c, job2, &agent(2), 500, T0 + 401 * SEC); // earlier, but rep 50
    bid(&mut c, job2, &agent(1), 500, T0 + 402 * SEC); // later, rep 55
    as_foreman(T0 + 403 * SEC);
    c.award(job2);
    assert_eq!(c.get_job(job2).winner, Some(agent(1)));
}

// ---------- attach_receipt / submit_work ----------

/// Spec proof for the check order in attach_receipt: winner check before state check.
/// Before the award there is no winner => ONLY_WINNER (not NOT_AWARDED).
#[test]
fn attach_receipt_before_award_hits_only_winner_first() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 900, T0 + SEC);
    expect_panic(
        || {
            ctx(T0 + 2 * SEC, &agent(1), 0);
            c.attach_receipt(job, "hash".into());
        },
        "ONLY_WINNER",
    );
}

/// We reach NOT_AWARDED as the real winner in state Accepted (winner set, state != Awarded).
#[test]
fn attach_receipt_not_awarded_after_accept() {
    let mut c = init();
    let job = deliver_one(&mut c);
    as_foreman(T0 + 4 * SEC);
    c.accept(job, 80);
    expect_panic(
        || {
            ctx(T0 + 5 * SEC, &agent(1), 0);
            c.attach_receipt(job, "hash".into());
        },
        "NOT_AWARDED",
    );
}

#[test]
fn attach_receipt_only_winner() {
    let mut c = init();
    let job = award_one_bid(&mut c); // winner = agent1
    expect_panic(
        || {
            ctx(T0 + 3 * SEC, &agent(2), 0);
            c.attach_receipt(job, "hash".into());
        },
        "ONLY_WINNER",
    );
}

#[test]
fn attach_receipt_rejects_blank_hash() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    expect_panic(
        || {
            ctx(T0 + 3 * SEC, &agent(1), 0);
            c.attach_receipt(job, "  ".into());
        },
        "RECEIPT_REQUIRED",
    );
}

#[test]
fn submit_work_requires_receipt_first() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    expect_panic(
        || {
            ctx(T0 + 3 * SEC, &agent(1), 0);
            c.submit_work(job, "artifact".into());
        },
        "RECEIPT_BEFORE_SUBMIT",
    );
}

#[test]
fn submit_work_only_winner() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    ctx(T0 + 3 * SEC, &agent(1), 0);
    c.attach_receipt(job, "r".into());
    expect_panic(
        || {
            ctx(T0 + 4 * SEC, &agent(2), 0);
            c.submit_work(job, "artifact".into());
        },
        "ONLY_WINNER",
    );
}

#[test]
fn submit_work_ok_sets_delivered() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    ctx(T0 + 3 * SEC, &agent(1), 0);
    c.attach_receipt(job, "receipt-hash".into());
    c.submit_work(job, "artifact-hash".into());
    let job = c.get_job(job);
    assert_eq!(job.state, JobState::Delivered);
    assert_eq!(job.receipt_hash.as_deref(), Some("receipt-hash"));
    assert_eq!(job.artifact_hash.as_deref(), Some("artifact-hash"));
}

// ---------- accept ----------

fn deliver_one(c: &mut Contract) -> u64 {
    let job = award_one_bid(c);
    ctx(T0 + 3 * SEC, &agent(1), 0);
    c.attach_receipt(job, "r".into());
    c.submit_work(job, "a".into());
    job
}

#[test]
fn accept_rejects_third_party() {
    let mut c = init();
    let job = deliver_one(&mut c);
    expect_panic(
        || {
            ctx(T0 + 4 * SEC, &agent(9), 0);
            c.accept(job, 80);
        },
        "ONLY_OWNER_OR_FOREMAN",
    );
}

/// RULES compliance (lead decision 05.11.): the owner may accept themselves.
#[test]
fn accept_by_owner_ok() {
    let mut c = init();
    let job = deliver_one(&mut c);
    ctx(T0 + 4 * SEC, &owner(), 0);
    c.accept(job, 90);
    assert_eq!(c.get_job(job).state, JobState::Accepted);
    assert_eq!(c.get_rep(agent(1)), 54, "sliding avg (50*9+90)/10");
}

#[test]
fn accept_not_delivered_before_work() {
    let mut c = init();
    let job = award_one_bid(&mut c);
    expect_panic(
        || {
            as_foreman(T0 + 3 * SEC);
            c.accept(job, 80);
        },
        "NOT_DELIVERED",
    );
}

#[test]
fn accept_ok_updates_state_and_rep() {
    let mut c = init();
    let job = deliver_one(&mut c);
    as_foreman(T0 + 4 * SEC);
    c.accept(job, 80);
    assert_eq!(c.get_job(job).state, JobState::Accepted);
    assert_eq!(c.get_rep(agent(1)), 53, "sliding avg (50*9+80)/10");
}

#[test]
fn accept_clamps_score_to_100() {
    let mut c = init();
    let job = deliver_one(&mut c);
    as_foreman(T0 + 4 * SEC);
    c.accept(job, 250);
    assert_eq!(
        c.get_rep(agent(1)),
        55,
        "score must clamp to 100 → (50*9+100)/10"
    );
}

#[test]
fn accept_twice_not_delivered() {
    let mut c = init();
    let job = deliver_one(&mut c);
    as_foreman(T0 + 4 * SEC);
    c.accept(job, 80);
    expect_panic(
        || {
            as_foreman(T0 + 5 * SEC);
            c.accept(job, 80);
        },
        "NOT_DELIVERED",
    );
}

// ---------- refund_expired ----------

#[test]
fn refund_expired_bad_state_delivered() {
    let mut c = init();
    let job = deliver_one(&mut c);
    let deadline = c.get_job(job).deadline_nanos;
    expect_panic(
        || {
            ctx(deadline + 61 * SEC, &agent(9), 0);
            c.refund_expired(job);
        },
        "BAD_STATE",
    );
}

#[test]
fn refund_expired_not_expired_yet() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    expect_panic(
        || {
            ctx(T0 + 3_600 * SEC, &agent(9), 0); // exactly deadline, +60s still missing
            c.refund_expired(job);
        },
        "NOT_EXPIRED",
    );
}

#[test]
fn refund_expired_ok_refunds_owner_and_marks_refunded() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 100 * SEC);
    ctx(T0 + 161 * SEC, &agent(9), 0); // permissionless trigger, deadline + 61 s
    c.refund_expired(job);
    assert_eq!(c.get_job(job).state, JobState::Refunded);
}

#[test]
fn refund_expired_awarded_sets_winner_rep_zero_path() {
    let mut c = init();
    let job = award_one_bid(&mut c); // winner agent1, rep 50
    ctx(T0 + 3_600 * SEC + 61 * SEC, &agent(9), 0);
    c.refund_expired(job);
    assert_eq!(c.get_job(job).state, JobState::Refunded);
    assert_eq!(
        c.get_rep(agent(1)),
        45,
        "sliding avg (50*9+0)/10 for no-show winner"
    );
}

// ---------- views ----------

#[test]
fn get_job_not_found_panics() {
    let c = init();
    expect_panic(
        || {
            c.get_job(999);
        },
        "JOB_NOT_FOUND",
    );
}

#[test]
fn get_bids_keeps_placement_order() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    bid(&mut c, job, &agent(1), 900, T0 + SEC);
    bid(&mut c, job, &agent(2), 500, T0 + 2 * SEC);
    let bids = c.get_bids(job);
    assert_eq!(bids[0].bidder, agent(1));
    assert_eq!(bids[1].bidder, agent(2));
}

// ---------- counter_reason (phase4.2) ----------

#[test]
fn counter_offer_persists_reason_and_view_works() {
    let mut c = init();
    let job = post(&mut c, T0, 1_000, T0 + 3_600 * SEC);
    assert_eq!(c.get_counter_reason(job), None, "no counter, no reason");
    as_foreman(T0 + SEC);
    c.counter_offer(
        job,
        NearToken::from_yoctonear(500),
        42,
        " criterion #2+3 at a fixed price ".into(),
    );
    assert_eq!(
        c.get_counter_reason(job).as_deref(),
        Some(" criterion #2+3 at a fixed price "),
        "reason persisted 1:1 (trim only for the gate, not when storing)"
    );
}

/// Upgrade proof: contract state without the 7th field (old state from the deploy era
/// before phase4.2, e.g. jobs 1-6 on-chain) must stay deserializable — counter_reasons
/// falls back to the fresh map b"k" instead of an EOF panic.
#[test]
fn legacy_state_without_counter_map_still_deserializes() {
    use near_sdk::borsh::{to_vec, BorshDeserialize};

    #[derive(near_sdk::borsh::BorshSerialize)]
    #[borsh(crate = "near_sdk::borsh")]
    struct OldContractWire {
        owner: AccountId,
        treasury: AccountId,
        foreman: AccountId,
        jobs_prefix: Vec<u8>, // LookupMap<JobId,Job> serializes only the prefix
        next_id: u64,
        rep_prefix: Vec<u8>, // LookupMap<AccountId,u32> likewise
    }

    let old = OldContractWire {
        owner: owner(),
        treasury: treasury(),
        foreman: foreman_acct(),
        jobs_prefix: b"j".to_vec(),
        next_id: 7,
        rep_prefix: b"r".to_vec(),
    };
    let bytes = to_vec(&old).expect("old-state bytes");
    let c = Contract::try_from_slice(&bytes).expect("old state without the 7th field must stay readable");
    assert_eq!(
        c.get_counter_reason(3),
        None,
        "fresh map => None, no panic"
    );
    assert_eq!(
        c.get_rep(agent(1)),
        50,
        "reputation map readable from old state"
    );
}
