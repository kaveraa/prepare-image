import { describe, expect, it } from 'vitest'
import { readMetadata } from '../../src/exif'
import { stripMetadata } from '../../src/strip'
import type { ImageKind } from '../../src/detect'
import {
  ascii,
  bytes,
  concat,
  exifPayload,
  jpeg,
  png,
  tiffBlock,
  u32,
  vp8xData,
  webp,
  IDAT_DATA,
  IHDR_DATA,
  PHYS_DATA,
  SCAN_DATA,
} from './fixtures'

/** Position of the first occurrence of a two-byte marker, or -1. */
function indexOfMarker(haystack: Uint8Array, first: number, second: number): number {
  for (let i = 0; i + 1 < haystack.length; i += 1) {
    if (haystack[i] === first && haystack[i + 1] === second) return i
  }
  return -1
}

describe('stripMetadata on JPEG', () => {
  const dirty = jpeg({ app1: exifPayload({ orientation: 6, gps: true }), comment: 'taken at home' })

  it('drops the EXIF segment and the comment', () => {
    const clean = stripMetadata(dirty, 'jpeg')

    expect(clean).not.toBeNull()
    if (clean === null) return
    expect(indexOfMarker(clean, 0xff, 0xe1)).toBe(-1)
    expect(indexOfMarker(clean, 0xff, 0xfe)).toBe(-1)
    expect(clean.length).toBeLessThan(dirty.length)
  })

  it('keeps the JFIF header, which carries the density', () => {
    const clean = stripMetadata(dirty, 'jpeg')

    expect(clean).not.toBeNull()
    if (clean === null) return
    expect(indexOfMarker(clean, 0xff, 0xe0)).toBe(2)
  })

  it('leaves a readable image: SOI, SOF, SOS and EOI are all still there', () => {
    const clean = stripMetadata(dirty, 'jpeg')

    expect(clean).not.toBeNull()
    if (clean === null) return
    expect(indexOfMarker(clean, 0xff, 0xd8)).toBe(0)
    expect(indexOfMarker(clean, 0xff, 0xdb)).toBeGreaterThan(0)
    expect(indexOfMarker(clean, 0xff, 0xc0)).toBeGreaterThan(0)
    expect(indexOfMarker(clean, 0xff, 0xc4)).toBeGreaterThan(0)
    expect(indexOfMarker(clean, 0xff, 0xda)).toBeGreaterThan(0)
    expect(clean.subarray(clean.length - 2)).toEqual(bytes(0xff, 0xd9))
  })

  it('leaves the compressed data untouched, byte for byte', () => {
    const clean = stripMetadata(dirty, 'jpeg')

    expect(clean).not.toBeNull()
    if (clean === null) return
    const tail = concat([SCAN_DATA, bytes(0xff, 0xd9)])
    expect(clean.subarray(clean.length - tail.length)).toEqual(tail)
  })

  it('gives a file that no longer says anything about the photo', () => {
    const before = readMetadata(dirty, 'jpeg')
    const clean = stripMetadata(dirty, 'jpeg')

    expect(before).toEqual({ orientation: 6, hasLocation: true, hasMetadata: true })
    expect(clean).not.toBeNull()
    if (clean === null) return
    expect(readMetadata(clean, 'jpeg')).toEqual({ orientation: 1, hasLocation: false, hasMetadata: false })
  })

  it('leaves an already clean JPEG exactly as it was', () => {
    const plain = jpeg()

    expect(stripMetadata(plain, 'jpeg')).toEqual(plain)
  })

  it('returns null rather than risk a broken file', () => {
    expect(stripMetadata(new Uint8Array(0), 'jpeg')).toBeNull()
    expect(stripMetadata(ascii('not a jpeg'), 'jpeg')).toBeNull()
    // Lying segment length.
    expect(stripMetadata(concat([bytes(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff), ascii('Exif')]), 'jpeg')).toBeNull()
    // No compressed data: this is not an image.
    expect(stripMetadata(concat([bytes(0xff, 0xd8), bytes(0xff, 0xd9)]), 'jpeg')).toBeNull()
    // Cut off in the middle.
    const cut = jpeg({ app1: exifPayload({ orientation: 3 }) }).subarray(0, 20)
    expect(stripMetadata(cut, 'jpeg')).toBeNull()
  })
})

