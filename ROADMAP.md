# Diagram reviewer roadmap

Seven reports about diagram reviewers, ordered into three releases. Each item names the
current behaviour, the cause in the code, the smallest change that fixes it, how to test it,
and what would count as done.

Status: planning only. Nothing in this document has been implemented yet.

Assumptions: one developer who knows `js/app.js`, estimates include tests and docs but not
review or deployment. Total: roughly 9–13 working days.

## How the work is ordered

1. **Fix what is wrong before adding options.** The identical question order teaches the pin
   number instead of the diagram, and a keyboard-only student cannot author a reviewer at all.
   Both are defects against the project's own rules, so they ship first.
2. **Then unlock the editor.** Editing is the most expensive item because it forces stable item
   ids, and those ids are also what make question order, multiple choice and progress survive
   re-renders. Doing it before the practice features avoids building them twice.
3. **Practice options last.** Multiple choice and zoom change how a question looks, not how the
   data is stored, and neither is needed to fix a wrong answer.

If dense diagrams are the loudest complaint from real users, promote R3.2 (zoom) above R2.1
(editing). Nothing in R3.2 depends on the editor.

## Traceability

| # | Report | Work item | Release |
|---|---|---|---|
| 1 | Every question is the same; shuffle the order | R1.1 | 1 |
| 2 | The 26 px marker is hard to hit; no nudge | R1.3 | 1 |
| 3 | You can't edit a diagram reviewer afterwards | R2.1 | 2 |
| 4 | Adding a part is keyboard-hostile | R1.3 | 1 |
| 5 | Only free-typed answers; optional multiple choice | R3.1 | 3 |
| 6 | No zoom | R3.2 | 3 |
| 7 | Pin numbers use a fixed colour | R1.2 | 1 |

The user's items 2 and 4 are one change: a marker you can focus, drag and nudge. Splitting them
would build the same control twice.

## Project rules this work must keep

These are already stated by the project and are treated as acceptance criteria, not preferences.

- **Keyboard parity.** Every action a pointer can take must be reachable and operable from the
  keyboard. `README.md` promises keyboard shortcuts and focus management; the app implements a
  global key handler in `js/app.js` and moves focus to the new screen's heading in `draw()`.
  The diagram's `<img onclick>` is the one place that breaks the promise.
- **Colours come from CSS variables.** `css/styles.css` defines every colour in `:root` and the
  two dark-theme blocks, and only the print block overrides them. The pin numbers hardcode
  `#14213d` and `#fff` instead.
- **No dependencies, no build step, no network.** `package.json` has no dependencies and the
  tests use Node built-ins plus a DOM stub. Any new test must follow that.
- **Bump `VERSION` in `sw.js` whenever a shipped file changes.** Cache-first means phones keep
  the old copy until the name changes. One bump per release, after the last commit.
- **Keep the README honest.** `README.md` has a "Diagram reviewers" section and a "Known limits"
  list that must describe whatever changes.

## Where diagram reviewers live today

Verified against the current tree.

| Area | Code |
|---|---|
| Editor state and screens | `diagBlob`, `diagURL`, `diagParts`, `diagPending`, `diagNameText`; `pickDiagram()`, `addPart()`, `createDiagram()`, `diagramSetup()`, `clearDiagram()` in `js/app.js` |
| Saved item shape | `{ id, type: 'img', q, answer, imageId, hotspot: {x,y}, exp }`, built in `createDiagram()` |
| Validation and backup | `cleanItem()`, `cleanReviewer()`, `cleanBackup()` in `js/app.js`; `opts` is whitelisted to `{ max, mcOnly }` |
| Practice surfaces | `quiz()`, `flipcards()`, `recite()`/`reciteQuestion()`, all rendering through `imageBlock()` |
| Grading | `answer()` branches on type; `img` is graded by `idOk()` in `js/reviewer-generator.js` |
| Marker look | `.diagram`, `.pin`, `.pin b`, `.pin.pending` in `css/styles.css` |
| Tests | `tests/app-smoke.js` (DOM stub, no `getBoundingClientRect` or pointer events), `tests/check.js` (grading) |

Three findings that change the shape of the work:

