require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;

// ---- Chargement configuration client ----
const CONFIG_FILE = path.join(__dirname, "client-config.json");

function loadClientConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("Erreur lecture client-config.json:", e.message);
    }
    return null;
}

function buildSystemPrompt(cfg) {
    if (!cfg) return "Tu es un assistant virtuel. Réponds de manière professionnelle et utile.";

    const servicesText = (cfg.services || []).map((s, i) =>
        `${i + 1}. **${s.name}** — ${s.price}\n   - ${s.description}`
    ).join("\n");

    const questionsText = (cfg.botPersonality?.qualifyingQuestions || []).map(q =>
        `  • ${q}`
    ).join("\n");

    const strengthsText = (cfg.botPersonality?.strengths || []).map(s =>
        `- ${s}`
    ).join("\n");

    const restrictionsText = (cfg.botPersonality?.restrictions || []).map(r =>
        `- ${r}`
    ).join("\n");

    return `Tu es l'assistant virtuel de ${cfg.companyName}, ${cfg.companyDescription || ''}.

📌 À PROPOS DE L'ENTREPRISE :
- Nom : ${cfg.companyName}
- Spécialité : ${cfg.companyDescription || ''}
- Localisation : ${cfg.location || 'Non précisé'}
- Site web : ${cfg.website || 'Non précisé'}
- Email : ${cfg.email || 'Non précisé'}
- Téléphone : ${cfg.phone || 'Non précisé'}
- Horaires : ${cfg.hours || 'Non précisé'}

📦 NOS SERVICES ET TARIFS :
${servicesText || 'Contactez-nous pour en savoir plus sur nos services.'}

🎯 TON RÔLE :
- Accueillir chaleureusement les visiteurs
- Expliquer clairement les services et les tarifs
- Qualifier les prospects en posant des questions pertinentes :
${questionsText}
- ${cfg.botPersonality?.callToAction || 'Proposer un rendez-vous pour discuter du projet'}
- Collecter le nom, email et téléphone pour qu'un conseiller les rappelle
- Mettre en avant les points forts :
${strengthsText}

🗣️ TON STYLE :
- Toujours répondre en ${cfg.botPersonality?.language || 'français'}
- ${cfg.botPersonality?.tone || 'Ton professionnel mais chaleureux'}
- ${cfg.botPersonality?.responseLength || 'Réponses concises (2-4 phrases max)'}
- Utiliser des émojis avec parcimonie pour rester pro
- Ne jamais inventer de faux témoignages ou de fausses statistiques
- Si tu ne connais pas une info précise, propose de mettre en relation avec un conseiller

🚫 NE JAMAIS :
${restrictionsText}`;
}

const CLIENT_CONFIG = loadClientConfig();
const SYSTEM_PROMPT = buildSystemPrompt(CLIENT_CONFIG);

// ---- Helpers : Sanitisation & Validation ----
function sanitizeText(str, maxLen = 500) {
    if (typeof str !== "string") return "";
    return str
        .replace(/[<>]/g, "")          // Anti-XSS basique
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // Caractères de contrôle
        .trim()
        .slice(0, maxLen);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isValidPhone(phone) {
    if (!phone) return true; // optionnel
    return /^[+\d][\d\s\-.()]{6,20}$/.test(phone);
}

function isValidUrl(url) {
    if (!url) return true;
    try { new URL(url); return true; } catch { return false; }
}

// ---- Rate limiting simple par IP ----
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 min
const RATE_LIMIT_MAX_CHAT = 15;  // max 15 requêtes chat / min / IP
const RATE_LIMIT_MAX_ANALYTICS = 60; // max 60 events / min / IP

function rateLimit(key, max) {
    const now = Date.now();
    if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
    const timestamps = rateLimitMap.get(key).filter(t => now - t < RATE_LIMIT_WINDOW);
    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    return timestamps.length > max;
}

// Nettoyage périodique de la map
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of rateLimitMap) {
        const filtered = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
        if (filtered.length === 0) rateLimitMap.delete(key);
        else rateLimitMap.set(key, filtered);
    }
}, 120000);

app.use(express.json({ limit: "50kb" })); // Limiter la taille du body
app.use(express.static(path.join(__dirname, "public")));

