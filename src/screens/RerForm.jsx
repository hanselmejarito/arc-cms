import React from 'react'
import { ageFrom, branchMaster, caseInfo } from '../data'
import { BrandLogo } from '../components'
const bodyMap='/arc-male-body-map.jpg'

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
 const next=row.next?(g?.advised?g.advised.replace(/^Advised to come back:\s*/i,'').replace(/\s*·\s*.*$/,''):row.next):''
 return <div className="arc-dose">
  <div className="arc-dose-meta">
   <span className="arc-dose-label">Date/Time</span>
   <b className="arc-dose-date">{g?slash(g.date).replaceAll(' ',''):'__/__/26'}</b>
   <small className="arc-dose-time">{g?.time||'__:__'}</small>
   <span className="arc-dose-label arc-vaccinator-label">Vaccinator</span>
   <em className="arc-vaccinator-name">{g?.vaccinator||'__________'}</em>
  </div>
  <div className="arc-dose-body">
   <div className="arc-dose-heading"><strong>{row.title}</strong><strong>L / R</strong></div>
   <label className="arc-dose-given"><Box on={!!g}/> {row.given}</label>
   <div className={'arc-dose-options'+(row.idOpts?'':' im-only')}>
    {row.idOpts&&<label><Box on={two}/> 0.1 ml x 2 sites ID</label>}
    <label className="arc-im-option"><Box on={im}/> 1 vial IM</label>
    {row.idOpts&&<label><Box on={one}/> 0.1 ml x 1 site ID</label>}
   </div>
   {row.next&&<label className="arc-dose-advice"><Box on={!!g&&!!next}/> Advised to come back for {next}</label>}
   <div className="arc-animal-status"><label><Box on={alive}/> ALIVE</label><label><Box on={lost}/> LOST/STRAY</label><label><Box on={dead}/> DEAD</label></div>
  </div>
 </div>
}

export function printAdmission(){
 const packet=document.querySelector('.admission-print-only .admission-sheet')||document.querySelector('.admission-sheet')
 if(!packet)return
 const host=document.createElement('div')
 host.className='rer-print-host admission-print-host'
 host.appendChild(packet.cloneNode(true))
 document.body.appendChild(host)
 const root=document.documentElement
 root.classList.add('print-admission','print-rer')
 const clear=()=>{root.classList.remove('print-admission','print-rer');host.remove();window.removeEventListener('afterprint',clear)}
 window.addEventListener('afterprint',clear)
 window.setTimeout(clear,120000)
 window.setTimeout(()=>window.print(),40)
}
export const printRer=printAdmission

const animalMark=(n,key)=>{
 const a=String(n?.animal||'').toLowerCase().replace(/\s+/g,' ')
 if(key==='alive')return a==='alive'
 if(key==='stray')return a.includes('stray')||a.includes('unknown')
 if(key==='weak')return a==='weak'
 if(key==='dead')return a==='dead'
 if(key==='missing')return a==='missing'||a.includes('lost')
 if(key==='behavior')return a.includes('behavior')||a.includes('behaviour')
 return false
}

const soapNum=v=>String(v||'').replace(/^Day\s+/i,'')

