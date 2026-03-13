require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const dns = require("dns").promises;
const crypto = require("crypto");

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
- Ne JAMAIS utiliser de formatting markdown (pas de **, *, #, _, etc.). Écris en texte brut uniquement.
- Utilise des tirets (-) ou des points (•) pour les listes, jamais des astérisques

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

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
    return { salt, hash };
}

function verifyPassword(password, hash, salt) {
    if (!password || !hash || !salt) return false;
    const candidate = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
    } catch {
        return false;
    }
}

function isClientCredentialValid(client, credential) {
    if (!client || !credential) return false;
    if (client.clientKey === credential) return true;
    return verifyPassword(credential, client.dashboardPasswordHash, client.dashboardPasswordSalt);
}

function normalizeWebsite(url) {
    const clean = sanitizeText(url || "", 500);
    if (!clean) return "";
    if (/^https?:\/\//i.test(clean)) return clean;
    return `https://${clean}`;
}

function getEmailDomain(email) {
    const clean = sanitizeText(email || "", 254).toLowerCase();
    const parts = clean.split("@");
    if (parts.length !== 2) return "";
    return parts[1].trim();
}

function getWebsiteHost(url) {
    if (!isValidUrl(url)) return "";
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return "";
    }
}

function isFreeMailboxDomain(domain) {
    return /^(gmail\.com|googlemail\.com|yahoo\.|hotmail\.|outlook\.|live\.|icloud\.com|orange\.fr|wanadoo\.fr|free\.fr|sfr\.fr|laposte\.net|gmx\.|proton\.|mail\.com)$/i.test(domain || "");
}

function tokenizeCompanyName(name) {
    const stop = new Set(["sarl", "sas", "eurl", "sa", "ets", "st", "ste", "societe", "entreprise", "services", "groupe", "du", "de", "des", "la", "le", "les", "et"]);
    return sanitizeText(name || "", 200)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 4 && !stop.has(t));
}

function websiteMatchesCompany(website, companyName) {
    const host = getWebsiteHost(website);
    if (!host) return false;
    const tokens = tokenizeCompanyName(companyName);
    if (!tokens.length) return false;
    return tokens.some(t => host.includes(t));
}

function extractEmailsFromText(text) {
    const matches = (text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const cleaned = new Set();
    for (const raw of matches) {
        const email = raw.toLowerCase().replace(/[),.;:!?]+$/g, "").trim();
        if (isValidEmail(email)) cleaned.add(email);
    }
    return [...cleaned];
}

function isEmailDomainCompatibleWithWebsite(email, website) {
    const domain = getEmailDomain(email);
    const host = getWebsiteHost(website);
    if (!domain || !host) return false;
    return domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
}

function scoreEmail(email) {
    const local = (email.split("@")[0] || "").toLowerCase();
    if (/^(contact|info|hello|bonjour|commercial|sales)$/.test(local)) return 100;
    if (/(contact|info|commercial|sales|admin)/.test(local)) return 80;
    return 40;
}

async function fetchHtml(url) {
    try {
        const res = await fetchWithTimeout(url, { method: "GET" }, 4500);
        if (!res || !res.ok) return "";
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct && !ct.includes("text/html")) return "";
        const html = await res.text();
        return (html || "").slice(0, 250000);
    } catch {
        return "";
    }
}

async function scrapeEmailFromWebsite(website) {
    if (!isValidUrl(website)) return "";
    const origin = new URL(website).origin;
    const paths = ["/", "/contact", "/nous-contacter", "/contactez-nous", "/mentions-legales"];
    const found = new Set();

    for (const p of paths) {
        const pageUrl = p === "/" ? origin : `${origin}${p}`;
        const html = await fetchHtml(pageUrl);
        if (!html) continue;
        for (const email of extractEmailsFromText(html)) {
            if (!isEmailDomainCompatibleWithWebsite(email, website)) continue;
            const domain = getEmailDomain(email);
            if (isFreeMailboxDomain(domain)) continue;
            found.add(email);
        }
    }

    const sorted = [...found].sort((a, b) => scoreEmail(b) - scoreEmail(a));
    return sorted[0] || "";
}

async function hasEmailDomainRecords(domain) {
    if (!domain) return false;
    try {
        const mx = await dns.resolveMx(domain);
        if (Array.isArray(mx) && mx.length) return true;
    } catch {}
    try {
        const a = await dns.resolve4(domain);
        if (Array.isArray(a) && a.length) return true;
    } catch {}
    return false;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
    } finally {
        clearTimeout(timer);
    }
}

