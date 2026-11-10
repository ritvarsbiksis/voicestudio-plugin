#!/usr/bin/env bash
# vsay — speak text through the local VoiceStudio app (macOS fallback for the voicestudio MCP tools).
# Adapted from LFTPadilla/agent-dev-kit (MIT): afplay instead of pw-play, voices by name, lv default.
set -euo pipefail

PORT="${VOICESTUDIO_PORT:-${OMNIVOICE_PORT:-3900}}"
BASE="http://127.0.0.1:${PORT}"
MODEL="${VOICE_MODEL:-tts-1}"
VOICE="${VOICE_NAME:-}"
SPEED="${VOICE_SPEED:-1.1}"
LANG_CODE="${VOICE_LANG:-lv}"
INSTRUCT="${VOICE_INSTRUCT:-}"
NUM_STEPS="${VOICE_STEPS:-24}"
CFG_SCALE="${VOICE_CFG:-}"
PIDFILE="${TMPDIR:-/tmp}/vsay-player.pid"

die() { echo "vsay: $*" >&2; exit 1; }

play_cmd() {
  if command -v afplay >/dev/null 2>&1; then echo afplay
  elif command -v pw-play >/dev/null 2>&1; then echo pw-play
  elif command -v paplay >/dev/null 2>&1; then echo paplay
  elif command -v aplay >/dev/null 2>&1; then echo aplay
  else return 1
  fi
}

require() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
require curl
require jq

check_health() {
  local status
  status="$(curl -s --max-time 3 "$BASE/health" | jq -r '.status // empty' 2>/dev/null || true)"
  if [[ "$status" != "ok" ]]; then
    if [[ "$status" == "starting" ]]; then
      die "VoiceStudio is still starting on $BASE; try again in a moment."
    fi
    die "VoiceStudio is not responding on $BASE. Open the VoiceStudio app (open -a VoiceStudio)."
  fi
}

case "${1:-}" in
  -L|--list)
    check_health
    echo "Voices in VoiceStudio:"
    curl -s "$BASE/profiles" | jq -r '.[] | "  - \(.name) [id: \(.id)]\(if .language then " (\(.language))" else "" end)"'
    exit 0 ;;
  --stop)
    if [[ -f "$PIDFILE" ]]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    pkill -f "afplay ${TMPDIR:-/tmp}.*voicestudio-" 2>/dev/null || true
    exit 0 ;;
  -h|--help)
    sed -n '2,3p' "$0"
    echo "usage: vsay [-b] [-v voice] [-s speed] [-N steps] [--cfg g] [-l lang] [-i instruct] [-o out.wav] [--no-play] [-t] text"
    echo "       vsay -L | --stop"
    exit 0 ;;
esac

OUTPUT_FILE=""
PLAY_BG=false
NO_PLAY=false
SHOW_TIME=false
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model) MODEL="$2"; shift 2 ;;
    -v|--voice) VOICE="$2"; shift 2 ;;
    -s|--speed) SPEED="$2"; shift 2 ;;
    -l|--lang) LANG_CODE="$2"; shift 2 ;;
    -i|--instruct) INSTRUCT="$2"; shift 2 ;;
    -o|--output) OUTPUT_FILE="$2"; shift 2 ;;
    -b|--bg|--async) PLAY_BG=true; shift ;;
    --no-play) NO_PLAY=true; shift ;;
    -t|--time) SHOW_TIME=true; shift ;;
    -N|--steps) NUM_STEPS="$2"; shift 2 ;;
    --cfg) CFG_SCALE="$2"; shift 2 ;;
    --) shift; POSITIONAL+=("$@"); break ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
  TEXT="${POSITIONAL[*]}"
else
  TEXT="$(cat)"
fi
[[ -z "${TEXT// /}" ]] && exit 0
[[ ${#TEXT} -le 4096 ]] || die "text is longer than 4096 characters; split it or use the generate_speech MCP tool."

check_health

# Resolve a voice name (case-insensitive), exact id or unique id prefix to a profile id.
VOICE_ID="default"
if [[ -n "$VOICE" && "$(printf '%s' "$VOICE" | tr '[:upper:]' '[:lower:]')" != "default" ]]; then
  VOICE_ID="$(curl -s "$BASE/profiles" | jq -r --arg v "$VOICE" '
    ($v | ascii_downcase) as $lv
    | (map(select(.id == $v)) + map(select((.name // "" | ascii_downcase) == $lv))) as $hit
    | if ($hit | length) > 0 then $hit[0].id
      else (map(select(.id | ascii_downcase | startswith($lv)))) as $pre
        | if ($pre | length) == 1 then $pre[0].id else empty end
      end')"
  [[ -n "$VOICE_ID" ]] || die "no voice matches '$VOICE' (see vsay -L)"
fi

[[ "$(printf '%s' "$LANG_CODE" | tr '[:upper:]' '[:lower:]')" == "auto" ]] && LANG_CODE=""

TMP_AUDIO="$(mktemp "${TMPDIR:-/tmp}/voicestudio-XXXXXX")"
mv "$TMP_AUDIO" "$TMP_AUDIO.wav"
TMP_AUDIO="$TMP_AUDIO.wav"
trap 'rm -f "$TMP_AUDIO"' EXIT

PAYLOAD="$(jq -n \
  --arg model "$MODEL" --arg voice "$VOICE_ID" --arg text "$TEXT" --arg lang "$LANG_CODE" \
  --arg instruct "$INSTRUCT" --arg steps "$NUM_STEPS" --arg cfg "$CFG_SCALE" --argjson speed "$SPEED" \
  '{model: $model, voice: $voice, input: $text, speed: $speed, response_format: "wav"}
   + (if $lang != "" then {language: $lang} else {} end)
   + (if $instruct != "" then {instruct: $instruct} else {} end)
   + (if $steps != "" then {num_step: ($steps | tonumber)} else {} end)
   + (if $cfg != "" then {guidance_scale: ($cfg | tonumber)} else {} end)')"

CURL_OUT="$(curl -s --connect-timeout "${VOICE_CONNECT_TIMEOUT:-10}" --max-time "${VOICE_SYNTHESIS_TIMEOUT:-600}" \
  -w "%{http_code}:%{time_total}" -X POST "$BASE/v1/audio/speech" \
  -H "Content-Type: application/json" -d "$PAYLOAD" --output "$TMP_AUDIO")" || die "request to VoiceStudio failed"

HTTP_CODE="${CURL_OUT%%:*}"
TIME_TOTAL="${CURL_OUT##*:}"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "vsay: VoiceStudio returned HTTP $HTTP_CODE" >&2
  cat "$TMP_AUDIO" >&2
  echo >&2
  exit 1
fi

[[ "$SHOW_TIME" == true ]] && echo "synthesis time: ${TIME_TOTAL}s"
[[ -n "$OUTPUT_FILE" ]] && cp "$TMP_AUDIO" "$OUTPUT_FILE"
[[ "$NO_PLAY" == true ]] && exit 0

PLAYER="$(play_cmd)" || die "no audio player found (afplay, pw-play, paplay or aplay)"
if [[ "$PLAY_BG" == true ]]; then
  trap - EXIT
  nohup bash -c "\"$PLAYER\" \"$TMP_AUDIO\" >/dev/null 2>&1; rm -f \"$TMP_AUDIO\" \"$PIDFILE\"" >/dev/null 2>&1 &
  echo $! >"$PIDFILE"
else
  "$PLAYER" "$TMP_AUDIO"
fi
