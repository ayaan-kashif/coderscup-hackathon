'use client';
import { Smartphone, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SimulatedBadge } from '@/components/shell/simulated-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { playSequence } from '@/components/voice/voice-prompt';

type Msg = { id: string; fromSender: string; body: string; kind: string; createdAt: string };

/** AUTH-2: the code is read aloud digit by digit from the mock inbox. Nothing is sent to a real number. */
export function MockPhone({ initialPhone }: { initialPhone: string }) {
  const [phone, setPhone] = useState(initialPhone);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => fetch(`/api/mock/sms/inbox?phone=${encodeURIComponent(phone)}`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!alive) return;
      if (r.ok) { setMsgs(b.messages); setError(null); } else setError(`${b.code ?? r.status}: ${b.detail ?? ''}`);
    }, () => { if (alive) setError('offline'); });
    void poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [phone]);
  return (
    <main className="mx-auto max-w-sm px-4 py-6">
      <div className="space-y-3 rounded-[2rem] border-4 border-foreground/80 bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold"><Smartphone className="size-5" /> Mock phone</span>
          <SimulatedBadge what="SMS / IVR" />
        </div>
        <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="fictional phone number" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto" dir="ltr">
          {msgs.map((m) => {
            const code = m.body.match(/code is (\d{6})/)?.[1];
            return (
              <li key={m.id} className="rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
                <div className="mb-1 flex justify-between text-xs opacity-70"><span>{m.fromSender} · {m.kind}</span><span>{new Date(m.createdAt).toLocaleTimeString()}</span></div>
                <p>{m.body}</p>
                {code && <Button size="sm" variant="outline" className="mt-2" onClick={() => playSequence(code.split('').map((d) => `digit_${d}`))}><Volume2 /> Read code aloud</Button>}
              </li>
            );
          })}
          {!msgs.length && <li className="text-center text-sm text-muted-foreground">No messages</li>}
        </ul>
      </div>
    </main>
  );
}
