;; Mock USDCx Token - SIP-010 Compliant
;; For testnet/demo purposes only
;; Note: USDCx uses 6 decimal places (1 USDCx = 1000000 micro-USDCx)

(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token mock-usdcx)

(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-BALANCE (err u402))

(define-constant CONTRACT-OWNER tx-sender)

;; SIP-010 Implementation

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? mock-usdcx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name)
  (ok "Mock USDCx")
)

(define-read-only (get-symbol)
  (ok "USDCx")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance mock-usdcx account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply mock-usdcx))
)

(define-read-only (get-token-uri)
  (ok none)
)

;; Mint function for testing
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (ft-mint? mock-usdcx amount recipient)
  )
)
