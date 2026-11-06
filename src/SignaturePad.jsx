import React from 'react'
import { PenLine, Upload, RotateCcw, Check } from 'lucide-react'
import { Button } from './components'

export default function SignaturePad({ value, onChange, disabled = false, allowUpload = false }) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  const canvasRef = React.useRef(null)
  const pointerRef = React.useRef(null)
  const drawing = React.useRef(null)
  const uploadRef = React.useRef(null)

  React.useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#172334'
    if (value) {
      const image = new Image()
      image.onload = () => {
        if (canvasRef.current !== canvas) return
        const scale = Math.min(rect.width / image.width, rect.height / image.height, 1)
        const w = image.width * scale, h = image.height * scale
        ctx.drawImage(image, (rect.width - w) / 2, (rect.height - h) / 2, w, h)
      }
      image.src = value
    }
  }, [open])

  const point = e => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const showPointer = e => {
    const marker = pointerRef.current, canvas = canvasRef.current
    if (!marker || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
    marker.style.visibility = inside ? 'visible' : 'hidden'
    marker.style.left = e.clientX + 'px'
    marker.style.top = e.clientY + 'px'
  }
  const hidePointer = () => { if (pointerRef.current) pointerRef.current.style.visibility = 'hidden' }
  const start = e => {
    showPointer(e)
    if (drawing.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const p = point(e)
    drawing.current = { id: e.pointerId, point: p }
    canvas.setPointerCapture(e.pointerId)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 0.01, p.y + 0.01)
    ctx.stroke()
  }
  const move = e => {
    showPointer(e)
    const current = drawing.current
    if (!current || current.id !== e.pointerId) return
    const ctx = canvasRef.current.getContext('2d')
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(current.point.x, current.point.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    current.point = p
  }
  const compactSignature = () => {
    const canvas = canvasRef.current, ctx = canvas.getContext('2d')
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    let left = width, top = height, right = -1, bottom = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x); right = Math.max(right, x)
        top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
    }
    if (right < 0) return ''
    const padding = Math.max(8, Math.ceil(Math.max(right - left, bottom - top) * .04))
    left = Math.max(0, left - padding); top = Math.max(0, top - padding)
    right = Math.min(width - 1, right + padding); bottom = Math.min(height - 1, bottom + padding)
    const sourceWidth = right - left + 1, sourceHeight = bottom - top + 1
    const scale = Math.min(1, 1200 / sourceWidth, 400 / sourceHeight)
    const output = document.createElement('canvas')
    output.width = Math.max(1, Math.round(sourceWidth * scale))
    output.height = Math.max(1, Math.round(sourceHeight * scale))
    output.getContext('2d').drawImage(canvas, left, top, sourceWidth, sourceHeight, 0, 0, output.width, output.height)
    return output.toDataURL('image/png')
  }
  const finish = e => {
    if (!drawing.current || drawing.current.id !== e.pointerId) return
    drawing.current = null
    setDraft(compactSignature())
  }
  return <div className="signature-control">
    <div className="signature-actions">
      <Button icon={PenLine} variant="secondary" disabled={disabled} onClick={() => { setDraft(value || ''); setOpen(true) }}>{value ? 'Sign again' : 'Sign with pen'}</Button>
      {allowUpload && <Button icon={Upload} variant="secondary" disabled={disabled} onClick={() => uploadRef.current?.click()}>Upload signature</Button>}
    </div>
    <p className="signature-help">{allowUpload ? 'Use the pen pad or upload a PNG / JPEG image (up to 2 MB).' : 'Open the signing area to use the pen pad.'}</p>
    {value && <figure className="signature-preview"><figcaption>Signature preview</figcaption><img src={value} alt="Signature preview"/><p>Ready to save with this record.</p></figure>}
    {allowUpload && <input ref={uploadRef} hidden type="file" aria-label="Upload signature image" accept="image/png,image/jpeg" disabled={disabled} onChange={event => {
        const input = event.target
        const file = input.files?.[0]
        input.value = ''
        setUploadError('')
        if (!file) return
        if (!['image/png','image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
          setUploadError('Choose a PNG or JPEG image no larger than 2 MB.')
          return
        }
        const reader = new FileReader()
        reader.onerror = () => setUploadError('Unable to read the image.')
        reader.onload = () => {
          const image = new Image()
          image.onerror = () => setUploadError('Unable to open the image.')
          image.onload = () => {
            if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) {
              setUploadError('Image dimensions are too large.')
              return
            }
            const scale = Math.min(1, 1200 / image.naturalWidth, 400 / image.naturalHeight)
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
            const result = canvas.toDataURL('image/png')
            if (result.length > 350000) { setUploadError('The signature image is too detailed. Use a smaller image.'); return }
            onChange(result, 'upload')
          }
          image.src = reader.result
        }
        reader.readAsDataURL(file)
      }}/>}
    {uploadError && <p className="signature-error" role="alert">{uploadError}</p>}
    {open && <div className="signature-backdrop" role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title">
      <div className="signature-dialog">
        <div className="signature-dialog-head"><h2 id="signature-dialog-title">Sign here</h2><p>Use the pen and watch your signature on the screen.</p></div>
        <canvas ref={canvasRef} aria-label="Signature drawing area" onPointerEnter={showPointer} onPointerLeave={hidePointer} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
          className="signature-canvas"/>
        <span ref={pointerRef} className="signature-pointer" aria-hidden="true"/>
        <div className="signature-dialog-actions">
          <Button icon={RotateCcw} variant="secondary" onClick={() => {const c=canvasRef.current;c.getContext('2d').clearRect(0,0,c.width,c.height);setDraft('')}}>Clear</Button>
          <div className="signature-actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button icon={Check} disabled={!draft} onClick={() => {onChange(draft, 'pen');setOpen(false)}}>Use signature</Button>
          </div>
        </div>
      </div>
    </div>}
  </div>
}