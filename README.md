# MoyLine AI

Live sports betting lines aggregator with paywalled pro picks. Black & gold sportsbook theme.

- **Home** — live odds board: opening vs current lines per book (DraftKings, FanDuel, BetMGM, Caesars), movement deltas, steam highlights, best-price callouts, biggest-movers strip, league filters.
- **Picks** — pro picks behind a Stripe paywall (test mode).
- **Record** — verified all-time track record (starts Oct 1, 2026).
- **PWA** — installable via "Add to Home Screen".

## 1. Run it locally

You need [Node.js](https://nodejs.org) 20+ installed.

```bash
cd moyline-ai
npm install
cp .env.example .env
# fill in the values below, then:
npm run dev
```

Open http://localhost:3000.

## 2. Get a free Odds API key

1. Go to **https://the-odds-api.com** and click **Get API Key**.
2. Choose the **Free** plan (500 requests/month, no credit card).
3. Copy your API key.
4. Paste it in `.env` as `ODDS_API_KEY=...`.

Quota math: each refresh pulls ~8 sports × ~2 credits ≈ 16 credits. The app caches for 30 minutes, keeps a last-good snapshot, and **stops refreshing when fewer than 50 requests remain**. Trim `ODDS_SPORTS` in `.env` to stretch the quota.

## 3. Stripe test mode (no real charges)

1. Create a free account at **https://dashboard.stripe.com** and make sure you're in **Test mode** (toggle in the top-right).
2. Go to **Products → Add product**: name it "MoyLine Pro", $29/month recurring. Copy the **Price ID** (starts with `price_`).
3. Go to **Developers → API keys**: copy the **Secret key** (starts with `sk_test_`).
4. Put them in `.env`:
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_PRICE_ID=price_...`
5. For webhooks (so subscriptions activate automatically):
   - Install the Stripe CLI, then run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
   - Copy the webhook signing secret it prints (starts with `whsec_`) into `STRIPE_WEBHOOK_SECRET=...`.

Test checkout with card `4242 4242 4242 4242`, any future expiry, any CVC.

## 4. Email sign-in

Magic-link sign-in needs an SMTP server. Easiest free option: **https://resend.com** (free tier) → create an API key → use `smtp://resend:<API_KEY>@smtp.resend.com:587` as `EMAIL_SERVER`, and set `EMAIL_FROM` to an address on a domain you verified.

Without `EMAIL_SERVER`, magic links print to the server console (local dev only).

Set `ADMIN_EMAIL` to your own email — you get full Pro access without paying.

## 5. Deploy to Vercel (step by step)

1. Push this folder to a GitHub repo (create one at github.com/new, then `git init`, `git add .`, `git commit -m "MoyLine AI"`, `git push`).
2. Go to **https://vercel.com/new**, sign in, **Import** your repo.
3. In **Environment Variables**, add every variable from `.env.example` (paste your real values — same as local).
4. Click **Deploy**. You'll get a public URL like `moyline-ai.vercel.app`.
5. The `vercel.json` cron refreshes odds at 7am, 12pm, and 6pm ET automatically. Set `CRON_SECRET` to any random string in Vercel's env vars — Vercel sends it with each cron call.
6. In Stripe Dashboard, add a **production webhook endpoint**: `https://YOUR-URL/api/webhooks/stripe`, listening to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret into Vercel's `STRIPE_WEBHOOK_SECRET`.

To go live with real payments later: flip Stripe to **Live mode**, replace the test keys/price ID with live ones, and update the webhook.

## 6. Beta testing with friends

- Send friends the Vercel URL. On iPhone: open in Safari → Share → **Add to Home Screen** for the app icon.
- Stripe stays in **test mode** during beta so nobody is really charged.
- Your `ADMIN_EMAIL` account bypasses the paywall.

## Data & privacy notes

- The track record lives in `data/track-record.json` — append graded briefs via `POST /api/track-record` (admin only, dedupes identical picks).
- `/data` JSON writes don't persist on Vercel's serverless filesystem. For durable production storage, swap `src/lib/store.ts` for Vercel KV or Postgres (function signatures are narrow on purpose).
- Never commit real keys: `.env` is git-ignored; only `.env.example` ships.

---

Analysis for entertainment purposes — not financial advice.
