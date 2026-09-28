/**
 * L'orientation notee dans le fichier par l'appareil photo, de 1 a 8.
 * 1 signifie "deja droite" ; 6 et 8 sont les deux quarts de tour habituels
 * d'un telephone tenu verticalement.
 *
 * The orientation recorded in the file by the camera, from 1 to 8.
 */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** Les formats que le paquet sait ecrire. */
export type Format = 'webp' | 'jpeg' | 'png'

/**
 * Ce que l'on demande a `prepareImage()`.
 *
 * What `prepareImage()` is asked to do.
 */
export interface PrepareOptions {
  /**
   * Cote le plus long, en pixels. L'image n'est jamais agrandie.
   * Par defaut : 2000.
   */
  maxSize?: number

  /**
   * Format de sortie. `'auto'` garde le PNG quand l'image a de la transparence,
   * et choisit le WebP sinon, avec repli sur le JPEG si le navigateur ne sait
   * pas ecrire le WebP. Par defaut : `'auto'`.
   */
  format?: Format | 'auto'

  /** Qualite, de 0 a 1. Sans effet sur le PNG. Par defaut : 0.82. */
  quality?: number

  /**
   * Poids maximum du resultat, en octets. La qualite est abaissee par paliers
   * jusqu'a tenir dans ce budget. Sans garantie : une image peut rester au-dessus.
   */
  maxBytes?: number

  /**
   * Couleur posee sous les zones transparentes quand la sortie ne garde pas la
   * transparence (JPEG). Par defaut : blanc.
   */
  background?: string

  /**
   * Reencoder meme quand rien n'a besoin de changer. Par defaut : false, et le
   * paquet se contente alors de retirer les metadonnees, sans toucher aux pixels.
   */
  alwaysReencode?: boolean

  /** Pour annuler un traitement en cours. */
  signal?: AbortSignal

  /**
   * De quoi lire le HEIC des photos d'iPhone. Chrome et Firefox ne savent pas
   * les decoder ; Safari, si. Donnez un decodeur pour couvrir tout le monde :
   *
   *     import { heicTo } from 'heic-to'
   *     prepareImage(file, { decodeHeic: (blob) => heicTo({ blob, type: 'image/jpeg' }) })
   */
  decodeHeic?: HeicDecoder

  /** Remplace les operations d'image. Sert aux tests et aux autres environnements. */
  imaging?: Imaging
}

export type HeicDecoder = (blob: Blob) => Promise<Blob>

/**
 * Le resultat : le fichier a envoyer, et de quoi savoir ce qui s'est passe.
 *
 * The result: the file to upload, and what happened on the way.
 */
export interface PreparedImage {
  /** Le fichier pret a partir. */
  file: File
  format: Format
  width: number
  height: number
  bytes: number

  /** L'image telle qu'elle est arrivee. */
  source: {
    type: string
    bytes: number
    width: number
    height: number
    orientation: Orientation
  }

  /** Ce qui a ete fait, dans l'ordre. Utile pour un journal ou un test. */
  changed: Change[]
}

export type Change = 'decoded-heic' | 'rotated' | 'resized' | 'converted' | 'recompressed' | 'metadata-removed'

/**
 * Les operations d'image du navigateur, isolees derriere une interface : le
 * reste du paquet ne touche jamais au canevas, et se teste donc sans navigateur.
 *
 * The image operations of the browser, kept behind one interface.
 */
export interface Imaging {
  /**
   * Decode le fichier. L'image rendue est **toujours droite** : l'implementation
   * applique l'orientation, soit en s'appuyant sur le navigateur, soit en
   * tournant elle-meme. Ses dimensions sont donc celles vues a l'ecran.
   */
  decode(blob: Blob, orientation: Orientation): Promise<DecodedImage>

  /** Dessine l'image a la taille demandee et l'encode. */
  encode(image: DecodedImage, options: EncodeOptions): Promise<Blob>

  /** Le navigateur sait-il ecrire ce format ? */
  supports(format: Format): Promise<boolean>
}

export interface DecodedImage {
  readonly width: number
  readonly height: number
  /** Libere la memoire. Toujours appele par le paquet, meme en cas d'erreur. */
  close(): void
}

export interface EncodeOptions {
  width: number
  height: number
  format: Format
  quality: number
  background: string
}
