# FitNotes and FitNotes 2 CSV export formats (for the GymSmarter importer)

Researcher. All sources checked on **2026-10-09**, and fact-checked again against primary sources the same day (see "Fact-check"). No accounts, trials or credentials were used. Extends `ios-platform-feasibility.md` §5, and corrects part of it. Feeds `docs/design/data-import-export.md` §2.5, §4.3, §4.4 and acceptance checks 16–29. That spec contains decisions DX1–DX12; the DX13–DX15 named in the task don't exist anywhere in the repo.

Labels: **[Doc]** the developer's own pages or store listing. **[Sample]** a real export file found online. **[Code]** open-source parser code read directly (it shows what its author's files contained, not an official spec). **[Reports]** third-party sites and READMEs. **[Inference]** my reasoning, not proven.

## Summary

1. There are at least **three FitNotes workout-CSV layouts**. Android up to v1.23 (until about June 2023) has one `Weight (kgs)` **or** `Weight (lbs)` column. Android v24+ has `Weight` plus `Weight Unit`. FitNotes 2 (iOS) has `Weight (kg)`, `Weight (lbs)`, `Notes` and `Kind`. Android's `Comment` column probably appears only when comments are included in the export.
2. Only the FitNotes 2 header is officially documented, and only as its import format. The Android headers come from one real 2020 export and nine open-source parsers (2015–2025). Two of them, both by one author, changed from `Weight (kgs)` to `Weight` + `Weight Unit` in June 2023 and September 2024. FitNotes 2's own changelog also records fixes for Android CSV formats (v8, Dec 2024).
3. Every layout is date-only (`YYYY-MM-DD`, with no time of day and no timezone) and has one row per set. No documented layout has warm-up, PR, RPE or workout-comment columns. Body weight is a separate Body Tracker CSV. Encoding, BOM, decimal comma, Android time format and unit strings aren't documented anywhere, and the parsers disagree on Android two-part times.
4. **The spec's Android header (`Weight (kgs)`, `Comment`) is the pre-2023 layout, so a current Android export would fail check 16 as written.** See "Proposed spec changes" below. There is also **one proposed brief change**: FitNotes 2 has recorded RPE, RIR and warm-ups since 2024, and its September 2026 update mentions them in CSV import/export for Hevy, FitBod and Strong formats.
5. Only Ben's real file can settle which app and version he uses, the exact header, the number, time and unit strings, and the encoding (§7).

## Recommendations

1. **Ask Ben (blocking for import, not for building):**
   - Which app he uses: Android "FitNotes" (James Gay), iPhone "FitNotes 2" (Ginger Technologies), or the unrelated iPhone "FitNotes – Workout Tracker" (Evgeny Uralsky).
   - The app version.
   - One workout CSV with comments included.
   - If the app is Android, also a `.fitnotes` backup, kept only as a safety copy.
2. **Build the detector for five exact headers now** (§2 table, rows A1-kg, A1-lb, A2, B1/B2, C):
   - Use synthetic fixtures we write ourselves, labelled `synthetic` in the file name. Don't copy third-party sample files into the repo: the 2020 sample has no licence.
   - Anything else stops the import (DX5).
   - Before the build is called done, re-run detection against Ben's real file and add his first line as a fixture.
   - Don't implement Kinoku's two-column Android header (`Weight (kgs),Weight (lbs)`) until a real file shows it. Nothing else supports it (§3.1).
3. **Take the unit per row, not per file:**
   - A1: the unit comes from the header.
   - B: the unit comes from the `Weight Unit` cell. Accept exactly `kgs` and `lbs`, and also `kg`/`lb` case-insensitively. Any other value makes the row unreadable.
   - C: the unit comes from whichever weight column is filled. If both are filled, ask Ben.
   - Never convert between kg and lb (check 19). Mixed-unit files are expected from Android v24+ (per-exercise units) and FitNotes 2 (both units since v1.0).
4. **Parse strictly and never guess:**
   - Dates: strict `YYYY-MM-DD` that is a real calendar date.
   - Numbers: `^-?\d+(\.\d+)?$`.
   - Times, C files: `HH:MM:SS` or `H:MM:SS`, or `MM:SS`/`M:SS` with hours left out (documented). Times, A and B files: accept three-part `H:MM:SS`. A two-part value is ambiguous because parsers disagree (`H:MM` or `MM:SS`, §3.2). Don't guess it: ask once per file or mark it unreadable (a design call) until Ben's file settles it.
   - Distance units: `m km cm in ft yd mi`.
   - Anything else (including `22,5`) becomes an "unreadable" row listing its raw text. Keep the raw cell text as provenance.
   - Tolerate a UTF-8 BOM, CRLF/LF/CR line endings, blank lines, and RFC 4180 quoting (embedded commas, newlines, doubled quotes).
