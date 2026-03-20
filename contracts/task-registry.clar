;; TaskBid Task Registry Contract
;; Autonomous molbot-to-molbot task auction marketplace
;; Built on Stacks with Clarity 4
;;
;; Economic loop: Post Task -> Bid -> Stake sBTC -> Execute -> Verify -> Pay USDCx -> Release/Slash Stake

;; ============================================================
;; CONSTANTS & ERROR CODES
;; ============================================================

(define-constant CONTRACT-OWNER tx-sender)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-TASK-NOT-FOUND (err u101))
(define-constant ERR-BID-NOT-FOUND (err u102))
(define-constant ERR-INVALID-STATUS (err u103))
(define-constant ERR-ALREADY-BID (err u104))
(define-constant ERR-INSUFFICIENT-STAKE (err u105))
(define-constant ERR-TASK-EXPIRED (err u106))
(define-constant ERR-NOT-ASSIGNED (err u107))
(define-constant ERR-ALREADY-COMPLETED (err u108))
(define-constant ERR-SELF-BID (err u109))
(define-constant ERR-INVALID-AMOUNT (err u110))
(define-constant ERR-BID-NOT-PENDING (err u111))
(define-constant ERR-TASK-NOT-OPEN (err u112))

;; Task status values
(define-constant STATUS-OPEN u0)
(define-constant STATUS-ASSIGNED u1)
(define-constant STATUS-SUBMITTED u2)
(define-constant STATUS-COMPLETED u3)
(define-constant STATUS-EXPIRED u4)
(define-constant STATUS-CANCELLED u5)

;; ============================================================
;; DATA VARIABLES
;; ============================================================

(define-data-var next-task-id uint u1)
(define-data-var next-bid-id uint u1)
(define-data-var min-stake-amount uint u100000000) ;; 1 sBTC (8 decimals)
(define-data-var platform-fee-pct uint u5) ;; 5% fee
(define-data-var insurance-pool uint u0)

;; ============================================================
;; DATA MAPS
;; ============================================================

;; Task: represents a posted task with reward and deadline
(define-map tasks
  uint ;; task-id
  {
    poster: principal,
    title: (string-ascii 64),
    description: (string-ascii 256),
    skill-required: (string-ascii 32),
    reward-amount: uint,        ;; in micro-USDCx (6 decimals)
    required-stake: uint,       ;; in sats (8 decimals)
    deadline: uint,             ;; block height
    status: uint,
    assigned-to: (optional principal),
    created-at: uint,
    bid-count: uint
  }
)

;; Bid: represents a molbot's bid on a task
(define-map bids
  uint ;; bid-id
  {
    task-id: uint,
    bidder: principal,
    stake-amount: uint,         ;; sBTC staked
    bid-price: uint,            ;; USDCx amount requested
    status: uint,               ;; 0=pending, 1=accepted, 2=rejected
    created-at: uint
  }
)

;; Molbot profile: tracks reputation
(define-map molbot-profiles
  principal
  {
    total-tasks-completed: uint,
    total-tasks-failed: uint,
    total-earned: uint,          ;; lifetime USDCx earned
    total-staked: uint,          ;; lifetime sBTC staked
    total-slashed: uint,         ;; lifetime sBTC slashed
    reputation-score: uint,      ;; 0-1000 scale
    skill-type: (string-ascii 32),
    registered-at: uint
  }
)

;; Track bids per task per bidder (prevent double-bidding)
(define-map task-bidders
  { task-id: uint, bidder: principal }
  uint ;; bid-id
)

;; Track staked sBTC per bid
(define-map bid-stakes
  uint ;; bid-id
  uint ;; amount staked in escrow
)

;; Track escrowed USDCx per task
(define-map task-escrow
  uint ;; task-id
  uint ;; USDCx amount in escrow
)

;; ============================================================
;; LAYER 1: MOLBOT REGISTRATION
;; ============================================================

(define-public (register-molbot (skill-type (string-ascii 32)))
  (begin
    ;; Prevent re-registration (would reset stats)
    (asserts! (is-none (map-get? molbot-profiles tx-sender)) ERR-ALREADY-BID)
    (map-set molbot-profiles tx-sender
      {
        total-tasks-completed: u0,
        total-tasks-failed: u0,
        total-earned: u0,
        total-staked: u0,
        total-slashed: u0,
        reputation-score: u500,  ;; start at 500/1000
        skill-type: skill-type,
        registered-at: block-height
      }
    )
    (ok true)
  )
)

;; ============================================================
;; LAYER 2: TASK LIFECYCLE
;; ============================================================

