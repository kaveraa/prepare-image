# Changelog

**FR** Toutes les évolutions notables du paquet sont listées ici. Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

**EN** All important changes of the package are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [1.0.1] - 2026-09-29

### Documentation

- **FR** Le README affiché par défaut est maintenant en anglais (`README.md`), le français est dans `README.fr.md`.
  **EN** The default README is now in English (`README.md`), the French version is in `README.fr.md`.

## [1.0.0] - 2026-09-29

### Ajouté / Added

- **FR** `prepareImage()` : le fichier choisi par la personne devient une image prête à être envoyée, en un seul appel.
  **EN** `prepareImage()`: the file someone picked becomes an image ready to upload, in a single call.
- **FR** Toutes les métadonnées sont retirées, à commencer par les coordonnées GPS du lieu de prise de vue. Sans réencodage quand rien d'autre n'a besoin de changer, donc sans perte de qualité.
  **EN** All metadata is removed, starting with the GPS position of the place the photo was taken. With no re-encode when nothing else has to change, so with no loss of quality.
- **FR** Orientation de l'appareil appliquée aux pixels, redimensionnement, choix du format (`auto` prend le WebP quand le navigateur sait l'écrire) et budget de poids par paliers de qualité.
  **EN** Camera orientation applied to the pixels, resizing, format choice (`auto` takes WebP when the browser can write it) and a size budget through quality steps.
- **FR** Photos HEIC des iPhone : le navigateur est essayé d'abord, votre décodeur n'est appelé qu'en cas d'échec, et `looksLikeHeic()` permet de décider en ne lisant que les premiers octets.
  **EN** iPhone HEIC photos: the browser is tried first, your decoder is called only if that fails, and `looksLikeHeic()` lets you decide by reading the first bytes only.
- **FR** Aucune dépendance, écrit en TypeScript, fonctionne dans un Web Worker, avec `AbortSignal` et des erreurs typées.
  **EN** No dependency, written in TypeScript, runs inside a Web Worker, with `AbortSignal` and typed errors.

[1.0.1]: https://github.com/kaveraa/prepare-image/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/kaveraa/prepare-image/releases/tag/v1.0.0