5. **Classify rows by their filled columns, not by category name.** Category is user-editable, and plank-style timed sets and weighted carries are not cardio. For C, use the `Kind` letters as an unordered set. See §5 for the rules. The design needs a decision for timed and distance strength sets (spec change S3).
6. **Store imported workouts as date-only.** Use `localDate` with no time, and don't invent a midnight, 07:00, noon or 19:00 instant the way the Hevy/Strong/Garmin converters do (rule 6). Record the device timezone at import only as provenance. FitNotes keeps one workout per calendar date, so grouping by `Date` loses nothing that the CSV holds.
7. **Detect non-CSV and wrong-type files by their content:**
   - SQLite magic `SQLite format 3\0` means a `.fitnotes` backup. Use the spec's existing "backup, not CSV" message.
   - `PK\x03\x04` means a zip file, which isn't a CSV.
   - A header with `Date` but no `Exercise` probably means a Body Tracker export. Show a specific message.
8. **Defer `.fitnotes` backup import, but keep it as the upgrade path.** Third-party readers report that it holds things the CSV loses: workout start/end times, workout comments, PR flags, routines and body tracker data (§6). Propose it only if Ben's CSV turns out to miss something he cares about.
9. **For our "FitNotes 2 CSV" export (§4.4):**
   - Write the documented header exactly.
   - Put dates in ascending order and keep each exercise's sets together within a workout.
   - Use at most 2 decimals.
   - Fill exactly one weight column per row, set `Kind` letters, and write `Time` as `HH:MM:SS`.
   - Quote `Notes` per RFC 4180.
   - FitNotes 2 skips any date that already has a workout. Say so on the export option.

## Fact-check (2026-10-09)

**Verified against primary sources, no change needed:**
- **No header string or column order in §2 was wrong.**
- A1-lb header and rows, verbatim from the real 2020 sample.
- The C header and every column rule, verbatim from FitNotes 2's docs: date format and order, set grouping, 2 decimals, the `Distance Unit` list, the `Time` format and the `Kind` letters.
- B column names in this order in FitNotes2Hevy's validator.
- The diffs and dates of the push-fitnotes (11 Jun 2023) and fitnotes2fit (25 Sep 2024) changes.
- Android export path, the Supporter-only per-exercise units and the convert-vs-relabel examples.
- FitNotes 2 version notes v5–v14 and Android version dates.

**Corrected in this pass:**
1. Only rosenpin's README says "include comments in export"; FitNotes2Hevy's and push-fitnotes' don't (§1).
2. push-fitnotes' old unit logic was a value test (`>= 0`), not a column-exists test (§3.1).
3. Android `Time` parsers disagree on two-part and bare values. Recommendation 4, §3.2 and §5 are changed.
4. The JSON `kind` values are documented; calling them a bitmask is inference (§3.4).
5. The three-kind evidence now cites the backup-export page, not changelog 2.0.2 (§3.3).
6. That FitNotes 2's "Android DB" export is a `.fitnotes` file is inference (§1).
7. The "three parsers" confirming B come from two authors (§2).
8. The v14 note is about Hevy/FitBod/Strong-format CSVs, so the brief wording is tightened.
9. Added:
   - org-fit's 2018 positional parse, which supports the A column order;
   - FitNotes 2's changelog entries on Android CSV formats;
   - Spanish (v4);
   - Android whole-workout comments (v1.23);
   - push-fitnotes' 19:00 default time.

**Still uncertain:**
- No real file shows A1-kg, A2, B1 or B2 verbatim, so their column order is probable only. A1-kg is strongest, because a positional parser depends on it.
- The literal `Weight Unit` values: the only evidence is one TypeScript type.
- Whether `Comment` is controlled by an export option: one README says so.
- The Android `Time` format.
- FitNotes 2's export header: only the import header is documented, and v14 may have changed it.
- The Body Tracker header.
- Encoding, BOM and decimal comma.
- Kinoku's two-column header.

**Couldn't reach:** fitnotes.info (HTTP 503), web.archive.org (fetch blocked) and reddit.com. GitHub's API was rate-limited for some commit dates, so those were read from the commit pages instead.

---

## 1. Which apps, and how to export

| App | Platform, developer | Workout CSV export path | Notes |
|---|---|---|---|
| **FitNotes** | Android, James Gay (`com.github.jamesgay.fitnotes`) | **Home ⋮ (overflow) → Settings → Data: Spreadsheet Export → Workout Data → Save Export / Share Export** | "Generate a CSV file of your Workout or Body Tracker data"; the CSV can't be used to restore data [Doc, settings]. Three third-party READMEs give the same path [Code: rosenpin, FitNotes2Hevy, push-fitnotes]. **Only rosenpin's** adds "(include comments in export)", so the comments option rests on one report [Reports]. Since v24 you choose the folder and can edit the default file name [Doc, release_24]. |
| **FitNotes 2** | iPhone, Ginger Technologies Pte Ltd (App Store id1538896016) | **Settings (bottom of the main workout screen) → Backup & Export → Export CSV → iCloud Drive or email** | "You can export a CSV of your workout data or body tracker data to iCloud Drive or as an email attachment" [Doc, backup-export]. Exact button labels beyond the "Export CSV" heading aren't published [Inference]. It also exports a backup database and an "Android DB" in "the FitNotes Android DB format" [Doc]; that this is a `.fitnotes` file is [Inference]. Exercises with more than two kinds can't be exported to Android [Doc]. |
| FitNotes – Workout Tracker | iPhone, Evgeny Uralsky (id1059245195) | Unknown | A different app. It dropped CSV import for its own `.fnw` format (v2.9.4), and later restored CSV export (v3.0.2, v3.0.8) [Doc, App Store]. A 2018 parser shows unrelated columns: start/end date and time, bodyweight, equipment, a "Done" flag, categories [Code: aboustayyef]. **Not supported.** |

