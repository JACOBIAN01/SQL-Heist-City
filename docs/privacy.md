# Data map (Phase 21.1)

What SQL Heist City keeps, why, and for how long. It is written from the real database: a test (`server/src/pg/dataMap.test.ts`) fails if a table or column exists that is not described here, or is described here but does not exist. So when you add a column, you have to say what it is for.

**Who the data is about.** Students (play with a Google account, often a school account, often under 18, sometimes under 13) and staff (teachers and administrators). Nobody else.

**What we do not collect.** No photo, date of birth (the birth year a student gives is used once and not kept), address, phone number, location, contacts, device identifiers, advertising identifiers or voice. No analytics or advertising services. No data is sold or shared for any other purpose.

**Kinds of data** (column "Kind"):
- **personal**: identifies a person (name, email, Google account id, password hash).
- **pseudonymous**: a number that points at a person's record (`player_id`). Meaningless without the `players` table; deleted with it or cut loose from it.
- **record**: what a person did (answers, marks, rounds), tied to them through a pseudonymous id.
- **school**: a class's settings and the school's decisions.
- **content**: questions, settings, text written by staff. About no one.
- **technical**: ids, timestamps, flags that only make the system work.

**How long** is in the last column, using the settings an administrator can change under Settings → Privacy (defaults in brackets; 0 keeps for ever): *unused account* (365 days), *archived class* (180 days), *open brief* (730 days), and the learning-record settings under Settings → Learning measures: *raw events* (180 days), *finished items* (730 days). "With the account" means it is removed when the student deletes their account, or the unused-account clean-up does.

## Students

### `players`
One row per student who has signed in.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Our number for the student | pseudonymous | with the account |
| `google_sub` | Google's stable id for their account | personal | with the account |
| `email` | Their Google email address | personal | with the account |
| `display_name` | The name other players see (they choose it; checked against a word list) | personal | with the account |
| `school_domain` | The domain of their email (`school.edu`) | personal | with the account |
| `created_at` | When they first signed in | technical | with the account |
| `last_seen_at` | When they last signed in; drives the unused-account clean-up | technical | with the account |
| `age_status` | Whether they said they are old enough: unknown, ok or too_young. The birth year is not stored | technical | with the account |

### `player_sessions`
A signed-in browser.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `token_hash` | A hash of the session cookie (the cookie itself is not stored) | technical | until it expires (12 hours) or the student signs out |
| `player_id` | Whose session | pseudonymous | as above |
| `expires_at` | When it stops working | technical | as above |
| `created_at` | When it began | technical | as above |

### `player_settings`
A student's own settings (sensitivity, volumes, key choices, text size, colour palette, language), so they play the same on any device.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `settings` | Their choices (no free text) | record | with the account |
| `updated_at` | When they last changed them | technical | with the account |

### `player_progress`
What a student has earned toward their rank (Phase 26): XP from solving questions and XP from playing rounds.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `learning_xp` | XP from solved questions | record | with the account |
| `play_xp` | XP from rounds (kills, cash banked, finishing) | record | with the account |
| `updated_at` | When it last changed | technical | with the account |

### `player_loadout`
Which unlocked cosmetics a student wears (outfit, mask, car paint), so other players see them.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `choice` | One cosmetic id per slot (no free text) | record | with the account |
| `updated_at` | When they last changed it | technical | with the account |

### `player_collectibles`
Which data chips (hidden SQL trivia cards) a student has found in the city (Phase 30.3), and which districts of the city they have explored (Phase 30.5).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `chip` | Which chip (the city seed and its number) or which district (`district:` and the city seed and its name); no free text | record | with the account |
| `found_at` | When they found it | technical | with the account |

### `player_upgrades`
Which safehouse upgrades a student has bought and at what level (Phase 30.4).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `upgrade` | Which upgrade (a fixed name, no free text) | record | with the account |
| `level` | How many levels they own | record | with the account |

### `player_story`
How far a student has got through each bank's story chain (Phase 32.2).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `chain` | Which chain (a bank, such as `bank-3`; no free text) | record | with the account |
| `step` | How many steps they have finished | record | with the account |

### `query_records`
A student's leanest correct query for each question: how many rows it is estimated to read and how long it is (Phase 34.4). The query text itself is **not** kept. Shown on the question's table, in the student's class and across the game, by display name.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `question_id` | Which question | content | with the account |
| `player_id` | The student | pseudonymous | with the account |
| `class_id` | The class they were in (a number; no class details) | pseudonymous | with the account |
| `scanned` | Estimated rows read | record | with the account |
| `length` | Characters in the query (no text) | record | with the account |
| `achieved_at` | When they reached it | technical | with the account |

