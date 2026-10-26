export const clinicDate=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
export const today=clinicDate()
export const longDate=(d=clinicDate())=>{const x=new Date(d.slice(0,10)+'T00:00:00+08:00');return x.toLocaleDateString('en-US',{weekday:'long',timeZone:'Asia/Manila'}).toUpperCase()+' · '+x.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila'}).toUpperCase()}
export const shiftWindows={MS:{label:'Morning Shift',start:'07:00',end:'16:00',display:'7:00 AM – 4:00 PM'},NS:{label:'Night Shift',start:'16:00',end:'23:00',display:'4:00 PM – 11:00 PM'},PO_MS:{label:'Morning Shift',start:'08:00',end:'17:00',display:'8:00 AM – 5:00 PM'}}
export const shiftCutoff='16:00'
export function dutyHours(role,shift='Morning Shift'){if(shift==='Night Shift'||shift==='NS')return shiftWindows.NS;if(role==='PhilHealth Officer')return shiftWindows.PO_MS;return shiftWindows.MS}
export function overtimeRoom(role,shift,clockOut){const end=toMins(dutyHours(role,shift).end),out=toMins(clockOut);if(out==null||end==null||out<=end)return 0;return Math.round((out-end)/60*100)/100}
export const toMins=t=>{if(!t)return null;const p=t.split(':');return Number(p[0])*60+Number(p[1])}
export const pad=(n,l=2)=>String(n).padStart(l,'0')
export const addDays=(d,n)=>{const x=new Date(d.slice(0,10)+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
export const fmt=d=>d?new Date(d.slice(0,10)+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'—'
export const ageFrom=b=>{if(!b)return '';const [y,m,d]=b.split('-').map(Number),[ty,tm,td]=today.split('-').map(Number);return ty-y-((tm<m||(tm===m&&td<d))?1:0)}
export const under15=a=>Number(a)<15
export const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})
export const yn=v=>v?'Y':'N'
export const quarterOf=d=>d.slice(0,4)+'-Q'+(Math.floor((Number(d.slice(5,7))-1)/3)+1)
export const inPeriod=(d,f)=>!d?false:f.mode==='Daily'?d===f.date:f.mode==='Monthly'?d.startsWith(f.month):f.mode==='Quarterly'?quarterOf(d)===f.quarter:f.mode==='Annual'?d.startsWith(f.year):(!f.from||d>=f.from)&&(!f.to||d<=f.to)
export const periodLabel=f=>f.mode==='Daily'?fmt(f.date):f.mode==='Monthly'?new Date(f.month+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'}):f.mode==='Quarterly'?f.quarter.replace('-',' '):f.mode==='Annual'?f.year:(f.from?fmt(f.from):'Start')+' – '+(f.to?fmt(f.to):'Today')
export const defaultPeriod=(mode='Monthly')=>({mode,date:today,month:today.slice(0,7),quarter:quarterOf(today),year:today.slice(0,4),from:'2026-09-01',to:today})

export const branches=['All branches','Guimba','Baloc','Talavera','Cabanatuan','Palayan','Laur','Paniqui','Rizal','Talugtug','Gapan','Muñoz','Cuyapo']
export const branchCodes={Guimba:'GUI',Baloc:'BAL',Talavera:'TAV',Cabanatuan:'CAB',Palayan:'PAL',Laur:'LAU',Paniqui:'PAN',Rizal:'RIZ',Talugtug:'TLG',Gapan:'GAP',Muñoz:'MUN',Cuyapo:'CUY'}
export const nextRegistryFor=(encs,branch,date=today)=>{const yy=date.slice(2,4),code=branchCodes[branch],prefix=`ARC${code}-${yy}-`,n=Math.max(0,...encs.filter(e=>e.branch===branch&&e.registry?.startsWith(prefix)).map(e=>Number(e.registry.slice(prefix.length))||0));return prefix+pad(n+1,4)}
export const branchMaster=[
{name:'Guimba',address:'JB Lacson Bldg, Parairo Street, Cor. Saranay District, Guimba, Nueva Ecija',contact:'0946 945 1531',hours:'Daily 7AM–11PM',accreditation:'Accredited',night:true,main:true},
{name:'Baloc',address:'HLD Bldg, Purok 3, Baloc, Sto. Domingo, Nueva Ecija',contact:'0953 665 5592',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false},
{name:'Talavera',address:'Maharlika Highway, Brgy. Maestrang Kikay, Talavera, Nueva Ecija',contact:'0955 760 7872',hours:'Daily 8AM–5PM',accreditation:'Accredited',night:false},
{name:'Cabanatuan',address:'Stall No. 20, Mabini Arcade, Mabini St., Quezon District, Cabanatuan City, Nueva Ecija',contact:'0952 528 2411',hours:'Daily 7AM–11PM',accreditation:'Accredited',night:true},
{name:'Palayan',address:'Aurora Road, Camino, Palayan City, Nueva Ecija',contact:'0997 096 8033',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false},
{name:'Laur',address:'Gen. Tinio St., Brgy. I, Laur, Nueva Ecija',contact:'0997 652 7942',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false},
{name:'Paniqui',address:'BLMGH Center, Zamora St., Poblacion Sur, Paniqui, Tarlac',contact:'0953 127 8974',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false},
{name:'Rizal',address:'KBMG Bldg, Poblacion Sur, Rizal, Nueva Ecija',contact:'0945 210 0188',hours:'Daily 7AM–5PM',accreditation:'Accredited',night:false},
{name:'Talugtug',address:'Zone 5, Talugtug, Nueva Ecija',contact:'0975 784 5887',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false},
{name:'Gapan',address:'Gapan City, Nueva Ecija',contact:'0915 754 1632',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false},
{name:'Muñoz',address:'2/F Drawwing Bldg, D. Delos Santos St., Poblacion East, Science City of Muñoz, Nueva Ecija',contact:'0953 105 8993',hours:'Daily 8AM–6PM',accreditation:'Accredited',night:false},
{name:'Cuyapo',address:'Cuyapo, Nueva Ecija',contact:'—',hours:'Daily 8AM–5PM',accreditation:'Not accredited',night:false}
].map(b=>({status:'Active',morning:true,...b}))
export const isAccredited=b=>branchMaster.find(x=>x.name===b)?.accreditation==='Accredited'
export const roles=['Superadmin','Admin','Nurse','PhilHealth Officer','Secretary']
export const allBranchRoles=['Superadmin','Admin']
export const noClockRoles=['Superadmin']
export const staffRoles=['Admin','Nurse','PhilHealth Officer','Secretary']

// DOH Animal Bite and Rabies Report: patient residence locations and population reference
export const municipalities=[['Guimba',128676],['Cuyapo',68108],['Talugtug',25249],['Licab',29678],['Quezon',42841],['Nampicuan',14471],['Cabanatuan',339598],['Muñoz',84714],['Tarlac',null],['Sto. Domingo',61918],['Talavera',136125],['Aliaga',72202],['Rizal',70305],['Zaragoza',null]]

export const protocols={ID:{label:'Intradermal (ID)',route:'ID',days:[['D0',0],['D3',3],['D7',7],['D28',28]]},IM:{label:'Intramuscular (IM)',route:'IM',days:[['D0',0],['D3',3],['D7',7],['D14',14],['D28',28]]},BOOSTER:{label:'Booster',route:'ID',days:[['D0',0],['D3',3]]},PREEXP:{label:'Pre-exposure (PrEP)',route:'ID',days:[['D0',0],['D7',7],['D21',21]]}}
export const vaccineBrands={PCEC:['ChiroRab','VaxiRab N'],PVRV:['Bioshoot','Speeda','Abhayrab']}
export const dayLabel={D0:'Day 0',D2:'Day 2',D3:'Day 3',D7:'Day 7',D14:'Day 14',D21:'Day 21/28',D14P:'Day 14/28',D28:'Day 21/28'}
export const doseOptions=[['0.1 mL × 2 sites ID',2],['1 vial IM',5],['0.1 mL × 1 site ID',1]]
export const animalStatuses=['Alive','Lost/Stray','Dead']
const idDays=[['D0',0],['D3',3],['D7',7],['D28',28]],idDays14=[['D0',0],['D3',3],['D7',7],['D14',14],['D28',28]]
export const observationEnd=e=>{const start=(e.biteDate||e.seriesStartDate||e.date||'').slice(0,10);return start?addDays(start,14):''}
export function day14Required(e,allDoses=[]){if(e.preExp||e.booster||(e.regimen||'ID')!=='ID')return false;const until=observationEnd(e);if(!until)return false;const reported=linkedDoses(e,allDoses).filter(d=>d.animalStatus==='Lost/Stray'||d.animalStatus==='Dead').map(d=>d.date).filter(Boolean).sort()[0];if(reported)return reported<=until;if(e.animalStatus==='Lost/Stray'||e.animalStatus==='Dead')return (e.date||until).slice(0,10)<=until;return false}
export const protocolOf=(e,allDoses=[])=>{const route=protocols[e.regimen]?.route||'ID';if(e.preExp)return {...protocols.PREEXP,route,label:`Pre-exposure (${route})`};if(e.booster)return {...protocols.BOOSTER,route,label:`Booster (${route})`};if(e.regimen==='IM')return protocols.IM;return {label:'Intradermal (ID)',route:'ID',days:day14Required(e,allDoses)?idDays14:idDays}}

export const suffixes=['Jr.','Sr.','II','III','IV']
export function fullName(p){const last=(p.last||'').trim(),first=(p.first||'').trim(),mid=(p.middle||'').trim(),suf=(p.suffix||'').trim(),mi=mid?mid[0].toUpperCase()+'.':'';return [last&&first?last+', '+first:last||first,mi,suf].filter(Boolean).join(' ')}
export const withName=p=>{const next={...p,first:(p.first||'').trim(),middle:(p.middle||'').trim(),last:(p.last||'').trim(),suffix:p.suffix||''};return {...next,name:fullName(next)}}
const first=['Mika','Jules','Ari','Samira','Noel','Lea','Toni','Eli','Dana','Robin','Cami','Pat','Ivy','Marco','Lia','Ben','Joy','Rey','Nina','Paolo','Kris','Gail','Enzo','Mara','Rico','Tess','Odi','Bea','Carlo','Rina','Dex','Faye','Gino','Hana','Ivan','Jana']
const femaleNames=new Set(['Mika','Samira','Lea','Toni','Dana','Cami','Ivy','Lia','Joy','Nina','Gail','Mara','Tess','Bea','Rina','Faye','Hana','Jana'])
const last=['Santos','Navarro','Mendoza','Cruz','Reyes','Mercado','Villanueva','Ramos','Flores','Bautista','Garcia','Dizon']
const middles=['Reyes','Garcia','Bautista','Flores','Ramos','Villanueva','Mercado','Navarro','Mendoza','Santos','Dizon','Dela Cruz']
const ages=[28,41,9,34,62,25,53,12,46,22,37,58,7,31,19,66,44,5,27,50,15,38,71,23,11,35,48,16,60,29,8,42,55,20,13,33]
const barangays=['Poblacion','San Roque','Sto. Cristo','Bantug','Caballero','Saranay']
const homes=['Guimba','Cuyapo','Talugtug','Licab','Quezon','Nampicuan','Cabanatuan','Muñoz','Sto. Domingo','Talavera','Aliaga','Rizal','Tarlac','Zaragoza']
export const patients=first.map((f,i)=>{const age=ages[i],muni=i%3===0?'Guimba':homes[(i*5)%14],philhealth=i%3===1,ln=last[i%12];return withName({id:'PT-'+pad(i+1,4),first:f,middle:i%8===0?'':middles[(i*3)%12],last:ln,suffix:i%11===3?'Jr.':i%13===5?'III':'',birthday:`${2026-age}-${pad(1+i%9)}-${pad(1+(i*7)%28)}`,age,sex:femaleNames.has(f)?'Female':'Male',contact:'0917 555 '+pad(1200+i*37,4),address:'Brgy. '+barangays[i%6]+', '+muni+(muni==='Tarlac'?', Tarlac':', Nueva Ecija'),municipality:muni,guardian:age<18?'Maria '+ln+' (Mother)':'',senior:age>=60,pwd:i%11===4,vetmed:i%13===6,philhealth,branch:branches[1+i%6],classification:philhealth?'PhilHealth':'Walk-in'})})
patients[0]={...patients[0],branch:'Baloc'}

const animals=['Dog','Dog','Cat','Dog','Cat','Dog','Others'],sites=['Head','Upper extremity','Hand','Lower extremity','Foot'],wounds=[['Abrasion'],['Lacerated'],['Bruised'],['Abrasion','Lacerated'],['Lacerated']],times=['08:15 AM','09:40 AM','10:20 AM','01:30 PM','03:05 PM','06:45 PM']
export const isActiveNurse=e=>e.role==='Nurse'&&(e.status||'Active')!=='Inactive'
export const nursesAt=(emps,branch)=>(emps||[]).filter(e=>isActiveNurse(e)&&e.branch===branch)
export const vaccinatorNames=(emps,branch)=>nursesAt(emps,branch).map(e=>e.name)
const rawEncounters=patients.map((p,i)=>{const date=addDays(today,-((i*7)%92)),nonBite=i%9===5,site=sites[i%sites.length],category=nonBite?'I':(['Head','Hand','Foot'].includes(site)?'III':['II','III','II','III','II'][i%5]),booster=category!=='I'&&i%10===4,stray=i%4===3,animal=animals[i%7],rig=category==='III'&&!booster?(i%11===0?'HRIG':'ERIG'):'';return {id:'ENC-'+pad(i+1,4),patientId:p.id,branch:p.branch,date,time:times[i%6],chief:nonBite?'Lick on intact skin':'Bitten on the '+site.toLowerCase(),animal,animalOther:animal==='Others'?'Pig':'',biteType:nonBite?'Non-Bite':'Bite',pet:!stray,vaccinated:!stray&&i%3===0,stray,owned:!stray,owner:stray?'':i%2?'Own pet':'Neighbor',biteDate:addDays(date,-(i%2)),biteTime:'07:30 AM',side:i%2?'R':'L',site,place:'Brgy. '+barangays[(i+2)%6]+', '+p.municipality,washed:i%5!==2,tandok:i%8===3,wound:nonBite?[]:wounds[i%5],category,booster,preExp:false,vaccine:'PVRV',brand:'Bioshoot',regimen:i%6===5?'IM':'ID',history:{iddm:i%14===3,kidney:false,dialysis:false,cancer:false,allergy:i%9===2,steroids:false,insulin:i%14===3,others:''},bp:['110/70','120/80','130/85','118/76'][i%4],weight:String(p.age<15?18+p.age*2:52+i%20),temp:['36.5','36.8','37.1','36.6'][i%4],consent:true,consentBy:p.guardian?p.guardian.split(' (')[0]:p.name,tt:{given:!nonBite&&i%4!==2,date:nonBite?'':date,time:times[i%6],refused:!nonBite&&i%4===2,withPrevious:i%4===1},rig,erig:rig?{brand:rig==='HRIG'?'HRIG':i%2?'Vinrab':'Equirab',date,skinTime:rig==='ERIG'?times[i%6]:'',skinResult:rig==='ERIG'?'Negative':'',weight:String(p.age<15?18+p.age*2:52+i%20),infiltration:true,ml:String(p.age<15?2:5),refused:false}:{brand:'',date:'',skinTime:'',skinResult:'',weight:'',infiltration:null,ml:'',refused:false},pepEligible:category!=='I'&&i%13!==7,stopAfter:i%10===7?2:[13,22].includes(i)?1:null,animalStatus:i%12===5?'Lost/Stray':i%17===9?'Dead':'Alive',progress:{healthy:false,healed:false,others:''},doctor:'Dr. A. Bautista',remark:'',transferredTo:'',died:false,rer:true}})
rawEncounters[14]={...rawEncounters[14],date:today,biteDate:today,time:'09:15 AM',chief:'',site:'',category:'',wound:[],rig:'',rer:false}
const returning=patients.filter((_,i)=>i%7===2).map((p,k)=>({...rawEncounters[patients.indexOf(p)],id:'ENC-P'+pad(k+1,3),date:'2025-0'+(3+k%6)+'-1'+k,biteDate:'2025-0'+(3+k%6)+'-1'+k,category:'II',booster:false,rig:'',stopAfter:null,remark:'Complete',transferredTo:'',past:true}))
const registryCounters={}
const withRegistry=e=>{const yy=e.date.slice(2,4),code=branchCodes[e.branch],key=e.branch+'-'+yy,n=(registryCounters[key]||0)+1;registryCounters[key]=n;return {...e,registry:'ARC'+code+'-'+yy+'-'+pad(n,4)}}
export const encounters=[...rawEncounters].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(withRegistry).concat(returning.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(withRegistry))
export const doses=[]
encounters.forEach((e,idx)=>{if((!e.preExp&&!e.booster&&(e.category==='I'||!e.pepEligible))||e.rer===false)return;const pr=protocolOf(e);pr.days.forEach(([day,off],k)=>{const due=addDays(e.date,off);if(!(off===0||(due<today&&(e.stopAfter==null||k<e.stopAfter))))return;const next=pr.days[k+1];doses.push({id:e.id+'-'+day,encounterId:e.id,day,date:due,time:e.time,dose:e.regimen==='IM'?'1 vial IM':'0.1 mL × 2 sites ID',side:e.side,brand:e.brand,batch:'202507058A1',route:pr.route,advised:next?dayLabel[next[0]]+' · '+fmt(addDays(e.date,next[1])):'Series complete',animalStatus:k?e.animalStatus:'Alive',vaccinator:'',branch:e.transferredTo&&k?e.transferredTo:e.branch})})})
const julesOrigin=encounters.find(e=>e.id==='ENC-0002')
if(julesOrigin){
  const receivingRegistry=nextRegistryFor(encounters,'Guimba',julesOrigin.date)
  const julesReceiving={...julesOrigin,id:'ENC-R0002',registry:receivingRegistry,branch:'Guimba',date:addDays(julesOrigin.date,3),seriesStartDate:julesOrigin.date,continuedFromEncounterId:julesOrigin.id,originRegistry:julesOrigin.registry,referredFrom:'Baloc',transferredTo:'',remark:''}
  Object.assign(julesOrigin,{remark:'Transferred',referredTo:'Guimba',receivingRegistry,receivingEncounterId:julesReceiving.id})
  encounters.push(julesReceiving)
  doses.forEach(d=>{if(d.encounterId===julesOrigin.id&&d.day!=='D0'){d.encounterId=julesReceiving.id;d.branch='Guimba';d.id=julesReceiving.id+'-'+d.day}})
}
encounters.forEach(e=>{if(e.past)return;const p=patients.find(x=>x.id===e.patientId);e.billing=!isAccredited(e.branch)&&p?.philhealth?'For PhilHealth':p?.philhealth?'PhilHealth':'Walk-in'})

export const graceDays=7
export const seriesStart=e=>e.seriesStartDate||e.date
export function linkedDoses(e,allDoses){const linkedIds=new Set([e.id,e.continuedFromEncounterId,e.receivingEncounterId].filter(Boolean));return allDoses.filter(d=>linkedIds.has(d.encounterId))}
export function scheduleDates(e,allDoses){const given=linkedDoses(e,allDoses);let anchor=seriesStart(e),anchorOff=0;const dates={};protocolOf(e,allDoses).days.forEach(([day,off])=>{const g=given.find(x=>x.day===day)||null;dates[day]={due:addDays(anchor,off-anchorOff),given:g};if(g){anchor=g.date;anchorOff=off}});return dates}
export function caseInfo(e,allDoses){const given=linkedDoses(e,allDoses);if(e.rer===false)return {given,next:null,status:'For RER',outcome:''};if(e.died)return {given,next:null,status:'Died',outcome:'D'};if(!e.preExp&&!e.booster&&(e.category==='I'||!e.pepEligible))return {given,next:null,status:'No PEP',outcome:'N'};const pending=protocolOf(e,allDoses).days.filter(([d])=>!given.some(g=>g.day===d));if(!pending.length)return {given,next:null,status:'Complete',outcome:'C'};const [day]=pending[0],due=scheduleDates(e,allDoses)[day].due,lapsed=due<addDays(today,-graceDays);return {given,next:{day,due},status:lapsed?'Incomplete':'Ongoing',outcome:lapsed?'Inc':''}}
export function refundCutoff(e,allDoses){const dates=scheduleDates(e,allDoses);return dates.D7?dates.D7.due:addDays(seriesStart(e),7)}
export function refundEligible(e,allDoses,asOf=today){return asOf<=refundCutoff(e,allDoses)}
export function buildSchedule(encs,allDoses,pts){return encs.filter(e=>!e.past&&e.remark!=='Transferred').map(e=>{const info=caseInfo(e,allDoses);if(!info.next)return null;const p=pts.find(x=>x.id===e.patientId)||{};return {id:e.id,encounterId:e.id,registry:e.registry,patient:p.name,patientId:p.id,contact:p.contact,branch:e.transferredTo||e.branch,vaccine:'Anti-rabies ('+e.brand+')',day:info.next.day,date:info.next.due,time:e.time,status:info.status==='Incomplete'?'Missed':info.next.due===today?'Due today':info.next.due<today?'Missed':'Upcoming'}}).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date))}

export const itemMaster=[
{item:'ChiroRab',type:'Anti-rabies vaccine · PCEC',unit:'vials',usesPerVial:10,threshold:30,rule:'1 vial = 10 injection uses / sites. Uses accumulate per actual injection; 1 vial is deducted when fully consumed.'},
{item:'VaxiRab N',type:'Anti-rabies vaccine · PCEC',unit:'vials',usesPerVial:10,threshold:30,rule:'1 vial = 10 injection uses / sites. Uses accumulate per actual injection; 1 vial is deducted when fully consumed.'},
{item:'Bioshoot',type:'Anti-rabies vaccine',unit:'vials',usesPerVial:5,threshold:30,rule:'1 vial = 5 injection uses / sites. Uses accumulate per actual injection; 1 vial is deducted when fully consumed.'},
{item:'Speeda',type:'Anti-rabies vaccine · PVRV',unit:'vials',usesPerVial:5,threshold:30,rule:'1 vial = 5 injection uses / sites. Uses accumulate per actual injection; 1 vial is deducted when fully consumed.'},
{item:'Abhayrab',type:'Anti-rabies vaccine · PVRV',unit:'vials',usesPerVial:5,threshold:30,rule:'1 vial = 5 injection uses / sites. Uses accumulate per actual injection; 1 vial is deducted when fully consumed.'},
{item:'ERIG (serum)',type:'Rabies immunoglobulin (ERIG)',unit:'vials',threshold:5,rule:'Manual in Stock Out. The number of vials depends on the wounds. Saving ERIG on Treatment does not deduct stock.'},
{item:'Tetanus Toxoid',type:'Tetanus vaccine',unit:'vials',threshold:20,rule:'1 patient treatment = 1 vial.'},
{item:'Influvac',type:'Flu vaccine',unit:'vials',threshold:4,rule:'1 patient treatment = 1 vial.'},
{item:'Pneumococcal',type:'Pneumococcal vaccine',unit:'vials',threshold:3,rule:'1 patient treatment = 1 vial.'}]
const stockSeed=[['Guimba','Bioshoot','202507058A1','2028-06-07',112],['Guimba','ChiroRab','CR-2026-041','2028-05-31',48],['Guimba','VaxiRab N','VRN-2026-018','2028-07-31',42],['Guimba','Speeda','SPD-2026-027','2028-08-31',55],['Guimba','Abhayrab','ABH-2026-033','2028-06-30',46],['Guimba','ERIG (serum)','08AR26019','2028-03-31',5],['Guimba','Tetanus Toxoid','25GTOX010D','2028-09-30',91],['Guimba','Influvac','—','2026-03-31',0],['Guimba','Pneumococcal','6120260100','2028-01-11',5],['Cabanatuan','Bioshoot','202507058A1','2028-06-07',38],['Cabanatuan','ERIG (serum)','08AR26019','2028-03-31',4],['Cabanatuan','Tetanus Toxoid','A1701125','2028-08-31',22],['Baloc','Bioshoot','202507058A1','2028-06-07',26],['Baloc','ERIG (serum)','08AR26025','2028-04-30',3],['Baloc','Tetanus Toxoid','A1701125','2028-08-31',30],['Palayan','Bioshoot','202507058A1','2028-06-07',44],['Palayan','ERIG (serum)','08AR26025','2028-04-30',6],['Palayan','Tetanus Toxoid','25GTOX010D','2028-09-30',18],['Talavera','Bioshoot','202507058A1','2028-06-07',52],['Talavera','ERIG (serum)','08AR26018','2026-11-15',2],['Talavera','Tetanus Toxoid','A1700725','2028-02-28',25],['Laur','Bioshoot','202507058A1','2028-06-07',31],['Laur','Tetanus Toxoid','A1700725','2028-02-28',21],['Laur','Pneumococcal','6120260100','2026-10-30',2],['Paniqui','Bioshoot','202507058A1','2028-06-07',18],['Paniqui','Tetanus Toxoid','A1701125','2028-08-31',12],['Rizal','Bioshoot','202507058A1','2028-06-07',27],['Rizal','ERIG (serum)','08AR26019','2028-03-31',2],['Rizal','Tetanus Toxoid','25GTOX010D','2028-09-30',16],['Talugtug','Bioshoot','202507058A1','2028-06-07',14],['Talugtug','Tetanus Toxoid','A1700725','2028-02-28',9],['Gapan','Bioshoot','202507058A1','2028-06-07',21],['Gapan','Tetanus Toxoid','A1701125','2028-08-31',11]]
export const inventory=stockSeed.map(([branch,item,batch,expiry,stock],i)=>{const m=itemMaster.find(x=>x.item===item);return {id:'STK-'+pad(i+1,3),item,type:m.type,branch,batch,expiry,stock,begin:stock,received:0,used:0,uses:m.usesPerVial?i%m.usesPerVial:0,usesPerVial:m.usesPerVial||0,date:today,shift:'MS',unit:m.unit,threshold:m.threshold}})
const sigs=['L. Tenorio','J. Torres','K. Diaz','A. Maligaya','C. Valdez']
const usePattern={Bioshoot:[4,8,9,8,7,6],ChiroRab:[0,0,0,0,0,0],'VaxiRab N':[0,0,0,0,0,0],Speeda:[0,0,0,0,0,0],Abhayrab:[0,0,0,0,0,0],'Tetanus Toxoid':[4,2,3,1,2,1],'ERIG (serum)':[1,0,1,0,0,1],Influvac:[0,0,0,0,0,0],Pneumococcal:[1,0,1,0,0,0]}
export const ledger=[]
const nightBranches=new Set(branchMaster.filter(b=>b.night).map(b=>b.name))
inventory.forEach((x,i)=>{const night=nightBranches.has(x.branch),slots=[];['2026-10-05','2026-10-06','2026-10-07'].forEach(d=>{slots.push([d,'MS']);if(night)slots.push([d,'NS'])});const used=slots.map((_,k)=>usePattern[x.item][k]),received=slots.map(()=>0),remarks=slots.map(()=>'');if(x.item==='Bioshoot'&&x.branch==='Guimba'){used[0]=14;received[1]=150;remarks[0]='10 transferred to Cabanatuan · 4 used'}if(x.item==='Bioshoot'&&x.branch==='Cabanatuan'){received[0]=10;remarks[0]='10 received from Guimba'}let soh=x.stock-received.reduce((a,n)=>a+n,0)+used.reduce((a,n)=>a+n,0);slots.forEach((s,k)=>{const begin=soh;soh=begin+received[k]-used[k];ledger.push({id:'LED-'+i+'-'+k,stockId:x.id,item:x.item,branch:x.branch,date:s[0],shift:s[1],begin,received:received[k],batch:received[k]?x.batch:'',used:used[k],stock:soh,remarks:remarks[k],signature:sigs[(i+k)%5]})})})
// Vaccine (Received) Inventory Report transcribed from the Guimba sheet
export const receivedReport=[['2026-08-25','Bioshoot','202507058A-1','2028-06-07',40,75],['2026-08-25','Tetanus Toxoid','25GTOX010C','2028-09-30',70,48],['2026-08-25','ERIG (serum)','08AR26018','2028-03-31',10,1],['2026-08-28','Bioshoot','202507058A-1','2028-06-07',110,57],['2026-09-02','Bioshoot','202507058A-1','2028-06-07',150,54],['2026-09-02','Tetanus Toxoid','25GTOX010C','2028-09-30',50,15],['2026-09-02','ERIG (serum)','08AR26018','2028-03-31',10,3],['2026-09-03','Influvac','—','2026-03-31',12,0],['2026-09-03','Tetanus Toxoid','A1700725','2028-02-28',50,35],['2026-09-03','Pneumococcal','6120260100','2028-01-11',5,5],['2026-09-08','Bioshoot','202507058A1','2028-06-07',150,64],['2026-09-08','ERIG (serum)','08AR26019','2028-03-31',10,4],['2026-09-08','Tetanus Toxoid','A1700725','2028-02-28',70,27],['2026-09-16','ERIG (serum)','08AR26025','2028-04-30',15,4],['2026-09-16','Bioshoot','202507058A1','2028-06-07',150,53,'NS'],['2026-09-16','Tetanus Toxoid','25GTOX010C','2028-09-30',150,0,'NS'],['2026-09-22','ERIG (serum)','08AR26025','2028-04-30',10,2,'NS'],['2026-09-22','Tetanus Toxoid','A1701125','2028-08-31',100,61,'NS'],['2026-09-22','Bioshoot','202507058A1','2028-06-07',150,36,'NS'],['2026-09-30','ERIG (serum)','08AR26019','2028-03-31',10,1,'NS'],['2026-09-30','Tetanus Toxoid','25GTOX010D','2028-09-30',50,89,'NS'],['2026-09-30','Bioshoot','202507058A1','2028-06-07',150,37,'NS']].map(([date,item,batch,expiry,received,remaining,shift='MS'],i)=>({id:'RCV-'+pad(i+1,3),date,shift,item,branch:'Guimba',batch,expiry,received,remaining,total:received+remaining}))

export const services=[{name:'Anti-rabies vaccine',price:750},{name:'ERIG (serum)',price:2600},{name:'Booster dose',price:750},{name:'Tetanus Toxoid',price:300},{name:'Speeda',price:1500},{name:'Hepatitis B',price:1100},{name:'Pneumococcal vaccine',price:2500},{name:'Flu Regular',price:1600},{name:'Flu Student',price:1500},{name:'Flu Senior-PWD',price:1350}]
export const servicePrice=name=>(services.find(s=>s.name===name)||{}).price||0
export function billLinesFor(e){
  const qty=1
  if(!e||e.preExp)return [{service:'Anti-rabies vaccine',qty}]
  if(e.booster)return [{service:'Booster dose',qty}]
  if(e.category==='III')return [{service:'Anti-rabies vaccine',qty},{service:'ERIG (serum)',qty},{service:'Tetanus Toxoid',qty}]
  if(e.category==='II')return [{service:'Anti-rabies vaccine',qty}]
  return [{service:'Anti-rabies vaccine',qty}]
}
export const isPhilhealthBill=c=>c==='PhilHealth'||c==='For PhilHealth'
export const isSale=p=>p.status==='Paid'&&Number(p.amount)>0&&!isPhilhealthBill(p.classification)
export const isReleasedRefund=r=>r&&r.status==='Refunded'
export const refundIsOpen=r=>r&&r.status!=='Rejected'
export function refundRemaining(bill,payments,refunds){
  const id=bill.paymentId||bill.id
  const lines=(payments||[]).filter(p=>bill.txn?p.txn===bill.txn:p.id===id)
  const ids=lines.length?lines.map(p=>p.id):[id]
  const used=(refunds||[]).filter(r=>ids.includes(r.payment)&&r.status!=='Rejected').reduce((s,r)=>s+Number(r.amount||0),0)
  return Math.max(0,Math.round((Number(bill.amount||0)-used)*100)/100)
}
export const refundStamp=r=>r&&r.refunded&&r.refunded!=='—'?String(r.refunded).slice(0,10):String(r?.requested||'').slice(0,10)
export function lineService(p){
  const name=String(p.service||'').replace(/ × \d+$/,'')
  if(!name||name==='Not set yet')return ''
  const price=servicePrice(name)
  const qty=price&&Number(p.amount)>0?Math.max(1,Math.round(Number(p.amount)/price)):1
  return qty>1?name+' × '+qty:name
}
export function groupBills(list){
  const map=new Map()
  for(const p of list||[]){
    const key=p.txn||p.encounterId||p.id
    if(!map.has(key))map.set(key,[])
    map.get(key).push(p)
  }
  return [...map.values()].map(lines=>{
    const first=lines[0]
    const amount=lines.reduce((s,p)=>s+Number(p.amount||0),0)
    const status=lines.some(p=>p.status==='Pending')?'Pending':lines.every(p=>p.status==='Not billed')?'Not billed':lines.some(p=>p.status==='Paid')?'Paid':first.status
    const names=lines.map(lineService).filter(Boolean)
    const refs=[...new Set(lines.map(p=>p.reference).filter(r=>r&&r!=='—'))]
    const methods=[...new Set(lines.map(p=>p.method).filter(m=>m&&m!=='—'))]
    return {
      id:first.txn||first.id,
      txn:first.txn||first.id,
      registry:first.registry,
      encounterId:first.encounterId,
      patient:first.patient,
      branch:first.branch,
      date:first.date,
      service:names.length?names.join(', '):'Not set yet',
      classification:first.classification,
      amount,
      method:methods[0]||first.method||'—',
      reference:refs[0]||first.reference||'—',
      status,
      remarks:first.remarks,
      paymentId:first.id
    }
  })
}
export const visitNeedsPay=e=>e&&(!!e.booster||(e.billing==='Walk-in'&&e.category!=='I'))
export const visitPaid=(pays,eid)=>(pays||[]).some(p=>p.encounterId===eid&&p.status==='Paid'&&Number(p.amount)>0)
export const payments=encounters.filter(e=>!e.past&&e.rer!==false).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,18).map((e,k)=>{const p=patients.find(x=>x.id===e.patientId),s=e.rig?services[1]:e.booster?services[2]:e.category==='I'?services[6]:services[0],ph=isPhilhealthBill(e.billing);return {id:'PAY-'+(2060+k),registry:e.registry,encounterId:e.id,patient:p.name,branch:e.branch,date:e.date,service:s.name,classification:ph?e.billing:p.classification,amount:ph?0:s.price,method:e.billing==='For PhilHealth'?'—':ph?'PhilHealth':k%3===1?'GCash':'Cash',reference:ph?'—':'EXT-'+(45820+k),status:ph?'Not billed':k===7?'Pending':'Paid',remarks:e.billing==='For PhilHealth'?'Not billed · give Day 0 then refer for PhilHealth':e.billing==='PhilHealth'?'₱0 · PhilHealth':''}})
if(julesOrigin&&!payments.some(pay=>pay.encounterId===julesOrigin.id)){const p=patients.find(x=>x.id===julesOrigin.patientId);payments.unshift({id:'PAY-2063',registry:julesOrigin.registry,encounterId:julesOrigin.id,patient:p.name,branch:julesOrigin.branch,date:julesOrigin.date,service:services[0].name,classification:'For PhilHealth',amount:0,method:'—',reference:'—',status:'Not billed',remarks:'Not billed · give Day 0 then refer for PhilHealth'})}
const mikaEnc=encounters.find(e=>e.patientId===patients[0].id&&!e.past)
export const referrals=[{id:'REF-107',patient:patients[1].name,patientId:patients[1].id,encounterId:julesOrigin?.id,registry:julesOrigin?.registry,receivingRegistry:julesOrigin?.receivingRegistry,receivingEncounterId:julesOrigin?.receivingEncounterId,from:'Baloc',to:'Guimba',date:addDays(julesOrigin?.date||today,3),reason:'Continue PEP at a PhilHealth-accredited branch',treatment:'Day 0 complete at Baloc · Day 3 given at Guimba',next:addDays(julesOrigin?.date||today,7),classification:'PhilHealth',status:'Accepted',remarks:'Origin and receiving registries are both retained.'},{id:'REF-108',patient:patients[0].name,patientId:patients[0].id,encounterId:mikaEnc?.id,registry:mikaEnc?.registry,from:'Baloc',to:'Guimba',date:today,reason:'Continue PEP at a PhilHealth-accredited branch',treatment:'Day 0 complete',next:addDays(today,3),classification:'PhilHealth',status:'Pending acceptance',remarks:'Cash payment stays at Baloc. PhilHealth enrollment is still pending.'}]
const demoNames=new Set([patients[0].name,patients[1].name,patients[2].name,patients[14].name,patients[27].name])
const refundPool=payments.filter(p=>p.status==='Paid'&&!demoNames.has(p.patient))
const refundSource=refundPool.find(p=>p.method==='Cash')||refundPool[0]
const refundApproved=refundPool.find(p=>p.id!==refundSource.id)
export const refunds=[{id:'RFD-019',patient:refundSource.patient,payment:refundSource.id,branch:refundSource.branch,amount:refundSource.amount,reason:'Duplicate service charge',requested:today,approvedBy:'—',processedBy:'—',refunded:'—',status:'Pending'},{id:'RFD-018',patient:refundApproved.patient,payment:refundApproved.id,branch:refundApproved.branch,amount:300,reason:'Duplicate service charge',requested:'2026-10-06',approvedBy:'Lyka Tenorio',processedBy:'—',refunded:'—',status:'Approved'}]
export const financeCategories={Income:['Other income','PhilHealth reimbursement','Miscellaneous income'],Expense:['Utilities','Rent','Medical supplies','Transportation','Repairs & maintenance','Office supplies','Miscellaneous']}
export const financeEntries=[['2026-10-08','Guimba','Expense','Utilities','Electricity bill – September',4820,'MERALCO-0926'],['2026-10-07','Cabanatuan','Expense','Medical supplies','Gauze, syringes and alcohol',1650,'DR-2231'],['2026-10-06','Guimba','Income','PhilHealth reimbursement','ABTC package claims batch',18500,'PH-REF-0912'],['2026-10-05','Baloc','Expense','Transportation','Vaccine pick-up from Guimba',600,'—'],['2026-10-03','Palayan','Expense','Rent','October branch rent',12000,'OR-5531'],['2026-10-02','Talavera','Income','Miscellaneous income','Medical certificate fees',450,'—'],['2026-10-01','Laur','Expense','Repairs & maintenance','Refrigerator thermostat repair',1800,'SR-118'],['2026-09-30','Guimba','Expense','Office supplies','Logbooks and forms printing',950,'—'],['2026-09-28','Cabanatuan','Expense','Utilities','Water bill – September',780,'WD-0928']].map(([date,branch,type,category,description,amount,reference],i)=>({id:'FIN-'+pad(i+1,3),date,branch,type,category,description,amount,reference,remarks:'',by:'Lyka Tenorio'}))