- Item ids for diagrams are positional (`img0`, `img1`, …) and `createDiagram()` always makes a
  new reviewer. Editing therefore needs random, stable ids and an update-in-place path.
- `imageURL()` caches object URLs per image id and `dropImage()` revokes them. An editor must
  reuse the cached URL and must not revoke an image another screen still shows.
- `.pin.big` is applied by `imageBlock(it, big)` on the flashcard answer side but has no CSS
  rule, so the answer pin is not actually bigger. Fold the fix into R1.3.

## Release 1 — correctness and the marker (`sw.js` v4; v3 shipped label covers)

### R1.1 Shuffle diagram question order

**Reported:** every question reads "Identify the part marked on the diagram", so the pin number
is learnable from the dot rather than the diagram.

**Cause:** all diagram items share the same literal `q`. `quiz()` renders the items in array
order, `startFlash()` builds `flashOrder` from array order, and `recite()` walks `r.items` in
order. Creation order is also the number shown next to each label on the setup screen, so the
first question is always part 1.

**Change:** a session-scoped display order for `img` items.

- Add `diagOrder` (an array of item positions) next to the existing `flashOrder`. Build it in
  `open()` and on `Shuffle`, using the shared `shuffle()` helper from `js/reviewer-generator.js`.
- Map `mine` in `quiz()` through `diagOrder`; have `startFlash()` and `recite()` reuse the same
  order so a flashcard and a quiz item never disagree about which part is next.
- Do **not** shuffle on every render: `quiz()` is redrawn after each answer, so a fresh random
  order would move the item under the student's finger and move focus.
- Keep `cur.ans` keyed by item id, so answers survive a reorder and "Retry missed" preserves the
  order of the remaining items.
- Leave text reviewers alone unless the same one-line change is provably safe; if it is, apply
  it to every reviewer type rather than special-casing `img`.

**Not claimed:** this stops positional memorisation, not a student memorising the authoring
screen. That screen is the author's tool, and hiding its labels would break authoring.

**Tests** (`tests/app-smoke.js`): the built order is a permutation of the item ids; with a
stubbed random source two builds differ (do not assert on `Math.random()`, a three-item
reviewer can legitimately produce the same order); every id still grades correctly; quiz,
flashcard and recitation orders agree; shuffling does not clear `ans` or the study plan.

**Done when:** two practice sessions of the same reviewer do not start with the same part, and
no answer key moved.

Effort: S (0.5–1 day).

### R1.2 Pin-number contrast tokens

**Reported:** pin numbers are drawn in a fixed colour on `--acc`, a contrast risk, against the
project's CSS-variable rule.

**Measured today** (WCAG relative luminance, 4.5:1 required for 12 px bold text):

| Pin | Text on background | Light | Dark |
|---|---|---|---|
| Numbered pin | `#14213d` on `--acc` | 5.49:1 | 7.56:1 |
| Pending pin | `#fff` on `--bad` | 5.44:1 | **2.53:1 — fails** |

So the numbered pin passes in both themes, but the pending pin's number is unreadable in dark
mode today: the theme swaps `--bad` from `#c0392b` to the much lighter `#ff7b6b` while the text
stays hardcoded white. The right foreground also differs per theme — `#14213d` on `#ff7b6b` is
6.31:1 in dark, but the same dark ink on the light theme's `#c0392b` is only 2.94:1. One fixed
literal cannot be correct for both, which is exactly why this needs a token.

**Change:**

- Add semantic tokens in the three theme blocks (`:root`, `prefers-color-scheme: dark`,
  `[data-theme=dark]`): `--on-acc` and `--on-bad`. Suggested values: `--on-acc: #14213d` in both
themes; `--on-bad: #fff` in light, `--on-bad: #14213d` in dark. The print block inherits both
because it does not override `--acc` or `--bad`; add them there only if that changes.
- Use `color: var(--on-acc)` in `.pin b` and `color: var(--on-bad)` in `.pin.pending b`. Remove
  both literals from the diagram block. The visible result in dark mode is a dark glyph on the
  light coral pending pin instead of white on coral.
