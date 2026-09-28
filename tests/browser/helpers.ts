/**
 * De quoi fabriquer et relire des images dans le test lui-meme, sans fichier
 * joint : un canevas ecrit l'image, un autre la relit pixel par pixel.
 *
 * Test helpers: build images with a canvas, read them back pixel by pixel.
 */

export type Rgba = readonly [number, number, number, number]

/** Un canevas de travail pour les tests. */
export function testSurface(width: number, height: number): {
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
} {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context in test')
  return { canvas, ctx }
}

/** Dessine une image et rend le Blob encode. */
export async function drawToBlob(
  width: number,
  height: number,
  draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
  type = 'image/png',
  quality = 0.92,
): Promise<Blob> {
  const { canvas, ctx } = testSurface(width, height)
  draw(ctx)
  return await canvas.convertToBlob({ type, quality })
}

/** Les quatre quadrants, chacun d'une couleur franche. */
export function drawQuadrants(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const halfWidth = width / 2
  const halfHeight = height / 2
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, halfWidth, halfHeight)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(halfWidth, 0, halfWidth, halfHeight)
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, halfHeight, halfWidth, halfHeight)
  ctx.fillStyle = '#ffff00'
  ctx.fillRect(halfWidth, halfHeight, halfWidth, halfHeight)
}

/** Les pixels d'un Blob image, relus a travers un canevas neutre. */
export class Pixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray

  private constructor(width: number, height: number, data: Uint8ClampedArray) {
    this.width = width
    this.height = height
    this.data = data
  }

  static async from(blob: Blob): Promise<Pixels> {
    const bitmap = await createImageBitmap(blob)
    const { ctx } = testSurface(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0)
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    bitmap.close()
    return new Pixels(image.width, image.height, image.data)
  }

  at(x: number, y: number): Rgba {
    const index = (y * this.width + x) * 4
    return [
      this.data[index] ?? 0,
      this.data[index + 1] ?? 0,
      this.data[index + 2] ?? 0,
      this.data[index + 3] ?? 0,
    ]
  }

  /** La couleur moyenne d'une zone, alpha compris. */
  average(x: number, y: number, width: number, height: number): Rgba {
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 0
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        const pixel = this.at(column, row)
        red += pixel[0]
        green += pixel[1]
        blue += pixel[2]
        alpha += pixel[3]
      }
    }
    const count = width * height
    return [red / count, green / count, blue / count, alpha / count]
  }
}

/** Ecart maximum entre deux couleurs, canal par canal. */
export function colorDistance(left: Rgba, right: Rgba): number {
  let worst = 0
  for (let channel = 0; channel < 4; channel += 1) {
    worst = Math.max(worst, Math.abs((left[channel] ?? 0) - (right[channel] ?? 0)))
  }
  return worst
}

/**
 * Glisse un segment EXIF (APP1) portant une orientation dans un JPEG, juste
 * apres le marqueur de debut. Les octets sont assembles a la main : entete
 * TIFF gros-boutien, une seule entree, le champ Orientation (0x0112).
 *
 * Insert an EXIF APP1 segment carrying an orientation into a JPEG.
 */
export function withExifOrientation(
  jpeg: Uint8Array,
  orientation: number,
): Uint8Array<ArrayBuffer> {
  const segment = new Uint8Array(36)
  const view = new DataView(segment.buffer)
  view.setUint16(0, 0xffe1) // marqueur APP1
  view.setUint16(2, 34) // longueur du segment, champ de longueur compris
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4) // "Exif\0\0"
  view.setUint16(10, 0x4d4d) // "MM" : gros-boutien
  view.setUint16(12, 0x002a) // nombre magique TIFF
  view.setUint32(14, 8) // decalage de l'IFD0
  view.setUint16(18, 1) // une entree
  view.setUint16(20, 0x0112) // Orientation
  view.setUint16(22, 3) // type SHORT
  view.setUint32(24, 1) // un element
  view.setUint16(28, orientation)
  view.setUint16(30, 0) // bourrage
  view.setUint32(32, 0) // pas d'IFD suivant

  const out = new Uint8Array(jpeg.length + segment.length)
  out.set(jpeg.subarray(0, 2), 0)
  out.set(segment, 2)
  out.set(jpeg.subarray(2), 2 + segment.length)
  return out
}

/** Un JPEG dessine puis marque d'une orientation EXIF. */
export async function jpegWithOrientation(
  width: number,
  height: number,
  draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
  orientation: number,
): Promise<Blob> {
  const plain = await drawToBlob(width, height, draw, 'image/jpeg', 0.95)
  const bytes = new Uint8Array(await plain.arrayBuffer())
  return new Blob([withExifOrientation(bytes, orientation)], { type: 'image/jpeg' })
}