### `player_contracts`
The daily contracts a student was dealt and how far each got (Phase 26.5). Old days are deleted by the retention job.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account, or 30 days per day |
| `day` | The calendar day (UTC) | technical | as above |
| `state` | Contract ids with progress and done flags (no free text) | record | as above |

### `player_streaks`
How many days in a row a student finished a contract.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `days` | The run length | record | with the account |
| `last_day` | The last day a contract was finished | record | with the account |
| `updated_at` | When it last changed | technical | with the account |

### `player_season_xp`
XP a student earned during each season (Phase 26.7), which fills the season's free track.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `season` | Which season (an id from the settings) | technical | with the account |
| `xp` | XP earned while it ran | record | with the account |

### `class_squads`
Which squad each student is in, within a class (Phase 27).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `class_id` | The class | school | with the class |
| `player_id` | The student | pseudonymous | with the class or the account |
| `squad` | The squad's number in the class | school | as above |

### `class_members`
Which students joined which class (by its code).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `class_id` | The class | school | with the class |
| `player_id` | The student | pseudonymous | with the class or the account |
| `joined_at` | When they joined | technical | as above |

### `class_results`
The scoreboard of each finished round of a class.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `round_id` | The round | technical | with the class |
| `rank` | Their place | record | with the class |
| `player_id` | The student; cut loose (set empty) when they delete their account | pseudonymous | with the class |
| `name` | The name they played under that round | personal | with the class |
| `banked` | Cash banked | record | with the class |
| `kills` | Kills | record | with the class |
| `deaths` | Deaths | record | with the class |

## The learning record

### `attempt_events`
The raw steps of each question: asked, run, submitted, hint taken, expired.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | technical | *raw events* (180 days) |
| `at` | When | record | as above |
| `player_id` | The student; cut loose when they delete their account | pseudonymous | as above |
| `class_id` | The class, if played in one | school | as above |
| `challenge_id` | The one question asked | technical | as above |
| `question_id` | Which question | content | as above |
| `reward_key` | What it was for (heal, gun, vault lock) | technical | as above |
| `kind` | What happened | record | as above |
| `detail` | Small facts (seconds, count, whether a query ran) — never the student's SQL | record | as above |

### `attempt_items`
One row per question a student finished, with how it went and the marks it earned.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `challenge_id` | The question asked | technical | *finished items* (730 days) |
| `player_id` | The student; cut loose when they delete their account | pseudonymous | as above |
| `class_id` | The class | school | as above |
| `round` | The round of the class | technical | as above |
| `question_id` | Which question | content | as above |
| `question_version` | Which version of it | content | as above |
| `reward_key` | What it was for | technical | as above |
| `tier` | Difficulty | content | as above |
| `rcsbe` | Which skill it measures | content | as above |
| `bloom` | Which level of thinking | content | as above |
| `marks` | What it was worth | content | as above |
| `topics` | Its SQL topics | content | as above |
| `outcome` | Solved, expired, abandoned… | record | as above |
| `runs` | Times they ran a query | record | as above |
| `submits` | Times they submitted | record | as above |
| `wrong_submits` | Wrong submits | record | as above |
| `hints_paid` | Paid hints used | record | as above |
| `seconds_open` | Seconds the question was open | record | as above |
| `tutorial` | Whether it was the tutorial | technical | as above |
| `counted` | Whether it counts toward the profile | technical | as above |
| `available` | Marks on offer | record | as above |
| `earned` | Marks earned | record | as above |
| `issued_at` | When asked | record | as above |
| `finished_at` | When finished | record | as above |
| `assessment` | Whether it was part of a pre- or post-test | record | as above |

The student's own SQL is kept only in the memory of the match, for the review after the round, and is never written to the database (`docs/RCBSE.md`, section 12).

### `profile_totals`
The running marks behind each student's radar charts. Additive numbers; they survive the pruning of items above, and go with the account.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `player_id` | The student | pseudonymous | with the account |
| `scope` | All time, a class, a round, or a pre/post test | technical | with the account |
| `class_id` | Which class | school | with the account |
| `round` | Which round | technical | with the account |
| `lens` | RCSBE or Bloom | technical | with the account |
| `dimension` | Which skill or level | technical | with the account |
| `earned` | Marks earned | record | with the account |
| `available` | Marks on offer | record | with the account |
| `items` | How many questions | record | with the account |

