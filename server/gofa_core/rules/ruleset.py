"""Game rules moved verbatim out of server/server.py on 2026-11-10 (docs/CORE_SURVEY.md refactor step 2, re-tools/rules_extract.py).

Tables and formulas only: nothing here touches player state, time, random, protobuf or files, so the legacy server and a future core
can share one source of balance numbers. Comments are kept as they were (they record where each number came from).
server.py imports these names; edits here take effect on the next hot reload (serve.py watches this module).
"""
import math
import os


HOME_BY_RACE = {1: 1101, 2: 2101, 3: 3101}   # species -> start planet: Terran Home 1001, Vossk A'Belarr 2001,
# Nivelian Ninarah 3001 (map order = species enum; the map has no species field). Chosen at seed time, kept in "home".


START_RESOURCES = 40000.0   # every video starts with 40,000 of each on Home1


COLONY_START_RESOURCES = 500.0


# Planet resources (planet field 9, element 0x100c68490): {1 type 1-5*, 2 amount*, 3 production per DAY
# (the HUD shows it /24 as "/h"), 4 storage capacity, 5 Timestamp of the amount}. Confirmed on screen 2026-10-09.
# Types: 1 metal, 2 gas, 3 crystal (4/5 = marines / spy probes, not used yet).
# Placeholder economy: base 10/h per resource + 30/h per extractor level (3 metal, 4 gas, 5 crystal extractor).
CAPACITY = 50000   # storage at HQ 1 (the original starts with 40,000 of each and keeps producing); see capacity()

EXTRACTOR_OF = {1: 3, 2: 4, 3: 5}


# Original economy (2026-11-04, from four gameplay videos 2013-2016, findings "Sany FireMan"): every cost is a base value
# x species x planet quality x the producing building's percent; build time in seconds = (metal + gas + crystal) / 2.
# BUILD_X = extractor cost per resource. Exact: L1-2, L10-12 (28,800 x 0.95 x q7 0.775 = 21,204 shown 21,205). L3-5 from
# Trade Center / Barracks L2-5, L6-9 interpolated between them, L13+ assumed x1.2 per level in 2,400 steps.
BUILD_X = {0: 10, 1: 10, 2: 20, 3: 80, 4: 800 / 3, 5: 800, 6: 1800, 7: 3900, 8: 7800, 9: 14400, 10: 16800, 11: 24000,
           12: 28800, 13: 33600, 14: 40800, 15: 48000, 16: 57600, 17: 69600, 18: 84000, 19: 100800, 20: 120000}

# Structure -> (metal, gas, crystal) multipliers of BUILD_X: HQ L4 800 x 3, Shipyard L4 800 / 400 / 0, Barracks L2 60 / 0 / 30,
# L5 2,400 / 0 / 1,200, L9 43,200 / 0 / 21,600, Scanner L2 0 / 60 / 30, Trade Center L2 30 x 3, L3 120 x 3.
BUILD_MIX = {1: (3, 3, 3), 2: (3, 1.5, 0), 3: (1, 1, 1), 4: (1, 1, 1), 5: (1, 1, 1), 6: (3, 0, 1.5), 7: (3, 0, 6), 8: (0, 3, 1.5),
             9: (3, 0, 6), 10: (1.5, 1.5, 1.5), 11: (3, 3, 3)}

BUILD_OVERRIDE = {(7, 2): (180, 0, 360), (9, 2): (180, 0, 360), (1, 2): (40, 40, 40)}   # Laboratory / Planetary Defense L2, HQ L2 seen


# Trade Center exchange ratio x100 per level (wiki Structures; L6 3.00 : 1 seen in the video), statics s11 field 6 = the TRADE tab's "Ratio".
TRADE_RATIO_PERCENT = {1: 350, 2: 340, 3: 330, 4: 320, 5: 310, 6: 300, 7: 290, 8: 280, 9: 270, 10: 260, 11: 255, 12: 250, 13: 245,
                       14: 240, 15: 235, 16: 230, 17: 225, 18: 220, 19: 215, 20: 210}


def total_seconds(*cost):
    return sum(cost) / 2


def build_cost(stype, level):
    """Base cost (metal, gas, crystal) of building `stype` up to `level`; also sent in statics section 11."""
    if (stype, level) in BUILD_OVERRIDE:
        return BUILD_OVERRIDE[(stype, level)]
    x = BUILD_X[min(level, max(BUILD_X))]
    return tuple(int(x * k) for k in BUILD_MIX.get(stype, (1, 1, 1)))


def build_seconds(stype, level):
    return int(total_seconds(*build_cost(stype, level)))


def extractor_part(level):
    """Extractor output per planet rating point: +66.7 each for L1-2, then +33.3 (Home1, rating 3: 398 / 598 / 698 / 798 /
    898; 5 x L11 + L10 fits the 12k/h citadel). Extractors on a planet add up."""
    return (200 * min(level, 2) + 100 * max(0, level - 2)) / 3


# Research per resource: L1 20, L2 180, L3 800 (estimate), L4 ~3,500 seen, then the building table three levels up.
RESEARCH_X = {0: 20, 1: 20, 2: 180, 3: 800, 4: 3500}


def research_cost(level):
    x = RESEARCH_X.get(level) or int(BUILD_X.get(level + 3, BUILD_X[20] * 1.2 ** (level - 17)))
    return x, x, x


def research_seconds(level):
    return int(total_seconds(*research_cost(level)))


def carrier_cost(lvl):
    k = int(1000 * 2.2 ** (lvl - 1))   # Carrier MK I 1,000 x 3, 25:00; MK II / III multiplier from the old balance
    return k, k, k


def carrier_seconds(lvl):
    return int(total_seconds(*carrier_cost(lvl)))


SPECIALIST_OF = {1: 16, 2: 17, 3: 18}   # resource -> commander skill (metal / gas / crystal specialist, seen on screen)

SPECIALIST_BONUS = 0.10                  # placeholder: +10% production per skill level


# Planet output (2026-11-04): (PLANET_BASE + extractors) x map rating x species planet bonus x bonuses. One L5 extractor gives
# exactly 898/h on Home1 and 449/h on Home2: the rating scales the whole planet. Home1 rating 2.5 x Terran on Oceanic 1.2 = 3.
PLANET_BASE = 66.0

# Species planet influence (wiki, docs/ORIGINAL_NUMBERS.md): (race 1 Terran / 2 Vossk / 3 Nivelian, map type 1 ocean, 2 jungle, 3 ice,
# 4 mountain, 5 volcano, 6 desert, 7-9 citadels) -> bonus.
SPECIES_PLANET = {(1, 6): 1.1, (1, 1): 1.2, (1, 4): 1.1, (3, 3): 1.2, (3, 2): 1.1, (3, 4): 1.1, (2, 6): 1.1, (2, 2): 1.1, (2, 5): 1.2,
                  **{(r, pt): 1.2 for r in (1, 2, 3, 4) for pt in (7, 8, 9)}}


def storage_step(level):
    """Resource capacity of a Headquarters / Trade Center level (wiki): +12,500 per level to 8, then +25,000 per level."""
    return 12500 * min(level, 8) + 25000 * max(0, level - 8)


# Artifact dig cost / time = statics s17 id 10 (0x100283814). The client scales it (0x10057d120 -> 0x10057d3ac):
# base x s2 double 6 (1.0) x s11 citadel field 6 / 100 x f(v), f(v) = 1 - 0.3 (v-1)/(v+1) (0x100408f98), v = a
# field (@0x60) of the object at game+0x660; v was 9 -> 0.76. Then rounded UP (factor is a hair above 0.76).
DIG_BASE = (250, 125, 50, 2368)   # metal, gas, crystal, seconds -> client shows 191 / 96 / 39, 30m 00s

DIG_FACTOR = float(os.environ.get("GOFA_DIG_FACTOR", "0.76"))


SCAN_DRONES, SCAN_TIME = {0: 1, 1: 5}, {0: 25, 1: 1200}   # guide: short range 1 drone, 25 s; long range 5 drones, 20 min (statics s17 id 7 / 9)


