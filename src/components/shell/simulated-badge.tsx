import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

/** Marks anything that comes from a mock service or synthetic data. */
export function SimulatedBadge({ what }: { what?: string }) {
  const t = useTranslations('shell');
  return (
    <Badge variant="warning" title={what ? `${what}: simulated` : 'simulated'} data-testid="simulated-badge">
      {t('simulated')}{what ? ` · ${what}` : ''}
    </Badge>
  );
}
