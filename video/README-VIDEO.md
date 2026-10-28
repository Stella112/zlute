# Lute demo video

`out/final-video.mp4`: 1:59, 1920×1080, H.264, 30 fps, AAC audio. The mp4 is not committed. It is uploaded separately for the submission.

| File | What it is |
|---|---|
| [storyboard.md](storyboard.md) | Scene by scene: time, picture, voice |
| [narration.md](narration.md) | Voiceover script with clip timings |
| [evidence-map.md](evidence-map.md) | Every shot mapped to its proof (mainnet, regtest, live screen, diagram, tests) |
| [subtitles.srt](subtitles.srt) | Subtitles (also burned in) |

## What is real

- Every product screen is a screenshot of uselute.xyz taken on 28 Oct 2026, in the owner's signed-in mainnet account (`capture-app.mjs`) or on public pages (`capture-public.mjs`).
- The agent terminal replays the transcript of a real MCP run on mainnet on 28 Oct 13:46 UTC. That run produced tx `ac68ee91…a6d5` (mined 3533628) and the DENY at 13:49:33 UTC.
- Diagrams are labelled DIAGRAM. Regtest-only features are labelled REGTEST.

## Rebuild

Requirements: Node 20+ and Python with `edge-tts` 7.3.1.

```bash
npm install
npm install --no-save typescript@5.6.3 playwright-core@1.56.1
```

Voice (sentence by sentence, `en-US-AndrewMultilingualNeural`, writes `public/audio/voice.wav`, `src/captions.json`, `subtitles.srt`):

```bash
python vo.py
```

Picture (muted), then sound (voice + ducked music) and mux:

```bash
npx remotion render src/index.ts LuteDemo out/video-muted.mp4 --muted --codec=h264 --crf=20
bash mix.sh out/video-muted.mp4 out/final-video.mp4
```

On Windows, pass `--browser-executable` with a Chromium headless shell path. Keep this folder free of a `tsconfig.json`: the repo root's TypeScript version breaks Remotion's bundler.

Original music: an ambient pad generated with ffmpeg `aevalsrc`. No third-party music or footage is used.
