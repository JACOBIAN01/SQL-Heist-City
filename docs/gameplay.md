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
Alarm/bounty markers, killfeed, day/night (night = reduced visibility), vault progress on map, round-end awards (fastest solver, most vaults cracked), streak bonuses for consecutive correct answers.

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
- Rooms: at most 40 at once (`maxRooms`), each closed after 30 minutes or when its player leaves. These numbers and the start HP are in `shared/src/config/tutorial.ts`; the steps' words are there too.

