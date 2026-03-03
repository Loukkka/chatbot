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
const sseAdminAll = new Set(); // Admin subscribers qui veulent TOUS les events

function broadcastSSE(clientId, type, payload) {
    const data = `data: ${JSON.stringify({ type, payload, clientId, time: new Date().toISOString() })}\n\n`;
    // Envoyer aux abonnés du client spécifique
    const set = sseClients.get(clientId);
    if (set) {
        for (const client of set) {
            try { client.write(data); } catch { set.delete(client); }
        }
    }
    // Envoyer aussi aux admins abonnés à "tous les clients"
    for (const admin of sseAdminAll) {
        try { admin.write(data); } catch { sseAdminAll.delete(admin); }
    }
}

// Heartbeat SSE toutes les 30s pour éviter les déconnexions
setInterval(() => {
    const ping = `:keepalive\n\n`;
    for (const [, set] of sseClients) {
        for (const client of set) {
            try { client.write(ping); } catch { set.delete(client); }
        }
    }
    for (const admin of sseAdminAll) {
        try { admin.write(ping); } catch { sseAdminAll.delete(admin); }
    }
}, 30000);

// ============================================================
// PAGES
// ============================================================
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/new-client", (req, res) => {
    const standard = path.join(__dirname, "public", "new-client.html");
    const legacy = path.join(__dirname, "public", "new Client.html");
    if (fs.existsSync(standard)) return res.sendFile(standard);
    if (fs.existsSync(legacy)) return res.sendFile(legacy);
    return res.status(404).send("Page introuvable");
});
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
    const existingKeys = new Set(Object.values(clients).map(c => c?.clientKey).filter(Boolean));
    function generateClientKey() {
        let key = "";
        do {
            key = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
        } while (existingKeys.has(key));
        return key;
    }
    // Générer une clé unique pour ce client (on la garde si elle existe déjà)
    const clientKey = clients[cleanId]?.clientKey || generateClientKey();
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
    const key = req.query.key;
    const clientId = req.query.clientId || "";
    const isAdmin = key === ADMIN_KEY;

    if (!isAdmin && !clientId) return res.status(400).json({ error: "clientId requis." });
    if (!isAuthorized(req, clientId || "__admin__")) return res.status(403).json({ error: "Accès refusé." });

    if (isAdmin && !clientId) {
        // Admin sans filtre → agréger les leads de TOUS les clients
        const clients = loadClients();
        let allLeads = [];
        for (const id of Object.keys(clients)) {
            const cl = loadLeads(id);
            allLeads = allLeads.concat(cl.map(l => ({ ...l, clientId: id })));
        }
        allLeads.sort((a, b) => (b.id || 0) - (a.id || 0));
        res.json({ total: allLeads.length, leads: allLeads });
    } else {
        const leads = loadLeads(clientId);
        res.json({ total: leads.length, leads });
    }
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
    const key = req.query.key;
    const clientId = req.query.clientId || "";
    const isAdmin = key === ADMIN_KEY;

    if (!isAdmin && !clientId) return res.status(400).json({ error: "clientId requis." });
    if (!isAuthorized(req, clientId || "__admin__")) return res.status(403).json({ error: "Accès refusé." });

    // Charger les events : soit d'un client, soit de tous
    let allEvents = [];
    if (isAdmin && !clientId) {
        const clients = loadClients();
        for (const id of Object.keys(clients)) {
            const a = loadAnalytics(id);
            allEvents = allEvents.concat(a.events.map(ev => ({ ...ev, clientId: id })));
        }
        allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
        const analytics = loadAnalytics(clientId);
        allEvents = analytics.events;
    }

    const sessionsWithMsg = new Set(), sessionsWithLead = new Set();
    let opens = 0, leads = 0, abandonments = 0;

    for (const ev of allEvents) {
        if (ev.event === "open") opens++;
        if (ev.event === "user_message") sessionsWithMsg.add(ev.sessionId);
        if (ev.event === "lead_captured") { leads++; sessionsWithLead.add(ev.sessionId); }
    }
    for (const ev of allEvents) {
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
        recentEvents: allEvents.slice(-100)
    });
});

