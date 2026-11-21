import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { touchGrant } from '@/services/helper';
import { documentUploadSchema, storeDocument } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });

/** §21.2 / DOC-1: upload a photo; key = SHA-256 of the file, so a re-upload after a dropped signal is the same document */
export const POST = route({
  operationId: 'uploadDocument', method: 'POST', path: '/api/v1/cases/{id}/documents', summary: 'Upload a document photo (idempotent by SHA-256)', tags: ['Cases'],
  auth: 'required', params, body: documentUploadSchema, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'case.write', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.document', resourceType: 'case' },
  handler: async (c, db) => {
    const r = await storeDocument(db, c.actor!, c.params.id, c.body);
    const grantId = c.actor!.role === 'helper' ? await touchGrant(db, c.actor!.id, String(c.resource!.citizenId)) : null;
    return {
      status: r.created ? 201 : 200,
      body: { documentId: r.id, sha256: r.sha256, sharpness: r.sharpness, retake: r.retake, created: r.created },
      audit: { details: { docType: c.body.docType, sha256: r.sha256, created: r.created, via: c.actor!.role === 'helper' ? 'helper' : c.actor!.role, grantId } },
    };
  },
});
