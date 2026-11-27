// Mirror the transaction grouping used by groupBills, then match refunds by payment ID.
export function refundsForBill(bill, payments, refunds) {
  const first = payments.find(p => p.id === bill.paymentId)
  if (!first) return []
  const key = p => p.txn || p.encounterId || p.id
  const ids = new Set(payments.filter(p => key(p) === key(first) && p.branch === first.branch).map(p => p.id))
  return refunds.filter(refund => ids.has(refund.payment))
}
