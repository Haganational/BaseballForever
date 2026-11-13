import { describe, expect, it } from "vitest";
import { FileDataSource, findTeam } from "../src/data.js";
import { simulateGame, type PlayEvent } from "../src/game.js";

const ds = new FileDataSource();
const yanks = findTeam(ds, "1927 NYA");
const cubs = findTeam(ds, "2016 CHN");

describe("simulateGame", () => {
  it("produces a consistent box score", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const g = simulateGame(ds, yanks, cubs, { knobs: { seed } });
      for (const side of [g.away, g.home]) {
        const fromLine = side.lineScore.filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0);
        expect(fromLine).toBe(side.R);
        expect(side.batting.reduce((a, b) => a + b.R, 0)).toBe(side.R);
        expect(side.batting.reduce((a, b) => a + b.H, 0)).toBe(side.H);
      }
      // runs charged to the defense's pitchers equal the runs the other side scored
      expect(g.home.pitching.reduce((a, p) => a + p.R, 0)).toBe(g.away.R);
      expect(g.away.pitching.reduce((a, p) => a + p.R, 0)).toBe(g.home.R);
      expect(g.away.R).not.toBe(g.home.R);
      // the away team always gets at least 27 outs worth of batting
      const awayOuts = g.home.pitching.reduce((a, p) => a + p.outs, 0);
      expect(awayOuts).toBeGreaterThanOrEqual(27);
      expect(awayOuts % 3).toBe(0);
      for (const e of g.events) if (e.kind === "pa") expect((e as PlayEvent).outsAfter).toBeLessThanOrEqual(3);
    }
  });

  it("is repeatable with the same seed", () => {
    const a = simulateGame(ds, yanks, cubs, { knobs: { seed: 42 } });
    const b = simulateGame(ds, yanks, cubs, { knobs: { seed: 42 } });
    expect(a.events).toEqual(b.events);
  });

  it("responds to the home run knob", () => {
    const count = (hrFactor: number) => {
      let hr = 0;
      for (let seed = 1; seed <= 150; seed++) hr += simulateGame(ds, yanks, cubs, { knobs: { seed, hrFactor } }).away.batting.reduce((a, b) => a + b.HR, 0);
      return hr;
    };
    expect(count(2)).toBeGreaterThan(count(1) * 1.5);
  });

  it("plays dead-ball games with fewer homers than modern ones", () => {
    const hrs = (environment: "home" | "away") => {
      let hr = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const g = simulateGame(ds, findTeam(ds, "1908 CHN"), findTeam(ds, "2019 MIN"), { knobs: { seed, environment } });
        hr += g.away.batting.reduce((a, b) => a + b.HR, 0) + g.home.batting.reduce((a, b) => a + b.HR, 0);
      }
      return hr;
    };
    expect(hrs("away")).toBeLessThan(hrs("home") / 3);
  });
});
