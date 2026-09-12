# CINDERLINE

An original, deterministic factory-automation game built for the browser with Three.js.

The current release target is [Milestone M1 — Playable Vertical Slice](./MILESTONE-M1.md).
It gates a two-stage Bootstrap → Throughput campaign arc, persistence,
desktop/mobile playability, and AAA presentation inside that slice. Broader
content is deferred; visual and interaction quality are not.

## Play

```bash
npm install
npm run dev
```

Open `http://localhost:4173`.

Controls:

- `WASD` / arrow keys — pan
- Mouse wheel — pointer-anchored zoom
- `1`–`9`, `0` — select a construction unit
- Left click / drag — place; belts support drag routing
- `R` — rotate
- `Delete` / `Backspace` — dismantle the selected or hovered unit
- `Shift` + right click — quick-dismantle under the pointer
- `Esc` / `Q` — cancel construction
- `Cmd/Ctrl` + `Z` — undo
- `Space` — pause
- `F` — refocus the foundry
- `B` — capture a blueprint area by dragging a marquee or clicking two corners
- `Shift+B` — open the persistent blueprint library and share console
- `Cmd/Ctrl` + `C` / `V` — copy the selected unit / arm the blueprint clipboard
- `R` / `M` / `Shift+M` while pasting — rotate / mirror horizontally / mirror vertically
- `Cmd/Ctrl` + `Z` / `Shift+Z` or `Y` — undo / redo atomic construction commands

The default game begins as a sparse campaign. Finish the granted iron starter line, build copper and masonry production, and route real finished cargo into the marked Commission Uplink. Transmitting Bootstrap unlocks the Precision Fabricator and awards the construction alloy for the second phase: establish an automatic coal feed, side-tap the moving mixed-plate belt into the new Fabricator, fabricate and secure 20 iron gears, switch that same machine to copper wire, secure 40 wire, and transmit Throughput. Its reward reveals Dispatch manifolds and the fluid-processing kit as the next-tier preview. Belt-side inserters claim compatible moving cargo at their geometric arm contact, so this cell does not rely on jamming or stopping the main line. Uplink cargo is physically removed from its depot into a single-use secure manifest; construction purchases and full Factorio-style recovery carry per-entity provenance through save, load, and undo.

Power is spatial. Grid relays supply an exact 11 × 11 square, link into deterministic local networks, and isolate generation, demand, fuel use, and brownouts per component. Selecting a relay reveals its coverage and connected cable topology. Migrated saves retain their legacy global dispatch until every powered unit is covered and the player commits an atomic local-grid retrofit.

The authoritative simulation also includes fixed-point fluid networks: crude sources, powered pumps, pipes, storage tanks, and processors preserve every milli-unit through throughput limits, splits, merges, backpressure, recipes, save/restore, and power loss. Their Three.js layer renders real network state with batched pipes, visible flow tracers, vessel levels, operating mechanisms, and material-specific industrial wear. Transmitting Throughput unlocks these fluid controls in the advanced construction palette; the simulation API and focused visual proof route are live as the next-tier M1 preview.

Simulation v7 adds deterministic red/green circuit networks and placeable constant, arithmetic, and decider combinators. Signals advance with an explicit one-tick delay and can materially gate machines and generators, switch powered consumers (including fluid pumps/processors), filter inserters, and route manifold outputs. Item and fluid custody sensors publish exact integer signals, while strict persistence rejects phantom endpoints, forged machine capabilities, over-reach, and tick drift. In-world wire rendering and the player-facing wiring editor remain active integration gates rather than claimed finished features.

The bootstrap generator cannot be dismantled. Build the short coal spur before the Precision Fabricator so the grid can sustain its second-phase load. If every generator runs dry before that feed is online, select a generator and use its black-start action. It first hand-transfers one physical coal from the nearest storage, transport, machine buffer, inserter hand, or other generator; if none is available, **HAND-MINE + PRIME 1 COAL** atomically removes one unit from the nearest surveyed seam and loads the real fuel hopper. The validated short spur delivers its first replacement coal before one burning coal expires.