// ---- SSE (Server-Sent Events) pour le dashboard temps réel ----
const sseClients = new Set();

function broadcastSSE(type, payload) {
    const data = JSON.stringify({ type, payload, time: new Date().toISOString() });
    for (const client of sseClients) {
        try { client.write(`data: ${data}\n\n`); } catch (e) { sseClients.delete(client); }
    }
}

app.get("/api/stream", (req, res) => {
    const secret = req.query.key;
    if (secret !== (process.env.ADMIN_KEY || "admin123")) {
        return res.status(403).json({ error: "Accès refusé." });
    }
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no"
    });
    res.write("data: {\"type\":\"connected\"}\n\n");
    sseClients.add(res);
    req.on("close", () => { sseClients.delete(res); });
});

// ---- Security Headers ----
app.use((req, res, next) => {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "SAMEORIGIN");
    res.header("X-XSS-Protection", "1; mode=block");
    res.header("Referrer-Policy", "strict-origin-when-cross-origin");
    res.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
});

// ---- CORS : autoriser les appels depuis n'importe quel site ----
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// ---- Content-Type guard for POST requests ----
app.use((req, res, next) => {
    if (req.method === "POST" && !req.is("application/json")) {
        return res.status(415).json({ error: "Content-Type application/json requis." });
    }
    next();
});

// ---- Dashboard HTML ----
app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ---- Guide d'integration ----
app.get("/embed", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "embed-example.html"));
});

// ---- Widget config endpoint (pour auto-configuration) ----
app.get("/api/widget-config", (req, res) => {
    const cfg = CLIENT_CONFIG || {};
    const chatbot = cfg.chatbot || {};
    res.json({
        name: chatbot.name || "Assistant",
        welcome: chatbot.welcome || "Bonjour ! Comment puis-je vous aider ?",
        placeholder: chatbot.placeholder || "Posez votre question...",
        color: chatbot.color || "#4B6BFB",
        logo: chatbot.logo || "",
        position: chatbot.position || "right",
        leadDelay: chatbot.leadDelay || 3,
        leadTimeDelay: chatbot.leadTimeDelay || 60,
        leadKeywords: chatbot.leadKeywords || [],
        companyName: cfg.companyName || "",
        rgpdText: cfg.rgpd?.consentText || ""
    });
});

// ---- Endpoint API chat ----
app.post("/api/chat", async (req, res) => {
    // Rate limit
    const ip = req.ip || req.connection.remoteAddress;
    if (rateLimit("chat:" + ip, RATE_LIMIT_MAX_CHAT)) {
        return res.status(429).json({ error: "Trop de requêtes. Réessayez dans un instant." });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: "Clé API non configurée sur le serveur." });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Format de message invalide." });
    }

    // Limiter le nombre de messages envoyés (anti-abus)
    if (messages.length > 30) {
        return res.status(400).json({ error: "Historique trop long." });
    }

    // Validate each message structure
    for (const m of messages) {
        if (!m || typeof m !== "object") {
            return res.status(400).json({ error: "Format de message invalide." });
        }
        const role = m.role;
        if (role !== "user" && role !== "model" && role !== "assistant") {
            return res.status(400).json({ error: "Rôle de message invalide." });
        }
        const text = m.parts?.[0]?.text || m.content || "";
        if (typeof text !== "string" || text.length > 5000) {
            return res.status(400).json({ error: "Contenu de message invalide." });
        }
    }

    // Convertir le format Gemini vers le format OpenAI/OpenRouter
    const openRouterMessages = [
        {
            role: "system",
            content: SYSTEM_PROMPT
        },
        ...messages.map(m => ({
            role: m.role === "model" ? "assistant" : "user",
            content: sanitizeText(m.parts?.[0]?.text || m.content || "", 2000)
        })).filter(m => m.content.length > 0)
    ];

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-lite-001",
                messages: openRouterMessages,
                temperature: 0.7,
                max_tokens: 1024
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Erreur OpenRouter:", data);
            return res.status(response.status).json({
                error: data.error?.message || "Erreur API"
            });
        }

        const reply = data.choices?.[0]?.message?.content
            || "Je n'ai pas pu générer de réponse.";

        res.json({ reply });

    } catch (error) {
        console.error("Erreur serveur:", error);
        res.status(500).json({ error: "Erreur de connexion au service IA." });
    }
});

