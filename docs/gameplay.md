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
- Wrong answer: 20 s lockout on that challenge; hints cost cash.
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

## Death & respawn
Drops carried cash as a bag; respawn at hospital after 5 s with 50 HP, unarmed; banked cash and vault progress kept. Kill bonus (small, config) to discourage pure camping.

## Cash flow
Carrying: visible bag, −10% speed per $100k (cap −30%). **Banking** at one of 3 safehouses (4 s interaction, interrupted by damage). Scoreboard shows banked cash and kills.

## Vehicles (Phase 8)
Sedan (balanced), sports car (fast, fragile), bike (light); enter/exit with F; collision damage; can be shot out; can carry cash bags.

## Engagement levers
Alarm/bounty markers, killfeed, day/night (night = reduced visibility), vault progress on map, round-end awards (fastest solver, most vaults cracked), streak bonuses for consecutive correct answers.

## Tuning
Tier 1 ≈ 30–60 s, tier 5 ≈ 4–6 min. Admin analytics show real medians; teachers retune tiers, not code.
