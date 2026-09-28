/**
 * La seule erreur levee par le paquet. Le code dit quoi faire.
 *
 * The only error thrown by the package. The code says what to do about it.
 */
export class PrepareImageError extends Error {
  constructor(
    message: string,
    readonly code: PrepareImageErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PrepareImageError'
  }

  static notAnImage(type: string): PrepareImageError {
    return new PrepareImageError(
      `This file does not look like an image the browser can read (${type || 'unknown type'}).`,
      'not-an-image',
    )
  }

  static needsDecoder(): PrepareImageError {
    return new PrepareImageError(
      'This is a HEIC photo, and this browser cannot read it. Pass a decoder in the decodeHeic option.',
      'needs-decoder',
    )
  }

  static cannotDecode(cause: unknown): PrepareImageError {
    return new PrepareImageError('The browser could not read this image.', 'cannot-decode', { cause })
  }

  static cannotEncode(format: string, cause?: unknown): PrepareImageError {
    return new PrepareImageError(`The browser could not write this image as ${format}.`, 'cannot-encode', { cause })
  }

  static aborted(): PrepareImageError {
    return new PrepareImageError('The work was stopped.', 'aborted')
  }
}

export type PrepareImageErrorCode =
  | 'not-an-image'
  | 'needs-decoder'
  | 'cannot-decode'
  | 'cannot-encode'
  | 'aborted'
