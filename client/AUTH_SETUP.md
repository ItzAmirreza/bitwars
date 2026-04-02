# Auth Setup

BitWars now supports two session modes:

- `guest`: uses a local SpacetimeDB token and keeps a browser-local guest profile
- `account`: uses a token returned by an external auth flow for `discord`, `google`, or `steam`

## Environment variables

Set these in your local/client deployment environment:

```bash
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_MODULE_NAME=bitwars
VITE_AUTH_CALLBACK_PATH=/
VITE_DISCORD_AUTH_URL=
VITE_GOOGLE_AUTH_URL=
VITE_STEAM_AUTH_URL=
```

## Provider URL contract

Each provider URL should start the login flow and then redirect back to the SPA with:

```text
?provider=discord|google|steam&token=<oidc-or-spacetimedb-token>
```

The client also accepts `auth_token`, `id_token`, or `spacetime_token` instead of `token`.

Supported URL placeholders:

- `{redirect_uri}` or `{callback_url}`
- `{provider}`
- `{return_to}`

Example:

```text
https://auth.example.com/login/steam?redirect_uri={redirect_uri}&return_to={return_to}
```

## Notes

- Guest mode remains available even when account sign-in is configured.
- Guest and account tokens are stored separately, so switching back to guest restores the prior guest profile in the same browser.
- Steam still requires an external auth bridge or provider that can return a token SpacetimeDB accepts.
