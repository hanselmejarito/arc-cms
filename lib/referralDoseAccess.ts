type EncounterLink = { id:string; continuedFromEncounterId:string|null; receivingEncounterId?:string|null }
type AcceptedReferral = { encounterId:string; receivingEncounterId:string; status:string }
// Only share source dose history for a verified accepted link into an accessible receiving visit.
export function accessibleDoseEncounterIds(encounters: EncounterLink[], referrals: AcceptedReferral[]) {
  const ids = new Set(encounters.map(e=>e.id))
  for (const e of encounters) {
    if (e.continuedFromEncounterId && referrals.some(r=>r.status==='Accepted' && r.encounterId===e.continuedFromEncounterId && r.receivingEncounterId===e.id)) ids.add(e.continuedFromEncounterId)
    if (e.receivingEncounterId && referrals.some(r=>r.status==='Accepted' && r.encounterId===e.id && r.receivingEncounterId===e.receivingEncounterId)) ids.add(e.receivingEncounterId)
  }
  return ids
}
