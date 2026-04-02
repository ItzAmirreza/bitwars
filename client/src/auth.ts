export type AuthProvider = "discord" | "google" | "steam";
export type AuthMode = "guest" | "account";

interface AccountSession {
  provider: AuthProvider;
  token: string;
  authenticatedAt: number;
}

const LEGACY_TOKEN_KEY = "bitwars_token";
const GUEST_TOKEN_KEY = "bitwars_guest_token";
const ACCOUNT_SESSION_KEY = "bitwars_account_session";
const PENDING_PROVIDER_KEY = "bitwars_pending_auth_provider";

const CALLBACK_TOKEN_KEYS = [
  "token",
  "auth_token",
  "id_token",
  "spacetime_token",
];
const CALLBACK_ERROR_KEYS = ["error_description", "error"];
const AUTH_CALLBACK_PATH = import.meta.env.VITE_AUTH_CALLBACK_PATH || "/";

const PROVIDER_URLS: Record<AuthProvider, string | undefined> = {
  discord: import.meta.env.VITE_DISCORD_AUTH_URL,
  google: import.meta.env.VITE_GOOGLE_AUTH_URL,
  steam: import.meta.env.VITE_STEAM_AUTH_URL,
};

function migrateLegacyGuestToken(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacy) return;
    if (!localStorage.getItem(GUEST_TOKEN_KEY)) {
      localStorage.setItem(GUEST_TOKEN_KEY, legacy);
    }
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // ignore storage migration failures
  }
}

function readAccountSession(): AccountSession | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountSession>;
    if (
      !parsed ||
      typeof parsed.token !== "string" ||
      !isAuthProvider(parsed.provider)
    ) {
      return null;
    }
    return {
      provider: parsed.provider,
      token: parsed.token,
      authenticatedAt:
        typeof parsed.authenticatedAt === "number"
          ? parsed.authenticatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeAccountSession(session: AccountSession): void {
  localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
}

function readPendingProvider(): AuthProvider | null {
  try {
    const raw = localStorage.getItem(PENDING_PROVIDER_KEY);
    return isAuthProvider(raw) ? raw : null;
  } catch {
    return null;
  }
}

function clearPendingProvider(): void {
  try {
    localStorage.removeItem(PENDING_PROVIDER_KEY);
  } catch {
    // ignore
  }
}

function parseCallbackParams(): URLSearchParams {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    for (const [key, value] of hashParams.entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }
  return params;
}

function clearCallbackUrl(): void {
  const url = new URL(window.location.href);
  window.history.replaceState({}, document.title, url.pathname || "/");
}

function findFirst(params: URLSearchParams, keys: string[]): string | null {
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return null;
}

function isAuthProvider(value: unknown): value is AuthProvider {
  return value === "discord" || value === "google" || value === "steam";
}

function getCallbackUrl(): string {
  return new URL(AUTH_CALLBACK_PATH, window.location.origin).toString();
}

export function getProviderLabel(provider: AuthProvider | null): string {
  switch (provider) {
    case "discord":
      return "Discord";
    case "google":
      return "Google";
    case "steam":
      return "Steam";
    default:
      return "Guest";
  }
}

export function getAuthMode(): AuthMode {
  migrateLegacyGuestToken();
  return readAccountSession() ? "account" : "guest";
}

export function getActiveProvider(): AuthProvider | null {
  migrateLegacyGuestToken();
  return readAccountSession()?.provider ?? null;
}

export function getConnectionToken(): string | undefined {
  migrateLegacyGuestToken();
  const account = readAccountSession();
  if (account?.token) return account.token;
  const guest = localStorage.getItem(GUEST_TOKEN_KEY);
  return guest || undefined;
}

export function saveConnectionToken(token: string): void {
  migrateLegacyGuestToken();
  const account = readAccountSession();
  if (account) {
    writeAccountSession({
      ...account,
      token,
    });
    return;
  }
  localStorage.setItem(GUEST_TOKEN_KEY, token);
}

export function hasConfiguredProvider(provider: AuthProvider): boolean {
  return Boolean(PROVIDER_URLS[provider]);
}

export function getProviderAuthUrl(provider: AuthProvider): string | null {
  const raw = PROVIDER_URLS[provider];
  if (!raw) return null;

  const callbackUrl = getCallbackUrl();
  const replaced = raw
    .replaceAll("{redirect_uri}", encodeURIComponent(callbackUrl))
    .replaceAll("{callback_url}", encodeURIComponent(callbackUrl))
    .replaceAll("{provider}", encodeURIComponent(provider))
    .replaceAll("{return_to}", encodeURIComponent(window.location.origin));

  if (replaced !== raw) {
    return replaced;
  }

  try {
    const url = new URL(raw);
    if (!url.searchParams.has("redirect_uri")) {
      url.searchParams.set("redirect_uri", callbackUrl);
    }
    if (!url.searchParams.has("provider")) {
      url.searchParams.set("provider", provider);
    }
    if (!url.searchParams.has("return_to")) {
      url.searchParams.set("return_to", window.location.origin);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function beginProviderSignIn(provider: AuthProvider): string | null {
  const url = getProviderAuthUrl(provider);
  if (!url) return null;
  localStorage.setItem(PENDING_PROVIDER_KEY, provider);
  window.location.assign(url);
  return url;
}

export function useGuestProfile(): void {
  clearPendingProvider();
  localStorage.removeItem(ACCOUNT_SESSION_KEY);
}

export function consumeAuthCallback(): {
  consumed: boolean;
  error: string | null;
} {
  migrateLegacyGuestToken();
  const params = parseCallbackParams();
  const token = findFirst(params, CALLBACK_TOKEN_KEYS);
  const error = findFirst(params, CALLBACK_ERROR_KEYS);
  const providerParam = params.get("provider");
  const provider =
    (isAuthProvider(providerParam) ? providerParam : null) ??
    readPendingProvider();

  const handled =
    token !== null ||
    error !== null ||
    params.has("provider") ||
    params.has("token") ||
    params.has("auth_token") ||
    params.has("id_token") ||
    params.has("spacetime_token");
  if (!handled) {
    return { consumed: false, error: null };
  }

  clearPendingProvider();
  clearCallbackUrl();

  if (error) {
    return { consumed: true, error };
  }
  if (!token) {
    return {
      consumed: true,
      error: "Authentication completed without a usable token.",
    };
  }
  if (!provider) {
    return {
      consumed: true,
      error: "Authentication completed without a recognized provider.",
    };
  }

  writeAccountSession({
    provider,
    token,
    authenticatedAt: Date.now(),
  });
  return { consumed: true, error: null };
}
