#!/usr/bin/env python3
"""Generate the judge voice clips (client/public/audio/*.mp3) and their durations
(shared/audio-durations.json) from the line catalogue in shared/audio.ts.

Usage:
  python3 -m venv scripts/.venv && scripts/.venv/bin/pip install edge-tts
  scripts/.venv/bin/python scripts/gen_audio.py [--voice zh-CN-YunyangNeural] [--force]

Needs node (to read shared/audio.ts) and ffmpeg/ffprobe (trim + loudness).
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'client', 'public', 'audio')
DURATIONS = os.path.join(ROOT, 'shared', 'audio-durations.json')


def clip_texts() -> dict:
    js = "import('./shared/audio.ts').then(m => process.stdout.write(JSON.stringify(m.allClips())))"
    out = subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=ROOT)
    return json.loads(out)


def duration(path: str) -> float:
    out = subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
    ])
    return round(float(out.strip()), 3)


async def synth(text: str, voice: str, rate: str, dst: str) -> None:
    import edge_tts  # noqa: imported lazily so --help works without it

    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'raw.mp3')
        await edge_tts.Communicate(text, voice, rate=rate).save(raw)
        # trim silence at both ends, normalise loudness, mono 24 kHz
        af = (
            'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,'
            'areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,'
            'loudnorm=I=-16:TP=-1.5:LRA=11'
        )
        subprocess.check_call([
            'ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', af, '-ac', '1', '-ar', '24000',
            '-b:a', '64k', dst,
        ])


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='zh-CN-YunyangNeural')
    ap.add_argument('--rate', default='-6%')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    clips = clip_texts()
    durations = {}
    if os.path.exists(DURATIONS) and not args.force:
        with open(DURATIONS) as f:
            durations = json.load(f)
    for i, (cid, text) in enumerate(sorted(clips.items())):
        dst = os.path.join(OUT, f'{cid}.mp3')
        if args.force or not os.path.exists(dst):
            for attempt in range(4):
                try:
                    await synth(text, args.voice, args.rate, dst)
                    break
                except Exception as e:  # network hiccups
                    print(f'  retry {cid}: {e}', file=sys.stderr)
                    await asyncio.sleep(2 + attempt * 2)
            else:
                raise SystemExit(f'failed: {cid}')
        durations[cid] = duration(dst)
        print(f'[{i + 1}/{len(clips)}] {cid} {durations[cid]}s  {text}')
    # drop clips that no longer exist in the catalogue
    for name in os.listdir(OUT):
        if name.endswith('.mp3') and name[:-4] not in clips:
            os.remove(os.path.join(OUT, name))
    durations = {k: v for k, v in sorted(durations.items()) if k in clips}
    with open(DURATIONS, 'w') as f:
        json.dump(durations, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'wrote {len(durations)} clips')


if __name__ == '__main__':
    asyncio.run(main())
