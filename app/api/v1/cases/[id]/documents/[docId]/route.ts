import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { decryptBytes } from '@/auth/crypto';
import { documents } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { loadCaseRef } from '@/services/cases';

const params = z.object({ id: z.string().max(64), docId: z.uuid() });

/** O2 "documents with zoom": the photo as a data URL. Officers need tenant + consent; every read is in her access log. */
export const GET = route({
  operationId: 'getDocumentImage', method: 'GET', path: '/api/v1/cases/{id}/documents/{docId}', summary: 'Read a document photo', tags: ['Cases'],
  auth: 'required', params,
  authorize: { action: 'case.read', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.documents.read', resourceType: 'case' },
  handler: async (c, db) => {
    if (c.verdict?.mask?.length) throw notFound(); // auditors see hashes and outcomes, not photos
    const [d] = await db.select({ mime: documents.mime, enc: documents.contentEnc, docType: documents.docType, storageKey: documents.storageKey }).from(documents)
      .where(and(eq(documents.id, c.params.docId), eq(documents.caseId, c.params.id))).limit(1);
    if (!d?.enc) throw notFound();
    return { body: { docType: d.docType, sha256: d.storageKey, dataUrl: `data:${d.mime};base64,${decryptBytes(d.enc).toString('base64')}` }, audit: { details: { documentId: c.params.docId } } };
  },
});
