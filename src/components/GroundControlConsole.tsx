import React, { useEffect, useState } from 'react';
import { AlertTriangle, Radio, RefreshCw, Send, ShieldAlert, Users } from 'lucide-react';
import type { DockingTelemetry, FlightDirective, OutpostTelemetry, RoomDirectoryEntry } from '../types/mission';
import { missionSocket } from '../services/websocketClient';

interface GroundControlConsoleProps {
  callsign: string;
  onAuditEvent?: (action: string, standardRef: string, detail: string) => void;
}

const QUICK_DIRECTIVES = [
  'Great flying! Slow down gently!',
  'Line up with the target ring!',
  'Solar storm coming — use Storm Shelter!',
  'All clear to dock!',
];

export const GroundControlConsole: React.FC<GroundControlConsoleProps> = ({
  callsign,
  onAuditEvent,
}) => {
  const [rooms, setRooms] = useState<RoomDirectoryEntry[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('ISS-NODE-01');
  const [liveDocking, setLiveDocking] = useState<DockingTelemetry | null>(null);
  const [liveOutpost, setLiveOutpost] = useState<OutpostTelemetry | null>(null);
  const [participants, setParticipants] = useState<Array<{ clientId: string; callsign: string; role: string }>>([]);
  const [directives, setDirectives] = useState<FlightDirective[]>([]);
  const [directiveText, setDirectiveText] = useState('');
  const [wsConnected, setWsConnected] = useState(false);

  const loadDirectory = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms || []);
      }
    } catch {
      // Ignore transient network errors
    }
  };

  useEffect(() => {
    loadDirectory();
    const timer = window.setInterval(loadDirectory, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    missionSocket.connect(selectedRoom, callsign, 'ground_control');
    const unsub = missionSocket.subscribe((ev) => {
      if (ev.type === 'ws:status') {
        setWsConnected(Boolean((ev.payload as { connected: boolean })?.connected));
      } else if (ev.type === 'session:welcome') {
        setWsConnected(true);
        const room = (ev.payload as { room?: RoomDirectoryEntry & { directives?: FlightDirective[] } })?.room;
        if (room) {
          setParticipants(room.participants || []);
          setLiveDocking(room.dockingTelemetry || null);
          setLiveOutpost(room.outpostTelemetry || null);
          setDirectives(room.directives || []);
        }
      } else if (ev.type === 'room:state') {
        const room = ev.payload as RoomDirectoryEntry & { directives?: FlightDirective[] };
        setParticipants(room.participants || []);
        if (room.directives) setDirectives(room.directives);
      } else if (ev.type === 'telemetry:docking') {
        setLiveDocking(ev.payload as DockingTelemetry);
      } else if (ev.type === 'telemetry:outpost') {
        setLiveOutpost(ev.payload as OutpostTelemetry);
      } else if (ev.type === 'directive:received') {
        const d = ev.payload as FlightDirective;
        setDirectives((prev) => [...prev.slice(-19), d]);
      } else if (ev.type === 'rooms:directory') {
        loadDirectory();
      }
    });
    return unsub;
  }, [selectedRoom, callsign]);

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    missionSocket.send('directive:send', {
      sender: callsign,
      role: 'ground_control',
      text: trimmed,
    });
    onAuditEvent?.('FLIGHT_DIRECTIVE_SENT', 'NPR-8715.3', `Room ${selectedRoom}: ${trimmed}`);
  };

  const sendDirective = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(directiveText);
    setDirectiveText('');
  };

  const injectRemoteDrill = (drillId: string) => {
    missionSocket.send('drill:inject', { drillId, sender: callsign });
    onAuditEvent?.('REMOTE_DRILL_INJECTED', 'NASA-STD-3001', `Injected ${drillId} into ${selectedRoom}`);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">
      <div className="bg-[#0B0E17] border border-slate-800 p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400">
            Team Live Link · {wsConnected ? '● Connected' : '▲ Connecting'}
          </p>
          <h1 className="text-2xl font-bold text-slate-100 mt-0.5">
            Mission Control & Team Radio
          </h1>
        </div>
        <button
          onClick={loadDirectory}
          className="px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Rooms</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-[#0B0E17] border border-slate-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-100 border-b border-slate-800 pb-2">
            Pick a Mission Room
          </h2>
          <div className="space-y-2">
            {rooms.map((r) => (
              <button
                key={r.roomId}
                onClick={() => setSelectedRoom(r.roomId)}
                className={`w-full text-left p-3 border transition-colors ${
                  selectedRoom === r.roomId
                    ? 'bg-cyan-950/30 border-cyan-500/70'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-slate-100">{r.roomId}</span>
                  <span className="text-xs font-mono text-cyan-300">{r.participantCount} online</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Mission: {r.mode === 'docking' ? 'Space Docking' : 'Moon/Mars Base'} · Alerts: {r.activeDrills.length}
                </p>
              </button>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-800 space-y-2">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span>Astronauts in Room ({participants.length})</span>
            </h3>
            {participants.length === 0 ? (
              <p className="text-xs text-slate-500">Nobody flying in this room right now.</p>
            ) : (
              <div className="space-y-1.5">
                {participants.map((p) => (
                  <div
                    key={p.clientId}
                    className="flex items-center justify-between text-xs bg-slate-900/70 border border-slate-800 px-3 py-1.5"
                  >
                    <span className="font-mono text-slate-100">{p.callsign}</span>
                    <span className="text-slate-400">
                      {p.role === 'commander' ? 'Pilot' : p.role === 'copilot' ? 'Co-Pilot' : 'Mission Control'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <div className="bg-[#0B0E17] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-100">
                Live Mission Screen · {selectedRoom}
              </h2>
              <span className="text-xs font-mono text-slate-400">
                {liveDocking
                  ? 'Space Docking Feed'
                  : liveOutpost
                  ? `${liveOutpost.theater === 'mars' ? 'Mars' : 'Moon'} Base Feed`
                  : 'Waiting for Pilot'}
              </span>
            </div>

            {liveDocking ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Distance</span>
                  <span className="font-mono text-xl font-bold text-slate-100">
                    {liveDocking.rangeMeters.toFixed(1)} m
                  </span>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Speed</span>
                  <span className="font-mono text-xl font-bold text-cyan-300">
                    {liveDocking.closureRateMs.toFixed(2)} m/s
                  </span>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Ship Tilt</span>
                  <span className="font-mono text-xl font-bold text-amber-300">
                    {liveDocking.alignmentErrorDeg.toFixed(0)}°
                  </span>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Fuel Left</span>
                  <span className="font-mono text-xl font-bold text-emerald-400">
                    {liveDocking.fuelRemainingPct}%
                  </span>
                </div>
              </div>
            ) : liveOutpost ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Fresh Oxygen</span>
                  <span className="font-mono text-xl font-bold text-emerald-400">{liveOutpost.o2Pct}%</span>
                  <span className="text-slate-400 block mt-0.5 font-mono">CO2 {liveOutpost.co2MmHg}</span>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Base Power</span>
                  <span className="font-mono text-xl font-bold text-cyan-300">{liveOutpost.totalPowerKw}</span>
                  <span className="text-slate-400 block mt-0.5 font-mono">Battery {liveOutpost.batteryPct}%</span>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Space Rays</span>
                  <span className="font-mono text-xl font-bold text-amber-300">{liveOutpost.radiationMsv}</span>
                  <span className="text-slate-400 block mt-0.5 font-mono">{liveOutpost.doseRateMsvHr}/hr</span>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 p-3">
                  <span className="text-slate-400 block">Crew Health</span>
                  <span className="font-mono text-xl font-bold text-slate-100">{liveOutpost.crewHealthPct}%</span>
                  <span className="text-slate-400 block mt-0.5 font-mono">Day {liveOutpost.sol}</span>
                </div>
              </div>
            ) : (
              <div className="border border-slate-800 bg-[#07090E] p-6 text-center text-sm text-slate-400">
                Have a teammate open Space Docking or Moon & Mars Base in another tab or device to watch them live!
              </div>
            )}

            <div className="pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 mb-2">
                <ShieldAlert className="w-4 h-4" />
                <span>Send a Surprise Challenge (Instructor / Teacher)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ['RCS_VALVE_STUCK', 'Stuck Jet'],
                  ['COAS_BLACKOUT', 'Foggy Camera'],
                  ['BUS_A_TRIP', 'Power Blink'],
                  ['SOLAR_FLARE_SPE', 'Solar Storm'],
                  ['HULL_MICROMETEOROID', 'Meteor Hole'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => injectRemoteDrill(id)}
                    className="px-3 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-200 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-[#0B0E17] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Radio className="w-4 h-4 text-cyan-400" />
              <span>Team Radio Messages</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_DIRECTIVES.map((msg) => (
                <button
                  key={msg}
                  type="button"
                  onClick={() => sendMessage(msg)}
                  className="px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-200 whitespace-nowrap"
                >
                  {msg}
                </button>
              ))}
            </div>

            <div className="h-40 overflow-y-auto bg-[#07090E] border border-slate-800 p-3 space-y-2">
              {directives.length === 0 ? (
                <p className="text-xs text-slate-500">No radio messages yet in {selectedRoom}.</p>
              ) : (
                directives.map((d) => (
                  <div key={d.id} className="text-xs border-b border-slate-800/60 pb-1.5">
                    <span className="font-mono text-cyan-300">{d.sender}</span>
                    <span className="text-slate-500 mx-1.5">·</span>
                    <span className="text-slate-200">{d.text}</span>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={sendDirective} className="flex items-center gap-2">
              <input
                type="text"
                value={directiveText}
                onChange={(e) => setDirectiveText(e.target.value)}
                placeholder="Type a friendly tip for the pilot..."
                className="flex-1 bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
