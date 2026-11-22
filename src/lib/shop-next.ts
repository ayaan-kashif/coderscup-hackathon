/** only a path on the shopkeeper page may be a "next" after sign-in (no open redirect) */
export const safeNext = (n?: string | null) => (n && /^\/shopkeeper(\?|$)/.test(n) ? n : '/shopkeeper');
