"use client";
// The landing page's live explanation: six placeholder jobs scramble, get judged, and snap into ranked order,
// with rank numbers taking their tier colors. It loops, so the product explains itself in a few seconds.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Tier, Verdict } from "@jevjob/core";
import { TIERS, VERDICTS } from "@/lib/tiers";

interface Row { id: string; tier: Tier; width: number; bars: Verdict[] }

const m: Verdict = "meets", u: Verdict = "unclear", x: Verdict = "does_not_meet";
const ROWS: Row[] = [
  { id: "a", tier: "apply", width: 72, bars: [m, m, m, m, m, u, m] },
  { id: "b", tier: "maybe", width: 58, bars: [m, m, u, m, x, m] },
  { id: "c", tier: "maybe", width: 80, bars: [m, u, m, m, u, m, x] },
  { id: "d", tier: "stretch", width: 64, bars: [m, x, u, x, m, u] },
  { id: "e", tier: "big_stretch", width: 50, bars: [x, m, x, x, u, x, x] },
  { id: "f", tier: "no", width: 68, bars: [x, x, m, x, x] },
];

const shuffle = (rows: Row[]) => {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

export function Specimen() {
  const [rows, setRows] = useState(ROWS);
  const [sorted, setSorted] = useState(true);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("still") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const loop = async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      while (alive) {
        await wait(2600);
        if (!alive) break;
        setSorted(false);
        setRows((r) => shuffle(r));
        await wait(1500);
        if (!alive) break;
        setSorted(true);
        setRows(ROWS);
      }
    };
    void loop();
    return () => void (alive = false);
  }, []);

  return (
    <div className="specimen-card" aria-hidden>
      <div className="specimen-head">
        <span>{sorted ? "Ranked" : "Reading requirements"}</span>
        <span className="specimen-dot" data-busy={!sorted} />
      </div>
      {rows.map((row, i) => (
        <motion.div key={row.id} layout transition={{ type: "spring", stiffness: 380, damping: 34 }} className="specimen-row">
          <motion.span className="specimen-rank" animate={{ color: sorted ? TIERS[row.tier].color : "var(--faint)" }} transition={{ duration: 0.4 }}>
            {i + 1}
          </motion.span>
          <span className="specimen-lines">
            <i style={{ width: `${row.width}%` }} />
            <i style={{ width: `${row.width * 0.55}%` }} />
          </span>
          <span className="specimen-bars">
            {row.bars.map((v, j) => (
              <motion.b
                key={j}
                animate={{ backgroundColor: sorted ? VERDICTS[v].color : "var(--line-2)", scaleY: sorted ? 1 : 0.45 }}
                transition={{ delay: sorted ? j * 0.04 + i * 0.03 : 0, duration: 0.3 }}
              />
            ))}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
