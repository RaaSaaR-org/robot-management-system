---
id: TASK-229
aliases:
- TASK-229
title: Make the robot's voice a selectable pack, so a customer can ship their own — starting
  with Saarländisch
slug: voice-packs-so-a-customer-can-ship-their-own-robot-voice
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- voice
- tts
sprint: ''
parent: ""
depends_on: []
spe: 8
effort: ""
due_date: ''
created: 2026-08-29
updated: "2026-09-05"
status_note: 'Written 2026-08-29 from a read of the live voice stack and of the finished
  Saar-TTS project (separate repo `saar-voice-example`, finetune trained and evaluated
  2026-08-29). The Saarländisch voice is the DELIVERABLE but not the POINT: the point is
  that today a "voice" is not a thing this system has — `language` doubles as the voice
  selector and the union is hardcoded `de|en` in six places across three processes. This
  task introduces the missing axis and lands Saarländisch as its first instance, so the
  second instance is a config entry rather than another refactor. Two honest caveats up
  front: the Saar checkpoint is CC-BY-NC-4.0 and therefore NOT shippable to a customer as-is
  (see Licensing), and it is not real-time on CPU (measured RTF 1.95). Both are handled by
  making licence and realtime first-class fields of a pack rather than by pretending.'
---

# Make the robot's voice a selectable pack, so a customer can ship their own — starting with Saarländisch

## Description

The robot has exactly two voices, they are not selectable, and they are not even
modelled as voices: `language` is the selector. `SpokenLanguages = ['en', 'de']`
is mirrored in three type files and its own doc comment admits the conflation —
*"the two the voice service has a Piper voice for"*.

Introduce a **voice pack** axis parallel to language: a declared, licensed,
selectable synthesis identity that the `/say` path, the UI composer and Agent
Mode narration all carry. Ship **Saarländisch** as the first pack — a trained
dialect voice from the `saar-voice-example` project — so that "a company runs its
own robot voice" becomes a config entry and a training job, not a fork.

## Where this stands (2026-08-29)

### There is no voice axis — `language` is doing that job

The TTS seam takes a language and nothing else:

```python
# robot-agent/voice/voice_service/tts/base.py:16
def synthesize(self, text: str, language: str) -> tuple[bytes, int]:
```

and the mapping from language to voice is a literal two-entry dict:

```python
# robot-agent/voice/voice_service/config.py:113-117
def piper_voice_for(self, language: str) -> str:
    mapping = {"de": self.piper_voice_de, "en": self.piper_voice_en}
```

The union is hardcoded in six places across three processes:

| File | Line | What is hardcoded |
|---|---|---|
| `robot-agent/voice/voice_service/config.py` | 18 | `VALID_TTS_ENGINES = ("piper",)` |
| `robot-agent/voice/voice_service/config.py` | 48-50 | `tts_engine`, `piper_voice_de`, `piper_voice_en` |
| `robot-agent/voice/voice_service/__main__.py` | 78-81 | `make_tts()` imports `PiperEngine` directly |
| `server/src/routes/voice.routes.ts` | 108-111 | rejects any language but `'de'`/`'en'` |
| `robot-agent/src/agent-mode/types.ts` | 116-121 | `SpokenLanguages` (mirrored ×3) |
| `app/src/features/robots/components/voice/VoiceComposer.tsx` | 94-102 | a two-option `SegmentedControl`, labels `"Piper Thorsten"` / `"Piper Lessac"` |

The composer's option titles naming the Piper voice models is the tell: the UI is
already trying to talk about voices through a control that only knows languages.

### The cheap route — "just add `saar` as a language" — poisons the input path

`VOICE_LANGUAGES` is not an output setting. It gates **speech recognition**:

```python
# robot-agent/voice/voice_service/stt/faster_whisper_stt.py:81
if detected not in self.config.languages or prob < self.config.language_min_prob:
    detected = self.config.default_language
```

Whisper will never return `saar`, and `config.py:103` requires
`default_language in languages`. So adding `saar` to the language list either
does nothing or forces every utterance to a language the recogniser cannot
produce. **The output axis has to be its own axis.**

### What is already right and must be reused

- **The engine seam exists and was designed for this.** `tts/base.py:3-5` says so:
  *"Keeping this seam allows swapping Piper (GPL, CPU) for e.g. Qwen3-TTS
  (Apache, GPU) with a single config change."* What is missing is the registry
  behind it, not the abstraction.
