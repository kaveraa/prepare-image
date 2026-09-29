# Prepare Image

<p align="center"><img src="https://raw.githubusercontent.com/kaveraa/prepare-image/main/art/banner.svg" alt="Prepare Image" width="100%"></p>

[![Tests](https://github.com/kaveraa/prepare-image/actions/workflows/tests.yml/badge.svg)](https://github.com/kaveraa/prepare-image/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/@kaveraa/prepare-image.svg)](https://www.npmjs.com/package/@kaveraa/prepare-image)
[![Downloads](https://img.shields.io/npm/dm/@kaveraa/prepare-image.svg)](https://www.npmjs.com/package/@kaveraa/prepare-image)
[![License](https://img.shields.io/github/license/kaveraa/prepare-image.svg)](https://github.com/kaveraa/prepare-image/blob/main/LICENSE)

**English** - [Français](https://github.com/kaveraa/prepare-image/blob/main/README.fr.md)

Between the file someone picks in a form and the image you want to store, there is a gap: 4 MB instead of 300 KB, a photo lying on its side, a HEIC that Chrome and Firefox cannot show, and the **GPS position of the place the photo was taken** - often a home address - carried inside the file.

```js
import { prepareImage } from '@kaveraa/prepare-image'

const ready = await prepareImage(file, { maxSize: 2000, format: 'webp' })

await fetch('/api/photos', { method: 'POST', body: formDataWith(ready.file) })
```

- **One call** for what usually takes three libraries.
- **iPhone photos**: HEIC is converted when the browser cannot read it, and only then.
- **Always upright**: the orientation recorded by the camera is applied to the pixels, then forgotten.
- **The location is gone**: no metadata comes out, no GPS, no camera model, no date.
- **No needless loss**: when nothing has to change, the pixels are not re-encoded, only the metadata is removed.
- **No dependency**, written in TypeScript, and the same code runs inside a Web Worker.

---

## Table of contents

- [The problem](#the-problem)
- [Installation](#installation)
- [Usage](#usage)
- [iPhone photos](#iphone-photos)
- [What is removed from the file](#what-is-removed-from-the-file)
- [What you get back](#what-you-get-back)
- [All the options](#all-the-options)
- [Fitting a size budget](#fitting-a-size-budget)
- [Inside a Web Worker](#inside-a-web-worker)
- [Errors](#errors)
- [Replacing the image operations](#replacing-the-image-operations)
- [What this package does not do](#what-this-package-does-not-do)
- [Development](#development)

## The problem

A form with a photo field is three lines of HTML. What comes after is a lot less so:

| What the phone hands you | What you wanted |
|---|---|
| `IMG_4821.HEIC`, unreadable by Chrome and Firefox | an image everybody can show |
| 4.2 MB | 280 KB |
| lying on its side, because the orientation is recorded apart | upright |
| `GPS 48.8566, 2.3522` | nothing |

Today people assemble `heic2any`, `browser-image-compression` and a piece of EXIF reading. The most downloaded of these libraries have not been published since 2022 or 2023. And the part that matters most to the people using your site - removing their location - is almost always forgotten.

## Installation

```bash
npm install @kaveraa/prepare-image
```

## Usage

```js
import { prepareImage } from '@kaveraa/prepare-image'

const input = document.querySelector('input[type=file]')

input.addEventListener('change', async () => {
  const file = input.files?.[0]

  if (!file) {
    return
  }

  const ready = await prepareImage(file)

  console.log(ready.file.name)  // IMG_4821.webp
  console.log(ready.bytes)      // 280114
  console.log(ready.changed)    // ['rotated', 'resized', 'converted', 'metadata-removed']

  const body = new FormData()
  body.append('photo', ready.file)

  await fetch('/api/photos', { method: 'POST', body })
})
```

With no option, the image is brought down to 2000 pixels on its longest edge, turned into WebP when the browser can write it, and freed of its metadata.

## iPhone photos

Since 2017, an iPhone saves its photos as HEIC. Safari can read them, Chrome and Firefox cannot. Decoding that format takes a heavy decoder, which most applications have no reason to load.

So the package works in this order: it asks the browser first, and turns to your decoder only if that fails. On Safari the decoder is never loaded.

```js
import { looksLikeHeic, prepareImage } from '@kaveraa/prepare-image'

const ready = await prepareImage(file, {
  // Loads the decoder only when it is really needed
  decodeHeic: async (blob) => {
    const { heicTo } = await import('heic-to')

    return heicTo({ blob, type: 'image/jpeg', quality: 0.92 })
  },
})
```

`looksLikeHeic(file)` reads the first bytes of the file only, if you would rather decide before calling.

The package also exports `sniff(bytes)`, which gives the real format of a file from its bytes and not from its name or the type the browser reports - a HEIC often arrives with an empty type, and a renamed file keeps its original bytes.

Without `decodeHeic`, a HEIC the browser cannot read throws a clear error instead of failing quietly.

## What is removed from the file

Everything. GPS position, camera model and serial number, date and time, shooting settings, thumbnail, comments, XMP.

Two paths, depending on what has to be done:

- **Something else has to be done** (resize, rotate, convert): the image is re-encoded, and a re-encode copies no metadata. Nothing survives.
- **Nothing else has to be done**: the pixels are left alone. The metadata blocks are removed from the file as it is, with no re-encode, so **with no loss of quality at all**.

To force a re-encode in every case, set `alwaysReencode: true`.

## What you get back

```ts
interface PreparedImage {
  file: File          // ready to go into a FormData
  format: 'webp' | 'jpeg' | 'png'
  width: number
  height: number
  bytes: number

  source: {           // the image as it arrived
    type: string
    bytes: number
    width: number     // size once turned upright
    height: number
    orientation: number
  }

  changed: Change[]   // what was done, in order
}
```

`changed` is there to explain, to log, or to say nothing at all when the list is empty.

## All the options

| Option | Default | Role |
|---|---|---|
| `maxSize` | `2000` | Longest edge, in pixels. The image is never enlarged |
| `format` | `'auto'` | `'webp'`, `'jpeg'`, `'png'`, or `'auto'`: WebP as soon as the browser can write it |
| `quality` | `0.82` | From 0 to 1. No effect on PNG |
| `maxBytes` | - | Size to aim for. The quality steps down to get close to it |
| `background` | `'#ffffff'` | Colour laid under transparency when the output is a JPEG |
| `alwaysReencode` | `false` | Re-encode even when nothing has to change |
| `decodeHeic` | - | Your HEIC decoder, called only if the browser fails |
| `signal` | - | An `AbortSignal` to stop the work |
| `imaging` | - | Replaces the image operations. See below |

## Fitting a size budget

```js
const ready = await prepareImage(file, { maxSize: 1600, maxBytes: 300 * 1024 })
```

The quality steps down until it fits the budget, without ever going under a level where the image would turn ugly. This is not a promise: a very detailed photo can stay above. Check `ready.bytes` if the size is a hard limit.

## Inside a Web Worker

The function only uses APIs a worker has. There is nothing to set up: put it in yours.

```js
// worker.js
import { prepareImage } from '@kaveraa/prepare-image'

onmessage = async (event) => {
  const ready = await prepareImage(event.data)

  postMessage(ready.file)
}
```

This helps when you handle several photos in a row: the main thread stays free and the page does not freeze.

## Errors

Every error of the package is a `PrepareImageError` and carries a `code`:

```js
import { PrepareImageError, prepareImage } from '@kaveraa/prepare-image'

try {
  await prepareImage(file)
} catch (error) {
  if (error instanceof PrepareImageError && error.code === 'needs-decoder') {
    // A HEIC photo, and no decoder was given
  }
}
```

| Code | When |
|---|---|
| `not-an-image` | The file is not an image we recognise |
| `needs-decoder` | A HEIC photo, and the browser cannot read it |
| `cannot-decode` | The browser could not read the image |
| `cannot-encode` | The browser cannot write the format asked for |
| `aborted` | The signal was fired |

## Replacing the image operations

The package never touches the canvas itself: everything goes through an `Imaging` interface. That is what makes the logic testable without a browser, and it leaves you free to replace it.

```ts
const ready = await prepareImage(file, {
  imaging: {
    decode: (blob, orientation) => ...,
    encode: (image, options) => ...,
    supports: (format) => ...,
  },
})
```

## What this package does not do

- **It uploads nothing.** It hands you a `File`, you choose how to send it.
- **It does not crop and does not retouch.** No cropping, no filters: other tools do that very well.
- **It does not decode HEIC on its own.** A decoder weighs a few hundred kilobytes: it has no place in a package many will install without needing it.
- **It does not replace a check on your server.** Anything happening in a browser can be worked around: keep validating what you receive.

## Development

```bash
git clone https://github.com/kaveraa/prepare-image.git
cd prepare-image
npm install
npx playwright install chromium
npm run test:all
```

The pure logic is tested under Node, and the real canvas in Chromium. To suggest a change, read the [CONTRIBUTING.md](https://github.com/kaveraa/prepare-image/blob/main/CONTRIBUTING.md) guide. See the [CHANGELOG](https://github.com/kaveraa/prepare-image/blob/main/CHANGELOG.md) for the history of versions.

To report a vulnerability, open a [private security advisory](https://github.com/kaveraa/prepare-image/security/advisories/new) rather than a public issue.

## License

MIT. See [LICENSE](https://github.com/kaveraa/prepare-image/blob/main/LICENSE).
