import os from "node:os";
import path from "node:path";

export interface Config {
  /** Backend base URL without a trailing slash, e.g. http://127.0.0.1:3900 */
  baseUrl: string;
  /** Default language code; "Auto" means let VoiceStudio detect it. */
  language: string;
  /** Default voice profile name or ID; empty means VoiceStudio's default voice. */
  voice: string;
  speed: number;
  steps: number;
  outputDir: string;
  autoLaunch: boolean;
  /** TTS model id sent to /v1/audio/speech. "tts-1" follows the engine active in the app. */
  model: string;
  /** macOS application name used by `open -a` for auto-launch. */
  appName: string;
}

type Env = Record<string, string | undefined>;

/**
 * Reads an option: VOICESTUDIO_PLUGIN_<NAME>, then CLAUDE_PLUGIN_OPTION_<NAME> (upper or lower
 * case). Empty values and unsubstituted "${user_config.x}" placeholders count as unset.
 */
export function readOption(env: Env, name: string): string | undefined {
  const keys = [
    `VOICESTUDIO_PLUGIN_${name.toUpperCase()}`,
    `CLAUDE_PLUGIN_OPTION_${name.toUpperCase()}`,
    `CLAUDE_PLUGIN_OPTION_${name.toLowerCase()}`,
  ];
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value === "" || value.includes("${user_config.")) continue;
    return value;
  }
  return undefined;
}

function readNumber(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = readOption(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = readOption(env, name);
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

export function normalizeLanguage(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const v = lang.trim();
  if (v === "" || v.toLowerCase() === "auto") return undefined;
  return v;
}

export function loadConfig(env: Env = process.env, home = os.homedir()): Config {
  const port = Math.round(readNumber(env, "port", 3900, 1, 65535));
  const explicitUrl = readOption(env, "url");
  const baseUrl = (explicitUrl ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  const outputDir = expandHome(
    readOption(env, "output_dir") ?? path.join(home, "Music", "VoiceStudio"),
    home,
  );
  return {
    baseUrl,
    language: readOption(env, "language") ?? "lv",
    voice: readOption(env, "voice") ?? "",
    speed: readNumber(env, "speed", 1.1, 0.25, 4),
    steps: Math.round(readNumber(env, "steps", 24, 1, 128)),
    outputDir: path.resolve(outputDir),
    autoLaunch: readBool(env, "auto_launch", true),
    model: readOption(env, "model") ?? "tts-1",
    appName: readOption(env, "app_name") ?? "VoiceStudio",
  };
}
