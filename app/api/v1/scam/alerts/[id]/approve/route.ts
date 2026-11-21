import { route } from '@/lib/api/route';
import { alertDecisionSpec } from '@/services/scam-alerts';

/** SCAM-6: an officer approves a drafted district alert before broadcast */
export const POST = route(alertDecisionSpec(true));
