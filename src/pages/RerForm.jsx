import React from 'react'
import { ageFrom, branchMaster, caseInfo, protocolOf } from '../data'
import { BrandLogo } from '../components'
import bodyMap from '../assets/arc-male-body-map.jpg'

const bodyPoints={
 Head:{L:[138,31],R:[114,31]},
 'Upper extremity':{L:[174,120],R:[78,120]},
 Hand:{L:[183,186],R:[64,186]},
 'Lower extremity':{L:[144,246],R:[108,246]},
 Foot:{L:[147,318],R:[100,318]}
}
const Box=({on})=><i className={'arc-box'+(on?' on':'')} aria-hidden="true">{on&&<svg viewBox="0 0 12 12" focusable="false"><path d="M2 6.2 4.7 8.8 10 3.2"/></svg>}</i>
const YN=({v})=><span className="arc-yn"><Box on={v===true}/> Y <Box on={v===false}/> N</span>
const slash=(d,full)=>{if(!d)return '';const [y,m,da]=d.slice(0,10).split('-');return m+' / '+da+' / '+(full?y:y.slice(2))}
const paperDays=[
 {day:'D0',title:'DAY 0',given:'Anti - Rabies day 0 given',next:'Day 3',idOpts:true},
 {day:'D3',title:'DAY 3',given:'Anti - Rabies day 3 given',next:'Day 7',idOpts:true},
 {day:'D7',title:'DAY 7',given:'Anti - Rabies day 7 given',next:'Day 28/30',idOpts:true},
 {day:'D14',title:'DAY 14',given:'Anti - Rabies day 14 given',next:'',idOpts:false},
 {day:'D28',title:'DAY 21/28',given:'Anti - Rabies day 21 given',next:'',idOpts:true}
]

function DoseBlock({row,g}){
 const two=/2 sites/i.test(g?.dose||''),one=/1 site/i.test(g?.dose||''),im=/IM/i.test(g?.dose||'')
 const alive=g?.animalStatus==='Alive',lost=g?.animalStatus==='Lost/Stray',dead=g?.animalStatus==='Dead'
 const next=g?.advised?g.advised.replace(/^Advised to come back:\s*/i,''):row.next
 return <div className="arc-dose">
  <div className="arc-dose-meta">
   <span className="arc-dose-label">Date/Time</span>
   <b className="arc-dose-date">{g?slash(g.date).replaceAll(' ',''):'__/__/26'}</b>
   <small className="arc-dose-time">{g?.time||'__:__'}</small>
   <span>Vaccinator</span>
   <em>{g?.vaccinator||'__________'}</em>
  </div>
  <div className="arc-dose-body">
   <div className="arc-dose-heading"><strong>{row.title}</strong><div className="arc-lr"><span>L / R</span><Box on={g?.side==='L'}/> L <Box on={g?.side==='R'}/> R</div></div>
   <label className="arc-dose-given"><Box on={!!g}/> {row.given}</label>
   <div className={'arc-dose-options'+(row.idOpts?'':' im-only')}>
    {row.idOpts&&<label><Box on={two}/> 0.1 ml x 2 sites ID</label>}
    <label className="arc-im-option"><Box on={im}/> 1 vial IM</label>
    {row.idOpts&&<label><Box on={one}/> 0.1 ml x 1 site ID</label>}
   </div>
   {next&&<label className="arc-dose-advice"><Box on={!!g?.advised}/> Advised to come back for {next}</label>}
   <div className="arc-animal-status"><label><Box on={alive}/> ALIVE</label><label><Box on={lost}/> LOST/STRAY</label><label><Box on={dead}/> DEAD</label></div>
  </div>
 </div>
}

export function printRer(){
 const root=document.documentElement
 root.classList.add('print-rer')
 const clear=()=>{root.classList.remove('print-rer');window.removeEventListener('afterprint',clear)}
 window.addEventListener('afterprint',clear)
 window.setTimeout(clear,120000)
 window.setTimeout(()=>window.print(),40)
}

