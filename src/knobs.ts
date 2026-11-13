/**
 * Every adjustable dial in the simulator. Defaults aim for "most accurate"; each knob says
 * what it does in plain words so a UI can show the comment as help text.
 */
export interface Knobs {
  /**
   * Which run-scoring world the game is played in.
   * - "blend": halfway between the two teams' leagues (default, fairest for cross-era games)
   * - "home" / "away": the home or away team's own league and year
   * - "year": a specific season, set with envYear (and envLeague, default "AL"/"NL" average)
   * - "alltime": an average of every MLB season since 1901
   */
  environment: "blend" | "home" | "away" | "year" | "alltime";
  envYear?: number;
  envLeague?: string;

  /**
   * How players from different eras are compared.
   * - "relative": each player is judged against his own league, then dropped into the target
   *   world (Babe Ruth hits like someone 2.5x the league HR rate, wherever he plays). Default.
   * - "raw": take the stat lines at face value, no era correction.
   */
  eraMode: "relative" | "raw";

  /**
   * Talent-spread adjustment, 0 to 1. Older leagues had a wider gap between stars and scrubs
   * because the talent pool was shallower. At 1, a player's edge over his league is resized to
   * fit how spread out talent is in the target world. At 0, edges are kept as-is.
   */
  spreadAdjust: number;

  /**
   * How much to pull stat lines toward average (luck correction). 0.3 = default,
   * near 0 = take every stat line at face value, 1 = typical analyst projection, 2 = very skeptical.
   */
  regression: number;

  /**
   * How much a pitcher controls hits on balls in play (0 to 1), after his team's defense is taken
   * out. Analysts say "not much" (0.35 in the trueTalent preset); 0.8 by default so great
   * seasons stay great. At 1 a pitcher's full hits-allowed record counts.
   */
  pitcherBipControl: number;

  /**
   * How much a team's fielders matter on balls in play (0 to 1). At 1 (default) the team's whole
   * hits-on-balls-in-play record beyond its pitchers is credited to its defense.
   */
  defenseWeight: number;

  /** Ballpark: "home" uses the home team's park factor, "neutral" ignores parks, or a number like 1.10 for a hitter's park. */
  park: "home" | "neutral" | number;

  /** Ball type. "era" means whatever the target world used. */
  ball: "era" | "dead" | "lively" | "juiced";

  /** Mound height. "era" follows the target world (high before 1969). */
  mound: "era" | "high" | "low";

  /** Designated hitter: follow the target world's rule, or force it on or off. */
  dh: "era" | "on" | "off";

  /** Extra-inning automatic runner on second: "era" means only in 2020+ worlds. */
  ghostRunner: "era" | "on" | "off";

  /**
   * How long starters stay in.
   * - "team": each team uses its own era's habits (1927 starters go deep, 2016 starters don't)
   * - "modern": quick hooks, closers, about 5-6 innings per start
   * - "classic": starters finish what they start unless they're getting hammered
   */
  bullpen: "team" | "modern" | "classic";

  /**
   * Batting order. "optimized": best hitters 1, 2 and 4 (modern analysis).
   * "traditional": on-base guy leads off, best hitter 3rd, biggest power bat cleanup.
   */
  lineup: "optimized" | "traditional";

  /** Batters get better the 3rd and 4th time they see a starter. 1 = typical effect, 0 = off. */
  timesThroughOrder: number;

  /** Home-field advantage. 1 = historical (~54% home win rate), 0 = none. */
  homeField: number;

  /** Multipliers applied after everything else: 1 = no change. */
  hrFactor: number;
  soFactor: number;
  bbFactor: number;
  /** Hits on balls in play (singles, doubles, triples). */
  babipFactor: number;
  /** Fielding errors. */
  errorFactor: number;
  /** Stolen base attempts. */
  stealFactor: number;

  /** Random seed, so a game can be replayed exactly. */
  seed: number;
}

export const DEFAULT_KNOBS: Knobs = {
  environment: "blend",
  eraMode: "relative",
  spreadAdjust: 1,
  regression: 0.3,
  pitcherBipControl: 0.8,
  defenseWeight: 1,
  park: "home",
  ball: "era",
  mound: "era",
  dh: "era",
  ghostRunner: "era",
  bullpen: "team",
  lineup: "traditional",
  timesThroughOrder: 1,
  homeField: 1,
  hrFactor: 1,
  soFactor: 1,
  bbFactor: 1,
  babipFactor: 1,
  errorFactor: 1,
  stealFactor: 1,
  seed: 1,
};

/**
 * Ready-made settings for the three knobs that decide how much of a season was skill vs luck.
 * - balanced (default): teams play close to their real records, small samples still reined in
 * - asItHappened: replay seasons the way they went, luck and all
 * - trueTalent: what a stats analyst would predict if the teams really met (more regression,
 *   pitchers judged mostly on strikeouts, walks and homers)
 */
export const PRESETS: Record<string, Partial<Knobs>> = {
  balanced: { regression: 0.3, pitcherBipControl: 0.8, defenseWeight: 1 },
  asItHappened: { regression: 0.15, pitcherBipControl: 1, defenseWeight: 1 },
  trueTalent: { regression: 1, pitcherBipControl: 0.35, defenseWeight: 0.7 },
};

export function withDefaults(k: Partial<Knobs> & { preset?: string } = {}): Knobs {
  const { preset, ...rest } = k;
  if (preset && !PRESETS[preset]) throw new Error(`Unknown preset ${preset}. Try: ${Object.keys(PRESETS).join(", ")}`);
  return { ...DEFAULT_KNOBS, ...(preset ? PRESETS[preset] : {}), ...rest };
}
