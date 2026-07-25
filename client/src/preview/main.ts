/**
 * Design preview harness — bootstrap.
 *
 * Renders one contact sheet of a subject's variants (or camera angles) into a
 * single element, then flips `window.__PREVIEW__.ready`. `scripts/shot.mjs`
 * waits on that flag and screenshots `#preview-stage`.
 *
 * Query params:
 *   subject    subject id (see the index page when omitted)
 *   variants   comma-separated variant ids, or "all" (default)
 *   view       front | back | side | threequarter | top
 *   yaws       comma-separated degrees — renders ONE variant from many angles
 *   cols       grid columns (default: auto)
 *   cell       cell size in px (default 420)
 *   zoom       <1 fills more of the cell (default from subject)
 *   ground     1/0 to force the ground plane on or off
 *   bg         background as hex, e.g. bg=202024
 */

import { renderStage, type StageCell, type ViewName } from './stage';
import { SUBJECTS, getSubject } from './subjects';

declare global {
  interface Window {
    __PREVIEW__: { ready: boolean; error: string | null };
  }
}

window.__PREVIEW__ = { ready: false, error: null };

const VIEWS: ViewName[] = ['front', 'back', 'side', 'threequarter', 'top'];

/** Subjects rendered through the first-person overlay camera, not auto-framed. */
const FPV_SUBJECTS = new Set(['sights', 'hip']);

function fail(message: string): void {
  window.__PREVIEW__.error = message;
  window.__PREVIEW__.ready = true;
  document.body.innerHTML =
    `<pre style="color:#ff8080;font:14px ui-monospace,monospace;padding:24px;white-space:pre-wrap">${message}</pre>`;
}

function renderIndex(): void {
  const rows = SUBJECTS.map((s) => {
    const variants = s.listVariants().map((v) => v.id).join(', ');
    return `  <li><code>?subject=${s.id}</code> — ${s.description}<br>`
      + `      <span style="opacity:.65">variants: ${variants}</span></li>`;
  }).join('\n');
  document.body.innerHTML =
    `<div style="font:14px ui-monospace,monospace;color:#e8e8ec;padding:24px;line-height:1.7">`
    + `<h1 style="font-size:18px">BitWars design preview</h1><ul>\n${rows}\n</ul></div>`;
  window.__PREVIEW__.ready = true;
}

function main(): void {
  const q = new URLSearchParams(location.search);
  document.body.style.cssText = 'margin:0;background:#17171b;';

  const subjectId = q.get('subject');
  if (!subjectId) { renderIndex(); return; }

  const subject = getSubject(subjectId);
  if (!subject) {
    fail(`unknown subject "${subjectId}". Known: ${SUBJECTS.map((s) => s.id).join(', ')}`);
    return;
  }

  const viewParam = q.get('view') as ViewName | null;
  if (viewParam && !VIEWS.includes(viewParam)) {
    fail(`unknown view "${viewParam}". Known: ${VIEWS.join(', ')}`);
    return;
  }
  const view = viewParam ?? subject.defaultView;

  const cellSize = Number(q.get('cell') ?? 420);
  const zoom = q.has('zoom') ? Number(q.get('zoom')) : (subject.defaultZoom ?? 1);
  const groundParam = q.get('ground');
  const showGround = groundParam === null ? (subject.ground ?? false) : groundParam === '1';

  const all = subject.listVariants();
  const requested = q.get('variants');
  const variants = !requested || requested === 'all'
    ? all
    : requested.split(',').map((id) => all.find((v) => v.id === id.trim())).filter((v) => v !== undefined);

  if (variants.length === 0) {
    fail(`no matching variants. Known: ${all.map((v) => v.id).join(', ')}`);
    return;
  }

  let cells: StageCell[];
  const yawsParam = q.get('yaws');
  if (yawsParam) {
    // Turntable mode: one variant, many angles.
    const v = variants[0]!;
    cells = yawsParam.split(',').map((raw) => {
      const yaw = Number(raw.trim());
      return { label: `${v.label} · ${yaw}°`, object: subject.build(v.id), yaw, zoom };
    });
  } else {
    cells = variants.map((v) => ({
      label: v.label,
      object: subject.build(v.id),
      zoom,
      fpv: FPV_SUBJECTS.has(subject.id),
    }));
  }

  const cols = Number(q.get('cols') ?? Math.min(cells.length, Math.ceil(Math.sqrt(cells.length))));
  const bg = q.get('bg');

  const { container } = renderStage({
    cells,
    cellSize,
    cols,
    view,
    showGround,
    ...(bg ? { background: parseInt(bg, 16) } : {}),
  });

  document.body.appendChild(container);
  window.__PREVIEW__.ready = true;
}

try {
  main();
} catch (err) {
  fail(err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err));
}
