// Clear backing pixels independently of the device-pixel-ratio transform.
export function clearSignatureCanvas(canvas) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
  ctx.beginPath()
}
