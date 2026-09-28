/**
 * L'orientation notee par l'appareil photo doit finir dans les pixels : une
 * photo prise telephone a la verticale ressort droite, cotes echanges.
 *
 * The camera orientation must end up in the pixels.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserImaging } from '../../src/imaging'
import { Pixels, colorDistance, drawQuadrants, drawToBlob, jpegWithOrientation } from './helpers'

const imaging = createBrowserImaging()

const RED = [255, 0, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const

/** Un paysage 400x200 : moitie gauche rouge, moitie droite bleue. */
function drawHalves(ctx: OffscreenCanvasRenderingContext2D): void {
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 200, 200)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(200, 0, 200, 200)
}

/** Decode, encode a la taille voulue, et rend les pixels du resultat. */
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

    // Un quart de tour : le 400x200 couche devient un 200x400 debout.
    expect(width).toBe(200)
    expect(height).toBe(400)
    expect(pixels.width).toBe(200)
    expect(pixels.height).toBe(400)

    // Sens horaire : la moitie gauche de l'origine monte en haut de l'image.
    expect(colorDistance(pixels.average(80, 60, 40, 40), RED)).toBeLessThanOrEqual(12)
    expect(colorDistance(pixels.average(80, 300, 40, 40), BLUE)).toBeLessThanOrEqual(12)
  })

  it('turns a jpeg tagged with orientation 8 the other way', async () => {
    const blob = await jpegWithOrientation(400, 200, drawHalves, 8)
    const { width, height, pixels } = await decodeThenRead(blob, 8)

    expect(width).toBe(200)
    expect(height).toBe(400)

    // Sens antihoraire : la moitie gauche de l'origine descend en bas.
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
 * Le chemin de secours : un moteur qui n'honore pas
 * `imageOrientation: 'from-image'`. On simule ce moteur en refusant l'option,
 * et on part d'un png, sans orientation dans le fichier, pour que la seule
 * rotation posee soit celle que la bibliotheque calcule elle-meme.
 *
 * The fallback path: an engine that ignores `imageOrientation: 'from-image'`.
 */
describe('orientation applied by hand', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Refuse l'option d'orientation, laisse passer le reste. */
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
   * Pour chaque orientation, les quatre quadrants attendus une fois l'image
   * droite, dans l'ordre haut-gauche, haut-droit, bas-gauche, bas-droit.
   * La source est rouge / bleu en haut, vert / jaune en bas.
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
