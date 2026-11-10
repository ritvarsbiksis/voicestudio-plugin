import { describe, expect, it } from "vitest";
import { chunkText, concatWav, wavDurationSeconds } from "../src/audio.js";

function wav(samples: number, sampleRate = 24000): Buffer {
  const data = Buffer.alloc(samples * 2, 1);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("wav", () => {
  it("measures duration", () => {
    expect(wavDurationSeconds(wav(24000))).toBeCloseTo(1);
    expect(wavDurationSeconds(Buffer.from("not audio"))).toBeUndefined();
  });

  it("concatenates parts with one header", () => {
    const joined = concatWav([wav(12000), wav(24000), wav(6000)]);
    expect(wavDurationSeconds(joined)).toBeCloseTo(1.75);
    expect(joined.length).toBe(44 + (12000 + 24000 + 6000) * 2);
    expect(joined.readUInt32LE(4)).toBe(joined.length - 8);
  });

  it("refuses mismatched formats", () => {
    expect(() => concatWav([wav(10, 24000), wav(10, 16000)])).toThrow(/different WAV format/);
  });
});

describe("chunkText", () => {
  it("keeps short text whole", () => {
    expect(chunkText("  Sveiki!  ")).toEqual(["Sveiki!"]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("splits on sentence boundaries under the limit", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Šis ir teikums numur ${i}.`).join(" ");
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(text);
  });

  it("falls back to words for a giant sentence", () => {
    const text = "vārds ".repeat(500).trim();
    const chunks = chunkText(text, 100);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ").split(/\s+/).length).toBe(500);
  });
});
