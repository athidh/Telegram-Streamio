import express from "express";
import { resolveMovieStreams } from "../resolver/movieResolver.js";
import { streamTelegramFile } from "../streaming/proxy.js";

export function createStremioRouter(telegramClient, streamClient) {
  const router = express.Router();

  // Stremio stream endpoint
  router.get("/stream/:type/:id.json", async (req, res) => {
    const { type, id } = req.params;
    
    if (type !== "movie") {
      return res.json({ streams: [] });
    }

    try {
      const streams = await resolveMovieStreams(telegramClient, id, type);
      res.json({ streams });
    } catch (error) {
      console.error("Error resolving streams:", error);
      res.json({ streams: [] });
    }
  });

  // Stream proxy endpoint for video playback
  router.get("/stream/:chatId/:messageId/:filename", async (req, res) => {
    const { chatId, messageId } = req.params;
    try {
      await streamTelegramFile(req, res, streamClient, chatId, parseInt(messageId, 10));
    } catch (error) {
      console.error("[Router] Stream proxy error:", error);
      if (!res.headersSent) {
        res.status(500).send("Streaming failed");
      }
    }
  });

  return router;
}
