#!/usr/bin/env node
/**
 * Design preview driver.
 *
 * Loads `/preview.html` in headless Chrome, waits for the harness to signal
 * ready, and writes a PNG of the contact sheet. Batches several shots through a
 * single browser launch, which is the whole point — launching costs ~400ms and
 * each additional shot after that is well under a second.
 *
 * Requires the Vite dev server (`bun dev`). Rendering goes through SwiftShader,
 * so output is deterministic across machines but is not a performance signal.
 *
 * Usage:
 *   bun run shot --subject character
 *   bun run shot --subject voxel --variants flat,pit --view side --cell 520
 *   bun run shot --subject fpweapon --yaws 0,90,180,270
 *   bun run shot --all
 */

import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'http://localhost:5173';
const DEFAULT_OUT_DIR = resolve(CLIENT_DIR, '.preview-shots');

/** Passed through to the harness verbatim as query params. */
const PASSTHROUGH = ['subject', 'variants', 'view', 'yaws', 'cols', 'cell', 'zoom', 'ground', 'bg'];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

async function assertDevServer(base) {
  try {
    const res = await fetch(`${base}/preview.html`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(
      `\nCannot reach the preview harness at ${base}/preview.html (${err.message}).\n`
      + `Start the dev server first:  cd client && bun dev\n`,
    );
    process.exit(1);
  }
}

async function shoot(page, { base, params, outPath, scale }) {
  const qs = new URLSearchParams(params).toString();
  const url = `${base}/preview.html?${qs}`;

  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: scale });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__PREVIEW__?.ready === true, { timeout: 30000 });

  const error = await page.evaluate(() => window.__PREVIEW__.error);
  if (error) throw new Error(`harness error for ${qs}:\n${error}`);

  const stage = await page.$('#preview-stage');
  if (!stage) throw new Error(`no #preview-stage rendered for ${qs} (is --subject set?)`);

  // Grow the viewport to the full sheet so nothing is clipped by scrolling.
  const box = await stage.boundingBox();
  await page.setViewport({
    width: Math.ceil(box.width),
    height: Math.ceil(box.height),
    deviceScaleFactor: scale,
  });

  const buf = await stage.screenshot({ type: 'png' });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base ?? DEFAULT_BASE;
  const scale = Number(args.scale ?? 1);
  const outDir = args.outdir ? resolve(args.outdir) : DEFAULT_OUT_DIR;

  await assertDevServer(base);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
    ],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(`  [page error] ${e.message}`));

    let jobs;
    if (args.all) {
      // Discover subjects from the harness itself so this never goes stale.
      await page.goto(`${base}/preview.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__PREVIEW__?.ready === true, { timeout: 30000 });
      const ids = await page.evaluate(() =>
        [...document.querySelectorAll('code')].map((c) => c.textContent.replace('?subject=', '')));
      jobs = ids.map((id) => ({ params: { subject: id }, outPath: resolve(outDir, `${id}.png`) }));
    } else {
      const params = {};
      for (const k of PASSTHROUGH) if (args[k] !== undefined) params[k] = String(args[k]);
      if (!params.subject) {
        console.error('Pass --subject <id>, or --all. Run with --subject "" to list subjects.');
        process.exit(1);
      }
      const name = args.out
        ? resolve(args.out)
        : resolve(outDir, `${params.subject}${params.view ? `-${params.view}` : ''}.png`);
      jobs = [{ params, outPath: name }];
    }

    const started = Date.now();
    for (const job of jobs) {
      const t = Date.now();
      const written = await shoot(page, { base, params: job.params, outPath: job.outPath, scale });
      console.log(`  ${written}  (${Date.now() - t}ms)`);
    }
    console.log(`\n${jobs.length} shot(s) in ${Date.now() - started}ms`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
