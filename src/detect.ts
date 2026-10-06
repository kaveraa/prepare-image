/**
 * Format detection from the header bytes.
 *
 * `file.type` often lies: several browsers report an empty type for a HEIC,
 * and a file renamed to `.jpg` keeps its original bytes. So we look neither
 * at the name nor at the declared type, only at the start of the file.
 */

/** The formats we can recognise. */
export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'heic' | 'avif' | 'tiff' | 'bmp' | 'unknown'

/**
 * The ISO-BMFF brands of the HEIF family. `mif1` and `msf1` are generic:
 * an AVIF can carry them too, so we do not decide on them right away.
 */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']
const AMBIGUOUS_BRANDS = ['mif1', 'msf1']
const AVIF_BRANDS = ['avif', 'avis']

/** Past this, we give up: a sane header puts `ftyp` in the very first boxes. */
const MAX_BOXES = 8

/** Reads one byte; returns 0 past the end, which avoids bounds checks everywhere. */
function at(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset]
  return value === undefined ? 0 : value
}

/** Do the bytes at this position match this ASCII text? */
function matches(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (at(bytes, offset + i) !== text.charCodeAt(i)) return false
  }
  return true
}

/** Four bytes read as ASCII text. Returns '' when out of range. */
function fourcc(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return ''
  return String.fromCharCode(at(bytes, offset), at(bytes, offset + 1), at(bytes, offset + 2), at(bytes, offset + 3))
}

/** Big-endian 32-bit integer. */
function u32be(bytes: Uint8Array, offset: number): number {
  return ((at(bytes, offset) << 24) | (at(bytes, offset + 1) << 16) | (at(bytes, offset + 2) << 8) | at(bytes, offset + 3)) >>> 0
}

/**
 * Looks for the `ftyp` box and returns the brands it carries, the major one
 * first. The box is not always the first one: we follow the declared sizes
 * from box to box, and refuse any absurd size so we never loop forever.
 */
function readFtypBrands(bytes: Uint8Array): string[] | null {
  let offset = 0
  for (let box = 0; box < MAX_BOXES; box += 1) {
    if (offset + 8 > bytes.length) return null
    const declared = u32be(bytes, offset)
    const type = fourcc(bytes, offset + 4)
    let header = 8
    let size = declared
    if (declared === 1) {
      // 64-bit size. Past 4 GB we give up: this is not a photo.
      if (offset + 16 > bytes.length) return null
      if (u32be(bytes, offset + 8) !== 0) return null
      size = u32be(bytes, offset + 12)
      header = 16
    } else if (declared === 0) {
      // 0 means "up to the end of the file".
      size = bytes.length - offset
    }
    if (size < header) return null
    if (type === 'ftyp') {
      const end = Math.min(offset + size, bytes.length)
      const brands: string[] = []
      const major = fourcc(bytes, offset + header)
      if (major === '') return null
      brands.push(major)
      // Skip the minor version, then read the compatible brands.
      for (let p = offset + header + 8; p + 4 <= end; p += 4) {
        brands.push(fourcc(bytes, p))
      }
      return brands
    }
    offset += size
  }
  return null
}

/** AVIF, HEIC, or nothing at all, from the brands of the `ftyp` box. */
function kindFromBrands(brands: string[]): ImageKind {
  const major = brands[0] ?? ''
  if (AVIF_BRANDS.includes(major)) return 'avif'
  if (HEIC_BRANDS.includes(major) && !AMBIGUOUS_BRANDS.includes(major)) return 'heic'
  // Generic major brand: the compatible brands decide, and AVIF wins
  // because a HEIC never declares itself compatible with AVIF.
  const compatible = brands.slice(1)
  if (compatible.some((brand) => AVIF_BRANDS.includes(brand))) return 'avif'
  if (compatible.some((brand) => HEIC_BRANDS.includes(brand))) return 'heic'
  if (HEIC_BRANDS.includes(major)) return 'heic'
  return 'unknown'
}

/**
 * Recognises the format from the leading bytes, never from the name or the
 * declared type. Returns `'unknown'` when nothing matches.
 */
export function sniff(bytes: Uint8Array): ImageKind {
  if (bytes.length < 3) return 'unknown'
  if (at(bytes, 0) === 0xff && at(bytes, 1) === 0xd8 && at(bytes, 2) === 0xff) return 'jpeg'
  if (matches(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png'
  if (matches(bytes, 0, 'GIF87a') || matches(bytes, 0, 'GIF89a')) return 'gif'
  if (matches(bytes, 0, 'RIFF') && matches(bytes, 8, 'WEBP')) return 'webp'
  if (matches(bytes, 0, 'II') && at(bytes, 2) === 0x2a && at(bytes, 3) === 0x00) return 'tiff'
  if (matches(bytes, 0, 'MM') && at(bytes, 2) === 0x00 && at(bytes, 3) === 0x2a) return 'tiff'

  const brands = readFtypBrands(bytes)
  if (brands !== null) {
    const kind = kindFromBrands(brands)
    if (kind !== 'unknown') return kind
  }

  // Last, because only two bytes: everything else is checked before.
  if (matches(bytes, 0, 'BM')) return 'bmp'
  return 'unknown'
}

/**
 * The matching MIME type, or `null` for `'unknown'`.
 */
export function mimeOf(kind: ImageKind): string | null {
  switch (kind) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heic':
      return 'image/heic'
    case 'avif':
      return 'image/avif'
    case 'tiff':
      return 'image/tiff'
    case 'bmp':
      return 'image/bmp'
    case 'unknown':
      return null
  }
}
