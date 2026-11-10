import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { normalizeLanguage } from "./config.js";

export class VoiceStudioError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "VoiceStudioError";
  }
}

export interface Health {
  state: "ok" | "starting" | "down";
  status?: string;
  device?: string;
  version?: string;
  label?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  kind?: string;
  language?: string;
  [key: string]: unknown;
}

export interface SpeechOptions {
  text: string;
  /** Profile ID (already resolved) or undefined for the app's default voice. */
  voiceId?: string;
  language?: string;
  speed: number;
  steps: number;
  guidanceScale?: number;
  instruct?: string;
  format: "wav" | "mp3" | "flac";
}

export interface Deps {
  fetch: typeof fetch;
  /** Starts the desktop app in the background. */
  launchApp: (appName: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: Deps = {
  fetch: (...args) => fetch(...args),
  launchApp: (appName) =>
    new Promise((resolve, reject) => {
      if (process.platform !== "darwin") {
        reject(new VoiceStudioError(`Automatic start is only supported on macOS. Start ${appName} yourself.`));
        return;
      }
      execFile("open", ["-g", "-a", appName], (err) =>
        err ? reject(new VoiceStudioError(`Could not open ${appName}.app: ${err.message}`)) : resolve(),
      );
    }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

const READY_TIMEOUT_MS = 120_000;
const QUICK_RETRY_MS = 10_000;
const SYNTH_TIMEOUT_MS = 30 * 60_000; // first call may load (or queue behind) a model

const AUDIO_MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
  ".aac": "audio/aac",
};

export class VoiceStudioClient {
  private readonly deps: Deps;
  private launched = false;
  private gaveUp = false;
  private profilesCache?: { at: number; profiles: VoiceProfile[] };

  constructor(readonly config: Config, deps: Partial<Deps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  private url(p: string): string {
    return `${this.config.baseUrl}${p}`;
  }

  async health(): Promise<Health> {
    let res: Response;
    try {
      res = await this.deps.fetch(this.url("/health"), { signal: AbortSignal.timeout(3000) });
    } catch {
      return { state: "down" };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
    const state = res.ok && body.status === "ok" ? "ok" : res.status === 503 || body.status === "starting" ? "starting" : "down";
    return { state, status: str("status"), device: str("device"), version: str("version"), label: str("label") };
  }

  /** Waits until the backend reports ok, starting the app once when allowed. */
  async ensureReady(): Promise<Health> {
    let health = await this.health();
    if (health.state === "ok") return health;

    if (health.state === "down") {
      if (!this.config.autoLaunch) {
        throw new VoiceStudioError(
          `VoiceStudio is not responding at ${this.config.baseUrl}. Open the VoiceStudio app (or enable "Start VoiceStudio automatically" in the plugin settings).`,
        );
      }
      if (!this.launched) {
        this.launched = true;
        await this.deps.launchApp(this.config.appName);
      }
    }

    // After one full wait has failed, a backend that still does not answer at all is not coming
    // up by itself (e.g. the window is open but its backend stopped): fail fast instead of
    // blocking every call for the whole timeout again. A backend that answers "starting" is
    // always waited for.
    const budget = this.gaveUp && health.state === "down" ? QUICK_RETRY_MS : READY_TIMEOUT_MS;
    const deadline = this.deps.now() + budget;
    while (this.deps.now() < deadline) {
      await this.deps.sleep(1500);
      health = await this.health();
      if (health.state === "ok") {
        this.gaveUp = false;
        return health;
      }
    }
    this.gaveUp = true;
    if (health.state === "down") {
      throw new VoiceStudioError(
        `VoiceStudio's backend is not answering at ${this.config.baseUrl}. If the VoiceStudio window is open, its speech engine has stopped: quit VoiceStudio completely (Cmd+Q) and open it again, or check the window for an error or setup prompt.`,
      );
    }
    const where = health.label ? ` (last step: ${health.label})` : "";
    throw new VoiceStudioError(
      `VoiceStudio is still starting at ${this.config.baseUrl} after ${budget / 1000}s${where}. It may be installing its runtime or a model; check the app window and try again.`,
    );
  }

  private async request(p: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    await this.ensureReady();
    let res: Response;
    try {
      res = await this.deps.fetch(this.url(p), { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const e = err as Error;
      if (e.name === "TimeoutError") throw new VoiceStudioError(`VoiceStudio did not answer ${p} within ${Math.round(timeoutMs / 1000)}s.`);
      throw new VoiceStudioError(`Could not reach VoiceStudio at ${this.config.baseUrl}: ${e.message}`);
    }
    if (!res.ok) throw new VoiceStudioError(await describeError(p, res), res.status);
    return res;
  }

  async listProfiles(fresh = false): Promise<VoiceProfile[]> {
    if (!fresh && this.profilesCache && this.deps.now() - this.profilesCache.at < 30_000) {
      return this.profilesCache.profiles;
    }
    const res = await this.request("/profiles", { method: "GET" }, 30_000);
    const data = (await res.json()) as unknown;
    const profiles = Array.isArray(data) ? (data as VoiceProfile[]) : [];
    this.profilesCache = { at: this.deps.now(), profiles };
    return profiles;
  }

  /**
   * Turns a voice name or ID into a profile ID. Empty input means the app default (undefined).
   * Matches an exact ID, then a case-insensitive name, then a unique ID prefix.
   */
  async resolveVoice(voice: string | undefined): Promise<string | undefined> {
    const wanted = voice?.trim();
    if (!wanted || wanted.toLowerCase() === "default") return undefined;
    const profiles = await this.listProfiles();
    const match = matchProfile(profiles, wanted);
    if (match) return match.id;
    const names = profiles.map((p) => p.name).filter(Boolean);
    throw new VoiceStudioError(
      `No VoiceStudio voice matches "${wanted}". ${names.length ? `Available: ${names.join(", ")}.` : "No voice profiles exist yet; create one in the app or with clone_voice."}`,
    );
  }

  async synthesize(opts: SpeechOptions): Promise<Buffer> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      input: opts.text,
      voice: opts.voiceId ?? "default",
      speed: opts.speed,
      num_step: opts.steps,
      response_format: opts.format,
    };
    const language = normalizeLanguage(opts.language);
    if (language) body.language = language;
    if (opts.guidanceScale !== undefined) body.guidance_scale = opts.guidanceScale;
    if (opts.instruct) body.instruct = opts.instruct;
    const res = await this.request(
      "/v1/audio/speech",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      SYNTH_TIMEOUT_MS,
    );
    return Buffer.from(await res.arrayBuffer());
  }

  async transcribe(audioPath: string, language?: string): Promise<{ text: string; language?: string; duration?: number }> {
    const form = new FormData();
    form.append("file", await fileBlob(audioPath), path.basename(audioPath));
    form.append("response_format", "verbose_json");
    const lang = normalizeLanguage(language);
    if (lang) form.append("language", lang);
    const res = await this.request("/v1/audio/transcriptions", { method: "POST", body: form }, SYNTH_TIMEOUT_MS);
    const data = (await res.json()) as { text?: string; language?: string; duration?: number };
    return { text: (data.text ?? "").trim(), language: data.language || undefined, duration: data.duration || undefined };
  }

  async cloneVoice(args: { name: string; audioPath: string; transcript?: string; language?: string }): Promise<VoiceProfile> {
    const form = new FormData();
    form.append("name", args.name);
    form.append("kind", "clone");
    form.append("ref_audio", await fileBlob(args.audioPath), path.basename(args.audioPath));
    form.append("ref_text", args.transcript ?? "");
    form.append("language", normalizeLanguage(args.language) ?? "Auto");
    const res = await this.request("/profiles", { method: "POST", body: form }, 10 * 60_000);
    this.profilesCache = undefined;
    return (await res.json()) as VoiceProfile;
  }
}

export function matchProfile(profiles: VoiceProfile[], wanted: string): VoiceProfile | undefined {
  const lower = wanted.toLowerCase();
  const exact = profiles.find((p) => p.id === wanted);
  if (exact) return exact;
  const byName = profiles.filter((p) => typeof p.name === "string" && p.name.toLowerCase() === lower);
  if (byName.length >= 1) return byName[0];
  const byPrefix = profiles.filter((p) => typeof p.id === "string" && p.id.toLowerCase().startsWith(lower));
  return byPrefix.length === 1 ? byPrefix[0] : undefined;
}

async function fileBlob(p: string): Promise<Blob> {
  let data: Buffer;
  try {
    data = await readFile(p);
  } catch (err) {
    throw new VoiceStudioError(`Cannot read audio file ${p}: ${(err as Error).message}`);
  }
  const type = AUDIO_MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
  return new Blob([new Uint8Array(data)], { type });
}

/** Builds a readable message from a VoiceStudio error response (FastAPI or OpenAI shape). */
export async function describeError(p: string, res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  let detail = raw.trim();
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const err = json.error as Record<string, unknown> | undefined;
    if (err && typeof err.message === "string") detail = err.message;
    else if (typeof json.detail === "string") detail = json.detail;
    else if (Array.isArray(json.detail)) {
      detail = json.detail
        .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join(".")}: ${d.msg ?? ""}`)
        .join("; ");
    }
  } catch {
    // not JSON: keep the text
  }
  if (detail.length > 600) detail = `${detail.slice(0, 600)}…`;
  return `VoiceStudio ${p} failed with HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
}
