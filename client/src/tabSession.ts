// Per-tab session coordination. The first BitWars tab holds a Web Lock for
// its lifetime ("primary") and keeps the shared persistent identity; any
// additional tab becomes "secondary" and gets its own per-tab identity so
// multiple players can join from one browser (multi-tab testing).

const PRIMARY_TAB_LOCK = "bitwars-primary-tab";

let secondary = false;

export function initTabSession(): Promise<void> {
  if (!("locks" in navigator)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    void navigator.locks.request(
      PRIMARY_TAB_LOCK,
      { ifAvailable: true },
      (lock) => {
        if (lock === null) {
          secondary = true;
          resolve();
          return;
        }
        resolve();
        // Hold the lock until the tab closes so later tabs become secondary
        return new Promise<void>(() => {});
      },
    );
  });
}

export function isSecondaryTab(): boolean {
  return secondary;
}
