import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config/env.js";

// useWSS: true -> WebSocket Secure on port 443 instead of plain TCP on port 80.
// Port 80 is blocked by many VPNs, firewalls, and ISPs (especially in India).
const BASE_OPTIONS = {
  connectionRetries: 20,
  retryDelay:        1000,
  autoReconnect:     true,
  requestRetries:    10,
  useWSS:            true,
};

export function createTelegramClient(session = config.telegramSession) {
  if (!config.telegramApiId || !config.telegramApiHash)
    throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env");
  return new TelegramClient(
    new StringSession(session),
    Number(config.telegramApiId),
    config.telegramApiHash,
    { ...BASE_OPTIONS }
  );
}

// Dedicated streaming client - isolated connection so downloads don't
// interfere with the bot/automation client.
export function createStreamClient(session = config.telegramSession) {
  if (!config.telegramApiId || !config.telegramApiHash)
    throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env");
  return new TelegramClient(
    new StringSession(session),
    Number(config.telegramApiId),
    config.telegramApiHash,
    { ...BASE_OPTIONS }
  );
}


