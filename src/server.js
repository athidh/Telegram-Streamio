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
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.get("host") || `127.0.0.1:${PORT}`;
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
    const manifestUrl = `${baseUrl}/manifest.json`;
    const installUrl = `stremio://${host}/manifest.json`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram Stremio Addon</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
    .card { background: #131c2e; border: 1px solid #1e293b; border-radius: 1.25rem; max-width: 520px; width: 100%; padding: 2.5rem; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.75rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem; }
    .url-box { background: #080d1a; border: 1px solid #1e293b; border-radius: 0.5rem; padding: 0.75rem 1rem; font-family: monospace; font-size: 0.85rem; color: #38bdf8; word-break: break-all; margin-bottom: 1.5rem; }
    .btn { display: inline-block; background: #0284c7; color: #fff; padding: 0.85rem 2rem; border-radius: 0.6rem; font-weight: 600; text-decoration: none; transition: background 0.2s; font-size: 1rem; }
    .btn:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚀</div>
    <h1>Telegram Stremio Addon</h1>
    <p>Your addon is online and ready. Click below to install it into Stremio across any device.</p>
    <div class="url-box">${manifestUrl}</div>
    <a class="btn" href="${installUrl}">Install on Stremio</a>
  </div>
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
