import { describe, expect, it } from 'vitest'
import {
  asFormat,
  chooseFormat,
  clampQuality,
  extensionOf,
  fitWithin,
  keepsTransparency,
  mayBeTransparent,
  qualitySteps,
  renameTo,
} from '../../src/plan'

describe('fitWithin', () => {
  it('brings the longest edge down to the limit', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 })
  })

  it('never makes an image bigger', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 })
  })

  it('keeps at least one pixel on the short side', () => {
    expect(fitWithin(10000, 3, 100)).toEqual({ width: 100, height: 1 })
  })

  it('leaves the size alone when the limit makes no sense', () => {
    expect(fitWithin(800, 600, 0)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(800, 600, -10)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(800, 600, Number.NaN)).toEqual({ width: 800, height: 600 })
  })

  it('rounds to whole pixels', () => {
    const { width, height } = fitWithin(1999, 1333, 1000)

    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })
})

describe('chooseFormat', () => {
  it('follows what was asked for', () => {
    expect(chooseFormat('jpeg', 'png', true)).toBe('jpeg')
    expect(chooseFormat('png', 'jpeg', true)).toBe('png')
  })

  it('takes webp whenever the browser can write it', () => {
    expect(chooseFormat('auto', 'jpeg', true)).toBe('webp')
    expect(chooseFormat('auto', 'png', true)).toBe('webp')
    expect(chooseFormat('auto', 'heic', true)).toBe('webp')
  })

  it('keeps png for what may be transparent when webp is missing', () => {
    expect(chooseFormat('auto', 'png', false)).toBe('png')
    expect(chooseFormat('auto', 'gif', false)).toBe('png')
    expect(chooseFormat('auto', 'jpeg', false)).toBe('jpeg')
    expect(chooseFormat('auto', 'heic', false)).toBe('jpeg')
  })
})

describe('format helpers', () => {
  it('knows which formats keep transparency', () => {
    expect(keepsTransparency('png')).toBe(true)
    expect(keepsTransparency('webp')).toBe(true)
    expect(keepsTransparency('jpeg')).toBe(false)
  })

  it('knows which sources may be transparent', () => {
    expect(mayBeTransparent('png')).toBe(true)
    expect(mayBeTransparent('jpeg')).toBe(false)
  })

  it('maps a source to an output format when there is one', () => {
    expect(asFormat('jpeg')).toBe('jpeg')
    expect(asFormat('heic')).toBeNull()
    expect(asFormat('unknown')).toBeNull()
  })

  it('uses the usual extension', () => {
    expect(extensionOf('jpeg')).toBe('jpg')
    expect(extensionOf('webp')).toBe('webp')
  })
})

describe('qualitySteps', () => {
  it('goes down step by step and stops before it gets ugly', () => {
    const steps = qualitySteps(0.82)

    expect(steps[0]).toBe(0.82)
    expect(steps.every((one, index) => index === 0 || one < (steps[index - 1] ?? 1))).toBe(true)
    expect(steps.every((one) => one >= 0.3)).toBe(true)
  })

  it('always offers at least the asked quality', () => {
    expect(qualitySteps(0.3)).toEqual([0.3])
    expect(qualitySteps(0.1)).toEqual([0.1])
  })

  it('keeps a quality inside its bounds', () => {
    expect(clampQuality(2)).toBe(1)
    expect(clampQuality(-1)).toBe(0.05)
    expect(clampQuality(Number.NaN)).toBe(0.82)
  })
})

describe('renameTo', () => {
  it('swaps the extension', () => {
    expect(renameTo('IMG_4821.HEIC', 'webp')).toBe('IMG_4821.webp')
    expect(renameTo('photo.jpeg', 'jpeg')).toBe('photo.jpg')
  })

  it('copes with a name that has no extension, or no name at all', () => {
    expect(renameTo('holiday', 'webp')).toBe('holiday.webp')
    expect(renameTo(undefined, 'webp')).toBe('image.webp')
    expect(renameTo('', 'jpeg')).toBe('image.jpg')
  })

  it('leaves the dots inside the name alone', () => {
    expect(renameTo('trip.2026.summer.jpg', 'webp')).toBe('trip.2026.summer.webp')
  })
})
