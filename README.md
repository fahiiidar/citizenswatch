# CitizensWatch

An anonymous, live safety map for Nigeria. Anyone can open the link, see reports on a map, and post what they see with photos or a short clip. Other people confirm, dispute or flag reports, and moderators review them.

The full click-by-click launch guide is in the "CitizensWatch launch guide" doc. The short version:

1. Upload the contents of this folder to a GitHub repository.
2. Create a Supabase project (region: West EU, London) and run `supabase/schema.sql` in its SQL Editor.
3. Create a Cloudflare Turnstile widget.
4. Import the repository into Vercel (Framework Preset: Other) and set these environment variables:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_…`) or legacy `service_role` key |
| `TURNSTILE_SITE_KEY` | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Turnstile secret key |
| `HASH_SECRET` | Long random string; never change it after launch |
| `MODERATOR_KEYS` | `name:key,name2:key2` (keys at least 16 characters) |
| `CRON_SECRET` | Optional; protects the daily cleanup job |
| `GEOCODER_URL` | Optional; a Photon-compatible place search server |
| `MAP_STYLE_URL` | Optional; a MapLibre style URL |

Moderators sign in at `/#/moderate`.

## How it is built

- **No build step and no npm packages.** `public/` is the website (plain JavaScript modules); `api/` holds Vercel serverless functions that talk to Supabase over its HTTP APIs.
- **Map:** MapLibre GL from unpkg with OpenFreeMap tiles. If the map cannot load, the app falls back to a list.
- **Place search:** Photon (OpenStreetMap data), proxied through `/api/geocode` so the provider never sees users' IP addresses.
- **Privacy:** exact locations are rounded on the phone to a ~1 km grid and rounded again on the server. Photos and clips are re-encoded on the phone to strip GPS and device metadata; clip sound is removed unless the poster keeps it. Device IDs and IP addresses are only stored as salted hashes. Media sits in a private bucket and is served through short-lived signed links.
- **Abuse limits:** Turnstile on every new report; 3 reports an hour per phone and 12 per network; one confirmation, "false" vote and flag per phone per report; reports auto-hide after 5 flags until a moderator reviews them; moderators can block a phone.

## Local testing

```
node dev-server.mjs --mock      # in-memory fake database, no accounts needed
node --test tests/*.test.mjs    # rule tests
node tests/api.e2e.mjs          # end-to-end API checks (with the mock server running)
```

Open http://localhost:3000. The mock moderator key is `local-moderator-key-123`.
