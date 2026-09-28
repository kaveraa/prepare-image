import { describe, expect, it, vi } from 'vitest'
import { PrepareImageError, prepareImage } from '../../src/index'
import { readMetadata } from '../../src/exif'
import type { DecodedImage, EncodeOptions, Format, Imaging, Orientation } from '../../src/types'
import { IDAT_DATA, IHDR_DATA, exifPayload, ftyp, jpeg, png } from './fixtures'

/**
 * Un faux jeu d'operations d'image : il permet de verifier tout l'enchainement
 * sous Node, sans navigateur. Le vrai canevas a ses propres tests.
 */
function fakeImaging(
  options: {
    size?: { width: number; height: number }
    canDecode?: (blob: Blob) => boolean
    webp?: boolean
    bytesFor?: (quality: number) => number
  } = {},
): Imaging & { encodes: EncodeOptions[]; closed: () => number } {
  const size = options.size ?? { width: 4000, height: 3000 }
  const encodes: EncodeOptions[] = []
  let closed = 0

  return {
    encodes,
    closed: () => closed,

    async decode(blob: Blob, _orientation: Orientation): Promise<DecodedImage> {
      if (options.canDecode !== undefined && !options.canDecode(blob)) {
        throw new Error('this browser cannot read that')
      }

      return {
        width: size.width,
        height: size.height,
        close: () => {
          closed += 1
        },
      }
    },

    async encode(_image: DecodedImage, encodeOptions: EncodeOptions): Promise<Blob> {
      encodes.push(encodeOptions)

      return new Blob([new Uint8Array(options.bytesFor?.(encodeOptions.quality) ?? 1000)], {
        type: `image/${encodeOptions.format}`,
      })
    },

    async supports(format: Format): Promise<boolean> {
      return format === 'webp' ? options.webp !== false : true
    },
  }
}

function fileOf(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type })
}

