/**
 * Single Firebase Admin app + typed handles shared by every function.
 * Importing this module initialises the SDK exactly once.
 */
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const app = getApps().length ? getApp() : initializeApp();

export const db = getFirestore(app);
export const auth = getAuth(app);

db.settings({ ignoreUndefinedProperties: true });