export const employees=[['Jamie Torres','Guimba','Nurse','Nurse',850,'Night Shift',false],['Lyka Tenorio','Guimba','PhilHealth Officer','PhilHealth Officer',950,'Morning Shift',true],['Kim Diaz','Cabanatuan','PhilHealth Officer','PhilHealth Officer',950,'Morning Shift',true],['Morgan Lim','Cabanatuan','Secretary','Secretary',700,'Morning Shift',false],['Amery Maligaya','Baloc','PhilHealth Officer','PhilHealth Officer',950,'Morning Shift',true],['Casey Valdez','Guimba','Nurse','Nurse',820,'Night Shift',false],['Michelle Clor','Palayan','PhilHealth Officer','PhilHealth Officer',950,'Morning Shift',true],['Taylor Aquino','Palayan','Secretary','Secretary',680,'Morning Shift',false],['Gelai Aban','Talavera','PhilHealth Officer','PhilHealth Officer',950,'Morning Shift',true],['Skyler Ong','Talavera','Secretary','Secretary',900,'Morning Shift',false],['Drew Salazar','Laur','Secretary','Secretary',650,'Morning Shift',false],['Riley Cruz','Baloc','Nurse','Nurse',820,'Morning Shift',false],['Noel Santos','Talavera','Nurse','Nurse',820,'Morning Shift',false],['Pat Morales','Cabanatuan','Nurse','Nurse',820,'Morning Shift',false],['Ira Villanueva','Palayan','Nurse','Nurse',820,'Morning Shift',false],['Sam Flores','Laur','Nurse','Nurse',820,'Morning Shift',false],['Quin Ramos','Paniqui','Nurse','Nurse',820,'Morning Shift',false],['Nico Bautista','Rizal','Nurse','Nurse',820,'Morning Shift',false],['Aya Mendoza','Talugtug','Nurse','Nurse',820,'Morning Shift',false],['Lex Garcia','Gapan','Nurse','Nurse',820,'Morning Shift',false],['Rei Dizon','Muñoz','Nurse','Nurse',820,'Morning Shift',false]].map(([name,branch,position,role,rate,shift,officer],i)=>({id:'EMP-'+(101+i),name,branch,position,role,rate,shift,officer,hours:8,status:'Active',payroll:true}))
export const vaccinators=vaccinatorNames(employees,'Guimba')
doses.forEach(d=>{const names=vaccinatorNames(employees,d.branch);if(names[0])d.vaccinator=names[0]})
export const contributionRules=[
  {agency:'SSS',basis:'Monthly salary credit · ₱500 brackets',rate:5,employer:'10% + EC',floor:5000,ceiling:35000,effective:'2025-01-01'},
  {agency:'PhilHealth',basis:'Monthly basic salary',rate:2.5,employer:'2.5%',floor:10000,ceiling:100000,effective:'2025-01-01'},
  {agency:'Pag-IBIG',basis:'Monthly fund salary',rate:2,employer:'2%',floor:0,ceiling:10000,effective:'2024-02-01'}
]
export function statutoryMonthly(){
  const monthly=13500
  const msc=13500
  return {
    monthly,
    sssMsc:msc,
    sssEe:675,
    sssEr:1350,
    sssEc:10,
    philEe:337.5,
    philEr:337.5,
    pagibigEe:200,
    pagibigEr:200
  }
}
export function statutoryCutoff(_dailyRate,{gross,payday}={}){
  const m=statutoryMonthly()
  const base={monthly:m.monthly,monthDays:26,otherDays:0,sssMsc:gross?m.sssMsc:0,sss:0,phil:0,pagibig:0,sssEr:0,philEr:0,pagibigEr:0,sssEc:0,sssMonthly:m.sssEe,philMonthly:m.philEe,pagibigMonthly:m.pagibigEe}
  if(!gross)return base
  const fifteenth=payday==='A'||payday===15||payday==='15'
  const monthEnd=payday==='B'||payday===30||payday==='30'
  if(fifteenth)return {...base,phil:m.philEe,philEr:m.philEr,pagibig:m.pagibigEe,pagibigEr:m.pagibigEr}
  if(monthEnd)return {...base,sss:m.sssEe,sssEr:m.sssEr,sssEc:m.sssEc}
  return {...base,sssMsc:0}
}
export function periodRank(id){const [y,m,half]=String(id||'').split('-');return (Number(y)||0)*1000+(Number(m)||0)*10+(half==='B'?2:1)}
export function overrideFor(rows,employeeId,periodId){const list=(rows||[]).filter(r=>r.employeeId===employeeId&&periodRank(r.fromPeriod)<=periodRank(periodId));list.sort((a,b)=>periodRank(b.fromPeriod)-periodRank(a.fromPeriod)||String(b.createdAt).localeCompare(String(a.createdAt)));return list[0]||null}
export function applyContribution(stat,ov,payday){const blank={sss:0,phil:0,pagibig:0,sssEr:0,philEr:0,pagibigEr:0,sssEc:0};if(!stat?.sssMsc)return blank;const pick=(key,auto)=>!ov||ov[key]===undefined||ov[key]===null||ov[key]===''?Number(auto)||0:Number(ov[key])||0;const fifteenth=payday==='A'||payday===15||payday==='15';const monthEnd=payday==='B'||payday===30||payday==='30';const sss=monthEnd?pick('sss',stat.sss):0;const phil=fifteenth?pick('phil',stat.phil):0;const pagibig=fifteenth?pick('pagibig',stat.pagibig):0;const sssEr=sss>0?sss*2:0;const sssEc=sss<=0?0:sss>=750?30:10;return {sss,phil,pagibig,sssEr,philEr:phil,pagibigEr:pagibig,sssEc}}
const phHolidays=[['2026-08-31','National Heroes Day','Regular'],['2026-11-01','All Saints’ Day','Special'],['2026-11-30','Bonifacio Day','Regular'],['2026-12-25','Christmas Day','Regular'],['2026-12-30','Rizal Day','Regular']]
const isoYmd=(y,m,d)=>y+'-'+pad(m)+'-'+pad(d)
const monthLast=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate()
function cutoffPeriod(y,m,day){
  if(day===10){
    const pm=m===1?12:m-1,py=m===1?y-1:y
    return {from:isoYmd(py,pm,26),to:isoYmd(y,m,10),cutoff:isoYmd(y,m,10),pay:isoYmd(y,m,15),half:'A'}
  }
  return {from:isoYmd(y,m,11),to:isoYmd(y,m,25),cutoff:isoYmd(y,m,25),pay:isoYmd(y,m,Math.min(30,monthLast(y,m))),half:'B'}
}
function currentCutoff(asOf){
  const [y,m,d]=asOf.split('-').map(Number)
  if(d<=10)return {y,m,day:10}
  if(d<=25)return {y,m,day:25}
  return m===12?{y:y+1,m:1,day:10}:{y,m:m+1,day:10}
}
function previousCutoff({y,m,day}){
  if(day===25)return {y,m,day:10}
  return m===1?{y:y-1,m:12,day:25}:{y,m:m-1,day:25}
}
export function buildPayPeriods(asOf=today,count=6){
  const out=[]
  let cur=currentCutoff(asOf)
  for(let i=0;i<count;i++){
    const p=cutoffPeriod(cur.y,cur.m,cur.day)
    const id=p.to.slice(0,4)+'-'+p.to.slice(5,7)+'-'+p.half
    const label=fmt(p.from).replace(/, \d{4}$/,'')+' – '+fmt(p.to)
    out.push({id,...p,label,holidays:phHolidays.filter(h=>h[0]>=p.from&&h[0]<=p.to)})
    cur=previousCutoff(cur)
  }
  return out
}
export const payPeriods=buildPayPeriods()
export function mergeAttendanceByDate(rows){const by={};for(const r of rows||[]){const cur=by[r.date];if(!cur){by[r.date]={...r};continue}const inA=toMins(cur.in),inB=toMins(r.in),outA=toMins(cur.out),outB=toMins(r.out);by[r.date]={...cur,in:inA==null?r.in:(inB!=null&&inB<inA?r.in:cur.in),out:outB==null?cur.out:(outA==null||outB>outA?r.out:cur.out)}}return Object.values(by)}
export function periodInputsFromAttendance(e,periodId,attendance=[],users=[],overtimeRequests=[]){const p=payPeriods.find(x=>x.id===periodId);const ids=new Set((users||[]).filter(u=>(u.employeeId||u.employee)===e.id).map(u=>u.id));const rows=mergeAttendanceByDate((attendance||[]).filter(a=>{if(p&&((p.from&&a.date<p.from)||(p.to&&a.date>p.to)))return false;if(a.employeeId===e.id)return true;if(ids.size&&ids.has(a.userId))return true;return false}));const win=dutyHours(e.role,e.shift);let late=0,undertime=0,night=0;for(const r of rows){if(r.in)late+=Math.max(0,(toMins(r.in)??0)-toMins(win.start));if(r.out)undertime+=Math.max(0,toMins(win.end)-(toMins(r.out)??toMins(win.end)));if(e.shift==='Night Shift'&&r.in&&r.out){const mins=(toMins(r.out)??0)-(toMins(r.in)??0);if(mins>0)night+=mins/60}}const worked=new Set(rows.filter(r=>r.in).map(r=>r.date));const holidayRegular=(p?.holidays||[]).filter(h=>h[2]!=='Special'&&worked.has(h[0])).length;const holidaySpecial=(p?.holidays||[]).filter(h=>h[2]==='Special'&&worked.has(h[0])).length;const otHours=Number(((overtimeRequests||[]).filter(r=>r.employeeId===e.id&&r.status==='Approved'&&(!p||(r.date>=p.from&&r.date<=p.to))).reduce((a,r)=>a+(Number(r.hours)||0),0)).toFixed(2));return {days:rows.filter(r=>r.in).length,late,undertime,ot:otHours,otApproved:otHours>0,night:Number(night.toFixed(2)),holiday:holidayRegular,holidayRegular,holidaySpecial,holidayType:'Regular',other:0,source:'attendance'}}
export const periodInputs=(e,periodId,attendance,users)=>periodInputsFromAttendance(e,periodId,attendance,users)
const shiftDays=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-05','2026-10-06','2026-10-07']
export function attendanceForEmployee(e){const night=e.shift==='Night Shift',po=e.role==='PhilHealth Officer';const ins=night?['16:02','16:08','15:58','16:00','16:18','15:55','16:05','15:59','16:01']:po?['08:02','08:08','07:58','08:00','08:18','07:55','08:05','07:59','08:01']:['07:02','07:08','06:58','07:00','07:18','06:55','07:05','06:59','07:01'];const outs=night?['23:02','23:00','22:55','23:05','23:00','23:08','23:00','23:01','23:04']:po?['17:02','17:00','16:55','17:05','17:00','17:08','17:00','17:01','17:04']:['16:02','16:00','15:55','16:05','16:00','16:08','16:00','16:01','16:04'];return shiftDays.map((d,i)=>({date:d,in:ins[i],out:outs[i],source:'Time In button',branch:e.branch,device:'Branch workstation'}))}
export const attendanceLog=attendanceForEmployee({shift:'Morning Shift',role:'Nurse',branch:'Guimba'})

