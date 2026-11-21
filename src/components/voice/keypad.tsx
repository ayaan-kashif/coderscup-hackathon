'use client';
import { Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { playSequence } from './voice-prompt';

/** CIT-3: a large speaking keypad; each digit is read back as it is tapped. No typing is ever required. */
export function Keypad({ value, onChange, max, masked = false }: { value: string; onChange: (v: string) => void; max: number; masked?: boolean }) {
  const press = (d: string) => {
    if (value.length >= max) return;
    onChange(value + d);
    void playSequence([`digit_${d}`]);
  };
  return (
    <div className="space-y-4">
      <div dir="ltr" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-void text-3xl font-bold tracking-[0.3em]" aria-live="polite">
        {masked ? '•'.repeat(value.length) : value || ' '}
      </div>
      <div dir="ltr" className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button key={d} type="button" size="xl" variant="outline" className="h-16 text-2xl" onClick={() => press(d)}>{d}</Button>
        ))}
        <Button type="button" size="xl" variant="ghost" className="h-16" aria-label="delete" onClick={() => onChange(value.slice(0, -1))}><Delete className="!size-7" /></Button>
        <Button type="button" size="xl" variant="outline" className="h-16 text-2xl" onClick={() => press('0')}>0</Button>
        <span />
      </div>
    </div>
  );
}
