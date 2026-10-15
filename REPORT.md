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

À compléter après la relecture commune et les prochaines missions.

### Tests et vérifications

- `npm test`
- `npm run build`

Résultats : 24 tests passent dans 7 fichiers ; le build Angular passe avec une route lazy
pour le studio.

### Utilisation de l’assistant IA

À compléter avec les prompts utilisés, les décisions retenues et les vérifications effectuées.
