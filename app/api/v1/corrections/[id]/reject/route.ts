import { route } from '@/lib/api/route';
import { correctionDecisionSpec } from '@/services/correction-routes';

/** CMP-3: reject a correction request with a reason code */
export const POST = route(correctionDecisionSpec(false));