async function isWebsiteReachable(url) {
    if (!isValidUrl(url)) return false;
    try {
        const head = await fetchWithTimeout(url, { method: "HEAD" });
        if (head && head.ok) return true;
    } catch {}
    try {
        const get = await fetchWithTimeout(url, { method: "GET" });
        return !!(get && get.ok);
    } catch {}
    return false;
}

async function getVerifiedWebsite(candidateWebsite) {
    const tested = new Set();
    const candidates = [];

    const normalizedCandidate = normalizeWebsite(candidateWebsite);
    if (normalizedCandidate) candidates.push(normalizedCandidate);

    for (const candidate of candidates) {
        if (!candidate || tested.has(candidate)) continue;
        tested.add(candidate);
        if (await isWebsiteReachable(candidate)) return candidate;
    }
    return "";
}

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
    const clientId = sanitizeText(req.query.clientId || "", 50);
    const key = sanitizeText(req.query.key || "", 100);
    const password = sanitizeText(req.query.password || "", 200);
    if (!clientId) return res.status(400).json({ error: "clientId requis." });
    const client = getClient(clientId);
    if (!client) return res.status(404).json({ error: "Client introuvable." });

    const passOk = verifyPassword(password, client.dashboardPasswordHash, client.dashboardPasswordSalt);
    const keyOk = isClientCredentialValid(client, key);
    if (!passOk && !keyOk) return res.status(403).json({ error: "Identifiants invalides." });

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
        hasPassword: !!(cfg.dashboardPasswordHash && cfg.dashboardPasswordSalt),
        dashboardUrl: `${SERVER_URL}/dashboard?clientId=${id}&key=${cfg.clientKey || ""}`,
        snippet: `<script>\nwindow.CHATBOT_CONFIG = { server: "${SERVER_URL}", clientId: "${id}" };\n</script>\n<script src="${SERVER_URL}/widget.js"></script>`
    }));
    res.json({ total: list.length, clients: list });
});

app.get("/api/admin/clients/:clientId", (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    const cleanId = sanitizeText(req.params.clientId || "", 50).toLowerCase();
    const clients = loadClients();
    const cfg = clients[cleanId];
    if (!cfg) return res.status(404).json({ error: "Client introuvable." });

    const safeConfig = { ...cfg };
    delete safeConfig.dashboardPasswordHash;
    delete safeConfig.dashboardPasswordSalt;
    safeConfig.hasPassword = !!(cfg.dashboardPasswordHash && cfg.dashboardPasswordSalt);

    res.json({ ok: true, clientId: cleanId, config: safeConfig });
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
    const previous = clients[cleanId] || {};
    const clientKey = previous.clientKey || generateClientKey();

    const rawPassword = sanitizeText(config.dashboardPassword || "", 200);
    const shouldSetPassword = rawPassword.length > 0;
    let dashboardPasswordHash = previous.dashboardPasswordHash || "";
    let dashboardPasswordSalt = previous.dashboardPasswordSalt || "";

    if (!previous.clientId && !shouldSetPassword) {
        return res.status(400).json({ error: "Mot de passe dashboard requis pour un nouveau client." });
    }
    if (shouldSetPassword) {
        if (rawPassword.length < 6) {
            return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
        }
        const secured = hashPassword(rawPassword);
        dashboardPasswordHash = secured.hash;
        dashboardPasswordSalt = secured.salt;
    }

    const cleanChatbot = {
        ...(config.chatbot || {}),
        name: sanitizeText(config.chatbot?.name || "Assistant", 80) || "Assistant",
        color: /^#[0-9a-fA-F]{6}$/.test(config.chatbot?.color || "") ? config.chatbot.color : "#4B6BFB",
        icon: sanitizeText(config.chatbot?.icon || "", 8),
        logo: sanitizeText(config.chatbot?.logo || "", 500),
        welcome: sanitizeText(config.chatbot?.welcome || "Bonjour ! Comment puis-je vous aider ?", 500),
        placeholder: sanitizeText(config.chatbot?.placeholder || "Posez votre question...", 120),
        position: config.chatbot?.position === "left" ? "left" : "right",
        leadDelay: Math.max(1, Math.min(20, Number.parseInt(config.chatbot?.leadDelay, 10) || 3)),
        leadTimeDelay: Math.max(10, Math.min(3600, Number.parseInt(config.chatbot?.leadTimeDelay, 10) || 60)),
        leadKeywords: Array.isArray(config.chatbot?.leadKeywords)
            ? config.chatbot.leadKeywords.map(k => sanitizeText(k, 40)).filter(Boolean).slice(0, 30)
            : []
    };

    clients[cleanId] = {
        ...config,
        clientId: cleanId,
        clientKey,
        chatbot: cleanChatbot,
        dashboardPasswordHash,
        dashboardPasswordSalt,
        updatedAt: new Date().toISOString(),
        createdAt: previous.createdAt || new Date().toISOString()
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
        icon: chatbot.icon || "",
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
    return isClientCredentialValid(client, key);
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
        if (!isClientCredentialValid(client, key)) return res.status(403).json({ error: "Accès refusé." });
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

// --- Email sending (Gmail API > SMTP > Brevo) ---

// Gmail API via HTTPS (fonctionne partout, même sur Render)
async function sendViaGmailAPI(to, subject, html, fromName, fromEmail) {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;

    // Rafraîchir l'access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token"
        })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`Gmail OAuth erreur: ${tokenData.error_description || tokenData.error}`);

    // Construire l'email RFC 2822
    const rawEmail = [
        `From: =?UTF-8?B?${Buffer.from(fromName).toString("base64")}?= <${fromEmail}>`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        Buffer.from(html).toString("base64")
    ].join("\r\n");

    // Encoder en base64url
    const encodedEmail = Buffer.from(rawEmail)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    // Envoyer via Gmail API
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ raw: encodedEmail })
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(`Gmail API erreur: ${sendData.error?.message || JSON.stringify(sendData)}`);
    return sendData;
}