;; Post a new task with USDCx reward escrowed
(define-public (post-task
    (title (string-ascii 64))
    (description (string-ascii 256))
    (skill-required (string-ascii 32))
    (reward-amount uint)
    (required-stake uint)
    (deadline uint))
  (let
    (
      (task-id (var-get next-task-id))
    )
    ;; Validate inputs
    (asserts! (> reward-amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= required-stake (var-get min-stake-amount)) ERR-INSUFFICIENT-STAKE)
    (asserts! (> deadline block-height) ERR-TASK-EXPIRED)

    ;; Transfer USDCx reward from poster to contract escrow
    (try! (contract-call? .mock-usdcx transfer reward-amount tx-sender (as-contract tx-sender) none))

    ;; Store task
    (map-set tasks task-id
      {
        poster: tx-sender,
        title: title,
        description: description,
        skill-required: skill-required,
        reward-amount: reward-amount,
        required-stake: required-stake,
        deadline: deadline,
        status: STATUS-OPEN,
        assigned-to: none,
        created-at: block-height,
        bid-count: u0
      }
    )

    ;; Store escrow amount
    (map-set task-escrow task-id reward-amount)

    ;; Increment task ID
    (var-set next-task-id (+ task-id u1))

    (print { event: "task-posted", task-id: task-id, poster: tx-sender, reward: reward-amount })
    (ok task-id)
  )
)

;; ============================================================
;; LAYER 3: BIDDING
;; ============================================================