# Missions (response 112 = mission list, entry 0x100c66f78). Mission type enum 1-22 from the caption switch
# 0x100355e5c: 1-3 quick harvest metal/gas/crystal, 4-6 deep harvest metal/gas/crystal, 7 deep anomaly,
# 8 deep NPC outpost, 9 deep ship wreck, 10-12 quick pirate fighters/bombers/interceptors, 13 quick pirate hideout,
# 14 quick merchant under attack, 15 quick anomaly (combat), 16 quick anomaly, 17 quick wreck looting,
# 18 quick unknown shipwreck, 19 deep rescue, 20-22 deep NPC outpost small/big/elite.
QUICK_MISSIONS = [1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18]

DEEP_MISSIONS = [4, 5, 6, 7, 8, 9, 19, 20, 21, 22]

PIRATE_FLEETS = {10: {1: 3}, 11: {5: 3}, 12: {3: 3}, 13: {1: 2, 3: 2, 5: 2}, 14: {3: 2}, 15: {1: 2},
                 8: {1: 4, 5: 4}, 20: {1: 3, 3: 3}, 21: {1: 6, 3: 6, 5: 6}, 22: {2: 6, 4: 6, 6: 6}}


def system_of(pid):
    """System id of a planet: home planets 1101/1201/.. -> HOME_SYSTEM; map ids ...SSSSP01 -> ...SSSS001."""
    return pid - (pid // 100 % 10) * 100   # home instance too: 2201 -> 2001


THREAT_LIMITS = (10, 25, 100, 500, 1000)   # ship counts from which SEVERAL / MANY / HUNDREDS / ARMY / LEGION show


def threat_class(n):
    """Mission fleet count -> client threat enum (1 FEW .. 6 LEGION, 7 NONE)."""
    return 7 if n <= 0 else 1 + sum(n >= x for x in THREAT_LIMITS)


MISSION_TRAVEL_SECONDS = 60

MISSION_TRAVEL_CLIENT = os.environ.get("GOFA_MISSION_TRAVEL_CLIENT", "1") == "1"   # travel time = the client's ETA (else fixed 60 s)


# ---- Mission resolution (placeholder rules) ----
# Ship classes: 1/2 fighter, 3/4 interceptor, 5/6 bomber, 8/9 freighter. Counters (statics s24 field 6 = 150):
# fighters beat interceptors, interceptors beat bombers, bombers beat fighters.
SHIP_CLASS = {1: "F", 2: "F", 3: "I", 4: "I", 5: "B", 6: "B", 8: "T", 9: "T"}

HARVEST = {1: 1, 2: 2, 3: 3, 4: 1, 5: 2, 6: 3}   # mission type -> resource type (quick / deep metal, gas, crystal harvest)

DEEP_TYPES = {4, 5, 6, 7, 8, 9, 19, 20, 21, 22}


def mission_yield(t, level=1):
    """(resource type, amount) a mission can yield. Also sent as statics s5 level field 5 (float): the mission report
    shows field 5 minus the amount left behind (0x1005613b0)."""
    if t in HARVEST:
        return HARVEST[t], int((1000 if t in DEEP_TYPES else 400) * level * 1.3 ** (level - 1))
    if t in MISSION_RES:   # Discord table: flat per level (Pirate Base / Outpost / Traitors none)
        return MISSION_RES_TYPE.get(t, 1), MISSION_RES[t] * max(1, min(10, level))
    return 1, int(150 * level * 1.3 ** (level - 1))


def ships_after(ships, loss):
    """A carrier's ships after a battle. Freighters stay aboard and the carrier gets away with them, its troops and cargo, even when every
    fighting ship is lost (report 27 Jun 2019: 3,258 Freighter II, 82 carriers and all troops survived the loss of 29,902 ships)."""
    return {str(k): n if k in (8, 9) else max(0, n - round(n * loss)) for k, n in ships.items()}


def fleet_cargo(ships):
    """Resources a fleet can bring home: freighters' cargo (statics s9 field 9)."""
    return sum(SHIP_CARGO.get(int(t), 0) * n for t, n in ships.items())


SHARPSHOOTER_SKILL, SHARPSHOOTER_PERCENT = 24, 2   # CROSSFIRE: +20 % accuracy at level 10 (replay, June 2019)


def pd_shield(level):
    """Planetary Defence shield bonus (wiki): +10 % per level to 15, then +20 % (250 % at 20)."""
    return (10 * min(level, 15) + 20 * max(0, level - 15)) / 100


def pd_raid_protection(level):
    """Share of resources Planetary Defence keeps from raiders (wiki: L9 11 %, L10 12 %, L12 14 %, L13 15 %, L20 22 %)."""
    return (level + 2) / 100 if level else 0.0


SHIP_DEF_STEP = 0.05   # SHIP DEFENCE tech (30): +5 % per level (wiki), only for ships defending their own planet (game text)


def _fleet_strength(ships, enemy, red=0.0, blue=0.0, shield=0.0):
    """Sum over ships of sqrt(damage dealt x damage survivable) against the enemy's mix, both weighted by ACCURACY: the rock-paper-scissors
    comes out of the table (per ship Bomber 1,837 vs Fighter 141; Interceptor 517 vs Bomber 125; Fighter 500 vs Interceptor 200)."""
    mix = {int(t): n for t, n in enemy.items() if n}
    n_all = sum(mix.values())
    total = 0.0
    for t, n in ships.items():
        d, t = SHIP_DEFS.get(int(t)), int(t)
        if not d or not n:
            continue
        cls = SHIP_CLASS.get(t)
        dmg, hp = d[4] * (1 + red * (cls in "FB")), (d[6] + d[5]) * (1 + shield) * (1 + blue * (cls in "FI"))   # shield = defence_bonus
        aim = 1 + red * (cls in "FB")   # red artifact: accuracy too, at most 100 % per target type
        hit = sum(min(100, accuracy(t, e) * aim) * k for e, k in mix.items()) / n_all / 100 if n_all else 1.0
        hurt = sum(accuracy(e, t) * k for e, k in mix.items()) / n_all / 100 if n_all else 1.0
        total += n * (dmg * hit * hp / max(hurt, 0.01)) ** 0.5
    return total


def kill_xp(before, after):
    """Battle XP = destroyed enemy ships x SHIP_XP (what the client shows as the report's EXPERIENCE POINTS)."""
    return sum(max(0, int(n) - int(after.get(t, after.get(str(t), 0)))) * SHIP_XP.get(int(t), 0) for t, n in before.items())


MAX_LEVEL = int(os.environ.get("GOFA_MAX_LEVEL", "300"))   # statics s26 entries (the original went past 800)
# Not more: with this XP curve the client hangs when the commander PROFILE opens if s26 has 390+ levels (tested on the
# iPad 2026-10-24: 100 and 300 fine, 390 / 480 / 650 / 850 hang; the earlier 1.4 %-growth curve worked with 850, cause
# unknown). Level 300 needs 91 million XP, so the cap doesn't matter in play.


def level_cost(lvl):
    """XP from level lvl to lvl + 1 = 100 x L x (L / 10 rounded up), the profile's "XP n / cost". Fits every value seen: level 1 "60/100",
    level 3 "8/300" (2019), level 159 "111,09x/254,400" (The Order video), level 386 "1,487,960/1,505,400"."""
    return 100 * lvl * math.ceil(lvl / 10)


LEVEL_TOTALS = [0, 0]   # index = level: total XP needed

for _l in range(1, MAX_LEVEL + 1):
    LEVEL_TOTALS.append(LEVEL_TOTALS[-1] + level_cost(_l))


# First level of Private, Sergeant, Lieutenant, Captain, Colonel, General. Round numbers that fit all 28 sightings (footage plus a
# Discord player's list, 2026-11-07). Bounds: Sergeant 9-11, Colonel 186-201, General 262-315; Lieutenant and Captain 46-122 are guesses.
# (Private to 8, Sergeant 11-45, Captain 122-185, Colonel 201-261, General 315+). Six at most: a 7th entry reads as Private in the
# client, so Star General cannot be reached by level.
RANK_LEVELS = (1, 10, 50, 100, 200, 300)


def level_threshold(lvl):
    """Total XP needed for a level; must match statics section 26 (handle_107). Level 2 = 100, 3 = 300, 10 = 4,500, 100 = 3,502,500."""
    return LEVEL_TOTALS[lvl]


def limit_steps(lvl, k):
    """How many limit steps commander level `lvl` has reached when step n (n >= 2) comes at level 1 + k x n(n-1)/2
    (rounded up). Planets k = 3 (wiki: levels 1, 4, 10, 19 ... 409 ... 829)."""
    n = 1
    while 1 + k * n * (n + 1) / 2 <= lvl + 1e-9:
        n += 1
    return n


def carrier_limit(lvl):
    """Natural carrier limit: step n at level floor(2 + 3 n (n - 2) / 8). Fits 2 at level 2, 3 at 3, next at 5 (2019), 11 at 45, next at 47 (video),
    33 at 386, next at 410."""
    n = 1
    while (16 + 3 * (n + 1) * (n - 1)) // 8 <= lvl:
        n += 1
    return n


SHIP_ANCHORS = ((48, 1250), (185, 3525), (187, 3550), (387, 5800), (434, 6350))   # seen on profiles, +25 steps between them


def ship_limit(lvl):
    """Natural ship limit: 50 to level 7, 100 at 8, 1,200 at 45, then SHIP_ANCHORS (next steps seen at 48, 52, 187, 387, 434)."""
    if lvl < 8:
        return 50
    if lvl < 45:
        return 100 + 50 * ((lvl - 8) * 22 // 37)
    if lvl < 48:
        return 1200
    for (l0, v0), (l1, v1) in zip(SHIP_ANCHORS, SHIP_ANCHORS[1:]):
        if lvl < l1:
            return v0 + 25 * ((lvl - l0) * (v1 - v0) // (25 * (l1 - l0)))
    return 6350 + 25 * ((lvl - 434) * 22 // 47)


SHIP_LIMIT_ORIGINAL = os.environ.get("GOFA_SHIP_LIMIT_ORIGINAL", "1") == "1"


def commander_limits(lvl):
    """Natural limits (outer planets, carriers, ships) at a commander level: statics s26 fields 3 / 4 / 5.
    Ships: ship_limit() (original numbers). The profile "hang" seen with it on 2026-10-24 was Frida's JS thread
    stalling, not the game (profile opened fine by hand); GOFA_SHIP_LIMIT_ORIGINAL=0 gives the old 30 + level."""
    return limit_steps(lvl, 3), carrier_limit(lvl), ship_limit(lvl) if SHIP_LIMIT_ORIGINAL else 30 + lvl


def player_level(xp):
    lvl = 1
    while lvl < MAX_LEVEL and level_threshold(lvl + 1) <= xp:
        lvl += 1
    return lvl


def skill_points_at(lvl):
    """Skill points earned by commander level lvl: one every 5 levels from level 6 (original level 1-2 SKILLS tab:
    "NEXT SKILLPOINT: Level 6 +1"; later steps unknown). Level 386 -> 77."""
    return (lvl - 1) // 5


def skill_cost(lv):
    """Points to learn skill level lv (statics 4 level field 10): 1 for L1-5, 2 for 6-10, 3 for 11-15, 4 for 16-20
    -> 50 points to take one skill to 20 (13 skills = 650 total, so a max-level commander masters ~3)."""
    return 1 + (lv - 1) // 5


# Deep mission table (Discord, players' compiled table, 2026-11-07; docs/FORUM_NOTES.md). Per level 1-10:
# fights pay XP 10 x level plus BATTLE XP (also counts for ALLIANCE WARFARE); the others pay XP only.
# Pirates' Nest L7 reads 1,914 in the table, a typo for 4,914 (702 x 7). Outpost alternates +78 / +468.
MISSION_BATTLE_XP = {8: [702 * n for n in range(1, 11)], 21: [624 * n for n in range(1, 11)], 22: [1248 * n for n in range(1, 11)],
                     20: [468, 546, 1014, 1092, 1560, 1638, 2106, 2184, 2652, 2730]}

MISSION_PLAIN_XP = {7: 2500, 9: 2500, 19: 600}   # x level: Abnormal Signals, Battleship Husk, Derelict Ship

MISSION_RES = {8: 9000, 7: 6000, 9: 6000, 19: 2000, 20: 0, 21: 0, 22: 0}   # resources x level (table); other types keep mission_yield's curve

MISSION_RES_TYPE = {9: 2}   # Battleship Husk pays gas (L7 report 12/07/15: 17,500 XP, "42000 Gas was left behind"); others unknown, metal


def mission_xp(won, level, fight, t=0):
    """(XP, of which battle XP). Table types above; other missions (quick range, harvest): the old guess 60 / 30 x level.
    A lost mission pays 10."""
    if not won:
        return 10, 0
    lv = max(1, min(10, level))
    if t in MISSION_BATTLE_XP:
        bx = MISSION_BATTLE_XP[t][lv - 1]
        return 10 * lv + bx, bx
    if t in MISSION_PLAIN_XP:
        return MISSION_PLAIN_XP[t] * lv, 0
    return (60 if fight else 30) * level, 0


# Mission rewards (guide, "Missions: Possible Rewards Overview"; type names from the loca). (artifacts, blueprints): 2 = "almost always, the higher
# the level the higher the probability", 1 = possible, 0 = never. Short range missions drop far less. Credits per level: Outposts and Elite Traitors
# highest, 400-500 credits a day from L10 missions (about 8 missions of 2-3 hours). The percentages themselves are estimates.
MISSION_DROPS = {7: (2, 0), 19: (1, 1), 9: (0, 2), 8: (1, 1), 20: (1, 1), 22: (1, 1)}

MISSION_CREDITS = {8: 10, 20: 5, 22: 20, 21: 10, 10: 1, 11: 1, 12: 1, 13: 1}   # x level; deep ones from the Discord table

# Drop chances by level 1-10 from the same table's words (rarely 15 %, sometimes 30 %, 50/50 50 %, often 75 %: our reading).
# (artifact, blueprint) lists; types not listed keep drop_chance()'s older guess (the table has no drop columns for pirates).
_R, _S, _H, _O = 0.15, 0.30, 0.50, 0.75

MISSION_DROP_TABLE = {7: ([_R, _R, _S, _H, _H, _H, _H, _O, _O, _O], [0] * 10),
                      9: ([0] * 10, [_R] * 6 + [_S] * 3 + [_H]),
                      19: ([_R, _R, _S, _S, _S, _H, _H, _H, _H, _O], [_R, _R, _R, _S, _S, _R, _S, _R, _S, _S])}

ITEM_NAMES = {10: "Artifact - Red", 11: "Artifact - Yellow", 12: "Artifact - Blue"}

BLUEPRINT_WEIGHTS = {6: 3, 7: 3, 8: 3, 9: 3, 4: 2, 5: 1}

BLUEPRINT_MK3_LEVEL = 3

BLUEPRINT_NAMES = {4: "Carrier MK II", 5: "Carrier MK III", 6: "Freighter MK II", 7: "Fighter MK II",
                   8: "Interceptor MK II", 9: "Bomber MK II"}


def mission_credits(t, level):
    return MISSION_CREDITS.get(t, 0) * level


def drop_chance(t, level, which):
    """Chance of an artifact (which 0) or blueprint (1) from a won mission."""
    if t in MISSION_DROP_TABLE:
        return MISSION_DROP_TABLE[t][which][max(1, min(10, level)) - 1]
    kind = MISSION_DROPS.get(t, (0, 0))[which]
    return 0.60 + 0.035 * level if kind == 2 else 0.10 + 0.02 * level if kind == 1 else 0.05 if t not in DEEP_TYPES else 0


SHIP_CARGO = {8: 1200, 9: 12000}   # resources a ship can carry (freighters Mk I / Mk II); statics s9 field 9

# XP per destroyed enemy ship = statics s9 field 14 = the ship's total base cost / 20 (2026-11-07, Discord battle reports: 54 Fighter I
# = 324; 34 Fighter II + 11 Interceptor II + 11 Bomber II = 4,980 exactly). Filled in below once SHIP_COST exists.
SHIP_XP = {}

# (the battle report's EXPERIENCE POINTS = the client's sum of destroyed enemy ships x field 14, no double-XP item)
# Ships (docs/ORIGINAL_NUMBERS.md, wiki table + the DATA / order screens in the videos): base cost, seconds = total cost / 2 (fits all 8),
# damage / shield / hitpoints. Freighter stats are not known. SHIP_YARD = required Shipyard level, ACCURACY = % against each ship type.
SHIP_COST = {1: (72, 40, 8), 2: (400, 80, 120), 3: (360, 270, 450), 4: (1350, 1800, 2250), 5: (96, 240, 24), 6: (240, 1320, 240),
             8: (360, 288, 72), 9: (1620, 1440, 540)}

SHIP_STATS = {1: (200, 50, 2000), 2: (220, 60, 2100), 3: (100, 100, 250), 4: (120, 120, 275), 5: (150, 30, 1125), 6: (175, 35, 1250),
              8: (20, 25, 2500), 9: (20, 38, 4000)}

SHIP_DEFS = {t: (*c, int(total_seconds(*c)), *SHIP_STATS[t]) for t, c in SHIP_COST.items()}   # m, g, c, seconds, damage, shield, hp

SHIP_XP.update({t: sum(c) // 20 for t, c in SHIP_COST.items()})   # 1: 6, 2: 30, 3: 54, 4: 270, 5: 18, 6: 90, 8: 36, 9: 180

SHIP_YARD = {8: 2, 5: 4, 3: 7, 2: 12, 9: 14, 6: 16, 4: 18}

CARRIER_YARD = {1: 10, 2: 20, 3: 20}   # carrier tier MK II / MK III / Void -> Shipyard level

ACCURACY = {1: {1: 50, 2: 40, 3: 15, 4: 12, 5: 5, 6: 3}, 2: {1: 60, 2: 60, 3: 27, 4: 21, 5: 6, 6: 5},
            3: {1: 24, 2: 24, 3: 50, 4: 45, 5: 75, 6: 70}, 4: {1: 24, 2: 30, 3: 60, 4: 55, 5: 90, 6: 95},
            5: {1: 100, 2: 85, 3: 7, 4: 5, 5: 15, 6: 15}, 6: {1: 100, 2: 95, 3: 9, 4: 9, 5: 20, 6: 20}}


def accuracy(a, b):
    """% of a ship type's shots that hit a ship type; freighters neither aim well nor dodge (not in the table)."""
    return ACCURACY.get(a, {}).get(b, 50 if a in ACCURACY else 5)


MOVE_SECONDS = 60


MOVE_BASE_SECONDS = 30        # placeholder travel model: base + distance (map units) x per-unit + jumpgate leg

MOVE_SECONDS_PER_UNIT = 20

JUMPGATE_SECONDS = 60


NAV_SKILL, NAV_PERCENT = 29, 3   # commander skill 29 = navigation: -3% travel time per level (skill level field 11)


def sec2(k):
    """Statics section 2 double field k as sent to the client."""
    return SEC2_F64.get(k, 1.0)


HQ_TRAVEL_STEP, HQ_TRAVEL_MIN = 5, 50   # HQ level record field 6 = travel time percent: 100 - 5 per level above 1


def hq_travel_percent(level):
    return max(HQ_TRAVEL_MIN, 100 - HQ_TRAVEL_STEP * (level - 1)) if level >= 1 else 100


ORDER_ATTACK, ORDER_RELOCATE, ORDER_DELIVER = 1, 2, 3   # 203 orders seen 2026-10-15/16


# Rounds (2026-11-07, Discord screenshots): a battle continues each quarter hour while both sides still have fighting ships, even
# when lopsided (19 Mar 2015: attacker lost all fighters + interceptors and half its bombers, "Ongoing"; 3 Jun 2015: ratio ~14:1,
# "Ongoing"); one ran 5+ rounds. Estimates: at most ROUND_MAX rounds; a side below ROUND_WIPE of the other's strength is finished
# at once; each round costs ROUND_LOSS x the other's share (fits 3 Jun: ours 3 % / 47 %, seen ~1 % / ~55 %).
ROUND_MAX, ROUND_WIPE, ROUND_LOSS = 8, 0.02, 0.5

ROUND_CLOSE = 1 / ROUND_WIPE   # old name, kept for anything still reading it


ORDER_COLONIZE = 6   # 203 order: 6 = COLONIZE PLANET (seen 2026-10-15: carrier order 6 -> 1500210001201)


# Planet limit (user's notes from the original, 2026-11-02: taking more planets "was locked behind the governance perk
# which increased how many planets you could hold"). The client's limit 0x10054758c = statics s26 level field 3 +
# GOVERNANCE skill bonus (skill 25 = PLANET_MANAGEMENT, "Planet limit expanded by <LEVEL>", level field 11) + planet
# extender items (type 1) x item def field 3. The server now refuses colonising / conquering past it.
PLANET_MGMT_SKILL, PLANET_EXTENDER_ITEM = 25, 1

PLANET_LIMIT_ON = os.environ.get("GOFA_PLANET_LIMIT", "1") == "1"


# Battle phases (2026-11-07). A fleet reaching a hostile planet does not fight at once: it GATHERS until the next quarter hour (battles
# start at :00 / :15 / :30 / :45), so fleets arriving in that window fight together. Client: movement order 7 shows GATHERING (order -> state
# table 0x100ae7380: 1 attack, 2 / 3 / 6 en route, 7 gathering; state function 0x1002bf20c, carrier field 13 bit 0 = IN COMBAT).
# The private home system fights at once (the tutorial's Outlaws): our choice, not known from the original.
ORDER_GATHER = 7

QUARTER_SECONDS = 900

GATHER_ON = os.environ.get("GOFA_GATHER", "1") == "1"

# Bombers kill troops before the landing. Limit 30 % of the garrison (developer post, June 2014); troops per bomber is our estimate.
BOMB_MAX, BOMB_PER_SHIP = 0.30, 0.5   # BOMB_PER_SHIP no longer used: see TROOP_HP


def next_quarter(t):
    return (int(t) // QUARTER_SECONDS + 1) * QUARTER_SECONDS


# Rounds (update 1.12: battles run in waves; the break lets fleets reinforce or retreat). Only the idea is known from the original. Our estimates:
# a fight stronger than 2 : 1 ends at once; a close one breaks off after a round (each side losing up to half its ships, by the other's share of
# the total) and goes on at the next quarter hour, for at most 3 rounds. Report result 4 = ONGOING (client 0x10038f684).
RESULT_ONGOING = 4


def battle_goes_on(mine, theirs, rnd):
    return rnd < ROUND_MAX and mine > 0 and theirs > 0 and ROUND_WIPE < mine / theirs < 1 / ROUND_WIPE


def round_losses(mine, theirs):
    """Share of (my, their) ships lost in a round that does not decide the battle."""
    return ROUND_LOSS * theirs / (mine + theirs), ROUND_LOSS * mine / (mine + theirs)


TROOP_HP = 4.87   # bombing: troops killed = bomber damage / TROOP_HP (21 Mar 2015 report: 124 Bomber I killed 3,820 of 34,882 = 30.8 each)


def bombed_troops(ships, garrison, defence=0):
    dmg = sum(n * SHIP_STATS[int(t)][0] for t, n in ships.items() if int(t) in (5, 6))
    return min(int(garrison * BOMB_MAX), int(dmg / TROOP_HP / (1 + 0.10 * defence)))


def pool_fleets(lead, others):
    """Fleets that gathered together fight as one: everything goes on the lead carrier for the battle. Returns what split_fleets needs."""
    shares = [(x["id"], {int(k): int(v) for k, v in x.get("ships", {}).items()}, {int(k): int(v) for k, v in x.get("cargo", {}).items()})
              for x in [lead] + others]
    ships, cargo = {}, {}
    for _, sh, ca in shares:
        for t, n in sh.items():
            ships[t] = ships.get(t, 0) + n
        for t, n in ca.items():
            cargo[t] = cargo.get(t, 0) + n
    for x in others:
        x["ships"], x["cargo"] = {}, {}
    lead["ships"], lead["cargo"] = {str(t): n for t, n in ships.items()}, {str(t): n for t, n in cargo.items()}
    return shares, ships, cargo


DEMOLISH_REFUND = 0.5   # our estimate: half the cost of the building's current level comes back; demolition takes half its build time


BLUEPRINT_TECH_OF = {2: 13, 4: 15, 6: 17, 9: 11}

TECH_LAB = {13: 12, 17: 16, 15: 18, 11: 14, 20: 10, 22: 20}   # blueprint tech -> Laboratory level (guide; same as the ship's Shipyard level)

CARRIER_TECH_OF = {5: 20, 9: 22}   # carrier ids shown in the Carriers tab: 1 MK I, 5 MK II, 9 MK III, 13 VOID (probe 0x100271e10, 2026-10-18); {2: 20, 3: 22} was the wrong ids   # Mk II ship -> blueprint tech (fighter / interceptor / bomber / freighter)

BLUEPRINT_GATING = True   # experiment: ship field 4 requirement list

TECH_MAX = int(os.environ.get("GOFA_TECH_MAX", 20))   # client max: section 2 field 25 (sent = TECH_MAX)

SKILL_MAX = int(os.environ.get("GOFA_SKILL_MAX", 10))   # client max: section 2 field 23 (sent = SKILL_MAX)


SEC2_F64 = {int(k): float(v) for k, v in (kv.split('=') for kv in os.environ.get('GOFA_SEC2_F64', '').split(',') if kv)}   # e.g. '18=2,59=0.5'

CARRIER_F16 = 1.0   # carrier level field 16 (double): acceleration distance in the travel formula

CARRIER_F11 = 100   # carrier level field 11: travel efficiency percent (divides travel time)

# Base speed per carrier tier (MK I / II / III / Void) in percent of MK I, applied through carrier level field 11 (2026-11-14, owner's OK).
# Sources: wiki (Russian Galaxy on Fire fandom): MK I 1000, MK II 1500, MK III 1250, MK I 1000 = "speed 1000" in our Sany FireMan footage;
# James Fire (Discord, trusted) gave the same order but 1 : 2 : 1.5 : 2.5. Void 190 is OUR inference (his Void / MK II ratio 1.25 on the wiki
# scale; the wiki only says "faster than any other carrier"). GOFA_TIER_SPEED=0 gives every tier 100 again (the old behaviour).
CARRIER_TIER_SPEED = {0: 100, 1: 150, 2: 125, 3: 190} if os.environ.get("GOFA_TIER_SPEED", "1") != "0" else {0: 100, 1: 100, 2: 100, 3: 100}


# Game text (INFO - MY ALLIANCE): "a maximum of 49 members ... each senior officer extending the member limit by 7";
# the panel lists field 28 as "Member/Senior Officer" -> 7 per leader / senior officer, 6 senior officers = 7 x 7 = 49.
# Was 50 / 10 (placeholders). 2026-10-27.
ALLIANCE_MEMBER_CAP = 7

ALLIANCE_SENIOR_OFFICERS = 6


# Premium credits (2026-10-27): was 10,000 at start + 1 credit per speed-up / item = unlimited. Income is the
# daily bonus (10) + tutorial rewards (~250), so a new player starts with 100 and prices are a real sink.
CREDITS = 1000   # premium currency (guess: response 115 {1 {1 varint32}} at login = credit balance)


SPEEDUP_MIN, SPEEDUP_MAX, SPEEDUP_HALF = 1, 999, 86400


def speedup_price(remaining):
    """Client 0x10050cd74: min + (max - min) x t / (t + half), rounded, 0 at under a second. Statics s2 fields 14 / 15 / 16 (SPEEDUP_MIN, MAX,
    HALF). 1, 999 ("at most 999 credits"), 1 day fit all 7 prices seen: 27 s 1, 4:03 4, 4:44 4, 22:48 17, 27:30 20, 55:19 38, 1:33:38 62."""
    t = max(0, remaining)
    return int(SPEEDUP_MIN + (SPEEDUP_MAX - SPEEDUP_MIN) * t / (t + SPEEDUP_HALF) + 0.5) if t >= 1 else 0


# Tech ids (caption switch 0x100295b18 / table 0x1002962a0): 1 metal, 2 crystal, 3 gas extraction, 5 silo,
# 11/13/15/17 freighter/fighter/interceptor/bomber Mk II blueprints (11 confirmed), 20/22 carrier Mk II/III,
# 30 ship defence, 31 ground battle, 32 bomber defence, 33 ship production.
TECH_BONUS = {1: 1, 2: 3, 3: 2}   # extraction tech -> resource type (1 metal, 2 gas, 3 crystal)

TECH_BONUS_PER_LEVEL = 0.10       # +10% production per tech level (wiki tech table; footage 360 -> 396/h at L1)

TECH_SLOTS = 3   # the lab has 3 tech slots: a 4th tech crashes the login after 103 (0x1000cedc8 <- 0x1002814d4)


JUMPGATE_AUTO_START = os.environ.get("GOFA_JUMPGATE_AUTO", "1") == "1"

JUMPGATE_START_PLANET = int(os.environ.get("GOFA_START_PLANET", 1500210001101))   # Murana1 (sector 15_21)


# Home-system lock (user's notes from the original, 2026-11-02: "Once you did the tutorial, you had the option to leave
# your home system which would place you in a RANDOM place in the galaxy map"). Until the home-system tutorial missions
# below are done, 241 is refused with 9241 {1 code, 2 request}: the client shows "Unable to open jumpgate." and the galaxy
# map (with its jumpgates) stays closed. Players who already have a start planet are not affected.
GATE_LOCK = os.environ.get("GOFA_GATE_LOCK", "1") == "1"

GATE_MISSION_TEXT = {2: "build a metal extractor", 3: "upgrade the HQ to level 2", 4: "upgrade a metal extractor to level 2",
                     5: "build a shipyard", 8: "build ships", 6: "build a carrier", 16: "build a scanner",
                     23: "send a mission", 24: "get a mission report", 19: "build barracks", 26: "build a research lab",
                     28: "research a technology"}

GATE_MISSIONS = [int(x) for x in os.environ.get("GOFA_GATE_MISSIONS", ",".join(map(str, GATE_MISSION_TEXT))).split(",") if x]


START_CONQUERABLE = os.environ.get("GOFA_START_CONQUERABLE", "1") == "1"   # start planets can be taken in PvP


TROOP_COST, TROOP_SECONDS = (196, 117, 39), 176         # Troop 187 / 112 / 38, 2:48 Terran, 185 / 111 / 37 at Barracks L2

DRONE_COST, DRONE_SECONDS = (50, 25, 10), 30            # not seen


# Tutorial missions (statics section 21 + responses 283 / 282). Mission id = mission type (the key enum is the type
# list); type = achievement caption switch 0x10062b2f0 index + 2. Requirement record 0x100c682b0 {1 tech, 2 structure
# type, 3 count, ...}; reward 0x100c65970 {1 [{1 enum 1-18, 2 n}], 3 [{1 ship type, 2 n}], 5 [{1 resource 1-5, 2 n}],
# 6 [{1 carrier type, 2 level, 3 n}], 8 varint64}. Status (283 entry field 2): 0 open, 2 ready to collect, 3 claimed?
TUTORIAL_ENABLED = os.environ.get("GOFA_TUTORIAL", "1") == "1"


# Tutorial XP is a guess (the originals are unknown): 100 per mission levelled a new player up on almost every reward
# (levels 2-5 cost 100 / 120 / 210 / 320). 25 each -> the whole tutorial is ~1,000 XP = level 5. 2026-10-27.
TUT_XP = 25


TUT_REWARDS = {2: {"credits": 100}, 3: {"xp": 50}, 5: {"credits": 100, "xp": 100}, 8: {"credits": 200}, 6: {"credits": 250, "xp": 200}, 20: {"credits": 100},
               17: {"credits": 150}, 21: {"xp": 75}, 14: {"credits": 20, "xp": 75}}


A_CREDITS, A_SPENT, A_BLUEPRINTS, A_ARTIFACTS, A_DAYS, A_STREAK, A_USED, A_RAID, A_VOID = range(80, 89)   # attribute ids the client does not count itself

A_MK3, A_FREIGHTER2, A_FIGHTER2, A_INTERCEPTOR2, A_BOMBER2 = range(89, 94)

MK1_SHIPS, MK2_SHIPS = (1, 3, 5, 8), (2, 4, 6, 9)


BOOKMARK_SHARED = (1, 2)   # CALL + ALLIANCE bookmarks are seen by the whole alliance


NPC_REGEN_SECONDS = 3600

PIRATE_RAIDS = os.environ.get("GOFA_PIRATE_RAIDS", "1") == "1"

RAID_MIN, RAID_MAX = 2 * 3600, 4 * 3600      # seconds between raids on one colony


PDEF_STRENGTH = 160   # raid defence per planetary defence level (was 60: L20 needed vs an L8 raid; now ~ raid level holds)


NPC_NAMES = ["Pirate Lord", "Red Corsairs", "Void Raiders", "Black Fang", "Rust Clan", "Scrap Barons"]


def base_level_of(npc):
    """Level of a pirate base from its stock (pirate_base: 300 x 1.7^(lvl-1); stock isn't changed by raids)."""
    return max(1, round(math.log(max(npc.get("stock", 300), 300) / 300, 1.7)) + 1)


def pirate_base(lvl):
    """Defence of a level-`lvl` pirate base (balance 2026-10-17): fleet strength ~50 x 1.7^(lvl-1) (tutorial fleet of 2
    fighters = 56 beats level 1, loses to level 2), mix 50% fighters / 30% interceptors / 20% bombers."""
    t = 50 * 1.7 ** (lvl - 1)
    return {"fleet": {1: max(1, round(.5 * t / 28)), 3: max(1, round(.3 * t / 20.5)), 5: round(.2 * t / 30.75)},
            "troops": 5 * lvl, "stock": int(300 * 1.7 ** (lvl - 1))}


NPC_RESPAWN_SECONDS = int(os.environ.get("GOFA_NPC_RESPAWN", str(6 * 3600)))   # one new base per period


# Void planets (2026-11-13; ALL NUMBERS ARE GUESSES except where noted; Discord notes in docs/FORUM_NOTES.md "Void fleets", "Void planets").
# A Void is a species-4 PLAYER ACCOUNT ("VOID #2053" in the Jan 2016 report) started as an event: it owns a few outer planets, one of them its
# jumpgate ("wormhole": it keeps producing ships; capturing it moves the gate, lose_planet), the others hold ships, planetary defence, a
# garrison and an artifact. Attacks, gathering, rounds, allies and conquest are the ordinary player-vs-player battle. The planet that falls
# pays VOID CRYSTALS (item 17), shared by the attackers by their ships in the final round (contribution based, Garuda4321): about 1 crystal
# per few dozen Void ships (JunkMeme: "a few dozen ships ... about 1 crystal"; Void carrier = VOID_CRYSTALS_PER_CARRIER = 50).
VOID_RACE = 4
VOID_LEVEL = int(os.environ.get("GOFA_VOID_LEVEL", "12"))                       # fleet level (pirate_base scale): 6 ~ a few dozen ships, 12 ~ 650, 16 ~ 3,000
VOID_SHIPS_PER_CRYSTAL = int(os.environ.get("GOFA_VOID_SHIPS_PER_CRYSTAL", "36"))
VOID_REGEN_SECONDS = int(os.environ.get("GOFA_VOID_REGEN", "1800"))             # the gate planet adds ships this often ...
VOID_REGEN_SHARE = 0.10                                                          # ... this share of its full fleet, up to the full fleet
VOID_ARTIFACT_ITEMS = (10, 11, 12)                                               # a conquered Void planet gives one (red / yellow / blue)
# Void raids (2026-11-13): the ordinary pirate raid timer (RAID_MIN..RAID_MAX per colony) can be answered by a Void instead of the pirates when a Void
# planet with ships lies within VOID_RAID_RANGE map units (sectors are 30 wide) of the colony. The raiding party is a share of that planet's ships;
# a repelled raid destroys the party (the Void loses those ships; the gate planet builds new ones), a lost one costs the colony the usual 30 % of its
# stationed ships and 10 % of each resource. Species text: Voids "ravage and exploit as many high-level planets as their fleets can seize".
VOID_RAIDS = os.environ.get("GOFA_VOID_RAIDS", "1") == "1"
VOID_RAID_RANGE = float(os.environ.get("GOFA_VOID_RAID_RANGE", "90"))            # map units from the Void planet to the colony (3 sectors)
VOID_RAID_CHANCE = float(os.environ.get("GOFA_VOID_RAID_CHANCE", "0.5"))         # share of the due raids a Void in range takes over from the pirates
VOID_RAID_SHARE = float(os.environ.get("GOFA_VOID_RAID_SHARE", "0.25"))          # share of the planet's ships that goes raiding


def void_base(lvl):
    """A Void planet of fleet level `lvl`: pirate fleet of that level, planetary defence lvl // 2, garrison 8 per level, a bigger stock, and the
    crystals it pays when it falls (1 per VOID_SHIPS_PER_CRYSTAL ships, at least 1)."""
    base = pirate_base(lvl)
    return {"fleet": base["fleet"], "pd": max(1, lvl // 2), "troops": 8 * lvl, "stock": base["stock"] * 2,
            "crystals": max(1, round(sum(base["fleet"].values()) / VOID_SHIPS_PER_CRYSTAL))}


def void_shares(total, weights):
    """Split `total` crystals by `weights` {player: ships}: largest remainder, ties to the larger weight, then the smaller key. Sums to `total`."""
    w = {k: v for k, v in weights.items() if v > 0}
    s = sum(w.values())
    if not total or not s:
        return {k: 0 for k in weights}
    raw = {k: total * v / s for k, v in w.items()}
    out = {k: int(r) for k, r in raw.items()}
    for k in sorted(w, key=lambda k: (-(raw[k] - out[k]), -w[k], k))[:total - sum(out.values())]:
        out[k] += 1
    return {k: out.get(k, 0) for k in weights}


# Espionage (2026-11-03, release design from the client's own texts: DESC_INFOSCREEN_TYPE_SPYDRONES, MSG_NOTE_SPY_REPORT,
# MSG_SPY_REPORT_*; was: always succeeded, detection fell with more drones, full report). More drones and a higher
# scanning array level raise the success chance AND the number of objects found, but more drones also raise the risk
# of being detected; the target's scanning array level helps it detect spies. Outcomes: failed (drones lost, no report),
# success, success but detected (the target learns who spied), success but detected anonymously.
# The release ESPIONAGE screen shows no success rate, only RISK OF BEING DETECTED and MAX. DETECTABLE (client, from drones x distance
# efficiency), so a failure stays rare: the alpha screen's 58 % at 25 drones is not used.
SPY_SUCCESS_BASE, SPY_SUCCESS_PER_LEVEL, SPY_SUCCESS_DRONES, SPY_SUCCESS_SCALE, SPY_SUCCESS_MAX = 0.70, 0.015, 0.20, 15.0, 0.98

SPY_DETECT_PLAYER = float(os.environ.get("GOFA_SPY_DETECT", "0.10"))   # 1 drone, equal scanner levels

SPY_DETECT_NPC = 0.05

SPY_DETECT_PER_DRONE, SPY_DETECT_PER_LEVEL, SPY_DETECT_MIN, SPY_DETECT_MAX = 0.0005, 0.02, 0.02, 0.90

SPY_ANONYMOUS = 0.5   # share of detections where the target is not told who spied

# MAX. DETECTABLE (client 0x100463270, 0x1006f8c98, 0x1006f8cdc): V = drones x scanning array level x distance efficiency, count = ceil((V - t) / t).
# t = statics s2 doubles 85 resources, 86 troops, 82 ships, 87 structure levels, 88 carriers; fits the Apr 2018 screen exactly (L13, 13 %, 650 drones:
# 1,120,906 / 112,090 / 2,241 / 224 / 22, 1,350: 2,328,037 / 232,803 / 4,656 / 465 / 46). 83 / 84 (players, planets on "spy attack") scaled, not seen.
SPY_COST = {"res": 0.001, "troops": 0.01, "ships": 0.5, "structure": 5.0, "carriers": 50.0}

SPY_S2 = {85: 0.001, 86: 0.01, 82: 0.5, 87: 5.0, 88: 50.0, 83: 25.0, 84: 2.5}

SPY_EFF_MIN, SPY_DISTANCE_EFF = 0.1, 60   # statics s2 doubles 101, 104: efficiency = 1 - distance / 60, at least 10 % (fields 102, 103 off below 100,000)


def spy_success_chance(level, drones):
    return min(SPY_SUCCESS_MAX, SPY_SUCCESS_BASE + SPY_SUCCESS_PER_LEVEL * level
               + SPY_SUCCESS_DRONES * (1 - math.exp(-drones / SPY_SUCCESS_SCALE)))


def spy_view(fleet, troops, res, sts, lim):
    """What the drones found within MAX. DETECTABLE: amounts up to the limit, ships largest stack first, cheapest structures first."""
    seen_res = {t: n for t, n in res.items() if n <= lim["res"]}
    seen_troops = troops if troops <= lim["troops"] else None
    left, seen_fleet = int(lim["ships"]), {}
    for t, n in sorted(fleet.items(), key=lambda x: -x[1]):
        if n and left > 0:
            seen_fleet[t], left = min(n, left), left - min(n, left)
    room, seen_st = lim["structure"], []
    for t, lv in sorted(sts, key=lambda x: x[1]):
        if lv <= room:
            seen_st.append((t, lv))
            room -= lv
    return seen_fleet, seen_troops, seen_res, seen_st


CITADEL_ITEM = {7: 12, 8: 10, 9: 11}   # planet type -> artifact item (12 blue, 10 red, 11 yellow)


# Coloured / Void carriers (2026-10-18). Carrier types: per tier (MK I 1-4, MK II 5-8, MK III 9-12, VOID 13-16) base,
# +1 BLUE, +2 RED, +3 YELLOW (caption switch 0x100242e40). The Carriers tab only builds the base types; a coloured carrier
# is an UPGRADE of an existing one ("Equip a carrier with an artifact"): request 213 {1 carrier id, 2 level, 3 colour
# 1 red / 2 blue / 3 yellow}. Client check 0x1002c9f14 (codes: 7 level > statics s2 field 24, 6, 5 resources, 4 carrier
# busy, 2 not enough of a cost-block list-5 item, 8) maps colour x tier to the target type via table 0x100c7b980 and
# looks up the TARGET type's statics s3 level -> its cost block, whose list 5 holds the artifact. Void carriers (13) need
# void crystals (item 17) in their cost block and use them up when ordered (handle_202).
CARRIER_UPGRADE_MAX = int(os.environ.get("GOFA_CARRIER_UPMAX", "20"))

COLOUR_OFFSET = {1: 2, 2: 1, 3: 3}               # request 213 colour -> type offset within the tier

OFFSET_ITEM = {1: 12, 2: 10, 3: 11}              # type offset -> artifact item (10 red, 11 yellow, 12 blue)

ARTIFACTS_PER_UPGRADE = int(os.environ.get("GOFA_ARTIFACTS", "1"))

VOID_CRYSTALS_PER_CARRIER = int(os.environ.get("GOFA_VOID_CRYSTALS", "50"))   # Discord 2026-11-08: JunkMeme 50; Garuda earned ~50 and got one carrier (his 200 conflicts)


def carrier_items(cid, level=1):
    """Items a carrier type needs (statics s3 cost block list 5): artifacts for coloured types, void crystals for 13."""
    off = (cid - 1) % 4
    if off:
        return {OFFSET_ITEM[off]: ARTIFACTS_PER_UPGRADE * level}
    if cid == 13:
        return {17: VOID_CRYSTALS_PER_CARRIER}
    return None


def carrier_artifacts(cid, level=1):
    """Cost block lists 2 + 6 {colour 1 red / 2 blue / 3 yellow, n}: the artifact price the carrier panel shows
    ("UPGRADE 2, COSTS n/owned") and the upgrade check compares with the owned artifacts."""
    off = (cid - 1) % 4
    return {OFFSET_COLOUR[off]: ARTIFACTS_PER_UPGRADE * level} if off else None


OFFSET_COLOUR = {v: k for k, v in COLOUR_OFFSET.items()}

# Upgrade bonuses (2026-10-18). The carrier view's "increases <stat> by n%" (0x100673af4) reads the carrier's statics s3
# level record: red = field 13, blue = field 14, both per mille (n = f / 1000 x 100 - 100); yellow = field 11 compared
# with the base type's level-1 field 11 (n = f / base x 100 - 100). Field 11 is also the client's travel speed percent
# (travel_seconds), so yellow carriers really travel faster. Other screens (0x10038819c, 0x10077e16c) use ratios too.
# Original numbers (docs/ORIGINAL_NUMBERS.md, 2019 screenshots + wiki Artifacts page), by tier 0 MK I / 1 MK II /
# 2 MK III / 3 VOID. The view shows the NEXT level's bonus: MK I red "UPGRADE 2 ... 7%" -> 3.5 % per level (red and
# blue; only that one point is known, the other tiers are assumed the same). Yellow: MK I / II +24 % at level 1 then
# +4 % per level (MK II level 20 = 100 %, seen), MK III +4 % per level (level 20 = 80 %, seen), VOID level 20 = 150 %
# (seen; 7.5 % per level assumed).
# Red / blue = RED_BLUE_BASE + step x level (2026-11-07, Discord screenshots): MK III red L20 "attack and accuracy of bombers and
# fighters by 25%", MK I red L2 7 %, VOID L20 65 % -> 5 + 1 x L (MK I-III; MK II assumed the same) and 5 + 3 x L (VOID).
RED_BLUE_BASE = 5.0

RED_BLUE_PCT = float(os.environ.get("GOFA_RED_PCT", "1.0"))   # % per upgrade level, red and blue, MK I-III

RED_BLUE_VOID = 3.0

YELLOW_FIRST, YELLOW_STEP = {0: 24, 1: 24, 2: 4, 3: 7.5}, {0: 4, 1: 4, 2: 4, 3: 7.5}

# Hangar (statics s3 level field 10, read by 0x1002c744c): base per tier + per upgrade level of any colour (wiki:
# +2 / +3 / +5; seen: MK I basic 75, red L1 77, MK II 100 -> 160 at L20, MK III 150 -> 250 at L20, VOID L20 800).
# VOID base 200 = James Fire (Discord 2026-11-13: tiers 75 / 100 / 150 / 200 capacity, the first three match the screenshots); the step 30 is OUR
# inference so that level 20 still gives the 800 seen (he said "+3 per artifact level", which fits MK II only and would give 260 at level 20).
HANGAR_BASE, HANGAR_STEP = {0: 75, 1: 100, 2: 150, 3: 200}, {0: 2, 1: 3, 2: 5, 3: 30}


def carrier_bonus(ctype, level, colour):
    """Bonus % of a carrier type / level for one colour (0 unless the type has that colour)."""
    if OFFSET_COLOUR.get((ctype - 1) % 4) != colour or level < 1:
        return 0
    if colour == 3:
        tier = (ctype - 1) // 4
        return YELLOW_FIRST[tier] + YELLOW_STEP[tier] * (level - 1)
    return RED_BLUE_BASE + (RED_BLUE_VOID if (ctype - 1) // 4 == 3 else RED_BLUE_PCT) * level


def carrier_hangar(ctype, level):
    """Hangar space: the tier's base, +HANGAR_STEP per upgrade level for coloured types (base types are level 1)."""
    tier = (ctype - 1) // 4
    return HANGAR_BASE[tier] + (HANGAR_STEP[tier] * level if (ctype - 1) % 4 else 0)


def carrier_field(ctype, level, k):
    """Statics s3 level fields 10-15: 10 = hangar, 11 = speed % (tier base x (1 + yellow bonus)), 13 / 14 = red / blue per mille,
    rest 100."""
    if k == 10:
        return carrier_hangar(ctype, level)
    if k == 11:
        return round(CARRIER_TIER_SPEED.get((ctype - 1) // 4, CARRIER_F11) * (1 + carrier_bonus(ctype, level, 3) / 100))
    if k in (13, 14):
        return round(1000 + 10 * carrier_bonus(ctype, level, 1 if k == 13 else 2))
    return 100


# Carrier escape (owner-approved 2026-11-12; ALL NUMBERS ARE GUESSES, change them here). When an attack on a planet is won by the
# attacker, every carrier stationed at that planet (the owner's and allies') tries to escape: CARRIER ESCAPE phase of the battle report
# (CAPTION_BATTLE_CARRIER_ESPCAPE). Chance by tier = (carrier type - 1) // 4 (MK I / II / III / Void): ESCAPE_ENGAGE for a carrier that
# fights (behaviour 1), ESCAPE_AVOID for one set to avoid combat (behaviour 2; game text: MK III "better escapes", showroom "flee from
# combat automatically"). A yellow carrier adds ESCAPE_YELLOW_SHARE of its speed bonus (carrier_bonus colour 3, in per cent); ESCAPE_MAX caps it.
ESCAPE_ENGAGE = {0: 0.40, 1: 0.50, 2: 0.70, 3: 0.70}
ESCAPE_AVOID = {0: 0.70, 1: 0.80, 2: 0.90, 3: 0.90}
ESCAPE_YELLOW_SHARE = 0.25  # 2026-11-13: back to 0.25. James Fire (Discord, relayed by the owner): the chance "was based on speed", so yellow carriers "definitely" escaped better (an earlier player said no, only faster; flee_station also uses the carrier's speed). Number is a guess
ESCAPE_MAX = 0.95


def escape_chance(ctype, level, behaviour):
    """Chance (0..ESCAPE_MAX) that a carrier of this type / level escapes a lost planet battle; behaviour 1 engage, 2 avoid combat."""
    tier = (ctype - 1) // 4
    base = (ESCAPE_AVOID if behaviour == 2 else ESCAPE_ENGAGE).get(tier, 0.5)
    return min(ESCAPE_MAX, base + carrier_bonus(ctype, level, 3) / 100 * ESCAPE_YELLOW_SHARE)


# Item def fields 2-9 (statics s20 and the 272 def): field 5 = hide in ITEMS tab (must be 0), field 3 = what one limit
# extender adds (client 0x10054758c: limit = s26 level field + skill + owned x def field 3, getter 0x10001907c @+0xc).
# Original: planets +1, carriers +1, ships +150 ("Increases our current ship limit by 150."), groups +1.
EXTENDER_AMOUNT = {1: 1, 2: 1, 3: 150, 18: 1}


ITEM_PRICE_MULT = {1: 2, 3: 2.75}


def item_price_base(t):
    return max(1, round(ITEM_PRICES.get(t, ITEM_PRICE) / ITEM_PRICE_MULT.get(t, 1)))


# Item types (read in the ITEMS tab 2026-10-18): 1-3 limit extenders planets / carriers / ships, 4 / 5 carrier MK II / III
# blueprint, 6 freighter, 7 fighter, 8 interceptor, 9 bomber MK II blueprint, 10-12 artifact red / yellow / blue,
# 13 double XP boost, 14 / 15 credit booster L / XL (16-18 not read: credit XXL, void crystals, limit extender groups).
TECH_ITEM = {11: 6, 13: 7, 15: 8, 17: 9, 20: 4, 22: 5}   # blueprint tech -> item consumed when its research starts


# Item effects (2026-10-18). The ITEMS tab has no "use" button: the tick next to GET MORE opens ITEM OFFER ("Request a
# black market transaction ...", BUY <price>) and BUY sends request 278 {1 item type, 2 amount}. No response 278 exists
# (9278 {1 code, 2 echo} is the error reply). The client keeps a pending purchase {type, amount, target = owned + amount}
# (0x100708a80) and shows ERROR_ITEM_PURCHASE_TIMED_OUT (0x10070864c) unless a 272 inventory push reaches the target,
# so BUY must ADD the items: 278 -> pushes 272 (inventory) + 115 (credits, ITEM_PRICE each).
# Effects follow the owned amounts: limit extenders (1-3, 18) are added to the commander-level limits by the client
# itself (findings 2026-10-10 00:20); double XP (13) is permanent while owned; each credit booster type (14-16) adds
# its % to the daily credit bonus while owned and uses up one item per duration (amount goes down).
ITEM_PRICE = 1                     # fallback; the panel showed 1 because item def fields 2-9 were all 1

# Credit prices (2026-10-27, guesses scaled to ~10 credits/day income; boosters pay back in about half their duration).
ITEM_PRICES = {1: 300, 2: 200, 3: 100, 4: 60, 5: 120, 6: 40, 7: 40, 8: 50, 9: 60, 10: 30, 11: 30, 12: 30,
               13: 500, 14: 150, 15: 400, 16: 900, 17: 25, 18: 200}


def item_price(t):
    """What the ITEM OFFER panel shows (field 4 x the client's multiplier) = what BUY charges."""
    return int(item_price_base(t) * ITEM_PRICE_MULT.get(t, 1))

CREDIT_BOOSTERS = {14: (100, 30), 15: (150, 90), 16: (200, 180)}   # item -> (+% daily credit bonus, days per item)

XP_BOOST_ITEM = 13

DAILY_CREDITS = 100                # daily credit bonus before boosters (+100 popup in the videos)


# Species bonus = statics s18 multiplier per (race, category); the client scales cost AND time by it and rounds up.
# Categories (marker test 2026-10-23): 1 structures, 2 ships + carriers, 3 troops, 4 spy drones, 5 techs,
# 6 artifact digs (0x1002837d8). Loca: Terran structures/ships/carriers/troops/spy drones, Nivelian structures,
# Vossk ships + carriers, Voids no number (left 1.0).
SPECIES_BONUS = {**{(1, c): 0.95 for c in (1, 2, 3, 4)}, (2, 2): 0.9, (3, 1): 0.9}

CAT_STRUCTURES, CAT_SHIPS, CAT_TROOPS, CAT_DRONES, CAT_TECHS = 1, 2, 3, 4, 5


def species_mult(race, cat):
    return SPECIES_BONUS.get((race, cat), 1.0)


def yard_percent(stype, level):
    """Statics s11 field 6 of Shipyard / Barracks / Scanner: -1 % cost and time per level above 1 (Carrier 950 -> 913 at L5)."""
    return 101 - level if stype in (2, 6, 8) else TRADE_RATIO_PERCENT.get(level, 350) if stype == 10 else 100


# Alliances (2026-10-20): shared in state/world.json "alliances" {id: {id, name, tag, desc, created, members {pid: rank},
# offers [{pid, type 1 application / 2 invitation, ts, by}]}}. Alliance record 0x100c63030 = {1 id*, 2 name,
# 3 description, 4 tag, 5 own membership 0x100c63210 {1 player*, 2 rank 1-5*, 3 joined}, 6 member count, 8 {1 members*},
# 9 {1 offers 0x100c63120 {1 alliance*, 2 player*, 3 type*, 4 ts*, 5 by}}, 10-12 diplomacy lists}. Player record field 5 =
# alliance id: the client's relation check (0x10033c5d0) makes players of its own alliance friends (relation 1).
ALLIANCE_LEADER = 1   # rank enum 1-5: 1 Leader .. 5 Member (5 showed as "Member" in MEMBERS)

ALLIANCE_MEMBER = 5

OFFER_APPLICATION, OFFER_INVITATION = 1, 2   # stored values


# Diplomacy lists (verified in game 2026-10-21): 10 relations (state 4 NAP / 5 WAR), 11 own offers ("NAP offered"),
# 12 offers to us ("NAP requested", entry field 1 = the offering alliance -> swap). Request state 1 NAP, 2 truce.
DIPLO_NAP, DIPLO_WAR, DIPLO_REQ_NAP, DIPLO_REQ_TRUCE = 4, 5, 1, 2

DIPLO_MAX_RANK = int(os.environ.get("GOFA_DIPLO_RANK", "2"))   # leader (1) + senior officers (2) may offer / accept / declare war


def _diplo_drop(a, other_id, lists):
    a["diplomacy"] = [d for d in a.get("diplomacy", []) if not (int(d["other"]) == int(other_id) and d.get("list") in lists)]


def relation(a, b):
    return next((d["state"] for d in a.get("diplomacy", []) if int(d["other"]) == int(b["id"]) and d.get("list") == 10), 0)


def request_between(a, b, lst):
    return next((d["state"] for d in a.get("diplomacy", []) if int(d["other"]) == int(b["id"]) and d.get("list") == lst), 0)


START_RANDOM = os.environ.get("GOFA_START_RANDOM", "1") == "1"
