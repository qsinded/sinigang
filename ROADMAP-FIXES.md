# Fixes roadmap

The plan for the complaints raised after a week of real use: lost progress, uneditable
questions, an exam date that does not schedule anything, untrusted input, no sharing, and
diagram practice that is still a demo.

`ROADMAP.md` already covers diagram reviewers in detail (R1.1–R3.2). This document covers
everything else and adopts those items by reference instead of designing them twice.

Status: **Phase 0 implemented, uncommitted.** Phases 1–6 planned. Nothing in this repository
is committed without the owner's approval.

## What a user complained about, and where it is fixed

| # | Complaint | Phase |
|---|---|---|
| 1 | Shuffle wipes every answer, card mark and study-plan entry | 0 |
| 2 | Removed junk questions come back on the next shuffle | 0 |
| 3 | A generated question cannot be edited, added or restored | 1 |
| 4 | "All" silently stops at about 68 items, with no explanation | 3 |
| 5 | The exam date never affects the schedule; due items arrive in one wall | 2 |
| 6 | Enumeration is all-or-nothing; "Count it correct" cannot be undone | 2 |
| 7 | Handouts that are scans or photos produce nothing | 3 (decision) |
| 8 | One reviewer cannot be shared; importing a backup duplicates it | 4 |
| 9 | Diagram pins are tiny, cannot be moved or zoomed, and cannot be edited later | 5 |
| 10 | No per-section stats, one-question-at-a-time mode, or consistent app name | 6 |

## Baseline (before Phase 0)

Recorded on the current tree, Node 24.21.0, 2026-10-29:

- `npm test` — `all checks passed`, `app smoke checks passed`, `offline checks passed`.
- `npm run quality` — 1000 questions checked, every count at its baseline of 0
  (`leak`, `dupOptions`, `badKey`, `outlineOption`, `tooShort`, `ungrounded`,
  `dupQuestion`, `falseTrueMismatch`, `filler`, `ambiguous`, `variant`, `tfFragment`,
  `tfMeta`, `instruction`).
- Corpus: biology 107 mc / 43 id / 25 enum from 7 of 9 substantial lines; architecture
  150/75/50 from 11 of 19; exam paper 130/45 from 7 of 13; networking 255/95/25 from 15 of 16.

A phase may not raise any quality count. Lowering a count requires lowering its baseline in
the same commit.

## Rules every phase keeps

- **Local only.** No dependency, no build step, no network. A feature that needs a server is a
  product decision, not an implementation detail.
- **Every new saved field is validated in `cleanReviewer()`.** A hand-edited backup must not be
  able to crash a screen, blank a reviewer, or fill storage.
- **Keyboard parity.** Anything a pointer can do is reachable from the keyboard, and focus is
  visible.
- **No silent data loss.** Rebuilding, importing or deleting must either keep progress or say
  what was lost, with a number.
- **Tests stay dependency-free.** `npm test` is Node built-ins plus the DOM stub.
- **`README.md` is updated in the same change**, including "Known limits".
- **One `VERSION` bump per release**, in `sw.js`, after the last commit of that release.
- **375 px, 200% zoom and print** are checked by hand before a phase is called done.

## Phase 0 — Keep what I've earned (done)

**Goal:** make the data model safe to build on. Every later feature assumes that a question
can be recognised after the set is rebuilt and that a deletion means deletion.

**What changed**

- `js/reviewer-generator.js`: `itemKey(it)` identifies a factual question by its normalised
  question and answer text, ignoring id, punctuation, case and spacing. `carryProgress(old,
  new, progress)` moves answers, known/learning marks and Leitner boxes onto a rebuilt set.
  Answers only carry between the same display type (a typed answer has no index in a new
  multiple-choice item); mastery follows the fact across formats. Duplicate keys are left
  alone rather than guessed.
- `js/app.js`: reviewers gain a validated `hidden` array of keys, capped at 400 entries of
  600 characters. Removing a question on the check screen records its key; `Shuffle` filters
  those keys out of both the rebuilt set and the fallback reorder. Shuffle no longer asks for
  permission to destroy progress because it no longer destroys it; it reports
  "Kept progress for N of M items" instead.
- `cleanReviewer()` refuses a backup that would hide so many questions that fewer than three
  remain visible.
