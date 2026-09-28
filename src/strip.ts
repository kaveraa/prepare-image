/**
 * Retrait des metadonnees sans toucher aux pixels : on recopie le fichier en
 * laissant tomber les morceaux qui portent de l'EXIF, du XMP, de l'IPTC ou des
 * commentaires, et on garde tout le reste octet pour octet.
 *
 * Regle : au moindre doute sur la structure, on rend `null`. Un fichier casse
 * serait pire qu'une metadonnee laissee.
 */

import type { ImageKind } from './detect'

/** Un intervalle a recopier tel quel, de `start` inclus a `end` exclu. */
type Range = [number, number]

function at(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset]
  return value === undefined ? 0 : value
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((at(bytes, offset) << 8) | at(bytes, offset + 1)) >>> 0
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((at(bytes, offset) << 24) | (at(bytes, offset + 1) << 16) | (at(bytes, offset + 2) << 8) | at(bytes, offset + 3)) >>> 0
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (at(bytes, offset) | (at(bytes, offset + 1) << 8) | (at(bytes, offset + 2) << 16) | (at(bytes, offset + 3) << 24)) >>> 0
}

function fourcc(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return ''
  return String.fromCharCode(at(bytes, offset), at(bytes, offset + 1), at(bytes, offset + 2), at(bytes, offset + 3))
}

function matches(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (at(bytes, offset + i) !== text.charCodeAt(i)) return false
  }
  return true
}

/** Colle bout a bout les intervalles gardes. */
function joinRanges(bytes: Uint8Array, ranges: Range[]): Uint8Array {
  let total = 0
  for (const range of ranges) total += range[1] - range[0]
  const out = new Uint8Array(total)
  let cursor = 0
  for (const range of ranges) {
    out.set(bytes.subarray(range[0], range[1]), cursor)
    cursor += range[1] - range[0]
  }
  return out
}

/**
 * JPEG : on recopie les segments en sautant APP1 a APP15 et le commentaire.
 * L'APP0 JFIF reste (il porte la densite), ainsi que tous les segments de
 * l'image (DQT, DHT, SOF, SOS). Apres SOS viennent les donnees compressees :
 * on recopie jusqu'a la fin sans plus chercher de marqueur.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  const length = bytes.length
  if (length < 4 || at(bytes, 0) !== 0xff || at(bytes, 1) !== 0xd8) return null

  const ranges: Range[] = [[0, 2]]
  let offset = 2
  let sawScan = false

  while (offset + 2 <= length) {
    if (at(bytes, offset) !== 0xff) return null
    let markerAt = offset
    while (markerAt < length && at(bytes, markerAt) === 0xff) markerAt += 1
    if (markerAt >= length) return null
    const marker = at(bytes, markerAt)

    // Marqueurs isoles, sans longueur : recopies tels quels.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      ranges.push([offset, markerAt + 1])
      offset = markerAt + 1
      continue
    }
    // Fin d'image : on recopie ce qui reste et on s'arrete.
    if (marker === 0xd9) {
      ranges.push([offset, length])
      offset = length
      break
    }

    if (markerAt + 3 > length) return null
    const segmentLength = u16be(bytes, markerAt + 1)
    if (segmentLength < 2) return null
    const segmentEnd = markerAt + 1 + segmentLength
    if (segmentEnd > length) return null

    // Debut du balayage : l'en-tete SOS puis tout le reste du fichier, tel quel.
    if (marker === 0xda) {
      ranges.push([offset, length])
      sawScan = true
      offset = length
      break
    }

    // APP2 porte le profil ICC : ce n'est pas une donnee personnelle, c'est ce
    // qui decide des couleurs. Le retirer ferait derailler les teintes d'une
    // photo en gamut large, pour rien. On le garde, comme l'APP0 JFIF.
    const isAppToDrop = marker >= 0xe1 && marker <= 0xef && marker !== 0xe2
    const isComment = marker === 0xfe
    if (!isAppToDrop && !isComment) ranges.push([offset, segmentEnd])
    offset = segmentEnd
  }

  // Sans donnees compressees, ce n'est pas une image lisible : on ne s'en mele pas.
  if (!sawScan) return null
  return joinRanges(bytes, ranges)
}

/** Les morceaux PNG qui portent des metadonnees et rien d'autre. */
const PNG_DROP = ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']

