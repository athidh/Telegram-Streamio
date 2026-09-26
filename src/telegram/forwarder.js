import { Api } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { parseFilename } from "../resolver/filenameParser.js";

// Global map to resolve promises when a document is forwarded
export const waitingForDocument = new Map();

export function setupForwarder(client) {
  // Listen to new private messages (usually from bots sending files)
  client.addEventHandler(async (event) => {
    const msg = event.message;
    
    // Check if message has a document
    if (msg.media && msg.media.document) {
      // Only process private chats with bots (or channels we just joined)
      const isPrivate = msg.isPrivate;
      
      // Auto-forward to Saved Messages ("me") if possible
      let finalChatId = "me";
      let finalMsgId = null;
      let finalDoc = null;
      let finalFilename = "Unknown";
      
      try {
        const forwarded = await client.invoke(
          new Api.messages.ForwardMessages({
            fromPeer: msg.peerId,
            id: [msg.id],
            toPeer: "me",
            randomId: [BigInt(Math.floor(Math.random() * 100000000000))]
          })
        );
        
        if (forwarded && forwarded.updates) {
          const newMsgUpdate = forwarded.updates.find(u => u.className === "UpdateNewMessage");
          if (newMsgUpdate && newMsgUpdate.message) {
            finalMsgId = newMsgUpdate.message.id;
            finalDoc = newMsgUpdate.message.media.document;
          }
        }
      } catch (err) {
        if (err.message.includes("CHAT_FORWARDS_RESTRICTED")) {
          console.warn("[Forwarder] Chat restricts forwarding. Serving stream directly from the bot's private chat! Note: Bot may delete it after 10 minutes.");
          // Fallback to streaming directly from the bot!
          finalChatId = msg.peerId.userId ? msg.peerId.userId.toString() : msg.peerId.channelId.toString();
          finalMsgId = msg.id;
          finalDoc = msg.media.document;
        } else {
          console.error("[Forwarder] Error forwarding document to Saved Messages:", err);
          return;
        }
      }

      if (finalMsgId && finalDoc) {
        const filenameAttr = finalDoc.attributes.find(a => a.className === "DocumentAttributeFilename");
        finalFilename = filenameAttr ? filenameAttr.fileName : "Unknown";
        
        // Check if anyone is waiting for this movie title
        for (const [query, resolver] of waitingForDocument.entries()) {
          const cleanFilename = finalFilename.toLowerCase().replace(/[^a-z0-9]/g, "");
          const cleanQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
          
          if (cleanFilename.includes(cleanQuery)) {
            console.log(`[Forwarder] Matched file for query '${query}': ${finalFilename}`);
            
            const parsed = parseFilename(finalFilename);
            resolver({
              chatId: finalChatId, // 'me' or the bot's ID
              messageId: finalMsgId,
              filename: finalFilename,
              size: finalDoc.size,
              mimeType: finalDoc.mimeType,
              resolution: parsed.resolution,
              source: parsed.source,
              codec: parsed.codec,
              audio: parsed.audio
            });
            // Don't delete or break — keep collecting more files for the same query!
            break; // break the inner for loop (one file matches one query), but the listener stays
          }
        }
      }
    } else if (msg.isPrivate && msg.replyMarkup && msg.replyMarkup.rows) {
      // It's a text message with buttons in Private Chat (likely a force-join bot)
      console.log(`[Forwarder] Received bot prompt in PM. Checking for Force-Join...`);
      for (const row of msg.replyMarkup.rows) {
        for (const button of row.buttons) {
          if (button.className === "KeyboardButtonUrl" && button.url) {
            const url = button.url;
            if (url.includes("t.me/+") || url.includes("t.me/joinchat/")) {
              console.log(`[Forwarder] Auto-joining forced channel: ${url}`);
              try {
                const hash = url.split("t.me/+")[1] || url.split("t.me/joinchat/")[1];
                await client.invoke(new Api.messages.ImportChatInvite({ hash: hash }));
                console.log(`[Forwarder] Successfully joined! Requesting file again if possible...`);
                // Usually bots have a "Try Again" or "Verify" button after joining
                // Or you can just send /start again. Let's look for callback buttons on the same message
              } catch(e) {
                console.error(`[Forwarder] Failed to join channel:`, e.message);
              }
            } else if (url.includes("t.me/") && !url.includes("?start=")) {
               // Public channel join
               const username = url.split("t.me/")[1];
               try {
                 await client.invoke(new Api.channels.JoinChannel({ channel: username }));
                 console.log(`[Forwarder] Successfully joined public channel: ${username}`);
               } catch(e) {}
            }
          }
          
          // Click verification callback buttons if present
          if (button.className === "KeyboardButtonCallback" && 
             (button.text.toLowerCase().includes("check") || button.text.toLowerCase().includes("verify") || button.text.toLowerCase().includes("joined"))) {
            console.log(`[Forwarder] Pressing Verify/Check button`);
            try {
              await client.invoke(new Api.messages.GetBotCallbackAnswer({
                peer: msg.peerId,
                msgId: msg.id,
                data: button.data
              }));
            } catch(e){}
          }
        }
      }
    }
  }, new NewMessage({ incoming: true }));
}