- `sw.js`: `VERSION` v5 → v6 (shipped scripts changed).
- `README.md`: practice modes and the removal limit now describe the behaviour.

**Tests added**

- `tests/check.js`: key normalisation; an answer follows its question; a chosen option follows
  its text when options are reordered; no answer across a format change; mastery across a
  format change; duplicate keys and changed answers do not steal progress.
- `tests/app-smoke.js`: a removed question stays out of a reorder and of a rebuilt set; the
  answer, known/learning marks and Leitner box follow their questions; no stale answer survives
  a reused id; `hidden` validation and the three-visible-item guard; removing on the check
  screen reaches the saved reviewer.

**Deliberately not included**

- No restore screen for a removed question yet. Phase 1 adds it; until then a backup taken
  before the removal is the only way back.
- The 40,000-character source cap and the generator's item caps are unchanged; Phase 1 and
  Phase 3 deal with them.
- Ids are still positional (`mc0`, `id1`, …). Phase 0 matches by key, so this is safe; Phase 1
  replaces them when editing needs stable identities.

**Effort:** 0.5–1 day. **Depends on:** nothing. **Blocks:** Phase 1.

## Phase 1 — Own your questions (next)

The single most requested fix: a generated reviewer is a draft, not a verdict.

1. **Edit an item.** Question, answer, explanation, multiple-choice options and the correct
   option. Editing an identification answer clears that item's stored answer (the old typed
   value refers to the old text) but keeps its schedule and mastery, as R2.1 already argues for
   diagrams.
2. **Add a question by hand.** Same four types, same validation; useful for the one fact the
   generator keeps missing.
3. **Delete and restore.** A deleted item goes to a "Removed" list with its key and a one-tap
   restore, instead of the Phase 0 one-way `hidden` key. Deleting a question that students have
   answered removes its `ans`/`plan` entries; restoring does not resurrect them.
4. **Re-generate one item.** Keep the current question and ask for another phrasing/format of
   the same fact, rather than rebuilding the whole set.
5. **Stable ids.** New items get random ids (`'it_' + …`); old positional ids keep working
   unchanged. Nothing is renumbered, so `ans`, `srs`, `flashKnown` and `flashLearn` survive
   every edit and reorder. `itemKey()` remains the migration and merge tool.
6. **Move source text to IndexedDB.** Keep `localStorage` for the small reviewer record, but
   store the 40k+ characters in IndexedDB (with a localStorage fallback when IndexedDB is
   blocked). `Shuffle` on a large PDF then rebuilds from the whole file, not its first 40k
   characters. This is also the foundation for Phase 3's skipped-line report.
7. **Duplicate questions inside one reviewer** are merged or flagged at the check step, using
   `itemKey()`.
8. **Preview becomes the editor.** "Remove" is joined by "Edit" and "Add question"; saving the
   reviewer validates the edited set exactly as `cleanReviewer()` does.

**Tests:** edit → save → reopen keeps the id and progress; an edited answer clears only that
answer; delete → restore keeps the key and does not restore old answers; add passes
`cleanItem()`; re-generate keeps the fact but may change the format; a 60k-character source
shuffles from the whole text; export/import round-trips edits and the Removed list; a
hand-edited backup cannot smuggle an invalid option key.

**Done when:** a typo fix or a manual question takes under twenty seconds, and no edit changes
another item's progress.

**Effort:** 3–4 days. **Depends on:** Phase 0. **Decision:** none blocking.

## Phase 2 — A plan that respects the exam

The exam date currently changes one sentence on the home screen; the schedule ignores it.

1. **Exam-aware intervals.** `BOX_DAYS` stays the default, but when an exam date is set, clamp
   each next due date to the last useful review before the exam. An item answered correctly
   sixteen days before an exam in three days is due in two, not sixteen. Show the compressed
   interval in the item feedback so the change is not a surprise.
2. **Daily cap.** Default 20 new/review items a day (setting: 10/20/40/All). "Study today"
   serves the cap, not the whole backlog; the home card says what is left.
3. **Seven-day forecast.** A small day-by-day count on the home card, so "180 due" becomes a
   plan. No notifications; the app has no server and does not run in the background.
4. **Due-only quiz.** "Review due" currently forces flashcards; offer the same filtered set as
   a graded quiz, and mark due items inside the quiz tabs.
