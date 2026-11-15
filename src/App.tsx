import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  issueEncryptedCredential,
  recordAuditEvent,
  revokeCredential,
  saveCertificationReport,
  saveSimulationRun,
  signInWithGoogle,
  signOutAccount,
  subscribeUserCollections,
  syncUserProfile,
} from './services/firebase';
import type {
  AppSection,
  AuditLogRecord,
  CertificationReportRecord,
  FlightCredentialRecord,
  SimulationRunRecord,
  UserProfile,
} from './types/mission';
import { DockingSimulator3D } from './components/DockingSimulator3D';
import { OutpostSimulator } from './components/OutpostSimulator';
import { GroundControlConsole } from './components/GroundControlConsole';
import { InstructorAnalytics } from './components/InstructorAnalytics';
import { ComplianceVault } from './components/ComplianceVault';
import { telemetryAudio } from './services/telemetryAudio';

export default function App() {
  const [section, setSection] = useState<AppSection>('docking');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  const [simulations, setSimulations] = useState<SimulationRunRecord[]>([]);
  const [credentials, setCredentials] = useState<FlightCredentialRecord[]>([]);
  const [certifications, setCertifications] = useState<CertificationReportRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  useEffect(() => {
    telemetryAudio.startSpaceMusic();
  }, []);

  useEffect(() => {
    let unsubCollections: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (unsubCollections) {
        unsubCollections();
        unsubCollections = null;
      }

      if (nextUser) {
        try {
          const prof = await syncUserProfile(nextUser);
          setProfile(prof);
          unsubCollections = subscribeUserCollections(nextUser, {
            onSimulations: setSimulations,
            onCredentials: setCredentials,
            onCertifications: setCertifications,
            onAuditLogs: setAuditLogs,
          });
        } catch (err) {
          setAppError(err instanceof Error ? err.message : 'Unable to sync astronaut profile.');
        }
      } else {
        setProfile(null);
        setSimulations([]);
        setCredentials([]);
        setCertifications([]);
        setAuditLogs([]);
      }
      setAuthReady(true);
    });

    return () => {
      unsubAuth();
      if (unsubCollections) unsubCollections();
    };
  }, []);

  const handleAuthAction = async () => {
    setAuthBusy(true);
    setAppError(null);
    try {
      if (user) {
        await signOutAccount();
      } else {
        await signInWithGoogle();
      }
    } catch (err) {
      setAppError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveRun = async (
    runInput: Omit<SimulationRunRecord, 'runId' | 'userId' | 'callsign' | 'instructorEmail' | 'createdAt'>
  ) => {
    if (!user) throw new Error('Sign in required to persist simulation telemetry.');
    await saveSimulationRun(user, profile, runInput);
  };

  const handleAuditEvent = (action: string, standardRef: string, detail: string) => {
    if (!user) return;
    recordAuditEvent(user, action, standardRef, detail).catch(() => {});
  };

  const handleGenerateReport = async (
    report: Omit<CertificationReportRecord, 'reportId' | 'userId' | 'instructorEmail' | 'createdAt'>
  ) => {
    if (!user) throw new Error('Sign in required.');
    await saveCertificationReport(user, report);
  };

  const handleIssueCredential = async (
    level: 'ORBITAL_DOCKING_L1' | 'OUTPOST_OPS_L2' | 'COMMAND_READY_L3',
    standardRef: string,
    score: number
  ) => {
    if (!user) throw new Error('Sign in required.');
    await issueEncryptedCredential(user, profile, level, standardRef, score);
  };

  const handleRevokeCredential = async (credentialId: string) => {
    if (!user) return;
    await revokeCredential(user, credentialId);
  };

  const callsign = profile?.callsign || (user ? 'CADET-AUTH' : 'CADET-01');
  const isAdmin = Boolean(
    user &&
      user.emailVerified &&
      (user.email === BOOTSTRAPPED_ADMIN_EMAIL || profile?.role === 'instructor')
  );

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="h-[72px] bg-[#07090E] border-b border-slate-800 px-6 flex items-center justify-between gap-8 shrink-0">
        <a
          href="#docking"
          onClick={(e) => {
            e.preventDefault();
            setSection('docking');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Artemis Flight Academy
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          {(
            [
              ['docking', 'Space Docking'],
              ['outpost', 'Moon & Mars Base'],
              ['ground_control', 'Mission Control'],
              ['analytics', 'AI Coach & Badges'],
              ['compliance', 'Safety Vault'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                section === id
                  ? 'text-slate-100 border-cyan-500'
                  : 'border-transparent hover:text-slate-100 hover:border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            onClick={handleAuthAction}
            disabled={!authReady || authBusy}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white transition-colors whitespace-nowrap shrink-0"
          >
            {authBusy
              ? 'Connecting...'
              : user
              ? `Sign Out (${callsign})`
              : 'Sign In'}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Bar (visible < md) */}
      <div className="md:hidden border-b border-slate-800 bg-[#0B0E17] px-3 py-2 flex items-center gap-2 overflow-x-auto">
        {(
          [
            ['docking', 'Docking'],
            ['outpost', 'Moon/Mars'],
            ['ground_control', 'Control'],
            ['analytics', 'AI Coach'],
            ['compliance', 'Vault'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              section === id ? 'bg-cyan-600 text-white' : 'text-slate-300 bg-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {appError && (
        <div className="bg-[#1B1014] border-b border-rose-500/50 px-6 py-2.5 flex items-center justify-between text-xs text-rose-200">
          <span className="truncate">{appError}</span>
          <button
            onClick={() => setAppError(null)}
            className="ml-4 text-rose-300 hover:text-white whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1">
        {section === 'docking' && (
          <DockingSimulator3D
            callsign={callsign}
            isSignedIn={Boolean(user)}
            onSaveRun={handleSaveRun}
            onAuditEvent={handleAuditEvent}
          />
        )}

        {section === 'outpost' && (
          <OutpostSimulator
            callsign={callsign}
            isSignedIn={Boolean(user)}
            onSaveRun={handleSaveRun}
            onAuditEvent={handleAuditEvent}
          />
        )}

        {section === 'ground_control' && (
          <GroundControlConsole callsign={callsign} onAuditEvent={handleAuditEvent} />
        )}

        {section === 'analytics' && (
          <InstructorAnalytics
            profile={profile}
            isSignedIn={Boolean(user)}
            runs={simulations}
            certifications={certifications}
            onGenerateReport={handleGenerateReport}
            onIssueCredential={handleIssueCredential}
          />
        )}

        {section === 'compliance' && (
          <ComplianceVault
            isSignedIn={Boolean(user)}
            isAdmin={isAdmin}
            credentials={credentials}
            auditLogs={auditLogs}
            onRevokeCredential={handleRevokeCredential}
          />
        )}
      </main>
    </div>
  );
}
