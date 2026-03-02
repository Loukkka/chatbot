# CLAUDE.md — Projet Chatbot IA SaaS Multi-clients

Ce fichier décrit l'intégralité du projet pour qu'une nouvelle session Claude comprenne l'architecture, le code, et comment contribuer efficacement.

---

## Vue d'ensemble

Plateforme SaaS de chatbot IA injectable sur n'importe quel site web. Un seul serveur héberge plusieurs clients. Chaque client a son propre chatbot personnalisé (prompt IA, couleurs, nom, services), ses propres leads et ses propres analytics.

**Stack :** Node.js + Express, OpenRouter API (modèle : `google/gemini-2.0-flash-lite-001`), fichiers JSON pour la persistance, SSE pour le temps réel.

**Hébergement :** Render — URL de production : `https://chatbot-jeoh.onrender.com`

---

## Structure des fichiers

```
/
├── server.js                  ← Serveur Express principal
├── .env                       ← Variables d'environnement (ne pas commiter)
├── package.json
├── data/                      ← Données persistantes (auto-créé au démarrage)
│   ├── clients.json           ← Config de tous les clients
│   ├── leads_[clientId].json  ← Leads par client
│   └── analytics_[clientId].json ← Analytics par client
└── public/
    ├── widget.js              ← Widget injectable (client final)
    ├── admin.html             ← Panel admin (toi seul)
    ├── dashboard.html         ← Dashboard client (partagé aux clients)
    └── new-client.html        ← Formulaire création client
```

---

## Variables d'environnement (.env)

```env
OPENROUTER_API_KEY=sk-or-...    # Clé API OpenRouter (obligatoire)
ADMIN_KEY=admin123              # Clé admin (changer en prod !)
SERVER_URL=https://chatbot-jeoh.onrender.com  # URL publique du serveur
PORT=3000                       # Port (géré automatiquement par Render)
```

---

## Architecture multi-tenant

### Isolation des données
Chaque client est identifié par un `clientId` (ex: `garage-dupont`). Les données sont stockées dans des fichiers séparés :
- `data/leads_garage-dupont.json`
- `data/analytics_garage-dupont.json`

### Config client (`data/clients.json`)
```json
{
  "garage-dupont": {
    "clientId": "garage-dupont",
    "clientKey": "abc123xyz",        ← clé unique pour accès dashboard client
    "companyName": "Garage Dupont",
    "companyDescription": "Garage auto...",
    "location": "Paris 15e",
    "email": "contact@garage-dupont.fr",
    "phone": "01 23 45 67 89",
    "hours": "Lun-Sam 8h-19h",
    "website": "https://...",
    "services": [
      { "name": "Vidange", "price": "49€", "description": "..." }
    ],
    "botPersonality": {
      "tone": "Professionnel mais chaleureux",
      "language": "français",
      "responseLength": "Réponses concises (2-4 phrases max)",
      "callToAction": "Proposer un rendez-vous",
      "strengths": ["Rapidité", "Prix transparents"],
      "qualifyingQuestions": ["Quel est votre véhicule ?"],
      "restrictions": ["Ne pas promettre de délais impossibles"]
    },
    "chatbot": {
      "name": "Alex",
      "color": "#FF0000",
      "welcome": "Bonjour ! Comment puis-je vous aider ?",
      "placeholder": "Posez votre question...",
      "position": "right",
      "leadDelay": 3,
      "leadTimeDelay": 60,
      "leadKeywords": ["devis", "prix", "rdv"]
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## Routes API — server.js

### Pages HTML
| Route | Accès | Description |
|-------|-------|-------------|
| `GET /admin` | Toi (ADMIN_KEY) | Panel admin complet |
| `GET /dashboard?clientId=X&key=Y` | Client (clientKey) | Dashboard client |
| `GET /new-client` | Toi | Formulaire création client |

### API Admin (nécessite `?key=ADMIN_KEY`)
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/admin/clients` | GET | Liste tous les clients |
| `/api/admin/clients` | POST | Créer/modifier un client |
| `/api/admin/clients/:clientId` | DELETE | Supprimer un client |

### API Auth client
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/client-auth?clientId=X&key=Y` | GET | Vérifie la clientKey |

### API Widget (appelée par widget.js, pas d'auth)
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/widget-config?clientId=X` | GET | Config chatbot publique |
| `/api/chat` | POST | Envoie un message au bot |
| `/api/lead` | POST | Soumettre un lead |
| `/api/analytics` | POST | Tracker un événement |

