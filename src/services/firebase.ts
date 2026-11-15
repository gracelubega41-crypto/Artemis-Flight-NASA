import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AuditLogRecord,
  CertificationReportRecord,
  FlightCredentialRecord,
  SimulationRunRecord,
  UserProfile,
} from '../types/mission';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const BOOTSTRAPPED_ADMIN_EMAIL = 'gracelubega41@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{ providerId?: string | null; email?: string | null }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
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

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
}

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function makeDefaultCallsign(displayName: string | null, uid: string): string {
  const base = (displayName || 'CADET')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const suffix = uid.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '1');
  return `${base || 'CADET'}-${suffix || '01'}`.slice(0, 20);
}

export async function syncUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const isBootstrappedAdmin = user.email === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;

  try {
    const snap = await getDoc(userRef);
    let profile: UserProfile;

    if (!snap.exists()) {
      profile = {
        uid: user.uid,
        displayName: (user.displayName || 'Astronaut Candidate').slice(0, 100),
        callsign: makeDefaultCallsign(user.displayName, user.uid),
        role: isBootstrappedAdmin ? 'instructor' : 'trainee',
        clearanceTier: isBootstrappedAdmin ? 'FLIGHT_DIRECTOR' : 'CADET',
        missionsCompleted: 0,
        averageSafetyScore: 0,
      };
      await setDoc(userRef, {
        ...profile,
        updatedAt: serverTimestamp(),
      });
    } else {
      profile = snap.data() as UserProfile;
    }

    // Sync isolated PII to /users/{uid}/private/info
    const privatePath = `users/${user.uid}/private/info`;
    const privateRef = doc(db, 'users', user.uid, 'private', 'info');
    try {
      const privSnap = await getDoc(privateRef);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid: user.uid,
          email: (user.email || 'candidate@artemis.nasa.gov').slice(0, 160),
          assignedInstructorEmail: BOOTSTRAPPED_ADMIN_EMAIL,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (privErr) {
      handleFirestoreError(privErr, OperationType.WRITE, privatePath);
    }

    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }
}

export async function recordAuditEvent(
  user: User,
  action: string,
  standardRef: string,
  detail: string
): Promise<AuditLogRecord> {
  const logId = makeSafeId('AUD');
  const timestamp = new Date().toISOString();
  let integrityHash = '';

  try {
    const res = await fetch('/api/audit/hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.uid,
        action,
        standardRef,
        detail,
        timestamp,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      integrityHash = data.integrityHash;
    }
  } catch {
    // Fallback deterministic digest string if offline
  }

  if (!integrityHash) {
    integrityHash = Array.from(detail + timestamp)
      .reduce((acc, ch) => ((acc * 33) ^ ch.charCodeAt(0)) >>> 0, 5381)
      .toString(16)
      .padStart(32, '0');
  }

  const record: AuditLogRecord = {
    logId,
    userId: user.uid,
    actorEmail: (user.email || '').slice(0, 160),
    action: action.slice(0, 80),
    standardRef: standardRef.slice(0, 40),
    detail: detail.slice(0, 500),
    integrityHash: integrityHash.slice(0, 128),
  };

  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      ...record,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `auditLogs/${logId}`);
  }

  return record;
}

