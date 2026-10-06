/**
 * Metadata removal without touching the pixels: we copy the file and drop
 * the chunks that carry EXIF, XMP, IPTC or comments, and we keep everything
 * else byte for byte.
 *
 * Rule: at the first doubt about the structure, we return `null`. A broken
 * file would be worse than a metadata left behind.
 */

import type { ImageKind } from './detect'

/** A range to copy as is, from `start` inclusive to `end` exclusive. */
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

/** Joins the kept ranges end to end. */
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
 * JPEG: we copy the segments and skip APP1 to APP15 and the comment.
 * The APP0 JFIF stays (it carries the density), as well as all the image
 * segments (DQT, DHT, SOF, SOS). After SOS comes the compressed data:
 * we copy up to the end without looking for any more markers.
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

    // Standalone markers, without a length: copied as is.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      ranges.push([offset, markerAt + 1])
      offset = markerAt + 1
      continue
    }
    // End of image: we copy what is left and stop.
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

    // Start of scan: the SOS header then all the rest of the file, as is.
    if (marker === 0xda) {
      ranges.push([offset, length])
      sawScan = true
      offset = length
      break
    }

    // APP2 carries the ICC profile: it is not personal data, it is what
    // decides the colours. Removing it would break the tints of a wide-gamut
    // photo, for nothing. We keep it, like the APP0 JFIF.
    const isAppToDrop = marker >= 0xe1 && marker <= 0xef && marker !== 0xe2
    const isComment = marker === 0xfe
    if (!isAppToDrop && !isComment) ranges.push([offset, segmentEnd])
    offset = segmentEnd
  }

  // Without compressed data, this is not a readable image: we leave it alone.
  if (!sawScan) return null
  return joinRanges(bytes, ranges)
}

/** The PNG chunks that carry metadata and nothing else. */
const PNG_DROP = ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']

/**
 * PNG: we copy the chunks and skip those that carry only metadata.
 * Everything else goes through, critical chunks as well as rendering chunks
 * (gAMA, cHRM, sRGB, iCCP, pHYs, tRNS, bKGD, sBIT): their CRCs are already
 * right, we copy them without touching them.
 */
function stripPng(bytes: Uint8Array): Uint8Array | null {
  const length = bytes.length
  if (!matches(bytes, 0, '\x89PNG\r\n\x1a\n')) return null

  const ranges: Range[] = [[0, 8]]
  let offset = 8
  let sawEnd = false

  while (offset + 12 <= length) {
    const size = u32be(bytes, offset)
    // Length that does not fit in what is left: doubtful structure.
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

/** Flags of the VP8X chunk: bit 3 for EXIF, bit 2 for XMP. */
const VP8X_EXIF_FLAG = 0x08
const VP8X_XMP_FLAG = 0x04

/**
 * WebP: RIFF container, we remove the `EXIF` and `XMP ` chunks, fix the size
 * declared by the RIFF header, and clear the matching flags in VP8X
 * (otherwise a strict reader would look for chunks that are gone).
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
    // RIFF chunks are aligned on an even number of bytes; the last padding
    // byte is sometimes missing at the end of the file, so we clamp.
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

  // RIFF size: the whole file minus the eight bytes of the header.
  const riffSize = out.length - 8
  out[4] = riffSize & 0xff
  out[5] = (riffSize >>> 8) & 0xff
  out[6] = (riffSize >>> 16) & 0xff
  out[7] = (riffSize >>> 24) & 0xff

  if (vp8xFlagsAt >= 0) {
    // The kept VP8X, if any, is the first chunk copied.
    const first = ranges[0]
    if (first !== undefined && first[0] === vp8xFlagsAt - 8) {
      const flagsAt = 12 + 8
      out[flagsAt] = at(out, flagsAt) & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG)
    }
  }

  return out
}

/**
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
      // GIF and BMP almost never carry EXIF; HEIC, AVIF and TIFF would need
      // the container rewritten, which would put the image at risk.
      return null
  }
}
