/**
 * Petits constructeurs de fichiers, octet par octet. Plus sur qu'un binaire
 * commite, et cela documente les formats.
 */

export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

export function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

export function u16(value: number, little = false): Uint8Array {
  const high = (value >>> 8) & 0xff
  const low = value & 0xff
  return little ? bytes(low, high) : bytes(high, low)
}

export function u32(value: number, little = false): Uint8Array {
  const a = (value >>> 24) & 0xff
  const b = (value >>> 16) & 0xff
  const c = (value >>> 8) & 0xff
  const d = value & 0xff
  return little ? bytes(d, c, b, a) : bytes(a, b, c, d)
}

/** CRC32 des morceaux PNG, calcule bit a bit pour rester court. */
export function crc32(input: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// --- TIFF / EXIF ------------------------------------------------------------

export interface TiffOptions {
  /** `true` pour `II` (petit boutiste), `false` pour `MM`. */
  little?: boolean
  /** Omis : pas d'entree d'orientation du tout. */
  orientation?: number
  /** Ajoute le pointeur vers un IFD GPS. */
  gps?: boolean
}

function entry(tag: number, type: number, count: number, value: Uint8Array, little: boolean): Uint8Array {
  const field = new Uint8Array(4)
  field.set(value.subarray(0, 4), 0)
  return concat([u16(tag, little), u16(type, little), u32(count, little), field])
}

/** Un bloc TIFF complet : en-tete, IFD0, et un IFD GPS quand on en demande un. */
export function tiffBlock(options: TiffOptions = {}): Uint8Array {
  const little = options.little ?? false
  const count = (options.orientation === undefined ? 0 : 1) + (options.gps === true ? 1 : 0)
  // En-tete (8) + compte (2) + entrees (12 chacune) + offset de l'IFD suivant (4).
  const gpsOffset = 8 + 2 + count * 12 + 4

  const entries: Uint8Array[] = []
  if (options.orientation !== undefined) {
    entries.push(entry(0x0112, 3, 1, u16(options.orientation, little), little))
  }
  if (options.gps === true) {
    entries.push(entry(0x8825, 4, 1, u32(gpsOffset, little), little))
  }

  const header = concat([ascii(little ? 'II' : 'MM'), u16(42, little), u32(8, little)])
  const ifd0 = concat([u16(count, little), ...entries, u32(0, little)])
  if (options.gps !== true) return concat([header, ifd0])

  // Un IFD GPS minimal : GPSLatitudeRef, deux caracteres ASCII.
  const gpsIfd = concat([u16(1, little), entry(0x0001, 2, 2, ascii('N\0'), little), u32(0, little)])
  return concat([header, ifd0, gpsIfd])
}

/** Le contenu d'un segment APP1 : le prefixe `Exif\0\0` puis le bloc TIFF. */
export function exifPayload(options: TiffOptions = {}): Uint8Array {
  return concat([ascii('Exif\0\0'), tiffBlock(options)])
}

// --- JPEG -------------------------------------------------------------------

export function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  return concat([bytes(0xff, marker), u16(data.length + 2), data])
}

export const JFIF_PAYLOAD = concat([ascii('JFIF\0'), bytes(0x01, 0x02, 0x01), u16(72), u16(72), bytes(0x00, 0x00)])

/** Les donnees compressees factices que l'on retrouve intactes apres nettoyage. */
export const SCAN_DATA = bytes(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0x01, 0x02, 0x03)

export interface JpegOptions {
  /** L'APP0 JFIF, garde par le nettoyage. Present par defaut. */
  jfif?: boolean
  /** Le contenu d'un segment APP1, typiquement `exifPayload(...)`. */
  app1?: Uint8Array
  /** Un segment APP2 : le profil ICC, garde par le nettoyage. */
  app2?: Uint8Array
  /** Un commentaire COM. */
  comment?: string
  /** Un segment APP13 (IPTC en vrai vie). */
  app13?: Uint8Array
  scan?: Uint8Array
}

/** Un JPEG minimal mais complet : SOI, segments, SOS, donnees, EOI. */
export function jpeg(options: JpegOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [bytes(0xff, 0xd8)]
  if (options.jfif !== false) parts.push(jpegSegment(0xe0, JFIF_PAYLOAD))
  if (options.app1 !== undefined) parts.push(jpegSegment(0xe1, options.app1))
  if (options.app2 !== undefined) parts.push(jpegSegment(0xe2, options.app2))
  if (options.app13 !== undefined) parts.push(jpegSegment(0xed, options.app13))
  if (options.comment !== undefined) parts.push(jpegSegment(0xfe, ascii(options.comment)))
  // Table de quantification, en-tete d'image, table de Huffman : du remplissage
  // plausible, ce qui compte est qu'ils traversent le nettoyage intacts.
  parts.push(jpegSegment(0xdb, new Uint8Array(65)))
  parts.push(jpegSegment(0xc0, concat([bytes(0x08), u16(16), u16(16), bytes(0x01, 0x01, 0x11, 0x00)])))
  parts.push(jpegSegment(0xc4, new Uint8Array(29)))
  parts.push(jpegSegment(0xda, bytes(0x01, 0x01, 0x00, 0x00, 0x3f, 0x00)))
  parts.push(options.scan ?? SCAN_DATA)
  parts.push(bytes(0xff, 0xd9))
  return concat(parts)
}

// --- PNG --------------------------------------------------------------------

export const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([ascii(type), data])
  return concat([u32(data.length), body, u32(crc32(body))])
}

export const IHDR_DATA = concat([u32(16), u32(16), bytes(0x08, 0x02, 0x00, 0x00, 0x00)])
export const IDAT_DATA = bytes(0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01)
export const PHYS_DATA = concat([u32(2835), u32(2835), bytes(0x01)])

/** Un PNG a partir d'une liste de morceaux, signature comprise. */
export function png(chunks: Array<[string, Uint8Array]>): Uint8Array {
  return concat([PNG_SIGNATURE, ...chunks.map(([type, data]) => pngChunk(type, data))])
}

// --- WebP -------------------------------------------------------------------

export function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [ascii(type), u32(data.length, true), data]
  if (data.length % 2 === 1) parts.push(bytes(0x00))
  return concat(parts)
}

/** Le morceau VP8X, avec ses drapeaux EXIF (0x08) et XMP (0x04). */
export function vp8xData(flags: number): Uint8Array {
  return concat([bytes(flags, 0x00, 0x00, 0x00), bytes(0x0f, 0x00, 0x00, 0x0f, 0x00, 0x00)])
}

export function webp(chunks: Array<[string, Uint8Array]>): Uint8Array {
  const body = concat(chunks.map(([type, data]) => riffChunk(type, data)))
  return concat([ascii('RIFF'), u32(body.length + 4, true), ascii('WEBP'), body])
}

// --- ISO-BMFF (HEIC / AVIF) -------------------------------------------------

export function isoBox(type: string, data: Uint8Array): Uint8Array {
  return concat([u32(data.length + 8), ascii(type), data])
}

/** Une boite `ftyp` : marque principale, version mineure, marques compatibles. */
export function ftyp(major: string, compatible: string[] = []): Uint8Array {
  return isoBox('ftyp', concat([ascii(major), u32(0), ...compatible.map((brand) => ascii(brand))]))
}
