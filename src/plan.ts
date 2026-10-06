import type { ImageKind } from './detect'
import type { Format } from './types'

/**
 * The output size, longest edge brought down to `maxSize`.
 * An image smaller than the limit is never enlarged.
 */
export function fitWithin(width: number, height: number, maxSize: number): { width: number; height: number } {
  const longest = Math.max(width, height)

  if (!Number.isFinite(maxSize) || maxSize <= 0 || longest <= maxSize) {
    return { width, height }
  }

  const ratio = maxSize / longest

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

/**
 * The output format. `'auto'` picks WebP whenever the browser can write it:
 * it weighs less than JPEG and keeps transparency, so it suits photos as
 * well as cut-out images. Otherwise we keep PNG for what may be transparent,
 * and JPEG for the rest.
 */
export function chooseFormat(asked: Format | 'auto', source: ImageKind, webpAvailable: boolean): Format {
  if (asked !== 'auto') {
    return asked
  }

  if (webpAvailable) {
    return 'webp'
  }

  return mayBeTransparent(source) ? 'png' : 'jpeg'
}

export function mayBeTransparent(source: ImageKind): boolean {
  return source === 'png' || source === 'gif' || source === 'webp' || source === 'avif'
}

/** Does the format keep transparency? If not, a background must be laid. */
export function keepsTransparency(format: Format): boolean {
  return format !== 'jpeg'
}

/** The format of the original file, when it matches an output format. */
export function asFormat(source: ImageKind): Format | null {
  return source === 'jpeg' || source === 'png' || source === 'webp' ? source : null
}

/**
 * The qualities tried one after another to fit a byte budget.
 * We go down in wide steps: each try costs one encoding.
 */
export function qualitySteps(start: number, steps = 4): number[] {
  const ladder = [clampQuality(start)]

  for (let i = 0; i < steps; i++) {
    const next = Math.round((ladder[ladder.length - 1] ?? start) * 0.75 * 100) / 100

    if (next < 0.3) {
      break
    }

    ladder.push(next)
  }

  return ladder
}

export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) {
    return 0.82
  }

  return Math.min(1, Math.max(0.05, quality))
}

/** The usual extension of the format. */
export function extensionOf(format: Format): string {
  return format === 'jpeg' ? 'jpg' : format
}

export function mimeOfFormat(format: Format): string {
  return `image/${format}`
}

/**
 * The name of the returned file: the original one, with the new extension.
 */
export function renameTo(name: string | undefined, format: Format): string {
  const extension = extensionOf(format)
  const base = (name ?? '').replace(/\.[^./\\]+$/, '').trim()

  return `${base === '' ? 'image' : base}.${extension}`
}