export const progressNotes=[{id:'PN-003',patientId:patients[1].id,encounterId:julesOrigin?.receivingEncounterId||julesOrigin?.id,date:'2026-10-07',s:{fever:false,rashes:false,numbness:true,headaches:false,others:''},animal:'Alive',o:{temp:'36.7',bp:'120/80',hr:'78',weakness:false,hydrophobia:false,aerophobia:false,photophobia:false,rashes:false,others:''},a:{spBite:true,healed:false,others:''},p:{day:'Day 3',erig:false,returnDay:'Day 7',observe:true,others:''},staff:'Jamie Torres',branch:julesOrigin?.referredTo||patients[1].branch},{id:'PN-002',patientId:patients[0].id,encounterId:mikaEnc?.id,date:today,s:{fever:false,rashes:false,numbness:false,headaches:false,others:'Pain at wound site'},animal:'Alive',o:{temp:'36.5',bp:'110/70',hr:'82',weakness:false,hydrophobia:false,aerophobia:false,photophobia:false,rashes:false,others:'Two superficial abrasions'},a:{spBite:true,healed:false,others:''},p:{day:'Day 0',erig:false,returnDay:'Day 3',observe:true,others:'Wound care advised'},staff:'Amery Maligaya',branch:'Baloc'}]
export const activities=[{title:'Day 0 vaccination completed',patient:patients[0].name,branch:'Baloc',time:'9:42 AM',type:'Treatment'},{title:'New admission registered',patient:patients[14].name,branch:'Talavera',time:'9:15 AM',type:'Admission'},{title:'Referral sent to Guimba',patient:patients[0].name,branch:'Baloc',time:'8:56 AM',type:'Referral'},{title:'Payment recorded',patient:patients[0].name,branch:'Baloc',time:'9:05 AM',type:'Payment'}]

