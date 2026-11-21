import { route } from '@/lib/api/route';
import { alertDecisionSpec } from '@/services/scam-alerts';

/** SCAM-6: dismiss a drafted district alert */
export const POST = route(alertDecisionSpec(false));