- **Sample rate is already a non-problem.** `_speak` (`pipeline.py:343-360`) takes
  whatever `(pcm, rate)` the engine returns and `audio/g1_speaker.py:29-33`
  resamples to the robot's 16 kHz. A 22.05 kHz Piper pack and a 24 kHz F5 pack
  both just work.
- **Runtime config patching exists and rolls back atomically** (`config.py:141-170`,
  `RUNTIME_MUTABLE` at :128). Voice selection belongs there — with the caveat below.
- **`tts_normalize()`** (`tts/normalize.py:31`) strips markdown before synthesis and
  *inserts* sentence-final periods at line breaks. That is compatible with what a
  dialect pack needs; it is not a substitute for one (see below).
- **Per-pack latency is already measurable**: `pipeline.py:354` records a `tts`
  metric that surfaces in `GET /status`.

### The Saar voice exists, is trained, and is measured

Separate repo, **not** vendored here: `saar-voice-example`. Public surface is
`speak(text, speaker, speed) -> SaarAudio` plus a Gradio Space
(`huhn511/saar-tts`) with a `/speak_pcm` endpoint that returns **base64 s16le at a
requested sample rate, default 16 000** — i.e. byte-for-byte the contract
`adapters/g1_audio_adapter.py:8,37` already expects. No WAV parsing, no second
roundtrip. A working G1 client already exists there (`clients/g1_saar_speaker.py`).

Finetune result, paired over 20 sentences and 4 speakers, against a baseline
re-run under identical settings:

| Metric | Baseline (DE) | Saar finetune |
|---|---|---|
| CER vs. human reference | 0.199 | **0.140** |
| — trained speakers (n=10) | 0.226 | **0.132** (−42 %, better on 8/10) |
| — zero-shot speakers (n=10) | 0.171 | **0.147** (−14 %, better on 5/10) |
| Speaker similarity (WavLM-SV) | 0.950 | 0.948 |
| RTF (Apple MPS) | 1.95 | 1.95 |

Training cost: **2.44 h of dialect audio, 7 980 updates / 60 epochs, ≈29 min on
one RTX 5090.** That number is the commercial argument for this whole task — a
customer voice is half an hour of audio and half an hour of GPU — and it is
measured, not projected.

Speaker similarity being flat is expected and not a failure: the base model
already clones a reference clip well. What the finetune buys is vowel length,
the `-isch` ending and sentence melody — i.e. dialect, not identity.

## The three things that will go wrong if they are not designed in

### 1. It is not real-time, and Piper is

RTF 1.95 measured warm on Apple MPS: mean **6.78 s of synthesis for 3.68 s of
audio**. Piper is real-time on CPU. Dropping an F5 pack into a live conversational
turn on the same box makes the robot feel broken. Mitigations all exist in the
Saar project (a two-tier text→audio cache keyed on text+speaker+speed+backend+model
revision, and a `speak_stream()` chunk generator) and the pipeline already has
`thinking_filler_s`. **A pack must declare `realtime: bool`,** the UI must show
it, and the default conversational voice must not silently become a non-real-time
one.

### 2. A dialect voice reading Hochdeutsch is not a dialect robot

The agent replies in standard German. Without a text-prep stage, a "Saarländisch
voice" says standard German sentences with a Saarland accent — a visibly weaker
product than what the demo promises, and nobody will notice in code review. The
Saar project has the missing stage (a rules-based Hochdeutsch→Saarländisch
translator, exposed there as `api_translate` / `dialect_mode`).

So a pack needs an **optional text-prep hook that runs after `tts_normalize()`**.
Two constraints on it, both learned the hard way in the Saar project:

- the target orthography is lowercase and quasi-phonetic (`"unn wääs der deiwel
  was noch"`) — that is *why* the voice works at all, since a character-level
  German model reads that spelling approximately as dialect;
- **sentence-final periods must survive.** They are the chunk boundary; a text
  without them is synthesized as one long chunk.

### 3. A silent fallback is worse than an error

If `/say` is asked for a voice that did not load and quietly answers in Piper
Thorsten, the failure mode is a demo that speaks the wrong language while every
health check stays green. **Unknown or unloaded voice → 4xx with a readable
reason.** Never fall back.

## Licensing — read this before promising it to a customer

