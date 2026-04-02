import { useState, useEffect, useRef, useCallback } from "react";
import { useGameStore } from "../store";
import { menuAudio } from "../menuAudio";
import { CHARACTER_PRESETS, colorHex } from "../characterPresets";
import { PixelArtBg } from "./PixelArtBg";
import {
  getActiveProvider,
  getAuthMode,
  getProviderLabel,
  useGuestProfile,
  type AuthProvider,
} from "../auth";
import { resetConnection } from "../db";

// 5x7 pixel soldier template
// H=head, V=visor, B=body, W=vest, G=gun, L=leg(darker body)
const SOLDIER_TEMPLATE = [
  ".HHH.",
  "HHVHH",
  ".BBB.",
  "BWWWB",
  "BWWWG",
  ".BBB.",
  ".B.B.",
];

function PixelSoldier({
  headColor,
  visorColor,
  bodyColor,
  vestColor,
  gunColor,
  size = 6,
  selected,
}: {
  headColor: string;
  visorColor: string;
  bodyColor: string;
  vestColor: string;
  gunColor: string;
  size?: number;
  selected?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const w = 5,
      h = 7;
    canvas.width = w * size;
    canvas.height = h * size;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const colorMap: Record<string, string> = {
      H: headColor,
      V: visorColor,
      B: bodyColor,
      W: vestColor,
      G: gunColor,
    };

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const ch = SOLDIER_TEMPLATE[row][col];
        if (ch === ".") continue;
        ctx.fillStyle = colorMap[ch] || bodyColor;
        ctx.fillRect(col * size, row * size, size - 0.5, size - 0.5);
      }
    }
  }, [headColor, visorColor, bodyColor, vestColor, gunColor, size, selected]);

  return <canvas ref={canvasRef} style={{ imageRendering: "pixelated" }} />;
}

