# Prepare Image

<p align="center"><img src="https://raw.githubusercontent.com/kaveraa/prepare-image/main/art/banner.svg" alt="Prepare Image" width="100%"></p>

[![Tests](https://github.com/kaveraa/prepare-image/actions/workflows/tests.yml/badge.svg)](https://github.com/kaveraa/prepare-image/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/@kaveraa/prepare-image.svg)](https://www.npmjs.com/package/@kaveraa/prepare-image)
[![Taille](https://img.shields.io/bundlephobia/minzip/@kaveraa/prepare-image.svg)](https://bundlephobia.com/package/@kaveraa/prepare-image)
[![Licence](https://img.shields.io/github/license/kaveraa/prepare-image.svg)](https://github.com/kaveraa/prepare-image/blob/main/LICENSE)

**Français** - [English](https://github.com/kaveraa/prepare-image/blob/main/README.en.md)

Entre le fichier qu'une personne choisit dans un formulaire et l'image que vous voulez stocker, il y a un gouffre : 4 Mo au lieu de 300 Ko, une photo couchée sur le côté, un HEIC que Chrome et Firefox ne savent pas afficher, et les **coordonnées GPS du lieu de la prise de vue** - souvent le domicile - embarquées dans le fichier.

```js
import { prepareImage } from '@kaveraa/prepare-image'

const ready = await prepareImage(file, { maxSize: 2000, format: 'webp' })

await fetch('/api/photos', { method: 'POST', body: formDataWith(ready.file) })
```

- **Un seul appel** pour ce qui demande d'habitude trois bibliothèques.
- **Les photos d'iPhone** : le HEIC est converti quand le navigateur ne sait pas le lire, et seulement là.
- **Toujours droite** : l'orientation notée par l'appareil est appliquée aux pixels, puis oubliée.
- **La position disparaît** : aucune métadonnée ne sort, ni GPS, ni modèle d'appareil, ni date.
- **Sans perte inutile** : si rien n'a besoin de changer, les pixels ne sont pas réencodés, seules les métadonnées sont retirées.
- **Aucune dépendance**, écrit en TypeScript, et le même code fonctionne dans un Web Worker.

---

## Sommaire

- [Le problème](#le-problème)
- [Installation](#installation)
- [Utilisation](#utilisation)
- [Les photos d'iPhone](#les-photos-diphone)
- [Ce qui est retiré du fichier](#ce-qui-est-retiré-du-fichier)
- [Ce que vous récupérez](#ce-que-vous-récupérez)
- [Toutes les options](#toutes-les-options)
- [Tenir dans un poids](#tenir-dans-un-poids)
- [Dans un Web Worker](#dans-un-web-worker)
- [Les erreurs](#les-erreurs)
- [Remplacer les opérations d'image](#remplacer-les-opérations-dimage)
- [Ce que ce paquet ne fait pas](#ce-que-ce-paquet-ne-fait-pas)
- [Développement](#développement)

## Le problème

Un formulaire avec un champ photo, c'est trois lignes de HTML. Ce qui suit l'est beaucoup moins :

| Ce que le téléphone donne | Ce que vous vouliez |
|---|---|
| `IMG_4821.HEIC`, illisible par Chrome et Firefox | une image que tout le monde affiche |
| 4,2 Mo | 280 Ko |
| couchée sur le côté, parce que l'orientation est notée à part | droite |
| `GPS 48.8566, 2.3522` | rien |

Aujourd'hui on assemble `heic2any`, `browser-image-compression` et un bout de lecture EXIF. Les plus téléchargées de ces bibliothèques n'ont pas été publiées depuis 2022 ou 2023. Et la partie qui compte le plus pour les personnes qui utilisent votre site - retirer leur position - est presque toujours oubliée.

## Installation

```bash
npm install @kaveraa/prepare-image
```

## Utilisation

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

Sans option, l'image est ramenée à 2000 pixels sur son côté le plus long, convertie en WebP quand le navigateur sait l'écrire, et débarrassée de ses métadonnées.

## Les photos d'iPhone

Depuis 2017, un iPhone enregistre ses photos en HEIC. Safari sait les lire, Chrome et Firefox non. Décoder ce format demande un décodeur lourd, que la plupart des applications n'ont aucune raison de charger.

Ce paquet fait donc les choses dans cet ordre : il demande d'abord au navigateur, et ne se tourne vers votre décodeur que si celui-ci échoue. Sur Safari, le décodeur n'est jamais chargé.

```js
import { looksLikeHeic, prepareImage } from '@kaveraa/prepare-image'

const ready = await prepareImage(file, {
  // Charge le decodeur seulement quand il sert vraiment
  decodeHeic: async (blob) => {
    const { heicTo } = await import('heic-to')

    return heicTo({ blob, type: 'image/jpeg', quality: 0.92 })
  },
})
```

`looksLikeHeic(file)` ne lit que les premiers octets du fichier, si vous préférez décider avant d'appeler.

Le paquet exporte aussi `sniff(bytes)`, qui donne le vrai format d'un fichier d'après ses octets et non d'après son nom ni le type annoncé par le navigateur - un HEIC arrive souvent avec un type vide, et un fichier renommé garde ses octets d'origine.

Sans `decodeHeic`, un HEIC que le navigateur ne sait pas lire lève une erreur claire plutôt que d'échouer en silence.

## Ce qui est retiré du fichier

Tout. Position GPS, modèle et numéro de série de l'appareil, date et heure, réglages de prise de vue, vignette, commentaires, XMP.

Deux chemins, selon ce qu'il y a à faire :

- **Il y a autre chose à faire** (redimensionner, tourner, convertir) : l'image est réencodée, et un réencodage ne recopie aucune métadonnée. Rien ne survit.
- **Il n'y a rien d'autre à faire** : les pixels ne sont pas touchés. Les blocs de métadonnées sont retirés du fichier tels quels, sans réencodage, donc **sans aucune perte de qualité**.

Pour forcer le réencodage dans tous les cas, mettez `alwaysReencode: true`.

## Ce que vous récupérez

```ts
interface PreparedImage {
  file: File          // pret a partir dans un FormData
  format: 'webp' | 'jpeg' | 'png'
  width: number
  height: number
  bytes: number

  source: {           // l'image telle qu'elle est arrivee
    type: string
    bytes: number
    width: number     // dimensions une fois remise droite
    height: number
    orientation: number
  }

  changed: Change[]   // ce qui a ete fait, dans l'ordre
}
```

`changed` sert à expliquer, à journaliser, ou à ne rien dire du tout quand la liste est vide.

## Toutes les options

| Option | Défaut | Rôle |
|---|---|---|
| `maxSize` | `2000` | Côté le plus long, en pixels. L'image n'est jamais agrandie |
| `format` | `'auto'` | `'webp'`, `'jpeg'`, `'png'`, ou `'auto'` : WebP dès que le navigateur sait l'écrire |
| `quality` | `0.82` | De 0 à 1. Sans effet sur le PNG |
| `maxBytes` | - | Poids visé. La qualité descend par paliers pour s'en approcher |
| `background` | `'#ffffff'` | Couleur posée sous la transparence quand la sortie est un JPEG |
| `alwaysReencode` | `false` | Réencoder même quand rien n'a besoin de changer |
| `decodeHeic` | - | Votre décodeur HEIC, appelé seulement si le navigateur échoue |
| `signal` | - | Un `AbortSignal` pour arrêter le traitement |
| `imaging` | - | Remplace les opérations d'image. Voir plus bas |

## Tenir dans un poids

```js
const ready = await prepareImage(file, { maxSize: 1600, maxBytes: 300 * 1024 })
```

La qualité est abaissée par paliers jusqu'à tenir dans le budget, sans jamais descendre sous un seuil où l'image deviendrait laide. Ce n'est pas une garantie : une photo très détaillée peut rester au-dessus. Vérifiez `ready.bytes` si le poids est une contrainte dure.

## Dans un Web Worker

La fonction n'utilise que des API disponibles dans un worker. Il n'y a rien à configurer : mettez-la dans le vôtre.

```js
// worker.js
import { prepareImage } from '@kaveraa/prepare-image'

onmessage = async (event) => {
  const ready = await prepareImage(event.data)

  postMessage(ready.file)
}
```

C'est utile quand vous traitez plusieurs photos d'affilée : le fil principal reste libre et la page ne se fige pas.

## Les erreurs

Toutes les erreurs du paquet sont des `PrepareImageError` et portent un `code` :

```js
import { PrepareImageError, prepareImage } from '@kaveraa/prepare-image'

try {
  await prepareImage(file)
} catch (error) {
  if (error instanceof PrepareImageError && error.code === 'needs-decoder') {
    // Une photo HEIC, et pas de decodeur fourni
  }
}
```

| Code | Quand |
|---|---|
| `not-an-image` | Le fichier n'est pas une image reconnue |
| `needs-decoder` | Une photo HEIC, et le navigateur ne sait pas la lire |
| `cannot-decode` | Le navigateur n'a pas réussi à lire l'image |
| `cannot-encode` | Le navigateur ne sait pas écrire le format demandé |
| `aborted` | Le signal a été déclenché |

## Remplacer les opérations d'image

Le paquet ne touche jamais au canevas directement : tout passe par une interface `Imaging`. C'est ce qui permet de tester la logique sans navigateur, et cela vous laisse la remplacer.

```ts
const ready = await prepareImage(file, {
  imaging: {
    decode: (blob, orientation) => ...,
    encode: (image, options) => ...,
    supports: (format) => ...,
  },
})
```

## Ce que ce paquet ne fait pas

- **Il n'envoie rien.** Il vous rend un `File`, vous choisissez comment l'envoyer.
- **Il ne recadre pas et ne retouche pas.** Pas de rognage, pas de filtre : d'autres outils font cela très bien.
- **Il ne décode pas le HEIC tout seul.** Un décodeur pèse plusieurs centaines de kilo-octets : il n'a rien à faire dans un paquet que beaucoup installeront sans en avoir besoin.
- **Il ne remplace pas une vérification côté serveur.** Tout ce qui se passe dans un navigateur peut être contourné : continuez à valider ce que vous recevez.

## Développement

```bash
git clone https://github.com/kaveraa/prepare-image.git
cd prepare-image
npm install
npx playwright install chromium
npm run test:all
```

La logique pure se teste sous Node, et le vrai canevas dans Chromium. Pour proposer une modification, lisez le guide [CONTRIBUTING.md](https://github.com/kaveraa/prepare-image/blob/main/CONTRIBUTING.md). Voir le [CHANGELOG](https://github.com/kaveraa/prepare-image/blob/main/CHANGELOG.md) pour l'historique des versions.

Pour signaler une faille, ouvrez une [alerte de sécurité privée](https://github.com/kaveraa/prepare-image/security/advisories/new) plutôt qu'une issue publique.

## Licence

MIT. Voir [LICENSE](https://github.com/kaveraa/prepare-image/blob/main/LICENSE).