### API Dashboard (auth ADMIN_KEY ou clientKey)
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/analytics?key=X&clientId=Y` | GET | Stats + events récents |
| `/api/leads?key=X&clientId=Y` | GET | Liste des leads |
| `/api/stream?key=X&clientId=Y` | GET SSE | Temps réel (EventSource) |

### Fonction isAuthorized
```js
function isAuthorized(req, clientId) {
    const key = req.query.key;
    if (key === ADMIN_KEY) return true;          // admin voit tout
    const client = getClient(clientId);
    return client && client.clientKey === key;   // client voit ses données
}
```

---

## Widget (public/widget.js)

Widget JavaScript injectable sur n'importe quel site. S'auto-configure depuis le serveur si `clientId` est fourni.

### Intégration (2 lignes)
```html
<script>
window.CHATBOT_CONFIG = {
    server: "https://chatbot-jeoh.onrender.com",
    clientId: "garage-dupont"
};
</script>
<script src="https://chatbot-jeoh.onrender.com/widget.js"></script>
```

### Config manuelle possible (override)
```js
window.CHATBOT_CONFIG = {
    server: "...",
    clientId: "...",
    color: "#4B6BFB",          // couleur principale
    name: "Assistant",         // nom du bot
    welcome: "Bonjour !",      // message d'accueil
    placeholder: "...",        // placeholder input
    position: "right",         // "right" ou "left"
    leadDelay: 3,              // nb réponses bot avant formulaire
    leadTimeDelay: 60,         // délai temps (secondes) avant formulaire
    leadKeywords: ["devis","prix","rdv"]  // mots-clés déclencheurs
}
```

### localStorage (isolé par client)
- `cb_session_[clientId]` — sessionId unique
- `cb_history_[clientId]` — historique conversation

### Events trackés (`/api/analytics`)
- `widget_loaded` — widget initialisé
- `open` — chat ouvert
- `close` — chat fermé (avec nb messages)
- `user_message` — message envoyé
- `bot_reply` — réponse reçue
- `lead_form_shown` — formulaire affiché (+ raison : delay/keywords/time)
- `lead_captured` — lead soumis (+ email)
- `lead_skipped` — formulaire ignoré

---

## Dashboards

### Admin — `/admin`
- Auth : `ADMIN_KEY`
- Onglets : Analytics, Leads, Événements, **Clients**
- Sélecteur client (filtre toutes les vues)
- L'URL se met à jour : `/admin?clientId=garage-dupont`
- Onglet Clients : snippet, URL dashboard, suppression
- Bouton "+ Client" → `/new-client`
- SSE temps réel

### Dashboard client — `/dashboard?clientId=X&key=Y`
- Auth : `clientKey` (générée automatiquement à la création du client)
- Si `key` dans l'URL → connexion automatique
- Onglets : Analytics, Leads, Événements (PAS de gestion clients)
- Cliquer sur un lead → modal conversation complète
- SSE temps réel

### Formulaire création client — `/new-client`
- Pas d'auth côté HTML (la clé admin est saisie dans le formulaire)
- Génère automatiquement l'`clientId` depuis le nom de l'entreprise
- À la création → affiche snippet HTML + URL dashboard à envoyer au client

---

## Créer un nouveau client

### Via l'interface
```
https://chatbot-jeoh.onrender.com/new-client
```
Remplir le formulaire → récupérer snippet + URL dashboard.

### Via curl
```bash
curl -X POST "https://chatbot-jeoh.onrender.com/api/admin/clients?key=ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "nom-client",
    "config": {
      "companyName": "Nom Entreprise",
      "companyDescription": "Description",
      "email": "contact@entreprise.fr",
      "phone": "06 00 00 00 00",
      "location": "Ville",
      "hours": "Lun-Ven 9h-18h",
      "services": [
        { "name": "Service 1", "price": "99€", "description": "Description" }
      ],
      "botPersonality": {
        "tone": "Professionnel",
        "language": "français",
        "responseLength": "Réponses concises",
        "callToAction": "Proposer un rendez-vous",
        "strengths": ["Point fort 1"],
        "qualifyingQuestions": ["Question 1 ?"],
        "restrictions": ["Ne jamais faire X"]
      },
      "chatbot": {
        "name": "Assistant",
        "color": "#4B6BFB",
        "welcome": "Bonjour ! Comment puis-je vous aider ?"
      }
    }
  }'
