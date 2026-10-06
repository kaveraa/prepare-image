/**
 * The browser image operations: decode, rotate, resize, encode. No dependency,
 * and worker safe: `document` is only read in fallback paths, after a guard.
 */

import type { DecodedImage, EncodeOptions, Format, Imaging, Orientation } from './types'

/**
 * A 2x1 JPEG (left red, right blue) tagged with EXIF orientation 6. Shown
 * upright it measures 1x2: width and height swapped. It is used to probe
 * whether the browser really honours `imageOrientation: 'from-image'`, as
 * some engines silently ignore it instead of throwing.
 */
const PROBE_JPEG_BASE64 =
  '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERAT' +
  'GCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARES' +
  'EhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj' +
  'Y2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAaEAEAAQUA' +
  'AAAAAAAAAAAAAAAAAQIDM3Kx/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwb/xAAZEQABBQAAAAAAAAAA' +
  'AAAAAAAAAQIDM3H/2gAMAwEAAhEDEQA/AJC9mr2noC3gqbiAzWO1T//Z'

/** The MIME type of each format. */
const MIME: Record<Format, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/** The formats that keep transparency. JPEG does not. */
const KEEPS_ALPHA: Record<Format, boolean> = {
  webp: true,
  png: true,
  jpeg: false,
}

/** Everything `drawImage` can draw here. */
type DrawSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

/** A canvas and its context, whatever its kind. */
interface Surface {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  readonly ctx: CanvasRenderingContext2D
}

/** Orientations 5 to 8 are a quarter turn: they swap the sides. */
function swapsAxes(orientation: Orientation): boolean {
  return orientation >= 5
}

function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 1
  return Math.min(1, Math.max(0, quality))
}

function toSize(value: number): number {
  return Math.max(1, Math.round(value))
}

/** The probe JPEG, as a Blob. */
function probeBlob(): Blob {
  const binary = atob(PROBE_JPEG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}

/**
 * A working canvas. `OffscreenCanvas` first: it does not block the main
 * thread and exists in a Worker. Otherwise a `<canvas>` of the document.
 */
function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('prepare-image: no 2d context on the offscreen canvas')
    // Both 2d contexts share the same API surface; we align the types.
    return { canvas, ctx: ctx as unknown as CanvasRenderingContext2D }
  }
  if (typeof document === 'undefined') {
    throw new Error('prepare-image: no canvas available in this environment')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('prepare-image: no 2d context on the canvas')
  return { canvas, ctx }
}

/** Encodes a canvas, with `convertToBlob()` when possible. */
async function surfaceToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob({ type, quality })
  }
  const element = canvas as HTMLCanvasElement
  const blob = await new Promise<Blob | null>((resolve) => {
    element.toBlob(resolve, type, quality)
  })
  // A canvas returning `null` means, in practice, a refused format.
  if (!blob) throw new Error(`prepare-image: the canvas returned nothing for ${type}`)
  return blob
}

/**
 * Applies the rotation (and the mirror) of an EXIF orientation to the context.
 * `width` and `height` are the sides seen after rotation.
 */
function applyOrientation(
  ctx: CanvasRenderingContext2D,
  orientation: Orientation,
  width: number,
  height: number,
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, width, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, width, height)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, height)
      break
    default:
      break
  }
}

/**
 * A decoded image ready to be drawn. Its size is always the displayed one.
 */
class CanvasImage implements DecodedImage {
  readonly width: number
  readonly height: number

  /** The drawable source, or `null` once closed. */
  #source: DrawSource | null
  /** The rotation still to apply when drawing; 1 if the browser already did it. */
  #pending: Orientation
  /** The object URL to release, if there is one. */
  #objectUrl: string | null

  constructor(
    source: DrawSource,
    width: number,
    height: number,
    pending: Orientation,
    objectUrl: string | null,
  ) {
    this.#source = source
    this.width = width
    this.height = height
    this.#pending = pending
    this.#objectUrl = objectUrl
  }

  /** What to draw: the source and the remaining rotation. Throws if the image is closed. */
  take(): { source: DrawSource; pending: Orientation } {
    const source = this.#source
    if (!source) throw new Error('prepare-image: this image was already closed with close()')
    return { source, pending: this.#pending }
  }

  /** Frees the memory. A second call does nothing and does not throw. */
  close(): void {
    const source = this.#source
    this.#source = null
    const url = this.#objectUrl
    this.#objectUrl = null
    if (url) URL.revokeObjectURL(url)
    if (source && typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
      source.close()
    }
  }
}

/** Loads an `HTMLImageElement` from a URL. */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('prepare-image: the browser could not read this file'))
    image.src = url
  })
}

/**
 * The factory. Each instance keeps its own probe and `supports()` answers,
 * so that nothing leaks from one test to the next.
 */
