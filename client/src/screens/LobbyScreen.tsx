import { useState, useEffect, useRef } from "react";
import { useGameStore } from "../store";
import { CLIENT_BUILD_HASH } from "../versionCheck";
import { menuAudio } from "../menuAudio";
import { PixelArtBg } from "./PixelArtBg";
import { GAME_MODES, getGameMode } from "../gameModes";
import {
  getActiveProvider,
  getAuthMode,
  getProviderLabel,
  useGuestProfile,
} from "../auth";
import { resetConnection } from "../db";
import { PrivacyPolicy, PixelDiscordIcon } from "./PrivacyPolicy";

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
  const {
    username,
    identity,
    connection,
    setScreen,
    setUsername,
    resetSession,
    selectedCharacterPreset,
    selectedGameMode,
    setSelectedGameMode,
  } = useGameStore();
  const settings = useGameStore((s) => s.settings);
  const [mounted, setMounted] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Inline player-name editing
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(username);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const activeMode = getGameMode(selectedGameMode);

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
  const authMode = getAuthMode();
  const authProviderLabel = getProviderLabel(
    authMode === "account" ? getActiveProvider() : null,
  );

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

  // Keep the draft in sync if the name changes elsewhere while not editing
  useEffect(() => {
    if (!editingName) setNameDraft(username);
  }, [username, editingName]);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  const startEditingName = () => {
    menuAudio.playUIClick();
    setNameDraft(username);
    setNameError(null);
    setEditingName(true);
  };

  const cancelEditingName = () => {
    menuAudio.playUIClick();
    setNameError(null);
    setEditingName(false);
    setNameDraft(username);
  };

  const handleSaveName = async () => {
    const name = nameDraft.trim();
    if (!connection || savingName) return;
    if (!name || name.length > 20) {
      menuAudio.playUIError();
      setNameError("Name must be 1-20 characters");
      return;
    }
    if (name === username) {
      setEditingName(false);
      setNameError(null);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await connection.reducers.setUsername({
        username: name,
        characterPreset: selectedCharacterPreset,
      });
      setUsername(name);
      menuAudio.playUINavigate();
      setEditingName(false);
    } catch (error) {
      menuAudio.playUIError();
      setNameError(
        error instanceof Error ? error.message : "Failed to update name",
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleSelectMode = (modeId: string, available: boolean) => {
    if (!available) {
      menuAudio.playUIError();
      return;
    }
    if (modeId === selectedGameMode) return;
    menuAudio.playUIClick();
    setSelectedGameMode(modeId);
  };

  const handleEnterGame = () => {
    if (!activeMode.available) {
      menuAudio.playUIError();
      return;
    }
    menuAudio.playUIDeploy();
    setScreen("game");
  };

  const handleUseGuest = () => {
    menuAudio.playUIClick();
    useGuestProfile();
    resetConnection();
    resetSession(null);
  };

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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
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
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: authMode === "account" ? "#00e5ff" : "#6b7080",
              letterSpacing: "0.08em",
              border: `2px solid ${authMode === "account" ? "#00e5ff55" : "#2a2e3e"}`,
              padding: "4px 8px",
            }}
          >
            {authMode === "account" ? authProviderLabel.toUpperCase() : "GUEST"}
          </span>
          {authMode === "account" && (
            <button
              onClick={handleUseGuest}
              onMouseEnter={() => menuAudio.playUIHover()}
              style={{
                border: "2px solid #2a2e3e",
                background: "transparent",
                color: "#ffd600",
                fontFamily: "var(--font-pixel)",
                fontSize: "7px",
                letterSpacing: "0.08em",
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              USE GUEST
            </button>
          )}
          {authMode === "guest" && (
            <button
              disabled
              onMouseEnter={() => menuAudio.playUIHover()}
              style={{
                border: "2px solid #2a2e3e",
                background: "transparent",
                color: "#00e5ff",
                fontFamily: "var(--font-pixel)",
                fontSize: "7px",
                letterSpacing: "0.08em",
                padding: "6px 10px",
                cursor: "not-allowed",
                opacity: 0.45,
              }}
            >
              SIGN IN
            </button>
          )}
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
          {/* Call sign (editable player name) */}
          <div
            className="anim-fade-up"
            style={{ animationDelay: "0.1s", width: "100%" }}
          >
            <div
              style={{
                background: "rgba(18, 22, 32, 0.92)",
                border: "3px solid #1a1e2a",
                borderLeft: "3px solid #ffd600",
                padding: "16px 18px",
                boxShadow: "6px 6px 0 #00000044",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-pixel)",
                  fontSize: "8px",
                  color: "#ffd600",
                  letterSpacing: "0.16em",
                  marginBottom: "12px",
                }}
              >
                CALL SIGN
              </div>

              {editingName ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <input
                      ref={nameInputRef}
                      type="text"
                      value={nameDraft}
                      maxLength={20}
                      onChange={(e) => {
                        setNameDraft(e.target.value);
                        menuAudio.playUIType();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveName();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditingName();
                        }
                      }}
                      placeholder="ENTER NAME..."
                      style={{
                        width: "100%",
                        background: "#12161e",
                        border: "3px solid #ffd600",
                        color: "#e8e8f0",
                        fontFamily: "var(--font-pixel)",
                        fontSize: "13px",
                        letterSpacing: "0.06em",
                        padding: "12px 48px 12px 14px",
                        outline: "none",
                        boxShadow: "4px 4px 0 #0005",
                        imageRendering: "pixelated",
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: "12px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontFamily: "var(--font-pixel)",
                        fontSize: "8px",
                        color: "#4a4e5e",
                      }}
                    >
                      {nameDraft.length}/20
                    </span>
                  </div>

                  {nameError && (
                    <span
                      style={{
                        fontFamily: "var(--font-pixel)",
                        fontSize: "7px",
                        color: "#ff2d78",
                        letterSpacing: "0.06em",
                        lineHeight: 1.6,
                      }}
                    >
                      {nameError}
                    </span>
                  )}

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => void handleSaveName()}
                      disabled={savingName}
                      onMouseEnter={() => menuAudio.playUIHover()}
                      style={{
                        flex: 1,
                        background: savingName ? "#3a3e2a" : "#ffd600",
                        border: "3px solid #000",
                        color: "#000",
                        fontFamily: "var(--font-pixel)",
                        fontSize: "9px",
                        letterSpacing: "0.12em",
                        padding: "10px 12px",
                        cursor: savingName ? "not-allowed" : "pointer",
                        boxShadow: "3px 3px 0 #00000066",
                      }}
                    >
                      {savingName ? "SAVING..." : "SAVE"}
                    </button>
                    <button
                      onClick={cancelEditingName}
                      disabled={savingName}
                      onMouseEnter={() => menuAudio.playUIHover()}
                      style={{
                        background: "transparent",
                        border: "3px solid #2a2e3e",
                        color: "#6b7080",
                        fontFamily: "var(--font-pixel)",
                        fontSize: "9px",
                        letterSpacing: "0.12em",
                        padding: "10px 16px",
                        cursor: savingName ? "not-allowed" : "pointer",
                      }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-pixel)",
                      fontSize: "15px",
                      color: "#fff",
                      letterSpacing: "0.04em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {username || "UNNAMED"}
                  </span>
                  <button
                    onClick={startEditingName}
                    onMouseEnter={() => menuAudio.playUIHover()}
                    style={{
                      flexShrink: 0,
                      background: "transparent",
                      border: "2px solid #ffd60055",
                      color: "#ffd600",
                      fontFamily: "var(--font-pixel)",
                      fontSize: "8px",
                      letterSpacing: "0.1em",
                      padding: "8px 14px",
                      cursor: "pointer",
                      transition: "all 0.1s",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = "#ffd600";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "#ffd60055";
                    }}
                  >
                    EDIT
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Game mode selection */}
          <div
            className="anim-fade-up"
            style={{ animationDelay: "0.18s", width: "100%" }}
          >
            <div
              style={{
                fontFamily: "var(--font-pixel)",
                fontSize: "8px",
                color: "#6b7080",
                letterSpacing: "0.16em",
                marginBottom: "10px",
                padding: "0 4px",
              }}
            >
              SELECT MODE
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {GAME_MODES.map((mode) => {
                const selected =
                  mode.available && mode.id === selectedGameMode;
                return (
                  <button
                    key={mode.id}
                    onClick={() => handleSelectMode(mode.id, mode.available)}
                    onMouseEnter={() =>
                      mode.available && menuAudio.playUIHover()
                    }
                    disabled={!mode.available}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      background: selected
                        ? `${mode.color}18`
                        : "rgba(18, 22, 32, 0.92)",
                      border: `3px solid ${
                        selected ? mode.color : "#1a1e2a"
                      }`,
                      padding: "14px 16px",
                      cursor: mode.available ? "pointer" : "not-allowed",
                      opacity: mode.available ? 1 : 0.5,
                      transition: "all 0.1s",
                      boxShadow: selected
                        ? `4px 4px 0 ${mode.color}44`
                        : "4px 4px 0 #00000033",
                    }}
                  >
                    {/* Selection marker */}
                    <div
                      style={{
                        width: "12px",
                        height: "12px",
                        flexShrink: 0,
                        border: `2px solid ${
                          mode.available ? mode.color : "#4a4e5e"
                        }`,
                        background: selected ? mode.color : "transparent",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-pixel)",
                            fontSize: "10px",
                            color: mode.available ? "#fff" : "#6b7080",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {mode.name}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-pixel)",
                            fontSize: "6px",
                            color: mode.available ? mode.color : "#6b7080",
                            letterSpacing: "0.08em",
                            border: `1px solid ${
                              mode.available ? `${mode.color}66` : "#2a2e3e"
                            }`,
                            padding: "2px 6px",
                          }}
                        >
                          {mode.tagline}
                        </span>
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-pixel)",
                          fontSize: "6px",
                          color: "#6b7080",
                          letterSpacing: "0.06em",
                          lineHeight: 1.8,
                          marginTop: "6px",
                        }}
                      >
                        {mode.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Play section */}
          <div
            className="anim-scale-in"
            style={{ animationDelay: "0.26s", width: "100%" }}
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
              {/* Selected mode label */}
              <div
                style={{
                  fontFamily: "var(--font-pixel)",
                  fontSize: "7px",
                  color: activeMode.color,
                  letterSpacing: "0.14em",
                  marginBottom: "14px",
                }}
              >
                MODE: {activeMode.name}
              </div>

              {/* Play button */}
              <button
                onClick={handleEnterGame}
                onMouseEnter={() => menuAudio.playUIHover()}
                disabled={!activeMode.available}
                style={{
                  width: "100%",
                  background: activeMode.available ? "#ff6b35" : "#3a3e4e",
                  border: "4px solid #000",
                  color: "#000",
                  fontFamily: "var(--font-pixel)",
                  fontSize: "20px",
                  letterSpacing: "0.2em",
                  padding: "20px 24px",
                  cursor: activeMode.available ? "pointer" : "not-allowed",
                  transition: "all 0.1s",
                  boxShadow: "5px 5px 0 #00000066",
                }}
                onMouseOver={(e) => {
                  if (!activeMode.available) return;
                  e.currentTarget.style.transform = "translate(-2px, -2px)";
                  e.currentTarget.style.boxShadow = "7px 7px 0 #00000066";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = "translate(0, 0)";
                  e.currentTarget.style.boxShadow = "5px 5px 0 #00000066";
                }}
                onMouseDown={(e) => {
                  if (!activeMode.available) return;
                  e.currentTarget.style.transform = "translate(3px, 3px)";
                  e.currentTarget.style.boxShadow = "1px 1px 0 #00000066";
                }}
                onMouseUp={(e) => {
                  if (!activeMode.available) return;
                  e.currentTarget.style.transform = "translate(-2px, -2px)";
                  e.currentTarget.style.boxShadow = "7px 7px 0 #00000066";
                }}
              >
                PLAY
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
                {activeMode.description.toUpperCase()}
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

                <p
                  style={{
                    fontFamily: "var(--font-pixel)",
                    fontSize: "7px",
                    color: authMode === "account" ? "#00e5ff" : "#6b7080",
                    marginBottom: "12px",
                    letterSpacing: "0.08em",
                    lineHeight: "1.8",
                  }}
                >
                  {authMode === "account"
                    ? `SIGNED IN WITH ${authProviderLabel.toUpperCase()}`
                    : "GUEST PROFILE ACTIVE"}
                </p>

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
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: "#3a3e4e",
              letterSpacing: "0.1em",
            }}
          >
            v0.1.0-ALPHA | build {CLIENT_BUILD_HASH}
          </span>
          <span style={{ color: "#2a2e3e" }}>|</span>
          <a
            href="https://discord.gg/R9HEJBqJAX"
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => menuAudio.playUIHover()}
            onClick={() => menuAudio.playUIClick()}
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: "#7c4dff",
              letterSpacing: "0.1em",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <PixelDiscordIcon color="#7c4dff" size={2} />
            DISCORD
          </a>
          <span style={{ color: "#2a2e3e" }}>|</span>
          <button
            onClick={() => {
              menuAudio.playUIClick();
              setShowPrivacy(true);
            }}
            onMouseEnter={() => menuAudio.playUIHover()}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: "#4a4e5e",
              letterSpacing: "0.1em",
            }}
          >
            PRIVACY
          </button>
        </div>
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

      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