| Component | Code | Weights | Commercial |
|---|---|---|---|
| Piper (current default) | **GPL-3.0** | per-voice | already noted in `tts/piper_engine.py:4-5` |
| `UdS-LSV/Saar-Voice` (the data) | — | CC BY 4.0 | yes |
| `hvoss-techfak/F5-TTS-German` (the base) | MIT | **CC-BY-NC-4.0** | **no** |
| The Saar finetune | — | **inherits CC-BY-NC-4.0** | **no** |

The dialect data is free. The restriction comes from the **base weights**, whose
training corpus (Emilia) is NC. So the Saar pack as it exists today is an
internal/demo voice and must be labelled one. The commercial path is a retrain on
an MIT-weights base (Chatterbox Multilingual is the identified candidate — MIT
code *and* weights), which is unbuilt and unmeasured.

Consequence for this task, and the reason it is in scope rather than deferred:
**a pack carries a `licence` field and a `commercial: bool`, the UI renders them,
and the pack list is honest about which voices a customer may ship.** The
platform already has the concept — `ListingLicense` hangs off `MarketplaceListing`.

## Settled decisions

1. **Voice is a separate axis from language.** `SpokenLanguages` stays a list of
   *languages* and does not gain `saar`. A pack declares which languages it can
   speak.
2. **The pack is declarative data, not a subclass per voice.** id, label, engine,
   languages, licence, `commercial`, `realtime`, optional text-prep, optional
   engine-specific options (for Saar: the reference speaker, default `P03`).
3. **Start with the pack pointed at the remote Space, not a vendored model.** The
   `/speak_pcm` contract already matches the adapter, a client already exists, and
   it keeps a 1.3 GB checkpoint and a CUDA/MPS dependency out of the voice venv. A
   local in-process pack is a later option for offline operation and latency.
4. **The reference speaker is a pack option, not an API parameter.** `/say` takes
   a voice id. Exposing `speaker=P03` through the product API leaks the Saar
   project's internals into a contract other packs cannot honour.
5. **Fail closed and fail loud** — see #3 above.
6. **No DB schema change in this task.** Packs live in the sidecar's config. The
   schema move is step 2 of the roadmap and should be done when there is a second
   customer voice, not before.

## Details

### Robot Agent — voice service (`robot-agent/voice/`)

- `voice_service/tts/base.py` — extend the contract to
  `synthesize(text, language, voice)` (or pass the resolved pack), and add an
  optional `prepare(text, language) -> str` hook, default identity.
- `voice_service/tts/registry.py` **(new)** — the pack table plus resolution:
  declared packs, which loaded, which failed and why. A pack whose engine cannot
  be imported must degrade to *unavailable with a reason*, never crash startup —
  `__main__.py`'s `build()` already has that shape, follow it.
- `voice_service/tts/saar_engine.py` **(new)** — `TTSEngine` over `gradio_client`
  against the Space, `api_name="/speak_pcm"`, `sample_rate=16000`. Returns
  `(pcm, 16_000)`. Implements `prepare()` for the dialect + orthography stage.
  Token via env, never logged.
- `voice_service/config.py` — add `voice: str = "piper_de"`; derive
  `VALID_TTS_ENGINES` (:18) from the registry; keep `piper_voice_for` (:113-117)
  as the Piper pack's own option lookup; add `voice` to `RUNTIME_MUTABLE` (:128)
  **only for already-loaded packs** — the docstring there promises "no model
  reloads needed", so switching to an unloaded pack must be an explicit error,
  not a hidden 20-second stall.
- `voice_service/__main__.py:78-81` — `make_tts()` resolves through the registry.
- `voice_service/pipeline.py:343-360` — `_speak` runs `tts_normalize()`, then the
  pack's `prepare()`, then `synthesize()`; record the `tts` metric **per pack**;
  report the active voice in `health()` (:365ff).
- `voice_service/http_api.py` — `/say` accepts an optional `voice`; `/health` and
  `/config` expose the pack list with `available`, `licence`, `commercial`,
  `realtime`. Update the endpoint docstring at :4-11.
- `.env.voice.example` — `VOICE_VOICE`, `VOICE_SAAR_SPACE`, `VOICE_SAAR_SPEAKER`.
- `scripts/g1_say.py` — a `--voice` flag; this is the fastest real-robot check.
- `README.md`, `ROBOT_DAY.md` — document the pack list and the licence column.

### Server

- `server/src/routes/voice.routes.ts:99-121` — the `'de'|'en'` gate at :108-111
  stays for `language`; add `voice` (validated against the relayed pack list, not
  a second hardcoded union) and forward it.
