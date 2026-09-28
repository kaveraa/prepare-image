import { describe, expect, it } from 'vitest'
import { readMetadata } from '../../src/exif'
import {
  ascii,
  bytes,
  concat,
  exifPayload,
  jpeg,
  jpegSegment,
  png,
  tiffBlock,
  u16,
  u32,
  webp,
  IDAT_DATA,
  IHDR_DATA,
  JFIF_PAYLOAD,
  PHYS_DATA,
} from './fixtures'

const BYTE_ORDERS: Array<[string, boolean]> = [
  ['little endian (II)', true],
  ['big endian (MM)', false],
]

describe('readMetadata on JPEG', () => {
  for (const [label, little] of BYTE_ORDERS) {
    it('reads the orientation in ' + label, () => {
      for (const orientation of [1, 3, 6, 8]) {
        const file = jpeg({ app1: exifPayload({ little, orientation }) })
        expect(readMetadata(file, 'jpeg').orientation).toBe(orientation)
      }
    })
  }

  it('falls back to 1 for a nonsense orientation', () => {
    for (const value of [0, 9, 42, 0xffff]) {
      const file = jpeg({ app1: exifPayload({ orientation: value }) })
      expect(readMetadata(file, 'jpeg').orientation).toBe(1)
    }
  })

  it('reports 1 when there is no EXIF at all', () => {
    const plain = readMetadata(jpeg(), 'jpeg')

    expect(plain.orientation).toBe(1)
    expect(plain.hasLocation).toBe(false)
    expect(plain.hasMetadata).toBe(false)
  })

  it('spots a GPS position, and its absence', () => {
    for (const [label, little] of BYTE_ORDERS) {
      const located = jpeg({ app1: exifPayload({ little, orientation: 6, gps: true }) })
      const anywhere = jpeg({ app1: exifPayload({ little, orientation: 6 }) })

      expect(readMetadata(located, 'jpeg').hasLocation, label).toBe(true)
      expect(readMetadata(anywhere, 'jpeg').hasLocation, label).toBe(false)
    }
  })

  it('counts EXIF, comments and IPTC as metadata, but not the JFIF header', () => {
    expect(readMetadata(jpeg(), 'jpeg').hasMetadata).toBe(false)
    expect(readMetadata(jpeg({ app1: exifPayload({ orientation: 1 }) }), 'jpeg').hasMetadata).toBe(true)
    expect(readMetadata(jpeg({ comment: 'taken at home' }), 'jpeg').hasMetadata).toBe(true)
    expect(readMetadata(jpeg({ app13: ascii('Photoshop 3.0\0') }), 'jpeg').hasMetadata).toBe(true)
  })

  it('reads across padding bytes between segments', () => {
    const padded = concat([
      bytes(0xff, 0xd8),
      bytes(0xff, 0xff, 0xff),
      jpegSegment(0xe0, JFIF_PAYLOAD),
      jpegSegment(0xe1, exifPayload({ orientation: 8 })),
      bytes(0xff, 0xd9),
    ])

    expect(readMetadata(padded, 'jpeg').orientation).toBe(8)
  })

  it('survives a file truncated in the middle of the EXIF block', () => {
    const file = jpeg({ app1: exifPayload({ orientation: 6, gps: true }) })

    // Toutes les troncatures possibles : aucune exception, aucune boucle.
    for (let length = 0; length <= file.length; length += 1) {
      const cut = file.subarray(0, length)
      expect(() => readMetadata(cut, 'jpeg')).not.toThrow()
      const read = readMetadata(cut, 'jpeg')
      expect([1, 6]).toContain(read.orientation)
    }
  })

  it('survives a segment length that lies', () => {
    const tooLong = concat([bytes(0xff, 0xd8), bytes(0xff, 0xe1), u16(0xffff), ascii('Exif\0\0'), bytes(0xff, 0xd9)])
    const tooShort = concat([bytes(0xff, 0xd8), bytes(0xff, 0xe1), u16(0), ascii('Exif\0\0'), bytes(0xff, 0xd9)])
    const zeroLength = concat([bytes(0xff, 0xd8), bytes(0xff, 0xe1), u16(1), bytes(0xff, 0xd9)])

    for (const file of [tooLong, tooShort, zeroLength]) {
      expect(() => readMetadata(file, 'jpeg')).not.toThrow()
      expect(readMetadata(file, 'jpeg').orientation).toBe(1)
    }
  })

  it('survives an EXIF block pointing outside itself', () => {
    const tiff = concat([ascii('MM'), u16(42), u32(0xfffffff0)])
    const file = jpeg({ app1: concat([ascii('Exif\0\0'), tiff]) })
    const read = readMetadata(file, 'jpeg')

    expect(read.orientation).toBe(1)
    expect(read.hasLocation).toBe(false)
    expect(read.hasMetadata).toBe(true)
  })

  it('survives an EXIF block whose entry count is far too big', () => {
    const tiff = concat([ascii('II'), u16(42, true), u32(8, true), u16(0xffff, true)])
    const file = jpeg({ app1: concat([ascii('Exif\0\0'), tiff]) })

    expect(() => readMetadata(file, 'jpeg')).not.toThrow()
    expect(readMetadata(file, 'jpeg').orientation).toBe(1)
  })

  it('survives bytes that are not a JPEG at all', () => {
    expect(readMetadata(new Uint8Array(0), 'jpeg')).toEqual({ orientation: 1, hasLocation: false, hasMetadata: false })
    expect(readMetadata(ascii('nope'), 'jpeg').hasMetadata).toBe(false)
  })
})

