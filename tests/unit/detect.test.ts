import { describe, expect, it } from 'vitest'
import { mimeOf, sniff, type ImageKind } from '../../src/detect'
import { ascii, bytes, concat, ftyp, isoBox, jpeg, png, tiffBlock, u32, webp, IDAT_DATA, IHDR_DATA } from './fixtures'

describe('sniff', () => {
  it('recognises a JPEG', () => {
    expect(sniff(jpeg())).toBe('jpeg')
  })

  it('recognises a PNG', () => {
    expect(
      sniff(
        png([
          ['IHDR', IHDR_DATA],
          ['IDAT', IDAT_DATA],
          ['IEND', new Uint8Array(0)],
        ]),
      ),
    ).toBe('png')
  })

  it('recognises a WebP', () => {
    expect(sniff(webp([['VP8 ', bytes(0x00, 0x01, 0x02, 0x03)]]))).toBe('webp')
  })

  it('recognises a GIF, both versions', () => {
    expect(sniff(concat([ascii('GIF87a'), bytes(0x10, 0x00, 0x10, 0x00)]))).toBe('gif')
    expect(sniff(concat([ascii('GIF89a'), bytes(0x10, 0x00, 0x10, 0x00)]))).toBe('gif')
  })

  it('recognises a TIFF in both byte orders', () => {
    expect(sniff(tiffBlock({ little: true, orientation: 1 }))).toBe('tiff')
    expect(sniff(tiffBlock({ little: false, orientation: 1 }))).toBe('tiff')
  })

  it('recognises a BMP', () => {
    expect(sniff(concat([ascii('BM'), u32(70, true), new Uint8Array(20)]))).toBe('bmp')
  })

  it('recognises every HEIC brand', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(sniff(concat([ftyp(brand), isoBox('mdat', new Uint8Array(8))]))).toBe('heic')
    }
  })

  it('recognises every AVIF brand', () => {
    for (const brand of ['avif', 'avis']) {
      expect(sniff(concat([ftyp(brand, ['mif1', 'miaf']), isoBox('mdat', new Uint8Array(8))]))).toBe('avif')
    }
  })

  it('prefers AVIF when the major brand is the generic mif1', () => {
    expect(sniff(ftyp('mif1', ['avif', 'miaf']))).toBe('avif')
    expect(sniff(ftyp('mif1', ['heic']))).toBe('heic')
  })

  it('finds the ftyp box when it is not the first box', () => {
    const file = concat([isoBox('free', new Uint8Array(12)), ftyp('heic', ['mif1']), isoBox('mdat', new Uint8Array(4))])

    // La boite ftyp est bien ailleurs qu'a l'offset 4.
    expect(file.subarray(4, 8)).not.toEqual(ascii('ftyp'))
    expect(sniff(file)).toBe('heic')
  })

  it('follows a 64 bit box size before the ftyp box', () => {
    const payload = new Uint8Array(8)
    const large = concat([u32(1), ascii('free'), u32(0), u32(16 + payload.length), payload])
    expect(sniff(concat([large, ftyp('avif')]))).toBe('avif')
  })

  it('reads an ftyp box whose size says "until the end of the file"', () => {
    const openEnded = concat([u32(0), ascii('ftyp'), ascii('heic'), u32(0), ascii('mif1')])
    expect(sniff(openEnded)).toBe('heic')
  })

  it('recognises a HEIC from the first 64 bytes only', () => {
    // `looksLikeHeic()` ne lit que le debut du fichier pour ne charger un
    // decodeur que lorsqu'il sert : sniff doit s'en contenter.
    const file = concat([ftyp('heic', ['mif1', 'miaf']), isoBox('mdat', new Uint8Array(4096))])

    expect(sniff(file.subarray(0, 64))).toBe('heic')
  })

  it('returns unknown for an empty or tiny file', () => {
    expect(sniff(new Uint8Array(0))).toBe('unknown')
    expect(sniff(bytes(0xff, 0xd8))).toBe('unknown')
    expect(sniff(bytes(0x89))).toBe('unknown')
  })

  it('returns unknown rather than looping on an absurd box size', () => {
    expect(sniff(concat([u32(3), ascii('free'), ascii('ftyp')]))).toBe('unknown')
    expect(sniff(concat([u32(0xffffffff), ascii('free'), ftyp('heic')]))).toBe('unknown')
  })

  it('returns unknown for an ISO-BMFF file with an unknown brand', () => {
    expect(sniff(ftyp('qt  ', ['isom']))).toBe('unknown')
  })

  it('returns unknown for plain text', () => {
    expect(sniff(ascii('this is not an image at all'))).toBe('unknown')
  })

  it('reads the bytes, not the extension: a renamed file keeps its real kind', () => {
    // Un PNG renomme en .jpg garde ses octets d'origine ; rien dans sniff ne
    // regarde le nom, et c'est justement le point.
    const renamed = png([
      ['IHDR', IHDR_DATA],
      ['IEND', new Uint8Array(0)],
    ])
    expect(sniff(renamed)).toBe('png')
  })
})

describe('mimeOf', () => {
  it('gives the MIME type of every known kind', () => {
    const pairs: Array<[ImageKind, string]> = [
      ['jpeg', 'image/jpeg'],
      ['png', 'image/png'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
      ['heic', 'image/heic'],
      ['avif', 'image/avif'],
      ['tiff', 'image/tiff'],
      ['bmp', 'image/bmp'],
    ]
    for (const [kind, mime] of pairs) expect(mimeOf(kind)).toBe(mime)
  })

  it('gives null for an unknown kind', () => {
    expect(mimeOf('unknown')).toBeNull()
  })
})
