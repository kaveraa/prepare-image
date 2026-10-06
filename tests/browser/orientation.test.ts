/**
 * The camera orientation must end up in the pixels: a photo taken with a
 * phone held vertically comes out upright, sides swapped.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserImaging } from '../../src/imaging'
import { Pixels, colorDistance, drawQuadrants, drawToBlob, jpegWithOrientation } from './helpers'

const imaging = createBrowserImaging()

const RED = [255, 0, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const

/** A 400x200 landscape: left half red, right half blue. */
function drawHalves(ctx: OffscreenCanvasRenderingContext2D): void {
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 200, 200)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(200, 0, 200, 200)
}

/** Decodes, encodes at the wanted size, and returns the pixels of the result. */
async function decodeThenRead(
  blob: Blob,
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): Promise<{ width: number; height: number; pixels: Pixels }> {
  const image = await imaging.decode(blob, orientation)
  try {
    const out = await imaging.encode(image, {
      width: image.width,
      height: image.height,
      format: 'png',
      quality: 1,
      background: '#ffffff',
    })
    return { width: image.width, height: image.height, pixels: await Pixels.from(out) }
  } finally {
    image.close()
  }
}

describe('orientation', () => {
  it('leaves an untagged jpeg alone', async () => {
    const blob = await jpegWithOrientation(400, 200, drawHalves, 1)
    const { width, height, pixels } = await decodeThenRead(blob, 1)
    expect(width).toBe(400)
    expect(height).toBe(200)
    expect(colorDistance(pixels.average(40, 80, 40, 40), RED)).toBeLessThanOrEqual(12)
    expect(colorDistance(pixels.average(320, 80, 40, 40), BLUE)).toBeLessThanOrEqual(12)
  })

  it('swaps the sides of a jpeg tagged with orientation 6 and turns it clockwise', async () => {
    const blob = await jpegWithOrientation(400, 200, drawHalves, 6)
    const { width, height, pixels } = await decodeThenRead(blob, 6)

    // A quarter turn: the 400x200 landscape becomes a 200x400 portrait.
    expect(width).toBe(200)
    expect(height).toBe(400)
    expect(pixels.width).toBe(200)
    expect(pixels.height).toBe(400)

    // Clockwise: the left half of the source goes to the top of the image.
    expect(colorDistance(pixels.average(80, 60, 40, 40), RED)).toBeLessThanOrEqual(12)
    expect(colorDistance(pixels.average(80, 300, 40, 40), BLUE)).toBeLessThanOrEqual(12)
  })

  it('turns a jpeg tagged with orientation 8 the other way', async () => {
    const blob = await jpegWithOrientation(400, 200, drawHalves, 8)
    const { width, height, pixels } = await decodeThenRead(blob, 8)

    expect(width).toBe(200)
    expect(height).toBe(400)

    // Counter-clockwise: the left half of the source goes to the bottom.
    expect(colorDistance(pixels.average(80, 300, 40, 40), RED)).toBeLessThanOrEqual(12)
    expect(colorDistance(pixels.average(80, 60, 40, 40), BLUE)).toBeLessThanOrEqual(12)
  })

  it('resizes an upright image from a tagged jpeg', async () => {
    const blob = await jpegWithOrientation(400, 200, drawHalves, 6)
    const image = await imaging.decode(blob, 6)
    try {
      const out = await imaging.encode(image, {
        width: 100,
        height: 200,
        format: 'png',
        quality: 1,
        background: '#ffffff',
      })
      const pixels = await Pixels.from(out)
      expect(pixels.width).toBe(100)
      expect(pixels.height).toBe(200)
      expect(colorDistance(pixels.average(40, 30, 20, 20), RED)).toBeLessThanOrEqual(12)
      expect(colorDistance(pixels.average(40, 150, 20, 20), BLUE)).toBeLessThanOrEqual(12)
    } finally {
      image.close()
    }
  })
})

/**
 * The fallback path: an engine that ignores `imageOrientation: 'from-image'`.
 * We fake this engine by refusing the option, and we start from a png with no
 * orientation in the file, so the only rotation applied is the one the
 * library computes itself.
 */
describe('orientation applied by hand', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Refuses the orientation option, lets the rest through. */
  function refuseImageOrientation(): void {
    const original = globalThis.createImageBitmap.bind(globalThis)
    vi.stubGlobal('createImageBitmap', (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      if (options && 'imageOrientation' in options) {
        return Promise.reject(new Error('imageOrientation not supported'))
      }
      return original(source)
    })
  }

  const QUADRANTS = {
    red: [255, 0, 0, 255],
    blue: [0, 0, 255, 255],
    green: [0, 255, 0, 255],
    yellow: [255, 255, 0, 255],
  } as const

  type Quadrant = keyof typeof QUADRANTS

  /**
   * For each orientation, the four quadrants expected once the image is
   * upright, in the order top-left, top-right, bottom-left, bottom-right.
   * The source is red / blue at the top, green / yellow at the bottom.
   */
  const EXPECTED: Record<number, readonly [Quadrant, Quadrant, Quadrant, Quadrant]> = {
    1: ['red', 'blue', 'green', 'yellow'],
    2: ['blue', 'red', 'yellow', 'green'],
    3: ['yellow', 'green', 'blue', 'red'],
    4: ['green', 'yellow', 'red', 'blue'],
    5: ['red', 'green', 'blue', 'yellow'],
    6: ['green', 'red', 'yellow', 'blue'],
    7: ['yellow', 'blue', 'green', 'red'],
    8: ['blue', 'yellow', 'red', 'green'],
  }

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    it(`places every quadrant right for orientation ${orientation}`, async () => {
      refuseImageOrientation()
      const fallback = createBrowserImaging()
      const source = await drawToBlob(400, 200, (ctx) => drawQuadrants(ctx, 400, 200))
      const image = await fallback.decode(source, orientation)

      const turned = orientation >= 5
      expect(image.width).toBe(turned ? 200 : 400)
      expect(image.height).toBe(turned ? 400 : 200)

      let out: Blob
      try {
        out = await fallback.encode(image, {
          width: image.width,
          height: image.height,
          format: 'png',
          quality: 1,
          background: '#ffffff',
        })
      } finally {
        image.close()
      }

      const pixels = await Pixels.from(out)
      const quarterWidth = pixels.width / 4
      const quarterHeight = pixels.height / 4
      const centers = [
        [quarterWidth, quarterHeight],
        [quarterWidth * 3, quarterHeight],
        [quarterWidth, quarterHeight * 3],
        [quarterWidth * 3, quarterHeight * 3],
      ] as const
      const expected = EXPECTED[orientation]
      if (!expected) throw new Error('missing expectation')

      for (let corner = 0; corner < 4; corner += 1) {
        const center = centers[corner]
        const name = expected[corner]
        if (!center || !name) throw new Error('missing sample')
        const sample = pixels.average(Math.round(center[0]) - 5, Math.round(center[1]) - 5, 10, 10)
        expect(colorDistance(sample, QUADRANTS[name]), `corner ${corner}`).toBeLessThanOrEqual(6)
      }
    })
  }
})
