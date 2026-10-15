# TP4 — Début du projet

> Transcription du PDF « M1 MIAGE 2026_2027 Technos Web TP4 : Début du projet ».

À partir du TP4, vous démarrez votre mini projet. Vous êtes plus « libres » d'orienter le projet.

Réfléchissez à ce que vous pouvez faire à partir du prototype actuel, qui comprend :

- la gestion des utilisateurs ;
- la manipulation, l'upload et le download de fichiers, plus d'autres données de formulaire.

Vous pouvez :

- faire un mini réseau social de partage de fichiers multimédia ;
- faire une application « solo » avec des fichiers publics et privés, un petit moteur de recherche, etc. ;
- faire une application orientée musique (la spécialité de l'enseignant).

## Suggestions

### Améliorer le lecteur audio

Faire une belle UI et utiliser la Web Audio API pour un beau lecteur audio :

- afficher la forme d'onde ;
- vu-mètres stéréo pour le volume droite/gauche ;
- animation temps réel des fréquences ;
- widgets custom (boutons rotatifs, sliders, switches) ;
- ajouter des contrôles au lecteur : balance G/D, égaliseur de fréquences graphique pour ajuster le son ;
- ajout d'effets audio paramétrables (reverb, distortion, delay, filter avec cutoff / resonance) ;
- voir le cours WebAudio (gratuit) : <https://www.edx.org/learn/html5/the-world-wide-web-consortium-w3c-html5-apps-and-games>, chapitre 1.5 ;
- ajout d'animations fluides en background (shaders WebGL/WebGPU qui réagissent à la musique, voir par exemple le projet butterchurn).

### Fichiers publics / privés

Pour du partage entre utilisateurs :

- un fichier public peut être recherché et trouvé par tout le monde ;
- afficher quelque part « fichiers récemment ajoutés » ;
- un fichier peut aussi être privé, et on peut le partager avec des « amis ». Il faut donc des features de réseau social : inviter, ajouter, supprimer des amis, voir l'activité des amis, etc. ;
- gestion du partage (on veut pouvoir stopper un partage) ;
- il faut un « search files ».

## Démarche demandée

Avant de commencer l'implémentation, discutez avec votre assistant IA des points suivants :

1. **Les fonctionnalités souhaitées** : définissez ce que vous aimeriez réaliser.
2. **Les interfaces utilisateur proposées** : examinez les différentes possibilités d'interface (UI).
3. **L'implémentation** : discutez des choix techniques et de la manière de procéder.
4. **Le découpage du travail** : divisez l'implémentation en plusieurs tâches, missions ou étapes, puis commencez par réaliser la première.

Demandez également à votre assistant IA d'ajouter des **tests unitaires pour toutes les nouvelles fonctionnalités**, afin de vérifier leur bon fonctionnement.

Enfin, demandez-lui de rédiger un rapport dans un fichier **`REPORT.md`**, décrivant le travail effectué, les choix techniques, les fonctionnalités implémentées et les résultats des tests.
