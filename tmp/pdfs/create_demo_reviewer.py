from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from xml.sax.saxutils import escape

pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial',boldItalic='Arial-Bold')
out='output/pdf/ARC_Demo_Reviewer_2026-11-13.pdf'
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='Top',fontName='Arial-Bold',fontSize=21,leading=25,textColor=colors.HexColor('#143D40'),spaceAfter=8))
styles.add(ParagraphStyle(name='Sub',fontName='Arial-Bold',fontSize=13,leading=17,textColor=colors.HexColor('#126A68'),spaceAfter=7))
styles.add(ParagraphStyle(name='BodyX',fontName='Arial',fontSize=10.7,leading=15.2,textColor=colors.HexColor('#1F3436'),spaceAfter=5))
styles.add(ParagraphStyle(name='SmallX',fontName='Arial',fontSize=9.4,leading=13,textColor=colors.HexColor('#45595B'),spaceAfter=4))
styles.add(ParagraphStyle(name='BulletX',fontName='Arial',fontSize=10.4,leading=14.8,leftIndent=12,firstLineIndent=-9,spaceAfter=5,textColor=colors.HexColor('#1F3436')))
styles.add(ParagraphStyle(name='CallX',fontName='Arial',fontSize=10.2,leading=14.7,textColor=colors.HexColor('#193F3F')))
styles.add(ParagraphStyle(name='TagX',fontName='Arial-Bold',fontSize=8.5,leading=11,textColor=colors.HexColor('#8B6100'),spaceAfter=8))
S=[]
def p(t,style='BodyX'): S.append(Paragraph(t,styles[style]))
def head(title,tag): p(tag.upper(),'TagX');p(title,'Top')
def bullet(title,text): p('&#8226; <b>'+escape(title)+'</b> '+escape(text),'BulletX')
def say(text):
    box=Table([[Paragraph('<b>Maaaring sabihin:</b><br/>'+escape(text),styles['CallX'])]],colWidths=[170*mm])
    box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#EAF5F2')),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#A5D3CA')),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]));S.append(box);S.append(Spacer(1,7))
def page():S.append(PageBreak())

