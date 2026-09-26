import { parseQuality, parseCodec, parseAudio, parseSource } from "./qualityParser.js";

export function parseFilename(filename) {
  // Simple heuristic: title usually comes before the year or resolution/quality
  // E.g., Interstellar.2014.1080p.BluRay.x264.mkv
  // E.g., The.Dark.Knight.2008.720p.mkv

  // Remove extension
  let cleanName = filename.replace(/\.(mkv|mp4|avi|webm)$/i, "");
  
  // Extract year if present
  const yearMatch = cleanName.match(/(19\d{2}|20\d{2})/);
  let year = yearMatch ? parseInt(yearMatch[0]) : null;

  // Extract title
  // Everything before the year or quality indicator
  let titlePart = cleanName;
  if (year) {
    titlePart = cleanName.substring(0, yearMatch.index);
  } else {
    // If no year, look for quality strings like 1080p, 720p to split
    const qualityMatch = cleanName.match(/(2160p|1080p|720p|480p)/i);
    if (qualityMatch) {
      titlePart = cleanName.substring(0, qualityMatch.index);
    }
  }

  // Normalize title (remove dots, underscores, dashes, trailing spaces)
  let title = titlePart.replace(/[\._\-]/g, " ").trim();
  // Remove trailing parentheses or brackets that might have got caught
  title = title.replace(/[\[\(\]\)]/g, "").trim();

  // Extract other metadata
  const resolution = parseQuality(filename);
  const codec = parseCodec(filename);
  const audio = parseAudio(filename);
  const source = parseSource(filename);

  return {
    title,
    year,
    resolution,
    source,
    codec,
    audio,
    extension: filename.split('.').pop()
  };
}