- Add `tests/css.js` (Node built-ins only) to `npm test`: read `css/styles.css`, confirm both
  tokens exist in each theme block, compute contrast against `--acc`/`--bad`, and fail below
  4.5:1. Optionally also fail on a hex/rgb literal inside the diagram section, which is the
  rule the project cares about.
- Keep the existing `@media (forced-colors: active)` block in mind; if the pin disappears in
  forced-colors mode, add the same border treatment the options already use.
- Related observation, optional: the accent circle against a white card is only about 2.9:1,
  just under the 3:1 non-text threshold. The 3 px card-coloured ring is what separates the pin
  from the diagram, so a hairline outline in `--edge` would make the marker robust on pale
  diagrams. Fold it in only if the visual check shows a problem.

**Done when:** the pending pin's number is legible in both themes, the diagram CSS contains no
colour literal, and a theme change that breaks the pin text fails the test suite instead of
shipping.

Effort: S (0.5 day).

### R1.3 A marker you can hit, drag, nudge and reach by keyboard

**Reported:** 26 px is hard to hit on a phone; a tap sets the position with no way to correct
it; and because placement is `onclick` on a plain `<img>`, keyboard-only users cannot add a
part at all.

**Cause:** `.pin` is a 26 px `aria-hidden` span; the only placement path is
`h('img', { onclick })` in `diagramSetup()`; no key handler is scoped to the diagram and the
global one returns early for inputs.

**Change:** one marker control, used by both reports.

- **Bigger target.** Raise the visual pin to 32–36 px and give it a 44×44 transparent hit area
  (a pseudo-element or a wrapping button) so the tap target meets the touch size the rest of the
  app already uses. Keep the dot visually small enough not to cover much diagram.
- **Draggable pending pin.** Use pointer events with `setPointerCapture`, `touch-action: none`
  on the pin only, and clamp to 0–1. A drag must not scroll the page and must not place a
  second pin.
- **Keyboard placement.** Add a real `<button>` — "Place marker at centre" — that creates a
  pending pin at the image centre (or the last pinned position) and focuses it. The marker
  itself becomes a focusable button labelled with its part name and position, so arrow keys
  nudge it (0.5% of the image per press, 2% with Shift), Enter commits to the parts list, Esc
  cancels, Delete removes it while editing. The image keeps its click handler as a pointer
  shortcut. Do not add `tabindex` plus a click handler to the `<img>`: a button is native,
  focusable, and needs no `role` or key emulation.
- **Nudge once saved.** Dragging and arrow-nudging a placed pin in the editor is the other half
  of R2.1's "move a pin" complaint and comes free with the same control.
- **Announcements.** Update the existing `say()` live region when a marker is placed or moved
  with the keyboard, debounced so arrow-key repeats do not flood a screen reader.
- **Fix `.pin.big`.** Give it a rule or remove the class from `imageBlock()`; today the
  flashcard answer pin is silently the same size.
- **Testability.** Extract the geometry into pure functions — `pointFromRect(rect, clientX,
  clientY)`, `clampHotspot(h)`, `nudgeHotspot(h, dx, dy)` — because the DOM stub in
  `tests/app-smoke.js` has no `getBoundingClientRect` and no pointer events. Test the functions
  directly and use the stub only to assert wiring (button present, label, style position).

**Tests:** normalising a click at the image's corners yields 0 and 1; clamping rejects
out-of-range values; a nudge keeps the hotspot inside the image; arrow keys on the focused
marker change only that marker; the full flow "choose image → place three markers → name them →
create" completes with keyboard events only.

**Done when:** a marker can be placed and corrected on a 375 px phone without redoing the
reviewer, and a keyboard-only user can author one.

Effort: M (1.5–2 days, including the pure helpers and tests).

## Release 2 — editing a saved reviewer (`sw.js` v5)

### R2.1 Edit labels, pins and title after saving

**Reported:** a typo in a label or a pin a few pixels off means remaking the whole reviewer;
the editor state is discarded on save.

**Cause:** `createDiagram()` always allocates a new `imageId`, builds items with positional ids,
`R.unshift(r)` creates a new reviewer, then `clearDiagram()` drops the in-memory parts. The home
card offers Open and Delete only.

**Change:**