/**
 * PNG : on recopie les morceaux en sautant ceux qui ne portent que des
 * metadonnees. Tout le reste passe, morceaux critiques comme morceaux de rendu
 * (gAMA, cHRM, sRGB, iCCP, pHYs, tRNS, bKGD, sBIT) : leurs CRC sont deja bons,
 * on les recopie sans y toucher.
 */
function stripPng(bytes: Uint8Array): Uint8Array | null {
  const length = bytes.length
  if (!matches(bytes, 0, '\x89PNG\r\n\x1a\n')) return null

  const ranges: Range[] = [[0, 8]]
  let offset = 8
  let sawEnd = false

  while (offset + 12 <= length) {
    const size = u32be(bytes, offset)
    // Longueur qui ne tient pas dans ce qui reste : structure douteuse.
    if (size > length - offset - 12) return null
    const type = fourcc(bytes, offset + 4)
    const end = offset + 12 + size

    if (!PNG_DROP.includes(type)) ranges.push([offset, end])
    offset = end
    if (type === 'IEND') {
      sawEnd = true
      break
    }
  }

  if (!sawEnd) return null
  return joinRanges(bytes, ranges)
}

/** Drapeaux du morceau VP8X : bit 3 pour l'EXIF, bit 2 pour le XMP. */
const VP8X_EXIF_FLAG = 0x08
const VP8X_XMP_FLAG = 0x04

/**
 * WebP : conteneur RIFF, on retire les morceaux `EXIF` et `XMP `, on corrige la
 * taille annoncee par l'en-tete RIFF, et on eteint les drapeaux correspondants
 * dans VP8X (sinon un lecteur strict chercherait des morceaux disparus).
 */
function stripWebp(bytes: Uint8Array): Uint8Array | null {
  const length = bytes.length
  if (length < 12 || !matches(bytes, 0, 'RIFF') || !matches(bytes, 8, 'WEBP')) return null

  const ranges: Range[] = []
  let vp8xFlagsAt = -1
  let offset = 12
  let dropped = false

  while (offset + 8 <= length) {
    const type = fourcc(bytes, offset)
    const size = u32le(bytes, offset + 4)
    if (size > length - offset - 8) return null
    // Les morceaux RIFF sont alignes sur un nombre pair d'octets ; le dernier
    // octet de bourrage manque parfois en fin de fichier, on borne donc.
    const end = Math.min(offset + 8 + size + (size % 2), length)

    if (type === 'EXIF' || type === 'XMP ') {
      dropped = true
    } else {
      if (type === 'VP8X' && size >= 4) vp8xFlagsAt = offset + 8
      ranges.push([offset, end])
    }
    offset = end
  }

  if (ranges.length === 0) return null
  if (!dropped) return bytes.slice()

  let payload = 0
  for (const range of ranges) payload += range[1] - range[0]
  const out = new Uint8Array(12 + payload)
  out.set(bytes.subarray(0, 12), 0)
  out.set(joinRanges(bytes, ranges), 12)

  // Taille RIFF : tout le fichier moins les huit octets de l'en-tete.
  const riffSize = out.length - 8
  out[4] = riffSize & 0xff
  out[5] = (riffSize >>> 8) & 0xff
  out[6] = (riffSize >>> 16) & 0xff
  out[7] = (riffSize >>> 24) & 0xff

  if (vp8xFlagsAt >= 0) {
    // Le VP8X garde, s'il existe, est le premier morceau recopie.
    const first = ranges[0]
    if (first !== undefined && first[0] === vp8xFlagsAt - 8) {
      const flagsAt = 12 + 8
      out[flagsAt] = at(out, flagsAt) & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG)
    }
  }

  return out
}

/**
 * Retire les metadonnees sans toucher aux pixels. Rend `null` quand le format
 * ne se traite pas ainsi : l'appelant reencodera.
 *
 * Removes metadata without touching the pixels. Returns `null` when the format
 * cannot be handled this way: the caller will re-encode instead.
 */
export function stripMetadata(bytes: Uint8Array, kind: ImageKind): Uint8Array | null {
  switch (kind) {
    case 'jpeg':
      return stripJpeg(bytes)
    case 'png':
      return stripPng(bytes)
    case 'webp':
      return stripWebp(bytes)
    case 'gif':
    case 'heic':
    case 'avif':
    case 'tiff':
    case 'bmp':
    case 'unknown':
      // GIF et BMP ne portent presque jamais d'EXIF ; HEIC, AVIF et TIFF
      // demanderaient de reecrire le conteneur, ce qui risquerait l'image.
      return null
  }
}