// ---- Endpoint capture de leads ----
const LEADS_FILE = path.join(__dirname, "leads.json");

function loadLeads() {
    try {
        if (fs.existsSync(LEADS_FILE)) {
            return JSON.parse(fs.readFileSync(LEADS_FILE, "utf-8"));
        }
    } catch (e) { /* fichier corrompu, on repart à zéro */ }
    return [];
}

function saveLeads(leads) {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
}

app.post("/api/lead", (req, res) => {
    // Rate limit
    const ip = req.ip || req.connection.remoteAddress;
    if (rateLimit("lead:" + ip, 5)) {
        return res.status(429).json({ error: "Trop de soumissions. Réessayez plus tard." });
    }

    const { name, firstName, lastName, email, phone, consent, source, conversation, timestamp } = req.body;

    // Validation prénom
    const cleanFirstName = sanitizeText(firstName, 50);
    if (!cleanFirstName || cleanFirstName.length < 2) {
        return res.status(400).json({ error: "Prénom requis (2 caractères min)." });
    }

    // Validation nom
    const cleanLastName = sanitizeText(lastName, 50);
    if (!cleanLastName || cleanLastName.length < 2) {
        return res.status(400).json({ error: "Nom requis (2 caractères min)." });
    }

    // Validation stricte email
    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    if (!isValidEmail(cleanEmail)) {
        return res.status(400).json({ error: "Email invalide." });
    }

    // Validation téléphone
    const cleanPhone = sanitizeText(phone, 25);
    if (cleanPhone && !isValidPhone(cleanPhone)) {
        return res.status(400).json({ error: "Numéro de téléphone invalide." });
    }

    // Vérifier consentement RGPD
    if (!consent) {
        return res.status(400).json({ error: "Consentement RGPD requis." });
    }

    const cleanName = sanitizeText(name, 100) || (cleanFirstName + " " + cleanLastName);
    const cleanSource = sanitizeText(source, 500);

    const lead = {
        id: Date.now(),
        firstName: cleanFirstName,
        lastName: cleanLastName,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        consent: true,
        consentDate: new Date().toISOString(),
        source: isValidUrl(cleanSource) ? cleanSource : "",
        ip: ip,
        timestamp: timestamp || new Date().toISOString(),
        conversationLength: Array.isArray(conversation) ? Math.min(conversation.length, 30) : 0,
        conversation: Array.isArray(conversation)
            ? conversation.slice(-30).map(m => ({
                role: m.role === "model" ? "bot" : "user",
                text: sanitizeText((m.parts && m.parts[0] ? m.parts[0].text : m.content) || "", 2000)
            })).filter(m => m.text.length > 0)
            : []
    };

    const leads = loadLeads();
    leads.push(lead);
    saveLeads(leads);

    console.log(`Nouveau lead : ${lead.firstName} ${lead.lastName} — ${lead.email} — ${lead.phone || "pas de tél"}`);

    // Broadcast SSE vers le dashboard
    broadcastSSE("new_lead", {
        id: lead.id, firstName: lead.firstName, lastName: lead.lastName,
        name: lead.name, email: lead.email, phone: lead.phone,
        conversationLength: lead.conversationLength, timestamp: lead.timestamp,
        conversation: lead.conversation
    });

    res.json({ success: true, message: "Lead enregistré." });
});

// ---- Voir les leads (protégé) ----
app.get("/api/leads", (req, res) => {
    const secret = req.query.key;
    if (secret !== (process.env.ADMIN_KEY || "admin123")) {
        return res.status(403).json({ error: "Accès refusé." });
    }
    const leads = loadLeads();
    res.json({ total: leads.length, leads });
});

// ---- Analytics tracking ----
const ANALYTICS_FILE = path.join(__dirname, "analytics.json");

function loadAnalytics() {
    try {
        if (fs.existsSync(ANALYTICS_FILE)) {
            return JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8"));
        }
    } catch (e) {}
    return { events: [], stats: { opens: 0, conversations: 0, leads: 0, abandonments: 0 } };
}

