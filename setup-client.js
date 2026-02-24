/**
 * ============================================================
 * OUTIL DE CONFIGURATION NOUVEAU CLIENT
 * ============================================================
 * 
 * Lance ce script pour créer/modifier la configuration d'un client :
 *   node setup-client.js
 * 
 * Il génère/met à jour le fichier client-config.json
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CONFIG_FILE = path.join(__dirname, "client-config.json");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question, defaultVal) {
    return new Promise((resolve) => {
        const suffix = defaultVal ? ` (${defaultVal})` : "";
        rl.question(`${question}${suffix}: `, (answer) => {
            resolve(answer.trim() || defaultVal || "");
        });
    });
}

function loadExisting() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        }
    } catch (e) { }
    return null;
}

async function main() {
    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║   🤖  CONFIGURATION NOUVEAU CLIENT           ║");
    console.log("╚══════════════════════════════════════════════╝\n");

    const existing = loadExisting();
    if (existing) {
        console.log(`⚠️  Un fichier client-config.json existe déjà (${existing.companyName}).`);
        const overwrite = await ask("Écraser ? (oui/non)", "non");
        if (overwrite !== "oui" && overwrite !== "o") {
            console.log("❌ Annulé.");
            rl.close();
            return;
        }
    }

    console.log("\n── 📌 Informations de l'entreprise ──\n");
    const companyName = await ask("Nom de l'entreprise");
    const companyDescription = await ask("Description courte", "Entreprise spécialisée en...");
    const website = await ask("Site web (URL)");
    const email = await ask("Email de contact");
    const phone = await ask("Téléphone");
    const location = await ask("Localisation (ville, pays)");
    const hours = await ask("Horaires d'ouverture", "Lundi au vendredi, 9h - 18h");

    console.log("\n── 🎨 Apparence du chatbot ──\n");
    const chatName = await ask("Nom du chatbot", "Assistant");
    const color = await ask("Couleur principale (hex)", "#4B6BFB");
    const welcome = await ask("Message de bienvenue", "Bonjour ! Comment puis-je vous aider ?");
    const logo = await ask("URL du logo (laisser vide si aucun)", "");
    const position = await ask("Position (right/left)", "right");

    console.log("\n── 📦 Services (tapez chaque service, ligne vide pour terminer) ──\n");
    const services = [];
    let serviceIndex = 1;
    while (true) {
        const name = await ask(`Service ${serviceIndex} — Nom (vide = terminé)`);
        if (!name) break;
        const price = await ask(`  Prix`);
        const description = await ask(`  Description`);
        services.push({ name, price, description });
        serviceIndex++;
    }

    console.log("\n── 🎯 Personnalité du bot ──\n");
    const tone = await ask("Ton", "Professionnel mais chaleureux et accessible");
    const callToAction = await ask("Objectif principal", "Proposer un rendez-vous pour discuter du projet");

    console.log("\n── Questions de qualification (vide = terminé) ──\n");
    const questions = [];
    let qi = 1;
    while (true) {
        const q = await ask(`Question ${qi}`);
        if (!q) break;
        questions.push(q);
        qi++;
    }

    console.log("\n── Points forts (vide = terminé) ──\n");
    const strengths = [];
    let si = 1;
    while (true) {
        const s = await ask(`Point fort ${si}`);
        if (!s) break;
        strengths.push(s);
        si++;
    }

    const config = {
        companyName,
        companyDescription,
        website,
        email,
        phone,
        location,
        hours,
        chatbot: {
            name: chatName,
            welcome,
            placeholder: "Posez votre question...",
            color,
            logo,
            position,
            leadDelay: 3,
            leadTimeDelay: 60,
            leadKeywords: ["devis", "prix", "tarif", "cout", "budget", "rdv", "rendez-vous", "rappeler", "contact", "telephone", "email"]
        },
        services,
        botPersonality: {
            language: "français",
            tone,
            responseLength: "Réponses concises (2-4 phrases max sauf si le client demande des détails)",
            callToAction,
            qualifyingQuestions: questions.length > 0 ? questions : [
                "Quel est votre projet ?",
                "Quel est votre budget approximatif ?",
                "Quel est votre délai ?"
            ],
            strengths: strengths.length > 0 ? strengths : [
                "Expertise",
                "Accompagnement personnalisé"
            ],
            restrictions: [
                "Ne jamais donner de prix exact sans préciser 'à partir de'",
                "Ne jamais promettre de résultats garantis",
                "Ne jamais partager d'informations confidentielles",
                "Ne jamais répondre à des questions sans rapport avec l'entreprise (rediriger poliment)"
            ]
        },
        rgpd: {
            consentText: "En envoyant ce formulaire, j'accepte d'être recontacté(e) et que mes données soient traitées conformément à la politique de confidentialité.",
            privacyUrl: ""
        },
        admin: {
            dashboardTitle: `Dashboard — ${companyName}`
        }
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4), "utf-8");

    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║   ✅  Configuration sauvegardée !             ║");
    console.log("╚══════════════════════════════════════════════╝\n");
    console.log(`📄 Fichier : ${CONFIG_FILE}`);
    console.log(`🏢 Client  : ${companyName}`);
    console.log(`📦 Services: ${services.length}`);
    console.log(`\n🚀 Prochaines étapes :`);
    console.log(`   1. Vérifiez/ajustez le fichier client-config.json`);
    console.log(`   2. Configurez le .env (clé API, port, ADMIN_KEY)`);
    console.log(`   3. Lancez le serveur : npm start`);
    console.log(`   4. Intégrez le widget : voir /embed\n`);

    rl.close();
}

main().catch(e => {
    console.error("Erreur:", e);
    rl.close();
});
