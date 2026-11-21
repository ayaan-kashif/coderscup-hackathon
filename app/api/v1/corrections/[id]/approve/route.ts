import { route } from '@/lib/api/route';
import { correctionDecisionSpec } from '@/services/correction-routes';

/** CMP-3: an approved correction is a new fact with source = officer; the old value is kept; the case is re-decided */
export const POST = route(correctionDecisionSpec(true));
