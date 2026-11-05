import React from 'react'
import { Camera, Upload } from 'lucide-react'
import { Button } from './components'

const MAX = 80000

function fitImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) {
        reject(new Error('Photo dimensions are too large.'))
        return
      }
      const max = 320
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      let quality = 0.72
      let result = canvas.toDataURL('image/jpeg', quality)
      while (result.length > MAX && quality > 0.42) {
        quality -= 0.08
        result = canvas.toDataURL('image/jpeg', quality)
      }
      if (result.length > MAX) reject(new Error('Photo is too large. Use a smaller image.'))
      else resolve(result)
    }
    image.onerror = () => reject(new Error('Unable to open the photo.'))
    image.src = src
  })
}

export default function PatientPhoto({ value = '', onChange, compact = false }) {
  const [error, setError] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const videoRef = React.useRef(null)
  const streamRef = React.useRef(null)
  const uploadRef = React.useRef(null)

  const stop = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }
  React.useEffect(() => () => stop(), [])

  const apply = async src => {
    setBusy(true)
    setError('')
    try {
      onChange(await fitImage(src))
      setOpen(false)
      stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to use this photo.')
    } finally {
      setBusy(false)
    }
  }

  const openCamera = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera. Upload a photo instead.')
      return
    }
    try {
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false })
      } catch (err) {
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') throw err
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamRef.current = stream
      setOpen(true)
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
      setError(denied ? 'Allow the camera for this site, then take the photo again.' : 'Camera is unavailable. Upload a photo instead.')
    }
  }
  React.useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!open || !video || !stream) return
    video.srcObject = stream
    video.play().catch(() => {})
  }, [open])

  const shoot = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    apply(canvas.toDataURL('image/jpeg', 0.85))
  }

  return <div className={'patient-photo' + (compact ? ' compact' : '')}>
    {!compact && <div className="patient-photo-frame">{value ? <img src={value} alt="Patient photo preview"/> : <span>No photo</span>}</div>}
    <div className="patient-photo-actions">
      <Button icon={Camera} variant="secondary" disabled={busy} onClick={openCamera}>{value ? 'Retake photo' : 'Take photo'}</Button>
      <Button icon={Upload} variant="secondary" disabled={busy} onClick={() => uploadRef.current?.click()}>Upload photo</Button>
      {value && <button type="button" className="text-link" onClick={() => { setError(''); onChange('') }}>Remove photo</button>}
      {!compact && <p className="card-note">Optional. It appears beside the patient name and at the top-right of the admission print.</p>}
      {error && <p className="signature-error" role="alert">{error}</p>}
    </div>
    <input ref={uploadRef} hidden type="file" accept="image/png,image/jpeg" aria-label="Upload patient photo" onChange={event => {
      const input = event.target
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024) {
        setError('Choose a PNG or JPEG photo no larger than 8 MB.')
        return
      }
      const reader = new FileReader()
      reader.onerror = () => setError('Unable to read the photo.')
      reader.onload = () => apply(reader.result)
      reader.readAsDataURL(file)
    }}/>
    {open && <div role="dialog" aria-modal="true" aria-labelledby="patient-photo-title" className="patient-photo-backdrop">
      <div className="signature-dialog">
        <h2 id="patient-photo-title" style={{fontSize:28,margin:'0 0 8px'}}>Patient photo</h2>
        <p style={{margin:'0 0 12px',fontSize:18}}>Center the patient in the frame, then capture.</p>
        <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="patient-photo-video"/>
        <div className="signature-dialog-actions">
          <Button variant="secondary" onClick={() => { setOpen(false); stop() }}>Cancel</Button>
          <Button icon={Camera} disabled={busy} onClick={shoot}>Capture</Button>
        </div>
      </div>
    </div>}
  </div>
}
