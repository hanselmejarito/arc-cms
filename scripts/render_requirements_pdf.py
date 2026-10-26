from pathlib import Path
from xml.sax.saxutils import escape
from docx import Document
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph as DocxParagraph
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak

source = Path(r'\\wsl$\Ubuntu\home\hplusplus\projects\clinic-codex\docs\ARC_Final_Business_and_System_Requirements_v1.2_For_Approval.docx')
output = Path(r'\\wsl$\Ubuntu\home\hplusplus\projects\clinic-codex\output\pdf\ARC_Final_Business_and_System_Requirements_v1.2_For_Approval.pdf')
output.parent.mkdir(parents=True, exist_ok=True)
doc = Document(source)
pdfmetrics.registerFont(TTFont('ArialDoc', r'C:\Windows\Fonts\arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialDocBold', r'C:\Windows\Fonts\arialbd.ttf'))
pdfmetrics.registerFontFamily('ArialDoc', normal='ArialDoc', bold='ArialDocBold')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='ARCBody', fontName='ArialDoc', fontSize=9.2, leading=13.2, spaceAfter=7, textColor=colors.HexColor('#18232E')))
styles.add(ParagraphStyle(name='ARCHeading', fontName='ArialDocBold', fontSize=12.2, leading=15, spaceBefore=15, spaceAfter=7, keepWithNext=True, textColor=colors.HexColor('#123147')))
styles.add(ParagraphStyle(name='ARCSubheading', fontName='ArialDocBold', fontSize=10, leading=13, spaceBefore=10, spaceAfter=5, keepWithNext=True, textColor=colors.HexColor('#123147')))
styles.add(ParagraphStyle(name='ARCBullet', parent=styles['ARCBody'], leftIndent=15, firstLineIndent=-9, bulletIndent=4, spaceAfter=4))
styles.add(ParagraphStyle(name='ARCTable', fontName='ArialDoc', fontSize=7.75, leading=10.3, textColor=colors.HexColor('#18232E')))
styles.add(ParagraphStyle(name='ARCTableHead', fontName='ArialDocBold', fontSize=8, leading=10.5, textColor=colors.white))
styles.add(ParagraphStyle(name='ARCTitle', fontName='ArialDocBold', fontSize=17, leading=20.5, spaceAfter=6, textColor=colors.HexColor('#123147')))
styles.add(ParagraphStyle(name='ARCSubtitle', fontName='ArialDoc', fontSize=10.3, leading=14, spaceAfter=6, textColor=colors.HexColor('#40586B')))
styles.add(ParagraphStyle(name='ARCSign', fontName='ArialDoc', fontSize=9.2, leading=12, textColor=colors.HexColor('#18232E')))

def ptext(text):
    return escape(text.replace('\ufffd', '-')).replace('\n', '<br/>')

story = []
first = True
for block in doc.iter_inner_content():
    if isinstance(block, DocxParagraph):
        text = block.text.strip()
        if not text:
            continue
        if first:
            first = False
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            for index, line in enumerate(lines):
                if index == 0:
                    story.append(Paragraph(ptext(line), styles['ARCSubtitle']))
                elif index == 1:
                    story.append(Paragraph(ptext(line), styles['ARCTitle']))
                elif index == 2:
                    story.append(Paragraph(ptext(line), styles['ARCSubtitle']))
                else:
                    story.append(Paragraph(ptext(line), styles['ARCBody']))
            story.append(Spacer(1, 9))
            continue
        if text.startswith('24. Approval / Scope Freeze'):
            story.append(PageBreak())
        if text.startswith('Client Representative Name and Signature:'):
            continue
        if text.startswith('Developer/Project Representative Name and Signature:'):
            sign = Table([
                [Paragraph('____________________________________<br/>Client representative name and signature', styles['ARCSign']), Paragraph('________________<br/>Date', styles['ARCSign'])],
                [Paragraph('____________________________________<br/>Developer or project representative name and signature', styles['ARCSign']), Paragraph('________________<br/>Date', styles['ARCSign'])]
            ], colWidths=[350, 146], rowHeights=[65, 65])
            sign.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'BOTTOM'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),12)]))
            story.append(KeepTogether([Spacer(1, 16), sign]))
            continue
        style_name = block.style.name
        if style_name.startswith('Heading 1') or (text[:2].isdigit() and '. ' in text[:5] and len(text)<100):
            style = styles['ARCHeading']
        elif style_name.startswith('Heading') or (text[:4].count('.') and len(text)<90):
            style = styles['ARCSubheading']
        elif style_name.startswith('List'):
            story.append(Paragraph('&#8226;  '+ptext(text), styles['ARCBullet']))
            continue
        else:
            style = styles['ARCBody']
        story.append(Paragraph(ptext(text), style))
    elif isinstance(block, DocxTable):
        count = len(block.columns)
        if count == 3:
            widths = [55, 319, 122]
        else:
            widths = [143, 353]
        data = []
        for row_index, row in enumerate(block.rows):
            style = styles['ARCTableHead'] if row_index == 0 else styles['ARCTable']
            data.append([Paragraph(ptext(cell.text.strip()), style) for cell in row.cells])
        table = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT', splitByRow=1)
        table.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#17384C')),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F4F7F9')]),
            ('GRID',(0,0),(-1,-1),0.35,colors.HexColor('#CDD5DB')),
            ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
            ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
            ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)
        ]))
        story.extend([table, Spacer(1, 9)])

def decorate(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#D7E0E5'))
    canvas.line(0.68*inch, 0.56*inch, 7.82*inch, 0.56*inch)
    canvas.setFont('ArialDoc', 8)
    canvas.setFillColor(colors.HexColor('#5B6D78'))
    canvas.drawString(0.7*inch, 0.38*inch, 'ARC Animal Bite Center  |  Business and System Requirements  |  Version 1.2')
    canvas.drawRightString(7.8*inch, 0.38*inch, f'Page {document.page}')
    canvas.restoreState()

pdf = SimpleDocTemplate(str(output), pagesize=letter, rightMargin=0.7*inch, leftMargin=0.7*inch, topMargin=0.64*inch, bottomMargin=0.74*inch, title='ARC Business and System Requirements Version 1.2', author='ARC Clinic Management System')
pdf.build(story, onFirstPage=decorate, onLaterPages=decorate)
print(output)
