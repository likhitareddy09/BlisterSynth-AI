# Phase 8: UI polish (frontend only, v0.8.0)

The backend is unchanged (still 0.7.0, all backend tests untouched).

## 1. The 10 weakest spots, and the fixes
1. **Phone top bar had no identity.** It now shows the logo mark and the page title, and the status counts are grouped into one pill.
2. **Stat cards truncated their labels and stacked badly on phones.** Labels now wrap, and icons are hidden on small screens.
3. **Tables were clipped on phones** (Runs, Data Lab, PdM, Generative). They now stack into cards (`.table-stack`), and the row actions fit on one line.
4. **Empty or uneven cards** ("No jobs yet", the model cards). These now have proper empty states and consistent spacing.
5. **The digital twin was cut off on phones, and the station chips were uneven.** The twin now snaps and scrolls sideways, and the chips sit in an even 2×4 grid.
6. **The station panel on the Live page started blank.** It now opens on the weakest station.
7. **Heatmaps and the KS table were unreadable on phones.** They now scroll sideways inside their card (and only on phones).
8. **Buttons got squeezed and tap targets were small.** All touch targets on phones are now at least about 40 px, and sliders have a 32 px touch area with a filled track. Form text is 16 px on phones, which stops iOS from zooming in.
9. **Hero on phones:** the text was cramped and decorations overlapped it. The headline now flows naturally and the controls sit on their own row.
10. **The dark mode pastels looked muddy, and one link was wrong** (Features pointed to the wrong place). The pastels are retuned, and the Quality Report link now goes to `/app/quality`.

I also fixed two layout bugs. Wide content inside grid cards widened the whole page on phones (fixed with `min-w-0` on cards and `grid-cols-1`). And the hero kept a tall empty block when reduced motion is on. Every page now has no sideways scroll at 360 px and 390 px.

## 2–5. What was built
- **Cinematic hero (`Hero.tsx`, `lib/hero.ts`).** Tablets drop from the nozzle into a 10-pocket pack as you scroll. It adds soft light rays, blurred foreground and background capsules for depth, and a word-by-word headline on load. Screen readers get the full headline.
- **Scroll story (`LineStory.tsx`, `lib/story.ts`).** The camera zooms through the line → forming → filling → sealing → punching, and each chapter's text slides in. It has a chapter rail and a progress bar. With reduced motion it falls back to static cards.
- **Control room (`Overview.tsx`, `DialGauge`, `MiniLine`, `KpiStrip`).** The biggest number is the health of the worst station. It also has dial gauges, a small animated line with green, amber and red lights, and ticking counters.
- **Tactile touches:**
  - Buttons press in like foil (`.press`).
  - A synthesised "pop" sound plays when you pop a tablet, with a mute toggle that is remembered.
  - A faint foil shine follows the mouse on cards.
  - The cursor turns into a tablet over pockets you can pop.
  - A "Pause motion" toggle stops the looping animations.

## 6. Five ideas from Uhlmann, Romaco, Recursion, Ginkgo and Moderna (adapted, not copied)
1. A guided "What do you want to do?" selector in the hero (Uhlmann)
2. Key figures, each with its context (Uhlmann / Moderna)
3. A monospace "instrument" voice and a running spec ticker (Recursion)
4. Pipeline-stage bars, used here for the readiness table (Recursion)
5. A process-chain story along the machine, plus a pause-motion control (Romaco / Moderna)

## 8. Trust section: honest by design
There are **no GMP, FDA 21 CFR Part 11 or ISO badges, and no made-up testimonial.** The app holds none of these certifications, so showing badges would be false. Instead the section has:
- **A readiness table.** It shows how far each item has got (none are certified) and names the backend test that backs each product claim.
- **"How your data stays safe".** Every statement in it has been checked against the code: local storage; only the typed prompt goes to Claude; the API key is masked; deleting really removes the files. It also says that there are no user accounts yet.
- **A case-study card** filled with *your own* result. Run the PdM "imbalance fix" experiment once and the card on the landing page shows your numbers.

## Tests
- `src/lib/phase8.test.ts`: 34 tests (scroll maths, hero, camera, counters, gauge, case study, readiness, sound, foil).
- `src/phase8.test.tsx`: 13 tests (hero pack and selector, toggles, story, trust section, control room).

Run:
```
cd frontend
npm install
npm test
npm run build
```
