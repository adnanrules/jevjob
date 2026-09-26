"use client";
// A field of short vertical ticks (the verdict barcode, at landscape scale) moved by slow 3D value noise.
// `energy` speeds it up while the machine runs; `tints` lets a few ticks pick up the tier colors of the results.
// Ticks fade toward `focus` (where the content is), so the text always sits on quiet background.
import { useEffect, useRef } from "react";

const GAP_X = 11;
const GAP_Y = 24;

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 3D value noise in [0, 1]: smooth, cheap, and good enough for slow ambient motion. */
function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

export function Background({ energy, focus, tints }: {
  /** 0 idle … 1 busy. Eased, so changes never jump. */
  energy: number;
  /** Horizontal position (0–1) of the content column; ticks are faintest there. */
  focus: number;
  /** Tier colors in proportion to the results; empty until there are results. */
  tints: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ energy, focus, tints });
  live.current = { energy, focus, tints };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const still =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(window.location.search).has("still");
    let width = 0, height = 0, raf = 0, last = performance.now(), time = 0;
    let energyNow = 0, focusNow = live.current.focus;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw();
    };

    const BUCKETS = 8;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const { tints } = live.current;
      const cx = focusNow * width;
      // Batch ticks by opacity bucket: a few big paths instead of thousands of tiny strokes.
      const paths = Array.from({ length: BUCKETS }, () => new Path2D());
      const tinted: Array<{ color: string; path: Path2D; alpha: number }> = [];
      const amp = 0.55 + 0.45 * energyNow;

      for (let y = GAP_Y / 2; y < height; y += GAP_Y) {
        const fadeY = 1 - 0.55 * (y / height);
        for (let x = GAP_X / 2; x < width; x += GAP_X) {
          const n = noise(x * 0.0065 + time * 0.09, y * 0.011, time * 0.07);
          const shaped = n * n;
          const dist = Math.min(1, Math.abs(x - cx) / (width * 0.5));
          const mask = (0.12 + 0.88 * smooth(dist)) * fadeY;
          const alpha = mask * (0.03 + shaped * 0.3);
          if (alpha < 0.012) continue;
          const len = 2 + shaped * 17 * amp;
          const r = hash(x, y, 7);
          if (tints.length && r < 0.03 && shaped > 0.25) {
            const path = new Path2D();
            path.moveTo(x, y - len / 2);
            path.lineTo(x, y + len / 2);
            tinted.push({ color: tints[Math.floor(hash(x, y, 11) * tints.length)]!, path, alpha: Math.min(0.9, alpha * 2.4) });
            continue;
          }
          const path = paths[Math.min(BUCKETS - 1, Math.floor((alpha / 0.33) * BUCKETS))]!;
          path.moveTo(x, y - len / 2);
          path.lineTo(x, y + len / 2);
        }
      }

      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      paths.forEach((path, i) => {
        ctx.strokeStyle = `rgba(236, 235, 231, ${((i + 0.5) / BUCKETS) * 0.33})`;
        ctx.stroke(path);
      });
      for (const t of tinted) {
        ctx.globalAlpha = t.alpha;
        ctx.strokeStyle = t.color;
        ctx.stroke(t.path);
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      energyNow += (live.current.energy - energyNow) * Math.min(1, dt * 1.6);
      focusNow += (live.current.focus - focusNow) * Math.min(1, dt * 1.2);
      time += dt * (0.5 + 1.6 * energyNow);
      draw();
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    if (still) draw();
    else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-canvas" aria-hidden />;
}
