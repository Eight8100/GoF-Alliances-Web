"""GoF Alliances replacement lobby/game server.

Wire format (rebuilt from the 1.16.1 binary, see GOFA_FINDINGS.md):
  request envelope:  1 fixed64, 2 fixed64, 3 repeated fixed64, 4 DeviceInfo, 5 ?, 10 repeated Request
  response envelope: 1 fixed64, 10 repeated Response
  Request / Response are containers whose payload is a single extension; the extension
  number picks the call (2113 = first call at startup).
"""
import datetime
import json
import os
import math
import struct
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pb
import schema
from netconf import PORT, bind_host, server_host
from gofa_core.rules.ruleset import (HOME_BY_RACE, START_RESOURCES, COLONY_START_RESOURCES, CAPACITY, EXTRACTOR_OF, BUILD_X,
    BUILD_MIX, BUILD_OVERRIDE, TRADE_RATIO_PERCENT, total_seconds, build_cost, build_seconds, extractor_part, RESEARCH_X,
    research_cost, research_seconds, carrier_cost, carrier_seconds, SPECIALIST_OF, SPECIALIST_BONUS, PLANET_BASE, SPECIES_PLANET,
    storage_step, DIG_BASE, DIG_FACTOR, SCAN_DRONES, SCAN_TIME, QUICK_MISSIONS, DEEP_MISSIONS, PIRATE_FLEETS, system_of,
    THREAT_LIMITS, threat_class, MISSION_TRAVEL_SECONDS, MISSION_TRAVEL_CLIENT, SHIP_CLASS, HARVEST, DEEP_TYPES, mission_yield,
    ships_after, fleet_cargo, SHARPSHOOTER_SKILL, SHARPSHOOTER_PERCENT, pd_shield, pd_raid_protection, SHIP_DEF_STEP,
    _fleet_strength, kill_xp, MAX_LEVEL, level_cost, LEVEL_TOTALS, RANK_LEVELS, level_threshold, limit_steps, carrier_limit,
    SHIP_ANCHORS, ship_limit, SHIP_LIMIT_ORIGINAL, commander_limits, player_level, skill_points_at, skill_cost,
    MISSION_BATTLE_XP, MISSION_PLAIN_XP, MISSION_RES, MISSION_RES_TYPE, mission_xp, MISSION_DROPS, MISSION_CREDITS, _R, _S, _H,
    _O, MISSION_DROP_TABLE, ITEM_NAMES, BLUEPRINT_WEIGHTS, BLUEPRINT_MK3_LEVEL, BLUEPRINT_NAMES, mission_credits, drop_chance,
    SHIP_CARGO, SHIP_XP, SHIP_COST, SHIP_STATS, SHIP_DEFS, SHIP_YARD, CARRIER_YARD, ACCURACY, accuracy, MOVE_SECONDS,
    MOVE_BASE_SECONDS, MOVE_SECONDS_PER_UNIT, JUMPGATE_SECONDS, NAV_SKILL, NAV_PERCENT, sec2, HQ_TRAVEL_STEP, HQ_TRAVEL_MIN,
    hq_travel_percent, ORDER_ATTACK, ORDER_RELOCATE, ORDER_DELIVER, ROUND_MAX, ROUND_WIPE, ROUND_LOSS, ROUND_CLOSE,
    ORDER_COLONIZE, PLANET_MGMT_SKILL, PLANET_EXTENDER_ITEM, PLANET_LIMIT_ON, ORDER_GATHER, QUARTER_SECONDS, GATHER_ON, BOMB_MAX,
    BOMB_PER_SHIP, next_quarter, RESULT_ONGOING, battle_goes_on, round_losses, TROOP_HP, bombed_troops, pool_fleets,
    DEMOLISH_REFUND, BLUEPRINT_TECH_OF, TECH_LAB, CARRIER_TECH_OF, BLUEPRINT_GATING, TECH_MAX, SKILL_MAX, SEC2_F64, CARRIER_F16,
    CARRIER_F11, ALLIANCE_MEMBER_CAP, ALLIANCE_SENIOR_OFFICERS, CREDITS, SPEEDUP_MIN, SPEEDUP_MAX, SPEEDUP_HALF, speedup_price,
    TECH_BONUS, TECH_BONUS_PER_LEVEL, TECH_SLOTS, JUMPGATE_AUTO_START, JUMPGATE_START_PLANET, GATE_LOCK, GATE_MISSION_TEXT,
    GATE_MISSIONS, START_CONQUERABLE, TROOP_COST, TROOP_SECONDS, DRONE_COST, DRONE_SECONDS, TUTORIAL_ENABLED, TUT_XP,
    TUT_REWARDS, A_CREDITS, A_SPENT, A_BLUEPRINTS, A_ARTIFACTS, A_DAYS, A_STREAK, A_USED, A_RAID, A_VOID, A_MK3, A_FREIGHTER2,
    A_FIGHTER2, A_INTERCEPTOR2, A_BOMBER2, MK1_SHIPS, MK2_SHIPS, BOOKMARK_SHARED, NPC_REGEN_SECONDS, PIRATE_RAIDS, RAID_MIN,
    RAID_MAX, PDEF_STRENGTH, NPC_NAMES, base_level_of, pirate_base, NPC_RESPAWN_SECONDS, SPY_SUCCESS_BASE, SPY_SUCCESS_PER_LEVEL,
    SPY_SUCCESS_DRONES, SPY_SUCCESS_SCALE, SPY_SUCCESS_MAX, SPY_DETECT_PLAYER, SPY_DETECT_NPC, SPY_DETECT_PER_DRONE,
    SPY_DETECT_PER_LEVEL, SPY_DETECT_MIN, SPY_DETECT_MAX, SPY_ANONYMOUS, SPY_COST, SPY_S2, SPY_EFF_MIN, SPY_DISTANCE_EFF,
    spy_success_chance, spy_view, CITADEL_ITEM, CARRIER_UPGRADE_MAX, COLOUR_OFFSET, OFFSET_ITEM, ARTIFACTS_PER_UPGRADE,
    VOID_CRYSTALS_PER_CARRIER, carrier_items, carrier_artifacts, OFFSET_COLOUR, RED_BLUE_BASE, RED_BLUE_PCT, RED_BLUE_VOID,
    YELLOW_FIRST, YELLOW_STEP, HANGAR_BASE, HANGAR_STEP, carrier_bonus, carrier_hangar, carrier_field, EXTENDER_AMOUNT,
    ITEM_PRICE_MULT, item_price_base, TECH_ITEM, ITEM_PRICE, ITEM_PRICES, item_price, CREDIT_BOOSTERS, XP_BOOST_ITEM,
    DAILY_CREDITS, SPECIES_BONUS, CAT_STRUCTURES, CAT_SHIPS, CAT_TROOPS, CAT_DRONES, CAT_TECHS, species_mult, yard_percent,
    ALLIANCE_LEADER, ALLIANCE_MEMBER, OFFER_APPLICATION, OFFER_INVITATION, DIPLO_NAP, DIPLO_WAR, DIPLO_REQ_NAP, DIPLO_REQ_TRUCE,
    DIPLO_MAX_RANK, _diplo_drop, relation, request_between, START_RANDOM,
    ESCAPE_ENGAGE, ESCAPE_AVOID, ESCAPE_YELLOW_SHARE, ESCAPE_MAX, escape_chance,
    VOID_RACE, VOID_LEVEL, VOID_REGEN_SECONDS, VOID_REGEN_SHARE, VOID_ARTIFACT_ITEMS, void_base, void_shares,
    VOID_RAIDS, VOID_RAID_RANGE, VOID_RAID_CHANCE, VOID_RAID_SHARE)

here = os.path.dirname(os.path.abspath(__file__))
CAPTURES = None if os.environ.get("GOFA_NO_CAPTURES") else os.path.join(here, "captures")   # off on the iPad build
if CAPTURES:
    os.makedirs(CAPTURES, exist_ok=True)


def capture(name, data):
    if CAPTURES:
        with open(os.path.join(CAPTURES, name), "wb") as f:
            f.write(data)


def handle_2113(req):
    """Client version check. Response 2113: 1 required status enum {22, 24, 25} (22 = default),
    2 required bool, 3 uint32, 4 repeated uint32."""
    return pb.v(1, 22) + pb.v(2, 0)


GAME_SERVER = "http://dominion-game-1.fishlegion.net"  # redirected to this server by redirect.js
# 2101 field 4: URL of the world connection (used verbatim; carries 150, 288 and the loading procedure)
WORLD_SERVER = "http://dominion-world-1.fishlegion.net/action"
SESSION_ID = 0x5EA510000001  # handed out on login (2700); the client echoes envelope field 1 back


ACCOUNT_ID = 0xACC000000001
PLAYER_ID = 0x91A000000001


def handle_login(req):
    """Login variants 2010-2013 (2013 = Game Center id + alias) and 2700 (create session).
    They only have error replies (9201x / 92700); 2005 {1,2,3: fixed64} follows the 201x group
    in the binary and is taken to be the shared success reply: session, account, player ids."""
    fs = list(pb.fields(req))
    alias = next((v.decode() for f, wt, v in fs if f == 8 and wt == 2), None)
    # 2011 (relaunch) has no alias: {1 session, 2 account (fixed64), 3, 4 token, 5 language, 6/7 device ids}
    acct = next((v for f, wt, v in fs if f == 2 and wt == 1), None)
    a = next((a for a in ACCOUNTS["accounts"] if a["account"] == acct), None) if alias is None else None
    # /debug/deviceas: logins from this device id (2013 field 5, 2011 field 6) play that player (the iPad shares
    # Game Center account of another device but plays its own player)
    dev = next((v.decode(errors="replace") for f, wt, v in fs if f == (6 if alias is None else 5) and wt == 2), "")
    if dev in ACCOUNTS.get("device_as", {}):
        if alias is None:
            a = account_for(ACCOUNTS["device_as"][dev])
        else:
            alias = ACCOUNTS["device_as"][dev]
    if alias is None and ACCOUNTS.get("play_as") and is_ipad(a):   # "new game" switch: the iPad plays another player
        a = account_for(ACCOUNTS["play_as"])
    if alias is not None and species_select_on() and not any(x["alias"] == alias for x in ACCOUNTS["accounts"]):
        # New Game Center player: answer "Game Center id not found" so the client shows the species selection and
        # then creates the game with 2700 {6 species, 7 portrait} (handle_2700). 2013 fails with ext 92913 (= 92000
        # + 0x391, not 92013); its field 1 = 1 becomes lobby error 12 (0x1004f9e64), which in Game Center mode with
        # no locally stored account switches the login screen to the new-game flow (0x1004bcb98 -> 0x1004bd700).
        s = {f: v.decode(errors="replace") for f, wt, v in fs if wt == 2 and f in (1, 5)}
        PENDING_GC[s.get(5, "")] = PENDING_GC["last"] = {"alias": alias, "gc": s.get(1, ""), "t": time.time()}
        print(f"=== 2013: new Game Center player {alias!r} -> 92913 (species selection)", flush=True)
        return [(92913, pb.v(1, 1))]
    return session_replies(alias or "Pilot", a)


# Species selection for new Game Center players (2026-10-27): on with GOFA_SPECIES_SELECT=1 or accounts.json
# "species_select" (/debug/speciesselect?on=1|0). Off = the old auto-create of a Terran player at the 2013 login.
PENDING_GC = globals().get("PENDING_GC", {})   # device id / "last" -> {"alias", "gc", "t"} of a 2013 answered with 92913


def species_select_on():
    return os.environ.get("GOFA_SPECIES_SELECT") == "1" or bool(ACCOUNTS.get("species_select"))


def handle_2700(req):
    """Create lobby session. The lobby state machine (0x1004ebf28, state 1) waits for response 2101:
    1 fixed64, 2 fixed64 (ids), 3 uint32, 4 string (stored as a wide string, likely the player name).
    Request 2700 field 13 is the Game Center alias. Sent by the new-game flow after the species selection:
    {1 1, 2 {}, 3 language, 4 device id, 6 species 1-3, 7 portrait, 10 data version, 11 uuid} (guest / SKIP capture)."""
    fs = list(pb.fields(req))
    alias = next((v.decode() for f, wt, v in fs if f == 13 and wt == 2), None)
    if not species_select_on():
        return session_replies(alias or "Pilot")
    num = {f: v for f, wt, v in fs if wt == 0}
    race, portrait = num.get(6, 1), num.get(7, 0)
    if race not in HOME_BY_RACE:   # 4 Robots / Voids was never a playable species (the screen offers 1-3)
        print(f"=== 2700 refused: species {race}", flush=True)
        return [(92700, pb.v(1, 106))]   # 106 -> lobby error 8 (0x1004ebd68); exact text unverified
    dev = next((v.decode(errors="replace") for f, wt, v in fs if f == 4 and wt == 2), "")
    p, last = PENDING_GC.pop(dev, None), PENDING_GC.pop("last", None)
    if p is None and last and time.time() - last["t"] < 900:   # 2013 and 2700 may carry different device ids
        p = last
    alias = alias or (p and p["alias"]) or "Guest-" + (dev.replace("-", "")[:6].upper() or "0")
    if any(x["alias"] == alias for x in ACCOUNTS["accounts"]):   # known player: log in as before, species unchanged
        return session_replies(alias)
    a = account_for(alias)
    a["race"], a["portrait"] = race, portrait
    if p and p.get("gc"):
        a["gc"] = p["gc"]
    _write_json(ACCOUNTS_FILE, ACCOUNTS)
    print(f"=== 2700: new player {alias!r} species {race} portrait {portrait} (home {HOME_BY_RACE[race]})", flush=True)
    return session_replies(alias, a)


PLAYER = {"alias": "Pilot"}  # last alias seen at login (single-player server)


def session_replies(alias, acct=None):
    a = acct or account_for(alias)
    use_player(a["player"])   # dispatch swaps the default player back in after the request
    PLAYER["alias"] = a["alias"] or alias
    """In state 1 the lobby session (0x1004ec814) waits until three replies have arrived:
    2005 (key 0: 1-4 required fixed64), 2100 (key 1: 1 required string, stored as text) and
    2101 (key 2: 1,2 fixed64, 3 uint32, 4 string = world connection URL). Then it moves to state 2."""
    return [(2005, pb.f64(1, SESSION_ID) + pb.f64(2, ACCOUNT_ID) + pb.f64(3, PLAYER_ID) + pb.f64(4, 1)),
            (2100, pb.ld(1, "GoFA Revival")),
            (2101, pb.f64(1, ACCOUNT_ID) + pb.f64(2, PLAYER_ID) + pb.v(3, 1) + pb.ld(4, WORLD_SERVER))]


def handle_2110(req):
    """Sent in lobby state 2; handler 0x1004ec30c copies the reply to session+0xc40 and moves to
    state 3. Response 2110: 1, 2 required strings; 3, 9 repeated messages; 4, 7, 8 strings;
    5, 6 varints; 10 fixed64 (layout only; meanings unknown). Field 1 may be the game server
    address: the client appends "/action" to it and posts game-protocol requests there."""
    world = pb.v(1, 1) + pb.ld(2, "Revival") + pb.v(3, 0) + pb.v(4, 0)      # 2110.3: 1, 2 required
    # 2110.9 = world connection: 1 server id*, 2 player id, 3 URL* used as-is for the world connection
    # (requests 150, 288, ... go there), 4/5/6 unknown.
    server = (pb.v(1, 1) + pb.v(2, PLAYER_ID & 0xFFFFFFFF) + pb.ld(3, GAME_SERVER + "/action")
              + pb.v(4, 1) + pb.ld(5, GAME_SERVER) + pb.v(6, 1))
    return (pb.ld(1, GAME_SERVER) + pb.ld(2, "GoFA Revival")
            + pb.ld(3, world) + pb.ld(9, server))


def handle_2100(req):
    """Request 2100 {3, 4, 7 = data version 461}; response 2100 is one required string."""
    return pb.ld(1, "GoFA Revival")


def handle_2101(req):
    """Request 2101 {1: 1} after state 3: answered with the same player record as at login."""
    return session_replies(PLAYER["alias"])[2][1]


def handle_2900(req):
    """ABANDON GAME (GAME SETTINGS -> YOUR ACCOUNTS, type ABANDON): {1 server 1, 2 1}, empty response. The save moves to
    backups/abandoned-<pid>-<time>.json, the player leaves its alliance, its planets are freed and it starts fresh
    (credit balance kept, for testing). The main save (Pilot) is refused with 92900."""
    pid = CUR_PLAYER[0]
    if pid == DEFAULT_PLAYER:
        print("   2900 abandon refused: main save (Pilot)", flush=True)
        return [(92900, pb.v(1, 1))]
    if alliance_of(pid):
        _leave_alliance("2900")
    save_state()
    credits = CREDITS_BOX[0]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    os.replace(player_file(pid), os.path.join(here, "backups", f"abandoned-{pid:X}-{stamp}.json"))
    _apply_state({})
    CREDITS_BOX[0] = credits
    seed_new_player()
    save_state()   # sync_owners frees the old planets
    ACCOUNTS.setdefault("no_game", []).append(pid)
    _write_json(ACCOUNTS_FILE, ACCOUNTS)
    print(f"=== 2900 abandon: player {pid:X} starts fresh (old save backups/abandoned-{pid:X}-{stamp}.json)", flush=True)
    return b""


def player_record():
    """Player {1 uint64 id*, 2 string name*, 3 enum 1-4* (race?), 4 enum, 5/7 uint64, 6/9/11 bool,
    8 Timestamp, 10 repeated message}. Types from the serializer (the map wrongly links field 3 to a message)."""
    # field 7 = leaderboard rank (COMMANDER PROGRESS board; 0 / absent = "You have not yet been ranked.")
    aid = alliance_id_of(PLAYER_ID)
    race = next((a.get("race", 1) for a in ACCOUNTS["accounts"] if a["player"] == PLAYER_ID), 1)   # species enum 1-4
    return (pb.v(1, PLAYER_ID) + pb.ld(2, PLAYER["alias"]) + pb.v(3, race) + pb.v(4, 1) + (pb.v(5, aid) if aid else b"")
            + pb.v(7, rank_of(PLAYER_ID)))


def handle_111(req):
    """User info (loader step 5, "Requesting initial player state"). Request is empty;
    response 111 = {1 Player*}."""
    return pb.ld(1, player_record())


def handle_301(req):
    """Save game (loader step 6). Request empty; response 301 = {1 SaveGame} where SaveGame has ~58
    optional fields (floats, counters, ids, lists; probably tutorial progress / settings). Sent empty
    = a new player with nothing saved."""
    return pb.ld(1, b"")


def handle_281(req):
    """Sent at step 7 once per section-21 type id (117 of them): {1 id}. Response {1 id*, 2 value*}.
    Echo the id (an id of 0 is not a valid enum value and gets dropped); value placeholder 0."""
    tid = next((v for f, wt, v in pb.fields(req) if f == 1 and wt == 0), 0)
    abandon_planets()   # this player's demolished Headquarters (tick_others only runs the OTHER accounts, so the planet stayed owned)
    tick_others()
    raided = pirate_raids()
    npc_respawn()
    void_tick()
    if boosters_now():       # a credit booster ran out: push the inventory
        return [(281, pb.v(1, tid) + pb.v(2, 0)), (272, handle_272(b""))]
    if daily_bonus():        # once a day: credits (+ active credit boosters), mail goes out with a later poll
        return [(281, pb.v(1, tid) + pb.v(2, 0)), (115, handle_115(b""))]
    if raided:   # pirates hit a colony: refresh it (the report mail goes out with the next poll via PENDING_MAIL)
        return [(281, pb.v(1, tid) + pb.v(2, 0))] + [(103, planet_details(p)) for p in raided]
    if ach_tick():           # achievement counters moved
        return [(281, pb.v(1, tid) + pb.v(2, 0)), (284, handle_284(b""))]
    if tutorial_changed():   # a tutorial requirement got fulfilled
        return [(281, pb.v(1, tid) + pb.v(2, 0)), (283, handle_283(b""))]
    if PENDING_XP:           # level / XP changed outside a mission
        PENDING_XP.clear()
        return [(281, pb.v(1, tid) + pb.v(2, 0)), (119, handle_119(b"")), (114, handle_114(b"")), (103, planet_details())]
    if PENDING_MAIL:         # new mail: push it as a 104 update
        ids = set(PENDING_MAIL); PENDING_MAIL.clear()
        return [(281, pb.v(1, tid) + pb.v(2, 0)), (104, mail_reply(ids))]
    if finish_moves():       # a relocated carrier arrived: push the planet (carriers)
        return ([(281, pb.v(1, tid) + pb.v(2, 0)), (102, planet_states()), (103, planet_details())]
                + [(103, planet_details(p)) for p in own_planets()[1:]] + [(109, handle_109(b""))])
    if resolve_missions():   # a fleet reached its mission: push planet (ships, resources), missions and credits
        # re-sending the travel does not clear it: the 205 handler skips known timer ids (0x1002cb5f8 -> 0x1002cb890)
        ENDED_TRAVELS.clear()
        # the 109 (fleets) push makes the client rebuild its travel/movement lists from the carriers (0x1002cc188 ->
        # 0x1002c1a58), which is what clears the "00m 00s" row in MANAGE FLEETS
        return ([(281, pb.v(1, tid) + pb.v(2, 0)), (103, planet_details())] + [(103, planet_details(p)) for p in own_planets()[1:]]
                + [(112, missions_reply()), (115, handle_115(b"")),
                 (109, handle_109(b"")), (119, handle_119(b"")), (272, handle_272(b""))])
    if PENDING_PLANET_PUSH and PENDING_PLANET_PUSH[0] <= time.time():
        # Deferred planet refresh after a collect (see handle_210): ride along with the periodic 281.
        lost = "planets" in PENDING_PLANET_PUSH   # a planet was conquered from this player
        PENDING_PLANET_PUSH.clear()
        return ([(281, pb.v(1, tid) + pb.v(2, 0)), (103, planet_details()), (109, handle_109(b""))]
                + ([(102, planet_states()), (242, handle_242(b""))] if lost else []))
    if CUR_PLAYER[0] in PENDING_ALLIANCE_PUSH:   # alliance changed by someone else (diplomacy): re-send 219 + 234
        PENDING_ALLIANCE_PUSH.discard(CUR_PLAYER[0])
        return [(281, pb.v(1, tid) + pb.v(2, 0))] + _alliance_push()
    return pb.v(1, tid) + pb.v(2, 0)


PENDING_PLANET_PUSH = []   # [earliest time] when a 103 push is owed
PENDING_ALLIANCE_PUSH = globals().get("PENDING_ALLIANCE_PUSH", set())   # player ids owed a 219 push on their next 281


def handle_302(req):
    """Save-game update: {1 SaveGame delta (e.g. fields 20, 30), 2 sequence}. Response {2 sequence*}:
    must echo the request's sequence, otherwise the client resends every 10 s.
    TODO stage 2: merge the delta into the stored save game."""
    seq = next((v for f, wt, v in pb.fields(req) if f == 2 and wt == 0), 0)
    return pb.v(2, seq)


def handle_288(req):
    """Sent from loader step 0 and retried: {1: 1, 2: 2, 3: [1]}. Response 288 (real vtable 0x100c70838,
    found with re-tools/probe_ext_init.js) = {1 int32*, 2 varint64*, 3 repeated varint64, 4 repeated
    message, 5 varint64}. Echo fields 1 and 2, lists empty."""
    vals = {f: v for f, wt, v in pb.fields(req) if wt == 0}
    out = pb.v(1, vals.get(1, 1)) + pb.v(2, vals.get(2, 1))
    if vals.get(2) in ALLIANCE_BOARDS and LEADERBOARD_ON[0]:   # alliance board page (galaxy TOP 10 mode polls type 2)
        req_ids = [v for f, wt, v in pb.fields(req) if f == 3 and wt == 0] or [1]
        page = alliance_ranking(vals[2])[(req_ids[0] - 1) * 10:req_ids[0] * 10]
        if LB_TAG_TYPE[0]:
            page = [(aid, name, vals[2] * 1000 + sc) for aid, name, sc in page]
        scores = b"".join(pb.ld(2, pb.v(1, aid) + pb.f64(2, struct.unpack("<Q", struct.pack("<d", float(sc)))[0]) + pb.ld(3, name))
                          for aid, name, sc in page)
        return out + (b"".join(pb.v(3, i) for i in req_ids) + pb.ld(4, pb.v(1, req_ids[0]) + scores + pb.ld(3, ts(time.time())))
                      + pb.v(5, LB_F5[0]))
    if vals.get(2) == 1 and LEADERBOARD_ON[0]:   # LEADERBOARDS panel query {1: 1, 2: 1, 3: [1]} (experiment)
        # entry field 2 is fixed64 = a DOUBLE score (raw XP bits read as ~0 before)
        # field 3 = page numbers; page p lists ranks p*10-9 .. p*10 (rank = sort by XP, step 3)
        req_ids = [v for f, wt, v in pb.fields(req) if f == 3 and wt == 0] or [1]
        board = ranking()
        page = board[(req_ids[0] - 1) * 10:req_ids[0] * 10]
        scores = b"".join(pb.ld(2, pb.v(1, pid) + pb.f64(2, struct.unpack("<Q", struct.pack("<d", float(xp)))[0]) + pb.ld(3, alias))
                          for pid, alias, xp in page)
        out += (b"".join(pb.v(3, i) for i in req_ids) + pb.ld(4, pb.v(1, req_ids[0]) + scores + pb.ld(3, ts(time.time())))
                + pb.v(5, LB_F5[0]))
    return out


LEADERBOARD_ON = [True]
OWN_RANK = 1   # single player: always first. 288 page p must list ranks p*10-9.. with us at index OWN_RANK-(p*10-9)
LB_F5 = [1]


def handle_101(req):
    """Player info by id: {1 player id} -> {1 {1 [player 0x100c6a998 {1 id*, 2 name*, 3 race 1-4*, 4, 5, ...}]}}."""
    ids = [v for f, wt, v in pb.fields(req) if f == 1 and wt == 0] or [PLAYER_ID]
    recs = b""
    for pid in ids:   # any known player (step 3); unknown ids get a placeholder so the client stops waiting
        info = player_info(pid)   # field 5 = alliance id, only when set (a 0 still counts as "in alliance 0")
        aid = alliance_id_of(pid)
        recs += pb.ld(1, pb.v(1, pid) + pb.ld(2, info["alias"]) + pb.v(3, info["race"]) + (pb.v(5, aid) if aid else b"")
                      + pb.v(6, player_level(info["xp"])) + pb.v(7, rank_of(pid))   # 7 = COMMANDER PROGRESS rank
                      + outer_planets_field(pid))   # 10 = OUTER PLANETS in the profile (same alliance only)
    return pb.ld(1, recs)


def handle_295(req):
    """Player profile (PLAYER INFORMATION panel, sent with 101 / 221 / 223 / 220): {1 player id} -> {1 profile
    0x100c64c50 {1 id*, 2 name*, 3 varint32*, 4 {1 [{1 int32*, 2 n*}]}, 5 varint64, 6 varint32}, 2 varint64*}.
    Field meanings are guesses: 3 race, 5 alliance id, 6 level, 2 the requested id."""
    pid = _req_fields(req).get(1, PLAYER_ID)
    info = player_info(pid)
    # Field 5 only when in an alliance: a present 5 (even 0) makes the client look up that alliance (220) and show
    # the diplomacy mode 2 instead of mode 3/4 (INVITE TO ALLIANCE button), 0x1004a1b28 / 0x10049da64.
    aid = alliance_id_of(pid)
    prof = (pb.v(1, pid) + pb.ld(2, info["alias"]) + pb.v(3, info["race"]) + pb.ld(4, b"")
            + (pb.v(5, aid) if aid else b"") + pb.v(6, player_level(info["xp"])))
    return pb.ld(1, prof) + pb.v(2, pid)


def handle_289(req):
    """Init batch: {1: 3}. Response 289 (real vtable 0x100c70748) = {1 varint32* (has-bit 0 checked),
    2 repeated message}. Echo field 1. (An empty reply failed and sank the whole init-batch envelope.)"""
    v = next((v for f, wt, v in pb.fields(req) if f == 1 and wt == 0), 1)
    # The handler (0x10074c1e4 -> 0x10074c4a4) inserts a client-side item at position 4 of the list built
    # from field 2, so the list needs at least 4 entries (else crash). Entries {1, 2, 3: optional messages}.
    # Entries {1 {1 kind*, 2 value*} | 2 mail-like msg | 3 other}; an entry with none of them is skipped.
    # Kind 5 is special-cased by the client; kind 1 used as placeholder.
    # Kind-1 board types 1 COMMANDER PROGRESS, 2-4 alliance boards (one entry each; the client adds its own at index 4).
    return pb.v(1, v) + b"".join(pb.ld(2, pb.ld(1, pb.v(1, t) + pb.v(2, 0))) for t in LB_BOARD_TYPES)


LB_BOARD_TYPES = (1, 2, 3, 4)
LB_TAG_TYPE = [False]   # experiment: alliance board scores = type * 1000 + score (showed which tab is which type)


def handle_312(req):
    """Game server, first call {1: 0}. Response 312: 1 required int64 (guessed: server time in ms),
    2 optional Player, 3 varint. Without a Player the client stops at the account list.
    Player: 1 uint64 id*, 2 string name*, 3 enum 1-4*, 4 enum (1,2,4..11 valid), 5/7 uint64,
    6/9/11 bool, 8 message, 10 repeated message (* = required)."""
    now = int(time.time() * 1000)
    if CUR_PLAYER[0] in ACCOUNTS.get("no_game", []):   # abandoned (2900): no Player -> the client offers a new commander
        print(f"   312: player {CUR_PLAYER[0]:X} has no game account (abandoned)", flush=True)
        return pb.v(1, now) + pb.v(4, now)
    player = player_record()
    return pb.v(1, now) + pb.ld(2, player) + pb.v(4, now)


def handle_2114(req):
    """Game server list. Request 2114 {2: data version 461, 4: 1}.
    Response 2114: 1 repeated Server {1 id*, 2 name* (SERVER:), 3 status enum 1-5* (1 = OPEN),
    4 float fill level 0..1 (FILL LEVEL:), 5 string (guessed: address)}. * = required."""
    account = (pb.v(1, 1) + pb.ld(2, "Revival") + pb.v(3, 1)
               + pb.key(4, 5) + struct.pack("<f", 0.0) + pb.ld(5, GAME_SERVER))
    return pb.ld(1, account)


HOME_SYSTEM = 1001   # system "Home" (sector 0_0); mission field 4 must equal the current system id
HOME_PLANET = HOME_DEFAULT = 1101  # planet 1 of system "Home" (id 1001) in the special sector 0_0 (data/map_x/0_0), the Terran
# start system (A'Belarr 2001 / Ninarah 3001 are the other two races'). The client only sets the player's
# instance system (GS_Player +0x110, read by SystemView) from a planet whose system lies in sector 0_0 and whose
# planet number is 1 (0x10027849c: 0x10027407c + 0x1002722c8); a normal-sector home crashes the first screen.
# moved to gofa_core/rules/ruleset.py: HOME_BY_RACE

def set_home(planet):
    globals()["HOME_PLANET"], globals()["HOME_SYSTEM"] = planet, system_of(planet)
    CUR_PLANET[0] = planet


PLANET_PARTS = (2,) + tuple(range(4, 18))   # 2 + sub-states 4-17 (3 = owner, has required fields 1-3: empty -> whole
# envelope rejected, loader stuck at step 7); the planet is only "ready" (PlanetState +0x670,
# set in 0x10023a5a8) once fields 4 and 6-17 are all present, whatever request 103 asks for


# Structures (planet field 14 / request 200): {1 type 1-11, 2 slot, 3 level, 4 unique id}. Request 200 =
# {1 planet, 2 structure} = "build type T in slot S up to level L"; the reply is a construction entry
# (planet field 15 element 0x100c69cf0): {1 timer 0x100c66078, 2 structure, 3 planet id}.
# Timer: {1 id, 2 start, 3 end, 4 end? (start here showed 00:00), 5 job kind 1-12 (validator 0x1000067d8; 1 assumed = construction), 6}.
# Timestamps 0x100c6a560 = {1 double unix seconds}. Build time = 60 s x level (placeholder, see statics 11).
# Balance (2026-10-17): build_seconds() / build_cost() below; one curve for all buildings, HQ x1.5 time.
# Multiplayer groundwork (2026-10-19): one state file per player (state/players/<player id hex>.json, same dict as the
# old state.json), shared world data in state/world.json, logins in state/accounts.json. The module-level globals
# below always hold DEFAULT_PLAYER at rest; use_player(pid) swaps another player in for the length of a request.
STATE_DIR = os.path.join(here, "state")
PLAYERS_DIR = os.path.join(STATE_DIR, "players")
os.makedirs(PLAYERS_DIR, exist_ok=True)
LEGACY_STATE_FILE = os.path.join(here, "state.json")   # pre-multiplayer single-player save (kept untouched)
WORLD_FILE = os.path.join(STATE_DIR, "world.json")
ACCOUNTS_FILE = os.path.join(STATE_DIR, "accounts.json")
DEFAULT_PLAYER = PLAYER_ID
CUR_PLAYER = [DEFAULT_PLAYER]   # whose state the globals hold right now


def player_file(pid):
    return os.path.join(PLAYERS_DIR, f"{int(pid):X}.json")


STATE_FILE = player_file(DEFAULT_PLAYER)
if not os.path.exists(STATE_FILE) and os.path.exists(LEGACY_STATE_FILE):   # one-off migration
    import shutil
    shutil.copyfile(LEGACY_STATE_FILE, STATE_FILE)
STRUCTURES = {0: {"type": 1, "slot": 0, "level": 1}}   # slot -> structure; start with an HQ
BUILDS = []                                            # pending constructions
JOB_ID = [1000]
# moved to gofa_core/rules/ruleset.py: START_RESOURCES

RESOURCES = [{"type": t, "amount": START_RESOURCES, "ts": time.time()} for t in (1, 2, 3)]
if os.path.exists(STATE_FILE):                         # survive server restarts (USB reconnects)
    _st = json.load(open(STATE_FILE))
    STRUCTURES = {int(k): v for k, v in _st["structures"].items()}
    BUILDS[:] = _st["builds"]
    JOB_ID[0] = _st["job_id"]
    RESOURCES = _st.get("resources", RESOURCES)
    _ships = {int(k): v for k, v in _st.get("ships", {}).items()}
    _ship_jobs = _st.get("ship_jobs", [])
    _carrier_jobs = _st.get("carrier_jobs", [])
    _carriers = _st.get("carriers", [])
    _carrier_groups = _st.get("carrier_groups", [])
    _credits = _st.get("credits", 10000)
    _scan_jobs = _st.get("scan_jobs", [])
    _missions = _st.get("missions", [])
    _reports = _st.get("reports", [])
    _mail = _st.get("mail", [])
    _xp = _st.get("xp", 0)
    _skills = {int(k): v for k, v in _st.get("skills", {}).items()}
    _techs = {int(k): v for k, v in _st.get("techs", {}).items()}
    _research = _st.get("research", [])
    _jumpgate = _st.get("jumpgate", {})
    _colonies = _st.get("colonies", [])
    _troop_jobs = _st.get("troop_jobs", [])
    _dig_jobs = _st.get("dig_jobs", [])
    _tut_claimed = _st.get("tut_claimed", [])
    _traded = _st.get("traded", False)
    _stats = _st.get("stats", {})
    _inventory = _st.get("inventory")
    _boosts = _st.get("boosts", {})
    _home_npc = _st.get("home_npc")
    _tut_flags = _st.get("tut_flags", [])
    _ach = _st.get("ach")
    _bookmarks = _st.get("bookmarks", [])
    if "npc" in _st:
        _npc = _st["npc"]
    _raids = _st.get("raids", {})
    _npc_next = _st.get("npc_next", 0)
    _planet_state = _st.get("planet_state", {})
if os.path.exists(WORLD_FILE):                         # shared world: pirate bases, respawn timer, job id counter
    _w = json.load(open(WORLD_FILE))
    _npc, _npc_next = _w["npc"], _w.get("npc_next", 0)
    JOB_ID[0] = max(JOB_ID[0], _w.get("job_id", 0))
    _battles = _w.get("battles", [])


CUR_PLANET = [HOME_PLANET]   # whose structures/builds/resources the STRUCTURES/BUILDS/RESOURCES globals hold now
PLANET_STATE = dict(globals().get("_planet_state", {}))   # str(planet id) -> {"structures", "builds", "resources"}
# moved to gofa_core/rules/ruleset.py: COLONY_START_RESOURCES

def use_planet(pid):
    """Swap planet pid's state into the STRUCTURES / BUILDS / RESOURCES globals (in place, so references held by
    the hot-reload front end stay valid). Colonies start with an HQ and COLONY_START_RESOURCES of each resource."""
    pid = int(pid)
    if pid == CUR_PLANET[0]:
        return
    PLANET_STATE[str(CUR_PLANET[0])] = _snapshot()
    st = PLANET_STATE.get(str(pid)) or {
        "structures": {"0": {"type": 1, "slot": 0, "level": 1}}, "builds": [],
        "resources": [{"type": t, "amount": COLONY_START_RESOURCES, "ts": time.time()} for t in (1, 2, 3)]}
    STRUCTURES.clear(); STRUCTURES.update({int(k): v for k, v in st["structures"].items()})
    BUILDS[:] = st["builds"]
    RESOURCES[:] = st["resources"]
    g = globals()
    if "SHIPS" in g:
        SHIPS.clear(); SHIPS.update({int(k): v for k, v in st.get("ships", {}).items()})
        SHIP_JOBS[:] = st.get("ship_jobs", [])
        CARRIER_JOBS[:] = st.get("carrier_jobs", [])
    CUR_PLANET[0] = pid


def _snapshot():
    g = globals()
    out = {"structures": {str(k): v for k, v in STRUCTURES.items()}, "builds": list(BUILDS),
           "resources": [dict(r) for r in RESOURCES]}
    if "SHIPS" in g:
        out.update({"ships": {str(k): v for k, v in SHIPS.items()}, "ship_jobs": list(SHIP_JOBS),
                    "carrier_jobs": list(CARRIER_JOBS)})
    return out


class on_planet:
    """with on_planet(pid): ... runs with that planet swapped in, and swaps home back afterwards."""
    def __init__(self, pid):
        self.pid = int(pid) if pid else HOME_PLANET
    def __enter__(self):
        use_planet(self.pid)
    def __exit__(self, *a):
        use_planet(HOME_PLANET)


def _home_view():
    """(structures, builds, resources) of the home planet, whichever planet is swapped in right now."""
    if CUR_PLANET[0] == HOME_PLANET:
        return STRUCTURES, BUILDS, RESOURCES
    h = PLANET_STATE[str(HOME_PLANET)]
    return h["structures"], h["builds"], h["resources"]


def save_state():
    cur = CUR_PLANET[0]
    if cur != HOME_PLANET:   # the top-level fields are always the home planet's
        use_planet(HOME_PLANET)
    try:
        _save_state()
    finally:
        if cur != HOME_PLANET:
            use_planet(cur)


# Load test 2026-10-26 (docs/LOADTEST_2026-10-26.md): a poll saves ~15 times, mostly unchanged. Compact JSON (C encoder;
# indent= falls back to the slow pure-Python one) and no disk write while the file is still the one we last wrote with the
# same content. Read a save with `python3 -m json.tool FILE`.
_LAST_WRITTEN = globals().get("_LAST_WRITTEN") or {}   # path -> (json text, mtime_ns of our write)


def _write_json(path, d):
    s = json.dumps(d, separators=(",", ":"))
    last = _LAST_WRITTEN.get(path)
    if last and last[0] == s:
        try:
            if os.stat(path).st_mtime_ns == last[1]:
                return
        except OSError:
            pass
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(s)
    os.replace(tmp, path)
    _LAST_WRITTEN[path] = (s, os.stat(path).st_mtime_ns)


def _save_state():
    d = _player_dict()
    world = {"npc": d.pop("npc"), "npc_next": d.pop("npc_next"), "job_id": JOB_ID[0]}
    if "OWNERS" in globals():   # step 3: shared planet-owner index (planet id -> owner player id)
        sync_owners()
        world["owners"] = {str(k): v for k, v in OWNERS.items()}
    if "ALLIANCES" in globals():
        world["alliances"] = ALLIANCES
    world["battles"] = globals().get("BATTLES", [])
    _write_json(player_file(CUR_PLAYER[0]), d)
    _write_json(WORLD_FILE, world)


def _player_dict():
    return ({"home": HOME_PLANET, "structures": STRUCTURES, "builds": BUILDS, "job_id": JOB_ID[0], "resources": RESOURCES,
               "planet_state": {k: v for k, v in PLANET_STATE.items() if k != str(HOME_PLANET)},
               "ships": SHIPS, "ship_jobs": SHIP_JOBS, "carrier_jobs": CARRIER_JOBS, "carriers": CARRIERS,
               "credits": CREDITS_BOX[0], "scan_jobs": SCAN_JOBS, "missions": MISSIONS,
               "reports": REPORTS, "mail": MAIL, "xp": XP_BOX[0], "battle_xp": BATTLE_XP_BOX[0], "skills": SKILLS,
               "techs": TECHS, "research": RESEARCH, "jumpgate": JUMPGATE, "colonies": COLONIES,
               "troop_jobs": TROOP_JOBS, "dig_jobs": globals().get("DIG_JOBS", []), "tut_claimed": sorted(globals().get("TUT_CLAIMED", [])),
               "traded": globals().get("TRADED", [False])[0], "stats": globals().get("STATS", {}),
               "inventory": {str(k): v for k, v in globals().get("INVENTORY", {}).items()},
               "boosts": globals().get("BOOSTS", {}),
               "home_npc": {str(k): v for k, v in globals().get("HOME_NPC", {}).items()},
               "ach": globals().get("ACH", {}), "tut_flags": sorted(globals().get("TUT_FLAGS", [])), "bookmarks": globals().get("BOOKMARKS", []),
               "npc": {str(k): v for k, v in globals().get("NPC_PLANETS", {}).items()},
               "raids": {str(k): v for k, v in globals().get("RAIDS", {}).items()},
               "npc_next": globals().get("NPC_NEXT", [0])[0]}
            | ({"carrier_groups": CARRIER_GROUPS} if globals().get("CARRIER_GROUPS") else {}))


# moved to gofa_core/rules/ruleset.py: CAPACITY, EXTRACTOR_OF, BUILD_X, BUILD_MIX, BUILD_OVERRIDE, TRADE_RATIO_PERCENT, total_seconds,
#     build_cost, build_seconds, extractor_part, RESEARCH_X, research_cost, research_seconds, carrier_cost, carrier_seconds, SPECIALIST_OF,
#     SPECIALIST_BONUS

def per_hour(rtype):
    if rtype not in (1, 2, 3):   # troops (4) / spy drones (5) are trained, not produced
        return 0
    return _per_hour(rtype)


# moved to gofa_core/rules/ruleset.py: PLANET_BASE, SPECIES_PLANET

def abundance(pid, rtype):
    """Map rating (1.0-5.0, map planet field 8) of resource rtype on planet pid."""
    if pid not in _PTYPE:
        _map_planet(pid)
    return _PABUND.get(pid, {}).get(rtype) or 3.0


def species_planet(pid, pl=None):
    return SPECIES_PLANET.get((race_of(pl or CUR_PLAYER[0]), map_planet_field(pid, 3)), 1.0)


def _per_hour(rtype):
    pid = CUR_PLANET[0]
    base = PLANET_BASE + sum(extractor_part(st["level"]) for st in STRUCTURES.values()
                             if st["type"] == EXTRACTOR_OF.get(rtype) and st["level"] > 0)
    base *= abundance(pid, rtype) * species_planet(pid)
    bonus = 1 + SPECIALIST_BONUS * globals().get("SKILLS", {}).get(SPECIALIST_OF.get(rtype), 0)
    techs = globals().get("TECHS", {})
    bonus += TECH_BONUS_PER_LEVEL * sum(lv for t, lv in techs.items() if globals().get("TECH_BONUS", {}).get(t) == rtype)
    return int(base * bonus + 1e-6)


# moved to gofa_core/rules/ruleset.py: storage_step

def capacity():
    """Storage per resource: 37,500 (HQ 1 = 50,000 seen) + HQ + each Trade Center, +10% per SILO tech level (tech 5)."""
    hq = max([st["level"] for st in STRUCTURES.values() if st["type"] == 1] + [1])
    trade = sum(storage_step(st["level"]) for st in STRUCTURES.values() if st["type"] == 10)
    return int((37500 + storage_step(hq) + trade) * (1 + 0.10 * globals().get("TECHS", {}).get(5, 0)))


def settle_resources():
    """Bring stored amounts up to now (production since the last settle), capped."""
    now = time.time()
    for r in RESOURCES:
        # stock already above the cap stays (old saves, raids, deliveries); only production stops
        r["amount"] = max(r["amount"], min(capacity(), r["amount"] + per_hour(r["type"]) * (now - r["ts"]) / 3600.0))
        r["ts"] = now


def resource_msg(r):
    return (pb.v(1, r["type"]) + pb.v(2, int(r["amount"])) + pb.v(3, 24 * per_hour(r["type"])) + pb.v(4, capacity())
            + pb.ld(5, ts(r["ts"])))


def ts(t):
    return pb.key(1, 1) + struct.pack("<d", t)


def structure_msg(st):
    # Field 4 = unique structure id: the client matches slot widgets to records by it (0x10027c46c); with
    # every id 0 all widgets bound to the first record (the extractor's Upgrade upgraded the HQ).
    return pb.v(1, st["type"]) + pb.v(2, st["slot"]) + pb.v(3, st["level"]) + pb.v(4, structure_id(st["slot"]))


def planet_of_structure(sid):
    """Which own planet a structure id belongs to (home ids 1000 + slot, colonies (planet % 1e9) * 100 + slot)."""
    for p in own_planets()[1:]:
        if sid // 100 == p % 10**9:
            return p
    return HOME_PLANET


def structure_id(slot, pid=None):
    """Unique structure id: home keeps 1000 + slot (ids already used by jobs); colonies (planet % 1e9) * 100 + slot."""
    pid = CUR_PLANET[0] if pid is None else pid
    return 1000 + slot if pid == HOME_PLANET else (pid % 10**9) * 100 + slot


ABANDON = []   # planets whose Headquarters was just demolished; lose_planet() runs outside on_planet (see abandon_planets)


def structures_now():
    """Apply finished constructions, then list the planet's structures."""
    for job in [j for j in BUILDS if j["end"] <= time.time()]:
        settle_resources()
        BUILDS.remove(job)
        if job["level"] == 0:   # demolished (request 200 with target level 0)
            old = STRUCTURES.pop(job["slot"], None)
            for r, c in zip(RESOURCES, job.get("refund", ())):
                r["amount"] += c
            print(f"   demolished: {old} refund {job.get('refund')}", flush=True)
            if job["type"] == 1:   # no Headquarters = planet abandoned
                print(f"   abandoned: {job.get('planet')}", flush=True)
                ABANDON.append(job.get("planet"))
        else:
            STRUCTURES[job["slot"]] = {"type": job["type"], "slot": job["slot"], "level": job["level"]}
        save_state()
    return list(STRUCTURES.values())


def construction_msg(job):
    timer = (pb.v(1, job["id"]) + pb.ld(2, ts(job["start"])) + pb.ld(3, ts(job["end"])) + pb.ld(4, ts(job["end"]))
             + pb.v(5, 1))
    st = {"type": job["type"], "slot": job["slot"], "level": job["level"]}
    return pb.ld(1, timer) + pb.ld(2, structure_msg(st)) + pb.v(3, job.get("planet", CUR_PLANET[0]))


SHIP_JOBS = list(globals().get("_ship_jobs", []))   # ship production orders (planet field 10 queue)
SHIPS = dict(globals().get("_ships", {}))   # ship type -> count stationed on the home planet (field 11)
SHIP_JOBS[:] = globals().get("_ship_jobs", [])


def ships_now():
    """Move finished ship production into the planet's ships; returns {type: count}."""
    for job in [j for j in SHIP_JOBS if j["end"] <= time.time()]:
        SHIPS[job["ship"]] = SHIPS.get(job["ship"], 0) + job["count"]
        SHIP_JOBS.remove(job)
        save_state()
    return SHIPS


def ship_job_msg(job):
    timer = (pb.v(1, job["id"]) + pb.ld(2, ts(job["start"])) + pb.ld(3, ts(job["end"])) + pb.ld(4, ts(job["end"]))
             + pb.v(5, 2))   # job kind 2 assumed = ship production (1 = construction)
    return pb.ld(1, timer) + pb.ld(2, pb.v(1, job["ship"]) + pb.v(2, job["count"])) + pb.v(3, job["yard"])


SCAN_JOBS = list(globals().get("_scan_jobs", []))   # planet field 8 queue (scanning array)
# moved to gofa_core/rules/ruleset.py: DIG_BASE, DIG_FACTOR

def dig_scaled(x, pid=None):
    """Client scaling of the dig cost / time: x f(q), f(q) = 1 - 0.3 (q-1)/(q+1), q = map planet field 7 (quality,
    CAPTION_INFOSCREEN_STRUCT_PLANET_PRODUCTION_COSTS), rounded up. Without a planet: DIG_FACTOR (q 9)."""
    q = map_planet_field(pid, 7) if pid else 0
    f = 1 - 0.3 * (q - 1) / (q + 1) if q else DIG_FACTOR
    return int(math.ceil(x * f + 1e-7))
# moved to gofa_core/rules/ruleset.py: SCAN_DRONES, SCAN_TIME

def scan_job_msg(job):
    """Planet field 8 entry 0x100c67a40 {1 timer*, 2 int32* = range (request 204 field 2: 0 quick, 1 deep),
    3 varint64* = scanning array structure id}. Timer kind 4 is a guess."""
    timer = (pb.v(1, job["id"]) + pb.ld(2, ts(job["start"])) + pb.ld(3, ts(job["end"])) + pb.ld(4, ts(job["end"]))
             + pb.v(5, 4))
    return pb.ld(1, timer) + pb.v(2, job["range"]) + pb.v(3, job["scanner"])


# moved to gofa_core/rules/ruleset.py: QUICK_MISSIONS, DEEP_MISSIONS, PIRATE_FLEETS

MISSIONS = list(globals().get("_missions", []))
MISSION_ID = [max([m["id"] for m in MISSIONS] + [r.get("mission", 0) for r in globals().get("_reports", [])] + [50000])]   # never reuse ids (reports keep them)


# moved to gofa_core/rules/ruleset.py: system_of, THREAT_LIMITS, threat_class

def mission_msg(m):
    """Entry 0x100c66f78 {1 id*, 2 type 1-22, 4 varint64 = SYSTEM id (the Missions panel 0x100539c94 lists only
    missions whose field 4 == current system [GS+8]), 3 varint64 = planet the mission is at (with the home planet the
    system view shows a purple '!' mission marker next to it; with the scanner id it vanished), 4 varint64 (assigned carrier?),
    5 varint32 (level?), 6 Timestamp (expiry?), 7 {1 [{1 ship type, 2 threat class}]} = enemy fleet}. Field meanings 3-6
    are guesses. Field 7.1.2 is NOT a count: an enum 1-7 (parser 0x1000a8554, captions 0x10038c258: EXPECTED THREAT
    1 FEW .. 6 LEGION, 7 NONE); any other value is dropped -> required field missing -> the whole 112 (login) fails."""
    fleet = b"".join(pb.ld(1, pb.v(1, int(t)) + pb.v(2, threat_class(n))) for t, n in sorted(m.get("fleet", {}).items()))
    planet = m.get("planet", HOME_PLANET)
    return (pb.v(1, m["id"]) + pb.v(2, m["type"]) + pb.v(3, planet) + pb.v(4, system_of(planet)) + pb.v(5, m.get("level", 1))
            + pb.ld(6, ts(m["expires"])) + (pb.ld(7, fleet) if fleet else b""))


def missions_reply():
    now = time.time()
    MISSIONS[:] = [m for m in MISSIONS if m["expires"] > now]
    return pb.ld(1, b"".join(pb.ld(1, mission_msg(m)) for m in MISSIONS))


def handle_112(req):
    return missions_reply()


def scan_found_missions(job):
    """A finished scan finds 3 missions of its range (quick / deep), valid for a day. Level = up to the scanning array's level (DESC "enables
    missions up to level <LEVEL>", 1-10, the statics s5 level range): enemy fleet x level, yield grows ~1.3x per level (mission_yield)."""
    import random
    pool = DEEP_MISSIONS if job["range"] else QUICK_MISSIONS
    top = min(10, yard_level(job["scanner"], 8, job.get("planet", HOME_PLANET)))
    for t in random.sample(pool, 3):
        lvl = random.randint(max(1, top - 2), top)
        MISSION_ID[0] += 1
        MISSIONS.append({"id": MISSION_ID[0], "type": t, "level": lvl, "expires": time.time() + 86400, "scanner": job["scanner"],
                         "job": job["id"], "planet": job.get("planet", HOME_PLANET),
                         "fleet": {str(k): v * lvl for k, v in PIRATE_FLEETS.get(t, {}).items()}})
    save_state()


# moved to gofa_core/rules/ruleset.py: MISSION_TRAVEL_SECONDS, MISSION_TRAVEL_CLIENT

MOVE_TARGET = 1201   # experiment: movement target (planet 2 of Home)
MOVE_ORDER = 6   # experiment: carrier field 10 order type while travelling


def travel_msg(t):
    """Travel record 0x100c678d8 {1 timer*, 2 varint64* (mission id), 3 varint64* (carrier id),
    4 varint32* (guess: 1 = outbound)}. Same type as carrier field 11 and response 205 field 1."""
    # field 2 = mission, field 3 = carrier: the fleet list finds a carrier's travel by field 3 (0x1002c7aa8 reads +0x18)
    # and the location code looks the mission up by field 2 (0x1002c3f44)
    return pb.ld(1, travel_timer(t)) + pb.v(2, t["mission"]) + pb.v(3, t["carrier"]) + pb.v(4, 1)


def travel_timer(t):
    return (pb.v(1, t["id"]) + pb.ld(2, ts(t["start"])) + pb.ld(3, ts(t["end"])) + pb.ld(4, ts(t["end"]))
            + pb.v(5, 5))   # timer kind 5 guessed (travel)


def handle_205(req):
    """Start mission (Missions panel -> SEND): {1 carrier id*, 2 mission id*, 3 cargo, 4 fixed64 speed (double 1.0),
    5 list} -> {1 travel record}. The carrier travels MISSION_TRAVEL_SECONDS to the mission."""
    f = {n: v for n, wt, v in pb.fields(req)}
    JOB_ID[0] += 1
    now = time.time()
    car = next((c for c in CARRIERS if c["id"] == f.get(1, 0)), {})
    mis = next((m for m in MISSIONS if m["id"] == f.get(2, 0)), {})
    secs = (travel_seconds(car.get("at") or HOME_PLANET, mis.get("planet", HOME_PLANET), mission=True, carrier=car or None)
            if MISSION_TRAVEL_CLIENT else MISSION_TRAVEL_SECONDS)
    t = {"id": JOB_ID[0], "carrier": f.get(1, 0), "mission": f.get(2, 0), "start": now, "end": now + secs}
    for c in CARRIERS:
        if c["id"] == t["carrier"]:
            c["travel"] = t
    for m in MISSIONS:
        if m["id"] == t["mission"]:
            m["carrier"] = t["carrier"]
    save_state()
    print(f"   mission: carrier {t['carrier']} -> mission {t['mission']}, arrives in {secs}s", flush=True)
    return [(205, pb.ld(1, travel_msg(t))), (103, planet_details())]


# moved to gofa_core/rules/ruleset.py: SHIP_CLASS, HARVEST, DEEP_TYPES, mission_yield

# Mission type -> loca suffix of DESC_MISSION_SUCCESS_* / DESC_MISSION_FAILURE_* (type enum: caption switch 0x100355e5c)
MISSION_LOCA = {1: "QUICK_HARVEST_METAL", 2: "QUICK_HARVEST_GAS", 3: "QUICK_HARVEST_CRYSTAL", 4: "DEEP_HARVEST_METAL",
                5: "DEEP_HARVEST_GAS", 6: "DEEP_HARVEST_CRYSTAL", 7: "DEEP_ANOMALY", 8: "DEEP_NPC_OUTPOST",
                9: "DEEP_SHIP_WRECK", 10: "QUICK_PIRATE_FIGHTERS", 11: "QUICK_PIRATE_BOMBERS", 12: "QUICK_PIRATE_INTERCEPTORS",
                13: "QUICK_PIRATE_HIDEOUT", 14: "QUICK_MERCHANT_UNDERATTACK", 15: "QUICK_ANOMALY_COMBAT", 16: "QUICK_ANOMALY",
                17: "QUICK_WRECK_LOOTING", 18: "QUICK_UNKNOWN_SHIPWRECK", 19: "DEEP_RESCUE", 20: "DEEP_NPC_OUTPOST_SMALL",
                21: "DEEP_NPC_OUTPOST_BIG", 22: "DEEP_NPC_OUTPOST_ELITE"}
REPORTS = list(globals().get("_reports", []))   # mission results, for a later reports/mail feature


# moved to gofa_core/rules/ruleset.py: ships_after, fleet_cargo, SHARPSHOOTER_SKILL, SHARPSHOOTER_PERCENT

def sharpshooter():
    """Strength factor of the current player's accuracy skill (strength goes with the square root of the hit rate)."""
    return (1 + SHARPSHOOTER_PERCENT * globals().get("SKILLS", {}).get(SHARPSHOOTER_SKILL, 0) / 100) ** 0.5


# moved to gofa_core/rules/ruleset.py: pd_shield, pd_raid_protection, SHIP_DEF_STEP

def defence_bonus(pd_level):
    """Toughness bonus of ships defending their owner's planet (call with the defender's TECHS active): Planetary Defence
    ("increases the shields of all ships stationed at this planet") x Ship Defence ("the defense bonus on this planet, including
    all defending carriers"). 2026-11-09: battle reports show defenders at home ~3x stronger than our old model (19 Mar 2015,
    5 Oct 2019); PD 20 + Ship Defence 20 + blue carriers gives about that. Returned as the extra share (0 = none)."""
    return (1 + pd_shield(min(pd_level, 20))) * (1 + SHIP_DEF_STEP * TECHS.get(30, 0)) - 1


def fleet_strength(ships, enemy, own=False, carrier=None, shield=0.0):
    """Sum of damage+shield+hp/4 per ship, x1.5 for ships whose class counters most of the enemy's ships; the player's
    fleet (own=True) gets +5% per SHIP DEFENCE tech level (30, placeholder). A red / blue carrier (artifact upgrade)
    adds its bonus to the damage and accuracy of fighters + bombers / the shield + hp of fighters + interceptors (game texts
    DESC_INVENTORY_ITEM_ARTIFACT_RED / _BLUE)."""
    red, blue = (carrier_bonus(carrier["type"], carrier.get("level", 1), c) / 100 for c in (1, 2)) if carrier else (0, 0)
    return _fleet_strength(ships, enemy, red, blue, shield) * (sharpshooter() if own else 1)


# moved to gofa_core/rules/ruleset.py: _fleet_strength

ENDED_TRAVELS = []
PENDING_XP = []
XP_BOX = [globals().get("_xp", 0)]   # commander experience (persisted as "xp")
BATTLE_XP_BOX = [0]   # XP from fights (persisted as "battle_xp"; ALLIANCE WARFARE board = sum over members)


def battle_xp(n):
    XP_BOX[0] += n
    BATTLE_XP_BOX[0] += n


# moved to gofa_core/rules/ruleset.py: kill_xp, MAX_LEVEL, level_cost, LEVEL_TOTALS, (table fill), RANK_LEVELS, level_threshold,
#     limit_steps, carrier_limit, SHIP_ANCHORS, ship_limit, SHIP_LIMIT_ORIGINAL, commander_limits, player_level, skill_points_at,
#     skill_cost

def skill_points():
    """skill_points_at(commander level), minus what the learned skill levels cost (skill_cost)."""
    spent = sum(skill_cost(n) for lv in SKILLS.values() for n in range(1, lv + 1))
    return max(0, skill_points_at(player_level(XP_BOX[0])) - spent + SKILL_BONUS[0])


SKILL_BONUS = [0]   # debug-only extra skill points (/debug/setlevel?skill=..&points=N)


def handle_119(req):
    """Commander (requested at login, also pushed after missions / skills): {1 AVAILABLE SKILL POINTS*, 2 xp*}.
    The level is derived by the client from the XP and statics section 26 (confirmed 2026-10-15 with marker 5)."""
    return pb.v(1, skill_points()) + pb.v(2, XP_BOX[0])


CMD_EXTRA = {}   # experiment: extra commander fields (set via /debug/xp?f5=..&f6=..)
SKILLS = dict(globals().get("_skills", {}))   # commander skill -> learned level (persisted as "skills")


def commander_msg():
    """Commander record 0x100c64c50: {1 id*, 2 name*, 3 int* (unknown, 0 as the old auto reply), 4 {1 [{1 skill*,
    2 level*}]} learned skills, 5, 6}."""
    skills = b"".join(pb.ld(1, pb.v(1, k) + pb.v(2, v)) for k, v in sorted(SKILLS.items()))
    extra = b"".join(pb.v(k, v) for k, v in CMD_EXTRA.items() if k in (5, 6))   # experiment hook (fields 5/6 unknown)
    return pb.v(1, PLAYER_ID) + pb.ld(2, PLAYER["alias"]) + pb.v(3, 0) + pb.ld(4, skills) + extra


def handle_114(req):
    """Commander (login): {1 commander record}."""
    return pb.ld(1, commander_msg())


def handle_212(req):
    """Learn a skill level: {1 skill*, 2 level*}. No 212 response type exists: answer with a 114 commander push.
    The client checks the skill-point cost itself (statics 4 level field 10)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    settle_resources()   # production so far at the old rate (specialist skills change it)
    SKILLS[f.get(1, 0)] = f.get(2, 0)
    save_state()
    print(f"   skill {f.get(1)} -> level {f.get(2)} (skills {SKILLS})", flush=True)
    return [(114, handle_114(b"")), (119, handle_119(b"")), (103, planet_details())]


# moved to gofa_core/rules/ruleset.py: MISSION_BATTLE_XP, MISSION_PLAIN_XP, MISSION_RES, MISSION_RES_TYPE, mission_xp, MISSION_DROPS,
#     MISSION_CREDITS, _R, _S, _H, _O, MISSION_DROP_TABLE, ITEM_NAMES, BLUEPRINT_WEIGHTS, BLUEPRINT_MK3_LEVEL, BLUEPRINT_NAMES,
#     mission_credits, drop_chance

def resolve_missions():
    """Carriers whose mission travel has ended fight / harvest, the mission is used up and the carrier is home
    again (missions are in the home system). Returns the list of results (empty if nothing happened)."""
    import random
    now, results = time.time(), []
    for c in CARRIERS:
        t = c.get("travel")
        if not t or t["end"] > now or t.get("done"):
            continue
        m = next((m for m in MISSIONS if m["id"] == t["mission"]), None)
        c.pop("travel", None)
        c["trip_end"] = time.time()   # carrier_msg keeps sending clearing stubs for STUB_GRACE
        # The client's travel list (filled by the 205 reply, never cleared in-session) merges entries by timer id:
        # re-send this travel with carrier 0 so the fleet list stops showing it ("00m 00s").
        ENDED_TRAVELS.append(dict(t, carrier=0, mission=0))
        if not m:
            continue
        ships = {int(k): v for k, v in c.get("ships", {}).items() if v}
        enemy = {int(k): v for k, v in m.get("fleet", {}).items()}
        res = {"mission": m["id"], "type": m["type"], "carrier": c["id"], "time": now, "before": dict(ships),
               "enemy": enemy, "reward": {}}
        if enemy:
            mine, theirs = fleet_strength(ships, enemy, own=True, carrier=c), fleet_strength(enemy, ships)
            res["won"] = mine > theirs * random.uniform(0.8, 1.2)
            loss = min(1.0, theirs / mine) * 0.5 if res["won"] and mine else 1.0
            c["ships"] = ships_after(ships, loss)
            if res["won"]:
                rt, amt = mission_yield(m["type"], m.get("level", 1))
                res["available"] = amt
                res["reward"] = {rt: min(amt, fleet_cargo(c.get("ships", {})))}
        else:
            res["won"] = True
            rt, amt = mission_yield(m["type"], m.get("level", 1))
            res["available"] = amt
            res["reward"] = {rt: min(amt, fleet_cargo(ships))}
        if res["won"] and mission_credits(m["type"], m.get("level", 1)):
            res["reward"]["credits"] = mission_credits(m["type"], m.get("level", 1))
        dest = m.get("planet", HOME_PLANET)
        with on_planet(dest if dest in own_planets() else HOME_PLANET):   # rewards land on the mission's planet
            settle_resources()
            for k, v in res["reward"].items():
                if k == "credits":
                    CREDITS_BOX[0] += v
                else:
                    r = resource(k)
                    r["amount"] = min(capacity(), r["amount"] + v)
        if res["won"] and random.random() < drop_chance(m["type"], m.get("level", 1), 0):   # artifact (red / yellow / blue)
            item = random.choice((10, 11, 12))
            INVENTORY[item] = INVENTORY.get(item, 0) + 1
            res["items"] = {item: 1}
            add_mail(kind=1, body=f"Mission {m['id']}: our fleet found an artifact ({ITEM_NAMES[item]}). It is in the "
                                  f"commander's ITEMS tab.")
        if res["won"] and random.random() < drop_chance(m["type"], m.get("level", 1), 1):   # blueprint (consumed by its research)
            pool = {t: w for t, w in BLUEPRINT_WEIGHTS.items() if t != 5 or m.get("level", 1) >= BLUEPRINT_MK3_LEVEL}
            item = random.choices(list(pool), weights=list(pool.values()))[0]
            INVENTORY[item] = INVENTORY.get(item, 0) + 1
            res["items"] = {**res.get("items", {}), item: 1}
            add_mail(kind=1, body=f"Mission {m['id']}: our fleet recovered a blueprint ({BLUEPRINT_NAMES[item]}). It is "
                                  f"in the commander's ITEMS tab.")
        res["after"] = {int(k): v for k, v in c.get("ships", {}).items()}
        xp, bx = mission_xp(res["won"], m.get("level", 1), bool(enemy), m["type"])
        res["xp"] = xp * xp_mult()
        XP_BOX[0] += res["xp"]
        BATTLE_XP_BOX[0] += bx * xp_mult()   # battle part also counts for ALLIANCE WARFARE
        MISSIONS.remove(m)
        REPORTS.append({k: (v if not isinstance(v, dict) else {str(a): b for a, b in v.items()}) for k, v in res.items()})
        results.append(res)
        # Mission report (kind 4, "Scanning Array"): details variant 4 with the mission result; location = home planet.
        key = f"DESC_MISSION_{'SUCCESS' if res['won'] else 'FAILURE'}_{MISSION_LOCA.get(m['type'], '')}"
        add_mail(kind=4, body=key, template=key, tkind=2,   # row text = field 7 key (localised); body alone shows raw
                 report={"type": m["type"], "mission": m["id"], "level": m.get("level", 1), "won": res["won"],
                         "reward": {str(k): v for k, v in res["reward"].items()},
                         "available": res.get("available"), "xp": res["xp"],
                         "after": {str(k): v for k, v in res["after"].items()},
                         "items": {str(k): v for k, v in res.get("items", {}).items()}})
        print(f"   mission {m['id']} (type {m['type']}) resolved: {'WON' if res['won'] else 'LOST'}, "
              f"ships {res['before']} -> {res['after']} vs {enemy}, reward {res['reward']}", flush=True)
    if results:
        save_state()
    return results


# ---- Mail (response 104 {1 repeated Message 0x100c668e8}) ----
# Message: 1 id*, 2 sender (player 0x100c6a998), 3 recipients, 4 body text, 5 Timestamp, 6 int32 (folder/kind?),
# 7 {1 int32, 2 string (loca template key?), 3 [{1 key*, 2 value, 3 int32, 4 string}]}, 100 varint32, 101/102 lists.
MAIL = list(globals().get("_mail", []))
# Kind-4 mission reports crash the REPORTS list until their location key (details 4.4, decoded via the map
# radices 0x100d19d60: sector / system-1 / planet-1) is right, so drop them and the debug test mails.
MAIL[:] = [m for m in MAIL if not m.get("body", "").startswith(("Test mail", "Report kind"))]
# Mission report rows show the body as plain text; field 7 {template id 1-4, loca key} is localised (checked
# 2026-10-19 with /debug/rowtest). Older reports stored only the key in the body: give them the template too.
for _m in MAIL:
    if _m.get("body", "").startswith("DESC_MISSION_") and not _m.get("template"):
        _m["template"], _m["tkind"] = _m["body"], 2
MISSION_REPORT_DETAILS = True   # kind-4 details (crashes, see above)
PENDING_MAIL = []   # mail ids to push with the next 281 poll
MISSION_MAIL_KIND = 5   # Message field 6: 1 inbox, 4 mission report (Scanning Array), 5 system report, 6 spy report


def mail_msg(m):
    out = pb.v(1, m["id"])
    if m.get("from"):   # field 2 = sender {1 player id, 2 alias, 3 race}, 3 = recipients (player mail, request 243)
        out += pb.ld(2, pb.v(1, m["from"]["id"]) + pb.ld(2, m["from"]["name"].encode()) + pb.v(3, 1))
        out += b"".join(pb.ld(3, pb.v(1, t["id"]) + pb.ld(2, t["name"].encode()) + pb.v(3, 1)) for t in m.get("to", []))
    out += pb.ld(4, m.get("body", "").encode()) + pb.ld(5, ts(m["time"])) + pb.v(6, m.get("kind", 1))
    if m.get("template"):
        params = b"".join(pb.ld(3, pb.ld(1, k.encode()) + pb.ld(2, str(v).encode())) for k, v in m.get("params", {}).items())
        out += pb.ld(7, pb.v(1, m.get("tkind", 1)) + pb.ld(2, m["template"].encode()) + params)
    return out


TEXT_DETAIL_FIELD = {5: 8}


BATTLE_MAIL_KIND = 3   # mail kind 3 = BATTLES tab (factory 0x100717c90)
BATTLE_RESULT = 1   # 1 win, 2 loss, 3 conquered (row "conq")   # experiments: battle 0x100c63918 field 4
BATTLE_F6 = 1           # details 3 field 6 (int32*)
BATTLE_P5, BATTLE_P8 = 1, 0
BATTLE_V2 = os.environ.get("GOFA_BATTLE_V2", "1") == "1"   # also send details field 13 (the client's own format)
# Carriers stationed at the defended planet in the report (2026-11-12, GOFA_FINDINGS "Battle report carrier lines"): details field 2
# {1 [attacker carriers destroyed], 2 [defender carriers destroyed]} drives the CARRIER outcome line; one battle v2 participant per
# stationed carrier fills the Carrier row; details field 5 {1 n} = marines bombed. GOFA_REPORT_CARRIERS=0 = the old reports.
REPORT_CARRIERS = os.environ.get("GOFA_REPORT_CARRIERS", "1") == "1"


def battle_v2(b, att, dfn, ships):
    """Details field 13 = battle v2 (0x100c63cd8), which the report view really reads: given field 1 the client
    converts it to this (0x100623248) and loses the troops. {1 before {1 att {1 [participant]}, 2 def}, 2 after,
    3 Timestamp, 4 result, 5 [player {1 id, 2 name, 3 race}], 6 [alliance {1 id, 2 name, 3 tag}], 7 [carrier]}.
    Participant v2 (0x100c63b70) = {1 player id, 2 ships, 4 alliance id, 5, 6 carrier id, 7 {..}, 8}.
    Troops row BEFORE (0x100391208 -> 0x100390d58) = sum of resource type 4 in the side's carriers' cargo
    (carrier field 8) + for the defender the planet's resources (details field 7 planet, field 9)."""
    a, d, a2, d2 = ships
    ab, db = (b["ground"][0], b["ground"][1]) if b.get("ground") else (0, 0)
    carrier = _intkeys(b.get("p6") or {}) if att[0] == PLAYER_ID else {}
    if b.get("ground") and not carrier:
        carrier = {1: b.get("carrier_id", 1), 2: 1, 3: 1, 5: HOME_PLANET, 9: 1}
    if carrier and ab:
        carrier[8] = {1: [{1: 4, 2: int(ab)}]}

    def part(who, s):
        out = {1: who[0], 2: {1: [{1: int(t), 2: int(n)} for t, n in s.items() if n]},
               5: b.get("p5a" if who[0] == PLAYER_ID else "p5d", BATTLE_P5), 7: {}, 8: BATTLE_P8}
        if who is att and carrier:
            out[6] = carrier[1]
        return out
    side = lambda x, y: {1: {1: [part(att, x)]}, 2: {1: [part(dfn, y)]}}
    out = {1: side(a, d), 2: side(a2, d2), 3: {1: float(b.get("time", time.time()))}, 4: b.get("result", BATTLE_RESULT),
           5: [{1: p[0], 2: p[1], 3: p[2]} for p in (att, dfn)]}
    carriers = [carrier] if carrier else []
    if REPORT_CARRIERS and b.get("station"):   # one defender participant per stationed carrier (the Carrier row counts them); after: survivors only
        seen = {att[0], dfn[0]}
        for e in b["station"]:
            cp = lambda: {1: e["owner"], 2: {}, 5: b.get("p5d", BATTLE_P5), 6: e["id"], 7: {}, 8: b.get("p8d", BATTLE_P8)}
            out[1][2][1].append(cp())
            if e.get("escaped") is not False:
                out[2][2][1].append(cp())
            carriers.append(station_record(e))
            if e["owner"] not in seen:   # an ally's carrier: the ally appears among the defenders
                seen.add(e["owner"]); out[5].append({1: e["owner"], 2: e.get("name", "?"), 3: e.get("race", 1)})
    if carriers:
        out[7] = carriers
    return out


def station_record(e):
    """Carrier record 0x100c64098 of a stationed carrier in a report: 1 id, 2 type, 3 level, 5 owner, 9 behaviour."""
    return {1: e["id"], 2: e["type"], 3: e.get("level", 1), 5: e["owner"], 9: e.get("behaviour", 1)}


def station_kw(station):
    """{"station": JSON-able copy of the stationed carriers} for a battle mail (the report is built later from the stored mail);
    nothing when REPORT_CARRIERS is off or no carrier was stationed (so the stored mails stay as before)."""
    snap = [{k: e[k] for k in ("owner", "name", "id", "type", "level", "behaviour", "escaped") if k in e} for e in station]
    return {"station": snap} if REPORT_CARRIERS and snap else {}


def battle_details(b):
    """Battle report = mail details variant 3 (0x100c635d0) {1 battle 0x100c63918* {1 before {1 attacker side,
    2 defender side}*, 2 after*, 3 Timestamp*, 4 int32*, 5, 6}, 6 int32*, 8 varint64* (planet?), 14 [rewards]}.
    Side = {1 [participant 0x100c637b0 {1 player*, 2 ships {1 [{1 type, 2 n}]}*, 3 [ship stats], 4 planet?,
    5 varint32*, 6 carrier?, 7 {..}*, 8 varint32*}]}. Field meanings beyond the layout are guesses (experiment)."""
    def player(pid, name, race):
        return {1: pid, 2: name, 3: race}
    def part(who, ships):
        pid, name, race = who
        out = {1: player(pid, name, race), 2: {1: [{1: int(t), 2: int(n)} for t, n in ships.items() if n]},
               5: b.get("p5a" if pid == PLAYER_ID else "p5d", BATTLE_P5), 7: {int(k): v for k, v in b.get("p7", {}).items()},
               8: b.get("p8a" if pid == PLAYER_ID else "p8d", BATTLE_P8)}
        p6 = b.get("p6" if who[0] == PLAYER_ID else "p6d")   # experiment: participant field 6 = carrier 0x100c64098
        if p6:
            out[6] = _intkeys(p6)
        if who[0] == PLAYER_ID and b.get("home_planet"):   # participant field 4 (0x100c63030) looks like an ALLIANCE
            out[4] = {1: b["home_planet"]}                      # record: the name gets an empty tag "Pilot []"; unused
        return out
    me, them = (PLAYER_ID, PLAYER["alias"], 1), (b.get("enemy_id", 900001), b.get("enemy", "Pirates"), 2)
    att, dfn = (me, them) if b.get("attacker", True) else (them, me)
    a, d = (b.get("mine", {}), b.get("theirs", {})) if b.get("attacker", True) else (b.get("theirs", {}), b.get("mine", {}))
    a2, d2 = ((b.get("mine_after", {}), b.get("theirs_after", {})) if b.get("attacker", True)
              else (b.get("theirs_after", {}), b.get("mine_after", {})))
    side = lambda who, ships: {1: [part(who, ships)]}
    battle = {1: {1: side(att, a), 2: side(dfn, d)}, 2: {1: side(att, a2), 2: side(dfn, d2)},
              3: {1: float(b.get("time", time.time()))}, 4: b.get("result", BATTLE_RESULT)}
    battle.update({int(k): v for k, v in b.get("bf", {}).items()})
    top = {1: battle, 6: BATTLE_F6, 8: b.get("planet", HOME_PLANET)}
    if b.get("ground"):   # ground battle 0x100c63e40 {1 before {1 [att {player, marines}], 2 [def]}, 2 after, 3 time, 4 int}
        ab, db, aa, da = b["ground"]
        gside = lambda an, dn: {1: [{1: player(*att), 2: an}], 2: [{1: player(*dfn), 2: dn}]}
        top[3] = {1: gside(ab, db), 2: gside(aa, da), 3: {1: float(b.get("time", time.time()))},
                  4: b.get("gresult", BATTLE_RESULT)}
        top[3].update(_intkeys(b.get("gtop", {})))   # experiment hook (debug/battlemail extra={"gtop": {...}})
    if BATTLE_V2:
        top[13] = battle_v2(b, att, dfn, (a, d, a2, d2))
        if b.get("ground") and b["ground"][1]:   # defender troops BEFORE = planet (field 7) resource type 4
            top[7] = {1: b.get("planet", HOME_PLANET), 9: {1: [{1: 4, 2: int(b["ground"][1])}]}}
    if REPORT_CARRIERS:
        dead = [station_record(e) for e in b.get("station") or [] if e.get("escaped") is False]
        if dead:   # details field 2: list 2 = the defender's carriers destroyed (failed CARRIER ESCAPE); list 1 (attacker's) stays empty
            top[2] = {2: dead}
        top.update(_intkeys(b.get("top", {})))   # field 5 {1 marines bombed}: inner keys must be ints too (a str key was dropped)
    else:
        top.update({int(k): v for k, v in b.get("top", {}).items()})
    return schema.build("0x100c635d0", top)


def _intkeys(d):
    return {int(k): _intkeys(v) for k, v in d.items()} if isinstance(d, dict) else d


def _qs(path):
    import urllib.parse
    return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(path).query))


def _q(path, key, default=None):
    return _qs(path).get(key, default)


def q_player(path):
    v = _qs(path).get("player")
    return int(v, 16) if v else None


def _reply(h, body=b"ok"):
    """200 text reply for the /debug/* endpoints (h = the request handler; a module function because serve.py
    calls Handler._do_GET with its own handler object as self)."""
    h.send_response(200); h.send_header("Content-Length", str(len(body))); h.end_headers(); h.wfile.write(body)


def mail_details(m):
    """Message details 0x100c66e10 (response 105): one of 10 kinds; 1 = {1 text}, 4 = mission report
    {1 mission type*, 2 result 0x100c679c8* {1 resources [{1 type, 2 amount}], 3 {1 credits}, 4 xp,
    5 ships [{1 type, 2 count}], 7 item, 8 items}, 3 level, 4 location (planet id)}."""
    r = m.get("report")
    if m.get("battle"):
        return pb.ld(3, battle_details({"time": m.get("time"), **m["battle"]}))   # older mails: no battle time
    if m.get("spy"):   # espionage report = details variant 6 (0x100c68fd0): {1 id*, 2 spy player*, 3 target player,
        sp = m["spy"]  # 4 int32*, 5 resources {1 [resource]}, 6 ships {1 [{1 type, 2 count}]}, 7 structures}
        sy = sp.get("spier")   # the spied player's copy names the spy (empty when the detection was anonymous)
        me = (pb.v(1, sy["id"]) + pb.ld(2, sy["alias"]) if sy else pb.v(1, PLAYER_ID) + pb.ld(2, PLAYER["alias"])) + pb.v(3, 1)
        tgt = pb.v(1, sp.get("owner", 0)) + pb.ld(2, sp.get("name", "")) + pb.v(3, 2)
        seen = ({int(t): n for t, n in sp["res"].items()} if "res" in sp   # "res" = only what the drones found
                else {1: sp.get("stock", 0), 2: sp.get("stock", 0), 3: sp.get("stock", 0), 4: sp.get("troops", 0)})
        res = b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, n) + pb.v(3, 0) + pb.v(4, n) + pb.ld(5, ts(time.time())))
                       for t, n in sorted(seen.items()))
        ships = b"".join(pb.ld(1, pb.v(1, int(t)) + pb.v(2, int(n))) for t, n in sp.get("fleet", {}).items() if n)
        seen_st = b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, i) + pb.v(3, n) + pb.v(4, i + 1)) for i, (t, n) in enumerate(sp.get("structures", [])))
        return pb.ld(6, pb.ld(1, pb.v(1, sp.get("planet", HOME_PLANET)) + pb.ld(2, me) + pb.ld(3, tgt) + pb.v(4, sp.get("f4", SPY_F4[0])) + pb.ld(5, res)
                               + pb.ld(6, ships) + (pb.ld(7, seen_st) if seen_st else b"")))
    if m.get("dv") == 9:   # template details {1 int32, 2 loca key, 3 [{1 key, 2 value}]}
        params = b"".join(pb.ld(3, pb.ld(1, k.encode()) + pb.ld(2, str(v).encode())) for k, v in m.get("params", {}).items())
        return pb.ld(9, pb.v(1, 1) + pb.ld(2, m.get("template", "").encode()) + params)
    if m.get("dv") == 5:
        return pb.ld(5, pb.v(1, HOME_PLANET) + pb.v(2, 1) + pb.v(3, 1))
    if m.get("dv"):
        return pb.ld(m["dv"], pb.ld(1, m.get("body", "").encode()))
    if not r or not (MISSION_REPORT_DETAILS or m.get("force4")):
        # text details: variant 1 for inbox mail; system reports (kind 5) did not load with it, try variant 8
        return pb.ld(TEXT_DETAIL_FIELD.get(m.get("kind", 1), 1), pb.ld(1, m.get("body", "").encode()))
    # resource entry {1 type, 2 amount, 3 ?}: with only 2 the viewer said "-149" and "150 Metal was left behind"
    # resource entry {1 type, 2 amount found}: the client works out what the fleet carried from its freighters
    # (result field 5 ships x statics s9 field 9) and reports the rest as "left behind"
    # resource entry {1 type, 2 LEFT BEHIND (>= 1 shows INFO_MISSION_RESOURCES_LEFT, checked in 0x100561608), 3 earned?}
    res = b"".join(pb.ld(1, pb.v(1, int(k)) + pb.v(2, max(0, int(r.get("available") or v) - int(v))) + pb.v(3, int(v)))
                   for k, v in r["reward"].items() if k != "credits")
    result = (pb.ld(1, res) + pb.ld(3, pb.v(1, int(r["reward"].get("credits", 0)))) + pb.v(4, r.get("xp", 0))
              + pb.ld(5, b"".join(pb.ld(1, pb.v(1, int(t)) + pb.v(2, int(n))) for t, n in r["after"].items())))
    if r.get("f7") is not None:   # result field 7 (int32, meaning unknown; debug only)
        result += pb.v(7, int(r["f7"]))
    # result field 8 = repeated {1 item type, 2 amount} (0x100c659e8): items found (artifacts / blueprints)
    result += b"".join(pb.ld(8, pb.v(1, int(t)) + pb.v(2, int(n))) for t, n in r.get("items", {}).items() if n)
    # field 4 is a packed LOCATION (decoded with the map radices, 0x1002722c8), not the mission id: an id there
    # crashed the report screen (index -1)
    return pb.ld(4, pb.v(1, r["type"]) + pb.ld(2, result) + pb.v(3, r.get("level", 1)) + pb.v(4, r.get("loc", HOME_PLANET)))


def handle_117(req):
    """Delete mails (DELETE ALL / delete): request {1 repeated id, 2, 3 flags} -> {4 messages, 5 repeated deleted id}."""
    ids = [v for f, wt, v in pb.fields(req) if f == 1 and wt == 0]
    MAIL[:] = [m for m in MAIL if m["id"] not in ids]
    save_state()
    print(f"   mail deleted: {ids}", flush=True)
    return b"".join(pb.v(5, i) for i in ids)


STUB_UNKNOWN_MAIL = os.environ.get("GOFA_STUB_MAIL", "1") == "1"


def handle_105(req):
    """Mail details: request {1 repeated message id, 2, 3} -> {1 [{1 id*, 2 Message, 3 details}], 2 ids}."""
    ids = [v for f, wt, v in pb.fields(req) if f == 1 and wt == 0]
    out = b""
    for m in MAIL:
        if m["id"] in ids:
            out += pb.ld(1, pb.v(1, m["id"]) + pb.ld(2, mail_msg(m)) + pb.ld(3, mail_details(m)))
    known = {m["id"] for m in MAIL}
    for i in ids:   # ids the client cached but the server no longer has (e.g. 70005, re-asked on every open): stub
        if i not in known and STUB_UNKNOWN_MAIL:
            stub = {"id": i, "time": time.time() - 86400, "kind": 1, "body": "(deleted)"}
            out += pb.ld(1, pb.v(1, i) + pb.ld(2, mail_msg(stub)) + pb.ld(3, pb.ld(1, pb.ld(1, b"(deleted)"))))
            print(f"   105: stub for unknown mail {i}", flush=True)
    out += b"".join(pb.v(2, i) for i in ids)   # field 2 = ids answered (else the viewer sticks on "Loading")
    return out


def handle_244(req):
    """Player name lookup (NEW MESSAGE recipient, sent before 243): {1 name} -> {1 name, 2 player id} (0 = unknown)."""
    name = next((v.decode("utf-8", "replace") for f, wt, v in pb.fields(req) if f == 1 and wt == 2), "")
    a = next((a for a in ACCOUNTS["accounts"] if a["alias"].lower() == name.strip().lower()), None)
    print(f"   244 lookup {name!r} -> {a['player'] if a else 0:X}", flush=True)
    return pb.ld(1, (a["alias"] if a else name).encode()) + pb.v(2, a["player"] if a else 0)


def handle_243(req):
    """Player mail (step 5): {1 string, 2 string, 3 repeated recipient player ids} (layout 0x100c72110; which string
    is subject / body is a guess: both are joined). Each recipient gets a kind-1 mail with the sender record
    (mail field 2); the sender keeps nothing (no SENT tab seen). Unknown ids / NPCs are skipped."""
    strs = [v.decode("utf-8", "replace") for f, wt, v in pb.fields(req) if f in (1, 2) and wt == 2]
    to = [v for f, wt, v in pb.fields(req) if f == 3 and wt == 0]
    me = CUR_PLAYER[0]
    sender = {"id": me, "name": player_info(me)["alias"]}
    known = {a["player"] for a in ACCOUNTS["accounts"]}
    rcpt = [{"id": t, "name": player_info(t)["alias"]} for t in to if t in known]
    body = "\n".join(x for x in strs if x)
    for r in rcpt:
        with as_player(r["id"]):
            add_mail(kind=1, body=body, **{"from": sender, "to": rcpt})
    print(f"   243 mail {sender['name']} -> {[r['name'] for r in rcpt]} (ids {to}): {body!r}", flush=True)
    if not rcpt:
        return [(243, b"")]
    # sender's copy (OUTBOX = mails whose sender is the own player), pushed back as 104 so the compose screen closes
    m = add_mail(kind=1, body=body, read=True, **{"from": sender, "to": rcpt})
    PENDING_MAIL[:] = [i for i in PENDING_MAIL if i != m["id"]]
    return [(243, b""), (104, mail_reply([m["id"]]))]


# Alliance conversations (MESSAGES -> ALLIANCE tab, 2026-11-01). Not mail: threads kept in the alliance dict
# ("threads" [{id, subject, author, created, posts [{id, time, text, author}]}]). 290 (login batch, empty request) = list
# {1 {1 [thread 0x100c6a290 {1 id, 2 type 1-2, 3 subject, 4 enum 1-4, 5/6/7 int, 8 Timestamp, 9 player, 10 id}]}};
# 292 {1 subject, 2 body} = new conversation (reply echoes {2, 3}); 291 {1 thread, 2 int} = posts {1 {1 int,
# 2 {1 [post 0x100c6a3f8 {1 id, 2 Timestamp, 3 {1 text}, 4 player, 5 template}]}, 3 thread}}; 293 {1 thread, 2 text} =
# reply; 296 = one thread record. Field meanings 2/4/5/6/7 and 291 field 1 are guesses (see findings).
THREAD_F2, THREAD_F4 = int(os.environ.get("GOFA_THREAD_F2", "2")), int(os.environ.get("GOFA_THREAD_F4", "1"))


def _threads(a):
    return a.setdefault("threads", [])


def _thread_rec(t):
    last = t["posts"][-1] if t["posts"] else {"time": t["created"], "author": t["author"]}
    return (pb.v(1, t["id"]) + pb.v(2, THREAD_F2) + pb.ld(3, t["subject"].encode()) + pb.v(4, THREAD_F4)
            + pb.v(5, len(t["posts"])) + pb.v(6, 0) + pb.v(7, 0) + pb.ld(8, ts(last["time"])) + pb.ld(9, player_rec(int(last["author"]))))


def _post_rec(po):
    return pb.v(1, po["id"]) + pb.ld(2, ts(po["time"])) + pb.ld(3, pb.ld(1, po["text"].encode())) + pb.ld(4, player_rec(int(po["author"])))


def thread_list_reply(pid):
    a = alliance_of(pid)
    ts_ = sorted(_threads(a), key=lambda t: -(t["posts"][-1]["time"] if t["posts"] else t["created"])) if a else []
    return pb.ld(1, b"".join(pb.ld(1, _thread_rec(t)) for t in ts_))


def handle_290(req):
    return [(290, thread_list_reply(CUR_PLAYER[0]))]


_THREAD_ID = globals().get("_THREAD_ID") or [0]


def _new_id():   # thread / post ids: increasing across players and restarts (JOB_ID is swapped per player)
    _THREAD_ID[0] = max(_THREAD_ID[0] + 1, int(time.time() * 1000) - 1_700_000_000_000)
    return _THREAD_ID[0]


def handle_292(req):
    """New alliance conversation {1 subject, 2 body}. The old auto reply (empty strings) made the client think it was
    posted while nothing was stored. Not in an alliance -> 9292 {1 code, 2 echoed request}."""
    strs = {f: v.decode("utf-8", "replace") for f, wt, v in pb.fields(req) if f in (1, 2) and wt == 2}
    subj, text = strs.get(1, ""), strs.get(2, "")
    me = CUR_PLAYER[0]
    a = alliance_of(me)
    if not a:
        return [(9292, pb.v(1, 1) + pb.ld(2, req))]
    now = time.time()
    t = {"id": _new_id(), "subject": subj, "author": me, "created": now,
         "posts": [{"id": _new_id(), "time": now, "text": text, "author": me}]}
    _threads(a).append(t)
    save_state()
    print(f"   292 new conversation [{a['tag']}] by {player_info(me)['alias']}: {subj!r} / {text!r}", flush=True)
    return [(292, pb.ld(2, subj.encode()) + pb.ld(3, text.encode())), (290, thread_list_reply(me))]


def _find_thread(tid):
    a = alliance_of(CUR_PLAYER[0])
    return a, next((t for t in _threads(a) if t["id"] == tid), None) if a else None


def thread_posts_reply(t, page=0):
    return pb.ld(1, pb.v(1, page) + pb.ld(2, b"".join(pb.ld(1, _post_rec(po)) for po in t["posts"])) + pb.v(3, t["id"]))


def handle_291(req):
    f = {fn: v for fn, wt, v in pb.fields(req) if wt == 0}
    a, t = _find_thread(f.get(1, 0))
    print(f"   291 thread {f.get(1)} page {f.get(2)} -> {len(t['posts']) if t else 'unknown'} posts", flush=True)
    if not t:
        return [(291, pb.ld(1, pb.v(1, f.get(2, 0)) + pb.v(3, f.get(1, 0))))]
    return [(291, thread_posts_reply(t, f.get(2, 0)))]


def handle_293(req):
    """Reply in an alliance conversation {1 thread id, 2 text}; no response type -> empty 293 + pushed 291 / 296 / 290."""
    tid = next((v for fn, wt, v in pb.fields(req) if fn == 1 and wt == 0), 0)
    text = next((v.decode("utf-8", "replace") for fn, wt, v in pb.fields(req) if fn == 2 and wt == 2), "")
    me = CUR_PLAYER[0]
    a, t = _find_thread(tid)
    if not t:
        return [(293, b"")]
    t["posts"].append({"id": _new_id(), "time": time.time(), "text": text, "author": me})
    save_state()
    print(f"   293 reply in [{a['tag']}] {t['subject']!r} by {player_info(me)['alias']}: {text!r}", flush=True)
    return [(293, b""), (291, thread_posts_reply(t)), (296, pb.ld(1, _thread_rec(t))), (290, thread_list_reply(me))]


def handle_294(req):
    """Delete an alliance conversation {1 thread id} (DELETE in the thread view, after the client's confirm popup). The
    author or leader / senior officers (DIPLO_MAX_RANK) may delete; no response type -> empty 294 + pushed 290."""
    tid = next((v for fn, wt, v in pb.fields(req) if fn == 1 and wt == 0), 0)
    me = CUR_PLAYER[0]
    a, t = _find_thread(tid)
    if t and (int(t["author"]) == me or a["members"].get(str(me), ALLIANCE_MEMBER) <= DIPLO_MAX_RANK):
        a["threads"] = [x for x in _threads(a) if x["id"] != tid]
        save_state()
        print(f"   294 deleted conversation [{a['tag']}] {t['subject']!r} by {player_info(me)['alias']}", flush=True)
    return [(294, b""), (290, thread_list_reply(me))]


MAIL_MAX = 300   # stored mails per player (oldest dropped)


def add_mail(**m):
    # unique and increasing even after deletions (the client remembers ids it has seen)
    m.setdefault("id", max([x["id"] for x in MAIL] + [int(time.time()) - 1_700_000_000]) + 1)
    m.setdefault("time", time.time())
    if m.get("battle"):   # battle report: row time = battle time; XP for the enemy ships destroyed (= the report's number)
        m["battle"].setdefault("time", m["time"])
        battle_xp(kill_xp(m["battle"].get("theirs", {}), m["battle"].get("theirs_after", {})))
    MAIL.append(m)
    PENDING_MAIL.append(m["id"])
    if len(MAIL) > MAIL_MAX:   # long play: raids add ~2 mails each, keep the newest MAIL_MAX
        MAIL.sort(key=lambda x: x.get("time", 0))
        drop = {x["id"] for x in MAIL[:len(MAIL) - MAIL_MAX]}
        MAIL[:] = [x for x in MAIL if x["id"] not in drop]
        PENDING_MAIL[:] = [i for i in PENDING_MAIL if i not in drop]
    save_state()
    return m


def mail_reply(ids=None):
    return b"".join(pb.ld(1, mail_msg(m)) for m in MAIL if ids is None or m["id"] in ids)


def handle_204(req):
    """Scan order (Scanning Array, Scan tab): {1 scanner structure id, 2 range 0 = quick / 1 = deep}. No response
    type exists -> answer with a 103 push, as for carriers (202)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    JOB_ID[0] += 1
    now = time.time()
    pid = planet_of_structure(f.get(1, 0))
    rng = 1 if f.get(2, 0) else 0
    with on_planet(pid):
        drones = resource(5)
        if drones["amount"] < SCAN_DRONES[rng]:   # the client refuses this itself
            print(f"   scan: needs {SCAN_DRONES[rng]} drones on {pid} - refused", flush=True)
            JOB_ID[0] -= 1
            return [(9204, pb.v(1, 1) + pb.ld(2, req)), (103, planet_details(pid))]
        drones["amount"] -= SCAN_DRONES[rng]
    job = {"id": JOB_ID[0], "scanner": f.get(1, 0), "range": f.get(2, 0), "planet": pid, "start": now,
           "end": now + SCAN_TIME[rng]}
    SCAN_JOBS.append(job)
    save_state()
    print(f"   scan: {'deep' if job['range'] else 'quick'} by {job['scanner']} on {pid} done in {SCAN_TIME[rng]}s", flush=True)
    return [(103, planet_details(pid))]


# moved to gofa_core/rules/ruleset.py: SHIP_CARGO, SHIP_XP, SHIP_COST, SHIP_STATS, SHIP_DEFS, (table fill), SHIP_YARD, CARRIER_YARD,
#     ACCURACY, accuracy

def handle_201(req):
    """Ship production order: {1 shipyard structure id, 2 {1 ship type, 2 count}} -> {1 {1 timer, 2 {1 type,
    2 count}, 3 shipyard id}} (same shape as planet field 10 entries = the ship production queue). Runs on the
    shipyard's planet."""
    f = {n: v for n, wt, v in pb.fields(req)}
    pid = planet_of_structure(f.get(1, 0))
    ship = {n: v for n, wt, v in pb.fields(f.get(2, b""))}.get(1, 1) if isinstance(f.get(2), bytes) else 1
    if yard_level(f.get(1, 0), 2, pid) < SHIP_YARD.get(ship, 1):   # the client refuses this itself
        print(f"   ships: type {ship} needs Shipyard {SHIP_YARD[ship]} - refused", flush=True)
        return [(9201, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2])), (103, planet_details(pid))]
    if BLUEPRINT_GATING and ship in BLUEPRINT_TECH_OF and TECHS.get(BLUEPRINT_TECH_OF[ship], 0) < 1:
        # the client refuses this itself ("We must fulfill the requirements"); log only (no error reply is known)
        print(f"   WARNING: ship {ship} ordered without blueprint tech {BLUEPRINT_TECH_OF[ship]}", flush=True)
    with on_planet(pid):
        out = _handle_201(f)
    return out[:1] + [(103, planet_details(pid))]


def _handle_201(f):
    o = {n: v for n, wt, v in pb.fields(f[2])}
    JOB_ID[0] += 1
    now = time.time()
    ship, count = o.get(1, 1), o.get(2, 1)
    m, g, c, secs = SHIP_DEFS.get(ship, SHIP_DEFS[1])[:4]
    f33 = 1 - 0.01 * TECHS.get(33, 0)   # SHIP PRODUCTION tech: -1% cost and time per level (wiki)
    m, g, c, secs = species_scaled(CAT_SHIPS, m * f33, g * f33, c * f33, secs * f33, pid=CUR_PLANET[0],
                                   percent=yard_percent(2, yard_level(f.get(1, 0), 2, CUR_PLANET[0])))
    settle_resources()
    cost = (m * count, g * count, c * count)
    if all(r["amount"] >= x for r, x in zip(RESOURCES, cost)):
        for r, x in zip(RESOURCES, cost):
            r["amount"] -= x
    else:
        print(f"   ships: cannot afford {cost} - refused", flush=True)
        JOB_ID[0] -= 1
        return [(9201, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2] if isinstance(f.get(2), bytes) else b"")),
                (103, planet_details())]
    job = {"id": JOB_ID[0], "yard": f.get(1, 0), "ship": ship, "count": count, "start": now,
           "end": now + secs * count}
    SHIP_JOBS.append(job)
    print(f"   ships: {job['count']} x type {job['ship']} at yard {job['yard']} done in {job['end'] - now:.0f}s", flush=True)
    return [(201, pb.ld(1, ship_job_msg(job))), (103, planet_details())]   # 103: as for 200, attaches the timer


CARRIER_JOBS = list(globals().get("_carrier_jobs", []))   # planet field 6 queue
CARRIER_GROUPS = list(globals().get("_carrier_groups", []))   # [{"id", "name"}]: response 109 field 2, requests 329 / 330
CARRIERS = list(globals().get("_carriers", []))           # planet field 5: carriers (fleets) on the home planet


def carrier_job_msg(job):
    timer = (pb.v(1, job["id"]) + pb.ld(2, ts(job["start"])) + pb.ld(3, ts(job["end"])) + pb.ld(4, ts(job["end"]))
             + pb.v(5, 3))   # job kind 3 assumed = carrier production
    return pb.ld(1, timer) + pb.ld(2, pb.v(1, job["carrier"]) + pb.v(2, job["level"]) + pb.v(3, job["count"])) + pb.v(3, job["yard"])


STUB_GRACE = 1800   # seconds after a trip ends that its stub is still sent


def carrier_msg(c):
    """Planet field 5 entry 0x100c64098: 1 id*, 2 carrier type 1-16*, 3 level*, 5 varint64* (home planet?),
    9 state 1-2*, 4 ships aboard [{1 type, 2 count}] (same list type as planet field 11)."""
    ships = b"".join(pb.ld(1, pb.v(1, int(t)) + pb.v(2, int(n))) for t, n in sorted(c.get("ships", {}).items()) if n)
    # field 5 = owner player id (guess; was the planet id: the carrier was counted on the commander screen but not
    # listed under Manage Fleets)
    # Ships aboard = field 4 (parser 0x100052318 -> mutable 0x1000133a0 -> merge 0x100c688c8 out of line);
    # field 16 is a varint64 (the map's "16 = ship list" was an off-by-one).
    # 6/7 = docked / current planet (one of them): with both unset the shipyard counted 0 carriers; set -> 5 (2026-10-10)
    travel = pb.ld(11, travel_msg(c["travel"])) if c.get("travel") and c["travel"]["end"] > time.time() else b""
    mv = c.get("move")
    move = pb.ld(10, movement_msg(c, mv)) if mv and mv["end"] > time.time() else b""
    # The client MERGES carrier updates, so a finished travel / move would stay in its fleet list ("00m 00s").
    # So whenever a carrier is not travelling / moving, send stubs whose carrier id (travel field 3 / movement field 2) is 0:
    # the merge zeroes the ids and the fleet list's lookups by carrier id (0x1002c7aa8 / 0x1002c7a3c) stop matching.
    stub_t = {"id": 0, "start": 0, "end": 0, "mission": 0, "carrier": 0}
    stub = b""
    # Only for a while after a trip ended: the carrier upgrade check (0x1002c9f14, code 5 ERROR_COMMANDSHIP_IS_BUSY)
    # refuses any carrier whose field 10 or 11 is present, stub or not (2026-10-18). A fresh login has no stale trips.
    recent = lambda k: max((c.get(k) or {}).get("end", 0), c.get("trip_end", 0)) > time.time() - STUB_GRACE
    if not travel and recent("travel"):
        stub += pb.ld(11, pb.ld(1, travel_timer(stub_t)) + pb.v(2, 0) + pb.v(3, 0) + pb.v(4, 0))
    if not move and recent("move"):
        stub += pb.ld(10, pb.ld(1, travel_timer(stub_t)) + pb.v(2, 0) + pb.v(3, 1) + pb.v(4, 0))

    at = c.get("at", HOME_PLANET)   # current planet (changes after a RELOCATE FLEET move)
    # 6 = current planet, 7 = home/base planet (guess). 9 = BEHAVIOUR 1 engage / 2 avoid combat (2026-11-12: the same enum
    # validator 0x100006728 as request 254's field 2, and the client's 254 check 0x1002ca480 compares field 9 with the
    # requested behaviour; it was guessed as 1 docked / 2 moving). 16 = carrier group id (329's check 0x1002c15cc reads it).
    return (pb.v(1, c["id"]) + pb.v(2, c["type"]) + pb.v(3, c["level"]) + pb.ld(4, ships) + pb.v(5, HOME_PLANET)
            + (pb.v(6, 0) + pb.v(7, 0) if move else pb.v(6, at) + pb.v(7, at))   # in flight: 0 (the client MERGES
            # updates, so absent fields keep old values); 0x1002c3f44 then
            + pb.v(9, c.get("behaviour", 1)) + move + travel + stub  # takes the location from the movement target)
            + (pb.v(16, c["group"]) if c.get("group") else b""))


def movement_msg(c, mv):
    """Movement 0x100c645c0 (carrier field 10, response 203): {1 timer*, 2 varint64* (carrier), 3 order type
    {1,2,3,6,7}*, 4 target*, 5 origin, 6, 7 fixed64 speed (double), 8}."""
    timer = (pb.v(1, mv["id"]) + pb.ld(2, ts(mv["start"])) + pb.ld(3, ts(mv["end"])) + pb.ld(4, ts(mv["end"]))
             + pb.v(5, MOVE_TIMER_KIND))
    return (pb.ld(1, timer) + pb.v(2, c["id"]) + pb.v(3, mv["order"]) + pb.v(4, mv["target"]) + pb.v(5, mv["origin"])
            + pb.f64(7, struct.unpack("<Q", struct.pack("<d", mv.get("speed", 1.0)))[0]))


# moved to gofa_core/rules/ruleset.py: MOVE_SECONDS

MOVE_TIMER_KIND = 5   # timer kind enum 1-12 (guess)


# moved to gofa_core/rules/ruleset.py: MOVE_BASE_SECONDS, MOVE_SECONDS_PER_UNIT, JUMPGATE_SECONDS

POS_CACHE = {}


def planet_pos(pid):
    """Galaxy position (x, y) of a planet's system from the bundled map; None for the home instance (sector 0_0)."""
    x, y = pid // 10**11, (pid // 10**7) % 10**4
    if x == 0 and y == 0:
        return None
    sid = pid - (pid // 100 % 10) * 100   # planet ...SSSSP01 -> system ...SSSS001
    if sid not in POS_CACHE:
        POS_CACHE[sid] = None
        try:
            d = open(os.path.join(here, "..", "data", "map_x", f"{x}_{y}"), "rb").read()
            for f, wt, v in pb.fields(d):
                if f != 3 or wt != 2:
                    continue
                for f2, wt2, v2 in pb.fields(v):
                    sysf = {a: b for a, w, b in pb.fields(v2)} if f2 == 1 and wt2 == 2 else {}
                    if sysf.get(1) == sid and isinstance(sysf.get(5), bytes):
                        pos = {a: b for a, w, b in pb.fields(sysf[5])}
                        dbl = lambda b: struct.unpack("<d", b if isinstance(b, bytes) else struct.pack("<Q", b))[0]
                        POS_CACHE[sid] = (dbl(pos[1]), dbl(pos[2]))
        except OSError:
            pass
    return POS_CACHE[sid]


# moved to gofa_core/rules/ruleset.py: NAV_SKILL, NAV_PERCENT, sec2, HQ_TRAVEL_STEP, HQ_TRAVEL_MIN, hq_travel_percent

def hq_percent(pid):
    """Travel time percent from the origin planet's HQ (client 0x1002cdda0: the HQ's level -> statics s11 (1, level)
    field 6; no HQ or an HQ being upgraded -> 100)."""
    try:
        if int(pid) == CUR_PLANET[0]:
            structs, builds = STRUCTURES, BUILDS
        else:
            st = PLANET_STATE.get(str(int(pid))) or {}
            structs = {int(k): v for k, v in st.get("structures", {"0": {"type": 1, "slot": 0, "level": 1}}).items()}
            builds = st.get("builds", [])
        busy = {b.get("slot") for b in builds}
        for slot, sdef in structs.items():
            if sdef.get("type") == 1 and slot not in busy:
                return hq_travel_percent(sdef.get("level", 1))
    except Exception:
        pass
    return 100


def travel_distance(src, dst):
    """The client's distance (0x1004094e4 / 0x100409674): same planet 0, same system s2.f19, other systems
    Euclidean system distance + 2 x s2.f19; the home instance (sector 0_0) counts as the jumpgate planet."""
    gate = JUMPGATE.get("planet")
    a, b = planet_pos(src), planet_pos(dst)
    if a is None and b is None:   # both in the home system
        return 0.0 if src == dst else sec2(19)
    if a is None or b is None:
        src, dst = (gate, dst) if a is None else (src, gate)
        if src is None or dst is None:
            return None
        a, b = planet_pos(src), planet_pos(dst)
        if a is None or b is None:
            return None
    if src == dst:
        return 0.0
    if src // 1000 == dst // 1000:   # same system (ids ...SSSSPnn)
        return sec2(19)
    return math.hypot(a[0] - b[0], a[1] - b[1]) + 2 * sec2(19)


def travel_seconds(src, dst, speed=1.0, mission=False, carrier=None):
    """(mission=True: the missions panel ETA = rounded time + 1 s, e.g. 1 s on the own planet.) Client travel formula (0x1004091a4, decoded 2026-10-16): 36 x HQ% / (s2.f18 x carrier f11 %) x
    (sqrt(2 a min(D, a)) + max(D - a, 0)) x (1 - navigation%) [x s2.f59 inside the home system] x speed,
    a = carrier level field 16 (acceleration distance), D = travel_distance. Matches the ETA the client shows."""
    d = travel_distance(src, dst)
    if d is None:
        return MOVE_SECONDS
    a = CARRIER_F16
    f11 = carrier_field(carrier["type"], carrier.get("level", 1), 11) if carrier else CARRIER_F11
    t = 36.0 * hq_percent(src) / (sec2(18) * f11) * (math.sqrt(2 * a * min(d, a)) + max(d - a, 0.0))
    t *= 1 - NAV_PERCENT * SKILLS.get(NAV_SKILL, 0) / 100
    if planet_pos(src) is None and planet_pos(dst) is None:
        t *= sec2(59)
    t *= min(max(speed or 1.0, 1.0), 1e6)
    return int(t + 0.5) + 1 if mission else max(1, int(t + 0.5))


def handle_203(req):
    """Move carrier (planet menu -> RELOCATE FLEET): {1 carrier*, 2 order type*, 3 target planet*, 5 fixed64 speed*,
    6, 7} -> {1 movement*}. The carrier arrives after MOVE_SECONDS."""
    f = {n: v for n, wt, v in pb.fields(req)}
    c = next((c for c in CARRIERS if c["id"] == f.get(1)), None)
    if not c:
        return None
    JOB_ID[0] += 1
    now = time.time()
    speed = struct.unpack("<d", struct.pack("<Q", f.get(5, 0)))[0] if f.get(5) else 1.0
    c["move"] = {"id": JOB_ID[0], "order": f.get(2, 1), "target": f.get(3, HOME_PLANET), "origin": c.get("at", HOME_PLANET),
                 "start": now, "end": now + travel_seconds(c.get("at", HOME_PLANET), f.get(3, HOME_PLANET), speed, carrier=c),
                 "speed": speed}
    save_state()
    print(f"   move: carrier {c['id']} order {f.get(2)} -> {f.get(3)}, {c['move']['end'] - now:.0f}s, req {f}", flush=True)
    return [(203, pb.ld(1, movement_msg(c, c["move"]))), (103, planet_details())]


# moved to gofa_core/rules/ruleset.py: ORDER_ATTACK, ORDER_RELOCATE, ORDER_DELIVER

SHIP_NAMES = {1: "Fighter Mk I", 2: "Fighter Mk II", 3: "Interceptor Mk I", 4: "Interceptor Mk II", 5: "Bomber Mk I",
              6: "Bomber Mk II", 8: "Freighter Mk I", 9: "Freighter Mk II"}
RES_NAMES = {1: "metal", 2: "gas", 3: "crystal", 4: "troops", 5: "spy drones"}


def fmt_ships(ships):
    items = [f"{n} {SHIP_NAMES.get(int(t), t)}" for t, n in sorted(ships.items(), key=lambda kv: int(kv[0])) if n]
    return ", ".join(items) or "none"


# Home-system NPC (2026-11-04): in every video the third home planet belongs to "Terran Outlaws" (HQ 4, tutorial battle: 3 fighters,
# 2 interceptors, 1 bomber; about 13k of each resource). Private to each player like the rest of the home system, saved in the
# player's save; winning the ground battle gives the planet with its buildings.
HOME_NPC = {int(k): v for k, v in (globals().get("_home_npc") or {}).items()}
OUTLAW_STRUCTURES = ((1, 4), (3, 3), (4, 3), (5, 3))
OUTLAW_SPECIES = {1: "Terran", 2: "Vossk", 3: "Nivelian"}   # each home system has its own species' Outlaws (2019: Nivelian Outlaws on Ninarah3)


def home_outlaws():
    """The current player's Outlaws (once), on the home system's third planet if the map has one."""
    pid = HOME_PLANET + 200
    if pid in own_planets() or not map_planet_field(pid, 3):
        return {}
    race = race_of(CUR_PLAYER[0])
    return {pid: {"id": 900001, "name": f"{OUTLAW_SPECIES.get(race, 'Terran')} Outlaws", "race": race, "f2": 2,
                  "fleet": {"1": 3, "3": 2, "5": 1}, "troops": 15, "stock": 13000}}


def npc_at(pid):
    """The NPC owning planet pid: a pirate base (world) or the player's home-system Outlaws."""
    return NPC_PLANETS.get(pid) or HOME_NPC.get(pid)


# moved to gofa_core/rules/ruleset.py: ROUND_MAX, ROUND_WIPE, ROUND_LOSS, ROUND_CLOSE

def attack_npc(c, target, rnd=ROUND_MAX):
    """A fleet attacked an NPC planet: space battle against its defence fleet; a win raids resources (up to the
    fleet's cargo) and, with more troops aboard than the planet's garrison, conquers it (it becomes a colony)."""
    import random
    log_battle(target)
    npc = npc_at(target)
    if not npc.get("fleet") and npc.get("base_fleet") and time.time() - npc.get("defeated", 0) > NPC_REGEN_SECONDS:
        npc["fleet"] = dict(npc["base_fleet"])
    ships = {int(k): v for k, v in c.get("ships", {}).items() if v}
    enemy = {int(k): v for k, v in npc.get("fleet", {}).items() if v}
    mine, theirs = fleet_strength(ships, enemy, own=True, carrier=c), fleet_strength(enemy, ships)
    if battle_goes_on(mine, theirs, rnd):
        lost, hit = round_losses(mine, theirs)
        c["ships"] = ships_after(ships, lost)
        npc["fleet"] = {str(t): n - round(n * hit) for t, n in enemy.items()}
        add_mail(kind=BATTLE_MAIL_KIND, body="The battle continues", battle={
            "planet": target, "enemy": npc["name"], "enemy_id": npc.get("id", 900001), "attacker": True, "mine": ships, "theirs": enemy,
            "mine_after": {int(k): v for k, v in c["ships"].items()}, "theirs_after": {int(k): v for k, v in npc["fleet"].items()},
            "result": RESULT_ONGOING})
        save_state()
        print(f"   battle round {rnd} at {target}: {mine:.0f} v {theirs:.0f}, continues", flush=True)
        return True
    won = mine > 0 and mine > theirs * random.uniform(0.8, 1.2)
    loss = (min(1.0, theirs / mine) * 0.5 if mine else 1.0) if won else 1.0
    c["ships"] = ships_after(ships, loss)
    troops_sent = sum(int(v) for k, v in c.get("cargo", {}).items() if int(k) == 4)
    garrison0 = npc.get("troops", 0)
    lines = [f"Battle at {npc['name']}'s planet: {'VICTORY' if won else 'DEFEAT'}.",
             f"Your fleet: {fmt_ships(ships)} -> {fmt_ships(c['ships'])}.",
             f"Enemy fleet: {fmt_ships(enemy)}{' (destroyed)' if won else ''}."]
    if won:
        npc.setdefault("base_fleet", dict(npc.get("fleet", {})))
        npc["fleet"] = {}
        npc["defeated"] = time.time()
        cap = fleet_cargo({int(k): v for k, v in c["ships"].items()})
        loot = {t: min(npc.get("stock", 500), cap // 3) for t in (1, 2, 3)}
        cargo = {int(k): v for k, v in c.get("cargo", {}).items()}
        for t, n in loot.items():
            cargo[t] = cargo.get(t, 0) + n
        troops, garrison = cargo.get(4, 0), npc.get("troops", 0)
        bombed = bombed_troops(ships, garrison)
        if bombed:
            garrison -= bombed
            garrison0 = garrison
            npc["troops"] = garrison
            lines.append(f"Our bombers killed {bombed} troops before the landing.")
        if troops > garrison and not planet_room():
            troops_sent = 0   # no ground battle: no ground section in the report
            lines.append(f"No landing: {limit_text()}. The troops stayed aboard.")
        elif troops > garrison:
            cargo[4] = troops - garrison
            NPC_PLANETS.pop(target, None)
            HOME_NPC.pop(target, None)
            COLONIES.append(target)
            if system_of(target) == HOME_SYSTEM:   # the Outlaws' base stays standing, with what the raid left
                with on_planet(target):
                    STRUCTURES.clear()
                    STRUCTURES.update({i: {"type": t, "slot": i, "level": n} for i, (t, n) in enumerate(OUTLAW_STRUCTURES)})
                    for r in RESOURCES:
                        r["amount"] = float(max(0, npc.get("stock", 500) - loot.get(r["type"], 0)))
            else:
                OWNERS[target] = CUR_PLAYER[0]
            lines.append(f"Ground battle won ({troops} troops vs {garrison}): the planet is now ours!")
        elif troops:
            cargo[4] = 0
            npc["troops"] = garrison - troops
            lines.append(f"Ground battle lost ({troops} troops vs {garrison}).")
        c["cargo"] = {str(t): n for t, n in cargo.items() if n}
        ach_add(A_RAID, sum(loot.values()))
        lines.append(f"Raided: {', '.join(f'{n} {RES_NAMES[t]}' for t, n in loot.items())} (aboard the carrier - deliver it home).")
        TUT_FLAGS.add("battle")
    conquered = won and npc_at(target) is None
    bombed = locals().get("bombed", 0)
    ground = None
    if won and troops_sent:
        ground = (troops_sent, garrison0, max(0, troops_sent - garrison0), max(0, garrison0 - troops_sent))
    add_mail(kind=BATTLE_MAIL_KIND, body=lines[0], battle={
        "planet": target, "enemy": npc["name"], "enemy_id": npc.get("id", 900001), "attacker": True,
        "mine": ships, "theirs": enemy, "mine_after": {int(k): v for k, v in c["ships"].items()},
        "theirs_after": {} if won else enemy, "result": 3 if conquered else 1 if won else 2, "ground": ground,
        "gresult": 1 if conquered else 2, "top": {"5": {"1": bombed}} if bombed else {},
        # participant field 6 = the attacking carrier: fills the report's Carrier row (1 before / 1 after)
        "p6": {"1": c["id"], "2": c["type"], "3": c["level"], "5": HOME_PLANET, "9": 1} if won else None})
    if len(lines) > 3:   # loot / ground battle details: the battle report has no resource section
        add_mail(kind=1, body="\n".join([lines[0]] + lines[3:]))
    save_state()
    print("   battle: " + " / ".join(lines), flush=True)


# ---- Carriers in a planet battle (owner-approved 2026-11-12, docs/FORUM_NOTES.md "Discord answers on carriers in battles") ----
# The carriers stationed at an attacked planet (no movement / mission trip running) fight for its owner: the ships aboard carriers set to
# ENGAGE (behaviour 1) join the ship battle and take the planet's loss share; carriers set to AVOID COMBAT (2) and their ships sit it out.
# The carriers themselves only face the CARRIER ESCAPE, which happens only when the attacker wins (escape_chance in the ruleset): a failed
# roll destroys the carrier with everything aboard. Allies' carriers stationed at the planet fight in the same battle (the server lets any
# carrier park on any planet: handle_203 / finish_moves set "at" unchecked). Station entries are plain dicts so they survive player swaps.

def add_ships(*fleets):
    """Sum of ship dicts ({type: n}), zero entries kept (the first fleet's order first)."""
    out = {}
    for fl in fleets:
        for t, n in fl.items():
            out[int(t)] = out.get(int(t), 0) + int(n)
    return out


def after_ships(ships, loss):
    """ships_after with int keys: a carrier's ships after losing the share `loss` (freighters stay aboard)."""
    return {int(k): v for k, v in ships_after(ships, loss).items()}


def station_at(planet, owner, allies=True):
    """Carriers stationed at `planet` for its owner: the owner's own and, if allies, the owner's alliance members' (parked there).
    Read-only, but it swaps players (reloads CARRIERS etc.): call it before changing anything or re-look-up carriers afterwards.
    Returns [{owner, id, type, level, behaviour, ships}]."""
    pids = [owner]
    a = alliance_of(owner) if allies else None
    for m in (a["members"] if a else []):
        if int(m) != owner and os.path.exists(player_file(int(m))):
            pids.append(int(m))
    now, out = time.time(), []
    for pid in pids:
        with as_player(pid):
            for x in CARRIERS:
                if x.get("at") == planet and not x.get("move") and not (x.get("travel") or {}).get("end", 0) > now:
                    out.append({"owner": pid, "name": PLAYER.get("alias", "?"), "id": x["id"], "type": x["type"], "level": x.get("level", 1),
                                "behaviour": x.get("behaviour", 1), "ships": {int(k): int(v) for k, v in x.get("ships", {}).items() if v}})
    return out


def refuge_for(owner, planet):
    """Where an avoid-combat carrier of `owner` flees to from `planet` when it is attacked: the nearest outer planet of the owner or of an alliance
    member (not `planet`), else None. Owner's Discord answer (2026-11-12): "if an enemy fleet flew into you they fled to an allied system if possible";
    "allied system" is read as a planet of an alliance member or an own colony (home planets are private copies and do not count)."""
    a = alliance_of(owner)
    pids = [owner] + [int(m) for m in (a["members"] if a else []) if int(m) != owner and os.path.exists(player_file(int(m)))]
    pos, best = planet_pos(planet), None
    for pid in pids:
        with as_player(pid):
            for q in outer_planets():
                if q == planet:
                    continue
                pq = planet_pos(q)
                d = math.hypot(pos[0] - pq[0], pos[1] - pq[1]) if pos and pq else 0
                if best is None or d < best[0]:
                    best = (d, q)
    return best[1] if best else None


def flee_station(station, planet):
    """Avoid-combat carriers (behaviour 2) that have a refuge leave `planet` before the battle as a relocation trip at their own speed (a yellow
    carrier "escapes faster"): they take no part in the ship battle and face no carrier escape. Returns (the carriers that stay, the ones that fled).
    Swaps players: call it right after station_at(), before anything is changed."""
    stay, fled, now = [], [], time.time()
    refuge = {}
    for e in station:
        if e["behaviour"] != 2:
            stay.append(e)
            continue
        r = refuge.setdefault(e["owner"], refuge_for(e["owner"], planet))
        if r is None:
            stay.append(e)
            continue
        with as_player(e["owner"]):
            x = next((y for y in CARRIERS if y["id"] == e["id"]), None)
            if x is None:
                continue
            secs = travel_seconds(planet, r, 1.0, carrier=x)
            JOB_ID[0] += 1
            x["move"] = {"id": JOB_ID[0], "order": ORDER_RELOCATE, "target": r, "origin": planet, "start": now, "end": now + secs, "speed": 1.0}
            add_mail(kind=1, body=f"Our carrier {x['id']} was set to avoid combat: the planet {planet} was attacked and it fled to {r} ({secs} s).")
            PENDING_PLANET_PUSH[:] = [time.time()]
            save_state()
        fled.append(dict(e, refuge=r))
    return stay, fled


def engaged_ships(station, owner=None):
    """Ships on the engaged carriers (behaviour 1) of the station, by type; owner = only that player's carriers."""
    return add_ships(*(e["ships"] for e in station if e["behaviour"] == 1 and (owner is None or e["owner"] == owner)))


def carrier_escape(station):
    """The attacker won: every stationed carrier rolls its escape. Sets e["escaped"] on each entry."""
    import random
    for e in station:
        e["escaped"] = random.random() < escape_chance(e["type"], e["level"], e["behaviour"])


def escape_line(station):
    """Report text of the escape phase ("" while it has not happened or nobody was there)."""
    gone = sum(1 for e in station if e.get("escaped") is False)
    ok = sum(1 for e in station if e.get("escaped"))
    if not (gone or ok):
        return ""
    plural = lambda n: f"{n} carrier{'' if n == 1 else 's'}"
    return "CARRIER ESCAPE: " + (f"all {plural(ok)} escaped" if not gone else f"{ok} escaped, {plural(gone)} destroyed" if ok else f"{plural(gone)} destroyed")


def settle_station(station, loss, conquered=False, text="", skip_mail=None):
    """Apply a finished battle round to the stationed carriers, player by player: engaged carriers' ships take the loss share, carriers
    that failed their escape are removed (ships, troops and cargo lost), escapees of a conquered planet go to their owner's home planet.
    Allies (not skip_mail) get `text` as a mail. Swaps players: re-look-up carriers afterwards."""
    for pid in dict.fromkeys(e["owner"] for e in station):
        with as_player(pid):
            for e in [e for e in station if e["owner"] == pid]:
                x = next((y for y in CARRIERS if y["id"] == e["id"]), None)
                if not x:
                    continue
                if e.get("escaped") is False:
                    CARRIERS.remove(x)
                    continue
                if e["behaviour"] == 1 and loss:
                    x["ships"] = ships_after(e["ships"], loss)
                if conquered and e.get("escaped"):
                    x["at"], x["trip_end"] = HOME_PLANET, time.time()
            if text and pid != skip_mail:
                add_mail(kind=1, body=text)
            if not PENDING_PLANET_PUSH:
                PENDING_PLANET_PUSH[:] = [time.time()]
            save_state()


def attack_player(cid, target, rnd=ROUND_MAX):
    """Step 5 (PvP): carrier cid of the current player attacked another player's planet. The defender's state is
    swapped in (as_player) for its side: stationed ships + planetary defence (as in a pirate raid), resources,
    troops. Win = 30-100 % of the defenders lost, loot up to the cargo capacity; more troops than the garrison
    conquers a colony or the start planet (GOFA_START_CONQUERABLE), within the attacker's planet limit. Both players get a battle report (kind 3) + a text mail.
    Swapping players reloads the globals, so the carrier is looked up by id again after each swap."""
    log_battle(target)
    import random
    me, defender = CUR_PLAYER[0], other_owner(target)
    void = is_void(defender)   # a Void account's planet: its gate planet can be conquered, the fallen planet pays crystals, a conquest gives an artifact
    my_alias = next((a["alias"] for a in ACCOUNTS["accounts"] if a["player"] == me), "Pilot")
    station = station_at(target, defender)   # carriers parked at the planet (swaps players: the attacker's carrier is looked up after)
    station, _fled = flee_station(station, target)   # avoid-combat carriers with a refuge leave before the battle
    carrier_ships, own_carrier_ships = engaged_ships(station), engaged_ships(station, defender)
    c = next(x for x in CARRIERS if x["id"] == cid)
    ships = {int(k): v for k, v in c.get("ships", {}).items() if v}
    troops = sum(int(v) for k, v in c.get("cargo", {}).items() if int(k) == 4)
    tech = sharpshooter()   # the attacker's skill (Ship Defence only helps defenders now); TECHS holds the defender's below
    ground_me = 1 + 0.10 * TECHS.get(31, 0)   # GROUND BATTLE tech, +10 % per level (wiki)
    power, hold, bombed = 0.0, 0.0, 0
    cap = fleet_cargo(ships)
    room, no_room = planet_room(), limit_text()   # attacker's planet limit
    goes_on = False
    with as_player(defender):
        their_alias = player_info(defender)["alias"]
        with on_planet(target):
            settle_resources()
            ships_now()
            planet_def = {t: n for t, n in SHIPS.items() if n}
            defenders = add_ships(planet_def, carrier_ships)   # the planet's ships + the ships on engaging carriers parked there
            dlevel = sum(st["level"] for st in STRUCTURES.values() if st["type"] == 9)
            mine = fleet_strength(ships, defenders, carrier=c) * tech
            theirs = fleet_strength(defenders, ships, own=True, shield=defence_bonus(dlevel)) + PDEF_STRENGTH * dlevel
            goes_on = battle_goes_on(mine, theirs, rnd)
            if goes_on:
                lost, hit = round_losses(mine, theirs)
                for t in list(SHIPS):
                    SHIPS[t] = SHIPS[t] - round(SHIPS[t] * hit)
                planet_after = {t: SHIPS.get(t, 0) for t in planet_def}
                after = add_ships(planet_after, *(after_ships(e["ships"], hit) for e in station if e["behaviour"] == 1))
                own_def = add_ships(planet_def, own_carrier_ships)
                own_after = add_ships(planet_after, *(after_ships(e["ships"], hit) for e in station
                                                      if e["behaviour"] == 1 and e["owner"] == defender))
        if goes_on:
            add_mail(kind=BATTLE_MAIL_KIND, body="The battle continues", battle={
                "planet": target, "enemy": my_alias, "enemy_id": me, "attacker": False, "mine": own_def, "theirs": ships,
                "mine_after": own_after, "theirs_after": ships_after(ships, lost), "result": RESULT_ONGOING, **station_kw(station)})
            PENDING_PLANET_PUSH[:] = [time.time()]
            save_state()
    if goes_on:
        settle_station(station, hit)   # the engaged carriers' ships take the round's loss too
        c = next(x for x in CARRIERS if x["id"] == cid)   # reloaded by the swap
        c["ships"] = ships_after(ships, lost)
        add_mail(kind=BATTLE_MAIL_KIND, body="The battle continues", battle={
            "planet": target, "enemy": their_alias, "enemy_id": defender, "attacker": True, "mine": ships, "theirs": defenders,
            "mine_after": {int(k): v for k, v in c["ships"].items()}, "theirs_after": after, "result": RESULT_ONGOING, **station_kw(station)})
        save_state()
        print(f"   pvp round {rnd} at {target}: {mine:.0f} v {theirs:.0f}, continues", flush=True)
        return True
    with as_player(defender):
        with on_planet(target):
            settle_resources()
            ships_now()
            planet_def = {t: n for t, n in SHIPS.items() if n}
            defenders = add_ships(planet_def, carrier_ships)
            dlevel = sum(st["level"] for st in STRUCTURES.values() if st["type"] == 9)
            mine = fleet_strength(ships, defenders, carrier=c) * tech
            theirs = fleet_strength(defenders, ships, own=True, shield=defence_bonus(dlevel)) + PDEF_STRENGTH * dlevel
            won = mine > 0 and mine > theirs * random.uniform(0.8, 1.2)
            dloss = 1.0 if won else (min(1.0, mine / theirs) * 0.5 if theirs else 0.0)
            for t in list(SHIPS):
                SHIPS[t] = SHIPS[t] - round(SHIPS[t] * dloss)
            planet_after = {t: SHIPS.get(t, 0) for t in planet_def}
            after = add_ships(planet_after, *(after_ships(e["ships"], dloss) for e in station if e["behaviour"] == 1))
            own_def = add_ships(planet_def, own_carrier_ships)
            own_after = add_ships(planet_after, *(after_ships(e["ships"], dloss) for e in station
                                                  if e["behaviour"] == 1 and e["owner"] == defender))
            if won:
                carrier_escape(station)   # only an attacker's win sends the parked carriers into the CARRIER ESCAPE
                if void:
                    VOID_PAYOUT[0] = void_payout(defender, target)   # finish_moves shares it among the attackers by their ships
            loot, garrison = {}, 0
            for r in RESOURCES:
                if r["type"] == 4:
                    garrison = int(r["amount"])
            if won:
                for r in RESOURCES:
                    if r["type"] in (1, 2, 3):
                        n = int(min(r["amount"], cap // 3) * (1 - pd_raid_protection(dlevel)))
                        r["amount"] -= n
                        loot[r["type"]] = n
                bombed = bombed_troops(ships, garrison, TECHS.get(32, 0))   # 32 = BOMBER DEFENCE
                garrison -= bombed
                ground_them = 1 + 0.10 * TECHS.get(31, 0)
                power, hold = troops * ground_me, garrison * ground_them
                for r in RESOURCES:
                    if r["type"] == 4:
                        r["amount"] = max(0, int((hold - power) / ground_them))
        takeable = target in COLONIES or ((START_CONQUERABLE or void) and target == JUMPGATE.get("planet"))
        conquered = won and troops and power > hold and takeable and room
        if conquered:
            lose_planet(target)
        esc = escape_line(station)
        dlines = [f"{my_alias} attacked your planet: {'LOST' if won else 'REPELLED'}.",
                  f"Attacker: {fmt_ships(ships)}. Defenders: {fmt_ships(defenders)}"
                  f"{f', planetary defence level {dlevel}' if dlevel else ''}."]
        if loot:
            dlines.append(f"Stolen: {', '.join(f'{n} {RES_NAMES[t]}' for t, n in loot.items())}.")
        if bombed:
            dlines.append(f"Bombers killed {bombed} troops.")
        if conquered:
            dlines.append(f"{my_alias} conquered the planet ({troops} troops vs {garrison}).")
        if esc:
            dlines.append(esc)
        add_mail(kind=BATTLE_MAIL_KIND, body=dlines[0], battle={
            "planet": target, "enemy": my_alias, "enemy_id": me, "attacker": False,
            "mine": own_def, "theirs": ships, "mine_after": own_after, "theirs_after": {} if not won else ships,
            "result": 1 if won else 2, "top": {"5": {"1": bombed}} if bombed else {}, **station_kw(station)})   # result from the attacker's side (as in pirate raids)
        add_mail(kind=1, body="\n".join(dlines), **{"from": {"id": me, "name": my_alias}})
        PENDING_PLANET_PUSH[:] = [time.time()] + (["planets"] if conquered else [])   # defender's client refreshes resources / ships (+ planet list, jumpgate) on its next poll
        save_state()
    settle_station(station, dloss, conquered, f"{my_alias} attacked {their_alias}'s planet {target}, where your carriers were stationed: "
                   f"{'LOST' if won else 'REPELLED'}." + (f"\n{esc}" if esc else ""), skip_mail=defender)
    c = next(x for x in CARRIERS if x["id"] == cid)   # reloaded by the swap
    loss = (min(1.0, theirs / mine) * 0.5 if mine else 1.0) if won else 1.0
    c["ships"] = ships_after(ships, loss)
    lines = [f"Battle at {their_alias}'s planet: {'VICTORY' if won else 'DEFEAT'}.",
             f"Your fleet: {fmt_ships(ships)} -> {fmt_ships(c['ships'])}.",
             f"Defenders: {fmt_ships(defenders)}{' (destroyed)' if won else ''}."]
    if won:
        cargo = {int(k): v for k, v in c.get("cargo", {}).items()}
        for t, n in loot.items():
            cargo[t] = cargo.get(t, 0) + n
        if bombed:
            lines.append(f"Our bombers killed {bombed} troops before the landing.")
        if troops:
            cargo[4] = max(0, int((power - hold) / ground_me))
            lines.append(f"Ground battle {'won' if power > hold else 'lost'} ({troops} troops vs {garrison})"
                         + (": the planet is now ours!" if conquered else "." if power <= hold else
                            f", but no landing: {no_room}." if not room else " (a start planet can't be conquered)."))
        if conquered:
            COLONIES.append(target)
            OWNERS[target] = me
            if void:   # the planets "had artifacts on them" (Middlingace)
                import random
                item = random.choice(VOID_ARTIFACT_ITEMS)
                INVENTORY[item] = INVENTORY.get(item, 0) + 1
                lines.append(f"The Void planet held an artifact ({ITEM_NAMES[item]}). It is in the commander's ITEMS tab.")
        c["cargo"] = {str(t): n for t, n in cargo.items() if n}
        ach_add(A_RAID, sum(loot.values()))
        lines.append(f"Raided: {', '.join(f'{n} {RES_NAMES[t]}' for t, n in loot.items())} (aboard the carrier - deliver it home).")
        TUT_FLAGS.add("battle")
    if esc:
        lines.append(esc)
    add_mail(kind=BATTLE_MAIL_KIND, body=lines[0], battle={
        "planet": target, "enemy": their_alias, "enemy_id": defender, "attacker": True,
        "mine": ships, "theirs": defenders, "mine_after": {int(k): v for k, v in c["ships"].items()},
        "theirs_after": {t: n for t, n in after.items() if n} if won else after, "result": 3 if conquered else 1 if won else 2,
        "p6": {"1": c["id"], "2": c["type"], "3": c["level"], "5": HOME_PLANET, "9": 1} if won else None,
        "top": {"5": {"1": bombed}} if bombed else {}, **station_kw(station)})
    if len(lines) > 3:
        add_mail(kind=1, body="\n".join([lines[0]] + lines[3:]))
    save_state()
    print(f"   pvp: {my_alias} -> {their_alias} @ {target}: " + " / ".join(lines), flush=True)


# moved to gofa_core/rules/ruleset.py: ORDER_COLONIZE

COLONIES = list(globals().get("_colonies", []))   # colonised planet ids (persisted)


def own_planets():
    """Every planet the player owns: home, the jumpgate's outer planet, colonies."""
    out = [HOME_PLANET]
    if globals().get("JUMPGATE", {}).get("planet"):
        out.append(JUMPGATE["planet"])
    out += [p for p in COLONIES if p not in out]
    return out


# moved to gofa_core/rules/ruleset.py: PLANET_MGMT_SKILL, PLANET_EXTENDER_ITEM, PLANET_LIMIT_ON

def outer_planets():
    return [p for p in own_planets() if system_of(p) != HOME_SYSTEM]   # the private home system does not count


def outer_planet_limit():
    return (commander_limits(player_level(XP_BOX[0]))[0] + SKILLS.get(PLANET_MGMT_SKILL, 0)
            + INVENTORY.get(PLANET_EXTENDER_ITEM, 0) * EXTENDER_AMOUNT.get(PLANET_EXTENDER_ITEM, 1))


def planet_room():
    return not PLANET_LIMIT_ON or len(outer_planets()) < outer_planet_limit()


def limit_text():
    return (f"planet limit reached ({len(outer_planets())}/{outer_planet_limit()}). Commander levels, the GOVERNANCE "
            f"skill and planet extenders raise it")


def lose_planet(pid):
    """A planet of the current player was conquered. Carriers parked there go home. Losing the jumpgate (start) planet
    makes the next colony the start planet; with no outer planet left the player is back in the home system only and
    the next jumpgate use (241) gives a new random start (original: "If all planets were captured from you, you would
    wind up in the home system again ... and reappear elsewhere")."""
    for c in CARRIERS:
        if c.get("at") == pid and not c.get("move"):
            c["at"] = HOME_PLANET
    if pid in COLONIES:
        COLONIES.remove(pid)
    elif pid == JUMPGATE.get("planet"):
        outer = [p for p in COLONIES if system_of(p) != HOME_SYSTEM]   # the gate moves to a random outer planet (client popup text)
        if outer:
            import random
            JUMPGATE["planet"] = random.choice(outer)
            COLONIES.remove(JUMPGATE["planet"])
        else:
            JUMPGATE.clear()
            add_mail(kind=1, body="All your planets in the galaxy are lost. You are back in your home system: use the "
                                  "jumpgate to start again somewhere else in the galaxy.")
    OWNERS.pop(pid, None)


# moved to gofa_core/rules/ruleset.py: ORDER_GATHER, QUARTER_SECONDS, GATHER_ON, BOMB_MAX, BOMB_PER_SHIP, next_quarter, RESULT_ONGOING,
#     battle_goes_on, round_losses, TROOP_HP, bombed_troops

def hostile_planet(pid):
    owner = other_owner(pid)
    return bool(npc_at(pid)) or bool(owner and not is_ally(CUR_PLAYER[0], owner) and not has_nap(CUR_PLAYER[0], owner))


# moved to gofa_core/rules/ruleset.py: pool_fleets

def split_fleets(pooled):
    """Back onto their own carriers: losses shared in proportion, new loot by each fleet's cargo room. The lead takes what rounding leaves."""
    shares, ships0, cargo0 = pooled
    fleets = [next((x for x in CARRIERS if x["id"] == i), None) for i, _, _ in shares]
    lead = fleets[0]
    ships1 = {int(k): int(v) for k, v in lead.get("ships", {}).items()}
    cargo1 = {int(k): int(v) for k, v in lead.get("cargo", {}).items()}
    room = [fleet_cargo(sh) for _, sh, _ in shares]
    split = {i: ({}, {}) for i, _, _ in shares}
    for t, n in ships1.items():
        left = n
        for i, sh, _ in shares[1:]:
            part = round(n * sh.get(t, 0) / ships0[t]) if ships0.get(t) else 0
            split[i][0][t] = part
            left -= part
        split[shares[0][0]][0][t] = left
    for t, n in cargo1.items():
        left = n
        for k, (i, sh, ca) in enumerate(shares):
            if k == 0:
                continue
            weight = ca.get(t, 0) / cargo0[t] if t == 4 and cargo0.get(t) else room[k] / sum(room) if sum(room) else 0
            part = int(n * weight)
            split[i][1][t] = part
            left -= part
        split[shares[0][0]][1][t] = left
    for x in fleets:
        if x:
            x["ships"] = {str(t): n for t, n in split[x["id"]][0].items() if n}
            x["cargo"] = {str(t): n for t, n in split[x["id"]][1].items() if n}


def handle_255(req):
    """CANCEL on a fleet under way: {1 repeated movement id} (seen 2026-11-07, SEND FLEET screen). The carrier turns round and takes as long
    to get back as it has flown. No 255 response type; 9255 {1 code, 2 echo} = error, codes from the client's switch 0x100396db0:
    1 server busy, 2 not travelling, 3 carrier not found, 4 already cancelled, 5 in the gathering phase, 6 locked, 7 jumpgate closed."""
    ids = [v for n, wt, v in pb.fields(req) if n == 1]
    out = []
    now = time.time()
    for mid in ids:
        c = next((x for x in CARRIERS if (x.get("move") or {}).get("id") == mid), None)
        mv = c and c["move"]
        retreat = bool(c and mv["order"] == ORDER_GATHER and mv.get("round", 1) > 1)   # the break between rounds
        code = 2 if not c else 5 if mv["order"] == ORDER_GATHER and not retreat else 4 if mv.get("cancelled") else 0
        if code:
            print(f"   cancel: move {mid} refused, code {code}", flush=True)
            return [(9255, pb.v(1, code) + pb.ld(2, req))]
        back = travel_seconds(mv["target"], mv["origin"], mv.get("speed", 1.0), carrier=c) if retreat else max(1, now - mv["start"])
        c["move"] = {"id": mid, "order": ORDER_RELOCATE, "target": mv["origin"], "origin": mv["target"], "start": now,
                     "end": now + back, "speed": mv.get("speed", 1.0), "cancelled": True}
        c["at"] = mv["origin"]
        out.append((203, pb.ld(1, movement_msg(c, c["move"]))))
        print(f"   cancel: carrier {c['id']} turns back to {mv['origin']}, {now - mv['start']:.0f}s", flush=True)
    save_state()
    return out + [(103, planet_details()), (103, planet_details(c["at"]))] if out and c["at"] != HOME_PLANET else out + [(103, planet_details())]


def allied_gatherers(target, now):
    """Alliance members' fleets gathered at target with their battle due: they fight in this battle. Nothing changes in their saves yet."""
    a = alliance_of(CUR_PLAYER[0])
    found = []
    for member in list(a["members"]) if a else []:
        pid = int(member)
        if pid == CUR_PLAYER[0] or not os.path.exists(player_file(pid)):
            continue
        with as_player(pid):
            fleets = [(x["id"], {int(t): int(n) for t, n in x.get("ships", {}).items()}, x["move"].get("round", 1)) for x in CARRIERS
                      if (x.get("move") or {}).get("order") == ORDER_GATHER and x["move"]["target"] == target and x["move"]["end"] <= now]
        if fleets:
            found.append((pid, fleets))
    return found


def settle_allies(allied, target, kept, goes_on, rnd, text, crystals=None):
    """kept = {ship type: share surviving}. Allied fleets take their losses and gather again, or stay at the planet.
    crystals = {player: Void crystals} their share of a fallen Void planet."""
    for pid, fleets in allied:
        with as_player(pid):
            for cid, ships, _ in fleets:
                x = next((y for y in CARRIERS if y["id"] == cid), None)
                if not x:
                    continue
                x["ships"] = {str(t): round(n * kept.get(t, 1.0)) for t, n in ships.items()}
                mv = x.pop("move", None) or {}
                x["at"], x["trip_end"] = target, time.time()
                if goes_on:
                    JOB_ID[0] += 1
                    x["move"] = dict(mv, id=JOB_ID[0], start=time.time(), end=next_quarter(time.time()), round=rnd + 1)
            add_mail(kind=1, body=text)
            give_crystals((crystals or {}).get(pid, 0), target)
            PENDING_PLANET_PUSH[:] = [time.time()]
            save_state()


def abandon_planets():
    """Headquarters demolished: the planet is free again; carriers there go home, a jumpgate planet moves the gate (lose_planet)."""
    foreign = []
    while ABANDON:
        pid = ABANDON.pop()
        if pid in own_planets():
            lose_planet(pid)
            PLANET_STATE.pop(str(pid), None)
            PENDING_PLANET_PUSH[:] = [time.time(), "planets"]
            save_state()
            print(f"   planet {pid} abandoned", flush=True)
        elif pid not in foreign:
            foreign.append(pid)   # another player's: that player's own turn takes it (it used to be dropped here)
    ABANDON.extend(foreign[-50:])


def finish_moves():
    """Carriers whose move ended are now at the target planet. Returns True if any arrived."""
    done = False
    now = time.time()
    # (first: looking at allies swaps the player, which reloads CARRIERS)
    allied = {t: allied_gatherers(t, now) for t in {c["move"]["target"] for c in CARRIERS
                                                    if (c.get("move") or {}).get("order") == ORDER_GATHER and c["move"]["end"] <= now}}
    for c in CARRIERS:
        mv = c.get("move")
        if mv and mv["end"] <= time.time():
            if (mv.get("order") == ORDER_ATTACK and c.get("behaviour", 1) == 2 and system_of(mv["target"]) != HOME_SYSTEM and hostile_planet(mv["target"])):
                # avoid combat (owner's Discord answer 2026-11-12: "if you flew into an enemy fleet with it on they withdrew back to point of origin"):
                # the carrier does not fight, it turns round and flies back (like a cancelled trip)
                now = time.time()
                back = travel_seconds(mv["target"], mv["origin"], mv.get("speed", 1.0), carrier=c)
                c["move"] = {"id": mv["id"], "order": ORDER_RELOCATE, "target": mv["origin"], "origin": mv["target"], "start": now, "end": now + back,
                             "speed": mv.get("speed", 1.0), "cancelled": True}
                c["at"] = mv["origin"]
                add_mail(kind=1, body=f"Carrier {c['id']} is set to avoid combat: it withdrew from {mv['target']} without fighting and flies back to {mv['origin']}.")
                print(f"   avoid combat: carrier {c['id']} withdraws from {mv['target']}", flush=True)
                done = True
                continue
            if (mv.get("order") == ORDER_ATTACK and GATHER_ON and system_of(mv["target"]) != HOME_SYSTEM
                    and hostile_planet(mv["target"])):
                JOB_ID[0] += 1
                c["move"] = dict(mv, id=JOB_ID[0], order=ORDER_GATHER, start=mv["end"], end=next_quarter(mv["end"]))
                done = True
                print(f"   gather: carrier {c['id']} at {mv['target']} until {time.strftime('%H:%M', time.localtime(c['move']['end']))}", flush=True)
                continue
            pooled, goes_on, rnd, group = None, False, ROUND_MAX, [c["id"]]   # no gathering (home system): one round
            extra, ally_ships, ally_crystals = [], {}, {}
            own_n = sum(int(v) for v in c.get("ships", {}).values())   # this player's ships in the battle (the Void crystal share)
            if mv.get("order") == ORDER_GATHER:
                mates = [x for x in CARRIERS if x is not c and (x.get("move") or {}).get("order") == ORDER_GATHER
                         and x["move"]["target"] == mv["target"] and x["move"]["end"] <= time.time()]
                extra = allied.get(mv["target"], [])
                rnd = max([mv.get("round", 1)] + [x["move"].get("round", 1) for x in mates] + [f[2] for _, fl in extra for f in fl])
                group += [x["id"] for x in mates]
                for x in mates:
                    x["at"], x["trip_end"] = mv["target"], time.time()
                    x.pop("move")
                pooled = pool_fleets(c, mates) if mates or extra else None
                own_n = sum(int(v) for v in c.get("ships", {}).values())
                ally_ships = {}
                for _, fl in extra:
                    for _, ships, _ in fl:
                        for t, n in ships.items():
                            ally_ships[t] = ally_ships.get(t, 0) + n
                c["ships"] = {str(t): int(c.get("ships", {}).get(str(t), 0)) + ally_ships.get(t, 0)
                              for t in set(ally_ships) | {int(k) for k in c.get("ships", {})}}
                mv = dict(mv, order=ORDER_ATTACK)
            c["at"] = mv["target"]
            c.pop("move")
            c["trip_end"] = time.time()
            if (planet_pos(mv["target"]) is None) != (planet_pos(mv.get("origin", HOME_PLANET)) is None):
                TUT_FLAGS.add("jumped")   # crossed between the home system and the galaxy
            done = True
            print(f"   move: carrier {c['id']} arrived at {c['at']}", flush=True)
            if mv.get("order") == ORDER_ATTACK and npc_at(mv["target"]):
                goes_on = attack_npc(c, mv["target"], rnd)
            elif mv.get("order") == ORDER_ATTACK and other_owner(mv["target"]) and is_ally(CUR_PLAYER[0], other_owner(mv["target"])):
                add_mail(kind=1, body=f"Attack on {mv['target']} called off: the planet belongs to an alliance member.")
                print(f"   move: attack on ally planet {mv['target']} refused", flush=True)
            elif mv.get("order") == ORDER_ATTACK and other_owner(mv["target"]) and has_nap(CUR_PLAYER[0], other_owner(mv["target"])):
                add_mail(kind=1, body=f"Attack on {mv['target']} called off: your alliance has a non-aggression pact with the owner's.")
                print(f"   move: attack on NAP planet {mv['target']} refused", flush=True)
            elif mv.get("order") == ORDER_ATTACK and other_owner(mv["target"]):
                goes_on = attack_player(c["id"], mv["target"], rnd)
                c = next(x for x in CARRIERS if x["id"] == c["id"])   # the player swap reloaded CARRIERS
                if VOID_PAYOUT[0]:   # a Void planet fell: crystals by each attacker's share of the ships (contribution based)
                    weights = {CUR_PLAYER[0]: own_n, **{pid: sum(n for _, s, _ in fl for n in s.values()) for pid, fl in extra}}
                    ally_crystals = void_shares(VOID_PAYOUT[0], weights)
                    VOID_PAYOUT[0] = 0
                    give_crystals(ally_crystals.pop(CUR_PLAYER[0], 0), mv["target"])
            kept = {}
            if extra:   # take the allies' ships back off the lead carrier
                lead = {int(k): int(v) for k, v in c.get("ships", {}).items()}
                for t, n in ally_ships.items():
                    kept[t] = lead.get(t, 0) / (pooled[1].get(t, 0) + n)
                    lead[t] = lead.get(t, 0) - round(n * kept[t])
                c["ships"] = {str(t): n for t, n in lead.items()}
            if pooled:
                split_fleets(pooled)
                c = next(x for x in CARRIERS if x["id"] == c["id"])
            if extra:
                alias = next((a["alias"] for a in ACCOUNTS["accounts"] if a["player"] == CUR_PLAYER[0]), "An ally")
                settle_allies(extra, mv["target"], kept, goes_on, rnd,
                              f"Allied battle with {alias}: {'the battle continues' if goes_on else 'the battle is over'}.", ally_crystals)
                c = next(x for x in CARRIERS if x["id"] == c["id"])
            if goes_on:   # the break: everyone gathers again for the next round, with whoever arrives meanwhile
                for x in CARRIERS:
                    if x["id"] in group:
                        JOB_ID[0] += 1
                        x["move"] = {"id": JOB_ID[0], "order": ORDER_GATHER, "target": mv["target"], "origin": mv["origin"], "start": time.time(),
                                     "end": next_quarter(time.time()), "speed": mv.get("speed", 1.0), "round": rnd + 1}
                print(f"   round {rnd + 1} at {mv['target']} at {time.strftime('%H:%M', time.localtime(c['move']['end']))}: fleets {group}", flush=True)
                done = True
                continue
            if mv.get("order") == ORDER_DELIVER and c.get("cargo") and mv["target"] in own_planets():
                with on_planet(mv["target"]):
                    settle_resources()
                    for t, n in c["cargo"].items():
                        r = next((r for r in RESOURCES if r["type"] == int(t)), None)
                        if r is not None:
                            r["amount"] = min(capacity(), r["amount"] + n)
                print(f"   deliver: {c['cargo']} unloaded at {mv['target']}", flush=True)
                TUT_FLAGS.add("deliver")
                c["cargo"] = {}
            if mv.get("order") == ORDER_COLONIZE and mv["target"] not in own_planets() and other_owner(mv["target"]):
                add_mail(kind=1, body=f"Colonisation failed: the planet already belongs to {player_info(other_owner(mv['target']))['alias']}.")
                print(f"   colonize: {mv['target']} is owned by {other_owner(mv['target']):X}", flush=True)
            elif mv.get("order") == ORDER_COLONIZE and mv["target"] not in own_planets() and not planet_room():
                add_mail(kind=1, body=f"Colonisation failed: {limit_text()}.")
                print(f"   colonize: {mv['target']} refused, {limit_text()}", flush=True)
            elif mv.get("order") == ORDER_COLONIZE and mv["target"] not in own_planets():
                COLONIES.append(mv["target"])
                print(f"   colonize: planet {mv['target']} is now ours (colonies {COLONIES})", flush=True)
    if done:
        save_state()
    return done


def carriers_now():
    for job in [j for j in CARRIER_JOBS if j["end"] <= time.time()]:
        for _ in range(job["count"]):
            JOB_ID[0] += 1
            CARRIERS.append({"id": 20000 + JOB_ID[0], "type": job["carrier"], "level": job["level"], "ships": {},
                             "at": CUR_PLANET[0]})
        CARRIER_JOBS.remove(job)
        save_state()
    return CARRIERS


def handle_109(req):
    """Fleets (loader step 9): response 109 = {1 carrier list* (0x100c64110, same as planet field 5) , 2 {1 repeated
    {1 varint64, 2 string}} (carrier groups? id + name)}. The planet record's field 5 is only counted (commander
    screen); Manage Fleets and the shipyard list the carriers from this reply."""
    carriers = b"".join(pb.ld(1, carrier_msg(c)) for c in carriers_now())
    groups = b"".join(pb.ld(1, pb.v(1, g["id"]) + pb.ld(2, g["name"])) for g in CARRIER_GROUPS)
    return pb.ld(1, carriers) + (pb.ld(2, groups) if groups else b"")


def handle_110(req):
    """Load a carrier: {1 carrier id, 2 ships {1 [{1 type, 2 count}]}, 3 cargo (resource list), 4 list} ->
    {1 updated carrier record}. Treated as the carrier's NEW loadout: ships move between the planet (field 11) and
    the carrier (field 16). Cargo not handled yet."""
    f = {n: v for n, wt, v in pb.fields(req)}
    cid = f.get(1, 0)
    want = {}
    for _, _, entry in pb.fields(f.get(2, b"")):
        e = {n: v for n, wt, v in pb.fields(entry)}
        want[e.get(1, 0)] = want.get(e.get(1, 0), 0) + e.get(2, 0)
    ships_now()
    for c in carriers_now():
        if c["id"] == cid:
            have = {int(k): int(v) for k, v in c.get("ships", {}).items()}
            at = c.get("at", HOME_PLANET) if c.get("at", HOME_PLANET) in own_planets() else HOME_PLANET
            with on_planet(at):   # ships move between the carrier and the planet it is at
                ships_now()
                for t in set(have) | set(want):
                    delta = min(want.get(t, 0) - have.get(t, 0), SHIPS.get(t, 0))
                    SHIPS[t] = SHIPS.get(t, 0) - delta
                    want[t] = have.get(t, 0) + delta
            c["ships"] = {t: n for t, n in want.items() if n}
            # cargo (field 3 {1 [{1 resource type, 2 amount}]}) = the NEW cargo: move the difference between the
            # carrier and the planet it is at
            cargo = {}
            for _, _, entry in pb.fields(f.get(3, b"")):
                e = {n: v for n, wt, v in pb.fields(entry)}
                cargo[e.get(1, 0)] = cargo.get(e.get(1, 0), 0) + e.get(2, 0)
            have_c = {int(k): v for k, v in c.get("cargo", {}).items()}
            with on_planet(c.get("at", HOME_PLANET) if c.get("at", HOME_PLANET) in own_planets() else HOME_PLANET):
                settle_resources()
                for t in set(have_c) | set(cargo):
                    r = next((r for r in RESOURCES if r["type"] == t), None)
                    if r is not None:
                        delta = min(cargo.get(t, 0) - have_c.get(t, 0), int(r["amount"]))   # can't load more than stored
                        r["amount"] -= delta
                        cargo[t] = have_c.get(t, 0) + delta
            c["cargo"] = {str(t): n for t, n in cargo.items() if n}
            if any(cargo.get(t) for t in (1, 2, 3)):
                TUT_FLAGS.add("cargo")
            if cargo.get(4):
                TUT_FLAGS.add("marines")
            save_state()
            print(f"   carrier {cid} loaded: {c['ships']} (planet now {SHIPS})", flush=True)
            return pb.ld(1, carrier_msg(c))
    print(f"   carrier {cid} not found", flush=True)
    return None


def handle_202(req):
    """Carrier production order: {1 shipyard id, 2 {1 carrier type, 2 level, 3 count}}. No response type exists:
    the client sees the order through the planet (field 6 queue) -> answer with a 103 planet push. Runs on the
    shipyard's planet."""
    f = {n: v for n, wt, v in pb.fields(req)}
    pid = planet_of_structure(f.get(1, 0))
    with on_planet(pid):
        err = _handle_202(f)
    if err and err[0][0] == 9202:
        return [err[0], (103, planet_details(pid))]
    return [(103, planet_details(pid)), (272, handle_272(b""))]


def _handle_202(f):
    o = {n: v for n, wt, v in pb.fields(f[2])}
    JOB_ID[0] += 1
    now = time.time()
    lvl, count = o.get(2, 1), o.get(3, 1)
    settle_resources()
    if yard_level(f.get(1, 0), 2, CUR_PLANET[0]) < CARRIER_YARD.get((o.get(1, 1) - 1) // 4, 1):   # the client refuses this itself
        print(f"   carrier: type {o.get(1, 1)} needs a higher Shipyard - refused", flush=True)
        JOB_ID[0] -= 1
        return [(9202, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2])), (103, planet_details())]
    *unit, secs = species_scaled(CAT_SHIPS, *carrier_cost(lvl), carrier_seconds(lvl), pid=CUR_PLANET[0],
                                 percent=yard_percent(2, yard_level(f.get(1, 0), 2, CUR_PLANET[0])))
    cost = tuple(x * count for x in unit)   # = statics s3 carrier_level() cost block x species bonus
    if all(r["amount"] >= x for r, x in zip(RESOURCES, cost)):
        for r, x in zip(RESOURCES, cost):
            r["amount"] -= x
    else:
        print(f"   carrier: cannot afford {cost} - refused", flush=True)
        JOB_ID[0] -= 1
        return [(9202, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2])), (103, planet_details())]
    need = carrier_items(o.get(1, 1), lvl) or {}   # Void carrier: void crystals (item 17), used up when ordered
    for t, n in need.items():
        INVENTORY[t] = max(0, INVENTORY.get(t, 0) - n * count)
        print(f"   carrier: item {t} x{n * count} used ({INVENTORY[t]} left)", flush=True)
    job = {"id": JOB_ID[0], "yard": f.get(1, 0), "carrier": o.get(1, 1), "level": lvl, "count": count,
           "start": now, "end": now + secs * count}
    CARRIER_JOBS.append(job)
    save_state()
    print(f"   carrier: {job['count']} x type {job['carrier']} L{job['level']} done in {job['end'] - now:.0f}s", flush=True)
    return [(103, planet_details())]


def planet_details(pid=None):
    """A 103 reply for a planet (home by default) ({1 id, 2 PlanetList}), pushed after state changes so the client
    refreshes slots/timers immediately instead of at its periodic 103 refresh."""
    pid = HOME_PLANET if pid is None else pid
    return pb.v(1, pid) + pb.ld(2, pb.ld(1, planet_record(pid)))


# Orders the player can't afford are refused (2026-10-27; were "allowed anyway"). The client checks this itself, so
# only a stale or modified client gets here. 9200/9201/9202 {1 code, 2 echoed order}; 104 = INSUFFICIENT_RESOURCES
# in the 9206 code table (assumed shared).
NO_RESOURCES_CODE = 104


def handle_200(req):
    """Build / upgrade a structure: {1 planet, 2 {1 type, 2 slot, 3 target level}} -> {1 construction entry}.
    Runs on the planet named in field 1 (home or a colony)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    pid = f.get(1, HOME_PLANET) or HOME_PLANET
    if pid not in own_planets():
        pid = HOME_PLANET
    with on_planet(pid):
        return _handle_200(f, pid)


# moved to gofa_core/rules/ruleset.py: DEMOLISH_REFUND

def _handle_200(f, pid):
    st = {n: v for n, wt, v in pb.fields(f[2])}
    if st.get(3, 1) == 0:
        return _demolish(f, st, pid)
    JOB_ID[0] += 1
    now = time.time()
    job = {"id": JOB_ID[0], "type": st.get(1, 1), "slot": st.get(2, 0), "level": st.get(3, 1), "planet": pid,
           "start": now, "end": now + species_scaled(CAT_STRUCTURES, build_seconds(st.get(1, 1), st.get(3, 1)), pid=pid)[0]}
    hq = max([x["level"] for x in STRUCTURES.values() if x["type"] == 1] + [1])
    if job["type"] != 1 and job["level"] > hq:   # achievement text: no building above the HQ level (the client refuses this too)
        print(f"   build: level {job['level']} above HQ {hq} - refused", flush=True)
        JOB_ID[0] -= 1
        return [(9200, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2])), (103, pb.v(1, pid) + pb.ld(2, pb.ld(1, _planet_record(pid))))]
    settle_resources()
    cost = species_scaled(CAT_STRUCTURES, *build_cost(job["type"], job["level"]), pid=pid)
    if all(r["amount"] >= c for r, c in zip(RESOURCES, cost)):
        for r, c in zip(RESOURCES, cost):
            r["amount"] -= c
    else:
        print(f"   build: cannot afford {cost} (have {[int(r['amount']) for r in RESOURCES]}) - refused", flush=True)
        JOB_ID[0] -= 1
        return [(9200, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2])),
                (103, pb.v(1, pid) + pb.ld(2, pb.ld(1, _planet_record(pid))))]
    BUILDS.append(job)
    if job["slot"] not in STRUCTURES:
        # New building: it must exist on the planet (level 0, same id) for the client to attach the
        # construction timer to the slot; otherwise the slot shows 00:00 and can't be sped up.
        STRUCTURES[job["slot"]] = {"type": job["type"], "slot": job["slot"], "level": job["level"] - 1}
    save_state()
    print(f"   build: type {job['type']} slot {job['slot']} level {job['level']} done in {job['end'] - now:.0f}s", flush=True)
    # Push the planet details (103 reply shape: {1 id, 2 PlanetList}) with the build reply: the client only
    # attaches the construction timer to the slot when a 103 reply arrives (else 00:00 until its periodic
    # 103 refresh ~40 s later).
    return [(200, pb.ld(1, construction_msg(job))),
            (103, pb.v(1, pid) + pb.ld(2, pb.ld(1, _planet_record(pid))))]


def _demolish(f, st, pid):
    """DEMOLISH on a building: request 200 with target level 0 (seen 2026-11-07). The Headquarters abandons the planet, never in the home system."""
    old = STRUCTURES.get(st.get(2, 0))
    if not old or (old["type"] == 1 and system_of(pid) == HOME_SYSTEM):
        print(f"   demolish refused: {old} on {pid}", flush=True)
        return [(9200, pb.v(1, NO_RESOURCES_CODE) + pb.ld(2, f[2])), (103, pb.v(1, pid) + pb.ld(2, pb.ld(1, _planet_record(pid))))]
    JOB_ID[0] += 1
    now = time.time()
    level = max(1, old["level"])
    secs = species_scaled(CAT_STRUCTURES, build_seconds(old["type"], level), pid=pid)[0] / 2
    refund = [int(c * DEMOLISH_REFUND) for c in species_scaled(CAT_STRUCTURES, *build_cost(old["type"], level), pid=pid)]
    job = {"id": JOB_ID[0], "type": old["type"], "slot": old["slot"], "level": 0, "planet": pid, "start": now, "end": now + secs, "refund": refund}
    BUILDS.append(job)
    save_state()
    print(f"   demolish: {old} on {pid}, {secs:.0f}s, refund {refund}", flush=True)
    return [(200, pb.ld(1, construction_msg(job))), (103, pb.v(1, pid) + pb.ld(2, pb.ld(1, _planet_record(pid))))]


NPC_DEFAULT = {1500210002101: {"id": 900001, "name": "Pirate Lord", "race": 2, "f2": 2,
                               "fleet": {1: 2, 3: 1}, "troops": 5, "stock": 800}}
NPC_PLANETS = {int(k): v for k, v in globals().get("_npc", {str(k): v for k, v in NPC_DEFAULT.items()}).items()}   # experiment: {planet id: {"id", "name", "race"}} - part 3 owner alone did not change the panel


def planet_record(pid, parts=PLANET_PARTS):
    if pid != HOME_PLANET and pid in own_planets():
        with on_planet(pid):
            return _planet_record(pid, parts)
    return _planet_record(pid, parts)


def _planet_record(pid, parts=PLANET_PARTS):
    """Planet: 1 id* (must exist in the map), 2 int32, 3-17 sub-states (no required fields), 19/20 ints,
    21/23 Timestamps, 22 message. The client keeps a planet 'pending' (loader step 8 waits on it) until the
    parts it asked for in 103 have arrived; here every part is present but empty (placeholder)."""
    out = pb.v(1, pid)
    npc = npc_at(pid)
    if npc and not npc.get("fleet") and npc.get("base_fleet") and time.time() - npc.get("defeated", 0) > NPC_REGEN_SECONDS:
        npc["fleet"] = dict(npc["base_fleet"])   # the pirates rebuild their defence fleet
    if npc:   # a planet owned by an NPC (owner record = part 3, player 0x100c6a998)
        out += pb.ld(3, pb.v(1, npc["id"]) + pb.ld(2, npc["name"]) + pb.v(3, npc.get("race", 2)))
    elif other_owner(pid):   # another player's planet (step 3 owner index)
        out += pb.ld(3, player_rec(other_owner(pid)))   # field 5 alliance id -> friend planet for alliance members
    elif pid in own_planets():   # own planets show the owner too (PLANET STATS, the name under the planet)
        out += pb.ld(3, player_rec(CUR_PLAYER[0]))
    for k in parts:
        if k == 2:
            out += pb.v(2, npc.get("f2", 1) if npc else 2 if other_owner(pid) else 1)   # 1 = free (COLONIZE)
        elif k == 14 and pid == CUR_PLANET[0]:
            out += pb.ld(14, b"".join(pb.ld(1, structure_msg(st)) for st in structures_now()))
        elif k == 9 and pid == CUR_PLANET[0]:
            settle_resources()
            out += pb.ld(9, b"".join(pb.ld(1, resource_msg(r)) for r in RESOURCES))
        elif k == 5 and pid == HOME_PLANET:
            out += pb.ld(5, b"".join(pb.ld(1, carrier_msg(c)) for c in carriers_now()))
        elif k == 6 and pid == CUR_PLANET[0]:
            out += pb.ld(6, b"".join(pb.ld(1, carrier_job_msg(j)) for j in CARRIER_JOBS if j["end"] > time.time()))
        elif k == 11 and pid == CUR_PLANET[0]:
            out += pb.ld(11, b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, n)) for t, n in sorted(ships_now().items()) if n))
        elif k == 8 and pid == CUR_PLANET[0]:
            out += pb.ld(8, b"".join(pb.ld(1, scan_job_msg(j)) for j in SCAN_JOBS if j.get("planet", HOME_PLANET) == pid))
        elif k == 10 and pid == CUR_PLANET[0]:
            out += pb.ld(10, b"".join(pb.ld(1, ship_job_msg(j)) for j in SHIP_JOBS if j["end"] > time.time()))
        elif k in (TROOP_FIELD, DRONE_FIELD) and pid == CUR_PLANET[0] and "TROOP_JOBS" in globals():
            troops_now() if CUR_PLANET[0] == HOME_PLANET else None
            want = 5 if k == DRONE_FIELD else 4
            out += pb.ld(k, b"".join(pb.ld(1, troop_job_msg(j)) for j in TROOP_JOBS
                                      if j.get("planet", HOME_PLANET) == pid and j.get("res", 4) == want
                                      and j["end"] > time.time()))
        elif k == 16 and pid == HOME_PLANET:
            out += pb.ld(16, b"".join(pb.ld(1, tech_order(t, lv)) for t, lv in sorted(research_now().items()) if lv))
        elif k == 17 and pid == HOME_PLANET:
            out += pb.ld(17, b"".join(pb.ld(1, research_job_msg(j)) for j in RESEARCH))
        elif k == 4:   # artifact dig jobs {1 timer, 2 citadel structure id}
            out += pb.ld(4, b"".join(pb.ld(1, dig_job_msg(j)) for j in globals().get("DIG_JOBS", []) if j["planet"] == pid))
        elif k == 15 and pid == CUR_PLANET[0]:
            out += pb.ld(15, b"".join(pb.ld(1, construction_msg(job)) for job in BUILDS if job["end"] > time.time()))
        else:
            out += pb.ld(k, b"")
    return out


def planet_states():
    """Planet states 102 (pushed with the init batch and requested at step 8). The step-8 handler
    (0x1001efd08) needs a non-empty list, else loader error 9."""
    return pb.ld(1, b"".join(pb.ld(1, planet_record(p)) for p in own_planets()))


def handle_104(req):
    """Init batch (step 7). Response 104 sent minimal; the planet-states push 102 rides along here because
    the step-8 check needs it and its handler needs the statics (pushing it at step 0 crashed)."""
    PLAYER["planets_sent"] = True
    return [(104, mail_reply()), (102, planet_states())]


def handle_103(req):
    """Planet details (loader step 8): {1 repeated planet id, 2-17 flags for which sub-states}.
    Response 103 = {1 repeated id (echo), 2 PlanetList {1 repeated Planet}} (same type as push 102).
    Step 8 also waits until the client's list of pending planet requests is empty."""
    ids = [v for f, wt, v in pb.fields(req) if f == 1 and wt == 0]
    parts = [f for f, wt, v in pb.fields(req) if f != 1 and wt == 0 and v]
    # parts == [7]: the galaxy map's owner query for shared-bookmark planets (0x10065fb04); own planets then carry their
    # owner record (part 3) too, else the DIPLOMACY counters file them under targets (mode 1) instead of friendly (2)
    own = set(own_planets()) if parts == [7] else set()
    planets = b"".join(pb.ld(1, planet_record(i) + (pb.ld(3, player_rec(PLAYER_ID)) if i in own else b""))
                       for i in ids)   # always all parts (see PLANET_PARTS)
    # A 102 from an earlier envelope is re-dispatched (empty) with this reply -> "invalid game state"
    # (loader error 9). Sending a fresh 102 alongside keeps the planet list non-empty.
    return b"".join(pb.v(1, i) for i in ids) + pb.ld(2, planets)


def handle_102(req):
    """Planet states, requested by the client at loader step 8 (empty request, sent with the 281 batch).
    An empty planet list here = loader error 9 "The current state of the game is not valid"."""
    return planet_states()


def handle_150(req):
    """Server time (loading step 0), sent on the world connection every 10 s until answered.
    Request: 1 Timestamp {1 fixed64 = client uptime as double}. Response 150: 1 Timestamp, 2 Timestamp,
    Timestamp = {1 required fixed64 (double seconds), 2 string}. Guess: 1 = echo of the client's stamp,
    2 = server time (unix seconds)."""
    client = next((v for f, wt, v in pb.fields(req) if f == 1 and wt == 2), pb.f64(1, 0))
    server = pb.key(1, 1) + struct.pack("<d", time.time())
    return pb.ld(1, client) + pb.ld(2, server)


def handle_100(req):
    """Version check (loading step 1). Request: 2 Versions {1 statics 461*, 2*, 3*, 4, 5, 6, 7 = 1443606008, 8}.
    Response 100: 3 Versions* (kept by the loader at +0x1e0), 4-7 bools. Handler 0x1001ef7e8:
    5 = client outdated ("CLIENT OUTDATED" / App Store popup), 4 = statics must be downloaded
    (0 makes the client use local statics it never had and crash at loader step 2), 6/7 unused there."""
    versions = next((v for f, wt, v in pb.fields(req) if f == 2 and wt == 2), pb.v(1, 461) + pb.v(2, 0) + pb.v(3, 0))
    # Versions field 5 = map id (loader +0x1e0, looked up in the map store at steps 2/3). The bundled
    # map is maps_ios/1931642559.map; without field 5 the client looks for map 0 and stalls at step 3.
    versions = b"".join(pb.v(f, v) if wt == 0 else pb.ld(f, v) for f, wt, v in pb.fields(versions) if f != 5)
    versions += pb.v(5, MAP_ID)
    return pb.ld(3, versions) + pb.v(4, 1) + pb.v(5, 0) + pb.v(6, 0)


STATICS_VERSION = 471
# moved to gofa_core/rules/ruleset.py: BLUEPRINT_TECH_OF, TECH_LAB, CARRIER_TECH_OF, BLUEPRINT_GATING, TECH_MAX, SKILL_MAX

# Types that also get a level-0 s11 record: the planetary defence widget (0x1005f7234) looks up s11 (9, current
# level) field 6 as soon as the slot holds a defence, and a NEW build is level 0 -> null record -> crash 0x100027110.
LEVEL0_TYPES = {9: 0}
BUILD_MAX = int(os.environ.get("GOFA_BUILD_MAX", 20))   # building level records in statics s11; the client hard-codes max 20 (0x1005bebb4 cmp level, #19) and crashes if level+1 has no record below that
S11_F = {}   # experiment: override s11 entry fields 2-4
# moved to gofa_core/rules/ruleset.py: SEC2_F64, CARRIER_F16, CARRIER_F11

MAP_BOUND_SCALE = 1
MAP_MIN_CORNER = 0.0   # was 32: the galaxy renderer subtracts it from system positions
TECH_KIND = 1   # experiment: section 12 entry field 2
TECH_F4, TECH_F5 = 0, 0   # experiment
ENUM_FIELDS = json.load(open(os.path.join(here, "..", "protos", "enum_fields.json")))
KEY_ENUMS = json.load(open(os.path.join(here, "..", "protos", "statics_key_enums.json")))
MAP_ID = 1931642560   # 1931642559 = bundled map; 1931642560 = same with positions +32 (data/1931642560.map, see findings)


def cost_block(m, g, c, seconds, items=True, need=None, artifacts=None):
    """Statics cost block 0x100c65178: 1 int*, 2 list {type 1-3, n}, 3 COST list {1 resource type, 2 amount},
    4 Timestamp {double} = duration in seconds, 5 list {type 1-18, n}, 6 list {type 1-3, n}. Lists 2/5/6 are
    kept full (zeros): the client indexes some of them by position. Confirmed in the building panel."""
    zeros = lambda n: b"".join(pb.ld(1, pb.v(1, i) + pb.v(2, 0)) for i in range(1, n + 1))
    res = b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, v)) for t, v in ((1, m), (2, g), (3, c)) if v)
    # items=False: no list-5 entries. The shipyard's "max buildable" (0x10027cae0) divides the owned count of each
    # list-5 item by its required amount; a listed 0 is an ARM divide by zero = 0 -> slider capped at 1.
    # List 2 {colour 1 red / 2 blue / 3 yellow, n}: the carrier view's "UPGRADE n, COSTS a/b" label takes a from it
    # (0x100388534 matches the colour; the upgrade check 0x1002c9e14 copies list 2 of the target level's cost block).
    arts = lambda: b"".join(pb.ld(1, pb.v(1, i) + pb.v(2, (artifacts or {}).get(i, 0))) for i in range(1, 4))
    return (pb.v(1, 1) + pb.ld(2, arts()) + pb.ld(3, res) + pb.ld(4, ts(seconds))
            + pb.ld(5, zeros(18) if items else b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, n)) for t, n in (need or {}).items()))
            + pb.ld(6, arts()))


# moved to gofa_core/rules/ruleset.py: ALLIANCE_MEMBER_CAP, ALLIANCE_SENIOR_OFFICERS

def handle_107(req):
    """Statics (loading step 2): the rulebook. Response 107: 1 string, 2 Statics {1 version*, 2 global
    constants, 3-33 tables}. Stage 1: every section present in its minimal form, all tables empty."""
    statics = schema.MESSAGES[schema.EXT[("response", 107)]]["fields"]["2"]["msg"]
    sections = {int(k): ({} if f["type"] == "message" else STATICS_VERSION)
                for k, f in schema.MESSAGES[statics]["fields"].items()}
    # Section 2 = global constants (137 fields, 1-71 and 135-137 required). Placeholder 1 for every
    # required one (0 is riskier: some are probably divisors or level caps).
    consts = schema.MESSAGES[statics]["fields"]["2"]["msg"]
    sections[2] = {int(k): 1 for k, f in schema.MESSAGES[consts]["fields"].items() if f["required"]}
    # fixed64 fields are doubles: an int 1 went out as raw bits 1 = 5e-324, i.e. 0. The fleet ETA multiplies by
    # fields 18 and 59 (travel formula 0x1004091a4) -> "00m 00s" everywhere. Send 1.0 (GOFA_SEC2_F64 to override).
    for k, f in schema.MESSAGES[consts]["fields"].items():
        if f["required"] and f["type"] == "fixed64":
            sections[2][int(k)] = SEC2_F64.get(int(k), 1.0)
    # Fields 7-11 = object-id encoding (0x100273bb4): id = x*(7*8*9*10) + y*(7*8*9) + system*(7*8) + planet*7 + n,
    # matching the map ids (x*1e11 + y*1e7 + system*1e3 + planet*1e2 + 01). 11 = range of the top part.
    sections[2].update({7: 100, 8: 10, 9: 10000, 10: 10000, 11: 10000})
    # Field 6 = SECTOR SIZE in map units (getter 0x100024a4c; the galaxy view bounds are field6 x sector index
    # (statics 14), 0x100345808). Map files place systems at 32 units per sector -> 32 (was the placeholder 1, which
    # squeezed the galaxy into 1..40 while systems sit at ~32..1280: empty galaxy map).
    sections[2][6] = 32
    # Field 25 = MAX RESEARCH LEVEL: the research check 0x100281c50 compares the requested level with the
    # section-2 int at +0x80 (getter 0x100024e74) and refuses with code 7 ("max level") above it. Was 1. 2026-10-17.
    sections[2][25] = TECH_MAX
    # Field 23 = MAX COMMANDER SKILL LEVEL (int at +0x70, getter 0x100024e04): the next-level helper 0x10077c7d0 caps
    # skill items (internal types 23-35 -> skills via table 0x100aeb0f0) at it, the learn check 0x10052c9a4 refuses
    # above it (code 4) and the skill widget (0x1005af1a8 / 0x1005b0048) sizes its level bar by it. Was 1. 2026-10-18.
    sections[2][23] = SKILL_MAX
    sections[2].update({14: SPEEDUP_MIN, 15: SPEEDUP_MAX, 16: SPEEDUP_HALF})   # speed-up price, see speedup_price()
    sections[2].update(SPY_S2)   # spy preview, see SPY_COST
    sections[2][70] = QUARTER_SECONDS // 60   # minutes between battles: the client's NEXT BATTLE (0x1003915d8) rounds to this
    # Field 24 = MAX CARRIER (ARTIFACT) UPGRADE LEVEL (int at +0x74, getter 0x100024e3c): the carrier upgrade check
    # 0x1002c9f14 refuses with code 7 when the upgrade level is above it. Was 1. 2026-10-18.
    sections[2][24] = CARRIER_UPGRADE_MAX
    # Alliances (2026-10-20, found by setting groups of section-2 ints to 7): field 28 = alliance MEMBER CAP
    # (MY ALLIANCE "MEMBER COUNT 1 / x"; the OFFERS accept tick refuses with "maximum number of members" at the cap),
    # field 57 = senior officers + 1 ("SENIOR OFFICERS 0 / x-1"). Optional field 79 (unsent = 0) gates the alliance
    # panel: 7 made the top-bar icon do nothing (probably an unlock level) - leave it unsent.
    sections[2][28] = ALLIANCE_MEMBER_CAP
    sections[2][57] = ALLIANCE_SENIOR_OFFICERS + 1
    # Chat switches (2026-10-22): field 74 (bool +0x169) = alliance chat on, 77 (+0x16b) = global chat on. The chat
    # pollers 0x100393f08 / 0x1003937ec only start the Photon connect (0x1005ac218) when they are set; unsent = the
    # chat tab stays "Disconnected". (73 = +0x168 = show OUTER PLANETS to everyone - leave unsent.)
    sections[2][74] = 1
    sections[2][77] = 1
    # Section 14 = map: 2 / 3 = min / max corner {1 x double, 2 y double, 3 sector x, 4 sector y}.
    # The bundled map holds sectors 1..39 x 1..39 (a full rectangle) plus a special 0_0 file; the sector
    # check (0x10073f4a4) needs every cell inside the bounds present, else "The client failed to load the
    # sector file." (loader step 3). ~32 units per sector.
    # 2026-10-15: the galaxy camera clamps to bounds/32 (min 1.00, max 40.00 with 32 / 1280) while system positions
    # in the map files are in sector units x 32 (Murana in sector 15_21 at 475,643; Home in 0_0 at 10,10) -> scale
    # the corners by MAP_BOUND_SCALE (experiment, 32 = corners 1024 / 40960).
    sections[14] = {2: {1: MAP_MIN_CORNER, 2: MAP_MIN_CORNER, 3: 1, 4: 1},
                    3: {1: 40 * 32.0 * MAP_BOUND_SCALE, 2: 40 * 32.0 * MAP_BOUND_SCALE, 3: 39, 4: 39}}
    # Section 14 field 1 = repeated sector, same layout as the bundled map files ({1 x, 2 y, 3 systems, 5 lanes}).
    # Section 26 = player levels: repeated {1 XP threshold*, 2 level*, 3-6 optional (rewards?)}.
    # Looked up by 0x1005474f0 (e.g. from reply 119); empty -> crash. MAX_LEVEL levels (level_threshold).
    # Fields 3 / 4 / 5 = natural outer planet / carrier / ship limits (commander_limits, original numbers).
    # Field 6 = cumulative skill points at that level: SKILLS "NEXT SKILLPOINT: Level n +k" shows the difference
    # (0x1005b2b2c -> 0x10052c1cc looks up s26 by level, field 6), so it follows skill_points_at().
    sections[26] = {1: [{1: level_threshold(lvl), 2: lvl, **dict(zip((3, 4, 5), commander_limits(lvl))),
                         6: skill_points_at(lvl)} for lvl in range(1, MAX_LEVEL + 1)]}
    # Section 20 = 18 type definitions {1 id*, 2-9 numbers (costs/stats?)}. The client walks a built-in
    # list of ids 1..18 (runtime array at 0x100d1d650) and looks each up here (0x100273688); a missing id
    # falls back to entry 0 -> crash in the 272 handler (0x100708310). Placeholder values.
    # Field 5 (bool, def+0x15) = HIDE the item in the commander ITEMS tab (0x10070f990: shown when count >= 1 or
    # field 6 set, and field 5 false) -> must be 0. Field 6 (def+0x16) = list even with count 0.
    sections[20] = {1: [{1: i, **item_def_fields(i)} for i in range(1, 19)]}
    # Commander rank: the client derives it from the level (0x10052c150: last entry with field 2 <= level, by list position),
    # so there is no rank field on the player. It picks the label (0x1004aa9fc) and the portrait (race base + rank x 2 + gender).
    sections[28] = {1: [{1: i + 1, 2: lvl} for i, lvl in enumerate(RANK_LEVELS)]}
    # Other id-keyed tables: entry field 1 is an enum (type id) with a fixed valid set; the parser drops
    # ids outside it, which then fails the entry's required check and rejects the whole statics.
    # Valid sets from the enum validators: protos/statics_key_enums.json. One placeholder entry per id;
    # an int field 2 is set to 1.
    for sec_s, ids in KEY_ENUMS.items():
        sec = int(sec_s)
        if sec in (20, 26) or not ids:
            continue
        elem = schema.MESSAGES[schema.MESSAGES[statics]["fields"][sec_s]["msg"]]["fields"]["1"]["msg"]
        enums = ENUM_FIELDS.get(elem, {})          # per-field valid sets (re-tools/enum_fields.py)
        ids = enums.get("1") or ids
        f2 = schema.MESSAGES[elem]["fields"].get("2", {})
        extra = {}
        if f2.get("type") in ("int32", "varint32", "varint64") and not f2.get("repeated"):
            extra = {2: (enums.get("2") or [1])[0]}
        sections[sec] = {1: [{1: i, **extra} for i in ids]}
    # Section 9 (vtable 0x100c68b20): entries {1 id, 2 repeated sub-entry, 3 int}. Sub-entry (0x100c68c88),
    # all 14 fields required: 1 id enum {1-6,8,9} (varint; the map wrongly says fixed32 -> wrong wire type
    # rejected the whole statics), 2 kind enum 1-4, 3 {1 int*} (0x100c65178), 4 {1 int*} (0x100c68328; the map misses this required field: IsInitialized uses tbz), 5-14 ints.
    # Built as raw bytes. After loading, scene setup (0x1002b249c) looks up (id 1, kind 1) via 0x100272720
    # and crashes on a miss.
    # Ship table (section 9 sub-entry, confirmed on screen 2026-10-10 with marker values): 1 ship type, 2 level 1-4,
    # 3 cost block (cost list = price per ship, Timestamp = build seconds per ship; field 5 list = required
    # items, shown as "Requires ... Amount n" when > 0), 4 {1 int}, 5 damage, 6 shield, 7 hitpoints, 8-14 unknown
    # (speed / cargo / ...?). The shipyard multiplies the cost by its level record field 6 (percent).
    # Ship types: 1/2 fighter Mk I/II, 3/4 interceptor, 5/6 bomber, 8/9 freighter.
    def sub(i, kind):
        m, g, c, secs, dmg, sh, hp = SHIP_DEFS.get(i, SHIP_DEFS[1])
        up = 1 + 0.1 * (kind - 1)          # levels 2-4 (research?) a bit stronger
        # fields 8-14 unknown; one of them is the ship's slot cost against the ship limit (all 10 -> each ship
        # counted 10 on the commander screen), so keep them 1 until identified
        # field 9 = cargo capacity per ship (carrier TONNAGE), field 10 = hangar slots per ship (probed 2026-10-11);
        # field 14 = XP per destroyed ship (probed 2026-10-23: report XP = kills x field 14); 8, 11-13 still unknown
        stats = [round(dmg * up), round(sh * up), round(hp * up), 1, SHIP_CARGO.get(i, 0), 1, 1, 1, 1, SHIP_XP.get(i, 0)]
        req = pb.v(1, 1)
        if i in SHIP_YARD:   # requirement record {2 structure, 3 count, 4 level}: REQUIRES Shipyard LEVEL n
            req += pb.ld(2, pb.v(2, 2) + pb.v(3, 1) + pb.v(4, SHIP_YARD[i]))
        if i in BLUEPRINT_TECH_OF and BLUEPRINT_GATING:   # Mk II ships: requirement record {1 tech, 3 level}
            req += pb.ld(2, pb.v(1, BLUEPRINT_TECH_OF[i]) + pb.v(3, 1) + pb.v(4, 1))
        return (pb.v(1, i) + pb.v(2, kind) + pb.ld(3, cost_block(m, g, c, secs, items=False)) + pb.ld(4, req)
                + b"".join(pb.v(k, v) for k, v in zip(range(5, 15), stats)))
    sections[9] = {1: [{1: i, 2: [sub(i, kind) for kind in (1, 2, 3, 4)]}
                       for i in (KEY_ENUMS.get("9") or [1])]}
    # Section 17 (Statics +0x88, vtable 0x100c69660): entries {1 id enum {1,4,7,9,10,11}*, 2 block*, 3 int*}.
    # Block (0x100c65178) = {1 int*, 2/3/5/6 lists of {1 small enum id, 2 amount} (ids 1-3, 1-5, 1-18, 1-3;
    # probably costs/rewards), 4 timestamp}. Scene setup (0x1004797c4) looks up id 11 (0x100272890) and reads
    # element i of list 2 for each resource type -> crash when short. Raw bytes.
    # The client indexes these lists by position against its built-in id lists (e.g. resource types 1-3
    # at 0x100d1b780, from enum validator 0x1000066f8), so each list carries one element per valid id.
    def pairs(n, base=None):
        return b"".join(pb.ld(1, pb.v(1, i) + pb.v(2, 1 if base is None else base + i)) for i in range(1, n + 1))
    # The Scanning Array's Scan tab shows these blocks (short / long range scan): list 3 = cost per resource type
    # 1-5 (metal, gas, crystal, troops, spy drones; drones shown as "SPY DRONES needed/owned"), field 4 = duration.
    # Scan: 50/25/10, no troops/drones, 60 s. List 5 (items) left empty like the ship blocks (zero/one item
    # requirements break "max" divisions and block the action).
    # Id 10 = artifact dig (citadel ARTIFACTS tab, 0x100283814 -> cost scaler 0x10057d120): own block DIG_BASE.
    def dig_block_of():
        return s17_block(DIG_BASE[:3], DIG_BASE[3])
    def s17_block(cost, secs):
        rows = b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, v)) for t, v in zip((1, 2, 3, 4, 5), tuple(cost) + (0, 0)))
        return pb.v(1, 1) + pb.ld(2, pairs(3)) + pb.ld(3, rows) + pb.ld(4, ts(secs)) + pb.ld(5, b"") + pb.ld(6, pairs(3))
    block = s17_block((0, 0, 0, 0, SCAN_DRONES[0]), SCAN_TIME[0])
    # Marker test 2026-11-04: id 1 troops, 4 spy drones, 7 short + 9 long range scan, 10 dig (Barracks / Scanner scale theirs like units).
    s17 = {1: s17_block(TROOP_COST, TROOP_SECONDS), 4: s17_block(DRONE_COST, DRONE_SECONDS), 10: dig_block_of(), 9: s17_block((0, 0, 0, 0, SCAN_DRONES[1]), SCAN_TIME[1])}
    sections[17] = {1: [{1: i, 2: s17.get(i, block), 3: 1} for i in (KEY_ENUMS.get("17") or [1, 4, 7, 9, 10, 11])]}
    # Section 24 (entry 0x100c68b98, Statics +0xb8) = ship matchup table {1 ship type, 2 level 1-4, 3 enemy ship
    # type, 4 enemy level, 5*, 6*}; lookup 0x1002738b0 (all four keys) -> field 6 (+0x1c). The ship info panel
    # asks for (type, lvl, 1|3|5.., lvl) and crashed on a miss (null at 0x100021414). Full cross product;
    # field 6 = effectiveness in percent: fighters > interceptors > bombers > fighters (150 / 50), else 100.
    SHIP_TYPES = [1, 2, 3, 4, 5, 6, 8, 9]
    cls = {1: "F", 2: "F", 3: "I", 4: "I", 5: "B", 6: "B", 8: "T", 9: "T"}
    sections[24] = {1: [pb.v(1, a) + pb.v(2, la) + pb.v(3, b) + pb.v(4, lb) + pb.v(5, 100) + pb.v(6, accuracy(a, b))
                        for a in SHIP_TYPES for la in (1, 2, 3, 4) for b in SHIP_TYPES for lb in (1, 2, 3, 4)]}
    # Section 5 = mission definitions (entry 0x100c67b30 {1 mission type 1-22, 2 class 1-3, 3 levels [{1 type,
    # 2 level, 3-8 floats, 9-11 ints}]}). Class 1 quick / 2 deep (guess). Placeholder: 10 levels, floats 1.0.
    def mission_def(t):
        cls = 2 if t in (4, 5, 6, 7, 8, 9, 19, 20, 21, 22) else 1
        # level floats 3-8: field 5 = resource yield (mission report), others unknown (1.0)
        lv = [pb.v(1, t) + pb.v(2, n) + b"".join(pb.key(k, 5) + struct.pack("<f", float(mission_yield(t, n)[1]) if k == 5 else 1.0)
                                               for k in range(3, 9))
              + pb.v(9, n) + pb.v(10, n) + pb.v(11, n) for n in range(1, 11)]
        return {1: t, 2: cls, 3: lv}
    sections[5] = {1: [mission_def(t) for t in range(1, 23)]}
    # Section 12 = technologies (laboratory TECH LIST): entry 0x100c6a128 {1 tech enum*, 2 int*, 3 repeated level
    # 0x100c6a218 {1 tech*, 2 level*, 3 cost block*, 4 {1 int*}*, 5 int*}, 4 int} (field 2 read at 0x100281ddc -> code 1 "Blueprint tech type token cannot be researched"). Opening the tech list looks up
    # (tech, level) via 0x100272e1c and crashed on the old empty level lists (2026-10-15). Placeholder costs.
    # Field 2 = 1 refuses research outright (code 1, whatever the inventory), so blueprint techs instead list their
    # blueprint item (TECH_ITEM, 1 per level) in the cost block's list 5 ("Requires: <item> Amount 1").
    # Level field 5 = effect in percent (100 = +0%): the tech INFO screen shows field 5 - 100 for the next level
    # ("-100%" with the old 0, "-87%" with 13). Same numbers as the server effects (TECH_BONUS_PER_LEVEL,
    # silo +10%, ship defence +5%, ship production -5% min 50%); other techs 100.
    def tech_f5(t, lv):
        if TECH_F5:
            return TECH_F5
        if t in TECH_BONUS:
            return round(100 + 100 * TECH_BONUS_PER_LEVEL * lv)
        return {5: 100 + 10 * lv, 30: 100 + 5 * lv, 33: 100 - lv}.get(t, 100)
    def tech_level(t, lv):
        return (pb.v(1, t) + pb.v(2, lv) + pb.ld(3, cost_block(*research_cost(lv), research_seconds(lv), items=False,
                                                                          need={TECH_ITEM[t]: 1} if t in TECH_ITEM and lv else None))
                + pb.ld(4, pb.v(1, TECH_F4) + (pb.ld(2, pb.v(2, 7) + pb.v(3, 1) + pb.v(4, max(lv, TECH_LAB.get(t, 0))))
                                               if lv > 1 or (lv and t in TECH_LAB) else b""))   # Lab level = tech level, blueprints TECH_LAB
                + pb.v(5, tech_f5(t, lv)))
    sections[12] = {1: [{1: t, 2: 0, 3: [tech_level(t, lv) for lv in range(0, TECH_MAX + 1)], 4: TECH_MAX}
                        for t in (KEY_ENUMS.get("12") or [1])]}
    # Section 4 = commander skills (entry 0x100c64ea8 {1 skill, 2 repeated level 0x100c64f98, 3 int (max level?)}).
    # Skill enum (validator 0x100006780): 13,14,16,17,18,23-30 (crossfire, harvesters, silo, construction, ...).
    # Level record: 1 skill*, 2 level*, 10* skill-point cost (confirmed: "collect 3 more" with cost 5 and 2 points), 11* (?). Looked up as (skill, level)
    # via 0x10027300c when the commander screen opens -> crash on an empty level list.
    def skill(sk, top=SKILL_MAX):
        lvls = [pb.v(1, sk) + pb.v(2, lv) + pb.v(10, skill_cost(lv)) + pb.v(11, NAV_PERCENT * lv if sk == NAV_SKILL else lv if sk == PLANET_MGMT_SKILL else 1) for lv in range(1, top + 1)]
        return {1: sk, 2: lvls, 3: top}
    sections[4] = {1: [skill(sk) for sk in (13, 14, 16, 17, 18, 23, 24, 25, 26, 27, 28, 29, 30)]}
    # Section 11 = structure (building) definitions, types 1-11 (validator 0x1000068c8); order from the DESC_* switch:
    # 1 HQ, 2 shipyard, 3 metal / 4 gas / 5 crystal extractor, 6 barracks, 7 research lab, 8 scanner,
    # 9 planetary defence, 10 trade centre, 11 citadel. Entry 0x100c69de0 {1 type*, 2*, 3*, 4* ints (guess:
    # max level, ...), 5 repeated level 0x100c69ed0}. Level: 1 type*, 2 level*, 3 cost block* and 4 cost block
    # (0x100c65178, same shape as section 17's), 5 {1 int*} (build time?), 6 int* (required level?),
    # 7 type* (required structure?). Placeholder balance: cost grows with level^2, no real requirements.
    # Field 6 = production efficiency in PERCENT (getter 0x100027110): the shipyard's ship cost/time is
    # base cost x field6/100 x ... (0x10057d3ac); 1 made every ship cost 1/1/1 and take 1 s. 2026-10-10.
    # Level record fields (confirmed with re-tools/probe_level_getters.js, 2026-10-09): the building panel reads
    # level field 3 (+0x10) and field 5 (+0x20). Cost block 0x100c65178: 1 int*, 2 list {1 type 1-3, 2 n},
    # 3 list of resource entries 0x100c68490 {1 type 1-5, 2 amount} = the COST (guess), 4 Timestamp {1 double}
    # = duration in seconds (guess), 5 list {1 type 1-18, 2 n}, 6 list {1 type 1-3, 2 n}.
    # Level field 5 = effects {1 int, 2 repeated effect 0x100c682b0 {1 tech 1-33, 2 structure 1-11, 3, 4, 5 attribute
    # id (s22 set), 6 varint64, 7-10, 11 mission type, 12, 13}}. EXPERIMENT (ship production limit 0): every
    # shipyard level grants every attribute with all value fields = 10.
    def effects(t, n):   # same message as ship field 4: 2 = requirement records. All buildings: level <= HQ level
        return pb.v(1, 60 * n) + (pb.ld(2, pb.v(2, 1) + pb.v(3, 1) + pb.v(4, n)) if t != 1 and n > 1 else b"")
    def structure(t, top=None):
        top = top or BUILD_MAX
        lv = [pb.v(1, t) + pb.v(2, n) + pb.ld(3, cost_block(*build_cost(t, n), build_seconds(t, n)))
              + pb.ld(4, cost_block(0, 0, 0, 0)) + pb.ld(5, effects(t, n)) + pb.v(6, hq_travel_percent(n) if t == 1 else yard_percent(t, n))
              + pb.v(7, 1)
              for n in range(LEVEL0_TYPES.get(t, 1), top + 1)]
        return {1: t, 2: S11_F.get(2, top), 3: S11_F.get(3, top), 4: S11_F.get(4, top), 5: lv}
    sections[11] = {1: [structure(t) for t in range(1, 12)]}
    # Section 7 = per planet type (1-9, validator 0x100006818; 9 CAPTION_PLANET_TYPE_* incl. 3 citadels):
    # {1 planet type, 2 repeated {1 kind 1-4*, 2 structure type 1-11*, 3 float*}} - probably building bonuses.
    # Section 18 = {1 kind 1-4*, 2 planet type 1-6*, 3 double*} - probably base extraction per planet type.
    # Read when the extractor panel opens (re-tools/probe_statics_reads.js). Test values: everything 1.0.
    sections[7] = {1: [pb.v(1, pt) + b"".join(pb.ld(2, pb.v(1, k) + pb.v(2, st) + pb.key(3, 5) + struct.pack("<f", SPECIES_PLANET.get((k, pt), 1.0)))
                                         for k in (1, 2, 3, 4) for st in range(1, 12)) for pt in range(1, 10)]}
    # Section 18 (Statics +0x90) = SPECIES BONUS {1 race 1-4, 2 category 1-6, 3 cost/time multiplier (double)}:
    # 0x1002734c0(category, race) -> cost helper 0x10057d3ac (as 32.32 fixed) + species info screen 0x100780474.
    sections[18] = {1: [pb.v(1, k) + pb.v(2, pt) + pb.key(3, 1) + struct.pack("<d", species_mult(k, pt))
                        for k in (1, 2, 3, 4) for pt in range(1, 7)]}
    # Section 3 = carriers (16 types, validator 1-16): entry 0x100c642f0 {1 id*, 2 int*, 3 repeated level
    # 0x100c643e0 {1 id*, 2 level*, 3 cost block*, 4 {1 int*} (0x100c68328)*, 10-15 ints*, 16 fixed64* (wire
    # type 1 per the parser's tag check 0x81; all 11 fields required, mask 0x7ff)}}. The Carriers tab looks up
    # (id, level 1) via 0x100271e10 and crashed on the empty level list.
    def carrier_level(cid, n):
        return (pb.v(1, cid) + pb.v(2, n) + pb.ld(3, cost_block(*carrier_cost(n), carrier_seconds(n), items=False,
                                                                need=carrier_items(cid, n) if cid == 13 else None,
                                                                artifacts=carrier_artifacts(cid, n)))
                + pb.ld(4, pb.v(1, 1) + (pb.ld(2, pb.v(1, CARRIER_TECH_OF[cid]) + pb.v(3, 1) + pb.v(4, 1))
                                         if BLUEPRINT_GATING and cid in CARRIER_TECH_OF else b"")
                        + (pb.ld(2, pb.v(2, 2) + pb.v(3, 1) + pb.v(4, CARRIER_YARD[(cid - 1) // 4])) if (cid - 1) // 4 in CARRIER_YARD else b""))
                + b"".join(pb.v(k, carrier_field(cid, n, k)) for k in range(10, 16)) + pb.f64(16, struct.unpack("<Q", struct.pack("<d", CARRIER_F16))[0]))   # 10 = hangar (carrier_field)
    sections[3] = {1: [pb.v(1, cid) + pb.v(2, 1) + b"".join(pb.ld(3, carrier_level(cid, n)) for n in range(1, CARRIER_UPGRADE_MAX + 1))
                       for cid in range(1, 17)]}
    # Section 21 = tutorial/mission definitions (element 0x100c62f40: 1 id*, 2 mission type* (117 values 2-137 =
    # the cases of the mission event switch 0x100721b14), 3 parameters, 7 reward 0x100c65970, ...). Placeholder
    # missions (all type 2, no parameters) crash the mission manager right after login (0x100722fa0 reads the
    # missing target). Sent empty until the mission types are understood.
    sections[21] = {}
    sections[21] = {1: [tutorial_def(d) for d in TUTORIAL] + [ach_def(d) for d in ACHIEVEMENTS]} if TUTORIAL_ENABLED else {}
    return schema.build(("response", 107), {1: str(STATICS_VERSION), 2: sections})


# moved to gofa_core/rules/ruleset.py: CREDITS

CREDITS_BOX = [globals().get("_credits", CREDITS)]   # current balance (persisted in state.json)
# moved to gofa_core/rules/ruleset.py: SPEEDUP_MIN, SPEEDUP_MAX, SPEEDUP_HALF, speedup_price

def handle_115(req):
    """Init-batch response 115 = {1 {1 varint32*}}: the player's credit balance (guess)."""
    return pb.ld(1, pb.v(1, CREDITS_BOX[0]))


def handle_501(req):
    """Speed up (finish now) a timed job: request {1 job id} -> response {1 Timestamp (new end), 2 varint64}.
    Guess: 2 = job id echo. Credits are not charged yet."""
    jid = next((v for f, wt, v in pb.fields(req) if f == 1), 0)
    now = time.time()
    left = max([j["end"] - now for j in BUILDS + SHIP_JOBS + CARRIER_JOBS + SCAN_JOBS + RESEARCH + TROOP_JOBS
                if j["id"] == jid] + [0])
    for p in own_planets()[1:]:
        with on_planet(p):
            left = max([left] + [j["end"] - now for j in BUILDS + SHIP_JOBS + CARRIER_JOBS if j["id"] == jid])
    price = speedup_price(left)
    if CREDITS_BOX[0] < price:   # 9501 {1 code, 2 {1 job}}; text = ERROR_CANNOT_SPEED_UP
        print(f"   speed-up: job {jid} needs {price} credits, have {CREDITS_BOX[0]} - refused", flush=True)
        return [(9501, pb.v(1, 1) + pb.ld(2, pb.v(1, jid))), (115, handle_115(b""))]
    for job in BUILDS + SHIP_JOBS + CARRIER_JOBS + SCAN_JOBS + RESEARCH + TROOP_JOBS:
        if job["id"] == jid:
            job["end"] = now
            print(f"   speed-up: job {jid} finished now", flush=True)
    for p in own_planets()[1:]:   # constructions on colonies
        with on_planet(p):
            for job in [j for j in BUILDS + SHIP_JOBS + CARRIER_JOBS if j["id"] == jid]:
                job["end"] = now
                print(f"   speed-up: job {jid} on {p} finished now", flush=True)
    # The panel shows the price (1 credit so far; real formula: statics globals, todo) but the client never deducts
    # it itself -> charge here and push the new balance as a 115 (same shape as the login reply).
    CREDITS_BOX[0] = max(0, CREDITS_BOX[0] - price)
    print(f"   speed-up: {left / 60:.0f} min left, charged {price} credits ({CREDITS_BOX[0]} left)", flush=True)
    save_state()
    return [(501, pb.ld(1, ts(now)) + pb.v(2, jid)), (115, handle_115(b""))]


TECHS = dict(globals().get("_techs", {}))          # tech id -> researched level (planet field 16)
RESEARCH = list(globals().get("_research", []))    # running research jobs (planet field 17)
# moved to gofa_core/rules/ruleset.py: TECH_BONUS, TECH_BONUS_PER_LEVEL, TECH_SLOTS

def tech_slot_free(tech):
    """True if `tech` is already learned / being researched, or a slot is still free."""
    used = set(TECHS) | {j["tech"] for j in RESEARCH}
    return tech in used or len(used) < TECH_SLOTS


def research_now():
    """Finished research jobs become learned tech levels."""
    for job in [j for j in RESEARCH if j["end"] <= time.time()]:
        settle_resources()
        TECHS[job["tech"]] = max(TECHS.get(job["tech"], 0), job["level"])
        RESEARCH.remove(job)
        save_state()
        print(f"   research done: tech {job['tech']} level {job['level']}", flush=True)
    return TECHS


def lab_id():
    """Structure id of the (first) laboratory, type 7 (ids are 1000 + slot, e.g. 1005 sent with request 206)."""
    return next((1000 + int(st["slot"]) for st in STRUCTURES.values() if st["type"] == 7), 0)


def tech_order(tech, level, lab=None):
    """Tech record 0x100c69f48 {1 tech*, 2 level*, 4 laboratory structure id (guess: puts it in that lab's slots)}."""
    lab = lab_id() if lab is None else lab
    return pb.v(1, tech) + pb.v(2, level) + (pb.v(4, lab) if lab else b"")


def research_job_msg(job):
    """Research job 0x100c6a038: {1 timer*, 2 tech order {1 tech*, 2 level*}*, 3 laboratory planet/structure id*}."""
    timer = (pb.v(1, job["id"]) + pb.ld(2, ts(job["start"])) + pb.ld(3, ts(job["end"])) + pb.ld(4, ts(job["end"]))
             + pb.v(5, RESEARCH_TIMER_KIND))
    return pb.ld(1, timer) + pb.ld(2, tech_order(job["tech"], job["level"])) + pb.v(3, job.get("lab", HOME_PLANET))


RESEARCH_TIMER_KIND = 6   # guess (1 build, 2 ships, 3 carriers, 4 scan, 5 travel)


JUMPGATE = dict(globals().get("_jumpgate", {}))   # {"ts": float, "planet": id, "f3": int} (persisted)


def jumpgate_msg():
    """Jumpgate state 0x100c6abf0 {1 Timestamp, 2 planet record 0x100c67c98 (outer-galaxy planet?), 3 int}. The
    jumpgate button (system view, bottom-left) only sends 241 while neither 1 nor 2 is set (0x1002746b8); the
    state arrives in a 242 reply (handler 0x100274a5c copies it to [world+0x198]+0x78; field 2 -> planet id)."""
    out = b""
    if "ts" in JUMPGATE:
        out += pb.ld(1, ts(JUMPGATE["ts"]))
    if "planet" in JUMPGATE:
        out += pb.ld(2, pb.v(1, JUMPGATE["planet"]))
    if "f3" in JUMPGATE:
        out += pb.v(3, JUMPGATE["f3"])
    return out


# moved to gofa_core/rules/ruleset.py: JUMPGATE_AUTO_START, JUMPGATE_START_PLANET

SEED_BOOKMARKS = os.environ.get("GOFA_SEED_BOOKMARKS") == "1"   # new players find systems on the map themselves


def handle_242(req):
    return pb.ld(1, jumpgate_msg())


# moved to gofa_core/rules/ruleset.py: GATE_LOCK, GATE_MISSION_TEXT, GATE_MISSIONS

GATE_MAILED = globals().get("GATE_MAILED") or {}   # player id -> time of the last "jumpgate locked" mail
# moved to gofa_core/rules/ruleset.py: START_CONQUERABLE

def gate_missions_left():
    if not GATE_LOCK or not TUTORIAL_ENABLED:
        return []
    st = dict(tutorial_status())
    return [m for m in GATE_MISSIONS if st.get(m) == 0]


def handle_241(req):
    """Jumpgate button: empty request / empty response; push the jumpgate state (242) with it."""
    left = [] if JUMPGATE.get("planet") else gate_missions_left()
    if left:
        print(f"   jumpgate: locked, home tutorial missions left {left}", flush=True)
        if time.time() - GATE_MAILED.get(CUR_PLAYER[0], 0) > 600:
            GATE_MAILED[CUR_PLAYER[0]] = time.time()
            add_mail(kind=1, body="The jumpgate stays closed until the home-system tutorial is done. Still to do: "
                     + ", ".join(GATE_MISSION_TEXT.get(m, f"mission {m}") for m in left) + ".")
            save_state()   # the mail goes out with the next poll (PENDING_MAIL)
        return [(9241, pb.v(1, 1) + pb.ld(2, req))]
    if not JUMPGATE.get("planet") and JUMPGATE_AUTO_START:
        # first use of the jumpgate: the player gets a starting planet in the outer galaxy (game text: opening the
        # jumpgate gives a start planet in the Shroud Nebula)
        start = pick_start_planet()
        JUMPGATE.update({"planet": start, "ts": time.time()})
        if SEED_BOOKMARKS:   # old workaround for the empty galaxy close zoom (fixed 2026-10-16): 12 systems bookmarked
            seed_bookmarks(start)
        seed_npcs(start)
        OWNERS[start] = CUR_PLAYER[0]
        save_state()
        print(f"   jumpgate: opened, start planet {start}", flush=True)
        return [(241, b""), (242, handle_242(b"")), (102, planet_states())]
    print(f"   jumpgate: 241 -> state {JUMPGATE}", flush=True)
    return [(241, b""), (242, handle_242(b""))]


SECTOR_CACHE = {}   # (x, y) -> [(system id, name, [planet ids])]


def sector_systems(x, y):
    """Systems of map sector x_y from the bundled map (data/map_x/x_y: {1 x, 2 y, 3 {1 [system {1 id, 2 type, 3 name,
    4, 5 position, 6 planets, 7}]}, 5 ...})."""
    if (x, y) not in SECTOR_CACHE:
        out = []
        try:
            d = open(os.path.join(here, "..", "data", "map_x", f"{x}_{y}"), "rb").read()
            for f, wt, v in pb.fields(d):
                if f == 3 and wt == 2:   # {1 [system]}
                    for f2, wt2, v2 in pb.fields(v):
                        if f2 == 1 and wt2 == 2:
                            sysf = {a: b for a, w, b in pb.fields(v2)}
                            planets = []
                            if isinstance(sysf.get(6), bytes):
                                for f3, wt3, v3 in pb.fields(sysf[6]):
                                    if f3 == 1 and wt3 == 2:
                                        planets.append({a: b for a, w, b in pb.fields(v3)}.get(1, 0))
                            out.append((sysf.get(1, 0), sysf.get(3, b""), planets))
        except OSError:
            pass
        SECTOR_CACHE[(x, y)] = out
    return SECTOR_CACHE[(x, y)]


SECTOR_OFFSET = 0   # experiment: request index vs map file name
DIPLO_OWN, DIPLO_ENEMY = 1, 4   # guesses for the 273 relation enum (1-4)
NPC_SECTOR_OWNERS = {}   # experiment (no effect on the planet panel, also after the map fix)
NPC_REL = [4]
SECTOR_FULL = 0   # experiment: fill all 273 system fields
SECTOR_CONTROL = 0   # experiment: field 11 (1-4) for every system (4 overrode the per-system relation)
STAR_TEST = {}   # experiment: {system id: value} -> system field 10 (DIPLOMACY star counter), /debug/star?sys=&v=


BATTLES = list(globals().get("_battles", []))   # [[planet, unix time]] of every fight (world.json "battles"), last 7 days
HEAT_DAY, HEAT_FULL = 86400, 10   # HEAT MAP window, battles per window for full heat


def log_battle(planet):
    now = time.time()
    BATTLES[:] = [b for b in BATTLES if now - b[1] < 7 * 86400][-500:] + [[int(planet), now]]


def heat_fields(sid):
    """Galaxy HEAT MAP (0x10067a104 / 0x10067a538): system field 6 = battles in system, 7 = heat (double 0..1, ring
    colour few -> many battles), 8 = [{1 planet}] planets under attack (distinct ids). Window: battles of the last day;
    under attack = fought over in the last hour."""
    now = time.time()
    day = [p for p, t in BATTLES if system_of(p) == sid and now - t < HEAT_DAY]
    if not day:
        return b""
    hot = sorted({p for p, t in BATTLES if system_of(p) == sid and now - t < 3600})
    heat = min(1.0, len(day) / HEAT_FULL)
    return (pb.v(6, len(day)) + pb.f64(7, struct.unpack("<Q", struct.pack("<d", heat))[0])
            + b"".join(pb.ld(8, pb.v(1, p)) for p in hot))


def handle_273(req):
    """Galaxy map sector: {1 x, 2 y} -> {1 x, 2 y, 3 {1 [system {1 id*, 2 [..], 3 name, ..., 11 enum 1-4, ...}]}}.
    Experiment: list every system of the sector from the bundled map."""
    f = {n: v for n, wt, v in pb.fields(req)}
    x, y = f.get(1, 0), f.get(2, 0)
    def rec(sid, name, planets):
        out = pb.v(1, sid) + pb.ld(3, name)
        # Ring colour / counters: client 0x100676cec reads system field 4 owner player, 5 owner alliance and field 11
        # (non-zero -> kind 4 -> relation 5, one fixed colour for every system), then 0x10033c5d0 relation.
        rel = {p: (DIPLO_OWN, int(OWNERS[p])) for p in planets if p in OWNERS}
        rel.update({p: (DIPLO_OWN, PLAYER_ID) for p in planets if p in own_planets()})
        rel.update({p: (DIPLO_ENEMY, npc_at(p)["id"]) for p in planets if npc_at(p)})
        if rel:   # planet records {1 planet, 2 owner, 3 owner alliance, 4 kind (1 player, 4 NPC)}
            out += b"".join(pb.ld(2, pb.v(1, p) + pb.v(2, o) + pb.v(3, alliance_id_of(o) if r == DIPLO_OWN else 0)
                                  + pb.v(4, r)) for p, (r, o) in rel.items())
            owners = [o for r, o in rel.values() if r == DIPLO_OWN]
            sys_owner = PLAYER_ID if PLAYER_ID in owners else (owners or [o for _, o in rel.values()])[0]
            out += pb.v(4, sys_owner)
            if sys_owner in owners and alliance_id_of(sys_owner):
                out += pb.v(5, alliance_id_of(sys_owner))
        # free planets = records without field 2: DIPLOMACY counter 3 (0x100677800 counts records lacking the owner)
        out += b"".join(pb.ld(2, pb.v(1, p)) for p in planets if p not in rel)
        owned = [p for p in planets if p in NPC_SECTOR_OWNERS]
        if owned and not SECTOR_FULL:   # experiment: NPC planet ownership in the sector overlay
            out += b"".join(pb.ld(2, pb.v(1, p) + pb.v(2, NPC_SECTOR_OWNERS[p]) + pb.v(3, 0) + pb.v(4, NPC_REL[0]))
                            for p in owned)
            out += pb.v(4, NPC_SECTOR_OWNERS[owned[0]])
        if SECTOR_FULL:   # experiment: every field filled
            out += b"".join(pb.ld(2, pb.v(1, p) + pb.v(2, 0) + pb.v(3, 0) + pb.v(4, SECTOR_CONTROL or 4)) for p in planets)
            out += pb.v(4, 0) + pb.v(5, 0) + pb.v(6, len(planets)) + pb.f64(7, 0) + pb.v(9, len(planets)) + pb.v(10, 0)
            out += pb.v(12, 0)
        out += heat_fields(sid)
        if STAR_TEST.get(sid):
            out += pb.v(10, STAR_TEST[sid])
        return out + (pb.v(11, SECTOR_CONTROL) if SECTOR_CONTROL else b"")
    systems = b"".join(pb.ld(1, rec(sid, name, planets))
                       for sid, name, planets in sector_systems(x + SECTOR_OFFSET, y + SECTOR_OFFSET))
    return pb.v(1, x) + pb.v(2, y) + pb.ld(3, systems)


def handle_274(req):
    """Galaxy FLEET / RESOURCES modes, per sector: {1 x, 2 y} -> {1 x, 2 y, 3 {1 [system {1 id, 2 [{1 planet, 2 own fleets,
    3 allied fleets}]}]}} (map grid +0xf8). FLEET ring 0x100677f90: sum of field 2 >= 1 -> blue (stationed own fleets), else
    field 3 >= 1 -> purple (allied); counters 0x1006782e0 mode 1 / 2 = those sums. RESOURCES 0x100678fdc looks field 1 up
    as a planet the client holds (0x100531354) -> own planet = blue, its counters read that planet's state. One record per
    planet that is ours or has stationed carriers (own / alliance mates')."""
    f = {n: v for n, wt, v in pb.fields(req)}
    x, y = f.get(1, 0), f.get(2, 0)
    me, now, mine = CUR_PLAYER[0], time.time(), set(own_planets())
    a = alliance_of(me)
    fleets = [(me, c) for c in CARRIERS]
    for m in (a["members"] if a else {}):
        if int(m) != me:
            fleets += [(int(m), c) for c in (_player_save(int(m)) or {}).get("carriers", [])]
    at = {}   # planet -> [own, allied] stationed carriers
    for o, c in fleets:
        if c.get("at") and c.get("trip_end", 0) <= now:
            at.setdefault(int(c["at"]), [0, 0])[0 if o == me else 1] += 1
    systems = b""
    for sid, name, planets in sector_systems(x + SECTOR_OFFSET, y + SECTOR_OFFSET):
        recs = b"".join(pb.ld(2, pb.v(1, p) + pb.v(2, at.get(p, [0, 0])[0]) + pb.v(3, at.get(p, [0, 0])[1]))
                        for p in planets if p in mine or p in at)
        systems += pb.ld(1, pb.v(1, sid) + recs)
    return pb.v(1, x) + pb.v(2, y) + pb.ld(3, systems)


def handle_304(req):
    """Map view poll: {1 repeated system/sector ids} -> response 304 (vtable 0x100c70ce8, read live from the
    registration default 0x100d33ac0) = {1 repeated id, 2 repeated id, 3 repeated movement 0x100c645c0 {1 timer*,
    2 id*, 3 kind {1,2,3,6,7}*, 4 id*, 5, 6, 7 fixed64, 8}}. Placeholder: echo the ids, no fleets moving."""
    ids = [v for f, wt, v in pb.fields(req) if f == 1 and wt == 0]
    for f, wt, v in pb.fields(req):   # packed form
        if f == 1 and wt == 2:
            ids += pb.unpack_varints(v) if hasattr(pb, "unpack_varints") else []
    return b"".join(pb.v(1, i) for i in ids)


TROOP_JOBS = list(globals().get("_troop_jobs", []))   # barracks training (planet field 7 queue), all planets
# moved to gofa_core/rules/ruleset.py: TROOP_COST, TROOP_SECONDS, DRONE_COST, DRONE_SECONDS

TROOP_FIELD = 7      # experiment: planet field of the training queue
TROOP_TIMER_KIND = 7  # guess


def resource(rtype):
    """The current planet's resource record of a type (created on demand, e.g. troops = 4)."""
    r = next((r for r in RESOURCES if r["type"] == rtype), None)
    if r is None:
        r = {"type": rtype, "amount": 0.0, "ts": time.time()}
        RESOURCES.append(r)
    return r


def troops_now():
    """Finished training jobs add troops (resource type 4) to their planet."""
    for job in [j for j in TROOP_JOBS if j["end"] <= time.time()]:
        TROOP_JOBS.remove(job)
        with on_planet(job.get("planet", HOME_PLANET)):
            resource(job.get("res", 4))["amount"] += job["count"]
        save_state()
        print(f"   troops: {job['count']} trained at {job.get('planet')}", flush=True)


DRONE_FIELD = 12      # experiment: planet field of the drone queue
DRONE_TIMER_KIND = 8   # guess


def troop_job_msg(job):
    kind = DRONE_TIMER_KIND if job.get("res", 4) == 5 else TROOP_TIMER_KIND
    timer = (pb.v(1, job["id"]) + pb.ld(2, ts(job["start"])) + pb.ld(3, ts(job["end"])) + pb.ld(4, ts(job["end"]))
             + pb.v(5, kind))
    return pb.ld(1, timer) + pb.v(2, job["yard"]) + pb.v(3, job["count"])


def handle_211(req):
    """Build spy drones (scanning array SPY DRONES tab): {1 scanner structure id, 2 count}. Same as troops, but
    resource type 5 and the planet field DRONE_FIELD queue."""
    return handle_209(req, res=5)


# moved to gofa_core/rules/ruleset.py: TUTORIAL_ENABLED

TUT_CLAIMED = set(globals().get("_tut_claimed", []))
TUT_LAST = [None]   # last statuses sent (283 is pushed again when they change)
TUT_CLAIMED_STATUS = [-1]   # (unused)
TUT_REWARD_LIST = [5]   # resources: granted, but the panel doesn't show list 5 (list 7 neither)   # experiment: which reward list carries resources (5 showed nothing)
TUT_CLAIMED_F2, TUT_CLAIMED_F3 = [2], [1]   # experiment: 283 entry for a claimed mission


def _structs(stype):
    return [st for st in _home_view()[0].values() if st["type"] == stype]


def _has_struct(stype, level=1):
    return any(st["level"] >= level for st in _structs(stype))


def _res_amount(rtype):
    return next((r["amount"] for r in _home_view()[2] if r["type"] == rtype), 0)


# moved to gofa_core/rules/ruleset.py: TUT_XP

TUTORIAL = [   # (id/type, requirement bytes, done(), reward {"res": {type: n}, "credits": n})
    (2, pb.v(2, 3) + pb.v(3, 1), lambda: _has_struct(3), {"res": {1: 300, 2: 150}}),
    (3, pb.v(2, 1) + pb.v(4, 2), lambda: _has_struct(1, 2), {"res": {1: 500, 2: 250, 3: 100}}),
    (4, pb.v(2, 3) + pb.v(4, 2), lambda: _has_struct(3, 2), {"res": {1: 500, 2: 250}}),
    (5, pb.v(2, 2) + pb.v(3, 1), lambda: _has_struct(2), {"res": {1: 800, 2: 400, 3: 200}, "ships": {1: 2}, "credits": 25}),
    (8, b"", lambda: sum(SHIPS.values()) > 0 or any(c.get("ships") for c in CARRIERS), {"res": {1: 500}}),
    (6, b"", lambda: len(CARRIERS) > 0, {"res": {1: 1000, 2: 500, 3: 250}}),
    (16, pb.v(2, 8) + pb.v(3, 1), lambda: _has_struct(8), {"res": {1: 400, 2: 200}}),
    (17, b"", lambda: _res_amount(5) > 0, {"res": {2: 300}}),
    (23, b"", lambda: bool(MISSIONS) or bool(REPORTS), {"res": {3: 300}}),   # not MISSION_ID: shared by all players
    (24, b"", lambda: bool(REPORTS), {"credits": 10}),
    (19, pb.v(2, 6) + pb.v(3, 1), lambda: _has_struct(6), {"res": {1: 400, 2: 200}}),
    (20, b"", lambda: _res_amount(4) > 0, {"res": {1: 300, 3: 150}}),
    (26, pb.v(2, 7) + pb.v(3, 1), lambda: _has_struct(7), {"res": {1: 600, 2: 300, 3: 300}}),
    (28, b"", lambda: bool(TECHS), {"credits": 10}),
    (37, b"", lambda: bool(SKILLS), {"credits": 10}),
    (42, b"", lambda: bool(JUMPGATE.get("planet")), {"credits": 20}),
    (10, b"", lambda: bool(COLONIES), {"res": {1: 1000, 2: 1000, 3: 1000}}),
    (29, pb.v(2, 10) + pb.v(3, 1), lambda: _has_struct(10), {"res": {1: 500, 2: 500}, "credits": 10}),
    (30, b"", lambda: bool(globals().get("TRADED", [False])[0]), {"credits": 10, "xp": 40}),
    (11, b"", lambda: "cargo" in TUT_FLAGS, {"res": {1: 500, 2: 500}, "xp": 40}),
    (12, b"", lambda: "deliver" in TUT_FLAGS, {"res": {1: 800, 2: 800, 3: 400}, "xp": 50}),
    (21, b"", lambda: "marines" in TUT_FLAGS, {"res": {1: 500, 3: 300}, "xp": 40}),
    (51, b"", lambda: "jumped" in TUT_FLAGS, {"credits": 20, "xp": 75}),
    (49, b"", lambda: player_level(XP_BOX[0]) >= 20, {"credits": 100, "xp": 125}),   # game text TUTORIAL_COMMANDER_LEVEL_10: "Reach level 20" (the id / key say 10; was 10)
    (14, b"", lambda: "battle" in TUT_FLAGS, {"credits": 20, "xp": 75}),
    (18, b"", lambda: "spied" in TUT_FLAGS, {"res": {2: 400}, "xp": 40}),
]
# moved to gofa_core/rules/ruleset.py: TUT_REWARDS

TUTORIAL = [(m, r, d, TUT_REWARDS.get(m, w)) for m, r, d, w in TUTORIAL]
TUT_FLAGS = set(globals().get("_tut_flags", []))   # one-off actions the tutorial checks (persisted)
TRADED = [bool(globals().get("_traded", False))]


# Star achievements (2026-11-04). Statics s21 like the tutorial, but field 2 (tutorial flag) 0 and field 8 = row: entries with the same field 8 are the
# stars of one row (client 0x1007212ac). Requirement kinds (0x100725198): field 2 + 4 structure level, 5 + 6 attribute counter (284) against a target,
# 7 planets, 8 carriers, 10 commander level; 0x100720450 shows the progress, the server decides what is ready (283). Rewards: guide, docs/ALLIANCES_GUIDE_NOTES.md.
ACH = globals().get("_ach") or {}
# moved to gofa_core/rules/ruleset.py: A_CREDITS, A_SPENT, A_BLUEPRINTS, A_ARTIFACTS, A_DAYS, A_STREAK, A_USED, A_RAID, A_VOID, A_MK3,
#     A_FREIGHTER2, A_FIGHTER2, A_INTERCEPTOR2, A_BOMBER2, MK1_SHIPS, MK2_SHIPS

def ach_count(attr):
    return ACH.get("c", {}).get(str(attr), 0)


def ach_add(attr, n):
    c = ACH.setdefault("c", {})
    c[str(attr)] = c.get(str(attr), 0) + int(n)


def owned_ships():
    out = {t for t, n in SHIPS.items() if n}
    for c in CARRIERS:
        out |= {int(t) for t, n in c.get("ships", {}).items() if n}
    return out


def ach_tick():
    """Counters the client cannot work out itself: credits, items, logins, Mk II ships. Returns True when one changed (284 push)."""
    now, before = time.time(), dict(ACH.get("c", {}))
    ACH.setdefault("first", now)
    cr, last = CREDITS_BOX[0], ACH.get("cr")
    if last is not None and cr != last:
        ach_add(A_CREDITS if cr > last else A_SPENT, abs(cr - last))
    ACH["cr"] = cr
    inv = ACH.setdefault("inv", {})
    for t, n in INVENTORY.items():
        d = n - inv.get(str(t), n)
        inv[str(t)] = n
        if d > 0 and t in range(4, 10):
            ach_add(A_BLUEPRINTS, d)
        elif d > 0 and t in (10, 11, 12):
            ach_add(A_ARTIFACTS, d)
        elif d < 0 and t in (10, 11, 12):
            ach_add(A_USED, -d)
        elif d > 0 and t == 17:
            ach_add(A_VOID, d)
    today = int(now // 86400)
    if ACH.get("day") != today:
        ACH["streak"] = ACH.get("streak", 0) + 1 if ACH.get("day") == today - 1 else 1
        ACH["day"] = today
    c = ACH.setdefault("c", {})
    c[str(A_STREAK)] = ACH["streak"]
    c[str(A_DAYS)] = int((now - ACH["first"]) // 86400)
    have = owned_ships()
    for a, t in ((A_FREIGHTER2, 9), (A_FIGHTER2, 2), (A_INTERCEPTOR2, 4), (A_BOMBER2, 6)):
        if t in have:
            c[str(a)] = 1
    if any(k.get("type", 1) in range(9, 13) for k in CARRIERS):
        c[str(A_MK3)] = 1
    return c != before


def best_structure(*types):
    sts = list(STRUCTURES.values()) + [st for ps in PLANET_STATE.values() for st in ps.get("structures", {}).values()]
    return max([st.get("level", 0) for st in sts if st.get("type") in types] + [0])


def _ach_req(raw, current, target):
    """A star requirement: (record bytes, done()); done.current / done.target are kept for the read-only /debug/quote?achievements=1 (the web page's tab)."""
    done = lambda: current() >= target
    done.current, done.target = current, target
    return raw, done


def ach_rows():
    each = lambda n: {10: n, 11: n, 12: n}
    ships = lambda ts, n: {t: n for t in ts}
    attr = lambda a, n: _ach_req(pb.v(5, a) + pb.v(6, n), lambda: ach_count(a), n)
    planets = lambda n: _ach_req(pb.v(7, n), lambda: len(own_planets()), n)
    carriers = lambda n: _ach_req(pb.v(8, n), lambda: len(CARRIERS), n)
    level = lambda n: _ach_req(pb.v(10, n), lambda: player_level(XP_BOX[0]), n)
    hq = lambda n: _ach_req(pb.v(2, 1) + pb.v(4, n), lambda: best_structure(1), n)
    extractor = lambda n: _ach_req(pb.v(2, 3) + pb.v(4, n), lambda: best_structure(3, 4, 5), n)
    xps = (500, 2500, 12500, 50000, 250000)
    return [   # in the order of the tab: (first ids, requirements, rewards)
        ((56, 57, 58, 59, 60), [attr(A_CREDITS, n) for n in (1000, 5000, 25000, 100000, 250000)],
         [{"items": each(a), "xp": x} for a, x in zip((1, 2, 3, 4, 5), xps)]),
        ((62, 63, 64, 65, 66), [attr(A_SPENT, n) for n in (500, 2500, 12500, 50000, 250000)],
         [{"items": each(a), "xp": x} for a, x in zip((1, 2, 3, 3, 5), xps)]),
        ((67, 68, 69, 70, 71), [attr(A_BLUEPRINTS, n) for n in (20, 50, 100, 500, 1000)], [{"items": each(a)} for a in (5, 10, 20, 30, 40)]),
        ((72, 73, 74, 75, 76), [attr(A_ARTIFACTS, n) for n in (100, 250, 500, 5000, 10000)], [{"credits": n} for n in (100, 250, 500, 1000, 5000)]),
        ((77, 78, 79, 80, 81), [planets(n) for n in (3, 5, 10, 15, 30)],
         [{"credits": 250, "xp": 100}, {"credits": 500, "xp": 200, "ships": ships(MK1_SHIPS, 10)}, {"credits": 1000, "xp": 1000, "ships": ships(MK2_SHIPS, 25)},
          {"credits": 5000, "xp": 5000}, {"credits": 25000, "xp": 50000, "ships": ships(MK2_SHIPS, 100)}]),
        ((82, 83, 84, 85, 86), [carriers(n) for n in (3, 5, 10, 15, 30)],
         [{"ships": {1: 5}}, {"ships": ships(MK1_SHIPS, 25)}, {"ships": ships(MK2_SHIPS, 25)}, {"ships": ships(MK2_SHIPS, 50)}, {"ships": ships(MK2_SHIPS, 100)}]),
        ((87, 88, 89, 90, 91), [attr(A_DAYS, n) for n in (3, 14, 30, 90, 180)], [{"credits": n} for n in (100, 250, 1000, 2500, 5000)]),
        ((92, 121, 122, 123, 124), [attr(A_STREAK, n) for n in (3, 14, 30, 90, 180)], [{"credits": n} for n in (100, 500, 1000, 2500, 5000)]),
        ((93, 94, 95, 96, 97), [level(n) for n in (25, 50, 100, 200, 300)], [{"credits": n} for n in (100, 250, 1000, 2500, 5000)]),
        ((98, 99, 100, 101, 102), [attr(A_USED, n) for n in (10, 50, 100, 250, 1000)], [{"xp": x} for x in xps]),
        ((103, 104, 105, 106, 120), [hq(n) for n in (4, 8, 12, 16, 20)], [{"credits": n} for n in (100, 500, 1000, 2500, 5000)]),
        ((107, 108, 109, 110, 111), [extractor(n) for n in (4, 8, 12, 16, 20)], [{"credits": n} for n in (50, 250, 500, 1000, 2500)]),
        ((113,), [attr(A_MK3, 1)], [{"xp": 25000}]),
        ((114,), [attr(A_FREIGHTER2, 1)], [{"xp": 25000}]),
        ((116,), [attr(A_FIGHTER2, 1)], [{"xp": 25000}]),
        ((117,), [attr(A_INTERCEPTOR2, 1)], [{"xp": 25000}]),
        ((118,), [attr(A_BOMBER2, 1)], [{"xp": 25000}]),
        ((126, 127, 128, 129, 130), [attr(A_RAID, n) for n in (5000, 25000, 100000, 500000, 2000000)], [{"credits": n} for n in (100, 250, 500, 1000, 5000)]),
        ((133, 134, 135, 136, 137), [attr(A_VOID, n) for n in (50, 250, 1000, 5000, 20000)], [{"credits": n} for n in (100, 250, 500, 1000, 5000)]),   # rewards not seen
    ]


ACHIEVEMENTS = [(i, req, done, {"xp": 0, **rw}, row) for row, (ids, reqs, rws) in enumerate(ach_rows(), 1)
                for i, (req, done), rw in zip(ids, reqs, rws)]


def ach_def(d):
    mid, req, _, reward, row = d
    rw = b"".join(pb.ld(1, pb.v(1, t) + pb.v(2, n)) for t, n in sorted(reward.get("items", {}).items()))
    rw += b"".join(pb.ld(3, pb.v(1, t) + pb.v(2, n)) for t, n in sorted(reward.get("ships", {}).items()))
    if reward.get("credits"):
        rw += pb.ld(2, pb.v(1, reward["credits"]))
    if reward.get("xp"):
        rw += pb.ld(4, pb.v(1, reward["xp"]))
    return pb.v(1, mid) + pb.v(2, 0) + pb.ld(3, pb.v(1, 1) + pb.ld(2, req)) + pb.v(4, 0) + pb.v(5, 0) + pb.v(6, 0) + pb.ld(7, rw) + pb.v(8, row)


def tutorial_def(d):
    mid, req, _, reward = d
    params = pb.v(1, 1) + (pb.ld(2, req) if req else b"")
    rw = b"".join(pb.ld(TUT_REWARD_LIST[0], pb.v(1, t) + pb.v(2, n)) for t, n in sorted(reward.get("res", {}).items()))
    rw += b"".join(pb.ld(3, pb.v(1, t) + pb.v(2, n)) for t, n in sorted(reward.get("ships", {}).items()))
    if reward.get("credits"):
        rw += pb.ld(2, pb.v(1, reward["credits"]))   # list 2 = CREDITS (shown)
    rw += pb.ld(4, pb.v(1, reward.get("xp", TUT_XP)))    # list 4 = EXPERIENCE POINTS (shown)
    return pb.v(1, mid) + pb.v(2, mid) + pb.ld(3, params) + pb.v(4, 0) + pb.v(5, 0) + pb.v(6, 0) + pb.ld(7, rw)


def tutorial_status():
    out = []
    for d in TUTORIAL + ACHIEVEMENTS:
        mid, done = d[0], d[2]
        try:
            ok = done()
        except Exception:
            ok = False
        out.append((mid, TUT_CLAIMED_STATUS[0] if mid in TUT_CLAIMED else 2 if ok else 0))
    return out


def handle_283(req):
    """Tutorial progress: {1 {1 [{1 mission id*, 2 status, 3}]}}."""
    st = tutorial_status()
    TUT_LAST[0] = st
    def ent(mid, status):
        if mid in TUT_CLAIMED:
            return pb.v(1, mid) + pb.v(2, TUT_CLAIMED_F2[0]) + pb.v(3, TUT_CLAIMED_F3[0])
        return pb.v(1, mid) + pb.v(2, status) + pb.v(3, 0)
    return pb.ld(1, b"".join(pb.ld(1, ent(mid, status)) for mid, status in st))


def handle_282(req):
    """Collect a tutorial reward: {1 mission id} -> {1 mission id} + 283 / 103 / 115 pushes."""
    mid = next((v for f, wt, v in pb.fields(req) if f == 1), 0)
    d = next((d for d in TUTORIAL + ACHIEVEMENTS if d[0] == mid), None)
    if d and mid not in TUT_CLAIMED:
        TUT_CLAIMED.add(mid)
        reward = d[3]
        with on_planet(HOME_PLANET):
            settle_resources()
            for t, n in reward.get("res", {}).items():
                r = resource(t)
                r["amount"] = min(capacity(), r["amount"] + n)
            for t, n in reward.get("ships", {}).items():
                SHIPS[t] = SHIPS.get(t, 0) + n
        CREDITS_BOX[0] += reward.get("credits", 0)
        XP_BOX[0] += reward.get("xp", TUT_XP) * xp_mult()
        for t, n in reward.get("items", {}).items():
            INVENTORY[t] = INVENTORY.get(t, 0) + n
        if reward.get("res"):   # the reward panel can't show resources: list them in a mail instead
            add_mail(kind=1, body="Tutorial reward delivered to Home1: "
                     + ", ".join(f"{n} {RES_NAMES[t]}" for t, n in sorted(reward["res"].items())) + ".")
        save_state()
        print(f"   tutorial: mission {mid} claimed, reward {reward}", flush=True)
    return [(282, pb.v(1, mid)), (283, handle_283(b"")), (103, planet_details()), (115, handle_115(b"")),
            (119, handle_119(b"")), (272, handle_272(b""))]


def tutorial_changed():
    return TUTORIAL_ENABLED and TUT_LAST[0] is not None and tutorial_status() != TUT_LAST[0]


def handle_208(req):
    """Trade centre exchange: {1 trade centre id, 2 from resource type, 3 amount, 4 to resource type} -> {} + 103."""
    f = {n: v for n, wt, v in pb.fields(req)}
    pid = planet_of_structure(f.get(1, 0))
    src, amount, dst = f.get(2, 1), f.get(3, 0), f.get(4, 2)
    with on_planet(pid):
        settle_resources()
        have = resource(src)
        amount = min(amount, int(have["amount"]))
        have["amount"] -= amount
        to = resource(dst)
        ratio = yard_percent(10, yard_level(f.get(1, 0), 10, pid)) / 100
        to["amount"] = min(capacity(), to["amount"] + amount / ratio)
    save_state()
    TRADED[0] = True
    print(f"   trade: {amount} of {src} -> {dst} on {pid}", flush=True)
    return [(208, b""), (103, planet_details(pid))]


STATS = {int(k): v for k, v in globals().get("_stats", {}).items()}   # statistics counters (persisted)


def handle_285(req):
    """Counter update {1 id*, 2 value*} (sent with most polls; no response type; ids like 103 - maybe the attribute
    ids of the 284 list) - stored only."""
    f = {n: v for n, wt, v in pb.fields(req)}
    if f.get(1):
        STATS[f[1]] = f.get(2, 0)
    return None


BOOKMARKS = list(globals().get("_bookmarks", []))   # [{"id", "planet", "type", "name", "ts"}] (persisted)


def bookmark_msg(b, owner_pid=None):
    """Bookmark 0x100c64020 {1 id*, 2 owner player record*, 3 planet id*, 4 name*, 5 type 1 call / 2 alliance / 3 private* (tabs CALL / ALLIANCE / PRIVATE),
    6 Timestamp*, 7 player, 8}. owner_pid = an alliance mate's shared bookmark (id made unique per owner)."""
    if owner_pid is None:
        bid, owner = b["id"], pb.v(1, PLAYER_ID) + pb.ld(2, PLAYER["alias"]) + pb.v(3, 1)
    else:
        bid, owner = (int(owner_pid) & 0xFFFF) << 32 | b["id"], player_rec(int(owner_pid))
    return (pb.v(1, bid) + pb.ld(2, owner) + pb.v(3, b["planet"]) + pb.ld(4, b.get("name", ""))
            + pb.v(5, b.get("type", 3)) + pb.ld(6, ts(b.get("ts", time.time()))))


# moved to gofa_core/rules/ruleset.py: BOOKMARK_SHARED

def shared_bookmarks():
    """(owner pid, bookmark) for the alliance mates' CALL / ALLIANCE bookmarks. Galaxy DIPLOMACY counters: the client
    (0x10065fb04) asks 103 for the planets of CALL (type 1) bookmarks owned by others and counts them per system by owner
    relation (0x100677800 modes 1 friendly / 2 other)."""
    a = alliance_of(CUR_PLAYER[0])
    out = []
    for m in (a["members"] if a else {}):
        if int(m) == CUR_PLAYER[0]:
            continue
        st = _player_save(int(m)) or {}
        out += [(int(m), b) for b in st.get("bookmarks", []) if b.get("type") in BOOKMARK_SHARED]
    return out


# moved to gofa_core/rules/ruleset.py: NPC_REGEN_SECONDS, PIRATE_RAIDS, RAID_MIN, RAID_MAX

RAIDS = {int(k): v for k, v in globals().get("_raids", {}).items()}   # colony -> next raid time (persisted)


def nearest_npc(pid):
    pos = planet_pos(pid)
    best = None
    for npid, npc in NPC_PLANETS.items():
        q = planet_pos(npid)
        if pos and q:
            d = math.hypot(pos[0] - q[0], pos[1] - q[1])
            if best is None or d < best[0]:
                best = (d, npid, npc)
    return best


# moved to gofa_core/rules/ruleset.py: PDEF_STRENGTH

def pirate_raids():
    """Colonies (never the home system) are raided by the nearest pirate base every RAID_MIN..RAID_MAX seconds, at
    level colony HQ // 2 (min 1). A Void planet within VOID_RAID_RANGE can answer a due raid instead (void_raid_source:
    a share of its ships goes raiding). Returns the raided planets."""
    import random
    voids = void_accounts()
    if any(a["player"] == CUR_PLAYER[0] for a in voids):   # a Void's own planets are not raided by pirates (tick_others runs every account); a plain species-4 player is
        return []
    void_on = VOID_RAIDS and bool(voids)
    if not PIRATE_RAIDS or not (NPC_PLANETS or void_on):
        return []
    now, hit = time.time(), []
    for pid in own_planets()[1:]:
        if pid not in RAIDS:
            RAIDS[pid] = now + random.uniform(RAID_MIN, RAID_MAX)
            continue
        if RAIDS[pid] > now:
            continue
        overdue = now - RAIDS[pid] > RAID_MAX   # timer ran out while the server was offline: no catch-up raid
        RAIDS[pid] = now + random.uniform(RAID_MIN, RAID_MAX)
        if overdue or hit:   # at most one raid per pass (several due at once used to land together)
            continue
        near = nearest_npc(pid) if NPC_PLANETS else None
        vsrc = void_raid_source(pid) if void_on else None
        if vsrc and near and random.random() >= VOID_RAID_CHANCE:
            vsrc = None   # the pirates take this one
        if not near and not vsrc:
            continue
        who = "Void" if vsrc else "Pirate"
        log_battle(pid)
        if vsrc:   # a share of the nearest Void planet's ships; the enemy id is the Void's player id (101 answers it: species 4)
            npc, raiders = {"name": vsrc["alias"], "id": vsrc["player"]}, vsrc["party"]
        else:
            _, npid, npc = near
            with on_planet(pid):
                rlevel = max(1, max([st["level"] for st in STRUCTURES.values() if st["type"] == 1] + [1]) // 2)
            base = pirate_base(rlevel)["fleet"]   # raid level follows the colony's own HQ (HQ // 2), not the home HQ (user, 2026-10-23)
            raiders = {t: round(v / 2) for t, v in base.items() if round(v / 2)} or {1: 1}   # raiding party = half a base fleet of that level
        me = CUR_PLAYER[0]
        station = station_at(pid, me)   # carriers parked at the colony (own + allies'); swaps players for a moment
        station, _fled = flee_station(station, pid)   # avoid-combat carriers with a refuge leave before the raid
        carrier_ships, own_carrier_ships = engaged_ships(station), engaged_ships(station, me)
        with on_planet(pid):
            settle_resources()
            ships_now()
            planet_def = {t: n for t, n in SHIPS.items() if n}
            defenders = add_ships(planet_def, carrier_ships)   # the planet's ships + the ships on engaging carriers parked there
            dlevel = sum(st["level"] for st in STRUCTURES.values() if st["type"] == 9)
            mine = fleet_strength(defenders, raiders, own=True, shield=defence_bonus(dlevel)) + PDEF_STRENGTH * dlevel
            theirs = fleet_strength(raiders, defenders)
            held = mine > theirs * random.uniform(0.8, 1.2)
            if not held:
                carrier_escape(station)   # the raiders won: the parked carriers try to escape
            esc = escape_line(station)
            lines = [f"{who} raid by {npc['name']} on your colony: {'REPELLED' if held else 'LOST'}."]
            lines.append(f"Raiders: {fmt_ships(raiders)}. Defenders: {fmt_ships(defenders)}"
                         f"{f', planetary defence level {dlevel}' if dlevel else ''}.")
            stolen = {}
            if held:
                lines.append(f"The {'Void ships were destroyed' if vsrc else 'pirates retreated'}.")
            else:
                loss = 0.3
                for t in list(SHIPS):
                    SHIPS[t] = SHIPS[t] - round(SHIPS[t] * loss)
                for r in RESOURCES:
                    if r["type"] in (1, 2, 3):
                        n = int(r["amount"] * 0.1)
                        r["amount"] -= n
                        stolen[r["type"]] = n
                lines.append(f"Stolen: {', '.join(f'{n} {RES_NAMES[t]}' for t, n in stolen.items())}; 30% of the stationed ships were lost.")
        own_def = add_ships(planet_def, own_carrier_ships)
        after = {t: n for t, n in planet_def.items()} if held else {t: n - round(n * 0.3) for t, n in planet_def.items()}
        after = add_ships(after, *(after_ships(e["ships"], 0 if held else 0.3) for e in station if e["behaviour"] == 1 and e["owner"] == me))
        add_mail(kind=BATTLE_MAIL_KIND, body=lines[0], battle={
            "planet": pid, "enemy": npc["name"], "enemy_id": npc.get("id", 900001), "attacker": False,
            "mine": own_def, "theirs": raiders, "mine_after": after, "theirs_after": {} if held else raiders,
            "result": 2 if held else 1, **station_kw(station)})   # result is from the attacker's (pirates') side
        if not held:
            add_mail(kind=1, body="\n".join([lines[0], lines[-1]] + ([esc] if esc else [])))
        if vsrc:
            void_raid_done(vsrc, held, stolen)
        settle_station(station, 0 if held else 0.3, False, f"{who}s raided {pid}, where your carriers were stationed: "
                       f"{'REPELLED' if held else 'LOST'}." + (f"\n{esc}" if esc else ""), skip_mail=me)   # engaged carriers' ships take the raid's loss; failed escapes are destroyed
        print("   raid: " + " / ".join(lines), flush=True)
        hit.append(pid)
    save_state()
    return hit
# moved to gofa_core/rules/ruleset.py: NPC_NAMES, base_level_of, pirate_base


def void_raid_source(pid):
    """The Void planet that may raid colony `pid`: the nearest planet of any Void within VOID_RAID_RANGE map units. The party is VOID_RAID_SHARE of
    the ships on it (whole ships, none = no raid). Returns {"player", "alias", "planet", "party"} or None."""
    pos = planet_pos(pid)
    if not pos:
        return None
    best = None
    for a in void_accounts():
        for p, o in OWNERS.items():
            q = planet_pos(p) if o == a["player"] else None
            if q:
                d = math.hypot(pos[0] - q[0], pos[1] - q[1])
                if d <= VOID_RAID_RANGE and (best is None or (d, p) < best[:2]):
                    best = (d, p, a)
    if not best:
        return None
    _, p, a = best
    with as_player(a["player"]):
        with on_planet(p):
            party = {t: int(n * VOID_RAID_SHARE) for t, n in SHIPS.items() if int(n * VOID_RAID_SHARE) > 0}
    return {"player": a["player"], "alias": a["alias"], "planet": p, "party": party} if party else None


def _player_ships(planet):
    """The ships stationed on `planet` of the current player."""
    with on_planet(planet):
        return {t: n for t, n in SHIPS.items() if n}


def void_raid_done(src, held, stolen):
    """A repelled raid destroys the party (the Void planet loses those ships; the gate builds more); a lost one brings the loot home."""
    with as_player(src["player"]):
        with on_planet(src["planet"]):
            if held:
                for t, n in src["party"].items():
                    SHIPS[t] = max(0, SHIPS.get(t, 0) - n)
            for r in RESOURCES:
                r["amount"] += stolen.get(r["type"], 0)
            left = sum(n for n in SHIPS.values() if n)
        save_state()
    print(f"   void raid: party of {sum(src['party'].values())} from planet {src['planet']} "
          f"{'destroyed' if held else 'back home with the loot'}; {left} ships left there", flush=True)

def home_hq_level():
    with on_planet(HOME_PLANET):
        return max([st["level"] for st in STRUCTURES.values() if st["type"] == 1] + [1])


def npc_level(dist):
    """Pirate base level: grows with distance from the start planet, and with the player's home HQ (HQ / 2) so
    late-game bases (and their raids, half the base fleet) stay worth attacking."""
    return max(1 + int(dist // 4), home_hq_level() // 2)


def seed_npcs(start, n=8):
    """Pirate bases in the n systems nearest the start planet (planet 2 of each), defences growing with distance."""
    sp = planet_pos(start)
    if sp is None:
        return
    x, y = start // 10**11, (start // 10**7) % 10**4
    cands = []
    for sx in range(x - 1, x + 2):
        for sy in range(y - 1, y + 2):
            for sid, name, planets in sector_systems(sx, sy):
                if len(planets) < 2 or system_of(sid + 100) == system_of(start):
                    continue
                pos = planet_pos(sid + 100)
                if pos:
                    cands.append((math.hypot(pos[0] - sp[0], pos[1] - sp[1]), planets[1]))
    for i, (dist, pid) in enumerate(sorted(cands)[:n]):
        if pid in own_planets() or pid in NPC_PLANETS or pid in OWNERS:
            continue
        lvl = npc_level(dist)
        NPC_PLANETS[pid] = {"id": 900100 + i, "name": NPC_NAMES[i % len(NPC_NAMES)], "race": 2, "f2": 2, **pirate_base(lvl)}
    save_state()


NPC_MIN = int(os.environ.get("GOFA_NPC_MIN", "6"))                       # keep at least this many pirate bases
# moved to gofa_core/rules/ruleset.py: NPC_RESPAWN_SECONDS

NPC_NEXT = [globals().get("_npc_next", 0)]   # time of the next respawn (persisted as "npc_next")


def npc_respawn():
    """Conquered pirate bases are replaced over time: while fewer than NPC_MIN remain, a new base appears every
    NPC_RESPAWN_SECONDS on planet 2 of the nearest system around the jumpgate planet that has no base or colony
    yet (search widens by one sector ring each try, up to 3). Called from the 281 poll."""
    start = JUMPGATE.get("planet")
    if not start or len(NPC_PLANETS) >= NPC_MIN:
        return None
    now = time.time()
    if NPC_NEXT[0] == 0:
        NPC_NEXT[0] = now + NPC_RESPAWN_SECONDS
        save_state()
        return None
    if now < NPC_NEXT[0]:
        return None
    NPC_NEXT[0] = now + NPC_RESPAWN_SECONDS
    sp = planet_pos(start)
    if sp is None:
        return None
    taken = {system_of(p) for p in list(own_planets()) + list(NPC_PLANETS) + list(OWNERS)}
    x, y = start // 10**11, (start // 10**7) % 10**4
    for r in (1, 2, 3):
        cands = []
        for sx in range(x - r, x + r + 1):
            for sy in range(y - r, y + r + 1):
                for sid, name, planets in sector_systems(sx, sy):
                    if len(planets) < 2 or system_of(planets[1]) in taken:
                        continue
                    pos = planet_pos(planets[1])
                    if pos:
                        cands.append((math.hypot(pos[0] - sp[0], pos[1] - sp[1]), planets[1]))
        if cands:
            dist, pid = min(cands)
            i = max([v.get("id", 900100) for v in NPC_PLANETS.values()] + [900100]) + 1
            lvl = npc_level(dist)
            NPC_PLANETS[pid] = {"id": i, "name": NPC_NAMES[i % len(NPC_NAMES)], "race": 2, "f2": 2, **pirate_base(lvl)}
            save_state()
            print(f"   npc: new pirate base {NPC_NAMES[i % len(NPC_NAMES)]} on {pid} (level {lvl})", flush=True)
            return pid
    save_state()
    return None


# ---- Void planets (2026-11-13; numbers and rules: gofa_core/rules/ruleset.py "Void planets", sources in docs/FORUM_NOTES.md) ----
VOID_PAYOUT = [0]   # crystals the last attack_player win paid; finish_moves shares them and clears it
VOID_AUTO_HOURS = float(os.environ.get("GOFA_VOID_AUTO_HOURS", "0"))   # > 0: a new Void event this many hours after none is left (0 = started by hand only)
VOID_NEXT = [0]


def is_void(pid):
    return bool(pid) and race_of(pid) == VOID_RACE


def void_accounts():
    return [a for a in ACCOUNTS["accounts"] if a.get("void")]


def void_payout(pid, planet):
    """The crystals the Void planet pays when it falls: paid once (the entry in the account's void meta is used up)."""
    a = next((a for a in void_accounts() if a["player"] == pid), None)
    n = a["void"]["crystals"].pop(str(planet), 0) if a else 0
    if n:
        _write_json(ACCOUNTS_FILE, ACCOUNTS)
    return n


def give_crystals(n, planet):
    """The current player found n Void crystals (inventory item 17, a mail)."""
    if n > 0:
        INVENTORY[17] = INVENTORY.get(17, 0) + n   # (ach_tick counts the VOID HUNTER progress from the item)
        add_mail(kind=1, body=f"You found {n} Void crystal{'s' if n != 1 else ''}! (Void planet {planet}) {'They are' if n != 1 else 'It is'} in the commander's ITEMS tab.")
        PENDING_PLANET_PUSH[:] = [time.time()]


def void_event_planets(near, n):
    """n free outer planets around planet `near` for a Void event: systems nobody holds a planet in, the third planet of a system (the second is the
    pirate base's) or else the second, random among the 3n nearest."""
    import random
    x, y = near // 10**11, (near // 10**7) % 10**4
    sp = planet_pos(near)
    held = set(OWNERS) | set(NPC_PLANETS)
    taken = {system_of(p) for p in held}
    cands = []
    for r in (1, 2, 3):
        cands = []
        for sx in range(x - r, x + r + 1):
            for sy in range(y - r, y + r + 1):
                for sid, name, planets in sector_systems(sx, sy):
                    pool = [p for p in (planets[2:] or planets[1:2]) if p not in held]
                    pos = planet_pos(pool[0]) if pool else None
                    if pos and sp and system_of(pool[0]) not in taken and system_of(pool[0]) != HOME_SYSTEM:
                        cands.append((math.hypot(pos[0] - sp[0], pos[1] - sp[1]), pool[0]))
        if len(cands) >= n:
            break
    cands.sort()
    near_ones = [p for _, p in cands[:3 * n]]
    return random.sample(near_ones, min(n, len(near_ones)))


def spawn_void(near=None, n=3, level=VOID_LEVEL):
    """Start one Void event: a new species-4 account "VOID #n" owns n outer planets near `near` (default: a random player's jumpgate planet).
    The first planet is its jumpgate ("wormhole"), the rest are colonies; each holds the fleet of `level`, planetary defence, a garrison, a stock.
    Returns the account or None (no player to appear near, or no free planets)."""
    import random
    if near is None:
        gates = [JUMPGATE.get("planet")] + [((_player_save(a["player"]) or {}).get("jumpgate") or {}).get("planet")
                                            for a in ACCOUNTS["accounts"] if not a.get("void") and a["player"] != CUR_PLAYER[0]]
        gates = [g for g in gates if g]
        if not gates:
            return None
        near = random.choice(gates)
    planets = void_event_planets(int(near), n)
    if not planets:
        return None
    now, base = time.time(), void_base(level)
    k = max([int(a["alias"].split("#")[1]) for a in void_accounts() if "#" in a["alias"]] + [2052]) + 1
    a = account_for(f"VOID #{k}")
    a["race"] = VOID_RACE
    a["void"] = {"level": level, "crystals": {str(p): base["crystals"] for p in planets}, "regen": now + VOID_REGEN_SECONDS,
                 "fleet": {str(t): c for t, c in base["fleet"].items()}}
    _write_json(ACCOUNTS_FILE, ACCOUNTS)
    with as_player(a["player"]):
        for p in planets:
            PLANET_STATE[str(p)] = {
                "structures": {"0": {"type": 1, "slot": 0, "level": 1}, "1": {"type": 9, "slot": 1, "level": base["pd"]}}, "builds": [],
                "resources": [{"type": t, "amount": base["stock"], "ts": now} for t in (1, 2, 3)] + [{"type": 4, "amount": base["troops"], "ts": now}],
                "ships": {str(t): c for t, c in base["fleet"].items()}, "ship_jobs": [], "carrier_jobs": []}
            OWNERS[p] = a["player"]
        JUMPGATE.clear()
        JUMPGATE.update({"planet": planets[0], "ts": now})
        COLONIES[:] = planets[1:]
        save_state()
    print(f"   void: {a['alias']} appeared on {planets} (level {level}, {base['crystals']} crystals per planet)", flush=True)
    return a


def void_tick():
    """Poll hook. A Void's jumpgate planet makes new ships every VOID_REGEN_SECONDS (a share of the full fleet, up to it); a Void with no planet
    left is removed; with GOFA_VOID_AUTO_HOURS a new event starts that long after none is left."""
    now, live = time.time(), 0
    for a in list(void_accounts()):
        pid, meta = a["player"], a["void"]
        if not any(o == pid for o in OWNERS.values()):   # every planet was taken (or abandoned)
            ACCOUNTS["accounts"].remove(a)
            _write_json(ACCOUNTS_FILE, ACCOUNTS)
            _SAVE_CACHE.pop(pid, None)
            try:
                os.remove(player_file(pid))
            except OSError:
                pass
            print(f"   void: {a['alias']} is gone", flush=True)
            continue
        live += 1
        if now >= meta.get("regen", 0):
            meta["regen"] = now + VOID_REGEN_SECONDS
            _write_json(ACCOUNTS_FILE, ACCOUNTS)
            with as_player(pid):
                gate = JUMPGATE.get("planet")
                if gate:
                    with on_planet(gate):
                        for t, full in meta["fleet"].items():
                            have = SHIPS.get(int(t), 0)
                            if have < full:
                                SHIPS[int(t)] = min(full, have + max(1, round(full * VOID_REGEN_SHARE)))
                del MAIL[:]   # battle mails pile up in an account nobody reads
                del REPORTS[:]
                save_state()
    if VOID_AUTO_HOURS > 0 and not live:
        if not VOID_NEXT[0]:
            VOID_NEXT[0] = now + VOID_AUTO_HOURS * 3600
        elif now >= VOID_NEXT[0]:
            VOID_NEXT[0] = 0
            spawn_void()


def seed_bookmarks(start, n=12):
    """Bookmark the first planet of the n systems nearest to the start planet (the galaxy map's close zoom draws no
    systems yet, so bookmarks are the way to reach other systems). Field 6 = when a CALL bookmark expires (1 h after
    it), so these carry a far-future time."""
    sp = planet_pos(start)
    if sp is None:
        return
    x, y = start // 10**11, (start // 10**7) % 10**4
    cands = []
    for sx in range(x - 1, x + 2):
        for sy in range(y - 1, y + 2):
            for sid, name, *_ in sector_systems(sx, sy):
                pid = sid + 100   # planet 1 of the system
                pos = planet_pos(pid)
                if pos and system_of(pid) != system_of(start):
                    cands.append((math.hypot(pos[0] - sp[0], pos[1] - sp[1]), pid))
    have = {b["planet"] for b in BOOKMARKS}
    for _, pid in sorted(cands)[:n]:
        if pid not in have:
            JOB_ID[0] += 1
            BOOKMARKS.append({"id": JOB_ID[0], "planet": pid, "type": 3, "name": "", "ts": time.time() + 10 * 365 * 86400})
    save_state()


def handle_267(req):
    """Bookmark list (login): {1 {1 [bookmark]}}. The galaxy map ignores the login copy (its 267 listener 0x10065f7a0
    needs game state +0x260 == 2), so alliance members get it again with the next in-game 281 poll."""
    if req is not None and alliance_of(CUR_PLAYER[0]):
        PENDING_ALLIANCE_PUSH.add(CUR_PLAYER[0])
    return pb.ld(1, b"".join(pb.ld(1, bookmark_msg(b)) for b in BOOKMARKS)
                 + b"".join(pb.ld(1, bookmark_msg(b, m)) for m, b in shared_bookmarks()))


def handle_269(req):
    """Add bookmark: {1 bookmark (id 0)} -> no 269 response type known: push the list (267)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    b = {n: v for n, wt, v in pb.fields(f.get(1, b""))}
    JOB_ID[0] += 1
    BOOKMARKS.append({"id": JOB_ID[0], "planet": b.get(3, 0), "type": b.get(5, 3),
                      "name": (b.get(4) or b"").decode(errors="replace"), "ts": time.time()})
    save_state()
    print(f"   bookmark: {BOOKMARKS[-1]}", flush=True)
    a = alliance_of(CUR_PLAYER[0])
    if a and BOOKMARKS[-1]["type"] in BOOKMARK_SHARED:   # mates get the new shared bookmark (267) on their next poll
        PENDING_ALLIANCE_PUSH.update(int(m) for m in a["members"] if int(m) != CUR_PLAYER[0])
    return [(267, handle_267(None))]


def handle_322(req):
    """Alliance chat channel {1 string, 2 int64} (polled ~10 s; the client copies field 1 to the chat manager +0x60 and
    then runs the alliance Photon connect 0x1003937ec, which subscribes to it). Empty = no alliance chat."""
    a = alliance_of(CUR_PLAYER[0])
    if not a:
        return b""
    aid = next(k for k, v in ALLIANCES.items() if v is a)
    return pb.ld(1, f"alliance_{aid}") + pb.v(2, int(aid))


def handle_326(req):
    """Global chat channel {1 string} (chat manager +0xc8, subscribed by the global Photon client)."""
    return pb.ld(1, "global")


def handle_325(req):
    """Experiment: {1 [{1 id, 2 Timestamp, 3 string, 4 string}]} (maybe news)."""
    return pb.ld(1, pb.v(1, 1) + pb.ld(2, ts(time.time())) + pb.ld(3, "NEWS-3 title") + pb.ld(4, "NEWS-4 body text"))


SPY_F4 = [1]   # 0 left the viewer on "Loading message"; 1 + field 1 = target planet (a packed location) renders
SPY_MAIL_KIND = [6]   # REPORTS / ESPIONAGE "Spy Report" (details variant 6, field 1 = target planet); was: experiment (6 = REPORTS / ESPIONAGE "Spy Report", details variant 6 still "Loading message"); 0 = off: mail kind of espionage reports (REPORTS / ESPIONAGE tab?)


# moved to gofa_core/rules/ruleset.py: SPY_SUCCESS_BASE, SPY_SUCCESS_PER_LEVEL, SPY_SUCCESS_DRONES, SPY_SUCCESS_SCALE, SPY_SUCCESS_MAX,
#     SPY_DETECT_PLAYER, SPY_DETECT_NPC, SPY_DETECT_PER_DRONE, SPY_DETECT_PER_LEVEL, SPY_DETECT_MIN, SPY_DETECT_MAX, SPY_ANONYMOUS,
#     SPY_COST, SPY_S2, SPY_EFF_MIN, SPY_DISTANCE_EFF

def scanner_level(pid, owner=None):
    """Highest scanning array (structure 8) level on planet pid; owner = another player (reads their save)."""
    if owner:
        sts = ((_player_save(owner) or {}).get("planet_state", {}).get(str(pid), {}).get("structures", {}) or {}).values()
    else:
        with on_planet(pid):
            sts = list(STRUCTURES.values())
    return max([st.get("level", 0) for st in sts if st.get("type") == 8] + [0])


# moved to gofa_core/rules/ruleset.py: spy_success_chance

def spy_detect_chance(target, drones, level):
    owner = other_owner(target)
    base = SPY_DETECT_PLAYER if owner else SPY_DETECT_NPC if npc_at(target) else 0
    if not base:
        return 0.0
    their = scanner_level(target, owner) if owner else 0
    return min(SPY_DETECT_MAX, max(SPY_DETECT_MIN, base + SPY_DETECT_PER_DRONE * (drones - 1)
                                   + SPY_DETECT_PER_LEVEL * (their - level)))


def spy_limits(drones, level, src, target):
    d = travel_distance(src, target)
    v = drones * level * max(SPY_EFF_MIN, 1 - (1.0 if d is None else d) / SPY_DISTANCE_EFF)
    return {k: math.ceil(max(0.0, v - t) / t) for k, t in SPY_COST.items()}


# moved to gofa_core/rules/ruleset.py: spy_view

def spy_lines(name, fleet, troops, res, seen_fleet, seen_troops, seen_res, seen_st=(), level_txt=""):
    total = sum(fleet.values())
    hidden = total - sum(seen_fleet.values())
    lines = [f"Espionage report: {name}'s planet{level_txt}.", f"Fleet: about {total} ships in total."]
    if seen_fleet:
        lines.append(f"Identified: {fmt_ships(seen_fleet)}" + (f" (+{hidden} unidentified)." if hidden else "."))
    elif total:
        lines.append("We got no information on ship types.")
    lines.append(f"Troops: {seen_troops}." if seen_troops is not None else "Unable to gain information on troops.")
    lines.append("Resources: " + (", ".join(f"{n} {RES_NAMES.get(t, t)}" for t, n in sorted(seen_res.items()))
                                  if seen_res else "no information") + ".")
    if len(seen_fleet) < len([n for n in fleet.values() if n]) or seen_troops is None or len(seen_res) < 3:
        lines.append("More spy drones or a higher scanning array level would identify more.")
    return lines


def handle_327(req):
    """Send spy drones: {1 scanner id, 2 target planet, 3 drones, 4} -> {1 echo, 2 id} + an espionage report
    (kind-6 Spy Report for pirates; text mail for players / unowned planets). The drones are used up."""
    import random
    f = {n: v for n, wt, v in pb.fields(req)}
    scanner, target, drones = f.get(1, 0), f.get(2, 0), max(1, f.get(3, 1))
    home = planet_of_structure(scanner)
    with on_planet(home):
        r = resource(5)
        r["amount"] = max(0, r["amount"] - drones)
    level = scanner_level(home)
    npc, owner, me = npc_at(target), other_owner(target), CUR_PLAYER[0]
    JOB_ID[0] += 1
    TUT_FLAGS.add("spied")
    reply = [(327, pb.ld(1, req) + pb.v(2, JOB_ID[0])), (103, planet_details(home))]
    chance = spy_success_chance(level, drones)
    if (npc or owner) and random.random() >= chance:
        add_mail(kind=1, body=f"Our spy attempt on planet {target} failed! Our {drones} spy drone(s) were lost.\n"
                              f"(Success chance {chance:.0%}: upgrade the scanning array and/or send more drones.)")
        save_state()
        print(f"   spy: {drones} drones on {target} FAILED ({chance:.0%}, scanner L{level})", flush=True)
        return reply
    detect = spy_detect_chance(target, drones, level)
    detected = random.random() < detect
    anonymous = detected and random.random() < SPY_ANONYMOUS
    lim, sts = spy_limits(drones, level, home, target), []
    if npc:
        fleet = {int(k): v for k, v in npc.get("fleet", {}).items() if v}
        troops, res, name, ltxt = npc.get("troops", 0), {t: npc.get("stock", 0) for t in (1, 2, 3)}, npc["name"], ""
    elif owner:
        fleet, troops, res, info, sts = spy_player_data(target)
        name, ltxt = info["alias"], f" (commander level {player_level(info['xp'])})"
    else:
        fleet = troops = res = None
    if fleet is None:
        lines = ["Espionage report: the planet is not defended (no owner)."]
        add_mail(kind=1, body=lines[0])
    else:
        seen = spy_view(fleet, troops, res, sts, lim)
        lines = spy_lines(name, fleet, troops, res, *seen, level_txt=ltxt)
        if detected:
            lines.insert(0, "Our espionage was successful, but our spy drones were detected! Luckily, we remain "
                            "anonymous." if anonymous else "Our espionage was successful, but we have been detected as spies!")
        if SPY_MAIL_KIND[0]:   # the report shows "?" for a resource it did not get and counts the structures sent
            add_mail(kind=SPY_MAIL_KIND[0], body="ESPIONAGE", spy={"owner": npc["id"] if npc else owner, "name": name, "planet": target,
                     "res": {**seen[2], **({4: seen[1]} if seen[1] is not None else {})}, "fleet": seen[0],
                     "structures": seen[3]})
            if detected:
                add_mail(kind=1, body=lines[0])
        else:
            add_mail(kind=1, body="\n".join(lines))
        if detected and owner:
            who = "an unknown commander" if anonymous else player_info(me)["alias"]
            with as_player(owner):
                if SPY_MAIL_KIND[0]:   # 2019 recording (Spy Report.MP4): the spied player gets the SAME kind-6 report ("Espionage
                    # detected on <planet>", "Someone spied on planet ..., and got classified information") with what the drones saw;
                    # the spy player field (2) names the spy unless the detection was anonymous
                    add_mail(kind=SPY_MAIL_KIND[0], body="ESPIONAGE",
                             spy={"owner": owner, "name": name, "planet": target,
                                  "res": {**seen[2], **({4: seen[1]} if seen[1] is not None else {})}, "fleet": seen[0],
                                  "structures": seen[3],
                                  "spier": {"id": 0 if anonymous else me, "alias": "" if anonymous else who},
                                  "f4": 2 if anonymous else 3})   # details field 4 picks the lead on the real client (iPad sweep 2026-11-15): 2 = "Someone spied on planet X, and got classified information", 3 = "<USER> spied on planet X, and obtained classified information." (1 / 7 / 8 = the generic error text)
                else:
                    add_mail(kind=1, body=f"Enemy spy drones from {who} were detected near planet {target}. They got away "
                                          f"with intel - expect an attack.")
    save_state()
    print(f"   spy: {drones} drones on {target} ok ({chance:.0%}), limits {lim}, detected {detected} "
          f"({detect:.0%}){' anon' if anonymous else ''}: " + " / ".join(lines), flush=True)
    return reply


def handle_209(req, res=4):
    """Train troops: {1 barracks structure id, 2 count}. No response type -> 103 push of the barracks' planet."""
    f = {n: v for n, wt, v in pb.fields(req)}
    pid = planet_of_structure(f.get(1, 0))
    count = max(1, f.get(2, 1))
    JOB_ID[0] += 1
    now = time.time()
    with on_planet(pid):
        settle_resources()
        *unit, secs = species_scaled(CAT_TROOPS if res == 4 else CAT_DRONES, *(TROOP_COST if res == 4 else DRONE_COST),
                                     TROOP_SECONDS if res == 4 else DRONE_SECONDS, pid=pid,
                                     percent=yard_percent(6 if res == 4 else 8, yard_level(f.get(1, 0), 6 if res == 4 else 8, pid)))
        for r, c in zip(RESOURCES, unit):
            r["amount"] = max(0.0, r["amount"] - c * count)
        resource(res)
    job = {"id": JOB_ID[0], "yard": f.get(1, 0), "count": count, "planet": pid, "res": res, "start": now,
           "end": now + secs * count}
    TROOP_JOBS.append(job)
    save_state()
    print(f"   troops: {count} at barracks {job['yard']} ({pid}) done in {job['end'] - now:.0f}s", flush=True)
    return [(103, planet_details(pid))]


RESEARCH_NO_ITEM_CODE = 109   # 9206 {1 code, 2 echoed request}; client codes: 105 slots, 107 requirements, 108 max level, 109 items


def handle_206(req):
    """Start research: {1 id (planet or lab), 2 {1 tech*, 2 level*, 4}} -> {1 research job}; cost = statics 12."""
    f = {n: v for n, wt, v in pb.fields(req)}
    o = {n: v for n, wt, v in pb.fields(f.get(2, b""))}
    tech, level = o.get(1, 1), o.get(2, 1)
    item = TECH_ITEM.get(tech)
    if item and INVENTORY.get(item, 0) <= 0:   # blueprint tech without its blueprint item: refuse (error reply 9206)
        print(f"   research refused: tech {tech} needs blueprint item {item}", flush=True)
        return [(9206, pb.v(1, RESEARCH_NO_ITEM_CODE) + pb.ld(2, req)), (103, planet_details())]
    if level > TECH_MAX:   # the client refuses this itself ("Maximum level reached!"); guard for bots
        print(f"   research refused: tech {tech} level {level} > TECH_MAX {TECH_MAX}", flush=True)
        return [(9206, pb.v(1, 108) + pb.ld(2, req)), (103, planet_details())]
    if not tech_slot_free(tech):
        print(f"   research refused: tech {tech}, all {TECH_SLOTS} lab slots used ({sorted(TECHS)})", flush=True)
        return [(9206, pb.v(1, 105) + pb.ld(2, req)), (103, planet_details())]
    if yard_level(f.get(1, 0), 7, CUR_PLANET[0]) < TECH_LAB.get(tech, 0):   # the client refuses this itself
        print(f"   research refused: tech {tech} needs Laboratory {TECH_LAB[tech]}", flush=True)
        return [(9206, pb.v(1, 107) + pb.ld(2, req)), (103, planet_details())]
    JOB_ID[0] += 1
    now = time.time()
    job = {"id": JOB_ID[0], "tech": tech, "level": level, "lab": f.get(1, HOME_PLANET), "start": now,
           "end": now + species_scaled(CAT_TECHS, research_seconds(level), pid=CUR_PLANET[0])[0]}
    settle_resources()
    for r, c in zip(RESOURCES, species_scaled(CAT_TECHS, *research_cost(level), pid=CUR_PLANET[0])):
        r["amount"] = max(0, r["amount"] - c)
    RESEARCH.append(job)
    item = TECH_ITEM.get(tech)
    if item and INVENTORY.get(item, 0) > 0:   # DESC_INFOSCREEN_TECH_BLUEPRINT_CONSUMED: one blueprint per research
        INVENTORY[item] -= 1
        print(f"   blueprint item {item} consumed for tech {tech} ({INVENTORY[item]} left)", flush=True)
    save_state()
    print(f"   research: tech {tech} level {level} (req {f.get(1)}) done in {job['end'] - now:.0f}s", flush=True)
    out = [(206, pb.ld(1, research_job_msg(job))), (103, planet_details())]
    return out + [(272, handle_272(b""))] if item else out


def handle_210(req):
    """Collect a finished job (the tick button): request {1 job id} -> response {1 job id*}. Applies the
    finished construction now (structures_now also applies it whenever the planet is next sent)."""
    jid = next((v for f, wt, v in pb.fields(req) if f == 1), 0)
    if any(j["id"] == jid for j in DIG_JOBS):
        return dig_finish(jid, 210)
    colony = None
    for job in [j for j in BUILDS + SHIP_JOBS + CARRIER_JOBS + RESEARCH + TROOP_JOBS if j["id"] == jid]:
        job["end"] = min(job["end"], time.time())
        if job in TROOP_JOBS and job.get("planet", HOME_PLANET) != HOME_PLANET:
            colony = job["planet"]
    troops_now()
    for p in own_planets()[1:]:   # jobs on colonies
        with on_planet(p):
            for job in [j for j in BUILDS + SHIP_JOBS + CARRIER_JOBS if j["id"] == jid]:
                job["end"] = min(job["end"], time.time())
                structures_now(); ships_now(); carriers_now()
                colony = p
    research_now()
    structures_now()
    ships_now()
    carriers_now()
    scanned = False
    for job in [j for j in SCAN_JOBS if j["id"] == jid]:
        SCAN_JOBS.remove(job)
        scan_found_missions(job)
        scanned = True
        if job.get("planet", HOME_PLANET) != HOME_PLANET:
            colony = job["planet"]
        print(f"   scan finished: {job} -> missions {[(m['id'], m['type']) for m in MISSIONS[-3:]]}", flush=True)
    print(f"   collect: job {jid}", flush=True)
    # No 103 push in this reply: refreshing the planet while the panel handles the collect crashed the client
    # (0x1005c1da0, freed slot/job objects). Without any push the building only updates at the client's own
    # ~40 s refresh, so the push is deferred to the next periodic 281 (>= 1 s later).
    # (A deferred push on the next 281 also crashed the client at 23:00:17 - unsolicited 103 replies are only
    # safe right after a 200. Disabled: the building updates at the client's own ~40 s 103 refresh.)
    # Push the planet with the reply so the collect shows at once instead of at the client's ~40 s fallback refresh.
    return [(210, pb.v(1, jid)), (103, planet_details(colony))] + ([(112, missions_reply())] if scanned else [])


# Artifact digging (2026-10-18): a CITADEL structure (type 11) on a citadel planet (map planet field 3: 7 blue,
# 8 red, 9 yellow - caption order 0x1002b83a8) shows ARTIFACTS -> START DIGGING = request 240 {1 citadel structure id}
# (sender 0x100297000, dig manager ctor 0x100296400; no 240 response type, error 9240 {1 code, 2 echo}).
# The job lives in planet field 4 = [{1 timer, 2 structure id}]; collect = 210 {job id} (tick), 253 {1 id} = same
# dig manager (collect / cancel), both handled here. Collect gives one artifact of the planet's colour + 272 push.
DIG_JOBS = list(globals().get("_dig_jobs", []))
DIG_SECONDS = int(os.environ.get("GOFA_DIG_SECONDS", dig_scaled(DIG_BASE[3])))
DIG_TIMER_KIND = 9   # guess (1-8 used by other jobs)
# moved to gofa_core/rules/ruleset.py: CITADEL_ITEM

_PTYPE = {}
# Abundance (2026-11-03): map planet field 8 = repeated {1 resource 1 metal / 2 gas / 3 crystal / 5 spy drones,
# 2 level 1-9, 3 float 1.0-5.0 (= 0.5 + 0.5 x level)}; levels differ per resource, none is 0 in the release map.
# Client: extractor info "Abundance level influence bonus". The Terran home system is sector 0_0 of the map.
_PABUND = {}


def map_planet_type(pid):
    """Planet type 1-9 from the bundled map (sector x_y = pid // 1e11, pid // 1e7 % 1e4)."""
    return map_planet_field(pid, 3, 1)


def map_planet_field(pid, k, default=0):
    """Field k of the planet's map record (3 type, 7 quality = the client's cost-reduction input)."""
    if pid not in _PTYPE:
        _map_planet(pid)
    return _PTYPE.get(pid, {}).get(k, default)


def _map_planet(pid):
    try:
        d = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "map_x",
                              f"{pid // 10**11}_{pid // 10**7 % 10**4}"), "rb").read()
        for f, _, s in pb.fields(d):
            for _, _, sysm in (pb.fields(s) if f == 3 else []):
                for k, _, v in pb.fields(sysm):
                    for k2, _, pl in (pb.fields(v) if k == 6 else []):
                        p = {a: b for a, _, b in pb.fields(pl)} if k2 == 1 else {}
                        if p.get(1) == pid:
                            _PTYPE[pid] = {a: b for a, b in p.items() if isinstance(b, int)}
                            for a, _, e in pb.fields(pl):
                                if a == 8:
                                    e = {x: y for x, _, y in pb.fields(e)}
                                    _PABUND.setdefault(pid, {})[e.get(1)] = struct.unpack("<f", struct.pack("<I", e.get(3, 0)))[0]
    except Exception as e:
        print(f"   map_planet_type {pid}: {e}", flush=True)
    _PTYPE.setdefault(pid, {})


_SYSNAME = {}


def map_system_name(pid):
    """Name of the planet's system in the bundled map ('' when not found); read-only, used by the web page's colony overview."""
    sid = system_of(pid)
    if sid not in _SYSNAME:
        _SYSNAME[sid] = ""
        try:
            d = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "map_x",
                                  f"{pid // 10**11}_{pid // 10**7 % 10**4}"), "rb").read()
            for f, _, s in pb.fields(d):
                for _, _, sysm in (pb.fields(s) if f == 3 else []):
                    fl = {k: v for k, _, v in pb.fields(sysm) if k in (1, 3)}   # system {1 id, 3 name, 6 planets}
                    if fl.get(1) == sid and isinstance(fl.get(3), (bytes, bytearray)):
                        _SYSNAME[sid] = bytes(fl[3]).decode("utf-8", "replace")
        except Exception as e:
            print(f"   map_system_name {pid}: {e}", flush=True)
    return _SYSNAME[sid]


def dig_job_msg(j):
    timer = (pb.v(1, j["id"]) + pb.ld(2, ts(j["start"])) + pb.ld(3, ts(j["end"])) + pb.ld(4, ts(j["end"]))
             + pb.v(5, DIG_TIMER_KIND))
    return pb.ld(1, timer) + pb.v(2, j["sid"])


def handle_240(req):
    """START DIGGING: {1 citadel structure id} -> dig job on that planet + 103 push."""
    sid = next((v for f, wt, v in pb.fields(req) if f == 1), 0)
    pid = planet_of_structure(sid)
    item = CITADEL_ITEM.get(map_planet_type(pid))
    if item is None or any(j["sid"] == sid for j in DIG_JOBS):
        print(f"   dig refused: structure {sid} planet {pid} type {map_planet_type(pid)}", flush=True)
        return (9240, pb.v(1, 1) + pb.ld(2, pb.v(1, sid)))
    cost = tuple(dig_scaled(x, pid) for x in DIG_BASE[:3])   # = what the ARTIFACTS tab shows
    with on_planet(pid):
        settle_resources()
        if not all(r["amount"] >= x for r, x in zip(RESOURCES, cost)):
            print(f"   dig refused: planet {pid} cannot afford {cost}", flush=True)
            return (9240, pb.v(1, 1) + pb.ld(2, pb.v(1, sid)))
        for r, x in zip(RESOURCES, cost):
            r["amount"] -= x
    JOB_ID[0] += 1
    now = time.time()
    secs = DIG_SECONDS if DIG_SECONDS != dig_scaled(DIG_BASE[3]) else dig_scaled(DIG_BASE[3], pid)   # debug override wins
    DIG_JOBS.append({"id": JOB_ID[0], "sid": sid, "planet": pid, "item": item, "start": now, "end": now + secs})
    save_state()
    print(f"   dig started: job {JOB_ID[0]} structure {sid} planet {pid} -> item {item} in {secs}s, cost {cost}", flush=True)
    return (103, planet_details(pid))


def dig_finish(jid, ext):
    """Collect (finished) or cancel (running) a dig job; jid may be the job or the structure id."""
    job = next((j for j in DIG_JOBS if jid in (j["id"], j["sid"])), None)
    if job is None:
        return (ext, pb.v(1, jid)) if ext == 210 else None
    DIG_JOBS.remove(job)
    out = []
    if job["end"] <= time.time() + 1:
        INVENTORY[job["item"]] = INVENTORY.get(job["item"], 0) + 1
        add_mail(kind=1, body=f"Planet {job['planet']}: artifact dig complete ({ITEM_NAMES[job['item']]}). It is in the "
                              f"ITEMS tab (commander).")
        out.append((272, handle_272(b"")))
        print(f"   dig collected: job {job['id']} -> item {job['item']} ({INVENTORY[job['item']]})", flush=True)
    else:
        print(f"   dig cancelled: job {job['id']}", flush=True)
    save_state()
    return ([(210, pb.v(1, job["id"]))] if ext == 210 else []) + out + [(103, planet_details(job["planet"]))]


def handle_253(req):
    return dig_finish(next((v for f, wt, v in pb.fields(req) if f == 1), 0), 253) or []


ATTRIBUTE_IDS = [1, 2, 3] + list(range(6, 99)) + list(range(100, 116))   # validator 0x1000067ac (= statics s22 ids)
ATTRIBUTE_TEST_VALUE = 10


def handle_284(req):
    """Response 284 = {1 {1 repeated {1 attribute id*, 2 varint64 value*}}}: counters, the achievements' progress (client table via 0x100d20840)."""
    return pb.ld(1, b"".join(pb.ld(1, pb.v(1, int(a)) + pb.v(2, int(n))) for a, n in sorted(ACH.get("c", {}).items(), key=lambda x: int(x[0])) if n))


# moved to gofa_core/rules/ruleset.py: CARRIER_UPGRADE_MAX, COLOUR_OFFSET, OFFSET_ITEM, ARTIFACTS_PER_UPGRADE, VOID_CRYSTALS_PER_CARRIER,
#     carrier_items, carrier_artifacts, OFFSET_COLOUR, RED_BLUE_BASE, RED_BLUE_PCT, RED_BLUE_VOID, YELLOW_FIRST, YELLOW_STEP, HANGAR_BASE,
#     HANGAR_STEP, carrier_bonus, carrier_hangar, carrier_field

def handle_213(req):
    """Carrier artifact upgrade {1 carrier id, 2 level, 3 colour 1-3}: the carrier becomes the coloured type of its
    tier, one artifact (per carrier_items) is used up and the resource cost charged. No 213 response type exists:
    answer with the planet (103) and inventory (272); 9213 {1 code, 2 echo} on refusal."""
    f = {n: v for n, wt, v in pb.fields(req)}
    c = next((c for c in CARRIERS if c["id"] == f.get(1)), None)
    colour, level = f.get(3, 1), f.get(2, 1)
    if not c or colour not in COLOUR_OFFSET:
        print(f"   carrier upgrade refused: {f}", flush=True)
        return [(9213, pb.v(1, 1) + pb.ld(2, req))]
    new_type = (c["type"] - 1) // 4 * 4 + 1 + COLOUR_OFFSET[colour]
    need = carrier_items(new_type, level) or {}
    if any(INVENTORY.get(t, 0) < n for t, n in need.items()):
        print(f"   carrier upgrade refused: needs {need}, owned {[INVENTORY.get(t, 0) for t in need]}", flush=True)
        return [(9213, pb.v(1, 2) + pb.ld(2, req)), (272, handle_272(b""))]
    pid = c.get("at", HOME_PLANET)
    with on_planet(pid if pid in own_planets() else HOME_PLANET):
        settle_resources()
        for r, x in zip(RESOURCES, carrier_cost(level)):
            r["amount"] = max(0, r["amount"] - x)
    for t, n in need.items():
        INVENTORY[t] -= n
    old = c["type"]
    c["type"], c["level"] = new_type, level
    save_state()
    print(f"   carrier upgrade: {c['id']} type {old} -> {new_type} L{level}, used {need}, inventory "
          f"{[INVENTORY.get(t, 0) for t in need]}", flush=True)
    # 110 = the load-carrier reply {1 carrier record}: pushed so the open carrier view / fleet list see the new type
    return [(103, planet_details(pid if pid in own_planets() else HOME_PLANET)), (272, handle_272(b"")),
            (110, pb.ld(1, carrier_msg(c))), (109, handle_109(b""))]


def _carrier_reply(c):
    return (pb.ld(1, carrier_msg(c)))


def handle_254(req):
    """Carrier behaviour {1 carrier id, 2 behaviour 1 engage / 2 avoid combat} (sender 0x1002ca638, from the carrier
    view's toggle 0x100365044; client error ERROR_CANNOT_CHANGE_BEHAVIOUR) -> 254 {1 carrier record}; 9254 {1 code,
    2 echo} on refusal. Stored as carrier field 9. Not modelled yet: battles ignore it (DESC_INFOSCREEN_SHOWROOM:
    the carrier flees from combat / disengages from approaching enemies)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    c = next((c for c in carriers_now() if c["id"] == f.get(1)), None)
    if not c or f.get(2) not in (1, 2):
        return [(9254, pb.v(1, 1) + pb.ld(2, req))]
    c["behaviour"] = f[2]
    save_state()
    print(f"   carrier {c['id']} behaviour -> {'avoid combat' if f[2] == 2 else 'engage'}", flush=True)
    return [(254, _carrier_reply(c))]


def handle_247(req):
    """Delete (demolish) a carrier {1 carrier id} (sender 0x1002beb28, sent from the carrier view's confirm dialog
    0x100366818). No 247 response type exists (only 9247 {1 code, 2 echo}). Everything aboard is lost (game text
    INFO_REALLY_DEMOLISH_CARRIER: "will also destroy all ships, troops, resources and artifacts on board"); then the
    planet (103) and the fleet list (109) are pushed. Refused while it travels or moves (code 1, assumed)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    c = next((c for c in carriers_now() if c["id"] == f.get(1)), None)
    busy = c and any((c.get(k) or {}).get("end", 0) > time.time() for k in ("travel", "move"))
    if not c or busy:
        print(f"   carrier delete refused: {f} ({'busy' if busy else 'unknown'})", flush=True)
        return [(9247, pb.v(1, 1) + pb.ld(2, req))]
    at = c.get("at", HOME_PLANET) if c.get("at", HOME_PLANET) in own_planets() else HOME_PLANET
    CARRIERS.remove(c)
    save_state()
    print(f"   carrier {c['id']} demolished at {at} (lost aboard: ships {c.get('ships', {})}, cargo {c.get('cargo', {})})", flush=True)
    return [(103, planet_details(at)), (109, handle_109(b""))]


def handle_330(req):
    """Create or rename a carrier group {1 group id (0 = new), 2 name} (sender 0x1002c0318; the client names new groups
    "Group <n>" and checks renames with ERROR_NAME_*) -> 330 {1 echo, 2 group {1 id, 2 name}}; 9330 {1 code, 2 echo}.
    The group limit (statics s26 level field 6 + fleet commander extenders) is checked by the client (code 6)."""
    f = {n: v for n, wt, v in pb.fields(req)}
    gid, raw = f.get(1, 0), f.get(2, b"")
    name = (raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)).strip()[:32]
    g = next((g for g in CARRIER_GROUPS if g["id"] == gid), None) if gid else None
    if not name or (gid and g is None):
        return [(9330, pb.v(1, 1) + pb.ld(2, req))]
    if g is None:
        g = {"id": max([g["id"] for g in CARRIER_GROUPS] + [0]) + 1, "name": name}
        CARRIER_GROUPS.append(g)
    g["name"] = name
    save_state()
    print(f"   carrier group {g['id']} = {name!r}", flush=True)
    return [(330, pb.ld(1, req) + pb.ld(2, pb.v(1, g["id"]) + pb.ld(2, g["name"])))]


def handle_329(req):
    """Put a carrier into a group {1 carrier id, 2 group id (0 = none)} (sender 0x1002c13d4, from 0x1006dee3c; client
    check 0x1002c15cc: 7 = already in that group, 5 = locked in a fight) -> 329 {1 echo, 2 carrier record (field 16 =
    group)}; 9329 {1 code, 2 echo}."""
    f = {n: v for n, wt, v in pb.fields(req)}
    c = next((c for c in carriers_now() if c["id"] == f.get(1)), None)
    gid = f.get(2, 0)
    if not c or (gid and not any(g["id"] == gid for g in CARRIER_GROUPS)):
        return [(9329, pb.v(1, 1) + pb.ld(2, req))]
    if gid:
        c["group"] = gid
    else:
        c.pop("group", None)
    save_state()
    print(f"   carrier {c['id']} -> group {gid}", flush=True)
    return [(329, pb.ld(1, req) + pb.ld(2, carrier_msg(c)))]


def handle_272(req):
    """Init-batch response 272 = inventory: {1 {1 repeated {1 unique id*, 2 item def* (0x100d19940, same type as
    statics section 20 entries: {1 item type 1-18, 2-9 ints}), 3 count*, 4 repeated ?}}}. Item types 1-18 =
    the 18 HEADER_INVENTORY_ITEM_* (pilot school / outpost / fleet commander extenders raise the ship /
    carrier / fleet-group production limits). Test: 5 of every item."""
    items = b"".join(pb.ld(1, pb.v(1, 5000 + t) + pb.ld(2, pb.v(1, t) + b"".join(pb.v(k, v) for k, v in item_def_fields(t).items() if v is not None and v >= 0))
                           + pb.v(3, n)) for t, n in sorted(INVENTORY.items()) if n > 0)
    return pb.ld(1, items)


# moved to gofa_core/rules/ruleset.py: EXTENDER_AMOUNT

# Field 4 = BUY price base (probed 2026-10-27 with field k = bit x 100 + type: all 18 items showed field 4 x a per-type
# multiplier the client applies itself - planet extender x2, ship extender x2.75, every other item x1; not a table in
# the binary, maybe state-dependent). Field 4 = price / multiplier, so the panel shows item_price(t) = what we charge.
ITEM_PRICE_PROBE = os.environ.get("GOFA_ITEM_PROBE", "0") == "1"
PROBE_BITS = {2: 1, 4: 2, 6: 4, 7: 8, 8: 16, 9: 32}
# moved to gofa_core/rules/ruleset.py: ITEM_PRICE_MULT, item_price_base

def item_def_fields(t):
    if ITEM_PRICE_PROBE:
        # round 2: field k = PROBE_BITS[k] x 100 + item type -> price // 100 = which fields (bits), % 100 = type (x count)
        return {k: (0 if k == 5 else EXTENDER_AMOUNT.get(t, 1) if k == 3 else PROBE_BITS[k] * 100 + t) for k in range(2, 10)}
    return {k: (0 if k == 5 else EXTENDER_AMOUNT.get(t, 1) if k == 3 else item_price_base(t) if k == 4 else 1)
            for k in range(2, 10)}


# Inventory (272): item type 1-18 -> count, persisted as state "inventory" (new saves start with 5 of each).
INVENTORY = {int(k): v for k, v in (globals().get("_inventory") or {}).items()}   # new saves: no items (was 5 of each)
# moved to gofa_core/rules/ruleset.py: TECH_ITEM, ITEM_PRICE, ITEM_PRICES, item_price, CREDIT_BOOSTERS, XP_BOOST_ITEM, DAILY_CREDITS

BOOSTS = {k: v for k, v in (globals().get("_boosts") or {}).items() if k in ("credit_until", "daily_last")}   # {"credit_until": {item: ts}, "daily_last": ts}


def xp_mult():
    return 2 if INVENTORY.get(XP_BOOST_ITEM, 0) > 0 else 1


def boosters_now():
    """Use up credit boosters whose duration ended; returns True if an amount changed."""
    now, changed, until = time.time(), False, BOOSTS.setdefault("credit_until", {})
    for t, (pct, days) in CREDIT_BOOSTERS.items():
        end = until.get(str(t))
        if INVENTORY.get(t, 0) <= 0:
            until.pop(str(t), None)
            continue
        if end is None:
            until[str(t)] = now + days * 86400
            changed = True
            continue
        while end <= now and INVENTORY.get(t, 0) > 0:
            INVENTORY[t] -= 1
            print(f"   credit booster {t} used up ({INVENTORY[t]} left)", flush=True)
            end += days * 86400
            changed = True
        until[str(t)] = end
    if changed:
        save_state()
    return changed


def daily_bonus():
    """Grant the daily credit bonus (DAILY_CREDITS + owned booster percentages) once per 24 h."""
    now = time.time()
    if not BOOSTS.get("daily_last"):
        BOOSTS["daily_last"] = now; save_state()
        return False
    if now - BOOSTS["daily_last"] < 86400:
        return False
    pct = sum(p for t, (p, d) in CREDIT_BOOSTERS.items() if INVENTORY.get(t, 0) > 0)
    amount = DAILY_CREDITS * (100 + pct) // 100
    CREDITS_BOX[0] += amount
    BOOSTS["daily_last"] = now
    add_mail(kind=1, body=f"Daily credit bonus: {amount} credits" + (f" (boosters +{pct}%)." if pct else "."))
    print(f"   daily bonus: {amount} credits (+{pct}%)", flush=True)
    return True


def handle_278(req):
    """BUY in the ITEM OFFER panel: {1 item type, 2 amount}. See the comment above ITEM_PRICE."""
    f = {n: v for n, wt, v in pb.fields(req)}
    t, n = f.get(1, 0), max(1, f.get(2, 1))
    n = min(n, CREDITS_BOX[0] // item_price(t)) if t not in (4, 5) else 0   # guide: carrier blueprints only come from missions
    if n <= 0:   # 9278 {1 code, 2 echo}; the panel then times out with "Unable to purchase requested item(s)."
        print(f"   item {t}: costs {item_price(t)}, have {CREDITS_BOX[0]} credits - refused", flush=True)
        return [(9278, pb.v(1, 1) + pb.ld(2, req)), (115, handle_115(b""))]
    CREDITS_BOX[0] -= n * item_price(t)
    INVENTORY[t] = INVENTORY.get(t, 0) + n
    boosters_now()
    save_state()
    print(f"   item {t} bought x{n} ({INVENTORY[t]} owned, {CREDITS_BOX[0]} credits)", flush=True)
    return [(272, handle_272(b"")), (115, handle_115(b""))]

def handle_235(req):
    """Request {1 int} (sent after loading with 0). Response {1 {1 varint64*}*, 2 varint64}; the auto reply
    lacked the inner required field and was rejected (probe_ext_init.js). Meaning unknown: echo the value."""
    v = next((x for f, wt, x in pb.fields(req) if f == 1), 0)
    # the alliance panel sends 235 when opened: piggyback the own alliance + offers so changes made by other
    # players (applications, accepts, promotions) show without a relaunch
    return [(235, pb.ld(1, pb.v(1, v))), (219, handle_219(b"")), (234, handle_234(b""))]


def handle_277(req):
    """Sent after the planet step (loader step 10 waits on it). Request empty; response 277 (vtable
    0x100c70bf8, missed by the message map) = {1 repeated entry}, no required fields -> empty list."""
    return b""


AUTO_SKIP = os.path.join(here, "auto_skip.txt")


def auto_skipped(ext):
    """Extensions listed in server/auto_skip.txt (one per line, '#' comments) get no automatic reply.
    Read on every request so it can be edited while the server runs."""
    try:
        return str(ext) in {l.split("#")[0].strip() for l in open(AUTO_SKIP)}
    except FileNotFoundError:
        return False


def auto_reply(req, ext=None):
    """Fallback: smallest valid response (all required fields, recursively) from the message map."""
    return schema.minimal(("response", ext))


def checked(ext, body):
    """Validate an outgoing reply against the message map and log what the client would reject (ERROR:
    missing required field -> whole envelope rejected) or silently drop (WARN). Never changes the reply."""
    try:
        if schema.EXT.get(("response", ext)) in schema.MESSAGES:
            res = schema.check(("response", ext), body)
            for r in res[:8]:
                print(f"   [check] {r}", flush=True)
            if len(res) > 8:
                print(f"   [check] ... {len(res) - 8} more", flush=True)
    except Exception as e:
        print(f"   [check] {ext}: checker failed {e!r}", flush=True)
    return body


# ---- Accounts + per-player state (multiplayer groundwork steps 1 + 2, 2026-10-19) ----
# Login 2013 (field 8) / 2700 (field 13) carry the Game Center alias -> account {alias, account, player, session}
# in state/accounts.json. The original single-player account (ids below) is seeded with alias "Pilot" (the name the
# relaunch login 2011 has always shown; 2011 carries no alias and is matched by its account id instead). If the real
# Game Center alias ever logs in via 2013, rename the first entry in accounts.json to it to keep the old save.
# Every request's envelope field 1 is the session id -> player; unknown sessions (old clients, login before a
# session exists) fall back to DEFAULT_PLAYER.
import threading
LOCK = globals().get("LOCK") or threading.RLock()   # survives hot reloads (same module namespace)
DEFAULT_ALIAS = os.environ.get("GOFA_DEFAULT_ALIAS", "Pilot")
ID_BASE = (0xACC000000000, 0x91A000000000, 0x5EA510000000)   # account / player / session ids = base + n


def _load_accounts():
    if os.path.exists(ACCOUNTS_FILE):
        return json.load(open(ACCOUNTS_FILE))
    return {"accounts": [{"alias": DEFAULT_ALIAS, "account": ACCOUNT_ID, "player": DEFAULT_PLAYER, "session": SESSION_ID}]}


ACCOUNTS = _load_accounts()
if not os.path.exists(ACCOUNTS_FILE):
    _write_json(ACCOUNTS_FILE, ACCOUNTS)


# moved to gofa_core/rules/ruleset.py: SPECIES_BONUS, CAT_STRUCTURES, CAT_SHIPS, CAT_TROOPS, CAT_DRONES, CAT_TECHS, species_mult

def species_scaled(cat, *values, pid=None, percent=100):
    """Cost / time values as the client shows them: base x species x planet quality (pid) x the producing building's
    statics field 6 percent, rounded up."""
    m = species_mult(race_of(CUR_PLAYER[0]), cat) * percent / 100
    if pid is not None:
        m *= quality_factor(pid)
    return tuple(math.ceil(round(v * m, 6)) for v in values)


def quality_factor(pid):
    """Planet quality discount 0x100408f98: Home1 q 1 = none, Home3 q 2 = 0.9, q 7 = 0.775, q 10 = 0.7545."""
    q = max(1, map_planet_field(pid, 7, 1))
    return 1 - 0.3 * (q - 1) / (q + 1)


# moved to gofa_core/rules/ruleset.py: yard_percent

def yard_level(sid, stype, pid):
    """Level of the building that produces a unit (structure id sid on planet pid), highest of its type if unknown."""
    with on_planet(pid):
        sts = [st for st in STRUCTURES.values() if st["type"] == stype]
        hit = [st["level"] for st in sts if structure_id(st["slot"], pid) == sid]
    return (hit or [max([st["level"] for st in sts] + [1])])[0]


def race_of(pid):
    return next((a.get("race", 1) for a in ACCOUNTS["accounts"] if a["player"] == pid), 1)


def account_for(alias):
    accts = ACCOUNTS["accounts"]
    a = next((a for a in accts if a["alias"] == alias), None)
    if a is None:
        n = max(x["player"] - ID_BASE[1] for x in accts) + 1
        a = {"alias": alias, "account": ID_BASE[0] + n, "player": ID_BASE[1] + n, "session": ID_BASE[2] + n}
        accts.append(a)
        _write_json(ACCOUNTS_FILE, ACCOUNTS)
        print(f"=== new account {alias!r} player {a['player']:X}", flush=True)
    return a


def player_of_session(session, second=0):
    """Envelope ids -> player. The real client never echoes the session: world requests carry {1 account, 2 player},
    some carry {1 player, 2 1}, login {0, 0}. Any of session / account / player id in field 1 (or a player id in
    field 2) selects that account; unknown -> the default player (Pilot)."""
    for a in ACCOUNTS["accounts"]:
        if session in (a["session"], a["account"], a["player"]) or second == a["player"]:
            return play_as_pid(a)
    return play_as_pid(None)


# "New game" switch (2026-10-23): accounts.json "play_as" = alias -> every iPad login / request (the default account,
# accounts marked "ipad", unknown ids) runs as that player; other players (bot) are unaffected. Set / clear with
# /debug/playas?alias=NAME (empty alias = back to normal), then relaunch the game. The old save stays as it is.
def is_ipad(a):
    return a is None or a["player"] == DEFAULT_PLAYER or a.get("ipad", False)


def play_as_pid(a):
    if ACCOUNTS.get("play_as") and is_ipad(a):
        return account_for(ACCOUNTS["play_as"])["player"]
    return a["player"] if a else DEFAULT_PLAYER


# Per-player values that are not saved (pending pushes, debug knobs); kept in memory per player.
VOLATILE_NAMES = ["PLAYER", "PENDING_PLANET_PUSH", "PENDING_XP", "PENDING_MAIL", "ENDED_TRAVELS", "TUT_LAST",
                  "SKILL_BONUS", "CMD_EXTRA"]
VOLATILE_DEFAULTS = {"PLAYER": {"alias": "Pilot"}, "PENDING_PLANET_PUSH": [], "PENDING_XP": [], "PENDING_MAIL": [],
                     "ENDED_TRAVELS": [], "TUT_LAST": [None], "SKILL_BONUS": [0], "CMD_EXTRA": {}}
VOLATILE = globals().get("VOLATILE") or {}


def _put(name, value):
    """Replace a global's contents in place (dict / list / set), so references held elsewhere stay valid."""
    g = globals()
    cur = g.get(name)
    if isinstance(cur, dict):
        cur.clear(); cur.update(value)
    elif isinstance(cur, list):
        cur[:] = value
    elif isinstance(cur, set):
        cur.clear(); cur.update(value)
    else:
        g[name] = value


def _intdict(d):
    return {int(k): v for k, v in (d or {}).items()}


def _apply_state(st):
    """Load a player save dict (the old state.json layout) into the globals; mirrors the module-level load."""
    _put("STRUCTURES", _intdict(st.get("structures") or {"0": {"type": 1, "slot": 0, "level": 1}}))
    _put("BUILDS", st.get("builds", []))
    _put("RESOURCES", st.get("resources") or [{"type": t, "amount": START_RESOURCES, "ts": time.time()} for t in (1, 2, 3)])
    _put("PLANET_STATE", dict(st.get("planet_state", {})))
    set_home(int(st.get("home", HOME_DEFAULT)))   # per player (sector 0_0 is a private copy each); new players: seed_new_player
    _put("HOME_NPC", _intdict(st["home_npc"]) if "home_npc" in st else {})
    _put("COLONIES", list(st.get("colonies", [])))
    if "home_npc" not in st:
        HOME_NPC.update(home_outlaws())
    for v in HOME_NPC.values():   # saves from before the species names
        v["name"] = f"{OUTLAW_SPECIES.get(v.get('race', 1), 'Terran')} Outlaws"
    _put("SHIPS", _intdict(st.get("ships")))
    for n, k in (("SHIP_JOBS", "ship_jobs"), ("CARRIER_JOBS", "carrier_jobs"), ("CARRIERS", "carriers"),
                 ("SCAN_JOBS", "scan_jobs"), ("MISSIONS", "missions"), ("REPORTS", "reports"), ("MAIL", "mail"),
                 ("RESEARCH", "research"), ("COLONIES", "colonies"), ("TROOP_JOBS", "troop_jobs"),
                 ("DIG_JOBS", "dig_jobs"), ("BOOKMARKS", "bookmarks"), ("CARRIER_GROUPS", "carrier_groups")):
        _put(n, list(st.get(k, [])))
    CREDITS_BOX[0] = st.get("credits", CREDITS)
    XP_BOX[0] = st.get("xp", 0)
    BATTLE_XP_BOX[0] = st.get("battle_xp", 0)
    _put("SKILLS", _intdict(st.get("skills")))
    _put("TECHS", _intdict(st.get("techs")))
    _put("JUMPGATE", dict(st.get("jumpgate", {})))
    _put("TUT_CLAIMED", set(st.get("tut_claimed", [])))
    TRADED[0] = bool(st.get("traded", False))
    _put("STATS", _intdict(st.get("stats")))
    # new players: 5 of each item except planet extenders (they would lift the planet limit past GOVERNANCE, 2026-11-02)
    _put("INVENTORY", _intdict(st.get("inventory") or {t: 5 for t in range(1, 19) if t != PLANET_EXTENDER_ITEM}))
    _put("BOOSTS", {k: v for k, v in (st.get("boosts") or {}).items() if k in ("credit_until", "daily_last")})
    _put("TUT_FLAGS", set(st.get("tut_flags", [])))
    _put("ACH", st.get("ach") or {})
    _put("RAIDS", _intdict(st.get("raids")))
    MISSION_ID[0] = max([MISSION_ID[0]] + [m["id"] for m in MISSIONS] + [r.get("mission", 0) for r in REPORTS])
    JOB_ID[0] = max(JOB_ID[0], st.get("job_id", 0))


def use_player(pid):
    """Swap player pid's whole state into the globals (saving the current player first); like use_planet one level up.
    New players start with an HQ, 500 of each resource and default credits / items."""
    pid = int(pid)
    if pid == CUR_PLAYER[0]:
        return
    save_state()   # also swaps the current player's home planet back in
    VOLATILE[CUR_PLAYER[0]] = {n: globals()[n] for n in VOLATILE_NAMES}
    path = player_file(pid)
    st = json.load(open(path)) if os.path.exists(path) else {}
    _apply_state(st)
    vol = VOLATILE.get(pid) or json.loads(json.dumps(VOLATILE_DEFAULTS))
    for n in VOLATILE_NAMES:
        globals()[n] = vol[n]
    a = next((a for a in ACCOUNTS["accounts"] if a["player"] == pid), None)
    g = globals()
    g["PLAYER_ID"] = pid
    if a:
        g["ACCOUNT_ID"], g["SESSION_ID"] = a["account"], a["session"]
    CUR_PLAYER[0] = pid
    if not st:
        seed_new_player()
        save_state()


class as_player:
    """with as_player(pid): ... runs a request as that player, serialised, and swaps the default player back in."""
    def __init__(self, pid):
        self.pid = pid
    def __enter__(self):
        LOCK.acquire()
        self.prev = CUR_PLAYER[0]   # nests: a tick inside another player's request swaps that player back in
        try:
            use_player(self.pid)
        except Exception:
            LOCK.release()
            raise
    def __exit__(self, *a):
        try:
            use_player(self.prev)
        finally:
            LOCK.release()


# Step 3 (shared world, 2026-10-19): OWNERS = planet-owner index in state/world.json {planet id: owner player id}
# for the outer galaxy (HOME_PLANET 1101 / sector 0_0 is a private copy per player and never listed). It is synced
# from the current player's own_planets() on every save; colonise / conquest / spy / planet owner records use it.
def _load_owners():
    try:
        w = json.load(open(WORLD_FILE))
        if "owners" in w:
            return {int(k): v for k, v in w["owners"].items()}
    except (OSError, ValueError):
        pass
    out = {}   # first run: rebuild from the player files
    for a in ACCOUNTS["accounts"]:
        try:
            st = json.load(open(player_file(a["player"])))
        except (OSError, ValueError):
            continue
        for pl in [st.get("jumpgate", {}).get("planet")] + st.get("colonies", []):
            if pl and pl != st.get("home", HOME_DEFAULT):
                out.setdefault(int(pl), a["player"])
    return out


OWNERS = globals().get("OWNERS") or _load_owners()


def sync_owners():
    cur = CUR_PLAYER[0]
    mine = {p for p in own_planets() if system_of(p) != HOME_SYSTEM}
    for k, v in list(OWNERS.items()):
        if v == cur and k not in mine:
            del OWNERS[k]
    for pl in mine:
        if OWNERS.get(pl) in (None, cur):
            OWNERS[pl] = cur
        else:
            print(f"=== owner conflict: {pl} owned by {OWNERS[pl]:X}, also listed by {cur:X}", flush=True)


def other_owner(planet):
    """The player id owning planet if that is another player, else None. Sector 0_0 is a private copy for each player."""
    if system_of(int(planet or 0)) == HOME_SYSTEM:
        return None
    o = OWNERS.get(int(planet or 0))
    return o if o and o != CUR_PLAYER[0] else None


_SAVE_CACHE = globals().get("_SAVE_CACHE") or {}   # pid -> ((mtime_ns, size), parsed save); callers only read it


def _player_save(pid):
    """Another player's save file, parsed once per change (ranking() asks for every player per player record)."""
    path = player_file(pid)
    try:
        st = os.stat(path)
        key = (st.st_mtime_ns, st.st_size)
        hit = _SAVE_CACHE.get(pid)
        if hit and hit[0] == key:
            return hit[1]
        d = json.load(open(path))
    except (OSError, ValueError):
        return None
    _SAVE_CACHE[pid] = (key, d)
    return d


def player_info(pid):
    """{alias, race, xp, level} for any player id (current player from the globals, others from their file),
    NPC owner ids from NPC_PLANETS; unknown ids get a placeholder."""
    pid = int(pid)
    a = next((a for a in ACCOUNTS["accounts"] if a["player"] == pid), None)
    if pid == CUR_PLAYER[0]:   # account alias (PLAYER["alias"] is volatile: "Pilot" again after a server restart)
        return {"alias": a["alias"] if a else PLAYER["alias"], "race": race_of(pid), "xp": XP_BOX[0], "battle_xp": BATTLE_XP_BOX[0]}
    if a:
        st = _player_save(pid) or {}
        return {"alias": a["alias"], "race": race_of(pid), "xp": st.get("xp", 0), "battle_xp": st.get("battle_xp", 0)}
    npc = next((n for n in (*NPC_PLANETS.values(), *HOME_NPC.values()) if n.get("id") == pid), None)
    if npc:
        return {"alias": npc["name"], "race": npc.get("race", 2), "xp": 0}
    return {"alias": "Unknown", "race": 1, "xp": 0}


def ranking():
    """COMMANDER PROGRESS board: [(player id, alias, xp)] sorted by XP (ties: older account first)."""
    rows = []
    for a in ACCOUNTS["accounts"]:
        if a.get("void"):
            continue   # Voids are not on the commander board
        if a["player"] == CUR_PLAYER[0] or os.path.exists(player_file(a["player"])):
            info = player_info(a["player"])
            rows.append((a["player"], info["alias"], info["xp"]))
    return sorted(rows, key=lambda r: (-r[2], r[0]))


ALLIANCE_BOARDS = (2, 3, 4)   # kind-1 board types (verified in game 2026-10-22): 2 ALLIANCE SIZE (PLANETS), 3 ALLIANCE
# WARFARE (XP FROM BATTLES), 4 ALLIANCE LEVEL (LEVEL)


def alliance_ranking(board):
    """[(alliance id, name, score)] best first. 2: planets outside home systems (ALLIANCE SIZE), 3: members' XP from
    battles (ALLIANCE WARFARE), 4: total XP of the members (ALLIANCE LEVEL)."""
    rows = []
    for a in ALLIANCES.values():
        pids = [int(m) for m in a["members"]]
        if board == 2:
            sc = sum(1 for pl, o in OWNERS.items() if int(o) in pids)
        else:
            sc = sum(player_info(p).get("battle_xp" if board == 3 else "xp", 0) for p in pids)
        rows.append((int(a["id"]), a["name"], sc))
    return sorted(rows, key=lambda r: (-r[2], r[0]))


def rank_of(pid):
    return next((i + 1 for i, r in enumerate(ranking()) if r[0] == pid), 0)


# moved to gofa_core/rules/ruleset.py: ALLIANCE_LEADER, ALLIANCE_MEMBER, OFFER_APPLICATION, OFFER_INVITATION

OFFER_WIRE = {OFFER_APPLICATION: 0, OFFER_INVITATION: 1}   # offer field 3 (0x100495df4: 0 Applied on / 1 Invited on; 2 hung the login)


def _load_alliances():
    try:
        return json.load(open(WORLD_FILE)).get("alliances", {})
    except (OSError, ValueError):
        return {}


ALLIANCES = globals().get("ALLIANCES") or _load_alliances()


def alliance_of(pid):
    """The alliance dict player pid belongs to, or None."""
    return next((a for a in ALLIANCES.values() if str(int(pid)) in a["members"]), None)


def alliance_id_of(pid):
    a = alliance_of(pid)
    return a["id"] if a else 0


OUTER_PLANET_F2 = int(os.environ.get("GOFA_OUTER_F2", "1"))


def player_rec(pid):
    """Player record 0x100c6a998 for any player: {1 id, 2 alias, 3 race, 5 alliance id, 7 rank}."""
    info = player_info(pid)
    out = pb.v(1, pid) + pb.ld(2, info["alias"]) + pb.v(3, info["race"])
    if alliance_id_of(pid):
        out += pb.v(5, alliance_id_of(pid))
    # field 10 = outer planets [{1 planet id, 2 int32}] -> profile OUTER PLANETS list (0x1004a18a4 -> 0x10033a9d0);
    # the client shows it only to members of the same alliance (0x100431c90), else CAPTION_NO_PLANET_REGISTER.
    return out + outer_planets_field(pid) + pb.v(7, rank_of(pid))


def outer_planets_field(pid):
    return b"".join(pb.ld(10, pb.v(1, int(p)) + pb.v(2, OUTER_PLANET_F2))
                    for p in sorted(p for p, o in OWNERS.items() if int(o) == int(pid)))


def member_rec(a, pid):
    pid = int(pid)
    return pb.ld(1, player_rec(pid)) + pb.v(2, a["members"][str(pid)]) + pb.ld(3, ts(a.get("joined", {}).get(str(pid), a["created"])))


def alliance_rec(a, me=None, full=True):
    out = pb.v(1, a["id"]) + pb.ld(2, a["name"]) + pb.ld(3, a.get("desc", "")) + pb.ld(4, a["tag"])   # 3 desc, 4 tag (seen in game)
    if me is not None and str(me) in a["members"]:
        out += pb.ld(5, member_rec(a, me))
    out += pb.v(6, len(a["members"]))
    if full:
        out += pb.ld(8, b"".join(pb.ld(1, member_rec(a, m)) for m in a["members"]))
        if me is not None and str(me) in a["members"]:
            out += pb.ld(9, b"".join(pb.ld(1, offer_rec(a, o)) for o in a.get("offers", [])))
    # 10-12 = diplomacy lists (0x100c6a5d8): always sent - the client counts list 12 without a null check (crash
    # 0x10044dcf4 at login once the alliance had an offer)
    lists = {10: b"", 11: b"", 12: b""}
    if full:   # both sides store their own entries (set_relation / set_request write both)
        for d in a.get("diplomacy", []):
            other = _alliance_by_id(d["other"])
            if other and d.get("list") in lists:
                lists[d["list"]] += pb.ld(1, diplo_rec(a, other, d))
    # 14 / 15 / 16 = own rank on the alliance boards (LEADERBOARDS own row, 0x100749628 on the 220 reply): 14 SIZE (type 2),
    # 15 LEVEL (4), 16 WARFARE (3) (has-bits 12-14; verified in game with two alliances)
    ranks = b"".join(pb.v(f, next((i + 1 for i, r in enumerate(alliance_ranking(t)) if r[0] == int(a["id"])), 0))
                     for f, t in ((14, 2), (15, 4), (16, 3)))
    return out + b"".join(pb.ld(k, v) for k, v in lists.items()) + ranks


# moved to gofa_core/rules/ruleset.py: DIPLO_NAP, DIPLO_WAR, DIPLO_REQ_NAP, DIPLO_REQ_TRUCE, DIPLO_MAX_RANK, _diplo_drop

def set_relation(a, b, state):
    """NAP / WAR between alliances a and b (state 0 = neutral); open offers between them are dropped."""
    for x, y in ((a, b), (b, a)):
        _diplo_drop(x, y["id"], (10, 11, 12))
        if state:
            x.setdefault("diplomacy", []).append({"other": y["id"], "list": 10, "state": state, "ts": time.time()})
        PENDING_ALLIANCE_PUSH.update(int(m) for m in x["members"])


def set_request(a, b, state):
    """Offer from a to b (state 1 NAP / 2 truce; 0 = withdraw / answered)."""
    for x, y in ((a, b), (b, a)):
        _diplo_drop(x, y["id"], (11, 12))
        PENDING_ALLIANCE_PUSH.update(int(m) for m in x["members"])
    if state:
        a.setdefault("diplomacy", []).append({"other": b["id"], "list": 11, "state": state, "ts": time.time()})
        b.setdefault("diplomacy", []).append({"other": a["id"], "list": 12, "state": state, "ts": time.time(), "swap": 1})


# moved to gofa_core/rules/ruleset.py: relation, request_between

def _diplo_pair(req):
    """(own alliance, other alliance) for a diplomacy request {1 other alliance id}; None if either is missing."""
    a, b = alliance_of(CUR_PLAYER[0]), _alliance_by_id(_req_fields(req).get(1, 0))
    if a and a["members"].get(str(CUR_PLAYER[0]), ALLIANCE_MEMBER) > DIPLO_MAX_RANK:   # ERROR_DIPLOMACY_RANK_TOO_LOW in the client
        print(f"   diplomacy refused: rank {a['members'].get(str(CUR_PLAYER[0]))} > {DIPLO_MAX_RANK}", flush=True)
        return None, None
    return (a, b) if a and b and a is not b else (None, None)


def _diplo_reply(ext, req, what):
    """Responses are {1 other alliance id} (echo), then the own alliance (lists 10-12) + offers."""
    print(f"   {ext} diplomacy: {what}", flush=True)
    _save_state()
    PENDING_ALLIANCE_PUSH.discard(CUR_PLAYER[0])
    return [(ext, pb.v(1, _req_fields(req).get(1, 0))), (219, handle_219(b"")), (234, handle_234(b""))]


def handle_260(req):
    """DECLARE WAR (DIPLOMACY row icon on a neutral / NAP alliance): {1 other alliance id}."""
    a, b = _diplo_pair(req)
    if a:
        set_relation(a, b, DIPLO_WAR)
    return _diplo_reply(260, req, f"war on {b and b['name']}")


def handle_259(req):
    """OFFER a treaty: {1 other alliance id, 2 state} - 2 truce (DIPLOMACY row icon on a WAR alliance), 1 NAP."""
    a, b = _diplo_pair(req)
    st = _req_fields(req).get(2, DIPLO_REQ_NAP)
    if a and (st == DIPLO_REQ_TRUCE) == (relation(a, b) == DIPLO_WAR):
        set_request(a, b, st)
    return _diplo_reply(259, req, f"offer {st} to {b and b['name']}")


def handle_262(req):
    """ACCEPT an offer (OFFERS tab tick on "NAP requested" / truce): {1 offering alliance id}."""
    a, b = _diplo_pair(req)
    st = request_between(a, b, 12) if a else 0
    if st == DIPLO_REQ_NAP:
        set_relation(a, b, DIPLO_NAP)
    elif st == DIPLO_REQ_TRUCE:
        set_relation(a, b, 0)
    return _diplo_reply(262, req, f"accepted offer {st} from {b and b['name']}")


def handle_261(req):
    """REJECT an offer (OFFERS tab cross): {1 offering alliance id}."""
    a, b = _diplo_pair(req)
    if a and request_between(a, b, 12):
        set_request(b, a, 0)
    return _diplo_reply(261, req, f"rejected offer from {b and b['name']}")


def handle_263(req):
    """DELETE NAP (row icon on a NAP alliance / profile): {1 other alliance id}."""
    a, b = _diplo_pair(req)
    if a and relation(a, b) == DIPLO_NAP:
        set_relation(a, b, 0)
    return _diplo_reply(263, req, f"NAP with {b and b['name']} deleted")


def handle_265(req):
    """WITHDRAW an own offer (guess; same OFFERS callback as 261/262): {1 other alliance id}."""
    a, b = _diplo_pair(req)
    if a and request_between(a, b, 11):
        set_request(a, b, 0)
    return _diplo_reply(265, req, f"own offer to {b and b['name']} withdrawn")


def diplo_rec(a, other, d):
    """Diplomacy entry 0x100c6a650: {1 alliance*, 2 other alliance* (both alliance records 0x100c63030), 3 state (4 NAP, 5 WAR),
    4 varint64* (entry id), 5 timestamp*}. The DIPLOMACY tab lists the 229 search results."""
    first, second = (other, a) if d.get("swap") else (a, other)
    out = pb.ld(1, alliance_rec(first, full=False)) + pb.ld(2, alliance_rec(second, full=False)) + pb.v(3, d.get("state", 0))
    out += pb.v(4, d.get("f4", other["id"]))   # required (has-bit 0; entries without it are dropped); 3 = 1/2 pending?, 4 NAP, 5 WAR
    return out + pb.ld(5, ts(d.get("ts", a["created"])))


def offer_rec(a, o):
    out = pb.ld(1, alliance_rec(a, full=False)) + pb.ld(2, player_rec(o["pid"])) + pb.v(3, OFFER_WIRE[o["type"]]) + pb.ld(4, ts(o["ts"]))
    if o.get("by") and str(o["by"]) in a["members"]:
        out += pb.ld(5, member_rec(a, o["by"]))
    return out


def _req_fields(req):
    return {f: v for f, wt, v in pb.fields(req)}


def is_ally(p1, p2):
    """True when players p1 and p2 are in the same alliance (the server refuses attacks between them)."""
    a = alliance_of(p1)
    return bool(a and p2 is not None and str(int(p2)) in a["members"])


def has_nap(p1, p2):
    """True when p1's and p2's alliances have a non-aggression pact (relation list 10, state 4): attacks are refused."""
    a, b = alliance_of(p1), (alliance_of(p2) if p2 is not None else None)
    return bool(a and b and any(d.get("list") == 10 and d.get("state") == DIPLO_NAP and int(d["other"]) == int(b["id"])
                                for d in a.get("diplomacy", [])))


def _alliance_by_id(aid):
    return ALLIANCES.get(str(int(aid)))


def handle_215(req):
    """CREATE alliance: {1 name, 2 tag, 3 description} -> {1 alliance record*}. Costs 1 artifact of each colour."""
    me, q = CUR_PLAYER[0], _req_fields(req)
    old = alliance_of(me)
    if old:
        return pb.ld(1, alliance_rec(old, me))
    if player_level(XP_BOX[0]) < 5 or any(INVENTORY.get(i, 0) < 1 for i in OFFSET_ITEM.values()):   # guide: level 5 + 1 artifact of each colour
        print(f"   215 create alliance refused: level {player_level(XP_BOX[0])}", flush=True)
        return [(9215, pb.v(1, 1) + pb.ld(2, req))]
    aid = 0xA11000000000 + max([int(k) & 0xFFFFFF for k in ALLIANCES] + [0]) + 1
    a = {"id": aid, "name": q.get(1, b"").decode("utf-8", "replace"), "tag": q.get(2, b"").decode("utf-8", "replace"),
         "desc": q.get(3, b"").decode("utf-8", "replace"), "created": time.time(),
         "members": {str(me): ALLIANCE_LEADER}, "joined": {str(me): time.time()}, "offers": []}
    ALLIANCES[str(aid)] = a
    for item in OFFSET_ITEM.values():   # red / blue / yellow artifact (CREATE screen costs 1 each)
        if INVENTORY.get(item, 0) > 0:
            INVENTORY[item] -= 1
    print(f"   215 create alliance {aid:X} {a['name']!r} [{a['tag']}] by {me:X}", flush=True)
    _save_state()
    return pb.ld(1, alliance_rec(a, me))


def handle_219(req):
    """Own alliance: {} -> {1 alliance record} (absent = no alliance)."""
    a = alliance_of(CUR_PLAYER[0])
    return pb.ld(1, alliance_rec(a, CUR_PLAYER[0])) if a else b""


GOFA_220_EMPTY = os.environ.get("GOFA_220_EMPTY", "0") == "1"   # 1 = profile spins (tested)


def handle_220(req):
    """Alliance by id: {1 id} -> {1 id*, 2 alliance record}."""
    aid = _req_fields(req).get(1, 0)
    a = _alliance_by_id(aid)
    if not aid and GOFA_220_EMPTY:   # experiment: viewed player has no alliance -> empty reply
        return b""
    return pb.v(1, aid) + (pb.ld(2, alliance_rec(a, CUR_PLAYER[0])) if a else b"")


def handle_229(req):
    """Alliance search: {1 text} (also sent empty every ~40 s) -> {1 text*, 2 alliance records}."""
    q = _req_fields(req).get(1, b"")
    t = q.decode("utf-8", "replace").strip().lower()
    hits = [a for a in ALLIANCES.values() if t in a["name"].lower() or t in a["tag"].lower()]
    return pb.ld(1, q) + b"".join(pb.ld(2, alliance_rec(a, CUR_PLAYER[0])) for a in hits[:50])


def handle_234(req):
    """The player's own offers (applications sent / invitations received): {} -> {1 offers 0x100c63120}."""
    me = CUR_PLAYER[0]
    return b"".join(pb.ld(1, offer_rec(a, o)) for a in ALLIANCES.values() for o in a.get("offers", []) if o["pid"] == me)


def _alliance_push():
    """No response types exist for the alliance actions: push the own alliance (219) and own offers (234) instead."""
    _save_state()
    return [(219, handle_219(b"")), (234, handle_234(b"")), (267, handle_267(None))]   # 267: mates' shared bookmarks


def _add_offer(a, pid, kind, by):
    a.setdefault("offers", [])
    if not any(o["pid"] == pid for o in a["offers"]):
        a["offers"].append({"pid": pid, "type": kind, "ts": time.time(), "by": by})


def _join(a, pid):
    for other in ALLIANCES.values():   # drop every other offer of the new member
        other["offers"] = [o for o in other.get("offers", []) if o["pid"] != pid]
    if not alliance_of(pid):
        a["members"][str(pid)] = ALLIANCE_MEMBER
        a.setdefault("joined", {})[str(pid)] = time.time()


def handle_216(req):
    """Invite a player (INFO_CANNOT_INVITE caller): {1 player id}. Needs an alliance; offer type 2 = invitation."""
    me, pid = CUR_PLAYER[0], _req_fields(req).get(1, 0)
    a = alliance_of(me)
    print(f"   216 invite {pid:X} to {a and a['name']!r}", flush=True)
    if a and pid != me and not alliance_of(pid):
        _add_offer(a, pid, OFFER_INVITATION, me)
    return _alliance_push()


def handle_232(req):
    """Apply to an alliance (member-cap errors caller): {1 alliance id}. Offer type 1 = application."""
    me, aid = CUR_PLAYER[0], _req_fields(req).get(1, 0)
    a = _alliance_by_id(aid)
    print(f"   232 apply {me:X} -> {aid:X} {a and a['name']!r}", flush=True)
    if a and not alliance_of(me):
        _add_offer(a, me, OFFER_APPLICATION, None)
    return _alliance_push()


def handle_217(req):
    """Answer an offer (INFO_CANNOT_ACCEPT / REJECT caller): {1 id, 2 answer}. id = alliance id (my invitation) or
    player id (an application to my alliance); answer 1 = accept, anything else = reject (guess)."""
    me, q = CUR_PLAYER[0], _req_fields(req)
    oid, ans = q.get(1, 0), q.get(2, 0)
    print(f"   217 answer offer {oid:X} -> {ans}", flush=True)
    a = _alliance_by_id(oid)
    if a and any(o["pid"] == me for o in a.get("offers", [])):     # invitation to me
        if ans == 1:
            _join(a, me)
        else:
            a["offers"] = [o for o in a["offers"] if o["pid"] != me]
    else:
        a = alliance_of(me)
        if a and any(o["pid"] == oid for o in a.get("offers", [])):  # application to my alliance
            if ans == 1:
                _join(a, oid)
            else:
                a["offers"] = [o for o in a["offers"] if o["pid"] != oid]
    return _alliance_push()


def handle_305(req):
    """OFFERS accept tick (leader, seen in game): {1 applicant player id, 2 1}. Same logic as 217."""
    return handle_217(req)


def handle_221(req):
    """40 s poller while the alliance panel / a profile is open: {1 own alliance id}. No response type; the client
    stops it when an alliance record with members (field 8) arrives (0x10043265c) -> push 219 (+ 234)."""
    return _alliance_push()


def handle_223(req):
    """Same poller for the offers (alliance field 9): {} -> push 219 (+ 234)."""
    return _alliance_push()


def handle_306(req):
    """CANCEL INVITATION on a PLAYER PROFILE (seen 2026-10-21): {1 invited player id} -> drop the own alliance's offer."""
    me, pid = CUR_PLAYER[0], _req_fields(req).get(1, 0)
    a = alliance_of(me)
    print(f"   306 cancel invitation {pid:X} from {a and a['name']!r}", flush=True)
    if a:
        a["offers"] = [o for o in a.get("offers", []) if o["pid"] != pid]
    return _alliance_push()


def handle_226(req):
    """Cancel an application / invitation: {1 id} (alliance id for my application, player id for an invitation).
    MEMBERS kick (seen 2026-10-20) sends the same 226 {1 member player id}: a higher rank removes a lower one."""
    me, oid = CUR_PLAYER[0], _req_fields(req).get(1, 0)
    mine = alliance_of(me)
    if mine and oid != me and str(oid) in mine["members"]:
        if mine["members"][str(me)] < mine["members"][str(oid)]:
            del mine["members"][str(oid)]
            mine.get("joined", {}).pop(str(oid), None)
            print(f"   226 kick {oid:X} from {mine['name']!r}", flush=True)
        return _alliance_push()
    print(f"   226 cancel offer {oid:X}", flush=True)
    a = _alliance_by_id(oid)
    if a:
        a["offers"] = [o for o in a.get("offers", []) if o["pid"] != me]
    elif alliance_of(me):
        alliance_of(me)["offers"] = [o for o in alliance_of(me).get("offers", []) if o["pid"] != oid]
    return _alliance_push()


def handle_218(req):
    """Promote / demote: {1 player id, 2 rank 1-5}. Promoting to leader demotes the old leader to senior officer."""
    me, q = CUR_PLAYER[0], _req_fields(req)
    pid, rank = q.get(1, 0), q.get(2, ALLIANCE_MEMBER)
    a = alliance_of(me)
    print(f"   218 rank {pid:X} -> {rank}", flush=True)
    if a and str(pid) in a["members"] and a["members"].get(str(me)) == ALLIANCE_LEADER:
        if rank == ALLIANCE_LEADER:
            a["members"][str(me)] = 2
        a["members"][str(pid)] = rank
    return _alliance_push()


def _leave_alliance(why):
    """LEAVE ALLIANCE / DELETE (227 / 230, both empty requests): a leader deletes the alliance, others leave."""
    me = CUR_PLAYER[0]
    a = alliance_of(me)
    print(f"   {why} leave/delete {a and a['name']!r} by {me:X}", flush=True)
    if a:
        if a["members"].get(str(me)) == ALLIANCE_LEADER:
            ALLIANCES.pop(str(a["id"]), None)
            for o in ALLIANCES.values():   # other alliances drop their relations / offers with the deleted one
                if any(int(d["other"]) == int(a["id"]) for d in o.get("diplomacy", [])):
                    _diplo_drop(o, a["id"], (10, 11, 12))
                    PENDING_ALLIANCE_PUSH.update(int(m) for m in o["members"])
        else:
            a["members"].pop(str(me), None)
    return _alliance_push()


def handle_227(req):
    return _leave_alliance("227")


def handle_230(req):
    return _leave_alliance("230")


def handle_228(req):
    """EDIT: {2 description} (1 = tag, never sent by the dialog) -> pushes 219 + 234."""
    q = _req_fields(req)
    a = alliance_of(CUR_PLAYER[0])
    print(f"   228 edit {q}", flush=True)
    if a:
        if 2 in q:   # the EDIT dialog only has the description box (verified in game 2026-10-21)
            a["desc"] = q[2].decode("utf-8", "replace")
        if q.get(1):
            a["tag"] = q[1].decode("utf-8", "replace")
        _save_state()
    return _alliance_push()


# moved to gofa_core/rules/ruleset.py: START_RANDOM

MAP_SECTORS = []   # (x, y) of every bundled map sector file


def random_start_planet(taken):
    """A random free planet anywhere on the bundled map (user's notes from the original: leaving the home system "would
    place you in a RANDOM place in the galaxy map"): not owned, no pirate base, not a citadel (types 7-9), in a system
    where no other player holds a planet."""
    import random
    if not MAP_SECTORS:
        for n in os.listdir(os.path.join(here, "..", "data", "map_x")):
            if "_" in n and n.replace("_", "").isdigit():
                MAP_SECTORS.append(tuple(map(int, n.split("_"))))
    busy = {system_of(p) for p in OWNERS}
    for _ in range(400):
        systems = sector_systems(*random.choice(MAP_SECTORS))
        if not systems:
            continue
        sid, name, planets = random.choice(systems)
        cands = [p for p in planets if p and p not in taken and system_of(p) not in busy
                 and map_planet_type(p) not in (7, 8, 9) and planet_pos(p) is not None]
        if cands:
            return random.choice(cands)
    return None


def pick_start_planet():
    """Start planet in the outer galaxy: random (START_RANDOM), else Murana1 if nobody owns it, else the nearest free
    planet (rings of sectors around the default start) that no player / NPC holds."""
    taken = {k for k, v in OWNERS.items() if v != CUR_PLAYER[0]} | set(NPC_PLANETS)
    if START_RANDOM:
        pl = random_start_planet(taken)
        if pl:
            return pl
    if JUMPGATE_START_PLANET not in taken:
        return JUMPGATE_START_PLANET
    x0, y0 = JUMPGATE_START_PLANET // 10**11, (JUMPGATE_START_PLANET // 10**7) % 10**4
    for r in range(0, 6):
        for sx in range(x0 - r, x0 + r + 1):
            for sy in range(y0 - r, y0 + r + 1):
                if max(abs(sx - x0), abs(sy - y0)) != r:
                    continue
                for sid, name, planets in sector_systems(sx, sy):
                    for pl in planets:
                        if pl and pl not in taken and planet_pos(pl) is not None:
                            return pl
    return JUMPGATE_START_PLANET


def seed_new_player():
    """New account: home system by species, start planet in the outer galaxy (jumpgate state) + bookmarks around it,
    like a first jumpgate tap."""
    set_home(HOME_BY_RACE.get(race_of(CUR_PLAYER[0]), HOME_DEFAULT))
    HOME_NPC.clear()
    HOME_NPC.update(home_outlaws())
    if os.environ.get("GOFA_PRESEED") != "1":
        return   # outer galaxy stays locked: the start planet, bookmarks and pirate bases come with the first jumpgate use (241)
    if JUMPGATE.get("planet") or not JUMPGATE_AUTO_START:
        return
    start = pick_start_planet()
    JUMPGATE.update({"planet": start, "ts": time.time()})
    try:
        seed_bookmarks(start)
    except Exception as e:
        print(f"=== seed_bookmarks failed: {e!r}", flush=True)
    OWNERS[start] = CUR_PLAYER[0]
    print(f"=== new player {CUR_PLAYER[0]:X}: start planet {start}", flush=True)


def spy_player_data(target):
    """(fleet {type: n}, troops, resources {1-3: n}, player_info) of another player's planet, read from their save."""
    owner = other_owner(target)
    info, st = player_info(owner), _player_save(owner) or {}
    ps = st.get("planet_state", {}).get(str(target), {})
    res = {r["type"]: int(r["amount"]) for r in ps.get("resources", [])}
    fleet = {}
    for c in st.get("carriers", []):
        if c.get("at") == target:
            for t, n in c.get("ships", {}).items():
                fleet[int(t)] = fleet.get(int(t), 0) + n
    if info.get("race") == VOID_RACE:   # a Void keeps its ships on the planet itself (no carriers)
        for t, n in ps.get("ships", {}).items():
            fleet[int(t)] = fleet.get(int(t), 0) + n
    sts = [(st["type"], st["level"]) for st in ps.get("structures", {}).values()]
    return fleet, res.pop(4, 0), {t: n for t, n in res.items() if t in (1, 2, 3)}, info, sts


# Step 4 (timers for every player): poll-time ticks are lazy, so a player who logs back in catches up anyway; this
# keeps the others current too (needed once players interact). Every TICK_OTHERS_SECONDS one poll runs the
# state-changing ticks for every other known player; their pushes wait in VOLATILE (PENDING_MAIL) or are re-sent
# at their next login.
TICK_OTHERS_SECONDS = int(os.environ.get("GOFA_TICK_OTHERS", "60"))
# Spread (load test 2026-10-26): at most TICK_OTHERS_BATCH players per poll, each once its own TICK_OTHERS_SECONDS are up
# (all at once took 2.4 s inside one poll at 100 players).
TICK_OTHERS_BATCH = int(os.environ.get("GOFA_TICK_BATCH", "4"))
TICK_OTHERS_LAST = globals().get("TICK_OTHERS_LAST")
if not isinstance(TICK_OTHERS_LAST, dict):
    TICK_OTHERS_LAST = {}   # player id -> time of its last tick


def tick_others():
    now = time.time()
    due = [a["player"] for a in list(ACCOUNTS["accounts"])
           if a["player"] != CUR_PLAYER[0] and now - TICK_OTHERS_LAST.get(a["player"], 0) >= TICK_OTHERS_SECONDS]
    for pid in sorted(due, key=lambda p: TICK_OTHERS_LAST.get(p, 0))[:TICK_OTHERS_BATCH]:
        TICK_OTHERS_LAST[pid] = now
        if not os.path.exists(player_file(pid)):
            continue
        try:
            with as_player(pid):
                pirate_raids(); finish_moves(); abandon_planets(); resolve_missions(); boosters_now()
                ENDED_TRAVELS.clear()
                save_state()
        except Exception as e:
            print(f"=== tick_others {pid:X} failed: {e!r}", flush=True)


def dispatch(body):
    env = {f: v for f, wt, v in pb.fields(body) if f in (1, 2) and wt == 1}
    with as_player(player_of_session(env.get(1, 0), env.get(2, 0))):
        return _dispatch(body)


def _dispatch(body):
    """Returns (response bytes, list of call descriptions)."""
    out, seen, session = [], [], 0
    for f, wt, val in pb.fields(body):
        if f == 1:
            session = val
        if f != 10:
            continue
        for ext, _, payload in pb.fields(val):
            fn = HANDLERS.get(ext)
            if fn is None and schema.EXT.get(("response", ext)) in schema.MESSAGES and not auto_skipped(ext):
                fn = auto_reply
            seen.append(f"{ext}{'' if fn not in (None, auto_reply) else ' (auto)' if fn else ' (unhandled)'}")
            reply = (fn(payload, ext) if fn is auto_reply else fn(payload)) if fn else None
            if isinstance(reply, tuple):  # handler answers with a different extension number
                reply = [reply]
            if isinstance(reply, list):    # one or more (extension, payload) responses
                out.extend(pb.ld(10, pb.ld(n, checked(n, body))) for n, body in reply)
            elif reply is not None:
                out.append(pb.ld(10, pb.ld(ext, checked(ext, reply))))
    return pb.f64(1, session) + b"".join(out), seen


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        stamp = datetime.datetime.now().strftime("%H%M%S_%f")
        host = self.headers.get("Host", "?").split(":")[0]
        capture(f"{stamp}_{host}.bin", body)
        try:
            resp, seen = dispatch(body)
        except Exception as e:
            resp, seen = b"", [f"decode error {e}"]
        capture(f"{stamp}_{host}.resp.bin", resp)
        print(f"{stamp} POST {host}{self.path} {len(body)}B calls={seen} -> {len(resp)}B {resp.hex()}", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/dominion-bin")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def do_GET(self):
        q = _qs(self.path)
        with as_player(int(q["player"], 16) if "player" in q else play_as_pid(None)):
            Handler._do_GET(self)   # serve.py calls Handler.do_GET with its own handler object as self

    def _do_GET(self):
        """Non-protocol requests (e.g. the world connection's /action/sectors map download): log + capture."""
        if "/debug" in self.path:   # admin endpoints: this Mac / the home LAN only (the server is reachable from the internet)
            import ipaddress
            ip = ipaddress.ip_address(self.client_address[0].replace("::ffff:", ""))
            if not (ip.is_loopback or ip.is_private):
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                print("debug refused from", ip, flush=True)
                return
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        stamp = datetime.datetime.now().strftime("%H%M%S_%f")
        host = self.headers.get("Host", "?").split(":")[0]
        capture(f"{stamp}_{host}_{self.command}.bin",
                self.requestline.encode() + b"\n" + str(dict(self.headers)).encode() + b"\n\n" + body)
        if self.path.endswith("/gofa.pac"):   # Wi-Fi "Configure Proxy -> Automatic" for devices that ignore manual DNS
            pac = ('function FindProxyForURL(url, host) { if (dnsDomainIs(host, ".fishlegion.net")) '
                   f'return "PROXY {self.connection.getsockname()[0]}:80"; return "DIRECT"; }}\n').encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ns-proxy-autoconfig")
            self.send_header("Content-Length", str(len(pac)))
            self.end_headers()
            self.wfile.write(pac)
            print(f"{stamp} GET gofa.pac from {self.client_address[0]}", flush=True)
            return
        if "/debug/playas" in self.path:   # ?alias=NAME : the iPad plays that player from the next relaunch (new = fresh start); ?alias= : back to normal
            q = _qs(self.path)
            name = q.get("alias", "")
            if name:
                account_for(name)["ipad"] = True
                ACCOUNTS["play_as"] = name
                if "race" in q:   # &race=1..4 : species in the player record (field 3)
                    account_for(name)["race"] = int(q["race"])
            else:
                ACCOUNTS.pop("play_as", None)
            _write_json(ACCOUNTS_FILE, ACCOUNTS)
            _reply(self, f"play_as {name or '(off)'}".encode())
            return
        if "/debug/deviceas" in self.path:   # ?dev=DEVICE-ID&alias=NAME : 2013 logins from that device play NAME (alias= removes)
            q = _qs(self.path)
            m = ACCOUNTS.setdefault("device_as", {})
            if q.get("alias"):
                m[q["dev"]] = q["alias"]
            else:
                m.pop(q.get("dev", ""), None)
            _write_json(ACCOUNTS_FILE, ACCOUNTS)
            _reply(self, f"device_as {m}".encode())
            return
        if "/debug/speciesselect" in self.path:   # ?on=1|0 : new Game Center players get the species selection
            on = _qs(self.path).get("on", "1") == "1"
            ACCOUNTS["species_select"] = on
            _write_json(ACCOUNTS_FILE, ACCOUNTS)
            _reply(self, f"species_select {on} (env GOFA_SPECIES_SELECT={os.environ.get('GOFA_SPECIES_SELECT')})".encode())
            return
        if "/debug/sendattack" in self.path and q_player(self.path):   # &player=HEX : the same for another player
            with as_player(q_player(self.path)):
                c = next((x for x in CARRIERS if x["id"] == int(_qs(self.path).get("cid", 0))), None) or (CARRIERS[0] if CARRIERS else None)
                q = _qs(self.path)
                if c:
                    JOB_ID[0] += 1
                    now = time.time()
                    c["move"] = {"id": JOB_ID[0], "order": ORDER_ATTACK, "target": int(q.get("target", 0)), "origin": c.get("at", HOME_PLANET), "start": now,
                                 "end": now + int(q.get("secs", 30)), "speed": 1.0}
                    c["ships"] = {k: int(n) for k, n in (x.split(":") for x in q.get("ships", "").split(",") if x)}
                    save_state()
            _reply(self, str(c and c["id"]).encode())
            return
        if "/debug/sendattack" in self.path:   # ?cid=..&target=..&secs=n : put a carrier on an attack move that arrives in n seconds
            q = _qs(self.path)
            c = next((x for x in CARRIERS if x["id"] == int(q.get("cid", 0))), None)
            if c:
                JOB_ID[0] += 1
                now = time.time()
                c["move"] = {"id": JOB_ID[0], "order": ORDER_ATTACK, "target": int(q.get("target", 0)), "origin": c.get("at", HOME_PLANET), "start": now,
                             "end": now + int(q.get("secs", 30)), "speed": 1.0}
                if q.get("ships"):   # &ships=5:40&cargo=4:30 : loadout for the test
                    c["ships"] = dict(x.split(":") for x in q["ships"].split(","))
                    c["ships"] = {k: int(n) for k, n in c["ships"].items()}
                if q.get("cargo"):
                    c["cargo"] = {k: int(n) for k, n in (x.split(":") for x in q["cargo"].split(","))}
                PENDING_PLANET_PUSH[:] = [time.time()]
                save_state()
            _reply(self, str(c and c["move"]).encode())
            return
        if "/debug/credits" in self.path:   # ?n=count : set the credit balance (pushed at the next login)
            CREDITS_BOX[0] = int(_qs(self.path).get("n", 1000000000))
            save_state()
            _reply(self, f"credits {CREDITS_BOX[0]}".encode())
            return
        if "/debug/abandon" in self.path:   # ABANDON GAME (2900) for the iPad player: fresh start in its species' home
            r = handle_2900(b"")
            _reply(self, f"abandon {CUR_PLAYER[0]:X} home {HOME_PLANET} {'refused' if r else 'ok'}".encode())
            return
        if "/debug/xp" in self.path:   # add XP (?add=n) and push the new level/XP on the next 281 poll
            q = _qs(self.path)
            (battle_xp if q.get("battle") else lambda n: XP_BOX.__setitem__(0, XP_BOX[0] + n))(int(q.get("add", 100)))   # &battle=1: counts as XP from battles
            CMD_EXTRA.clear(); CMD_EXTRA.update({int(k[1:]): int(v) for k, v in q.items() if k[0] == "f"})
            PENDING_XP[:] = [1]
            save_state()
            _reply(self)
            return
        if "/debug/battlemail" in self.path:   # kind-5 battle report test mail (details variant 3)
            q = _qs(self.path)
            add_mail(kind=int(q.get("kind", 5)), body=f"Battle test kind {q.get('kind', 5)}", battle={"planet": 1500210002101, "enemy": "Pirate Lord",
                     "mine": {1: 10, 3: 5}, "theirs": {1: 6}, "mine_after": {1: 8, 3: 5}, "theirs_after": {},
                     "top": json.loads(q.get("top", "{}")), "bf": json.loads(q.get("bf", "{}")),
                     **json.loads(q.get("extra", "{}"))})
            _reply(self)
            return
        if "/debug/npcfleet" in self.path:   # ?target=planet&fleet=1:300,3:200 : set a pirate planet's fleet
            q = _qs(self.path)
            npc = npc_at(int(q.get("target", 0)))
            if npc:
                npc["fleet"] = {k: int(n) for k, n in (x.split(":") for x in q.get("fleet", "").split(",") if x)}
                save_state()
            _reply(self, str(npc and npc["fleet"]).encode())
            return
        if "/debug/giveships" in self.path:   # ?player=HEX&planet=id&ships=1:3,5:2 : station ships on another player's planet
            q = _qs(self.path)
            pairs = {int(k): int(n) for k, n in (x.split(":") for x in q.get("ships", "").split(",") if x)}
            with as_player(int(q.get("player", "0"), 16)):
                with on_planet(int(q.get("planet", 0))):
                    SHIPS.update(pairs)
                save_state()
            _reply(self, str(pairs).encode())
            return
        if "/debug/dropmail" in self.path:   # ?enemy=NAME : remove test battle reports
            q = _qs(self.path)
            n = len(MAIL)
            MAIL[:] = [m for m in MAIL if (m.get("battle") or {}).get("enemy") != q.get("enemy")]
            save_state()
            _reply(self, str(n - len(MAIL)).encode())
            return
        if "/debug/spymail" in self.path:   # ?f4=n : kind-6 espionage report test mail (details variant 6)
            q = _qs(self.path)
            npid, npc = next(iter(NPC_PLANETS.items()))
            npid = int(q.get("planet", npid))
            spy = {"owner": npc["id"], "name": npc["name"], "planet": npid,
                   "stock": npc.get("stock", 0), "troops": npc.get("troops", 0), "fleet": npc.get("fleet", {})}
            if q.get("spier") or q.get("anon"):   # ?spier=NAME : the spied player's copy naming the spy; ?anon=1 : the anonymous case (id 0, no name)
                spy["spier"] = {"id": 1 if q.get("spier") else 0, "alias": q.get("spier", "")}
            if "f4" in q:   # ?f4=N : this mail's details field 4 (lead selector, see handle_327), the global SPY_F4 stays
                spy["f4"] = int(q["f4"])
            tpl = {}
            if q.get("key"):   # ?key=MSG_GOT_SPIED_SUCCESS[_DETECTED] &user=NAME &pname=PLANET &tkind=N : the lead text as a field 7 template (loca key + <PLANET> / <USER>)
                tpl = {"template": q["key"], "tkind": int(q.get("tkind", 2)), "params": {"PLANET": q.get("pname", "Suson5"), "USER": q.get("user", "Someone")}}
            add_mail(kind=6, body="ESPIONAGE", spy=spy, **tpl)
            _reply(self)
            return
        if "/debug/delmail" in self.path:   # ?id=n : drop a mail on the server (the client keeps its copy until DELETE)
            q = _qs(self.path)
            MAIL[:] = [m for m in MAIL if m["id"] != int(q["id"])]
            save_state()
            _reply(self)
            return
        if "/debug/ajoin" in self.path:   # ?pid=HEX&alliance=ID : move a player into an alliance (member rank)
            q = _qs(self.path)
            pid = str(int(q["pid"], 16))
            for x in list(ALLIANCES.values()):
                x["members"].pop(pid, None)
            a = ALLIANCES[q["alliance"]] if q["alliance"] in ALLIANCES else ALLIANCES[int(q["alliance"])]
            a["members"][pid] = ALLIANCE_MEMBER
            a.setdefault("joined", {})[pid] = time.time()
            PENDING_ALLIANCE_PUSH.update(int(m) for m in a["members"])
            _save_state()
            _reply(self, json.dumps(a).encode())
            return
        if "/debug/relation" in self.path:   # ?a=ID&b=ID&state=4 NAP / 5 WAR / 0 neutral (both sides)
            q = _qs(self.path)
            set_relation(_alliance_by_id(q["a"]), _alliance_by_id(q["b"]), int(q.get("state", DIPLO_NAP)))
            _save_state()
            _reply(self)
            return
        if "/debug/battle" in self.path:   # ?planet=ID&n=3 log n battles (galaxy HEAT MAP); ?clear=1 empties the log
            q = _qs(self.path)
            if q.get("clear"):
                BATTLES.clear()
            else:
                for _ in range(int(q.get("n", 1))):
                    log_battle(int(q["planet"]))
            _save_state()
            _reply(self, json.dumps(BATTLES[-20:]).encode())
            return
        if "/debug/star" in self.path:   # ?planet=ID&v=N : system field 10 for that planet's system (v=0 removes)
            q = _qs(self.path)
            sid = system_of(int(q["planet"]))
            STAR_TEST[sid] = int(q.get("v", 0))
            _reply(self, json.dumps({str(k): v for k, v in STAR_TEST.items()}).encode())
            return
        if "/debug/arank" in self.path:   # /debug/arank?pid=HEX&rank=1..5 : set an alliance member's rank
            q = _qs(self.path)
            a = alliance_of(int(q["pid"], 16))
            if a:
                a["members"][str(int(q["pid"], 16))] = int(q["rank"])
                PENDING_ALLIANCE_PUSH.update(int(m) for m in a["members"])
                _save_state()
            _reply(self, json.dumps(a).encode())
            return
        if "/debug/mkalliance" in self.path:   # ?name=&tag=[&pid=hex]: CREATE (handle_215) for a player
            q = _qs(self.path)
            with as_player(int(q.get("pid", "%X" % PLAYER_ID), 16)):
                handle_215(pb.ld(1, q.get("name", "Sol Union").encode()) + pb.ld(2, q.get("tag", "SOL").encode()))
            _reply(self, json.dumps(alliance_of(int(q.get("pid", "%X" % PLAYER_ID), 16))).encode())
            return
        if "/debug/void" in self.path:   # ?spawn=1[&near=planet][&n=3][&level=12] starts a Void event; ?tick=1 lets the gates produce ships now; else lists the Voids
            q = _qs(self.path)
            if "spawn" in q:
                spawn_void(int(q["near"]) if "near" in q else None, int(q.get("n", 3)), int(q.get("level", VOID_LEVEL)))
            if "tick" in q:
                for a in void_accounts():
                    a["void"]["regen"] = 0
                void_tick()
            rows = [{"alias": a["alias"], "player": a["player"], "level": a["void"]["level"], "crystals": a["void"]["crystals"],
                     "planets": sorted(p for p, o in OWNERS.items() if o == a["player"])} for a in void_accounts()]
            for row in rows:   # ships on each Void planet (what the raids take from it and the gate builds back)
                with as_player(row["player"]):
                    row["ships"] = {str(p): sum(_player_ships(p).values()) for p in row["planets"]}
            _reply(self, json.dumps(rows).encode())
            return
        if "/debug/npcrespawn" in self.path:   # force one npc_respawn() now (ignores NPC_MIN)
            keep = NPC_MIN
            globals()["NPC_MIN"] = len(NPC_PLANETS) + 1
            NPC_NEXT[0] = 1
            pid = npc_respawn()
            globals()["NPC_MIN"] = keep
            body = str(pid).encode()
            _reply(self, body)
            return
        if "/debug/setlevel" in self.path:   # ?slot=n&level=n[&type=t][&planet=id] (structure, home planet by default) or ?tech=n&level=n
            q = _qs(self.path)
            if "skill" in q:   # commander skill (&points=N adds N debug skill points, not persisted)
                SKILLS[int(q["skill"])] = int(q["level"])
                SKILL_BONUS[0] = int(q.get("points", SKILL_BONUS[0]))
            elif "tech" in q:
                if int(q["level"]) and not tech_slot_free(int(q["tech"])):
                    _reply(self, f"refused: all {TECH_SLOTS} lab slots used {sorted(TECHS)}".encode())
                    return
                TECHS[int(q["tech"])] = int(q["level"])
                if not TECHS[int(q["tech"])]:
                    TECHS.pop(int(q["tech"]))   # level 0 = not researched (a 4th tech in a 3-slot lab crashes the login)
            else:   # &planet=id: a colony's structure (default home planet)
                with on_planet(int(q.get("planet", HOME_PLANET))):
                    if "type" in q:   # &type=t: put a new structure of type t into that (free) slot
                        STRUCTURES[int(q["slot"])] = {"type": int(q["type"]), "slot": int(q["slot"]), "level": int(q["level"])}
                    else:
                        STRUCTURES[int(q["slot"])]["level"] = int(q["level"])
            save_state()
            _reply(self)
            return
        if "/debug/digsecs" in self.path:   # ?s=N: length of new digs (until the next reload; default GOFA_DIG_SECONDS)
            global DIG_SECONDS
            DIG_SECONDS = int(_q(self.path, "s", str(dig_scaled(DIG_BASE[3]))))
            _reply(self)
            return
        if "/debug/inventory" in self.path:   # ?item=t&n=count, or ?ids=1 (count = item type, to read the mapping)
            q = _qs(self.path)
            if "ids" in q:
                INVENTORY.update({t: t for t in range(1, 19)})
            else:
                INVENTORY[int(q["item"])] = int(q["n"])
            save_state()
            _reply(self)
            return
        if "/debug/missions" in self.path:   # 3 quick missions on Home1 as if a scan just finished (no scan needed)
            if "clear" in self.path:   # ?clear=1: drop the debug-made missions (job 0) again
                MISSIONS[:] = [m for m in MISSIONS if m.get("job")]
                save_state()
                _reply(self)
                return
            scan_found_missions({"id": 0, "scanner": 1004, "range": 0, "planet": HOME_PLANET})
            if "nofleet" in self.path:   # ?nofleet: no pirates (a sure win, e.g. to test mission rewards)
                for m in MISSIONS[-3:]:
                    m["fleet"] = {}
                save_state()
            _reply(self)
            return
        if "/debug/daily" in self.path:   # make the daily credit bonus due on the next poll
            BOOSTS["daily_last"] = time.time() - 86401
            if "expire" in self.path:   # ?expire=item : that credit booster's current item runs out now
                q = _qs(self.path)
                BOOSTS.setdefault("credit_until", {})[q["expire"]] = time.time() - 1
                BOOSTS["daily_last"] = time.time()
            _reply(self)
            return
        if "/debug/diplo" in self.path:   # ?name=&tag=&list=10&state=1[&f4=][&swap=1] diplomacy entry with a (new) alliance; ?clear=1
            q = _qs(self.path)
            a = alliance_of(CUR_PLAYER[0])
            if q.get("clear"):
                a["diplomacy"] = []
                for k in [k for k, o in ALLIANCES.items() if o is not a and not o.get("diplomacy") and q.get("clear") == "all"
                          and all(int(m) >= 0x91A0000000F0 for m in o["members"])]:
                    ALLIANCES.pop(k)   # clear=all also drops the test alliances
            else:
                other = next((o for o in ALLIANCES.values() if o["tag"] == q["tag"]), None)
                if not other:
                    aid = 0xA11000000000 + max([int(k) & 0xFFFFFF for k in ALLIANCES] + [0]) + 1
                    other = {"id": aid, "name": q.get("name", q["tag"]), "tag": q["tag"], "desc": "", "created": time.time(),
                             "members": {str(0x91A0000000F0 + len(ALLIANCES)): ALLIANCE_LEADER}, "joined": {}, "offers": []}
                    ALLIANCES[str(aid)] = other
                d = {"other": other["id"], "list": int(q.get("list", 10)), "state": int(q.get("state", 0)), "ts": time.time()}
                for k in ("f4", "swap"):
                    if k in q:
                        d[k] = int(q[k])
                a.setdefault("diplomacy", []).append(d)
            PENDING_ALLIANCE_PUSH.update(int(m) for m in a["members"])
            _save_state()
            _reply(self)
            return
        if "/debug/raid" in self.path:   # ?planet=id : raid that colony on the next poll
            q = _qs(self.path)
            RAIDS[int(q["planet"])] = time.time() - 1   # due now (0 counted as "overdue while offline" -> skipped)
            _reply(self)
            return
        if "/debug/rebalancenpcs" in self.path:   # rebuild every pirate base's defence from pirate_base(level); old level = fighters / 2
            for npc in NPC_PLANETS.values():
                old = npc.get("base_fleet") or npc.get("fleet") or {}
                lvl = max(1, int(old.get("1", old.get(1, 2))) // 2)
                if "scale" in self.path:   # ?scale=1: also lift weak bases to the HQ-based level (npc_level)
                    lvl = max(lvl, home_hq_level() // 2)
                npc.update(pirate_base(lvl)); npc.pop("base_fleet", None); npc.pop("defeated", None)
            save_state()
            _reply(self)
            return
        if "/debug/seednpcs" in self.path:   # pirate bases near the jumpgate planet
            seed_npcs(JUMPGATE.get("planet", JUMPGATE_START_PLANET))
            _reply(self)
            return
        if "/debug/seedbookmarks" in self.path:   # bookmark the systems near the jumpgate planet
            BOOKMARKS[:] = [b for b in BOOKMARKS if b.get("ts", 0) > time.time()]
            seed_bookmarks(JUMPGATE.get("planet", JUMPGATE_START_PLANET))
            _reply(self)
            return
        if "/debug/bookmark" in self.path:   # ?planet=id&type=3
            q = _qs(self.path)
            JOB_ID[0] += 1
            BOOKMARKS.append({"id": JOB_ID[0], "planet": int(q["planet"]), "type": int(q.get("type", 3)), "name": "",
                              "ts": time.time()})
            save_state()
            _reply(self)
            return
        if "/debug/loadcarrier" in self.path:   # ?carrier=id&ships=1:10,3:5&cargo=4:20 (sets the carrier's loadout)
            q = _qs(self.path)
            c = next(c for c in CARRIERS if str(c["id"]) == q["carrier"])
            pairs = lambda v: {k: int(n) for k, n in (x.split(":") for x in v.split(",") if x)}
            if "ships" in q:
                c["ships"] = pairs(q["ships"])
            if "cargo" in q:
                c["cargo"] = pairs(q["cargo"])
            save_state()
            _reply(self)
            return
        if "/debug/quote" in self.path:   # ?planet=id&type=t&level=n[&player=HEX] : what a build / upgrade order costs and takes (read-only; same numbers as _handle_200)
            q = _qs(self.path)
            pid = int(q.get("planet", HOME_PLANET))
            if pid not in own_planets():
                _reply(self, b'{"error": "not an own planet"}')
                return
            if "carrier" in q:   # &carrier=T&level=L&yard=STRUCTURE_ID : one carrier of that type, as _handle_202 prices it
                ctype, clv, yard = int(q["carrier"]), int(q.get("level", 1)), int(q.get("yard", 0))
                with on_planet(pid):
                    ylv = yard_level(yard, 2, pid)
                    *unit, secs = species_scaled(CAT_SHIPS, *carrier_cost(clv), carrier_seconds(clv), pid=pid, percent=yard_percent(2, ylv))
                _reply(self, json.dumps({"planet": pid, "type": ctype, "level": clv, "cost": unit, "seconds": secs, "yard_level": ylv,
                                         "yard_needed": CARRIER_YARD.get((ctype - 1) // 4, 1), "items": {str(k): v for k, v in (carrier_items(ctype, clv) or {}).items()},
                                         # the carrier view's "increases ... by n%" line (INFO_UPGRADE_ARTIFACT_*): this type / level's bonus in its colour (1 red, 2 blue, 3 yellow)
                                         "colour": OFFSET_COLOUR.get((ctype - 1) % 4, 0), "bonus": carrier_bonus(ctype, clv, OFFSET_COLOUR.get((ctype - 1) % 4, 0)),
                                         "inventory": {str(k): v for k, v in INVENTORY.items() if v}}).encode())
                return
            if "trade" in q:   # &trade=STRUCTURE_ID : the trade centre's exchange rate (handle_208: amount x 100 / percent arrives) and the storage cap
                tid = int(q["trade"])
                with on_planet(pid):
                    tlv = yard_level(tid, 10, pid)
                    _reply(self, json.dumps({"planet": pid, "trade": tid, "level": tlv, "percent": yard_percent(10, tlv), "capacity": capacity()}).encode())
                return
            if "jumpgate" in q:   # &jumpgate=1 : the jumpgate button's state for the web page (read-only): open = a start planet is set (242), locked = home tutorial missions still open (handle_241 answers 9241), planets outside the home system against the limit
                left = [] if JUMPGATE.get("planet") else gate_missions_left()
                _reply(self, json.dumps({"open": bool(JUMPGATE.get("planet")), "planet": JUMPGATE.get("planet"), "locked": bool(left),
                                         "left": [{"mission": m, "text": GATE_MISSION_TEXT.get(m, f"mission {m}")} for m in left],
                                         "random": START_RANDOM, "outer": len(outer_planets()), "outer_limit": outer_planet_limit()}).encode())
                return
            if "colonies" in q:   # &colonies=1 : the colony overview for the web page (read-only): per own planet the role, system, map type / quality, HQ and defence levels, the pirate raid level of a colony (as pirate_raids / &raid=1: HQ // 2, min 1) and whether it counts against the planet limit
                rows = []
                for cp in own_planets():
                    with on_planet(cp):
                        hq = max([st["level"] for st in STRUCTURES.values() if st["type"] == 1] + [0])
                        dl = sum(st["level"] for st in STRUCTURES.values() if st["type"] == 9)
                        rl = max(1, max([st["level"] for st in STRUCTURES.values() if st["type"] == 1] + [1]) // 2)
                    rows.append({"id": cp, "role": "home" if cp == HOME_PLANET else "start" if cp == JUMPGATE.get("planet") else "colony",
                                 "system": system_of(cp), "system_name": map_system_name(cp), "number": map_planet_field(cp, 4, 0),
                                 "type": map_planet_type(cp), "quality": map_planet_field(cp, 7, 0), "hq": hq, "defence_level": dl,
                                 "raid_level": None if cp == HOME_PLANET else rl, "outer": system_of(cp) != HOME_SYSTEM})
                _reply(self, json.dumps({"planets": rows, "outer": len(outer_planets()), "outer_limit": outer_planet_limit(), "limit_on": bool(PLANET_LIMIT_ON),
                                         "raids": bool(PIRATE_RAIDS and NPC_PLANETS), "raid_min": RAID_MIN, "raid_max": RAID_MAX}).encode())
                return
            if "demolish" in q:   # &demolish=SLOT : what DEMOLISH on the building in that slot gives and takes (read-only; _demolish's numbers): half the build time, DEMOLISH_REFUND of the cost of its current level; the Headquarters gives the planet up (refused in the home system)
                dslot = int(q["demolish"])
                n_here = sum(1 for c in carriers_now() if c.get("at") == pid and not c.get("move"))   # outside on_planet: carriers belong to the account
                with on_planet(pid):
                    old = STRUCTURES.get(dslot)
                    busy = any(j["slot"] == dslot for j in BUILDS)
                    if not old:
                        out = {"planet": pid, "slot": dslot, "building": False}
                    else:
                        dlv = max(1, old["level"])
                        out = {"planet": pid, "slot": dslot, "building": True, "type": old["type"], "level": old["level"], "busy": busy,
                               "seconds": species_scaled(CAT_STRUCTURES, build_seconds(old["type"], dlv), pid=pid)[0] / 2,
                               "refund": [int(c * DEMOLISH_REFUND) for c in species_scaled(CAT_STRUCTURES, *build_cost(old["type"], dlv), pid=pid)],
                               "hq": old["type"] == 1, "refused": old["type"] == 1 and system_of(pid) == HOME_SYSTEM,
                               "gate": pid == JUMPGATE.get("planet"),
                               "carriers_here": n_here}
                _reply(self, json.dumps(out).encode())
                return
            if "dig" in q:   # &dig=STRUCTURE_ID : START DIGGING as handle_240 prices it (cost and seconds scaled by the planet quality), the artifact this planet yields and the running job (read-only)
                sid = int(q["dig"])
                with on_planet(pid):
                    cit = next((s for s in STRUCTURES.values() if s["type"] == 11 and structure_id(s["slot"], pid) == sid), None)
                secs = DIG_SECONDS if DIG_SECONDS != dig_scaled(DIG_BASE[3]) else dig_scaled(DIG_BASE[3], pid)
                job = next((j for j in DIG_JOBS if j["sid"] == sid), None)
                _reply(self, json.dumps({"planet": pid, "structure": sid, "citadel": cit is not None, "level": cit["level"] if cit else 0,
                                         "planet_type": map_planet_type(pid), "item": CITADEL_ITEM.get(map_planet_type(pid)),
                                         "cost": [dig_scaled(x, pid) for x in DIG_BASE[:3]], "seconds": secs,
                                         "job": {"id": job["id"], "end": job["end"]} if job else None,
                                         "inventory": {str(k): v for k, v in INVENTORY.items() if v}}).encode())
                return
            if "itemlist" in q:   # &itemlist=1 : what BUY charges per item type (item_price), whether it can be bought (carrier blueprints only come from missions) and the numbers behind the effect texts (read-only)
                _reply(self, json.dumps({"items": {str(t): {"price": item_price(t), "buy": t not in (4, 5), "adds": EXTENDER_AMOUNT.get(t, 0),
                                                            "boost": list(CREDIT_BOOSTERS[t]) if t in CREDIT_BOOSTERS else None} for t in range(1, 19)},
                                         "inventory": {str(k): v for k, v in INVENTORY.items() if v}}).encode())
                return
            if "attack" in q:   # &attack=TARGET&fleet=CARRIER_ID[&seen=TYPE:N,..][&troops=N] : the attack screen's numbers (read-only). The page passes only what its spy report showed (seen = identified ships, troops = the garrison it learned): the real defence stays hidden.
                tgt = int(q["attack"])
                c = next((x for x in carriers_now() if x["id"] == int(q.get("fleet", 0))), None)
                if c is None:
                    _reply(self, b'{"error": "no such carrier"}')
                    return
                ships = {int(k): v for k, v in c.get("ships", {}).items() if v}
                cargo = {int(k): v for k, v in c.get("cargo", {}).items()}
                seen = {int(a): int(b) for a, b in (x.split(":") for x in q.get("seen", "").split(",") if x)}
                npc, owner = npc_at(tgt), other_owner(tgt)
                kind = "own" if tgt in own_planets() else "pirate" if npc else "player" if owner else "free"
                mine = fleet_strength(ships, seen, own=True, carrier=c)
                theirs = fleet_strength(seen, ships) if seen else None
                ratio = mine / theirs if theirs else None
                garrison = int(q["troops"]) if "troops" in q else None
                secs = travel_seconds(c.get("at", HOME_PLANET), tgt, 1.0, carrier=c)
                gathers = GATHER_ON and system_of(tgt) != HOME_SYSTEM   # a fleet reaching a hostile planet waits for the next quarter hour
                bombed = bombed_troops(ships, garrison) if garrison is not None else None
                aboard = cargo.get(4, 0)
                _reply(self, json.dumps({"planet": pid, "target": tgt, "kind": kind, "carrier": c["id"], "at": c.get("at", HOME_PLANET), "seconds": secs,
                                         "ships": {str(k): v for k, v in ships.items()}, "troops_aboard": aboard,
                                         "bombers": ships.get(5, 0) + ships.get(6, 0), "capacity": fleet_cargo(ships),
                                         "mine": round(mine), "theirs": round(theirs) if theirs is not None else None,
                                         "ratio": round(ratio, 2) if ratio is not None else None,
                                         # the final roll is mine > theirs x U(0.8, 1.2): certain from 1.2, impossible below 0.8; a close fight (ratio inside 0.02..50) first runs rounds a quarter hour apart (at most ROUND_MAX)
                                         "chance": None if ratio is None else round(min(1.0, max(0.0, (ratio - 0.8) / 0.4)), 2),
                                         "rounds": None if ratio is None else bool(battle_goes_on(mine, theirs, 1)), "rounds_max": ROUND_MAX,
                                         "gathers": gathers, "fight_at": next_quarter(time.time() + secs) if gathers else None,
                                         "bombed": bombed, "conquer": None if garrison is None else aboard > garrison - bombed,
                                         "room": planet_room(), "limit_text": None if planet_room() else limit_text(),
                                         "outer": len(outer_planets()), "outer_limit": outer_planet_limit()}).encode())
                return
            if "spy" in q:   # &spy=TARGET&drones=N : SEND SPY DRONES as handle_327 rolls it (read-only): success and detection chance, the drones owned, what N drones can identify
                tgt, n = int(q["spy"]), max(1, int(q.get("drones", 1)))
                with on_planet(pid):
                    have = int(resource(5)["amount"])
                lvl = scanner_level(pid)
                lim = spy_limits(n, lvl, pid, tgt)
                _reply(self, json.dumps({"planet": pid, "target": tgt, "drones": n, "have": have, "scanner": lvl,
                                         "chance": round(spy_success_chance(lvl, n), 3), "detect": round(spy_detect_chance(tgt, n, lvl), 3),
                                         "limits": lim}).encode())
                return
            if "raid" in q:   # &raid=1 : the colony's pirate raids (read-only; pirate_raids' numbers): the raid level (colony HQ // 2), the party, the defence incl. engaged carriers parked here, the chance to hold. The timer stays private (raids come every RAID_MIN..RAID_MAX).
                if pid == HOME_PLANET:
                    _reply(self, json.dumps({"planet": pid, "home": True}).encode())
                    return
                near = nearest_npc(pid)
                voids = void_accounts()
                vsrc = void_raid_source(pid) if (VOID_RAIDS and voids) else None   # a Void planet in range (pirate_raids: it takes the due raid with VOID_RAID_CHANCE, always if no pirate base exists)
                station = station_at(pid, CUR_PLAYER[0])
                with on_planet(pid):
                    rlevel = max(1, max([st["level"] for st in STRUCTURES.values() if st["type"] == 1] + [1]) // 2)
                    base = pirate_base(rlevel)["fleet"]
                    raiders = {t: round(v / 2) for t, v in base.items() if round(v / 2)} or {1: 1}
                    planet_def = {t: n for t, n in SHIPS.items() if n}
                    defenders = add_ships(planet_def, engaged_ships(station))
                    dlevel = sum(st["level"] for st in STRUCTURES.values() if st["type"] == 9)
                    mine = fleet_strength(defenders, raiders, own=True, shield=defence_bonus(dlevel)) + PDEF_STRENGTH * dlevel
                    theirs = fleet_strength(raiders, defenders)
                    void = None
                    if vsrc:
                        vmine = fleet_strength(defenders, vsrc["party"], own=True, shield=defence_bonus(dlevel)) + PDEF_STRENGTH * dlevel
                        vtheirs = fleet_strength(vsrc["party"], defenders)
                        void = {"alias": vsrc["alias"], "player": vsrc["player"], "planet": vsrc["planet"], "party": {str(k): v for k, v in vsrc["party"].items()},
                                "share": VOID_RAID_SHARE, "range": VOID_RAID_RANGE, "takes_raid": VOID_RAID_CHANCE if (near and NPC_PLANETS) else 1.0,   # share of the due raids a Void answers
                                "mine": round(vmine), "theirs": round(vtheirs), "ratio": round(vmine / vtheirs, 2) if vtheirs else None,
                                "chance": round(min(1.0, max(0.0, (vmine / vtheirs - 0.8) / 0.4)), 2) if vtheirs else 1.0}
                _reply(self, json.dumps({"planet": pid, "home": False, "enabled": bool(PIRATE_RAIDS and (NPC_PLANETS or vsrc)), "void": void, "base": near[2]["name"] if near else None,
                                         "base_planet": near[1] if near else None, "level": rlevel, "raiders": {str(k): v for k, v in raiders.items()},
                                         "defenders": {str(k): v for k, v in defenders.items()}, "ships_here": {str(k): v for k, v in planet_def.items()},
                                         "carriers_engaged": sum(1 for e in station if e["behaviour"] == 1), "defence_level": dlevel,
                                         "mine": round(mine), "theirs": round(theirs), "ratio": round(mine / theirs, 2) if theirs else None,
                                         "chance": round(min(1.0, max(0.0, (mine / theirs - 0.8) / 0.4)), 2) if theirs else 1.0,
                                         "min_seconds": RAID_MIN, "max_seconds": RAID_MAX,
                                         "lost": {"ships": 0.3, "resources": 0.1}}).encode())   # a lost raid costs 30 % of the stationed ships and 10 % of metal / gas / crystal
                return
            if "move" in q:   # &move=1&fleet=CARRIER_ID&target=PLANET[&speed=1.0] : seconds of a trip (handle_203's travel_seconds) and what the carrier holds (cargo is not in the protocol)
                c = next((x for x in carriers_now() if x["id"] == int(q["fleet"])), None)
                if c is None:
                    _reply(self, b'{"error": "no such carrier"}')
                    return
                tgt = int(q.get("target", 0))
                _reply(self, json.dumps({"carrier": c["id"], "at": c.get("at", HOME_PLANET), "target": tgt,
                                         "seconds": travel_seconds(c.get("at", HOME_PLANET), tgt, float(q.get("speed", 1.0)), carrier=c),
                                         "cargo": {str(k): v for k, v in c.get("cargo", {}).items()},
                                         "capacity": fleet_cargo({int(k): v for k, v in c.get("ships", {}).items()}),
                                         "per_ship": {str(t): fleet_cargo({t: 1}) for t in SHIP_DEFS},   # cargo space of one ship of each type (the load screens check a NEW loadout)
                                         "outer": len(outer_planets()), "outer_limit": outer_planet_limit()}).encode())   # colonising needs outer < limit
                return
            if "portrait" in q:   # &portrait=1[&player=HEX] : the portrait picked at creation (2700 field 7: 2 = female, anything else male), for the browser game's avatars
                pid = int(q["player"], 16) if "player" in q else play_as_pid(None)
                acc = next((a for a in ACCOUNTS["accounts"] if a.get("player") == pid), {})
                _reply(self, json.dumps({"portrait": acc.get("portrait", 0), "female": acc.get("portrait", 0) == 2}).encode())
                return
            if "commander" in q:   # &commander=1[&xp=N] : level for an XP total, the XP where this and the next level start, skill points available
                xp = int(q.get("xp", XP_BOX[0]))
                lv = player_level(xp)
                limits = []   # natural limits (outer planets, carriers, ships) now, the level that raised them to this value, the level of the next step and its size (profile bars)
                for k in range(3):
                    f = lambda l, k=k: commander_limits(l)[k]
                    cur = f(lv)
                    nxt = next((l for l in range(lv + 1, MAX_LEVEL + 1) if f(l) > cur), None)
                    frm = next(l for l in range(1, lv + 1) if f(l) == cur)
                    limits.append({"now": cur, "from_level": frm, "next_level": nxt, "step": f(nxt) - cur if nxt else 0,
                                   "from_xp": level_threshold(frm), "next_xp": level_threshold(nxt) if nxt else None})   # profile bars = XP progress between these totals
                pt = skill_points_at(lv)   # the next skill point: the level where it comes, the XP totals at its start and at that level (SKILLS tab "NEXT SKILLPOINT")
                npl = next((l for l in range(lv + 1, MAX_LEVEL + 1) if skill_points_at(l) > pt), None)
                pfrm = next(l for l in range(1, lv + 1) if skill_points_at(l) == pt)
                next_point = {"level": npl, "step": skill_points_at(npl) - pt if npl else 0, "from_xp": level_threshold(pfrm), "next_xp": level_threshold(npl) if npl else None}
                _reply(self, json.dumps({"xp": xp, "level": lv, "xp_level": level_threshold(lv), "xp_next": level_threshold(lv + 1), "points": skill_points(),
                                         "rank": sum(1 for t in RANK_LEVELS if lv >= t), "limits": limits, "next_point": next_point,
                                         "alliance": ({"name": al["name"], "tag": al["tag"], "rank": al["members"].get(str(CUR_PLAYER[0]), ALLIANCE_MEMBER)}
                                                      if (al := alliance_of(CUR_PLAYER[0])) else None)}).encode())   # alliance rank 1 Leader .. 5 Member (profile ALLIANCE / POSITION)
                return
            if "achievements" in q:   # read-only: the star achievements' progress, one list of stars per row in the tab's order {id, target, current, done, claimed}
                rows = {}
                for mid, _r, done, rw, row in ACHIEVEMENTS:
                    try:
                        cur = int(done.current())
                    except Exception:
                        cur = 0
                    rows.setdefault(row, []).append({"id": mid, "target": done.target, "current": cur, "done": cur >= done.target, "claimed": mid in TUT_CLAIMED, "reward": {k: v for k, v in rw.items() if v}})
                _reply(self, json.dumps([rows[k] for k in sorted(rows)]).encode())
                return
            if "speedup" in q:   # read-only: &speedup=JOBID -> {"price": credits, "left": seconds} = what request 501 would charge for that job (same lookup as handle_501)
                jid, now = int(q["speedup"]), time.time()
                left = max([j["end"] - now for j in BUILDS + SHIP_JOBS + CARRIER_JOBS + SCAN_JOBS + RESEARCH + TROOP_JOBS if j["id"] == jid] + [0])
                for p2 in own_planets()[1:]:
                    with on_planet(p2):
                        left = max([left] + [j["end"] - now for j in BUILDS + SHIP_JOBS + CARRIER_JOBS if j["id"] == jid])
                _reply(self, json.dumps({"price": speedup_price(left), "left": left, "credits": CREDITS_BOX[0]}).encode())
                return
            if "tutorial" in q:   # read-only: the tutorial missions in the server's order {id, done, claimed, reward} for the web page's TUTORIAL MISSIONS panel
                out = []
                for d in TUTORIAL:
                    try:
                        ok = bool(d[2]())
                    except Exception:
                        ok = False
                    out.append({"id": d[0], "done": ok, "claimed": d[0] in TUT_CLAIMED, "gate": d[0] in GATE_MISSIONS and GATE_LOCK, "xp_mult": xp_mult(), "reward": {"xp": TUT_XP, **{k: v for k, v in d[3].items() if v}}})
                _reply(self, json.dumps(out).encode())
                return
            if "alliances" in q:   # read-only, for the web page's ALLIANCE search: &q=text filters name / tag -> {"rows": [{id, name, tag, members}], "mine": alliance id or None}
                t = q.get("q", "").lower()
                rows = [{"id": int(a["id"]), "name": a["name"], "tag": a["tag"], "members": len(a["members"])} for a in ALLIANCES.values() if t in a["name"].lower() or t in a["tag"].lower()]
                mine = alliance_of(CUR_PLAYER[0])
                _reply(self, json.dumps({"rows": sorted(rows, key=lambda r: (-r["members"], r["id"]))[:100], "mine": int(mine["id"]) if mine else None}).encode())
                return
            if "alliance" in q:   # read-only, for the web page's ALLIANCE screens. &alliance=1 -> my bundle {mine (members, offers when my rank allows), invites, applied, create}; &alliance=1&id=N -> that alliance's profile
                me = CUR_PLAYER[0]
                def _al(pid):
                    try:
                        return player_info(pid).get("alias", "?")
                    except Exception:
                        return "?"
                def _leader(a):
                    return next((_al(int(m)) for m, r in a["members"].items() if r == ALLIANCE_LEADER), "?")
                mine = alliance_of(me)
                if q.get("id"):
                    a = _alliance_by_id(int(q["id"]))
                    if not a:
                        _reply(self, b"null")
                        return
                    standing = "neutral"
                    if mine and int(mine["id"]) == int(a["id"]):
                        standing = "own"
                    elif mine:
                        for d in mine.get("diplomacy", []):
                            if d.get("list") == 10 and int(d["other"]) == int(a["id"]):
                                standing = "nap" if d.get("state") == DIPLO_NAP else "war" if d.get("state") == DIPLO_WAR else "neutral"
                    _reply(self, json.dumps({"id": int(a["id"]), "name": a["name"], "tag": a["tag"], "desc": a.get("desc", ""), "members": len(a["members"]), "leader": _leader(a), "standing": standing,
                                             "applied": any(o["pid"] == me and o["type"] == OFFER_APPLICATION for o in a.get("offers", [])), "mine": bool(mine and int(mine["id"]) == int(a["id"]))}).encode())
                    return
                out = {"mine": None, "invites": [], "applied": [], "create": {"level": player_level(XP_BOX[0]), "need": 5, "artifacts": {"red": INVENTORY.get(OFFSET_ITEM[2], 0), "blue": INVENTORY.get(OFFSET_ITEM[1], 0), "yellow": INVENTORY.get(OFFSET_ITEM[3], 0)}}}
                if mine:
                    rank = mine["members"].get(str(me), 5)
                    out["mine"] = {"id": int(mine["id"]), "name": mine["name"], "tag": mine["tag"], "desc": mine.get("desc", ""), "rank": rank, "leader": _leader(mine),
                                   "members": sorted(({"id": int(m), "name": _al(int(m)), "rank": r, "joined": mine.get("joined", {}).get(m, mine["created"])} for m, r in mine["members"].items()), key=lambda x: (x["rank"], x["id"])),
                                   "offers": [{"pid": o["pid"], "name": _al(o["pid"]), "type": o["type"], "ts": o["ts"]} for o in mine.get("offers", [])] if rank <= DIPLO_MAX_RANK else []}
                for a in ALLIANCES.values():
                    for o in a.get("offers", []):
                        if o["pid"] == me:
                            (out["invites"] if o["type"] == OFFER_INVITATION else out["applied"]).append({"id": int(a["id"]), "name": a["name"], "tag": a["tag"], "members": len(a["members"]), "ts": o["ts"]})
                _reply(self, json.dumps(out).encode())
                return
            if "leaderboard" in q:   # read-only, for the web page's LEADERBOARDS: &type=1 players (COMMANDER PROGRESS), 2 ALLIANCE SIZE, 3 ALLIANCE WARFARE, 4 ALLIANCE LEVEL
                t = int(q.get("type", 1))
                if t == 1:
                    rows = [{"rank": i + 1, "id": pid, "name": alias, "score": int(xp)} for i, (pid, alias, xp) in enumerate(ranking())]
                    own = next((r for r in rows if r["id"] == CUR_PLAYER[0]), None)
                else:
                    rows = [{"rank": i + 1, "id": aid, "name": name, "score": int(sc)} for i, (aid, name, sc) in enumerate(alliance_ranking(t))]
                    mine = alliance_id_of(CUR_PLAYER[0])
                    own = next((r for r in rows if r["id"] == mine), None) if mine else None
                _reply(self, json.dumps({"type": t, "rows": rows[:200], "own": own}).encode())
                return
            if "skill" in q:   # &skill=ID&level=n : skill points that level costs, the level cap and the points available (handle_212 itself checks nothing)
                lv = int(q["level"])
                _reply(self, json.dumps({"skill": int(q["skill"]), "level": lv, "cost": skill_cost(lv), "max_level": SKILL_MAX, "points": skill_points()}).encode())
                return
            if "unit" in q:   # &unit=drone|troop&yard=STRUCTURE_ID : one spy drone (scanner) / troop (barracks), as handle_209 prices it
                res = 5 if q["unit"] == "drone" else 4
                yard, ytype = int(q.get("yard", 0)), 8 if res == 5 else 6
                with on_planet(pid):
                    *unit, secs = species_scaled(CAT_DRONES if res == 5 else CAT_TROOPS, *(DRONE_COST if res == 5 else TROOP_COST),
                                                 DRONE_SECONDS if res == 5 else TROOP_SECONDS, pid=pid,
                                                 percent=yard_percent(ytype, yard_level(yard, ytype, pid)))
                _reply(self, json.dumps({"planet": pid, "unit": q["unit"], "cost": unit, "seconds": secs}).encode())
                return
            if "scan" in q:   # &scan=0|1 : drones used and seconds of a quick / deep scan (handle_204)
                rng = 1 if int(q["scan"]) else 0
                _reply(self, json.dumps({"planet": pid, "range": rng, "drones": SCAN_DRONES[rng], "seconds": SCAN_TIME[rng]}).encode())
                return
            if "ship" in q:   # &ship=T&yard=STRUCTURE_ID : one ship of that type, as _handle_201 prices it (cost / time per ship)
                ship, yard = int(q["ship"]), int(q.get("yard", 0))
                with on_planet(pid):
                    ylv = yard_level(yard, 2, pid)
                    m, g, c, secs = SHIP_DEFS.get(ship, SHIP_DEFS[1])[:4]
                    f33 = 1 - 0.01 * TECHS.get(33, 0)
                    m, g, c, secs = species_scaled(CAT_SHIPS, m * f33, g * f33, c * f33, secs * f33, pid=pid, percent=yard_percent(2, ylv))
                    bp = BLUEPRINT_TECH_OF.get(ship) if BLUEPRINT_GATING else None
                    bp_ok = bp is None or TECHS.get(bp, 0) >= 1
                _reply(self, json.dumps({"planet": pid, "ship": ship, "cost": [m, g, c], "seconds": secs, "yard_level": ylv,
                                         "yard_needed": SHIP_YARD.get(ship, 1), "blueprint_tech": bp, "blueprint_ok": bp_ok}).encode())
                return
            if "tech" in q:   # &tech=T&level=n&lab=STRUCTURE_ID : a research order as handle_206 prices and gates it
                tech, lv, lab = int(q["tech"]), int(q["level"]), int(q.get("lab", 0))
                with on_planet(pid):
                    lab_lv = yard_level(lab, 7, pid)
                    cost = species_scaled(CAT_TECHS, *research_cost(lv), pid=pid)
                    secs = species_scaled(CAT_TECHS, research_seconds(lv), pid=pid)[0]
                item = TECH_ITEM.get(tech)
                _reply(self, json.dumps({"planet": pid, "tech": tech, "level": lv, "cost": list(cost), "seconds": secs, "lab_level": lab_lv,
                                         "lab_needed": TECH_LAB.get(tech, 0), "max_level": TECH_MAX, "slots": TECH_SLOTS, "item": item,
                                         "item_owned": INVENTORY.get(item, 0) if item else None}).encode())
                return
            t, lv = int(q["type"]), int(q["level"])
            with on_planet(pid):
                hq = max([x["level"] for x in STRUCTURES.values() if x["type"] == 1] + [1])
                cost = species_scaled(CAT_STRUCTURES, *build_cost(t, lv), pid=pid)
                secs = species_scaled(CAT_STRUCTURES, build_seconds(t, lv), pid=pid)[0]
            _reply(self, json.dumps({"planet": pid, "type": t, "level": lv, "cost": list(cost), "seconds": secs, "hq": hq,
                                     "allowed": t == 1 or lv <= hq}).encode())
            return
        if "/debug/res" in self.path:   # set a planet's resources: ?planet=id&amount=5000[&type=1,2]
            q = _qs(self.path)
            with on_planet(int(q.get("planet", HOME_PLANET))):
                settle_resources()
                for r in RESOURCES:   # metal / gas / crystal only (types 4-5 = troops / spy drones) unless &all=1
                    if ("type" in q and str(r["type"]) in q["type"].split(",")) or (
                            "type" not in q and (r["type"] <= 3 or q.get("all") == "1")):
                        r["amount"] = float(q.get("amount", 5000))
            PENDING_PLANET_PUSH[:] = [time.time()]   # client refreshes its counters on the next poll
            save_state()
            _reply(self)
            return
        if "/debug/carrier" in self.path:   # new carrier: ?type=1&at=planet&ships=1:20,8:5[&player=HEX]
            q = _qs(self.path)
            JOB_ID[0] += 1
            pairs = lambda v: {k: int(n) for k, n in (x.split(":") for x in v.split(",") if x)}
            c = {"id": 20000 + JOB_ID[0], "type": int(q.get("type", 1)), "level": int(q.get("level", 1)), "ships": pairs(q.get("ships", "")),
                 "at": int(q.get("at", HOME_PLANET))}
            if "behaviour" in q:   # ?behaviour=2 : avoid combat (default 1 engage)
                c["behaviour"] = int(q["behaviour"])
            if "cargo" in q:   # ?cargo=4:200 (troops etc.)
                c["cargo"] = pairs(q["cargo"])
            CARRIERS.append(c)
            PENDING_PLANET_PUSH[:] = [time.time()]
            save_state()
            body = str(c["id"]).encode()
            _reply(self, body)
            return
        if "/debug/hurry" in self.path:   # moving carrier arrives in secs: ?carrier=id&secs=5[&player=HEX]
            q = _qs(self.path)
            c = next(c for c in CARRIERS if str(c["id"]) == q["carrier"])
            if c.get("move"):
                c["move"]["end"] = time.time() + float(q.get("secs", 5))
            save_state()
            _reply(self)
            return
        if "/debug/ships" in self.path:   # grant ships at home: ?type=8&n=5
            q = _qs(self.path)
            t, n = int(q.get("type", 8)), int(q.get("n", 5))
            SHIPS[t] = SHIPS.get(t, 0) + n
            PENDING_PLANET_PUSH[:] = [time.time()]
            save_state()
            _reply(self)
            return
        if "/debug/jumpgate" in self.path:   # set the jumpgate experiment state: ?ts=secs_from_now&planet=id&f3=n&clear=1
            q = _qs(self.path)
            if q.get("clear"):
                JUMPGATE.clear()
            if "ts" in q:
                JUMPGATE["ts"] = time.time() + float(q["ts"])
            for k in ("planet", "f3"):
                if k in q:
                    JUMPGATE[k] = int(q[k])
            save_state()
            _reply(self)
            return
        if "/debug/move" in self.path:   # start a RELOCATE-style move of the first carrier to Home2 (display test)
            q = _qs(self.path)
            c = next(c for c in CARRIERS if str(c["id"]) == q.get("carrier", str(CARRIERS[0]["id"])))
            JOB_ID[0] += 1
            now = time.time()
            c["move"] = {"id": JOB_ID[0], "order": int(q.get("order", 1)), "target": int(q.get("target", 1201)),
                         "origin": c.get("at", HOME_PLANET), "start": now, "end": now + int(q.get("secs", 120)), "speed": 1.0}
            PENDING_PLANET_PUSH[:] = [now]
            save_state()
            _reply(self)
            return
        if "/debug/templates" in self.path:   # one kind-5 report per template id 2-12 (field 7.1)
            for t in range(2, 13):
                add_mail(kind=5, body=f"template {t}", dv=5, tkind=t, template="X", params={"PLANET": "Home1", "SYSTEM": "Home",
                         "USER": "Pilot", "COUNT": "3", "CREDITS": "7"})
            _reply(self)
            return
        if "/debug/report4" in self.path:   # kind-4 mission report with a location in sector 1_1
            add_mail(kind=4, body="kind4 test", force4=True, report={"type": 10, "mission": 1, "level": 1, "won": True,
                     "loc": 1101, "reward": {"credits": 5, "1": 150}, "after": {"1": 2},
                     "items": dict(x.split(":") for x in _q(self.path, "items", "10:1").split(",") if x),
                     "f7": _q(self.path, "f7", None)})
            _reply(self)
            return
        if "/debug/rowtest" in self.path:   # kind-4 report rows: body text vs field 7 template ids (row title test)
            key = "DESC_MISSION_SUCCESS_QUICK_PIRATE_FIGHTERS"
            for t in [int(x) for x in _q(self.path, "t", "0,1,2,3,4").split(",")]:
                kw = {"template": key, "tkind": t} if t else {}
                add_mail(kind=4, body=f"BODY t{t}", force4=True, report={"type": 10, "mission": 1, "level": 1, "won": True,
                         "loc": 1101, "reward": {"credits": 5, "1": 150}, "after": {"1": 2}, "items": {}}, **kw)
            _reply(self)
            return
        if "/debug/rawkey" in self.path:   # does an unknown template key show as plain text?
            add_mail(kind=5, body="raw", dv=5, template="Mission 50005 succeeded. Reward: 400 gas.")
            _reply(self)
            return
        if "/debug/variants" in self.path:   # local debugging: one kind-5 report per details variant
            for dv in (1, 8, 9, 5):
                add_mail(kind=5, body=f"variant {dv}", dv=dv, template="MSG_COLONIZE_SUCCESS",
                         params={"PLANET": "Home1", "SYSTEM": "Home"})
            add_mail(kind=5, body="msg template", template="MSG_COLONIZE_SUCCESS", params={"PLANET": "Home1", "SYSTEM": "Home"})
            _reply(self)
            return
        if "/debug/sysreport" in self.path:   # local debugging: one fresh kind-5 report (text details variant test)
            add_mail(kind=5, body=f"System report test, details variant {TEXT_DETAIL_FIELD.get(5)}")
            _reply(self)
            return
        if "/debug/reportmail" in self.path:   # local debugging: fake mission reports with Message kind 1-6
            for k in range(1, 7):
                add_mail(kind=k, body=f"Report kind {k}", report={"type": 10, "mission": 59000 + k, "level": 1, "won": True,
                         "reward": {"credits": k, "1": 100 * k}, "after": {"1": k}})
            _reply(self)
            return
        if "/debug/testmail" in self.path:   # local debugging: queue one test mail per kind 1-3
            for k in (1, 2, 3):
                add_mail(kind=k, body=f"Test mail kind {k}")
            _reply(self)
            return
        if self.path.endswith("/loca"):
            # Localization download (loader step 4, unconditional on every launch; the client sends
            # Cache-Control: no-cache): the bundled base_loc zip (loca + loca_version). Prefer the English-only
            # build (re-tools/loca_en_only.py: 66 KB instead of 865 KB for 14 languages).
            en = os.path.join(here, "..", "data", "base_loc_en")
            data = open(en if os.path.exists(en) else os.path.join(here, "..", "data", "base_loc"), "rb").read()
            print(f"{stamp} {self.command} {host}{self.path} -> base_loc {len(data)}B", flush=True)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
            return
        if self.path.endswith("/sectors") or self.path.endswith(".map"):
            # Sector download (loader step 3): the zip of sector files, same as the bundled
            # maps_ios/<MAP_ID>.map (data/<MAP_ID>.map, pulled from the iPad).
            data = open(os.path.join(here, "..", "data", f"{MAP_ID}.map"), "rb").read()
            print(f"{stamp} {self.command} {host}{self.path} -> map {len(data)}B", flush=True)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
            return
        print(f"{stamp} {self.command} {host}{self.path} {len(body)}B headers={dict(self.headers)} -> 404", flush=True)
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_PUT = do_HEAD = do_GET

    def log_message(self, *a):
        pass


for _p in [p for p in NPC_PLANETS if p in OWNERS]:   # bases seeded on a planet another player already held
    del NPC_PLANETS[_p]
if globals().get("_home_npc") is None and not HOME_NPC:   # the default player's save from before the Outlaws
    HOME_NPC.update(home_outlaws())

# Built at the end of the module so handlers defined anywhere are included. Every handle_<n> function is registered automatically (so a new handler can't be forgotten); login also answers 2010-2013.
UNREGISTERED_HANDLERS = {325}   # experiments, deliberately left out (the client gets the auto reply)
HANDLERS = {int(k[7:]): f for k, f in globals().items() if k.startswith("handle_") and k[7:].isdigit() and callable(f)
            and int(k[7:]) not in UNREGISTERED_HANDLERS}
HANDLERS.update({n: handle_login for n in (2010, 2011, 2012, 2013)})


if __name__ == "__main__":
    host = bind_host()     # USB link / Wi-Fi address; all interfaces only in GOFA_NET=hosts mode (port 80)
    print("listening on", host, PORT, flush=True)
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()
