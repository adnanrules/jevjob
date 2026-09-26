"use client";
// A field of short vertical ticks (the verdict barcode at landscape scale), moved by slow 3D value noise.
//   · `energy` speeds it up while the machine runs; `tints` let a few ticks take the results' tier colors.
//   · The cursor is a lens: nearby ticks lengthen and brighten.
//   · pulse(x, y, color) sends a shockwave ring through the field (resume dropped, job ranked, batch loaded).
// Ticks fade toward `focus` (the content column), so text always sits on a quiet background.
import { useEffect, useRef } from "react";

const GAP_X = 11;
const GAP_Y = 24;
const LENS = 150;
const RING_SPEED = 520; // px per second
const RING_WIDTH = 34;
const RING_LIFE = 1.6; // seconds

interface Pulse { x: number; y: number; color: string; born: number }
const pulses: Pulse[] = [];

/** Send a shockwave through the background from a screen point. Safe to call from anywhere. */
export function pulse(x: number, y: number, color = "rgba(236,235,231,1)") {
  pulses.push({ x, y, color, born: performance.now() });
  if (pulses.length > 12) pulses.shift();
}

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 3D value noise in [0, 1]: smooth and cheap, fine for slow ambient motion. */
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

export function Background({ energy, focus, tints }: { energy: number; focus: number; tints: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ energy, focus, tints });
  live.current = { energy, focus, tints };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(window.location.search).has("still");
    let width = 0, height = 0, raf = 0, last = performance.now(), time = 0;
    let energyNow = 0, focusNow = live.current.focus;
    const pointer = { x: -9999, y: -9999, strength: 0, target: 0 };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw(performance.now());
    };
    const move = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.target = 1;
    };
    const leave = () => void (pointer.target = 0);

    const BUCKETS = 8;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const { tints } = live.current;
      const cx = focusNow * width;
      const paths = Array.from({ length: BUCKETS }, () => new Path2D());
      const accents: Array<{ color: string; alpha: number; path: Path2D }> = [];
      const amp = 0.55 + 0.45 * energyNow;
      const active = pulses.filter((p) => (now - p.born) / 1000 < RING_LIFE);

      for (let y = GAP_Y / 2; y < height; y += GAP_Y) {
        const fadeY = 1 - 0.55 * (y / height);
        for (let x = GAP_X / 2; x < width; x += GAP_X) {
          const n = noise(x * 0.0065 + time * 0.09, y * 0.011, time * 0.07);
          let shaped = n * n;
          const dist = Math.min(1, Math.abs(x - cx) / (width * 0.5));
          let mask = (0.12 + 0.88 * smooth(dist)) * fadeY;

          // Cursor lens: a soft bump in length and brightness, even over the quiet center.
          let lens = 0;
          if (pointer.strength > 0.01) {
            const d = Math.hypot(x - pointer.x, y - pointer.y);
            if (d < LENS) lens = (1 - d / LENS) ** 2 * pointer.strength;
          }
          // Shockwave rings.
          let ring = 0;
          let ringColor: string | null = null;
          for (const p of active) {
            const age = (now - p.born) / 1000;
            const offset = Math.hypot(x - p.x, y - p.y) - age * RING_SPEED;
            const strength = Math.exp(-(offset * offset) / (2 * RING_WIDTH * RING_WIDTH)) * (1 - age / RING_LIFE);
            if (strength > ring) {
              ring = strength;
              ringColor = p.color;
            }
          }
          shaped = Math.min(1, shaped + lens * 0.55 + ring * 0.7);
          mask = Math.min(1, mask + lens * 0.8 + ring * 0.9);

          const alpha = mask * (0.03 + shaped * 0.3);
          if (alpha < 0.012) continue;
          const len = 2 + shaped * 17 * amp + lens * 10 + ring * 12;
          const accent =
            ringColor && ring > 0.35 ? { color: ringColor, alpha: Math.min(0.95, alpha * 2.2) }
            : tints.length && hash(x, y, 7) < 0.03 && shaped > 0.25 ? { color: tints[Math.floor(hash(x, y, 11) * tints.length)]!, alpha: Math.min(0.9, alpha * 2.4) }
            : null;
          // Plain ticks share a few batched paths; only the rare colored ones get their own.
          const path = accent ? new Path2D() : paths[Math.min(BUCKETS - 1, Math.floor((alpha / 0.33) * BUCKETS))]!;
          path.moveTo(x, y - len / 2);
          path.lineTo(x, y + len / 2);
          if (accent) accents.push({ ...accent, path });
        }
      }

      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      paths.forEach((path, i) => {
        ctx.strokeStyle = `rgba(236, 235, 231, ${((i + 0.5) / BUCKETS) * 0.33})`;
        ctx.stroke(path);
      });
      for (const a of accents) {
        ctx.globalAlpha = a.alpha;
        ctx.strokeStyle = a.color;
        ctx.stroke(a.path);
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      energyNow += (live.current.energy - energyNow) * Math.min(1, dt * 1.6);
      focusNow += (live.current.focus - focusNow) * Math.min(1, dt * 1.2);
      pointer.strength += (pointer.target - pointer.strength) * Math.min(1, dt * 5);
      time += dt * (0.5 + 1.6 * energyNow);
      draw(now);
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    if (still) draw(performance.now());
    else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-canvas" aria-hidden />;
}
