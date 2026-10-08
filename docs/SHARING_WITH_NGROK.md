# Sharing a test build with your team

**For testing only.** See the warnings at the bottom before sending a link to anyone.

---

## Short answer: no, tunnelling only the frontend does not work

Not on its own. The browser app calls the API, and if it calls `http://localhost:5000`
then a teammate's browser resolves `localhost` to **their** machine, where nothing is
listening. Every request fails and the app shows an empty sign-in screen.

It *does* work once the frontend proxies the API, which is now configured. The dev server
forwards `/api` to the backend, so the page and its data share one origin and travel down
one tunnel. As a side effect there is no cross-origin request left for CORS to reject.

```
teammate ──https──▶ ngrok ──▶ :3000 Vite ──┬──▶ the React app
                                            └──▶ /api  ──▶ :5000 ASP.NET ──▶ PostgreSQL
```

---

## Running it

Three terminals.

```bash
# 1. backend
cd Backend
dotnet run

# 2. frontend in share mode
cd Frontend
npm run share

# 3. the tunnel
ngrok http 3000
```

ngrok prints a line like `Forwarding  https://wrongly-doable-props.ngrok-free.dev -> http://localhost:3000`.
That URL is what you send. It changes every time ngrok restarts unless you have a
reserved domain.

`npm run share` sets `SHARE=1`, which differs from `npm run dev` in two ways:

- **Any tunnel host is allowed.** Vite blocks requests for hostnames it does not know
  (a DNS-rebinding protection). Without this a teammate sees `Blocked request`.
- **Hot reload is off.** The HMR websocket cannot reach a random https tunnel without more
  configuration, and a failing socket floods the console with errors that look like real
  faults. Sharing is for looking at the app; your own `npm run dev` still has HMR.

---

## What your team needs to do

1. Open the link. ngrok's free tier shows a one-time "You are about to visit" page —
   click through it.
2. **Create an account.** Registration is open, and the first account on a fresh database
   becomes the system administrator, so that one is already taken. Everyone else signs up
   as an ordinary user.
3. A new account sees **no projects**. You have to add them: open the project, then add
   their email as `Viewer` (read-only) or `Contributor` (can import and upload models).

---

## Notes

**The interstitial.** Every API call sends `ngrok-skip-browser-warning: true`. Without it
ngrok answers with an HTML interstitial instead of JSON, and every request fails with a
parse error that looks nothing like the real cause.

**One tunnel, not two.** Tunnelling the backend separately and pointing
`VITE_API_BASE` at it also works, but it means two URLs, a second CORS entry, and a
rebuild whenever ngrok restarts. The proxy avoids all of it.

**A backend elsewhere.** `API_TARGET=http://some-host:5000 npm run share` points the proxy
somewhere other than localhost.

**Serving the production build instead of the dev server:**

```bash
cd Frontend && npm run build && SHARE=1 npm run preview
```

`preview` carries the same proxy and host allowance. Slower to change, faster to load.

---

## Before you send the link

This exposes the app on the public internet. It is fine for a short test session with
colleagues; it is not a deployment.

| | |
|---|---|
| **Registration is open** | Anyone with the URL can create an account. They see nothing until you add them to a project, but they *are* in your `Users` table. |
| **The signing key is committed** | `appsettings.Development.json` holds a known key. Anyone who reads this repo can mint a valid token. Set `JWT__SIGNINGKEY` to something private if the link goes anywhere you do not control. |
| **The database password is in plaintext** | `appsettings.json` carries the Postgres credentials. |
| **It is your machine** | The tunnel points at your laptop and your local database. Closing the terminal ends the session. |

Stop sharing by closing the ngrok terminal — the URL dies immediately.

If you want something that survives your laptop closing, that is a real deployment: the
backend on a host, the database managed, `JWT__SIGNINGKEY` and the connection string as
environment variables, and the frontend built and served as static files.