// SSE — accepte adminKey ou clientKey
app.get("/api/stream", (req, res) => {
    const key = req.query.key;
    const clientId = req.query.clientId || "";
    const isAdmin = key === ADMIN_KEY;

    // Vérifier l'authentification
    if (!isAdmin) {
        if (!clientId) return res.status(400).json({ error: "clientId requis." });
        const client = getClient(clientId);
        if (!client || client.clientKey !== key) return res.status(403).json({ error: "Accès refusé." });
    }

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`data: ${JSON.stringify({ type: "connected", clientId: clientId || "__all__" })}\n\n`);

    if (isAdmin && !clientId) {
        // Admin sans clientId → reçoit TOUS les events de tous les clients
        sseAdminAll.add(res);
        req.on("close", () => sseAdminAll.delete(res));
    } else {
        // Client spécifique (ou admin filtré sur un client)
        const id = clientId || "default";
        if (!sseClients.has(id)) sseClients.set(id, new Set());
        sseClients.get(id).add(res);
        req.on("close", () => sseClients.get(id)?.delete(res));
    }
});

// ============================================================
// PROSPECTION MODULE
// ============================================================
const crypto = require("crypto");
const PROSPECTS_FILE = path.join(DATA_DIR, "prospects.json");
const EMAIL_HISTORY_FILE = path.join(DATA_DIR, "email_history.json");
const UNSUBSCRIBED_FILE = path.join(DATA_DIR, "unsubscribed.json");

function loadProspects() {
    try { if (fs.existsSync(PROSPECTS_FILE)) return JSON.parse(fs.readFileSync(PROSPECTS_FILE, "utf-8")); } catch (e) {}
    return [];
}
function saveProspects(p) { fs.writeFileSync(PROSPECTS_FILE, JSON.stringify(p, null, 2), "utf-8"); }
function loadEmailHistory() {
    try { if (fs.existsSync(EMAIL_HISTORY_FILE)) return JSON.parse(fs.readFileSync(EMAIL_HISTORY_FILE, "utf-8")); } catch (e) {}
    return [];
}
function saveEmailHistory(h) { fs.writeFileSync(EMAIL_HISTORY_FILE, JSON.stringify(h, null, 2), "utf-8"); }
function loadUnsubscribed() {
    try { if (fs.existsSync(UNSUBSCRIBED_FILE)) return JSON.parse(fs.readFileSync(UNSUBSCRIBED_FILE, "utf-8")); } catch (e) {}
    return [];
}
function saveUnsubscribed(u) { fs.writeFileSync(UNSUBSCRIBED_FILE, JSON.stringify(u, null, 2), "utf-8"); }
function generateToken() { return crypto.randomBytes(16).toString("hex"); }

// --- Email sending (Brevo API ou SMTP fallback) ---
async function sendEmail(to, subject, html) {
    const fromName = process.env.SMTP_FROM_NAME || "Service Chatbot IA";
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "noreply@example.com";

    // Méthode 1 : Brevo API (recommandé pour Render)
    if (process.env.BREVO_API_KEY) {
        console.log("📧 Envoi via Brevo API à", to);
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-key": process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: { name: fromName, email: fromEmail },
                to: [{ email: to }],
                subject: subject,
                htmlContent: html,
                headers: { "List-Unsubscribe": `<${process.env.SERVER_URL || "https://chatbot-jeoh.onrender.com"}/unsubscribe?email=${encodeURIComponent(to)}>` }
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || JSON.stringify(data));
        return data;
    }

    // Méthode 2 : SMTP (fonctionne en local)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log("📧 Envoi via SMTP à", to);
        const transporter = getEmailTransporter();
        return await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: to,
            subject: subject,
            html: html
        });
    }

    throw new Error("Aucune méthode d'envoi configurée. Ajoutez BREVO_API_KEY ou SMTP_USER/SMTP_PASS.");
}