Campaign persistence uses a verified atomic v6 session wrapper with explicit save/continue status and a recoverable two-step reset. Loading validates the simulation schema, Uplink custody, unlocks, construction and rail provenance, mutation floor, local-grid mode, and exact earned/spent alloy; valid v5/v4 campaign sessions migrate forward, and an unreadable current save can fall back without consuming the older recovery source. These checks detect corruption and inconsistent edits, but they are not a security boundary against a user who controls both the browser code and every localStorage field.

The optional `?showcase` URL opens the dense warm-start visual factory. It is fully simulated: extractors deplete seeded resources, twin-lane belts preserve spacing and backpressure, dispatch manifolds split, merge, prioritize, and extract physical payloads, inserters transfer items, machines consume recipes, local generators dispatch deterministically, and beacons boost nearby production. Inserters connect to dispatch manifolds through a one-tile belt adapter; direct inserter/manifold custody is intentionally rejected because manifold branch topology has no single unambiguous arm contact.

Blueprints capture construction intent—not runtime inventory, payload identity, craft progress, or power state—into a strict, byte-stable v2 local clipboard. Area or selected-unit copies preserve orientation, the newest queued recipe target, and the manifold's exact local A/B policy (including the latent Extract selector); every reflection swaps local ports and v1 clipboards migrate to A without being stranded. Placement preflights every footprint, unlock, recipe, and aggregate alloy cost before committing the entire group as one undoable transaction. Exact existing units are recognized as zero-cost matches, while differing recipes or routing are reapplied atomically without rebuilding the machine.

The in-game blueprint library stores named plans and ordered books to six levels, persists canonical v2 bytes, and supports strict atomic import/export share strings. Its kernel rejects duplicate keys, stale catalogs, malformed Unicode, prototype/accessor tricks, over-depth trees, and oversized archives before live state changes.

## Validate

```bash
npm test
npm run build
```

With the development server running:

```bash
npm run qa
npm run qa:readability-audio
npm run qa:audio
npm run qa:motion
npm run qa:silhouette
npm run qa:terrain-pan
npm run qa:smelter-cycle
npm run qa:surface
npm run qa:causal-cell
npm run qa:materials
npm run qa:manifold
npm run qa:inserter-custody
npm run qa:inserter-scale
npm run qa:extractor-cycle
npm run qa:process-console
npm run qa:process-world
npm run qa:local-grid
npm run qa:uplink
npm run qa:blueprint-overlay
npm run qa:blueprint-ui
npm run qa:blueprint-library
npm run qa:fluid-core
npm run qa:fluid-visual
npm run qa:circuit-simulation
```

The M1 release gate is stricter than the general browser suite: it must cover
the complete Bootstrap → earned-alloy Throughput arc and the independent AAA
visual review. Build and run the production preview, then invoke `npm run qa:m1` with a unique
`CINDERLINE_M1_OUTPUT` directory as documented in
[MILESTONE-M1.md](./MILESTONE-M1.md).

`qa:readability-audio` captures the native 1920×1080, 1366×768, 390×844,
and 320×568 HUD states and enforces the release typography, touch-target,
overflow, post-output loudness, headroom, first-gesture, and mute-transition
gates. `qa:audio` provides a focused cue-by-cue mix report. Run both against the
same production preview used for release evidence.

