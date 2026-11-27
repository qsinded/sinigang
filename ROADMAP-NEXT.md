# Next roadmap: what a first-time student needs

Written 2026-11-27 after using the generator the way a new student would: pasting real notes from
biology, history, economics and Filipino-language Araling Panlipunan, then answering the questions.

`ROADMAP.md` (diagram reviewers) and `ROADMAP-FIXES.md` (complaints after a week of use) stay as
they are. This plan covers the part those two do not: **how many good questions come out of
ordinary notes, and how fairly they are graded.** A student who gets zero or wrong questions on
the first try never sees the study plan, flashcards or recitation.

Status: planning only. The fixes already shipped on 2026-11-27 are listed at the end.

## What the test found

Measured with `generate()` on hand-written notes, after the 2026-11-27 fixes:

| Notes | Facts | Questions | Main problem |
|---|---|---|---|
| History (English, past tense, dates) | 11 | 11 | fixed today; "Which term is described?" reads oddly for a person |
| Biology (cell division) | 15 | 9 | sentences that are not "X is Y" and have no CAPS word are never used |
| Economics (supply and demand) | 8 | 4 | "The law of demand **states that**…" and "…**happens when**…" are not read |
| Araling Panlipunan in Filipino | 6 | **0** | "Ang X **ay** Y" is not recognised at all |

Grading:

| Answer | Typed | Graded |
|---|---|---|
| Mitochondria | `mitocondria` | wrong |
| Photosynthesis | `photosinthesis` | wrong |
| Cytokinesis | `cytokenesis` | wrong |
| Telophase | `telophase lol idk` | correct |

With a small set of notes, the same three wrong options also repeat on almost every multiple
choice question, so the answer can be found by elimination.

## Rules this plan keeps

From the existing roadmaps: no server, no account, no AI, no new dependency, files never leave the
device. Every phase adds tests to `tests/check.js`, never raises a `tests/quality.js` count, bumps
`VERSION` in `sw.js` once per release, and updates `README.md` honestly.

## Phase A: never give a student zero (do first)

1. **Filipino and Taglish notes.** Read `ay` as the linking verb and `ang`, `ang mga`, `si` and
   `sina` as articles, so "Ang Katipunan ay isang lihim na samahan…" becomes a definition and "Si Jose
   Rizal ay binaril…" a fact about a person. Add `noong <year>` to the date rule. Add
   `tests/corpus/filipino.txt` so `npm run quality` guards it.
   *Why first:* the app's audience is Filipino students, and today these notes produce nothing.
   **Done 2026-11-27:** `LANGS` table (en, fil) drives articles, linking verbs, non-terms and clause words;
   "Ang X ay Y", "Si X ay Y", "Si X ang Y" and verb-first sentences with a year work; true/false keeps
   people after "Si". Filipino corpus coverage 0% → 90%, English output unchanged. Still to do: Filipino
   question wording ("Ano ang tinutukoy?", "Tama o Mali"), Filipino learning objectives ("Layunin",
   Bloom verbs like "Ipaliwanag"), and Filipino list headings ("Halimbawa", "Tandaan").
2. **More ways English notes state a fact.** "X states that Y", "X is called Y" / "Y is known as
   X", "X consists of Y", "X happens when Y", "X occurs when Y". Each needs a question form
   ("Which law states that…?") and a quality-corpus line.
   **Done 2026-11-27, more generally:** any plain subject-verb sentence asks for its subject as a blank in
   the note's own sentence ("The _____ states that when price rises…" → law of demand; "A _____ happens
   when…" → shortage). Coverage: biology 67→100%, economics 54→85%, computer architecture 47→74%, exam paper
   54→69%, networking 88→94%. Not done: "is called" / "is known as" reversals, and wrong options that agree
   with the verb's number ("register" can appear for "_____ move").
3. **Skipped-line report.** Backend done 2026-11-27: `generate()` returns `.skipped` with a reason code per
   line, and `SKIP_REASONS` words each one for a student with a fix ("Try writing it as *X is …*").
   Still to do (UI, paused): show it when a file yields few questions, instead of the dead-end error.
   Today's gaps by reason (`npm run quality -- --missed`): no-pattern 13, no-claim 10 (all Filipino),
   bad-term 7, then furniture the generator is right to skip.
4. **Done 2026-11-27:** `tests/corpus/` has history, economics and Filipino notes, and `npm run quality`
   now gates *coverage* (share of note lines some question uses) per file, so a rule that stops reading a
   kind of sentence fails the run. Baselines: Filipino 0%, economics 54%, lecture 33%, biology 67%.

