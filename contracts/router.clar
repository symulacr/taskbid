(define-constant CONTRACT-OWNER     tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u500))
(define-constant ERR-INVALID-AMOUNT (err u501))

(define-data-var total-routed-tasks uint u0)
(define-data-var total-volume-usdcx uint u0)

;; Mint USDCx to user (simulates Bitflow STX->USDCx swap), then post task.
;; tx-sender = user throughout; registry pulls USDCx from user after mint.
(define-public (post-task-with-stx
    (title          (string-ascii 64))
    (description    (string-ascii 256))
    (skill-required (string-ascii 32))
    (reward-amount  uint)
    (required-stake uint)
    (deadline       uint))
  (begin
    (asserts! (> reward-amount u0) ERR-INVALID-AMOUNT)
    (try! (contract-call? .usdcx minter-mint tx-sender reward-amount))
    (let ((result (try! (contract-call? .registry post-task
                          title description skill-required
                          reward-amount required-stake deadline))))
      (var-set total-routed-tasks (+ (var-get total-routed-tasks) u1))
      (var-set total-volume-usdcx (+ (var-get total-volume-usdcx) reward-amount))
      (print { e: "task-routed", task-id: result, reward: reward-amount })
      (ok result)
    )
  )
)

;; Mint sBTC to user (simulates Bitflow STX->sBTC swap), then place bid.
(define-public (bid-with-stx (task-id uint) (bid-price uint) (stake-amount uint))
  (begin
    (asserts! (> bid-price u0) ERR-INVALID-AMOUNT)
    (try! (contract-call? .sbtc minter-mint tx-sender stake-amount))
    (try! (contract-call? .registry place-bid task-id bid-price))
    (print { e: "bid-routed", task-id: task-id,
             bid-price: bid-price, stake: stake-amount })
    (ok true)
  )
)

(define-read-only (get-metrics)
  { total-routed: (var-get total-routed-tasks),
    volume-usdcx: (var-get total-volume-usdcx) })
