---
id: "TASK-425"
aliases: []
title: "The data-collection session page is a simple live console that shows the assistant one clear next step"
slug: "the-data-collection-session-page-is-a-simple-live-console"
status: "done"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core"]
sprint: ""
parent: ""
depends_on: []
spe: 24                       # roll-up of the four children under "Split"; an epic — /plan publishes them, no leaf above 8
effort: "high"
due_date: ""
created: "2026-10-29"
updated: "2026-10-30"
---

# The data-collection session page is a simple live console that shows the assistant one clear next step

## Description

The session page (`/data-collection/:sessionId`) is the desktop assistant's view of a
two-person G1 recording, and it has grown into about three screens of stacked cards:
- The Quest connect controls appear twice.
- The robot mode panel is a wall of red reasons.
- "No camera" is a paragraph of troubleshooting.
- "Kept 0 takes" appears twice.
- Developer tools sit next to the main flow.
- The 3D twin takes half the screen while the real camera is a side tile.

This task rebuilds the page's layout and visual design around the three phases the
assistant actually works through:
- **Set up** is a guided checklist in bring-up order with one lit action.
- **Record** is a console that fits one 1512×945 screen: big live view, take dock and
  systems strip.
- **Wrap up** is a single summary band with one dataset action.

A sticky command bar keeps who/what/E-STOP in place across all three: every normal action
on its left, the E-STOP alone in its own zone on the far right, so it is never pressed by
accident. It is a change to
layout and presentation. Behaviour, handlers, stores and server calls stay as they are,
except the items listed under "Explicit changes".

## Details

### Current state

- **Route and page.** `/data-collection/:sessionId` renders
  `app/src/features/datacollection/pages/SessionDetailPage.tsx` (790 lines).
- **Page order today.** The page stacks these blocks, top to bottom:
  - `PageHeader`, whose `meta` holds `SessionStatusBadge`, the Sim tag, the "Live" tag
    (telemetry connected) and `PresenceBar`. Its `actions` hold the read-only
    `ControlLeaseBar`, `SessionEStopButton` and the status action (Start / End / Pause /
    Resume / Open dataset / New session / Create dataset). Its children hold
    `SessionStepIndicator` (Connect input → Record episodes → Review → Export).
  - `QuickCheckCard`, after each take.
  - The degraded banner "Frames are being missed", in violet.
  - `PreflightChecklist` "Before you record", on a created session.
  - A "Control" panel with an interactive `ControlLeaseBar`, for gamepad sessions and
    simulated VR.
  - A "Robot mode" panel. It holds `app/src/features/robots/components/RobotModeControl.tsx`
    with a long description.
  - A 12-column assistant grid:
    - On the left, the twin `Robot3DViewer` with `OperatorOverlay` (ghost hands) at
      `h-[34rem]`, and "More cameras".
    - On the right, a column with:
      - the lead `CameraStreamView` (`h-56`), or an `EmptyState` "No camera" with the
        whole troubleshooting text;
      - `SessionHud`: phase pill, Take N, timer, and four StatTiles, rendered even on a
        created session as "NOT STARTED Take 1 00:00";
      - `OperatorCard`, with its own Connect / Open on headset / Copy viewer link;
      - `EpisodePanel`, with the take buttons, a "Kept N takes" progress line and the take
        list;
      - the compact `RobotReadinessPanel` ("Robot side", whose values truncate);
      - `QualityIndicator`.
  - `VRSessionPanel` ("VR teleop (Meta Quest)"). It carries the second copy of the Quest
    connect card, Launch VR, "Test without a headset" (Simulate VR input) and "Keyboard
    fallback".
  - "Manual control", for non-VR sessions.
  - `SessionCompleted`, on completed sessions. Its Dataset card repeats the header's
    Open/Create dataset button.
- **PR #446 (TASK-423, about to merge).** It adds a bring-up indicator to
  `RobotModeControl`:
  - `BRING_UP_STEPS` = Zero torque → Limp → Stand → Balance.
  - `bringUpNext(measured)` gives the next button and a "Next: press …" line.
  - `data-next` and a ring mark the next button.
  - Test ids `robot-bringup` and `robot-bringup-next`.
  - It colours `unknown` red (`text-signal-stopped`) and `limp` amber.

  Build on the merged version.
- **Shell.** `app/src/components/layout/AppLayout.tsx`: a sticky `TopBar` (h-14), a
  sidebar of 224 px, and `main` with `px-8 py-6 gap-6`. Inside main sit
  `AlertBanner` (the in-flow E-stop alarm), `SectionRail` (~40 px), then the page. At
  1512×945 the page starts at y≈144, which leaves ~777 px of height.
- **Tokens.** `app/src/index.css` and `docs/brand.md` (Part II); the kit is
  `@/shared/components/ui`. The running lab install is white-labelled ZeMA
  (`brand/brand.config.ts`: steel-blue primary `#4d7c91`, neutral greys, Encode Sans). The
  design uses tokens only, so it renders in both brands.
- **Flow source of truth.** `docs/data-collection-two-person.md`:
  1. Start robot side.
  2. Take control, then Switch to arm control.
  3. Stand up, then Balance.
  4. Connect the Quest, then Open on headset.
  5. The operator presses Launch VR, Take control and Enter VR.
  6. Start session.
  7. Takes.
  8. End session.
  9. Create dataset.
- **Readiness model.** `app/src/features/robots/components/readiness/readinessRows.ts`
  turns `RobotReadiness` into rows:
  - Row ids: link, bridge, sidecar, agent, mode, arms, hand_left, hand_right, camera,
    control, quest.
  - `reasonRow()` maps the agent's ONE ordered reason code (`sidecar_unreachable`,
    `no_lowstate`, `read_only`, `estop_latched`, `mode_unknown`, `mode_not_balance`,
    `lease_none`, `hand_missing`, …) to the row it belongs to.

### Mockup

There is an approved-for-review static mockup, but it lives in a temporary scratchpad, so
everything it shows is described in words below:
- the page: `scratchpad/ui/mockup/index.html`, with states via `#state=setup|record|wrap`
  and `&v=rec|check|fault`, and `&brand=zema`;
- screenshots: `scratchpad/ui/mockup/*.png`.

It uses the real camera frames of the apple task, a real twin render, the app's fonts and
its tokens.

### The design in one sentence

One lit thing: at every moment exactly one control carries the primary fill, and it is
the next action. A 2 px tally line on the command bar tells the room the state:
- amber: getting ready;
- breathing red: a take records;
- quiet: between takes;
- mint: done.

### Visual language (tokens and classes — no new colours, fonts or dependencies)

**Surfaces**
- Page ground is `bg-canvas`.
- Phase panels are `Panel` (`bg-panel rounded-panel border-line-subtle`).
- Wells, quick check and table heads are `bg-inset rounded-control`.
- Popovers are `bg-raised` with `--shadow-raised`, the one shadow in the system.
- The wrap-up band is `Panel variant="highlight"`, and that is its only use on the page.
- New token: `--bg-media` (`bg-media`, dark `#03070c` in both themes) for the video well,
  because video is black in every theme. Add it to `index.css` and the brand.md token
  table.

**Instrument details**
- Readouts are hairline grids: `grid gap-px bg-line-subtle` with `bg-panel` cells.
- The live view has four 14 px reticle corner ticks: `border-line-strong`, and
  `border-signal-stopped/80` while a take records.
- Overlay chips on video are `bg-canvas/80 border border-line-subtle rounded-tag`.
- No `backdrop-filter`.
- Tabular numbers everywhere a number changes.

**Glow, inside the brand contract (§0.4: no glow shadows)**
- "Lit" is drawn with a 1 px signal border, a 4–10 % signal tint and a 2 px bar.
- Opacity breathing is the only motion for a lit state.
- Current setup step:
  - container: `rounded-control border border-primary/20 bg-primary/[0.04]`;
  - node: `h-7 w-7 rounded-full border border-primary bg-primary/10 text-primary`;
  - ring: `before:absolute before:-inset-[5px] before:rounded-full before:border before:border-primary/45 before:animate-breathe`.
- Live view while a take records: `ring-1 ring-inset ring-signal-stopped/65`.

**Colour means state**
- `primary` fill: only the next action, one per view. The E-STOP is the exception and
  uses `bg-stop text-on-stop`, the only saturated red on screen.
- `signal-measured`: ok, done, live, following, kept.
- `signal-unknown` (amber): waiting, attention, link stale, measured fps below 90 % of
  target, degraded, the unverified stand-up FSM, and the robot mode `unknown`. This
  changes PR #446, which colours it red: unknown is never a fault (brand §0.5).
- `signal-stopped`: fault text, a lost hand, a latched E-stop, and the REC pill outline.
  REC is a tinted outline, never a fill.
- `signal-estimated`: the Sim tag and the "Simulated input" tag.
- Paused uses amber (`statusTone`). The violet HUD pause pill goes.

**Tally (command bar `before:` 2 px top edge, `data-tally` on the bar)**

| `data-tally` | When | Colour |
| --- | --- | --- |
| `setup` | while steps are open | `bg-signal-unknown` |
| `setup` | once all steps are done | `bg-signal-measured` |
| `rec` | while capturing | `bg-signal-stopped animate-breathe` |
| `between` | between takes | `bg-line-strong` |
| `fault` | E-stop latched or a fail cell | `bg-signal-stopped` |
| `done` | completed | `bg-signal-measured` |
| `failed` | failed | `bg-signal-stopped` |

**Typography: Archivo (display, width axis), Inter (text), JetBrains Mono only for the session id**
- h1 (session name, the one h1): `font-display text-[19px] font-semibold leading-tight
  tracking-[-0.01em] [word-spacing:.06em] [font-variation-settings:'wdth'_106] truncate`
  with `title` set to the full text. It is 16.5 px and clamps to 2 lines below 640 px.
- Panel titles: `font-display text-base font-semibold [font-variation-settings:'wdth'_106]`.
  Step titles use the same face at 15 px.
- Take timer, the hero: `font-display text-[64px] leading-[.95] font-semibold tabular-nums
  tracking-[-0.03em] [font-variation-settings:'wdth'_116]`. It is 56 px below 1440 px and
  44 px below 640 px. Colour: `text-ink-primary` while capturing.
- "Take 3": `font-display text-[22px] font-semibold`.
- Readout values: `font-display text-[19px] font-semibold tabular-nums
  [font-variation-settings:'wdth'_108]`. Labels: Inter 11.5 px, `text-ink-tertiary`,
  sentence case, no eyebrows on readouts.
- Uppercase appears only in `StatusTag` and in the dock pill (`● REC`, `READY`, `PAUSED`,
  which e2e reads).