*Size:* about 4–6 days. *Risk:* a looser sentence rule lets junk through; the quality corpus is
the guard, so A4 lands with A1.

## Phase B: questions that read like a teacher wrote them

1. **Ask by the kind of answer.** A person: "Who was executed in Bagumbayan in 1896?". A year:
   "In what year…?". A place: "Where…?". Everything else keeps "Which term is described?".
   Detect a person from the note's own wording (a capitalised name before "was", "Si …").
2. **Varied wrong options.** Do not reuse one wrong option more than twice per set. When the pool
   is too small for honest variety, ask identification instead of multiple choice.
3. **Clean up awkward option text.** "When two new nuclei form…" (from "Telophase is when…")
   should read "The stage when two new nuclei form…", or the item should become identification.
4. **Sentences with two dates** ("from 1565 to 1898") ask about each year, not only the first.

*Size:* about 3–4 days.

## Phase C: fair grading

**Done 2026-11-27 (C1–C3):** `gradeId()` grades word by word with filler words from `LANGS`, forgives one
slip in 6–9 letters and two in 10+, never in short words or acronyms, rejects a slip that fits another answer
in the reviewer as well, and the app adds "(accepted, but check the spelling)". A sweep over every corpus
answer: correct variants accepted 561 → 572 of 572, wrong-answer acceptances unchanged (4, all genuine:
OS/operating system, switch/Switches). Limit: a slip can still match a real word that is not in the reviewer
("adsorption" for "absorption").

1. **Accept small spelling mistakes** on longer answers: one wrong letter for 6–9 letters, two for
   10 or more, never for short words or acronyms, so `heap` and `head` stay different.
2. **Grade by words, not characters.** An extra filler word ("the", "stage", "process") is fine;
   an extra content word ("lol idk", a second candidate) is not. This replaces today's 60% rule.
3. **Say "close, check the spelling"** when a near-miss is accepted, so the student learns the
   right spelling instead of being silently passed.

*Size:* about 2 days. *Risk:* tolerance can accept a different real term (`mitosis` vs `meiosis`
are two letters apart). Typos are only accepted when no other answer in the reviewer is equally
close.

## Phase D: the first five minutes

1. **"Try with sample notes"** on the home screen: one tap builds a reviewer from bundled notes, so
   a visitor sees the questions, flashcards and study plan before finding a file.
2. **A short "how to write notes that work" card** beside the paste box, using the patterns from A1
   and A2.
3. **A manual pass on a real phone** (375 px, slow network, first install, offline reopen). The
   2026-11-27 test used the generator directly and did not click through the interface, so screen
   layout and phone feel are untested here.

*Size:* about 2 days.

## Still open in the other roadmaps

- `ROADMAP-FIXES.md` Phase 5 (diagram practice, which adopts `ROADMAP.md` R1.1–R3.2) and the rest
  of Phase 6 (section stats, weak-item list, custom timer, recitation controls, trash with undo).
- `ROADMAP-FIXES.md` Phase 3 OCR decision; A3 above covers the diagnostics half.

## Suggested order

| Order | Work | Why |
|---|---|---|
| 1 | A1 + A4 Filipino notes and corpus | biggest audience, currently zero |
| 2 | C1–C3 fair grading | a correct answer marked wrong loses trust fastest |
| 3 | A2 + A3 more fact patterns, skipped-line report | more questions per page, no dead ends |
| 4 | D1–D3 first five minutes | converts first visits |
| 5 | B1–B4 question wording | polish once the volume is there |
| 6 | Phases 5–6 of `ROADMAP-FIXES.md` | diagrams and insight |

## Out of scope

Same as the other roadmaps: AI-generated questions, a hosted service, accounts or sync, and
automatic diagram label detection.

## Shipped on 2026-11-27

- Typing every candidate ("prophase metaphase anaphase interphase") is no longer correct.
- "X was/were Y" is a definition; past-tense "-ed" verbs count as a claim.
- A year in a sentence is asked as a fill-in-the-blank, with the notes' other years as options.
- Long titles, in Title Case or sentence case, are headings instead of being glued onto the
  first sentence.
- An acronym is never a wrong option for its own spelled-out answer.
- A clause ("surplus happens when quantity supplied") is never taken as a term.
- Turning off true/false no longer drops the facts that would have become true/false items.
