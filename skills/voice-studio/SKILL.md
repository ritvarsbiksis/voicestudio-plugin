---
name: voice-studio
description: Use when the user asks Claude to speak, talk, read something aloud or answer by voice; to generate speech, a voiceover, narration or an audio file from text; to transcribe an audio recording; to list or pick VoiceStudio voices; or to clone a voice from a recording. Works through the local VoiceStudio app (text-to-speech in 646 languages, Latvian by default) via the voicestudio MCP tools, with a vsay shell fallback.
---

# VoiceStudio

Speak to the user and produce audio with the local VoiceStudio app. Everything runs on this
computer: no audio leaves the machine.

## Tools (voicestudio MCP server)

| Need | Tool |
|---|---|
| Say something out loud now | `speak` |
| Save speech as a file (voiceover, narration, sample) | `generate_speech` → returns the path |
| Stop talking | `stop_speaking` |
| See or pick voices | `list_voices` |
| Audio file → text | `transcribe` |
| New voice from a recording | `clone_voice` |
| Is VoiceStudio up? What are the defaults? | `voicestudio_status` |

The server starts VoiceStudio in the background when it is not running, so just call the tool.
The first request after a start can take a minute while the model loads.

Defaults come from the plugin settings: language `lv`, speed `1.1`, 24 steps, VoiceStudio's
default voice, files saved to `~/Music/VoiceStudio`. Override per call only when the user asks
(another language, voice, speed, quality) or the text clearly needs it — for example pass
`language: "en"` for English text, or `"Auto"` for mixed-language text.

## How to speak well

- Keep spoken replies short: one to three sentences. Put details, code and lists in the written
  answer, not in the audio.
- Speak in the background (the default) so work continues; queued calls play in order. Use
  `wait: true` only when the next step depends on the audio having finished, and
  `interrupt: true` when a new message should cut off the old one.
- Write for the ear: spell out symbols and abbreviations (“procenti”, not “%”), say numbers the
  way they are read, leave out URLs, file paths and code.
- Long text is split at sentence boundaries automatically; for a long `generate_speech` keep the
  default WAV format so the parts can be joined.

## Expressive tokens and prosody

Embed bracketed tokens in the text for vocal inflections (OmniVoice engine):

- **Reactions:** `[laughter]`, `[surprise-wa]`, `[surprise-ah]`, `[sigh]`, `[crying]`
- **Hesitations and feedback:** `[uhm]`, `[confirmation-en]`, `[dissatisfaction-hnn]`, `[shh]`, `[cough]`
- **Questions:** `[question-en]`, `[question-ah]`, `[question-oh]`, `[question-ei]`, `[question-yi]`
- **Breath:** `[breathing]`

Pacing rules:

1. Combine `...` and `[breathing]` between clauses for natural breathing pauses.
2. Use punctuation (`!`, `?`, `¡`, `¿`) to shape expressive pitch contours.
3. Place commas before conjunctions to induce realistic pitch dips.
4. Use tokens sparingly — one or two per sentence at most — or the speech sounds staged.

Example: `[surprise-wa] Lieliski! Testi izgāja... [breathing] un būve ir gatava. [laughter]`

`instruct` adds a style instruction (`"whisper"`, `"excited"`, `"calm narrator"`).

## Quality and speed

- `steps`: `16` fast drafts, `24` balanced (default), `32` studio quality for final voiceovers.
- `guidance_scale`: app default `2.0`; raise slightly for a closer match to the voice, lower for
  more natural variation.
- `speed`: `0.9`–`1.0` for narration and audiobooks, `1.1` for conversational replies.

## Voices and cloning

- `list_voices` shows saved profiles; pass a profile **name or id** as `voice`.
- `clone_voice` needs a clean 5–30 second recording of one speaker, ideally with its exact
  `transcript`. **Clone a voice only with the owner's clear permission** — ask the user to
  confirm if it is not their own voice.

## Fallback: vsay (shell)

If the MCP tools are unavailable, use the bundled script (needs `curl`, `jq`; macOS `afplay`):

```bash
VSAY="${CLAUDE_PLUGIN_ROOT}/skills/voice-studio/scripts/vsay.sh"
"$VSAY" -b "Uzdevums pabeigts."                    # speak in background (default lv, 1.1x, 24 steps)
"$VSAY" -v Narrator -l en -s 1.0 "Chapter one."    # voice by name, English, normal speed
"$VSAY" -N 32 --no-play -o ~/Music/intro.wav "…"   # studio quality, save only
"$VSAY" -L                                         # list voices
"$VSAY" --stop                                     # stop playback
```

Flags: `-b` background · `-v <name|id>` voice · `-s <float>` speed · `-N <int>` steps ·
`--cfg <float>` guidance · `-l <code|Auto>` language · `-i <text>` style instruction ·
`-o <path>` save WAV · `--no-play` · `-L` list · `--stop` · `-t` show synthesis time.
Environment: `VOICESTUDIO_PORT` (default 3900), `VOICE_NAME`, `VOICE_LANG`, `VOICE_SPEED`,
`VOICE_STEPS`.

## Troubleshooting

- `voicestudio_status` (or `curl -s http://127.0.0.1:3900/health`) should report
  `"status": "ok"` and a device (`mps` on Apple Silicon).
- “did not become ready”: open the VoiceStudio window — it may be installing its runtime or asking
  to download a model.
- HTTP 4xx naming a model: install the speech model in VoiceStudio → Models.
- Wrong language or accent: pass `language` explicitly instead of relying on `Auto`.

Adapted from the `voice-studio` skill in
[LFTPadilla/agent-dev-kit](https://github.com/LFTPadilla/agent-dev-kit) (MIT); see
THIRD_PARTY_NOTICES.md.