export async function saveSimulationRun(
  user: User,
  profile: UserProfile | null,
  runInput: Omit<SimulationRunRecord, 'runId' | 'userId' | 'callsign' | 'instructorEmail' | 'createdAt'>
): Promise<SimulationRunRecord> {
  const runId = makeSafeId('SIM');
  const callsign = profile?.callsign || makeDefaultCallsign(user.displayName, user.uid);

  const record: SimulationRunRecord = {
    runId,
    userId: user.uid,
    callsign,
    instructorEmail: BOOTSTRAPPED_ADMIN_EMAIL,
    mode: runInput.mode,
    outcome: runInput.outcome,
    safetyScore: Math.round(Math.min(100, Math.max(0, runInput.safetyScore))),
    durationSec: Math.round(Math.max(0, runInput.durationSec)),
    standardRef: runInput.standardRef.slice(0, 40),
    ...(runInput.fuelRemainingPct !== undefined ? { fuelRemainingPct: Math.round(runInput.fuelRemainingPct) } : {}),
    ...(runInput.closureRateMs !== undefined ? { closureRateMs: Number(runInput.closureRateMs.toFixed(3)) } : {}),
    ...(runInput.alignmentErrorDeg !== undefined ? { alignmentErrorDeg: Number(runInput.alignmentErrorDeg.toFixed(2)) } : {}),
    ...(runInput.radiationDoseMsv !== undefined ? { radiationDoseMsv: Number(runInput.radiationDoseMsv.toFixed(2)) } : {}),
    ...(runInput.drillsResolved !== undefined ? { drillsResolved: runInput.drillsResolved } : {}),
    ...(runInput.vrUsed !== undefined ? { vrUsed: runInput.vrUsed } : {}),
    ...(runInput.hardwareInputUsed !== undefined ? { hardwareInputUsed: runInput.hardwareInputUsed } : {}),
    ...(runInput.multiplayerRoom ? { multiplayerRoom: runInput.multiplayerRoom.slice(0, 40) } : {}),
  };

  try {
    await setDoc(doc(db, 'simulations', runId), {
      ...record,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `simulations/${runId}`);
  }

  // Update aggregate profile metrics
  if (profile) {
    const prevCount = profile.missionsCompleted || 0;
    const nextCount = prevCount + 1;
    const nextAvg = Math.round(((profile.averageSafetyScore || 0) * prevCount + record.safetyScore) / nextCount);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: profile.displayName,
        callsign: profile.callsign,
        missionsCompleted: nextCount,
        averageSafetyScore: nextAvg,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  }

  await recordAuditEvent(
    user,
    `SIMULATION_${record.outcome}`,
    record.standardRef,
    `Mode: ${record.mode} | Score: ${record.safetyScore}% | Duration: ${record.durationSec}s`
  );

  return record;
}

export async function issueEncryptedCredential(
  user: User,
  profile: UserProfile | null,
  certificationLevel: FlightCredentialRecord['certificationLevel'],
  standardRef: string,
  score: number
): Promise<FlightCredentialRecord> {
  const callsign = profile?.callsign || makeDefaultCallsign(user.displayName, user.uid);
  const res = await fetch('/api/credentials/encrypt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.uid,
      callsign,
      certificationLevel,
      standardRef,
      score,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || 'Failed to encrypt flight credential.');
  }

  const envelope = await res.json();
  const credentialId = makeSafeId('CRED');

  const record: FlightCredentialRecord = {
    credentialId,
    userId: user.uid,
    instructorEmail: BOOTSTRAPPED_ADMIN_EMAIL,
    certificationLevel,
    algorithm: envelope.algorithm,
    ivHex: envelope.ivHex,
    authTagHex: envelope.authTagHex,
    ciphertextHex: envelope.ciphertextHex,
    fingerprintSha256: envelope.fingerprintSha256,
    status: 'ACTIVE',
  };

  try {
    await setDoc(doc(db, 'credentials', credentialId), {
      ...record,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `credentials/${credentialId}`);
  }

  await recordAuditEvent(
    user,
    'CREDENTIAL_ISSUED',
    standardRef,
    `Issued ${certificationLevel} AES-256-GCM envelope (${credentialId})`
  );

  return record;
}

export async function revokeCredential(user: User, credentialId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'credentials', credentialId), {
      status: 'REVOKED',
    });
    await recordAuditEvent(
      user,
      'CREDENTIAL_REVOKED',
      'NPR-8715.3',
      `Revoked flight credential ${credentialId}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `credentials/${credentialId}`);
  }
}

export async function saveCertificationReport(
  user: User,
  report: Omit<CertificationReportRecord, 'reportId' | 'userId' | 'instructorEmail' | 'createdAt'>
): Promise<CertificationReportRecord> {
  const reportId = makeSafeId('CERT');
  const record: CertificationReportRecord = {
    reportId,
    userId: user.uid,
    instructorEmail: BOOTSTRAPPED_ADMIN_EMAIL,
    status: report.status,
    readinessScore: Math.round(Math.min(100, Math.max(0, report.readinessScore))),
    summary: report.summary.slice(0, 2000),
    identifiedGaps: report.identifiedGaps.slice(0, 10),
    recommendations: report.recommendations.slice(0, 10),
  };

  try {
    await setDoc(doc(db, 'certifications', reportId), {
      ...record,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `certifications/${reportId}`);
  }

  await recordAuditEvent(
    user,
    'AI_CERTIFICATION_GENERATED',
    'NASA-STD-3001',
    `Determination: ${record.status} (${record.readinessScore}%)`
  );

  return record;
}

export function subscribeUserCollections(
  user: User,
  callbacks: {
    onSimulations: (items: SimulationRunRecord[]) => void;
    onCredentials: (items: FlightCredentialRecord[]) => void;
    onCertifications: (items: CertificationReportRecord[]) => void;
    onAuditLogs: (items: AuditLogRecord[]) => void;
  }
): () => void {
  const isBootstrappedAdmin = user.email === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;
  const unsubs: Unsubscribe[] = [];

  const simQuery = isBootstrappedAdmin
    ? query(collection(db, 'simulations'), orderBy('createdAt', 'desc'), limit(40))
    : query(collection(db, 'simulations'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(30));

  unsubs.push(
    onSnapshot(
      simQuery,
      (snap) => {
        callbacks.onSimulations(snap.docs.map((d) => d.data() as SimulationRunRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'simulations')
    )
  );

  const credQuery = isBootstrappedAdmin
    ? query(collection(db, 'credentials'), orderBy('createdAt', 'desc'), limit(30))
    : query(collection(db, 'credentials'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(20));

  unsubs.push(
    onSnapshot(
      credQuery,
      (snap) => {
        callbacks.onCredentials(snap.docs.map((d) => d.data() as FlightCredentialRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'credentials')
    )
  );

  const certQuery = isBootstrappedAdmin
    ? query(collection(db, 'certifications'), orderBy('createdAt', 'desc'), limit(30))
    : query(collection(db, 'certifications'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(20));

  unsubs.push(
    onSnapshot(
      certQuery,
      (snap) => {
        callbacks.onCertifications(snap.docs.map((d) => d.data() as CertificationReportRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'certifications')
    )
  );

  const auditQuery = isBootstrappedAdmin
    ? query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(50))
    : query(collection(db, 'auditLogs'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(40));

  unsubs.push(
    onSnapshot(
      auditQuery,
      (snap) => {
        callbacks.onAuditLogs(snap.docs.map((d) => d.data() as AuditLogRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    )
  );

  return () => {
    unsubs.forEach((u) => u());
  };
}

export async function fetchAllProfilesForInstructor(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(30)));
    return snap.docs.map((d) => d.data() as UserProfile);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}