- New `GET /:id/voice/voices` relaying the sidecar's pack list, so the frontend
  never hardcodes one.
- `server/src/types/agent-mode.types.ts:178-181` — leave `SpokenLanguages` alone;
  fix the comment that ties it to Piper.

### Frontend

- `app/src/features/robots/types/voice.types.ts:18` — keep `VoiceLanguage`; add
  `VoicePack { id, label, languages, licence, commercial, realtime, available }`
  and add the active voice to `VoiceHealth`.
- `app/src/features/robots/api/voiceApi.ts:13-20,36-48` — `voices` endpoint,
  `voice` argument on `say`.
- `app/src/features/robots/components/voice/VoiceComposer.tsx:94-102` — replace the
  hardcoded two-option control with a voice picker fed by the API. Language stays
  a separate control. An NC or non-realtime pack renders a badge; an unavailable
  pack is disabled with its reason as the title.
- `app/src/features/robots/components/tabs/VoiceTab.tsx:33` — thread `voice` through.
- `app/src/features/robots/store/voiceStore.ts` — remember the selection per robot.

### Agent Mode narration

- `robot-agent/src/agent-mode/voice-narrator.ts:67,73` — carry the configured voice
  into the `/say` body alongside `language`.
- `robot-agent/src/agent-mode/types.ts:116-121` — correct the comment; the language
  union is not the voice list any more.

### Key files

```
robot-agent/voice/voice_service/tts/{base.py,registry.py,saar_engine.py,piper_engine.py}
robot-agent/voice/voice_service/{config.py,__main__.py,pipeline.py,http_api.py}
robot-agent/voice/scripts/g1_say.py
robot-agent/voice/.env.voice.example
server/src/routes/voice.routes.ts
app/src/features/robots/types/voice.types.ts
app/src/features/robots/api/voiceApi.ts
app/src/features/robots/components/voice/VoiceComposer.tsx
app/src/features/robots/components/tabs/VoiceTab.tsx
app/src/features/robots/store/voiceStore.ts
robot-agent/src/agent-mode/{voice-narrator.ts,types.ts}
```

## The road to a self-trained, customer-owned voice

Out of scope here, recorded so this task's shape does not have to be undone later.
Every step below already has its slot in the schema:

1. **This task** — a pack is config; licence and realtime are first-class; the
   `/say` path carries a voice end to end.
2. **A voice becomes a row, not config.** `ModelVersion.modelType`
   (`server/prisma/schema.prisma:2410`) already discriminates `'vla' | 'rl_policy'`;
   `TrainingJob.kind` (:2360) already discriminates `'supervised' | 'sim_rl'`.
   Adding `'voice'` to both gets a voice the same `artifactUri` in RustFS, MLflow
   run, `staging → canary → production` lifecycle and `Deployment` rollout as a
   manipulation policy — for a fraction of the training cost.
3. **Tenant isolation is free.** `TrainingJob.tenantId` and `ModelVersion.tenantId`
   already exist (TASK-155). A customer's voice is invisible to other tenants
   without new access-control code.
4. **Customer-supplied voice data.** ~30–60 min of clean single-speaker audio plus
   transcripts. This is *not* the shape of `Dataset` (LeRobot episodes, fps,
   frames) and should not be forced into it — that is a decision to make
   deliberately at step 2, not by accident now.
5. **Resale.** `MarketplaceListing.type` (:2647) is `skill | dataset`. `voice` is
   the third, and `ListingLicense` already models the licence a voice has to carry.

The story that sells: *a company records half an hour of its own spokesperson,
the platform trains a voice in half an hour of GPU time, and every robot in that
tenant's fleet speaks with it.* Step 1 of that is this task; the measurement
backing the claim is in the table above.

## Not in scope

- Any Prisma migration or DB-backed voice registry (roadmap step 2).
- Training a voice from inside NeoDEM. The Saar checkpoint is trained already.
- A commercially licensed (MIT-weights) Saar retrain. Named as the blocker for
  customer delivery; not attempted here.
- Voice cloning from arbitrary user-uploaded audio, and the consent/deepfake
  questions that come with it. That is a compliance-tagged task of its own and
  must not be smuggled in behind a config field.
- Changing STT. This task touches the output path only.

## Test Strategy

- **Registry unit tests**: every declared pack has id, label, languages, licence,
  `commercial`, `realtime`. A pack whose engine import raises is reported
  `available: false` **with a reason**, and startup still succeeds — assert on the
  reason string, not just on the boolean.
