import { useState, useEffect } from "react";
import { useGameStore } from "../store";
import { menuAudio } from "../menuAudio";
import { PixelArtBg } from "./PixelArtBg";

// Small decorative pixel bar
function PixelBar({
  colors,
  height = 4,
}: {
  colors: string[];
  height?: number;
}) {
  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {colors.map((c, i) => (
        <div
          key={i}
          style={{
            width: "10px",
            height: `${height}px`,
            background: c,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

export function LobbyScreen() {
  const { username, identity, connection, setScreen } = useGameStore();
  const settings = useGameStore((s) => s.settings);
  const [mounted, setMounted] = useState(false);

  const players = connection
    ? Array.from(connection.db.player.iter()).filter((p: any) => p.online)
    : [];
  const localPlayer = connection
    ? (Array.from(connection.db.player.iter()).find(
        (p: any) => p.identity.toHexString() === identity,
      ) ?? null)
    : null;
  const localProfile =
    connection && localPlayer
      ? (Array.from(
          ((connection.db as any).player_profile?.iter?.() ??
            []) as Iterable<any>,
        ).find(
          (profile: any) =>
            Number(profile.profileId) === Number(localPlayer.profileId),
        ) ?? null)
      : null;
  const onlineCount = players.length;
  const lifetimeKills = Number(localProfile?.totalKills ?? 0);
  const lifetimeDeaths = Number(localProfile?.totalDeaths ?? 0);
  const lifetimeKd =
    lifetimeDeaths > 0
      ? (lifetimeKills / lifetimeDeaths).toFixed(1)
      : lifetimeKills > 0
        ? lifetimeKills.toFixed(1)
        : "0.0";
  const lifetimePlaytimeMins = Math.floor(
    Number(localProfile?.timePlayedSecs ?? 0) / 60,
  );
  const bestStreak = Number(localProfile?.bestStreak ?? 0);

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
    menuAudio.startMenuAmbience();
    menuAudio.playUINavigate();
    setMounted(true);
    return () => {
      menuAudio.stopMenuAmbience();
    };
  }, []);

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume]);

  const handleEnterGame = () => {
    menuAudio.playUIDeploy();
    setScreen("game");
  };
  const handleEnterPerf = () => {
    menuAudio.playUIDeploy();
    sessionStorage.setItem("bitwars-open-perf", "1");
    setScreen("game");
  };

  const accentOrange = "#ff6b35";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#0a0c14",
      }}
    >
      <PixelArtBg />

      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: "3px solid #1a1e2a",
          background: "rgba(10, 12, 20, 0.9)",
          position: "relative",
          zIndex: 10,
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.4s ease",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <h1
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "16px",
              color: "#fff",
              letterSpacing: "0.08em",
              textShadow: "3px 3px 0 #ff6b35",
            }}
          >
            BITWARS
          </h1>
          <PixelBar
            colors={["#ff6b35", "#ffd600", "#76ff03", "#00e5ff", "#7c4dff"]}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Online count */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "var(--font-pixel)",
              fontSize: "8px",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                background: "#76ff03",
              }}
            />
            <span style={{ color: "#76ff03" }}>{onlineCount} ONLINE</span>
          </div>

          {/* Player name */}
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "9px",
              color: "#ffd600",
              letterSpacing: "0.05em",
            }}
          >
            {username}
          </span>
        </div>
      </header>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.5s ease 0.15s",
            gap: "28px",
            width: "min(460px, calc(100vw - 40px))",
          }}
        >
          {/* Play section */}
          <div
            className="anim-scale-in"
            style={{ animationDelay: "0.15s", width: "100%" }}
          >
            <div
              style={{
                background: "rgba(18, 22, 32, 0.92)",
                border: "3px solid #1a1e2a",
                padding: "28px 24px 22px",
                textAlign: "center",
                boxShadow: "6px 6px 0 #00000044",
              }}
            >
              {/* Play button */}
              <button
                onClick={handleEnterGame}
                onMouseEnter={() => menuAudio.playUIHover()}
                style={{
                  width: "100%",
                  background: accentOrange,
                  border: "4px solid #000",
                  color: "#000",
                  fontFamily: "var(--font-pixel)",
                  fontSize: "20px",
                  letterSpacing: "0.2em",
                  padding: "20px 24px",
                  cursor: "pointer",
                  transition: "all 0.1s",
                  boxShadow: "5px 5px 0 #00000066",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = "translate(-2px, -2px)";
                  e.currentTarget.style.boxShadow = "7px 7px 0 #00000066";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = "translate(0, 0)";
                  e.currentTarget.style.boxShadow = "5px 5px 0 #00000066";
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "translate(3px, 3px)";
                  e.currentTarget.style.boxShadow = "1px 1px 0 #00000066";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "translate(-2px, -2px)";
                  e.currentTarget.style.boxShadow = "7px 7px 0 #00000066";
                }}
              >
                PLAY
              </button>

              {/* Test harness button */}
              <button
                onClick={handleEnterPerf}
                onMouseEnter={() => menuAudio.playUIHover()}
                style={{
                  width: "100%",
                  marginTop: "10px",
                  fontSize: "8px",
                  padding: "10px 14px",
                  letterSpacing: "0.1em",
                  fontFamily: "var(--font-pixel)",
                  border: "2px solid #2a2e3e",
                  color: "#6b7080",
                  background: "transparent",
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = "#00e5ff";
                  e.currentTarget.style.color = "#00e5ff";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = "#2a2e3e";
                  e.currentTarget.style.color = "#6b7080";
                }}
              >
                PLAY + TEST HARNESS
              </button>

              <p
                style={{
                  fontFamily: "var(--font-pixel)",
                  fontSize: "7px",
                  color: "#6b7080",
                  marginTop: "16px",
                  letterSpacing: "0.1em",
                  lineHeight: "2",
                }}
              >
                ALL WEAPONS UNLOCKED &bull; NO RULES
              </p>

              {/* Weapon pills */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  marginTop: "12px",
                  gap: "6px",
                }}
              >
                {[
                  { name: "RIFLE", color: "#00aaff" },
                  { name: "SHOTGUN", color: "#ff9f1c" },
                  { name: "RPG", color: "#ff2d78" },
                  { name: "MACHINE GUN", color: "#00e5ff" },
                  { name: "GRENADE", color: "#76ff03" },
                ].map((w) => (
                  <div
                    key={w.name}
                    style={{
                      fontFamily: "var(--font-pixel)",
                      fontSize: "6px",
                      padding: "4px 10px",
                      border: `2px solid ${w.color}`,
                      color: w.color,
                      letterSpacing: "0.06em",
                      background: `${w.color}10`,
                    }}
                  >
                    {w.name}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {localProfile && (
            <div
              className="anim-fade-up"
              style={{ animationDelay: "0.22s", width: "100%" }}
            >
              <div
                style={{
                  background: "rgba(10, 16, 26, 0.86)",
                  border: "3px solid #16324a",
                  padding: "16px 18px",
                  boxShadow: "6px 6px 0 #00000033",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-pixel)",
                      fontSize: "8px",
                      color: "#00e5ff",
                      letterSpacing: "0.16em",
                    }}
                  >
                    LIFETIME PROFILE
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-pixel)",
                      fontSize: "7px",
                      color: "#6b7080",
                      letterSpacing: "0.08em",
                    }}
                  >
                    SAVED TO THIS BROWSER
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: "10px",
                  }}
                >
                  {[
                    { label: "KILLS", value: lifetimeKills, color: "#76ff03" },
                    {
                      label: "DEATHS",
                      value: lifetimeDeaths,
                      color: "#ff2d78",
                    },
                    { label: "K/D", value: lifetimeKd, color: "#ffd600" },
                    { label: "STREAK", value: bestStreak, color: "#00e5ff" },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      style={{
                        border: `2px solid ${stat.color}33`,
                        background: `${stat.color}12`,
                        padding: "10px 8px",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-pixel)",
                          fontSize: "6px",
                          color: "#6b7080",
                          letterSpacing: "0.12em",
                          marginBottom: "6px",
                        }}
                      >
                        {stat.label}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-pixel)",
                          fontSize: "12px",
                          color: stat.color,
                        }}
                      >
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                <p
                  style={{
                    fontFamily: "var(--font-pixel)",
                    fontSize: "7px",
                    color: "#6b7080",
                    marginTop: "12px",
                    letterSpacing: "0.08em",
                    lineHeight: "1.8",
                  }}
                >
                  PLAYTIME {lifetimePlaytimeMins} MINUTES
                </p>
              </div>
            </div>
          )}

          {/* Players list */}
          {onlineCount > 0 && (
            <div
              className="anim-fade-up"
              style={{ animationDelay: "0.3s", width: "100%" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontFamily: "var(--font-pixel)",
                  fontSize: "8px",
                  color: "#6b7080",
                  letterSpacing: "0.12em",
                  marginBottom: "8px",
                  padding: "0 4px",
                }}
              >
                <span>PLAYERS</span>
                <span style={{ color: "#76ff03" }}>{onlineCount}</span>
              </div>
              <div
                style={{
                  background: "rgba(18, 22, 32, 0.92)",
                  border: "3px solid #1a1e2a",
                  maxHeight: "200px",
                  overflowY: "auto",
                  boxShadow: "4px 4px 0 #00000033",
                }}
              >
                {players.map((p: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 14px",
                      fontFamily: "var(--font-pixel)",
                      fontSize: "8px",
                      borderBottom:
                        i < players.length - 1 ? "2px solid #1a1e2a" : "none",
                      transition: "background 0.1s",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.03)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {/* Pixel avatar dot */}
                      <div
                        style={{
                          width: "6px",
                          height: "6px",
                          background: "#ff6b35",
                        }}
                      />
                      <span
                        style={{
                          color:
                            p.username === username ? "#ffd600" : "#e8e8f0",
                        }}
                      >
                        {p.username || "Unknown"}
                      </span>
                      {p.username === username && (
                        <span
                          style={{
                            fontSize: "6px",
                            color: "#ffd600",
                            border: "1px solid #ffd60055",
                            padding: "1px 4px",
                            letterSpacing: "0.1em",
                          }}
                        >
                          YOU
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontSize: "7px",
                      }}
                    >
                      <span style={{ color: "#76ff03" }}>K:{p.kills}</span>
                      <span style={{ color: "#ff2d78" }}>D:{p.deaths}</span>
                      <span style={{ color: "#4a4e5e" }}>
                        {p.kills + p.deaths > 0
                          ? (
                              (p.kills / Math.max(1, p.deaths)) as number
                            ).toFixed(1)
                          : "0.0"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          borderTop: "3px solid #1a1e2a",
          background: "rgba(10, 12, 20, 0.85)",
          position: "relative",
          zIndex: 10,
          flexWrap: "wrap",
          gap: "8px",
        }}
        className="anim-fade-in"
      >
        <span
          style={{
            fontFamily: "var(--font-pixel)",
            fontSize: "7px",
            color: "#3a3e4e",
            letterSpacing: "0.1em",
          }}
        >
          v0.1.0-ALPHA
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: "#3a3e4e",
              letterSpacing: "0.1em",
            }}
          >
            SPACETIMEDB
          </span>
          <div style={{ width: "6px", height: "6px", background: "#76ff03" }} />
        </div>
      </footer>
    </div>
  );
}
