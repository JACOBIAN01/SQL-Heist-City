# Inputs needed from the owner

What the phases need that code cannot invent. Work goes ahead without waiting: every phase is built and tested against local stand-ins, and anything below that is missing is marked **blocked** in `docs/Phases.md` instead of being faked. Hand these over when you have them, in any order.

## Needed soon (phases 13–15)

| # | What | Why | Phase |
|---|---|---|---|
| 1 | **Google OAuth client** (type "Web application"): client ID and client secret, and the redirect URIs you will use (dev: `http://localhost:8081/auth/google/callback`; production: your real domain) | Sign-in. Until then sign-in runs against a local fake Google in tests and a dev-only bypass. Put them in environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), never in the repo | 13.5 |
| 2 | **School domains allowed to sign in** (for example `myschool.edu`) or "any Google account" | The optional allow-list | 13.5 |
| 3 | **A production PostgreSQL** (managed, connection string in `DATABASE_URL`). Development and CI use a private local PostgreSQL that the repo starts itself | System of record | 13.2, 20.3 |
| 4 | **Answers to `docs/RCBSE.md` section 11**: marks scale (proposed 1–5 by tier), hint penalty (25%), abandon threshold (20 s), target profile (R10 C25 S40 B10 E15), export format | Fixes how marks and radars are computed | 15.1 |
| 5 | **A sample of your dimension-analysis sheet** (the spreadsheet you use today to analyse RCSBE per student), so the export matches its columns | CSV export | 15.15 |
| 6 | **A teacher to review** the RCSBE and Bloom tags I give the 150 existing questions, and the ~100 new questions of phase 17 | Tags and new questions are my judgement until a teacher agrees | 15.4, 17 |

## Needed before launch (phases 16–25)

| # | What | Phase |
|---|---|---|
| 7 | Which SQL dialect(s) your classes use (SQLite is what runs today; PostgreSQL and MySQL notes are planned) | 17.14 |
| 8 | Which two languages (English and a Hindi draft are in), and a native speaker to review `client/src/i18n/hi.ts` and translate the rest | 22.7 |
| 9 | 3 low-end Chromebooks or similar for the performance pass, or the model names of what schools use; ideally also a gamepad and a touch screen to try 22.4/22.5 on real hardware | 22.6 |
| 10 | A cloud account for staging and production (provider of your choice), a domain name, and who gets alerts (email or chat address) | 20 |
| 11 | A legal reviewer for the privacy policy, terms and school agreement (COPPA, GDPR, India DPDP) and the school consent wording. **The drafts are ready** in `docs/legal/` (published with a visible "draft" banner until `reviewed: true`); the list of questions for the reviewer is in `docs/legal/README.md`. Bracketed items (operator name, contact, providers, governing law) are yours to fill in | 21 |
| 12 | An IARC account for the content rating (a questionnaire only the publisher can submit). **Prepared answers** are in `docs/legal/rating.md`; after the rating, set Settings → Privacy → minimum age to at least the rating's age | 21.7 |
| 13 | 2–3 schools and teachers for the pilot, with their consent forms; real students for usability tests | 23.6, 24 |
| 14 | An external penetration tester (a vendor or person you trust), a staging environment and test accounts. The brief to send them is ready: `docs/pentest-brief.md` (fill in the bracketed items) | 18.6 |
| 15 | Cloud machines for the 100- and 200-player load test (otherwise only local numbers are recorded) | 19.1 |

## Needed after launch (phases 26–36)

| # | What | Phase |
|---|---|---|
| 16 | Story direction: tone, setting and whether a crew with named characters suits your classes (I will draft a bible for you to approve) | 32 |
| 17 | Music for the car radio and any extra sound or art you want (licensed or created; the current sounds are generated in code) | 29.7, 35 |
| 18 | Countries and currencies for the localised themes | 34.7 |
| 19 | Sponsor or school branding for seasons and cosmetics, if any | 26 |

## Things that can only be done by you

These are outward-facing or irreversible, so I prepare everything and stop short: the production deploy (25.3), submitting the IARC questionnaire (21.7), sending anything to schools, publishing a policy, and running the external pen test (18.6). The checklist (25.1) lists them with their evidence.