- **No silent fallback**: `POST /say {voice: "does-not-exist"}` and
  `{voice: "<declared but unloaded>"}` both return 4xx. Assert Piper did **not**
  synthesize. This is the regression that would otherwise ship a broken demo
  looking healthy.
- **Language and voice are independent**: `/say {language: "de", voice: "saar"}`
  and `{language: "en", voice: "piper_de"}` both resolve without one clobbering
  the other; `saar` is rejected as a *language*.
- **Text prep**: the Saar `prepare()` lowercases, applies the dialect rules, and
  **keeps sentence-final periods** — assert on a multi-sentence input, since
  losing them collapses the text into a single chunk.
- **Order**: `tts_normalize()` runs before `prepare()` (markdown must be gone
  before dialect rules see the text).
- **Server route**: `voice` is forwarded; the existing `language` validation is
  unchanged; the pack list is relayed rather than re-declared.
- **Frontend**: the composer renders the packs from the API, disables unavailable
  ones with their reason, and shows a licence badge for a non-commercial pack.
- **Latency, per pack**: `GET /status` reports separate `tts` p50/p95 for Piper and
  Saar. Gate: the Piper path does not regress. The Saar path is *reported*, not
  gated — it is known slower and that is the point of the `realtime` flag.
- **Live on the G1**: `scripts/g1_say.py --voice saar "…"` out of the robot
  speaker. The speaker leg is already validated on real hardware (TASK-181,
  2026-07-17), so this needs no new bring-up.

## Acceptance Criteria

- [ ] A voice pack registry exists; packs are declared as data, and a pack that
      fails to load is reported unavailable with a reason instead of crashing
- [ ] `TTSEngine` carries a voice and an optional `prepare()` text hook
- [ ] `VOICE_VOICE` selects the pack; switching between *loaded* packs works at
      runtime, switching to an unloaded one is an explicit error
- [ ] A Saarländisch pack synthesizes through `/speak_pcm` and comes out of the
      G1 speaker via `scripts/g1_say.py --voice saar`
- [ ] The Saar pack applies the dialect + corpus-orthography prep, and sentence
      periods survive it
- [ ] `/say` takes an optional `voice`; an unknown or unloaded voice is a 4xx and
      never a silent fallback to Piper
- [ ] `/health` and `GET /:id/voice/voices` list the packs with `available`,
      `licence`, `commercial`, `realtime`
- [ ] The Voice tab composer offers the packs, separately from the language
      control, and shows the licence and realtime state
- [ ] `SpokenLanguages` still contains exactly `['en', 'de']`, and the comments
      tying it to Piper voices are gone
- [ ] Agent Mode narration speaks through the configured pack
- [ ] Per-pack TTS latency is visible in `GET /status`
- [ ] Typecheck, the server suite, the app suite and the voice suite pass

## Not verified / open questions

- **An unresolved hang in the upstream Saar project.** One corpus-normalized
  four-sentence text stalls the *baseline* F5 model indefinitely (>600 s for what
  should take ~45 s); the finetune renders the same text fine, and text chunking
  has been ruled out as the cause (both variants chunk to 3 near-identical pieces).
  A voice that can hang is not safe for unattended narration. **This is the single
  biggest open risk in the task.** The `realtime: false` flag plus a hard timeout
  around `synthesize()` is the containment; the root cause is upstream work.
- **ZeroGPU cold start is unmeasured.** Only warm RTF (1.95, Apple MPS) exists. If
  a cold Space costs tens of seconds on the first turn, the remote-pack decision
  (#3) may have to be revisited in favour of a local pack on the robot-side GPU.
- **Whether a Chatterbox (MIT) retrain reaches the same quality.** Untested. The
  entire commercial story depends on it, and the dialect quality of the current
  pack is not evidence for it — different base model, different training data.
- **Where the dialect stage belongs.** In the pack (chosen here — it does not
  depend on the local LLM's dialect competence) or in the agent's system prompt
  (fewer moving parts, better prosody if it works). Unmeasured either way.
- **Whether `voice` should become a per-robot column** rather than a sidecar
  setting. A mixed fleet where one robot speaks dialect and another does not is a
  plausible customer request and the current design cannot express it.
- **Zero-shot speakers gained only −14 % CER** and only 5/10 improved. If a
  customer voice is trained on one speaker, the relevant number is the trained-
  speaker one (−42 %). Nothing here validates a customer voice generalising to a
  reference clip it never saw.
