(define-constant CONTRACT-OWNER tx-sender)
(define-constant REGISTRY-PRINCIPAL .registry)

(define-constant ERR-NOT-AUTHORIZED     (err u100))
(define-constant ERR-TASK-NOT-FOUND     (err u101))
(define-constant ERR-BID-NOT-FOUND      (err u102))
(define-constant ERR-INVALID-STATUS     (err u103))
(define-constant ERR-ALREADY-BID        (err u104))
(define-constant ERR-INSUFFICIENT-STAKE (err u105))
(define-constant ERR-TASK-EXPIRED       (err u106))
(define-constant ERR-NOT-ASSIGNED       (err u107))
(define-constant ERR-ALREADY-REGISTERED (err u108))
(define-constant ERR-SELF-BID           (err u109))
(define-constant ERR-INVALID-AMOUNT     (err u110))
(define-constant ERR-HAS-BIDS           (err u111))
(define-constant ERR-NOT-EXPIRED        (err u112))
(define-constant ERR-NO-ORACLE          (err u113))

(define-constant STATUS-OPEN      u0)
(define-constant STATUS-ASSIGNED  u1)
(define-constant STATUS-SUBMITTED u2)
(define-constant STATUS-COMPLETED u3)
(define-constant STATUS-EXPIRED   u4)
(define-constant STATUS-CANCELLED u5)

(define-data-var next-task-id       uint u1)
(define-data-var next-bid-id        uint u1)
(define-data-var min-stake-amount   uint u100000000)
(define-data-var platform-fee-bps   uint u500)
(define-data-var insurance-pool     uint u0)
(define-data-var total-volume-usdcx uint u0)
(define-data-var total-tasks-posted uint u0)
(define-data-var oracle-addr (optional principal) none)

(define-map tasks uint
  { poster:         principal,
    title:          (string-ascii 64),
    description:    (string-ascii 256),
    skill-required: (string-ascii 32),
    reward-amount:  uint,
    required-stake: uint,
    deadline:       uint,
    status:         uint,
    assigned-to:    (optional principal),
    created-at:     uint,
    bid-count:      uint,
    proof-hash:     (optional (buff 32)) })

(define-map bids uint
  { task-id:      uint,
    bidder:       principal,
    stake-amount: uint,
    bid-price:    uint,
    status:       uint,
    created-at:   uint,
    score:        uint })

(define-map molbot-profiles principal
  { reputation-score:      uint,
    skill-type:            (string-ascii 32),
    total-tasks-completed: uint,
    total-tasks-failed:    uint,
    total-earned:          uint,
    total-staked:          uint,
    total-slashed:         uint,
    registered-at:         uint,
    last-active:           uint })

(define-map task-bidders { task-id: uint, bidder: principal } uint)
(define-map bid-stakes   uint uint)
(define-map task-escrow  uint uint)

(define-private (compute-fee (reward uint))
  (/ (* reward (var-get platform-fee-bps)) u10000))

(define-private (compute-score (reputation uint) (bid-price uint)
                                (reward uint) (stake uint))
  (+ (* reputation u10)
     (if (> reward u0) (/ (* bid-price u1000) reward) u0)
     (if (>= stake (var-get min-stake-amount)) u500 u0)))

;; -- LAYER 1: MOLBOT REGISTRATION ---------------------------------------------

(define-public (register-molbot (skill-type (string-ascii 32)))
  (begin
    (asserts! (is-none (map-get? molbot-profiles tx-sender)) ERR-ALREADY-REGISTERED)
    (map-set molbot-profiles tx-sender
      { reputation-score:      u500,
        skill-type:            skill-type,
        total-tasks-completed: u0,
        total-tasks-failed:    u0,
        total-earned:          u0,
        total-staked:          u0,
        total-slashed:         u0,
        registered-at:         stacks-block-height,
        last-active:           stacks-block-height })
    (print { e: "registered", addr: tx-sender, skill: skill-type })
    (ok true)
  )
)

;; -- LAYER 2: TASK POST / CANCEL -----------------------------------------------

