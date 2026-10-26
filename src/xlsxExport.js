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
    const name = encoder.encode(path), data = encoder.encode(content), crc = crc32(data), local = [], central = []
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

export function buildReportXlsx(table, titles) {
  const sourceRows = [...table.querySelectorAll('tr')], occupied = new Set(), merges = [], rows = []
  const width = Math.max(1, ...sourceRows.map(row => [...row.children].reduce((n, cell) => n + Number(cell.colSpan || 1), 0)))
  titles.forEach((title, i) => { rows.push([{column:0, value:title, style:i === 3 ? 2 : 1}]); if(width > 1) merges.push(`A${i+1}:${columnName(width-1)}${i+1}`) })
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
      const header = element.tagName === 'TH', total = !!row.closest('tfoot')
      const numeric = !header && element.classList.contains('num') && /^-?[\d,]+(?:\.\d+)?$/.test(value)
      const style = header ? 3 : total ? 6 : element.classList.contains('auto') ? 5 : numeric ? 4 : 0
      cells.push({column, value:numeric ? Number(value.replace(/,/g, '')) : value, numeric, style})
      if(across > 1 || down > 1) merges.push(`${columnName(column)}${rowNumber}:${columnName(column+across-1)}${rowNumber+down-1}`)
      for(let y=0;y<down;y++) for(let x=0;x<across;x++) if(x || y) occupied.add(`${rowNumber+y}:${column+x}`)
      column += across
    }
    rows.push(cells)
  })
  const sheetRows = rows.map((cells, i) => {
    const number = i + 1, height = i < titles.length ? (i === 3 ? 27 : 20) : number >= firstTableRow && number < firstTableRow + headerRows ? 52 : 22
    const content = cells.map(cell => { const ref = `${columnName(cell.column)}${number}`; return cell.numeric ? `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>` : `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>` }).join('')
    return `<row r="${number}" ht="${height}" customHeight="1">${content}</row>`
  }).join('')
  const columns = Array.from({length:width}, (_, i) => `<col min="${i+1}" max="${i+1}" width="${i === 0 ? 30 : i === 1 ? 20 : 18}" customWidth="1"/>`).join('')
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''
  const worksheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${mergeXml}</worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F5E9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', worksheet], ['xl/styles.xml', styles]
  ])
}

export function downloadReportXlsx(filename, sheetSelector) {
  const sheet = document.querySelector(sheetSelector), table = sheet?.querySelector('table')
  if(!table) return false
  const head = sheet.querySelector('.sheet-head')
  const titles = head ? [...head.querySelectorAll('span,strong,h3,small')].map(el => el.innerText.trim()).filter(Boolean) : []
  const url = URL.createObjectURL(buildReportXlsx(table, titles)), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename.replace(/\.xls$/i, '.xlsx'); anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  return true
}
