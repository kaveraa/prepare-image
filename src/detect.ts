/**
 * Reconnaissance du format par les octets d'en-tete.
 *
 * `file.type` ment souvent : plusieurs navigateurs annoncent un type vide pour
 * un HEIC, et un fichier renomme en `.jpg` garde ses octets d'origine. On ne
 * regarde donc ni le nom ni le type annonce, seulement le debut du fichier.
 */

/** Les formats que l'on sait reconnaitre. */
export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'heic' | 'avif' | 'tiff' | 'bmp' | 'unknown'

/**
 * Les marques ISO-BMFF de la famille HEIF. `mif1` et `msf1` sont generiques :
 * un AVIF peut les porter aussi, on ne tranche donc pas dessus tout de suite.
 */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']
const AMBIGUOUS_BRANDS = ['mif1', 'msf1']
const AVIF_BRANDS = ['avif', 'avis']

/** Au-dela, on renonce : un en-tete sain place `ftyp` dans les toutes premieres boites. */
const MAX_BOXES = 8

/** Lit un octet ; rend 0 au-dela de la fin, ce qui evite les tests de bornes partout. */
function at(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset]
  return value === undefined ? 0 : value
}

/** La suite d'octets a cette position vaut-elle ce texte ASCII ? */
function matches(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (at(bytes, offset + i) !== text.charCodeAt(i)) return false
  }
  return true
}

/** Quatre octets lus comme du texte ASCII. Rend '' si on deborde. */
function fourcc(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return ''
  return String.fromCharCode(at(bytes, offset), at(bytes, offset + 1), at(bytes, offset + 2), at(bytes, offset + 3))
}

/** Entier 32 bits gros-boutiste. */
function u32be(bytes: Uint8Array, offset: number): number {
  return ((at(bytes, offset) << 24) | (at(bytes, offset + 1) << 16) | (at(bytes, offset + 2) << 8) | at(bytes, offset + 3)) >>> 0
}

/**
 * Cherche la boite `ftyp` et rend les marques qu'elle porte, la principale en
 * tete. La boite n'est pas toujours la premiere : on suit les tailles annoncees
 * de boite en boite, en refusant toute taille absurde pour ne jamais boucler.
 */
function readFtypBrands(bytes: Uint8Array): string[] | null {
  let offset = 0
  for (let box = 0; box < MAX_BOXES; box += 1) {
    if (offset + 8 > bytes.length) return null
    const declared = u32be(bytes, offset)
    const type = fourcc(bytes, offset + 4)
    let header = 8
    let size = declared
    if (declared === 1) {
      // Taille sur 64 bits. Au-dela de 4 Go on renonce : ce n'est pas une photo.
      if (offset + 16 > bytes.length) return null
      if (u32be(bytes, offset + 8) !== 0) return null
      size = u32be(bytes, offset + 12)
      header = 16
    } else if (declared === 0) {
      // 0 signifie "jusqu'a la fin du fichier".
      size = bytes.length - offset
    }
    if (size < header) return null
    if (type === 'ftyp') {
      const end = Math.min(offset + size, bytes.length)
      const brands: string[] = []
      const major = fourcc(bytes, offset + header)
      if (major === '') return null
      brands.push(major)
      // On saute la version mineure, puis on lit les marques compatibles.
      for (let p = offset + header + 8; p + 4 <= end; p += 4) {
        brands.push(fourcc(bytes, p))
      }
      return brands
    }
    offset += size
  }
  return null
}

/** AVIF, HEIC, ou rien du tout, a partir des marques de la boite `ftyp`. */
function kindFromBrands(brands: string[]): ImageKind {
  const major = brands[0] ?? ''
  if (AVIF_BRANDS.includes(major)) return 'avif'
  if (HEIC_BRANDS.includes(major) && !AMBIGUOUS_BRANDS.includes(major)) return 'heic'
  // Marque principale generique : ce sont les marques compatibles qui tranchent,
  // et l'AVIF l'emporte car un HEIC ne se declare jamais compatible AVIF.
  const compatible = brands.slice(1)
  if (compatible.some((brand) => AVIF_BRANDS.includes(brand))) return 'avif'
  if (compatible.some((brand) => HEIC_BRANDS.includes(brand))) return 'heic'
  if (HEIC_BRANDS.includes(major)) return 'heic'
  return 'unknown'
}

/**
 * Reconnait le format par les octets d'en-tete, pas par le nom ni par le type
 * annonce. Rend `'unknown'` quand rien ne correspond.
 *
 * Recognises the format from the leading bytes, never from the name or the
 * declared type. Returns `'unknown'` when nothing matches.
 */
export function sniff(bytes: Uint8Array): ImageKind {
  if (bytes.length < 3) return 'unknown'
  if (at(bytes, 0) === 0xff && at(bytes, 1) === 0xd8 && at(bytes, 2) === 0xff) return 'jpeg'
  if (matches(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'png'
  if (matches(bytes, 0, 'GIF87a') || matches(bytes, 0, 'GIF89a')) return 'gif'
  if (matches(bytes, 0, 'RIFF') && matches(bytes, 8, 'WEBP')) return 'webp'
  if (matches(bytes, 0, 'II') && at(bytes, 2) === 0x2a && at(bytes, 3) === 0x00) return 'tiff'
  if (matches(bytes, 0, 'MM') && at(bytes, 2) === 0x00 && at(bytes, 3) === 0x2a) return 'tiff'

  const brands = readFtypBrands(bytes)
  if (brands !== null) {
    const kind = kindFromBrands(brands)
    if (kind !== 'unknown') return kind
  }

  // En dernier, car deux octets seulement : tout le reste passe avant.
  if (matches(bytes, 0, 'BM')) return 'bmp'
  return 'unknown'
}

/**
 * Le type MIME correspondant, ou `null` pour `'unknown'`.
 *
 * The matching MIME type, or `null` for `'unknown'`.
 */
export function mimeOf(kind: ImageKind): string | null {
  switch (kind) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heic':
      return 'image/heic'
    case 'avif':
      return 'image/avif'
    case 'tiff':
      return 'image/tiff'
    case 'bmp':
      return 'image/bmp'
    case 'unknown':
      return null
  }
}
