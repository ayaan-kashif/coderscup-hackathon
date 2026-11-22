# WhatsApp sign-in codes with Baileys

**What this is.** A citizen who signs in with her own Pakistani mobile number gets her 6-digit code as a real WhatsApp message. The message is sent by
a small gateway (`wa-gateway/`) that uses the official [Baileys](https://github.com/WhiskeySockets/Baileys) package from a **spare demo number**. It is not Meta's official WhatsApp API.

**What stays fictional.** Everything she enters after signing in (name, date of birth, district, answers, documents) is made up, and the app tells her so.
Fictional `+92 00000…` numbers never leave the app: their code goes to the on-screen mock phone (`/mock/phone`), which is also the fallback when the gateway is down.

```
citizen phone ── WhatsApp code ──▶ wa-gateway (laptop) ◀── tunnel ── Vercel (OTP_PROVIDER=baileys)
                                         │
                                  spare demo WhatsApp number
```

## 1. Start the gateway

```bash
cd wa-gateway
pnpm install --ignore-workspace
cp .env.example .env                 # set WA_GATEWAY_SECRET to 24+ random characters
pnpm start
```

Generate the secret with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. Keep it private.

## 2. Link the spare phone

The terminal shows a QR code. On the spare phone: **WhatsApp → Linked devices → Link a device**, then scan it. When you see `[wa] connected`, the gateway is linked.
`wa-gateway/auth/` now holds a **live WhatsApp login**: it is git-ignored, never commit or share it.

## 3. Start the tunnel with a fixed address

Vercel must reach the gateway at the same address every time. Example with ngrok (free static domain):

```bash
ngrok http --url=your-name.ngrok-free.app 8787
```

(Cloudflare Tunnel with a named tunnel also gives a fixed hostname.) A tunnel with a random address that changes on every start will break sign-in.

## 4. Tell the app where the gateway is

In **Vercel → Project → Settings → Environment Variables** add (Production, server-only, never a `NEXT_PUBLIC_` name):

| Variable | Value |
| --- | --- |
| `OTP_PROVIDER` | `baileys` |
| `WA_GATEWAY_URL` | `https://your-name.ngrok-free.app` |
| `WA_GATEWAY_SECRET` | the same secret as in `wa-gateway/.env` |

Then **redeploy**. For local use put the same three lines in `.env.local`.
With `OTP_PROVIDER=baileys` the URL and a 24+ character secret are required, or the app refuses to start the sign-in.

## 5. Test it

```bash
pnpm wa:test-otp +923001234567
```

It sends one throwaway code to that number through the gateway and prints `OK` (or the reason) with the number masked. The code is never printed: read it on the phone.
Then open the app, choose **Use my WhatsApp number**, and sign in with a real number that has WhatsApp.
`/status` shows **WhatsApp gateway: connected / disconnected** (no number).

## If the gateway disconnects

- The citizen sees **"WhatsApp is not available right now"** with **"Use the demo phone instead"**, which switches to the `+92 00000` mock flow. Nobody is blocked.
- Check `/status` and the gateway terminal. The gateway reconnects by itself after any drop.
- Laptop asleep or offline: wake it and wait about 30 seconds.
- Tunnel down: start it again with the **same** address.
- "Logged out" in the terminal means the device was removed on the phone: delete `wa-gateway/auth/`, run `pnpm start`, scan a new QR.
- The gateway allows 1 message per number per 60 seconds and 10 per minute overall. A citizen who asks twice quickly sees "A code was just sent. Wait N seconds".

## After the event

```bash
pnpm users:purge-whatsapp          # counts the accounts made with a real number
pnpm users:purge-whatsapp --yes    # deletes them and all their data
```

Then remove the device on the spare phone (**Linked devices**), delete `wa-gateway/auth/`, and remove the three variables in Vercel.

## What the code guarantees (and the tests check)

- The gateway sends only a sign-in code a user just requested, and logs no code, secret, token or full number.
- A real number is stored only encrypted (AES-GCM) plus its HMAC; the plain-text column is for fictional numbers only. Rate-limit keys use the hash.
- A first successful code creates the citizen account in the same transaction, and two parallel verifies make one account.
- The citizen's PIN, the reversed-PIN duress rule, consent and audit are unchanged. Each citizen sees only her own data.
- "Delete my account and data" (My data, with her PIN) removes her cases, documents, consents, profile and login. The audit log keeps ids and hashes only.
