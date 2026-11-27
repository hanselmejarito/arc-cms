import { treatmentRecorded, treatmentSnapshot } from '../lib/treatmentRecordLock'
export function referralTreatmentEntries(kind, encounter) {
 const origin = encounter?.[kind] || {}, linked = encounter?.referralProgress?.[kind] || {}
 const hasOrigin=treatmentRecorded(kind,origin), hasLinked=treatmentRecorded(kind,linked)
 const same=hasOrigin&&hasLinked&&JSON.stringify(treatmentSnapshot(kind,origin))===JSON.stringify(treatmentSnapshot(kind,linked))
 const rows=[]
 if(hasOrigin)rows.push({branch:encounter.branch,value:origin})
 if(hasLinked&&!same)rows.push({branch:encounter.referralProgress.branch,value:linked})
 return rows.length?rows:[{branch:'',value:origin}]
}
