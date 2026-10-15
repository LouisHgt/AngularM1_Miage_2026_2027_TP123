# Plan du projet WebJam Studio (TP4 à TP6)

Références : [SUJET_ETUDIANT_TP4.md](SUJET_ETUDIANT_TP4.md) (consignes) et [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) (vision du projet).

Le sujet du TP4 demande de discuter quatre points avec l'assistant IA avant de coder : les fonctionnalités, l'interface, l'implémentation et le découpage. Ce document reprend ces quatre points dans l'ordre. On y choisit l'orientation « application musique » du sujet, en partant du prototype existant (utilisateurs, upload, download).

## 1. Fonctionnalités

On ne repart pas de zéro : le studio s'ouvre sur une piste de la bibliothèque existante, et ce qu'on y produit (enregistrements) revient dans la bibliothèque. Le traitement audio reste entièrement dans le navigateur, comme le prévoit le cahier des charges.

| Priorité | Fonctionnalité | Origine |
|---|---|---|
| **Indispensable** | Ouvrir une piste de la bibliothèque dans un studio, lecture, pause, déplacement dans le morceau | prototype et cahier des charges |
| **Indispensable** | Forme d'onde cliquable pour se déplacer | suggestion du sujet |
| **Indispensable** | Séparation en 4 stems par IA (voix, batterie, basse, autres) | cahier des charges |
| **Indispensable** | Console de mixage : volume, balance G/D, mute, solo par piste, avec boutons rotatifs custom | cahier des charges et sujet |
| **Indispensable** | Chaîne d'effets par piste : **EQ graphique en premier**, puis filtre (cutoff et resonance), compresseur, reverb | cahier des charges et sujet |
| **Important** | Vu-mètres stéréo G/D et analyseur de fréquences en temps réel | sujet |
| **Important** | Boucle A/B dessinée sur la forme d'onde | cahier des charges |
| **Important** | Entrée carte son (guitare, micro), effets d'entrée (EQ, distorsion, delay), écoute en direct | cahier des charges |
| **Important** | Enregistrement de la performance, ajouté comme piste puis **sauvegardé dans la bibliothèque** (réutilise l'upload) | cahier des charges et prototype |
| **Si le temps le permet** | Vitesse et tonalité réglables séparément (time-stretch et pitch-shift) | cahier des charges |
| **Bonus** | Fond animé WebGL qui réagit à la musique (butterchurn) | sujet |
| **Hors périmètre** | Fichiers publics et privés, amis, partage | autre orientation proposée par le sujet |

**Écart assumé avec le cahier des charges** : celui-ci prévoit un hébergement statique (GitHub Pages). On garde le backend Express et MongoDB du prototype, parce que le sujet demande de partir de la gestion des utilisateurs et des fichiers. Seul le traitement audio est côté client.

## 2. Interface

Deux dispositions possibles pour le studio :

- **Pistes horizontales, style DAW** : une ligne par piste, la forme d'onde en fond. La boucle A/B et le déplacement se font directement sur la forme d'onde.
- **Console verticale, style table de mixage** : une tranche verticale par piste, avec faders et vu-mètres. C'est très lisible pour le mixage, mais il n'y a pas de place pour la forme d'onde.

**Choix retenu : pistes horizontales**, parce que la forme d'onde et la boucle A/B sont au cœur de l'usage « je travaille un passage ». Les réglages fins d'une piste s'ouvrent dans un panneau latéral.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ◀ Bibliothèque   « Titre du morceau »          [Séparer les pistes]  │
├──────────────────────────────────────────────────────────────────────┤
│ ⏮ ▶ ⏸ ⏹   01:23 / 03:45   🔁 A–B   Vitesse 0.8×   Tonalité −1   ▮▮ VU │
├──────────────┬───────────────────────────────────────────────────────┤
│ Voix    M S  │ ▁▃▅▇▅▃▁▂▅▇▇▅▃  [====A======B====]                     │
│ ◯vol ◯pan FX │                                                       │
│ Batterie M S │ ▇▁▇▁▇▁▇▁▇▁▇▁▇                                         │
│ ...          │                                                       │
│ 🎙 Prise 1    │ ▂▃▃▂▅▆▃▂                                              │
├──────────────┴────────────────────┬──────────────────────────────────┤
│ Entrée : [Interface USB ▾]  ▮▮ VU │ Panneau FX de la piste choisie : │
│ EQ ▸ Distorsion ▸ Delay           │ courbe EQ graphique + cartes     │
│ [Écoute ●]  [● REC]  (imprimé ▾)  │ d'effets avec boutons rotatifs   │
└───────────────────────────────────┴──────────────────────────────────┘
        (fond : analyseur de fréquences ou visuel WebGL en bonus)
```

On garde une interface accessible : chaque bouton rotatif est un vrai contrôle (`role="slider"`, flèches du clavier, label lisible), Espace lance ou met en pause la lecture, et les contrastes respectent WCAG AA.

## 3. Implémentation

| Sujet | Choix | Raison |
|---|---|---|
| Moteur audio | Web Audio API native, un seul `AudioContext` créé au premier clic | règle d'autoplay des navigateurs, horloge commune à toutes les pistes |
| Graphe de lecture | `AudioBufferSourceNode → EQ → effets → Gain → StereoPanner → Analyser → master` | ordre imposé par le cahier des charges, EQ toujours en premier |
| Graphe d'entrée | `MediaStreamSource → EQ → distorsion (WaveShaper) → delay`, puis d'un côté le monitoring et de l'autre `MediaRecorder` | cahier des charges |
| Format d'un effet | `interface AudioEffect { input; output; params; dispose() }` | les effets sont interchangeables et testables séparément |
| Séparation IA | `demucs-web` et `onnxruntime-web` dans un **Web Worker** | l'inférence prend plusieurs secondes et ne doit pas figer l'interface |
| Cache | IndexedDB pour le modèle (téléchargé une seule fois depuis le CDN) et pour les stems calculés, rangés par identifiant de piste | on évite de retélécharger le modèle et de recalculer la séparation |
| Vitesse et tonalité | `signalsmith-stretch` (AudioWorklet) | `playbackRate` seul change aussi la hauteur |
| Visualisation | `AnalyserNode` dessiné dans un `<canvas>` avec `requestAnimationFrame` | vu-mètres et spectre en temps réel |
| Sauvegarde des prises | upload via `TrackService.upload()` existant, au format `audio/webm` (Opus) | un WAV de 3 minutes dépasse la limite de 25 Mo du backend |
| Backend | Stockage partagé des audios dans MongoDB GridFS, et acceptation de `audio/webm` dans la liste des types MIME, avec tests backend | les fichiers sont accessibles depuis tous les postes connectés au même backend et au même cluster |
| Architecture Angular | services dans `src/app/shared`, Signals, route `/studio/:id` en lazy loading | normes des TD (`best-practices.md`) |

### Tests et rapport

- **Tests unitaires pour chaque nouvelle fonctionnalité** (Vitest, sans backend, avec un faux `AudioContext`). Exemples :
  - le graphe est branché dans le bon ordre, avec l'EQ en premier ;
  - mute et solo calculent les bonnes pistes audibles ;
  - les bornes de la boucle A/B sont vérifiées ;
  - le cache évite un second téléchargement du modèle ;
  - un refus de `getUserMedia` affiche un message clair ;
  - une prise terminée est ajoutée comme piste.
- `npm test` et `npm run build` passent avant chaque fusion.
- **`REPORT.md`** (exigé par le sujet du TP4) décrit le travail effectué, les choix techniques, les fonctionnalités et les résultats des tests. On le met à jour à la fin de chaque séance.
- **`RAPPORT_IA_MODELE.md`** reste le journal d'usage de l'IA, avec une section par mission : objectif, prompt, plan de l'agent, vérifications, propositions rejetées, fichiers, preuves, ce que chacun sait expliquer.

## 4. Découpage du travail

Deux axes qui se touchent le moins possible. Leur seul point de contact est le **`StudioStore`** (la liste des pistes du projet) : B y ajoute des pistes (stems, prises), A les joue.

### Étape 0, à faire ensemble (première mission du TP4)

- Modèles `StudioTrack` (`id`, `name`, `kind: 'original' | 'stem' | 'recording'`, `buffer: AudioBuffer`) et `MixerState`.
- `AudioContextService` et `StudioStore` (Signal `tracks`, `addTrack()`, `removeTrack()`).
- Route lazy `/studio/:id` protégée par `authGuard` : chargement de la piste via `TrackService.audio(id)`, puis `decodeAudioData`, puis ajout dans le store.
- Bouton « Ouvrir dans le studio » sur les cards de la bibliothèque.
- Les premiers tests (store et chargement), le squelette de `REPORT.md`.
- Branche `feat/commun-studio-skeleton` créée depuis `dev`, pull request vers `dev`, puis `git merge dev` dans `dev-louis` et `dev-remi`.

### Membre A : lecture, mixage et effets

| Mission | TP | Contenu |
|---|---|---|
| A1 | TP4 | **Moteur et transport** : lecture synchronisée de toutes les pistes, Play, Pause, Stop, position, forme d'onde cliquable |
| A2 | TP4 | **Console de mixage** : composant bouton rotatif réutilisable, volume, balance, mute, solo |
| A3 | TP5 | **Chaîne d'effets** : interface `AudioEffect`, EQ graphique (courbe éditable), filtre cutoff/resonance, compresseur, reverb, ajout et retrait d'effets |
| A4 | TP5 | **Boucle A/B** sur la forme d'onde, lecture en boucle sans coupure |
| A5 | TP6 | **Vitesse et tonalité** avec `signalsmith-stretch` |

### Membre B : IA, visualisation et studio live

| Mission | TP | Contenu |
|---|---|---|
| B1 | TP4 | **Séparation IA** dans un Web Worker, avec barre de progression et ajout des 4 stems au store |
| B2 | TP4 | **Cache IndexedDB** du modèle et des stems |
| B3 | TP5 | **Visualisation** : vu-mètres stéréo G/D (deux `AnalyserNode` après un `ChannelSplitter`) et spectre de fréquences |
| B4 | TP5 | **Entrée live** : choix du périphérique, gestion du refus d'autorisation, chaîne d'entrée (EQ, distorsion, delay), écoute en direct. Réutilise `AudioEffect` et le bouton rotatif de A |
| B5 | TP6 | **Enregistrement** : `MediaRecorder` (effets imprimés ou son brut), ajout comme piste, sauvegarde dans la bibliothèque (modification backend `audio/webm` et son test) |

**Bonus**, pour le premier qui est en avance : le fond WebGL butterchurn.

La séparation IA (B1) est la partie la plus risquée : modèle lourd, temps de calcul important. Elle est placée en premier pour laisser le temps de se rabattre sur une solution plus simple si besoin, par exemple un modèle plus léger ou une séparation limitée à un extrait.

### Règles de travail

- **Branches** :

  ```text
  main                      ← rendus (fusion de dev à la fin de chaque TP)
   └── dev                  ← intégration, toujours buildable et testée
        ├── feat/commun-*   ← travail commun (étape 0, modèles partagés) : PR directe vers dev
        ├── dev-louis       ← branche personnelle de Louis
        │    └── feat/<mission>   ← PR vers dev-louis
        └── dev-remi        ← branche personnelle de Rémi
             └── feat/<mission>   ← PR vers dev-remi
  ```

  - Une branche `feat/` par mission (`feat/a1-playback-engine`, `feat/b1-stem-separation`…), créée depuis la branche personnelle et fusionnée dedans par pull request.
  - Quand une mission est terminée (tests et build verts), la branche personnelle est fusionnée dans `dev` par pull request.
  - Après chaque fusion commune, chacun récupère `dev` dans sa branche personnelle (`git merge dev`) pour rester à jour, en particulier sur `StudioStore` et `AudioEffect`.
- **Relecture croisée** des pull requests vers `dev` par l'autre membre : chacun doit pouvoir expliquer tout le projet.
- Les composants n'appellent jamais `HttpClient` ni la Web Audio API directement : tout passe par les services.
- Nettoyage dans `DestroyRef.onDestroy` : arrêter les sources, fermer le micro, terminer le Worker, révoquer les ObjectURL.
- Ne jamais logger le JWT ni le mot de passe.

## Questions à préparer pour l'oral

1. Pourquoi un seul `AudioContext`, et pourquoi il doit être créé après un geste de l'utilisateur.
2. L'ordre du graphe de lecture et celui du graphe d'entrée, et la position de l'EQ dans chacun.
3. Pourquoi l'inférence tourne dans un Web Worker, et ce qu'apporte le cache IndexedDB.
4. Comment un `AnalyserNode` permet d'afficher un vu-mètre ou un spectre.
5. Pourquoi `playbackRate` change la hauteur, et ce que fait un time-stretch.
6. Pourquoi les prises sont envoyées en `webm` plutôt qu'en WAV, et ce que le backend contrôle encore.
