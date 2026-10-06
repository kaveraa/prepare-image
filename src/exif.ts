/**
 * Metadata reading: orientation, presence of a GPS position, presence of
 * anything to remove.
 *
 * Survival rule: a truncated, malformed or hostile file must neither throw
 * nor loop forever. At the first doubt we stop and return what we have read
 * so far.
 */

import type { Orientation } from './types'
import type { ImageKind } from './detect'

export interface Metadata {
  /** 1 when there is nothing, or when the value read makes no sense. */
  orientation: Orientation
  /** Does the file carry a GPS position? */
  hasLocation: boolean
  /** Does the file carry metadata to remove (EXIF, XMP, IPTC, comments)? */
  hasMetadata: boolean
}

/** TIFF tag of the orientation. */
const TAG_ORIENTATION = 0x0112
/** TIFF tag of the pointer to the GPS IFD: its presence is enough to say "this file locates the photo". */
const TAG_GPS_IFD = 0x8825

/** Nothing to report. Builds a new object each time: the caller may keep it. */
function empty(): Metadata {
  return { orientation: 1, hasLocation: false, hasMetadata: false }
}

/** Reads one byte; returns 0 past the end. Every read goes through here. */
function at(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset]
  return value === undefined ? 0 : value
}

function u16(bytes: Uint8Array, offset: number, little: boolean): number {
  const a = at(bytes, offset)
  const b = at(bytes, offset + 1)
  return little ? ((b << 8) | a) >>> 0 : ((a << 8) | b) >>> 0
}

function u32(bytes: Uint8Array, offset: number, little: boolean): number {
  const a = at(bytes, offset)
  const b = at(bytes, offset + 1)
  const c = at(bytes, offset + 2)
  const d = at(bytes, offset + 3)
  return little ? ((d << 24) | (c << 16) | (b << 8) | a) >>> 0 : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
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

/** Maps anything that is not a valid orientation (0, 9, 42, ...) to 1. */
function toOrientation(value: number): Orientation {
  switch (value) {
    case 1:
      return 1
    case 2:
      return 2
    case 3:
      return 3
    case 4:
      return 4
    case 5:
      return 5
    case 6:
      return 6
    case 7:
      return 7
    case 8:
      return 8
    default:
      return 1
  }
}

interface TiffReading {
  orientation: Orientation
  hasLocation: boolean
}

function noTiff(): TiffReading {
  return { orientation: 1, hasLocation: false }
}

/**
 * Reads the IFD0 of a TIFF block. `start` points to the two byte-order bytes
 * (`II` or `MM`), `end` is the limit not to cross.
 */
function readTiff(bytes: Uint8Array, start: number, end: number): TiffReading {
  const limit = Math.min(end, bytes.length)
  if (start < 0 || start + 8 > limit) return noTiff()

  let little: boolean
  if (matches(bytes, start, 'II')) little = true
  else if (matches(bytes, start, 'MM')) little = false
  else return noTiff()

  if (u16(bytes, start + 2, little) !== 42) return noTiff()

  const ifdOffset = u32(bytes, start + 4, little)
  // The IFD0 always comes after the 8-byte header.
  if (ifdOffset < 8) return noTiff()
  const ifd = start + ifdOffset
  if (ifd + 2 > limit) return noTiff()

  const count = u16(bytes, ifd, little)
  let orientation: Orientation = 1
  let hasLocation = false
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    // Entry crossing the end: the file is truncated, we stop here.
    if (entry + 12 > limit) break
    const tag = u16(bytes, entry, little)
    if (tag === TAG_ORIENTATION) {
      // SHORT (3) or LONG (4): in both cases the value fits in the four
      // bytes of the entry, there is no pointer to follow.
      const type = u16(bytes, entry + 2, little)
      const raw = type === 4 ? u32(bytes, entry + 8, little) : u16(bytes, entry + 8, little)
      orientation = toOrientation(raw)
    } else if (tag === TAG_GPS_IFD) {
      if (u32(bytes, entry + 8, little) > 0) hasLocation = true
    }
  }
  return { orientation, hasLocation }
}

/** The EXIF block of a JPEG, a PNG or a WebP sometimes starts with `Exif\0\0`. */
function tiffStart(bytes: Uint8Array, offset: number): number {
  return matches(bytes, offset, 'Exif\0\0') ? offset + 6 : offset
}