describe('readMetadata on PNG', () => {
  const idat: [string, Uint8Array] = ['IDAT', IDAT_DATA]
  const iend: [string, Uint8Array] = ['IEND', new Uint8Array(0)]

  it('reads the orientation out of an eXIf chunk, in both byte orders', () => {
    for (const [label, little] of BYTE_ORDERS) {
      for (const orientation of [1, 3, 6, 8]) {
        const file = png([['IHDR', IHDR_DATA], ['eXIf', tiffBlock({ little, orientation })], idat, iend])
        expect(readMetadata(file, 'png').orientation, label).toBe(orientation)
      }
    }
  })

  it('spots a GPS position in an eXIf chunk', () => {
    const located = png([['IHDR', IHDR_DATA], ['eXIf', tiffBlock({ orientation: 1, gps: true })], iend])
    const anywhere = png([['IHDR', IHDR_DATA], ['eXIf', tiffBlock({ orientation: 1 })], iend])

    expect(readMetadata(located, 'png').hasLocation).toBe(true)
    expect(readMetadata(anywhere, 'png').hasLocation).toBe(false)
  })

  it('counts text chunks as metadata', () => {
    for (const type of ['tEXt', 'iTXt', 'zTXt']) {
      const file = png([['IHDR', IHDR_DATA], [type, ascii('Comment\0hello')], idat, iend])
      expect(readMetadata(file, 'png').hasMetadata).toBe(true)
    }
  })

  it('reports nothing for a plain PNG', () => {
    const file = png([['IHDR', IHDR_DATA], ['pHYs', PHYS_DATA], idat, iend])

    expect(readMetadata(file, 'png')).toEqual({ orientation: 1, hasLocation: false, hasMetadata: false })
  })

  it('survives a truncated PNG and a lying chunk length', () => {
    const file = png([['IHDR', IHDR_DATA], ['eXIf', tiffBlock({ orientation: 6 })], idat, iend])
    for (let length = 0; length <= file.length; length += 1) {
      expect(() => readMetadata(file.subarray(0, length), 'png')).not.toThrow()
    }

    const lying = concat([file.subarray(0, 8), u32(0xfffffff0), ascii('tEXt'), new Uint8Array(8)])
    expect(() => readMetadata(lying, 'png')).not.toThrow()
    expect(readMetadata(lying, 'png').hasMetadata).toBe(false)
  })
})

describe('readMetadata on WebP', () => {
  const vp8: [string, Uint8Array] = ['VP8 ', bytes(0x00, 0x01, 0x02, 0x03)]

  it('reads an EXIF chunk, with or without the Exif prefix', () => {
    const raw = webp([vp8, ['EXIF', tiffBlock({ orientation: 6, gps: true })]])
    const prefixed = webp([vp8, ['EXIF', concat([ascii('Exif\0\0'), tiffBlock({ orientation: 6, gps: true })])]])

    for (const file of [raw, prefixed]) {
      const read = readMetadata(file, 'webp')
      expect(read.orientation).toBe(6)
      expect(read.hasLocation).toBe(true)
      expect(read.hasMetadata).toBe(true)
    }
  })

  it('counts an XMP chunk as metadata', () => {
    const file = webp([vp8, ['XMP ', ascii('<x:xmpmeta/>')]])
    const read = readMetadata(file, 'webp')

    expect(read.hasMetadata).toBe(true)
    expect(read.hasLocation).toBe(false)
  })

  it('reports nothing for a plain WebP', () => {
    expect(readMetadata(webp([vp8]), 'webp')).toEqual({ orientation: 1, hasLocation: false, hasMetadata: false })
  })

  it('survives a truncated WebP', () => {
    const file = webp([vp8, ['EXIF', tiffBlock({ orientation: 3 })]])
    for (let length = 0; length <= file.length; length += 1) {
      expect(() => readMetadata(file.subarray(0, length), 'webp')).not.toThrow()
    }
  })
})

describe('readMetadata on the other kinds', () => {
  it('assumes HEIC and AVIF carry metadata, and no readable orientation', () => {
    for (const kind of ['heic', 'avif'] as const) {
      expect(readMetadata(new Uint8Array(32), kind)).toEqual({
        orientation: 1,
        hasLocation: false,
        hasMetadata: true,
      })
    }
  })

  it('reports nothing for the kinds it does not read', () => {
    for (const kind of ['gif', 'tiff', 'bmp', 'unknown'] as const) {
      expect(readMetadata(new Uint8Array(32), kind)).toEqual({
        orientation: 1,
        hasLocation: false,
        hasMetadata: false,
      })
    }
  })
})
