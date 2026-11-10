import { describe, expect, it, vi } from "vitest";
import { describeError, matchProfile, VoiceStudioClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const profiles = [
  { id: "0a96633d", name: "Explainer", kind: "design" },
  { id: "6c622598", name: "Companion", kind: "clone" },
];

describe("matchProfile", () => {
  it("matches id, name (any case) and unique prefix", () => {
    expect(matchProfile(profiles, "6c622598")?.name).toBe("Companion");
    expect(matchProfile(profiles, "explainer")?.id).toBe("0a96633d");
    expect(matchProfile(profiles, "0a9")?.id).toBe("0a96633d");
    expect(matchProfile(profiles, "nobody")).toBeUndefined();
  });
});

describe("VoiceStudioClient", () => {
  it("launches the app once when the backend is down and waits for ok", async () => {
    let calls = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        calls++;
        if (calls === 1) throw new Error("ECONNREFUSED");
        if (calls === 2) return json({ status: "starting", label: "Loading" }, 503);
        return json({ status: "ok", device: "mps", version: "0.5.6" });
      }
      return json(profiles);
    });
    const launchApp = vi.fn(async () => undefined);
    const client = new VoiceStudioClient(loadConfig({}), { fetch: fetch as never, launchApp, ...fakeClock() });
    const health = await client.ensureReady();
    expect(health).toMatchObject({ state: "ok", device: "mps" });
    expect(launchApp).toHaveBeenCalledWith("VoiceStudio");
  });

  it("explains how to start the app when auto-launch is off", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = new VoiceStudioClient(loadConfig({ VOICESTUDIO_PLUGIN_AUTO_LAUNCH: "false" }), { fetch: fetch as never });
    await expect(client.ensureReady()).rejects.toThrow(/not responding.*Open the VoiceStudio app/);
  });

  it("gives up after the ready timeout while starting", async () => {
    const fetch = vi.fn(async () => json({ status: "starting", label: "Installing models" }, 503));
    const client = new VoiceStudioClient(loadConfig({}), { fetch: fetch as never, launchApp: async () => undefined, ...fakeClock() });
    await expect(client.ensureReady()).rejects.toThrow(/still starting.*Installing models/);
  });

  it("fails fast on later calls when the backend stays down", async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const launchApp = vi.fn(async () => undefined);
    const client = new VoiceStudioClient(loadConfig({}), { fetch: fetch as never, launchApp, ...clock });
    await expect(client.ensureReady()).rejects.toThrow(/quit VoiceStudio completely/);
    const t0 = clock.now();
    await expect(client.ensureReady()).rejects.toThrow(/not answering/);
    expect(clock.now() - t0).toBeLessThanOrEqual(12_000);
    expect(launchApp).toHaveBeenCalledTimes(1);
  });

  it("sends the speech request with resolved defaults and no language for Auto", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) return json({ status: "ok" });
      if (url.endsWith("/profiles")) return json(profiles);
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = new VoiceStudioClient(loadConfig({}), { fetch: fetch as never });
    const voiceId = await client.resolveVoice("companion");
    const buf = await client.synthesize({ text: "Sveiki", voiceId, language: "lv", speed: 1.1, steps: 24, format: "wav" });
    await client.synthesize({ text: "Hi", language: "Auto", speed: 1, steps: 16, format: "mp3", instruct: "whisper" });
    expect(buf.length).toBe(3);
    expect(bodies[0]).toEqual({
      model: "tts-1",
      input: "Sveiki",
      voice: "6c622598",
      speed: 1.1,
      num_step: 24,
      response_format: "wav",
      language: "lv",
    });
    expect(bodies[1]).not.toHaveProperty("language");
    expect(bodies[1]).toMatchObject({ voice: "default", instruct: "whisper", response_format: "mp3" });
  });

  it("lists available names when a voice is unknown", async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith("/health") ? json({ status: "ok" }) : json(profiles)));
    const client = new VoiceStudioClient(loadConfig({}), { fetch: fetch as never });
    await expect(client.resolveVoice("Ghost")).rejects.toThrow(/Available: Explainer, Companion/);
    expect(await client.resolveVoice("")).toBeUndefined();
    expect(await client.resolveVoice("default")).toBeUndefined();
  });

  it("surfaces backend error details", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/health") ? json({ status: "ok" }) : json({ error: { message: "Model omnivoice is not installed" } }, 400),
    );
    const client = new VoiceStudioClient(loadConfig({}), { fetch: fetch as never });
    await expect(client.synthesize({ text: "x", speed: 1, steps: 16, format: "wav" })).rejects.toThrow(
      "VoiceStudio /v1/audio/speech failed with HTTP 400: Model omnivoice is not installed",
    );
  });
});

describe("describeError", () => {
  it("handles FastAPI validation lists and plain text", async () => {
    expect(await describeError("/p", json({ detail: [{ loc: ["body", "input"], msg: "too long" }] }, 422))).toBe(
      "VoiceStudio /p failed with HTTP 422: body.input: too long",
    );
    expect(await describeError("/p", new Response("boom", { status: 500 }))).toBe("VoiceStudio /p failed with HTTP 500: boom");
  });
});
