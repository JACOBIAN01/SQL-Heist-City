---
title: Data Processing Agreement (template)
reviewed: false
updated: 2026-10-17
---

# Data Processing Agreement (template)

Between **[School or district name, address]** (the "School", controller) and **[Operator name, address]** (the "Operator", processor), for the **SQL Heist City** service.

## 1. Subject and duration
The Operator processes personal data of the School's students and staff to provide the service to the School's classes, for as long as the School uses it and until deletion under section 9.

## 2. Instructions
The Operator processes the data only on the School's documented instructions, which are: to provide, secure and improve the service for the School's classes as described in the Privacy Policy and Terms. It tells the School if it believes an instruction breaks the law.

## 3. What data, whose, and for what
| | |
|---|---|
| **Data subjects** | students of the School's classes; the School's teachers and administrators |
| **Student data** | Google account id, name and email, school domain; chosen display name; classes joined; whether the student confirmed they meet the minimum age; the learning record (questions asked, marks, tries, hints, round results, briefs and marks) |
| **Staff data** | login email, a password hash, actions in the admin (audit log) |
| **Not collected** | birth date, photo, address, phone, location, advertising identifiers |
| **Purpose** | teaching and assessing SQL; running classes; keeping the service secure and fair |

The complete list of fields is the Operator's data map (`privacy.md`), kept in step with the database by an automated test.

## 4. Confidentiality
People who handle the data are bound by confidentiality. Access is limited to what their work needs and is logged.

## 5. Security measures
Encryption in transit (TLS); passwords and sessions stored as hashes; signed short-lived game tickets; per-address and per-connection rate limits; origin checks; isolated, resource-limited SQL execution that is fuzz-tested every night; secrets from the environment, refused if weak, and scanned for in the code; dependency audit on every change; PostgreSQL with daily backups kept 14 days and a tested restore; structured logs that contain no names, emails or answers; monitoring and alerts. An external penetration test is planned [status to be filled in]. The Operator will tell the School of material changes to these measures.

## 6. Sub-processors
The School agrees to the following and to others the Operator tells it about in advance, with a chance to object:

| Sub-processor | Purpose | Location |
|---|---|---|
| Google (sign-in) | identity | [to be filled in] |
| [Hosting provider] | servers and database | [to be filled in] |
| [CDN provider] | delivering the game page | [to be filled in] |

The Operator keeps the same obligations on each of them as in this agreement.

## 7. International transfers
Where data leaves the School's country or the European Economic Area, the Operator relies on [adequacy decisions / standard contractual clauses / other: reviewer to complete].

## 8. Helping the School
The Operator helps the School answer requests to access, correct, export or delete a student's data (the menu and the admin provide these directly), and with impact assessments and consultations with authorities, as far as the Operator's role allows.

## 9. Return and deletion
At the end, or on request, the Operator deletes the School's classes and students' data (or returns an export first). Unused accounts, archived classes and old briefs are deleted automatically after the times in the Privacy Policy. Backups expire within 14 days.

## 10. Breaches
The Operator tells the School without undue delay, and within [48] hours of becoming aware, of a breach affecting personal data, with what it knows: what happened, what data, what it is doing.

## 11. Audits
The Operator makes available the information needed to show compliance and allows reasonable audits by the School or an auditor it names, with notice, during working hours, once a year unless a breach calls for more.

## 12. Liability and law
As in the Terms of Use. [Reviewer to complete.]

Signed for the School: ________________  Name, role, date

Signed for the Operator: ________________  Name, role, date
