# Rapport d'usage de l'IA - TP1

Pour chaque mission, détailler et fournir des explications concernant : objectif; prompt principal; plan proposé par l'agent; vérifications réalisées par le binôme; erreurs ou propositions rejetées; fichiers effectivement modifiés; preuve de fonctionnement; ce que chaque membre sait maintenant expliquer sans l'agent.

## Mission 0 — Cartographier l'application

**Assistant et mode** : Claude Code (extension VS Code), modèle Claude Opus 5.

**Objectif** : sans modifier le code, retrouver le composant racine, les routes, l'enregistrement de `HttpClient`, les modèles/services/pages et le mécanisme d'ajout du JWT ; produire un schéma annoté du flux « Se connecter » ; distinguer routes publiques et protégées.

**Prompt principal** : « Faisons la mission 0 du TP 1 Sujet etudiant. »

**Démarche de l'agent** :

1. Lecture de `SUJET_ETUDIANT_TP1.md`, `CONSEILS_POUR_UTIISER_ASSISTANT_AI.md`, `frontend-starter/CLAUDE.md` et `API_CONTRACT.md`.
2. Lecture de tous les fichiers de `frontend-starter/src` (main, routes, composants, services, modèles, guard, intercepteur) et de `proxy.conf.json`.
3. Lecture du backend : `src/app.js` (routes et middleware `auth`), `src/server.js`, `src/models/User.js`.
4. Rédaction de la cartographie, du diagramme de séquence et du tableau des routes.

Aucune commande de build ou de test n'a été lancée : la mission est une analyse. Aucun secret (`.env`, URI MongoDB, JWT) n'a été lu ni transmis.

**Fichiers modifiés** : aucun fichier de code. Fichiers de documentation créés/modifiés : `MISSION_0_CARTOGRAPHIE.md`, `RAPPORT_IA_MODELE.md`.

**Production** : voir [MISSION_0_CARTOGRAPHIE.md](MISSION_0_CARTOGRAPHIE.md) (tableau des éléments, schéma du flux de connexion, routes publiques/protégées, traces, constats pour la mission 1).