### `brief_submissions`
Open briefs a student wrote between rounds (a goal, queries, how they checked), waiting for or already marked by a teacher.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `challenge_id` | The brief | technical | *open brief* (730 days) |
| `player_id` | The student; the brief goes with their account | pseudonymous | as above |
| `class_id` | The class | school | as above |
| `round` | The round | technical | as above |
| `question_id` | Which brief question | content | as above |
| `question_version` | Its version | content | as above |
| `title` | The brief's title | content | as above |
| `story` | The brief's text | content | as above |
| `rcsbe` | Skill | content | as above |
| `bloom` | Level | content | as above |
| `item_marks` | What it is worth | content | as above |
| `topics` | Its topics | content | as above |
| `rubric` | The marking criteria | content | as above |
| `text` | What the student wrote | record | as above |
| `sql` | The queries they wrote | record | as above |
| `submitted_at` | When | record | as above |
| `marks` | The teacher's marks per criterion | record | as above |
| `feedback` | The teacher's comment | record | as above |
| `marked_by` | The teacher's login name (an email address) | personal | as above |
| `marked_at` | When it was marked | record | as above |

### `assessments`
A class's pre- or post-test: which questions, and whether it is open.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | technical | with the class |
| `class_id` | The class | school | with the class |
| `kind` | Pre or post | school | with the class |
| `question_ids` | The questions | school | with the class |
| `open` | Whether students can take it | school | with the class |
| `created_at` | When it was set | technical | with the class |

## Classes and staff

### `classes`
A teacher's class.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | technical | *archived class* (180 days after archiving) |
| `code` | The join code students type | school | as above |
| `name` | The class name | school | as above |
| `owner_user_id` | The teacher | pseudonymous | as above |
| `city_seed` | Which city | school | as above |
| `banks_open` | Which banks are open | school | as above |
| `round_minutes` | Round length | school | as above |
| `player_cap` | Most students | school | as above |
| `locked` | Closed to new students | school | as above |
| `archived` | Put away by the teacher | school | as above |
| `archived_at` | When; starts the clean-up clock | technical | as above |
| `created_at` | When made | technical | as above |
| `updated_at` | When last changed | technical | as above |
| `dialect` | Which SQL dialect notes to show | school | as above |
| `mode` | Which game mode the room plays (an id from the settings) | school | as above |
| `squad_mode` | How squads are formed (off, teacher, self, auto) | school | as above |
| `squad_size` | Students per squad (3 or 4) | school | as above |
| `consent_version` | Which version of the terms the school accepted | school | as above |
| `consent_user_id` | The teacher who accepted | pseudonymous | as above |
| `consent_at` | When | school | as above |

### `class_questions`
Which questions a class may be asked, for what.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `class_id` | The class | school | with the class |
| `question_id` | The question | content | with the class |
| `usage` | Vault, heal, gun or ammo | school | with the class |

### `class_rounds`
Each finished round of a class.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | technical | with the class |
| `class_id` | The class | school | with the class |
| `number` | Round number | technical | with the class |
| `started_at` | Start | technical | with the class |
| `ended_at` | End | technical | with the class |
| `awards` | The round's awards: names of winners as they appeared | personal | with the class |

### `users`
Teachers and administrators (staff sign in with email and password, not Google).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | pseudonymous | until an administrator removes the account |
| `email` | Their login | personal | as above |
| `password_hash` | A salted scrypt hash, never the password | personal | as above |
| `role` | Teacher or admin | technical | as above |
| `disabled` | Switched off | technical | as above |
| `created_at` | When made | technical | as above |

### `sessions`
A signed-in staff browser.

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `token_hash` | A hash of the cookie | technical | until it expires (12 hours) or sign-out |
| `user_id` | Whose | pseudonymous | as above |
| `expires_at` | When it stops | technical | as above |
| `created_at` | When it began | technical | as above |

### `audit_log`
Who changed what in the admin (a record for accountability).

| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | technical | no limit set; entries about a deleted student have their details blanked |
| `user_id` | The staff account | pseudonymous | as above |
| `actor` | The staff email at the time | personal | as above |
| `action` | What was done | record | as above |
| `entity` | To what kind of thing | technical | as above |
| `entity_id` | Which one | technical | as above |
| `detail_json` | Small facts (counts, field names), never answers | record | as above |
| `at` | When | technical | as above |

## Content: about no one

These tables hold questions, settings and teaching text written by staff.

### `questions`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | content | until deleted by staff |
| `slug` | Short name | content | as above |
| `tier` | Difficulty | content | as above |
| `title` | Title | content | as above |
| `enabled` | In use | content | as above |
| `current_version` | Latest version | content | as above |
| `template_json` | The question | content | as above |
| `updated_by` | The staff login that last changed it | personal | as above |
| `created_at` | When made | content | as above |
| `updated_at` | When changed | content | as above |
| `deleted_at` | When removed | content | as above |

