require("dotenv").config();

async function test() {
    console.log("🔑 Obtention de l'access token...");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.GMAIL_CLIENT_ID,
            client_secret: process.env.GMAIL_CLIENT_SECRET,
            refresh_token: process.env.GMAIL_REFRESH_TOKEN,
            grant_type: "refresh_token"
        })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) { console.error("❌ Token erreur:", tokenData); return; }
    console.log("✅ Access token obtenu");

    // Construire email RFC 2822
    const fromName = "Aivio";
    const fromEmail = "louka.poulbriere.pro@gmail.com";
    const to = "louka.pool@gmail.com";
    const subject = "Test Gmail API - Chatbot IA";
    const html = "<h1>Test Gmail API</h1><p>Cet email est envoyé directement depuis votre adresse Gmail via l'API Gmail (HTTPS). Pas de Brevo, pas de SMTP !</p>";

    const rawEmail = [
        `From: =?UTF-8?B?${Buffer.from(fromName).toString("base64")}?= <${fromEmail}>`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(html).toString("base64")
    ].join("\r\n");

    const encodedEmail = Buffer.from(rawEmail)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    console.log("📧 Envoi via Gmail API...");
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ raw: encodedEmail })
    });
    const sendData = await sendRes.json();
    if (sendRes.ok) {
        console.log("✅ EMAIL ENVOYÉ AVEC SUCCÈS !");
        console.log("   Message ID:", sendData.id);
        console.log("   De:", fromEmail);
        console.log("   À:", to);
    } else {
        console.error("❌ Erreur envoi:", JSON.stringify(sendData, null, 2));
    }
}

test().catch(e => console.error("❌ Erreur:", e.message));
