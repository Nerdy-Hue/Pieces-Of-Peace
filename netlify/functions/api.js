import { handleApi } from '../../server/http.js';
import { openDefaultStore } from '../../server/store.js';

export default async function handler(request, context) {
  const store = await openDefaultStore();
  const sourceIp = request.headers.get('x-nf-client-connection-ip') || context?.ip || '';
  return handleApi(request, { store, sourceIp });
}
