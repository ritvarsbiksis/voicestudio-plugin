import { describe, expect, it } from "vitest";
import { resolveOutput } from "../src/tools.js";

const now = new Date("2026-11-10T21:30:05Z");

describe("resolveOutput", () => {
  it("builds a timestamped name in the output folder", () => {
    expect(resolveOutput(undefined, undefined, "/out", "[laughter] Sveiki, pasaule!", now)).toEqual({
      path: "/out/voicestudio-20261110-213005-sveiki-pasaule.wav",
      format: "wav",
    });
  });

  it("resolves relative, home and extension-less paths", () => {
    expect(resolveOutput("intro.mp3", undefined, "/out", "x", now)).toEqual({ path: "/out/intro.mp3", format: "mp3" });
    expect(resolveOutput("/abs/clip", "flac", "/out", "x", now)).toEqual({ path: "/abs/clip.flac", format: "flac" });
    expect(resolveOutput("/abs/clip.txt", undefined, "/out", "x", now)).toEqual({ path: "/abs/clip.txt.wav", format: "wav" });
    expect(resolveOutput("~/a.wav", "mp3", "/out", "x", now).path.endsWith("/a.mp3")).toBe(true);
  });
});
