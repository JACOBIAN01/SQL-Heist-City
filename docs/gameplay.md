# Gameplay

All numbers are **defaults**; each lives in `settings` (admin-editable).

## Premise
An empty city, 100 students, 5 banks. The only way to do anything is to out-think the lock — in SQL — while everyone else is trying to shoot you.

## Match
100 players (60–200 configurable), 15-minute rounds, random street spawns, unarmed, 100 HP, 5 s spawn protection. **Win:** highest **banked** cash at the end (early end if all 5 vaults emptied). Late join in first 3 minutes.

## Banks
| Bank | Floors | Tier | Vault loot |
|---|---|---|---|
| 1 Corner Savings | 3 | 1 | $50k |
| 2 City Trust | 4 | 2 | $100k |
| 3 Metro Capital | 4 | 3 | $200k |
| 4 Grand Reserve | 5 | 4 | $400k |
| 5 Federal Vault | 6 | 5 | $800k |

Lobby → offices (loose cash, minor loot) → vault floor. Stairs and elevators (loud, chokepoint).

## Loose office cash (12.1)
Every other desk in a bank's offices has a small pile of cash on it, laid out again at the start of every round.
- **Amount:** per pile, by the bank's tier (`looseCashByTier`, default $1,000 at Corner Savings up to $4,000 at Federal Vault).
- **Picking it up:** walk over it, exactly like a bag. It is carried, dropped on death and banked like any other cash.
- **No lock guards it**, so it is the first money a player without a gun can find. Next to a vault it is small change.
- It never holds a round open: the early end ("every vault open and its loot gone") waits only for vault bags and dropped bags.
- **Drawing:** a few banded bundles lying still on the desk; it is not marked on the minimap.
- **Where:** `cashOnDesks` in `shared/src/world/bank/dressing.ts` derives the piles from each layout's desks, so moving a desk moves its cash.

## Vault
N locks (default 3); lock *k* tier = min(5, bankTier + k − 1). Solved locks **persist** through death/disconnect. Final lock → door opens → loot bags spawn, anyone can grab. Opening a lock triggers an alarm radius + minimap marker (ambush bait).

## The catch: one brain, three needs
The world never pauses. While the pop-up is open the player stays vulnerable.
| Need | Reward | Default tier |
|---|---|---|
| Heal | +20 / +50 / full | 1 / 3 / 4 |
| Gun | pistol / SMG / shotgun / rifle / sniper | 1 / 3 / 3 / 4 / 5 |
| Ammo | refill current gun | 1 |
| Vault lock | progress to loot | bank-based |

- Switching task discards the question; next request = new variant (panic-switching has a cost).
- Wrong answer: 10 s lockout on that challenge; hints cost cash.
- Run (preview) is free but rate-limited; only Submit counts.
- Pop-up can be minimised to fight; timer continues. Challenge expires after 5 min with no penalty.

## Combat (defaults, config-driven)
| Gun | Dmg | RPM | Mag | Range | Falloff | Job |
|---|---|---|---|---|---|---|
| Pistol | 18 | 300 | 12 | 40 m | from 20 m to 60% | a fair start |
| SMG | 12 | 750 | 30 | 35 m | from 12 m to 50% | close range, keeps its aim on the run |
| Shotgun | 9×8 | 70 | 6 | 15 m | from 6 m to 25% | owns a doorway, nothing past it |
| Rifle | 28 | 450 | 25 | 80 m | from 45 m to 70% | mid range, aimed |
| Sniper | 90 | 40 | 5 | 200 m | none | long sight lines, scoped and still |

Hitscan, headshot ×2. Guns are earned **per life**.

