// Never include photo contents in validation errors.
export function readPhoto(image: unknown) {
  if (image == null || image === '') return null
  if (typeof image !== 'string' || image.length > 80000) throw new Error('Choose a smaller JPEG or PNG photo.')
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
  if (!match) throw new Error('Choose a valid JPEG or PNG photo.')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length < 32 || bytes.length > 60000) throw new Error('Choose a smaller JPEG or PNG photo.')
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (match[1] === 'png' ? !png : !jpeg) throw new Error('Choose a valid JPEG or PNG photo.')
  if (png) {
    if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Choose a valid JPEG or PNG photo.')
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    if (!width || !height || width * height > 2000000) throw new Error('Photo dimensions are too large.')
  }
  return image
}
