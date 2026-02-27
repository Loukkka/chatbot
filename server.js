require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

// ============================================================
// DOSSIERS DE DONNÉES
// ============================================================
const DATA_DIR = path.join(__dirname, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
// GESTION CLIENTS
// ============================================================
function loadClients() {
    try {
        if (fs.existsSync(CLIENTS_FILE))
            return JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf-8"));
    } catch (e) { console.error("Erreur clients.json:", e.message); }
    return {};
}
function saveClients(clients) {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf-8");
}
function getClient(clientId) {
    return loadClients()[clientId] || null;
}

// ============================================================
// FICHIERS PAR CLIENT
// ============================================================
function loadLeads(clientId) {
    try {
        const f = path.join(DATA_DIR, `leads_${clientId}.json`);
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch (e) {}
    return [];
}
function saveLeads(clientId, leads) {
    fs.writeFileSync(path.join(DATA_DIR, `leads_${clientId}.json`), JSON.stringify(leads, null, 2), "utf-8");
}
function loadAnalytics(clientId) {
    try {
        const f = path.join(DATA_DIR, `analytics_${clientId}.json`);
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch (e) {}
    return { events: [] };
}
function saveAnalytics(clientId, data) {
    fs.writeFileSync(path.join(DATA_DIR, `analytics_${clientId}.json`), JSON.stringify(data, null, 2), "utf-8");
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
function buildSystemPrompt(cfg) {
    if (!cfg) return "Tu es un assistant virtuel. Réponds de manière professionnelle et utile.";

    const servicesText = (cfg.services || []).map((s, i) =>
        `${i + 1}. **${s.name}** — ${s.price}\n   - ${s.description}`
    ).join("\n");
    const questionsText = (cfg.botPersonality?.qualifyingQuestions || []).map(q => `  • ${q}`).join("\n");
    const strengthsText = (cfg.botPersonality?.strengths || []).map(s => `- ${s}`).join("\n");
    const restrictionsText = (cfg.botPersonality?.restrictions || []).map(r => `- ${r}`).join("\n");

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
- Qualifier les prospects :
${questionsText}
- ${cfg.botPersonality?.callToAction || 'Proposer un rendez-vous'}
- Collecter nom, email et téléphone
- Points forts :
${strengthsText}

🗣️ TON STYLE :
- Toujours répondre en ${cfg.botPersonality?.language || 'français'}
- ${cfg.botPersonality?.tone || 'Ton professionnel mais chaleureux'}
- ${cfg.botPersonality?.responseLength || 'Réponses concises (2-4 phrases max)'}
- Ne jamais inventer de faux témoignages ou statistiques

🚫 NE JAMAIS :
${restrictionsText}`;
}

// ============================================================
// HELPERS
// ============================================================
function sanitizeText(str, maxLen = 500) {
    if (typeof str !== "string") return "";
    return str.replace(/[<>]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, maxLen);
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function isValidPhone(p) { if (!p) return true; return /^[+\d][\d\s\-.()]{6,20}$/.test(p); }
function isValidUrl(u) { if (!u) return true; try { new URL(u); return true; } catch { return false; } }

const rateLimitMap = new Map();
function rateLimit(key, max) {
    const now = Date.now();
    if (!rateLimitMap.has(key)) rateLimitMap.set(key, []);
    const ts = rateLimitMap.get(key).filter(t => now - t < 60000);
    ts.push(now);
    rateLimitMap.set(key, ts);
    return ts.length > max;
}
setInterval(() => {
    const now = Date.now();
    for (const [k, ts] of rateLimitMap) {
        const f = ts.filter(t => now - t < 60000);
        if (!f.length) rateLimitMap.delete(k); else rateLimitMap.set(k, f);
    }
}, 120000);

// ============================================================
// EXPRESS SETUP
// ============================================================
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
app.use((req, res, next) => {
    if (req.method === "POST" && !req.is("application/json"))
        return res.status(415).json({ error: "Content-Type application/json requis." });
    next();
});

// ============================================================
// SSE — temps réel par client
// ============================================================
const sseClients = new Map();

function broadcastSSE(clientId, type, payload) {
    const set = sseClients.get(clientId);
    if (!set) return;
    const data = `data: ${JSON.stringify({ type, payload, time: new Date().toISOString() })}\n\n`;
    for (const client of set) {
        try { client.write(data); } catch { set.delete(client); }
    }
}

app.get("/api/stream", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const clientId = req.query.clientId || "default";
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);
    if (!sseClients.has(clientId)) sseClients.set(clientId, new Set());
    sseClients.get(clientId).add(res);
    req.on("close", () => sseClients.get(clientId)?.delete(res));
});

// ============================================================
// PAGES
// ============================================================
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/new-client", (req, res) => res.sendFile(path.join(__dirname, "public", "new-client.html")));
app.get("/embed", (req, res) => res.sendFile(path.join(__dirname, "public", "embed-example.html")));

// ============================================================
// AUTH CLIENT — vérifier la clé d'un client
// ============================================================
app.get("/api/client-auth", (req, res) => {
    const { clientId, key } = req.query;
    if (!clientId || !key) return res.status(400).json({ error: "clientId et key requis." });
    const client = getClient(clientId);
    if (!client) return res.status(404).json({ error: "Client introuvable." });
    if (client.clientKey !== key) return res.status(403).json({ error: "Clé invalide." });
    res.json({ ok: true, companyName: client.companyName });
});

// ============================================================
// ADMIN — Gestion clients
// ============================================================
app.get("/api/admin/clients", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const clients = loadClients();
    const SERVER_URL = process.env.SERVER_URL || "https://chatbot-jeoh.onrender.com";
    const list = Object.entries(clients).map(([id, cfg]) => ({
        clientId: id,
        companyName: cfg.companyName || id,
        createdAt: cfg.createdAt || null,
        clientKey: cfg.clientKey || null,
        dashboardUrl: `${SERVER_URL}/dashboard?clientId=${id}&key=${cfg.clientKey || ""}`,
        snippet: `<script>\nwindow.CHATBOT_CONFIG = { server: "${SERVER_URL}", clientId: "${id}" };\n</script>\n<script src="${SERVER_URL}/widget.js"></script>`
    }));
    res.json({ total: list.length, clients: list });
});

app.post("/api/admin/clients", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const { clientId, config } = req.body;
    if (!clientId || !config) return res.status(400).json({ error: "clientId et config requis." });
    const cleanId = clientId.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 50);
    if (!cleanId) return res.status(400).json({ error: "clientId invalide." });
    const clients = loadClients();
    const SERVER_URL = process.env.SERVER_URL || "https://chatbot-jeoh.onrender.com";
    // Générer une clé unique pour ce client (on la garde si elle existe déjà)
    const clientKey = clients[cleanId]?.clientKey || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    clients[cleanId] = {
        ...config, clientId: cleanId, clientKey,
        updatedAt: new Date().toISOString(),
        createdAt: clients[cleanId]?.createdAt || new Date().toISOString()
    };
    saveClients(clients);
    res.json({
        ok: true, clientId: cleanId, clientKey,
        dashboardUrl: `${SERVER_URL}/dashboard?clientId=${cleanId}&key=${clientKey}`,
        snippet: `<script>\nwindow.CHATBOT_CONFIG = { server: "${SERVER_URL}", clientId: "${cleanId}" };\n</script>\n<script src="${SERVER_URL}/widget.js"></script>`
    });
});

app.delete("/api/admin/clients/:clientId", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const clients = loadClients();
    delete clients[req.params.clientId];
    saveClients(clients);
    res.json({ ok: true });
});


// ============================================================
// WIDGET CONFIG
// ============================================================
app.get("/api/widget-config", (req, res) => {
    const cfg = req.query.clientId ? getClient(req.query.clientId) : null;
    const chatbot = cfg?.chatbot || {};
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
        companyName: cfg?.companyName || "",
        rgpdText: cfg?.rgpd?.consentText || ""
    });
});

// ============================================================
// CHAT
// ============================================================
app.post("/api/chat", async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (rateLimit("chat:" + ip, 15)) return res.status(429).json({ error: "Trop de requêtes." });
    if (!API_KEY) return res.status(500).json({ error: "Clé API non configurée." });

    const { messages, clientId } = req.body;
    if (!messages || !Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "Messages invalides." });
    if (messages.length > 30) return res.status(400).json({ error: "Historique trop long." });

    for (const m of messages) {
        if (!m || typeof m !== "object") return res.status(400).json({ error: "Format invalide." });
        if (!["user", "model", "assistant"].includes(m.role)) return res.status(400).json({ error: "Rôle invalide." });
        const text = m.parts?.[0]?.text || m.content || "";
        if (typeof text !== "string" || text.length > 5000) return res.status(400).json({ error: "Contenu invalide." });
    }

    const clientCfg = clientId ? getClient(clientId) : null;
    const systemPrompt = buildSystemPrompt(clientCfg);

    const openRouterMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({
            role: m.role === "model" ? "assistant" : "user",
            content: sanitizeText(m.parts?.[0]?.text || m.content || "", 2000)
        })).filter(m => m.content.length > 0)
    ];

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
            body: JSON.stringify({ model: "google/gemini-2.0-flash-lite-001", messages: openRouterMessages, temperature: 0.7, max_tokens: 1024 })
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Erreur API" });
        res.json({ reply: data.choices?.[0]?.message?.content || "Je n'ai pas pu générer de réponse." });
    } catch (err) {
        console.error("Erreur chat:", err);
        res.status(500).json({ error: "Erreur de connexion au service IA." });
    }
});

// ============================================================
// LEADS
// ============================================================
app.post("/api/lead", (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (rateLimit("lead:" + ip, 5)) return res.status(429).json({ error: "Trop de soumissions." });

    const { firstName, lastName, email, phone, consent, source, conversation, timestamp, clientId } = req.body;
    const cleanFirstName = sanitizeText(firstName, 50);
    if (!cleanFirstName || cleanFirstName.length < 2) return res.status(400).json({ error: "Prénom requis." });
    const cleanLastName = sanitizeText(lastName, 50);
    if (!cleanLastName || cleanLastName.length < 2) return res.status(400).json({ error: "Nom requis." });
    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: "Email invalide." });
    const cleanPhone = sanitizeText(phone, 25);
    if (cleanPhone && !isValidPhone(cleanPhone)) return res.status(400).json({ error: "Téléphone invalide." });
    if (!consent) return res.status(400).json({ error: "Consentement RGPD requis." });

    const id = sanitizeText(clientId, 50) || "default";
    const cleanSource = sanitizeText(source, 500);

    const lead = {
        id: Date.now(), clientId: id,
        firstName: cleanFirstName, lastName: cleanLastName,
        name: cleanFirstName + " " + cleanLastName,
        email: cleanEmail, phone: cleanPhone,
        consent: true, consentDate: new Date().toISOString(),
        source: isValidUrl(cleanSource) ? cleanSource : "",
        ip, timestamp: timestamp || new Date().toISOString(),
        conversationLength: Array.isArray(conversation) ? Math.min(conversation.length, 30) : 0,
        conversation: Array.isArray(conversation)
            ? conversation.slice(-30).map(m => ({
                role: m.role === "model" ? "bot" : "user",
                text: sanitizeText((m.parts?.[0]?.text || m.content) || "", 2000)
            })).filter(m => m.text.length > 0)
            : []
    };

    const leads = loadLeads(id);
    leads.push(lead);
    saveLeads(id, leads);
    console.log(`[${id}] Nouveau lead : ${lead.name} — ${lead.email}`);
    broadcastSSE(id, "new_lead", lead);
    res.json({ success: true, message: "Lead enregistré." });
});


// Helper : vérifie soit adminKey soit clientKey valide pour un clientId
function isAuthorized(req, clientId) {
    const key = req.query.key;
    if (key === ADMIN_KEY) return true;
    const client = getClient(clientId);
    return client && client.clientKey === key;
}

app.get("/api/leads", (req, res) => {
    const clientId = req.query.clientId || "default";
    if (!isAuthorized(req, clientId)) return res.status(403).json({ error: "Accès refusé." });
    const leads = loadLeads(clientId);
    res.json({ total: leads.length, leads });
});

// ============================================================
// ANALYTICS
// ============================================================
app.post("/api/analytics", (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (rateLimit("analytics:" + ip, 60)) return res.status(429).json({ error: "Trop de requêtes." });

    const { sessionId, event, data, page, timestamp, clientId } = req.body;
    const cleanEvent = sanitizeText(event, 50);
    if (!cleanEvent) return res.status(400).json({ error: "Event requis." });

    const id = sanitizeText(clientId, 50) || "default";
    const analytics = loadAnalytics(id);

    analytics.events.push({ sessionId, event: cleanEvent, data, page, timestamp: timestamp || new Date().toISOString() });
    if (analytics.events.length > 5000) analytics.events = analytics.events.slice(-5000);
    saveAnalytics(id, analytics);

    broadcastSSE(id, "analytics", { sessionId, event: cleanEvent, data, page, timestamp });
    res.json({ ok: true });
});

app.get("/api/analytics", (req, res) => {
    const clientId = req.query.clientId || "default";
    if (!isAuthorized(req, clientId)) return res.status(403).json({ error: "Accès refusé." });
    const analytics = loadAnalytics(clientId);

    const sessionsWithMsg = new Set(), sessionsWithLead = new Set();
    let opens = 0, leads = 0, abandonments = 0;

    for (const ev of analytics.events) {
        if (ev.event === "open") opens++;
        if (ev.event === "user_message") sessionsWithMsg.add(ev.sessionId);
        if (ev.event === "lead_captured") { leads++; sessionsWithLead.add(ev.sessionId); }
    }
    for (const ev of analytics.events) {
        if (ev.event === "close" && ev.data?.messages > 2 && !sessionsWithLead.has(ev.sessionId))
            abandonments++;
    }

    const conversations = sessionsWithMsg.size;
    res.json({
        stats: {
            opens, conversations, leads, abandonments,
            conversionRate: conversations > 0 ? ((leads / conversations) * 100).toFixed(1) + "%" : "0%",
            abandonRate: conversations > 0 ? ((abandonments / conversations) * 100).toFixed(1) + "%" : "0%"
        },
        recentEvents: analytics.events.slice(-100)
    });
});

// SSE — accepte aussi la clientKey
app.get("/api/stream", (req, res) => {
    const clientId = req.query.clientId || "default";
    if (!isAuthorized(req, clientId)) return res.status(403).json({ error: "Accès refusé." });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);
    if (!sseClients.has(clientId)) sseClients.set(clientId, new Set());
    sseClients.get(clientId).add(res);
    req.on("close", () => sseClients.get(clientId)?.delete(res));
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
    console.log(`\n✅ Serveur multi-clients démarré sur http://localhost:${PORT}`);
    console.log(`🔐 Admin : http://localhost:${PORT}/admin`);
    console.log(`📊 Dashboard client : http://localhost:${PORT}/dashboard?clientId=XXX&key=YYY`);
    console.log(`➕ Créer client : http://localhost:${PORT}/new-client`);
    if (!API_KEY) console.warn("⚠️  OPENROUTER_API_KEY manquante dans .env");
});