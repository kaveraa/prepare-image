# Changelog

**FR** Toutes les évolutions notables du paquet sont listées ici. Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

**EN** All important changes of the package are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Maintenance

- **FR** Compatibilité avec TypeScript 6 (`ignoreDeprecations` dans `tsconfig.json`, en attendant un correctif de tsup). Aucun changement dans le code.
  **EN** Compatibility with TypeScript 6 (`ignoreDeprecations` in `tsconfig.json`, until tsup ships a fix). No code change.

## [1.0.3] - 2026-09-30

### Documentation

- **FR** L'URL de la bannière du README pointe sur un commit précis, plus sur la branche `main`, pour que les sites qui affichent le README montrent toujours la bannière en cours. Le guide de contribution explique la marche à suivre quand la bannière change.
  **EN** The README banner URL now points to a fixed commit instead of the `main` branch, so sites that show the README always display the current banner. The contributing guide explains what to do when the banner changes.

## [1.0.2] - 2026-09-29

### Documentation

- **FR** Badges du README mis à jour (téléchargements npm à la place de Bundlephobia) et actions de la CI mises à jour.
  **EN** README badges updated (npm downloads instead of Bundlephobia) and CI actions bumped.

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
