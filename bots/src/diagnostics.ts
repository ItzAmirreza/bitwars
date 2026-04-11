type ReconcileMode = 'none' | 'soft' | 'hard';

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

function max(values: number[]): number {
  if (values.length === 0) return 0;
  let best = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] ?? 0) > best) best = values[i] ?? 0;
  }
  return best;
}

class BotRuntimeDiagnostics {
  private readonly enabled = process.env.BOT_DIAGNOSTICS !== '0';
  private readonly intervalMs = Math.max(2000, Math.floor(Number(process.env.BOT_DIAGNOSTICS_INTERVAL_MS ?? 10000) || 10000));
  private timer: ReturnType<typeof setInterval> | null = null;
  private windowStartedAt = Date.now();
  private botNames = new Set<string>();
  private tickDtMs: number[] = [];
  private tickDelayMs: number[] = [];
  private tickComputeMs: number[] = [];
  private reconcileHorizontal: number[] = [];
  private reconcileVertical: number[] = [];
  private longTickCount = 0;
  private softReconcileCount = 0;
  private hardReconcileCount = 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.flush();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  recordTick(botName: string, actualDtMs: number, targetDtMs: number, computeMs: number): void {
    if (!this.enabled) return;
    this.start();
    this.botNames.add(botName);
    this.tickDtMs.push(actualDtMs);
    this.tickComputeMs.push(computeMs);
    const delay = Math.max(0, actualDtMs - targetDtMs);
    this.tickDelayMs.push(delay);
    if (actualDtMs > targetDtMs * 1.35) {
      this.longTickCount++;
    }
  }

  recordReconcile(botName: string, horizontalDrift: number, verticalDrift: number, mode: ReconcileMode): void {
    if (!this.enabled) return;
    this.start();
    this.botNames.add(botName);
    this.reconcileHorizontal.push(horizontalDrift);
    this.reconcileVertical.push(verticalDrift);
    if (mode === 'soft') this.softReconcileCount++;
    if (mode === 'hard') this.hardReconcileCount++;
  }

  private flush(): void {
    if (!this.enabled) return;
    const windowMs = Date.now() - this.windowStartedAt;
    if (
      this.tickDtMs.length === 0 &&
      this.reconcileHorizontal.length === 0 &&
      this.reconcileVertical.length === 0
    ) {
      this.windowStartedAt = Date.now();
      return;
    }

    const tickAvg = mean(this.tickDtMs);
    const tickP95 = percentile(this.tickDtMs, 0.95);
    const tickMax = max(this.tickDtMs);
    const delayAvg = mean(this.tickDelayMs);
    const delayP95 = percentile(this.tickDelayMs, 0.95);
    const computeAvg = mean(this.tickComputeMs);
    const computeP95 = percentile(this.tickComputeMs, 0.95);
    const computeMax = max(this.tickComputeMs);
    const reconcileAvg = mean(this.reconcileHorizontal);
    const reconcileP95 = percentile(this.reconcileHorizontal, 0.95);
    const reconcileMax = max(this.reconcileHorizontal);
    const reconcileYMax = max(this.reconcileVertical);

    console.log(
      `[bots:diag] window=${(windowMs / 1000).toFixed(1)}s bots=${this.botNames.size} ` +
      `tick_avg=${tickAvg.toFixed(1)}ms tick_p95=${tickP95.toFixed(1)}ms tick_max=${tickMax.toFixed(1)}ms ` +
      `delay_avg=${delayAvg.toFixed(1)}ms delay_p95=${delayP95.toFixed(1)}ms long_ticks=${this.longTickCount} ` +
      `compute_avg=${computeAvg.toFixed(2)}ms compute_p95=${computeP95.toFixed(2)}ms compute_max=${computeMax.toFixed(2)}ms ` +
      `reconcile_avg=${reconcileAvg.toFixed(2)}u reconcile_p95=${reconcileP95.toFixed(2)}u reconcile_max=${reconcileMax.toFixed(2)}u ` +
      `reconcile_y_max=${reconcileYMax.toFixed(2)}u soft=${this.softReconcileCount} hard=${this.hardReconcileCount}`,
    );

    this.windowStartedAt = Date.now();
    this.botNames.clear();
    this.tickDtMs = [];
    this.tickDelayMs = [];
    this.tickComputeMs = [];
    this.reconcileHorizontal = [];
    this.reconcileVertical = [];
    this.longTickCount = 0;
    this.softReconcileCount = 0;
    this.hardReconcileCount = 0;
  }
}

export const runtimeDiagnostics = new BotRuntimeDiagnostics();
