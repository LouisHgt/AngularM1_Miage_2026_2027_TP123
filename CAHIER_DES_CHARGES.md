# 📝 Spécifications du Projet : WebJam Studio

**Vision :** 
Une station de travail audio (Mini-DAW) 100% web et *Client-Side*. L'application permet aux musiciens d'analyser des morceaux grâce à l'IA, d'isoler des instruments pour le repiquage, de s'enregistrer en direct par-dessus, et d'appliquer des chaînes d'effets (plugins) modulaires, le tout localement dans le navigateur.

## 🏗️ Architecture de Déploiement

*   **Hébergement Front-end :** Serveur statique (ex: GitHub Pages) pour le HTML, JS (Node.js/Express en dev local), CSS.
*   **Hébergement Modèles IA :** Modèles (Spleeter/Demucs) distribués via un CDN public (Hugging Face / jsDelivr), avec mise en cache locale via IndexedDB pour éviter les retéléchargements massifs.

## ⚙️ Fonctionnalités Principales

### 1. Bibliothèque & Intelligence Artificielle
*   **Import :** Interface permettant de charger et d'afficher une liste de fichiers audio locaux (MP3, WAV).
*   **Séparation de Pistes (Stem Separation) :** Déclenchement de l'inférence IA locale (via TensorFlow.js/ONNX) pour éclater le fichier en 4 pistes distinctes (Voix, Batterie, Basse, Autres).

### 2. Console de Mixage & Traitement du Signal (Playback Stems)
*   **Contrôles standards :** Mute, Solo, Volume, et Panoramique (Pan L/R) indépendants par piste.
*   **Chaîne d'effets (Insert FX) :**
    *   **EQ (Premier de la chaîne) :** Un Égaliseur paramétrique positionné en tout premier dans le routage du signal pour sculpter le son source de la piste séparée.
    *   **Slots de Plugins :** Possibilité d'ajouter d'autres effets à la suite (Compresseur, Reverb, etc.).

### 3. Outils de Pratique Musicale
*   **Time-Stretching (Vitesse) :** Contrôle de la vitesse de lecture globale pour ralentir ou accélérer le morceau sans modifier sa hauteur.
*   **Pitch-Shifting (Tonalité) :** Modificateur de pitch global permettant de transposer le morceau (ex: +1 ou -1 demi-ton) indépendamment de la vitesse.
*   **Bouclage (Loop A/B) :** Sélection d'une région temporelle spécifique (entre un point A et B) tournant en boucle fluide.

### 4. Live Input, Plugins & Enregistrement (Studio Mode)
*   **Routage Physique (WebRTC/MediaStream) :** Prise en charge des entrées matérielles via la carte son de l'utilisateur (guitare branchée sur une interface audio, micro USB).
*   **Chaîne de Plugins d'Entrée :** 
    *   Application d'effets **en direct** sur le signal entrant (ex: simulation d'ampli, distorsion, ou delay pour une guitare) *avant* même l'enregistrement.
    *   L'EQ reste le premier plugin par défaut de cette chaîne d'entrée.
*   **Monitoring Live :** Écoute en temps réel de l'instrument traité par les plugins, parfaitement synchronisé avec la lecture du mixage IA (Backing Track).
*   **Capture (Bouncing) :** Bouton d'enregistrement pour capturer la performance live (avec ou sans les effets "imprimés" dans la piste selon le choix de routage) et l'ajouter automatiquement comme nouvelle piste au projet.

## 🧠 Architecture du Routage Audio (Web Audio API)

L'architecture logicielle repose sur le graphe de routage de la Web Audio API, séparant le flux de lecture des *Stems* et le flux d'enregistrement :

*   **Flux de Lecture (Stems) :** 
    `AudioBufferSourceNode (Gère Vitesse/Pitch)` ➔ `BiquadFilterNode (EQ)` ➔ `Autres Nœuds Plugins` ➔ `GainNode (Volume)` ➔ `StereoPannerNode (Pan)` ➔ `Master (Destination)`.
*   **Flux d'Entrée (Live) :** 
    `MediaStreamAudioSourceNode (Carte son)` ➔ `BiquadFilterNode (EQ In)` ➔ `Nœuds Plugins (Ampli/FX)` ➔ Divisé vers :
    1.  `GainNode` ➔ `Master` (Pour l'écoute en direct/Monitoring).
    2.  `MediaRecorder API` (Pour l'enregistrement du fichier audio de la performance).