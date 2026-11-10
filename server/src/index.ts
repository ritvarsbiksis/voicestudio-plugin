import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VoiceStudioClient } from "./client.js";
import { loadConfig } from "./config.js";
import { Player } from "./player.js";
import { registerTools } from "./tools.js";

const VERSION = "0.1.0";

async function main() {
  const config = loadConfig();
  const server = new McpServer(
    { name: "voicestudio", version: VERSION },
    {
      instructions:
        "Local speech through the VoiceStudio app. speak plays text aloud on this computer; generate_speech saves an audio file and returns its path; list_voices shows voice profiles; transcribe turns an audio file into text; clone_voice creates a voice from a recording (only with the speaker's permission). The app starts automatically when needed. Default language: " +
        config.language +
        ".",
    },
  );
  const player = new Player();
  registerTools(server, new VoiceStudioClient(config), player);

  const shutdown = () => {
    player.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`voicestudio MCP server ${VERSION} ready (backend ${config.baseUrl}, language ${config.language})`);
}

main().catch((err) => {
  console.error(`voicestudio MCP server failed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
