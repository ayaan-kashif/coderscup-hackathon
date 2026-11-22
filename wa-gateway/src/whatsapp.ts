/* eslint-disable react-hooks/rules-of-hooks -- useMultiFileAuthState is a Baileys function, not a React hook */
/**
 * The Baileys side (official package @whiskeysockets/baileys, github.com/WhiskeySockets/Baileys).
 * ./auth is a LIVE WhatsApp login: it is git-ignored and must never be shared or committed.
 */
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState, type WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { Gateway } from './server.js';

export type WhatsApp = Gateway & { start(): Promise<void> };

export function createWhatsApp(opts: { authDir?: string; pairingNumber?: string }): WhatsApp {
  const authDir = opts.authDir ?? './auth';
  let sock: WASocket | null = null;
  let connected = false;
  let retry = 0;
  // Baileys logs at error level only: debug logs can carry message content
  const logger = pino({ level: process.env.WA_LOG_LEVEL ?? 'error' });

  async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    sock = makeWASocket({ auth: state, logger, browser: Browsers.ubuntu('AMANAT gateway'), markOnlineOnConnect: false, syncFullHistory: false });
    // save credentials on every update, or the session breaks
    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered && opts.pairingNumber) {
      // pairing code instead of a QR: WhatsApp > Linked devices > Link with phone number
      const s = sock;
      setTimeout(() => {
        s.requestPairingCode(opts.pairingNumber!.replace(/\D/g, '')).then((c) => console.log(`[wa] pairing code: ${c}`)).catch(() => console.log('[wa] could not get a pairing code; use the QR instead'));
      }, 3000);
    }

    sock.ev.on('connection.update', (u) => {
      if (u.qr && !opts.pairingNumber) {
        console.log('[wa] scan this QR with the spare phone: WhatsApp > Linked devices > Link a device');
        qrcode.generate(u.qr, { small: true });
      }
      if (u.connection === 'open') {
        connected = true;
        retry = 0;
        console.log('[wa] connected');
      }
      if (u.connection === 'close') {
        connected = false;
        const status = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (status === DisconnectReason.loggedOut) {
          console.log('[wa] logged out from the phone. Delete the ./auth folder and start again to link a new session.');
          return; // the only case where we do not reconnect
        }
        const wait = Math.min(30_000, 1000 * 2 ** Math.min(retry++, 5));
        console.log(`[wa] disconnected (code ${status ?? 'unknown'}); reconnecting in ${Math.round(wait / 1000)} s`);
        setTimeout(() => { void start(); }, wait);
      }
    });
  }

  return {
    start,
    isConnected: () => connected && !!sock,
    account: () => (sock?.user?.id ?? '').split(':')[0]!.split('@')[0] || null,
    onWhatsApp: async (jid) => {
      const r = await sock!.onWhatsApp(jid);
      const first = r?.[0];
      return { exists: !!first?.exists, jid: first?.jid };
    },
    sendText: async (jid, text) => {
      const m = await sock!.sendMessage(jid, { text });
      return m?.key?.id ?? '';
    },
  };
}