(define-public (post-task
    (title          (string-ascii 64))
    (description    (string-ascii 256))
    (skill-required (string-ascii 32))
    (reward-amount  uint)
    (required-stake uint)
    (deadline       uint))
  (let ((task-id (var-get next-task-id)))
    (asserts! (> reward-amount u0)                              ERR-INVALID-AMOUNT)
    (asserts! (>= required-stake (var-get min-stake-amount))    ERR-INSUFFICIENT-STAKE)
    (asserts! (> deadline stacks-block-height)                  ERR-TASK-EXPIRED)
    (try! (contract-call? .usdcx transfer
             reward-amount tx-sender REGISTRY-PRINCIPAL none))
    (map-set tasks task-id
      { poster:         tx-sender,
        title:          title,
        description:    description,
        skill-required: skill-required,
        reward-amount:  reward-amount,
        required-stake: required-stake,
        deadline:       deadline,
        status:         STATUS-OPEN,
        assigned-to:    none,
        created-at:     stacks-block-height,
        bid-count:      u0,
        proof-hash:     none })
    (map-set task-escrow task-id reward-amount)
    (var-set next-task-id       (+ task-id u1))
    (var-set total-tasks-posted (+ (var-get total-tasks-posted) u1))
    (var-set total-volume-usdcx (+ (var-get total-volume-usdcx) reward-amount))
    (print { e: "task-posted", id: task-id, reward: reward-amount,
             stake: required-stake, deadline: deadline, skill: skill-required })
    (ok task-id)
  )
)

(define-public (cancel-task (task-id uint))
  (let ((task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get poster task))  ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status task) STATUS-OPEN) ERR-INVALID-STATUS)
    (asserts! (is-eq (get bid-count task) u0)       ERR-HAS-BIDS)
    (try! (contract-call? .usdcx contract-transfer
             (get reward-amount task) (get poster task)))
    (map-set tasks task-id (merge task { status: STATUS-CANCELLED }))
    (map-delete task-escrow task-id)
    (print { e: "task-cancelled", id: task-id, refund: (get reward-amount task) })
    (ok true)
  )
)

;; -- LAYER 3: BIDDING ---------------------------------------------------------

