#!/usr/bin/env bash
# Final sound: polished voice (vo.py) over the original music, ducked under the voice, then muxed
# with the muted Remotion render. Usage: bash mix.sh out/video-muted.mp4 out/final-video.mp4
set -euo pipefail
cd "$(dirname "$0")"
IN=${1:-out/video-muted.mp4}
OUT=${2:-out/final-video.mp4}
ffmpeg -v error -y -i public/audio/voice.wav -i public/audio/music.mp3 -filter_complex "\
[0:a]aresample=48000,asplit=2[v][key];\
[1:a]aresample=48000,volume=0.5,afade=t=in:d=1.5,afade=t=out:st=116.5:d=2.5[m];\
[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];\
[v][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=9[a]" \
  -map "[a]" -ac 2 -ar 48000 -c:a aac -b:a 192k out/mix.m4a
ffmpeg -v error -y -i "$IN" -i out/mix.m4a -map 0:v -map 1:a -c:v copy -c:a copy -shortest -movflags +faststart "$OUT"
rm -f out/mix.m4a
