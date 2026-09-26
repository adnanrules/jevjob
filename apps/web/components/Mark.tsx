import { TIER_ORDER } from "@jevjob/core";
import { TIERS } from "@/lib/tiers";

/** Five bars, best tier to worst: the verdict barcode as a logo. */
export function Mark({ onClick }: { onClick?: () => void }) {
  return (
    <a className="mark" href="/" onClick={(e) => { if (onClick) { e.preventDefault(); onClick(); } }}>
      <span className="mark-glyph" aria-hidden>
        {TIER_ORDER.map((t, i) => <i key={t} style={{ height: 16 - i * 2.5, background: TIERS[t].color }} />)}
      </span>
      JevJob
    </a>
  );
}
