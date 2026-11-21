"""
Regenerates the Urdu prompt library (public/voice/ur) from scripts/voice/prompts.json with Microsoft's
neural Urdu voice via edge-tts (no API key). Writes one MP3 per prompt and a fresh manifest.json.

    pip install edge-tts
    python scripts/voice/generate-edge.py                 # default voice ur-PK-UzmaNeural
    python scripts/voice/generate-edge.py --voice ur-PK-AsadNeural --rate -5%

edge-tts is an unofficial client for the Edge read-aloud service; the clips are synthetic speech, no human voice.
"""
import argparse
import asyncio
import json
import os
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS = os.path.join(ROOT, "scripts", "voice", "prompts.json")
OUT = os.path.join(ROOT, "public", "voice", "ur")


async def synth(p, voice, rate, sem, retries=3):
    path = os.path.join(OUT, f"{p['key']}.mp3")
    async with sem:
        for attempt in range(retries):
            try:
                await edge_tts.Communicate(p["text_ur"], voice, rate=rate).save(path)
                if os.path.getsize(path) > 0:
                    return path
            except Exception as e:  # network hiccup: retry, then fail loudly
                if attempt == retries - 1:
                    raise RuntimeError(f"{p['key']}: {e}") from e
            await asyncio.sleep(1 + attempt)
    raise RuntimeError(f"{p['key']}: empty audio")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ur-PK-UzmaNeural")
    ap.add_argument("--rate", default="-8%", help="slightly slower than default: easier to follow for first-time users")
    ap.add_argument("--concurrency", type=int, default=6)
    a = ap.parse_args()

    with open(PROMPTS, encoding="utf8") as f:
        prompts = json.load(f)["prompts"]
    os.makedirs(OUT, exist_ok=True)
    sem = asyncio.Semaphore(a.concurrency)
    await asyncio.gather(*(synth(p, a.voice, a.rate, sem) for p in prompts))

    clips = []
    for p in prompts:
        file = f"/voice/ur/{p['key']}.mp3"
        clips.append({
            "key": p["key"], "file": file, "text_ur": p["text_ur"], "text_roman": p.get("text_roman", ""),
            "placeholder": False, "precache": bool(p.get("precache")),
            "bytes": os.path.getsize(os.path.join(OUT, f"{p['key']}.mp3")), "model": f"edge-tts/{a.voice}",
        })
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf8") as f:
        json.dump({"version": f"prompts-v2-edge-{a.voice}", "clips": clips}, f, ensure_ascii=False, indent=2)
    total = sum(c["bytes"] for c in clips)
    sys.stdout.write(f"{len(clips)} clips with {a.voice}, {total / 1024:.0f} KB\n")


if __name__ == "__main__":
    asyncio.run(main())
