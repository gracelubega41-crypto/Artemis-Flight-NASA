import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BrainCircuit,
  CheckCircle2,
  FileCheck2,
  Loader2,
  ShieldAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  CertificationReportRecord,
  NasaMissionFeed,
  SimulationRunRecord,
  UserProfile,
} from '../types/mission';
import { voiceGuide } from '../services/voiceGuide';
import { AskAiCoachPanel } from './AskAiCoachPanel';

interface InstructorAnalyticsProps {
  profile: UserProfile | null;
  isSignedIn: boolean;
  runs: SimulationRunRecord[];
  certifications: CertificationReportRecord[];
  onGenerateReport: (report: Omit<CertificationReportRecord, 'reportId' | 'userId' | 'instructorEmail' | 'createdAt'>) => Promise<void>;
  onIssueCredential: (
    level: 'ORBITAL_DOCKING_L1' | 'OUTPOST_OPS_L2' | 'COMMAND_READY_L3',
    standardRef: string,
    score: number
  ) => Promise<void>;
}

const AXES = [
  'Smooth Flying',
  'Fuel Saving',
  'Fresh Air Care',
  'Storm Safety',
  'Quick Fixes',
  'Mission Wins',
];

interface BadgeDef {
  id: string;
  title: string;
  hint: string;
  accent: string;
  unlocked: boolean;
  icon: 'dock' | 'fuel' | 'moon' | 'mars' | 'fix' | 'nasa';
}

const BadgePatchSvg: React.FC<{ icon: BadgeDef['icon']; unlocked: boolean; accent: string }> = ({
  icon,
  unlocked,
  accent,
}) => {
  const stroke = unlocked ? accent : '#475569';
  const fill = unlocked ? `${accent}22` : '#0F172A';
  return (
    <svg viewBox="0 0 80 80" className="w-16 h-16 shrink-0">
      <polygon
        points="40,4 72,22 72,58 40,76 8,58 8,22"
        fill={fill}
        stroke={stroke}
        strokeWidth="2.5"
      />
      <circle cx="40" cy="40" r="22" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="3 3" />
      {icon === 'dock' && (
        <g stroke={stroke} strokeWidth="2.2" fill="none" strokeLinecap="round">
          <path d="M40 20 L48 36 L44 50 L36 50 L32 36 Z" />
          <line x1="28" y1="54" x2="52" y2="54" />
        </g>
      )}
      {icon === 'fuel' && (
        <g stroke={stroke} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M40 20 C48 30 50 38 50 45 A10 10 0 1 1 30 45 C30 38 32 30 40 20 Z" />
          <path d="M37 45 L40 39 L43 45" />
        </g>
      )}
      {icon === 'moon' && (
        <g stroke={stroke} strokeWidth="2.2" fill="none">
          <path d="M46 25 A15 15 0 1 0 54 48 A11 11 0 1 1 46 25 Z" />
          <circle cx="52" cy="29" r="1.5" fill={stroke} />
        </g>
      )}
      {icon === 'mars' && (
        <g stroke={stroke} strokeWidth="2.2" fill="none">
          <circle cx="40" cy="40" r="13" />
          <path d="M31 36 Q40 32 49 38" />
          <path d="M32 45 Q40 49 48 43" />
        </g>
      )}
      {icon === 'fix' && (
        <g stroke={stroke} strokeWidth="2.2" fill="none" strokeLinecap="round">
          <path d="M32 28 L48 44 M44 26 L52 34 M28 46 L36 54" />
          <circle cx="40" cy="40" r="16" strokeOpacity="0.4" />
        </g>
      )}
      {icon === 'nasa' && (
        <g stroke={stroke} strokeWidth="2.2" fill="none" strokeLinecap="round">
          <circle cx="40" cy="40" r="7" />
          <path d="M40 23 V28 M40 52 V57 M23 40 H28 M52 40 H57 M28 28 L32 32 M48 48 L52 52 M52 28 L48 32 M32 48 L28 52" />
        </g>
      )}
    </svg>
  );
};