;; Place a bid on a task with sBTC stake
(define-public (place-bid (task-id uint) (bid-price uint))
  (let
    (
      (task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
      (bid-id (var-get next-bid-id))
      (required-stake (get required-stake task))
    )
    ;; Validate
    (asserts! (is-eq (get status task) STATUS-OPEN) ERR-TASK-NOT-OPEN)
    (asserts! (not (is-eq tx-sender (get poster task))) ERR-SELF-BID)
    (asserts! (is-none (map-get? task-bidders { task-id: task-id, bidder: tx-sender })) ERR-ALREADY-BID)
    (asserts! (> bid-price u0) ERR-INVALID-AMOUNT)
    (asserts! (<= block-height (get deadline task)) ERR-TASK-EXPIRED)

    ;; Transfer sBTC stake from bidder to contract escrow
    (try! (contract-call? .mock-sbtc transfer required-stake tx-sender (as-contract tx-sender) none))

    ;; Store bid
    (map-set bids bid-id
      {
        task-id: task-id,
        bidder: tx-sender,
        stake-amount: required-stake,
        bid-price: bid-price,
        status: u0,  ;; pending
        created-at: block-height
      }
    )

    ;; Track stake
    (map-set bid-stakes bid-id required-stake)

    ;; Track bidder
    (map-set task-bidders { task-id: task-id, bidder: tx-sender } bid-id)

    ;; Update task bid count
    (map-set tasks task-id (merge task { bid-count: (+ (get bid-count task) u1) }))

    ;; Increment bid ID
    (var-set next-bid-id (+ bid-id u1))

    ;; Update molbot profile stake tracking
    (match (map-get? molbot-profiles tx-sender)
      profile (map-set molbot-profiles tx-sender
        (merge profile { total-staked: (+ (get total-staked profile) required-stake) }))
      true ;; no profile yet, skip
    )

    (print { event: "bid-placed", bid-id: bid-id, task-id: task-id, bidder: tx-sender, stake: required-stake })
    (ok bid-id)
  )
)

;; Accept a bid (task poster only)
(define-public (accept-bid (bid-id uint))
  (let
    (
      (bid (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
      (task-id (get task-id bid))
      (task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
    )
    ;; Only task poster can accept
    (asserts! (is-eq tx-sender (get poster task)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status task) STATUS-OPEN) ERR-TASK-NOT-OPEN)
    (asserts! (is-eq (get status bid) u0) ERR-BID-NOT-PENDING)

    ;; Update task status to assigned
    (map-set tasks task-id
      (merge task {
        status: STATUS-ASSIGNED,
        assigned-to: (some (get bidder bid))
      })
    )

    ;; Update bid status to accepted
    (map-set bids bid-id (merge bid { status: u1 }))

    (print { event: "bid-accepted", bid-id: bid-id, task-id: task-id, assigned-to: (get bidder bid) })
    (ok true)
  )
)

;; ============================================================
;; LAYER 4: WORK SUBMISSION & DELIVERY
;; ============================================================

;; Submit work (assigned molbot only)
(define-public (submit-work (task-id uint) (proof (string-ascii 256)))
  (let
    (
      (task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
    )
    ;; Only assigned molbot can submit
    (asserts! (is-eq (some tx-sender) (get assigned-to task)) ERR-NOT-ASSIGNED)
    (asserts! (is-eq (get status task) STATUS-ASSIGNED) ERR-INVALID-STATUS)
    (asserts! (<= block-height (get deadline task)) ERR-TASK-EXPIRED)

    ;; Update task status
    (map-set tasks task-id (merge task { status: STATUS-SUBMITTED }))

    (print { event: "work-submitted", task-id: task-id, worker: tx-sender, proof: proof })
    (ok true)
  )
)

;; Confirm delivery -- releases sBTC stake and pays USDCx reward
;; This is the atomic settlement: stake release + payment in one tx
(define-public (confirm-delivery (task-id uint))
  (let
    (
      (task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
      (worker (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
      (reward (get reward-amount task))
      (fee (/ (* reward (var-get platform-fee-pct)) u100))
      (net-reward (- reward fee))
      (escrow-amount (default-to u0 (map-get? task-escrow task-id)))
    )
    ;; Only poster can confirm
    (asserts! (is-eq tx-sender (get poster task)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status task) STATUS-SUBMITTED) ERR-INVALID-STATUS)

    ;; Find the accepted bid to get stake info
    (let
      (
        (bid-id (unwrap! (map-get? task-bidders { task-id: task-id, bidder: worker }) ERR-BID-NOT-FOUND))
        (bid (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
        (stake-amount (get stake-amount bid))
      )

      ;; ATOMIC SETTLEMENT:
      ;; 1. Release sBTC stake back to worker
      (try! (as-contract (contract-call? .mock-sbtc transfer stake-amount tx-sender worker none)))

      ;; 2. Pay USDCx reward to worker (minus platform fee)
      (try! (as-contract (contract-call? .mock-usdcx transfer net-reward tx-sender worker none)))

      ;; 3. Platform fee stays in contract (add to insurance pool)
      (var-set insurance-pool (+ (var-get insurance-pool) fee))

      ;; Update task status
      (map-set tasks task-id (merge task { status: STATUS-COMPLETED }))

      ;; Clear escrow
      (map-delete task-escrow task-id)
      (map-delete bid-stakes bid-id)

      ;; Update molbot profile
      (match (map-get? molbot-profiles worker)
        profile (map-set molbot-profiles worker
          (merge profile {
            total-tasks-completed: (+ (get total-tasks-completed profile) u1),
            total-earned: (+ (get total-earned profile) net-reward),
            reputation-score: (if (> (+ (get reputation-score profile) u50) u1000) u1000 (+ (get reputation-score profile) u50))
          }))
        true
      )

      (print { event: "delivery-confirmed", task-id: task-id, worker: worker, reward: net-reward, stake-released: stake-amount })
      (ok true)
    )
  )
)

;; ============================================================
;; LAYER 5: SLASHING (EXPIRED TASKS)
;; ============================================================

;; Slash stake for expired task -- anyone can call this
(define-public (slash-expired (task-id uint))
  (let
    (
      (task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
      (worker (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
    )
    ;; Task must be assigned or submitted (not completed)
    (asserts! (or (is-eq (get status task) STATUS-ASSIGNED) (is-eq (get status task) STATUS-SUBMITTED)) ERR-INVALID-STATUS)
    ;; Must be past deadline
    (asserts! (> block-height (get deadline task)) ERR-TASK-EXPIRED)

    (let
      (
        (bid-id (unwrap! (map-get? task-bidders { task-id: task-id, bidder: worker }) ERR-BID-NOT-FOUND))
        (bid (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
        (stake-amount (get stake-amount bid))
        (reward (get reward-amount task))
      )

      ;; Slash: stake goes to insurance pool (stays in contract)
      (var-set insurance-pool (+ (var-get insurance-pool) stake-amount))

      ;; Refund USDCx reward back to poster
      (try! (as-contract (contract-call? .mock-usdcx transfer reward tx-sender (get poster task) none)))

      ;; Update task status
      (map-set tasks task-id (merge task { status: STATUS-EXPIRED }))

      ;; Clear escrow tracking
      (map-delete task-escrow task-id)
      (map-delete bid-stakes bid-id)

      ;; Update molbot profile -- reputation penalty
      (match (map-get? molbot-profiles worker)
        profile (map-set molbot-profiles worker
          (merge profile {
            total-tasks-failed: (+ (get total-tasks-failed profile) u1),
            total-slashed: (+ (get total-slashed profile) stake-amount),
            reputation-score: (if (>= (get reputation-score profile) u100)
              (- (get reputation-score profile) u100)
              u0)
          }))
        true
      )

      (print { event: "stake-slashed", task-id: task-id, worker: worker, slashed-amount: stake-amount })
      (ok true)
    )
  )
)

;; ============================================================
;; LAYER 6: READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-task (task-id uint))
  (map-get? tasks task-id)
)

(define-read-only (get-bid (bid-id uint))
  (map-get? bids bid-id)
)

(define-read-only (get-molbot-profile (molbot principal))
  (map-get? molbot-profiles molbot)
)

(define-read-only (get-task-escrow (task-id uint))
  (default-to u0 (map-get? task-escrow task-id))
)

(define-read-only (get-bid-stake (bid-id uint))
  (default-to u0 (map-get? bid-stakes bid-id))
)

(define-read-only (get-insurance-pool)
  (var-get insurance-pool)
)

(define-read-only (get-min-stake)
  (var-get min-stake-amount)
)

(define-read-only (get-platform-fee-pct)
  (var-get platform-fee-pct)
)

(define-read-only (get-next-task-id)
  (var-get next-task-id)
)

(define-read-only (get-next-bid-id)
  (var-get next-bid-id)
)

;; ============================================================
;; ADMIN FUNCTIONS
;; ============================================================

(define-public (set-min-stake (amount uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set min-stake-amount amount)
    (ok true)
  )
)

(define-public (set-platform-fee (pct uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (<= pct u20) ERR-INVALID-AMOUNT) ;; max 20%
    (var-set platform-fee-pct pct)
    (ok true)
  )
)
