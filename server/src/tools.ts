import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chunkText, concatWav, MAX_INPUT_CHARS, wavDurationSeconds } from "./audio.js";
import { VoiceStudioClient, VoiceStudioError, type VoiceProfile } from "./client.js";
import { expandHome } from "./config.js";
import { Player } from "./player.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const CHUNK_CHARS = 1500;
const MAX_TEXT_CHARS = 50_000;

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

const round = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 100) / 100);

const speechShape = {
  text: z
    .string()
    .min(1)
    .max(MAX_TEXT_CHARS)
    .describe(
      "Text to speak. Expressive tokens such as [laughter], [sigh], [breathing], [surprise-wa], [question-en] are voiced; '...' adds a pause. Long text is split at sentence boundaries automatically.",
    ),
  voice: z.string().optional().describe("Voice profile name or ID (see list_voices). Omit for the plugin's default voice."),
  language: z
    .string()
    .optional()
    .describe("Language code such as lv, en, de, or 'Auto' to detect. Omit for the plugin default (lv unless changed)."),
  speed: z.number().min(0.25).max(4).optional().describe("Speed multiplier. Omit for the plugin default (1.1)."),
  steps: z.number().int().min(4).max(64).optional().describe("Diffusion steps: 16 fast, 24 balanced, 32 studio quality."),
  guidance_scale: z.number().gt(0).max(20).optional().describe("Classifier-free guidance (app default 2.0)."),
  instruct: z.string().max(500).optional().describe("Style instruction for the engine, e.g. 'whisper', 'excited', 'calm narrator'."),
};

type SpeechArgs = {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  steps?: number;
  guidance_scale?: number;
  instruct?: string;
};