async function sendEmail(to, subject, html) {
    const fromName = process.env.SMTP_FROM_NAME || "Service Chatbot IA";
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "noreply@example.com";

    // Méthode 1 : Gmail API (HTTPS — fonctionne partout, envoie depuis votre vraie adresse Gmail)
    if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
        console.log("📧 Envoi via Gmail API à", to);
        return await sendViaGmailAPI(to, subject, html, fromName, fromEmail);
    }

    // Méthode 2 : SMTP direct (fonctionne en local, bloqué sur Render)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log("📧 Envoi via SMTP à", to);
        const nodemailer = require("nodemailer");
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            family: 4
        });
        return await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: to,
            subject: subject,
            html: html
        });
    }

    // Méthode 3 : Brevo API (fallback)
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
                htmlContent: html
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || JSON.stringify(data));
        return data;
    }

    throw new Error("Aucune méthode d'envoi configurée. Ajoutez GMAIL_CLIENT_ID/GMAIL_REFRESH_TOKEN, ou SMTP_USER/SMTP_PASS.");
}

function buildProspectionEmailHTML(prospect) {
    const SERVER_URL = process.env.SERVER_URL || "https://chatbot-jeoh.onrender.com";
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
    const unsubUrl = `${SERVER_URL}/unsubscribe?email=${encodeURIComponent(prospect.email)}&token=${encodeURIComponent(prospect.unsubToken || "")}`;

    // Variations légères de l'intro pour varier entre prospects
    const intros = [
        `En découvrant <strong>${prospect.companyName}</strong>, j'ai trouvé votre activité vraiment intéressante et je pense que vous pourriez bénéficier d'une optimisation simple mais efficace sur votre site.`,
        `J'ai découvert <strong>${prospect.companyName}</strong> récemment et j'ai tout de suite pensé qu'une solution simple pourrait vraiment apporter un plus à votre site web.`,
        `En faisant des recherches, je suis tombé sur <strong>${prospect.companyName}</strong> et j'ai été séduit par votre activité. Je pense qu'il y a un vrai potentiel d'amélioration pour votre site.`,
    ];

    const closes = [
        `Si vous le souhaitez, je peux vous préparer une démonstration personnalisée pour <strong>${prospect.companyName}</strong>. Cela ne prend que 10 minutes et c'est sans engagement.`,
        `Je peux vous montrer ce que ça donnerait concrètement sur le site de <strong>${prospect.companyName}</strong> — ça prend 10 minutes et c'est sans aucun engagement.`,
        `Je serais ravi de vous préparer une petite démo personnalisée pour <strong>${prospect.companyName}</strong>. 10 minutes, sans engagement, juste pour que vous puissiez voir l'impact.`,
    ];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td style="padding:24px 20px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td style="padding:0;">
<p style="margin:0 0 20px;color:#222;font-size:15px;line-height:1.7;">Bonjour,</p>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.7;">${pick(intros)}</p>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.7;">Je développe des chatbots IA pour les entreprises, conçus pour répondre automatiquement aux visiteurs et alléger la charge de votre équipe. L'idée est simple : un assistant intelligent intégré à votre site qui connaît vos services, vos tarifs, et oriente chaque visiteur vers la bonne information, même en dehors de vos heures d'ouverture.</p>
<p style="margin:0 0 12px;color:#333;font-size:15px;line-height:1.7;"><strong>Ce que mes clients apprécient le plus :</strong></p>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:2.0;">• Fini de perdre du temps à répondre aux mêmes questions<br/>
• Réduction du travail de votre équipe : plus besoin d'envoyer quelqu'un répondre aux demandes basiques<br/>
• Des demandes de contact disponibles 24/7, même la nuit<br/>
• Un tableau de bord en temps réel pour suivre toutes les interactions et voir directement l'impact du bot sur vos visiteurs<br/>
• Une solution sur mesure, qui comprend parfaitement leur activité</p>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.7;">${pick(closes)}</p>
<p style="margin:0 0 24px;color:#333;font-size:15px;line-height:1.7;">Souhaitez-vous que l'on planifie ce court échange pour voir ce que cela pourrait apporter à votre site ?</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 24px;">
<a href="mailto:${fromEmail}?subject=Démo%20chatbot%20-%20${encodeURIComponent(prospect.companyName)}" style="display:inline-block;background:#4B6BFB;color:#fff;text-decoration:none;padding:13px 28px;border-radius:6px;font-size:14px;font-weight:600;">Oui, je veux voir une démo →</a>
</td></tr></table>
<p style="margin:0 0 2px;color:#333;font-size:15px;line-height:1.7;">Bien cordialement,</p>
<p style="margin:0 0 0;color:#333;font-size:15px;line-height:1.7;font-weight:600;">Louka Poulbrière</p>
<p style="margin:0;color:#888;font-size:13px;line-height:1.6;">Aivio – Chatbots intelligents pour entreprises</p>
</td></tr>
<tr><td style="padding:32px 0 0;">
<p style="margin:0;color:#ccc;font-size:10px;line-height:1.5;">
<a href="${unsubUrl}" style="color:#ccc;text-decoration:underline;">Se désinscrire</a>
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
    const prospects = loadProspects().sort((a, b) => {
        const v = Number(!!b.emailVerified100) - Number(!!a.emailVerified100);
        if (v !== 0) return v;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json({ total: prospects.length, prospects });
});

// --- AI Search ---
app.post("/api/admin/prospects/search", async (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Accès refusé." });
    if (!API_KEY) return res.status(500).json({ error: "Clé API OpenRouter non configurée." });

    const { sector, location, count } = req.body;
    const cleanSector = sanitizeText(sector, 100);
    const cleanLocation = sanitizeText(location, 100);
    const cleanCount = Math.min(Math.max(parseInt(count) || 5, 1), 30);
    if (!cleanSector) return res.status(400).json({ error: "Secteur requis." });

    const prompt = `Tu es un expert en prospection B2B. Trouve ${cleanCount} VRAIES entreprises existantes dans le secteur "${cleanSector}"${cleanLocation ? ` situées à/en ${cleanLocation}` : ""}.

IMPORTANT : Ce doivent être de VRAIES entreprises qui existent réellement en France. Utilise tes connaissances pour trouver des entreprises réelles.

Retourne UNIQUEMENT un tableau JSON valide (sans markdown, sans backticks, sans texte avant/après) avec ce format exact:
[{"companyName":"Nom","email":"contact@domaine.fr","website":"https://www.domaine.fr","sector":"Sous-secteur","description":"Description courte de l'activité"}]

Règles:
- Uniquement des entreprises qui existent RÉELLEMENT en France
- Noms d'entreprises RÉELS et vérifiables
- Email professionnel 
- Website optionnel
- Sous-secteurs diversifiés dans "${cleanSector}"
- ${cleanCount} résultats exactement
- Interdit d'inventer des entreprises fictives ou des placeholders`;

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

        const validated = await Promise.all((Array.isArray(prospects) ? prospects : []).map(async (p, i) => {
            const companyName = sanitizeText(p.companyName, 200);
            const aiEmail = sanitizeText(p.email, 254).toLowerCase();
            const websiteInput = sanitizeText(p.website, 500);
            const sectorValue = sanitizeText(p.sector, 100);
            const descriptionValue = sanitizeText(p.description, 500);

            if (!companyName) return null;

            const normalizedWebsite = normalizeWebsite(websiteInput);
            const safeWebsite = (normalizedWebsite && isValidUrl(normalizedWebsite)) ? normalizedWebsite : "";
            const verifiedWebsite = safeWebsite ? await getVerifiedWebsite(safeWebsite) : "";

            let finalEmail = "";
            let emailVerified100 = false;
            if (verifiedWebsite && websiteMatchesCompany(verifiedWebsite, companyName)) {
                const scraped = await scrapeEmailFromWebsite(verifiedWebsite);
                if (scraped) {
                    finalEmail = scraped;
                    emailVerified100 = true;
                }
            }

            if (!finalEmail && isValidEmail(aiEmail)) {
                const aiDomain = getEmailDomain(aiEmail);
                if (aiDomain && !isFreeMailboxDomain(aiDomain) && await hasEmailDomainRecords(aiDomain)) {
                    finalEmail = aiEmail;
                }
            }

            if (!finalEmail || !isValidEmail(finalEmail)) return null;
            const domain = getEmailDomain(finalEmail);
            if (!domain || isFreeMailboxDomain(domain)) return null;
            if (!(await hasEmailDomainRecords(domain))) return null;

            return {
                id: Date.now() + i,
                companyName,
                email: finalEmail,
                emailVerified100,
                website: verifiedWebsite || safeWebsite,
                sector: sectorValue,
                description: descriptionValue,
                status: "pending",
                source: "ai_search",
                unsubToken: generateToken(),
                createdAt: new Date().toISOString()
            };
        }));

        const enriched = validated.filter(Boolean);
        const prioritized = enriched.sort((a, b) => {
            const v = Number(!!b.emailVerified100) - Number(!!a.emailVerified100);
            if (v !== 0) return v;
            return a.companyName.localeCompare(b.companyName, "fr", { sensitivity: "base" });
        });
        res.json({ total: prioritized.length, prospects: prioritized, filteredOut: (Array.isArray(prospects) ? prospects.length : 0) - prioritized.length });
    } catch (err) {
        console.error("Erreur recherche IA:", err);
        res.status(500).json({ error: "Erreur de connexion au service IA." });
    }
});