5. **Partial credit for enumeration.** Store matched/missing/expected and award the fraction.
   `enumCheck()` already reports `got` and `missing`; the score and the study plan need to use
   them. A 4/5 answer should not reset the Leitner box to zero.
6. **Undo an answer.** "Count it correct" and a mis-tap need an undo (restore the previous
   `ans`/`srs` entry), not "Reset this part".
7. **Cram mode** for the last three days before an exam: all items, exam-style, with feedback
   optional. Deliberately separate from the spaced plan.

**Tests:** an exam date clamps every future due date to on or before the exam; a passed exam
date does not produce negative waits; the cap never serves more than the setting; a 4/5
enumeration stores the fraction and advances/keeps the box by the documented rule; undo
restores the exact previous entry; cram mode does not mutate the SRS schedule.

**Done when:** setting an exam changes what is due tomorrow, and a 200-item backlog is served as
20 a day.

**Effort:** 2–3 days. **Depends on:** Phase 0 for carrying progress across a rebuild.
**Decision:** default daily cap (recommended 20).

## Phase 3 — Trust the input

The generator is good at complete sentences and quiet about everything else.

1. **Skipped-line report.** `generate()` gains an optional collector (not a change to the
   returned items) that counts why lines were dropped — instruction/rubric, too short, no verb,
   outline, duplicate, no term — and keeps three examples per reason. The check screen shows
   "62 lines skipped: 31 instructions, 12 headings…" with the examples. A test asserts the item
   output is byte-identical with and without the collector.
2. **Surface the caps and choose the mix.** Replace "All" with the real number ("All (~68)") and
   offer per-type counts (multiple choice / identification / true-false / enumeration) instead
   of only "multiple choice only".
3. **Paste text.** A textarea for notes copied from a document, a web page or a chat, so a
   student does not have to create a file first.
4. **Multiple files** keep their names in the reviewer title and the skipped-line report
   identifies the file or page.
5. **OCR — decision required.** A scanned handout or a phone photo is the loudest silent
   failure. On-device OCR means a new ~2–4 MB dependency (Tesseract.js-style), which conflicts
   with "no dependencies" and grows the offline shell. Recommended sequence: ship the
   diagnostic and paste-text box first, then decide whether the dependency is worth it. Do not
   build OCR without approval.
6. **Document what cannot be read.** Google Docs/Drive require Download/Export first; `.doc`
   still needs `.docx` or PDF. The error should say that before the file is chosen, not after.

**Tests:** diagnostics are off by default and do not change items; counts add up to the input
line count; examples are real lines; per-type counts are honoured and validated on import; paste
text follows the same minimum-length and item-count rules.

**Done when:** a student can see why 90 slides produced 50 questions, and can fix the input
without guessing.

**Effort:** 2–3 days (OCR separate). **Depends on:** Phase 1's IndexedDB source storage for
large files. **Decision:** OCR dependency (recommended: defer).

## Phase 4 — Move and share

1. **Export one reviewer.** Same envelope as "Export all", filtered to one reviewer, with only
   the images it references. Share it as a file with a classmate.
2. **Duplicate-safe import.** Compare reviewer content (title + keys + source hash) and offer
   Merge / Keep both / Replace, instead of silently creating a second copy with a new id.
   Merging keeps the better progress per item and never duplicates an item.
3. **Import a plain question list.** CSV/TXT with `question,answer[,option,option,…]` mapped to
   `id` or `mc`, validated through `cleanItem()`; useful for question banks that already exist.
4. **Backup completeness.** Decide whether the focus timer and streak travel in the backup
   (they are device-local today). Recommended: include them, clearly labelled as device stats,
   because "move to another device" currently halves the app's memory.
5. **Search and sort.** Search appears only above five reviewers and matches titles only. Add
   filters: due today, exam this week, has diagrams, type. Sort by exam date, due count or
   recently opened.
6. **Sync — decision required.** Optional encrypted sync is the one feature that needs a
   server, an account and a privacy story. It contradicts "no account, nothing leaves the
   device". Recommended: keep it out unless the owner asks; local-first remains the promise.

**Tests:** single export imports alone and keeps images; importing the same file twice offers a
merge and does not duplicate; merge keeps per-item progress and discards nothing silently;
CSV rows that fail validation are counted and shown; search/sort filters return the documented
sets.