**Vérifications réalisées par le binôme** : _à compléter_ (ex. ouvrir chaque fichier cité et confirmer les numéros de ligne ; se connecter avec le compte démo et vérifier dans Network que `POST /api/auth/login` n'a pas besoin d'`Authorization` alors que `GET /api/tracks` l'a ; observer les logs `[http]` et `[auth]` dans le terminal du backend).

**Erreurs ou propositions rejetées** : _à compléter_.

**Preuve** : voir les captures Network de la Mission 1 ([login réussi](captures/login-reussi.png), [login refusé](captures/login-echoue.png)) : `POST /api/auth/login` est une route publique, sans `Authorization`.

**Ce que chaque membre sait expliquer sans l'agent** : _à compléter_ (ex. rôle de `provideHttpClient(withInterceptors(...))`, différence entre `authGuard` et le middleware `auth`, pourquoi l'Observable ne part qu'au `subscribe()`, rôle du proxy).

## Mission 1 — Inscription, connexion et profil

**Assistant et mode** : Claude Code (extension VS Code), modèle Claude Opus 5.5.

**Objectif** : compléter la partie utilisateur du frontend (formulaires réactifs validés, JWT, Signal `currentUser`, redirections, déconnexion, profil, gestion du `401`).

**Prompt principal** : « Vas-y, que manque-t-il pour le TP1 ? » (après la cartographie de la mission 0).

**Démarche de l'agent** : relecture du sujet, des constats de `MISSION_0_CARTOGRAPHIE.md`, des règles de validation du backend (`User.js` : nom ≥ 2 caractères ; `app.js` : mot de passe ≥ 8 caractères, messages `400/401/409`), puis modifications du frontend uniquement et `ng build` (build OK).

**Fichiers modifiés** :

| Fichier | Changement |
|---|---|
| `shared/services/auth.service.ts` | `computed` `isAuthenticated`, constante `TOKEN_KEY` |
| `shared/interceptors/auth.interceptor.ts` | pas de token sur `/api/auth/login` et `/register` ; sur `401` d'une route protégée : `logout()` puis redirection vers `/login?expired=true&returnUrl=…` |
| `shared/guards/auth.guard.ts` | utilise `isAuthenticated()` et transmet `returnUrl` |
| `shared/utils/api-error.ts` (nouveau) | message lisible à partir d'une `HttpErrorResponse` (message du backend, ou « Serveur injoignable » si statut `0`) |
| `components/app/app.*` | menu selon l'état connecté : nom de l'utilisateur et bouton **Déconnexion**, ou Connexion/Inscription |
| `components/login-page/*` | `form.invalid` bloque l'envoi, messages par champ, état `loading` (bouton désactivé, pas de double envoi), message « session expirée », redirection vers `returnUrl` |
| `components/register-page/*` | mêmes validations que le backend (`minLength(2)` nom, `minLength(8)` mot de passe), messages, `loading` |
| `components/profile-page/*` | chargement automatique de `GET /api/users/me` à l'ouverture, validation du nom, états chargement / succès / erreur |
| `styles.css` | classes `.info`, `.success`, `.link-button` |

Les `console.error` ne loguent plus l'objet d'erreur complet : ni mot de passe ni JWT n'apparaissent dans la console.

**Réponses aux questions du sujet** :

- *Routes backend utilisées par le TP1* : `POST /api/auth/register`, `POST /api/auth/login` (publiques), `GET /api/users/me` et `PUT /api/users/me` (protégées par le middleware `auth`).
- *Où s'effectue « mise à jour du profil utilisateur » ?*
  - Front : `profile-page.html` (formulaire, `(ngSubmit)="save()"`) → `profile-page.ts` `save()` → `auth.service.ts` `update(name)` (`PUT /api/users/me` puis `currentUser.set(user)`) → `auth.interceptor.ts` (ajout de `Authorization: Bearer`).
  - Back : `backend/src/app.js`, middleware `auth()` (vérifie le JWT et place l'identifiant dans `req.auth.sub`) puis route `app.put("/api/users/me")` (`User.findByIdAndUpdate` avec `runValidators`) ; validation dans `backend/src/models/User.js` (`name` : `required`, `trim`, `minlength: 2`).
- *Signal ou `localStorage` ?* Le `localStorage` est un stockage **persistant** du navigateur (chaînes de caractères, survit au rechargement, mais n'est pas réactif : Angular n'est pas prévenu quand il change). Un Signal est une valeur **en mémoire et réactive** : quand elle change, les templates, les `computed()` et le guard se mettent à jour. Elle est perdue au rechargement. Ici on combine les deux : le token est écrit dans `localStorage` pour survivre au rechargement et relu au démarrage dans le Signal `token`, qui pilote l'interface. `currentUser` n'existe qu'en Signal : il est rechargé depuis `/api/users/me`.
- *Modèle et consommation de tokens* : _à compléter par le binôme_ (dans Claude Code : `/model` pour le modèle, `/cost` ou `/usage` pour la consommation).

**Vérifications réalisées par le binôme** : _à compléter_. Tests suggérés :
1. Login avec un mauvais mot de passe → message « Identifiants incorrects ».
2. Inscription avec un mot de passe de 5 caractères → message de validation, aucune requête dans Network.
3. Inscription avec un email existant → « Email déjà utilisé » (`409`).
4. Modifier le nom → le nom affiché dans l'en-tête change aussitôt (Signal).
5. Dans DevTools > Application > Local Storage, remplacer `gpc_token` par `abc`, puis ouvrir Profil → `401`, retour à `/login` avec « session expirée ».
6. Déconnexion → `gpc_token` supprimé, menu Connexion/Inscription affiché.

**Preuve** (checkpoint Network) :

| Requête | Méthode / URL | Corps JSON envoyé | Statut | Réponse | `Authorization` |
|---|---|---|---|---|---|
| Connexion réussie | `POST /api/auth/login` | `{email, password}` (valeurs non capturées) | 200 OK | `{token, user}` (341 octets) | absent (route publique) |
| Connexion refusée | `POST /api/auth/login` | `{email, password}` (mauvais mot de passe) | 401 Unauthorized | `{"message":"Identifiants incorrects"}` (37 octets) | absent |
| Lecture du profil | `GET /api/users/me` | aucun | _à compléter_ | `{id, name, email, createdAt}` | présent : `Bearer ***` |

![Connexion réussie](captures/login-reussi.png)

![Connexion refusée](captures/login-echoue.png)

_À ajouter : capture de `GET` ou `PUT /api/users/me` (valeur du token masquée)._

Remarque : ouvrir `http://localhost:4200/api/users/me` dans la barre d'adresse renvoie `401 Authentification requise`, car une navigation ne passe pas par `HttpClient` et donc pas par l'intercepteur ; le JWT, stocké dans `localStorage` (pas un cookie), n'est pas envoyé.

**Erreurs ou propositions rejetées** : _à compléter_.

**Ce que chaque membre sait expliquer sans l'agent** : _à compléter_.