// --- Save prospects (batch) ---
app.post("/api/admin/prospects", async (req, res) => {
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
        const domain = getEmailDomain(email);
        if (!domain || isFreeMailboxDomain(domain)) { skipped++; continue; }
        if (!(await hasEmailDomainRecords(domain))) { skipped++; continue; }

        let emailVerified100 = false;
        const websiteInput = sanitizeText(p.website, 500);
        const normalizedWebsite = normalizeWebsite(websiteInput);
        let website = "";
        if (normalizedWebsite && isValidUrl(normalizedWebsite)) {
            website = (await getVerifiedWebsite(normalizedWebsite)) || normalizedWebsite;
            if (website && websiteMatchesCompany(website, sanitizeText(p.companyName, 200))) {
                const scraped = await scrapeEmailFromWebsite(website);
                if (scraped && scraped.toLowerCase() === email) emailVerified100 = true;
            }
        }
        existing.push({
            id: p.id || Date.now() + added,
            companyName: sanitizeText(p.companyName, 200), email,
            emailVerified100,
            website, sector: sanitizeText(p.sector, 100),
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
    if (!process.env.GMAIL_REFRESH_TOKEN && !process.env.SMTP_USER && !process.env.BREVO_API_KEY) return res.status(400).json({ error: "Configuration email manquante. Ajoutez GMAIL_CLIENT_ID/GMAIL_REFRESH_TOKEN, SMTP_USER/SMTP_PASS, ou BREVO_API_KEY dans les variables d'environnement." });

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
    if (!process.env.GMAIL_REFRESH_TOKEN && !process.env.SMTP_USER && !process.env.BREVO_API_KEY) console.warn("⚠️  Email non configuré — ajoutez GMAIL_CLIENT_ID/GMAIL_REFRESH_TOKEN ou SMTP_USER/SMTP_PASS");
    if (process.env.GMAIL_REFRESH_TOKEN) console.log("📧 Email configuré via Gmail API (HTTPS)");
    else if (process.env.SMTP_USER) console.log("📧 Email configuré via SMTP");
    else if (process.env.BREVO_API_KEY) console.log("📧 Email configuré via Brevo API");
});