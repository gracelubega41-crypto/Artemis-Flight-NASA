import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Gamepad2, Glasses, KeyRound, Lock, ShieldCheck, Usb } from 'lucide-react';
import type { AuditLogRecord, FlightCredentialRecord } from '../types/mission';
import { pollFlightHardware, requestWebHidFlightHardware } from '../services/hardwareInput';

interface ComplianceVaultProps {
  isSignedIn: boolean;
  isAdmin: boolean;
  credentials: FlightCredentialRecord[];
  auditLogs: AuditLogRecord[];
  onRevokeCredential: (credentialId: string) => Promise<void>;
}

export const ComplianceVault: React.FC<ComplianceVaultProps> = ({
  isSignedIn,
  isAdmin,
  credentials,
  auditLogs,
  onRevokeCredential,
}) => {
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [hwStatus, setHwStatus] = useState(() => pollFlightHardware());
  const [hidDevices, setHidDevices] = useState<string[]>([]);
  const [hidError, setHidError] = useState<string | null>(null);
  const [xrSupported, setXrSupported] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHwStatus(pollFlightHardware());
    }, 250);
    const xr = (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr;
    if (xr?.isSessionSupported) {
      xr.isSessionSupported('immersive-vr')
        .then((s) => setXrSupported(s))
        .catch(() => setXrSupported(false));
    }
    return () => window.clearInterval(timer);
  }, []);

  const handleVerifyCredential = async (cred: FlightCredentialRecord) => {
    setVerifyingId(cred.credentialId);
    try {
      const res = await fetch('/api/credentials/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ivHex: cred.ivHex,
          authTagHex: cred.authTagHex,
          ciphertextHex: cred.ciphertextHex,
          fingerprintSha256: cred.fingerprintSha256,
        }),
      });
      const data = await res.json();
      if (res.ok && data.verified) {
        setVerifyResult((prev) => ({
          ...prev,
          [cred.credentialId]: {
            ok: true,
            detail: `Badge Unlocked & Verified! Score ${data.payload.score}% · ${data.payload.certificationLevel}`,
          },
        }));
      } else {
        setVerifyResult((prev) => ({
          ...prev,
          [cred.credentialId]: { ok: false, detail: data.error || 'Could not verify badge.' },
        }));
      }
    } catch (err) {
      setVerifyResult((prev) => ({
        ...prev,
        [cred.credentialId]: { ok: false, detail: err instanceof Error ? err.message : 'Network error' },
      }));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleConnectHid = async () => {
    setHidError(null);
    try {
      const list = await requestWebHidFlightHardware();
      if (list.length > 0) {
        setHidDevices((prev) => Array.from(new Set([...prev, ...list])));
      }
    } catch (err) {
      setHidError(err instanceof Error ? err.message : 'Cancelled or unavailable.');
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">
      <div className="bg-[#0B0E17] border border-slate-800 p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400">
            Astronaut Safety & Gear Check · Secret AES-256-GCM Badge Lock
          </p>
          <h1 className="text-2xl font-bold text-slate-100 mt-0.5">
            Safety Vault, Badges & Controller Check
          </h1>
        </div>
        <span className="font-mono text-xs text-emerald-400 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" />
          <span>Badges Protected</span>
        </span>
      </div>

      {/* Gear Check */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0B0E17] border border-slate-800 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Game Controller / Joystick</span>
            <Gamepad2 className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-sm font-semibold text-slate-100">
            {hwStatus.connected ? `● Connected: ${hwStatus.deviceName}` : 'No Controller Plugged In'}
          </p>
          <p className="text-xs font-mono text-slate-400">
            {hwStatus.connected
              ? `Sticks: [${hwStatus.rawAxes.slice(0, 4).join(', ')}]`
              : 'Plug in a USB or Bluetooth controller and press any button to use it!'}
          </p>
        </div>

        <div className="bg-[#0B0E17] border border-slate-800 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Flight Stick USB Link</span>
            <Usb className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-100">
              {hwStatus.hidSupported ? 'USB Flight Gear Ready' : 'Not Supported Here'}
            </p>
            {hwStatus.hidSupported && (
              <button
                onClick={handleConnectHid}
                className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 whitespace-nowrap"
              >
                Connect USB
              </button>
            )}
          </div>
          {hidDevices.length > 0 && (
            <p className="text-xs font-mono text-emerald-400">Connected: {hidDevices.join(', ')}</p>
          )}
          {hidError && <p className="text-xs text-amber-300">{hidError}</p>}
        </div>

        <div className="bg-[#0B0E17] border border-slate-800 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>VR Headset Check</span>
            <Glasses className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-sm font-semibold text-slate-100">
            {xrSupported ? '● VR Headset Ready!' : '3D Split-Eye VR Mode Ready'}
          </p>
          <p className="text-xs text-slate-400">
            Works with VR headsets or right on your screen using VR View in Space Docking.
          </p>
        </div>
      </div>

      {/* Encrypted Badges */}
      <div className="bg-[#0B0E17] border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-semibold text-slate-100">Secret-Locked Astronaut Badges</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">{credentials.length} badges</span>
        </div>

        {!isSignedIn ? (
          <p className="text-sm text-slate-400 py-4">Sign in to view or check your locked Astronaut Badges.</p>
        ) : credentials.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">
            No badges yet! Go to AI Coach & Badges after finishing a mission and tap Earn Astronaut Badge.
          </p>
        ) : (
          <div className="space-y-3">
            {credentials.map((c) => {
              const vr = verifyResult[c.credentialId];
              return (
                <div key={c.credentialId} className="bg-slate-900/60 border border-slate-800 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Lock className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="font-mono font-semibold text-slate-100">{c.certificationLevel}</span>
                      <span className="text-slate-500">·</span>
                      <span className={c.status === 'ACTIVE' ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                        {c.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleVerifyCredential(c)}
                        disabled={verifyingId === c.credentialId}
                        className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white whitespace-nowrap"
                      >
                        {verifyingId === c.credentialId ? 'Checking...' : 'Check Badge Lock'}
                      </button>
                      {isAdmin && c.status === 'ACTIVE' && (
                        <button
                          onClick={() => onRevokeCredential(c.credentialId)}
                          className="px-3 py-1 text-xs bg-rose-700 hover:bg-rose-600 text-white whitespace-nowrap"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] font-mono text-slate-400 break-all">
                    {c.algorithm} · Lock Code: {c.fingerprintSha256.slice(0, 24)}...
                  </p>

                  {vr && (
                    <div
                      className={`text-xs flex items-center gap-1.5 ${
                        vr.ok ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{vr.detail}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mission Safety Logbook */}
      <div className="bg-[#0B0E17] border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">Mission Safety Logbook</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">{auditLogs.length} entries</span>
        </div>

        {auditLogs.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">
            No logbook entries yet. Sign in and play a mission to see your flight history!
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="py-2 pr-4">Log ID</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">Rulebook</th>
                  <th className="py-2 pr-4">What Happened</th>
                  <th className="py-2 pr-4">Safety Stamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {auditLogs.map((log) => (
                  <tr key={log.logId} className="text-slate-300">
                    <td className="py-2 pr-4 text-slate-500">{log.logId}</td>
                    <td className="py-2 pr-4 text-cyan-300">{log.action}</td>
                    <td className="py-2 pr-4 text-amber-300">{log.standardRef}</td>
                    <td className="py-2 pr-4 font-sans text-slate-200">{log.detail}</td>
                    <td className="py-2 pr-4 text-slate-500">{log.integrityHash.slice(0, 14)}...</td>
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