function buildProspectionEmailHTML(prospect) {
    const SERVER_URL = process.env.SERVER_URL || "https://chatbot-jeoh.onrender.com";
    const fromName = process.env.SMTP_FROM_NAME || "Service Chatbot IA";
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
    const unsubUrl = `${SERVER_URL}/unsubscribe?email=${encodeURIComponent(prospect.email)}&token=${encodeURIComponent(prospect.unsubToken || "")}`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:linear-gradient(135deg,#4B6BFB,#7c3aed);padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">🤖 Chatbot IA pour ${prospect.companyName}</h1>
<p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Automatisez votre service client et générez plus de leads</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">Bonjour <strong>${prospect.companyName}</strong>,</p>
<p style="margin:0 0 16px;color:#555;font-size:14px;line-height:1.7;">Je me permets de vous contacter car je développe des <strong>chatbots IA sur mesure</strong> pour les entreprises comme la vôtre. Notre solution s'installe en 2 minutes sur n'importe quel site web.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9ff;border-radius:8px;margin:20px 0;">
<tr><td style="padding:24px;">
<p style="margin:0 0 12px;color:#4B6BFB;font-size:14px;font-weight:700;">💡 Les bénéfices pour ${prospect.companyName} :</p>
<ul style="margin:0;padding:0 0 0 18px;color:#555;font-size:13px;line-height:2;">
<li>Réponses automatiques 24h/24 aux questions de vos visiteurs</li>
<li>Qualification automatique de vos prospects</li>
<li>Capture de leads qualifiés même hors horaires</li>
<li>Chatbot personnalisé à votre image et vos services</li>
<li>Dashboard en temps réel pour suivre vos performances</li>
</ul></td></tr></table>
<p style="margin:20px 0;color:#555;font-size:14px;line-height:1.7;">Nos clients constatent en moyenne une <strong>augmentation significative des demandes de contact</strong> grâce à l'engagement automatique du chatbot.</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 0;">
<a href="mailto:${fromEmail}?subject=D%C3%A9monstration%20Chatbot%20IA%20-%20${encodeURIComponent(prospect.companyName)}" style="display:inline-block;background:linear-gradient(135deg,#4B6BFB,#7c3aed);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;">🎁 Demander une démonstration gratuite</a>
</td></tr></table>
<p style="margin:16px 0 0;color:#555;font-size:14px;line-height:1.7;">N'hésitez pas à répondre directement à cet email pour toute question.</p>
<p style="margin:24px 0 0;color:#333;font-size:14px;">Cordialement,<br/><strong>${fromName}</strong></p>
</td></tr>
<tr><td style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #eee;">
<p style="margin:0;color:#999;font-size:11px;line-height:1.6;text-align:center;">
Cet email a été envoyé à ${prospect.email} car votre adresse email professionnelle est publiquement disponible.<br/>
Conformément au RGPD, vous disposez d'un droit d'accès, de rectification et de suppression de vos données.<br/>
<a href="${unsubUrl}" style="color:#4B6BFB;text-decoration:underline;">Se désinscrire / Ne plus recevoir d'emails</a>
</p></td></tr>
</table></td></tr></table></body></html>`;
}

// --- Sending queue ---
let sendingInProgress = false;
let sendingQueue = [];
let sendingStats = { total: 0, sent: 0, errors: 0, current: "" };

async function processSendingQueue() {
    if (sendingInProgress) return;
    sendingInProgress = true;
    const DELAY_MS = parseInt(process.env.EMAIL_DELAY_MS) || 30000;
    console.log(`📧 Démarrage envoi de ${sendingQueue.length} email(s), délai: ${DELAY_MS}ms`);
    console.log(`📧 Méthode: ${process.env.BREVO_API_KEY ? "Brevo API" : "SMTP"}`);
    const history = loadEmailHistory();
    const unsubscribed = loadUnsubscribed().map(u => u.email.toLowerCase());

    for (let i = 0; i < sendingQueue.length; i++) {
        const prospect = sendingQueue[i];
        sendingStats.current = prospect.companyName;

        if (unsubscribed.includes(prospect.email.toLowerCase())) {
            history.push({ id: Date.now(), prospectId: prospect.id, companyName: prospect.companyName, email: prospect.email, status: "skipped", reason: "Désabonné", sentAt: new Date().toISOString() });
            sendingStats.sent++;
            saveEmailHistory(history);
            continue;
        }

        const recentlySent = history.some(h => h.email === prospect.email && h.status === "sent" && (Date.now() - new Date(h.sentAt).getTime()) < 30 * 86400000);
        if (recentlySent) {
            history.push({ id: Date.now(), prospectId: prospect.id, companyName: prospect.companyName, email: prospect.email, status: "skipped", reason: "Déjà contacté (<30j)", sentAt: new Date().toISOString() });
            sendingStats.sent++;
            saveEmailHistory(history);
            continue;
        }

        try {
            const subject = `${prospect.companyName} — Boostez votre service client avec l'IA`;
            const html = buildProspectionEmailHTML(prospect);
            await sendEmail(prospect.email, subject, html);
            history.push({ id: Date.now(), prospectId: prospect.id, companyName: prospect.companyName, email: prospect.email, website: prospect.website || "", status: "sent", sentAt: new Date().toISOString() });
            sendingStats.sent++;

            const prospects = loadProspects();
            const p = prospects.find(pp => pp.id === prospect.id);
            if (p) { p.status = "sent"; p.sentAt = new Date().toISOString(); }
            saveProspects(prospects);
            console.log(`📧 Email envoyé à ${prospect.email} (${prospect.companyName})`);
        } catch (err) {
            console.error(`❌ Erreur envoi à ${prospect.email}:`, err.message);
            history.push({ id: Date.now(), prospectId: prospect.id, companyName: prospect.companyName, email: prospect.email, status: "error", error: err.message, sentAt: new Date().toISOString() });
            sendingStats.errors++;
            const prospects = loadProspects();
            const p = prospects.find(pp => pp.id === prospect.id);
            if (p) { p.status = "error"; p.errorMessage = err.message; }
            saveProspects(prospects);
        }
        saveEmailHistory(history);
        if (i < sendingQueue.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
    }
    sendingQueue = [];
    sendingInProgress = false;
    sendingStats.current = "";
}

