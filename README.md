# Telegram Stremio Addon

A personal Stremio addon that streams movies directly from your authorized Telegram channels and groups!

This addon searches your **pinned chats** in Telegram to find movie files and streams them seamlessly to Stremio with full seeking (byte-range) support. It acts as an intelligent proxy, meaning it doesn't download the whole file to your disk—it streams the exact pieces of the movie that Stremio requests.

## Architecture
1. **Search**: When you click a movie in Stremio, the addon searches for the movie title in your **pinned Telegram chats**.
2. **Match**: It intelligently parses the filenames (extracting quality, codec, year) and filters out mismatches.
3. **Stream**: It exposes a local HTTP proxy endpoint for Stremio to stream the Telegram file in chunks.

## Requirements
- Node.js (v18+)
- A Telegram account
- Telegram API ID and Hash (Get it from [my.telegram.org](https://my.telegram.org))

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` and add your `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.*

## Authentication (One-time Setup)

Run the login script to authenticate your Telegram account:
```bash
npm run telegram:login
```
Enter your phone number (with country code, e.g., `+1...`), the OTP code from Telegram, and your 2FA password if enabled. 
The script will securely save your session string into the `.env` file.

## Configuring Sources

**You do NOT need to edit any configuration files to add sources!**
The addon dynamically reads the **pinned chats** from your Telegram account. 
To add a channel or group as a movie source:
1. Open your Telegram app.
2. Pin the channel/group you want to use.
That's it! The addon will search all your pinned chats.

## Running the Addon

Start the Stremio server:
```bash
npm start
```
*Or run in development mode with automatic restarts:* `npm run dev`

### Adding it to Stremio
Once the server is running, you can add it to Stremio using this URL:
```text
http://127.0.0.1:7000/manifest.json
```

## Diagnostics and Testing

- **Test Telegram Connection:** 
  ```bash
  npm run telegram:test
  ```
- **List your chats (to easily find IDs if needed):**
  ```bash
  npm run telegram:chats
  ```
- **Test the Search engine manually:**
  ```bash
  npm run search -- "Inception"
  ```

## Security
- This addon is strictly for **personal use** and binds to localhost (`127.0.0.1`) by default.
- It respects your `.gitignore` and never logs your Telegram session, OTP, or passwords.
- It only searches chats you are already a member of and have explicitly pinned.

## Disclaimer
This project relies on the unofficial `gramjs` client and the Telegram MTProto API. Do not abuse the Telegram API by spamming search requests. The streaming proxy respects Telegram's limits but heavily seeking around in a 4K file may trigger temporary flood waits from Telegram.