function readJpeg(bytes: Uint8Array): Metadata {
  const length = bytes.length
  if (length < 4 || at(bytes, 0) !== 0xff || at(bytes, 1) !== 0xd8) return empty()

  let orientation: Orientation = 1
  let hasLocation = false
  let hasMetadata = false
  let offset = 2

  while (offset + 2 <= length) {
    if (at(bytes, offset) !== 0xff) break // Out of sync: we no longer know where we are.
    // Padding 0xFF bytes may come before the marker.
    let markerAt = offset
    while (markerAt < length && at(bytes, markerAt) === 0xff) markerAt += 1
    if (markerAt >= length) break
    const marker = at(bytes, markerAt)

    // Standalone markers, without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerAt + 1
      continue
    }
    // End of image, or start of the compressed data: nothing more to read.
    if (marker === 0xd9 || marker === 0xda) break

    if (markerAt + 3 > length) break
    const segmentLength = u16(bytes, markerAt + 1, false)
    // A length counts its own two bytes: below 2 it is wrong.
    if (segmentLength < 2) break
    const dataStart = markerAt + 3
    const dataEnd = markerAt + 1 + segmentLength
    // Length going past the file: truncated or lying, we stop.
    if (dataEnd > length) break

    // APP1 to APP15 and the comment: exactly what `stripMetadata` removes.
    // The APP0 JFIF stays, it carries the density, it is not metadata to drop.
    // APP2 is the ICC profile: it stays, so there is nothing to clean for it.
    if ((marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe) hasMetadata = true

    if (marker === 0xe1 && matches(bytes, dataStart, 'Exif\0\0')) {
      const reading = readTiff(bytes, dataStart + 6, dataEnd)
      if (reading.orientation !== 1) orientation = reading.orientation
      if (reading.hasLocation) hasLocation = true
    }

    offset = dataEnd
  }

  return { orientation, hasLocation, hasMetadata }
}

// The chunks that stripMetadata removes: reading and cleaning must see
// exactly the same thing, or we would announce a cleanup that does not happen.
const PNG_TEXT_CHUNKS = ['tEXt', 'iTXt', 'zTXt', 'tIME']

function readPng(bytes: Uint8Array): Metadata {
  const length = bytes.length
  if (!matches(bytes, 0, '\x89PNG\r\n\x1a\n')) return empty()

  let orientation: Orientation = 1
  let hasLocation = false
  let hasMetadata = false
  let offset = 8

  while (offset + 12 <= length) {
    const size = u32(bytes, offset, false)
    // Length that does not fit in what is left: we stop.
    if (size > length - offset - 12) break
    const type = fourcc(bytes, offset + 4)
    const dataStart = offset + 8

    if (type === 'eXIf') {
      hasMetadata = true
      const reading = readTiff(bytes, tiffStart(bytes, dataStart), dataStart + size)
      if (reading.orientation !== 1) orientation = reading.orientation
      if (reading.hasLocation) hasLocation = true
    } else if (PNG_TEXT_CHUNKS.includes(type)) {
      hasMetadata = true
    }

    if (type === 'IEND') break
    offset = dataStart + size + 4
  }

  return { orientation, hasLocation, hasMetadata }
}

function readWebp(bytes: Uint8Array): Metadata {
  const length = bytes.length
  if (!matches(bytes, 0, 'RIFF') || !matches(bytes, 8, 'WEBP')) return empty()

  let orientation: Orientation = 1
  let hasLocation = false
  let hasMetadata = false
  let offset = 12

  while (offset + 8 <= length) {
    const type = fourcc(bytes, offset)
    const size = u32(bytes, offset + 4, true)
    if (size > length - offset - 8) break
    const dataStart = offset + 8

    if (type === 'EXIF') {
      hasMetadata = true
      const reading = readTiff(bytes, tiffStart(bytes, dataStart), dataStart + size)
      if (reading.orientation !== 1) orientation = reading.orientation
      if (reading.hasLocation) hasLocation = true
    } else if (type === 'XMP ') {
      hasMetadata = true
    }

    // RIFF chunks are aligned on an even number of bytes.
    offset = dataStart + size + (size % 2)
  }

  return { orientation, hasLocation, hasMetadata }
}

/**
 * Reads what matters before processing: orientation, whether the file says
 * where the photo was taken, and whether anything needs removing. Never throws:
 * an unreadable file simply returns `{ orientation: 1, ... }`.
 */
export function readMetadata(bytes: Uint8Array, kind: ImageKind): Metadata {
  switch (kind) {
    case 'jpeg':
      return readJpeg(bytes)
    case 'png':
      return readPng(bytes)
    case 'webp':
      return readWebp(bytes)
    case 'heic':
    case 'avif':
      // We do not walk the whole ISO-BMFF container for so little: there the
      // orientation lives in `irot`/`imir`, per item, and these files come from
      // cameras that always put EXIF in them. They will be re-encoded anyway,
      // so `hasMetadata: true` without looking further is right in practice
      // and costs nothing wrong.
      return { orientation: 1, hasLocation: false, hasMetadata: true }
    case 'gif':
    case 'tiff':
    case 'bmp':
    case 'unknown':
      return empty()
  }
}