// --- Prospection Page ---
app.get("/prospection", (req, res) => res.sendFile(path.join(__dirname, "public", "prospection.html")));

// --- List prospects ---
app.get("/api/admin/prospects", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    res.json({ total: loadProspects().length, prospects: loadProspects() });
});

// --- AI Search ---
app.post("/api/admin/prospects/search", async (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    if (!API_KEY) return res.status(500).json({ error: "Clé API OpenRouter non configurée." });

    const { sector, location, count } = req.body;
    const cleanSector = sanitizeText(sector, 100);
    const cleanLocation = sanitizeText(location, 100);
    const cleanCount = Math.min(Math.max(parseInt(count) || 5, 1), 100);
    if (!cleanSector) return res.status(400).json({ error: "Secteur requis." });

    const prompt = `Génère une liste de ${cleanCount} entreprises françaises réalistes dans le secteur "${cleanSector}"${cleanLocation ? ` situées à/en ${cleanLocation}` : ""}.
Ce sont des suggestions de profils type pour de la prospection B2B.

Retourne UNIQUEMENT un tableau JSON valide (sans markdown, sans backticks, sans texte avant/après) avec ce format exact:
[{"companyName":"Nom","email":"contact@domaine.fr","website":"https://www.domaine.fr","sector":"Sous-secteur","description":"Description courte"}]

Règles:
- Noms crédibles et variés
- Emails au format contact@ ou info@ avec domaines cohérents avec le nom
- Sites web plausibles
- Sous-secteurs diversifiés dans "${cleanSector}"
- ${cleanCount} résultats exactement`;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
            body: JSON.stringify({ model: "google/gemini-2.0-flash-lite-001", messages: [{ role: "user", content: prompt }], temperature: 0.9, max_tokens: 4096 })
        });
        const data = await response.json();
        if (!response.ok) return res.status(500).json({ error: data.error?.message || "Erreur API" });

        const content = data.choices?.[0]?.message?.content || "[]";
        let prospects;
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            prospects = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        } catch (e) { return res.status(500).json({ error: "Erreur parsing réponse IA.", raw: content }); }

        const enriched = prospects.map((p, i) => ({
            id: Date.now() + i,
            companyName: sanitizeText(p.companyName, 200),
            email: sanitizeText(p.email, 254).toLowerCase(),
            website: sanitizeText(p.website, 500),
            sector: sanitizeText(p.sector, 100),
            description: sanitizeText(p.description, 500),
            status: "pending",
            source: "ai_search",
            unsubToken: generateToken(),
            createdAt: new Date().toISOString()
        }));
        res.json({ total: enriched.length, prospects: enriched });
    } catch (err) {
        console.error("Erreur recherche IA:", err);
        res.status(500).json({ error: "Erreur de connexion au service IA." });
    }
});

