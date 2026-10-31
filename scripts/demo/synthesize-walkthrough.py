"""Synthesize the reviewed walkthrough locally with Kokoro's Heart voice."""
from pathlib import Path
import argparse
import hashlib
import json

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

parser = argparse.ArgumentParser()
parser.add_argument('--work-dir', type=Path, required=True)
parser.add_argument('--model-dir', type=Path, required=True)
args = parser.parse_args()
root = args.work_dir.resolve()
assets = args.model_dir.resolve()
(root / 'audio').mkdir(parents=True, exist_ok=True)
scenes = json.loads((root / 'scenes.json').read_text())
model = Kokoro(str(assets / 'kokoro-v1.0.onnx'), str(assets / 'voices-v1.0.bin'))
assert 'af_heart' in model.get_voices()
for scene in scenes:
    pieces, captions, cursor = [], [], 0.0
    for index, text in enumerate(scene['sentences']):
        digest = hashlib.sha256(text.encode()).hexdigest()[:8]
        target = root / 'audio' / f"{scene['id']}-{index:02d}-{digest}.wav"
        if target.exists():
            samples, sample_rate = sf.read(target, dtype='float32')
        else:
            samples, sample_rate = model.create(text, voice='af_heart', speed=1.0, lang='en-us')
            sf.write(target, samples, sample_rate)
        pause = np.zeros(round(sample_rate * (0.3 if index == 0 else 0.2)), dtype=np.float32)
        pieces.extend([pause, samples])
        cursor += len(pause) / sample_rate
        end = cursor + len(samples) / sample_rate
        captions.append({'start': round(cursor, 3), 'end': round(end, 3), 'text': text})
        cursor = end
    pieces.append(np.zeros(round(sample_rate * 0.5), dtype=np.float32))
    audio = np.concatenate(pieces)
    sf.write(root / 'audio' / f"{scene['id']}.wav", audio, sample_rate)
    scene.update(duration=len(audio) / sample_rate, captions=captions, voice='af_heart')
    print(scene['id'], round(scene['duration'], 2), flush=True)
(root / 'timeline.json').write_text(json.dumps(scenes, indent=2))
print('TOTAL', round(sum(scene['duration'] for scene in scenes), 2), flush=True)