function SoapPaperBlock({n}){
 const s=n?.s||{},o=n?.o||{},a=n?.a||{},p=n?.p||{}
 return <div className="soap-paper-block">
  <div className="soap-paper-date">DATE: <u>{n?slash(n.date,true):''}</u></div>
  <b className="soap-l soap-l-s">S</b>
  <div className="soap-paper-s">
   <div className="soap-paper-col">
    <label><Box on={!!s.fever}/> fever</label>
    <label><Box on={!!s.rashes}/> rashes</label>
    <label><Box on={!!s.numbness}/> numbness at the wound site</label>
    <label><Box on={!!s.headaches}/> headaches</label>
    <label><Box on={!!s.others}/> others <u>{s.others||''}</u></label>
   </div>
   <div className="soap-paper-animal">
    <strong>status of biting animal</strong>
    <div className="soap-paper-animal-grid">
     <label><Box on={animalMark(n,'alive')}/> alive</label>
     <label><Box on={animalMark(n,'stray')}/> unknown / stray</label>
     <label><Box on={animalMark(n,'weak')}/> weak</label>
     <label><Box on={animalMark(n,'dead')}/> DEAD</label>
     <label><Box on={animalMark(n,'missing')}/> missing</label>
     <label><Box on={animalMark(n,'behavior')}/> change in behavior</label>
    </div>
   </div>
  </div>
  <div className="soap-paper-sign">
   <em>{n?.staff||''}</em>
   <span>NAME & SIGNATURE</span>
  </div>
  <b className="soap-l soap-l-o">O</b>
  <div className="soap-paper-o">
   <div className="soap-paper-col">
    <label><Box on={!!o.temp}/> body temperature <u>{o.temp||''}</u></label>
    <label><Box on={!!o.bp||!!o.hr}/> BP <u>{o.bp||''}</u> / HR <u>{o.hr||''}</u></label>
    <label><Box on={!!o.weakness}/> general weakness</label>
   </div>
   <div className="soap-paper-col">
    <label><Box on={!!o.hydrophobia}/> hydrophobia</label>
    <label><Box on={!!o.aerophobia}/> aerophobia</label>
    <label><Box on={!!o.photophobia}/> photophobia</label>
   </div>
   <div className="soap-paper-col">
    <label><Box on={!!o.rashes}/> rashes</label>
    <label><Box on={!!o.others}/> others <u>{o.others||''}</u></label>
   </div>
  </div>
  <b className="soap-l soap-l-a">A</b>
  <div className="soap-paper-a">
   <div className="soap-paper-col">
    <label><Box on={!!a.spBite}/> s/p animal bite</label>
    <label><Box on={!!a.healed}/> healed wound secondary to animal bite</label>
   </div>
   <label><Box on={!!a.others}/> others <u>{a.others||''}</u></label>
  </div>
  <b className="soap-l soap-l-p">P</b>
  <div className="soap-paper-p">
   <div className="soap-paper-col">
    <label><Box on={!!p.day}/> give day <u>{soapNum(p.day)}</u> of anti rabies vaccine</label>
    <label><Box on={!!p.erig}/> give ERIG</label>
    <label><Box on={!!p.returnDay}/> to come back on DAY <u>{soapNum(p.returnDay)}</u></label>
   </div>
   <div className="soap-paper-col">
    <label><Box on={!!p.observe}/> cont. observation of biting animal</label>
    <label><Box on={!!p.others}/> others <u>{p.others||''}</u></label>
   </div>
  </div>
 </div>
}

function soapPages(notes){
 const rows=notes.length?notes:[null]
 const pages=[]
 for(let i=0;i<rows.length;i+=4){
  const slice=rows.slice(i,i+4)
  while(slice.length<4)slice.push(null)
  pages.push(slice)
 }
 return pages
}

export function AdmissionSheet({e,p,notes=[],doses=[]}){
 const visitNotes=(notes||[]).filter(n=>!n.encounterId||n.encounterId===e.id)
 return <div className="admission-sheet">
  <RerSheet e={e} p={p} doses={doses}/>
  {soapPages(visitNotes).map((page,i)=>
   <section className="admission-page admission-back" key={i}>
    <div className="soap-paper">
     <header className="soap-paper-head"><h2>PROGRESS NOTES</h2></header>
     {page.map((n,k)=><SoapPaperBlock key={(n&&n.id)||('blank-'+k)} n={n}/>)}
    </div>
   </section>
  )}
 </div>
}

function paperPlace(br){
 if(!br||br.name==='Guimba')return 'SARANAY DISTRICT, GUIMBA, NUEVA ECIJA'
 const tail=(br.address||'').split(',').map(s=>s.trim()).filter(Boolean).slice(-2).join(', ')
 return (tail||br.name+', Nueva Ecija').toUpperCase()
}