**Done when:** one reviewer can move phone → laptop → classmate without a duplicate or a lost
mark.

**Effort:** 2–3 days. **Depends on:** Phase 1 (stable ids, `itemKey`). **Decision:** backup
contents; sync (recommended: no).

## Phase 5 — Diagram practice

Adopt `ROADMAP.md` R1.1–R3.2 as written (shuffle order, contrast tokens, the 44 px draggable
and keyboard marker, edit-in-place with stable ids, multiple choice from sibling labels, zoom and
pan), then add two practice modes that the roadmap does not cover:

1. **Reverse mode:** show the label, tap the correct part on the image. This is the other half
   of anatomy practice and uses the same hotspots.
2. **Label the whole diagram:** show every pin at once and accept the labels in any order, with
   a per-diagram score. This is closer to a practical exam than one pin at a time.

The stable ids and `itemKey()` from Phases 0–1 are shared; do not build a second identity
scheme for diagrams. The brand and dark-mode fixes from Phase 6 are folded in here because they
touch the same CSS.

**Effort:** ROADMAP.md's 9–13 days plus 2–3 days for the two modes. **Depends on:** Phase 1 for
stable ids. **Decision:** whether reverse mode or label-all ships first (recommended: reverse).

## Phase 6 — Insight and polish

1. **Stats by section.** Page/slide tags are already stored; show accuracy and due counts per
   section, a weak-items list, time per item and a short trend. "12 correct" is not a study
   plan.
2. **One question at a time** on a phone, with flag/skip/jump, instead of a long page.
3. **Custom focus timer** (25/5 default, 50/10 and custom), long break, and the same settings
   across screens.
4. **One name.** The tab title appends `SINEGENG` while the app, manifest and icon say Reviewer
   Generator. Pick one name and use it in `document.title`, `manifest.webmanifest`, `README` and
   the header.
5. **Recitation controls:** choose the voice, recite only missed/due items, and say which part
   is marked on a diagram instead of "Look at the diagram".
6. **Trash instead of confirm-and-gone** for deleting a reviewer, with undo.

**Effort:** 3–4 days. **Depends on:** Phase 2 for due/weak-item data. **Decision:** the app's
public name (recommended: Reviewer Generator).

## Cross-cutting test plan

- `tests/check.js` — pure helpers: keys, progress carry, interval compression, enumeration
  partial credit, CSV parsing, diagnostics.
- `tests/app-smoke.js` — model and wiring: editor save/reopen, hidden/restore, import merge,
  search filters, cap enforcement, no stale progress.
- `tests/offline.js` — any new shipped file is added to `SHELL` and exists; no file is cached
  under two names.
- `tests/quality.js` — counts may not rise; lowering one means lowering `BASELINE` in the same
  change.
- Manual, reported as pending until done: 375 px, 200% zoom and reflow, keyboard-only authoring,
  screen reader over the editor and the check screen, print with covers, two-account data
  isolation is not applicable (no accounts).

## Release mechanics

- One `VERSION` bump per release, after the last commit of that release, then confirm the app
  reloads once and the offline copy updates.
- Phase 0 already bumped v5 → v6; do not bump again for Phase 0.
- `README.md` describes the new behaviour and its limits in the same release.
- A phase is done when its tests pass, the quality baseline is intact, the manual checks are
  either done or reported as pending, and the README is honest.
- **Commits require the owner's approval.** Work can be staged in the tree and reviewed before
  any commit.

## Decisions needed before Phase 2/3/4

1. Daily cap default: 20 (recommended), 10, or All.
2. OCR: add a dependency, or stay dependency-free with paste text + diagnostics (recommended).
3. Backups: include the timer and streak (recommended) or keep them device-local.
4. Sync/accounts: keep local-first (recommended) or plan an encrypted sync.
5. The app's public name: Reviewer Generator (recommended) or another name.
6. Diagram order: reverse mode or label-all first (recommended: reverse).

## Out of scope

- AI-generated questions, a hosted service, accounts or cloud sync unless explicitly approved.
- Automatic label or arrow detection in diagrams (manual labelling stays the design).
- Converting a typed reviewer into a diagram reviewer, or the reverse.
- Drawing/annotation tools, colour-coded pins, per-pin notes.
- Draft resumption for an unfinished new reviewer (ROADMAP.md R2.1 notes this as separate).
