/**
 * The image operations inside a real Chromium.
 */

import { describe, expect, it } from 'vitest'
import { createBrowserImaging } from '../../src/imaging'
import { Pixels, colorDistance, drawQuadrants, drawToBlob } from './helpers'

const imaging = createBrowserImaging()

const RED = [255, 0, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const
const GREEN = [0, 255, 0, 255] as const
const YELLOW = [255, 255, 0, 255] as const

describe('decode', () => {
  it('reports the size of a png', async () => {
    const blob = await drawToBlob(400, 200, (ctx) => drawQuadrants(ctx, 400, 200))
    const image = await imaging.decode(blob, 1)
    try {
      expect(image.width).toBe(400)
      expect(image.height).toBe(200)
    } finally {
      image.close()
    }
  })

  it('close() frees without throwing, twice in a row', async () => {
    const blob = await drawToBlob(40, 20, (ctx) => drawQuadrants(ctx, 40, 20))
    const image = await imaging.decode(blob, 1)
    expect(() => image.close()).not.toThrow()
    expect(() => image.close()).not.toThrow()
  })

  it('refuses to encode an image that was closed', async () => {
    const blob = await drawToBlob(40, 20, (ctx) => drawQuadrants(ctx, 40, 20))
    const image = await imaging.decode(blob, 1)
    image.close()
    await expect(
      imaging.encode(image, {
        width: 20,
        height: 10,
        format: 'png',
        quality: 1,
        background: '#ffffff',
      }),
    ).rejects.toThrow(/close/)
  })
})

describe('encode', () => {
  it('resizes 400x200 down to 200x100 and keeps every corner in place', async () => {
    const source = await drawToBlob(400, 200, (ctx) => drawQuadrants(ctx, 400, 200))
    const image = await imaging.decode(source, 1)
    let out: Blob
    try {
      out = await imaging.encode(image, {
        width: 200,
        height: 100,
        format: 'png',
        quality: 1,
        background: '#ffffff',
      })
    } finally {
      image.close()
    }

    const pixels = await Pixels.from(out)
    expect(pixels.width).toBe(200)
    expect(pixels.height).toBe(100)
    expect(colorDistance(pixels.at(25, 25), RED)).toBeLessThanOrEqual(6)
    expect(colorDistance(pixels.at(175, 25), BLUE)).toBeLessThanOrEqual(6)
    expect(colorDistance(pixels.at(25, 75), GREEN)).toBeLessThanOrEqual(6)
    expect(colorDistance(pixels.at(175, 75), YELLOW)).toBeLessThanOrEqual(6)
  })

  it('lays the requested background under a transparent png turned into a jpeg', async () => {
    // A fully transparent png: without a background, the jpeg would come out black.
    const source = await drawToBlob(60, 60, (ctx) => ctx.clearRect(0, 0, 60, 60))
    const image = await imaging.decode(source, 1)
    let out: Blob
    try {
      out = await imaging.encode(image, {
        width: 60,
        height: 60,
        format: 'jpeg',
        quality: 0.95,
        background: '#ff8800',
      })
    } finally {
      image.close()
    }

    expect(out.type).toBe('image/jpeg')
    const pixels = await Pixels.from(out)
    expect(colorDistance(pixels.average(10, 10, 40, 40), [255, 136, 0, 255])).toBeLessThanOrEqual(8)
  })

  it('keeps transparency when the format holds it', async () => {
    const source = await drawToBlob(40, 40, (ctx) => {
      ctx.clearRect(0, 0, 40, 40)
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, 20, 40)
    })
    const image = await imaging.decode(source, 1)
    let out: Blob
    try {
      out = await imaging.encode(image, {
        width: 40,
        height: 40,
        format: 'png',
        quality: 1,
        background: '#00ff00',
      })
    } finally {
      image.close()
    }

    const pixels = await Pixels.from(out)
    expect(pixels.at(30, 20)[3]).toBe(0)
    expect(colorDistance(pixels.at(10, 20), RED)).toBeLessThanOrEqual(6)
  })

  it('writes a webp blob that really is a webp', async () => {
    const source = await drawToBlob(100, 100, (ctx) => drawQuadrants(ctx, 100, 100))
    const image = await imaging.decode(source, 1)
    try {
      const out = await imaging.encode(image, {
        width: 100,
        height: 100,
        format: 'webp',
        quality: 0.8,
        background: '#ffffff',
      })
      expect(out.type).toBe('image/webp')
      expect(out.size).toBeGreaterThan(0)
    } finally {
      image.close()
    }
  })

  it('makes a lighter file at a lower quality', async () => {
    // A noisy image: a flat colour would compress the same at both qualities.
    const source = await drawToBlob(400, 400, (ctx) => {
      const image = ctx.createImageData(400, 400)
      let seed = 1
      for (let index = 0; index < image.data.length; index += 4) {
        seed = (seed * 16807) % 2147483647
        image.data[index] = seed % 256
        image.data[index + 1] = (seed >> 8) % 256
        image.data[index + 2] = (seed >> 16) % 256
        image.data[index + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
    })
    const image = await imaging.decode(source, 1)
    try {
      const high = await imaging.encode(image, {
        width: 400,
        height: 400,
        format: 'jpeg',
        quality: 0.9,
        background: '#ffffff',
      })
      const low = await imaging.encode(image, {
        width: 400,
        height: 400,
        format: 'jpeg',
        quality: 0.3,
        background: '#ffffff',
      })
      expect(high.size).toBeGreaterThan(low.size)
    } finally {
      image.close()
    }
  })

  it('keeps the average color when shrinking 2000x1500 down to 200x150', async () => {
    // Stripes of 5 pixels, so a period of 10, exactly the sampling step
    // of a reduction by ten: a nearest-neighbour pick would always land on
    // the red stripe and return a fully red image. Real filtering keeps
    // the average purple.
    const source = await drawToBlob(2000, 1500, (ctx) => {
      for (let x = 0; x < 2000; x += 10) {
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(x, 0, 5, 1500)
        ctx.fillStyle = '#0000ff'
        ctx.fillRect(x + 5, 0, 5, 1500)
      }
    })

    const before = await Pixels.from(source)
    const expected = before.average(0, 0, 2000, 1500)
    expect(colorDistance(expected, [127.5, 0, 127.5, 255])).toBeLessThanOrEqual(2)

    const image = await imaging.decode(source, 1)
    let out: Blob
    try {
      out = await imaging.encode(image, {
        width: 200,
        height: 150,
        format: 'png',
        quality: 1,
        background: '#ffffff',
      })
    } finally {
      image.close()
    }

    const after = await Pixels.from(out)
    expect(after.width).toBe(200)
    expect(after.height).toBe(150)
    expect(colorDistance(after.average(0, 0, 200, 150), expected)).toBeLessThanOrEqual(10)
  })
})

describe('supports', () => {
  it('answers true for the three formats under chromium', async () => {
    expect(await imaging.supports('png')).toBe(true)
    expect(await imaging.supports('jpeg')).toBe(true)
    expect(await imaging.supports('webp')).toBe(true)
  })

  it('gives the same answer twice, from its cache', async () => {
    const first = await imaging.supports('webp')
    const second = await imaging.supports('webp')
    expect(second).toBe(first)
  })
})
