/**
 * Announcer profiles. Everything that makes a voice sound like itself lives here as data, so
 * anyone can write a new announcer (in the web page's editor, or as JSON) without touching code.
 *
 * Templates can use these placeholders:
 *   {batter} {batterLast} {pitcher} {pitcherLast} {fielder} {field} {team} {otherTeam}
 *   {runs} {score} {inning} {outs} {me} (the announcer's own name)
 */
export interface Announcer {
  id: string;
  name: string;
  /** "pbp" calls every play; "color" adds stats, history and opinions between plays */
  role: "pbp" | "color";
  /** a few words shown in the picker */
  tagline: string;
  /** 0 = calm, 1 = loses his mind on every big play */
  excitement: number;
  /** 0 = only the essentials, 1 = never stops talking */
  chattiness: number;
  /** cheer for one side: "away", "home" or null for neutral */
  homer: "away" | "home" | null;
  /** extra lines this announcer mixes in. Any list can be left empty to use the house lines. */
  phrases: {
    intro: string[];
    homeRun: string[];
    bigHomeRun: string[];
    strikeout: string[];
    doublePlay: string[];
    bigHit: string[];
    walkoff: string[];
    final: string[];
    /** color men: their go-to observations */
    filler: string[];
  };
  voice: {
    /** browser speech voice name (blank = default voice), used only with the phone's built-in speech */
    name: string;
    /** studio voice id (a Piper neural voice shipped with the site); blank = pick one by role */
    neural?: string;
    /** 0.5 slow .. 2 fast */
    rate: number;
    /** 0 low .. 2 high */
    pitch: number;
  };
  /** true for the built-in voices, which can be copied but not changed */
  builtIn?: boolean;
}

const empty = () => ({ intro: [], homeRun: [], bigHomeRun: [], strikeout: [], doublePlay: [], bigHit: [], walkoff: [], final: [], filler: [] });

/** Original announcers that ship with the game. Fictional characters, not real broadcasters. */
export const BUILT_IN_ANNOUNCERS: Announcer[] = [
  {
    id: "red-holloway",
    name: "Red Holloway",
    role: "pbp",
    tagline: "Golden-age radio, smooth as a summer night",
    excitement: 0.6,
    chattiness: 0.5,
    homer: null,
    builtIn: true,
    phrases: {
      ...empty(),
      intro: ["Good evening, everybody, and welcome to the ballpark. It's a lovely night for baseball, and what a ballgame we have for you."],
      homeRun: ["{batterLast} swings, and that ball is going, going... it is gone!", "There's a long drive, way back... and it's out of here! {batter} with a home run."],
      bigHomeRun: ["Oh my! {batter} has hit one into the night, and this ballpark is shaking!", "Going, going, gone! Holy smokes, {batter} has done it!"],
      strikeout: ["Strike three called, and {batterLast} goes back to the bench.", "He swings and misses, and {pitcherLast} has him struck out."],
      doublePlay: ["Two for the price of one. Tidy work by the infield."],
      bigHit: ["And here comes the run! {team} make some noise!"],
      walkoff: ["And that's the ballgame! {team} win it, and the fans are pouring onto the field!"],
      final: ["So it goes into the books. For all of us here, this is Red Holloway saying good night, everybody."],
    },
    voice: { neural: "en_US-ryan-medium", name: "", rate: 0.95, pitch: 0.9 },
  },
  {
    id: "dex-marlowe",
    name: "Dex Marlowe",
    role: "pbp",
    tagline: "Modern, loud and all-in on every swing",
    excitement: 0.95,
    chattiness: 0.7,
    homer: null,
    builtIn: true,
    phrases: {
      ...empty(),
      intro: ["What is UP, everybody! We have got a time-traveling showdown tonight and I could not be more fired up!"],
      homeRun: ["{batterLast} BLASTS one! See ya! That ball is GONE!", "OH, he got all of that one! {batter} goes yard!"],
      bigHomeRun: ["ARE YOU KIDDING ME?! {batter}! Into the seats! This place is ELECTRIC!", "GET UP, GET UP, GET OUTTA HERE! {batter} has flipped this game upside down!"],
      strikeout: ["Sit down! {pitcherLast} rings him up!", "Strike three! {batterLast} had no chance on that one!"],
      doublePlay: ["Turn two! Tailor-made, and the inning dies right there!"],
      bigHit: ["Here comes the run, he's gonna score! BIG hit!"],
      walkoff: ["WALK-OFF! {team} WIN IT! Bedlam! Absolute bedlam!"],
      final: ["That's a wrap, folks! What a game! Dex Marlowe signing off, catch you next time!"],
    },
    voice: { neural: "en_US-joe-medium", name: "", rate: 1.15, pitch: 1.1 },
  },
  {
    id: "doc-pemberton",
    name: "Doc Pemberton",
    role: "color",
    tagline: "The numbers guy. Knows every stat, loves context",
    excitement: 0.3,
    chattiness: 0.6,
    homer: null,
    builtIn: true,
    phrases: {
      ...empty(),
      intro: ["And I've been looking forward to this one. Comparing players across a hundred years of baseball is my favorite puzzle."],
      filler: [
        "You have to remember how different the game was back then. Fewer strikeouts, far more balls in play.",
        "The question everybody asks: how would these guys do against each other? Well, tonight we find out.",
        "Strike-throwing matters in any era. Walks will hurt you whether it's 1927 or 2024.",
      ],
    },
    voice: { neural: "en_US-lessac-medium", name: "", rate: 1.0, pitch: 0.8 },
  },
  {
    id: "gus-kowalski",
    name: "Gus Kowalski",
    role: "color",
    tagline: "Old ballplayer. Grumpy, funny, hates the shift",
    excitement: 0.5,
    chattiness: 0.8,
    homer: null,
    builtIn: true,
    phrases: {
      ...empty(),
      intro: ["Happy to be here. Although in my day we played doubleheaders and nobody complained."],
      strikeout: ["Back in my day you choked up with two strikes. Put the ball in play!"],
      filler: [
        "I'll tell you what, you can't teach that kind of hustle.",
        "These fellas would've loved the train rides. Nothing like a sleeper car to Saint Louis.",
        "Pitcher's gotta trust his stuff here. Just throw strikes, kid.",
        "Fundamentals. That's what wins ballgames. Fundamentals.",
      ],
    },
    voice: { neural: "en_US-norman-medium", name: "", rate: 0.9, pitch: 0.7 },
  },
];

export function blankAnnouncer(role: "pbp" | "color" = "pbp"): Announcer {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: role === "pbp" ? "New Play-by-Play Voice" : "New Color Analyst",
    role,
    tagline: "My own announcer",
    excitement: 0.6,
    chattiness: 0.5,
    homer: null,
    phrases: empty(),
    voice: { name: "", rate: 1, pitch: 1 },
  };
}
