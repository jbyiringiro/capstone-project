# Amajwi y'Ikinyarwanda / Kinyarwanda audio

These synthetic word clips pronounce the exact `label_rw` values in
`vocab/symbols.csv`. They were generated locally using Meta AI's
[MMS Kinyarwanda text-to-speech model](https://huggingface.co/facebook/mms-tts-kin),
at pinned revision `71d00a03419b9bfd203a6bfa4d6bc565cbe3c4e0`.
The model's language is `kin`; the app uses `rw` for Kinyarwanda.

The audio is **synthetic and has not been reviewed by a Kinyarwanda speaker,
caregiver or therapist**. Automated checks verify readable, non-silent PCM and
exact vocabulary coverage; they do not establish pronunciation quality or
communication benefit. Each word is played separately. Joining these clips does
not produce a grammatically corrected sentence.

## Attribution and license

Model: Massively Multilingual Speech (MMS), by Vineel Pratap and colleagues,
Meta AI. [Research paper: Scaling Speech Technology to 1,000+ Languages](https://arxiv.org/abs/2305.13516).
The [official model card](https://huggingface.co/facebook/mms-tts-kin#license)
states that the model is licensed under
[Creative Commons Attribution–NonCommercial 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/).
The official English legal text is included in [LICENSE.txt](LICENSE.txt) for
offline review, with its source URL.
This synthetic audio pack is distributed under CC BY-NC 4.0 as well. Retain this
attribution and the license link when sharing the pack. It is intended for the
noncommercial research prototype; Meta does not endorse this project.

Changes made: generated speech for Vuga's supplied Kinyarwanda vocabulary,
normalized waveform peaks to 85%, and encoded mono 16-bit PCM WAV at 16,000 Hz.
No model weights are bundled with the app. [manifest.json](manifest.json) records
the model revision and weight hash, exact input labels, per-word seeds, file
hashes, durations, signal measurements and dependency versions.

## Regeneration

Run from the repository root using a local Python 3.11 virtual environment.
The first generation downloads the public model; inference runs on the local
CPU. No private recordings or participant information is sent to a service.

```powershell
.\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pip install 'transformers>=4.49,<5' safetensors
.\.venv\Scripts\python.exe scripts/generate_kinyarwanda_audio.py --only WATER
.\.venv\Scripts\python.exe scripts/generate_kinyarwanda_audio.py
.\.venv\Scripts\python.exe scripts/generate_kinyarwanda_audio.py --check
```

The script accepts only the pinned official model, loads safetensors without
remote Python code, and keeps its cache under the ignored `.venv/tts-model-cache`
directory. `--check` uses the Python standard library and needs no model or
network. The shipped files can play offline after the app has cached them.

Caregivers can replace the synthetic voice for individual words with their own
checked recordings in the app; those recordings remain in browser storage.
