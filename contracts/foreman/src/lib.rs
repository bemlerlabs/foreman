/// Foreman escrow contract — v0.2 per docs/SEQUENCE.md + RULES.md (near-sdk 5.x)
/// API: new · post_job · place_bid · counter_offer · award · attach_receipt · submit_work · accept · refund_expired · get_*
/// Phase-1 hardened (06.11.): max_bids limit, per-job opened_at window proven by tests, RULES flags in docs/EVIDENCE_LOG.md.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::LookupMap;
use near_sdk::NearToken;
use near_sdk::{env, near, require, AccountId, NearSchema, PanicOnDefault, Promise};

pub type JobId = u64;
pub const BID_WINDOW_SECONDS: u64 = 120;
pub const FOREMAN_FEE_NUM: u128 = 10; // 10 % (RULES.md)
pub const DENOM: u128 = 100;
/// Gas discipline (phase 1): hard bid limit per job — no unbounded Vec loops.
pub const MAX_BIDS: usize = 20;

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, NearSchema,
)]
#[borsh(crate = "near_sdk::borsh")]
#[abi(json)] // NEP-330 ABI (phase1.2): JsonSchema impl at __abi-generate
pub enum JobState {
    Open,
    Bidding,
    Awarded,
    Delivered,
    Accepted,
    Refunded,
    Expired,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, NearSchema)]