export function registerTools(server: McpServer, client: VoiceStudioClient, player = new Player()): void {
  const cfg = client.config;
  let tmpDir: string | undefined;

  const tempFile = async (i: number) => {
    tmpDir ??= await mkdtemp(path.join(os.tmpdir(), "voicestudio-plugin-"));
    return path.join(tmpDir, `speech-${Date.now()}-${i}.wav`);
  };

  /** Synthesizes each chunk in order and hands every finished part to onPart. */
  async function synthesizeChunks(args: SpeechArgs, format: "wav" | "mp3" | "flac", onPart: (buf: Buffer, i: number) => Promise<void>) {
    const chunks = chunkText(args.text, CHUNK_CHARS);
    if (chunks.length === 0) throw new VoiceStudioError("Nothing to say: the text is empty.");
    if (chunks.some((c) => c.length > MAX_INPUT_CHARS)) throw new VoiceStudioError("Text could not be split into chunks VoiceStudio accepts.");
    const voiceId = await client.resolveVoice(args.voice ?? cfg.voice);
    for (let i = 0; i < chunks.length; i++) {
      const buf = await client.synthesize({
        text: chunks[i],
        voiceId,
        language: args.language ?? cfg.language,
        speed: args.speed ?? cfg.speed,
        steps: args.steps ?? cfg.steps,
        guidanceScale: args.guidance_scale,
        instruct: args.instruct,
        format,
      });
      await onPart(buf, i);
    }
    return { chunks: chunks.length, voiceId };
  }

  server.registerTool(
    "speak",
    {
      title: "Speak aloud",
      description:
        "Say text out loud on this computer through VoiceStudio (local TTS). Returns once the audio is synthesized; by default playback continues in the background and further calls queue after it. Use for short spoken replies to the user; use generate_speech to save a file instead.",
      inputSchema: {
        ...speechShape,
        wait: z.boolean().optional().describe("Wait until playback has finished before returning. Default false."),
        interrupt: z.boolean().optional().describe("Stop whatever is playing (and queued) before speaking. Default false: queue after it."),
      },
      annotations: { openWorldHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        if (!player.available) throw new VoiceStudioError("No audio player is available on this system; use generate_speech to save a file.");
        if (args.interrupt) player.stop();
        const playing: Promise<void>[] = [];
        let seconds = 0;
        const { chunks, voiceId } = await synthesizeChunks(args, "wav", async (buf, i) => {
          seconds += wavDurationSeconds(buf) ?? 0;
          const file = await tempFile(i);
          await writeFile(file, buf);
          const p = player.enqueue(file, true);
          p.catch((err: Error) => console.error(`voicestudio: playback failed: ${err.message}`));
          playing.push(p);
        });
        if (args.wait) await Promise.allSettled(playing);
        return ok({
          spoken: true,
          playback: args.wait ? "finished" : "playing in background",
          duration_seconds: round(seconds),
          chunks,
          voice: voiceId ?? "default",
          language: args.language ?? cfg.language,
        });
      }),
  );

  server.registerTool(
    "generate_speech",
    {
      title: "Generate speech file",
      description:
        "Synthesize text with VoiceStudio and save it as an audio file (WAV by default). Returns the file path and duration; the audio itself is not put into the conversation.",
      inputSchema: {
        ...speechShape,
        output_path: z
          .string()
          .optional()
          .describe("Where to save. Absolute, ~/..., or relative to the plugin output folder (~/Music/VoiceStudio by default). Omit for a timestamped name."),
        format: z.enum(["wav", "mp3", "flac"]).optional().describe("Audio format. Default wav, or taken from output_path's extension."),
        play: z.boolean().optional().describe("Also play the file aloud in the background. Default false."),
      },
      annotations: { openWorldHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        const target = resolveOutput(args.output_path, args.format, cfg.outputDir, args.text);
        const parts: Buffer[] = [];
        const { chunks, voiceId } = await synthesizeChunks(args, target.format, async (buf) => {
          parts.push(buf);
        });
        if (parts.length > 1 && target.format !== "wav") {
          throw new VoiceStudioError(`This text needs ${parts.length} parts; joining them is only supported for WAV. Use format "wav" or shorter text.`);
        }
        const audio = target.format === "wav" ? concatWav(parts) : parts[0];
        await mkdir(path.dirname(target.path), { recursive: true });
        await writeFile(target.path, audio);
        if (args.play && player.available) {
          player.enqueue(target.path).catch((err: Error) => console.error(`voicestudio: playback failed: ${err.message}`));
        }
        return ok({
          path: target.path,
          format: target.format,
          bytes: audio.length,
          duration_seconds: round(target.format === "wav" ? wavDurationSeconds(audio) : undefined),
          chunks,
          voice: voiceId ?? "default",
          language: args.language ?? cfg.language,
          playing: Boolean(args.play && player.available),
        });
      }),
  );

  server.registerTool(
    "stop_speaking",
    {
      title: "Stop speaking",
      description: "Stop the audio that speak or generate_speech is playing and clear the playback queue.",
      inputSchema: {},
      annotations: { openWorldHint: false, idempotentHint: true },
    },
    () => guard(async () => ok({ stopped: player.stop() })),
  );

  server.registerTool(
    "list_voices",
    {
      title: "List voices",
      description: "List the voice profiles saved in VoiceStudio (name, id, kind, language). Pass a name or id as `voice` to speak or generate_speech.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guard(async () => {
        const profiles = await client.listProfiles(true);
        return ok({
          default_voice: cfg.voice || "VoiceStudio default",
          voices: profiles.map(summarizeProfile),
        });
      }),
  );

  server.registerTool(
    "transcribe",
    {
      title: "Transcribe audio",
      description: "Transcribe a local audio file (wav, mp3, m4a, flac, ogg, webm) to text with VoiceStudio's local speech recognition.",
      inputSchema: {
        audio_path: z.string().min(1).describe("Absolute or ~/ path to the audio file."),
        language: z.string().optional().describe("Spoken language code if known (e.g. lv, en). Omit to detect."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      guard(async () => {
        const file = path.resolve(expandHome(args.audio_path));
        const result = await client.transcribe(file, args.language);
        return ok({ path: file, ...result, duration: round(result.duration) });
      }),
  );

  server.registerTool(
    "clone_voice",
    {
      title: "Clone a voice",
      description:
        "Create a new VoiceStudio voice profile from a clean reference recording (about 5-30 seconds of one speaker). Only clone a voice with its owner's permission. Returns the new profile's id and name.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Name for the new voice."),
        audio_path: z.string().min(1).describe("Absolute or ~/ path to the reference recording."),
        transcript: z.string().optional().describe("Exact words spoken in the recording. Improves quality; omitted means VoiceStudio transcribes it."),
        language: z.string().optional().describe("Language of the recording (e.g. lv). Omit to detect."),
      },
      annotations: { openWorldHint: false, destructiveHint: false },
    },
    (args) =>
      guard(async () => {
        const file = path.resolve(expandHome(args.audio_path));
        const profile = await client.cloneVoice({ name: args.name, audioPath: file, transcript: args.transcript, language: args.language });
        return ok({ created: true, voice: summarizeProfile(profile) });
      }),
  );

  server.registerTool(
    "voicestudio_status",
    {
      title: "VoiceStudio status",
      description: "Check that VoiceStudio is running and ready (starting it in the background if enabled), and show the plugin's speech defaults.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guard(async () => {
        const health = await client.ensureReady();
        return ok({
          status: health.status ?? health.state,
          device: health.device,
          version: health.version,
          url: cfg.baseUrl,
          audio_player: player.available,
          defaults: {
            language: cfg.language,
            voice: cfg.voice || "VoiceStudio default",
            speed: cfg.speed,
            steps: cfg.steps,
            output_dir: cfg.outputDir,
            auto_launch: cfg.autoLaunch,
          },
        });
      }),
  );
}

function summarizeProfile(p: VoiceProfile) {
  const pick = (k: string) => (typeof p[k] === "string" && p[k] !== "" ? (p[k] as string) : undefined);
  return {
    name: p.name,
    id: p.id,
    kind: pick("kind"),
    language: pick("language"),
    personality: pick("personality"),
    instruct: pick("instruct"),
  };
}

export function resolveOutput(
  outputPath: string | undefined,
  format: "wav" | "mp3" | "flac" | undefined,
  outputDir: string,
  text: string,
  now = new Date(),
): { path: string; format: "wav" | "mp3" | "flac" } {
  if (!outputPath) {
    const fmt = format ?? "wav";
    const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const slug = slugify(text);
    return { path: path.join(outputDir, `voicestudio-${stamp}${slug ? `-${slug}` : ""}.${fmt}`), format: fmt };
  }
  let p = expandHome(outputPath.trim());
  if (!path.isAbsolute(p)) p = path.join(outputDir, p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const extFormat = ext === "wav" || ext === "mp3" || ext === "flac" ? ext : undefined;
  if (extFormat && (!format || format === extFormat)) return { path: path.resolve(p), format: extFormat };
  if (extFormat && format) return { path: path.resolve(`${p.slice(0, -ext.length - 1)}.${format}`), format };
  const fmt = format ?? "wav";
  return { path: path.resolve(`${p}.${fmt}`), format: fmt };
}

function slugify(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}
