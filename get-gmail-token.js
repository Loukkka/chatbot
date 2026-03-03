/**
 * Script d'aide pour obtenir un Refresh Token Gmail API
 * 
 * Prérequis : Avoir créé un projet Google Cloud avec l'API Gmail activée
 * et des identifiants OAuth2 (type "Application de bureau")
 * 
 * Usage : node get-gmail-token.js
 */

require("dotenv").config();
const http = require("http");
const { URL } = require("url");

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3001/oauth2callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.send";

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           CONFIGURATION GMAIL API - ÉTAPES                   ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. Allez sur https://console.cloud.google.com               ║
║  2. Créez un nouveau projet (ex: "Chatbot Emails")           ║
║  3. Dans le menu, allez dans "API et services"               ║
║     → "Bibliothèque" → Cherchez "Gmail API" → Activez-la    ║
║  4. Allez dans "API et services" → "Écran de consentement"   ║
║     → Type "Externe" → Remplissez le nom de l'app            ║
║     → Ajoutez le scope: gmail.send                           ║
║     → Ajoutez votre email comme "Utilisateur test"           ║
║  5. Allez dans "API et services" → "Identifiants"            ║
║     → "Créer des identifiants" → "ID client OAuth"           ║
║     → Type: "Application de bureau"                          ║
║     → Notez le Client ID et Client Secret                    ║
║  6. Ajoutez dans votre .env :                                ║
║     GMAIL_CLIENT_ID=votre_client_id                          ║
║     GMAIL_CLIENT_SECRET=votre_client_secret                  ║
║  7. Relancez : node get-gmail-token.js                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
}

// Construire l'URL d'autorisation
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(SCOPES)}&` +
    `access_type=offline&` +
    `prompt=consent`;

console.log("\n🔗 Ouvrez cette URL dans votre navigateur :\n");
console.log(authUrl);
console.log("\n⏳ En attente de l'autorisation... (serveur temporaire sur port 3001)\n");

// Serveur temporaire pour capturer le callback OAuth2
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost:3001");

    if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
        console.error("❌ Autorisation refusée:", error);
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>❌ Autorisation refusée</h1><p>${error}</p>`);
        setTimeout(() => { server.close(); process.exit(1); }, 500);
        return;
    }

    if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>❌ Pas de code d'autorisation reçu</h1>");
        return;
    }

    try {
        // Échanger le code contre les tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code"
            })
        });

        const tokens = await tokenRes.json();

        if (tokens.refresh_token) {
            console.log("\n✅ ════════════════════════════════════════════════════");
            console.log("   REFRESH TOKEN OBTENU AVEC SUCCÈS !");
            console.log("   ════════════════════════════════════════════════════\n");
            console.log("   Ajoutez cette ligne dans votre .env :\n");
            console.log(`   GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log("\n   Et sur Render (variables d'environnement) :");
            console.log(`   GMAIL_CLIENT_ID = ${CLIENT_ID}`);
            console.log(`   GMAIL_CLIENT_SECRET = ${CLIENT_SECRET}`);
            console.log(`   GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
            console.log("\n   ════════════════════════════════════════════════════\n");

            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0fdf4;margin:0}
.card{background:#fff;border-radius:16px;padding:48px;max-width:500px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1)}
h1{color:#16a34a;margin-bottom:16px}p{color:#555;line-height:1.6}</style></head>
<body><div class="card"><h1>✅ Autorisation réussie !</h1>
<p>Retournez dans le terminal pour copier votre <strong>Refresh Token</strong>.</p>
<p style="margin-top:20px;color:#999;font-size:13px">Vous pouvez fermer cette page.</p></div></body></html>`);
        } else {
            console.error("❌ Pas de refresh_token dans la réponse:", JSON.stringify(tokens, null, 2));
            console.log("\n💡 Astuce: Vérifiez que 'prompt=consent' est bien dans l'URL et réessayez.");
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h1>❌ Pas de refresh token</h1><p>Vérifiez la console pour plus de détails.</p>");
        }
    } catch (err) {
        console.error("❌ Erreur lors de l'échange du code:", err.message);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>❌ Erreur</h1><p>${err.message}</p>`);
    }

    setTimeout(() => { server.close(); process.exit(0); }, 1000);
});

server.listen(3001, () => {
    // Ouvrir automatiquement le navigateur (Windows)
    const { exec } = require("child_process");
    exec(`start "${authUrl}"`);
});
