import { blobStore } from '../server/snapshot-store.js';
import { createHandler } from '../server/snapshots-handler.js';
export default createHandler(blobStore());
