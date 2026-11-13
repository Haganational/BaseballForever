# Baseball Forever

Pick any two teams in baseball history, set the era knobs, and play.

- `src/`: the game engine and its era-adjustment knobs (step 1 of the plan)
- `web/`: the pick-two-teams web page (step 2)
- `web/src/Diamond.tsx`: animated key-play replays (step 4)
- `src/commentary/`: the radio booth, with announcer profiles and the broadcast writer (step 3)
- `supabase/`: database tables, for when the data moves to Supabase

## Key-play animations

Each game's biggest moments (every home run, the walk-off, and the plays that swung the win probability most) get
an animated replay on a little SVG ballpark. The replay is built from the play's real data: where the ball went, who was on base,
who scored and who was thrown out. Big moments get a gag:
- fireworks and "GONE!" for a home run;
- a giant K (sometimes backwards) for a strikeout;
- "TURN TWO!" for a double play;
- a confetti party for a walk-off.

Press **Play highlight reel** to run them all, or watch the small diamond replay every play while the radio broadcast is on.

## Radio broadcast

After a game, the page has a radio booth. Pick a play-by-play voice and, optionally, a color analyst, then press
**Listen live**. The game is called line by line, read aloud with your device's built-in voices
(you can switch the voice off and just read along). From the command line:

```bash
npm run radio -- "1927 Yankees" "2016 Cubs" --pbp dex-marlowe --color gus-kowalski --seed 3
```

Four original announcers come built in. Red Holloway and Dex Marlowe call play-by-play, and Doc Pemberton and Gus Kowalski are color analysts.
**Create your own** in the page's announcer booth. Each profile can set:
- a name and voice;
- talking speed and pitch;
- excitement and chattiness;
- which team they root for;
- their own lines for home runs, strikeouts, walk-offs and the sign-off, plus a color analyst's go-to remarks.

Custom announcers are saved in your browser for now. The profile format is in `src/commentary/announcers.ts`.
The broadcast is written from the game's event log plus each player's real season stats. The same game and seed always produce the same broadcast.