- Keyboard hints are `<kbd>` inside buttons: Inter 11 px, `rounded-[5px] border
  border-line-strong px-[5px] text-ink-tertiary`. On a primary they use
  `border-on-primary/30 text-on-primary/70`.
- Nothing renders below 10 px.

**Motion**
- 150 ms `--ease-instrument` for colour, border and expand changes.
- One new keyframe in `index.css`: `breathe` (opacity .45 → 1 → .45, 2 s), exposed as
  `animate-breathe`.
- Only three things breathe: the REC tally, the current-step ring and the live dot
  (`StatusTag pulse`). Setup and Record never show together, so at most one breathes at a
  time.
- No hover lift, bounce or shimmer, and nothing faster than 1 Hz.
- `prefers-reduced-motion` already neutralises animations globally.

**Icons**
- `lucide-react`, `strokeWidth={1.75}`: `h-4 w-4` in rows and buttons, `h-[18px]` in the
  E-STOP and the dock primary.
- Step states: Check (done), a number (open/current), Lock (waits).
- Steps: Hand (take control), Activity (arm control), PersonStanding (stand up), Usb
  (connect), Glasses (headset, operator).
- Takes: Play, Square, SkipForward, Trash2, Undo2.
- View: Video, Box, ArrowLeftRight, Maximize2.
- Bar: Volume2 / VolumeX (mute), FlaskConical (testing tools), Square (End session),
  OctagonX (E-STOP), Ellipsis (phone menu).

**Copy**
- Sentence case and verbs.
- Problems are stated once, in plain words, with the fix next to them. Examples:
  - "Take control in step 2 first."
  - "The right hand stopped answering."
  - "Starting take 4 keeps take 3."
- No troubleshooting paragraphs in tiles. The detail lives behind a "Details" or "Why"
  disclosure.

### Phase engine

| `session.status` | Phase |
| --- | --- |
| `created` | Set up |
| `recording`, `paused` | Record |
| `completed`, `failed` | Wrap up |

The page renders one phase layout. Every hook and handler in `SessionDetailPage` stays and
keeps running as today, including:
- the lease;
- presence (declared as `assistant`);
- telemetry autoConnect;
- the cameras poll;
- the polling intervals;
- the VR goodbye (`endsUnderVr`, `VR_GOODBYE_MS`);
- the hotkeys (Space, E, N, Backspace, Escape twice).

**Device role.** Add `useDeviceRole()`:
- It returns `'headset'` when the user agent matches `/OculusBrowser|Quest/i`, or when the
  `?xremu` emulator is active (`EMULATOR_ACTIVE` in
  `robots/components/tabs/vr/vrConstants.ts`).
- Otherwise it returns `'desktop'`.
- `isSessionSupported('immersive-vr')` alone is not enough, because desktop Chrome with an
  OpenXR runtime reports it.
- Testing tools has a "Show the headset view here" override.

On the headset role, every live phase leads with a full-width hero, "This is the headset",
with **Launch VR** as the primary (keeps `vr-launch`). The desktop steps sit behind one
"Robot setup" disclosure. That fixes Launch VR sitting at y≈2400 px on the Quest today.

### Command bar (all phases) — `components/console/SessionCommandBar.tsx`

`sticky top-14 z-30 flex h-[60px] items-center gap-3 overflow-hidden rounded-panel border border-line-subtle bg-panel pl-2.5`
(no right padding: the E-STOP zone runs flush to the right edge) with the tally `before:`
bar, wrapped in a `bg-canvas` sticky shim so that content scrolling under it is covered.
It is the page's `<header>` (data-testid `session-command-bar`).

**Sticky offset (decided 2026-10-30, amended to 32 px in TASK-426's review).** The shim
holds the bar **32 px** under the TopBar when it is stuck (the mockup used 12 px), so the
bar's top sits at 56 + 32 = 88 px and the E-STOP's top at 96 px. That puts every TopBar
control's hit box ≥ 48 px from the E-STOP (the Docs icon button 49.5 px, the account
avatar 54.5 px) instead of 34 px; at 28 px the Docs button's box was only 45.5 px away. At scroll 0 the bar stays where the layout puts it (y≈144 at 1512×945);
only the stuck position changes. Content scrolling under the bar stays covered by the
`bg-canvas` shim across the whole 32 px.

**Two sides, and the E-STOP never shares one.** Every normal action sits on the left,
packed right after the identity. The E-STOP sits alone on the far right, in its own zone,
behind a flexible clear gap. A click aimed at End session or Testing tools cannot land on
the E-STOP: the nearest other control is at least 65 px from its edge at every width from
640 px up, and End session is never its neighbour, in any phase or width. (Before: End
session sat 25 px from the E-STOP, and the user pointed out the risk of an accidental
stop.)

```
1512 — Record (measured: End session → E-STOP 67 px)
┌▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ tally ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀┬▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀┐
│ ← Pick up the apple and place it on the plate [● RECORDING] │ (BH)(AK◉) 🔊 ⚗ Testing tools [□ End session]             │░[⊗ E-STOP Esc Esc]░│
│   ● G1-EDU-4 (real) │ Meta Quest VR │ 30 fps                 │                                    ←──── ≥ 65 px ────→ │░ dark well, alone ░│
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────┘
  identity (truncates first)                                   left group: every normal action   clear gap (flex)        E-STOP only
```

Contents, left to right:

