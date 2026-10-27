# Story bible — SQL Heist City

The words in the game's story live in the `story` settings (admin → Settings → Story). This is the plan they follow. Status: **drafted, waiting for the owner's approval** (Phase 32.1). Change anything here, then change the settings to match.

## The premise

Five banks hold the city's money, and all five have been lying about it. A small crew, the **Ledger Crew**, was started by a woman who read the books at the biggest bank and could not un-read them. The player is new hands: students who can read a table. Each bank hides one page of evidence in its vault. Collect all five and the case against the man who signed every false entry is complete.

The tone is a caper, not a war. The heists are violent in the game's way (guns, guards, police) but the story is about being right: the crew steals only to prove a fraud, and every key to every door is a query. Nobody is hurt in the telling, and nothing is described that the game does not show.

## The crew

| Fixer | Where | Role in the story | What they teach |
|---|---|---|---|
| **Mae Okafor** | Corner Savings (tier 1) | Former teller. Let go after asking why deposits doubled on paper. | Reading a table: SELECT, WHERE |
| **Dev Rao** | City Trust (tier 2) | Auditor. Audits what he is shown and has begun to wonder about the rest. | Relating tables: JOIN |
| **Inez Vega** | Metro Capital (tier 3) | Analyst whose sum will not close. | Totals and groups: GROUP BY, aggregates |
| **Walt Brennan** | Grand Reserve (tier 4) | Retired guard. Knows the shifts and who looks away. | Questions inside questions: subqueries, windows |
| **Lena Hart** | Federal Vault (tier 5) | Ran the books at the top, then read them. Founded the crew. | Building an answer in parts: CTEs |

**The antagonist** is **Marcus Vale**, head of the Federal Vault ("the Reserve"). He never appears in a mission; his signature is on the first page. He is the reason there are five chains and not one.

## The arc across the tiers

1. **The first page** (Corner Savings): deposits that never happened.
2. **Two ledgers** (City Trust): the same accounts, two sets of totals.
3. **The numbers do not add up** (Metro Capital): it is short by exactly what another bank is long.
4. **Walt's old beat** (Grand Reserve): the money comes to rest in a delivery at three in the morning that is on no manifest.
5. **The Reserve** (Federal Vault): Vale's books, with his signature on page one.

Each chain unlocks the next, so the story climbs with the player's skill. Finishing all five plays the ending: the pages, put together, make the case, and the last line is that the queries will do the rest.

## How a chain plays

Every chain is three steps, using only things the game already does:

1. **The briefing:** gather intel on that bank at the terminal outside it. Higher banks ask for more intel.
2. **The favour:** finish one kind of contract chosen to suit the fixer (a delivery for Mae, recon for Dev, sabotage for Inez, an escort for Walt, data theft for Lena).
3. **The heist:** crack that bank's vault and bank the take.

Finishing a chain pays cash and XP, and gives the page. A scene plays when a chain starts and when it ends; the fixers also say a short line at moments in a heist (intel gained, a lock cracked, the vault open, the getaway, the heist done, a heist lost, the police close in, a contract done). Every question is framed by one line from the fixer, so the question sits in the story. Scenes can be skipped.

Solo or together: a student's progress is their own, and if squad-mates are near when one finishes a heist, they share the credit.

## Rules for the words

- Short: a scene is two or three lines, a bark one sentence, a frame one line.
- Plain English, readable at age 11 and up. No real people, banks or brands.
- Never tell the player the answer to a question. A frame sets the scene; it does not hint.
- No gore, no slurs, no jokes at anyone's expense.
- Hindi: every line will need a translation (the settings hold English; see `docs/inputs-needed.md`).

## What the owner decides

- Whether this story, these names and this arc are right (this is the approval 32.1 asks for).
- Whether the question stories (the situations each of the 268 questions describes) should be rewritten to match the arc. Phase 32.4 adds the framing line to every question without touching them; a full rewrite is a content job.