describe('prepareImage', () => {
  it('turns a big sideways photo into something you can upload', async () => {
    const source = jpeg({ app1: exifPayload({ orientation: 6, gps: true }) })
    const imaging = fakeImaging({ size: { width: 3000, height: 4000 } })

    const ready = await prepareImage(fileOf(source, 'IMG_4821.JPG', 'image/jpeg'), { imaging })

    expect(ready.format).toBe('webp')
    expect(ready.width).toBe(1500)
    expect(ready.height).toBe(2000)
    expect(ready.file.name).toBe('IMG_4821.webp')
    expect(ready.file.type).toBe('image/webp')
    expect(ready.changed).toEqual(['rotated', 'resized', 'converted', 'metadata-removed'])
    expect(ready.source.orientation).toBe(6)
    expect(ready.source.bytes).toBe(source.byteLength)
  })

  it('leaves a file alone when there is nothing to do', async () => {
    const source = png([
      ['IHDR', IHDR_DATA],
      ['IDAT', IDAT_DATA],
      ['IEND', new Uint8Array(0)],
    ])
    const imaging = fakeImaging({ size: { width: 800, height: 600 }, webp: false })

    const ready = await prepareImage(fileOf(source, 'logo.png', 'image/png'), { imaging })

    expect(ready.changed).toEqual([])
    expect(ready.bytes).toBe(source.byteLength)
    expect(imaging.encodes).toHaveLength(0)
  })

  it('removes the location without touching the pixels when that is all there is to do', async () => {
    const source = jpeg({ app1: exifPayload({ orientation: 1, gps: true }) })
    const imaging = fakeImaging({ size: { width: 800, height: 600 }, webp: false })

    const ready = await prepareImage(fileOf(source, 'holiday.jpg', 'image/jpeg'), { imaging })

    expect(ready.changed).toEqual(['metadata-removed'])
    // Aucun encodage : les pixels n'ont pas ete retouches.
    expect(imaging.encodes).toHaveLength(0)
    expect(ready.bytes).toBeLessThan(source.byteLength)

    const cleaned = new Uint8Array(await ready.file.arrayBuffer())
    expect(readMetadata(cleaned, 'jpeg').hasLocation).toBe(false)
  })

  it('re-encodes anyway when it is asked to', async () => {
    const source = jpeg({ app1: exifPayload({ gps: true }) })
    const imaging = fakeImaging({ size: { width: 800, height: 600 }, webp: false })

    const ready = await prepareImage(fileOf(source, 'holiday.jpg', 'image/jpeg'), {
      imaging,
      alwaysReencode: true,
    })

    expect(imaging.encodes).toHaveLength(1)
    expect(ready.changed).toEqual(['recompressed', 'metadata-removed'])
  })

  it('steps the quality down to fit a size budget', async () => {
    const source = jpeg({})
    const imaging = fakeImaging({
      size: { width: 4000, height: 3000 },
      bytesFor: (quality) => Math.round(quality * 1_000_000),
    })

    const ready = await prepareImage(fileOf(source, 'big.jpg', 'image/jpeg'), {
      imaging,
      maxBytes: 400_000,
    })

    expect(imaging.encodes.length).toBeGreaterThan(1)
    expect(ready.bytes).toBeLessThanOrEqual(400_000)

    const qualities = imaging.encodes.map((one) => one.quality)
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a))
  })

  it('does not chase a budget for a png, where quality means nothing', async () => {
    const source = png([
      ['IHDR', IHDR_DATA],
      ['IDAT', IDAT_DATA],
      ['IEND', new Uint8Array(0)],
    ])
    const imaging = fakeImaging({ size: { width: 4000, height: 3000 }, webp: false })

    await prepareImage(fileOf(source, 'chart.png', 'image/png'), { imaging, maxBytes: 10 })

    expect(imaging.encodes).toHaveLength(1)
  })

  it('says clearly when a heic photo needs a decoder', async () => {
    const heic = ftyp('heic', ['mif1'])
    const imaging = fakeImaging({ canDecode: () => false })

    await expect(prepareImage(fileOf(heic, 'IMG.HEIC', ''), { imaging })).rejects.toMatchObject({
      name: 'PrepareImageError',
      code: 'needs-decoder',
    })
  })

  it('uses the decoder given to it, and only then', async () => {
    const heic = ftyp('heic', ['mif1'])
    const converted = jpeg({})
    const decodeHeic = vi.fn(async () => new Blob([converted.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }))

    let firstCall = true
    const imaging = fakeImaging({
      size: { width: 800, height: 600 },
      webp: false,
      canDecode: () => {
        if (firstCall) {
          firstCall = false

          return false
        }

        return true
      },
    })

    const ready = await prepareImage(fileOf(heic, 'IMG_4821.HEIC', ''), { imaging, decodeHeic })

    expect(decodeHeic).toHaveBeenCalledTimes(1)
    expect(ready.changed[0]).toBe('decoded-heic')
    expect(ready.file.name).toBe('IMG_4821.jpg')
  })

  it('refuses what is not an image', async () => {
    const notAnImage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

    await expect(
      prepareImage(fileOf(notAnImage, 'contract.pdf', 'application/pdf'), { imaging: fakeImaging() }),
    ).rejects.toMatchObject({ code: 'not-an-image' })
  })

  it('stops when the signal is already fired', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      prepareImage(fileOf(jpeg({}), 'a.jpg', 'image/jpeg'), {
        imaging: fakeImaging(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })

  it('always frees the decoded image, even when the encoding fails', async () => {
    let closed = 0
    const imaging: Imaging = {
      async decode() {
        return { width: 4000, height: 3000, close: () => { closed += 1 } }
      },
      async encode() {
        throw new Error('no room left')
      },
      async supports() {
        return true
      },
    }

    await expect(prepareImage(fileOf(jpeg({}), 'a.jpg', 'image/jpeg'), { imaging })).rejects.toMatchObject({
      name: 'PrepareImageError',
      code: 'cannot-encode',
    })
    expect(closed).toBe(1)
  })

  it('carries a code on every error it throws', () => {
    expect(PrepareImageError.needsDecoder().code).toBe('needs-decoder')
    expect(PrepareImageError.notAnImage('').code).toBe('not-an-image')
  })
})
