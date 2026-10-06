/**
 * The orientation recorded in the file by the camera, from 1 to 8.
 * 1 means "already upright"; 6 and 8 are the two usual quarter turns of a
 * phone held vertically.
 */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** The formats the package can write. */
export type Format = 'webp' | 'jpeg' | 'png'

/**
 * What `prepareImage()` is asked to do.
 */
export interface PrepareOptions {
  /**
   * Longest edge, in pixels. The image is never enlarged.
   * Default: 2000.
   */
  maxSize?: number

  /**
   * Output format. `'auto'` picks WebP as soon as the browser can write it.
   * Otherwise it keeps PNG when the image may be transparent, and JPEG for
   * the rest. Default: `'auto'`.
   */
  format?: Format | 'auto'

  /** Quality, from 0 to 1. No effect on PNG. Default: 0.82. */
  quality?: number

  /**
   * Maximum weight of the result, in bytes. The quality is lowered step by
   * step until it fits this budget. No guarantee: an image may stay above.
   */
  maxBytes?: number

  /**
   * Colour laid under the transparent areas when the output does not keep
   * transparency (JPEG). Default: white.
   */
  background?: string

  /**
   * Re-encode even when nothing needs to change. Default: false, and the
   * package then only removes the metadata, without touching the pixels.
   */
  alwaysReencode?: boolean

  /** To cancel a running job. */
  signal?: AbortSignal

  /**
   * A way to read the HEIC of iPhone photos. Chrome and Firefox cannot decode
   * them; Safari can. Give a decoder to cover everyone:
   *
   *     import { heicTo } from 'heic-to'
   *     prepareImage(file, { decodeHeic: (blob) => heicTo({ blob, type: 'image/jpeg' }) })
   */
  decodeHeic?: HeicDecoder

  /** Replaces the image operations. Used by tests and other environments. */
  imaging?: Imaging
}

export type HeicDecoder = (blob: Blob) => Promise<Blob>

/**
 * The result: the file to upload, and what happened on the way.
 */
export interface PreparedImage {
  /** The file ready to upload. */
  file: File
  format: Format
  width: number
  height: number
  bytes: number

  /** The image as it came in. */
  source: {
    type: string
    bytes: number
    width: number
    height: number
    orientation: Orientation
  }

  /** What was done, in order. Useful for a log or a test. */
  changed: Change[]
}

export type Change = 'decoded-heic' | 'rotated' | 'resized' | 'converted' | 'recompressed' | 'metadata-removed'

/**
 * The image operations of the browser, kept behind one interface: the rest
 * of the package never touches the canvas, so it is tested without a browser.
 */
export interface Imaging {
  /**
   * Decodes the file. The returned image is **always upright**: the
   * implementation applies the orientation, either through the browser or by
   * rotating itself. So its dimensions are the ones seen on screen.
   */
  decode(blob: Blob, orientation: Orientation): Promise<DecodedImage>

  /** Draws the image at the requested size and encodes it. */
  encode(image: DecodedImage, options: EncodeOptions): Promise<Blob>

  /** Can the browser write this format? */
  supports(format: Format): Promise<boolean>
}

export interface DecodedImage {
  readonly width: number
  readonly height: number
  /** Frees the memory. Always called by the package, even on error. */
  close(): void
}

export interface EncodeOptions {
  width: number
  height: number
  format: Format
  quality: number
  background: string
}
