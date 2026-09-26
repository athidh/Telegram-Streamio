import { Api } from "telegram";
import { waitingForDocument } from "./forwarder.js";

// Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function simulateButtonClick(client, peer, msgId, button) {
  try {
    let urlToOpen = button.url;
    
    if (button.className === "KeyboardButtonCallback") {
      console.log(`[Automation] Pressing callback button: ${button.text.substring(0,30)}...`);
      const ans = await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: peer,
          msgId: msgId,
          data: button.data
        })
      );
      if (ans && ans.url) {
        console.log(`[Automation] Callback returned URL: ${ans.url}`);
        urlToOpen = ans.url;
      }
    }

    if (urlToOpen) {
      const match = urlToOpen.match(/t\.me\/([^?]+)\?start=(.+)/);
      if (match) {
        const botUsername = match[1];
        const startParam = match[2];
        console.log(`[Automation] Starting bot @${botUsername} with param ${startParam}`);
        await client.invoke(
          new Api.messages.StartBot({
            bot: botUsername,
            peer: botUsername,
            randomId: BigInt(Math.floor(Math.random() * 100000000000)),
            startParam: startParam
          })
        );
      }
    }
  } catch (err) {
    console.error("[Automation] Error clicking button:", err.message);
  }
}

export async function automateMovieRequest(client, query) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Get Pinned Groups/Channels via GetPinnedDialogs (avoids getDialogs() crash
      //    and flood-wait issues). Cached for 5 minutes.
      const now = Date.now();
      if (!automateMovieRequest._dialogsCache || now - automateMovieRequest._dialogsTs > 5 * 60 * 1000) {
        const raw = await client.invoke(new Api.messages.GetPinnedDialogs({ folderId: 0 }));
        const chatsById = new Map((raw.chats || []).map(c => [String(c.id), c]));

        automateMovieRequest._dialogsCache = (raw.dialogs || [])
          .map(d => {
            const peer = d.peer;
            if (!peer) return null;

            let id, entity;
            if (peer.className === "PeerChannel" && peer.channelId) {
              id = String(peer.channelId);
              const chat = chatsById.get(id);
              if (!chat) return null;
              entity = chat.username
                ? chat.username
                : new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash || BigInt(0) });
              return { entity, title: chat.title || "channel" };
            }
            if (peer.className === "PeerChat" && peer.chatId) {
              id = String(peer.chatId);
              const chat = chatsById.get(id);
              if (!chat) return null;
              entity = new Api.InputPeerChat({ chatId: chat.id });
              return { entity, title: chat.title || "group" };
            }
            return null;
          })
          .filter(Boolean);

        automateMovieRequest._dialogsTs = now;
        console.log(`[Automation] Found ${automateMovieRequest._dialogsCache.length} pinned group(s):`,
          automateMovieRequest._dialogsCache.map(s => s.title));
      }
      const sources = automateMovieRequest._dialogsCache;

      if (sources.length === 0) {
        return resolve([]);
      }

      // Register listener for our query — collect ALL files that arrive within the window
      const results = [];
      let collectTimeout;
      let finalized = false; // Flag to stop button-clicking once we have enough

      const finalize = () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(collectTimeout);
        clearTimeout(absoluteTimeout);
        waitingForDocument.delete(query);
        console.log(`[Automation] ✅ Done collecting: ${results.length} files for '${query}'`);
        resolve(results);
      };

      // Absolute max timeout — resolve with whatever we have after 20 seconds
      const absoluteTimeout = setTimeout(finalize, 20000);

      waitingForDocument.set(query, (doc) => {
        if (finalized) return; // ignore late arrivals
        results.push(doc);
        console.log(`[Automation] 📥 File ${results.length} received for '${query}': ${doc.filename}`);
        
        // Reset the collection window — wait 4 more seconds for additional files
        clearTimeout(collectTimeout);
        collectTimeout = setTimeout(() => {
          finalize();
        }, 4000);
      });

      // 2. Send the request to pinned groups and click buttons
      for (const source of sources) {
        if (finalized) break; // Stop if we already have enough results
        console.log(`[Automation] Sending request for '${query}' in ${source.title}`);
        const sentMsg = await client.sendMessage(source.entity, { message: query });
        await sleep(2000); // Wait for bot to reply
        
        // 3. Fetch recent messages to find the bot's reply
        const msgs = await client.getMessages(source.entity, { limit: 10 });
        
        for (const msg of msgs) {
          if (finalized) break; // Stop clicking if already done
          // Ensure we only click buttons on messages that are a reply to OUR request
          const isReplyToUs = msg.replyTo && msg.replyTo.replyToMsgId === sentMsg.id;
          const mentionsUs = msg.message && msg.message.includes(query);
          
          if (!isReplyToUs && !mentionsUs) continue;

          // Check if message has inline buttons
          if (msg.replyMarkup && msg.replyMarkup.rows) {
            let pressedCount = 0;
            for (const row of msg.replyMarkup.rows) {
              if (finalized || pressedCount >= 5) break;
              for (const button of row.buttons) {
                if (finalized || pressedCount >= 5) break;
                const btnText = button.text.toLowerCase();
                const cleanQuery = query.toLowerCase().split(' ')[0];
                
                if (btnText.includes(cleanQuery) || btnText.includes("mb") || btnText.includes("gb") || btnText.includes("1080") || btnText.includes("720")) {
                  await simulateButtonClick(client, source.entity, msg.id, button);
                  pressedCount++;
                  await sleep(1500); // Don't spam
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[Automation] Engine error:", err);
      resolve([]);
    }
  });
}