**What sets the guns apart (9.5):** damage falls off linearly from the falloff distance to the minimum share at full range. Spread is the gun's base cone, widened on the move in proportion to speed (`moveSpread` at a sprint: small for the SMG, large for the rifle, crippling for the sniper) and multiplied by `aimSpread` while aiming. Right mouse aims: the view zooms by the gun's `aimZoom` (the sniper's 4× shows a scope and hides your own body), mouse look slows by the same factor, and the character raises the gun. Each shot kicks the view up by `recoil`; pulling it back down is the player's job. The server decides falloff and spread (from the shooter's speed and the Aim button); zoom and recoil are the shooter's view only.

**Tuning:** all of it is in `shared/config/combat.ts` and editable by admins (Settings → Guns, settings key `combat`; stored guns override the defaults one field at a time). Matches pick changes up at their next round and send every client the new numbers.

> **Sandbox map:** on the sandbox yard everyone still holds the rifle with unlimited ammo (`sandboxWeapon`); heist maps (`unarmedStart`) start everyone unarmed. Magazines are finite there: each shot spends a round (a shotgun blast one, all pellets), an empty gun clicks, and `ammo:refill` fills the held gun's magazine; guns are lost on death. Respawn is 5 s at 50 HP with 5 s protection, all from `shared/config/combat.ts`.

## Death & respawn
Drops carried cash as a bag; respawn at the hospital (`respawns` on the map, one bed per spot) after 5 s with 50 HP, unarmed; banked cash and vault progress kept. The 5 s spawn protection ends the moment its owner fires (no shooting from behind it). Kill bonus (`killBonus`, default $2,000, setting) goes to the killer's pocket, on top of whatever the victim drops.

## Cash flow
Carrying: visible bag, −10% speed per $100k (cap −30%). **Banking** at one of 3 safehouses (4 s interaction, interrupted by damage). Scoreboard shows banked cash and kills.

## Vehicles (Phase 8)
Sedan (balanced), sports car (fast, fragile), bike (light); enter/exit with F; collision damage; can be shot out; can carry cash bags.

## Engagement levers
Alarm/bounty markers, killfeed, day/night (night = reduced visibility), vault progress on map, round-end awards (see "Round awards"), streak bonuses for consecutive correct answers (see "Progression").

## Tuning
Tier 1 ≈ 30–60 s, tier 5 ≈ 4–6 min. Admin analytics show real medians; teachers retune tiers, not code.

## Vehicles (Phase 8.7)
**Physics:** `stepVehicle` (`shared/src/sim/vehicle.ts`) is shared and deterministic like `stepBody`, so the server can own cars in 8.8 and clients can predict them.
- **Steering:** a bicycle model: yaw rate = speed · tan(wheel angle) / wheelbase. The wheels turn toward the stick at `steerSpeed`, and the full lock shrinks to `highSpeedSteer` at top speed.
- **Pedals:** pressing against the motion brakes first, then drives the other way. Coasting slows the car; Jump is the handbrake.
- **Collision:** the car's footprint (an oriented rectangle) is pushed out of map boxes by the separating-axis test.
  - Boxes lower than 0.3 m (kerbs) are driven over.
  - A head-on hit bounces the car back with `bounce` × its speed.
  - A glancing hit scrapes along the wall, losing some speed.

**Running people over (12.3).** A car with a driver hurts anyone on foot it touches (within `runOver.reach` of its body). Damage is `(speed − minSpeed) × damagePerSpeed × mass/1000` hit points, so below `runOver.minSpeed` (5 m/s) a car only shoves, and a fast, heavy car kills a full-health player. One pass is one hit (`hitCooldownSec`). The kill goes to the driver (kills, bounty, feed, awards). Empty rolling cars and people on upper floors are never hit. All numbers are `VehicleSettings.runOver` and the `mass` of each kind.

**Kinds:** the numbers per kind (`sedan`, `sports`, `suv`) are in `VehicleSettings` (`shared/src/config/vehicles.ts`, defaults only).

| | top speed | accel | brake | full lock | footprint |
|---|---|---|---|---|---|
| sedan | 20 m/s (72 km/h) | 7 m/s² | 16 m/s² | 0.6 rad | 4.2 × 1.8 m |
| sports | 26 m/s | 10 | 20 | 0.55 | 4.0 × 1.85 |
| suv | 17 m/s | 6 | 14 | 0.6 | 4.2 × 2.1 |

**Models:** Quaternius *Cars* (CC0): NormalCar1/2, Taxi and Cop are sedans; SportsCar and SportsCar2 are sports; SUV is an SUV (`CAR_KIND`, client). The pack has no motorbike, which 8.9 must find or build.

**Getting in and out (8.8):** every car belongs to the server.
- **Parked cars:** the city parks about 50 cars along the kerbs (`parkedCarChance` per slot, facing the traffic on that side, clear of the lane spawns). They are back in their spots at the start of each round.
- **Driving:** F next to an empty car (within 1.6 m of its body) gets in; F again gets out, if the car is going no faster than 4 m/s and there is room by a door, behind or in front. While you drive, your movement input drives the car on the server, and your client predicts it (`PredictedVehicle`, reconciled each snapshot like on foot).
- **The driver:** sits in the car. Other players do not see the body, but bullets still find it; you cannot shoot or use a lift, vault or safehouse from the wheel. Dying or leaving frees the car, which rolls to a stop.
- **Crashes:** cars shove each other: a head-on hit bounces the moving car back and pushes the other.
- **Drawing:** a car standing still is drawn as one merged mesh (one draw call); a moving one has steering and rolling wheels. Cars further than 110 m are not drawn.

Cars are solid to people on foot: after each movement step a body is pushed out of any car footprint it overlaps (`pushBodyOutOfCars`, shared by the server and client prediction), losing the speed it had into the car. A car rolling into someone shoves them aside, never into a wall (that push is skipped). Bodies on an upper floor (y ≥ 1.4 m) ignore cars. Not yet: running people over (no damage from cars) and car damage.

## Hearing (Phase 8.10)
Sound is information. Gunshots carry 220 m and stay loud for 18 m, so a fight is heard streets away and roughly where it is. Footsteps carry only 28 m, and crouching makes them a third as loud: sneaking up works. A cracked vault lock rings that bank's alarm for 18 s, out to 160 m, which tells everyone nearby that a vault is being worked. All of these numbers are in `shared/src/config/audio.ts`. Design and code: frontend.md "Audio".

## Alarms, bounties and the feed (Phase 9.7)
- **Alarm:** every cracked vault lock puts a red line in everyone's feed: "ALARM · Metro Capital (bank 3): lock 2/3 cracked". The bank's minimap marker pulses and its bell rings. It says where, never who: the crackers stay anonymous until they carry the cash.
- **Vault open:** the last lock is announced as "Metro Capital vault is OPEN", in gold.
- **Banked:** "Ana banked $30,000", in green.
- **Bounty:** anyone alive carrying **$100k or more** is wanted (`bountyThreshold`).
  - The feed says so ("Ana carries $120,000 · $10,000 bounty"), and the wanted player is told everyone can see them.
  - Every 2 s (`bountyEverySec`) the server posts where every wanted player is to everyone. The minimap shows them as orange `$` diamonds, on the rim when far.
  - Whoever kills a wanted player collects **$10,000** (`bountyReward`) on top of the kill bonus and the cash they drop, and the feed says who claimed it.
  - Banking the cash, or dropping below the threshold, lifts the bounty.
- **Server:** the heist rules publish events on one bus (`HeistEvents`, Observer: lock opened, vault opened, banked, wanted, bounty claimed). `FeedReporter` and `BountyBoard` subscribe or publish there, so later features (round awards, metrics) can listen without touching the vault or banking code.

## Tutorial (Phase 9.8)
A new player opens the game with `?tutorial` (normal game pages show a "New here? Play the tutorial" link until it has been finished once in that browser). Each player gets a **private room**: a small walled yard with Bank 1, a firing range with three targets and one safehouse. The questions are real ones from the database.

| # | Step | Done when (the server judges it) |
|---|---|---|
| 1 | Move | standing within 2.5 m of the marker |
| 2 | Heal with SQL | a heal task solved (you start at 35 HP) |
| 3 | Earn a gun | owning any gun |
| 4 | Shoot | a practice target knocked down |
| 5 | Crack the vault | the vault open (the tutorial vault has one lock) |
| 6 | Grab the cash | carrying cash |
| 7 | Bank it | cash banked |

- Steps are taken in order, but one done early (a gun before the heal) counts when its turn comes.
- A glowing beacon and a ring on the minimap mark where the current step happens. The card ticks steps off, and the last one offers a real match.
- Tutorial heist rules sit on top of the game's own: one lock, $10,000 in the vault, no kill bonus (the targets would hand out cash), and a long round (`TUTORIAL_HEIST_OVERRIDES`).
- **Same questions, solution free (Phase 10.3):** the heal, gun and vault tasks each always ask one fixed question (defaults: `t1-staff-roster`, `t1-big-earners`, `t1-dept-staff`), built from a fixed seed, so every player on every run sees the same tables. The pop-up has a "Show solution (free)" button that shows the query and puts it in the editor, and hints cost nothing. Admins pick the three questions on the Settings page ("Tutorial questions"); a missing or disabled one falls back to a normal pick. Ammo refills are issued the normal way.
- Rooms: at most 40 at once (`maxRooms`), each closed after 30 minutes or when its player leaves. These numbers, the start HP and the fixed questions are tutorial settings (`shared/src/config/tutorial.ts`, settings key `tutorial`); the steps' words are there too.

## Round awards (Phase 9.9)
When a round ends, the results card shows the winner, then one card per award somebody earned, then the top 10.

| Award | For | Counted from |
|---|---|---|
| Safecracker | most vault locks cracked | `lock_opened` with its solver |
| Quick Draw | fastest correct SQL answer | `task_solved`: seconds from the question being issued to the correct submit (server clock) |
| SQL Brain | most SQL tasks solved | `task_solved` |
| Top Gun | most kills | `kill` (practice targets do not count) |
| Bounty Hunter | most bounty cash claimed | `bounty_claimed` |
| Big Haul | biggest single banking | `banked` |

- Ties go to whoever got there first. A player who left before the end is passed over, and an award nobody earned is not shown.
- `RoundAwards` (server) listens on the heist event bus; each award is one rule (Strategy). Tallies reset when the next round starts. Players joining during the intermission see the same card.
- The award names and units are in `shared/src/config/awards.ts`; the server sends only the award id, the winner and the number (`awards` on the `round` ended message).


## Classroom mode (Phase 14)
A teacher makes a **class** in the admin: a name, a six-character **join code**, which **banks are open**, a **city seed**, an optional **round length**, a **player cap** (60–200) and the **question set**: each question is released for a kind of task (vault locks, healing, guns, ammo). A class only ever receives questions released to it, for that kind of task.

**Joining.** A student signs in with Google, types the code in the menu (limited to 8 wrong guesses a minute) and is added to the class's roster. They wait in a lobby until the teacher presses **Start the match**; the match is a private room (its own thread and port) that plays the class's city. They connect with a ticket made for that class, so a ticket opens only that room. A locked class lets in only students already on its roster.

**Closed banks.** A bank the teacher did not open stays on the map marked CLOSED. Its vault cannot be worked, it has no loose cash, and the round does not wait for it.

**During a match** the teacher can end the round, start the next now, stop the room, remove or rename a student, lock the room to newcomers, and edit the class (the new question set and open banks apply at once, round length at the next round). When a round ends its standings and awards are saved and can be reviewed later.

## Teaching loop (Phase 16)
- **Hints climb a ladder:** a free one-line nudge, then the topic's concept card (free), then the question's own paid hints. Only paid steps lower the marks a question earns.
- **Errors in plain words:** a SQLite error comes with a tip on what it usually means.
- **While you fight:** the minimised pop-up keeps the question's tables in view; the editor autocompletes this question's tables and columns only.
- **After the round:** press V for the review: every question you met, your last query, the model answer and the concept cards. Nothing of it is sent during the round.
- **Fair difficulty:** a student whose profile is weak gets easier questions, more time and smaller heals (settings); the weakest topics come back now and then (spaced repetition).
- **Practice:** a solo drill from the menu, by topic and tier, with no match and no rewards; it counts toward the profile.
- **Pre/post tests:** a teacher sets a short fixed test before and after a unit; the gain per dimension shows on the class's Learning page.

## Before a class can play (Phase 21)
A class cannot start, and students cannot join it, until a teacher or administrator has ticked each statement of the school's terms in the class editor, including the plain statement that the game is violent (cartoon shooting and cars, no blood or gore). A new student is asked the year they were born once; only whether they are old enough is kept (the age is a setting, default 13), and someone found too young can only delete their account. Unused accounts, archived classes and old briefs are deleted on a schedule (Settings → Privacy). See `docs/privacy.md`.

## Planning the next heist (Phase 17.10)
When a round ends, a signed-in player sees **Plan the next heist** on the results card. It opens an open brief (`brief:plan`): the player writes a goal, when they are done and how they know it worked, and puts their queries in the editor (Run works as usual). It gives nothing in the game; a teacher marks it later against its rubric and the marks count as Build. The task stays open into the next round until its time runs out. `planningBriefs` (heist settings) turns it off; `taskKinds` (challenge settings) keeps briefs out of every in-round task and keeps planning to briefs only.

## Dropping out and coming back (Phase 19.5)
A signed-in player who loses their connection mid-round keeps their seat: banked cash, kills, deaths and guns are held, and come back when they rejoin the same match in the same round, even after the join window has closed. What they were carrying is dropped as loot when they drop, as before. A seat lasts until the round ends. Signing in again from a second tab or device takes over: the older connection is closed ("Signed in somewhere else") and its seat passes to the new one. Players without an account have no seat, since nobody can prove it is them.


## Progression (Phase 26)
**XP and ranks (26.1).** A signed-in student earns XP two ways, both set in the admin (`progression`):
- **Learning:** a solved question pays by tier (20 / 35 / 55 / 80 / 120), ×1.25 when right first time with no paid hint, ×0.9 per paid hint, ×1.5 for a topic not solved recently. Part marks pay their share. The tutorial and the pre/post tests pay nothing.
- **Playing:** at the end of a round, 20 for finishing, 4 per kill, 8 per $1,000 banked, and 40 / 25 / 15 for the podium — **capped at 150 per round**, so a player who only fights cannot out-rank one who is learning (the cap is no more than three mid-tier first-try solves).
Ranks (Rookie → Mastermind by default) come from total XP. The HUD shows the rank, a bar to the next one, and "+N XP" when something is earned. XP only goes up and is deleted with the account.

**Skill tree (26.2).** Topics are grouped into nodes (Selecting → Filtering → Joins → Subqueries → CTEs → Window functions …). A node is *mastered* when the student has at least 3 counted questions on its topics and has earned 70 % of the marks available on them; it is *open* when everything it requires is mastered (the roots are always open). Press **J** to see it. The tree is an admin setting (`progression.skills`), so a teacher or admin can reshape it; the shipped questions' topics are all covered (a test enforces it). The tree currently shows progress and gates nothing in play — cosmetics (26.3) and the profile (26.9) use it.

**Cosmetics (26.3).** Outfits (shirt colour), masks and car paint are earned, never bought or won from a box: each is unlocked by reaching a rank or by mastering a skill-tree node (the free "Street grey" outfit aside). Press **U** to wear what you have earned; locked items show what they need. The server checks every choice, and everyone in the match sees how you look; your car wears your paint while you drive it (a tint over the car's colours). The catalog is an admin setting (`progression.cosmetics`).

**Streak bonus (26.4).** In a match, answers that are right at the first go, one after another, earn extra carried cash from the third on: $500 for the third, $1,000 for the fourth, and so on up to $3,000 (`heist.streak`). A wrong submit or a death ends the run, and each round starts everyone at zero. The cash is carried like any other, so it can be lost; the tutorial pays no streak.

**Daily contracts (26.5).** Each UTC day a student is dealt three short SQL contracts (for example "solve 3 Joins questions", "solve 2 questions of tier 3 or higher", "solve 5 right first time with no hints") from the admin-editable list in `progression.contracts`. The same student gets the same three all day; different students get different mixes. A finished question fills the contracts it counts for (never in the tutorial or a pre/post test) and finishing one pays XP. Finishing at least one contract on consecutive days builds a **day streak**: each extra day adds 10 % to contract XP, up to 7 days; a missed day starts again. Press **L** to see them.

**Weekly class league (26.6).** For each class and week (Monday to Sunday, UTC) every student who played or answered gets points: **10 per mark earned** on counted questions, **1 per $1,000 banked in class rounds (at most 100 points a week from cash)**, and 5 per round played. Learning therefore decides the table, and cash cannot win it alone. Teachers see the full table on the class page (with a week picker); students in the room see the top ten (**H**) with their learning and cash points apart. Ties share a rank. The weights live in `progression.league`.

**Seasons (26.7).** A season is a few weeks with a theme (`progression.seasons`: name, first and last day, a track). While one runs, every XP a student earns also fills the season's **free track**; each step unlocks a themed cosmetic (outfit, mask or car paint) that stays theirs after the season ends. There is nothing to buy and no paid track. The track and days left are shown in the wardrobe (**U**). Seasons may not overlap, and a season taken out of the settings can no longer be earned.

**Round card (26.8).** When a round ends, the review panel (**V**) offers a picture of the student's round — name, place, haul, kills, the awards they won and their best query with its time — that they can **save** or **share**. It is drawn on their own device; the game uploads nothing, and the model answer is never on it. An admin can switch cards off, or leave the query off (`progression.share`), for a class that should not trade answers.

## Squads (Phase 27)
A teacher can run a class in **squads of 3 or 4** (class setting: none, teacher's list, students pick, or balanced by mastery). A squad scores as one: its members' banked cash, kills, vault locks and solved tasks are added up and ranked on the scoreboard and at the end of the round, with four squad awards (Top Haul, Lock Breakers, Wolfpack, Brain Trust). Students who pick for themselves can do so until they have banked cash in the round, so cash cannot be carried from one squad to another. "Balanced by mastery" deals students out strongest-first in a snake so no squad is stacked, treating a student with no record yet as average.

**Roles.** Each member of a squad may take one role, each role once per squad (press **G**): *Hacker* (hints cost half), *Driver* (40 % less damage in a car), *Enforcer* (15 % less damage on foot), *Lookout* (rivals within 60 m show on their minimap). The perks are small and live in `heist.roles`; they have not been balanced in a real playtest yet.

**Squad HUD.** Squad-mates appear under the minimap with their health and what they are solving, and on the minimap and full map. No chat (out of scope).

## Game modes (Phase 28)
A class picks a **mode**; a mode is only settings (`modes` in the admin): which heist numbers it changes, how many banks are open, and whether the room plays a heist or duels. The teacher's own round length still wins over a mode's.
- **Classic heist** — the full game as before.
- **Smash and Grab** — five minutes, one bank (the lowest the class has open), two locks per vault, a short overtime.
- **SQL Quick Draw** — one against one. Students wait in a queue and are paired; after a short countdown both get *the same question* (from the class's released set, quick ones, no hints). The first correct answer wins the draw — a shot, counted as a kill — and the duel goes to whoever wins more than half of five draws. Nobody solving a draw in time scores for nobody; a student who leaves forfeits. There is no cash and no vault in this mode.

## Police and the wanted level (Phase 29.4)

Cracking a lock, killing a player, a bank guard or an officer earns stars (`heist.police.crimeStars`, up to `maxStars`). Each star sends `perStar` officers, who appear out of sight 45–85 m away, follow the streets and shoot on sight; from `roadblockFromStars` two officers also block the street ahead. Stay out of every officer's sight for `escapeSeconds` to lose a star; at zero they go home. Dying, leaving or a new round clears it. Tutorial and duel rooms have no police. All numbers are settings.

## Weather (Phase 29.5)

The match clock is cut into spells of `atmosphere.weather.spellMinutes`, each clear, foggy, rainy or stormy by `weights`, the same for everyone and blended over `blendSeconds`. Fog shortens how far you see; rain draws streaks and adds a rain sound. It changes nothing about shooting, damage or grading.
