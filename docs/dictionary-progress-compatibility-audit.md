# Dictionary update — student progress compatibility audit

Date: 2026-11-26
Baseline: main (index blob 76e10accde64ba47391f9c98e39223e38197f015)
Candidate: feature/a2-dictionary-review, commit 2e4bd488006e642531add24da892b6c3145abc52 (index blob ce1e208af47c016242e511d401030c892fc90ec1)

## Scope and method
Fetched both real index.html versions, the complete original 776-card A1 file, the updated 832-card A1 and 630-card A2 files, and the complete unchanged legacy dictionary blob 0052f912e87501ab6c8e4e72b41f0145c558a48a (31,061 source rows).
Executed actual extracted catalog loader, storage, ID lookup, review filtering, learning-set statistics, session resume/persistence and account-switch functions in an isolated JavaScript harness with mocked fetch, localStorage and UI. No real accounts or Firestore writes. The initial harness run failed because a UI stub was missing; rerun with the stub passed.

## Results
| Check | Result |
|---|---|
| Old catalog entries / unique IDs | 31,847 / 31,847 |
| New catalog entries / unique IDs | 31,907 / 31,907 |
| Missing previously accessible IDs | 0 |
| Loader errors (old / new) | 0 / 0 |
| Previously visible records now hidden as duplicates | 32; IDs remain accessible |
| Old displayed headword changed at same ID | 164; corrections include removal of incorrect articles from adjectives, spelling, and other lexical changes |
| Previously published A1 IDs retained | 776 / 776 |

Synthetic student: six cards (published A1, unreviewed legacy, same-ID revised A2, newly hidden duplicate, personal card), a personal set, selected set, history, spaced repetition records and a partially finished session.
- Student data serialized identically before and after loading the updated application.
- Set statistics unchanged: 6 started, 3 mastered, 6 total.
- All six cards remained resolvable and eligible for scheduled review.
- Resume restored the saved session exactly at index 1; persisting it did not change saved state.
- Switching to a second account did not expose the first account's records or sets; switching back restored the original state.
- No alerts in the successful harness run.

Compared actual source: local storage key/schema, cloud answer synchronization, workspace synchronization, review-record calculation, answer handling, and session resume/persistence are unchanged from main.

## Limits / release gate
This is a full-catalog compatibility audit and synthetic local-state regression test, not an authenticated browser or live Firebase integration test. Actual student data was neither accessed nor modified. An authenticated test account is still required for cloud sync, refresh/resume and cross-device verification before publishing. Same-ID wording and sense corrections retain existing historical results; these results are not evidence that the corrected meaning has been mastered. Distinct old/new IDs are not automatically merged; hidden duplicates remain usable in existing sets and scheduled reviews, and a separate new card may have independent progress. No destructive ID migration is justified by this audit. Main remains untouched.

Next: grammar-hint presentation and authenticated browser smoke tests before deployment.
