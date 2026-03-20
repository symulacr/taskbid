(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token sbtc)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant FAUCET-AMOUNT u100000000)

(define-data-var total-minted         uint u0)
(define-data-var total-faucet-claimed uint u0)
(define-data-var total-transfers      uint u0)

(define-map approved-minters principal bool)

(define-public (transfer (amount uint) (sender principal) (recipient principal)
                          (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? sbtc amount sender recipient))
    (var-set total-transfers (+ (var-get total-transfers) u1))
    (match memo m (print m) 0x)
    (print { e: "transfer", a: amount, f: sender, t: recipient })
    (ok true)
  )
)

(define-read-only (get-name)         (ok "TaskBid sBTC"))
(define-read-only (get-symbol)       (ok "tbsBTC"))
(define-read-only (get-decimals)     (ok u8))
(define-read-only (get-balance (account principal))
  (ok (ft-get-balance sbtc account)))
(define-read-only (get-total-supply) (ok (ft-get-supply sbtc)))
(define-read-only (get-token-uri)
  (ok (some u"https://taskbid.vercel.app/tokens/sbtc.json")))

;; Registry calls this to release escrowed sBTC.
;; contract-caller (the registry) is debited -- no as-contract needed.
(define-public (contract-transfer (amount uint) (recipient principal))
  (begin
    (try! (ft-transfer? sbtc amount contract-caller recipient))
    (var-set total-transfers (+ (var-get total-transfers) u1))
    (print { e: "escrow-release", from: contract-caller, to: recipient, a: amount })
    (ok true)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (var-set total-minted (+ (var-get total-minted) amount))
    (ft-mint? sbtc amount recipient)
  )
)

(define-public (faucet-mint (recipient principal))
  (begin
    (var-set total-faucet-claimed (+ (var-get total-faucet-claimed) FAUCET-AMOUNT))
    (print { e: "faucet", r: recipient, a: FAUCET-AMOUNT })
    (ft-mint? sbtc FAUCET-AMOUNT recipient)
  )
)

(define-public (minter-mint (recipient principal) (amount uint))
  (begin
    (asserts! (default-to false (map-get? approved-minters contract-caller))
              ERR-NOT-AUTHORIZED)
    (var-set total-minted (+ (var-get total-minted) amount))
    (ft-mint? sbtc amount recipient)
  )
)

(define-public (authorize-minter (addr principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (map-set approved-minters addr true)
    (ok true)
  )
)

(define-read-only (get-metrics)
  { minted: (var-get total-minted),
    faucet:  (var-get total-faucet-claimed),
    xfers:   (var-get total-transfers) })
