;; RoyaltyDistributor.clar
;; Core contract for distributing royalties in pharmaceutical patent collaborations.
;; Handles share management, royalty calculations, and automated distributions.
;; Integrates with PatentRegistry for validation and TokenIntegrator for payouts.
;; Supports STX and fungible tokens (FTs) via traits.

;; Traits
(define-trait patent-registry-trait
  (
    (get-patent-owner ((buff 32)) (response principal uint))
    (get-patent-contributors ((buff 32)) (response (list 50 principal) uint))
    (is-patent-registered ((buff 32)) (response bool uint))
  )
)

(define-trait token-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-balance (principal) (response uint uint))
  )
)

;; Constants
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-PATENT u101)
(define-constant ERR-INVALID-SHARE u102)
(define-constant ERR-NO-CONTRIBUTORS u103)
(define-constant ERR-DISTRIBUTION-FAILED u104)
(define-constant ERR-INVALID-AMOUNT u105)
(define-constant ERR-ALREADY-INITIALIZED u106)
(define-constant ERR-PAUSED u107)
(define-constant ERR-INVALID-TOKEN u108)
(define-constant ERR-SHARES-NOT-SET u109)
(define-constant ERR-INVALID-RECIPIENT u110)
(define-constant ERR-OVERFLOW u111)
(define-constant ERR-MAX-CONTRIBUTORS-EXCEEDED u112)

(define-constant MAX-CONTRIBUTORS u50)
(define-constant MAX_SHARE_PERCENTAGE u100)
(define-constant MIN_DEPOSIT_AMOUNT u1)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var total-distributed uint u0)
(define-data-var distribution-counter uint u0)

;; Data Maps
(define-map patent-shares
  { patent-id: (buff 32) }
  { shares: (list 50 { contributor: principal, percentage: uint }) }
)

(define-map distribution-history
  { distribution-id: uint }
  {
    patent-id: (buff 32),
    amount: uint,
    token-type: (optional principal), ;; none for STX, some contract for FT
    timestamp: uint,
    distributor: principal
  }
)

(define-map contributor-payouts
  { patent-id: (buff 32), contributor: principal }
  { total-received: uint }
)

;; Private Functions
(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

(define-private (validate-shares (shares (list 50 { contributor: principal, percentage: uint })))
  (let
    (
      (total-percent (fold + (map get-percentage shares) u0))
    )
    (if (and
          (> (len shares) u0)
          (<= (len shares) MAX-CONTRIBUTORS)
          (is-eq total-percent MAX_SHARE_PERCENTAGE)
          (fold and (map valid-percentage shares) true)
        )
        (ok true)
        (err ERR-INVALID-SHARE)
    )
  )
)

(define-private (get-percentage (share { contributor: principal, percentage: uint }))
  (get percentage share)
)

(define-private (valid-percentage (share { contributor: principal, percentage: uint }))
  (and (> (get percentage share) u0) (<= (get percentage share) MAX_SHARE_PERCENTAGE))
)

(define-private (calculate-payout (amount uint) (percentage uint))
  (let
    (
      (payout (/ (* amount percentage) MAX_SHARE_PERCENTAGE))
    )
    (asserts! (<= payout amount) (err ERR-OVERFLOW))
    payout
  )
)

(define-private (distribute-to-contributor
  (patent-id (buff 32))
  (contributor principal)
  (payout uint)
  (token-type (optional principal))
  )
  (begin
    (asserts! (> payout u0) (err ERR-INVALID-AMOUNT))
    (asserts! (not (is-eq contributor (as-contract tx-sender))) (err ERR-INVALID-RECIPIENT))
    (match token-type
      token-contract
        (try! (as-contract (contract-call? token-trait transfer payout tx-sender contributor none)))
      (try! (stx-transfer? payout tx-sender contributor))
    )
    (let
      (
        (current-received (default-to u0 (get total-received (map-get? contributor-payouts { patent-id: patent-id, contributor: contributor }))))
      )
      (map-set contributor-payouts
        { patent-id: patent-id, contributor: contributor }
        { total-received: (+ current-received payout) }
      )
      (ok true)
    )
  )
)

;; Public Functions
(define-public (set-patent-shares
  (patent-id (buff 32))
  (shares (list 50 { contributor: principal, percentage: uint }))
  (registry <patent-registry-trait>)
  )
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (let
      (
        (is-registered (try! (contract-call? registry is-patent-registered patent-id)))
        (owner (try! (contract-call? registry get-patent-owner patent-id)))
      )
      (asserts! is-registered (err ERR-INVALID-PATENT))
      (asserts! (is-eq tx-sender owner) (err ERR-NOT-AUTHORIZED))
      (try! (validate-shares shares))
      (map-set patent-shares { patent-id: patent-id } { shares: shares })
      (ok true)
    )
  )
)

(define-public (distribute-royalties
  (patent-id (buff 32))
  (amount uint)
  (token-type (optional principal))
  (registry <patent-registry-trait>)
  )
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (>= amount MIN_DEPOSIT_AMOUNT) (err ERR-INVALID-AMOUNT))
    (let
      (
        (shares-opt (map-get? patent-shares { patent-id: patent-id }))
        (contributors (try! (contract-call? registry get-patent-contributors patent-id)))
        (dist-id (+ (var-get distribution-counter) u1))
      )
      (asserts! (is-some shares-opt) (err ERR-SHARES-NOT-SET))
      (asserts! (> (len contributors) u0) (err ERR-NO-CONTRIBUTORS))
      (var-set distribution-counter dist-id)
      (map-set distribution-history
        { distribution-id: dist-id }
        {
          patent-id: patent-id,
          amount: amount,
          token-type: token-type,
          timestamp: block-height,
          distributor: tx-sender
        }
      )
      (var-set total-distributed (+ (var-get total-distributed) amount))
      (fold distribute-fold (get shares (unwrap! shares-opt (err ERR-SHARES-NOT-SET))) (ok { remaining: amount, token-type: token-type, patent-id: patent-id }))
    )
  )
)

(define-private (distribute-fold
  (share { contributor: principal, percentage: uint })
  (acc (response { remaining: uint, token-type: (optional principal), patent-id: (buff 32) } uint))
  )
  (match acc
    success
      (let
        (
          (payout (calculate-payout (get remaining success) (get percentage share)))
          (new-remaining (- (get remaining success) payout))
        )
        (try! (distribute-to-contributor (get patent-id success) (get contributor share) payout (get token-type success)))
        (ok { remaining: new-remaining, token-type: (get token-type success), patent-id: (get patent-id success) })
      )
    error error
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-owner) (err ERR-NOT-AUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-patent-shares (patent-id (buff 32)))
  (map-get? patent-shares { patent-id: patent-id })
)

(define-read-only (get-distribution-history (dist-id uint))
  (map-get? distribution-history { distribution-id: dist-id })
)

(define-read-only (get-contributor-payouts (patent-id (buff 32)) (contributor principal))
  (map-get? contributor-payouts { patent-id: patent-id, contributor: contributor })
)

(define-read-only (get-total-distributed)
  (ok (var-get total-distributed))
)

(define-read-only (get-contract-owner)
  (ok (var-get contract-owner))
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-read-only (get-distribution-counter)
  (ok (var-get distribution-counter))
)