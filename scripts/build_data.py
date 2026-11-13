"""Build per-season JSON files from the Lahman database (via the pylahman parquet files).

Usage: python3 -I scripts/build_data.py <path-to-pylahman-data-dir> <out-dir>

Each output file data/seasons/<year>.json holds:
  leagues: league-wide per-PA event rates (the "environment" for that year/league)
  teams:   every team with its batters and pitchers (team-season totals)
Missing old-era columns (SO, HBP, SF, ...) are left as null so the engine can fall
back to league average for that event rather than inventing a number.
"""
import json
import math
import os
import sys

import pandas as pd

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def rd(name):
    return pd.read_parquet(os.path.join(src, name + ".parquet"))


bat = rd("Batting")
pit = rd("Pitching")
teams = rd("Teams")
people = rd("People").set_index("playerID")
app = rd("Appearances")


def num(v):
    if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NA:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    f = float(v)
    return int(f) if f.is_integer() else round(f, 4)


def sv(v):
    return None if v is None or v is pd.NA or (not isinstance(v, str) and pd.isna(v)) else str(v)


def name_of(pid):
    if pid in people.index:
        r = people.loc[pid]
        first = r["nameFirst"] if not pd.isna(r["nameFirst"]) else ""
        return f"{first} {r['nameLast']}".strip(), (None if pd.isna(r["bats"]) else r["bats"]), (
            None if pd.isna(r["throws"]) else r["throws"])
    return pid, None, None


BAT_COLS = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "IBB", "HBP", "SH", "SF", "GIDP"]
PIT_COLS = ["W", "L", "G", "GS", "CG", "SHO", "SV", "IPOuts", "H", "ER", "HR", "BB", "SO", "IBB", "WP", "HBP", "BK",
            "BFP", "GF", "R", "SH", "SF", "GIDP"]
POS = ["p", "c", "1b", "2b", "3b", "ss", "lf", "cf", "rf", "dh"]


def agg(df, cols, keys):
    # sum but keep NaN when every value in the group is missing (min_count=1)
    return df.groupby(keys, dropna=False)[cols].sum(min_count=1).reset_index()


bat_t = agg(bat, BAT_COLS, ["yearID", "teamID", "lgID", "playerID"])
pit_t = agg(pit, PIT_COLS, ["yearID", "teamID", "lgID", "playerID"])

index = []
for year in sorted(teams.yearID.unique()):
    ty = teams[teams.yearID == year]
    by = bat_t[bat_t.yearID == year]
    py = pit_t[pit_t.yearID == year]
    ay = app[app.yearID == year]

    leagues = {}
    for lg in ty.lgID.dropna().unique():
        b = by[by.lgID == lg]
        p = py[py.lgID == lg]
        t = ty[ty.lgID == lg]
        s = lambda df, c: float(df[c].sum(min_count=1)) if df[c].notna().any() else None
        AB, H, D, T, HR, BB = (s(b, c) for c in ["AB", "H", "2B", "3B", "HR", "BB"])
        HBP = s(b, "HBP") or s(p, "HBP")
        SO = s(b, "SO") if b["SO"].notna().sum() > len(b) * 0.5 else s(p, "SO")
        SF, SH = s(b, "SF"), s(b, "SH")
        PA = AB + BB + (HBP or 0) + (SF or 0) + (SH or 0)
        games = float(t["G"].sum()) / 2 if len(t) else None
        runs = float(t["R"].sum())
        errors = s(t, "E")
        leagues[lg] = {
            "PA": PA, "AB": AB, "H": H, "2B": D, "3B": T, "HR": HR, "BB": BB, "HBP": HBP, "SO": SO,
            "SF": SF, "SH": SH, "SB": s(b, "SB"), "CS": s(b, "CS"), "GIDP": s(b, "GIDP"),
            "R": runs, "G": games, "E": errors, "DP": s(t, "DP"),
            "IPOuts": s(p, "IPOuts"), "CG": s(t, "CG"), "GS": s(p, "GS"), "SV": s(p, "SV"),
            "teams": int(len(t)),
        }
        leagues[lg] = {k: num(v) for k, v in leagues[lg].items()}

    team_list = []
    for _, tr in ty.iterrows():
        tid = tr["teamID"]
        tb = by[by.teamID == tid]
        tp = py[py.teamID == tid]
        ta = ay[ay.teamID == tid].set_index("playerID")
        batters = []
        for _, r in tb.iterrows():
            pid = r["playerID"]
            nm, bats, throws = name_of(pid)
            d = {"id": pid, "name": sv(nm), "bats": sv(bats), "throws": sv(throws)}
            for c in BAT_COLS:
                d[c] = num(r[c])
            if pid in ta.index:
                a = ta.loc[pid]
                if isinstance(a, pd.DataFrame):
                    a = a.iloc[0]
                d["pos"] = {k: num(a["G_" + k]) for k in POS if num(a["G_" + k])}
                d["GS"] = num(a["GS"])
            else:
                d["pos"] = {}
            batters.append(d)
        pitchers = []
        for _, r in tp.iterrows():
            pid = r["playerID"]
            nm, bats, throws = name_of(pid)
            d = {"id": pid, "name": sv(nm), "throws": sv(throws)}
            for c in PIT_COLS:
                d[c] = num(r[c])
            pitchers.append(d)
        team = {
            "id": f"{year}{tid}", "teamID": tid, "year": int(year), "lg": None if pd.isna(tr["lgID"]) else tr["lgID"],
            "franch": sv(tr["franchID"]), "name": sv(tr["name"]), "park": None if pd.isna(tr["park"]) else tr["park"],
            "W": num(tr["W"]), "L": num(tr["L"]), "G": num(tr["G"]), "R": num(tr["R"]), "RA": num(tr["RA"]),
            "E": num(tr["E"]), "DP": num(tr["DP"]),
            "BPF": num(tr["BPF"]), "PPF": num(tr["PPF"]),
            "WSWin": sv(tr["WSWin"]) == "Y", "LgWin": sv(tr["LgWin"]) == "Y",
            "batters": batters, "pitchers": pitchers,
        }
        team_list.append(team)
        index.append({"id": team["id"], "year": int(year), "lg": team["lg"], "name": team["name"],
                      "W": team["W"], "L": team["L"], "WS": team["WSWin"]})

    with open(os.path.join(out, f"{year}.json"), "w") as f:
        json.dump({"year": int(year), "leagues": leagues, "teams": team_list}, f, separators=(",", ":"))

with open(os.path.join(out, "..", "teams-index.json"), "w") as f:
    json.dump(index, f, separators=(",", ":"))
print("seasons:", teams.yearID.nunique(), "teams:", len(index))
