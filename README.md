# VoiceStudio plugin for Claude Code

Let Claude **speak**, create **voiceovers**, **transcribe** recordings and **clone voices** through
the local [VoiceStudio](https://github.com/debpalash/VoiceStudio) app. Everything runs on your own
computer.

- **`voicestudio` MCP server** — plays speech on your Mac (`afplay`), saves audio files and returns
  their paths (no base64 audio in the conversation), starts VoiceStudio in the background when
  needed.
- **`voice-studio` skill** — when to speak and how: short spoken replies, expressive tokens
  (`[laughter]`, `[sigh]`, `[breathing]` …), pacing rules, quality settings and a `vsay` shell
  fallback.

## Requirements

- [VoiceStudio](https://voicestudio.sh) desktop app (0.5.x) with a speech model installed
  (OmniVoice is the default).
- Node.js 18 or newer (nvm, Homebrew, Volta and the usual folders are found automatically).
- macOS for playback and auto-start; on Linux, playback uses `pw-play`, `paplay`, `aplay` or `ffplay`
  and VoiceStudio must be started by hand.

## Install

```text
/plugin marketplace add ritvarsbiksis/voicestudio-plugin
/plugin install voicestudio-plugin@voicestudio
```

From a local checkout: `/plugin marketplace add /path/to/voicestudio-mcp`.

## Settings

Set them when you enable the plugin (or later under `/plugin` → VoiceStudio → configure).

| Setting | Default | |
|---|---|---|
| VoiceStudio port | `3900` | Backend port of the app |
| Speech language | `lv` | ISO code (`lv`, `en`, `de` …) or `Auto` |
| Default voice | VoiceStudio default | Voice profile name or ID |
| Speech speed | `1.1` | 0.25–4.0 |
| Diffusion steps | `24` | 16 fast · 24 balanced · 32 studio |
| Output folder | `~/Music/VoiceStudio` | Where `generate_speech` saves files |
| Start VoiceStudio automatically | on | `open -g -a VoiceStudio` when the backend is down |

## Tools

| Tool | What it does |
|---|---|
| `speak` | Synthesizes and plays text; background by default, calls queue in order (`wait`, `interrupt`) |
| `generate_speech` | Saves WAV/MP3/FLAC; long text is split by sentence and joined (WAV) |
| `stop_speaking` | Stops playback and clears the queue |
| `list_voices` | Voice profiles (name, id, kind, language) |
| `transcribe` | Audio file → text with VoiceStudio's local speech recognition |
| `clone_voice` | New voice profile from a 5–30 s recording (only with the speaker's permission) |
| `voicestudio_status` | Health, device and current defaults; starts the app if needed |

Try: *“Pasaki skaļi, ka būve ir gatava”*, *“Izveido 30 sekunžu ievadu podkāstam un saglabā kā
intro.wav”*, *“Transkribē ~/Desktop/sapulce.m4a”*.

## Troubleshooting

- **“backend is not answering”** while the VoiceStudio window is open: the app's speech engine has
  stopped. Quit VoiceStudio completely (Cmd+Q) and open it again.
- **“still starting”**: VoiceStudio is installing its runtime or a model; follow the prompts in
  the window.
- **HTTP 4xx about a model**: install it in VoiceStudio → Models.
- Check by hand: `curl -s http://127.0.0.1:3900/health` should return `"status": "ok"`.

## Development

```bash
cd server
npm install
npm test          # unit tests (vitest)
npm run typecheck
npm run build     # → ../dist/server.js and ../dist/THIRD_PARTY_LICENSES.txt
```

`dist/` is committed so the installed plugin runs without `npm install`; rebuild it after changing
`server/src`. Try the plugin without installing: `claude --plugin-dir .`.

---

## Latviski īsumā

Plugin ļauj Claude runāt latviski (un 645 citās valodās) caur lokālo VoiceStudio lietotni:
`speak` atskaņo runu uzreiz, `generate_speech` saglabā audio failu, `transcribe` pārvērš ierakstu
tekstā, `clone_voice` izveido balsi no ieraksta (tikai ar balss īpašnieka atļauju). Noklusējuma
valoda ir latviešu (`lv`); to un citus iestatījumus var mainīt plugin konfigurācijā. Ja VoiceStudio
logs ir atvērts, bet rīki saka, ka backends neatbild — pilnībā aizver lietotni (Cmd+Q) un atver
no jauna.

## License

MIT — see [LICENSE](LICENSE). The skill is adapted from LFTPadilla/agent-dev-kit (MIT); VoiceStudio
itself (AGPL-3.0) is not bundled. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