export function RerSheet({e,p,doses}){
 const info=caseInfo(e,doses)
 const br=branchMaster.find(b=>b.name===e.branch)||branchMaster[0]
 const h=e.history||{},tt=e.tt||{},er=e.erig||{},pr=e.progress||{}
 const st=info.status,point=bodyPoints[e.site]?.[e.side||'L']
 const brand=(er.brand||'').toLowerCase()
 return <div className="rer-sheet arc-form">
  <header className="arc-form-head">
   <span className="arc-form-logo"><BrandLogo alt="ARC Anti Rabies Clinic"/></span>
   <div className="arc-form-title">
    <h1>ARC ANIMAL BITE CENTER</h1>
    <p>{paperPlace(br)}</p>
    <small>Mobile No: {(br.contact||'09469451531').replace(/\s/g,'')} / EMAIL ADDRESS arcantirabisclinic@gmail.com</small>
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
    </div>
    <div className="arc-block">
     <h3>CATEGORY:</h3>
     {['I','II','III'].map(c=><label key={c}><Box on={e.category===c}/> {c}</label>)}
    </div>
    <label className="arc-block tight"><span>BOOSTER:</span><Box on={!!e.booster}/></label>
    <label className="arc-block tight"><span>PRE-EXP:</span><Box on={!!e.preExp}/></label>
   </div>
   <div className="arc-center">
    <h3>Chief Complaints</h3>
    <div className="arc-complaint-side"><span><Box on={e.side==='L'}/> L</span><span><Box on={e.side==='R'}/> R</span></div>
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
    <div className="arc-row arc-indent">Pet: <YN v={e.pet}/> Vaccinated: <YN v={e.vaccinated}/> Stray: <YN v={e.stray}/></div>
    <div className="arc-row arc-indent">Owned: <YN v={e.owned}/> If not, whom: <u className="arc-owner-line">{e.owned?'':(e.owner||'')}</u></div>
    <div className="arc-row arc-indent"><span className="arc-gold-label">Date of bite:</span> <u>{slash(e.biteDate)}</u> Time: <u>{e.biteTime||''}</u></div>
    <div className="arc-row arc-indent"><span className="arc-gold-label">SOB:</span> <Box on={e.side==='L'}/> L <Box on={e.side==='R'}/> R &nbsp; POB: <u>{e.place||''}</u></div>
    <div className="arc-row"><b>Washing of Wound:</b> <YN v={e.washed}/> Tandok: <YN v={e.tandok}/></div>
    <div className="arc-row"><b>TYPE OF WOUND:</b></div>
    <div className="arc-row wrap">{['Abrasion','Lacerated','Bruised','Healed'].map(w=><label key={w}><Box on={(e.wound||[]).includes(w)}/> {w}</label>)}</div>
    <div className="arc-row arc-section-gap"><b className="arc-medical-heading">MEDICAL HISTORY:</b></div>
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
     <div className="arc-indent arc-consent-block">
      <div className="arc-sign-name">{e.consent?e.consentBy:''}</div>
      <div className="arc-sign-rule" aria-hidden="true"/>
      <p className="arc-sign-label">SIGNATURE OVER PRINTED NAME</p>
     </div>
    </div>
    <div className="arc-panel">
     <h3>TETANUS TOXOID:</h3>
     <div className="arc-indent">
      <p>Date: <u>{slash(tt.date)}</u> Time: <u>{tt.time||''}</u></p>
      <p>Refused: <Box on={!!tt.refused}/> With Previous <Box on={!!tt.withPrevious}/></p>
     </div>
    </div>
    <div className="arc-panel">
     <h3>ERIG: <span className="arc-erig-options"><Box on={brand.includes('equirab')}/> EQUIRAB <Box on={brand.includes('vinrab')}/> VINRAB{brand.includes('hrig')&&<u> HRIG</u>}</span></h3>
     <div className="arc-indent">
      <p>Date: <u>{slash(er.date)}</u></p>
      <p>Time of Skin Test: <u>{er.skinTime||''}</u></p>
      <p>Result of ST: <u>{er.skinResult||''}</u> Weight: <u>{er.weight||''}</u></p>
      <p>Infiltration: <YN v={er.infiltration}/> ML used: <u>{er.ml||''}</u> ml</p>
      <p>Refused: <Box on={!!er.refused}/></p>
     </div>
    </div>
    <div className="arc-panel">
     <h3>PROGRESS NOTE:</h3>
     <div className="arc-indent">
      <div className="arc-progress-fields">
       <div className="arc-progress-checks">
        <label><Box on={!!pr.healthy}/> Patient is Healthy:</label>
        <label><Box on={!!pr.healed}/> Wound is healed</label>
       </div>
       <p className="arc-progress-others"><span>Others(please specify):</span><u>{pr.others||''}</u></p>
      </div>
     </div>
     <div className="arc-doc">
      <div className="arc-sign-name">{e.doctor||''}</div>
      <div className="arc-sign-rule" aria-hidden="true"/>
      <p className="arc-sign-label">Doctor’s Signature</p>
     </div>
    </div>
   </div>
  </div>

  <div className="arc-remarks">
   <b>REMARKS:</b>
   <label><Box on={st==='Complete'}/> Complete</label>
   <label><Box on={st==='Incomplete'}/> Incomplete</label>
   <label><Box on={st==='Transferred'}/> Transferred</label>
  </div>
 </div>
}
