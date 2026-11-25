const encoder = new TextEncoder()
const escapeXml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const columnName = index => { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name }
const u16 = (out, n) => out.push(n & 255, n >>> 8 & 255)
const u32 = (out, n) => out.push(n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255)
const crcTable = Array.from({length:256}, (_, i) => { let c = i; for(let j=0;j<8;j++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0 })
const crc32 = bytes => { let c = 0xffffffff; for(const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0 }

function zip(files) {
  const parts = [], directory = []
  let offset = 0
  for(const [path, content] of files) {
    const name = encoder.encode(path), data = typeof content === 'string' ? encoder.encode(content) : content, crc = crc32(data), local = [], central = []
    u32(local, 0x04034b50); u16(local, 20); u16(local, 0); u16(local, 0); u16(local, 0); u16(local, 0)
    u32(local, crc); u32(local, data.length); u32(local, data.length); u16(local, name.length); u16(local, 0)
    parts.push(new Uint8Array(local), name, data)
    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0)
    u32(central, crc); u32(central, data.length); u32(central, data.length); u16(central, name.length)
    u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0); u32(central, offset)
    directory.push(new Uint8Array(central), name)
    offset += local.length + name.length + data.length
  }
  const size = directory.reduce((n, part) => n + part.length, 0), end = []
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, files.length); u16(end, files.length); u32(end, size); u32(end, offset); u16(end, 0)
  return new Blob([...parts, ...directory, new Uint8Array(end)], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}

export function buildReportXlsx(table, titles, logos = []) {
  const sourceRows = [...table.querySelectorAll('tr')], occupied = new Set(), merges = [], rows = [], mergedHeaderCells = []
  const width = Math.max(1, ...sourceRows.map(row => [...row.children].reduce((n, cell) => n + Number(cell.colSpan || 1), 0)))
  const logoHeader = logos.length === 2 && width >= 10
  const center = Math.floor(width / 2), titleStart = logoHeader ? Math.max(1, center - 5) : 0, titleEnd = logoHeader ? Math.min(width - 2, center + 5) : width - 1
  const headingIndex = Math.max(0, titles.length - 2)
  titles.forEach((title, i) => { rows.push([{column:titleStart, value:title, style:logoHeader ? (i === headingIndex ? 8 : 7) : (i === headingIndex ? 2 : 1)}]); if(width > 1) merges.push(`${columnName(titleStart)}${i+1}:${columnName(titleEnd)}${i+1}`) })
  rows.push([])
  const firstTableRow = rows.length + 1, headerRows = table.tHead?.rows.length || 0
  sourceRows.forEach((row, index) => {
    const rowNumber = firstTableRow + index, cells = []
    let column = 0
    for(const element of row.children) {
      while(occupied.has(`${rowNumber}:${column}`)) column++
      const across = Number(element.colSpan || 1), down = Number(element.rowSpan || 1)
      const input = element.querySelector('input')
      const value = input ? (input.value === '' ? '0' : input.value) : element.textContent.trim()
      const header = element.tagName === 'TH', total = !!row.closest('tfoot') || !!row.classList?.contains('hr-total')
      const amount = (element.classList.contains('hr-amount') || total) && /^₱\s*-?[\d,]+(?:\.\d+)?$/.test(value)
      const numeric = amount || (!header && element.classList.contains('num') && /^-?[\d,]+(?:\.\d+)?$/.test(value))
      const style = header ? 3 : total ? 6 : element.classList.contains('auto') ? 5 : numeric ? 4 : 9
      cells.push({column, value:numeric ? Number(value.replace(/[₱,\s]/g, '')) : value, numeric, style})
      if(across > 1 || down > 1) merges.push(`${columnName(column)}${rowNumber}:${columnName(column+across-1)}${rowNumber+down-1}`)
      for(let y=0;y<down;y++) for(let x=0;x<across;x++) if(x || y) {
        occupied.add(`${rowNumber+y}:${column+x}`)
        if(header) mergedHeaderCells.push({row:rowNumber+y, column:column+x})
      }
      column += across
    }
    rows.push(cells)
  })
  // Excel needs explicit styles at the edges of merged header ranges.
  for(const cell of mergedHeaderCells) if(rows[cell.row-1]) rows[cell.row-1].push({column:cell.column, value:'', style:3})
  for(const row of rows) row.sort((a,b)=>a.column-b.column)
  const sheetRows = rows.map((cells, i) => {
    const number = i + 1, height = i < titles.length ? (i === headingIndex ? 27 : i === titles.length - 1 && titles[i].length > 80 ? 34 : 20) : number >= firstTableRow && number < firstTableRow + headerRows ? 52 : Math.max(22, ...cells.map(cell => Math.min(90, Math.ceil(String(cell.value ?? '').length / 18) * 15)))
    const content = cells.map(cell => { const ref = `${columnName(cell.column)}${number}`; return cell.numeric ? `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>` : `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>` }).join('')
    return `<row r="${number}" ht="${height}" customHeight="1">${content}</row>`
  }).join('')
  const columns = Array.from({length:width}, (_, i) => `<col min="${i+1}" max="${i+1}" width="${i === 0 ? 30 : i === 1 ? 20 : 18}" customWidth="1"/>`).join('')
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''
  const worksheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${mergeXml}${logoHeader ? '<drawing r:id="rId1"/>' : ''}</worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F5E9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', worksheet], ['xl/styles.xml', styles]
  ]
  if (logoHeader) {
    files[0][1] = files[0][1].replace('<Override PartName="/xl/workbook.xml"', '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml"').replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>')
    const anchor = (col, index, name) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="952500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index}" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${index}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
    files.push(['xl/worksheets/_rels/sheet1.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'])
    files.push(['xl/drawings/drawing1.xml',`<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchor(Math.max(0,titleStart-1),1,'Bagong Pilipinas')}${anchor(Math.min(width-1,titleEnd+1),2,'Department of Health')}</xdr:wsDr>`])
    files.push(['xl/drawings/_rels/drawing1.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo1.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo2.png"/></Relationships>'])
    files.push(['xl/media/logo1.png',logos[0]],['xl/media/logo2.png',logos[1]])
  }
  return zip(files)
}

export async function downloadReportXlsx(filename, sheetSelector) {
  const sheet = document.querySelector(sheetSelector), table = sheet?.querySelector('table')
  if(!table) return false
  const head = sheet.querySelector('.sheet-head')
  const titles = head ? [...head.querySelectorAll('span,strong,h3,small')].map(el => el.innerText.trim()).filter(Boolean) : []
  let logos = []
  try {
    const images = [...head.querySelectorAll('.report-logo')]
    if(images.length === 2) logos = await Promise.all(images.map(async image => { const response = await fetch(image.src); if(!response.ok) throw new Error('Logo unavailable'); return new Uint8Array(await response.arrayBuffer()) }))
  } catch { return false }
  const url = URL.createObjectURL(buildReportXlsx(table, titles, logos)), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename.replace(/\.xls$/i, '.xlsx'); anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  return true
}
