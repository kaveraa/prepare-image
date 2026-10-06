import { describe, expect, it } from 'vitest'
import { readMetadata } from '../../src/exif'
import { stripMetadata } from '../../src/strip'
import { ascii, concat, exifPayload, jpeg, png, IDAT_DATA, IHDR_DATA } from './fixtures'

/**
 * The ICC profile says which colours to display. It is not personal data,
 * and removing it would break the tints of a wide-gamut photo. So it must
 * go through the cleanup untouched.
 */
const ICC = concat([ascii('ICC_PROFILE\0'), new Uint8Array([0x01, 0x01]), new Uint8Array(24)])

describe('the colour profile', () => {
  it('survives the cleaning, while the rest goes', () => {
    const file = jpeg({ app1: exifPayload({ orientation: 6, gps: true }), app2: ICC, comment: 'taken with a phone' })

    const before = readMetadata(file, 'jpeg')
    expect(before.hasMetadata).toBe(true)
    expect(before.hasLocation).toBe(true)

    const cleaned = stripMetadata(file, 'jpeg')
    expect(cleaned).not.toBeNull()

    const after = readMetadata(cleaned as Uint8Array, 'jpeg')
    expect(after.hasMetadata).toBe(false)
    expect(after.hasLocation).toBe(false)
    expect(after.orientation).toBe(1)

    // The profile is still there, whole.
    expect(indexOfBytes(cleaned as Uint8Array, ascii('ICC_PROFILE'))).toBeGreaterThan(0)
  })

  it('is not a reason to clean a file that has nothing else', () => {
    const file = jpeg({ app2: ICC })

    // Nothing to remove: the package must not announce a cleanup that does not happen.
    expect(readMetadata(file, 'jpeg').hasMetadata).toBe(false)

    const cleaned = stripMetadata(file, 'jpeg')
    expect(cleaned).not.toBeNull()
    expect(Array.from(cleaned as Uint8Array)).toEqual(Array.from(file))
  })
})

describe('the png modification time', () => {
  it('is seen as metadata, since the cleaning removes it', () => {
    const file = png([
      ['IHDR', IHDR_DATA],
      ['tIME', concat([new Uint8Array([0x07, 0xea]), new Uint8Array([9, 29, 21, 30, 0])])],
      ['IDAT', IDAT_DATA],
      ['IEND', new Uint8Array(0)],
    ])

    expect(readMetadata(file, 'png').hasMetadata).toBe(true)

    const cleaned = stripMetadata(file, 'png')
    expect(cleaned).not.toBeNull()
    expect(indexOfBytes(cleaned as Uint8Array, ascii('tIME'))).toBe(-1)
    expect(readMetadata(cleaned as Uint8Array, 'png').hasMetadata).toBe(false)
  })
})

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer
    }

    return start
  }

  return -1
}
