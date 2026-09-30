# Contribuer / Contributing

**Français** - [English](#english)

## Français

Merci de votre aide ! Toute modification passe par une **Pull Request** : la branche `main` est protégée et la CI doit être verte pour fusionner.

### 1. Préparer le projet

```bash
git clone https://github.com/kaveraa/prepare-image.git
cd prepare-image
npm install
npx playwright install chromium
```

Il faut Node.js 20 ou plus. Chromium sert aux tests qui ont besoin d'un vrai canevas.

### 2. Créer une branche

```bash
git checkout -b fix/nom-court-du-changement
```

Préfixes conseillés : `feat/` (nouveauté), `fix/` (correction), `docs/` (documentation).

### 3. Lancer les tests

```bash
npm test              # la logique pure, sous Node : lecture d'octets, calculs, orchestration
npm run test:browser  # le vrai canevas, dans Chromium : decodage, rotation, encodage
npm run test:all      # les deux
npm run typecheck
npm run build
```

### 4. Règles du projet

- **Les métadonnées ne doivent jamais survivre.** C'est la promesse du paquet. Toute modification du parcours s'accompagne d'un test qui vérifie qu'une image portant une position GPS n'en porte plus à la sortie.
- **Un fichier cassé serait pire qu'une métadonnée laissée.** Le nettoyage sans réencodage doit toujours rendre un fichier lisible, octet pour octet sur la partie image.
- **Aucune exception sur un fichier tordu.** Un fichier tronqué, mensonger ou malveillant doit donner un résultat neutre, jamais une erreur non rattrapée ni une boucle infinie. Les tests en contiennent plusieurs, gardez-les.
- **Le navigateur reste derrière une interface.** Le reste du paquet ne touche jamais au canevas : c'est ce qui permet de tout tester sous Node. Si vous ajoutez une opération d'image, ajoutez-la à `Imaging`, pas ailleurs.
- **Aucune dépendance.** Le paquet n'en a pas, et le décodeur HEIC est fourni par l'application, pas par nous : c'est ce qui garde l'installation légère pour ceux qui n'en ont pas besoin.
- **Tests** : toute correction ou nouveauté est accompagnée d'un test.
- **Documentation** : mettez à jour `README.md` (anglais simple) **et** `README.fr.md` (français), ainsi que le `CHANGELOG.md` (section en haut, en français et en anglais).
- **Commits** : en anglais simple, compréhensible par un débutant. Phrases courtes, pas de jargon.
- **Caractères** : uniquement des caractères du clavier dans les fichiers et les commits : `-` (pas de tiret long), `"` (pas de guillemets français), `->` (pas de flèche), pas d'emoji ni d'icône. Les lettres accentuées du français sont acceptées.

### 5. Ouvrir la Pull Request

Poussez votre branche, ouvrez une PR vers `main` et remplissez la checklist proposée. La PR peut être fusionnée quand le contrôle **All tests passed** est vert.

### Publier une version (mainteneur)

Après la fusion : mettre à jour la version dans `package.json` et le `CHANGELOG.md` (via une PR), créer un tag `vX.Y.Z` sur `main`, puis lancer `npm publish`.

### Changer la bannière (mainteneur)

Les README chargent `art/banner.svg` par une URL qui nomme un commit, pas la branche `main`. Certains sites qui affichent un README (Packagist, pour les paquets PHP) mettent en cache une URL de branche pendant un an ; la même règle vaut pour tous les paquets. Quand la bannière change :

1. Commiter le nouveau `art/banner.svg`.
2. Mettre ce commit dans l'URL de l'image de `README.md` et `README.fr.md`, dans un second commit.

---

## English

Thank you for your help! Every change goes through a **Pull Request**: the `main` branch is protected, and the CI must be green before merge.

### 1. Set up the project

```bash
git clone https://github.com/kaveraa/prepare-image.git
cd prepare-image
npm install
npx playwright install chromium
```

You need Node.js 20 or more. Chromium is used by the tests that need a real canvas.

### 2. Create a branch

```bash
git checkout -b fix/short-name-of-the-change
```

Suggested prefixes: `feat/` (new feature), `fix/` (bug fix), `docs/` (documentation).

### 3. Run the tests

```bash
npm test              # the pure logic, under Node: byte reading, sizing, orchestration
npm run test:browser  # the real canvas, in Chromium: decoding, rotation, encoding
npm run test:all      # both
npm run typecheck
npm run build
```

### 4. Project rules

- **Metadata must never survive.** That is the promise of the package. Every change to the pipeline comes with a test checking that an image carrying a GPS position no longer carries one on the way out.
- **A broken file would be worse than a leftover piece of metadata.** Cleaning without re-encoding must always return a readable file, byte for byte on the image part.
- **No exception on a twisted file.** A truncated, lying or hostile file must give a harmless result, never an uncaught error and never an endless loop. The tests hold several of them, keep them.
- **The browser stays behind one interface.** The rest of the package never touches the canvas: that is what makes everything testable under Node. If you add an image operation, add it to `Imaging`, nowhere else.
- **No dependency.** The package has none, and the HEIC decoder is given by the application, not by us: that is what keeps the install small for those who do not need it.
- **Tests**: every fix or new feature comes with a test.
- **Documentation**: update `README.md` (simple English) **and** `README.fr.md` (French), and the `CHANGELOG.md` (section at the top, in French and English).
- **Commits**: in simple English, easy to read for a beginner. Short sentences, no jargon.
- **Characters**: only keyboard characters in files and commits: `-` (no long dash), `"` (no French quotes), `->` (no arrow), no emoji or icon. French accented letters are fine.

### 5. Open the Pull Request

Push your branch, open a PR to `main` and fill in the checklist. The PR can be merged when the **All tests passed** check is green.

### Release a version (maintainer)

After the merge: update the version in `package.json` and the `CHANGELOG.md` (with a PR), create a `vX.Y.Z` tag on `main`, then run `npm publish`.

### Change the banner (maintainer)

The README files load `art/banner.svg` through a URL that names a commit, not the `main` branch. Some sites that show a README (Packagist, for the PHP packages) cache a branch URL for a year; the same rule applies to every package. When the banner changes:

1. Commit the new `art/banner.svg`.
2. Put that commit in the image URL of `README.md` and `README.fr.md`, in a second commit.