Browser QA verifies the sparse campaign start, locked capabilities, paid placement/refund/undo/redo, single- and multi-unit blueprint transactions, exact-match and zero-cost configuration reapply, drag-marquee capture, mirrored Extract-B and latent Even-B routing, blueprint v1→v3 migration, nested blueprint-library CRUD/reassign/duplicate/reorder/recoverable-delete/import/export, an exhausted-grid black-start, atomic v6 persistence, v4 campaign recovery, v2 sandbox migration, physical Uplink cargo consumption, Bootstrap rewards, pause controls, responsive layout, console health, simulation progress, and captures desktop/mobile blueprint layouts plus 1920×1080 and 1366×768 world screenshots under `.qa/`.
Motion QA also proves that at least 40 persistent physical payloads traverse real belt state while the production line remains active, then captures a four-frame visual contact sheet.
The focused visual gates isolate non-emissive machine silhouettes, closest-zoom terrain motion, six deterministic smelter phases, and machine-to-ground support geometry for controlled regression review.
Causal-cell QA renders a deterministic four-frame copper plate → copper wire → storage proof while asserting the real transfer and production event chain.
Material QA freezes and isolates one full-color representative of every machine family, then captures a labeled contact sheet for controlled palette and surface-response review.
Inserter custody QA proves exact pickup, lift, carry, drop, and release contact against authoritative belt state. Inserter scale QA exercises 250 independently phased, payload-carrying arms in performance mode, enforcing draw-call, triangle, frame-time, quality-roundtrip, teardown, and console-health budgets while capturing `.qa/inserter-scale/performance-250.png`.
Extractor-cycle QA captures six captionless mechanical stages plus the real post-wrap discharge, proving drill/ground and chute/payload contact, carriage travel, cutter rotation, chute aperture, exact resource-to-item conservation, ordered production/transfer events, and the extractor rig-cost budget.
Process-console QA drives real mouse and keyboard recipe commands through unconfigured, starved, working, queued/undo/requeue, and output-blocked/reclaim states at 1920×1080 and 1366×768. It also proves exact authoritative buffers and event ordering, persistent card identity, mobile-sheet behavior, reclaim-first extraction, frame-time parity, and targeted live UI without browser warnings.
Process-world QA proves that the same authoritative machine states drive physically attached, rotation-correct world mechanisms: standardized geometric recipe dies, rear input hopper, chamber strobe, twin-die queue shuttle, full output gate, open power breaker, ready dock, and orthogonal source-only reclaim bin. It captures eleven captionless fixtures spanning all seven process states and every Fabricator/Smelter recipe identity including Auto-smelt, produces labeled and deterministic blind A–K sheets plus an untouched live-factory context capture, and verifies a five-draw-call shared performance LOD across 128 mixed machines with incremental triangle/frame-time limits, exact quality roundtrips, and two-cycle teardown budgets.
Local-grid QA verifies relay coverage, network-specific cables, selection overlays, performance batches, placement ghosts, and exact zero-state teardown. Uplink QA exercises the real campaign receive path from inbound payload through secured custody, empty carriage return, targeted-manifest interlock, surplus non-gating cargo, and transmission; it also covers every ItemId silhouette, normal/performance picking, matched-visibility memory restoration, and full rig teardown.
Blueprint-overlay QA drives a real drag capture, placement, and mixed semantic revalidation, then proves marquee inclusion tint, NEW/CONFIG/MATCH/BLOCKED world states, complete 4,096-unit silhouettes, the 96-rig authored-detail cap, bounded batching, responsive frame time, and clean console output while capturing each visual state.
Fluid-core QA proves fixed-point conservation, powered transfer, splits/merges, incompatible-fluid arbitration, processor blocking, topology edits, hostile restore rejection, and deterministic continuation. Fluid-visual QA then constructs and runs a real 2,400-tick powered refinery, requires exact produced-versus-stored mass, and captures the authoritative source → pump → tank → processor → product route with renderer telemetry.
Circuit-simulation QA proves delayed signal publication, combinator placement, real inserter filtering, manifold sorting, power switching, fluid-pump isolation, exact save continuation, hostile endpoint validation, and v6→v7 migration.

## Art

All machine geometry, icons, effects, shaders, interface design, audio synthesis, and gameplay code are original. The terrain material is an original generated project asset; no Factorio assets are shipped.
