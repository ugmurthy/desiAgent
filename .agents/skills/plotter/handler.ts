// skills/plotter/handler.ts
// Generates line or bar chart as SVG — zero external dependencies.

import { writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";

interface PlotArgs {
  y: number[];
  x?: number[];
  type?: "line" | "bar";
  title?: string;
  output?: string;
}

export default async function plotter(args: PlotArgs): Promise<string> {
  const { y, type = "line", title, output = "artifacts/chart.svg" } = args;

  if (!Array.isArray(y) || y.length === 0) {
    return "Error: y must be a non-empty array of numbers";
  }

  const x = args.x ?? y.map((_, i) => i);
  if (x.length !== y.length) {
    return "Error: x and y arrays must have the same length";
  }

  const svg = type === "bar" ? barChart(x, y, title) : lineChart(x, y, title);

  const outPath = resolve(process.cwd(), output);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, svg, "utf-8");

  return `Chart saved to ${outPath} (${type}, ${y.length} points)`;
}

// ── Layout constants ──────────────────────────────────────────────
const W = 600;
const H = 400;
const PAD = { top: 50, right: 30, bottom: 50, left: 60 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// ── Helpers ───────────────────────────────────────────────────────
function scale(
  val: number,
  min: number,
  max: number,
  outMin: number,
  outMax: number,
): number {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((val - min) / (max - min)) * (outMax - outMin);
}

function niceTickCount(range: number): number {
  if (range === 0) return 1;
  const rough = 5;
  const step = range / rough;
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const residual = step / mag;
  const niceStep =
    residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10;
  return Math.ceil(range / (niceStep * mag));
}

function fmt(n: number): string {
  return Math.abs(n) < 0.01 && n !== 0 ? n.toExponential(2) : +n.toPrecision(4) + "";
}

function axes(xMin: number, xMax: number, yMin: number, yMax: number, title?: string): string {
  const yTicks = niceTickCount(yMax - yMin) || 1;
  const xTicks = niceTickCount(xMax - xMin) || 1;
  let svg = "";

  // Y-axis ticks + grid
  for (let i = 0; i <= yTicks; i++) {
    const val = yMin + (i / yTicks) * (yMax - yMin);
    const py = scale(val, yMin, yMax, PAD.top + PLOT_H, PAD.top);
    svg += `<line x1="${PAD.left}" y1="${py}" x2="${PAD.left + PLOT_W}" y2="${py}" stroke="#e0e0e0" stroke-width="0.5"/>`;
    svg += `<text x="${PAD.left - 8}" y="${py + 4}" text-anchor="end" font-size="11" fill="#555">${fmt(val)}</text>`;
  }

  // X-axis ticks
  for (let i = 0; i <= xTicks; i++) {
    const val = xMin + (i / xTicks) * (xMax - xMin);
    const px = scale(val, xMin, xMax, PAD.left, PAD.left + PLOT_W);
    svg += `<text x="${px}" y="${PAD.top + PLOT_H + 20}" text-anchor="middle" font-size="11" fill="#555">${fmt(val)}</text>`;
  }

  // Axes lines
  svg += `<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PLOT_H}" stroke="#333" stroke-width="1.5"/>`;
  svg += `<line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${PAD.left + PLOT_W}" y2="${PAD.top + PLOT_H}" stroke="#333" stroke-width="1.5"/>`;

  // Title
  if (title) {
    svg += `<text x="${W / 2}" y="${PAD.top - 20}" text-anchor="middle" font-size="15" font-weight="bold" fill="#222">${escXml(title)}</text>`;
  }

  return svg;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="font-family:system-ui,sans-serif">\n<rect width="${W}" height="${H}" fill="#fafafa"/>\n${body}\n</svg>`;
}

// ── Chart renderers ───────────────────────────────────────────────
function lineChart(x: number[], y: number[], title?: string): string {
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const yMin = Math.min(...y, 0);
  const yMax = Math.max(...y);

  let body = axes(xMin, xMax, yMin, yMax, title);

  // Polyline
  const points = x
    .map((xi, i) => {
      const px = scale(xi, xMin, xMax, PAD.left, PAD.left + PLOT_W);
      const py = scale(y[i], yMin, yMax, PAD.top + PLOT_H, PAD.top);
      return `${px},${py}`;
    })
    .join(" ");

  body += `<polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>`;

  // Data points
  x.forEach((xi, i) => {
    const px = scale(xi, xMin, xMax, PAD.left, PAD.left + PLOT_W);
    const py = scale(y[i], yMin, yMax, PAD.top + PLOT_H, PAD.top);
    body += `<circle cx="${px}" cy="${py}" r="3" fill="#2563eb"/>`;
  });

  return wrap(body);
}

function barChart(x: number[], y: number[], title?: string): string {
  const n = y.length;
  const xMin = 0;
  const xMax = n;
  const yMin = Math.min(...y, 0);
  const yMax = Math.max(...y);

  let body = axes(xMin, xMax, yMin, yMax, title);

  const barWidth = (PLOT_W / n) * 0.7;
  const gap = (PLOT_W / n) * 0.15;

  y.forEach((yi, i) => {
    const bx = PAD.left + (i / n) * PLOT_W + gap;
    const byTop = scale(yi, yMin, yMax, PAD.top + PLOT_H, PAD.top);
    const byBase = scale(0, yMin, yMax, PAD.top + PLOT_H, PAD.top);
    const bh = Math.abs(byBase - byTop);
    const by = Math.min(byTop, byBase);
    body += `<rect x="${bx}" y="${by}" width="${barWidth}" height="${bh}" fill="#2563eb" rx="2"/>`;
    // Label
    body += `<text x="${bx + barWidth / 2}" y="${PAD.top + PLOT_H + 20}" text-anchor="middle" font-size="10" fill="#555">${fmt(x[i])}</text>`;
  });

  return wrap(body);
}