describe('stripMetadata on PNG', () => {
  const idat: [string, Uint8Array] = ['IDAT', IDAT_DATA]
  const iend: [string, Uint8Array] = ['IEND', new Uint8Array(0)]
  const dirty = png([
    ['IHDR', IHDR_DATA],
    ['eXIf', tiffBlock({ orientation: 6, gps: true })],
    ['tEXt', ascii('Comment\0taken at home')],
    ['pHYs', PHYS_DATA],
    ['tIME', bytes(0x07, 0xe9, 0x01, 0x02, 0x03, 0x04, 0x05)],
    idat,
    iend,
  ])

  it('drops eXIf, tEXt and tIME, and keeps everything else byte for byte', () => {
    const clean = stripMetadata(dirty, 'png')
    const expected = png([['IHDR', IHDR_DATA], ['pHYs', PHYS_DATA], idat, iend])

    expect(clean).toEqual(expected)
  })

  it('keeps the chunks that matter to the rendering', () => {
    const rich = png([
      ['IHDR', IHDR_DATA],
      ['gAMA', u32(45455)],
      ['sRGB', bytes(0x00)],
      ['sBIT', bytes(0x08, 0x08, 0x08)],
      ['bKGD', bytes(0x00, 0xff, 0x00, 0xff, 0x00, 0xff)],
      ['tEXt', ascii('Software\0somewhere')],
      idat,
      iend,
    ])
    const clean = stripMetadata(rich, 'png')

    expect(clean).not.toBeNull()
    if (clean === null) return
    for (const type of ['IHDR', 'gAMA', 'sRGB', 'sBIT', 'bKGD', 'IDAT', 'IEND']) {
      expect(indexOfText(clean, type), type).toBeGreaterThan(0)
    }
    expect(indexOfText(clean, 'tEXt')).toBe(-1)
  })

  it('leaves an already clean PNG exactly as it was', () => {
    const plain = png([['IHDR', IHDR_DATA], idat, iend])

    expect(stripMetadata(plain, 'png')).toEqual(plain)
  })

  it('says nothing is left to remove afterwards', () => {
    const clean = stripMetadata(dirty, 'png')

    expect(clean).not.toBeNull()
    if (clean === null) return
    expect(readMetadata(clean, 'png')).toEqual({ orientation: 1, hasLocation: false, hasMetadata: false })
  })

  it('returns null on a broken PNG', () => {
    expect(stripMetadata(new Uint8Array(0), 'png')).toBeNull()
    expect(stripMetadata(dirty.subarray(0, 30), 'png')).toBeNull()
    // Without IEND we do not know where the file ends.
    expect(stripMetadata(png([['IHDR', IHDR_DATA], idat]), 'png')).toBeNull()
  })
})

/** Position of the first occurrence of a short ASCII text, or -1. */
function indexOfText(haystack: Uint8Array, text: string): number {
  const needle = ascii(text)
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let same = true
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        same = false
        break
      }
    }
    if (same) return i
  }
  return -1
}

describe('stripMetadata on WebP', () => {
  const vp8: [string, Uint8Array] = ['VP8 ', bytes(0x00, 0x01, 0x02, 0x03)]

  it('drops the EXIF and XMP chunks and fixes the RIFF size', () => {
    const dirty = webp([
      ['VP8X', vp8xData(0x0c)],
      vp8,
      ['EXIF', tiffBlock({ orientation: 6, gps: true })],
      ['XMP ', ascii('<x:xmpmeta/>')],
    ])
    const clean = stripMetadata(dirty, 'webp')

    // The EXIF and XMP flags of the VP8X are cleared, the rest is identical.
    expect(clean).toEqual(webp([['VP8X', vp8xData(0x00)], vp8]))
  })

  it('keeps the other flags of the VP8X chunk', () => {
    const dirty = webp([['VP8X', vp8xData(0x1c)], vp8, ['EXIF', tiffBlock({ orientation: 1 })]])
    const clean = stripMetadata(dirty, 'webp')

    // 0x10 is the alpha flag: it survives.
    expect(clean).toEqual(webp([['VP8X', vp8xData(0x10)], vp8]))
  })

  it('leaves an already clean WebP exactly as it was', () => {
    const plain = webp([vp8])

    expect(stripMetadata(plain, 'webp')).toEqual(plain)
  })

  it('says nothing is left to remove afterwards', () => {
    const dirty = webp([vp8, ['EXIF', tiffBlock({ orientation: 3, gps: true })]])
    const clean = stripMetadata(dirty, 'webp')

    expect(clean).not.toBeNull()
    if (clean === null) return
    expect(readMetadata(clean, 'webp')).toEqual({ orientation: 1, hasLocation: false, hasMetadata: false })
  })

  it('returns null on a broken WebP', () => {
    expect(stripMetadata(new Uint8Array(0), 'webp')).toBeNull()
    expect(stripMetadata(ascii('RIFF....NOPE'), 'webp')).toBeNull()
    const lying = concat([ascii('RIFF'), u32(64, true), ascii('WEBP'), ascii('EXIF'), u32(0xfffffff0, true)])
    expect(stripMetadata(lying, 'webp')).toBeNull()
  })
})

describe('stripMetadata on the kinds it will not touch', () => {
  it('returns null, so the caller re-encodes instead', () => {
    const kinds: ImageKind[] = ['gif', 'heic', 'avif', 'tiff', 'bmp', 'unknown']

    for (const kind of kinds) {
      expect(stripMetadata(new Uint8Array(64), kind), kind).toBeNull()
    }
  })
})