export function createBrowserImaging(): Imaging {
  /** Probe: does `createImageBitmap` honour `imageOrientation: 'from-image'`? */
  let bitmapProbe: Promise<boolean> | undefined
  /** Probe: does an `HTMLImageElement` apply the orientation of the file? */
  let elementProbe: Promise<boolean> | undefined
  /** One answer per format, computed only once. */
  const supportCache = new Map<Format, Promise<boolean>>()

  function bitmapAppliesOrientation(): Promise<boolean> {
    // A single try, kept for the whole life of the instance.
    bitmapProbe ??= (async () => {
      try {
        const bitmap = await createImageBitmap(probeBlob(), { imageOrientation: 'from-image' })
        const applied = bitmap.width === 1 && bitmap.height === 2
        bitmap.close()
        return applied
      } catch {
        return false
      }
    })()
    return bitmapProbe
  }

  function elementAppliesOrientation(): Promise<boolean> {
    elementProbe ??= (async () => {
      if (typeof document === 'undefined') return false
      try {
        const url = URL.createObjectURL(probeBlob())
        try {
          const image = await loadImageElement(url)
          return image.naturalWidth === 1 && image.naturalHeight === 2
        } finally {
          URL.revokeObjectURL(url)
        }
      } catch {
        return false
      }
    })()
    return elementProbe
  }

  async function decodeWithBitmap(blob: Blob, orientation: Orientation): Promise<CanvasImage> {
    if (await bitmapAppliesOrientation()) {
      // The browser rotates by itself: the returned sides are already right.
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return new CanvasImage(bitmap, bitmap.width, bitmap.height, 1, null)
    }
    // Otherwise we keep the pixels as is and rotate when drawing.
    const bitmap = await createImageBitmap(blob)
    const swap = swapsAxes(orientation)
    return new CanvasImage(
      bitmap,
      swap ? bitmap.height : bitmap.width,
      swap ? bitmap.width : bitmap.height,
      orientation,
      null,
    )
  }

  async function decodeWithElement(blob: Blob, orientation: Orientation): Promise<CanvasImage> {
    if (typeof document === 'undefined') {
      throw new Error('prepare-image: no way to decode an image in this environment')
    }
    const applies = await elementAppliesOrientation()
    const url = URL.createObjectURL(blob)
    try {
      const image = await loadImageElement(url)
      // `naturalWidth` already follows the orientation when the engine applies it.
      if (applies) {
        return new CanvasImage(image, image.naturalWidth, image.naturalHeight, 1, url)
      }
      const swap = swapsAxes(orientation)
      return new CanvasImage(
        image,
        swap ? image.naturalHeight : image.naturalWidth,
        swap ? image.naturalWidth : image.naturalHeight,
        orientation,
        url,
      )
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  }

  /**
   * Decode the file. The returned image is always upright.
   */
  async function decode(blob: Blob, orientation: Orientation): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
      try {
        return await decodeWithBitmap(blob, orientation)
      } catch {
        // Fallback to the image element: some engines refuse files that
        // the `<img>` still accepts.
      }
    }
    return await decodeWithElement(blob, orientation)
  }

  /**
   * Draw the image at the requested size and encode it.
   */
  async function encode(image: DecodedImage, options: EncodeOptions): Promise<Blob> {
    if (!(image instanceof CanvasImage)) {
      throw new Error('prepare-image: this image does not come from this decoder')
    }
    const width = toSize(options.width)
    const height = toSize(options.height)
    const { source, pending } = image.take()

    let current: DrawSource = source
    let currentWidth = image.width
    let currentHeight = image.height

    // 1. Apply the rotation if the browser did not do it.
    if (pending !== 1) {
      const swap = swapsAxes(pending)
      const sourceWidth = swap ? image.height : image.width
      const sourceHeight = swap ? image.width : image.height
      const surface = createSurface(image.width, image.height)
      applyOrientation(surface.ctx, pending, image.width, image.height)
      surface.ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight)
      current = surface.canvas
    }

    // 2. Go down by successive halves while the reduction is above a
    //    factor of 2. Chromium filters a big gap well in a single `drawImage`,
    //    but other engines only use four neighbour pixels and produce
    //    aliasing. Two halves cost little and smooth everywhere.
    //    We prefer this loop to
    //    `createImageBitmap(..., { resizeQuality: 'high' })` because not all
    //    engines follow that option, and they ignore it without a word.
    while (currentWidth > width * 2 || currentHeight > height * 2) {
      const nextWidth = Math.max(width, Math.floor(currentWidth / 2))
      const nextHeight = Math.max(height, Math.floor(currentHeight / 2))
      const step = createSurface(nextWidth, nextHeight)
      step.ctx.imageSmoothingEnabled = true
      step.ctx.imageSmoothingQuality = 'high'
      step.ctx.drawImage(current, 0, 0, nextWidth, nextHeight)
      current = step.canvas
      currentWidth = nextWidth
      currentHeight = nextHeight
    }

    // 3. The final drawing, on the requested background when the format loses transparency.
    const target = createSurface(width, height)
    if (!KEEPS_ALPHA[options.format]) {
      target.ctx.fillStyle = options.background
      target.ctx.fillRect(0, 0, width, height)
    }
    target.ctx.imageSmoothingEnabled = true
    target.ctx.imageSmoothingQuality = 'high'
    target.ctx.drawImage(current, 0, 0, width, height)

    const type = MIME[options.format]
    let blob: Blob
    try {
      blob = await surfaceToBlob(target.canvas, type, clampQuality(options.quality))
    } catch (cause) {
      throw new Error(`prepare-image: the browser cannot write ${options.format}`, {
        cause,
      })
    }
    // An engine that cannot write WebP returns a PNG without complaining:
    // so we check the type of the blob, never just the absence of an error.
    if (blob.type !== type) {
      throw new Error(
        `prepare-image: the browser returned ${blob.type || 'an unknown type'} instead of ${type}`,
      )
    }
    return blob
  }

  /**
   * Can the browser write this format? Probed once per format, then cached.
   */
  function supports(format: Format): Promise<boolean> {
    let answer = supportCache.get(format)
    if (!answer) {
      answer = (async () => {
        const type = MIME[format]
        try {
          const surface = createSurface(1, 1)
          const blob = await surfaceToBlob(surface.canvas, type, 1)
          return blob.type === type
        } catch {
          return false
        }
      })()
      supportCache.set(format, answer)
    }
    return answer
  }

  return { decode, encode, supports }
}

/**
 * The default implementation, shared by the whole package.
 */
export const browserImaging: Imaging = createBrowserImaging()
