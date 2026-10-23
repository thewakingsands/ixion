const binding = require('./binding.js')

exports.encodeRgba = async function encodeRgba(image, options) {
  if (!image || !Buffer.isBuffer(image.data)) throw new TypeError('RGBA data must be a Buffer')
  if (!options || typeof options !== 'object') throw new TypeError('Explicit encoding options are required')
  return binding.encodeRgba(image, options)
}