```

### Réponse
```json
{
  "ok": true,
  "clientId": "nom-client",
  "clientKey": "abc123xyz",
  "dashboardUrl": "https://chatbot-jeoh.onrender.com/dashboard?clientId=nom-client&key=abc123xyz",
  "snippet": "<script>...</script>"
}
```

Envoyer `dashboardUrl` au client → il clique et accède directement.

---

## Installer le widget WordPress

### Option 1 — Plugin "WPCode" ou "Insert Headers and Footers" (recommandé)
1. Installer le plugin gratuit
2. Paramètres → Insert Headers and Footers → Footer
3. Coller le snippet
4. Sauvegarder

### Option 2 — footer.php du thème
1. Apparence → Éditeur de thème → footer.php
2. Coller avant `</body>`
3. ⚠️ Écrasé à la mise à jour du thème

### Option 3 — Page builders (Elementor, Divi...)
Chercher "Custom Code" ou "Scripts personnalisés" dans les réglages du site.

---

## Sécurité

- **Rate limiting** par IP : 15 req/min chat, 5 req/min leads, 60 req/min analytics
- **Sanitization** : tous les inputs passent par `sanitizeText()`, protection XSS basique
- **Validation** : email regex, téléphone regex, URL validation
- **CORS** : `Access-Control-Allow-Origin: *` (widget injectable cross-domain)
- **Content-Type guard** : POST rejette tout sauf `application/json`
- **Taille limite** : body JSON max 50kb, messages max 30, texte max 5000 chars
- **Isolation** : un client ne peut accéder qu'à ses propres données via sa `clientKey`

---

## Système de prompts IA

La fonction `buildSystemPrompt(cfg)` dans `server.js` génère le prompt système à partir de la config client. Il inclut :
- Présentation de l'entreprise (nom, description, contact, horaires)
- Services et tarifs
- Questions de qualification
- Points forts à mettre en avant
- Ton et style de réponse
- Restrictions (ce que le bot ne doit jamais faire)
- Call to action

Le modèle utilisé est `google/gemini-2.0-flash-lite-001` via OpenRouter.

---

## Déploiement Render

### Variables d'environnement à configurer
```
OPENROUTER_API_KEY  = sk-or-...
ADMIN_KEY           = une-vraie-cle-secrete
SERVER_URL          = https://chatbot-jeoh.onrender.com
```

### Fichiers à uploader après modifications
```
server.js              ← racine
public/widget.js
public/admin.html
public/dashboard.html
public/new-client.html
```

### Notes Render
- Le dossier `data/` est créé automatiquement au démarrage
- ⚠️ Render efface le disque à chaque redéploiement sur le plan gratuit → les données JSON sont perdues. Pour la prod, migrer vers une base de données (ex: PlanetScale, Supabase, MongoDB Atlas).

---

## Points d'attention et TODO potentiels

- **Persistance** : les fichiers JSON dans `data/` sont perdus au redéploiement sur Render plan gratuit. Envisager une vraie DB.
- **SSE route dupliquée** : `server.js` contient deux définitions de `GET /api/stream` (lignes ~168 et ~428). La deuxième (avec `isAuthorized`) écrase la première. Supprimer la première.
- **ADMIN_KEY par défaut** : changer `admin123` en production via la variable d'env.
- **Pas de HTTPS forcé** : Render le gère en amont, ok en prod.
- **Pas de pagination** sur les leads et events : peut devenir lent avec beaucoup de données.

---

## Flux complet d'un nouveau client

```
1. Toi → /new-client (ou curl POST /api/admin/clients)
2. Serveur → génère clientId + clientKey, stocke dans clients.json
3. Toi → envoies le snippet HTML au client (pour son site)
4. Toi → envoies dashboardUrl au client (pour ses stats)
5. Client → colle snippet dans WordPress / son site
6. Visiteur → ouvre le chat, discute avec le bot IA personnalisé
7. Bot → qualifie, affiche formulaire lead au bon moment
8. Lead → enregistré dans leads_[clientId].json, visible dans dashboard
9. Client → consulte /dashboard?clientId=X&key=Y en temps réel
```