1. **Edit mode.** Add `diagEditing` (reviewer id, null for a new one). An "Edit labels" action
   in the quiz screen's "More options" loads the saved reviewer into the existing editor: `diagParts` from
   `r.items` (label + hotspot), `diagTitleText` from `r.title`, and the image through
   `imageURL(r.items[0].imageId)`. Reuse the cached object URL; do not revoke it on exit, since
   `imageURL()` owns that cache and other screens may be showing it.
2. **Save in place.** When `diagEditing` is set, update `r.items` and `r.title` instead of
   unshifting a new reviewer. Keep `r.id`, `r.ans`, `r.flashKnown`, `r.flashLearn` and
   `r.plan.srs` for items that still exist.
3. **Stable ids.** New parts get a random id (`'img_' + …`), and existing ids are never rewritten
   when a part is renamed or its pin is nudged. Removing a part must not renumber its siblings:
   `ans`, `plan.srs`, `flashKnown` and `flashLearn` are all keyed by id. Old positional
   `img0…` ids keep working; migration is "leave them alone".
4. **Prune progress on removal.** Delete the removed id from `ans`, `plan.srs`, `flashKnown` and
   `flashLearn`. On rename, keep the schedule but clear `ans[id]` for that item, because the
   stored answer text (`exp`) and the typed value refer to the old label. Document that choice
   in a comment; it is the only defensible option without asking the student.
5. **Minimum three parts.** The create button already requires three; saving an edit must use
   the same rule, matching `cleanReviewer()`'s `items.length < 3` rejection.
6. **Replace the image (optional, same release).** If a new image is chosen while editing, write
   a new `imageId` and drop the old one only if no item still references it. Normalised hotspots
   remain valid when the new image is the same diagram, which is the common case.
7. **Race safety.** Keep the existing `diagToken` guard and make sure an edit cancelled or
   superseded mid-save never drops an image that is in use.
8. **Entry points.** The reviewer screen is the right home; adding a small "Edit" button to the
   home card is optional and would crowd a card that already has Open/Delete.

**Data and backups:** no schema change is strictly required, because items already carry the
label, hotspot and image id. `cleanReviewer()` already keeps only the `ans`/`plan` entries whose
ids exist, so removals prune themselves on import. Editing must produce items that pass
`cleanItem()` unchanged (normalised hotspot, label present, same image id).

**Tests:** create → edit a label → save → reopen: title and label update, `r.id` is unchanged,
untouched items keep `ans`/`srs`; moving a pin keeps the id and progress; removing a part prunes
every per-item map; adding a part gets a fresh unique id; export → import preserves the edited
reviewer; leaving the editor without saving leaves the reviewer untouched.

**Done when:** a typo fix or a pin move takes under twenty seconds, keeps every other item's
progress, and produces the same saved shape the app already validates.

Effort: L (3–4 days). This is the largest item and the one most worth doing carefully.

**Deliberately not included:** resuming an unfinished new reviewer after a reload or an
accidental navigation. That is a separate draft-persistence feature (a temporary image in
IndexedDB plus a draft record) and is not what the report asks for. If it is wanted, it should
be its own item after R2.1.

## Release 3 — practice options (`sw.js` v6)

### R3.1 Optional multiple choice from the diagram's own labels

**Reported:** "left ventricle" and "ventricle, left" are graded by the same `idOk()` as ordinary
identification; typing on a phone is the friction; an optional multiple-choice mode using the
other labels would help.

**Cause:** `img` items are always free-text. `answer()` routes `img` through `idOk()`;
`cleanItem()` has a working `mc` type with 2–4 options, but diagrams never use it.

**Change:**

