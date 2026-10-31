# Current desktop demonstration

The October 31, 2026 walkthrough shows the current light desktop workbench: product intake, source-backed account matching, native Kuzu paths, saved message briefs, exact-version human review, and synchronized pipeline/ownership/credit records.

**Artifact:** `gtm-current-heart.mp4`, 2:54, 1920 × 1080, H.264/AAC, with local Kokoro **Heart (`af_heart`)** narration and 40 burned-in English caption cues. A separate SRT and script accompany the local video. Public upload is awaiting the owner’s confirmation of the terms shown in YouTube’s submission dialog. The [earlier public video](https://youtu.be/lXMJIpLYfAc) is preserved but shows the older interface.

This is an **edited walkthrough of actual UI captures**, with explanatory title cards and captions, rather than an uninterrupted screen recording. Application source: [`05a95ec`](https://github.com/yuansshi/gtm_hackthon/commit/05a95ec305dc92bc0fe785b8e52cdef9b12547cf). Capture order and narrative timing are in [capture-schedule.json](capture-schedule.json) and [scenes.json](scenes.json). [The render manifest](render-manifest.json) records chapters, input-image hashes and the local MP4 checksum.

## What was exercised

All actions ran in a dedicated SQLite/Kuzu workspace, separate from the main campaigns. The six external provider adapters received an empty environment and a denying transport. No `.env` file, global credentials, hosted TTS, real Band post or external outreach was used.

- Review six locally extracted intake suggestions, adjust a target title, inspect unconfirmed capabilities, and approve Allco’s US OEM profile.
- Run real bounded public-source retrieval for four curated account hypotheses. Elliott’s three pages were reachable; two Link-Belt pages failed the size bound. Failures are retained. Reachability does not validate source interpretation, current employment, buying intent or authority.
- Inspect Elliott’s application/evidence and shortlist it. Execute a native graph query and inspect the published person → company → possible product path. Published leadership and public company email remain unverified buyer identity.
- Prepare an engineering-collaboration template with an engineering audience, technical tone, 180-word budget and technical-review CTA. No model generated this draft.
- Acknowledge/approve version 1, edit the subject, observe approval clearing, acknowledge/approve version 2 and record one dry run. The local receipt is `58b24ca9-1d26-43f4-b511-1ccdd594188f`.
- Inspect Contacted with the dry-run actor/time, assign a demonstration owner/next action, inspect Board/List/Analytics and reload. No reply, RFQ or provider acceptance is invented.
- Inspect 96 local credits: discovery −2, graph −1, dry run −1. Huasheng remains unapproved with zero accounts and 100 credits.

[Recording evidence](recording-evidence.json) contains the scoped assertions and source-check results. The main workspaces were checked separately and retain Allco’s four accounts/166 credits and Huasheng’s zero accounts/100 credits. Runtime databases, full snapshots, model weights, virtual environments and media binaries are excluded from this source publication.

Live model/search/enrichment/Band/Flexprice/email verification, public hosting and real Snyk scans remain outstanding. Local templates, deterministic role labels and demo metering do not establish provider integration bonuses, deliverability, customer validation or actual charges.

## Reproduce

From the repository root, install the normal Node dependencies and build the application. Start a **new empty dedicated directory**; never point this command at application data:

```sh
npm ci
npm run build
node scripts/demo/recording-server.mjs /absolute/path/to/new-demo-workspace 3022
```

Open `http://localhost:3022/#overview` and perform the workflow through the UI. The helper refuses application data, its ancestors/descendants, symlink aliases and unrelated populated directories. Only a directory carrying its dedicated recording marker may be resumed. Provider settings stay disabled even if the parent shell has live credentials. Public company source retrieval is still real network activity; no repeating background scheduler runs. Stop with Ctrl-C after jobs complete so native stores close cleanly.

Save screenshots under a separate media work directory’s `frames/`, named as in the schedule. Copy this directory’s `scenes.json` and `capture-schedule.json` into that media work directory. Keep the default browser viewport; the renderer fits captured screenshots into a 1080p presentation without changing UI content. The schedule intentionally edits together inspected states and compresses waits. Current labels/timestamps/source reachability can differ on a later run.

Use a separate Python environment with `kokoro-onnx`, `onnxruntime`, `numpy`, `soundfile` and `Pillow`, plus FFmpeg on PATH. Supply locally obtained Kokoro `kokoro-v1.0.onnx` and `voices-v1.0.bin` assets; the scripts do not download models. The verified local versions were 0.6.1, 1.31.1, 2.5.4, 0.14.0 and 13.0.0 respectively. These are media-authoring dependencies, not application runtime requirements.

```sh
python scripts/demo/synthesize-walkthrough.py --work-dir /absolute/media-work --model-dir /absolute/kokoro-assets
python scripts/demo/render-walkthrough.py --work-dir /absolute/media-work --output-dir /absolute/output --source-commit COMMIT_SHA
```

The renderer writes the MP4, SRT and plain-text narration to the output directory and a manifest/previews to the media work directory. Verify 120–180 seconds with `ffprobe`, decode the full output with FFmpeg, check caption timing/legibility and listen to the narration before publication. Fonts use macOS Arial or Linux DejaVu Sans. Real account facts, claims and recipients still require human review; this recording does not authorize real outreach.
