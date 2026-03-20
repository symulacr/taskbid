(define-constant CONTRACT-OWNER     tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u400))

(define-data-var weight-reputation uint u10)
(define-data-var weight-bid-ratio  uint u5)
(define-data-var weight-stake      uint u2)
(define-data-var slash-bounty-bps  uint u100)
(define-data-var auto-accept-enabled bool false)
(define-data-var auto-accept-min-rep uint u700)
(define-data-var total-slashes-triggered uint u0)

(define-public (trigger-slash (task-id uint))
  (begin
    (try! (contract-call? .registry slash-expired task-id))
    (var-set total-slashes-triggered (+ (var-get total-slashes-triggered) u1))
    (print { e: "slash-triggered", task-id: task-id, caller: tx-sender })
    (ok true)
  )
)

(define-read-only (compute-priority-score (reputation uint) (bid-price uint)
                                           (reward uint)     (stake uint)
                                           (min-stake uint))
  (+ (* reputation (var-get weight-reputation))
     (if (> reward u0)
       (/ (* bid-price u1000 (var-get weight-bid-ratio)) reward)
       u0)
     (if (>= stake min-stake)
       (* u100 (var-get weight-stake))
       u0))
)

(define-public (configure-weights (rep uint) (bid-ratio uint) (stake uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set weight-reputation rep)
    (var-set weight-bid-ratio  bid-ratio)
    (var-set weight-stake      stake)
    (print { e: "weights-updated", rep: rep, bid-ratio: bid-ratio, stake: stake })
    (ok true)
  )
)

(define-public (configure-auto-accept (enabled bool) (min-rep uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set auto-accept-enabled enabled)
    (var-set auto-accept-min-rep min-rep)
    (ok true)
  )
)

(define-read-only (get-config)
  { weight-reputation:   (var-get weight-reputation),
    weight-bid-ratio:    (var-get weight-bid-ratio),
    weight-stake:        (var-get weight-stake),
    slash-bounty-bps:    (var-get slash-bounty-bps),
    auto-accept-enabled: (var-get auto-accept-enabled),
    auto-accept-min-rep: (var-get auto-accept-min-rep) })

(define-read-only (get-total-slashes) (var-get total-slashes-triggered))
