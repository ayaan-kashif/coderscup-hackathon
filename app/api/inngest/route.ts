import { serve } from 'inngest/next';
import { FUNCTIONS, inngest } from '@/jobs/inngest';

/** Inngest endpoint (signed by INNGEST_SIGNING_KEY in production). Not part of /api/v1; never called by browsers. */
export const { GET, POST, PUT } = serve({ client: inngest, functions: FUNCTIONS });
export const maxDuration = 60;
