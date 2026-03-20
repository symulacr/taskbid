(define-constant COOLDOWN-BLOCKS u144)
(define-constant SBTC-DRIP       u100000000)
(define-constant USDCX-DRIP      u100000000)
(define-constant ERR-COOLDOWN    (err u201))

(define-map last-claim principal uint)
(define-data-var total-claims uint u0)

(define-public (claim-tokens)
  (let ((last (default-to u0 (map-get? last-claim tx-sender))))
    (asserts! (> stacks-block-height (+ last COOLDOWN-BLOCKS)) ERR-COOLDOWN)
    (try! (contract-call? .sbtc  faucet-mint tx-sender))
    (try! (contract-call? .usdcx faucet-mint tx-sender))
    (map-set last-claim tx-sender stacks-block-height)
    (var-set total-claims (+ (var-get total-claims) u1))
    (print { e: "tokens-claimed", addr: tx-sender,
             sbtc: SBTC-DRIP, usdcx: USDCX-DRIP })
    (ok { sbtc: SBTC-DRIP, usdcx: USDCX-DRIP })
  )
)

(define-read-only (get-cooldown-remaining (addr principal))
  (let ((last (default-to u0 (map-get? last-claim addr))))
    (if (> stacks-block-height (+ last COOLDOWN-BLOCKS))
      u0
      (- (+ last COOLDOWN-BLOCKS) stacks-block-height))))

(define-read-only (get-total-claims) (var-get total-claims))