export const InstructorAnalytics: React.FC<InstructorAnalyticsProps> = ({
  profile,
  isSignedIn,
  runs,
  certifications,
  onGenerateReport,
  onIssueCredential,
}) => {
  const [evaluating, setEvaluating] = useState(false);
  const [issuingCred, setIssuingCred] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(voiceGuide.isEnabled());
  const [nasaFeed, setNasaFeed] = useState<NasaMissionFeed | null>(null);
  const [guestReport, setGuestReport] = useState<CertificationReportRecord | null>(null);

  useEffect(() => {
    fetch('/api/nasa/mission-feed')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NasaMissionFeed | null) => {
        if (data) setNasaFeed(data);
      })
      .catch(() => {});
  }, []);

  const radarScores = useMemo(() => {
    if (runs.length === 0) return [60, 60, 60, 60, 60, 60];
    const dockingRuns = runs.filter((r) => r.mode === 'docking');
    const outpostRuns = runs.filter((r) => r.mode !== 'docking');

    const avgDockScore = dockingRuns.length
      ? dockingRuns.reduce((s, r) => s + r.safetyScore, 0) / dockingRuns.length
      : 72;
    const avgFuel = dockingRuns.length
      ? dockingRuns.reduce((s, r) => s + (r.fuelRemainingPct ?? 75), 0) / dockingRuns.length
      : 74;
    const avgOutpostScore = outpostRuns.length
      ? outpostRuns.reduce((s, r) => s + r.safetyScore, 0) / outpostRuns.length
      : 76;
    const avgRad = outpostRuns.length
      ? Math.max(30, 100 - (outpostRuns.reduce((s, r) => s + (r.radiationDoseMsv ?? 8), 0) / outpostRuns.length) * 2.5)
      : 78;
    const drillScore = Math.min(
      100,
      62 + runs.reduce((s, r) => s + (r.drillsResolved ?? 0), 0) * 8
    );
    const idssRate = Math.round(
      (runs.filter((r) => r.outcome === 'SUCCESS').length / Math.max(1, runs.length)) * 100
    );

    return [
      Math.round(avgDockScore),
      Math.round(avgFuel),
      Math.round(avgOutpostScore),
      Math.round(avgRad),
      Math.round(drillScore),
      Math.max(40, idssRate),
    ];
  }, [runs]);

  const badges: BadgeDef[] = useMemo(() => {
    const hasSafeDock = runs.some((r) => r.mode === 'docking' && r.outcome === 'SUCCESS');
    const hasFuelAce = runs.some((r) => r.mode === 'docking' && r.outcome === 'SUCCESS' && (r.fuelRemainingPct ?? 0) >= 60);
    const hasMoonHero = runs.some((r) => r.mode === 'lunar_outpost' && r.outcome === 'SUCCESS' && r.safetyScore >= 75);
    const hasMarsHero = runs.some((r) => r.mode === 'mars_outpost' && r.outcome === 'SUCCESS' && r.safetyScore >= 75);
    const hasFixer = runs.some((r) => (r.drillsResolved ?? 0) >= 1);

    return [
      {
        id: 'dock',
        title: 'First Safe Dock',
        hint: 'Dock safely once in Space Docking',
        accent: '#06B6D4',
        unlocked: hasSafeDock,
        icon: 'dock',
      },
      {
        id: 'fuel',
        title: 'Fuel Saver Ace',
        hint: 'Dock with 60%+ fuel left',
        accent: '#10B981',
        unlocked: hasFuelAce,
        icon: 'fuel',
      },
      {
        id: 'moon',
        title: 'Moon Base Hero',
        hint: 'Save a Moon Base score of 75%+',
        accent: '#38BDF8',
        unlocked: hasMoonHero,
        icon: 'moon',
      },
      {
        id: 'mars',
        title: 'Mars Explorer',
        hint: 'Save a Mars Base score of 75%+',
        accent: '#F59E0B',
        unlocked: hasMarsHero,
        icon: 'mars',
      },
      {
        id: 'fix',
        title: 'Emergency Fixer',
        hint: 'Fix at least 1 emergency drill',
        accent: '#EC4899',
        unlocked: hasFixer,
        icon: 'fix',
      },
      {
        id: 'nasa',
        title: 'NASA Weather Pro',
        hint: 'Pass Moon or Mars Base after fixing a storm drill',
        accent: '#FBBF24',
        unlocked:
          (hasMoonHero || hasMarsHero) &&
          runs.some((r) => r.mode !== 'docking' && (r.drillsResolved ?? 0) >= 1 && r.safetyScore >= 80),
        icon: 'nasa',
      },
    ];
  }, [runs]);

  const polygonPoints = useMemo(() => {
    const cx = 140;
    const cy = 140;
    const maxR = 95;
    return radarScores
      .map((score, i) => {
        const ang = (Math.PI * 2 * i) / 6 - Math.PI / 2;
        const r = (score / 100) * maxR;
        return `${(cx + Math.cos(ang) * r).toFixed(1)},${(cy + Math.sin(ang) * r).toFixed(1)}`;
      })
      .join(' ');
  }, [radarScores]);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    voiceGuide.setEnabled(next);
    setVoiceEnabled(next);
    if (next) {
      voiceGuide.speak('Voice guide turned on! Tap Hear Coach Summary or click any Astronaut Badge to listen.', {
        priority: true,
        speaker: voiceGuide.resolveCoachSpeaker(),
        useNeuralTts: true,
      });
    }
  };

  const handleRunAiAnalysis = async () => {
    setEvaluating(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/analytics/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callsign: profile?.callsign || 'CADET-01',
          runs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI Coach evaluation failed.');
      }
      if (isSignedIn) {
        await onGenerateReport(data);
        setStatusMsg('AI Flight Coach report card created and saved!');
      } else {
        setGuestReport({
          reportId: 'GUEST-PREVIEW',
          userId: 'guest',
          status: data.status,
          readinessScore: data.readinessScore,
          summary: data.summary,
          identifiedGaps: data.identifiedGaps,
          recommendations: data.recommendations,
        });
        setStatusMsg('AI Flight Coach report card ready! Sign in anytime to save reports to the cloud.');
      }
      if (data.summary) {
        voiceGuide.speak(`Your Flight Coach report is ready! ${data.summary}`, {
          priority: true,
          speaker: voiceGuide.resolveCoachSpeaker(),
          useNeuralTts: true,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to complete AI analysis.');
    } finally {
      setEvaluating(false);
    }
  };

  const handleIssueCert = async () => {
    if (!isSignedIn) return;
    setIssuingCred(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const avgScore = runs.length
        ? Math.round(runs.reduce((s, r) => s + r.safetyScore, 0) / runs.length)
        : 85;
      const level =
        avgScore >= 90
          ? 'COMMAND_READY_L3'
          : avgScore >= 75
          ? 'OUTPOST_OPS_L2'
          : 'ORBITAL_DOCKING_L1';
      await onIssueCredential(level, 'NASA-STD-3001', avgScore);
      setStatusMsg(`Locked Astronaut Badge (${level}) created and saved!`);
      voiceGuide.speak(`Awesome job! You earned your official Astronaut Badge with a score of ${avgScore} percent!`, {
        priority: true,
        speaker: 'maya',
        useNeuralTts: true,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create badge.');
    } finally {
      setIssuingCred(false);
    }
  };

  const latestCert = certifications[0] || guestReport;

  const speakReport = () => {
    if (!latestCert) return;
    if (!voiceGuide.isEnabled()) {
      voiceGuide.setEnabled(true);
      setVoiceEnabled(true);
    }
    const gaps = latestCert.identifiedGaps.slice(0, 2).join('. ');
    const tips = latestCert.recommendations.slice(0, 2).join('. ');
    voiceGuide.speak(
      `Here is your Flight Coach Report Card! Readiness score: ${latestCert.readinessScore} percent. ${latestCert.summary} Skills to practice next: ${gaps}. Coach tips: ${tips}`,
      { priority: true, speaker: voiceGuide.resolveCoachSpeaker(), useNeuralTts: true }
    );
  };

  const unlockedCount = badges.filter((b) => b.unlocked).length;

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">
      <div className="bg-[#0B0E17] border border-slate-800 p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400">
            Junior Astronaut Progress · {profile?.callsign || 'Guest Cadet'} · {profile?.clearanceTier || 'CADET'}
          </p>
          <h1 className="text-2xl font-bold text-slate-100 mt-0.5">
            AI Flight Coach & Astronaut Badges
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={toggleVoice}
            className={`px-3 py-2 text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap ${
              voiceEnabled
                ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{voiceEnabled ? 'Voice Guide On' : 'Voice Guide Off'}</span>
          </button>

          <button
            onClick={handleRunAiAnalysis}
            disabled={evaluating}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white flex items-center gap-2 whitespace-nowrap"
          >
            {evaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
            <span>{evaluating ? 'Coach Thinking...' : 'Get Coach Report Card'}</span>
          </button>

          <button
            onClick={handleIssueCert}
            disabled={!isSignedIn || runs.length === 0 || issuingCred}
            className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-100 flex items-center gap-2 whitespace-nowrap"
          >
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span>{issuingCred ? 'Locking Badge...' : 'Earn Astronaut Badge'}</span>
          </button>
        </div>
      </div>

      {!isSignedIn && (
        <div className="bg-[#0B0E17] border border-amber-500/40 p-4 text-xs text-amber-200">
          You can chat with Coach Maya and generate your AI Report Card right now! Tap Sign In in the top right whenever you want to save missions and Astronaut Badges to the cloud.
        </div>
      )}

      {errorMsg && (
        <div className="bg-[#1B1014] border border-rose-500/60 p-4 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && (
        <div className="bg-[#0B1715] border border-emerald-500/50 p-4 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Interactive AI Flight Coach Q&A + Astronaut Skills Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 flex">
          <AskAiCoachPanel
            callsign={profile?.callsign || 'CADET-01'}
            mode="general"
            nasaFeed={nasaFeed}
            runs={runs}
            variant="embedded"
            voiceEnabled={voiceEnabled}
            onToggleVoice={toggleVoice}
          />
        </div>

        <div className="lg:col-span-5 bg-[#0B0E17] border border-slate-800 p-5 flex flex-col items-center justify-center">
          <div className="w-full flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-100">Astronaut Skills Radar</h2>
            <span className="font-mono text-xs text-slate-400">{runs.length} missions saved</span>
          </div>

          <svg viewBox="0 0 280 280" className="w-72 h-72">
            {[25, 50, 75, 100].map((pct) => {
              const r = (pct / 100) * 95;
              const pts = AXES.map((_, i) => {
                const ang = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                return `${(140 + Math.cos(ang) * r).toFixed(1)},${(140 + Math.sin(ang) * r).toFixed(1)}`;
              }).join(' ');
              return <polygon key={pct} points={pts} fill="none" stroke="#1E293B" strokeWidth="1" />;
            })}
            {AXES.map((label, i) => {
              const ang = (Math.PI * 2 * i) / 6 - Math.PI / 2;
              const x2 = 140 + Math.cos(ang) * 95;
              const y2 = 140 + Math.sin(ang) * 95;
              const lx = 140 + Math.cos(ang) * 116;
              const ly = 140 + Math.sin(ang) * 116;
              return (
                <g key={label}>
                  <line x1="140" y1="140" x2={x2} y2={y2} stroke="#1E293B" strokeWidth="1" />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#94A3B8"
                    fontSize="9"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            <polygon
              points={polygonPoints}
              fill="rgba(6, 182, 212, 0.22)"
              stroke="#06B6D4"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* AI Flight Coach Report Card */}
      <div className="bg-[#0B0E17] border border-slate-800 p-5 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-cyan-400" />
              <h2 className="text-base font-semibold text-slate-100">AI Flight Coach Report Card</h2>
            </div>

            <div className="flex items-center gap-3">
              {latestCert && (
                <button
                  type="button"
                  onClick={speakReport}
                  className="px-2.5 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 flex items-center gap-1.5"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Hear Coach Summary</span>
                </button>
              )}
              {latestCert && (
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${
                    latestCert.status === 'CERTIFIED'
                      ? 'text-emerald-400'
                      : latestCert.status === 'PROVISIONAL'
                      ? 'text-amber-300'
                      : 'text-rose-400'
                  }`}
                >
                  {latestCert.status === 'CERTIFIED'
                    ? 'FLIGHT READY!'
                    : latestCert.status === 'PROVISIONAL'
                    ? 'ALMOST READY'
                    : 'KEEP PRACTICING'}{' '}
                  · {latestCert.readinessScore}%
                </span>
              )}
            </div>
          </div>

          {latestCert ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-200 leading-relaxed">{latestCert.summary}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="bg-slate-900/60 border border-slate-800 p-3.5">
                  <h3 className="text-xs font-semibold text-amber-300 mb-2">Skills to Practice Next</h3>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {latestCert.identifiedGaps.map((g, idx) => (
                      <li key={idx}>• {g}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 p-3.5">
                  <h3 className="text-xs font-semibold text-cyan-300 mb-2">Coach Tips</h3>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {latestCert.recommendations.map((rec, idx) => (
                      <li key={idx}>• {rec}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-slate-400">
              Click <span className="text-slate-200 font-medium">Get Coach Report Card</span> above anytime for your personal starter plan or mission check-up!
            </div>
          )}
        </div>
      </div>

      {/* Collectible Junior Astronaut Mission Patches */}
      <div className="bg-[#0B0E17] border border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-semibold text-slate-100">Junior Astronaut Mission Badges</h2>
          </div>
          <span className="font-mono text-xs text-cyan-300">
            {unlockedCount} / {badges.length} Badges Unlocked
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {badges.map((badge) => (
            <button
              key={badge.id}
              type="button"
              onClick={() => {
                if (!voiceGuide.isEnabled()) {
                  voiceGuide.setEnabled(true);
                  setVoiceEnabled(true);
                }
                voiceGuide.speak(
                  badge.unlocked
                    ? `${badge.title} badge unlocked! ${badge.hint}. Great job Astronaut!`
                    : `${badge.title} badge is locked. To unlock it: ${badge.hint}.`,
                  { priority: true, speaker: voiceGuide.resolveCoachSpeaker(), useNeuralTts: true }
                );
              }}
              className={`p-4 border text-left flex items-center gap-3.5 transition-colors ${
                badge.unlocked
                  ? 'bg-[#07090E] border-cyan-500/40 hover:border-cyan-400'
                  : 'bg-[#07090E]/50 border-slate-800/80 opacity-75 hover:opacity-100'
              }`}
            >
              <BadgePatchSvg icon={badge.icon} unlocked={badge.unlocked} accent={badge.accent} />
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${badge.unlocked ? 'text-slate-100' : 'text-slate-400'}`}>
                  {badge.title}
                </p>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">{badge.hint}</p>
                <p className={`text-[11px] font-mono mt-1.5 ${badge.unlocked ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {badge.unlocked ? 'UNLOCKED' : 'LOCKED'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[#0B0E17] border border-slate-800 p-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <h2 className="text-base font-semibold text-slate-100">My Saved Missions</h2>
          <span className="text-xs font-mono text-slate-400">Cloud Saved</span>
        </div>

        {runs.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            No missions saved yet. Fly a ship in Space Docking or run a Moon/Mars Base and tap Save!
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="py-2 pr-4">Mission ID</th>
                  <th className="py-2 pr-4">Pilot</th>
                  <th className="py-2 pr-4">Game Mode</th>
                  <th className="py-2 pr-4">Result</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {runs.map((r) => (
                  <tr key={r.runId} className="text-slate-200">
                    <td className="py-2.5 pr-4 text-slate-400">{r.runId}</td>
                    <td className="py-2.5 pr-4">{r.callsign}</td>
                    <td className="py-2.5 pr-4">
                      {r.mode === 'docking'
                        ? 'Space Docking'
                        : r.mode === 'mars_outpost'
                        ? 'Mars Base'
                        : 'Moon Base'}
                    </td>
                    <td
                      className={`py-2.5 pr-4 ${
                        r.outcome === 'SUCCESS'
                          ? 'text-emerald-400'
                          : r.outcome === 'ABORTED'
                          ? 'text-amber-300'
                          : 'text-rose-400'
                      }`}
                    >
                      {r.outcome}
                    </td>
                    <td className="py-2.5 pr-4">{r.safetyScore}%</td>
                    <td className="py-2.5 pr-4">{r.durationSec}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
