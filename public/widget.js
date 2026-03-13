/**
 * Widget Chatbot IA — Systeme de generation de leads v3
 *
 * UTILISATION :
 *   <script>
 *   window.CHATBOT_CONFIG = {
 *       server: "https://VOTRE-SERVEUR.com",
 *       clientId: "nom-du-client",   <-- NOUVEAU
 *       color: "#4B6BFB",
 *       name: "Assistant",
 *       logo: "",
 *       welcome: "Bonjour ! Comment puis-je vous aider ?",
 *       placeholder: "Posez votre question...",
 *       position: "right",
 *       leadDelay: 3,
 *       leadKeywords: ["devis","prix","tarif","budget","rdv","rendez-vous","rappeler"]
 *   };
 *   </script>
 *   <script src="https://VOTRE-SERVEUR.com/widget.js"></script>
 */

(function () {
    "use strict";

    // ============================================================
    // MODULE: Config
    // ============================================================
    var CFG = Object.assign({
        server: "",
        clientId: "",          // ← identifiant du client
        color: "#4B6BFB",
        name: "Assistant",
        icon: "",
        logo: "",
        welcome: "Bonjour ! Comment puis-je vous aider ?",
        placeholder: "Posez votre question...",
        position: "right",
        leadDelay: 3,
        leadKeywords: ["devis","prix","tarif","cout","budget","rdv","rendez-vous","rappeler","contact","telephone","email"],
        leadTimeDelay: 60,
        maxDisplayedMessages: 80
    }, window.CHATBOT_CONFIG || {});

    if (!CFG.server) {
        if (window.CHATBOT_SERVER) { CFG.server = window.CHATBOT_SERVER; }
        else {
            try {
                var scripts = document.getElementsByTagName("script");
                for (var i = scripts.length - 1; i >= 0; i--) {
                    var src = scripts[i].src || "";
                    if (src.indexOf("widget.js") !== -1) {
                        CFG.server = src.replace(/\/widget\.js.*$/, "");
                        break;
                    }
                }
            } catch(e){}
        }
        if (!CFG.server) {
            console.error("[Chatbot] Serveur non configure. Ajoutez window.CHATBOT_CONFIG = { server: '...' }");
            return;
        }
    }

    // ============================================================
    // MODULE: Auto-chargement config depuis le serveur
    // Si le clientId est fourni, on récupère la config dynamiquement
    // ============================================================
    function applyServerConfig(cfg) {
        if (!cfg) return;
        if (cfg.name)        CFG.name        = cfg.name;
        if (cfg.welcome)     CFG.welcome     = cfg.welcome;
        if (cfg.placeholder) CFG.placeholder = cfg.placeholder;
        if (cfg.color)       CFG.color       = cfg.color;
        if (cfg.icon)        CFG.icon        = cfg.icon;
        if (cfg.logo)        CFG.logo        = cfg.logo;
        if (cfg.position)    CFG.position    = cfg.position;
        if (typeof cfg.leadDelay === "number")   CFG.leadDelay   = cfg.leadDelay;
        if (typeof cfg.leadTimeDelay === "number") CFG.leadTimeDelay = cfg.leadTimeDelay;
        if (cfg.leadKeywords && cfg.leadKeywords.length) CFG.leadKeywords = cfg.leadKeywords;
    }

    if (CFG.clientId) {
        fetch(CFG.server + "/api/widget-config?clientId=" + encodeURIComponent(CFG.clientId))
            .then(function(r){ return r.json(); })
            .then(function(cfg){ applyServerConfig(cfg); applyRuntimeConfig(); })
            .catch(function(){});
    }

    // ============================================================
    // MODULE: Helpers
    // ============================================================
    function $(id) { return document.getElementById(id); }

    function sanitize(str, maxLen) {
        if (typeof str !== "string") return "";
        return str.replace(/[<>]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, maxLen || 500);
    }

    function hexToRgba(hex, a) {
        var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return "rgba("+r+","+g+","+b+","+a+")";
    }

    function escAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
    function escText(s) { return String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

    var CL  = hexToRgba(CFG.color, 0.12);
    var CS  = hexToRgba(CFG.color, 0.35);
    var CH  = hexToRgba(CFG.color, 0.85);

    function recalcTheme() {
        CL = hexToRgba(CFG.color, 0.12);
        CS = hexToRgba(CFG.color, 0.35);
        CH = hexToRgba(CFG.color, 0.85);
    }

    function renderLauncherContent() {
        if (CFG.logo) return '<img src="'+escAttr(CFG.logo)+'" alt="'+escAttr(CFG.name)+'">';
        return escText(CFG.icon || "AI");
    }

    function renderHeaderLeft() {
        var iconHtml = CFG.logo
            ? '<img src="'+escAttr(CFG.logo)+'" alt="">'
            : '<span class="cb-ic">'+escText(CFG.icon || "AI")+'</span>';
        return '<div id="cb-hd-l">'+iconHtml+'<span class="cb-dot"></span>'+escText(CFG.name)+'</div>';
    }

    function applyRuntimeConfig() {
        recalcTheme();
        if (!btn || !box) return;

        btn.style.background = CFG.color;
        btn.style.boxShadow = "0 4px 18px " + CS;
        btn.setAttribute("aria-label", "Ouvrir le chat " + CFG.name);
        btn.title = "Ouvrir " + CFG.name;
        btn.innerHTML = renderLauncherContent();

        var hd = $("cb-hd");
        if (hd) {
            hd.style.background = CFG.color;
            var newHeader = renderHeaderLeft();
            var close = hd.querySelector(".cb-x");
            hd.innerHTML = newHeader;
            if (close) hd.appendChild(close);
        }

        var input = $("cb-in");
        if (input) {
            input.placeholder = CFG.placeholder;
            input.style.borderColor = "";
        }

        box.setAttribute("aria-label", "Chat avec " + CFG.name);

        box.querySelectorAll(".cb-u").forEach(function(el){ el.style.background = CFG.color; });
        box.querySelectorAll(".cb-b, .cb-tp").forEach(function(el){ el.style.background = CL; });
        box.querySelectorAll(".cb-lf-ok").forEach(function(el){ el.style.background = CFG.color; });
        var send = $("cb-send");
        if (send) send.style.background = CFG.color;
    }

    // ============================================================
    // MODULE: Session & Persistence
    // ============================================================
    var SK = "cb_session_" + (CFG.clientId || "default");
    var HK = "cb_history_" + (CFG.clientId || "default");
    var LK = "cb_lead_"    + (CFG.clientId || "default");

    function store(k, v) { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch(e){} }
    function storeSession(k, v) { try { sessionStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch(e){} }
    function load(k, parse) {
        try { var v = localStorage.getItem(k); return parse && v ? JSON.parse(v) : v; } catch(e){ return null; }
    }
    function loadSession(k) {
        try { return sessionStorage.getItem(k); } catch(e){ return null; }
    }

    function getSessionId() {
        var id = load(SK);
        if (!id) { id = "s_"+Date.now()+"_"+Math.random().toString(36).substr(2,9); store(SK, id); }
        return id;
    }
    var sessionId = getSessionId();
    var history = [];
    function saveHistory() { store(HK, history.slice(-20)); }
    function restoreHistory() {
        var d = load(HK, true);
        return Array.isArray(d) && d.length > 0 ? d : null;
    }

    // ============================================================
    // MODULE: Anti-Spam
    // ============================================================
    var lastSend = 0, stamps = [], SPAM_MS = 1500, MAX_PM = 10;
    function isSpam() {
        var n = Date.now();
        if (n - lastSend < SPAM_MS) return true;
        stamps.push(n);
        stamps = stamps.filter(function(t){ return n - t < 60000; });
        if (stamps.length > MAX_PM) return true;
        lastSend = n;
        return false;
    }

    // ============================================================
    // MODULE: Lead State
    // ============================================================
    var leadCaptured = loadSession(LK) === "true";
    var botMsgCount = 0, leadFormShown = false, convStart = 0;
    var leadSkipCount = 0;
    var timeCheckTimer = null;

    function hasKeyword(text) {
        var l = text.toLowerCase();
        for (var i = 0; i < CFG.leadKeywords.length; i++) {
            if (l.indexOf(CFG.leadKeywords[i]) !== -1) return true;
        }
        return false;
    }
    function timeTriggered() { return convStart > 0 && (Date.now() - convStart) > CFG.leadTimeDelay * 1000; }

    function tryLeadTrigger(reason) {
        if (leadCaptured || leadFormShown || !isOpen) return;
        showLeadForm(reason);
    }

    function startTimeCheck() {
        if (timeCheckTimer) return;
        timeCheckTimer = setInterval(function () {
            if (leadCaptured || leadFormShown) {
                clearInterval(timeCheckTimer); timeCheckTimer = null; return;
            }
            if (timeTriggered()) {
                tryLeadTrigger("time");
                clearInterval(timeCheckTimer); timeCheckTimer = null;
            }
        }, 5000);
    }

    // ============================================================
    // MODULE: Analytics  ← clientId ajouté
    // ============================================================
    function track(evt, data) {
        try {
            fetch(CFG.server+"/api/analytics", {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({
                    sessionId: sessionId,
                    event: evt,
                    data: data || {},
                    page: location.href,
                    timestamp: new Date().toISOString(),
                    clientId: CFG.clientId || ""   // ← NOUVEAU
                })
            }).catch(function(){});
        } catch(e){}
    }

    // ============================================================
    // MODULE: Styles
    // ============================================================
    var posR = CFG.position === "right";
    // Charger la police Inter
    var fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(fontLink);
    var css = document.createElement("style");
    css.textContent = [
        "#cb-btn{position:fixed;bottom:20px;",posR?"right:20px;":"left:20px;","width:62px;height:62px;border-radius:50%;background:",CFG.color,";color:#fff;border:none;font-size:26px;cursor:pointer;box-shadow:0 4px 18px ",CS,";z-index:99999;transition:transform .2s,box-shadow .2s,opacity .3s;font-family:sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden}",
        "#cb-btn:hover{transform:scale(1.08);box-shadow:0 6px 24px ",CS,"}",
        "#cb-btn:focus-visible{outline:3px solid ",CFG.color,";outline-offset:3px}",
        "#cb-btn img{width:34px;height:34px;border-radius:50%;object-fit:cover}",
        "#cb-btn .cb-ic{font-size:20px;line-height:1}",
        "#cb-btn.cb-hide{opacity:0;pointer-events:none;transform:scale(0.8)}",
        "#cb-box{width:380px;height:520px;position:fixed;bottom:92px;",posR?"right:20px;":"left:20px;","background:#fff;border-radius:18px;box-shadow:0 12px 48px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;z-index:99998;font-family:'Inter','Helvetica Neue',Arial,sans-serif !important}",
        "#cb-box.cb-open{display:flex;animation:cb-up .3s ease}",
        "@keyframes cb-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}",
        "#cb-hd{background:",CFG.color,";color:#fff;padding:16px 18px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center;gap:10px}",
        "#cb-hd-l{display:flex;align-items:center;gap:10px}",
        "#cb-hd-l img{width:30px;height:30px;border-radius:50%;object-fit:cover}",
        "#cb-hd-l .cb-ic{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1}",
        ".cb-x{background:rgba(255,255,255,.15);border:none;color:#fff;font-size:16px;cursor:pointer;padding:4px 8px;border-radius:8px;transition:background .2s}",
        ".cb-x:hover{background:rgba(255,255,255,.3)}",
        ".cb-x:focus-visible{outline:2px solid #fff;outline-offset:2px}",
        ".cb-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;margin-right:4px;animation:cb-pulse 2s infinite}",
        "@keyframes cb-pulse{0%,100%{opacity:1}50%{opacity:.4}}",
        "#cb-msgs{flex:1;padding:14px;overflow-y:auto;font-size:14px;display:flex;flex-direction:column;gap:8px;background:#fafbff;scroll-behavior:smooth;font-family:'Inter','Helvetica Neue',Arial,sans-serif !important}",
        ".cb-m{padding:10px 14px;border-radius:16px;max-width:84%;line-height:1.55;word-wrap:break-word;white-space:pre-wrap;font-size:13.5px;letter-spacing:0.01em;font-family:'Inter','Helvetica Neue',Arial,sans-serif !important}",
        ".cb-b{background:",CL,";align-self:flex-start;border-bottom-left-radius:4px;color:#1e2a5a}",
        ".cb-u{background:",CFG.color,";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}",
        ".cb-s{background:#fff3cd;color:#664d03;align-self:center;text-align:center;font-size:13px;border-radius:10px;max-width:95%}",
        ".cb-tp{background:",CL,";align-self:flex-start;border-bottom-left-radius:4px;padding:12px 18px;display:flex;gap:5px}",
        ".cb-tp span{width:7px;height:7px;border-radius:50%;background:#999;animation:cb-dot-bounce .6s infinite alternate}",
        ".cb-tp span:nth-child(2){animation-delay:.2s}",
        ".cb-tp span:nth-child(3){animation-delay:.4s}",
        "@keyframes cb-dot-bounce{0%{opacity:.3;transform:translateY(0)}100%{opacity:1;transform:translateY(-4px)}}",
        ".cb-net{background:#fee2e2;color:#991b1b;text-align:center;font-size:12px;padding:6px;display:none;font-weight:500}",
        ".cb-net.show{display:block}",
        ".cb-lf{background:#fff;border:1px solid #e0e0e0;border-radius:14px;padding:16px;margin:8px 0;align-self:flex-start;max-width:92%}",
        ".cb-lf p{margin:0 0 10px;font-size:14px;font-weight:600;color:#333}",
        ".cb-lf input[type=text],.cb-lf input[type=email],.cb-lf input[type=tel]{width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:8px;box-sizing:border-box;font-family:inherit;outline:none;transition:border .2s}",
        ".cb-lf input:focus{border-color:",CFG.color,"}",
        ".cb-lf-btns{display:flex;gap:8px;margin-top:4px}",
        ".cb-lf-ok{flex:1;background:",CFG.color,";color:#fff;border:none;padding:9px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:opacity .2s}",
        ".cb-lf-ok:hover{opacity:.9}",
        ".cb-lf-sk{background:none;border:1px solid #ddd;padding:9px 14px;border-radius:8px;cursor:pointer;font-size:13px;color:#666;transition:background .2s}",
        ".cb-lf-sk:hover{background:#f5f5f5}",
        ".cb-rgpd{display:flex;align-items:flex-start;gap:6px;margin:6px 0 4px}",
        ".cb-rgpd input[type=checkbox]{width:auto;margin:3px 0 0;padding:0;cursor:pointer;flex-shrink:0}",
        ".cb-rgpd label{font-size:11px;color:#888;line-height:1.3;cursor:pointer}",
        "#cb-bar{display:flex;align-items:center;padding:10px 12px;background:#fff;border-top:1px solid #eee;gap:8px}",
        "#cb-bar input{flex:1;padding:11px 16px;border:1.5px solid #e0e4ea;border-radius:24px;outline:none;font-size:14px;font-family:inherit;background:#f7f8fb;transition:border .2s,background .2s}",
        "#cb-bar input:focus{border-color:",CFG.color,";background:#fff}",
        "#cb-bar button{width:42px;height:42px;border-radius:50%;background:",CFG.color,";color:#fff;border:none;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .15s;flex-shrink:0}",
        "#cb-bar button:hover{background:",CH,";transform:scale(1.06)}",
        "#cb-bar button:disabled{opacity:.4;cursor:not-allowed;transform:none}",
        "#cb-bar button:focus-visible{outline:3px solid ",CFG.color,";outline-offset:2px}",
        "#cb-bar input:focus-visible{outline:none;border-color:",CFG.color,"}",
        "#cb-ft{text-align:center;padding:5px;font-size:10px;color:#c0c0c0;background:#fff;border-radius:0 0 18px 18px}",
        "@media(max-width:480px){",
            "#cb-box{width:calc(100vw - 16px);height:calc(100dvh - 100px);",posR?"right:8px;":"left:8px;","bottom:82px;border-radius:14px}",
            "#cb-btn{bottom:14px;",posR?"right:14px;":"left:14px;","width:56px;height:56px;font-size:22px}",
        "}",
        "@media(max-width:360px){",
            "#cb-box{width:calc(100vw - 8px);right:4px;left:4px}",
        "}"
    ].join("");
    document.head.appendChild(css);

    // ============================================================
    // MODULE: UI Builder
    // ============================================================
    var btn = document.createElement("button");
    btn.id = "cb-btn";
    btn.setAttribute("aria-label", "Ouvrir le chat " + CFG.name);
    btn.setAttribute("role", "button");
    btn.title = "Ouvrir " + CFG.name;
    btn.innerHTML = renderLauncherContent();

    var box = document.createElement("div");
    box.id = "cb-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Chat avec " + CFG.name);
    box.setAttribute("aria-hidden", "true");

    var hdLogo = renderHeaderLeft();

    box.innerHTML = [
        '<div id="cb-hd">',hdLogo,'<button class="cb-x" aria-label="Fermer le chat">\u2715</button></div>',
        '<div class="cb-net" id="cb-net" role="alert">Connexion perdue\u2026 V\u00e9rifiez votre r\u00e9seau.</div>',
        '<div id="cb-msgs" role="log" aria-live="polite" aria-label="Messages du chat"></div>',
        '<div id="cb-bar" role="form" aria-label="Envoyer un message">',
            '<input type="text" id="cb-in" placeholder="',escAttr(CFG.placeholder),'" autocomplete="off" aria-label="Votre message" maxlength="500">',
            '<button id="cb-send" aria-label="Envoyer">\u27A4</button>',
        '</div>',
        '<div id="cb-ft"></div>'
    ].join("");

    document.body.appendChild(btn);
    document.body.appendChild(box);

    // ============================================================
    // MODULE: DOM refs
    // ============================================================
    var msgs   = $("cb-msgs");
    var sendBt = $("cb-send");
    var inpF   = $("cb-in");
    var closeBt = box.querySelector(".cb-x");
    var netBar  = $("cb-net");
    var isOpen = false, isSending = false, firstOpen = true;
    var displayedCount = 0;

    applyRuntimeConfig();

    // ============================================================
    // MODULE: Network detection
    // ============================================================
    function updateNet() {
        var offline = !navigator.onLine;
        netBar.classList.toggle("show", offline);
        if (offline) { sendBt.disabled = true; inpF.disabled = true; }
        else if (!isSending) { sendBt.disabled = false; inpF.disabled = false; }
    }
    window.addEventListener("online", updateNet);
    window.addEventListener("offline", updateNet);

    // ============================================================
    // MODULE: Toggle
    // ============================================================
    function toggle() {
        isOpen = !isOpen;
        box.classList.toggle("cb-open", isOpen);
        box.setAttribute("aria-hidden", !isOpen ? "true" : "false");
        btn.classList.toggle("cb-hide", isOpen);
        if (isOpen) {
            inpF.focus();
            if (firstOpen) {
                track("open");
                convStart = Date.now();
                firstOpen = false;
                if (!leadCaptured) startTimeCheck();
            }
            if (!leadCaptured && !leadFormShown && botMsgCount >= CFG.leadDelay) {
                setTimeout(function () { tryLeadTrigger("delay_open"); }, 1500);
            }
        }
    }
    btn.addEventListener("click", toggle);
    closeBt.addEventListener("click", function() {
        toggle();
        track("close", { messages: history.length });
    });
    document.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && isOpen) toggle();
    });

    // ============================================================
    // MODULE: Messages
    // ============================================================
    function scrollDown() {
        requestAnimationFrame(function() { msgs.scrollTop = msgs.scrollHeight; });
    }

    function cleanMarkdown(t) {
        return t.replace(/\*\*\*(.+?)\*\*\*/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/_(.+?)_/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^[\-\*]\s+/gm, '• ');
    }

    function addMsg(text, type) {
        var el = document.createElement("div");
        el.classList.add("cb-m", "cb-" + type);
        el.textContent = type === "b" ? cleanMarkdown(text) : text;
        if (type === "b") el.setAttribute("aria-label", CFG.name + " dit");
        if (type === "u") el.setAttribute("aria-label", "Vous dites");
        msgs.appendChild(el);
        displayedCount++;
        while (displayedCount > CFG.maxDisplayedMessages && msgs.firstChild) {
            msgs.removeChild(msgs.firstChild);
            displayedCount--;
        }
        scrollDown();
        return el;
    }

    function showTyping() {
        var el = document.createElement("div");
        el.classList.add("cb-tp");
        el.id = "cb-tp";
        el.setAttribute("aria-label", CFG.name + " est en train d'ecrire");
        el.innerHTML = "<span></span><span></span><span></span>";
        msgs.appendChild(el);
        scrollDown();
    }

    function removeTyping() {
        var el = $("cb-tp");
        if (el) { el.remove(); }
    }

    // ============================================================
    // MODULE: Lead Form
    // ============================================================
    function showLeadForm(reason) {
        if (leadCaptured || leadFormShown) return;
        leadFormShown = true;
        track("lead_form_shown", { reason: reason || "delay" });

        var f = document.createElement("div");
        f.classList.add("cb-lf");
        f.id = "cb-lf";
        f.setAttribute("role", "form");
        f.setAttribute("aria-label", "Formulaire de contact");
        f.innerHTML = [
            '<p>Pour que nous puissions vous recontacter :</p>',
            '<input type="text" id="cb-lfn" placeholder="Votre pr\u00e9nom *" aria-label="Pr\u00e9nom" required>',
            '<input type="text" id="cb-lln" placeholder="Votre nom *" aria-label="Nom" required>',
            '<input type="email" id="cb-le" placeholder="Votre email *" aria-label="Email" required>',
            '<input type="tel" id="cb-lp" placeholder="Votre t\u00e9l\u00e9phone" aria-label="T\u00e9l\u00e9phone">',
            '<div class="cb-rgpd">',
                '<input type="checkbox" id="cb-lc">',
                '<label for="cb-lc">En envoyant ce formulaire, j\u2019accepte d\u2019\u00eatre recontact\u00e9(e) et que mes donn\u00e9es soient trait\u00e9es conform\u00e9ment \u00e0 la politique de confidentialit\u00e9.</label>',
            '</div>',
            '<div class="cb-lf-btns">',
                '<button class="cb-lf-sk" id="cb-lf-sk">Plus tard</button>',
                '<button class="cb-lf-ok" id="cb-lf-ok">Envoyer</button>',
            '</div>'
        ].join("");
        msgs.appendChild(f);
        scrollDown();

        var firstInput = $("cb-lfn");
        if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);

        $("cb-lf-ok").addEventListener("click", submitLead);
        $("cb-lf-sk").addEventListener("click", function() {
            f.remove(); leadFormShown = false;
            leadSkipCount++;
            track("lead_skipped");
            addMsg("Pas de souci ! N'hesitez pas si vous changez d'avis.", "b");
        });
    }

    function submitLead() {
        var fn = sanitize($("cb-lfn").value, 50);
        var ln = sanitize($("cb-lln").value, 50);
        var em = sanitize($("cb-le").value, 254).toLowerCase();
        var ph = sanitize($("cb-lp").value, 25);
        var ck = $("cb-lc");

        if (!fn || fn.length < 2) { addMsg("Merci d'indiquer votre pr\u00e9nom.", "s"); return; }
        if (!ln || ln.length < 2) { addMsg("Merci d'indiquer votre nom.", "s"); return; }
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { addMsg("Merci d'indiquer un email valide.", "s"); return; }
        if (ph && !/^[+\d][\d\s\-.()]{6,20}$/.test(ph)) { addMsg("Num\u00e9ro de t\u00e9l\u00e9phone invalide.", "s"); return; }
        if (!ck || !ck.checked) { addMsg("Veuillez accepter les conditions RGPD pour continuer.", "s"); return; }

        var fullName = fn + " " + ln;
        var f = $("cb-lf"); if (f) f.remove();

        try {
            var ctrl = new AbortController();
            var to = setTimeout(function(){ ctrl.abort(); }, 10000);
            fetch(CFG.server+"/api/lead", {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({
                    sessionId: sessionId,
                    firstName: fn,
                    lastName: ln,
                    name: fullName,
                    email: em,
                    phone: ph,
                    consent: true,
                    source: location.href,
                    conversation: history,
                    timestamp: new Date().toISOString(),
                    clientId: CFG.clientId || ""   // ← NOUVEAU
                }),
                signal: ctrl.signal
            }).then(function(){ clearTimeout(to); }).catch(function(e){ console.warn("[Chatbot] Lead error",e); });
        } catch(e){}

        leadCaptured = true;
        storeSession(LK, "true");
        track("lead_captured", { email: em });
        addMsg("Merci " + fn + " ! Un conseiller vous contactera tr\u00e8s bient\u00f4t.", "b");
    }

    // ============================================================
    // MODULE: AI API  ← clientId ajouté
    // ============================================================
    function askAI(text) {
        history.push({ role: "user", parts: [{ text: sanitize(text, 500) }] });
        saveHistory();

        var ctrl = new AbortController();
        var to = setTimeout(function(){ ctrl.abort(); }, 15000);

        return fetch(CFG.server+"/api/chat", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({
                messages: history,
                clientId: CFG.clientId || ""   // ← NOUVEAU
            }),
            signal: ctrl.signal
        }).then(function(res) {
            clearTimeout(to);
            if (!res.ok) {
                return res.json().catch(function(){ return {}; }).then(function(err) {
                    if (res.status === 429) return "Trop de messages envoyes. Patientez un instant.";
                    return "Desole, une erreur est survenue. Reessayez dans un instant.";
                });
            }
            return res.json().then(function(data) {
                var reply = data.reply || "Je n'ai pas pu generer de reponse.";
                history.push({ role: "model", parts: [{ text: reply }] });
                if (history.length > 20) history = history.slice(-20);
                saveHistory();
                botMsgCount++;
                track("bot_reply", { count: botMsgCount });

                if (!leadCaptured && !leadFormShown && isOpen) {
                    if (botMsgCount >= CFG.leadDelay) {
                        setTimeout(function(){ tryLeadTrigger("delay"); }, 800);
                    } else if (timeTriggered()) {
                        setTimeout(function(){ tryLeadTrigger("time"); }, 800);
                    }
                }
                if (!leadCaptured && !leadFormShown && isOpen && leadSkipCount > 0 && botMsgCount >= CFG.leadDelay + (leadSkipCount * 2)) {
                    setTimeout(function(){ tryLeadTrigger("re_trigger"); }, 1500);
                }
                return reply;
            });
        }).catch(function(e) {
            clearTimeout(to);
            if (e.name === "AbortError") return "Le serveur met trop de temps. Reessayez dans un instant.";
            return "Impossible de se connecter. Verifiez votre connexion internet.";
        });
    }

    // ============================================================
    // MODULE: Send
    // ============================================================
    function send() {
        var text = inpF.value.trim();
        if (!text || isSending) return;
        if (text.length > 500) { text = text.slice(0, 500); }

        if (isSpam()) {
            addMsg("Merci de patienter avant d'envoyer un autre message.", "s");
            return;
        }

        if (!leadCaptured && !leadFormShown && hasKeyword(text)) {
            setTimeout(function(){ tryLeadTrigger("keyword"); }, 1200);
        }

        isSending = true;
        addMsg(text, "u");
        inpF.value = "";
        sendBt.disabled = true;
        inpF.disabled = true;
        showTyping();
        track("user_message");

        askAI(text).then(function(reply) {
            removeTyping();
            addMsg(reply, "b");
            sendBt.disabled = false;
            inpF.disabled = false;
            isSending = false;
            inpF.focus();
            updateNet();
        });
    }

    sendBt.addEventListener("click", send);
    inpF.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });

    // ============================================================
    // MODULE: Session Restore
    // ============================================================
    var saved = restoreHistory();
    if (saved && saved.length > 0) {
        history = saved;
        var toShow = saved.slice(-CFG.maxDisplayedMessages);
        for (var i = 0; i < toShow.length; i++) {
            var m = toShow[i], t = m.role === "user" ? "u" : "b";
            var txt = (m.parts && m.parts[0]) ? m.parts[0].text : "";
            if (txt) addMsg(txt, t);
        }
        botMsgCount = saved.filter(function(x){ return x.role === "model"; }).length;
    } else {
        addMsg(CFG.welcome, "b");
    }

    track("widget_loaded");
    updateNet();

})();
