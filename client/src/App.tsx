import { useCallback, useEffect, useRef, useState } from "react";
import { useGameStore } from "./store";
import { connect, resetConnection } from "./db";
import {
  CLIENT_BUILD_HASH,
  fetchLatestBuildMeta,
  hasNewClientBuild,
  isServerBuildCompatible,
} from "./versionCheck";
import { LoginScreen } from "./screens/LoginScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";
import { useMatchSession } from "./screens/hooks/useMatchSession";
import { consumeAuthCallback } from "./auth";

const UPDATE_RELOAD_AT_KEY = "bitwars-update-reload-at";
const UPDATE_RELOAD_TARGET_KEY = "bitwars-update-reload-target";
const UPDATE_RELOAD_COOLDOWN_MS = 60000;

type PendingUpdate = {
  kind: "client" | "compatibility";
  latestClientBuild?: string;
  serverBuild?: string;
};

function LoadingScreen() {
  const [dots, setDots] = useState("");
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Stepped pixel loading bar
    const steps = [8, 20, 35, 50, 65, 78, 88, 95, 100];
    let i = 0;
    const timer = setInterval(() => {
      if (i < steps.length) {
        setBarWidth(steps[i]);
        i++;
      } else {
        clearInterval(timer);
      }
    }, 350);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#0a0c14",
      }}
    >
      <div
        style={{ textAlign: "center" }}
        className="anim-fade-up relative z-10"
      >
        <h1
          style={{
            fontFamily: "var(--font-pixel)",
            fontSize: "clamp(32px, 6vw, 52px)",
            color: "#fff",
            letterSpacing: "0.12em",
            marginBottom: "32px",
            textShadow: "4px 4px 0 #ff6b35, -2px -2px 0 #00e5ff",
          }}
        >
          BITWARS
        </h1>

        <div
          style={{
            width: "240px",
            height: "10px",
            background: "#12161e",
            border: "2px solid #2a2e3e",
            margin: "0 auto 20px",
            overflow: "hidden",
            padding: "1px",
          }}
        >
          <div
            style={{
              width: `${barWidth}%`,
              height: "100%",
              background: "#ff6b35",
              transition: "width 0.15s steps(4)",
              imageRendering: "pixelated",
            }}
          />
        </div>

        <span
          style={{
            fontFamily: "var(--font-pixel)",
            fontSize: "9px",
            color: "#6b7080",
            letterSpacing: "0.15em",
          }}
        >
          CONNECTING{dots}
        </span>
      </div>
    </div>
  );
}

function UpdateBanner({
  pendingUpdate,
  canReloadNow,
  onReloadNow,
}: {
  pendingUpdate: PendingUpdate;
  canReloadNow: boolean;
  onReloadNow: () => void;
}) {
  const message = pendingUpdate.kind === "compatibility"
    ? canReloadNow
      ? "Server update detected. Reloading BitWars to resync."
      : "Server update detected. This round will finish before BitWars reloads."
    : canReloadNow
      ? "New BitWars build ready. Reloading to update."
      : "New BitWars build ready. This round will finish before BitWars reloads.";

  const detail = pendingUpdate.kind === "compatibility"
    ? pendingUpdate.serverBuild
      ? `server ${pendingUpdate.serverBuild} / client ${CLIENT_BUILD_HASH}`
      : `client ${CLIENT_BUILD_HASH}`
    : pendingUpdate.latestClientBuild
      ? `current ${CLIENT_BUILD_HASH} / latest ${pendingUpdate.latestClientBuild}`
      : `current ${CLIENT_BUILD_HASH}`;

  return (
    <div
      style={{
        position: "absolute",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 40,
        minWidth: "min(720px, calc(100vw - 24px))",
        maxWidth: "min(720px, calc(100vw - 24px))",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "10px 14px",
          background: "rgba(10, 12, 20, 0.96)",
          border: "2px solid #ff6b35",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "8px",
              color: "#ff6b35",
              letterSpacing: "0.12em",
            }}
          >
            UPDATE READY
          </span>
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: "#e8e8f0",
              letterSpacing: "0.06em",
              lineHeight: 1.5,
            }}
          >
            {message}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "#6b7080",
            }}
          >
            {detail}
          </span>
        </div>
        <button
          onClick={onReloadNow}
          style={{
            fontFamily: "var(--font-pixel)",
            fontSize: "7px",
            background: "#ff6b35",
            border: "2px solid #ff9f1c",
            color: "#0a0c14",
            letterSpacing: "0.08em",
            cursor: "pointer",
            padding: "8px 12px",
            flexShrink: 0,
          }}
        >
          RELOAD NOW
        </button>
      </div>
    </div>
  );
}