#[borsh(crate = "near_sdk::borsh")]
#[abi(json)] // NEP-330 ABI (phase1.2)
pub struct Bid {
    pub bidder: AccountId,
    pub price: NearToken,
    pub eta_secs: u64,
    pub rep_snapshot: u32,
    pub placed_at: u64, // nanos
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, NearSchema)]
#[borsh(crate = "near_sdk::borsh")]
#[abi(json)] // NEP-330 ABI (phase1.2)
pub struct Job {
    pub id: JobId,
    pub spec: String,
    pub acceptance_criteria: Vec<String>,
    pub budget: NearToken,
    pub opened_at: u64, // nanos, for BID_WINDOW
    pub deadline_nanos: u64,
    pub created_by: AccountId,
    pub state: JobState,
    pub bids: Vec<Bid>,
    pub counter_offer: Option<Bid>, // EXACTLY 1 allowed (07-prompt rule)
    pub winner: Option<AccountId>,
    pub receipt_hash: Option<String>, // sha256 of the signed Ephemora execution report
    pub artifact_hash: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    treasury: AccountId,
    foreman: AccountId,
    jobs: LookupMap<JobId, Job>,
    next_id: JobId,
    reputation: LookupMap<AccountId, u32>, // 0..=100, start 50
                                           // counter_reasons (phase4.2) is deliberately NOT a struct field: a transient
                                           // LookupMap handle on prefix b"k" (see counter_reasons()) writes straight to
                                           // storage — contract/job Borsh layout stays bit-for-bit stable for old state (jobs 1-6).
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, treasury: AccountId, foreman: AccountId) -> Self {
        require!(!env::state_exists(), "ALREADY_INIT");
        Self {
            owner,
            treasury,
            foreman,
            jobs: LookupMap::new(b"j".to_vec()),
            next_id: 1,
            reputation: LookupMap::new(b"r".to_vec()),
        }
    }

    /// Owner posts a job; escrow = attached deposit (> 0).
    #[payable]
    pub fn post_job(
        &mut self,
        spec: String,
        acceptance_criteria: Vec<String>,
        deadline_nanos: u64,
    ) -> JobId {
        let budget = env::attached_deposit();
        require!(budget.as_yoctonear() > 0, "ESCROW_REQUIRED");
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner || caller == self.foreman,
            "ONLY_OWNER_OR_FOREMAN"
        );
        let id = self.next_id;
        self.next_id += 1;
        let job = Job {
            id,
            spec,
            acceptance_criteria,
            budget,
            opened_at: env::block_timestamp(),
            deadline_nanos,
            created_by: caller,
            state: JobState::Bidding,
            bids: vec![],
            counter_offer: None,
            winner: None,
            receipt_hash: None,
            artifact_hash: None,
        };
        self.jobs.insert(id, job);
        env::log_str(&format!(
            "foreman:job_opened|id={}|budget={}",
            id,
            budget.as_yoctonear()
        ));
        id
    }

    /// Swarm bids; only inside the bid window, price <= budget, bidder = caller (RULES.md).
    #[payable]
    pub fn place_bid(&mut self, job_id: JobId, price: NearToken, eta_secs: u64) {
        let mut job = self.get_job(job_id);
        require!(job.state == JobState::Bidding, "NOT_BIDDING");
        let now = env::block_timestamp();
        require!(
            now >= job.opened_at && now - job.opened_at < BID_WINDOW_SECONDS * 1_000_000_000,
            "BID_WINDOW_CLOSED"
        );
        require!(now < job.deadline_nanos, "EXPIRED");
        require!(
            price.as_yoctonear() > 0 && price.as_yoctonear() <= job.budget.as_yoctonear(),
            "PRICE_RANGE"
        );
        require!(job.bids.len() < MAX_BIDS, "MAX_BIDS_REACHED");
        let bidder = env::predecessor_account_id();
        require!(!job.bids.iter().any(|b| b.bidder == bidder), "ALREADY_BID");
        let rep = self.get_rep(bidder.clone());
        job.bids.push(Bid {
            bidder,
            price,
            eta_secs,
            rep_snapshot: rep,
            placed_at: now,
        });
        self.jobs.insert(job_id, job);
    }

    /// Foreman places EXACTLY ONE reasoned counter-offer.
    pub fn counter_offer(
        &mut self,
        job_id: JobId,
        price: NearToken,
        eta_secs: u64,
        reason: String,
    ) {
        self.assert_foreman();
        let mut job = self.get_job(job_id);
        require!(job.state == JobState::Bidding, "NOT_BIDDING");
        require!(job.counter_offer.is_none(), "ONLY_ONE_COUNTER");
        require!(!reason.trim().is_empty(), "REASON_REQUIRED");
        job.counter_offer = Some(Bid {
            bidder: self.foreman.clone(),
            price,
            eta_secs,
            rep_snapshot: 0,
            placed_at: env::block_timestamp(),
        });
        self.jobs.insert(job_id, job);
        // Persist the reason (board panel 4): transient LookupMap handle on b"k",
        // store types write to storage immediately — no contract field, no Borsh break.
        let mut reasons = Self::counter_reasons();
        reasons.insert(job_id, reason);
    }

    /// Award with score validation: lowest price, then reputation, then order.
    pub fn award(&mut self, job_id: JobId) {
        self.assert_foreman();
        let mut job = self.get_job(job_id);
        require!(job.state == JobState::Bidding, "NOT_BIDDING");
        require!(!job.bids.is_empty(), "NO_BIDS");
        let mut sorted = job.bids.clone();
        sorted.sort_by(|a, b| {
            a.price
                .cmp(&b.price)
                .then(b.rep_snapshot.cmp(&a.rep_snapshot))
                .then(a.placed_at.cmp(&b.placed_at))
        });
        job.winner = Some(sorted[0].bidder.clone());
        job.state = JobState::Awarded;
        self.jobs.insert(job_id, job);
    }

    /// Winner anchors the hash of the signed Ephemora execution report (required before submit_work).
    pub fn attach_receipt(&mut self, job_id: JobId, receipt_hash: String) {
        let mut job = self.get_job(job_id);
        // security: identity check precedes state check
        self.assert_winner(&job);
        require!(job.state == JobState::Awarded, "NOT_AWARDED");
        require!(!receipt_hash.trim().is_empty(), "RECEIPT_REQUIRED");
        job.receipt_hash = Some(receipt_hash);
        self.jobs.insert(job_id, job);
    }

    pub fn submit_work(&mut self, job_id: JobId, artifact_hash: String) {
        let mut job = self.get_job(job_id);
        self.assert_winner(&job);
        require!(
            job.state == JobState::Awarded && job.receipt_hash.is_some(),
            "RECEIPT_BEFORE_SUBMIT"
        );
        job.artifact_hash = Some(artifact_hash);
        job.state = JobState::Delivered;
        self.jobs.insert(job_id, job);
    }

    /// Acceptance → payout: 90 % winner, 10 % foreman fee; reputation update (RULES.md).
    /// RULES-compliant (lead decision 05.11.): owner OR foreman may accept.
    pub fn accept(&mut self, job_id: JobId, delivery_score: u32) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner || caller == self.foreman,
            "ONLY_OWNER_OR_FOREMAN"
        );
        let mut job = self.get_job(job_id);
        require!(job.state == JobState::Delivered, "NOT_DELIVERED");
        let winner = job.winner.clone().expect("WINNER");
        let fee = job.budget.as_yoctonear() * FOREMAN_FEE_NUM / DENOM;
        let payout = job.budget.as_yoctonear() - fee;
        Promise::new(winner.clone())
            .transfer(NearToken::from_yoctonear(payout))
            .detach();
        Promise::new(self.foreman.clone())
            .transfer(NearToken::from_yoctonear(fee))
            .detach();
        self.update_rep(winner.clone(), delivery_score.min(100));
        job.state = JobState::Accepted;
        self.jobs.insert(job_id, job);
        env::log_str(&format!(
            "foreman:paid|id={}|winner={}|payout={}|fee={}",
            job_id, winner, payout, fee
        ));
    }

    /// Deadline passed without a deliverable → refund to owner (permissionless trigger).
    pub fn refund_expired(&mut self, job_id: JobId) {
        let mut job = self.get_job(job_id);
        require!(
            job.state == JobState::Bidding || job.state == JobState::Awarded,
            "BAD_STATE"
        );
        require!(
            env::block_timestamp() > job.deadline_nanos + 60_000_000_000,
            "NOT_EXPIRED"
        );
        Promise::new(job.created_by.clone())
            .transfer(job.budget)
            .detach();
        if let Some(w) = job.winner.clone() {
            self.update_rep(w, 0);
        }
        job.state = JobState::Refunded;
        self.jobs.insert(job_id, job);
    }

    // ---- Views ----
    pub fn get_job(&self, job_id: JobId) -> Job {
        self.jobs.get(&job_id).expect("JOB_NOT_FOUND").clone()
    }
    pub fn get_bids(&self, job_id: JobId) -> Vec<Bid> {
        self.get_job(job_id).bids
    }
    pub fn get_rep(&self, agent: AccountId) -> u32 {
        self.reputation.get(&agent).copied().unwrap_or(50)
    }
    /// Reason of the counter-offer, if present (phase4.2, RULES "reasoned counter-offer").
    pub fn get_counter_reason(&self, job_id: JobId) -> Option<String> {
        Self::counter_reasons().get(&job_id).cloned()
    }

    // ---- internal helpers ----
    /// Persistent counter reasons: LookupMap prefix b"k" (job_id -> reason).
    /// Transient handle — reads/writes straight against storage, contract layout stable.
    fn counter_reasons() -> LookupMap<JobId, String> {
        LookupMap::new(b"k".to_vec())
    }
    fn assert_foreman(&self) {
        require!(
            env::predecessor_account_id() == self.foreman,
            "ONLY_FOREMAN"
        );
    }
    fn assert_winner(&self, job: &Job) {
        require!(
            job.winner.as_deref() == Some(env::predecessor_account_id().as_ref()),
            "ONLY_WINNER"
        );
    }
    fn update_rep(&mut self, agent: AccountId, score: u32) {
        let old = self.get_rep(agent.clone());
        let new = (old * 9 + score) / 10; // moving average (RULES.md)
        self.reputation.insert(agent, new);
    }
}
