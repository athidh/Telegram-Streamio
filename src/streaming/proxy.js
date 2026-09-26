import { Api } from 'telegram';
import bigInt from 'big-integer';

// ─── Configuration ─────────────────────────────────────────────────────────────
// Telegram's maximum allowed limit per upload.GetFile is 1 MB (1024 * 1024 bytes).
const CHUNK_SIZE = 1024 * 1024;

// Number of concurrent upload.GetFile requests kept in flight simultaneously.
// 4 requests (4 MB in flight) achieves maximum throughput without triggering Telegram flood wait.
const CONCURRENCY = 4;

// Cache of document metadata to avoid repeated Telegram API calls on range reconnects
// key: `${chatIdStr}_${messageId}` -> { fileLocation, dcId, totalSize, mimeType, filename }
const documentCache = new Map();

// DC ID -> Sender connection cache
const dcSenders = new Map();

// Active streams registry: id -> { filename, fileKey, start, abort() }
const activeStreams = new Map();

function killStaleStreams(chatIdStr, messageId, start) {
  const currentFile = `${chatIdStr}|${messageId}`;
  for (const [key, stream] of activeStreams.entries()) {
    // If it's a different movie or seeking to a different location, stop the old stream
    if (stream.fileKey !== currentFile || Math.abs(stream.start - start) > 5 * 1024 * 1024) {
      console.log(`[Proxy] ⏹️ Stopped old stream: "${stream.filename}" @ ${(stream.start / 1024 / 1024).toFixed(1)} MB`);
      stream.abort();
      activeStreams.delete(key);
    }
  }
}

