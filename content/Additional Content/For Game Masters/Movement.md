---
permalink: additional/gm/movement
---
In Tiny d10, there are three different layers at which movement occurs:

| Layer                      | Movement Rate       | Movement Type          |
| -------------------------- | ------------------- | ---------------------- |
| Combat                     | Feet per 10 seconds | Brisk walk to run      |
| Exploration (Dungeon)      | Feet per 10 minutes | Stealthy to cautious   |
| Exploration (Overland)[^1] | Miles per hour      | Careful to quick march |
Every layer is abstracted to a different turn length, but still centered around the same `feet per second/minute` and `miles per hour` math, with 1-10 mph being the "operational" range for most classes.

>It should be noted that the only thing the rules are doing here is *establishing turn length*, which is completely flexible to the table's needs.
## Determining A Creature's Movement Rate
Simply take the creature's average rate of speed in miles per hour (mph) and multiply it by 15: this produces its movement rate in feet per 10 seconds (for use in combat scenarios); feet per minute (as necessary) can be easily derived.

>**Note:** Movement rate scales by turn length, so a creature with a 100 ft. movement rate can likewise move 600 ft. per minute, and over 1 mile per 10 minutes.
### Sprinting
Considering that the maximum sprint speed for a reasonably fit adult is 15-20 mph, it is recommend that a "sprint" action be added to the available combat options.

*Sprint* – move up to triple your maximum movement speed for one round (may not perform any other actions on this round).

>**Note:** Combat is the only layer where sprinting makes sense, as it is sustainable for only a few seconds at a time.
## Examples
|       | average (mph) | ft/round | 5s burst (mph) | top speed (mph) |
| ----- | ------------- | -------- | -------------- | --------------- |
| human | 5.5           | 80       | 11             | ~15             |
| bear  | 10            | 150      | 20             | ~30             |
| horse | 12            | 180      | 24             | ~44             |
| wolf  | 12            | 180      | 24             | ~35             |
### Considerations
- When it comes to dungeon crawling, the turn exists primarily to signal to GMs when they should check for wandering monsters, or advance any plots being executed by the dungeon's denizens.

---
[^1]: In the interest of brevity, overland travel is averaged at 2 mph in Fantasy Core; with the addition of [[Encumbrance]] and the [[Downloads|Worldwide Adventure Generator]], travel guidance has been updated.