// --- Save prospects (batch) ---
app.post("/api/admin/prospects", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const { prospects: newProspects } = req.body;
    if (!Array.isArray(newProspects) || !newProspects.length) return res.status(400).json({ error: "Liste de prospects requise." });

    const existing = loadProspects();
    const unsubscribed = loadUnsubscribed().map(u => u.email.toLowerCase());
    const existingEmails = new Set(existing.map(p => p.email.toLowerCase()));
    let added = 0, skipped = 0;

    for (const p of newProspects) {
        const email = sanitizeText(p.email, 254).toLowerCase();
        if (!isValidEmail(email) || existingEmails.has(email) || unsubscribed.includes(email)) { skipped++; continue; }
        existing.push({
            id: p.id || Date.now() + added,
            companyName: sanitizeText(p.companyName, 200), email,
            website: sanitizeText(p.website, 500), sector: sanitizeText(p.sector, 100),
            description: sanitizeText(p.description, 500),
            status: "pending", source: p.source || "manual",
            unsubToken: p.unsubToken || generateToken(),
            createdAt: p.createdAt || new Date().toISOString()
        });
        existingEmails.add(email);
        added++;
    }
    saveProspects(existing);
    res.json({ ok: true, added, skipped, total: existing.length });
});

// --- Delete prospect ---
app.delete("/api/admin/prospects/:id", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const prospects = loadProspects();
    saveProspects(prospects.filter(p => p.id !== parseInt(req.params.id)));
    res.json({ ok: true });
});

// --- Clear all prospects ---
app.delete("/api/admin/prospects", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    saveProspects([]);
    res.json({ ok: true });
});

// --- Send emails ---
app.post("/api/admin/prospects/send", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    if (!process.env.BREVO_API_KEY && (!process.env.SMTP_USER || !process.env.SMTP_PASS)) return res.status(400).json({ error: "Configuration email manquante. Ajoutez BREVO_API_KEY ou SMTP_USER/SMTP_PASS dans les variables d'environnement." });

    const { prospectIds } = req.body;
    if (!Array.isArray(prospectIds) || !prospectIds.length) return res.status(400).json({ error: "Sélectionnez des prospects." });
    if (sendingInProgress) return res.status(409).json({ error: "Envoi déjà en cours. Veuillez patienter." });

    const prospects = loadProspects();
    console.log("📧 IDs reçus:", prospectIds);
    console.log("📧 IDs disponibles:", prospects.map(p => p.id));
    const toSend = prospects.filter(p => prospectIds.includes(p.id) && p.status !== "sent");
    console.log("📧 Prospects à envoyer:", toSend.length, toSend.map(p => p.email));
    if (!toSend.length) return res.status(400).json({ error: "Aucun prospect valide à contacter." });

    for (const p of toSend) { const f = prospects.find(pp => pp.id === p.id); if (f) f.status = "sending"; }
    saveProspects(prospects);

    sendingQueue = toSend;
    sendingStats = { total: toSend.length, sent: 0, errors: 0, current: "" };
    processSendingQueue();
    res.json({ ok: true, queued: toSend.length });
});