1. **Back.** An icon button (`aria-label="Back to Data collection"`, title "Data
   collection").
2. **Identity** (`min-w-0 shrink`).
   - Line 1: the h1 (`sessionName(session)`, i.e. the task text) and `SessionStatusBadge`.
     The text ("Ready", "Recording", "Paused", "Completed", "Failed") stays unchanged for
     e2e.
   - Line 2 (12.5 px, `text-ink-tertiary`):
     - a robot link dot and the robot name, followed by the `Sim` tag on a sim robot;
     - a 1 px divider, then the input type;
     - a divider, then `fps`.
   - The dot tells the robot link:
     - `signal-measured`: telemetry live;
     - `signal-unknown`: online but no robot state;
     - hollow: offline.

     Its `title` names the state. It replaces the "Live" tag.
   - In wrap-up the dot is not rendered.
   - When the bar runs short, the h1 truncates (its `title` holds the full text) before the
     clear gap shrinks. The full task text fits at 1512 and 1920; at 1280 it truncates.
3. **Left action group** (data-testid `session-actions`, `role="group"`): `flex flex-none
   items-center gap-2 h-[34px] border-l border-line-subtle pl-3`, directly after the
   identity, in Set up and Record (not rendered in wrap-up). In this order:
   1. **Presence.**
      - An avatar stack of 30 px initials with a `ring-1 ring-line-strong`, deduped by
        (user, role).
      - The headset viewer is ringed `signal-measured` and carries a 15 px Glasses badge.
      - Tooltips: "Anna Keller, in the headset" and "Ben Hoffmann, on this desktop".
      - Keeps `presence-bar` and `presence-viewer`.
   2. **Mute.** A ghost icon button with Volume2 (VolumeX while muted), `hud-mute`,
      `aria-label="Mute sound cues"`, `aria-pressed`, in Record only. It moved here from
      the take dock header, whose top row lies directly under the E-STOP (37 px).
   3. **Testing tools.**
      - A ghost `sm` button with FlaskConical and the label "Testing tools"; the label
        hides below 1440 px. It is `aria-haspopup="dialog"`, data-testid
        `session-tools-toggle`, and appears in Set up and Record.
      - When simulated input is on, a `StatusTag tone="sim"` "Simulated input" appears
        beside it.
   4. **End session.** A secondary button with Square and `<kbd>E</kbd>` (the hint hides
      below 1600 px, so the full task text still fits at 1512), in Record only, still
      behind the existing `confirm()`. Legacy recorders keep Pause in the dock, not here.
4. **Clear gap.** A spacer, `flex-1 min-w-6`. With the bar's `gap-3` on both sides of it,
   the zone's 1 px border and its 16 px left padding, the E-STOP is never closer than
   12 + 24 + 12 + 1 + 16 = **65 px** to another control. It holds nothing, ever. Measured:
   67 px at 1512, 65 px at 1280, 448 px at 1920 (Record, End session the nearest); 320 px
   at 1512 in Set up (Testing tools the nearest).
5. **E-STOP zone** (data-testid `estop-zone`): `flex flex-none items-center self-stretch
   border-l border-line bg-canvas/70 pl-4 pr-[7px]`. A slightly darker well, the full bar
   height, flush with the bar's right edge, behind a full-height hairline, so it reads as
   its own bay. It holds the E-STOP and nothing else, in every phase:
   - `SessionEStopButton`, restyled as `h-11 rounded-control bg-stop px-3.5 text-on-stop
     font-display font-bold tracking-[.06em] [font-variation-settings:'wdth'_112]`, with
     OctagonX and `<kbd>Esc Esc</kbd>`. Same size and colour as before (44 px tall,
     about 191 px wide).
   - It is rightmost, in every status (the unit test requires it on completed and failed
     too), with one press, no confirm and Escape twice, unchanged.
6. **Below 640 px.**
   - The bar keeps back, the h1 (2 lines), the status tag and the robot name, and gets
     `pr-2` back. An Ellipsis `DropdownMenu` at its top right holds End session, Testing
     tools, Mute sound cues and the control actions. It is not rendered in wrap-up, where
     none of them apply.
   - The **E-STOP zone itself** becomes the fixed bottom dock, by CSS only (same element,
     same `session-estop`): `max-sm:fixed inset-x-0 bottom-0 z-40 flex justify-end
     border-t border-line bg-inset px-4 pt-4 pb-[calc(12px+env(safe-area-inset-bottom))]`.
     The E-STOP is 52 px tall, at least 176 px wide, right-aligned as on the desktop,
     without the `<kbd>`.
   - The dock holds **only the E-STOP**. Its 16 px top padding and its empty left side are
     a dead band: content scrolled up to the dock's edge stays at least 17 px from the
     E-STOP, and a tap on the empty left does nothing.
   - The phase's primary action stays in the page, where it is on the desktop: Start
     session in the start bar, Stop/Start take in the take dock, Create dataset in the
     summary band (full width there).
   - `main` gets `pb-28` so nothing hides behind the dock.
   - Exactly one `session-estop` stays in the DOM.

**Testing tools popover** (`components/console/TestingTools.tsx`)
- A non-modal popover anchored to the button and aligned to its end, so it opens
  leftward under the left group, away from the E-STOP: `w-[360px] bg-raised border-line
  rounded-control shadow-[var(--shadow-raised)] p-1.5`. Open, its nearest control is still
  End session (67 px from the E-STOP at 1512). Its title is "Testing tools" and
  its lead is "For testing without a headset. A real session needs none of this."
- Rows, each with a 1 px top border, a title, one line of help and its control:
  - **Simulate VR input** (`simulate-vr-toggle`, `sim-input-status`), as a Switch.
  - **VR window on this browser**, with [Launch VR] (`vr-launch`, `vr-launch-hint`,
    `vr-prerequisites`), on the desktop role.
  - **Keyboard fallback** (`keyboard-fallback-toggle`, which opens `KeyboardTeleopSection`
    in place).
  - **Joint states** (Show, which opens `JointStateGrid` in place). This replaces the
    non-VR "Manual control" panel.
  - **Show the headset view here**.
- The popover stays **mounted** and toggles `hidden`, so `VRSessionPanel` (which owns the
  VR modal and the simulated input) never unmounts when it closes.
- Esc and an outside click close it, and focus returns to the button.

### SET UP (created) — guided rail and preview

```
1512×945 — SET UP. Content 1224 × 777 from y=144; no page scroll (measured 945/945).
┌ COMMAND BAR ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ tally amber ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀┬▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀┐
│ ←  Pick up the apple and place it on the plate [READY] │ (BH) ⚗ Testing tools                 │░[⊗ E-STOP Esc Esc]░│
│    ● G1-EDU-4 (real) │ Meta Quest VR │ 30 fps           │ left group ←── clear gap (flex) ──→ │░ E-STOP zone only ░│
└───────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────┘
┌ GET READY · 7fr (708) ──────────────────── 1 of 5 done ▬▬▭▭▭ ┐ ┌ PREVIEW · 5fr (504) ────────────────────────────┐
│ (✓) Start the robot side            Running, robot state live ⌄│ │ ⌜ [▢ Twin | ▣ Head camera]           [● Live] ⌝ │
│  │                                                            │ │                                                 │
│ ┌──────────────────────────────────────────────────────────────┐│ │          twin, large (watch it stand up)        │
│ │(②) Switch to arm control             ● Nobody has control  ⌃ ││ │                                                 │
│ │    The arms follow the headset only in arm control. Take     ││ │                                                 │
│ │    control, then switch. Nothing moves yet.                  ││ │                                ┌ Head camera ⇄┐ │
│ │    [✋ Take control]  [∿ Switch to arm control]  ⌄ Details    ││ │                                │  apple, plate │ │
│ │    👓 Later the operator takes control in the headset.        ││ │ ⌞                              └──────────────┘⌟│
│ │       That ends yours, as it should.                         ││ └─────────────────────────────────────────────────┘
│ └──────────────────────────────────────────────────────────────┘│
│ (3) Stand up and balance                               ● Limp ⌄ │
│ (4) Connect the Quest                         ○ No Quest on USB ⌄│
│ (5) Operator enters VR                  ○ Waiting for the headset ⌄│
├────────────────────────────────────────────────────────────────┤
│ [▷ Start session  Space]  4 steps open. You can start anyway:   │
│                           nothing records until a take starts,  │
│                           and each take stops on its own after 60 s.│
└────────────────────────────────────────────────────────────────┘
Step 3 opened (accordion — the click closes step 2's body; step 2 keeps its ring):
│ (3) Stand up and balance                               ● Limp ⌃ │
│     ● Zero torque ── ◉ Limp ── ○ Stand ── ○ Balance   measured 0.3 s ago │
│     Next: Stand up, then Balance. The robot must hang in the gantry; keep the remote within reach. │
│     [🧍 Stand up] (primary, disabled)  [Balance] (disabled)  [Limp]           │
│     🔒 Take control in step 2 first.                                          │
│     ⚠ Stand-up FSM 4 is not verified on this robot yet. Watch the first Stand up closely. │
```

**Layout**
- `grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-3 items-stretch` from 1024 px, one
  column below.
- Left is the "Get ready" `Panel` (data-testid `setup-rail`):
  - **Header.** The title "Get ready" and, on the right, "N of M done" with M segments of
    `h-1 w-[18px] rounded-sm`:
    - done: `bg-signal-measured`;
    - current: `bg-primary`;
    - open: `bg-line`.
  - **Track.** An `<ol>` of steps, each with a 28 px node and a 1 px connector
    (`bg-line`; `bg-signal-measured/40` below done steps).
  - **Start bar.** It sits under a `border-t border-line-subtle`.
- **Step row.** A button with
  `grid-cols-[28px_minmax(0,1fr)_auto_16px] gap-3.5 px-3 py-2.5 rounded-control`:
  - the node;
  - the title, `font-display 15px`, `text-ink-secondary` while open;
  - a one-line summary, 13 px, with a status dot: ok `text-signal-measured`, attention
    `text-signal-unknown`, idle `text-ink-tertiary` with a hollow dot;
  - a ChevronDown that rotates when open.
  - It carries data-testid `setup-step-<id>`, `data-state="done|current|open|waits|fault"`
    and `aria-expanded`.
- **Accordion.**
  - Exactly one body is expanded: the current step by default, or the one the user
    clicked. Closing it returns to the current step.
  - Bodies stay mounted (`hidden` when collapsed), so test ids and the controls' own state
    survive.
  - A body (`pl-[54px] pr-4 pb-4`) contains, in order:
    1. the step's problem line, if the readiness reason belongs to it;
    2. one line of what to do (max 62ch);
    3. an optional mode track;
    4. actions — the fix or next action as the **only primary on the page**, other legal
       actions as secondary or ghost;
    5. one reason line, if the actions are disabled;
    6. a "Details" disclosure with that step's readiness rows. Rows wrap and never
       truncate, values are humanised, and `title` carries the raw value.
- **Start bar.**
  - `Button size="lg"` "Start session" with `<kbd>Space</kbd>`.
  - It is **secondary** while steps are open, with the text "N steps open. You can start
    anyway: nothing records until a take starts, and each take stops on its own after
    {autoStopS} s." The last clause appears only when auto-stop is set.
  - It is **primary** once all steps are done, and its text becomes "Everything is ready.
    Nothing records until a take starts."
  - It is disabled only when preflight is `blocking` (robot offline). The reason is then
    the visible text, not just a `title`.
  - The `confirm()` and the Space hotkey are unchanged; Space is still blocked when
    `startBlockedRef` is set.
  - When every step is done, the track folds to one line: "✓ Robot ready, arm control on,
    balancing, Anna in VR".

**Steps for a VR session (`vr_quest`, `vr_vision_pro`), in bring-up order**
Model: a new pure `utils/setupSteps.ts`, unit-tested. It is built from:
- the readiness rows and `reasonRow()`;
- the preflight items (`utils/preflight.ts`);
- `useRobotBaseMode` (and the `bringUpNext` of PR #446);
- the lease;
- the operator presence and `inVr`;
- the readiness `quest` report.

| # | id | Title | Done when | Summary while open | Primary action (current step) | Other actions | Details rows |
|---|----|-------|-----------|--------------------|-------------------------------|---------------|--------------|
| 1 | `robot` | Start the robot side | robot online, agent reachable, robot state live (link/bridge/sidecar/agent rows ok; preflight robot + recorder ok) | "G1-EDU-4 is offline" / the reason text | **Start robot side** (`readiness-start`) | Logs (`readiness-logs`) | link, bridge, sidecar, agent, hand_left, hand_right (a missing hand is a non-blocking warning on this step: "Running; right hand missing") |
| 2 | `arm_control` | Switch to arm control | sidecar in `arm_sdk` (reason ≠ `read_only`) | "Nobody has control" / "You have control" | **Take control** (`readiness-take-control`), then **Switch to arm control** (`readiness-arm-control`, keeps its confirm) | Switch to read-only (`readiness-read-only`) | sidecar, control |
| 3 | `stance` | Stand up and balance | measured mode `balance` | measured mode label (Limp/Stand/Zero torque/Unknown), amber unless Balance | the `bringUpNext` button (Limp / Stand up / Balance) through `RobotModeControl variant="step"`; keeps every `ConfirmDialog` and "Ask the headset" | the other two mode buttons; Limp always enabled where it is today | mode |
| 4 | `quest` | Connect the Quest | Quest connected and forwarded, or the operator already present | "No Quest on USB" / "Quest connected, not forwarded" | **Connect** (`quest-connect`), then **Open on headset** (`quest-open`) via `QuestControls` | Copy viewer link (`quest-copy-viewer-link`); `quest-connect-help` / `data-mode` stay on this body | quest |
| 5 | `operator` | Operator enters VR | operator present, `inVr`, holding control | "Waiting for the headset" / "Anna is in the session, not in VR yet" | none (the operator acts); the body says "In the headset the operator presses Launch VR, Take control and Enter VR. You hear a chime when they are in." | — | arms (only meaningful once in VR) |

**Steps for non-VR sessions**
- `robot`, as above.
- `input`: Connect the gamepad / keyboard / leader arm. It comes from the preflight `input`
  item and is done when the device is seen.
- `control`: Take control. It shows only when the page uses its own inputs, and hosts the
  interactive `ControlLeaseBar` with `showEstop={false}` and data-testid
  `session-control-lease`.

**Rules**
- **current** is the first step that is not done.
- A later step whose prerequisite failed is **waits**. It gets a Lock node and the summary
  "Waits for step N", and never repeats the upstream error.
- The readiness reason sentence appears **once**: in the step that owns its row.
- Any step can be opened and acted on out of order. The model reads measured state, not
  clicks.

**Preview** (`Panel`, data-testid `setup-preview`)
- It holds the shared `LiveView` (below), defaulting to **Twin** as the main view so the
  assistant watches the robot stand up, with the head camera as the PiP.
- A missing camera is one amber line at the bottom of the well, "No head camera. Takes
  record without video.", with a "Why" disclosure holding `cameras.detail`. It replaces
  the `EmptyState` paragraph.
- Robot offline: an `EmptyState size="sm"` "Robot offline" inside the well. The action
  lives in step 1, not here.

### RECORD (recording, paused) — the console

```
1512×945 — RECORD, take running (measured: scrollHeight 945 = viewport). Title abbreviated here; the full text fits at 1512.
┌ COMMAND BAR · sticky top-14 · h60 ▀▀▀▀▀▀▀▀▀▀▀▀ tally signal-stopped, breathing ▀▀▀▀▀▀▀▀▀▀▀▀▀▀┬▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀┐
│ ← Pick up the apple … [● RECORDING] │ (BH)(AK◉) 🔊 ⚗ Testing tools [□ End session]             │░[⊗ E-STOP Esc Esc]░│
│   ● G1-EDU-4 (real) │ Meta Quest VR │ … │ left group                          ←── ≥ 65 px ──→ │░ E-STOP zone only ░│
└───────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────┘
 gap 12
┌ LIVE VIEW · 1fr (832) ─────────────────────────────────────────┐ ┌ TAKE DOCK · 380 ─────────────────────────────┐
│ ┌ well bg-media · 4:3 frame by container units ──────────────┐ │ │ [● REC] Take 3   (no control on this row)    │
│ │ ⌜ [▣ Head camera | ▢ Twin]           [● Live 29.8 fps] [⤢] ⌝│ │ │ 00:12                 (64 px, wdth 116)      │
│ │                                                            │ │ │ ▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭▭▭▭           Auto-stop in 48 s│
│ │            head camera, live — the hands, the apple,       │ │ │ ┌──────────────────────────────────────────┐ │
│ │            the plate                                       │ │ │ │ □ Stop take                        Space │ │ ← the one primary fill (52 px)
│ │                                         ┌ PiP 31% ≤270 ──┐ │ │ │ └──────────────────────────────────────────┘ │
│ │ [AK 38 ms  L ▬▬▬▭  R ▭▭▭▭]             │ Twin + ghosts ⇄ │ │ │ │ [⏭ Next take N]        [🗑 Discard ⌫]       │
│ │ ⌞                                       └────────────────┘⌟│ │ │ ┌Session─┬Frames──┬Frame rate─┬Kept─────┐  │
│ └────────────────────────────────────────────────────────────┘ │ │ │ 4:31    │ 1,740   │ 29.8 / 30 │ 2 takes │  │
├ SYSTEMS · 7 cells · h52 ───────────────────────────────────────┤ │ ├Motion ▬▬▬▬▬▬▬▬▬▬▬▭▭              Smooth┤  │
│Robot side│Control│Arm control│Mode    │Headset│Arms      │Hands  │ │ └──────────────────────────────────────────┘ │
│● Running │● Anna │● On       │● Balance│● In VR│● Following│● Both ok│ └──────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────────┘ ┌ TAKES · fills the rest · scrolls inside ─────┐
                                                                    │ Takes                          Newest first │
                                                                    │ [● REC] Take 3   Recording 00:12       Anna │
                                                                    │ [thumb] Take 2   8.1 s  243 frames     Anna │
                                                                    │ [thumb] Take 1   6.2 s  186 frames      Ben │
                                                                    └──────────────────────────────────────────────┘
Budget: 60 bar + 12 gap + 705 console = 777 (+ 24 shell padding). The shell's E-stop alarm banner (+78) shrinks the console, never the page.

Dock variants (same 380 column):
 between takes (quick check)               a fault (right hand lost) — blocker above the timer
┌──────────────────────────────────────┐  ┌──────────────────────────────────────────┐
│ [READY] Take 4                       │  │ [● REC] Take 3                           │
│ ┌ quick-check (bg-inset) ───────────┐ │  │ 00:12                Auto-stop in 48 s   │
│ │[thumb] Take 3  just now, by Anna  │ │  │ ┌ fault: border-signal-stopped/40 ─────┐ │
│ │        9.4 s  282 frames  30.0 fps│ │  │ │⊗ The right hand stopped answering    │ │
│ │        [L arm][R arm][R hand]     │ │  │ │  Its last reading is 41 s old, so    │ │
│ │ ⌄ Top 5 joints     Keep [🗑 Discard]│ │  │ │  this take has no right-hand frames. │ │
│ └───────────────────────────────────┘ │  │ │  Check the hand's cable and power.   │ │
│ [▷ Start take                  Space] │  │ │  ⌄ Details                           │ │
│      Starting take 4 keeps take 3.    │  │ └──────────────────────────────────────┘ │
│ Session │ Frames │ Frame rate │ Kept 3 │  │ [□ Stop take                   Space]   │
└──────────────────────────────────────┘  │ Systems: Arms ● Left only (amber), Hands ● Right lost (red); tally red │
                                          └──────────────────────────────────────────┘
```

**Console**
- `grid grid-cols-[minmax(0,1fr)_380px] gap-3` (340 px below 1440), data-testid
  `session-console`.
- Its height comes from a new `hooks/useViewportFill.ts`: it sets `--console-h` to
  `innerHeight − console top (page coords) − 24` (minimum 520). It re-measures on resize
  and with a `ResizeObserver` on `document.body`, which covers the alarm banner appearing.
- From 1024 px the page never scrolls in Record.
- Below 1024 px it stacks — live view, dock, takes — and the page scrolls. The well is
  then `aspect-[4/3]`.

**Live view** (`components/console/LiveView.tsx`, data-testid `live-view`), one component
shared by Set up and Record:
- **Well.** `relative flex-1 min-h-0 bg-media rounded-t-[13px] overflow-hidden
  [container-type:size]`. The **frame** is `absolute inset-0 m-auto
  w-[min(100cqw,133.333cqh)] h-[min(100cqh,75cqw)]`, so the overlays and reticle sit on
  the picture, not on the letterbox. Use the camera's aspect if it is known.
- **Main view and PiP.** Views are the head camera, the twin and each other served camera.
  The main view is the camera in Record and the Twin in Set up. The PiP (`absolute right-4
  bottom-4 w-[min(31%,270px)] aspect-[4/3] rounded-control border border-line-strong`)
  shows the other one and has a swap button (`live-view-swap`, ArrowLeftRight).
- **Overlays.**
  - Top-left: a view switch (segmented: Head camera / Twin / other cameras).
  - Top-right: `● Live 29.8 fps` (the camera's measured rate) and an expand button
    (Maximize2, the browser fullscreen API on the well).
  - Both top overlays sit `top-[26px]`, level with the end of the reticle tick. That keeps
    the Set up preview's view switch 50 px from the E-STOP at 1280 px (at 18 px it was
    39 px).
  - Bottom-left: the **operator chip** (VR only). It shows the avatar, then the link
    latency in `signal-measured` (amber when stale, red when lost), then grip bars
    `L`/`R` (44×5 px, filled `signal-measured` while that grip clutches).
- **Camera.** `CameraStreamView` keeps its reconnect countdown over the last frame,
  "Retry now" and "The recording continues". Its long "no camera" paragraph goes behind
  "Why".
- **Twin.** `Robot3DViewer` and `OperatorOverlay` are unchanged. Both views still unmount
  while this page's VR modal is open.
- **Recording.** While capturing, the well gets `ring-1 ring-inset ring-signal-stopped/65`
  and the reticle turns `signal-stopped/80`.
- **Test ids.** `session-twin` and `session-lead-camera` stay, on the twin and camera
  elements.

**Systems strip** (`components/console/SystemsStrip.tsx`, data-testid `session-systems`)
- It is the folded setup checklist, built by the same `setupSteps.ts` model, plus the live
  cells:
  - Robot side;
  - Control (data-testid `control-lease-holder`; value "Anna", or "You" or "Nobody");
  - Arm control;
  - Mode;
  - Headset ("In VR" / "Not in VR" / "No headset");
  - Arms ("Following" / "Left only" / the short why);
  - Hands ("Both ok" / "Right lost").
- Non-VR sessions show Robot side, Control and Input.
- **Cell.** A `button` with `flex flex-col gap-0.5 px-3 py-2.5 border-l border-line-subtle`,
  data-testid `systems-cell-<id>` and `data-status`:
  - the label is 11.5 px `text-ink-tertiary`;
  - the value is 13 px medium, with a 7 px dot;
  - `warn` adds `bg-signal-unknown/[0.07] text-signal-unknown`;
  - `fail` adds `bg-signal-stopped/[0.08] text-signal-stopped`.
- **Layout.** Seven equal columns from 1440 px, 4 + 3 below. Below 640 px it becomes one
  summary row: seven dots and "All 7 systems ok" or the worst cell's text. A tap expands
  the grid.
- **Click.** A cell opens a popover with that step's body: the same controls as in Set up.
  - Control: the read-only holder, or the interactive `ControlLeaseBar` with
    `session-control-lease` when the page uses its own inputs.
  - Mode: `RobotModeControl variant="step"`.
  - Headset: `QuestControls` while the operator is not in VR.
  - The rest: the Details rows.
- That keeps every function one click away and never repeats a control on screen.

**Take dock** (`components/console/TakeDock.tsx`; the root keeps data-testid `session-hud`)
- `Panel p-4 pb-[18px] flex flex-col gap-3.5`.
- **Header.**
  - The pill `hud-phase`, `font-display 14px tracking-[.08em] h-[30px] rounded-[8px]
    border`, reading:
    - `● REC`: `text-signal-stopped bg-signal-stopped/10 border-signal-stopped/35`;
    - `READY`: `text-ink-secondary bg-inset border-line`;
    - `PAUSED`: `statusTone` warning.
  - Then `hud-take` "Take N" (`hud-episode` inside). Between takes it shows the number of
    the next take, as today.
  - Nothing else. This row lies directly under the E-STOP, so it holds no control: the
    mute (`hud-mute`) moved to the command bar's left group. The row keeps its 38 px
    height, so the dock does not move.
- **Hero region.** It changes with the phase:
  - **Capturing:**
    - the timer `hud-take-timer`;
    - when auto-stop is set, a 3 px progress track and "Auto-stop in N s" (`hud-autostop`),
      amber in the last 10 s.
  - **Between takes with a pending quick check:** `QuickCheckCard` in a new
    `variant="dock"`. It keeps every test id and its verdict for an E-stop-aborted take. It
    shows:
    - a 104×78 thumbnail, then "Take N" with "just now, by Anna";
    - length, frames and fps, then the moved-group chips;
    - "Top 5 joints" (disclosure), then Keep (ghost) and Discard (secondary).

    A short or no-motion take turns the card's border `signal-stopped/40` and focuses
    Discard, as today.
  - **Between takes without a check:** the timer shows `00:00` in `text-ink-muted`.
- **Primary.**
  - `take-primary`, full-width, 52 px, primary: "Stop take" (Square) or "Start take"
    (Play), with `<kbd>Space</kbd>` pushed right.
  - Between takes after a check, a hint follows: "Starting take N keeps take N−1."
  - Paused (legacy): Resume.
  - Legacy recording: "Next episode" (`episode-next`) and Pause as secondaries.
- **Secondary row** (`grid grid-cols-2 gap-2`):
  - `take-next` "Next take" `<kbd>N</kbd>`, while capturing;
  - `take-discard-last` "Discard" `<kbd>⌫</kbd>`, with the 5 s Undo toast unchanged.

  While a quick check shows, the row hides, because the check owns Discard.
- **Slot.** It sits between the header and the primary. In priority order:
  1. **Recovery.** Shown when the E-stop is latched or the measured mode is not Balance. It
     holds the line "E-stop is latched. Take N was stopped and discarded." (fault tone), how
     the operator resets it, `RobotModeControl variant="step"` to re-stand (with Ask the
     headset), and Limp. The take buttons stay enabled as today, with the line "The arms
     will not follow until the robot balances."
  2. **Blocker.** Shown when the recorder is degraded ("Frames are being missed. The robot
     agent is unreachable; retrying.", amber, keeps `hud-degraded`), when the readiness
     reason is blocking (the reason sentence plus the fix action plus Details;
     `operator-why`, `operator-held`), or when motion is jerky (`QualityIndicator`'s
     warning and suggestions, amber).
  3. **The quick check.** This is the between-takes hero described above.
- **Readouts.** `dl`, hairline grid, four columns:
  - Session (`hud-duration`);
  - Frames (`hud-frames`);
  - Frame rate (`hud-fps`). It shows measured `29.8` with `/ 30` small; it is amber below
    90 %, and the title says "target 30 fps".
  - Kept (`hud-kept`, "N takes"). It carries `hud-streak` "5 in a row" from a streak of 2.

  A full-width row follows: "Motion", a 4 px meter of the smoothness score, then the label
  (Smooth / Jerky), taken from `QualityIndicator`'s data.
- **Takes list** (`components/console/TakesList.tsx`, data-testid `episode-panel`):
  - **Panel.** `flex-1 min-h-0` with the header "Takes" and "Newest first", and `<ol>
    overflow-auto`.
  - **Row.** `grid-cols-[64px_minmax(0,1fr)_auto] gap-3 px-2.5 py-1.5 rounded-control
    hover:bg-inset`, holding:
    - the thumbnail (`take-thumbnail-N`, 64×48), with the live take as a `● REC` outlined
      box;
    - "Take N", then the length and frames;
    - chips (`episode-chips-N`), dropped (`episode-dropped-N`) and the actor
      (`episode-actor-N`);
    - the row's trash button (`episode-discard-N`), unchanged: Discard on a finished take, "Restart take N?" on the live take, each with its confirm.
  - Each row keeps `episode-row-N`, and `episode-empty` reads "No takes yet. Space starts
    the first one."

### WRAP UP (completed, failed)

```
1512×945 — WRAP UP (no scroll).
┌ COMMAND BAR ▀▀▀▀ tally mint ▀▀▀▀ ←  Pick up the apple and place it on the plate [COMPLETED]  G1-EDU-4 (real)   …   │░[⊗ E-STOP]░┐
┌ SUMMARY BAND · Panel highlight ─────────────────────────────────────────────────────────────────────────────────┐
│ (✓) Session complete                                                            (nothing under the E-STOP)     │
│     Ben ended it at 17:42. 3 takes kept, 1 discarded. Create a dataset to curate and train on them.            │
│     Takes kept │ Recorded │ Frames │ Frame rate │ Motion                                 [🗄 Create dataset]     │
│     3          │ 5:02     │ 711    │ 29.9 fps   │ 86 % smooth                           (own column, centred)    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ TAKES · 8fr · review-episodes ──────────────────────────────────────┐ ┌ DETAILS · 4fr ──────────────────────────────┐
│ Takes  Trim or delete weak takes in the dataset viewer before you train.│ │ Task  Pick up the apple and place …  ✎ Edit │
│ TAKE          LENGTH  FRAMES  DROPPED  FPS   MOVED              BY  │ │ Robot and input  G1-EDU-4 (real), Meta Quest VR │
│ [img] Take 1   6.2 s    186      0    30.0  [L arm]             Ben │ │ Started and ended  Oct 29, 17:36 to 17:42   │
│ [img] Take 2   8.1 s    243      0    29.9  [L arm][L hand]    Anna │ │ Session  814249f2 (mono)                    │
│ [img] Take 3   9.4 s    282      1    29.9  [L arm][R arm][R hand] Anna │ │ Dataset  Not created yet  /  [EXPORTED] e3553405 │
└─────────────────────────────────────────────────────────────────────┘ └─────────────────────────────────────────────┘
```

**Summary band** (`Panel variant="highlight"`, data-testid `session-summary`)
- A 30 px check node in `signal-measured`, then "Session complete" (`font-display 24px
  wdth 108`). Failed sessions show an OctagonX node in `signal-stopped`, "Session failed"
  and the reason.
- One sentence: who ended it and when, kept and discarded counts, and the next step.
- **Exactly one action**, primary `lg`, in the band's own right column (`grid
  grid-cols-[minmax(0,1fr)_auto] gap-x-8 items-center`; the title, sentence and readouts
  fill the left column), vertically centred. It is never on the band's top row, which
  lies under the E-STOP: it sits 85 px from the E-STOP (it was 49 px top-right). Below
  640 px it spans the band's width under the readouts. It is:
  - Open dataset (`open-dataset`, when exported);
  - else New session (when 0 frames);
  - else Create dataset (the existing FormModal).
- **Readouts.** `grid grid-cols-5` with `border-l border-line` dividers, values
  `font-display 26px wdth 110 tabular-nums`: takes kept, recorded, frames
  (`session-frames`, keeping the TASK-418 "…" while settling), fps and motion.
  `session-warning` stays under the sentence.
- **Grid below.** `grid-cols-[minmax(0,8fr)_minmax(0,4fr)] gap-3`:
  - **Takes.** The `review-episodes` `DataTable`, with a 48×36 thumbnail column and the
    columns Take, Length, Frames, Dropped, FPS, Moved (chips), By, and Input
    (`episode-input-N`; hidden below 640 px together with Dropped, FPS and Moved). The
    header hint is "Trim or delete weak takes in the dataset viewer before you train."
  - **Details.** A `KeyValueList`-style `dl` holding:
    - Task, with a ghost "Edit" opening the existing Edit task modal;
    - Robot and input;
    - Started and ended;
    - Session id (mono);
    - Dataset, which reads "Not created yet", or the id with an "Exported" tag. It never
      has a second button.
- No telemetry, presence, testing tools, mute or robot link dot. The E-STOP stays in the
  bar, alone in its zone.

### Phone (390×844)

```
RECORD (viewport)                    SET UP (viewport)                   WRAP UP (viewport)
┌ TopBar · SectionRail (shell) ┐     ┌ ... ┐                              ┌ ... ┐
│▀▀ tally ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│     │ ← Pick up the apple and   ⋯ │       │ ← Pick up the apple …    │
│ ← Pick up the apple and    ⋯ │     │   place it on the plate     │       │   [COMPLETED] G1-EDU-4   │
│   place it on the plate      │     │   [READY] ● G1-EDU-4 (real) │       │ (✓) Session complete     │
│   [● RECORDING] ● G1-EDU-4   │     │ Get ready    1 of 5 ▬▬▭▭▭  │       │ Ben ended it at 17:42 …  │
│ ┌ camera 4:3 ─────────────┐  │     │ (✓) Start the robot side ⌄ │       │ Takes kept 3 │ Rec 5:02  │
│ │[Head camera|Twin] [Live]│  │     │ (②) Switch to arm control ⌃│       │ Frames 711 │ 29.9 fps    │
│ │[AK 38ms L▬ R▭] ┌twin⇄┐  │  │     │   …  [✋ Take control]      │       │ Motion 86 % smooth       │
│ └────────────────┴──────┘  │     │   [Switch to arm control]   │       │ [🗄 Create dataset      ]│
│ ●●●●●●● All 7 systems ok ⌄  │     │ (3) Stand up and balance ⌄ │       │ Takes  TAKE LENGTH FRAMES│
│ [● REC] Take 3               │     │ (4) Connect the Quest     ⌄│       │ …                        │
│ 00:12 (44 px)  Auto-stop 48 s│     │ …                          │       │                          │
│ [□ Stop take          Space] │     │                            │       │                          │
├──────────────────────────────┤     ├────────────────────────────┤       ├──────────────────────────┤ ← 16 px dead band
│               [⊗  E-STOP   ] │     │             [⊗  E-STOP   ] │       │           [⊗  E-STOP   ] │ ← fixed dock: E-STOP only, 52 px
└──────────────────────────────┘     └────────────────────────────┘       └──────────────────────────┘
⋯ holds End session, Testing tools and Mute sound cues in Record, Testing tools in Set up; it is not rendered in Wrap up.
Then (scroll): Next take / Discard, readouts 2×2 + Motion, Takes list (Record) / the other steps, the start bar with
[▷ Start session] and the preview (Set up) / takes table + details (Wrap up).
No horizontal scroll (measured scrollWidth 390); the E-STOP is in the viewport at every scroll position (measured).
```

### Explicit changes (everything else is layout and presentation only)

1. **Created session.** It no longer renders the HUD ("NOT STARTED Take 1 00:00" and the
   zero tiles).
2. **Step indicator.** `SessionStepIndicator` is removed, along with its testid
   `session-steps`. The status tag and the phase layout carry it.
3. **"Live" tag.** It becomes the robot link dot, and it is not shown in wrap-up.
4. **Preflight "Input" row.** It is not shown for VR sessions on the desktop role (a false
   "No headset on this browser"). It still shows for gamepad, keyboard and leader-arm
   sessions as the `input` step.
5. **Camera names.** With no cameras known, the page no longer invents "top" and "wrist"
   tiles.
6. **Degraded and unknown.** The degraded message is amber, not violet. RobotModeControl's
   `unknown` is amber, not red.
7. **Robot mode reasons.** The per-button reasons list becomes one reason line, the first
   reason in `modeDisabledReason` order. The raw `base.error` goes into Details.
8. **Wrap-up actions.** The Dataset card's second Open/Create dataset button is removed;
   the summary band holds the one action.
9. **Testing tools.** Simulate VR input, the desktop VR window, Keyboard fallback, Joint
   states and the Manual control panel all live behind the one "Testing tools" button.
10. **Headset role.** It leads with the Launch VR hero.
11. **Quest controls.** They render once, in step 4 or in the Headset cell popover. They
    are removed from `OperatorCard` and from the `VRSessionPanel` card.
12. **Presence chips.** They are deduped by (user, role).
13. **Phone.** Below 640 px the E-STOP alone is pinned in a bottom dock. The phase action
    stays in the page, and End session, Testing tools and the mute are in the bar's ⋯
    menu.
14. **E-STOP clear zone.** The E-STOP stands alone in its own zone at the bar's right end,
    behind a clear gap of at least 65 px; every normal action (presence, mute, Testing
    tools, End session) sits on the bar's left, after the identity. The mute moves from
    the take dock header to the bar, and the wrap-up action moves into its own centred
    column, because both sat under the E-STOP.

### Element map: old → new (nothing disappears silently)

| Old element (file) | New home |
| --- | --- |
| Back link "Data collection" (`PageHeader back`) | Command bar back icon button |
| Eyebrow "Build" | Not rendered in the bar: the SectionRail (Collect active) and the sidebar (Skill Training) carry the location. Add one sentence to brand.md §3: "A live console may use a console bar instead of PageHeader." |
| h1 `sessionName(session)` | Command bar h1 (truncate + title) |
| Description "robot · input" | Command bar line 2 (robot, divider, input, divider, fps) |
| `SessionStatusBadge` | Command bar, next to the h1 (same component and texts) |
| Sim tag | Command bar line 2, after the robot name |
| "Live" tag (telemetry) | Robot link dot (Explicit change 3) |
| `PresenceBar` chips | Command bar left group, first: avatar stack (deduped; `presence-bar`, `presence-viewer`) |
| Read-only `ControlLeaseBar` holder | Set up: step 2 summary. Record: Systems "Control" cell (`control-lease-holder`) |
| `SessionEStopButton` | Command bar, alone in its right zone (`estop-zone`) behind a clear gap of at least 65 px, all phases; below 640 px that zone is the bottom dock and holds nothing else (same element) |
| Start session | Set up start bar (secondary → primary; blocked with visible reason), on phones too (not in the dock) |
| End session | Command bar left group, last; Record only (confirm unchanged); never next to the E-STOP. Phone: ⋯ menu |
| Pause / Resume (legacy) | Take dock (Pause secondary, Resume primary) |
| Open dataset / New session / Create dataset | Wrap-up band, one action, in its own right column, vertically centred (full width on phones, not in the dock) |
| `SessionStepIndicator` | Removed (Explicit change 2) |
| `QuickCheckCard` | Take dock hero between takes (`variant="dock"`, all test ids kept) |
| Degraded banner + HUD "Degraded" chip | Take dock blocker line (`hud-degraded`, amber) |
| `PreflightChecklist` (Robot, Recorder, Camera, Input, Control, Next) | `setupSteps.ts` steps: Robot and Recorder → step 1; Camera → preview note; Input → `input` step (non-VR); Control → `control` step; "Next:" → the current step. The component and its test are deleted; `utils/preflight.ts` and its tests stay |
| "Control" panel (interactive `ControlLeaseBar`, `session-control-lease`) | Set up: `control` step body. Record: Control cell popover. `showEstop={false}` (one E-STOP) |
| "Robot mode" panel (`RobotModeControl`, `session-robot-mode`) | Set up: step 3 body (`variant="step"`, keeps `robot-mode-*`, `robot-bringup*`, confirms, Ask the headset). Record: Mode cell popover and recovery slot. The panel description text is dropped; the step's one line replaces it |
| Assistant grid (`session-assistant-layout`) | Record console (`session-console`) |
| Twin panel `Robot3DViewer` + `OperatorOverlay` (`session-twin`) | `LiveView`: Set up main view, Record PiP (swap) |
| "More cameras" panel | `LiveView` view switch entries |
| Lead camera `CameraStreamView` / "No camera" `EmptyState` (`session-lead-camera`) | `LiveView` Record main view; "No head camera" one-liner + Why |
| `SessionHud` phase pill, take, timer, auto-stop | Take dock header and hero (same test ids) |
| `SessionHud` mute (`hud-mute`) | Command bar left group, Record only (same test id); phone: ⋯ menu. Not in the take dock, whose header row lies under the E-STOP |
| `SessionHud` StatRow (Session time, Frames, Frame rate, Kept + streak / hotkey hint) | Take dock readouts (same test ids); hotkey hints move into the buttons' `<kbd>` |
| `OperatorCard`: status + link | Presence avatar (bar) + operator chip latency (`operator-status`, `operator-card`) |
| `OperatorCard`: grip bars | Operator chip (`operator-grip-left`, `operator-grip-right`) |
| `OperatorCard`: why line, held | Systems "Arms" cell + dock blocker (`operator-why`, `operator-held`) |
| `OperatorCard`: "Waiting for the headset…" + Quest buttons | Set up steps 4–5; Record Headset cell popover |
| `EpisodePanel` take buttons (`take-controls`, `take-primary`, `take-next`, `take-discard-last`, `episode-next`) + hotkeys | Take dock, on phones too (the phone dock holds only the E-STOP); hotkey logic moved unchanged into `hooks/useTakeHotkeys.ts` |
| `EpisodePanel` progress "Kept N takes" + hint (`episode-progress`) | Removed; Kept readout and `<kbd>` hints carry it (no duplicate) |
| `EpisodePanel` list rows | `TakesList` (same row test ids) |
| Compact `RobotReadinessPanel` "Robot side" (`session-readiness`, `robot-readiness-compact`) | Set up steps (rows in Details, reason in the owning step); Record systems strip. `readiness-start` / `readiness-take-control` / `readiness-arm-control` / `readiness-read-only` / `readiness-logs` as the step actions |
| `QualityIndicator` panel | Dock "Motion" readout + blocker line when jerky |
| `VRSessionPanel` card: status tag, WebXR line | Testing tools "VR window" row (desktop) / headset hero (headset role) |
| `VRSessionPanel` "Connect Meta Quest" card (`quest-connect-help`, Connect, Open on headset, Copy viewer link) | Step 4 body only |
| `VRSessionPanel` Launch VR (`vr-launch`, `vr-launch-hint`, `vr-prerequisites`) | Testing tools (desktop) / headset hero (headset) |
| `VRSessionPanel` "Test without a headset" (`simulate-vr-toggle`, `sim-input-status`) | Testing tools; "Simulated input" sim tag in the bar while on |
| `VRSessionPanel` Keyboard fallback (`keyboard-fallback-toggle`) | Testing tools |
| "Manual control" panel (non-VR: `KeyboardTeleopSection`, `JointStateGrid`) | Testing tools (Keyboard fallback, Joint states) |
| `SessionCompleted` Recording summary | Wrap-up band readouts + Details panel |
| `SessionCompleted` Dataset card | Details "Dataset" row (no second button) |
| `SessionCompleted` Takes table (`review-episodes`, `episode-input-N`) | Wrap-up Takes table (thumbnails added) |
| Edit task / Create dataset `FormModal`s | Unchanged |
| Loading / error states (`PageHeader` + `SkeletonText` / `ErrorState`) | Command bar skeleton + the same `ErrorState` |

### Frontend

**Create**
- `app/src/features/datacollection/components/console/SessionCommandBar.tsx`: the bar,
  its tally, the robot link dot, the left action group (avatar stack, mute, Testing tools,
  End session), the clear gap and the E-STOP zone, the zone's phone dock pinning and the
  ⋯ menu.
- `app/src/features/datacollection/components/console/TestingTools.tsx`: the popover, kept
  mounted.
- `app/src/features/datacollection/components/console/SetupRail.tsx` and `SetupStep.tsx`.
- `app/src/features/datacollection/utils/setupSteps.ts` with
  `utils/__tests__/setupSteps.test.ts`: the pure step and cell model; current, waits, and
  one-reason-once.
- `app/src/features/datacollection/components/console/LiveView.tsx` and
  `OperatorChip.tsx`.
- `app/src/features/datacollection/components/console/SystemsStrip.tsx`.
- `app/src/features/datacollection/components/console/TakeDock.tsx` and
  `TakesList.tsx`.
- `app/src/features/datacollection/components/console/HeadsetHero.tsx`.
- `app/src/features/datacollection/hooks/useViewportFill.ts`, `useDeviceRole.ts` and
  `useTakeHotkeys.ts` (moved out of `EpisodePanel` unchanged).
- `app/e2e/datacollection-console.spec.ts`: the layout acceptance checks below.

**Modify**
- `app/src/features/datacollection/pages/SessionDetailPage.tsx`: composition by phase. All
  state, effects and handlers stay; only the JSX changes.
- `.../components/session/SessionHud.tsx`: becomes the dock header, timer and readouts, or
  is folded into `TakeDock`. All `hud-*` ids are kept; `hud-mute` now renders in the
  command bar.
- `.../components/EpisodePanel.tsx`: split into `TakeDock` controls and `TakesList`. Delete
  it once empty.
- `.../components/session/QuickCheckCard.tsx`: `variant="dock"`.
- `.../components/OperatorCard.tsx`: reduced to `OperatorChip` data. The waiting and Quest
  part moves to the steps.
- `.../components/PresenceBar.tsx`: the avatar stack and dedupe.
- `.../components/VRSessionPanel.tsx`: `variant: 'tools' | 'hero'`, with the Quest connect
  card removed. It stays the one owner of the VR modal, the simulated input and the
  goodbye.
- `.../components/CameraStreamView.tsx`: `fit` in a frame, and the no-camera text behind
  Why.
- `.../components/session/SessionCompleted.tsx`: band, table and details.
- `.../components/index.ts` and `app/src/features/datacollection/index.ts`: exports.
- `app/src/features/robots/components/RobotModeControl.tsx`: `variant: 'panel' | 'step'`.
  The step variant has the node track for `BRING_UP_STEPS`, one reason line, amber
  `unknown`, and the unverified-FSM note as one amber line. `'panel'` (the robot Teleop tab
  and the VR modal) keeps today's look apart from the amber `unknown`.
- `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx` and
  `ReadinessRow.tsx`:
  - expose the action buttons (Start robot side, Take control, Switch to arm control,
    read-only, logs) as `ReadinessActions` usable on their own;
  - add a `rows` filter prop so a step can render just its rows;
  - values wrap instead of truncating.

  The Teleop tab's full panel is unchanged.
- `app/src/features/robots/components/readiness/QuestControls.tsx`: used by step 4 as is;
  the `quest-connect-help` / `data-mode` wrapper moves with it.
- `app/src/index.css`: `--bg-media` / `--color-media`, the `breathe` keyframe and
  `--animate-breathe`.
- `docs/brand.md`: the media token, `animate-breathe`, the console-bar sentence in §3 and
  the tally colours.
- `docs/data-collection-two-person.md`: rewrite "What the assistant sees" for the three
  phases. Setup steps 1–8 now point at the Get ready steps.

**Delete**
- `.../components/SessionStepIndicator.tsx`
- `.../components/PreflightChecklist.tsx` and `.../components/__tests__/PreflightChecklist.test.tsx`

**Test selectors**

These must survive (Playwright `app/e2e/datacollection-takes.spec.ts`,
`app/e2e/quest-connect.spec.ts`, and the vitest files under
`app/src/features/datacollection/pages/__tests__/`):
- the dock and HUD:
  - `hud-phase` with exact text `● REC` / `READY`;
  - `hud-take` "Take N";
  - `hud-take-timer` `00:0x`;
  - `take-primary` with text "Stop take" / "Start take";
  - `hud-duration`, `hud-frames`, `hud-fps`, `hud-kept`, `hud-streak`, `hud-autostop`,
    `hud-degraded`, `hud-mute`;
- the quick check: `quick-check`, `quick-check-title`, `quick-check-groups`,
  `quick-check-keep`, `quick-check-discard`, `quick-check-verdict`, `quick-check-stats`;
- `take-thumbnail-N` with `data-state`;
- the takes list: `episode-row-N`, `episode-panel`, `episode-chips-N`, `episode-discard-N`,
  `episode-actor-N`, `episode-dropped-N`, `episode-empty`;
- the E-STOP: `session-estop`, **exactly one in the DOM**;
- the take toasts: "You discarded take 1", "Discarding take 1…" with an Undo button, and
  "Emergency stop sent";
- the role button "Start session"; a "Pause" button exists only for legacy recorders;
- the Quest controls, now in step 4:
  - `quest-connect-help` with `data-mode` and `quest-copy-viewer-link`. The e2e first
    expands `setup-step-quest`, or the body is current. Bodies stay mounted.
- the VR panel and testing tools:
  - `vr-session-panel`, `vr-launch`, `vr-launch-hint`, `vr-prerequisites`,
    `simulate-vr-toggle`, `sim-input-status`, `keyboard-fallback-toggle`. They live in the
    mounted Testing tools; tests click `session-tools-toggle` first.
- control and readiness:
  - `session-control-lease`, present only when the page uses its own inputs;
  - `control-lease-holder`;
  - `robot-readiness-compact`, which the vrLease test only asserts absent;
  - `readiness-start`, `readiness-take-control`, `readiness-arm-control`;
- robot mode: `robot-mode-control`, `robot-mode-readout`, `robot-mode-<mode>`,
  `robot-mode-confirm`, `robot-bringup`, `robot-bringup-next`;
- `session-twin`, `session-lead-camera`, `open-dataset`, `review-episodes`,
  `episode-input-N`, `session-frames`, `session-warning`, `presence-bar`, `presence-viewer`;
- the vitest text check that "Top camera" is absent.

These are renamed or updated:
- `preflight-robot` → `setup-step-robot`, and `preflight-camera` → `setup-preview` (the
  camera note). Update `SessionDetailPage.preflight.test.tsx`.
- `session-steps` and `session-step-*` are removed.
- `session-assistant-layout` → `session-console`.
- `session-readiness` → `setup-rail`.
- `session-robot-mode` → `setup-step-stance`.

New test ids:
- the bar: `session-command-bar`, `session-actions` (the left group), `estop-zone` (the
  E-STOP's zone; below 640 px it is the fixed bottom dock, so it replaces the planned
  `mobile-dock`), `session-tools-toggle`, `session-tools`, `headset-hero`;
- set up: `setup-rail`, `setup-step-<id>` (with `data-state`), `setup-start`,
  `setup-preview`;
- record: `session-console`, `live-view`, `live-view-swap`, `session-systems`,
  `systems-cell-<id>` (with `data-status`), `take-dock-slot` (with
  `data-kind="recovery|blocker"`);
- wrap up: `session-summary`.

### Split (this is an epic; `/plan` publishes these children, none above 8)

1. **TASK-426 — Command bar, phase switch, testing tools and phone dock** (spe 5). Depends on nothing.
   It covers:
   - `SessionCommandBar`, its tally and the presence dedupe, the left action group (with
     the mute moved in from the HUD) and the E-STOP zone behind its clear gap;
   - `TestingTools`, with `VRSessionPanel variant="tools"` and the Manual control panel
     moved;
   - `useDeviceRole` and `HeadsetHero`;
   - the phase switch in `SessionDetailPage`, with the old blocks still rendered under it
     per phase;
   - the E-STOP zone as the phone dock (E-STOP only) and the ⋯ menu;
   - removing `SessionStepIndicator`;
   - the `breathe` keyframe and the `media` token.
2. **TASK-427 — Set up is a guided checklist with one lit action** (spe 8). It depends on child 1 and
   on PR #446 being merged. It covers:
   - the `setupSteps.ts` model and its tests;
   - `SetupRail` / `SetupStep`;
   - `ReadinessActions` and the row filter;
   - `RobotModeControl variant="step"`;
   - `QuestControls` in step 4;
   - `LiveView` (twin, camera, PiP, frame) as the preview;
   - deleting `PreflightChecklist`.
3. **TASK-428 — Recording is a console that fits one screen** (spe 8). It depends on child 2 (for
   `LiveView` and the model). It covers:
   - `useViewportFill`;
   - `SystemsStrip` and the cell popovers;
   - `TakeDock`, with the slot, the quick check dock variant and the readouts (no
     control in its header row);
   - `TakesList` and `useTakeHotkeys`;
   - `OperatorChip`;
   - `app/e2e/datacollection-console.spec.ts`.
4. **TASK-429 — Wrap-up is one summary band with one dataset action** (spe 3). It depends on child 1.
   It covers `SessionCompleted` → band (the action in its own centred column), table and
   details, and the docs update
   (`docs/data-collection-two-person.md`, `docs/brand.md`).

Plan decisions (2026-10-30), on top of the split above:
- **TASK-426 creates `app/e2e/datacollection-console.spec.ts`** with the E-STOP sweeps and
  the bar measurements, so the safety checks exist from the first PR on. TASK-427, -428 and
  -429 each add their phase's blocks to it. The Record fit measurement stays with TASK-428.
- **Phase-scoped criteria go to the phase's child.** Where a criterion below names several
  phases (one lit action, page-wide E-STOP clearance, duplicates, reachability, phone,
  screenshots, light theme and ZeMA), each phase's part belongs to the child that builds
  that phase. The table below gives every part exactly one owner.
- **Gates run on every child.** `design-drift.test.ts`, the brand bans (no raw hex or hue
  utilities, no `backdrop-filter`, no glow shadows), `./scripts/test-all.sh --skip-pw` and
  the four Playwright specs must be green on every child's PR; they are not owned by one
  child, because each PR can break them.
- **The headset role in e2e.** `EMULATOR_ACTIVE` is false outside `import.meta.env.DEV` on
  localhost, so the demo build cannot use `?xremu`. The e2e drives the headset role with a
  Quest user agent (`OculusBrowser`); `?xremu` is checked by hand against `npm run dev`.

| Acceptance criterion (below) | Part | Owner |
| --- | --- | --- |
| Record fits | all | TASK-428 |
| E-STOP always visible | all (one in the DOM, scroll sweep in all phases at 1512 and 390, one press, Escape twice) | TASK-426 |
| E-STOP stands alone | only control in `estop-zone`; End session never adjacent; bar gap ≥ 65 px at every width from 640 px, Testing tools open too; TopBar ≈ 50 px via the sticky offset; 390 dock holds only the E-STOP and the ⋯ menu holds End session, Testing tools, mute | TASK-426 |
| E-STOP stands alone | page-wide ≥ 64 / 48 px in Set up (Testing tools open too) | TASK-427 |
| E-STOP stands alone | page-wide ≥ 64 / 48 px in Record capturing, between takes, blocker (Testing tools open too) | TASK-428 |
| E-STOP stands alone | page-wide ≥ 64 / 48 px in Wrap up | TASK-429 |
| No duplicates | one `session-estop`; no E-STOP inside a `ControlLeaseBar`; one avatar per (user, role) | TASK-426 |
| No duplicates | Quest controls and "Open on headset" once, and the reason sentence once, in Set up | TASK-427 |
| No duplicates | Quest controls and "Open on headset" once, the reason sentence once, and the kept count once, in Record | TASK-428 |
| One lit action | Set up | TASK-427 |
| One lit action | Record capturing, Record between takes | TASK-428 |
| One lit action | Wrap up | TASK-429 |
| Every function within one disclosure | Simulate VR input, Launch VR, Keyboard fallback, Joint states, mute, End session, E-STOP | TASK-426 |
| Every function within one disclosure | Start robot side, Take control, Switch to arm control, Limp / Stand up / Balance, Ask the headset, Connect, Open on headset, Copy viewer link, Start session, swap view, expand view (in Set up) | TASK-427 |
| Every function within one disclosure | Start / Stop / Next / Discard take, Keep, Undo, and the robot, control, mode and Quest actions through the systems cells (in Record) | TASK-428 |
| Every function within one disclosure | Edit task, Create / Open dataset | TASK-429 |
| Diagnostics | `mode_not_balance` in step 3 only; "Waits for step N"; amber `unknown` | TASK-427 |
| Diagnostics | `mode_not_balance` in the Mode cell and the recovery slot only | TASK-428 |
| Set up | all | TASK-427 |
| Testing tools | all | TASK-426 |
| Phone (390×844) | the bar (h1 at most 2 lines, back, status, robot); the dock holds only the E-STOP; the existing "fits a phone" e2e passes | TASK-426 |
| Phone (390×844) | no horizontal scroll and the phase action in the page, per phase | TASK-427 (Set up), TASK-428 (Record), TASK-429 (Wrap up) |
| Headset role | all | TASK-426 |
| Brand | only `media` and `animate-breathe` added to `index.css`; breathing stops under `prefers-reduced-motion` | TASK-426 |
| Brand | both tokens, `animate-breathe`, the console-bar sentence and the tally colours documented in `docs/brand.md` | TASK-429 |
| Brand | light theme and ZeMA render | TASK-426 (the command bar and the phone dock), TASK-427 (Set up), TASK-428 (Record), TASK-429 (Wrap up) |
| Brand | `design-drift.test.ts`, no raw hex / hue / `backdrop-filter` / glow | gate on every child |
| Tests and screenshots | `test-all.sh --skip-pw` and the four Playwright specs green, with the child's selector updates | gate on every child |
| Tests and screenshots | before/after screenshots at 1512×945, 1920×1080 and 390×844, per phase | TASK-427 (Set up), TASK-428 (Record capturing and between takes), TASK-429 (Wrap up) |

## Acceptance Criteria

- [x] **Record fits.** At 1512×945, on `#/data-collection/demo-session-takes` (demo build,
  MSW), during a take, between takes with the quick check open, and with a blocker in the
  slot, all of these hold:
  - `document.documentElement.scrollHeight <= window.innerHeight`;
  - the live view, the systems strip, the take dock primary and the E-STOP are all inside
    the viewport.

  The same holds at 1920×1080 and 1280×800. This is measured in
  `app/e2e/datacollection-console.spec.ts`.
- [x] **E-STOP always visible.** Exactly one `session-estop` is in the DOM. Scrolling in
  200 px steps through the whole page, its bounding box lies inside the viewport at every
  position:
  - at 1512×945 in Set up, Record and Wrap up;
  - at 390×844 in all three phases.

  It fires on one press with no dialog ("Emergency stop sent"), and Escape twice still
  works.
- [x] **E-STOP stands alone.** Measured in `app/e2e/datacollection-console.spec.ts` from
  the bounding boxes:
  - The E-STOP is the only control in the bar's right zone (`estop-zone`). End session is
    never adjacent to it, in any phase or width.
  - The nearest other interactive element (`button`, `a[href]`, `[role=switch]`,
    `[role=menuitem]`, inputs; anywhere on the page, with the Testing tools popover open
    too) is **≥ 64 px** from the E-STOP at 1512×945 and 1920×1080 and **≥ 48 px** at
    1280×800. This holds in Set up, Record (capturing, between takes, blocker) and Wrap
    up, at scroll position 0. Inside the bar, the gap holds at every width from 640 px
    up.
  - The app TopBar's controls are not moved, but the bar's sticky offset keeps them clear:
    the bar sticks 32 px under the TopBar (was 12 px; decided 2026-10-30, see "Sticky
    offset" under the command bar), so when the page scrolls every TopBar control sits
    ≥ 48 px from the E-STOP instead of 34 px.
  - At 390×844 the bottom dock holds only the E-STOP. End session, Testing tools and the
    mute are in the bar's ⋯ menu, and the phase action is in the page.

  The mockup measured 67 px at 1512 (End session), 65 px at 1280 (End session), and
  448 px at 1920 in the bar, with 111 px to the TopBar there. Page-wide it measured
  ≥ 84 px at 1512 in Wrap up (Create dataset), ≥ 101 px in Set up (the preview's view
  switch), and 50 px at 1280 in Set up (the view switch). Before the change, End session
  sat 25 px from the E-STOP.
- [x] **No duplicates.**
  - On a live VR session there is at most one element each with `quest-connect`,
    `quest-open` and `quest-copy-viewer-link`. The text "Open on headset" occurs once.
  - The kept count is rendered once (`hud-kept`).
  - The readiness reason sentence occurs at most once in the DOM.
  - There is one `session-estop`.
  - There is no second E-STOP inside a `ControlLeaseBar` on this page.
  - Presence shows one avatar per (user, role).
- [x] **One lit action.** In every phase state of the e2e (Set up, Record capturing,
  Record between takes, Wrap up), exactly one visible kit `primary` button is on screen,
  not counting the E-STOP. Disabled primaries count as not lit.
- [x] **Every function within one disclosure.** The e2e reaches each of these with at most
  one click (expand a step, open a systems cell, or open Testing tools):
  - Start robot side, Take control, Switch to arm control;
  - Limp / Stand up / Balance (and Ask the headset);
  - Connect, Open on headset, Copy viewer link;
  - Start session, Start/Stop/Next/Discard take, Keep, Undo, End session;
  - Edit task, Create/Open dataset;
  - Simulate VR input, Launch VR, Keyboard fallback, Joint states;
  - mute, swap view, expand view, E-STOP (zero clicks).
- [x] **Diagnostics.**
  - Single-source and plain-language: a robot with readiness reason `mode_not_balance`
    shows the reason in step 3 (Set up) or the Mode cell plus the recovery slot (Record),
    and nowhere else.
  - Steps after a failed step read "Waits for step N" without the error text.
  - The robot mode `unknown` renders amber (`text-signal-unknown`).
- [x] **Set up.**
  - The current step is the first open one, is expanded, and holds the page's only primary.
  - Start session is secondary while steps are open and primary when all are done.
  - It is disabled with visible reason text when the robot is offline, and Space then does
    not start it (existing vitest kept).
- [x] **Testing tools.**
  - Simulated VR input, the desktop VR window, Keyboard fallback and Joint states are only
    in Testing tools.
  - Turning simulation on shows a "Simulated input" sim tag in the bar.
  - Closing the popover does not unmount `VRSessionPanel`: the vrGoodbye and vrLease
    vitest files pass.
- [x] **Phone (390×844).**
  - No horizontal scroll (`scrollWidth <= clientWidth`; the existing "fits a phone" e2e
    passes).
  - The fixed bottom dock holds the E-STOP and no other control. The phase action stays
    in the page: the start bar, the take dock or the summary band.
  - The h1 wraps to at most 2 lines.
- [x] **Headset role.** With `?xremu`, the page leads with the "This is the headset" hero
  and Launch VR (`vr-launch`) above the fold at 390×844 and 1280×800.
- [ ] **Brand.**
  - `app/src/__tests__/design-drift.test.ts` passes.
  - No raw hex or hue utilities, no `backdrop-filter`, no glow shadows.
  - Only the new `media` token and `animate-breathe` are added to `index.css`; both are
    documented in `docs/brand.md`.
  - Breathing stops under `prefers-reduced-motion`.
  - The page renders correctly in the light theme and under a white-label brand: check
    with the ZeMA `brand/` config.
- [ ] **Tests and screenshots.**
  - `./scripts/test-all.sh --skip-pw` is green.
  - `npx playwright test e2e/datacollection-takes.spec.ts e2e/quest-connect.spec.ts
    e2e/datacollection-new-session.spec.ts e2e/datacollection-console.spec.ts` is green,
    with only the selector updates listed above.
  - The PR shows before/after screenshots of Set up, Record (capturing and between takes)
    and Wrap up at 1512×945, 1920×1080 and 390×844.

## Test Strategy

**Unit (vitest)**
- `setupSteps.test.ts` covers:
  - step order for VR and non-VR sessions;
  - current = the first not-done step, and waits after a failure;
  - each `reasonRow` code landing in exactly one step or cell;
  - hands as a non-blocking warning;
  - the gamepad `input` step;
  - the systems cells from the same input.
- Update `SessionDetailPage.preflight.test.tsx` for the new ids. The offline block and the
  Space block are kept.
- `SessionDetailPage.takes.test.tsx` stays unchanged and passes (dock ids kept).
- The vrGoodbye and vrLease tests pass, with Testing tools opened where they click
  `simulate-vr-toggle`.
- `RobotModeControl` tests cover the step variant: one reason line, amber unknown, and the
  confirm still required.
- `QuickCheckCard` dock variant: Keep, Discard, and the E-stop verdict.

**E2E (Playwright, demo build)**
- New `datacollection-console.spec.ts` covers:
  - the fit measurement at 1512×945, 1920×1080 and 1280×800 in each Record variant;
  - the E-STOP-visible-at-every-scroll-position sweep (1512 and 390, all phases);
  - the E-STOP clearance: the nearest interactive element to its bounding box per phase
    at 1280, 1512 and 1920 (≥ 48 / 64 / 64 px), with Testing tools open as well; and at
    390, that the dock holds only the E-STOP;
  - the duplicate counts;
  - the one-primary count;
  - the one-click reachability list;
  - `?xremu` for the headset hero.
- The existing `datacollection-takes.spec.ts` and `quest-connect.spec.ts` run with the
  listed selector updates.

**Manual on this box**
- Rehearse the full two-person flow against the sim robot `sim-g1-edu-dev`
  (`docs/g1-edu-lab-bringup.md`) with a desktop browser and `?xremu`:
  - Set up, steps 1→5;
  - Start session;
  - three takes with Keep, Discard and Undo;
  - an E-stop during a take, then recovery from the slot;
  - End session;
  - Create dataset.
- Then repeat the screen review on the real `g1-edu-4` with the ZeMA brand.
- Capture the PR screenshots with a playwright script at the three sizes.

## Safety constraints

- The E-STOP:
  - stays one press, with no confirm;
  - stays always visible;
  - is never behind a disclosure, tab, hover or drawer;
  - stays in every status;
  - keeps Escape twice;
  - moves only by CSS, never by a second instance;
  - stands alone. Nothing else goes in its zone or in the phone dock. No other control
    comes within 64 px of it at 1512 px (48 px at 1280), and the bar's clear gap never
    drops below 65 px: the title truncates first.
- Every action that has a confirmation keeps it:
  - Start session and End session (`confirm()`);
  - Limp / Stand up / Balance and Ask the headset (`ConfirmDialog`, `robot-mode-confirm`);
  - Switch to arm control and read-only;
  - Stop robot side;
  - Discard from a row;
  - the Backspace discard's 5 s Undo.
- Take control keeps its existing flow. The page still never takes the lease away from the
  operator, and the read-only holder display stays read-only.
- Limp stays enabled wherever it is enabled today.
- The VR modal, the simulated input and the goodbye stay owned by one mounted
  `VRSessionPanel`. The Testing tools popover must not unmount it.
- No behaviour change: stores, hooks, API calls, polling intervals, hotkeys, presence role
  and lease logic are untouched. Only the 14 items under "Explicit changes" differ, and all
  of them are presentation.

## Notes

Closed 2026-10-30 with its four children merged: TASK-426 (#448), TASK-427 (#450),
TASK-429 (#449) and TASK-428 (#451). Each child's PR lists where its part of the criteria
above is tested. The ticked criteria are measured on the demo build with MSW, mostly in
`app/e2e/datacollection-console.spec.ts`; the full demo Playwright suite (258 tests) and the
app's vitest (3459 tests) pass on the merged tree.

Left unticked, and why:
- **Brand.** Everything but one part holds: the tokens, `design-drift.test.ts`, the
  reduced-motion stop and the `docs/brand.md` entries. The light theme was checked for all
  three phases, and the ZeMA `brand/` config for the command bar, the phone dock, Record and
  Wrap up. Set up was not re-shot under ZeMA (#450 says so); it adds no colour outside the
  tokens.
- **Tests and screenshots.** The four Playwright specs are green. `./scripts/test-all.sh
  --skip-pw` is not green on this box, for reasons outside the epic's diff (no child changes
  `server/`, `robot-agent/` or `scripts/`): `server` `ScanSessionService.test.ts` fails while
  `RUSTFS_ENDPOINT` is set in the shell, and `robot-agent` `workspace.test.ts` fails its
  orphan sweep, on `main` too. The before/after screenshots are described in each PR body,
  not attached, because this repo does not keep PR images.

Not verified on a real robot. All of the above is the demo build, unit tests and the
reviewers' probes. None of the manual checks under "Test Strategy" is recorded here: not the
rehearsal against `sim-g1-edu-dev`, and not the screen review on `g1-edu-4` with the ZeMA
brand. That covers Set up steps 1–5 against a live robot side, the lease hand-over to the
headset, Ask the headset from the recovery slot, recovery after a real E-stop, and a dataset
from real takes. The user started testing on the real robot on 2026-10-30.

Found while closing, not fixed here: `useSessionDetail`
(`app/src/features/datacollection/hooks/datacollection.ts`) fetches once per mount
(`hasFetched`), so a hash-only navigation from one session page to another stays on
"Loading…".
