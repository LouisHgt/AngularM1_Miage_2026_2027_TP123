# Rapport TP4 — Studio audio

## Étape 0 — Squelette commun

### Fonctionnalités réalisées

- Modèles `StudioTrack` et `MixerState`.
- `AudioContextService` pour partager un unique `AudioContext`.
- `StudioStore` avec ajout et suppression de pistes.
- Route lazy et protégée `/studio/:id`.
- Chargement d’une piste depuis la bibliothèque, conversion en `ArrayBuffer`, puis décodage en `AudioBuffer`.
- Bouton « Ouvrir dans le studio » sur chaque piste.

### Choix techniques

- Un seul `AudioContext` est fourni par `AudioContextService`.
- L’état partagé des pistes est géré par `StudioStore` avec des Signals Angular.
- La page studio est chargée avec une route lazy et protégée par `authGuard`.
- Les composants ne communiquent pas directement avec `HttpClient` ou les détails
  de la Web Audio API : ces responsabilités sont placées dans les services.

### Tests et vérifications

- `npm test`
- `npm run build`

Résultats au dernier passage : 26 tests passent dans 8 fichiers ; le build Angular
passe avec une route lazy pour le studio.

## Mission B1 — Séparation IA des stems

### Objectif

Permettre à l’utilisateur de choisir entre deux traitements produisant les quatre
mêmes stems :

- `vocals` : voix ;
- `drums` : batterie ;
- `bass` : basse ;
- `other` : autres instruments.

Le mode **Rapide** utilise quatre modèles Spleeter spécialisés. Le mode **Qualité**
utilise le modèle monolithique Demucs v4.

### Fonctionnalités réalisées

- Sélecteur Rapide/Qualité dans la page studio.
- Service `StemSeparationService` avec Signals pour l’état, le message et la progression.
- Création et arrêt propre d’un Web Worker.
- Protocole de messages entre le thread Angular et le Worker.
- Pattern Strategy pour masquer les différences d’exécution des modèles :
  - `SpleeterStrategy` : quatre artefacts et quatre sessions prévues ;
  - `DemucsStrategy` : un artefact et une session prévue.
- Configuration des URLs des modèles de la release GitHub `v1.0-models`.
- Transfert des données audio sous forme de `Float32Array`.
- Ajout prévu des quatre pistes normalisées au `StudioStore` après séparation.
- Gestion explicite des erreurs et absence de simulation silencieuse.

### Modèles utilisés

Mode Rapide :

- `vocals.fp16.onnx`
- `drums.fp16.onnx`
- `bass.fp16.onnx`
- `other.fp16.onnx`

Mode Qualité :

- `htdemucs.onnx`

Les modèles sont téléchargés depuis la release GitHub du projet et
`onnxruntime-web` est installé dans `frontend-starter`.
Les sessions ONNX sont créées dans le Worker et les modèles sont mis en cache dans
IndexedDB (`webjam-studio` / `onnx-models`).

### Choix techniques

Le Worker sélectionne une stratégie selon le mode choisi, charge les modèles
depuis IndexedDB ou la release GitHub, puis utilise le même contrat audio brut :

```text
loadModels()
separate({ sampleRate, channels })
    -> StemResult[]
```

Les sessions exposent leurs noms d'entrées et de sorties dans la progression afin
de valider le contrat réel des artefacts. Les `AudioBuffer` restent créés dans le
thread principal, et non dans le Worker.

Spleeter devra calculer une STFT, exécuter les quatre réseaux, appliquer les masques
fréquentiels, puis effectuer une iSTFT. Demucs devra exécuter une session unique et
séparer son tenseur de sortie en quatre pistes.

### Vérifications réalisées

- Tests B1 ciblés : 2 tests réussis.
- Suite frontend : 26 tests réussis dans 8 fichiers.
- `npm run build` réussi.
- `npm list onnxruntime-web --depth=0` confirme l’installation de
  `onnxruntime-web@1.30.0`.
- Les cinq URLs de release répondent en HTTP 200 ; les quatre modèles Rapide font
  environ 19,7 Mo chacun et Demucs environ 316 Mo.
- Les modèles Rapide exposent une entrée `x` et une sortie `y`, toutes deux en
  `float32`, de forme `[2, num_splits, 512, 1024]`. Une inférence de sonde avec
  `num_splits = 1` fonctionne et produit une sortie `[2, 1, 512, 1024]`.
- Le noyau STFT/iSTFT radix-2 utilise une fenêtre de Hann périodique, une FFT de
  4096, un hop de 1024 et un padding avant de 3072 échantillons.
- Le pipeline Spleeter Rapide exécute les quatre modèles sur les magnitudes
  stéréo, calcule les masques de ratio, étend les 1024 bins modélisés à 2049 par
  moyenne par trame, puis reconstruit les quatre stems par iSTFT.
