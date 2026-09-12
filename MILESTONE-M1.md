# Milestone M1 — Playable Vertical Slice

M1 is the current stopping point. It proves that Cinderline is a polished,
playable game slice with AAA-quality presentation and interaction inside its
defined scope. It does not claim Factorio's full content breadth.

## Player outcome

A new player can start a fresh campaign, understand the immediate objective,
finish the starter iron handoff, construct powered copper and masonry lines,
move real produced cargo into the Commission Uplink, transmit the Bootstrap
contract, spend the earned alloy on a self-sustaining coal spur and a Precision
Fabricator cell, deliver the Throughput shipment, reveal the next technology
tier, and continue from a persisted session.

## Ship gates

- A clean install launches in a supported desktop browser with no uncaught
  errors or progress-blocking warnings.
- Onboarding identifies the objective, the missing starter-line handoff, core
  construction controls, power state, and the Uplink delivery requirements.
- Extraction, belts, inserters, local power, smelting, storage, construction,
  dismantling/refunds, physical Uplink custody, and commission completion form
  one deterministic playable loop.
- Bootstrap awards material that the audited playthrough actually spends on
  the next phase: a 41-alloy automatic coal spur and an 84-alloy Precision
  Fabricator cell. That route moves alloy from `240 → 32 → 192 → 67`;
  transmitting Throughput then awards 160 alloy and reveals manifolds plus
  fluid processing. The open-ended simulation still permits alternate valid
  layouts and recovery strategies.
- The campaign economy cannot soft-lock the player. The bootstrap generator can
  be recovered through physical coal transfer or hand mining, and one burning
  coal sustains the validated short spur until its first mined coal arrives.
- The audited one-cell route consumes real iron and copper plate, physically
  secures 20 iron gears and 40 copper wire at the Uplink, and proves an actual
  HUD recipe change on that same live Fabricator between production stages.
  Alternate valid factory layouts remain player freedom rather than a hidden
  contract restriction. Its side inserter takes compatible cargo from a moving
  mixed-material belt at the geometric arm contact; it does not depend on an
  artificial belt jam.
- Autosave plus an explicit save/continue surface survives reload and rejects
  corrupt state without destroying the last recoverable session.
- Desktop mouse/keyboard and mobile touch layouts can pan, zoom, select, build,
  rotate, cancel, inspect, pause, save, and safely reset without viewport
  overflow or hidden controls intercepting input.
- Native 100% browser-zoom captures at 1920×1080, 1366×768, 390×844, and
  320×568 keep every actionable label at 14 CSS px or larger, mission/manual/
  session prose at 16 CSS px or larger with at least 1.4 line height, primary
  headings at 18 CSS px or larger, and meaningful secondary metadata at 12 CSS
  px or larger. Mobile controls have 44×44 CSS px touch targets; build names,
  states, panels, and transient feedback remain readable without clipping,
  ellipsis, page overflow, or overlapping text. Typography is scored as part
  of every visual-parity review, not treated as a separate polish exception.
- Post-output audio QA measures the signal after the game mix. Routine cues
  peak between -18 and -7 dBFS with active RMS between -30 and -18 dBFS and at
  least 10 dB separation from ambience; direct feedback peaks between -12 and
  -3 dBFS with active RMS between -24 and -14 dBFS and at least 14 dB
  separation. The worst supported cue stack stays below -1 dBFS without
  clipped/non-finite samples, the first gesture unlocks and renders its cue
  within 500 ms, mute completes within 100 ms, and unmute within 150 ms.
- Type checking, all automated tests, the production build, a fresh desktop
  browser playthrough, and a fresh mobile browser smoke pass are green.
- Within this slice, world materials, lighting, motion, effects, UI,
  readability, feedback, and interaction finish are held to AAA parity. Native
  desktop/mobile captures and active-machine closeups must survive a harsh
  independent visual review, while the focused renderer gates enforce frame
  and resource budgets; a merely functional result does not ship. The
  post-output mix gates above are part of this playable milestone; broad
  hardware-specific mastering beyond supported browsers remains deferred.
- An independent verifier reviews the fresh evidence, compares the slice's
  production values against a current factory-game reference without exposing
  candidate identity during scoring, and issues a ship verdict.

## Deferred beyond M1

- Exhaustive technology/content breadth, multiplayer, modding, and a long-form
  endgame.
- Full integration of every advanced fluid, circuit, rail, and blueprint-v3
  authoring path into the campaign tutorial.
- Final audio/accessibility/performance hardening across every device class.

## Validation

```bash
npm test
npm run build
npm run qa
npm run qa:readability-audio
npm run qa:audio
```

The release verdict must also cite a deterministic Bootstrap → Throughput
playthrough, the earned-alloy and automatic-fuel ledgers, AAA visual-review
evidence, and desktop/mobile persistence evidence produced from the exact final
source. Run the dedicated gate against a production preview, using a new empty
artifact directory for each candidate:

```bash
# Terminal 1
npm run build
npm run preview -- --port 4173 --strictPort

# Terminal 2
CINDERLINE_URL=http://127.0.0.1:4173 \
  CINDERLINE_M1_OUTPUT=.qa/m1-release-candidate-01 \
  npm run qa:m1
```
