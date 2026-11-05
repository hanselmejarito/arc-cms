// Never include signature contents in validation errors.
export function readSignature(image: unknown, method: unknown) {
  if (image == null || image === '') return null
  if (typeof image !== 'string' || image.length > 350000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
    throw new Error('Choose a valid PNG signature image.')
  const bytes = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64')
  if (bytes.length < 33 || bytes.length > 250000 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16) !== 'IHDR')
    throw new Error('Choose a valid PNG signature image.')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > 16000000) throw new Error('Signature image dimensions are invalid.')
  if (method !== 'upload' && method !== 'pen') throw new Error('Choose a signature capture method.')
  return { image, method }
}