## Web page

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in web/dist, deployable to Vercel, Netlify or GitHub Pages
```

The engine runs entirely in the browser, so no server is needed. By default the page reads static data files that
`npm run prepare-data` builds from `data/`. To read from Supabase instead:

1. Run `supabase/schema.sql` in the Supabase SQL editor.
2. From the repo root: `npm install`, then
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run upload:supabase` (about 3,600 team-seasons).
3. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `web/.env.local` (or in your host's settings).

On Vercel, set the project root directory to `web`.

## Engine

The engine It simulates a full game,
one plate appearance at a time, between any two teams from 1871 to 2025 (Negro Leagues included). The output is a box score.
Radio commentary (step 3) and key-play animations (step 4) will be built on the detailed play-by-play
event log the engine already produces.

## Try it

```bash
npm install
npm run sim -- "1927 Yankees" "2016 Cubs"                      # one game, box score
npm run sim -- "1927 Yankees" "2016 Cubs" --games 3000         # head-to-head series summary
npm run sim -- "1927 NYA" "1962 NYN" --environment home --ball juiced --seed 9
npm run sim -- "1975 CIN" "1998 NYA" --preset trueTalent --games 2000
npm run validate -- 1000                                        # accuracy check against real seasons
npm test
```

You can name teams as `"<year> <name>"` ("1927 Yankees") or by Lahman id ("1927NYA"). If a name
matches more than one team, the error message lists the ids to choose from.

## How a plate appearance is decided

1. **Each player is rated against his own league.** For each outcome (strikeout, walk, HBP, single,
   double, triple, homer) the player's rate is divided by his league's rate. Small samples are pulled toward average,
   and his home park's effect is taken out.
2. **Pick the world the game is played in**, using the `environment` knob. The default sits halfway between the two teams' leagues.
3. **Combine batter and pitcher** with the odds-ratio method, the standard way to blend a batter's
   and a pitcher's rates against a league baseline. Then apply the park, the ball, the mound, home field,
   how many times the batter has seen this pitcher, pitcher fatigue, defense and the knob multipliers.
4. **Talent spread.** A star's edge over his league is resized to fit how spread out talent
   is in the target world. Early leagues had a shallower talent pool, so their stars stood further from
   average. This spread is measured for every league-season from the data. For example, Babe Ruth's 1927 line translates to
   about 47 HR and a .266/.399/.597 slash line in 2019. Barry Bonds 2001 translates to 41 HR with 179 walks in 1927.
5. **Power in low-homer eras.** When a player moves to a world with many more homers than his own, his
   home run rate is partly judged by all his extra-base hits. This stops a dead-ball player's 10 homers from turning into 90.

Then the play itself: batted-ball type (grounder, fly or liner), fielder, runner advancement scaled by
runner speed, double plays, fielder's choices, sac flies, errors (much more common in old eras),
steals, wild pitches, the ghost runner, and walk-offs. Pitcher usage follows each team's own era:
1927 starters go deep, while 2016 has quick hooks and a closer in save situations. Relievers are
used in proportion to how much they really pitched.

## The knobs (`src/knobs.ts`)

| Knob | Default | What it does |
|---|---|---|
| `environment` | `blend` | The run-scoring world: `blend`, `home`, `away`, `year` (with `envYear` and optionally `envLeague`), or `alltime` |
| `eraMode` | `relative` | `relative` judges players against their own league. `raw` takes stat lines at face value |
| `spreadAdjust` | 1 | 0 to 1: how much to resize star edges to fit the target world's talent spread |
| `regression` | 0.3 | Luck correction. Near 0 trusts every stat line, 1 is a typical analyst projection |
| `pitcherBipControl` | 0.8 | How much credit or blame a pitcher gets for hits on balls in play |
| `defenseWeight` | 1 | How much a team's fielders matter on balls in play |
| `park` | `home` | `home`, `neutral`, or a run factor such as `1.15` |
| `ball` | `era` | `dead`, `lively`, `juiced` |
| `mound` | `era` | `high` (before 1969) or `low` |
| `dh` | `era` | Follows the home team's rule, or `on` / `off` |
| `ghostRunner` | `era` | Extra-inning runner on second (2020 and later by default) |
| `bullpen` | `team` | `team` era habits, `modern` quick hooks, `classic` starters finish |
| `lineup` | `traditional` | `traditional` puts the best hitter 3rd. `optimized` puts the best hitters 1, 2 and 4 |
| `timesThroughOrder` | 1 | Batters improve the 3rd and 4th time they face a starter |
| `homeField` | 1 | Home advantage, where 0 means none |
| `hrFactor`, `soFactor`, `bbFactor`, `babipFactor`, `errorFactor`, `stealFactor` | 1 | Final multipliers |
| `seed` | 1 | The same seed replays the same game exactly |

**Presets** (`--preset`) set the three skill-versus-luck knobs together:
- `balanced` is the default. Teams play close to their real records.
- `asItHappened` replays seasons the way they went.
- `trueTalent` is what an analyst would predict if the teams really met.

## Accuracy check

`npm run validate -- 1000` replays ten real league-seasons from 1908 to 2024. Every team plays 1,000
games against its real league opponents, and the results are compared with what actually happened:

```
League    Real R/G  Sim R/G   Diff   RS corr  RA corr  W% corr
1908NL     3.32     3.39    0.07     0.90     0.62     0.92
1927AL     4.92     5.06    0.14     0.96     0.92     0.96
1930NL     5.68     5.56   -0.13     0.87     0.97     0.93
1948AL     4.73     4.67   -0.05     0.96     0.81     0.92
1968AL     3.41     3.41    0.01     0.96     0.85     0.88
1987AL     4.90     5.06    0.16     0.51     0.86     0.75
2000AL     5.30     5.56    0.27     0.77     0.77     0.80
2016NL     4.44     4.32   -0.12     0.74     0.89     0.81
2019AL     4.88     4.99    0.10     0.88     0.83     0.90
2024NL     4.51     4.54    0.02     0.92     0.94     0.89

Average miss on league scoring: 0.11 runs per team-game (2.2%)
Average correlation with real team records: runs scored 0.85, runs allowed 0.84, win % 0.88
```

Known gaps:
- **Records are a bit compressed.** Good teams win somewhat less often than they really did, and bad teams somewhat more. On average the simulated win-% spread is about 70% of the real spread. Part of that is real-world luck the sim can't copy, and part is that the simulator has no bench, platoons or pinch hitters yet.
- **Modern scoring runs a little high.** Teams use their regulars every game, so homers run slightly high in modern seasons (for example 3.24% of plate appearances against a real 3.02% in 2000).
- **The lineup is simplified.** There's no pitch-by-pitch detail, no bunts, and no platoon (left/right) splits yet.

## Data

`data/` is built from the Lahman Baseball Database, which is free under CC BY-SA 3.0, via the `pylahman` package:
`scripts/build_data.py` writes one JSON file per season, and `npm run build:envs` precomputes league environments.
The engine reads data through a small `DataSource` interface (`src/data.ts`), so step 2 can switch it to Supabase.
