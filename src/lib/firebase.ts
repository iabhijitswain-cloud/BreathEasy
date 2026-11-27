import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { BudgetTier, HouseholdState, SupportedLanguage } from '../types/breatheasy.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  if (typeof window === 'undefined' || navigator.userAgent.includes('jsdom')) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export interface StoredHouseholdPreference {
  userId: string;
  cityId: string;
  language: SupportedLanguage;
  budgetTier: BudgetTier;
  eli10: boolean;
  roomSqft: number;
  memberCount: number;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const VALID_CITY_ID_REGEX = /^[a-z0-9_]+$/;

export async function saveHouseholdPreferencesToFirestore(
  userId: string,
  household: HouseholdState,
): Promise<void> {
  if (!VALID_ID_REGEX.test(userId) || !VALID_CITY_ID_REGEX.test(household.city.id)) {
    throw new Error('Invalid identifier format for household persistence.');
  }

  const boundedRoomSqft = Math.min(5000, Math.max(40, Math.round(household.roomSqft)));
  const boundedMembers = Math.min(20, Math.max(1, household.members.length));
  const path = `users/${userId}/private/household`;

  try {
    await setDoc(doc(db, 'users', userId, 'private', 'household'), {
      userId,
      cityId: household.city.id,
      language: household.language,
      budgetTier: household.budgetTier,
      eli10: Boolean(household.eli10),
      roomSqft: boundedRoomSqft,
      memberCount: boundedMembers,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadHouseholdPreferencesFromFirestore(
  userId: string,
): Promise<StoredHouseholdPreference | null> {
  if (!VALID_ID_REGEX.test(userId)) {
    return null;
  }
  const path = `users/${userId}/private/household`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'private', 'household'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      userId: String(d.userId || userId),
      cityId: String(d.cityId || 'delhi_mayur_vihar'),
      language: (['en', 'hi', 'bn'].includes(String(d.language))
        ? d.language
        : 'en') as SupportedLanguage,
      budgetTier: ([
        'inr_0',
        'under_500',
        'under_2000',
        'under_5000',
        'under_10000',
        'custom',
      ].includes(String(d.budgetTier))
        ? d.budgetTier
        : 'under_2000') as BudgetTier,
      eli10: Boolean(d.eli10),
      roomSqft: typeof d.roomSqft === 'number' ? d.roomSqft : 140,
      memberCount: typeof d.memberCount === 'number' ? d.memberCount : 4,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function deleteHouseholdPreferencesFromFirestore(userId: string): Promise<void> {
  if (!VALID_ID_REGEX.test(userId)) {
    throw new Error('Invalid identifier format for household deletion.');
  }
  const path = `users/${userId}/private/household`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'private', 'household'));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