head('Client demo reviewer','13 November 2026 | ARC Clinic Management System')
p('Gabay na puwedeng basahin habang nagpe-present. Gamit ang fictional na data sa demo.','BodyX')
say('Magandang araw po. Ipapakita ko ang mga pangunahing workflow ng system, babalikan natin ang mga napag-usapan noong October 27, at kukunin ko rin po ang inyong kumpirmasyon sa mga natitirang rules bago ang final testing.')
p('Bago magsimula','Sub')
bullet('Signed baseline:', 'Ang requirements v1.2 ay pinirmahan na ng client. Baseline ito ng scope; hindi nito ibig sabihing tapos na ang UAT o production deployment.')
bullet('October 27 discussion:', 'Mga napag-usapang requirements ito na dapat i-review ng client; ang mga implementation o detalye ay hindi awtomatikong final approval.')
bullet('HR follow-up:', 'May mga nakuhang operational rules at manual forms mula kay HR. Ipapakita ang mga iyon at kukunin pa rin ang confirmation ng client kung kailangan.')
p('Proposed meeting flow','Sub')
p('1. Maikling recap ng October 27 &nbsp;&nbsp; 2. Guided system demo &nbsp;&nbsp; 3. Client questions at decisions &nbsp;&nbsp; 4. Ilista ang susunod na hakbang.','BodyX')
p('Status key: IMPLEMENTED = may code; TESTED = nasubukan ayon sa ating notes; REVIEW = kailangan pang i-validate sa demo o client. Ang lumang live site ay hindi pa na-verify na updated.','SmallX')
page()
head('October 27: recap na babasahin','Una: kumpirmahin ang pagkaunawa')
say('Noong October 27, ito po ang mga napag-usapan nating i-review. Babalikan ko muna ang bawat isa, saka ko ipapakita ang kasalukuyang system.')
items=[
('1. Muñoz at Palayan','8 AM-6 PM schedule, isang oras na break, at overtime handling.'),
('2. Access','Clinic-only access at hiwalay na privileged accounts para sa owners at administrator.'),
('3. Flu','Pagpapalit ng service label na Influvac sa Flu; itatala pa rin ang product o brand kung kailangan.'),
('4. Reminders at forms','SMS reminders, signature pad, at patient photo sa admission printout.'),
('5. Other Treatments','ERIG, TT, Flu, Pneumococcal at Hepatitis B na maaaring ibigay nang walang RER admission o registry number.'),
('6. Cross-branch referral','Pagpapatuloy ng Baloc Day 0 sa Guimba, unified treatment history, hiwalay na branch records, at completion tracking.'),
('7. Discount at presyo','Senior/PWD 20% discount, editable transaction price, at VetMed pricing para kumpirmahin.'),
('8. Staff at payroll','Payroll eligibility, resignation, account deactivation, rehire at preservation ng history.')]
for a,b in items:bullet(a,b)
p('Transition','Sub')
say('Iyan po ang recap. Ipapakita ko ngayon kung alin ang nakikita na sa system at kung alin ang kailangan pa nating pagdesisyunan o i-test.')
page()
head('Demo flow: actual na ipapakita','Gamitin lamang ang fictional na pasyente')
bullet('1. Patient at admission','Mag-create o maghanap ng test patient; ipakita ang required address at municipality, patient flags, admission at patient photo. Huwag gumamit ng totoong personal data.')
bullet('2. RER at consent','Ipakita ang exposure details, category at signature pad. Staff pa rin ang nag-a-assess. I-save at ipakita ang admission print preview; i-check ang linaw ng signatures at photo.')
bullet('3. Treatment at SOAP','Ipakita ang scheduled doses, vaccinator, sign/upload at progress note. Ipakita ang pirma sa printout. Ang Day 0 signature ay nakadugtong sa recorded dose.')
bullet('4. Other Treatments','Pumili ng Flu at iba pang service, branch at stock batch; ipakita ang editable prices at Save as Given. Ang stock ay nababawas sa pag-record ng given treatment; puwedeng sumunod ang payment.')
bullet('5. Payment at discount','Buksan ang pending bill sa Payments / Sales > Collect. Ipakita ang original total, Senior/PWD selection, 20% at final total. I-verify sa test patient at ipakita ang paid record.')
bullet('6. Inventory at report','Ipakita ang batch, expiry at stock movement. Ipakita na Other Treatments ay nasa sales/inventory, hindi sa RER/DOH exposure counts; i-verify ang report gamit ang sample.')
bullet('7. Attendance at print','Ipakita ang time in/out, hiwalay na night controls kung available sa branch, at Attendance Summary / Payroll Register print preview. Gamitin ang test employee at sabihin na HR validation ay pending.')
p('Mahalagang demo note','Sub')
p('Sa kasalukuyang RER walk-in flow, kailangan munang may payment bago ma-record ang dose. Ibang flow ito sa Other Treatments; huwag sabihing puwedeng laging treatment muna sa RER.','BodyX')
page()
head('Mga dapat linawin sa client','Pagkatapos ng maikling demo')
bullet('Access at accounts','Sino ang dalawang owners at administrator na magkakaroon ng sariling privileged accounts? Ano ang pahintulot nila at paano ipatutupad ang clinic-only access?')
bullet('SMS reminders','Kumpirmahin ang reminder one day before at sa appointment day, oras ng send, consent/opt-out, message, provider, internet at recurring SMS charges. In-system reminders lang ang nakita sa current code; huwag i-demo bilang live SMS.')
bullet('Consent at signatures','Ano ang aprubadong consent process at eksaktong statement kung may kailangang ipakita? Sino ang maaaring gumamit o mag-upload ng doctor/vaccinator signature? I-check ang linaw at layout sa papel.')
bullet('Cross-branch','Kumpirmahin ang receiving branch workflow, kung sino ang mag-a-accept, history at report ownership. Ang Baloc D0 > Guimba completion at reports ay kailangan pang end-to-end test.')
bullet('Other Treatments','Kumpirmahin na puwedeng walang registry, na kasama sa sales at inventory pero excluded sa RER/DOH exposure reports, at bayad pagkatapos bilang isang buong payment.')
bullet('Discount at Flu','Kumpirmahin ang 20% sa eligible services, ang walang-VAT assumption, pag-check ng eligibility at receipt breakdown. Ang bagong Flu default ay ₱1,600; sa confirmed rule, isang 20% discount lang. Ipa-check ang application sa accountant.')
bullet('VetMed','Ano ang eligibility at services? Proposed ang ₱500 ARV per dose; kumpirmahin kung kailan at saang branch ito applicable at paano isasama sa billing.')
bullet('Inventory at cancellation','Kumpirmahin ang quantity/vial rules sa bawat product, expired batch policy at stock corrections. Para sa nakanselang bayad, kumpirmahin ang refund approval at audit process.')
page()
head('HR follow-up: attendance at payroll','Ibalik sa client para sa validation')
say('May follow-up po tayo kay HR. Ito ang working rules na nakuha ko; paki-review po kung tama ang application bago tayo mag-finalize ng payroll.')
bullet('Morning at OT','Muñoz/Palayan: 8 AM-6 PM, 12-1 PM unpaid break, 9 actual hours sa buong shift. Kinumpirma na ang ika-9 na oras ay OT bukod sa daily rate. Paki-review ang worked-break correction at ordinary/holiday computation.')
bullet('Grace periods','Morning: 20 minutes; hal. 8:21 para sa 8:00 start = 1 minute late ayon kay HR. Lampas shift: 15-minute filing/review threshold; panatilihin ang actual timestamps at ipa-validate ang payable work sa HR/accountant.')
bullet('Straight duty','Guimba at Cabanatuan: hiwalay na morning at 4-11 PM night in/out. HR example: ₱850 morning + ₱850 night + night differential. Halimbawa lang ang ₱850; gamitin ang configured employee rate.')
bullet('Night late at differential','Sinabi ni HR: night rate ÷ 7 hours, per-minute ang late/undertime; walang unpaid night break para sa demo. Ipa-confirm ang applicable differential at overtime basis. Night OT pagkatapos ng 11 PM at pagtawid ng midnight ay hindi pa kumpleto.')
bullet('Partial days','I-review ang late, early-out, half-day at hindi nakuha ang break; huwag hulaan ang payable break. May local Admin review control, ngunit kailangan pa ng actual UI at payroll validation.')
bullet('Employee status','Kapag payroll eligibility off, nakatago ang employee sa payroll, payslips at summary sa lahat ng periods; naka-save pa ang records. Kumpirmahin kung ito ang gusto, lalo na sa historical payslips, resignation at rehire.')
bullet('Manual HR forms','Gusto ba nila ang bagong attendance matrix at payroll print? Kumpirmahin ang daily status, regular/part-time, allowance, at Prepared / Checked / Approved. Pirmahan sa print ay hindi pa digital approval.')
p('Tandaan: kasalukuyang payroll ay dapat ituring na for review hanggang mapatunayan sa agreed sample cases. Ang direct Bundy/biometric integration at full leave-credit management ay nasa exclusions ng signed v1.2.','SmallX')
page()
head('Bago at pagkatapos ng meeting','Checklist at decision log')
p('Bago ang demo','Sub')
bullet('Environment','Mag-rehearse sa local app. Hindi pa napatunayang updated ang Vercel/Supabase deployment; huwag ipangakong pareho ito sa local build.')
bullet('Demo setup','Nalinisan ang local test records at Superadmin lang ang natira. Maghanda ng fictional employees/accounts, patient, sapat na stock at batches, at test cases bago ang presentation.')
bullet('Equipment','I-test ang XP-Pen, camera permissions, sign/upload, save/reload, print preview at actual printer. I-review ang SOAP at admission layout sa papel.')
bullet('Iwasan ang overclaim','Cross-branch end-to-end, local attendance/payroll, new HR print layouts at recent changes ay kailangang i-test sa browser. SMS provider integration ay hindi pa live ayon sa current code.')
p('Pagkatapos ng demo','Sub')
bullet('Kunin ang malinaw na decision','Para sa bawat tanong: approved, for revision, o pending; ilista ang responsable at target date. Huwag ipagpalagay na approved ang rule dahil lang nagawa o nakita sa demo.')
bullet('Scope at pagbabago','Ihambing ang bagong hiling sa signed v1.2. Material additions at excluded integrations ay idaan sa documented change request kung applicable.')
bullet('Susunod na UAT','Magkasundo sa test cases para sa branch access, clinical workflow, inventory, cross-branch, discounts, payroll at reports bago production use.')
p('Notes / decisions','Sub')
for i in range(4):p('____________________________________________________________________________________','BodyX')
p('Reference: ARC Final Business and System Requirements v1.2, signed baseline per client confirmation; sections 4-14, 17-24. This reviewer does not amend the agreement.','SmallX')

def footer(c,doc):
    c.setStrokeColor(colors.HexColor('#D4E2DE'));c.line(20*mm,17*mm,190*mm,17*mm)
    c.setFont('Arial',8);c.setFillColor(colors.HexColor('#607477'));c.drawString(20*mm,12*mm,'ARC CMS | Client demo reviewer | 13 November 2026');c.drawRightString(190*mm,12*mm,str(doc.page))

doc=SimpleDocTemplate(out,pagesize=A4,rightMargin=20*mm,leftMargin=20*mm,topMargin=16*mm,bottomMargin=22*mm,title='ARC CMS Client Demo Reviewer',author='ARC CMS project')
doc.build(S,onFirstPage=footer,onLaterPages=footer)
print('Created:',out)