Version timeline:

- **Android** [Reports: APKPure version list]: 1.22.0 (Dec 2019) · 1.23.1 (17 Jul 2021) · 24.1 (5 Jun 2023) · 25.0 (31 May 2024) · 25.1 (29 Oct 2025, latest found).
- **FitNotes 2** [Doc: App Store version history]:
  - v4 (6 Feb 2024): Spanish.
  - v5 (22 Jun 2024): RPE, RIR and warm-up flags.
  - v8 (11 Dec 2024): "Update CSV format for the other FitNotes import".
  - v11 (27 Nov 2025).
  - v12 (8 Mar): French, and photo/video attachments on notes.
  - v13 (9 Apr).
  - **v14 (9 Sep)**.
  - The page doesn't show years for v12–v14. **2026 is inferred** from the order and from v14's "iOS 26" fix.

The Android FAQ says "there aren't any plans to develop an iOS/iPhone version at the moment" [Doc, faq].

## 2. Header rows per variant

| ID | App / version | Exact header row | Evidence |
|---|---|---|---|
| **A1-lb** | Android ≤ v1.23, unit Imperial, comments not included | `Date,Exercise,Category,Weight (lbs),Reps,Distance,Distance Unit,Time` | **[Sample] verbatim** from a real export, `FitNotes_Export_2020_10_04.csv` (moferg) |
| **A1-kg** | Android ≤ v1.23, unit Metric, comments not included | `Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time` | [Code] The `Weight (kgs)` name is in four parsers: chewxy gist (2015), nerdOut (2020, as R's `Weight..kgs.`), push-fitnotes (Feb 2023) and fitnotes2fit (before Sep 2024). The column order comes from two places. org-fit's 2018 parser splits rows by position, reads columns 0–7 as Date, Exercise, Category, Weight, Reps, Distance, Distance Unit, Time, and labels weights `kgs`. push-fitnotes' row type has the same order. **Probable (strong)**, not seen verbatim |
| **A2** | as A1, comments included | `Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time,Comment` (or `Weight (lbs)`) | [Code] push-fitnotes `FitNotesCSVRowT` and its writer use exactly this order. **Probable** |
| **B1** | Android v24+ (from about Jun 2023), comments not included | `Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time` | [Code] Three parsers from two authors confirm the names: FitNotes2Hevy's required-column list (this order, `Comment` optional; alanjonesit, Dec 2025); fitnotes2fit commit c093557 (25 Sep 2024: `Weight (kgs)` → `Weight` + `Weight Unit`); push-fitnotes commit af7c034 (11 Jun 2023, six days after v24.1). The last two are both by tihawk. A bare `Weight` is also read by rosenpin (Sep 2025), Frefdt (Apr 2025) and ikkani (Nov 2025). Order **probable**: all of these parsers read columns by name |
| **B2** | Android v24+, comments included | `Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment` | [Code] rosenpin, Frefdt and ikkani read `Weight` and `Comment`; FitNotes2Hevy treats `Comment` as optional. `Comment` as the last column follows A2. **Probable** |
| **C** | FitNotes 2 (iOS) | `Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind` | **[Doc] verbatim**, as "the FitNotes iOS CSV header" for **import**. That the **export** uses the same header is [Inference]: the page calls it the app's own format. Two third-party tools use the same header for FitNotes 2 files (swift-workout-importer fixture, jacked.coach sample), probably taken from the docs. No real FitNotes 2 export was found |
| C-v14? | FitNotes 2 v14 (Sep 2026) | **Unknown.** It may add RPE, RIR or warm-up columns, or offer Strong/Hevy/FitBod-style exports | [Doc] v14: "Improved workout CSV import/export for Hevy, FitBod and Strong, including RPE, RIR and warmup sets". This most naturally reads as Hevy/FitBod/Strong-format files, not FitNotes' own CSV [Inference]. Ambiguous |
| (unverified) | Android, both weight columns | `Date,Exercise,Category,Weight (kgs),Weight (lbs),Reps,Distance,Distance Unit,Time,Comment` | [Reports] Kinoku only, with a synthetic sample using Strong-style names (`Squat (Barbell)`). It contradicts the real sample and push-fitnotes' one-column logic. **Don't implement unless seen** |
| — | Body Tracker CSV (both apps) | Unknown | [Doc] it exists in both apps. No column list published |

Header notes:
- Spelling differs: Android uses `kgs`, FitNotes 2 uses `kg`. Android uses `Comment`, FitNotes 2 uses `Notes`.
- **The delimiter is a comma in every sample and parser seen.** No semicolon variant was found.
- Independent support for "more than one Android layout" [Doc, FitNotes 2 changelog]. None of these entries names columns:
  - v1.2: "Handle older CSV file format imports";
  - v3.0.0: "Fix: Import of some FitNotes Android CSVs";
  - v8 (Dec 2024): "Update CSV format for the other FitNotes import".
- Whether headers are translated on non-English phones is unknown. FitNotes 2 added Spanish in v4 and French in v12 [Doc]. (Hevy requires Strong exports in English because Strong translates its headers, but that's a different app.)

## 3. Column semantics

### 3.1 Weight and units
- **A (old Android):** one weight column, named after the global unit setting, so one unit per file [Sample, Code].
  - push-fitnotes' code from 27 Feb to 11 Jun 2023 (commit 68b8039) set the unit with `row['Weight (kgs)'] >= 0 ? 'kgs' : 'lbs'`. In practice a missing `Weight (kgs)` column meant lb; a negative kg value would also have been read as lb [Code].
  - org-fit (2018) hard-codes `kgs` for its positional reads [Code].
  - The real sample writes weights as `45.0`, `135.0` (always one decimal) and reps as integers [Sample].
- **B (Android v24+):** a `Weight` value plus a per-row `Weight Unit`.
  - push-fitnotes types the unit as `'kgs' | 'lbs'` and tests `=== 'kgs'` [Code]. No other parser compares the unit strings: FitNotes2Hevy, fitnotes2fit, rosenpin, Frefdt and ikkani ignore them or pass them through. A TypeScript type isn't evidence of real values, so the literal strings are **unverified**.
  - Mixed units in one file are possible because v24 added per-exercise units, a Supporter feature [Doc, release_24, settings, exercises].
  - Changing an exercise's unit offers "Convert existing values" (100.0 kg → 220.46 lbs) or "Just change unit" (100.0 kg → 100.0 lbs) [Doc, release_24]. Converted values can be non-round, and relabelled values can be wrong in history. The file can't show which happened [Inference].
- **C (FitNotes 2):** separate kg and lb columns, at most 2 decimals [Doc]. The app has let you "Record your workouts in both lbs and kg" since v1.0 [Doc, changelog].
  - One parser treats the columns as mutually exclusive in practice and keeps kg if both are filled [Code: swift-workout-importer]. That is its choice, not FitNotes' behaviour.
  - What FitNotes 2 writes when both are known is unknown.
- **Storage hint:** the Android database reportedly stores kg (`training_log.metric_weight`) and converts for display [Reports: Cadence issue #19, which says it's unverified]. Exported lb values may carry rounding artefacts; the 2020 sample shows clean values [Sample].
- **Bodyweight and assisted:** in the sample, every row had a weight. Whether bodyweight sets export as `0.0` or blank, and whether negative (assisted) weights exist, is unknown. Android's "Reps Only" type exists only in the Supporter app [Doc, exercises], so free users probably log bodyweight sets as "Weight and Reps" with 0 [Inference]. The spec's per-exercise question (DX6) covers both [Inference].
- **Load convention** (dumbbell each or pair, bar included) is never recorded [Doc: no such field in any format].

### 3.2 Dates, times and timezone
- `Date` is ISO `YYYY-MM-DD`. Evidence:
  - [Sample];
  - [Code] parsers use `%Y-%m-%d` and the regex `\d\d\d\d-\d\d-\d\d`;
  - [Doc] FitNotes 2 requires it, in ascending order.
- **No time of day and no timezone in any layout.** Converters invent one [Code]:
  - FitNotes2Hevy: 07:00 plus a UTC offset (default +10);
  - rosenpin: 12:00;
  - push-fitnotes: 19:00 local;
  - Frefdt: midnight.
- The Android app has recorded workout start/end times since v1.23 [Doc, release_1_23], and FitNotes 2 v14 can show set completion times [Doc]. Neither appears in any known CSV [Inference from all column lists].
- `Time` (the set duration):
  - FitNotes 2: `HH:MM:ss` (`01:01:01`) or with hours left out (`23:59`) [Doc]. So two parts mean `MM:SS`.
  - Android: undocumented, and **the parsers disagree** [Code]:
    - push-fitnotes reads the first field as hours: `H:MM:SS`, `H:MM`, and a bare number as hours.
    - FitNotes2Hevy reads three parts as `H:MM:SS`, two parts as `MM:SS`, and a bare number as seconds.
    - rosenpin reads a bare number as seconds, with an optional `s`/`m` suffix.
    - So a two-part Android value is ambiguous. Treat the format as unknown.
- The sample is in ascending date order, with each exercise's sets together within a date [Sample]. FitNotes 2 requires both on import [Doc].

### 3.3 Distance and cardio
- FitNotes 2 `Distance Unit` values: `m, km, cm, in, ft, yd, mi`, at most 2 decimals [Doc]. cm and in were added in v3.0.0 [Doc, changelog].
- Android unit strings are unknown. FitNotes 2's "Android DB" export handles yards [Doc, changelog].
- Android exercise types [Doc, exercises]:
  - By default there are 2: "Weight and Reps" and "Distance and Time".
  - The Supporter app adds Weight and Distance, Weight and Time, Reps and Distance, Reps and Time, Weight Only, Reps Only, Distance Only and Time Only.
- FitNotes 2 allows exercises with more than two kinds (for example weight, distance and time). These can't be exported to Android: "Android FitNotes only supports 1 or 2 'kinds' per exercise" [Doc, backup-export].
- In the real sample, strength rows leave `Distance`, `Distance Unit` and `Time` empty (`,,,`) [Sample].
- Whether cardio rows in Android files have empty or `0` weight and reps is unknown.

### 3.4 Categories, comments, flags
- `Category` is the exercise's muscle group. It is user-editable and can be reordered or deleted [Doc, exercises].
  - Real values: `Legs, Chest, Shoulders, Triceps, Back, Biceps` [Sample].
  - Don't use it to classify rows. An empty category is possible in FitNotes 2 files [Code: synthetic test].
  - (Implementation note, 11 Oct 2026: the importer uses it only as a hint that drops or ranks name suggestions, never to match or classify; see ADR 0016.)
- `Comment` (Android) is a **set** comment [Doc, workout_tracking]. It is probably present only if comments were included in the export. Evidence [Code/Reports]:
  - rosenpin's README;
  - FitNotes2Hevy treats it as optional;
  - the real sample lacks it.
- `Notes` (FitNotes 2) is the set note [Doc]. Set notes can hold photo or video attachments (v12) [Doc, workout-sets]; those can't be in a CSV [Inference].
- **Workout-level comments:**
  - Android has had whole-workout comments since at least v1.23 ("either to an individual set or to a whole workout") [Doc, release_1_23].
  - FitNotes 2 has workout notes.
  - Neither has a column in any known layout [Inference].
  - They exist in the `.fitnotes` backup [Reports: fitnotes-merger, FlexNotes].
- **PR flags:** none in the CSV. Android calculates records for Weight and Reps exercises "automatically any time you alter a workout" ("Calculate Personal Records" recalculates them) [Doc, settings]. The backup holds PR flags [Reports]. GymSmarter should recompute records (progress.md PG10 already limits the flood).
- **Warm-ups:**
  - Android has no warm-up flag that I could find. v24's home-screen "show last sets… if you prefer to see working sets instead of warmups" implies none [Doc, release_24].
  - FitNotes 2 has had a warm-up flag since v5, set from a set's "Advanced" notes screen [Doc, workout-sets]. The documented CSV has no column for it [Doc].
  - **Imported warm-ups will look like working sets** [Inference].
- **RPE/RIR:**
  - Android: none.
  - FitNotes 2 has recorded RPE and RIR since v5, and its JSON format carries `rpe`, `rir` and `isWarmup` [Doc].
  - They are absent from the documented CSV. v14 may export them (C-v14?, unknown).
- `Kind` (FitNotes 2 CSV only) is a combination of the letters `w`, `r`, `d`, `t`; for example, "weight and reps" is `wr` [Doc]. Letter order beyond `wr` isn't documented, so parse it as a set [Inference].
  - Its JSON instead has a numeric `exercise.kind`, set per exercise, not per set. The docs list 3 = weight + reps, 2 = reps-only, 8 = time-only and 12 = distance + time as "the most common" [Doc].
  - That these are bit flags (w=1, r=2, d=4, t=8) is [Inference].
- **Supersets, rest times, routines, set completion state:** not in any CSV layout [Doc for FitNotes 2 text export; Inference for CSV]. FitNotes 2 stores a per-set rest time [Doc, workout-sets].

### 3.5 File-level properties
- **Encoding, BOM, line endings, quoting:** undocumented for both apps.
  - The real sample shows no quoted fields because it has no comments [Sample].
  - swift-workout-importer has a synthetic edge-case fixture (`fitnotes-edge-cases`, not fetched) [Code]. Its test name says it covers a BOM, multi-line notes and embedded commas. Its main fixture, `fitnotes-example.csv`, has none of these.
  - Free-text comments make quoting certain whenever a comment holds a comma or newline [Inference].
- **Decimal comma:** no evidence either way. The only sample uses `.` [Sample].
- **File names:** `FitNotes_Export_2020_10_04.csv` and `FitNotes_Export_2020_09_18_08_47_10.csv` [Sample/Code]. Since v24 users can edit the name [Doc], so never detect by file name.

## 4. Sample rows

Verbatim from the real 2020 Android export (A1-lb) [Sample, moferg, quoted as data]:
```
Date,Exercise,Category,Weight (lbs),Reps,Distance,Distance Unit,Time
2020-09-13,Barbell Squat,Legs,45.0,10,,,
2020-09-13,Barbell Squat,Legs,135.0,5,,,
2020-09-13,Romanian Deadlift,Legs,45.0,12,,,
2020-10-03,Barbell Squat,Legs,185.0,1,,,
```
The same file has 436 rows from 2020-09-13 to 2020-10-03, with no quoted fields, no empty weights and no filled distance or time cells. Its exercise names are FitNotes defaults, such as `Flat Barbell Bench Press`, `Lat Pulldown (Pulley)`, `Seated Cable Row (Pulley)`, `Rope Push Down`, `Lateral Dumbbell Raise` and `Dumbbell Curl` [Sample].

**Synthetic illustrations, not real exports.** These are for our fixtures only [Inference from §2–3]:
```
# B2 (Android v24+, comments included)
Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment
2026-10-01,Flat Barbell Bench Press,Chest,100.0,kgs,8,,,,"@8, felt heavy"
2026-10-01,Pull Up,Back,10.0,kgs,6,,,,
2026-10-01,Treadmill,Cardio,,,,5.0,km,0:25:00,

# C (FitNotes 2)
Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Distance,Distance Unit,Time,Notes,Kind
2026-10-01,Flat Barbell Bench Press,Chest,100,,8,,,,"@8, felt heavy",wr
2026-10-01,Incline Dumbbell Bench Press,Chest,,50,10,,,,,wr
2026-10-01,Plank,Abs,,,,,,01:30,,t
2026-10-01,Treadmill,Cardio,,,,5,km,25:00,,dt
```

## 5. Edge cases the importer must handle

| Case | Handling (recommended) |
|---|---|
| Comment/Notes containing commas, quotes or newlines | RFC 4180 parse. Report the record number **and** the physical line where it starts (a quoted newline shifts line numbers) |
| UTF-8 BOM, CRLF, a trailing blank line | Strip the BOM, normalise line endings, ignore blank records |
| Header with surrounding spaces, or a different letter case | Trim spaces; keep the match case-sensitive. A case difference counts as an unknown header (DX5) |
| A or B header without `Comment` | Valid. "Kept as written" shows `No comments in this file (FitNotes export without comments)` |
| Mixed kg/lb in one file (B, C) | Unit per row. Preview says `kg and lb (per set)`. Never convert |
| A C row with both weight columns filled | Ask Ben which one he entered (spec Step 3c), counted per row, not per file |
| `Weight Unit` value other than kgs/lbs/kg/lb | Unreadable row, showing its raw value |
| `22,5` or another non-dot decimal | Unreadable row; nothing guessed. If many rows fail this way, report `This file may use decimal commas` |
| Two-part `Time` in an A or B file (`25:00`) | Ambiguous: it could be `H:MM` or `MM:SS` (§3.2). Don't guess. Ask once per file or mark it unreadable (design decision). In C files it means `MM:SS` [Doc] |
| Repeated identical rows on a date | Real repeated sets. **Never de-duplicate within a file** |
| Rows out of date order, or an exercise's sets split across a date | Keep row order as set order. Group by date. Record exercise order as first appearance [Inference] |
| Timed strength sets (Plank: Time only) and weighted carries (w + d) | **Not cardio.** Needs a design decision: import as timed or distance sets, or list them separately (spec change S3) |
| Cardio rows (d and/or t only, no w/r) | Skipped and listed (P-I4), using the column pattern or `Kind` |
| Weight `0`/`0.0` or blank on a weight-and-reps row | Treat as "no added load", keep the raw value, and include it in the bodyweight question |
| Negative weights | Show the range in the bodyweight question (`Values in your file: −20 to 0`). Never assume |
| Converted lb values (220.46) | Import as written. Never snap imported completed sets to feasible loads (rule 2) |
| Instruction-like text in names or comments | Data only (rule 8, check 26) |
| A re-export of the same history (new file, new name) | Match by date + source + row content. FitNotes lets users edit history, so an old date can differ. GymSmarter's version wins (spec §3.4) |
| Body Tracker CSV picked by mistake | Header has `Date` but no `Exercise`. Show `This looks like a FitNotes Body Tracker export. Choose the Workout Data export.` [Inference: header unknown] |
| `.fitnotes` backup or FitNotes 2 backup picked | SQLite or zip magic bytes → the existing "backup, not CSV" message |
| A file from the other iPhone "FitNotes – Workout Tracker" | Falls through as an unknown header. The first line is shown for the developer |

## 6. CSV vs `.fitnotes` backup (Android)

- `.fitnotes` is a plain SQLite database. Its default name is `FitNotes_Backup.fitnotes`, with an optional timestamp in the name [Doc, settings]. One tool, whose schema was reverse-engineered from real backups, reports SQLite `user_version` 22 [Reports: fitnotes-merger README].
- What it holds, according to third-party readers:
  - FlexNotes: "workouts, sets, PRs, comments, workout times, exercises, categories" plus all body tracker measurements. FlexNotes says it doesn't import routines from backups.
  - fitnotes-merger: sets in `training_log`, plus routines, body weight, measurements, goals, workout notes/times, settings and plates.
  - Weights are reportedly stored in kg [Reports: Cadence issue #19, unverified].
- **What the CSV loses compared with the backup** [Inference]: workout start/end times, workout comments, PR flags, routines, per-exercise units in A files, and body weight.
- The schema is undocumented and version-tagged, so reading it is a bigger, riskier job. Keep it as a later option only (Recommendation 8).

## 7. What only Ben's real export can settle

1. Which app, which version, and whether he is a Supporter (per-exercise units, extra exercise types).
2. The exact first line: which of A1/A2/B1/B2/C (or C-v14), with or without `Comment`.
3. The literal `Weight Unit` strings, and how numbers are written (`100` / `100.0` / `100.00`, decimal separator, float artefacts in lb).
4. How bodyweight, assisted and timed sets look:
   - `0.0` or blank weight;
   - negative values;
   - the `Time` format, especially whether two-part values are `H:MM` or `MM:SS`;
   - distance unit strings.
5. Encoding, BOM, line endings, and quoting of comments that contain commas, newlines or quotes.
6. FitNotes 2 only:
   - whether warm-up, RPE or RIR appear;
   - whether both weight columns are ever filled;
   - whether v14 offers a Strong/Hevy-format export that carries them.
7. Whether exercise and category names (or headers) are translated.
8. Whether any date holds more than one workout, and whether rows are always in date order.
9. File size and row count, for check 27 (10,000 rows in under 5 s).
10. How often his comments contain effort ratings (`@8`, `RPE 9`), to tune the extraction review.

## Proposed spec changes (data-import-export.md; designer/PM decide)

| # | Change | Why |
|---|---|---|
| S1 | Check 16: detect and name **A1-kg, A1-lb, A2, B1/B2 and C** (headers in §2), with Android `Comment` optional. Detection label: `FitNotes (Android) CSV` for both A and B, `FitNotes 2 (iPhone) CSV` for C | The spec's Android header is the pre-2023 layout. Current Android (v24/25) exports `Weight` + `Weight Unit` |
| S2 | The unit is per row. The preview line reads `weights in kg` / `in lb` / `in kg and lb (per set)`. The Step 3c question appears only for C rows with both columns filled | A files have one unit; B and C files can mix units |
| S3 | Add a decision for **timed and distance strength sets** (Plank, carries, weighted dips with time), separate from "cardio rows (not imported yet)". Include how an ambiguous two-part Android `Time` is handled | Classifying by "has Time" would skip planks the spec itself matches (`Plank (timed)`). Android parsers disagree on `MM:SS` vs `H:MM` |
| S4 | Intro steps may name the paths, hedged: Android `⋮ → Settings → Spreadsheet Export → Workout Data` (include comments); iPhone `Settings → Backup & Export → Export CSV`, plus `Menus can differ by app version.` | The Android path is documented [Doc] and three READMEs repeat it. The iOS path is partly documented |
| S5 | State that imported workouts are **date-only** (no invented time) and that FitNotes keeps one workout per date | Rule 6. Removes the worry that sessions "merge" |
| S6 | Add a Body Tracker CSV message, and mark imported sets' set type as **not recorded** (FitNotes has no warm-up column) so Progress and "Last" rules can treat them deliberately | Imported warm-ups would otherwise count as working sets |
| S7 | §4.4 FitNotes 2 export: ascending dates, sets grouped, ≤ 2 decimals, one weight column per row, `Kind` letters | Documented import rules [Doc] |

## Proposed brief changes

- **Brief v0.2 bullet "FitNotes: … RPE is not expected as a column."**
  - Proposed wording: "RPE is not a column in Android FitNotes exports. FitNotes 2 (iPhone) has recorded RPE, RIR and warm-up flags since 2024. Its September 2026 update mentions them in CSV import/export for Hevy, FitBod and Strong formats, so check Ben's file and the export options his version offers. Otherwise RPE comes only from reviewed comment parsing."
  - Ben approves; the PM records it in `CHANGELOG.md`.
- No stack or architecture change, so no ADR.

## Sources (all checked 2026-10-09)

Official, FitNotes (Android):
- https://www.fitnotesapp.com/settings/ (Spreadsheet Export, backup name, unit system, Calculate Personal Records, Supporter-only exercise units)
- https://www.fitnotesapp.com/release_24/ (per-exercise units, convert vs change, export folder and file name)
- https://www.fitnotesapp.com/release_1_23/ (workout start/end times; set and whole-workout comments)
- https://www.fitnotesapp.com/release_25/ · https://www.fitnotesapp.com/release_1_22/ · https://www.fitnotesapp.com/release_1_21/
- https://www.fitnotesapp.com/exercises/ (exercise types, Supporter types, categories) · https://www.fitnotesapp.com/workout_tracking/ · https://www.fitnotesapp.com/body_tracker/ · https://www.fitnotesapp.com/faq/ · https://www.fitnotesapp.com/glossary/

Official, FitNotes 2 (iOS):
- https://www.getfitnotes.com/docs/migrate-from-other-apps.html (CSV header and rules)
- https://www.getfitnotes.com/docs/backup-export.html (Export CSV, Android DB, the more-than-2-kinds limit) · https://www.getfitnotes.com/docs/migrate-from-android.html
- https://getfitnotes.com/docs/workout-import-export.html (text/JSON; numeric `exercise.kind`; rpe/rir/isWarmup)
- https://www.getfitnotes.com/docs/workout-sets.html (photo/video notes; RPE, RIR, rest, warm-up per set) · https://www.getfitnotes.com/docs/settings.html · https://www.getfitnotes.com/docs/body-tracker.html · https://www.getfitnotes.com/docs/contact-community.html
- https://www.getfitnotes.com/changelog/ (up to v12, including v1.0 both units, v1.2, v3.0.0, v8 Android-CSV entries)
- https://apps.apple.com/us/app/fitnotes-2-gym-workout-log/id1538896016?see-all=version-history (v1.5.1–v14)
- https://apps.apple.com/gb/app/fitnotes-workout-tracker/id1059245195 (the unrelated iPhone "FitNotes")

Real sample and parsers [Sample/Code]:
- https://raw.githubusercontent.com/moferg/fitnotes-data-viz/master/FitNotes_Export_2020_10_04.csv
- push-fitnotes:
  - commits 68b8039 (27 Feb 2023) and af7c034 (11 Jun 2023): https://github.com/tihawk/push-fitnotes/commit/68b8039de3e1a07ec13690d7029078f48f880605 · https://github.com/tihawk/push-fitnotes/commit/af7c0345fd71e88df7ffdd2f1266fb312251cc5d
  - https://github.com/tihawk/push-fitnotes/commits/master/src/csv-parser/index.ts
  - https://raw.githubusercontent.com/tihawk/push-fitnotes/master/src/csv-parser/index.ts · https://raw.githubusercontent.com/tihawk/push-fitnotes/master/src/util/interfaces.ts · https://raw.githubusercontent.com/tihawk/push-fitnotes/master/src/util/index.ts
- fitnotes2fit:
  - https://github.com/tihawk/fitnotes2fit/commit/c093557 (25 Sep 2024, via https://api.github.com/repos/tihawk/fitnotes2fit/commits/c093557)
  - https://raw.githubusercontent.com/tihawk/fitnotes2fit/master/src/main/java/com/developination/fitnotes2fit/models/FitNotesSet.java
- FitNotes2Hevy:
  - https://raw.githubusercontent.com/alanjonesit/FitNotes2Hevy/main/src/fitnotes2hevy/converter.py · https://raw.githubusercontent.com/alanjonesit/FitNotes2Hevy/main/src/fitnotes2hevy/config.py · https://raw.githubusercontent.com/alanjonesit/FitNotes2Hevy/main/README.md
  - https://github.com/alanjonesit/FitNotes2Hevy/commits/main (Dec 2025)
- rosenpin: https://raw.githubusercontent.com/rosenpin/fitnotes-converter/main/convert.py · https://raw.githubusercontent.com/rosenpin/fitnotes-converter/main/README.md (Sep 2025)
- Frefdt: https://raw.githubusercontent.com/Frefdt/Fitnotes-To-Strong-Converter/main/converter.py (Apr 2025)
- ikkani: https://raw.githubusercontent.com/ikkani/Fitnotes2Hevy/main/main.py (Nov 2025)
- nerdOut: https://raw.githubusercontent.com/rsiani/nerdOut/master/nerdOut.Rmd
- chewxy: https://gist.github.com/chewxy/6b59cd3324fd5218f0e8 (Nov 2015)
- org-fit: https://raw.githubusercontent.com/guancio/org-fit/master/cli/csvimport.py · https://github.com/guancio/org-fit/commits/master/cli/csvimport.py (2018, positional)
- swift-workout-importer:
  - https://github.com/gossamr/swift-workout-importer
  - `Tests/WorkoutImporterTests/FitNotesCSVImporterTests.swift` and `Fixtures/fitnotes-example.csv`, both synthetic
- aboustayyef (Uralsky app): https://raw.githubusercontent.com/aboustayyef/fitnotes/master/app/CsvImporter.php

Reports:
- https://kinoku.app/import-format (two-column claim, synthetic sample)
- https://apkpure.com/fitnotes-gym-workout-log/com.github.jamesgay.fitnotes/versions (Android version dates)
- https://github.com/espipj/fitnotes-merger · https://github.com/Flameingskull/FlexNotes · https://github.com/Flameingskull/FitLens/issues/75 · https://github.com/liminal-hq/cadence/issues/19 (backup contents)
- https://jacked.coach/tools/fitnotes-csv-import-checker/ (uses the C header) · https://github.com/gymcoach-app/gymcoach/issues/399 (no format detail)

Not reachable: reddit.com and old.reddit.com (fetch blocked), fitnotes.info (HTTP 503, again on the fact-check pass) and web.archive.org (fetch blocked). Web search found no Reddit threads on the CSV format, and no real Android v24+ export, so this file has no user-forum evidence.
