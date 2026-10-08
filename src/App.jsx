import React from 'react'
import { Activity, Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock3, CreditCard, FileBarChart2, FileClock, FileText, GitBranch, HeartPulse, LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, Search, Settings, ShieldCheck, Syringe, UserRound, Users, WalletCards, X } from 'lucide-react'
import { branches } from './data'
import { Badge, Button, IconButton } from './components'
import { Dashboard, PatientsPage, ProfilePage, AdmissionsPage, ExposurePage, TreatmentsPage, NotesPage, SchedulePage } from './pages/Clinical'
import { InventoryPage, PaymentsPage, ReferralsPage, RefundsPage } from './pages/Operations'
import { EmployeesPage, AttendancePage, PayrollPage, PayslipsPage } from './pages/People'
import { ReportsPage, RegistryPage, DOHPage } from './pages/Reports'
import { BranchesPage, UsersPage, AuditPage, SettingsPage } from './pages/Admin'

const nav=[
{group:'OVERVIEW',items:[['dashboard','Dashboard',LayoutDashboard]]},
{group:'PATIENT MANAGEMENT',items:[['patients','Patients',Users],['admissions','Admissions',ClipboardList],['exposure','RER / Animal Bite',HeartPulse],['treatments','Treatment & Vaccination',Syringe],['notes','Progress Notes',FileText],['schedule','Follow-up Schedule',CalendarDays]]},
{group:'INVENTORY',items:[['stock','Current Stock',Package],['receiving','Stock Receiving',Package],['usage','Stock Usage',Activity],['adjustments','Stock Adjustments',ClipboardList],['alerts','Expiring / Low Stock',Bell]]},
{group:'TRANSACTIONS',items:[['payments','Payments / Sales',CreditCard],['referrals','Branch Referrals',GitBranch],['refunds','Refunds',WalletCards]]},
{group:'EMPLOYEES',items:[['employees','Employee Records',Users],['attendance','Attendance',Clock3],['payroll','Payroll',WalletCards],['payslips','Payslips',FileText]]},
{group:'REPORTS',items:[['reports','Patient & Finance Reports',FileBarChart2],['registry','Rabies Exposure Registry',ClipboardList],['doh','DOH Reports',FileBarChart2]]},
{group:'ADMINISTRATION',items:[['branches','Branches',GitBranch],['users','Users & Roles',ShieldCheck],['audit','Audit Trail',FileClock],['settings','Settings',Settings]]}
]
const titles=Object.fromEntries(nav.flatMap(g=>g.items.map(([id,label])=>[id,label])))
const restricted={HR:['dashboard','employees','attendance','payroll','payslips','reports','settings'],Cashier:['dashboard','patients','payments','referrals','refunds','reports'],Employee:['dashboard','patients','schedule','attendance'], 'Nurse / Clinic Staff':['dashboard','patients','admissions','exposure','treatments','notes','schedule','stock','usage','alerts','referrals','attendance']}
const branchUser=['HR','Cashier','Employee','Nurse / Clinic Staff']
function useStored(key,initial){const [value,setValue]=React.useState(()=>{try{return JSON.parse(localStorage.getItem(key))??initial}catch{return initial}});React.useEffect(()=>localStorage.setItem(key,JSON.stringify(value)),[key,value]);return [value,setValue]}
export default function App(){
 const [logged,setLogged]=useStored('clinic-logged',false)
 const [page,setPage]=React.useState('dashboard')
 const [branch,setBranch]=React.useState('All branches')
 const [role,setRole]=React.useState('Owner')
 const [sidebar,setSidebar]=React.useState(true)
 const [mobile,setMobile]=React.useState(false)
 const [profileMenu,setProfileMenu]=React.useState(false)
 const [notifications,setNotifications]=React.useState(false)
 const [patientId,setPatientId]=React.useState('PT-24018')
 const [patients,setPatients]=useStored('clinic-patients',null)
 const [inventory,setInventory]=useStored('clinic-inventory',null)
 const [payments,setPayments]=useStored('clinic-payments',null)
 const [referrals,setReferrals]=useStored('clinic-referrals',null)
 const [refunds,setRefunds]=useStored('clinic-refunds',null)
 const [attendance,setAttendance]=useStored('clinic-attendance',{})
 const [notes,setNotes]=useStored('clinic-notes',[])
 const [activity,setActivity]=useStored('clinic-extra-activity',[])
 const [toast,setToast]=React.useState('')
 React.useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t)}},[toast])
 const notify=(message)=>{setToast(message);setActivity(a=>[{title:message,patient:'Demo user',branch:branch==='All branches'?'Cuyapo':branch,time:new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}),type:'Update'},...(a||[])].slice(0,12))}
 const go=(id)=>{setPage(id);setMobile(false);setProfileMenu(false);window.scrollTo({top:0,behavior:'smooth'})}
 const changeRole=(r)=>{setRole(r);setBranch(branchUser.includes(r)?'Cuyapo':'All branches');setProfileMenu(false);if(restricted[r]&&!restricted[r].includes(page))setPage('dashboard')}
 const ctx={page,go,branch,role,patients,setPatients,inventory,setInventory,payments,setPayments,referrals,setReferrals,refunds,setRefunds,attendance,setAttendance,notes,setNotes,activity,notify,patientId,setPatientId}
 if(!logged)return <Login onLogin={()=>setLogged(true)}/>
 let content
 if(page==='dashboard')content=<Dashboard {...ctx}/>
 else if(page==='patients')content=<PatientsPage {...ctx}/>
 else if(page==='profile')content=<ProfilePage {...ctx}/>
 else if(page==='admissions')content=<AdmissionsPage {...ctx}/>
 else if(page==='exposure')content=<ExposurePage {...ctx}/>
 else if(page==='treatments')content=<TreatmentsPage {...ctx}/>
 else if(page==='notes')content=<NotesPage {...ctx}/>
 else if(page==='schedule')content=<SchedulePage {...ctx}/>
 else if(['stock','receiving','usage','adjustments','alerts'].includes(page))content=<InventoryPage {...ctx}/>
 else if(page==='payments')content=<PaymentsPage {...ctx}/>
 else if(page==='referrals')content=<ReferralsPage {...ctx}/>
 else if(page==='refunds')content=<RefundsPage {...ctx}/>
 else if(page==='employees')content=<EmployeesPage {...ctx}/>
 else if(page==='attendance')content=<AttendancePage {...ctx}/>
 else if(page==='payroll')content=<PayrollPage {...ctx}/>
 else if(page==='payslips')content=<PayslipsPage {...ctx}/>
 else if(page==='reports')content=<ReportsPage {...ctx}/>
 else if(page==='registry')content=<RegistryPage {...ctx}/>
 else if(page==='doh')content=<DOHPage {...ctx}/>
 else if(page==='branches')content=<BranchesPage {...ctx}/>
 else if(page==='users')content=<UsersPage {...ctx}/>
 else if(page==='audit')content=<AuditPage {...ctx}/>
 else content=<SettingsPage {...ctx}/>
 return <div className={'app '+(!sidebar?'sidebar-collapsed':'')}>
  {mobile&&<div className="mobile-scrim" onClick={()=>setMobile(false)}/>}
  <aside className={'sidebar '+(mobile?'mobile-open':'')}>
   <div className="brand"><div className="brand-mark"><HeartPulse size={23} strokeWidth={2.3}/></div><div><strong>careline<span>.</span></strong><small>CLINIC COMMAND CENTER</small></div><button className="sidebar-close" onClick={()=>setMobile(false)}><X size={18}/></button></div>
   <div className="sidebar-context"><span className="context-icon"><GitBranch size={17}/></span><div><small>WORKSPACE</small><strong>{branch==='All branches'?'All 12 branches':branch+' Branch'}</strong></div><ChevronDown size={14}/></div>
   <nav className="side-nav">{nav.map(group=>{const items=group.items.filter(([id])=>!restricted[role]||restricted[role].includes(id));return items.length?<div className="nav-group" key={group.group}><div className="nav-label">{group.group}</div>{items.map(([id,label,Icon])=><button key={id} className={'nav-link '+(page===id||page==='profile'&&id==='patients'?'active':'')} onClick={()=>go(id)}><Icon size={18}/><span>{label}</span>{id==='alerts'&&<span className="nav-count">3</span>}</button>)}</div>:null})}</nav>
   <div className="sidebar-bottom"><div className="support-card"><span className="support-icon"><HeartPulse size={18}/></span><strong>Care across every branch</strong><p>One connected view of patients, teams and care.</p></div><button className="collapse-button" onClick={()=>setSidebar(!sidebar)}><PanelLeftClose size={17}/> Collapse sidebar</button></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="top-left"><button className="mobile-menu" onClick={()=>setMobile(true)}><Menu size={21}/></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{page==='profile'?'Patient Profile':titles[page]}</strong></div></div><div className="top-right"><div className="global-search"><Search size={17}/><input placeholder="Search patients, records..." onKeyDown={e=>{if(e.key==='Enter'){go('patients');e.target.blur()}}}/><kbd>⌘ K</kbd></div><div className="branch-select"><GitBranch size={16}/><select value={branch} onChange={e=>setBranch(e.target.value)} disabled={branchUser.includes(role)}>{(branchUser.includes(role)?['Cuyapo']:branches).map(b=><option key={b}>{b}</option>)}</select><ChevronDown size={14}/></div><div className="header-pop"><IconButton icon={Bell} onClick={()=>setNotifications(!notifications)} label="Notifications"/><i className="notification-dot"/>{notifications&&<div className="popover notifications"><strong>Notifications</strong><p><Badge>Due today</Badge> 4 vaccine follow-ups require attention.</p><p><Badge>Low stock</Badge> ERIG at Guimba is below threshold.</p><p><Badge>Pending</Badge> A referral is awaiting acceptance.</p></div>}</div><div className="header-pop"><button className="avatar-button" onClick={()=>setProfileMenu(!profileMenu)}><span className="avatar">AR</span><span className="avatar-text"><strong>Alex Rivera</strong><small>{role}</small></span><ChevronDown size={15}/></button>{profileMenu&&<div className="popover profile-pop"><strong>Demo role</strong>{['Owner','Admin','HR','Nurse / Clinic Staff','Cashier','Employee'].map(r=><button key={r} onClick={()=>changeRole(r)} className={role===r?'selected':''}>{r}{role===r?' ✓':''}</button>)}<button className="logout" onClick={()=>setLogged(false)}><LogOut size={15}/> Sign out</button></div>}</div></div></header>
   <main className="content">{content}</main><footer className="app-footer">Careline prototype · Fictional demo data · Local browser state only</footer>
  </div>{toast&&<div className="toast"><span>✓</span>{toast}<button onClick={()=>setToast('')}><X size={15}/></button></div>}
 </div>
}
function Login({onLogin}){const [email,setEmail]=React.useState('');const [password,setPassword]=React.useState('');const [show,setShow]=React.useState(false);const [remember,setRemember]=React.useState(true);return <div className="login-page"><div className="login-left"><div className="login-brand"><span className="brand-mark"><HeartPulse size={25}/></span><strong>careline<span>.</span></strong></div><div className="login-copy"><span className="login-kicker">CONNECTED CARE, EVERYWHERE</span><h1>A clearer view of care across every clinic.</h1><p>Bring patient journeys, clinical operations, teams and financial records together in one calm workspace.</p><div className="login-features"><div><span>01</span> Patient care, connected across branches</div><div><span>02</span> Daily operations, made visible</div><div><span>03</span> Better decisions, backed by insight</div></div></div><div className="login-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-card art-card-main"><div className="art-card-top"><span className="pulse-mini"><Activity size={20}/></span><span>Network overview</span><Badge>Live demo</Badge></div><div className="art-number">12 <small>connected branches</small></div><div className="art-bars">{[45,68,55,82,62,92,75,100,78,88].map((n,i)=><i key={i} style={{height:n+'%'}}/>)}</div></div><div className="art-card art-card-small"><div className="art-small-icon"><HeartPulse size={20}/></div><div><b>Care continues here</b><span>Seamless cross-branch follow-up</span></div></div></div><div className="login-copyright">© 2026 Careline Clinic Systems · UI prototype</div></div><div className="login-right"><form className="login-form" onSubmit={e=>{e.preventDefault();if(email&&password)onLogin()}}><div className="login-welcome"><span className="login-kicker">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Access your clinic operations dashboard.</p></div><label>Email or username<input required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter any demo username"/></label><label>Password<div className="password-field"><input required type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter any demo password"/><button type="button" onClick={()=>setShow(!show)}>{show?'Hide':'Show'}</button></div></label><label className="remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Remember me on this device</label><Button type="submit" className="login-submit">Sign in to Careline <ChevronRight size={16}/></Button><div className="demo-hint"><ShieldCheck size={17}/><span>Demo access: enter any username and password. System sign-in does not record attendance; use Time In separately.</span></div></form></div></div>}

