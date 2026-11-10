/** Small helpers for WAV buffers and text chunking. No dependencies. */

export const MAX_INPUT_CHARS = 4096;

interface WavInfo {
  /** Byte offset where the fmt chunk body starts. */
  fmtOffset: number;
  fmtSize: number;
  byteRate: number;
  dataOffset: number;
  dataSize: number;
}

function parseWav(buf: Buffer): WavInfo | undefined {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return undefined;
  }
  let offset = 12;
  let fmtOffset = -1;
  let fmtSize = 0;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    let size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmtOffset = body;
      fmtSize = size;
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === "data") {
      // Streaming writers may leave 0 or 0xFFFFFFFF as the size; use what is actually there.
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      if (fmtOffset < 0) return undefined;
      return { fmtOffset, fmtSize, byteRate, dataOffset: body, dataSize: size };
    }
    offset = body + size + (size % 2);
  }
  return undefined;
}

/** Duration of a PCM WAV buffer in seconds, or undefined when it cannot be read. */
export function wavDurationSeconds(buf: Buffer): number | undefined {
  const info = parseWav(buf);
  if (!info || info.byteRate <= 0) return undefined;
  return info.dataSize / info.byteRate;
}

/**
 * Concatenates WAV buffers that share one format into a single WAV. Throws when a part is not a
 * readable WAV or its format differs from the first part.
 */
export function concatWav(parts: Buffer[]): Buffer {
  if (parts.length === 0) throw new Error("no audio to join");
  if (parts.length === 1) return parts[0];
  const infos = parts.map((p, i) => {
    const info = parseWav(p);
    if (!info) throw new Error(`audio part ${i + 1} is not a WAV file`);
    return info;
  });
  const fmt = parts[0].subarray(infos[0].fmtOffset, infos[0].fmtOffset + infos[0].fmtSize);
  infos.forEach((info, i) => {
    const other = parts[i].subarray(info.fmtOffset, info.fmtOffset + info.fmtSize);
    if (!other.equals(fmt)) throw new Error(`audio part ${i + 1} has a different WAV format`);
  });
  const data = Buffer.concat(parts.map((p, i) => p.subarray(infos[i].dataOffset, infos[i].dataOffset + infos[i].dataSize)));
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(header.length - 8 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  const dataHeader = 20 + fmt.length;
  header.write("data", dataHeader, "ascii");
  header.writeUInt32LE(data.length, dataHeader + 4);
  return Buffer.concat([header, data]);
}

/**
 * Splits text into chunks no longer than `max` characters, preferring paragraph, then sentence,
 * then clause, then word boundaries. Expressive tokens like "[laughter]" are never cut.
 */
export function chunkText(text: string, max = 1500): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= max) return [clean];

  const pieces = splitKeep(clean, /(?<=\n\s*\n)/)
    .flatMap((p) => (p.length <= max ? [p] : splitKeep(p, /(?<=[.!?…。！？]["'”»)]*\s+)/)))
    .flatMap((p) => (p.length <= max ? [p] : splitKeep(p, /(?<=[,;:—–]\s+)/)))
    .flatMap((p) => (p.length <= max ? [p] : splitWords(p, max)));

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current.length + piece.length <= max) {
      current += piece;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function splitKeep(text: string, re: RegExp): string[] {
  return text.split(re).filter((s) => s.length > 0);
}

function splitWords(text: string, max: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/(?<=\s)/)) {
    if (word.length > max) {
      if (current) out.push(current);
      for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
      current = "";
    } else if (current.length + word.length > max) {
      out.push(current);
      current = word;
    } else {
      current += word;
    }
  }
  if (current) out.push(current);
  return out;
}