function pendingUpdateFingerprint(update: PendingUpdate): string {
  if (update.kind === "compatibility") {
    return `compatibility:${update.serverBuild ?? "unknown"}`;
  }
  return `client:${update.latestClientBuild ?? "unknown"}`;
}

function App() {
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null);
  const {
    screen,
    identity,
    connected,
    connection,
    error,
    setConnected,
    setIdentity,
    setConnection,
    setError,
    setScreen,
    setUsername,
    resetSession,
  } = useGameStore();
  const handlingSessionLossRef = useRef(false);
  const matchSession = useMatchSession(connection, identity);

  const canReloadForUpdate =
    !connection || screen !== "game" || matchSession.phase !== "active";

  const handleSessionLoss = useCallback(
    (message: string) => {
      if (handlingSessionLossRef.current) return;

      handlingSessionLossRef.current = true;
      resetConnection();
      resetSession(message);
    },
    [resetSession],
  );

  const queuePendingUpdate = useCallback((update: PendingUpdate) => {
    setPendingUpdate((current) => {
      if (!current) return update;
      if (current.kind === "compatibility") {
        return {
          ...current,
          serverBuild: update.serverBuild ?? current.serverBuild,
        };
      }
      if (update.kind === "compatibility") return update;
      return {
        ...current,
        latestClientBuild: update.latestClientBuild ?? current.latestClientBuild,
      };
    });
  }, []);

  const canAutoReloadPendingUpdate = useCallback((update: PendingUpdate) => {
    const target = pendingUpdateFingerprint(update);
    const lastTarget = sessionStorage.getItem(UPDATE_RELOAD_TARGET_KEY);
    const lastAttempt = Number(sessionStorage.getItem(UPDATE_RELOAD_AT_KEY) ?? "0");

    return !(
      lastTarget === target && Date.now() - lastAttempt < UPDATE_RELOAD_COOLDOWN_MS
    );
  }, []);

  const reloadForUpdate = useCallback(() => {
    if (!pendingUpdate) return;

    const target = pendingUpdateFingerprint(pendingUpdate);
    const now = Date.now();
    const lastAttempt = Number(
      sessionStorage.getItem(UPDATE_RELOAD_AT_KEY) ?? "0",
    );
    const lastTarget = sessionStorage.getItem(UPDATE_RELOAD_TARGET_KEY);
    if (
      lastTarget === target &&
      now - lastAttempt < UPDATE_RELOAD_COOLDOWN_MS
    ) {
      setError("BitWars is still updating. Try again in a few seconds.");
      return;
    }

    sessionStorage.setItem(UPDATE_RELOAD_TARGET_KEY, target);
    sessionStorage.setItem(UPDATE_RELOAD_AT_KEY, String(now));
    resetConnection();
    window.location.reload();
  }, [pendingUpdate, setError]);

  useEffect(() => {
    const result = consumeAuthCallback();
    if (result.error) {
      setError(result.error);
    }
    setAuthReady(true);
  }, [setError]);

  useEffect(() => {
    if (!authReady || connected || connection) return;

    connect(
      (conn, nextIdentity, _token) => {
        handlingSessionLossRef.current = false;
        setError(null);
        setIdentity(nextIdentity);
        setConnection(conn);
        setConnected(true);
      },
      (nextError) => {
        setError(nextError.message);
        console.error("[BitWars] Connection error:", nextError);
      },
      (disconnectError) => {
        console.error("[BitWars] Session lost:", disconnectError);
        handleSessionLoss(disconnectError.message);
      },
    );

    const retryTimer = window.setTimeout(() => {
      const state = useGameStore.getState();
      if (!state.connected && !state.connection) {
        setConnectAttempt((attempt) => attempt + 1);
      }
    }, 2000);

    return () => window.clearTimeout(retryTimer);
  }, [
    authReady,
    connected,
    connection,
    setConnected,
    setIdentity,
    setConnection,
    setError,
    handleSessionLoss,
    connectAttempt,
  ]);

  useEffect(() => {
    if (pendingUpdate) return;
    sessionStorage.removeItem(UPDATE_RELOAD_TARGET_KEY);
    sessionStorage.removeItem(UPDATE_RELOAD_AT_KEY);
  }, [pendingUpdate]);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let disposed = false;
    let activeController: AbortController | null = null;

    const pollLatestBuild = async () => {
      activeController?.abort();
      activeController = new AbortController();

      const meta = await fetchLatestBuildMeta(activeController.signal);
      if (disposed || !meta || !hasNewClientBuild(meta)) return;

      queuePendingUpdate({
        kind: "client",
        latestClientBuild: meta.clientBuild,
      });
    };

    void pollLatestBuild();
    const interval = window.setInterval(() => {
      void pollLatestBuild();
    }, 60000);

    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(interval);
    };
  }, [queuePendingUpdate]);

  useEffect(() => {
    if (!connected || !connection || !identity) return;

    const checkLocalPlayer = () => {
      let localPlayer: { online?: boolean; username?: string } | null = null;

      for (const row of connection.db.player.iter()) {
        const player = row as {
          identity: { toHexString: () => string };
          online?: boolean;
          username?: string;
        };
        if (player.identity.toHexString() !== identity) continue;
        localPlayer = player;
        break;
      }

      if (!localPlayer) {
        if (screen !== "login") {
          handleSessionLoss("Lost sync with the server. Please join again.");
        }
        return;
      }

      if (localPlayer.online === false) {
        handleSessionLoss("Lost sync with the server. Please join again.");
        return;
      }

      if (localPlayer.username?.trim()) {
        setUsername(localPlayer.username);
        if (screen === "login") {
          setScreen("lobby");
        }
      }
    };

    checkLocalPlayer();
    const interval = window.setInterval(checkLocalPlayer, 1000);

    const db = connection.db as Record<string, unknown>;
    const serverInfoTable = db.server_info as
      | {
          onInsert?: (cb: (...args: unknown[]) => void) => { remove: () => void };
          iter?: () => Iterable<{ buildHash?: string }>;
        }
      | undefined;

    let versionUnsub: { remove: () => void } | undefined;

    const checkVersion = (row: { buildHash?: string }) => {
      if (row.buildHash && !isServerBuildCompatible(row.buildHash)) {
        queuePendingUpdate({
          kind: "compatibility",
          serverBuild: row.buildHash,
        });
      }
    };

    if (serverInfoTable) {
      if (serverInfoTable.iter) {
        for (const row of serverInfoTable.iter()) {
          checkVersion(row);
        }
      }
      if (serverInfoTable.onInsert) {
        versionUnsub = serverInfoTable.onInsert((_ctx: unknown, row: unknown) =>
          checkVersion(row as { buildHash?: string }),
        );
      }
    }

    return () => {
      window.clearInterval(interval);
      versionUnsub?.remove();
    };
  }, [
    connected,
    connection,
    identity,
    screen,
    handleSessionLoss,
    queuePendingUpdate,
    setScreen,
    setUsername,
  ]);

  useEffect(() => {
    if (import.meta.env.DEV || !pendingUpdate || !canReloadForUpdate) return;
    if (!canAutoReloadPendingUpdate(pendingUpdate)) return;

    const reloadTimer = window.setTimeout(() => {
      reloadForUpdate();
    }, pendingUpdate.kind === "compatibility" ? 1500 : 4000);

    return () => window.clearTimeout(reloadTimer);
  }, [
    pendingUpdate,
    canAutoReloadPendingUpdate,
    canReloadForUpdate,
    reloadForUpdate,
  ]);


  if (!connected && !error) {
    return <LoadingScreen />;
  }

  const showGameScreen = connection !== null;

  return (
    <div className="w-full h-full relative">
      {pendingUpdate && (
        <UpdateBanner
          pendingUpdate={pendingUpdate}
          canReloadNow={canReloadForUpdate}
          onReloadNow={reloadForUpdate}
        />
      )}
      <div className="absolute inset-0">
        {showGameScreen && <GameScreen active={screen === "game"} />}
      </div>
      {screen === "login" && (
        <div className="absolute inset-0 z-10">
          <LoginScreen />
        </div>
      )}
      {screen === "lobby" && (
        <div className="absolute inset-0 z-10">
          <LobbyScreen />
        </div>
      )}
    </div>
  );
}

export default App;
