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
| Gun | Dmg | RPM | Mag | Range |
|---|---|---|---|---|
| Pistol | 18 | 300 | 12 | 40 m |
| SMG | 12 | 750 | 30 | 35 m |
| Shotgun | 9×8 | 70 | 6 | 15 m |
| Rifle | 28 | 450 | 25 | 80 m |
| Sniper | 90 | 40 | 5 | 200 m |

Hitscan, recoil/spread, headshot ×2. Guns are earned **per life**.

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

Not yet: people walking through cars (bodies do not collide with cars), running people over, and car damage.