function saveAnalytics(data) {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

app.post("/api/analytics", (req, res) => {
    // Rate limit analytics
    const ip = req.ip || req.connection.remoteAddress;
    if (rateLimit("analytics:" + ip, RATE_LIMIT_MAX_ANALYTICS)) {
        return res.status(429).json({ error: "Trop de requêtes." });
    }

    const { sessionId, event, data, page, timestamp } = req.body;
    const cleanEvent = sanitizeText(event, 50);
    if (!cleanEvent) return res.status(400).json({ error: "Event requis." });

    const analytics = loadAnalytics();

    // Mettre à jour les compteurs
    switch (event) {
        case "open":
            analytics.stats.opens++;
            break;
        case "user_message":
            // Compter conversation unique par session
            const hasSession = analytics.events.some(
                e => e.sessionId === sessionId && e.event === "user_message"
            );
            if (!hasSession) analytics.stats.conversations++;
            break;
        case "lead_captured":
            analytics.stats.leads++;
            break;
        case "close":
            // Abandon = fermeture sans lead
            const hadLead = analytics.events.some(
                e => e.sessionId === sessionId && e.event === "lead_captured"
            );
            if (!hadLead && data?.messages > 2) analytics.stats.abandonments++;
            break;
    }

    // Garder les 5000 derniers événements max
    analytics.events.push({ sessionId, event, data, page, timestamp });
    if (analytics.events.length > 5000) {
        analytics.events = analytics.events.slice(-5000);
    }

    saveAnalytics(analytics);

    // Broadcast SSE vers le dashboard
    broadcastSSE("analytics", { sessionId, event: cleanEvent, data, page, timestamp });

    res.json({ ok: true });
});

// ---- Dashboard analytics (protégé) ----
app.get("/api/analytics", (req, res) => {
    const secret = req.query.key;
    if (secret !== (process.env.ADMIN_KEY || "admin123")) {
        return res.status(403).json({ error: "Accès refusé." });
    }
    const analytics = loadAnalytics();

    // Recalculer les stats à partir des événements pour garantir la précision
    const sessionsWithMsg = new Set();
    const sessionsWithLead = new Set();
    let opens = 0, leads = 0, abandonments = 0;

    for (const ev of analytics.events) {
        switch (ev.event) {
            case "open":
                opens++;
                break;
            case "user_message":
                sessionsWithMsg.add(ev.sessionId);
                break;
            case "lead_captured":
                leads++;
                sessionsWithLead.add(ev.sessionId);
                break;
        }
    }

    // Abandonments: sessions with user_message + close(>2 msgs) but no lead
    for (const ev of analytics.events) {
        if (ev.event === "close" && ev.data?.messages > 2) {
            if (!sessionsWithLead.has(ev.sessionId)) {
                abandonments++;
            }
        }
    }

    const conversations = sessionsWithMsg.size;
    const conversionRate = conversations > 0
        ? ((leads / conversations) * 100).toFixed(1) + "%"
        : "0%";
    const abandonRate = conversations > 0
        ? ((abandonments / conversations) * 100).toFixed(1) + "%"
        : "0%";

    res.json({
        stats: {
            opens,
            conversations,
            leads,
            abandonments,
            conversionRate,
            abandonRate
        },
        recentEvents: analytics.events.slice(-100)
    });
});

// ---- Lancer le serveur ----
app.listen(PORT, () => {
    const cfg = CLIENT_CONFIG;
    console.log(`\n✅ Chatbot IA démarré sur http://localhost:${PORT}`);
    console.log(`🏢 Client : ${cfg ? cfg.companyName : 'Non configuré'}`);
    console.log(`📊 Dashboard : http://localhost:${PORT}/dashboard`);
    console.log(`📦 Guide d'intégration : http://localhost:${PORT}/embed`);
    console.log(`📋 API Leads : http://localhost:${PORT}/api/leads?key=${process.env.ADMIN_KEY || "admin123"}`);
    console.log(`📈 API Analytics : http://localhost:${PORT}/api/analytics?key=${process.env.ADMIN_KEY || "admin123"}`);
    if (!API_KEY) {
        console.warn("\n⚠️  ATTENTION: La variable OPENROUTER_API_KEY n'est pas définie dans .env");
    }
    if (!cfg) {
        console.warn("⚠️  ATTENTION: Aucun client-config.json trouvé. Lancez 'npm run setup' pour configurer.");
    }
    console.log("");
});
