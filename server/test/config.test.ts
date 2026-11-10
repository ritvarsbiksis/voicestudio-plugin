import { describe, expect, it } from "vitest";
import { expandHome, loadConfig, normalizeLanguage, readOption } from "../src/config.js";

describe("config", () => {
  it("uses defaults when nothing is set", () => {
    const c = loadConfig({}, "/Users/me");
    expect(c).toMatchObject({
      baseUrl: "http://127.0.0.1:3900",
      language: "lv",
      voice: "",
      speed: 1.1,
      steps: 24,
      outputDir: "/Users/me/Music/VoiceStudio",
      autoLaunch: true,
      model: "tts-1",
    });
  });

  it("treats unsubstituted ${user_config.x} placeholders and blanks as unset", () => {
    const c = loadConfig(
      { VOICESTUDIO_PLUGIN_PORT: "${user_config.port}", VOICESTUDIO_PLUGIN_LANGUAGE: "  ", VOICESTUDIO_PLUGIN_OUTPUT_DIR: "" },
      "/h",
    );
    expect(c.baseUrl).toBe("http://127.0.0.1:3900");
    expect(c.language).toBe("lv");
    expect(c.outputDir).toBe("/h/Music/VoiceStudio");
  });

  it("reads plugin env, falls back to CLAUDE_PLUGIN_OPTION_*, clamps numbers", () => {
    const c = loadConfig(
      {
        VOICESTUDIO_PLUGIN_PORT: "4000",
        CLAUDE_PLUGIN_OPTION_LANGUAGE: "en",
        VOICESTUDIO_PLUGIN_SPEED: "9",
        VOICESTUDIO_PLUGIN_AUTO_LAUNCH: "false",
        VOICESTUDIO_PLUGIN_OUTPUT_DIR: "~/Audio",
      },
      "/h",
    );
    expect(c.baseUrl).toBe("http://127.0.0.1:4000");
    expect(c.language).toBe("en");
    expect(c.speed).toBe(4);
    expect(c.autoLaunch).toBe(false);
    expect(c.outputDir).toBe("/h/Audio");
  });

  it("prefers an explicit URL and strips trailing slashes", () => {
    expect(loadConfig({ VOICESTUDIO_PLUGIN_URL: "https://gpu-box/vs/" }).baseUrl).toBe("https://gpu-box/vs");
  });

  it("helpers", () => {
    expect(readOption({ CLAUDE_PLUGIN_OPTION_voice: "Narrator" }, "voice")).toBe("Narrator");
    expect(expandHome("~/x", "/h")).toBe("/h/x");
    expect(expandHome("/abs", "/h")).toBe("/abs");
    expect(normalizeLanguage("Auto")).toBeUndefined();
    expect(normalizeLanguage(" lv ")).toBe("lv");
  });
});