// Decorative pixel blocks flanking the title
function TitleDecor({ side }: { side: "left" | "right" }) {
  const colors =
    side === "left"
      ? ["#ff6b35", "#ff9f1c", "#ffbf69", "#00e5ff", "#76ff03"]
      : ["#7c4dff", "#ff2d78", "#ffd600", "#00e676", "#ff3d00"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        opacity: 0.7,
        transform: side === "right" ? "scaleX(-1)" : undefined,
      }}
    >
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} style={{ display: "flex", gap: "3px" }}>
          {[0, 1, 2].map((col) => {
            const show = (row + col) % 2 === 0 || (row === 2 && col < 2);
            return (
              <div
                key={col}
                style={{
                  width: "6px",
                  height: "6px",
                  background: show
                    ? colors[(row + col) % colors.length]
                    : "transparent",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ProviderIcon({
  provider,
  color,
}: {
  provider: AuthProvider;
  color: string;
}) {
  if (provider === "discord") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 8.5C8.7 7.2 10.2 6.8 12 6.8c1.8 0 3.3.4 5 1.7l1.4 6.1c-1.2 1-2.3 1.7-3.8 2.2l-.8-1.1c.8-.3 1.5-.7 2.1-1.1-.6.3-1.3.6-1.9.8-.8.2-1.4.3-2 .3s-1.2-.1-2-.3c-.6-.2-1.3-.5-1.9-.8.6.4 1.3.8 2.1 1.1l-.8 1.1c-1.5-.5-2.6-1.2-3.8-2.2L7 8.5Z"
          fill={color}
        />
        <circle cx="9.5" cy="12.1" r="1.1" fill="#0a0c14" />
        <circle cx="14.5" cy="12.1" r="1.1" fill="#0a0c14" />
      </svg>
    );
  }

  if (provider === "google") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M20 12.3c0-.6-.1-1.1-.2-1.6H12v3h4.5c-.2 1-.8 1.9-1.7 2.5v2h2.8c1.7-1.5 2.4-3.7 2.4-5.9Z"
          fill="#4285F4"
        />
        <path
          d="M12 20.3c2.2 0 4-.7 5.4-2l-2.8-2c-.8.5-1.7.9-2.6.9-2 0-3.7-1.3-4.3-3.1H4.8v2.1c1.4 2.7 4.1 4.1 7.2 4.1Z"
          fill="#34A853"
        />
        <path
          d="M7.7 14.1c-.2-.5-.3-1-.3-1.6s.1-1.1.3-1.6V8.8H4.8C4.3 9.8 4 11 4 12.5s.3 2.7.8 3.7l2.9-2.1Z"
          fill="#FBBC05"
        />
        <path
          d="M12 7.8c1.2 0 2.3.4 3.1 1.2l2.3-2.3C16 5.3 14.2 4.5 12 4.5c-3.1 0-5.8 1.7-7.2 4.3l2.9 2.1c.6-1.8 2.3-3.1 4.3-3.1Z"
          fill="#EA4335"
        />
      </svg>
    );
  }

  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke={color}
        strokeWidth="2"
      />
      <circle cx="15.7" cy="8.4" r="2.1" fill={color} />
      <path
        d="M12.2 11.5 15 9.8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="9.1" cy="14.8" r="2.2" fill={color} />
    </svg>
  );
}

export function LoginScreen() {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const {
    connection,
    setUsername,
    setScreen,
    setError,
    resetSession,
    selectedCharacterPreset,
    setSelectedCharacterPreset,
  } = useGameStore();
  const error = useGameStore((s) => s.error);
  const settings = useGameStore((s) => s.settings);
  const inputRef = useRef<HTMLInputElement>(null);
  const authMode = getAuthMode();
  const activeProvider = getActiveProvider();

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
    menuAudio.startMenuAmbience();
    setMounted(true);
    return () => {
      menuAudio.stopMenuAmbience();
    };
  }, []);

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = input.trim();
      if (!name || name.length > 20 || !connection || submitting) {
        if (!name) menuAudio.playUIError();
        return;
      }
      setSubmitting(true);
      setError(null);
      menuAudio.playUIDeploy();
      try {
        await connection.reducers.setUsername({
          username: name,
          characterPreset: selectedCharacterPreset,
        });
        setUsername(name);
        setScreen("lobby");
      } catch (error) {
        menuAudio.playUIError();
        setError(
          error instanceof Error ? error.message : "Failed to set username",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      input,
      connection,
      submitting,
      selectedCharacterPreset,
      setUsername,
      setScreen,
      setError,
    ],
  );

  const handleUseGuest = useCallback(() => {
    menuAudio.playUIClick();
    useGuestProfile();
    resetConnection();
    resetSession(null);
    setError(null);
  }, [resetSession, setError]);

  const pixelBorder = "3px solid";
  const accentColor = "#ff6b35";
  const accentCyan = "#00e5ff";

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
      <PixelArtBg />

      {/* Main content */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s ease",
          maxWidth: "600px",
          width: "100%",
          padding: "0 20px",
        }}
      >
        {/* Title section */}
        <div
          className="anim-fade-up"
          style={{
            animationDelay: "0.1s",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <TitleDecor side="left" />
          <h1
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "clamp(38px, 7vw, 72px)",
              color: "#fff",
              letterSpacing: "0.12em",
              textAlign: "center",
              textShadow: "4px 4px 0 #ff6b35, -2px -2px 0 #00e5ff",
            }}
          >
            BITWARS
          </h1>
          <TitleDecor side="right" />
        </div>

        {/* Subtitle */}
        <div className="anim-fade-up" style={{ animationDelay: "0.18s" }}>
          <p
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "clamp(8px, 1.4vw, 11px)",
              color: "#6b7080",
              letterSpacing: "0.35em",
              marginTop: "12px",
              textAlign: "center",
            }}
          >
            BLOCK &nbsp;&bull;&nbsp; SHOOT &nbsp;&bull;&nbsp; DESTROY
          </p>
        </div>

        {/* Pixel divider */}
        <div
          className="anim-fade-in"
          style={{
            animationDelay: "0.28s",
            display: "flex",
            gap: "4px",
            margin: "28px 0 24px",
            justifyContent: "center",
          }}
        >
          {[
            "#ff6b35",
            "#ff9f1c",
            "#ffd600",
            "#76ff03",
            "#00e5ff",
            "#7c4dff",
            "#ff2d78",
          ].map((c, i) => (
            <div
              key={i}
              style={{
                width: "18px",
                height: "4px",
                background: c,
                opacity: 0.6,
              }}
            />
          ))}
        </div>

        {/* Login form */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            gap: "24px",
          }}
        >
          {/* Name input */}
          <div
            className="anim-fade-up"
            style={{
              animationDelay: "0.32s",
              maxWidth: "380px",
              width: "100%",
            }}
          >
            <label
              style={{
                fontFamily: "var(--font-pixel)",
                fontSize: "10px",
                color: accentCyan,
                letterSpacing: "0.15em",
                display: "block",
                marginBottom: "10px",
              }}
            >
              CALL SIGN
            </label>
            <div style={{ position: "relative" }}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  menuAudio.playUIType();
                }}
                onFocus={() => {
                  setFocused(true);
                  menuAudio.playUIClick();
                }}
                onBlur={() => setFocused(false)}
                placeholder="ENTER NAME..."
                maxLength={20}
                autoFocus
                style={{
                  width: "100%",
                  background: "#12161e",
                  border: `${pixelBorder} ${focused ? accentColor : "#2a2e3e"}`,
                  color: "#e8e8f0",
                  fontFamily: "var(--font-pixel)",
                  fontWeight: 400,
                  padding: "14px 16px",
                  fontSize: "14px",
                  letterSpacing: "0.06em",
                  outline: "none",
                  transition: "border-color 0.15s",
                  boxShadow: focused
                    ? `4px 4px 0 ${accentColor}44`
                    : "4px 4px 0 #0005",
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
                {input.length}/20
              </span>
            </div>
          </div>

          {/* Character presets */}
          <div
            className="anim-fade-up"
            style={{ animationDelay: "0.4s", width: "100%" }}
          >
            <label
              style={{
                fontFamily: "var(--font-pixel)",
                fontSize: "10px",
                color: accentCyan,
                letterSpacing: "0.15em",
                display: "block",
                marginBottom: "12px",
                textAlign: "center",
              }}
            >
              CHOOSE YOUR SOLDIER
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "10px",
              }}
            >
              {CHARACTER_PRESETS.map((preset) => {
                const sel = preset.id === selectedCharacterPreset;
                const borderColor = sel
                  ? colorHex(preset.visorColor)
                  : "#2a2e3e";
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      menuAudio.playUIClick();
                      setSelectedCharacterPreset(preset.id);
                    }}
                    onMouseEnter={() => menuAudio.playUIHover()}
                    style={{
                      border: `3px solid ${borderColor}`,
                      background: sel
                        ? `${colorHex(preset.visorColor)}15`
                        : "#12161e",
                      color: sel ? "#fff" : "#a0a4b0",
                      minWidth: "100px",
                      padding: "14px 12px 10px",
                      cursor: "pointer",
                      transition: "all 0.1s",
                      boxShadow: sel
                        ? `4px 4px 0 ${colorHex(preset.visorColor)}44`
                        : "3px 3px 0 #0005",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <PixelSoldier
                      headColor={colorHex(preset.headColor)}
                      visorColor={colorHex(preset.visorColor)}
                      bodyColor={colorHex(preset.bodyColor)}
                      vestColor={colorHex(preset.vestColor)}
                      gunColor={colorHex(preset.gunColor)}
                      size={sel ? 7 : 6}
                      selected={sel}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-pixel)",
                        fontSize: "8px",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {preset.name.toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Play button */}
          <div
            className="anim-fade-up"
            style={{
              animationDelay: "0.48s",
              width: "100%",
              maxWidth: "380px",
            }}
          >
            <button
              type="submit"
              disabled={submitting}
              onMouseEnter={() => menuAudio.playUIHover()}
              style={{
                width: "100%",
                background: submitting ? "#cc5528" : accentColor,
                border: "4px solid #000",
                color: "#000",
                fontFamily: "var(--font-pixel)",
                fontWeight: 400,
                fontSize: "18px",
                letterSpacing: "0.2em",
                padding: "18px 32px",
                cursor: submitting ? "not-allowed" : "pointer",
                transition: "all 0.1s",
                boxShadow: "6px 6px 0 #00000066",
                position: "relative",
              }}
              onMouseOver={(e) => {
                if (!submitting) {
                  e.currentTarget.style.transform = "translate(-2px, -2px)";
                  e.currentTarget.style.boxShadow = "8px 8px 0 #00000066";
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = "translate(0, 0)";
                e.currentTarget.style.boxShadow = "6px 6px 0 #00000066";
              }}
              onMouseDown={(e) => {
                if (!submitting) {
                  e.currentTarget.style.transform = "translate(3px, 3px)";
                  e.currentTarget.style.boxShadow = "2px 2px 0 #00000066";
                }
              }}
              onMouseUp={(e) => {
                if (!submitting) {
                  e.currentTarget.style.transform = "translate(-2px, -2px)";
                  e.currentTarget.style.boxShadow = "8px 8px 0 #00000066";
                }
              }}
            >
              {submitting
                ? "CONNECTING..."
                : authMode === "account"
                  ? "PLAY"
                  : "PLAY AS GUEST"}
            </button>
          </div>

          <div
            className="anim-fade-up"
            style={{
              animationDelay: "0.54s",
              width: "100%",
              maxWidth: "420px",
              background: "rgba(12, 18, 28, 0.88)",
              border: "3px solid #1d2636",
              padding: "18px 18px 16px",
              boxShadow: "5px 5px 0 #00000044",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                marginBottom: "12px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-pixel)",
                  fontSize: "8px",
                  color: "#00e5ff",
                  letterSpacing: "0.14em",
                }}
              >
                ACCOUNT
              </span>
              <span
                style={{
                  fontFamily: "var(--font-pixel)",
                  fontSize: "7px",
                  color: authMode === "account" ? "#76ff03" : "#6b7080",
                  letterSpacing: "0.08em",
                }}
              >
                {authMode === "account"
                  ? getProviderLabel(activeProvider).toUpperCase()
                  : "GUEST"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "8px",
              }}
            >
              {(
                [
                  { provider: "discord", color: "#5865f2" },
                  { provider: "google", color: "#34a853" },
                  { provider: "steam", color: "#66c0f4" },
                ] as const
              ).map(({ provider, color }) => (
                <button
                  key={provider}
                  type="button"
                  disabled
                  onMouseEnter={() => menuAudio.playUIHover()}
                  style={{
                    border: `2px solid ${color}`,
                    background: "#151922",
                    color,
                    fontFamily: "var(--font-pixel)",
                    fontSize: "7px",
                    letterSpacing: "0.08em",
                    padding: "10px 8px 9px",
                    cursor: "not-allowed",
                    minHeight: "64px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    opacity: 0.5,
                  }}
                >
                  <ProviderIcon provider={provider} color={color} />
                  <div>{getProviderLabel(provider).toUpperCase()}</div>
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      background: "#4a4e5e",
                    }}
                  />
                </button>
              ))}
            </div>

            {authMode === "account" && (
              <button
                type="button"
                onClick={handleUseGuest}
                onMouseEnter={() => menuAudio.playUIHover()}
                style={{
                  width: "100%",
                  marginTop: "12px",
                  border: "2px solid #2a2e3e",
                  background: "transparent",
                  color: "#ffd600",
                  fontFamily: "var(--font-pixel)",
                  fontSize: "8px",
                  letterSpacing: "0.08em",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                USE GUEST
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              className="anim-fade-up"
              style={{
                fontFamily: "var(--font-pixel)",
                fontSize: "9px",
                color: "#ff2d78",
                padding: "10px 16px",
                background: "#ff2d7812",
                border: "2px solid #ff2d78",
                textAlign: "center",
                width: "100%",
                maxWidth: "380px",
                lineHeight: 1.6,
              }}
            >
              {error}
            </div>
          )}
        </form>

        {/* Feature tags */}
        <div
          className="anim-fade-in"
          style={{
            animationDelay: "0.6s",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "8px",
            marginTop: "28px",
          }}
        >
          {[
            { text: "DESTROY EVERYTHING", color: "#ff3d00" },
            { text: "5 WEAPONS", color: "#ffd600" },
            { text: "REAL-TIME PVP", color: "#00e5ff" },
          ].map((tag, i) => (
            <div
              key={tag.text}
              className="anim-fade-up"
              style={{
                animationDelay: `${0.6 + i * 0.06}s`,
                fontFamily: "var(--font-pixel)",
                fontSize: "7px",
                color: tag.color,
                letterSpacing: "0.1em",
                padding: "6px 14px",
                border: `2px solid ${tag.color}55`,
                background: `${tag.color}08`,
              }}
            >
              {tag.text}
            </div>
          ))}
        </div>

        {/* Version */}
        <div
          className="anim-fade-in"
          style={{ animationDelay: "0.8s", marginTop: "20px" }}
        >
          <p
            style={{
              fontFamily: "var(--font-pixel)",
              fontSize: "7px",
              color: "#3a3e4e",
              letterSpacing: "0.1em",
            }}
          >
            v0.1.0 ALPHA
          </p>
        </div>
      </div>
    </div>
  );
}
