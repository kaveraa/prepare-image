import type { ImageKind } from './detect'
import type { Format } from './types'

/**
 * Les dimensions de sortie, cote le plus long ramene a `maxSize`.
 * Une image plus petite que la limite n'est jamais agrandie.
 *
 * The output size, longest edge brought down to `maxSize`.
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
 * Le format de sortie. `'auto'` prend le WebP des que le navigateur sait
 * l'ecrire : il pese moins lourd que le JPEG et garde la transparence, donc il
 * convient aux photos comme aux images detourees. Sinon on garde le PNG pour ce
 * qui peut etre transparent, et le JPEG pour le reste.
 *
 * The output format. `'auto'` picks WebP whenever the browser can write it.
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

/** Le format garde-t-il la transparence ? Sinon il faut poser un fond. */
export function keepsTransparency(format: Format): boolean {
  return format !== 'jpeg'
}

/** Le format du fichier d'origine, quand il correspond a un format de sortie. */
export function asFormat(source: ImageKind): Format | null {
  return source === 'jpeg' || source === 'png' || source === 'webp' ? source : null
}

/**
 * Les qualites essayees l'une apres l'autre pour tenir dans un budget d'octets.
 * On descend par paliers larges : chaque essai coute un encodage.
 *
 * The qualities tried one after another to fit a byte budget.
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

/** L'extension habituelle du format. */
export function extensionOf(format: Format): string {
  return format === 'jpeg' ? 'jpg' : format
}

export function mimeOfFormat(format: Format): string {
  return `image/${format}`
}

/**
 * Le nom du fichier rendu : celui d'origine, avec la nouvelle extension.
 *
 * The name of the returned file: the original one, with the new extension.
 */
export function renameTo(name: string | undefined, format: Format): string {
  const extension = extensionOf(format)
  const base = (name ?? '').replace(/\.[^./\\]+$/, '').trim()

  return `${base === '' ? 'image' : base}.${extension}`
}