// --- Sending status ---
app.get("/api/admin/prospects/sending-status", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    res.json({ inProgress: sendingInProgress, ...sendingStats, remaining: sendingStats.total - sendingStats.sent - sendingStats.errors });
});

// --- Email history ---
app.get("/api/admin/prospects/history", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const history = loadEmailHistory().sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    res.json({ total: history.length, history });
});

// --- Unsubscribe page ---
app.get("/unsubscribe", (req, res) => {
    const { email, token } = req.query;
    res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Désinscription</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#f4f4f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:12px;padding:40px;max-width:440px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{font-size:22px;margin-bottom:12px;color:#333}.desc{color:#666;font-size:14px;line-height:1.6;margin-bottom:24px}
button{background:linear-gradient(135deg,#f87171,#dc2626);color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
button:hover{opacity:.9}.success{color:#16a34a;font-weight:600;font-size:15px}.error{color:#dc2626;font-size:14px}
</style></head><body><div class="card"><h1>📧 Désinscription</h1>
<p class="desc">Vous souhaitez ne plus recevoir nos emails ?<br/>Cliquez sur le bouton ci-dessous pour confirmer.</p>
<div id="msg"></div>
<button id="btn" onclick="unsub()">Confirmer la désinscription</button>
</div><script>
async function unsub(){
    document.getElementById("btn").disabled=true;document.getElementById("btn").textContent="Traitement...";
    try{const r=await fetch("/api/unsubscribe",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:"${(email || "").replace(/"/g, "")}",token:"${(token || "").replace(/"/g, "")}"})});
    const d=await r.json();if(r.ok){document.getElementById("msg").innerHTML='<p class="success">✅ '+d.message+'</p>';document.getElementById("btn").style.display="none";}
    else{document.getElementById("msg").innerHTML='<p class="error">❌ '+d.error+'</p>';document.getElementById("btn").disabled=false;document.getElementById("btn").textContent="Réessayer";}}
    catch(e){document.getElementById("msg").innerHTML='<p class="error">Erreur de connexion.</p>';document.getElementById("btn").disabled=false;}}
</script></body></html>`);
});

app.post("/api/unsubscribe", (req, res) => {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ error: "Paramètres manquants." });
    const prospects = loadProspects();
    const prospect = prospects.find(p => p.email.toLowerCase() === email.toLowerCase() && p.unsubToken === token);
    if (!prospect) return res.status(400).json({ error: "Lien de désinscription invalide." });

    const unsubscribed = loadUnsubscribed();
    if (!unsubscribed.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        unsubscribed.push({ email: email.toLowerCase(), unsubscribedAt: new Date().toISOString() });
        saveUnsubscribed(unsubscribed);
    }
    res.json({ ok: true, message: "Vous avez été désabonné avec succès. Vous ne recevrez plus d'emails de notre part." });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
    console.log(`\n✅ Serveur multi-clients démarré sur http://localhost:${PORT}`);
    console.log(`🔐 Admin : http://localhost:${PORT}/admin`);
    console.log(`📊 Dashboard client : http://localhost:${PORT}/dashboard?clientId=XXX&key=YYY`);
    console.log(`➕ Créer client : http://localhost:${PORT}/new-client`);
    console.log(`📧 Prospection : http://localhost:${PORT}/prospection`);
    if (!API_KEY) console.warn("⚠️  OPENROUTER_API_KEY manquante dans .env");
    if (!process.env.BREVO_API_KEY && !process.env.SMTP_USER) console.warn("⚠️  Email non configuré — ajoutez BREVO_API_KEY ou SMTP_USER/SMTP_PASS");
    if (process.env.BREVO_API_KEY) console.log("📧 Email configuré via Brevo API");
    else if (process.env.SMTP_USER) console.log("📧 Email configuré via SMTP");
});