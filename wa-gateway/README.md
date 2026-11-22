# AMANAT WhatsApp gateway

A small Node 20+ service that sends **one kind of message**: a sign-in code that a citizen just asked for in AMANAT AI. It uses the official
[Baileys](https://github.com/WhiskeySockets/Baileys) package (`@whiskeysockets/baileys`) to act as a linked device on a **spare demo WhatsApp number**.
It is not Meta's official WhatsApp API.

It runs on a laptop or an always-on machine. **Never on Vercel** (it needs a long-lived connection and a folder for the WhatsApp login).

## What it never does

- It sends nothing except the sign-in message below, and only to the number in the request.
- It never logs a code, a message text, a secret, a token or a full phone number (masked numbers only, like `+92*******67`).
- It listens on `127.0.0.1` only. Reach it from outside through a tunnel.

## First run

```bash
cd wa-gateway
pnpm install --ignore-workspace      # or: npm install
cp .env.example .env                 # then put a long random value in WA_GATEWAY_SECRET (24+ characters)
pnpm start
```

Make a secret with: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

### Link the spare phone (QR)

1. `pnpm start` prints a QR code in the terminal.
2. On the spare phone: **WhatsApp → Settings → Linked devices → Link a device**, then scan the QR.
3. The terminal prints `[wa] connected`. The login is saved in `./auth/`.

No camera? Put the number in `.env` as `WA_PAIRING_NUMBER=923001234567` (digits, with country code) and start again. The terminal prints a pairing code to
type into **Link with phone number instead**.

> `./auth/` **is a live WhatsApp login.** It is git-ignored. Never commit it, zip it, share it or copy it into a chat.

## API (every request needs `Authorization: Bearer <WA_GATEWAY_SECRET>`; otherwise 401)

| Request | Answer |
| --- | --- |
| `GET /health` | `{ "connected": true, "account": "+92*******67" }` (masked) |
| `POST /send-otp` `{ "to": "+923001234567", "code": "123456", "lang": "ur" }` | `200 { "messageId" }`, `503` not connected, `404 NOT_ON_WHATSAPP`, `429 { "retryAfterSec" }`, `400` bad input |

The message (Urdu first, then English; English first when `lang` is `en`):

```
{code} آپ کا AMANAT تصدیقی کوڈ ہے۔ یہ کوڈ کسی کو نہ بتائیں۔
{code} is your AMANAT (prototype) sign-in code. Don't share it. If you didn't ask for it, ignore this message.
```

Throttle: at most **1 message per number per 60 seconds** and **10 per minute overall** (`429` with `retryAfterSec`).

## The tunnel

Vercel has to reach the gateway at a fixed address. With ngrok (a free account includes one static domain):

```bash
ngrok http --url=your-name.ngrok-free.app 8787
```

Use `https://your-name.ngrok-free.app` as `WA_GATEWAY_URL` in Vercel. See [../docs/whatsapp-baileys.md](../docs/whatsapp-baileys.md) for the whole setup.

## Restarting and staying linked

- Stop with Ctrl+C and start again with `pnpm start`: it reconnects from `./auth/` without a new QR.
- After any disconnect the service reconnects by itself (waiting 1 s, 2 s, 4 s … up to 30 s). The only case it does **not** reconnect is when you remove the device from the phone (logged out).
  Then delete `./auth/` and start again to scan a new QR.
- If the laptop sleeps, WhatsApp disconnects. Keep it awake during the event.

## Testing without WhatsApp

`WA_GATEWAY_SECRET=<24+ chars> PORT=8788 pnpm fake` starts the same HTTP handler on top of a pretend socket. It sends nothing anywhere.
Numbers ending in `0000` pretend not to be on WhatsApp. Used by the `WA_E2E=1` browser test.
