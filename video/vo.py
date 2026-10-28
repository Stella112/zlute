"""Voice-over, sentence by sentence (edge-tts, en-US-AndrewMultilingualNeural), with hand-set pauses.

Each line is (text, pause_ms_after, at), where `at` (seconds, or None) pins the line's start to the
picture. Writes public/audio/voice.wav (polished, full timeline) and src/captions.json (one cue per line).
"""
import hashlib, json, os, subprocess, sys

VOICE = "en-US-AndrewMultilingualNeural"
RATE = "-4%"
HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "vo-gen")
TOTAL = 119.0

LINES = [
    ("Zcash makes money private.", 300, 1.0),
    ("Lute makes it programmable.", 0, None),

    ("This is Lute, live on Zcash mainnet.", 250, 5.0),
    ("One private balance, and every payment shielded.", 300, None),
    ("Even the payments my AI agent made, and the one it was refused.", 0, None),

    ("Getting paid is one link.", 200, 15.5),
    ("This one was just paid, and confirmed.", 0, None),

    ("But the real story is agents.", 300, 20.6),
    ("Lute runs as an MCP server.", 250, None),
    ("Any agent, like Claude, gets ten tools to pay for APIs by itself.", 0, None),

    ("Here's a real run, on mainnet.", 250, 30.9),
    ("The agent checks its budget,", 150, None),
    ("opens a metered session with a document API,", 150, None),
    ("and gets a quote that works exactly once.", 300, None),
    ("It extracts an invoice. Reusing the quote fails.", 300, None),
    ("Then it settles, with one shielded payment, from its own wallet.", 300, None),
    ("Nobody clicked approve. The owner signed the rules once.", 0, None),

    ("Then it keeps calling the API.", 200, 52.5),
    ("Every call adds a thousand zatoshi to the meter.", 300, None),
    ("At eleven thousand, it tries to settle.", 300, None),
    ("The limit is ten thousand. Refused.", 250, None),
    ("Before a transaction is even built.", 0, None),

    ("Any business can sell its own API this way:", 150, 65.3),
    ("a price per call, paid privately, over HTTP 402.", 0, None),

    ("Streams pay someone by the second, like a salary.", 250, 73.3),
    ("Earnings grow live.", 250, None),
    ("Money moves only in payouts the owner approves, each one shielded.", 300, None),
    ("This stream paid out on mainnet.", 0, None),

    ("Subscriptions send a fresh shielded invoice every period.", 250, 86.5),
    ("Subscribers pay from their own wallet.", 200, None),
    ("No auto-debit. Lute never pulls funds.", 0, None),

    ("And a whole team gets paid in one transaction, each with a private payslip.", 0, 97.0),

    ("Every claim links to its evidence.", 250, 104.3),
    ("Two hundred seventy-seven passing tests.", 0, None),
    ("Lute.", 350, 110.6),
    ("Programmable privacy, for people, businesses, and AI agents.", 0, None),
]


def dur(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def main():
    os.makedirs(GEN, exist_ok=True)
    clips = []
    for i, (text, pause, at) in enumerate(LINES):
        key = hashlib.sha1(f"{VOICE}|{RATE}|{text}".encode()).hexdigest()[:10]
        mp3 = os.path.join(GEN, f"{key}.mp3")
        txt = os.path.join(GEN, f"{key}.txt")
        wav = os.path.join(GEN, f"{key}.wav")
        with open(txt, "w", encoding="utf8") as f:
            f.write(text)
        if not os.path.exists(mp3) or os.path.getsize(mp3) == 0:
            for attempt in range(4):
                r = subprocess.run([sys.executable, "-m", "edge_tts", "--voice", VOICE, f"--rate={RATE}", "-f", txt, "--write-media", mp3])
                if r.returncode == 0 and os.path.getsize(mp3) > 0:
                    break
            else:
                sys.exit(f"tts failed: {text}")
        # trim edge silence so the hand-set pauses are exact
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-af",
                        "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
                        "-ar", "48000", "-ac", "1", wav], check=True)
        clips.append(wav)

    t = 0.0
    cues, placed = [], []
    for i, (text, pause, at) in enumerate(LINES):
        if at is not None:
            if at < t - 0.05:
                print(f"WARN line {i} pinned at {at} but previous ends {t:.2f}")
            t = max(t, at)
        d = dur(clips[i])
        cues.append({"text": text, "start": round(t, 3), "end": round(t + d, 3)})
        placed.append((clips[i], t))
        t += d + pause / 1000
    print(f"voice ends at {t:.2f}s")

    # one full-length track: each clip delayed to its slot, mixed, then polished
    args = ["ffmpeg", "-v", "error", "-y"]
    for w, _ in placed:
        args += ["-i", w]
    chains = [f"[{k}]adelay={int(st * 1000)}|{int(st * 1000)}[d{k}]" for k, (_, st) in enumerate(placed)]
    mix = "".join(f"[d{k}]" for k in range(len(placed)))
    chains.append(f"{mix}amix=inputs={len(placed)}:normalize=0,apad=whole_dur={TOTAL},"
                  "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,"
                  "loudnorm=I=-16:TP=-1.5:LRA=7,atrim=0:" + str(TOTAL) + "[out]")
    args += ["-filter_complex", ";".join(chains), "-map", "[out]", "-ar", "48000", "-ac", "1",
             os.path.join(HERE, "public", "audio", "voice.wav")]
    subprocess.run(args, check=True)

    # merge short adjacent lines into readable caption cues (max ~70 chars)
    merged = []
    for c in cues:
        if merged and len(merged[-1]["text"]) + len(c["text"]) < 70 and c["start"] - merged[-1]["end"] < 0.6:
            merged[-1] = {"text": merged[-1]["text"] + " " + c["text"], "start": merged[-1]["start"], "end": c["end"]}
        else:
            merged.append(dict(c))
    with open(os.path.join(HERE, "src", "captions.json"), "w", encoding="utf8") as f:
        json.dump({"offsets": {}, "cues": merged}, f, indent=1)

    def ts(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    with open(os.path.join(HERE, "subtitles.srt"), "w", encoding="utf8") as f:
        for n, c in enumerate(merged, 1):
            f.write(f"{n}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n\n")
    print(f"{len(merged)} caption cues")


if __name__ == "__main__":
    main()
