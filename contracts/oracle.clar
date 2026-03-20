(define-constant CONTRACT-OWNER     tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u300))
(define-constant ERR-NOT-FOUND      (err u301))
(define-constant ERR-ALREADY-EXISTS (err u302))
(define-constant ERR-DISPUTE-CLOSED (err u303))

(define-map approved-solvers principal bool)

(define-map proof-status uint
  { verified: bool,
    solver:   principal,
    block:    uint,
    score:    uint })

(define-map disputes uint
  { opener:  principal,
    reason:  (string-ascii 256),
    status:  uint })

(define-map price-feed (string-ascii 8)
  { price-usd-micro: uint,
    last-block:      uint })

(define-data-var verified-count uint u0)
(define-data-var dispute-count  uint u0)

(map-set approved-solvers CONTRACT-OWNER true)

(define-public (verify-proof (task-id uint) (proof-hash (buff 32)) (quality-score uint))
  (begin
    (asserts! (default-to false (map-get? approved-solvers tx-sender))
              ERR-NOT-AUTHORIZED)
    (asserts! (is-none (map-get? proof-status task-id)) ERR-ALREADY-EXISTS)
    (map-set proof-status task-id
      { verified: true, solver: tx-sender,
        block: stacks-block-height, score: quality-score })
    (var-set verified-count (+ (var-get verified-count) u1))
    (print { e: "proof-verified", task-id: task-id,
             solver: tx-sender, score: quality-score })
    (ok true)
  )
)

(define-public (open-dispute (task-id uint) (reason (string-ascii 256)))
  (begin
    (asserts! (is-none (map-get? disputes task-id)) ERR-ALREADY-EXISTS)
    (map-set disputes task-id
      { opener: tx-sender, reason: reason, status: u0 })
    (var-set dispute-count (+ (var-get dispute-count) u1))
    (print { e: "dispute-opened", task-id: task-id,
             opener: tx-sender, reason: reason })
    (ok true)
  )
)

(define-public (resolve-dispute (task-id uint) (pay-worker bool))
  (let ((dispute (unwrap! (map-get? disputes task-id) ERR-NOT-FOUND)))
    (asserts! (default-to false (map-get? approved-solvers tx-sender))
              ERR-NOT-AUTHORIZED)
    (asserts! (is-eq u0 (get status dispute)) ERR-DISPUTE-CLOSED)
    (try! (contract-call? .registry oracle-settle task-id pay-worker))
    (map-set disputes task-id (merge dispute { status: u1 }))
    (print { e: "dispute-resolved", task-id: task-id,
             solver: tx-sender, pay-worker: pay-worker })
    (ok true)
  )
)

(define-public (update-price (token (string-ascii 8)) (price-usd-micro uint))
  (begin
    (asserts! (default-to false (map-get? approved-solvers tx-sender))
              ERR-NOT-AUTHORIZED)
    (map-set price-feed token
      { price-usd-micro: price-usd-micro, last-block: stacks-block-height })
    (print { e: "price-updated", token: token, price: price-usd-micro })
    (ok true)
  )
)

(define-public (register-solver (addr principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set approved-solvers addr true)
    (print { e: "solver-registered", addr: addr })
    (ok true)
  )
)

(define-read-only (is-verified (task-id uint))
  (default-to false (get verified (map-get? proof-status task-id))))
(define-read-only (get-proof-status (task-id uint))
  (map-get? proof-status task-id))
(define-read-only (get-dispute (task-id uint))
  (map-get? disputes task-id))
(define-read-only (get-price (token (string-ascii 8)))
  (map-get? price-feed token))
(define-read-only (is-approved-solver (addr principal))
  (default-to false (map-get? approved-solvers addr)))
(define-read-only (get-metrics)
  { verified: (var-get verified-count), disputes: (var-get dispute-count) })
