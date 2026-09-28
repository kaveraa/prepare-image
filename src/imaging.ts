/**
 * Les operations d'image du navigateur : decodage, rotation, redimensionnement,
 * encodage. Aucune dependance. Le fichier tourne aussi dans un Web Worker :
 * `document` n'est touche que dans les chemins de repli, et seulement apres
 * avoir verifie qu'il existe.
 *
 * The browser image operations: decode, rotate, resize, encode. No dependency,
 * and worker safe: `document` is only read in fallback paths, after a guard.
 */

import type { DecodedImage, EncodeOptions, Format, Imaging, Orientation } from './types'

/**
 * Un JPEG de 2x1 pixels (gauche rouge, droite bleu) portant l'orientation 6 en
 * EXIF. Affiche droit, il mesure donc 1x2 : largeur et hauteur echangees. Il
 * sert de temoin pour savoir si le navigateur honore vraiment l'option
 * `imageOrientation: 'from-image'`, car certains moteurs l'ignorent en silence
 * au lieu de lever une erreur.
 *
 * A 2x1 JPEG tagged with EXIF orientation 6, so an engine that applies the
 * orientation reports 1x2. Used to probe `imageOrientation: 'from-image'`.
 */
const PROBE_JPEG_BASE64 =
  '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERAT' +
  'GCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARES' +
  'EhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj' +
  'Y2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAaEAEAAQUA' +
  'AAAAAAAAAAAAAAAAAQIDM3Kx/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwb/xAAZEQABBQAAAAAAAAAA' +
  'AAAAAAAAAQIDM3H/2gAMAwEAAhEDEQA/AJC9mr2noC3gqbiAzWO1T//Z'

/** Le type MIME de chaque format. */
const MIME: Record<Format, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/** Les formats qui gardent la transparence. Le JPEG, non. */
const KEEPS_ALPHA: Record<Format, boolean> = {
  webp: true,
  png: true,
  jpeg: false,
}

/** Tout ce que `drawImage` sait dessiner ici. */
type DrawSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

/** Un canevas et son contexte, quelle que soit sa sorte. */
interface Surface {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  readonly ctx: CanvasRenderingContext2D
}

/** Les orientations 5 a 8 font un quart de tour : elles echangent les cotes. */
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

/** Le JPEG temoin, en Blob. */
function probeBlob(): Blob {
  const binary = atob(PROBE_JPEG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}

/**
 * Un canevas de travail. `OffscreenCanvas` d'abord : il n'occupe pas le fil
 * principal et existe dans un Worker. Sinon un `<canvas>` du document.
 */
function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('prepare-image: no 2d context on the offscreen canvas')
    // Les deux contextes 2d partagent la meme surface d'API ; on aligne les types.
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

/** Encode un canevas, avec `convertToBlob()` quand c'est possible. */
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
  // Un canevas qui rend `null` veut dire, en pratique, un format refuse.
  if (!blob) throw new Error(`prepare-image: the canvas returned nothing for ${type}`)
  return blob
}

/**
 * Pose la rotation (et le miroir) d'une orientation EXIF sur le contexte.
 * `width` et `height` sont les cotes vus apres rotation.
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
 * Une image decodee, prete a etre dessinee. `width` et `height` sont toujours
 * les cotes vus a l'ecran, quart de tour compris.
 *
 * A decoded image ready to be drawn. Its size is always the displayed one.
 */
class CanvasImage implements DecodedImage {
  readonly width: number
  readonly height: number

  /** La source dessinable, ou `null` une fois fermee. */
  #source: DrawSource | null
  /** La rotation qui reste a poser au dessin ; 1 si le navigateur l'a deja faite. */
  #pending: Orientation
  /** L'URL d'objet a liberer, s'il y en a une. */
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

  /** De quoi dessiner : la source et la rotation restante. Leve si l'image est fermee. */
  take(): { source: DrawSource; pending: Orientation } {
    const source = this.#source
    if (!source) throw new Error('prepare-image: this image was already closed with close()')
    return { source, pending: this.#pending }
  }

  /** Libere la memoire. Un second appel ne fait rien et ne leve pas. */
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

/** Charge un `HTMLImageElement` depuis une URL. */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('prepare-image: the browser could not read this file'))
    image.src = url
  })
}

/**
 * La fabrique. Chaque instance garde ses propres reponses de temoin et de
 * `supports()`, pour que rien ne fuite d'un test a l'autre.
 *
 * The factory. Each instance keeps its own probe and `supports()` answers.
 */
export function createBrowserImaging(): Imaging {
  /** Temoin : `createImageBitmap` honore-t-il `imageOrientation: 'from-image'` ? */
  let bitmapProbe: Promise<boolean> | undefined
  /** Temoin : un `HTMLImageElement` applique-t-il l'orientation du fichier ? */
  let elementProbe: Promise<boolean> | undefined
  /** Une reponse par format, calculee une seule fois. */
  const supportCache = new Map<Format, Promise<boolean>>()

  function bitmapAppliesOrientation(): Promise<boolean> {
    // Un seul essai, garde pour toute la vie de l'instance.
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
      // Le navigateur tourne lui-meme : les cotes rendus sont deja les bons.
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return new CanvasImage(bitmap, bitmap.width, bitmap.height, 1, null)
    }
    // Sinon on garde les pixels tels quels et on tournera au moment du dessin.
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
      // `naturalWidth` suit deja l'orientation quand le moteur l'applique.
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
   * Decode le fichier. L'image rendue est toujours droite.
   *
   * Decode the file. The returned image is always upright.
   */
  async function decode(blob: Blob, orientation: Orientation): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
      try {
        return await decodeWithBitmap(blob, orientation)
      } catch {
        // Repli sur l'element image : certains moteurs refusent des fichiers
        // que le `<img>` accepte quand meme.
      }
    }
    return await decodeWithElement(blob, orientation)
  }

  /**
   * Dessine l'image a la taille demandee et l'encode.
   *
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

    // 1. Poser la rotation si le navigateur ne l'a pas faite.
    if (pending !== 1) {
      const swap = swapsAxes(pending)
      const sourceWidth = swap ? image.height : image.width
      const sourceHeight = swap ? image.width : image.height
      const surface = createSurface(image.width, image.height)
      applyOrientation(surface.ctx, pending, image.width, image.height)
      surface.ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight)
      current = surface.canvas
    }

    // 2. Descendre par moities successives tant que la reduction depasse un
    //    facteur 2. Chromium filtre bien un gros ecart en un seul `drawImage`,
    //    mais d'autres moteurs se contentent de quatre pixels voisins et
    //    crenelent l'image. Deux moities coutent peu et lissent partout.
    //    On prefere cette boucle a
    //    `createImageBitmap(..., { resizeQuality: 'high' })` parce que tous les
    //    moteurs ne suivent pas cette option, et l'ignorent sans rien dire.
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

    // 3. Le dessin final, sur le fond demande quand le format perd la transparence.
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
    // Un moteur qui ne sait pas ecrire le WebP rend un PNG sans se plaindre :
    // on verifie donc le type du blob, jamais la seule absence d'erreur.
    if (blob.type !== type) {
      throw new Error(
        `prepare-image: the browser returned ${blob.type || 'an unknown type'} instead of ${type}`,
      )
    }
    return blob
  }

  /**
   * Le navigateur sait-il ecrire ce format ? Un seul essai par format, garde.
   *
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
 * L'implementation par defaut, partagee par tout le paquet.
 *
 * The default implementation, shared by the whole package.
 */
export const browserImaging: Imaging = createBrowserImaging()