// ─── MIME Type Helper ──────────────────────────────────────────────────────────
function guessMime(filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    mkv:  'video/x-matroska',
    mp4:  'video/mp4',
    avi:  'video/x-msvideo',
    mov:  'video/quicktime',
    ts:   'video/mp2t',
    webm: 'video/webm',
    m4v:  'video/x-m4v',
    flv:  'video/x-flv',
    mp3:  'audio/mpeg',
    flac: 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

// ─── Document Metadata Resolver ────────────────────────────────────────────────
async function getDocument(client, chatIdStr, messageId) {
  const cacheKey = `${chatIdStr}_${messageId}`;
  if (documentCache.has(cacheKey)) {
    return documentCache.get(cacheKey);
  }

  let msg;
  try {
    const peer = chatIdStr === 'me' ? 'me' : chatIdStr;
    const msgs = await client.getMessages(peer, { ids: [Number(messageId)] });
    msg = msgs?.[0];
  } catch {
    const res = await client.invoke(
      new Api.messages.GetMessages({ id: [new Api.InputMessageID({ id: Number(messageId) })] })
    );
    msg = res.messages?.[0];
  }

  if (!msg || !msg.media || !msg.media.document) {
    throw new Error(`Document not found for message #${messageId} in ${chatIdStr}`);
  }

  const doc = msg.media.document;
  const dcId = Number(doc.dcId || doc.dc_id);

  const fileLocation = new Api.InputDocumentFileLocation({
    id:            doc.id,
    accessHash:    doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize:     '',
  });
  fileLocation.dcId = dcId;

  const filenameAttr = doc.attributes?.find(a => a.className === 'DocumentAttributeFilename');
  const filename = filenameAttr?.fileName || 'video.mkv';
  const mimeType = doc.mimeType || guessMime(filename);
  const totalSize = Number(doc.size);

  const meta = { fileLocation, dcId, totalSize, mimeType, filename };
  documentCache.set(cacheKey, meta);
  return meta;
}

// ─── Parallel Async Generator for Telegram Chunks ──────────────────────────────
/**
 * Keeps CONCURRENCY upload.GetFile requests in flight concurrently over client's DC connection.
 * Reassembles chunks in strict sequential order.
 * Automatically aligns unaligned seek offsets down to 1MB and trims leading bytes from chunk #0.
 */
async function* iterDownloadParallel(
  client,
  fileLocation,
  dcId,
  startOffset,
  totalBytes,
  shouldAbort
) {
  if (totalBytes <= 0) return;

  // Retrieve or cache the persistent DC sender
  let sender = dcSenders.get(dcId);
  if (!sender) {
    sender = await client.getSender(dcId);
    dcSenders.set(dcId, sender);
  }

  // Prevent GramJS's internal 30-second EXPORTED_SENDER_RELEASE_TIMEOUT from firing
  // which causes "sender already has some hanging states. reconnecting" mid-stream.
  const cancelReleaseTimeout = () => {
    const t = client._exportedSenderReleaseTimeouts?.get(dcId);
    if (t) {
      clearTimeout(t);
      client._exportedSenderReleaseTimeouts.delete(dcId);
    }
  };
  cancelReleaseTimeout();

  const endOffset = startOffset + totalBytes; // exclusive end

  // 1. Align start offset DOWN to 1MB boundary (Telegram MTProto requirement)
  const alignedStart = Math.floor(startOffset / CHUNK_SIZE) * CHUNK_SIZE;
  const skipFirstBytes = startOffset - alignedStart;

  let nextFetchOffset = alignedStart;
  let remainingToYield = totalBytes;

  // Sliding window queue of in-flight promises: Array<{ offset, promise }>
  const inFlight = [];

  const launchChunk = (offset) => {
    const p = client.invokeWithSender(
      new Api.upload.GetFile({
        location: fileLocation,
        offset:   bigInt(offset),
        limit:    CHUNK_SIZE,
      }),
      sender
    ).then(res => {
      if (res && res.bytes) return Buffer.from(res.bytes);
      return Buffer.alloc(0);
    });

    // Attach no-op catch immediately to prevent UnhandledPromiseRejection if stream aborts
    p.catch(() => {});
    return p;
  };

  // Pre-fill the pipeline with initial requests
  while (inFlight.length < CONCURRENCY && nextFetchOffset < endOffset) {
    const off = nextFetchOffset;
    inFlight.push({ offset: off, promise: launchChunk(off) });
    nextFetchOffset += CHUNK_SIZE;
  }

  let isFirst = true;

  while (inFlight.length > 0) {
    if (shouldAbort()) {
      inFlight.length = 0;
      break;
    }
    cancelReleaseTimeout();

    // Pop the oldest in-flight chunk (strictly ordered)
    const { offset, promise } = inFlight.shift();

    // Refill pipeline ahead to maintain full saturation
    if (nextFetchOffset < endOffset && !shouldAbort()) {
      const off = nextFetchOffset;
      inFlight.push({ offset: off, promise: launchChunk(off) });
      nextFetchOffset += CHUNK_SIZE;
    }

    let chunk = await promise;
    if (shouldAbort() || !chunk || chunk.length === 0) {
      inFlight.length = 0;
      break;
    }

    // 2. Trim unaligned leading bytes on the first chunk
    if (isFirst) {
      isFirst = false;
      if (skipFirstBytes > 0) {
        chunk = chunk.subarray(skipFirstBytes);
      }
    }

    // 3. Trim trailing bytes if chunk exceeds requested range
    if (chunk.length > remainingToYield) {
      chunk = chunk.subarray(0, remainingToYield);
    }

    if (chunk.length > 0) {
      yield chunk;
      remainingToYield -= chunk.length;
    }

    if (remainingToYield <= 0) break;
  }
}

// ─── Stream Telegram File HTTP Handler ─────────────────────────────────────────
export async function streamTelegramFile(req, res, client, chatIdStr, messageId) {
  let aborted = false;
  res.setMaxListeners(50);

  const streamId = `${chatIdStr}_${messageId}_${Date.now()}_${Math.random()}`;

  const markAborted = () => {
    if (!aborted) {
      aborted = true;
      activeStreams.delete(streamId);
    }
  };

  req.on('close', markAborted);
  res.on('close', markAborted);

  try {
    // 1. Resolve file metadata from Telegram
    const { fileLocation, dcId, totalSize, mimeType, filename } = await getDocument(
      client,
      chatIdStr,
      messageId
    );

    if (aborted) return;

    // 2. Parse RFC 7233 Range header
    let start = 0;
    let end   = totalSize - 1;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      if (parts[1]) {
        end = Math.min(parseInt(parts[1], 10), totalSize - 1);
      }
    }

    // Validate range
    if (isNaN(start) || start < 0 || start >= totalSize || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${totalSize}`,
      });
      res.end();
      return;
    }

    const contentLength = end - start + 1;
    const isProbe = contentLength < 5 * 1024 * 1024;

    // Stop previous streams if user switched files or jumped/seeked
    if (!isProbe) {
      killStaleStreams(chatIdStr, messageId, start);
    }

    activeStreams.set(streamId, {
      filename,
      fileKey: `${chatIdStr}|${messageId}`,
      start,
      abort: () => {
        aborted = true;
        try { res.destroy(); } catch {}
      },
    });

    console.log(
      `[Proxy] ▶ "${filename}" ` +
      `${(start / 1024 / 1024).toFixed(1)} - ${(end / 1024 / 1024).toFixed(1)} MB ` +
      `(${(contentLength / 1024 / 1024).toFixed(1)} MB)`
    );

    // 3. Send HTTP response headers
    req.socket.setNoDelay(true);

    if (rangeHeader) {
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': contentLength,
        'Content-Type':   mimeType,
      });
    } else {
      res.writeHead(200, {
        'Accept-Ranges':  'bytes',
        'Content-Length': contentLength,
        'Content-Type':   mimeType,
      });
    }

    // 4. Stream chunks directly to HTTP response
    const streamIter = iterDownloadParallel(
      client,
      fileLocation,
      dcId,
      start,
      contentLength,
      () => aborted || req.socket.destroyed
    );

    let speedBytes = 0;
    let speedTs    = Date.now();

    for await (const chunk of streamIter) {
      if (aborted || req.socket.destroyed) break;

      speedBytes += chunk.length;
      const ok = res.write(chunk);

      // Backpressure handling: pause if socket buffer is saturated
      if (!ok && !aborted) {
        await new Promise(r => {
          const onDrain = () => { cleanup(); r(); };
          const onClose = () => { cleanup(); r(); };
          const cleanup = () => {
            res.removeListener('drain', onDrain);
            res.removeListener('close', onClose);
          };
          res.once('drain', onDrain);
          res.once('close', onClose);
        });
      }

      // Throughput logging
      const now = Date.now();
      if (now - speedTs >= 5000) {
        const mbps = (speedBytes / 1024 / 1024 / ((now - speedTs) / 1000)).toFixed(1);
        console.log(`[Proxy] ⚡ "${filename}": ${mbps} MB/s (direct stream)`);
        speedBytes = 0;
        speedTs    = now;
      }
    }

    if (!aborted && !req.socket.destroyed) {
      res.end();
    }

  } catch (err) {
    if (aborted) return;
    console.error(`[Proxy] Error streaming message #${messageId}:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('Streaming error');
    } else {
      res.end();
    }
  }
}