function registryRemarks(e,info){const finish=e.referredTo||e.branch,parts=[];if(e.originRegistry)parts.push('Referred from '+(e.referredFrom||'')+' · '+e.originRegistry);else if(e.referredTo)parts.push('Referred to '+e.referredTo);if(info.status==='Complete')parts.push('Completed in '+finish);else if(info.status==='Ongoing'&&info.next)parts.push('Next: '+dayLabel[info.next.day]+' '+fmt(info.next.due));return parts.filter(Boolean).join(' · ')}
export function registryRows(encs,allDoses,pts){return encs.filter(e=>!e.past&&e.rer!==false).map(e=>{const p=pts.find(x=>x.id===e.patientId)||{},info=caseInfo(e,allDoses),d=day=>(info.given.find(g=>g.day===day)||{}).date,days14=addDays(e.biteDate||e.date,14)<=today;return {id:e.id,e,p,no:e.registry,date:e.date,name:p.name,birthday:p.birthday,address:p.address,age:ageFrom(p.birthday)||p.age,sex:p.sex==='Male'?'M':'F',expDate:e.biteDate,place:e.place,animalCode:e.animal==='Dog'?(e.stray?'SD':'PD'):e.animal==='Cat'?'C':'O',type:e.biteType==='Bite'?'B':'NB',site:(e.side?e.side+' ':'')+e.site,category:{I:'1',II:'2',III:'3'}[e.category],washed:yn(e.washed),rigDate:e.rig&&!e.erig.refused?e.erig.date:'',route:info.given.length?protocolOf(e).route:'',d0:d('D0'),d3:d('D3'),d7:d('D7'),d14:d('D14'),d28:d('D28')||d('D21'),brand:info.given.length?e.brand:'',outcome:info.outcome,prep:e.booster?'Booster':e.preExp?'PrEP':'',animal14:days14?{'Lost/Stray':'Lost'}[e.animalStatus]||e.animalStatus:'',remarks:registryRemarks(e,info)}}).sort((a,b)=>a.no.localeCompare(b.no))}
