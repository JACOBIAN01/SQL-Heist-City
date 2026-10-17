# Legal documents (Phase 21.2, 21.6)

**Status: DRAFTS for the owner's legal reviewer. Not legal advice, and not yet reviewed.** They are written from what the product actually does (`docs/privacy.md` is the source for every fact) and are shown to schools and students with a visible "draft" notice until a reviewer has signed them off (inputs-needed #11).

| File | For | Published at |
|---|---|---|
| `privacy-policy.md` | students, parents, schools | `/legal/privacy.html` in the game and the admin |
| `terms.md` | schools and students | `/legal/terms.html` |
| `dpa.md` | the school or district (a template to sign) | `/legal/dpa.html` |

`npm run legal` (also part of `npm run build`) turns these into pages. To publish after review: fill in the bracketed items, set `reviewed: true` in each file's header, and the draft banner disappears.

## What the reviewer is asked to check
1. **The operator.** Who is the controller or processor: the school (controller) with us as processor, which is how the documents are written, or the operator directly?
2. **Children.** COPPA (under 13, USA): school authorisation in place of parental consent. GDPR Article 8 (digital age of consent 13 to 16 by country): school as the basis. India's DPDP Act, section 9: verifiable consent of a parent for anyone under 18, and a ban on tracking, behavioural monitoring and targeted advertising of children. Is the school's acceptance (`classes.consent_*`) enough in each country, or does a parent notice or form also have to be collected?
3. **The violence notice and rating.** The consent text says the game is violent, cartoon-style, no blood or gore. The IARC questionnaire answers are prepared in `docs/legal/rating.md`; the owner submits it.
4. **International transfers** (Google, hosting, CDN) and where the data lives.
5. **Breach notification** times and who tells whom.
6. **A DPIA** (GDPR Article 35) is likely advisable for children's data at school scale; `docs/privacy.md` is the record of processing.

## Where each requirement is met in the product
| Requirement | Where |
|---|---|
| Data minimisation (GDPR 5, COPPA) | no birth date, photo or location; birth year used once and not kept (`players.age_status`); `docs/privacy.md` lists every column and a test keeps it complete |
| Notice (GDPR 13, COPPA, DPDP 5) | the privacy policy, linked from the menu and the class consent |
| Consent on behalf of the school / parents | `classes.consent_*`: a class cannot start, and students cannot join it, until a teacher or administrator ticks every statement of the current terms; the version is recorded and a new version asks again |
| Age limit | age gate at first sign-in, minimum age a setting (default 13); a refusal stays and offers deletion |
| Access and portability (GDPR 15, 20) | menu → Download my data |
| Erasure (GDPR 17, COPPA, DPDP 12) | menu → Delete my account; automatic deletion of unused accounts, archived classes, old briefs (`PrivacyRetention`) |
| Rectification (GDPR 16) | display name editable; staff can rename in a class |
| No profiling for ads, no sale | nothing of the kind exists; stated in the policy |
| Security (GDPR 32) | TLS, hashed passwords and sessions, signed short-lived tickets, rate limits, origin checks, sandboxed SQL, fuzzing, secrets policy, backups (`docs/operations.md`); an external penetration test is planned (18.6) |
| Records of processing (GDPR 30) | `docs/privacy.md` |
| Processor terms (GDPR 28) | `dpa.md` |
| Logs hold no personal data | logger masks emails and tokens; `scripts/scan-logs.mjs` checks real logs |
