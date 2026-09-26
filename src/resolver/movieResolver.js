import { automateMovieRequest } from "../telegram/automation.js";
import { parseFilename } from "./filenameParser.js";
import { matchTitle } from "./titleMatcher.js";

const streamCache = new Map();

// Fetch metadata from Cinemeta
async function fetchMetadata(id, type) {
  try {
    const response = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`);
    const data = await response.json();
    if (data && data.meta) {
      return {
        title: data.meta.name,
        year: data.meta.year ? parseInt(data.meta.year) : null,
      };
    }
  } catch (err) {
    console.error("Error fetching metadata from Cinemeta:", err);
  }
  return null;
}

export async function resolveMovieStreams(client, id, type, req) {
  const rawProto = req?.headers?.["x-forwarded-proto"] || req?.protocol || "http";
  const protocol = String(rawProto).split(",")[0].trim();
  const rawHost = req?.headers?.["x-forwarded-host"] || req?.get?.("host") || `127.0.0.1:${process.env.PORT || 7000}`;
  const host = String(rawHost).split(",")[0].trim();
  const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/+$/, "") : `${protocol}://${host}`;

  const cacheKey = `${type}_${id}`;
  if (streamCache.has(cacheKey)) {
    const cached = streamCache.get(cacheKey);
    // 60 minutes TTL
    const ttl = (process.env.CACHE_TTL || 3600) * 1000;
    if (Date.now() - cached.timestamp < ttl) {
      console.log(`[INFO] Serving cached streams for ${id}`);
      return cached.streams.map(s => ({
        ...s,
        url: `${baseUrl}/stream/${s._chatId}/${s._messageId}/video.mkv`
      }));
    } else {
      streamCache.delete(cacheKey);
    }
  }

  const meta = await fetchMetadata(id, type);
  if (!meta) {
    console.log(`Could not resolve metadata for ${id}`);
    return [];
  }

  console.log(`[INFO] Stremio request: ${id}`);
  console.log(`[INFO] Resolving metadata: ${meta.title} (${meta.year || "Unknown Year"})`);

  // Trigger Automation Engine for bots
  console.log(`[INFO] Triggering Bot Automation Engine...`);
  const results = await automateMovieRequest(client, meta.title);
  
  console.log(`[INFO] Found ${results.length} candidate files`);

  // Filter and score matches
  const validStreams = [];

  for (const result of results) {
    const parsed = parseFilename(result.filename);
    
    // Check title match
    if (!matchTitle(parsed.title, meta.title)) {
      continue;
    }

    // Check year match if year exists in both metadata and parsed filename
    if (meta.year && parsed.year && meta.year !== parsed.year) {
      // Allow +/- 1 year discrepancy
      if (Math.abs(meta.year - parsed.year) > 1) {
         continue;
      }
    }

    // Construct stream description
    const sizeGB = (result.size / 1024 / 1024 / 1024).toFixed(2);
    let name = `Telegram\n${parsed.resolution || "Unknown"}`;
    let description = `${result.filename}\n📁 ${sizeGB} GB • ${parsed.source || "Unknown"} • ${parsed.codec || ""} • ${parsed.audio || ""}`;

    // Stremio URL format for our proxy
    const proxyUrl = `${baseUrl}/stream/${result.chatId}/${result.messageId}/video.mkv`;

    validStreams.push({
      name,
      description,
      url: proxyUrl,
      _chatId: result.chatId,
      _messageId: result.messageId,
      _resolution: parsed.resolution,
      _size: result.size,
      _filename: result.filename
    });
  }

  // Sort by resolution, then source quality, then size
  validStreams.sort((a, b) => {
    const resMap = { "4K": 4, "1080p": 3, "720p": 2, "480p": 1, "Unknown": 0 };
    const resA = resMap[a._resolution] || 0;
    const resB = resMap[b._resolution] || 0;
    if (resA !== resB) return resB - resA;

    // Prefer well-known, compatible sources (WEB-DL, BluRay, BDRip) over fan encodes
    const sourceScore = (f) => {
      const fn = f._filename.toLowerCase();
      if (fn.includes("web-dl") || fn.includes("webrip")) return 3;
      if (fn.includes("bluray") || fn.includes("bdrip") || fn.includes("blu-ray")) return 2;
      if (fn.includes("hdrip") || fn.includes("hd.rip")) return 1;
      return 0; // unknown / fan encode
    };
    const sA = sourceScore(a), sB = sourceScore(b);
    if (sA !== sB) return sB - sA;

    // Deprioritize files with '@' (fan-encoded, often compatibility issues)
    const atA = a._filename.includes("@") ? -1 : 0;
    const atB = b._filename.includes("@") ? -1 : 0;
    if (atA !== atB) return atB - atA;

    return b._size - a._size; // Largest first within same tier
  });

  // Deduplicate by filename (same file from different bots)
  const seen = new Set();
  const deduped = validStreams.filter(s => {
    if (seen.has(s._filename)) return false;
    seen.add(s._filename);
    return true;
  });

  // Cap at 5 best streams to avoid overloading the Telegram connection
  const capped = deduped.slice(0, 5);

  // Remove internal properties before returning to Stremio
  const finalStreams = capped.map(s => {
    delete s._resolution;
    delete s._size;
    delete s._filename;
    return s;
  });

  streamCache.set(`${type}_${id}`, {
    timestamp: Date.now(),
    streams: finalStreams
  });

  console.log(`[INFO] Selected ${finalStreams.length} streams`);
  return finalStreams;
}