(define-public (place-bid (task-id uint) (bid-price uint))
  (let ((task   (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
        (bid-id (var-get next-bid-id))
        (stake  (get required-stake task))
        (score  (compute-score
                   (default-to u500
                     (get reputation-score (map-get? molbot-profiles tx-sender)))
                   bid-price (get reward-amount task)
                   (get required-stake task))))
    (asserts! (is-eq (get status task) STATUS-OPEN) ERR-INVALID-STATUS)
    (asserts! (not (is-eq tx-sender (get poster task))) ERR-SELF-BID)
    (asserts! (is-none (map-get? task-bidders { task-id: task-id, bidder: tx-sender }))
              ERR-ALREADY-BID)
    (asserts! (> bid-price u0) ERR-INVALID-AMOUNT)
    (asserts! (<= stacks-block-height (get deadline task)) ERR-TASK-EXPIRED)
    (try! (contract-call? .sbtc transfer
             stake tx-sender REGISTRY-PRINCIPAL none))
    (map-set bids bid-id
      { task-id:      task-id,
        bidder:       tx-sender,
        stake-amount: stake,
        bid-price:    bid-price,
        status:       u0,
        created-at:   stacks-block-height,
        score:        score })
    (map-set bid-stakes   bid-id stake)
    (map-set task-bidders { task-id: task-id, bidder: tx-sender } bid-id)
    (map-set tasks task-id (merge task { bid-count: (+ (get bid-count task) u1) }))
    (match (map-get? molbot-profiles tx-sender)
      p (map-set molbot-profiles tx-sender
          (merge p { total-staked: (+ (get total-staked p) stake),
                     last-active:  stacks-block-height }))
      true)
    (var-set next-bid-id (+ bid-id u1))
    (print { e: "bid-placed", bid-id: bid-id, task-id: task-id,
             bidder: tx-sender, stake: stake, bid-price: bid-price, score: score })
    (ok bid-id)
  )
)

(define-public (accept-bid (bid-id uint))
  (let ((bid  (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
        (task (unwrap! (map-get? tasks (get task-id bid)) ERR-TASK-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get poster task)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status task) STATUS-OPEN) ERR-INVALID-STATUS)
    (asserts! (is-eq (get status bid)  u0)          ERR-INVALID-STATUS)
    (map-set tasks (get task-id bid)
      (merge task { status: STATUS-ASSIGNED, assigned-to: (some (get bidder bid)) }))
    (map-set bids bid-id (merge bid { status: u1 }))
    (print { e: "bid-accepted", bid-id: bid-id,
             task-id: (get task-id bid), assigned-to: (get bidder bid) })
    (ok true)
  )
)

;; -- LAYER 4: WORK SUBMISSION -------------------------------------------------

(define-public (submit-work (task-id uint) (proof-hash (buff 32)))
  (let ((task (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND)))
    (asserts! (is-eq (some tx-sender) (get assigned-to task)) ERR-NOT-ASSIGNED)
    (asserts! (is-eq (get status task) STATUS-ASSIGNED) ERR-INVALID-STATUS)
    (asserts! (<= stacks-block-height (get deadline task)) ERR-TASK-EXPIRED)
    (map-set tasks task-id
      (merge task { status: STATUS-SUBMITTED, proof-hash: (some proof-hash) }))
    (match (map-get? molbot-profiles tx-sender)
      p (map-set molbot-profiles tx-sender
          (merge p { last-active: stacks-block-height }))
      true)
    (print { e: "work-submitted", task-id: task-id,
             worker: tx-sender, proof-hash: proof-hash })
    (ok true)
  )
)

;; -- LAYER 5: SETTLEMENT -------------------------------------------------------

(define-public (confirm-delivery (task-id uint))
  (let ((task       (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
        (worker     (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
        (bid-id     (unwrap! (map-get? task-bidders { task-id: task-id, bidder: worker })
                             ERR-BID-NOT-FOUND))
        (bid        (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
        (stake      (get stake-amount bid))
        (fee        (compute-fee (get reward-amount task)))
        (net-reward (- (get reward-amount task) (compute-fee (get reward-amount task)))))
    (asserts! (is-eq tx-sender (get poster task)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status task) STATUS-SUBMITTED) ERR-INVALID-STATUS)
    (try! (contract-call? .sbtc  contract-transfer stake worker))
    (try! (contract-call? .usdcx contract-transfer net-reward worker))
    (var-set insurance-pool     (+ (var-get insurance-pool) fee))
    (var-set total-volume-usdcx (+ (var-get total-volume-usdcx) net-reward))
    (map-set tasks task-id (merge task { status: STATUS-COMPLETED }))
    (map-delete task-escrow task-id)
    (map-delete bid-stakes  bid-id)
    (match (map-get? molbot-profiles worker)
      p (map-set molbot-profiles worker
          (merge p { total-tasks-completed: (+ (get total-tasks-completed p) u1),
                     total-earned:          (+ (get total-earned p) net-reward),
                     reputation-score:      (if (> (+ (get reputation-score p) u50) u1000)
                                              u1000 (+ (get reputation-score p) u50)),
                     last-active:           stacks-block-height }))
      true)
    (print { e: "delivery-confirmed", task-id: task-id, worker: worker,
             net-reward: net-reward, fee: fee, stake-released: stake })
    (ok true)
  )
)

(define-public (slash-expired (task-id uint))
  (let ((task   (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
        (worker (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
        (bid-id (unwrap! (map-get? task-bidders { task-id: task-id, bidder: worker })
                         ERR-BID-NOT-FOUND))
        (bid    (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
        (stake  (get stake-amount bid))
        (reward (get reward-amount task)))
    (asserts! (or (is-eq (get status task) STATUS-ASSIGNED)
                  (is-eq (get status task) STATUS-SUBMITTED)) ERR-INVALID-STATUS)
    (asserts! (> stacks-block-height (get deadline task)) ERR-NOT-EXPIRED)
    (try! (contract-call? .usdcx contract-transfer reward (get poster task)))
    (var-set insurance-pool (+ (var-get insurance-pool) stake))
    (map-set tasks task-id (merge task { status: STATUS-EXPIRED }))
    (map-delete task-escrow task-id)
    (map-delete bid-stakes  bid-id)
    (match (map-get? molbot-profiles worker)
      p (map-set molbot-profiles worker
          (merge p { total-tasks-failed: (+ (get total-tasks-failed p) u1),
                     total-slashed:      (+ (get total-slashed p) stake),
                     reputation-score:   (if (>= (get reputation-score p) u100)
                                           (- (get reputation-score p) u100) u0) }))
      true)
    (print { e: "stake-slashed", task-id: task-id, worker: worker,
             slashed: stake, refund: reward })
    (ok true)
  )
)

;; -- LAYER 6: ORACLE SETTLEMENT ------------------------------------------------

(define-public (oracle-settle (task-id uint) (pay-worker bool))
  (let ((task       (unwrap! (map-get? tasks task-id) ERR-TASK-NOT-FOUND))
        (worker     (unwrap! (get assigned-to task) ERR-NOT-ASSIGNED))
        (bid-id     (unwrap! (map-get? task-bidders { task-id: task-id, bidder: worker })
                             ERR-BID-NOT-FOUND))
        (bid        (unwrap! (map-get? bids bid-id) ERR-BID-NOT-FOUND))
        (stake      (get stake-amount bid))
        (reward     (get reward-amount task))
        (fee        (compute-fee (get reward-amount task)))
        (net-reward (- (get reward-amount task) (compute-fee (get reward-amount task)))))
    (asserts! (is-eq (some contract-caller) (var-get oracle-addr)) ERR-NO-ORACLE)
    (asserts! (or (is-eq (get status task) STATUS-SUBMITTED)
                  (is-eq (get status task) STATUS-ASSIGNED)) ERR-INVALID-STATUS)
    (if pay-worker
      (begin
        (try! (contract-call? .sbtc  contract-transfer stake worker))
        (try! (contract-call? .usdcx contract-transfer net-reward worker))
        (var-set insurance-pool     (+ (var-get insurance-pool) fee))
        (var-set total-volume-usdcx (+ (var-get total-volume-usdcx) net-reward))
        (map-set tasks task-id (merge task { status: STATUS-COMPLETED }))
        (map-delete task-escrow task-id)
        (map-delete bid-stakes  bid-id)
        (match (map-get? molbot-profiles worker)
          p (map-set molbot-profiles worker
              (merge p { total-tasks-completed: (+ (get total-tasks-completed p) u1),
                         total-earned:          (+ (get total-earned p) net-reward),
                         reputation-score:      (if (> (+ (get reputation-score p) u50) u1000)
                                                  u1000 (+ (get reputation-score p) u50)),
                         last-active:           stacks-block-height }))
          true)
        (print { e: "oracle-settled-worker", task-id: task-id, worker: worker,
                 net-reward: net-reward })
        (ok true)
      )
      (begin
        (try! (contract-call? .usdcx contract-transfer reward (get poster task)))
        (var-set insurance-pool (+ (var-get insurance-pool) stake))
        (map-set tasks task-id (merge task { status: STATUS-EXPIRED }))
        (map-delete task-escrow task-id)
        (map-delete bid-stakes  bid-id)
        (match (map-get? molbot-profiles worker)
          p (map-set molbot-profiles worker
              (merge p { total-tasks-failed: (+ (get total-tasks-failed p) u1),
                         total-slashed:      (+ (get total-slashed p) stake),
                         reputation-score:   (if (>= (get reputation-score p) u100)
                                               (- (get reputation-score p) u100) u0) }))
          true)
        (print { e: "oracle-settled-poster", task-id: task-id,
                 poster: (get poster task), refund: reward })
        (ok true)
      )
    )
  )
)

;; -- READ-ONLY -----------------------------------------------------------------

(define-read-only (get-task (task-id uint))    (map-get? tasks task-id))
(define-read-only (get-bid (bid-id uint))      (map-get? bids bid-id))
(define-read-only (get-molbot-profile (addr principal)) (map-get? molbot-profiles addr))
(define-read-only (get-task-escrow (task-id uint))
  (default-to u0 (map-get? task-escrow task-id)))
(define-read-only (get-bid-stake (bid-id uint))
  (default-to u0 (map-get? bid-stakes bid-id)))
(define-read-only (get-bid-for-task (task-id uint) (bidder principal))
  (map-get? task-bidders { task-id: task-id, bidder: bidder }))
(define-read-only (get-insurance-pool)   (var-get insurance-pool))
(define-read-only (get-min-stake)        (var-get min-stake-amount))
(define-read-only (get-platform-fee-bps) (var-get platform-fee-bps))
(define-read-only (get-next-task-id)     (var-get next-task-id))
(define-read-only (get-next-bid-id)      (var-get next-bid-id))
(define-read-only (get-oracle-addr)      (var-get oracle-addr))
(define-read-only (get-contract-metrics)
  { total-volume:   (var-get total-volume-usdcx),
    total-tasks:    (var-get total-tasks-posted),
    insurance-pool: (var-get insurance-pool) })

;; -- ADMIN --------------------------------------------------------------------

(define-public (set-oracle (addr principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set oracle-addr (some addr))
    (print { e: "oracle-set", addr: addr })
    (ok true)
  )
)

(define-public (set-min-stake (amount uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set min-stake-amount amount)
    (ok true)
  )
)

(define-public (set-platform-fee (bps uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (<= bps u2000) ERR-INVALID-AMOUNT)
    (var-set platform-fee-bps bps)
    (ok true)
  )
)