- Le pipeline rééchantillonne les données décodées vers 44 100 Hz si le
  `AudioContext` du navigateur les a fournies en 48 000 Hz ou à une autre
  fréquence.
- L'inférence des quatre sessions est séquentielle pour limiter la pression
  mémoire du runtime WASM ; les sorties contenant des `NaN` ou des infinis sont
  refusées explicitement.
- La reconstruction STFT/iSTFT est vérifiée par un test frontend.
- Le build contient le Worker ONNX et les binaires WASM sous `ort/`.
- `git diff --check` réussi.
- Le navigateur signale également que la Content Security Policy (CSP) bloque
  l'utilisation de `eval` (voir « Diagnostic CSP » ci-dessous).

### Séparation par blocs et progression (correction du blocage à 30 %)

**Cause réelle du blocage à 30 %** : le Worker n'émettait plus aucun message entre
`30 %` (« Préparation de l'audio ») et `95 %`, car `strategy.separate()` faisait tout
en un seul appel synchrone-ou-presque : STFT de tout le morceau, un unique tenseur
`[2, splitCount, 512, 1024]`, quatre inférences, puis 8 iSTFT globales avec, pour
chaque bin de chaque trame, un recalcul des moyennes de 1024 valeurs (coût
quadratique en JS). Aucun callback de progression n'existait, d'où une barre figée,
et la mémoire (spectrogrammes complexes globaux + tenseurs complets) explosait sur
les morceaux longs.

**Fonctionnement actuel** (`SpleeterStrategy.separate`) :

- un bloc = au plus 512 trames = un « split » Spleeter (les splits sont indépendants
  dans le modèle, le découpage est donc mathématiquement équivalent au tenseur global) ;
- par bloc : STFT des seules trames du bloc (`stftRange`), tenseur `[2, 1, 512, 1024]`,
  inférence séquentielle des 4 modèles, masques de ratio (bins 1024-2048 = moyenne par
  trame), iSTFT par overlap-add (`overlapAddFrames`) dans des accumulateurs par stem/canal ;
- le chevauchement des fenêtres entre blocs est résolu par l'accumulation ; la
  normalisation par l'énergie de fenêtre (`accumulateWindowEnergy`) est appliquée une
  seule fois à la fin : pas de coupure, pas de double gain ;
- `input.dispose()` et `dispose()` de toutes les sorties ONNX sont appelés après chaque
  bloc (dans un `finally`) ; seuls les accumulateurs (taille du morceau) persistent ;
- le contrat est inchangé : stéréo, 44 100 Hz (vérification/rééchantillonnage conservés),
  FFT 4096, hop 1024, Hann périodique, padding avant 3072, phase STFT d'origine.

**Messages de progression** (monotones, 30 → 95 %, puis 97 % transfert, 100 % côté service) :
« Préparation de l'audio… » (30), « Audio prêt : N s, T trames, B bloc(s) » (33), puis pour
chaque bloc « Bloc i/B : STFT… », « préparation du tenseur d'entrée… », « inférence
vocals/drums/bass/other (k/4)… », « calcul des masques… », « iSTFT <stem> (canal c/2)… »,
puis « Assemblage du résultat… » (91-95). L'orchestration du Worker est extraite dans
`stem-separation-runner.ts` pour être testable ; les erreurs sont postées en message
`error` (et journalisées), sans repli silencieux. `worker.onerror` inclut maintenant
le message d'origine.

### Diagnostic CSP (`eval`)

- Aucune CSP n'est définie par le projet : ni dans `backend/src/app.js`, ni dans
  `index.html`, ni dans `angular.json` (pas de `headers`). Aucun `unsafe-eval` ajouté,
  la CSP n'a pas été modifiée.
- Le bundle de production ne contient aucun appel `eval(`. Le Worker contient un
  `new Function` dans le glue embind d'ONNX Runtime (builds JSEP/asyncify), ainsi que
  les `.mjs` `jsep`/`asyncify`/`jspi` copiés sous `/ort` ; le `.mjs` WASM de base
  utilisé (`executionProviders: ['wasm']`) n'en contient pas.
- Conclusion : le message provient très probablement des outils du navigateur
  (DevTools/extension évaluant du code dans une page ayant une CSP imposée par
  l'environnement) ou du chemin embind non emprunté par le provider `wasm`. **Non
  vérifié dans un navigateur par cet assistant** : à confirmer manuellement (voir
  procédure). Si le Worker charge les modèles et exécute les inférences (progression
  > 30 %), le message est non bloquant.
- Le build Angular de production n'émet aucun avertissement. En revanche, `ng serve`
  affichait « Prebundling has been configured but will not be used because scripts
  optimization is enabled » et un avertissement Vite « The above dynamic import cannot be
  analyzed » sur le `import()` d'ONNX Runtime. Cause : `angular.json` n'avait aucune
  configuration de build, donc le serveur de développement servait un build **optimisé** ;
  la minification supprimait le commentaire `/* @vite-ignore */` qu'ONNX Runtime place dans
  son `import()`. Correction : configurations `production` (défaut, inchangée) et
  `development` (sans optimisation) dans `angular.json`, et `serve` pointe sur
  `gpc:build:development`. Vérifié : le Worker et le prébundle ONNX sont servis sans
  aucun avertissement. Ce message n'était qu'un avertissement, jamais une erreur.

### Mission B2 — Brouillon de stems dans le navigateur

- Après une séparation réussie, les quatre stems (`StemResult[]`, `Float32Array` par
  canal) sont enregistrés dans IndexedDB (base `webjam-studio`, magasin `stem-drafts`),
  **un brouillon par identifiant de piste** : une nouvelle séparation du même morceau
  remplace le précédent.
- À l'ouverture du studio d'un morceau, le brouillon est rechargé automatiquement et les
  quatre stems sont ajoutés au `StudioStore` sans relancer le Worker. Le studio affiche
  « Brouillon enregistré dans ce navigateur (mode, date) » et un bouton
  « Supprimer le brouillon », qui efface l'entrée IndexedDB et retire les stems du studio.
- La base passe en version 2 (`shared/storage/studio-db.ts`) : le magasin des modèles ONNX
  est conservé, le magasin des brouillons est créé à la mise à jour. Le thread principal
  (`StemDraftStorage`) et le Worker (`model-cache.ts`) partagent cette seule définition.
- Les erreurs (IndexedDB indisponible, quota dépassé, brouillon illisible) sont affichées
  dans le studio et journalisées ; la séparation reste utilisable. Si la suppression
  échoue, les stems restent affichés. Pas de repli silencieux.
- Garde-fous : l'état du morceau précédent est remis à zéro à l'ouverture
  (`StemSeparationService.reset()`), et une lecture ou écriture de brouillon qui se termine
  après un changement de morceau n'affecte pas le studio ouvert.
- Taille : les stems sont compactés en PCM 16 bits avec un facteur d'échelle par canal
  (`stem-draft-codec.ts`), soit environ 170 Mo pour 4 minutes de musique stéréo (le
  premier essai en `Float32` donnait `QuotaExceededError`, ~340 Mo). La perte est
  inférieure à la quantification 16 bits.
- Limite : au plus 3 brouillons (`MAX_DRAFTS`). À l'enregistrement du suivant, le plus
  ancien est supprimé (index `savedAt`, version 3 de la base) et le studio en informe
  l'utilisateur. Avant d'écrire, `navigator.storage.estimate()` est comparé à la taille
  nécessaire : le message d'erreur indique les Mo nécessaires et disponibles. Le brouillon
  reste local à ce navigateur ; un stockage serveur (GridFS) a été envisagé puis écarté
  pour l'instant (limite de 25 Mo par fichier, quota du cluster Atlas, modification du
  backend et de `API_CONTRACT.md`).
- Tests : rechargement, absence de brouillon, changement de morceau pendant la lecture,
  erreur de lecture, suppression (et échec de suppression), remise à zéro, codec 16 bits,
  limite de 3 brouillons, quota dépassé, vérification de l'espace. La couche
  IndexedDB elle-même n'est pas testée en environnement simulé (à vérifier à la main).

### État actuel et limites

Le mode Rapide dispose maintenant d'un pipeline audio complet jusqu'à la création
des quatre résultats stéréo dans le Worker. Le mode Qualité reste en attente de
l'inspection et de l'implémentation du contrat Demucs.

Il reste à réaliser :

- vérifier le pipeline Spleeter sur un fichier musical réel dans le navigateur ;
- confirmer dans un navigateur que le message CSP `eval` est non bloquant ;
- implémenter l’inférence Demucs ;
- Demucs (non traité) ; les tests utilisent des sessions ONNX simulées, pas les vrais modèles ;
- l'accumulation en sortie reste proportionnelle à la durée (8 × Float32 de la taille du morceau) ;
- le rééchantillonnage est linéaire, sans filtre anti-repliement.

Ainsi, la branche produit maintenant les stems Rapide à partir d'une inférence
réelle, sous réserve de validation manuelle avec un fichier audio.

### Utilisation de l’assistant IA

L’assistant a été utilisé pour :

- vérifier la présence du socle commun ;
- concevoir le découpage B1 ;
- comparer les stratégies d’exécution Demucs et Spleeter ;
- mettre en place le pattern Strategy ;
- intégrer les URLs des modèles de la release ;
- installer `onnxruntime-web` ;
- proposer les tests et vérifier le build.

Les décisions retenues et les limites techniques ont été conservées dans
`RAPPORT_IA_MODELE.md`.