export function RerSheet({e,p,doses}){
 const info=caseInfo(e,doses)
 const br=branchMaster.find(b=>b.name===e.branch)||branchMaster[0]
 const h=e.history||{},tt=e.tt||{},er=e.erig||{},pr=e.progress||{}
 const st=info.status,point=bodyPoints[e.site]?.[e.side||'L']
 const brand=(er.brand||'').toLowerCase()
 return <div className="rer-sheet arc-form">
  <header className="arc-form-head">
   <span className="arc-form-logo"><BrandLogo alt="ARC"/></span>
   <div className="arc-form-title">
    <h1>ARC ANIMAL BITE CENTER</h1>
    <p>{br.address||'Saranay District, Guimba, Nueva Ecija'}</p>
    <small>Mobile No: {br.contact||'0946 945 1531'} / EMAIL ADDRESS arcantirabiesclinic@gmail.com</small>
   </div>
   <span className="arc-form-head-spacer" aria-hidden="true"/>
  </header>

  <div className="arc-id">
   <div className="arc-id-line arc-name-line"><span>Name:</span><b className="arc-name-value">{p.name||''}</b><span className="arc-name-registry">Registry NO. <b>{e.registry||'2026-0000'}</b></span></div>
   {(e.originRegistry||e.receivingRegistry)&&<div className="arc-registry-trace">{e.originRegistry&&<span>Origin {e.originRegistry}</span>}{e.receivingRegistry&&<span>Receiving {e.receivingRegistry}</span>}</div>}
   <div className="arc-id-line"><span>Birthday:</span><b>{slash(p.birthday,true)}</b><span>Age:</span><b>{ageFrom(p.birthday)||p.age||''}</b><span>Gender:</span><b>{p.sex||''}</b><span>Cellphone No.:</span><b>{p.contact||''}</b></div>
   <div className="arc-id-line"><span>Address:</span><b className="grow">{p.address||''}</b></div>
   <div className="arc-id-line"><span>Name of Mother/Father/Guardian:</span><b className="grow">{p.guardian||''}</b>
    <span className="arc-flags"><label><Box on={!!p.senior}/> Senior</label><label><Box on={!!p.pwd}/> PWD</label><label><Box on={!!p.vetmed}/> Vetmed</label><label><Box on={!!p.philhealth}/> PHILHEALTH</label></span>
   </div>
  </div>

  <div className="arc-main">
   <div className="arc-left">
    <div className="arc-block">
     <h3>VACCINE:</h3>
     <label><Box on={e.vaccine==='PCEC'}/> PCEC</label>
     <label><Box on={e.vaccine==='PVRV'}/> PVRV</label>
     <div className="arc-lr stacked"><Box on={e.side==='L'}/> L <Box on={e.side==='R'}/> R</div>
    </div>
    <div className="arc-block">
     <h3>CATEGORY:</h3>
     {['I','II','III'].map(c=><label key={c}><Box on={e.category===c}/> {c}</label>)}
    </div>
    <label className="arc-block tight"><Box on={!!e.booster}/> BOOSTER:</label>
    <label className="arc-block tight"><Box on={!!e.preExp}/> PRE-EXP:</label>
   </div>
   <div className="arc-center">
    <h3>Chief Complaints</h3>
    <div className="arc-bodies">
     <svg viewBox="0 0 460 360" aria-label="Bite site">
      <image href={bodyMap} x="0" y="0" width="460" height="345" preserveAspectRatio="xMidYMid meet"/>
      {point&&<g className="body-marker"><circle cx={point[0]} cy={point[1]} r="16"/><circle cx={point[0]} cy={point[1]} r="6"/></g>}
     </svg>
    </div>
    {e.chief&&<p className="arc-chief">{e.chief}{e.site?' · '+(e.side||'')+' '+e.site:''}</p>}
   </div>
   <div className="arc-right">
    <div className="arc-row"><b>Bitting Animal:</b> <Box on={e.animal==='Dog'}/> Dog <Box on={e.animal==='Cat'}/> Cat <Box on={e.animal==='Others'}/> Oth: <u className="arc-animal-other">{e.animal==='Others'?e.animalOther:''}</u></div>
    <div className="arc-row"><b>Type of Bite:</b> <Box on={e.biteType==='Bite'}/> Bite <Box on={e.biteType==='Non-Bite'}/> Non-Bite</div>
    <div className="arc-row">Pet: <YN v={e.pet}/> Vaccinated: <YN v={e.vaccinated}/> Stray: <YN v={e.stray}/></div>
    <div className="arc-row">Owned: <YN v={e.owned}/> If not, whom: <u className="arc-owner-line">{e.owned?'':(e.owner||'')}</u></div>
    <div className="arc-row"><span className="arc-gold-label">Date of bite:</span> <u>{slash(e.biteDate)}</u> Time: <u>{e.biteTime||''}</u></div>
    <div className="arc-row"><span className="arc-gold-label">SOB:</span> <Box on={e.side==='L'}/> L <Box on={e.side==='R'}/> R &nbsp; POB: <u>{e.place||''}</u></div>
    <div className="arc-row">Washing of Wound: <YN v={e.washed}/> Tandok: <YN v={e.tandok}/></div>
    <div className="arc-row"><b>TYPE OF WOUND:</b></div>
    <div className="arc-row wrap">{['Abrasion','Lacerated','Bruised','Healed'].map(w=><label key={w}><Box on={(e.wound||[]).includes(w)}/> {w}</label>)}</div>
    <div className="arc-row"><b className="arc-medical-heading">MEDICAL HISTORY:</b></div>
    <div className="arc-row wrap">
     <span>IDDM: <YN v={h.iddm}/></span>
     <span>Kidney Disease: <YN v={h.kidney}/></span>
     <span>Others: <u>{h.others||''}</u></span>
     <span>Dialysis: <YN v={h.dialysis}/></span>
     <span>Cancer: <YN v={h.cancer}/></span>
     <span>Allergy: <YN v={h.allergy}/></span>
     <span>Steroids: <YN v={h.steroids}/></span>
     <span>Insulin: <YN v={h.insulin}/></span>
    </div>
    <div className="arc-row">BP: <u>{e.bp||''}</u> Wt: <u>{e.weight||''}</u> Temp: <u>{e.temp||''}</u></div>
   </div>
  </div>

  <div className="arc-lower">
   <div className="arc-doses">{paperDays.map(row=><DoseBlock key={row.day} row={row} g={info.given.find(x=>x.day===row.day)}/>)}</div>
   <div className="arc-side">
    <div className="arc-panel">
     <h3>CONSENT FORM</h3>
     <p className="arc-sign-label">SIGNATURE OVER PRINTED NAME</p>
     <div className="arc-sign-line">{e.consent?e.consentBy:''}</div>
    </div>
    <div className="arc-panel">
     <h3>TETANUS TOXOID:</h3>
     <p>Date: <u>{slash(tt.date)}</u> Time: <u>{tt.time||''}</u></p>
     <p>Refused: <Box on={!!tt.refused}/> With Previous <Box on={!!tt.withPrevious}/></p>
    </div>
    <div className="arc-panel">
     <h3>ERIG: <span className="arc-erig-options"><Box on={brand.includes('equirab')}/> EQUIRAB <Box on={brand.includes('vinrab')}/> VINRAB</span></h3>
     <p>Date: <u>{slash(er.date)}</u></p>
     <p>Time of Skin Test: <u>{er.skinTime||''}</u></p>
     <p>Result of ST: <u>{er.skinResult||''}</u> Weight: <u>{er.weight||''}</u></p>
     <p>Infiltration: <YN v={er.infiltration}/> ML used: <u>{er.ml||''}</u> ml</p>
     <p>Refused: <Box on={!!er.refused}/></p>
    </div>
    <div className="arc-panel">
     <h3>PROGRESS NOTE:</h3>
     <div className="arc-progress-fields">
      <div className="arc-progress-checks">
       <label><Box on={!!pr.healthy}/> Patient is Healthy:</label>
       <label><Box on={!!pr.healed}/> Wound is healed</label>
      </div>
      <p className="arc-progress-others"><span>Others(please specify):</span><u>{pr.others||''}</u></p>
     </div>
     <p className="arc-doc"><span className="arc-doc-label">Doctor’s Signature:</span><span className="arc-doc-signature"><span className="arc-doc-sign-line" aria-hidden="true"/><b>{e.doctor||''}</b></span></p>
    </div>
   </div>
  </div>

  <div className="arc-remarks">
   <b>REMARKS:</b>
   <label><Box on={st==='Complete'}/> Complete</label>
   <label><Box on={st==='Incomplete'}/> Incomplete</label>
   <label><Box on={st==='Transferred'}/> Transferred</label>
   {protocolOf(e).days.some(([d])=>!paperDays.some(r=>r.day===d)&&info.given.some(g=>g.day===d))&&<small>Extra protocol doses are on the treatment record.</small>}
  </div>
 </div>
}
