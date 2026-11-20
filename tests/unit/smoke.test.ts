import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('toolchain', () => {
  it('runs vitest with path aliases', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
});
