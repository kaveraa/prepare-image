import { mimeOf, sniff } from './detect'
import { PrepareImageError } from './errors'
import { readMetadata } from './exif'
import { browserImaging } from './imaging'
import {
  asFormat,
  chooseFormat,
  clampQuality,
  fitWithin,
  mimeOfFormat,
  qualitySteps,
  renameTo,
} from './plan'
import { stripMetadata } from './strip'
import type { Change, DecodedImage, Format, PrepareOptions, PreparedImage } from './types'

const DEFAULT_MAX_SIZE = 2000
const DEFAULT_QUALITY = 0.82
const DEFAULT_BACKGROUND = '#ffffff'

/**
 * Prend le fichier que la personne vient de choisir et rend une image prete a
 * etre envoyee : lisible par tous les navigateurs, droite, a la bonne taille,
 * et debarrassee des metadonnees.
 *
 * Takes the file someone just picked and returns an image ready to upload:
 * readable everywhere, upright, the right size, and free of metadata.
 */
export async function prepareImage(input: Blob, options: PrepareOptions = {}): Promise<PreparedImage> {
  const imaging = options.imaging ?? browserImaging

  stopIfAsked(options.signal)

  let blob: Blob = input
  let bytes = new Uint8Array(await blob.arrayBuffer())
  let kind = sniff(bytes)

  if (kind === 'unknown') {
    throw PrepareImageError.notAnImage(input.type)
  }

  let meta = readMetadata(bytes, kind)
  const changed: Change[] = []

  // On essaie d'abord le navigateur seul : Safari lit le HEIC sans aide, et
  // cela evite de charger un decodeur pour rien.
  let image: DecodedImage

  try {
    image = await imaging.decode(blob, meta.orientation)
  } catch (error) {
    if (options.decodeHeic === undefined) {
      throw kind === 'heic' || kind === 'avif'
        ? PrepareImageError.needsDecoder()
        : PrepareImageError.cannotDecode(error)
    }

    blob = await options.decodeHeic(blob)
    bytes = new Uint8Array(await blob.arrayBuffer())
    kind = sniff(bytes)
    meta = readMetadata(bytes, kind)
    changed.push('decoded-heic')

    stopIfAsked(options.signal)

    try {
      image = await imaging.decode(blob, meta.orientation)
    } catch (second) {
      throw PrepareImageError.cannotDecode(second)
    }
  }

  try {
    const target = fitWithin(image.width, image.height, options.maxSize ?? DEFAULT_MAX_SIZE)
    const format = chooseFormat(options.format ?? 'auto', kind, await imaging.supports('webp'))

    const resized = target.width !== image.width || target.height !== image.height
    const converted = asFormat(kind) !== format
    const rotated = meta.orientation !== 1

    const source = {
      type: mimeOf(kind) ?? input.type,
      bytes: input.size,
      width: image.width,
      height: image.height,
      orientation: meta.orientation,
    }

    // Rien a changer sur les pixels : on se contente de retirer les
    // metadonnees, sans reencoder, donc sans perte de qualite.
    if (options.alwaysReencode !== true && !resized && !converted && !rotated) {
      const cleaned = meta.hasMetadata ? stripMetadata(bytes, kind) : bytes

      if (cleaned !== null) {
        if (meta.hasMetadata) {
          changed.push('metadata-removed')
        }

        const type = mimeOf(kind) ?? input.type

        return {
          file: toFile(new Blob([toBuffer(cleaned)], { type }), input, format),
          format,
          width: image.width,
          height: image.height,
          bytes: cleaned.byteLength,
          source,
          changed,
        }
      }
    }

    if (!(await imaging.supports(format))) {
      throw PrepareImageError.cannotEncode(format)
    }

    const quality = clampQuality(options.quality ?? DEFAULT_QUALITY)
    const background = options.background ?? DEFAULT_BACKGROUND

    // Le PNG ne connait pas la qualite : inutile de reessayer plus bas.
    const ladder =
      options.maxBytes !== undefined && format !== 'png' ? qualitySteps(quality) : [quality]

    let out: Blob | undefined

    for (const step of ladder) {
      stopIfAsked(options.signal)

      try {
        out = await imaging.encode(image, { ...target, format, quality: step, background })
      } catch (error) {
        // Toutes les erreurs du paquet portent un code : celles du canevas aussi.
        throw error instanceof PrepareImageError ? error : PrepareImageError.cannotEncode(format, error)
      }

      if (options.maxBytes === undefined || out.size <= options.maxBytes) {
        break
      }
    }

    if (out === undefined) {
      throw PrepareImageError.cannotEncode(format)
    }

    if (rotated) {
      changed.push('rotated')
    }

    if (resized) {
      changed.push('resized')
    }

    if (converted) {
      changed.push('converted')
    } else if (!resized && !rotated) {
      changed.push('recompressed')
    }

    if (meta.hasMetadata) {
      changed.push('metadata-removed')
    }

    return {
      file: toFile(out, input, format),
      format,
      width: target.width,
      height: target.height,
      bytes: out.size,
      source,
      changed,
    }
  } finally {
    image.close()
  }
}

/**
 * Le fichier est-il une photo HEIC ? Lit seulement les premiers octets, ce qui
 * permet de ne charger un decodeur que lorsqu'il sert vraiment.
 *
 * Is this file a HEIC photo? Reads the first bytes only.
 */
export async function looksLikeHeic(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer())

  return sniff(head) === 'heic'
}

function toFile(blob: Blob, input: Blob, format: Format): File {
  const name = renameTo(input instanceof File ? input.name : undefined, format)
  const type = blob.type === '' ? mimeOfFormat(format) : blob.type

  return new File([blob], name, { type, lastModified: Date.now() })
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function stopIfAsked(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw PrepareImageError.aborted()
  }
}

export { PrepareImageError } from './errors'
export type { PrepareImageErrorCode } from './errors'
export { sniff } from './detect'
export type { ImageKind } from './detect'
export type {
  Change,
  DecodedImage,
  EncodeOptions,
  Format,
  HeicDecoder,
  Imaging,
  Orientation,
  PrepareOptions,
  PreparedImage,
} from './types'
