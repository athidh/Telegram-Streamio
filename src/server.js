import "dotenv/config";
import express from "express";
import cors from "cors";
import { manifest } from "./stremio/manifest.js";
import { createTelegramClient, createStreamClient } from "./telegram/client.js";
import { createStremioRouter } from "./routes/stremio.js";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 7000);

  // Enable trust proxy for Render / reverse proxies
  app.set("trust proxy", true);

  // Enable CORS for Stremio
  app.use(cors());

  app.get("/", (req, res) => {
    const rawProto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const protocol = String(rawProto).split(",")[0].trim();
    const rawHost = req.headers["x-forwarded-host"] || req.get("host") || `127.0.0.1:${PORT}`;
    const host = String(rawHost).split(",")[0].trim();
    const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/+$/, "") : `${protocol}://${host}`;
    const manifestUrl = `${baseUrl}/manifest.json`;
    const hostForInstall = (process.env.BASE_URL ? process.env.BASE_URL.replace(/^https?:\/\//, "") : host).replace(/\/+$/, "");
    const installUrl = `stremio://${hostForInstall}/manifest.json`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram Stremio Addon</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #090d16;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 1.25rem;
      max-width: 560px;
      width: 100%;
      padding: 2.5rem;
      text-align: center;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.7);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(16, 185, 129, 0.12);
      color: #10b981;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.825rem;
      font-weight: 600;
      margin-bottom: 1.25rem;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
    }
    h1 {
      font-size: 1.85rem;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 0.6rem;
      letter-spacing: -0.02em;
    }
    p.subtitle {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.55;
      margin-bottom: 1.75rem;
    }
    .url-container {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 0.75rem;
      padding: 0.85rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      text-align: left;
    }
    .url-text {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      color: #38bdf8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: all;
    }
    .copy-btn {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
      padding: 0.45rem 0.85rem;
      border-radius: 0.45rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      background: #334155;
      color: #ffffff;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .btn-primary {
      display: block;
      background: #0284c7;
      color: #ffffff;
      padding: 0.9rem 1.75rem;
      border-radius: 0.65rem;
      font-weight: 600;
      text-decoration: none;
      font-size: 1.05rem;
      transition: background 0.2s, transform 0.1s;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
    }
    .btn-primary:hover {
      background: #0369a1;
      transform: translateY(-1px);
    }
    .guide {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid #1e293b;
      text-align: left;
      font-size: 0.85rem;
      color: #94a3b8;
    }
    .guide h3 {
      font-size: 0.9rem;
      color: #cbd5e1;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    .guide ol {
      padding-left: 1.25rem;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span> Online & Ready</div>
    <h1>Telegram Stremio Addon</h1>
    <p class="subtitle">Stream your personal Telegram movie library directly on any device running Stremio.</p>
    
    <div class="url-container">
      <span class="url-text" id="manifestUrl">${manifestUrl}</span>
      <button class="copy-btn" id="copyBtn" onclick="copyManifest()">Copy URL</button>
    </div>

    <div class="actions">
      <a class="btn-primary" href="${installUrl}">Install on Stremio</a>
    </div>

    <div class="guide">
      <h3>Universal Setup Guide:</h3>
      <ol>
        <li><strong>PC / Mobile with Stremio installed:</strong> Click <em>Install on Stremio</em> above.</li>
        <li><strong>Smart TV / FireStick / Web:</strong> Copy the URL above, open Stremio, go to <em>Addons</em>, paste into search bar, and click <em>Install</em>.</li>
      </ol>
    </div>
  </div>

  <script>
    function copyManifest() {
      const url = document.getElementById("manifestUrl").innerText;
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById("copyBtn");
        btn.innerText = "Copied!";
        btn.style.background = "#10b981";
        btn.style.color = "#ffffff";
        setTimeout(() => {
          btn.innerText = "Copy URL";
          btn.style.background = "#1e293b";
          btn.style.color = "#cbd5e1";
        }, 2000);
      });
    }
  </script>
</body>
</html>`);
  });

  app.get("/manifest.json", (_req, res) => {
    res.json(manifest);
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "telegram-stremio" });
  });

  console.log("Initializing Telegram Client...");
  let telegramClient;
  try {
    telegramClient = createTelegramClient();
    await telegramClient.connect();
    const me = await telegramClient.getMe();
    console.log(`Telegram connected successfully as @${me.username || "no-username"}`);
    
    // Initialize the auto-forwarder to catch bot files
    const { setupForwarder } = await import("./telegram/forwarder.js");
    setupForwarder(telegramClient);
    console.log("Auto-forwarder initialized.");

    console.log("Initializing isolated Stream Client...");
    const streamClient = createStreamClient();
    await streamClient.connect();
    console.log("Stream Client connected (TCPFull).");
    
    // Mount Stremio + stream routes
    app.use(createStremioRouter(telegramClient, streamClient));
  } catch (error) {
    console.error("Failed to connect to Telegram:", error.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(` Telegram Stremio Addon is running!`);
    console.log(`========================================`);
    console.log(`\n Addon URL for Stremio:`);
    console.log(` http://127.0.0.1:${PORT}/manifest.json\n`);
  });

  // Prevent Node from killing long-running streaming connections.
  // Stremio keeps range connections open for minutes during playback.
  server.keepAliveTimeout = 0;       // disable TCP keep-alive timeout
  server.headersTimeout = 0;         // disable headers timeout
  server.timeout = 0;                // disable socket inactivity timeout
}

startServer();