- **Opt-in setting per reviewer:** `opts.diagramAnswer = 'type' | 'choice'`, default `'type'`.
  Show it on the reviewer screen next to the existing options ("Answers: type the name / choose
  from the labels"). Add the key to `cleanReviewer()`'s opts whitelist, or imported backups will
  silently drop it.
- **Build the choices** from the reviewer's own labels: the correct label plus up to three
  siblings, never duplicating the answer. Seed the option order from the item id so re-renders
  after answering do not move the options. Three labels give a three-option item; four labels
  are needed for a full set of four, and the editor's three-part minimum does not guarantee that.
- **Keep the stored type as `img`.** Render option buttons when the setting is `choice`, reusing
  the `.opt` markup and the `answer()` path for `mc` (index in `ans.val`, label in `ans.exp`).
  Keeping `img` means old backups, flashcards, recitation, export and `cleanItem()` stay valid.
  Do not convert the saved item to `mc`.
- **Keyboard:** the `1–4` shortcut is currently gated on `tab === 'mc'`; extend it to diagram
  items in choice mode.
- **Recitation:** `reciteQuestion()` says "Look at the diagram" for `img`. In choice mode the
  voice must either read the options or the reviewer should refuse to recite choice items and
  ask for typing. Reading the options is the fair choice; decide before implementing, because a
  silent options list makes an oral drill unanswerable.
- **Trade-off, state it in the README:** distractors are other labels on the same diagram, so a
  student can sometimes answer by elimination using the other questions. That is acceptable for
  a study aid and is why the mode is opt-in, not the default.
- If the reviewer has only three labels, still offer three options rather than hiding the mode;
  a two-option item is legal in `cleanItem()` but teaches little.

**Tests:** the builder returns 3–4 unique labels, never the answer twice, and the same order for
the same item id; a choice answer is graded by index; switching the setting does not alter the
saved items; typed mode is unchanged; import/export keeps the setting; the keyboard shortcut
answers a diagram choice item.

**Done when:** a phone user can practice a diagram without typing, and a reviewer left on the
default behaves exactly as before.

Effort: M (2 days).

### R3.2 Zoom and pan that keep the marker in view

**Reported:** a small label on a dense diagram cannot be zoomed in, and the pin covers the
detail you are trying to read.

**Cause:** `.diagram img` is `max-width: 100%` with no scale state; `imageBlock()` renders the
image and one pin inside a single inline block, so there is nothing to zoom or pan.

**Change:**

- Wrap the image and pin in a viewport with `overflow: hidden` and its own transform state.
  Supports pinch (two pointers), a `− / 100% / +` control and a "Fit" reset, 1×–4×, and
  drag-to-pan with clamped bounds so the image cannot be lost. Keyboard: `+`, `−`, `0` when the
  viewport has focus.
- **Zoom on the marker, not the centre.** The reason to zoom is the detail under the pin, so
  provide "Zoom on marker" and keep it in view while panning; a centre zoom usually moves the
  part off-screen.
- **Keep pins a constant screen size** by scaling them inversely (`scale(1/k)`), so they cover
  proportionally less detail as the user zooms in. Add "Hide pin" for study and for reading a
  label a pin happens to sit on, with the answer still shown in the feedback area.
- **Coordinates stay correct:** hotspot math is against the untransformed image box, so pins
  never drift with zoom. Extract `clampZoom`, `clampPan` and `hotspotToScreen` as pure helpers
  and test them, because the DOM stub has no layout.
- **Do not hijack browser zoom.** Do not intercept ctrl+wheel globally and do not add
  `user-scalable=no` to the viewport meta (the app currently allows browser zoom). Prefer the
  on-screen controls and pinch; if wheel zoom is added, require the diagram to be focused.
- Respect `prefers-reduced-motion`: no animated zoom transition.

**Tests:** zoom clamps to 1–4 and resets; pan clamps to the image bounds; a hotspot's screen
position matches its percentage at every zoom level; rendering the same item at 1× and 3× keeps
the saved hotspot untouched.

**Done when:** a dense diagram's smallest printed label can be read on a phone, the pin does not
hide it, and no other screen's zoom or scroll behaviour changed.

Effort: L (2–3 days).

## Cross-cutting work

- **Pure helpers first.** `pointFromRect`, `clampHotspot`, `nudgeHotspot`, `diagramOrder`,
  `buildChoices`, `clampZoom`, `clampPan`, `hotspotToScreen`. They are the only part of this
  work the current DOM stub can test well, and they keep the screen functions readable.
- **Tests to add:** unit checks for the helpers, model checks in `tests/app-smoke.js` (order,
  stable ids, edit-in-place, option building, import/export round-trip), and one scripted
  keyboard-only authoring pass. `npm test` must stay dependency-free.
- **Manual checks that the stub cannot cover:** a phone-sized viewport, a full keyboard
  walkthrough, 200% browser zoom and reflow, a screen-reader pass over the editor, and dragging
  with a touch emulator. Report these as pending until someone actually does them.
- **Docs:** update the "Diagram reviewers" steps in `README.md` (place, drag or nudge, edit,
  choose answer mode, zoom) and the "Known limits" list (choice-mode elimination, gesture
  conflicts, pin size on large diagrams). Add the new test file to the test list if one is
  added.
- **Release mechanics:** one `VERSION` bump per release (`v3` → `v4`, `v5`, `v6`) after the last
  commit in that release, then verify the app reloads once and the offline copy updates.

## Schedule

| Work item | Effort | Depends on | Ships in |
|---|---|---|---|
| R1.1 Shuffle diagram order | S (0.5–1 d) | — | v4 |
| R1.2 Contrast tokens + CSS check | S (0.5 d) | — | v4 |
| R1.3 Marker: 44 px, drag, keyboard, nudge | M (1.5–2 d) | — | v4 |
| R2.1 Edit a saved reviewer | L (3–4 d) | R1.3 (marker control), stable ids | v5 |
| R3.1 Multiple choice from sibling labels | M (2 d) | R2.1 (stable ids, opts whitelist) | v6 |
| R3.2 Zoom and pan | L (2–3 d) | — (can be promoted) | v6 |

Start here: R1.2 first (half a day, and it fixes a real dark-mode failure), then R1.1, then the
marker rework in R1.3. Release 1 is about three days and removes the two defects that make the
feature unfair or inaccessible. Release 2 is the one users will feel most. Release 3 is optional
polish that can be reordered by user feedback.

## Risks and open decisions

| Risk | Mitigation |
|---|---|
| Shuffling on every render moves the question and the focus | Session order array, rebuilt only on open or explicit shuffle |
| Editing reassigns ids and silently loses progress | Random stable ids, no renumbering, prune only removed ids, test the round-trip |
| A drag places a pin on pointer-up too, so two pins appear | Separate "drag a marker" from "tap the image"; guard with pointer capture and a moved threshold |
| Pinch and page scroll fight each other | `touch-action` only on the marker/viewport, clamped pan, test on a real phone |
| Wheel/ctrl-wheel zoom breaks browser zoom | Controls and pinch first; never disable page zoom; wheel only when focused |
| Multiple choice leaks answers through sibling labels | Opt-in, documented, default stays typed |
| New CSS token forgotten in a future theme | Contrast test fails the build rather than a manual check |
| Tests cannot simulate layout | Pure geometry helpers; keep DOM tests to wiring and model state |

Decisions needed before starting R3:

1. Is choice mode per reviewer, or a global preference? Per reviewer is recommended, because a
   dense map and a three-label cell diagram want different defaults.
2. In choice mode, should recitation read the options aloud, or skip those items? Reading them
   is recommended.
3. Should shuffle apply to text reviewers too? A one-line win if the ordering code is shared;
   keep it if it does not special-case diagram items.
4. Is image replacement part of "edit", or a separate action? Same release is fine, but it needs
   an explicit confirmation that progress is preserved because the pins keep their coordinates.

## Out of scope

- Automatic label or arrow detection in an uploaded image. The README already says labelling is
  manual by design, and that stays true.
- Converting a typed reviewer into a diagram reviewer, or the reverse.
- A drawing/annotation tool, colour-coded pins, or per-pin notes.
- Cloud sync or accounts; reviewers stay local and exportable.
- Draft resumption for an unfinished new reviewer (see R2.1).

## Definition of done, per release

- `npm test` passes, including the new checks, with no skipped assertions.
- A keyboard-only run of the feature works and focus stays visible.
- The changed screen works at a 375 px width and at 200% browser zoom.
- Export/import round-trips a reviewer containing the new data.
- `README.md` describes the new behaviour and its limits.
- `VERSION` in `sw.js` is bumped exactly once for the release.
- The doc and comments explain *why*, matching the rest of `js/app.js`.
