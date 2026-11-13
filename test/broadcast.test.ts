import { describe, expect, it } from "vitest";
import { BUILT_IN_ANNOUNCERS, blankAnnouncer } from "../src/commentary/announcers.js";
import { generateBroadcast } from "../src/commentary/broadcast.js";
import { FileDataSource, findTeam } from "../src/data.js";
import { simulateGame } from "../src/game.js";

const ds = new FileDataSource();
const game = (seed: number) => simulateGame(ds, findTeam(ds, "1927 NYA"), findTeam(ds, "2016 CHN"), { knobs: { seed } });
const [red, dex, doc] = BUILT_IN_ANNOUNCERS;

describe("generateBroadcast", () => {
  it("calls every plate appearance and never leaves a template blank", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = game(seed);
      const lines = generateBroadcast(g, { pbp: seed % 2 ? red : dex, color: doc }, seed);
      const called = new Set(lines.map((l) => l.eventIndex));
      g.events.forEach((e, i) => { if (e.kind === "pa") expect(called.has(i)).toBe(true); });
      for (const l of lines) {
        expect(l.text).not.toMatch(/\{\w+\}|undefined|NaN/);
        expect(l.text.length).toBeGreaterThan(3);
      }
    }
  });

  it("is repeatable and uses a custom announcer's own lines", () => {
    const g = game(3);
    const me = { ...blankAnnouncer("pbp"), name: "Matty Mic", phrases: { ...blankAnnouncer().phrases, intro: ["Matty Mic here, let's play two!"], final: ["Matty Mic out!"] } };
    const a = generateBroadcast(g, { pbp: me }, 3);
    expect(a[0].text).toBe("Matty Mic here, let's play two!");
    expect(a[a.length - 1].text).toBe("Matty Mic out!");
    expect(generateBroadcast(g, { pbp: me }, 3)).toEqual(a);
  });
});