### `question_versions`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | content | as above |
| `question_id` | The question | content | as above |
| `version` | Version number | content | as above |
| `template_json` | That version | content | as above |
| `created_by` | The staff login | personal | as above |
| `created_at` | When | content | as above |

### `question_topics`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `question_id` | The question | content | as above |
| `topic` | A topic | content | as above |

### `pools`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `id` | Row number | content | until deleted by staff |
| `name` | Name | content | as above |
| `description` | Text | content | as above |
| `created_by` | The staff login | personal | as above |
| `created_at` | When | content | as above |
| `updated_at` | When | content | as above |

### `pool_questions`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `pool_id` | The pool | content | as above |
| `question_id` | The question | content | as above |

### `concept_cards`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `topic` | The topic | content | until deleted by staff |
| `title` | Title | content | as above |
| `nudge` | One-line hint | content | as above |
| `body_md` | The explanation | content | as above |
| `version` | Version | content | as above |
| `updated_by` | The staff login | personal | as above |
| `updated_at` | When | content | as above |

### `concept_card_versions`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `topic` | The topic | content | as above |
| `version` | Version | content | as above |
| `title` | Title | content | as above |
| `nudge` | One-line hint | content | as above |
| `body_md` | The explanation | content | as above |
| `created_by` | The staff login | personal | as above |
| `created_at` | When | content | as above |

### `reward_map`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `reward_key` | A reward | content | until changed by an administrator |
| `tier_min` | Easiest question for it | content | as above |
| `tier_max` | Hardest question for it | content | as above |

### `settings`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `key` | Which setting | content | until changed by an administrator |
| `value_json` | Its value | content | as above |

### `schema_migrations`
| Column | What it holds | Kind | Kept |
|---|---|---|---|
| `version` | A database change that has been applied | technical | for ever |
| `applied_at` | When | technical | for ever |

## Elsewhere

| Where | What | Kept |
|---|---|---|
| **Cookies** | `heist_player` (a student's session, HttpOnly, 12 hours), a short-lived sign-in cookie during the Google redirect (minutes), the staff session cookie (12 hours). No tracking cookies | as stated |
| **The browser** (`sessionStorage`, `localStorage`) | Unsent SQL drafts for the question being worked on; sound and display choices | on the student's own device, until they clear it |
| **Round card** (Phase 26.8) | A picture of the student's round (name, place, haul, awards, their best query), drawn in their browser when they open the review. Saved or shared only if they press a button; the game sends it nowhere. An admin can switch it off or leave the query off (`progression.share`) | on the student's own device, as long as they keep it |
| **Game memory** | Who is in the match, positions, health, cash, the student's last SQL for the post-round review | until the round or the connection ends; never written to the database |
| **Content snapshot** (SQLite file on the game server) | Questions, settings, concept cards. No student data | rebuilt from PostgreSQL |
| **Logs** | JSON lines: events, errors, anomalies (a match-local player label and, for cheat checks, our number for the student). No names, emails, tickets, queries or answers; emails and tokens in any text are masked, and a scan of real logs checks it (`scripts/scan-logs.mjs`) | by the host's log retention (set it to 30 days or less) |
| **Metrics** | Numbers only: players, tick times, queue lengths. Labels are match or class numbers | by the monitoring system's retention |
| **Backups** | A copy of the whole database | 14 days (`docs/operations.md`); a deletion leaves backups until they expire |
| **Google** | Receives a sign-in request; sends us `sub`, email, name and domain (scopes `openid email profile`) | Google's own policy |
| **Hosting, CDN** | See the data processing agreement for the actual providers | per agreement |

## Rights and how they are met

- **Access and export**: a student's menu → "Download my data" (all sources in `PersonalDataRegistry`: account, learning record, briefs, class memberships).
- **Deletion**: menu → "Delete my account" removes the account and everything keyed to it at once; the learning record rows keep no link to the person (`player_id` is emptied). Staff can ask an administrator to do the same.
- **Unused accounts** are deleted after the *unused account* time; archived classes and old briefs after theirs (`PrivacyRetention`, daily, audited with counts only).
- **Correction**: a student can change their display name; staff can rename in a class.
- **A school's decisions**: a class cannot start, and students cannot join it, until a teacher or administrator has accepted the terms for the school (`classes.consent_*`); the notice says plainly that the game is violent.
- **Age**: asked once; a student found too young stays refused and can only delete their account.
