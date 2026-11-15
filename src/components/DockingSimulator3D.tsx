import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Eye,
  Flame,
  Gamepad2,
  Gauge,
  Glasses,
  Hand,
  Monitor,
  Music,
  Rocket,
  RotateCcw,
  Satellite,
  Save,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import type { CrewRole, DockingTelemetry, FlightDirective, NasaMissionFeed, SimulationRunRecord } from '../types/mission';
import { pollFlightHardware } from '../services/hardwareInput';
import { telemetryAudio } from '../services/telemetryAudio';
import { voiceGuide } from '../services/voiceGuide';
import { missionSocket, type RoomParticipant } from '../services/websocketClient';
import { animateAstronaut, createAstronautRig } from '../three/astronautCharacter';
import {
  createAtmosphereRimMaterial,
  createCloudLayerTexture,
  createEarthRealisticTexture,
  createGoldFoilTexture,
  createShuttleTileTexture,
  createSoftParticleTexture,
  createSolarCellTexture,
  createTileBumpTexture,
} from '../three/realisticMaterials';
import { ShuttleLaunchMission } from './ShuttleLaunchMission';
import { AskAiCoachPanel } from './AskAiCoachPanel';

interface DockingSimulator3DProps {
  callsign: string;
  isSignedIn: boolean;
  onSaveRun: (
    run: Omit<SimulationRunRecord, 'runId' | 'userId' | 'callsign' | 'instructorEmail' | 'createdAt'>
  ) => Promise<void>;
  onAuditEvent?: (action: string, standardRef: string, detail: string) => void;
}

type CameraPreset = 'chase' | 'coas' | 'station' | 'cockpit';

const DRILL_VOICE: Record<string, { speaker: 'maya' | 'leo' | 'sam'; text: string }> = {
  RCS_VALVE_STUCK: {
    speaker: 'sam',
    text: 'Alert! A side thruster valve is stuck open, pushing the shuttle sideways because of action and reaction! Tap the wrench button to shut the valve!',
  },
  COAS_BLACKOUT: {
    speaker: 'leo',
    text: 'Alert! Space dust fogged the front optical camera! Tap the radar fix button so radio waves can measure the station distance instead of light!',
  },
  BUS_A_TRIP: {
    speaker: 'sam',
    text: 'Alert! Main solar power bus blinked out! Tap the battery backup button to switch electricity cleanly to Bus B!',
  },
};

// Reusable scratch math objects outside render loop (zero GC)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

function createCoasTargetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#06B6D4';
  ctx.lineWidth = 6;
  [210, 140, 70].forEach((r) => {
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.strokeStyle = '#F8FAFC';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(256, 26);
  ctx.lineTo(256, 486);
  ctx.moveTo(26, 256);
  ctx.lineTo(486, 256);
  ctx.stroke();

  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.arc(256, 256, 14, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const DockingSimulator3D: React.FC<DockingSimulator3DProps> = ({
  callsign,
  isSignedIn,
  onSaveRun,
  onAuditEvent,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [missionPhase, setMissionPhase] = useState<'journey' | 'docking'>('journey');
  const [entryVeil, setEntryVeil] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('chase');
  const [easyMode, setEasyMode] = useState(true);
  const [precisionMode, setPrecisionMode] = useState(false);
  const [hoverSteerEnabled, setHoverSteerEnabled] = useState(true);
  const [stereoVrMode, setStereoVrMode] = useState(false);
  const [webXrSupported, setWebXrSupported] = useState(false);
  const [webXrActive, setWebXrActive] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [showAiCoach, setShowAiCoach] = useState(false);
  const [muted, setMuted] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(telemetryAudio.isMusicEnabled());
  const [voiceEnabled, setVoiceEnabled] = useState(voiceGuide.isEnabled());
  const [roomId, setRoomId] = useState('ISS-NODE-01');
  const [crewRole, setCrewRole] = useState<CrewRole>('commander');
  const [wsConnected, setWsConnected] = useState(false);
  const [, setParticipants] = useState<RoomParticipant[]>([]);
  const [, setDirectives] = useState<FlightDirective[]>([]);
  const [savingRun, setSavingRun] = useState(false);
  const [, setSaveNotice] = useState<string | null>(null);
  const [, setHardwareDevice] = useState<string | null>(null);
  const [webglFallback, setWebglFallback] = useState(false);
  const [nasaFeed, setNasaFeed] = useState<NasaMissionFeed | null>(null);

  const [telemetry, setTelemetry] = useState<DockingTelemetry>({
    posX: 1.8,
    posY: 1.0,
    posZ: 28.0,
    velX: 0,
    velY: 0,
    velZ: -0.08,
    pitchDeg: 0,
    yawDeg: 0,
    rollDeg: 0,
    angVelPitch: 0,
    angVelYaw: 0,
    angVelRoll: 0,
    rangeMeters: 26.55,
    closureRateMs: 0.08,
    lateralOffsetM: 2.06,
    alignmentErrorDeg: 0,
    fuelKg: 420,
    fuelRemainingPct: 100,
    rcsActive: [],
    captureLatchArmed: true,
    idaAlignmentOffset: 0,
    busBActive: false,
    radarBackupActive: false,
    dockingStatus: 'APPROACH',
    safetyScore: 100,
    elapsedSec: 0,
    activeDrills: [],
    vrActive: false,
    hardwareActive: false,
  });

  const simRef = useRef({
    pos: new THREE.Vector3(1.8, 1.0, 28.0),
    vel: new THREE.Vector3(0, 0, -0.08),
    rotDeg: new THREE.Vector3(0, 0, 0),
    angVelDeg: new THREE.Vector3(0, 0, 0),
    fuelKg: 420,
    maxFuelKg: 420,
    elapsedSec: 0,
    drillsResolved: 0,
    activeDrills: [] as string[],
    captureLatchArmed: true,
    idaAlignmentOffset: 0,
    busBActive: false,
    radarBackupActive: false,
    status: 'APPROACH' as DockingTelemetry['dockingStatus'],
    safetyScore: 100,
    keys: new Set<string>(),
    manualImpulse: { tx: 0, ty: 0, tz: 0, pitch: 0, yaw: 0, roll: 0, killRot: false },
    cameraPreset: 'chase' as CameraPreset,
    easyMode: true,
    precisionMode: false,
    hoverSteerEnabled: true,
    hoverSteer: {
      active: false,
      dragActive: false,
      normX: 0,
      normY: 0,
      dragYawDeg: 0,
      dragPitchDeg: 0,
      orbitYawRad: 0,
      orbitPitchRad: 0,
      spinYawDeg: 0,
    },
    stereoVrMode: false,
    crewRole: 'commander' as CrewRole,
    headOffsetYaw: 0,
    headOffsetPitch: 0,
    lastBroadcastAt: 0,
    spokenOutcome: false,
    captureProgress: 0,
  });

  const teachingDoneRef = useRef<Set<string>>(new Set());
  const backgroundTipIdxRef = useRef(0);
  const latestTelemetryRef = useRef(telemetry);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    latestTelemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    simRef.current.cameraPreset = cameraPreset;
  }, [cameraPreset]);

  useEffect(() => {
    simRef.current.easyMode = easyMode;
  }, [easyMode]);

  useEffect(() => {
    simRef.current.precisionMode = precisionMode;
  }, [precisionMode]);

  useEffect(() => {
    simRef.current.hoverSteerEnabled = hoverSteerEnabled;
  }, [hoverSteerEnabled]);

  useEffect(() => {
    simRef.current.stereoVrMode = stereoVrMode;
  }, [stereoVrMode]);

  useEffect(() => {
    simRef.current.crewRole = crewRole;
  }, [crewRole]);

  // Load live NASA orbit briefing & welcome spoken briefing when entering docking
  useEffect(() => {
    fetch('/api/nasa/mission-feed')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NasaMissionFeed | null) => {
        if (data) setNasaFeed(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (missionPhase !== 'docking') return;
    const t = window.setTimeout(() => {
      voiceGuide.speak(
        'Welcome to orbital docking, Junior Astronaut! Because there is no air friction in space, one gentle tap on W keeps you gliding forward. Use the arrow keys to fly inside the glowing guide rings!',
        { cooldownMs: 2000, speaker: 'maya', useNeuralTts: true }
      );
    }, 650);
    return () => window.clearTimeout(t);
  }, [missionPhase]);

  // Live spoken coaching & physics teaching alternating between Female (Maya) & Male (Leo/Sam) voices
  useEffect(() => {
    if (!voiceEnabled || missionPhase !== 'docking') return;
    const maxSafeSpeed = easyMode ? 0.45 : 0.25;
    const maxSafeOffset = easyMode ? 0.7 : 0.35;

    if (telemetry.dockingStatus === 'CAPTURED' && !simRef.current.spokenOutcome) {
      simRef.current.spokenOutcome = true;
      voiceGuide.speak(
        `Soft capture! Awesome flying, ${callsign}! Moving slowly tamed your shuttle momentum so the station latches clicked safely with a ${telemetry.safetyScore} percent score!`,
        { priority: true, speaker: 'maya', useNeuralTts: true }
      );
    } else if (telemetry.dockingStatus === 'COLLISION_ABORT' && !simRef.current.spokenOutcome) {
      simRef.current.spokenOutcome = true;
      voiceGuide.speak(
        'Whoops! Heavy shuttles carry lots of momentum, so fast speed makes a big bump. Tap Fly Again and tap Brake early to drift in like a feather!',
        { priority: true, speaker: 'leo', useNeuralTts: true }
      );
    } else if (telemetry.dockingStatus === 'APPROACH' || telemetry.dockingStatus === 'FINAL_CORRIDOR') {
      if (telemetry.closureRateMs > maxSafeSpeed) {
        voiceGuide.speak('Careful, too much speed builds momentum! Tap Spacebar or Brake to fire nose thrusters and slow down.', {
          speaker: 'leo',
        });
      } else if (telemetry.rangeMeters < 16 && telemetry.lateralOffsetM > maxSafeOffset + 0.3) {
        const dx = telemetry.posX - telemetry.idaAlignmentOffset;
        const dy = telemetry.posY;
        if (Math.abs(dx) >= Math.abs(dy)) {
          voiceGuide.speak(dx > 0 ? 'Tap left to push gas right and slide toward the glowing rings.' : 'Tap right to push gas left and slide toward the glowing rings.', {
            speaker: 'maya',
          });
        } else {
          voiceGuide.speak(dy > 0 ? 'Steer down gently into the guide rings.' : 'Steer up gently into the guide rings.', {
            speaker: 'leo',
          });
        }
      } else if (telemetry.rangeMeters < 8 && telemetry.lateralOffsetM <= maxSafeOffset) {
        if (!teachingDoneRef.current.has('corridor_momentum')) {
          teachingDoneRef.current.add('corridor_momentum');
          voiceGuide.speak(
            'Final corridor! Notice how tiny taps make smooth changes because nothing stops motion in vacuum until a thruster pushes back. Drift right into the center!',
            { speaker: 'maya', useNeuralTts: true }
          );
        } else {
          voiceGuide.speak('Almost there! Stay steady and drift smoothly into the docking port.', {
            speaker: 'maya',
          });
        }
      } else if (
        telemetry.elapsedSec >= 6 &&
        telemetry.rangeMeters >= 15 &&
        !teachingDoneRef.current.has('zero_g_inertia')
      ) {
        teachingDoneRef.current.add('zero_g_inertia');
        voiceGuide.speak(
          'Space science tip: in zero gravity there is no air pushing against you, so your shuttle keeps coasting at the same speed until you fire opposite thrusters!',
          { speaker: 'leo', useNeuralTts: true }
        );
      } else if (
        telemetry.rcsActive.length > 0 &&
        telemetry.elapsedSec >= 3 &&
        !teachingDoneRef.current.has('thruster_action_reaction')
      ) {
        teachingDoneRef.current.add('thruster_action_reaction');
        voiceGuide.speak(
          'Great steering! Those white gas puffs push one way to move your shuttle the opposite way—that is rocket action and reaction!',
          { speaker: 'sam', useNeuralTts: true }
        );
      }
    }
  }, [telemetry, easyMode, voiceEnabled, callsign, missionPhase]);

  // Continuous background guiding voice so pilots hear ongoing coaching & space science while playing
  useEffect(() => {
    if (!voiceEnabled || missionPhase !== 'docking' || showAiCoach) return;
    const interval = window.setInterval(() => {
      if (!voiceGuide.isEnabled() || voiceGuide.isSpeaking() || voiceGuide.isCoachBusy()) return;
      const t = latestTelemetryRef.current;
      if (t.dockingStatus !== 'APPROACH' && t.dockingStatus !== 'FINAL_CORRIDOR') return;

      const idx = backgroundTipIdxRef.current++;
      const speaker: 'maya' | 'leo' | 'sam' = idx % 3 === 0 ? 'maya' : idx % 3 === 1 ? 'leo' : 'sam';
      const maxSpeed = easyMode ? 0.45 : 0.25;

      let line = '';
      if (idx % 2 === 0) {
        if (t.rangeMeters > 16 && t.closureRateMs < 0.08) {
          line = `You are ${t.rangeMeters.toFixed(0)} meters from the station, ${callsign}. Give Forward or W a quick tap so orbital momentum carries you closer!`;
        } else if (t.lateralOffsetM > (easyMode ? 0.75 : 0.4)) {
          const dx = t.posX - t.idaAlignmentOffset;
          line =
            Math.abs(dx) > 0.35
              ? `Keep hovering or tapping ${dx > 0 ? 'Left' : 'Right'} to line your shuttle nose inside the glowing guide rings!`
              : `Adjust ${t.posY > 0 ? 'Down' : 'Up'} gently to center your flight path with the space station port!`;
        } else if (t.closureRateMs > maxSpeed * 0.88) {
          line = 'You are closing in! Keep a finger near Brake or Spacebar so you touch the station latches soft as a feather.';
        } else if (t.rangeMeters <= 8) {
          line = `Looking awesome! Just ${t.rangeMeters.toFixed(1)} meters left—hold steady and let those docking hooks lock on!`;
        } else {
          line = `Steady flying! ${t.fuelRemainingPct} percent thruster fuel left and ${t.rangeMeters.toFixed(0)} meters to go.`;
        }
      } else {
        const scienceFacts = [
          'Space science tip: because space has no air to slow you down, gliding slowly saves fuel for final braking!',
          'Fun fact: astronauts aboard the International Space Station orbit Earth sixteen times every single day!',
          'Notice how hovering or swiping rotates your shuttle and view? Real spacecraft use small side thrusters to turn cleanly in three dimensions.',
          'When your guide rings turn bright green, your sideways offset is safe for soft capture latches!',
          'Space station solar wings stretch wider than a football field to turn sunlight into electricity for the crew!',
        ];
        line = scienceFacts[Math.floor(idx / 2) % scienceFacts.length];
      }

      voiceGuide.speak(line, { cooldownMs: 9500, speaker, useNeuralTts: false });
    }, 10500);

    return () => window.clearInterval(interval);
  }, [voiceEnabled, missionPhase, easyMode, callsign, showAiCoach]);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr;
    if (xr?.isSessionSupported) {
      xr.isSessionSupported('immersive-vr')
        .then((supported) => setWebXrSupported(supported))
        .catch(() => setWebXrSupported(false));
    }
  }, []);

  useEffect(() => {
    missionSocket.connect(roomId, callsign, crewRole);
    const unsub = missionSocket.subscribe((ev) => {
      if (ev.type === 'ws:status') {
        setWsConnected(Boolean((ev.payload as { connected: boolean })?.connected));
      } else if (ev.type === 'session:welcome') {
        setWsConnected(true);
        const r = (ev.payload as { room?: { participants?: RoomParticipant[]; directives?: FlightDirective[]; activeDrills?: string[] } })?.room;
        if (r?.participants) setParticipants(r.participants);
        if (r?.directives) setDirectives(r.directives);
        if (r?.activeDrills) simRef.current.activeDrills = [...r.activeDrills];
      } else if (ev.type === 'room:state') {
        const r = ev.payload as { participants?: RoomParticipant[]; directives?: FlightDirective[] };
        if (r?.participants) setParticipants(r.participants);
        if (r?.directives) setDirectives(r.directives);
      } else if (ev.type === 'directive:received') {
        const d = ev.payload as FlightDirective;
        setDirectives((prev) => [...prev.slice(-14), d]);
        telemetryAudio.playAlertTone('caution');
        voiceGuide.speak(`Message from Mission Control: ${d.text}`, { priority: true });
      } else if (ev.type === 'drill:injected') {
        const { drillId } = ev.payload as { drillId: string };
        if (drillId && !simRef.current.activeDrills.includes(drillId)) {
          simRef.current.activeDrills = [...simRef.current.activeDrills, drillId];
          telemetryAudio.playAlertTone('critical');
          if (DRILL_VOICE[drillId]) {
            voiceGuide.speak(DRILL_VOICE[drillId].text, {
              priority: true,
              speaker: DRILL_VOICE[drillId].speaker,
              useNeuralTts: true,
            });
          }
        }
      } else if (ev.type === 'drill:cleared') {
        const { drillId } = ev.payload as { drillId: string };
        simRef.current.activeDrills = simRef.current.activeDrills.filter((d) => d !== drillId);
      } else if (ev.type === 'copilot:action') {
        const act = ev.payload as { action: string; value?: unknown };
        if (act.action === 'toggle_latch') {
          simRef.current.captureLatchArmed = Boolean(act.value);
        } else if (act.action === 'trim_ida') {
          simRef.current.idaAlignmentOffset = Number(act.value ?? 0);
        } else if (act.action === 'clear_drill') {
          const drillId = String(act.value || '');
          simRef.current.activeDrills = simRef.current.activeDrills.filter((d) => d !== drillId);
          simRef.current.drillsResolved += 1;
        }
      } else if (ev.type === 'telemetry:docking' && simRef.current.crewRole !== 'commander') {
        const remote = ev.payload as DockingTelemetry;
        simRef.current.pos.set(remote.posX, remote.posY, remote.posZ);
        simRef.current.vel.set(remote.velX, remote.velY, remote.velZ);
        simRef.current.rotDeg.set(remote.pitchDeg, remote.yawDeg, remote.rollDeg);
        simRef.current.fuelKg = (remote.fuelRemainingPct / 100) * simRef.current.maxFuelKg;
        simRef.current.status = remote.dockingStatus;
        simRef.current.safetyScore = remote.safetyScore;
        simRef.current.elapsedSec = remote.elapsedSec;
        simRef.current.activeDrills = remote.activeDrills || [];
      }
    });
    return unsub;
  }, [roomId, callsign, crewRole]);

  useEffect(() => {
    const handledKeys = new Set([
      ' ',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
      'w',
      'a',
      's',
      'd',
      'q',
      'e',
      'i',
      'j',
      'k',
      'l',
      'u',
      'o',
    ]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (handledKeys.has(key)) {
        e.preventDefault();
        simRef.current.keys.add(key);
      }
      if (key === 'h') {
        setDockCollapsed((prev) => !prev);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      simRef.current.keys.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Three.js enhanced orbital scene (runs when missionPhase === 'docking')
  useEffect(() => {
    if (missionPhase !== 'docking') return;
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFallback(true);
      return;
    }

    rendererRef.current = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglFallback(true);
    };
    const handleContextRestored = () => {
      setWebglFallback(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060c);
    scene.fog = new THREE.FogExp2(0x03060c, 0.0014);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      58,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      1200
    );
    const leftEyeCam = new THREE.PerspectiveCamera(68, 0.8, 0.1, 1200);
    const rightEyeCam = new THREE.PerspectiveCamera(68, 0.8, 0.1, 1200);

    const keySun = new THREE.DirectionalLight(0xfff4d6, 2.5);
    keySun.position.set(55, 42, 35);
    keySun.castShadow = !isSoftwareGl;
    keySun.shadow.mapSize.set(1024, 1024);
    keySun.shadow.bias = -0.0005;
    keySun.shadow.normalBias = 0.02;
    scene.add(keySun);

    const earthFill = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.85);
    scene.add(earthFill);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.9);
    rimLight.position.set(-35, -15, -45);
    scene.add(rimLight);

    // Sun Disc & Corona in deep sky
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(7, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    sunDisc.position.set(140, 105, -190);
    scene.add(sunDisc);

    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(12, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.24 })
    );
    sunGlow.position.copy(sunDisc.position);
    scene.add(sunGlow);

    // Realistic Starfield & Orbital Dust Motes
    const softTex = createSoftParticleTexture();
    const starCount = 1600;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 340 + Math.random() * 260;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      map: softTex,
      color: 0xf1f5f9,
      size: 2.2,
      transparent: true,
      alphaTest: 0.01,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(starGeo, starMat));

    const dustCount = 260;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 46;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 28;
      dustPos[i * 3 + 2] = -12 + Math.random() * 52;
    }
    const orbitalDustGeo = new THREE.BufferGeometry();
    orbitalDustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const orbitalDustMat = new THREE.PointsMaterial({
      map: softTex,
      color: 0xbae6fd,
      size: 0.18,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orbitalDust = new THREE.Points(orbitalDustGeo, orbitalDustMat);
    scene.add(orbitalDust);

    // Photorealistic Earth + Volumetric Cloud Layer + GLSL Fresnel Atmospheric Rim
    const earthTex = createEarthRealisticTexture();
    earthTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthGeo = new THREE.SphereGeometry(180, 64, 42);
    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTex,
      roughness: 0.65,
      metalness: 0.08,
      emissive: 0x05203c,
      emissiveIntensity: 0.28,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.position.set(0, -196, -30);
    scene.add(earthMesh);

    const earthCloudTex = createCloudLayerTexture();
    earthCloudTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthCloudsGeo = new THREE.SphereGeometry(181.3, 56, 36);
    const earthCloudsMat = new THREE.MeshStandardMaterial({
      map: earthCloudTex,
      transparent: true,
      opacity: 0.78,
      roughness: 0.9,
      depthWrite: false,
    });
    const earthCloudsMesh = new THREE.Mesh(earthCloudsGeo, earthCloudsMat);
    earthCloudsMesh.position.copy(earthMesh.position);
    scene.add(earthCloudsMesh);

    const atmoGeo = new THREE.SphereGeometry(186.2, 56, 36);
    const atmoMat = createAtmosphereRimMaterial(0x38bdf8, 0.92);
    const atmosphereHalo = new THREE.Mesh(atmoGeo, atmoMat);
    atmosphereHalo.position.copy(earthMesh.position);
    scene.add(atmosphereHalo);

    const shuttleTileTex = createShuttleTileTexture();
    shuttleTileTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const shuttleTileBumpTex = createTileBumpTexture();
    shuttleTileBumpTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const goldFoilTex = createGoldFoilTexture();
    goldFoilTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const whiteHullMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      map: shuttleTileTex,
      bumpMap: shuttleTileBumpTex,
      bumpScale: 0.022,
      roughness: 0.34,
      metalness: 0.24,
    });
    const darkTitaniumMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.28, metalness: 0.86 });
    const rccBlackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.74, metalness: 0.14 });
    const kaptonGoldMat = new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      map: goldFoilTex,
      bumpMap: goldFoilTex,
      bumpScale: 0.045,
      roughness: 0.22,
      metalness: 0.94,
      clearcoat: 0.75,
    });
    const solarTex = createSolarCellTexture();
    solarTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const solarMat = new THREE.MeshPhysicalMaterial({
      map: solarTex,
      roughness: 0.16,
      metalness: 0.68,
      clearcoat: 0.85,
    });
    const coasTex = createCoasTargetTexture();
    coasTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // --- TARGET ORBITAL STATION ---
    const stationGroup = new THREE.Group();
    const coreModule = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 11.5, 28), whiteHullMat);
    coreModule.rotation.x = Math.PI / 2;
    coreModule.position.z = -6.5;
    stationGroup.add(coreModule);

    const kaptonBand = new THREE.Mesh(new THREE.CylinderGeometry(2.22, 2.22, 3.0, 28), kaptonGoldMat);
    kaptonBand.rotation.x = Math.PI / 2;
    kaptonBand.position.z = -5.5;
    stationGroup.add(kaptonBand);

    const nodeSphere = new THREE.Mesh(new THREE.SphereGeometry(2.3, 28, 20), whiteHullMat);
    nodeSphere.position.z = -12.6;
    stationGroup.add(nodeSphere);

    // Cupola observation window dome with interior light glow
    const cupolaDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 20, 14),
      new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, roughness: 0.06, metalness: 0.18, clearcoat: 1 })
    );
    cupolaDome.position.set(0, 2.15, -6.5);
    stationGroup.add(cupolaDome);
    const cupolaGlow = new THREE.PointLight(0x38bdf8, 1.4, 8);
    cupolaGlow.position.set(0, 2.5, -6.5);
    stationGroup.add(cupolaGlow);

    // Detailed International Docking Adapter (IDSS Soft-Capture Ring + Petals + Clamping Latches)
    const idaRing = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.15, 16, 36), darkTitaniumMat);
    idaRing.position.z = 0;
    stationGroup.add(idaRing);

    const idaInnerCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 1.18, 1.15, 28), darkTitaniumMat);
    idaInnerCollar.rotation.x = Math.PI / 2;
    idaInnerCollar.position.z = -0.55;
    stationGroup.add(idaInnerCollar);

    const softCaptureGroup = new THREE.Group();
    softCaptureGroup.position.z = 0.28;
    stationGroup.add(softCaptureGroup);

    const idaSealMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.75,
      roughness: 0.28,
      metalness: 0.65,
    });
    const softCaptureRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.085, 14, 32), idaSealMat);
    softCaptureGroup.add(softCaptureRing);

    const petalGeo = new THREE.BoxGeometry(0.32, 0.44, 0.08);
    const hookGeo = new THREE.BoxGeometry(0.14, 0.28, 0.14);
    const latchHooks: THREE.Mesh[] = [];
    [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].forEach((ang) => {
      const petalHolder = new THREE.Group();
      petalHolder.rotation.z = ang;
      const petal = new THREE.Mesh(petalGeo, darkTitaniumMat);
      petal.position.set(0, 1.02, 0.18);
      petal.rotation.x = -0.52;
      petalHolder.add(petal);

      const latch = new THREE.Mesh(hookGeo, kaptonGoldMat);
      latch.position.set(0, 1.05, 0.05);
      latch.rotation.x = 0.28;
      petalHolder.add(latch);
      latchHooks.push(latch);
      softCaptureGroup.add(petalHolder);
    });

    const coasPlate = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 32),
      new THREE.MeshBasicMaterial({ map: coasTex })
    );
    coasPlate.position.z = -0.02;
    stationGroup.add(coasPlate);

    // Alignment Laser Beam along docking corridor centerline
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    const laserBeamGeo = new THREE.CylinderGeometry(0.016, 0.016, 25, 8);
    const alignLaser = new THREE.Mesh(laserBeamGeo, laserMat);
    alignLaser.rotation.x = Math.PI / 2;
    alignLaser.position.z = 12.6;
    stationGroup.add(alignLaser);

    // Docking Port Floodlight illuminating Shuttle Nose + Station Latch Ring
    const portFloodLight = new THREE.PointLight(0xe0f2fe, 2.2, 14);
    portFloodLight.position.set(0, 1.4, 1.2);
    stationGroup.add(portFloodLight);

    // Lab Portholes along ISS Core Module & Port/Starboard Aviation Strobes
    const portholeGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16);
    const portholeMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
    [-4.0, -6.5, -9.0].forEach((pz) => {
      [-2.14, 2.14].forEach((px) => {
        const portWin = new THREE.Mesh(portholeGeo, portholeMat);
        portWin.rotation.z = Math.PI / 2;
        portWin.position.set(px, 0.35, pz);
        stationGroup.add(portWin);
      });
    });

    const portNavStrobe = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    portNavStrobe.position.set(-10.8, 0.32, -8);
    stationGroup.add(portNavStrobe);
    const stbdNavStrobe = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    stbdNavStrobe.position.set(10.8, 0.32, -8);
    stationGroup.add(stbdNavStrobe);

    // Blinking Docking Port Beacon Lights
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    [
      [1.2, 0, 0.05],
      [-1.2, 0, 0.05],
      [0, 1.2, 0.05],
      [0, -1.2, 0.05],
    ].forEach(([bx, by, bz]) => {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), beaconMat);
      beacon.position.set(bx, by, bz);
      stationGroup.add(beacon);
    });

    // Truss, Solar Wings & Radiators
    const truss = new THREE.Mesh(new THREE.BoxGeometry(22, 0.42, 0.42), darkTitaniumMat);
    truss.position.set(0, 0, -8);
    stationGroup.add(truss);

    [-8.4, 8.4].forEach((sx) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.07, 2.5), solarMat);
      wing.position.set(sx, 0, -8);
      stationGroup.add(wing);
      const wingGimbal = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 12), kaptonGoldMat);
      wingGimbal.rotation.z = Math.PI / 2;
      wingGimbal.position.set(sx > 0 ? 5.2 : -5.2, 0, -8);
      stationGroup.add(wingGimbal);
    });

    [-4.2, 4.2].forEach((rx) => {
      const rad = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.8, 0.06), whiteHullMat);
      rad.position.set(rx, 2.1, -9.2);
      stationGroup.add(rad);
    });

    // Canadarm2 Robotic Arm mounted on the Space Station Truss
    const armGroup = new THREE.Group();
    armGroup.position.set(3.2, 0.5, -6.5);
    const armBoom1 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.2, 12), whiteHullMat);
    armBoom1.position.set(0, 1.5, 0);
    armBoom1.rotation.z = -0.35;
    armGroup.add(armBoom1);
    const armJoint = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 14), kaptonGoldMat);
    armJoint.position.set(0.55, 2.95, 0);
    armGroup.add(armJoint);
    const armBoom2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 12), whiteHullMat);
    armBoom2.position.set(1.3, 3.4, 0.8);
    armBoom2.rotation.set(0.6, 0, -1.1);
    armGroup.add(armBoom2);
    stationGroup.add(armGroup);

    // Visiting Crew Capsule docked at Zenith ISS Port for scale & realism
    const visitingPod = new THREE.Group();
    visitingPod.position.set(0, 3.6, -12.6);
    const podBody = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.2, 20), whiteHullMat);
    visitingPod.add(podBody);
    const podTrunk = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 20), whiteHullMat);
    podTrunk.position.y = -1.6;
    visitingPod.add(podTrunk);
    const podCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.72, 0.5, 16), kaptonGoldMat);
    podCollar.position.y = -2.6;
    visitingPod.add(podCollar);
    stationGroup.add(visitingPod);

    // 6 Luminous Alignment Guide Rings forming a glowing Space Corridor
    const guideRingMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    const guideRings: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.045, 10, 36), guideRingMat);
      ring.position.z = 2.8 + i * 4.2;
      stationGroup.add(ring);
      guideRings.push(ring);
    }

    scene.add(stationGroup);

    // --- WINGED SPACE SHUTTLE ORBITER WITH VISIBLE COCKPIT PILOTS MAYA & LEO ---
    const capsuleGroup = new THREE.Group();
    const crewCone = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.82, 2.3, 28), whiteHullMat);
    crewCone.rotation.x = Math.PI / 2;
    crewCone.position.z = -0.35;
    capsuleGroup.add(crewCone);

    // Panoramic Transparent Cockpit Glass Dome so Maya, Sam & Leo are clearly visible inside!
    const cockpitCanopyGlass = new THREE.Mesh(
      new THREE.SphereGeometry(1.18, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.56),
      new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.16,
        roughness: 0.05,
        clearcoat: 1.0,
        depthWrite: false,
      })
    );
    cockpitCanopyGlass.position.set(0, 0.84, 0.26);
    cockpitCanopyGlass.scale.set(1.12, 0.78, 1.35);
    cockpitCanopyGlass.renderOrder = 6;
    capsuleGroup.add(cockpitCanopyGlass);

    // Interior Instrument Fill Light illuminating Maya, Sam & Leo inside the Shuttle Dome
    const cockpitDomeLight = new THREE.PointLight(0xe0f2fe, 2.2, 5.5);
    cockpitDomeLight.position.set(0, 1.48, 0.12);
    capsuleGroup.add(cockpitDomeLight);

    // Animated Live Avionics Glass Cockpit MFD Screen
    const dashCanvas = document.createElement('canvas');
    dashCanvas.width = 256;
    dashCanvas.height = 64;
    const dashCtx = dashCanvas.getContext('2d')!;
    const dashTex = new THREE.CanvasTexture(dashCanvas);
    dashTex.colorSpace = THREE.SRGBColorSpace;
    const dashGlow = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.28, 0.22),
      new THREE.MeshBasicMaterial({ map: dashTex })
    );
    dashGlow.position.set(0, 0.8, -0.58);
    capsuleGroup.add(dashGlow);

    // Commander Maya, Flight Director Sam & Pilot Leo ALL seated together in the Shuttle Cockpit
    const mayaCabinRig = createAstronautRig('maya', 0.42);
    mayaCabinRig.root.position.set(-0.37, 0.65, 0.04);
    mayaCabinRig.root.rotation.y = Math.PI * 0.92;
    capsuleGroup.add(mayaCabinRig.root);

    const samCabinRig = createAstronautRig('sam', 0.41);
    samCabinRig.root.position.set(0, 0.72, 0.36);
    samCabinRig.root.rotation.y = Math.PI;
    capsuleGroup.add(samCabinRig.root);

    const leoCabinRig = createAstronautRig('leo', 0.41);
    leoCabinRig.root.position.set(0.37, 0.65, 0.04);
    leoCabinRig.root.rotation.y = -Math.PI * 0.92;
    capsuleGroup.add(leoCabinRig.root);

    const dockingCollar = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.1, 14, 32), darkTitaniumMat);
    dockingCollar.position.z = -1.52;
    capsuleGroup.add(dockingCollar);

    const heatShield = new THREE.Mesh(new THREE.CylinderGeometry(1.88, 1.75, 0.32, 28), rccBlackMat);
    heatShield.rotation.x = Math.PI / 2;
    heatShield.position.z = 0.92;
    capsuleGroup.add(heatShield);

    const serviceModule = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.52, 2.7, 28), whiteHullMat);
    serviceModule.rotation.x = Math.PI / 2;
    serviceModule.position.z = 2.4;
    capsuleGroup.add(serviceModule);

    // Black RCC Thermal Belly Shielding
    const bellyShield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 3.6), rccBlackMat);
    bellyShield.position.set(0, -1.32, 1.8);
    capsuleGroup.add(bellyShield);

    // Twin OMS Aft Pods
    [-1.25, 1.25].forEach((ox) => {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 8, 12), whiteHullMat);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(ox, 0.55, 3.3);
      capsuleGroup.add(pod);
    });

    // Swept Space Shuttle Delta Wings & Vertical Tail Fin with Black RCC Leading Edges
    const shuttleWingMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      map: shuttleTileTex,
      bumpMap: shuttleTileBumpTex,
      bumpScale: 0.02,
      roughness: 0.36,
      metalness: 0.24,
    });
    const deltaWingGeo = new THREE.BoxGeometry(3.15, 0.1, 2.05);
    [-2.4, 2.4].forEach((wx) => {
      const wing = new THREE.Mesh(deltaWingGeo, shuttleWingMat);
      wing.position.set(wx, -0.35, 2.35);
      wing.rotation.y = wx < 0 ? 0.36 : -0.36;
      capsuleGroup.add(wing);

      const leadingEdge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.22), rccBlackMat);
      leadingEdge.position.set(wx, -0.35, 1.42);
      leadingEdge.rotation.y = wx < 0 ? 0.36 : -0.36;
      capsuleGroup.add(leadingEdge);
    });
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.75, 1.25), shuttleWingMat);
    tailFin.position.set(0, 1.45, 3.25);
    tailFin.rotation.x = -0.25;
    capsuleGroup.add(tailFin);

    // Triple Clustered RS-25 Main Engine Bells
    const rs25Geo = new THREE.CylinderGeometry(0.24, 0.44, 0.72, 20);
    [
      [0, 0.36, 4.05],
      [-0.45, -0.28, 4.05],
      [0.45, -0.28, 4.05],
    ].forEach(([ex, ey, ez]) => {
      const bell = new THREE.Mesh(rs25Geo, darkTitaniumMat);
      bell.rotation.x = Math.PI / 2;
      bell.position.set(ex, ey, ez);
      capsuleGroup.add(bell);
    });

    // Multi-layered glowing plasma thruster plumes (Additive core + halo)
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const plumeCoreMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const makePlume = (rx: number, rz: number, x: number, y: number, z: number, scale = 1) => {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.24 * scale, 1.25 * scale, 12), plumeMat);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11 * scale, 0.75 * scale, 10), plumeCoreMat);
      g.add(outer, inner);
      g.rotation.set(rx, 0, rz);
      g.position.set(x, y, z);
      g.visible = false;
      capsuleGroup.add(g);
      return g;
    };
    const plumeFore = makePlume(-Math.PI / 2, 0, 0, 1.25, -1.65);
    const plumeAft = makePlume(Math.PI / 2, 0, 0, 0, 4.9, 1.35);
    const plumePort = makePlume(0, -Math.PI / 2, 1.95, 0, 1.8);
    const plumeStbd = makePlume(0, Math.PI / 2, -1.95, 0, 1.8);
    const plumeUp = makePlume(Math.PI, 0, 0, -1.85, 1.8);
    const plumeDown = makePlume(0, 0, 0, 1.85, 1.8);

    scene.add(capsuleGroup);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    renderer.domElement.style.touchAction = 'none';
    let dragging = false;
    let activePointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const updateNormalizedHover = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const rawX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const rawY = ((clientY - rect.top) / rect.height) * 2 - 1;
      const dead = 0.06;
      const applyDead = (v: number) => {
        const clamped = THREE.MathUtils.clamp(v, -1, 1);
        if (Math.abs(clamped) < dead) return 0;
        return ((Math.abs(clamped) - dead) / (1 - dead)) * Math.sign(clamped);
      };
      simRef.current.hoverSteer.normX = applyDead(rawX);
      simRef.current.hoverSteer.normY = applyDead(rawY);
      simRef.current.hoverSteer.active = true;
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      activePointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      simRef.current.hoverSteer.dragActive = true;
      updateNormalizedHover(e.clientX, e.clientY);
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures on synthetic events
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.target === renderer.domElement || dragging) {
        updateNormalizedHover(e.clientX, e.clientY);
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      const s = simRef.current;
      s.headOffsetYaw = THREE.MathUtils.clamp(s.headOffsetYaw - dx * 0.0045, -1.2, 1.2);
      s.headOffsetPitch = THREE.MathUtils.clamp(s.headOffsetPitch - dy * 0.0045, -0.7, 0.7);
      s.hoverSteer.orbitYawRad -= dx * 0.009;
      s.hoverSteer.orbitPitchRad = THREE.MathUtils.clamp(s.hoverSteer.orbitPitchRad + dy * 0.006, -0.55, 0.95);

      if (s.crewRole === 'commander' && (s.status === 'APPROACH' || s.status === 'FINAL_CORRIDOR')) {
        s.hoverSteer.spinYawDeg -= dx * 0.28;
        s.hoverSteer.dragYawDeg = THREE.MathUtils.clamp(s.hoverSteer.dragYawDeg - dx * 0.16, -32, 32);
        s.hoverSteer.dragPitchDeg = THREE.MathUtils.clamp(s.hoverSteer.dragPitchDeg - dy * 0.14, -22, 22);
        if (!s.easyMode) {
          s.rotDeg.y -= dx * 0.24;
          s.rotDeg.x = THREE.MathUtils.clamp(s.rotDeg.x - dy * 0.14, -35, 35);
        }
      }
    };

    const endDrag = (e?: PointerEvent) => {
      if (e && activePointerId !== null && e.pointerId === activePointerId) {
        try {
          if (renderer.domElement.hasPointerCapture(activePointerId)) {
            renderer.domElement.releasePointerCapture(activePointerId);
          }
        } catch {
          // Ignore release errors
        }
      }
      dragging = false;
      activePointerId = null;
      simRef.current.hoverSteer.dragActive = false;
      if (e && e.pointerType !== 'mouse') {
        simRef.current.hoverSteer.active = false;
        simRef.current.hoverSteer.normX = 0;
        simRef.current.hoverSteer.normY = 0;
      }
    };

    const onPointerLeave = (e: PointerEvent) => {
      if (dragging) return;
      if (e.pointerType === 'mouse') {
        simRef.current.hoverSteer.active = false;
        simRef.current.hoverSteer.normX = 0;
        simRef.current.hoverSteer.normY = 0;
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    const handleResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    let lastTime = performance.now();
    let hudSyncAcc = 0;
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;

      const s = simRef.current;
      const hw = pollFlightHardware();
      if (hw.connected && hw.deviceName) {
        setHardwareDevice((prev) => (prev === hw.deviceName ? prev : hw.deviceName));
      }

      const rcsActive: string[] = [];
      if (s.status === 'APPROACH' || s.status === 'FINAL_CORRIDOR') {
        s.elapsedSec += dt;

        const isCommander = s.crewRole === 'commander';
        const gain = s.precisionMode ? 0.32 : s.easyMode ? 0.72 : 1.0;

        if (isCommander && s.fuelKg > 0) {
          let tx = s.manualImpulse.tx + hw.translateX;
          let ty = s.manualImpulse.ty + hw.translateY;
          let tz = s.manualImpulse.tz + hw.translateZ;
          let pCmd = s.manualImpulse.pitch + hw.pitch;
          let yCmd = s.manualImpulse.yaw + hw.yaw;
          let rCmd = s.manualImpulse.roll + hw.roll;

          if (s.keys.has('w')) tz -= 1;
          if (s.keys.has('s')) tz += 1;
          if (s.keys.has('a') || s.keys.has('arrowleft')) tx -= 1;
          if (s.keys.has('d') || s.keys.has('arrowright')) tx += 1;
          if (s.keys.has('q') || s.keys.has('arrowup')) ty += 1;
          if (s.keys.has('e') || s.keys.has('arrowdown')) ty -= 1;

          if (s.keys.has('i')) pCmd += 1;
          if (s.keys.has('k')) pCmd -= 1;
          if (s.keys.has('j')) yCmd += 1;
          if (s.keys.has('l')) yCmd -= 1;
          if (s.keys.has('u')) rCmd += 1;
          if (s.keys.has('o')) rCmd -= 1;

          const steerEngaged =
            s.hoverSteerEnabled &&
            (s.hoverSteer.active ||
              s.hoverSteer.dragActive ||
              Math.abs(s.hoverSteer.dragYawDeg) > 0.1 ||
              Math.abs(s.hoverSteer.dragPitchDeg) > 0.1);
          const steerX = steerEngaged ? s.hoverSteer.normX : 0;
          const steerY = steerEngaged ? s.hoverSteer.normY : 0;

          if (steerEngaged && !s.keys.has(' ')) {
            // Hovering near outer half rotates the ship and camera continuously around 360 degrees
            if (!s.hoverSteer.dragActive && Math.abs(steerX) > 0.34) {
              const edgeSpin = (Math.abs(steerX) - 0.34) * Math.sign(steerX);
              s.hoverSteer.spinYawDeg -= edgeSpin * 58 * dt;
              s.hoverSteer.orbitYawRad -= edgeSpin * 1.15 * dt;
            }
            // Hovering or dragging on screen smoothly steers translation aligned to heading
            tx += steerX * 0.52;
            ty += -steerY * 0.45;
            if (!s.easyMode) {
              yCmd += -steerX * 1.1;
              pCmd += -steerY * 0.9;
              rCmd += -steerX * 0.45;
            }
          }

          if (!s.hoverSteer.dragActive) {
            s.hoverSteer.dragYawDeg = THREE.MathUtils.damp(s.hoverSteer.dragYawDeg, 0, 2.2, dt);
            s.hoverSteer.dragPitchDeg = THREE.MathUtils.damp(s.hoverSteer.dragPitchDeg, 0, 2.2, dt);
          }

          const brakeHold = s.keys.has(' ') || s.manualImpulse.killRot || hw.killRotationPressed;

          const transAccel = 0.7 * gain;
          const rotAccelDeg = 12.0 * gain;

          _euler.set(
            THREE.MathUtils.degToRad(s.rotDeg.x),
            THREE.MathUtils.degToRad(s.rotDeg.y),
            THREE.MathUtils.degToRad(s.rotDeg.z)
          );
          _q1.setFromEuler(_euler);
          _v1.set(tx * transAccel * dt, ty * transAccel * dt, tz * transAccel * dt).applyQuaternion(_q1);
          s.vel.add(_v1);

          if (s.easyMode && Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05) {
            s.vel.x = THREE.MathUtils.damp(s.vel.x, 0, 1.35, dt);
            s.vel.y = THREE.MathUtils.damp(s.vel.y, 0, 1.35, dt);
          }

          if (s.activeDrills.includes('RCS_VALVE_STUCK')) {
            s.vel.x += 0.09 * dt;
            if (!s.easyMode) s.angVelDeg.y += 1.4 * dt;
          }

          const noseDistNow = Math.max(0, s.pos.z - 1.45);
          const nearPortBlend = noseDistNow < 2.8 ? THREE.MathUtils.clamp((noseDistNow - 0.3) / 2.5, 0.15, 1) : 1;

          if (noseDistNow < 3.0 && s.easyMode) {
            // Gently line nose & orbit forward cleanly during final docking capture
            s.hoverSteer.spinYawDeg = THREE.MathUtils.damp(s.hoverSteer.spinYawDeg, 0, 4.0, dt);
            s.hoverSteer.orbitYawRad = THREE.MathUtils.damp(s.hoverSteer.orbitYawRad, 0, 4.0, dt);
          }

          if (brakeHold) {
            s.angVelDeg.x = THREE.MathUtils.damp(s.angVelDeg.x, 0, 6.0, dt);
            s.angVelDeg.y = THREE.MathUtils.damp(s.angVelDeg.y, 0, 6.0, dt);
            s.angVelDeg.z = THREE.MathUtils.damp(s.angVelDeg.z, 0, 6.0, dt);
            s.hoverSteer.dragYawDeg = THREE.MathUtils.damp(s.hoverSteer.dragYawDeg, 0, 6.0, dt);
            s.hoverSteer.dragPitchDeg = THREE.MathUtils.damp(s.hoverSteer.dragPitchDeg, 0, 6.0, dt);
            s.hoverSteer.spinYawDeg = THREE.MathUtils.damp(s.hoverSteer.spinYawDeg, 0, 5.0, dt);
            s.hoverSteer.orbitYawRad = THREE.MathUtils.damp(s.hoverSteer.orbitYawRad, 0, 4.5, dt);
            if (s.easyMode) {
              s.vel.x = THREE.MathUtils.damp(s.vel.x, 0, 4.5, dt);
              s.vel.y = THREE.MathUtils.damp(s.vel.y, 0, 4.5, dt);
              s.vel.z = THREE.MathUtils.damp(s.vel.z, 0, 4.5, dt);
              s.rotDeg.x = THREE.MathUtils.damp(s.rotDeg.x, 0, 5.5, dt);
              s.rotDeg.y = THREE.MathUtils.damp(s.rotDeg.y, 0, 5.5, dt);
              s.rotDeg.z = THREE.MathUtils.damp(s.rotDeg.z, 0, 5.5, dt);
            }
            rcsActive.push('BRAKE');
          } else if (s.easyMode) {
            const targetYaw = steerEngaged
              ? (s.hoverSteer.spinYawDeg - steerX * 15.0 + s.hoverSteer.dragYawDeg * 0.5) * nearPortBlend
              : s.hoverSteer.spinYawDeg * nearPortBlend;
            const targetPitch = steerEngaged
              ? (-steerY * 10.5 + s.hoverSteer.dragPitchDeg * 0.7) * nearPortBlend
              : 0;
            const targetRoll = steerEngaged ? (-steerX * 9.0 + s.hoverSteer.dragYawDeg * 0.25) * nearPortBlend : 0;
            const turnRate = steerEngaged ? 6.2 : 3.6;
            s.rotDeg.x = THREE.MathUtils.damp(s.rotDeg.x, THREE.MathUtils.clamp(targetPitch, -20, 20), turnRate, dt);
            s.rotDeg.y = THREE.MathUtils.damp(s.rotDeg.y, targetYaw, turnRate, dt);
            s.rotDeg.z = THREE.MathUtils.damp(s.rotDeg.z, THREE.MathUtils.clamp(targetRoll, -16, 16), turnRate, dt);
            s.angVelDeg.set(0, 0, 0);
          } else {
            s.angVelDeg.x += pCmd * rotAccelDeg * dt;
            s.angVelDeg.y += yCmd * rotAccelDeg * dt;
            s.angVelDeg.z += rCmd * rotAccelDeg * dt;
            if (steerEngaged) {
              s.angVelDeg.x = THREE.MathUtils.damp(s.angVelDeg.x, 0, 1.8, dt);
              s.angVelDeg.y = THREE.MathUtils.damp(s.angVelDeg.y, 0, 1.8, dt);
              s.angVelDeg.z = THREE.MathUtils.damp(s.angVelDeg.z, 0, 2.2, dt);
            }
          }

          const anyThrust =
            Math.abs(tx) > 0.05 ||
            Math.abs(ty) > 0.05 ||
            Math.abs(tz) > 0.05 ||
            Math.abs(pCmd) > 0.05 ||
            Math.abs(yCmd) > 0.05 ||
            Math.abs(rCmd) > 0.05;

          if (tx < -0.1) rcsActive.push('LEFT');
          if (tx > 0.1) rcsActive.push('RIGHT');
          if (ty > 0.1) rcsActive.push('UP');
          if (ty < -0.1) rcsActive.push('DOWN');
          if (tz < -0.1) rcsActive.push('CLOSER');
          if (tz > 0.1) rcsActive.push('BACK');

          plumeFore.visible = tz > 0.1;
          plumeAft.visible = tz < -0.1;
          plumePort.visible = tx < -0.1;
          plumeStbd.visible = tx > 0.1;
          plumeUp.visible = ty > 0.1;
          plumeDown.visible = ty < -0.1;

          const manualButtonOrKeyThrust =
            Math.abs(s.manualImpulse.tx) > 0.05 ||
            Math.abs(s.manualImpulse.ty) > 0.05 ||
            Math.abs(s.manualImpulse.tz) > 0.05 ||
            s.keys.size > 0;
          if (anyThrust) {
            const burnScale = manualButtonOrKeyThrust ? 1.0 : 0.22;
            const burnRate = (s.easyMode ? 1.1 : 1.8) * gain * burnScale * dt;
            s.fuelKg = Math.max(0, s.fuelKg - burnRate);
            if (manualButtonOrKeyThrust) telemetryAudio.playThrusterPulse();
          }
        } else {
          plumeFore.visible = false;
          plumeAft.visible = false;
          plumePort.visible = false;
          plumeStbd.visible = false;
          plumeUp.visible = false;
          plumeDown.visible = false;
        }

        s.pos.addScaledVector(s.vel, dt);
        s.rotDeg.addScaledVector(s.angVelDeg, dt);

        const noseZ = s.pos.z - 1.45;
        const lateralOffsetM = Math.hypot(s.pos.x - s.idaAlignmentOffset, s.pos.y);
        const alignmentErrorDeg = Math.hypot(s.rotDeg.x, s.rotDeg.y, s.rotDeg.z * 0.5);
        const closureRateMs = -s.vel.z;

        if (noseZ <= 8.0 && s.status === 'APPROACH') {
          s.status = 'FINAL_CORRIDOR';
        }

        if (noseZ <= 0.18) {
          const maxSpeed = s.easyMode ? 0.45 : 0.25;
          const maxLat = s.easyMode ? 0.7 : 0.35;
          const maxAngle = s.easyMode ? 10.0 : 4.5;

          const safeSpeed = closureRateMs > 0 && closureRateMs <= maxSpeed;
          const safeLateral = lateralOffsetM <= maxLat;
          const safeAngle = alignmentErrorDeg <= maxAngle;
          const drillsClear = s.activeDrills.length === 0;

          if (safeSpeed && safeLateral && safeAngle && s.captureLatchArmed && drillsClear) {
            s.status = 'CAPTURED';
            s.captureProgress = 0;
            s.vel.set(0, 0, 0);
            s.angVelDeg.set(0, 0, 0);
            const fuelBonus = (s.fuelKg / s.maxFuelKg) * 20;
            const speedBonus = Math.max(0, (maxSpeed - closureRateMs) * 45);
            s.safetyScore = Math.round(Math.min(100, 72 + fuelBonus + speedBonus));
            telemetryAudio.playCaptureChime();
          } else {
            s.status = 'COLLISION_ABORT';
            s.vel.z = Math.abs(s.vel.z) * 0.4 + 0.22;
            s.safetyScore = Math.max(20, Math.round(58 - lateralOffsetM * 10 - Math.abs(closureRateMs) * 20));
            telemetryAudio.playAlertTone('critical');
          }
        }
      }

      // Soft-Capture -> Hard-Mate Mechanical Berthing Sequence on the Space Station
      if (s.status === 'CAPTURED') {
        s.captureProgress = Math.min(1, s.captureProgress + dt * 0.85);
        const cp = s.captureProgress;
        const ease = 1 - Math.pow(1 - cp, 3);
        const cushionSpring = Math.sin(cp * Math.PI * 2.5) * Math.exp(-cp * 4.5) * 0.04;
        s.pos.x = THREE.MathUtils.damp(s.pos.x, s.idaAlignmentOffset, 8, dt);
        s.pos.y = THREE.MathUtils.damp(s.pos.y, 0, 8, dt);
        s.pos.z = THREE.MathUtils.lerp(1.66, 1.48, ease) + cushionSpring;
        s.rotDeg.x = THREE.MathUtils.damp(s.rotDeg.x, 0, 8, dt);
        s.rotDeg.y = THREE.MathUtils.damp(s.rotDeg.y, 0, 8, dt);
        s.rotDeg.z = THREE.MathUtils.damp(s.rotDeg.z, 0, 8, dt);
        softCaptureGroup.position.z = THREE.MathUtils.lerp(0.28, 0.02, ease);
        latchHooks.forEach((lh) => {
          lh.rotation.x = THREE.MathUtils.lerp(0.28, -0.45, ease);
        });
        idaSealMat.color.setHex(0x10b981);
        idaSealMat.emissive.setHex(0x059669);
        idaSealMat.emissiveIntensity = 1.45;
        alignLaser.visible = false;
      } else {
        softCaptureGroup.position.z = 0.28;
        latchHooks.forEach((lh) => {
          lh.rotation.x = 0.28;
        });
        idaSealMat.color.setHex(s.status === 'COLLISION_ABORT' ? 0xf43f5e : 0x0ea5e9);
        idaSealMat.emissive.setHex(s.status === 'COLLISION_ABORT' ? 0xe11d48 : 0x0284c7);
        idaSealMat.emissiveIntensity = 0.75;
        alignLaser.visible = true;
      }

      // Color-code the glowing guide rings & alignment laser based on ship alignment!
      const latErrNow = Math.hypot(s.pos.x - s.idaAlignmentOffset, s.pos.y);
      const ringAligned = latErrNow <= (s.easyMode ? 0.7 : 0.35);
      guideRingMat.color.setHex(ringAligned ? 0x10b981 : 0x06b6d4);
      laserMat.color.setHex(ringAligned ? 0x10b981 : 0x22d3ee);
      guideRings.forEach((r, idx) => {
        r.visible = s.status === 'APPROACH' || s.status === 'FINAL_CORRIDOR';
        const pulseScale = 1 + Math.sin(now * 0.004 - idx * 0.6) * 0.05;
        r.scale.set(pulseScale, pulseScale, 1);
      });
      beaconMat.color.setHex(
        s.status === 'CAPTURED' ? 0x10b981 : Math.floor(now / 500) % 2 === 0 ? 0x22d3ee : 0xf59e0b
      );
      const strobeOn = Math.floor(now / 700) % 2 === 0;
      portNavStrobe.visible = strobeOn;
      stbdNavStrobe.visible = strobeOn;

      capsuleGroup.position.copy(s.pos);
      capsuleGroup.rotation.set(
        THREE.MathUtils.degToRad(s.rotDeg.x),
        THREE.MathUtils.degToRad(s.rotDeg.y),
        THREE.MathUtils.degToRad(s.rotDeg.z),
        'YXZ'
      );

      // Animate Commander Maya, Director Sam & Pilot Leo inside cockpit synced to real speech words
      const timeSec = now * 0.001;
      const lip = voiceGuide.getLipSyncState();
      const lipOpenFor = (who: 'maya' | 'leo' | 'sam') => (lip.speaker === who ? lip.openness : 0);

      animateAstronaut(mayaCabinRig, {
        timeSec,
        pose: 'seated_cockpit',
        isSpeaking: lip.speaker === 'maya',
        mouthOpen: lipOpenFor('maya'),
        mouthSpread: lip.spread,
        lookAtYaw: -0.28,
        stickX: s.vel.x * 2,
        stickZ: -s.vel.z * 2,
      });
      animateAstronaut(samCabinRig, {
        timeSec: timeSec + 0.25,
        pose: 'seated_cockpit',
        isSpeaking: lip.speaker === 'sam',
        mouthOpen: lipOpenFor('sam'),
        mouthSpread: lip.spread,
        lookAtYaw: lip.speaker === 'maya' ? 0.22 : -0.22,
      });
      animateAstronaut(leoCabinRig, {
        timeSec: timeSec + 0.5,
        pose: 'seated_cockpit',
        isSpeaking: lip.speaker === 'leo',
        mouthOpen: lipOpenFor('leo'),
        mouthSpread: lip.spread,
        lookAtYaw: 0.28,
        stickX: s.vel.x * 2,
        stickZ: -s.vel.z * 2,
      });

      armGroup.rotation.y = Math.sin(timeSec * 0.35) * 0.14;
      stationGroup.position.x = THREE.MathUtils.damp(stationGroup.position.x, s.idaAlignmentOffset, 6, dt);
      earthMesh.rotation.y += dt * 0.008;
      earthCloudsMesh.rotation.y += dt * 0.011;
      orbitalDust.rotation.y += dt * 0.004;

      // Update live cockpit MFD avionics canvas (zero words — pure vector graphics)
      dashCtx.fillStyle = '#041222';
      dashCtx.fillRect(0, 0, 256, 64);
      dashCtx.strokeStyle = ringAligned ? '#10b981' : '#38bdf8';
      dashCtx.lineWidth = 2;
      dashCtx.strokeRect(4, 4, 72, 56);
      dashCtx.beginPath();
      dashCtx.moveTo(12, 32 + Math.sin(timeSec * 2) * 3);
      dashCtx.lineTo(68, 32 - Math.sin(timeSec * 2) * 3);
      dashCtx.stroke();
      dashCtx.strokeStyle = '#38bdf8';
      dashCtx.strokeRect(86, 4, 84, 56);
      dashCtx.beginPath();
      dashCtx.arc(128, 32, 18, 0, Math.PI * 2);
      dashCtx.stroke();
      dashCtx.fillStyle = ringAligned ? '#22c55e' : '#f59e0b';
      dashCtx.beginPath();
      dashCtx.arc(128 - s.pos.x * 4, 32 - s.pos.y * 4, 4, 0, Math.PI * 2);
      dashCtx.fill();
      dashCtx.fillStyle = '#0ea5e9';
      dashCtx.fillRect(182, 12, 60 * (s.fuelKg / s.maxFuelKg), 14);
      dashCtx.fillStyle = '#22c55e';
      dashCtx.fillRect(182, 36, Math.min(60, Math.max(4, Math.abs(s.vel.z) * 100)), 14);
      dashTex.needsUpdate = true;

      if (!renderer.xr.isPresenting) {
        if (s.cameraPreset === 'chase') {
          if (s.status === 'CAPTURED') {
            // Smooth hero three-quarter angle showing nose latched into the Space Station port (rotates 360 around with orbitYawRad)
            const orb = s.hoverSteer.orbitYawRad + Math.PI * 0.19;
            _v1.set(s.pos.x + Math.sin(orb) * 6.2, s.pos.y + 2.35 + s.hoverSteer.orbitPitchRad * 2.5, s.pos.z + Math.cos(orb) * 6.2);
            _v2.set(s.idaAlignmentOffset, 0.25, 0.25);
          } else {
            const orbAngle = s.hoverSteer.orbitYawRad + (s.hoverSteerEnabled ? THREE.MathUtils.degToRad(s.rotDeg.y) * 0.45 : 0);
            const camDist = 8.9;
            const camHeight = Math.max(0.6, 2.85 + s.hoverSteer.orbitPitchRad * 4.5);
            _v1.set(
              s.pos.x + Math.sin(orbAngle) * camDist + 1.1 * Math.cos(orbAngle),
              s.pos.y + camHeight,
              s.pos.z + Math.cos(orbAngle) * camDist - 1.1 * Math.sin(orbAngle)
            );
            _v2.set(
              s.pos.x * 0.55 - Math.sin(orbAngle) * 2.4,
              s.pos.y * 0.55 + 0.35,
              s.pos.z - Math.cos(orbAngle) * 4.5
            );
          }
        } else if (s.cameraPreset === 'coas') {
          _v1.set(s.pos.x, s.pos.y + 0.1, s.pos.z - 1.3);
          _v2.set(s.pos.x, s.pos.y, 0);
        } else if (s.cameraPreset === 'station') {
          _v1.set(-8.5, 5.2, 6.5);
          _v2.copy(s.pos);
        } else {
          // Cockpit view looking past Maya, Sam & Leo out the panoramic dome toward the Station
          _v1.set(s.pos.x, s.pos.y + 1.24, s.pos.z + 0.96);
          _v2.set(
            s.pos.x + Math.sin(s.headOffsetYaw) * 18,
            s.pos.y + Math.sin(s.headOffsetPitch) * 12 + 0.65,
            s.pos.z - 20
          );
        }
        camera.position.lerp(_v1, 1 - Math.exp(-8 * dt));
        camera.lookAt(_v2);
      }

      const w = container.clientWidth;
      const h = container.clientHeight;
      if (s.stereoVrMode && !renderer.xr.isPresenting) {
        renderer.setScissorTest(true);
        const halfW = Math.floor(w / 2);
        const ipdHalf = 0.064;

        leftEyeCam.aspect = Math.max(0.5, halfW / Math.max(1, h));
        leftEyeCam.updateProjectionMatrix();
        leftEyeCam.position.copy(camera.position).add(new THREE.Vector3(-ipdHalf, 0, 0));
        leftEyeCam.quaternion.copy(camera.quaternion);
        renderer.setViewport(0, 0, halfW, h);
        renderer.setScissor(0, 0, halfW, h);
        renderer.render(scene, leftEyeCam);

        rightEyeCam.aspect = Math.max(0.5, halfW / Math.max(1, h));
        rightEyeCam.updateProjectionMatrix();
        rightEyeCam.position.copy(camera.position).add(new THREE.Vector3(ipdHalf, 0, 0));
        rightEyeCam.quaternion.copy(camera.quaternion);
        renderer.setViewport(halfW, 0, w - halfW, h);
        renderer.setScissor(halfW, 0, w - halfW, h);
        renderer.render(scene, rightEyeCam);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
      } else {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        renderer.render(scene, camera);
      }

      hudSyncAcc += dt;
      if (hudSyncAcc >= 0.1) {
        hudSyncAcc = 0;
        const rangeMeters = Math.max(0, s.pos.z - 1.45);
        const lateralOffsetM = Math.hypot(s.pos.x - s.idaAlignmentOffset, s.pos.y);
        const alignmentErrorDeg = Math.hypot(s.rotDeg.x, s.rotDeg.y, s.rotDeg.z * 0.5);
        const snapshot: DockingTelemetry = {
          posX: Number(s.pos.x.toFixed(2)),
          posY: Number(s.pos.y.toFixed(2)),
          posZ: Number(s.pos.z.toFixed(2)),
          velX: Number(s.vel.x.toFixed(3)),
          velY: Number(s.vel.y.toFixed(3)),
          velZ: Number(s.vel.z.toFixed(3)),
          pitchDeg: Number(s.rotDeg.x.toFixed(2)),
          yawDeg: Number(s.rotDeg.y.toFixed(2)),
          rollDeg: Number(s.rotDeg.z.toFixed(2)),
          angVelPitch: Number(s.angVelDeg.x.toFixed(2)),
          angVelYaw: Number(s.angVelDeg.y.toFixed(2)),
          angVelRoll: Number(s.angVelDeg.z.toFixed(2)),
          rangeMeters: Number(rangeMeters.toFixed(2)),
          closureRateMs: Number((-s.vel.z).toFixed(3)),
          lateralOffsetM: Number(lateralOffsetM.toFixed(2)),
          alignmentErrorDeg: Number(alignmentErrorDeg.toFixed(2)),
          fuelKg: Number(s.fuelKg.toFixed(1)),
          fuelRemainingPct: Math.round((s.fuelKg / s.maxFuelKg) * 100),
          rcsActive,
          captureLatchArmed: s.captureLatchArmed,
          idaAlignmentOffset: s.idaAlignmentOffset,
          busBActive: s.busBActive,
          radarBackupActive: s.radarBackupActive,
          dockingStatus: s.status,
          safetyScore: s.safetyScore,
          elapsedSec: Math.round(s.elapsedSec),
          activeDrills: [...s.activeDrills],
          vrActive: s.stereoVrMode || renderer.xr.isPresenting,
          hardwareActive: hw.connected,
        };
        setTelemetry(snapshot);

        if (s.crewRole === 'commander' && now - s.lastBroadcastAt > 180) {
          s.lastBroadcastAt = now;
          missionSocket.send('telemetry:docking', snapshot);
        }
      }

      if (renderer.xr.isPresenting) return;
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    if (isSoftwareGl) afterDraw(tick);
    else frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      mayaCabinRig.dispose();
      samCabinRig.dispose();
      leoCabinRig.dispose();
      deltaWingGeo.dispose();
      petalGeo.dispose();
      hookGeo.dispose();
      laserBeamGeo.dispose();
      laserMat.dispose();
      idaSealMat.dispose();
      portholeGeo.dispose();
      portholeMat.dispose();
      shuttleWingMat.dispose();
      whiteHullMat.dispose();
      darkTitaniumMat.dispose();
      rccBlackMat.dispose();
      kaptonGoldMat.dispose();
      solarMat.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      earthCloudsGeo.dispose();
      earthCloudsMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      rs25Geo.dispose();
      plumeMat.dispose();
      plumeCoreMat.dispose();
      earthTex.dispose();
      earthCloudTex.dispose();
      shuttleTileTex.dispose();
      shuttleTileBumpTex.dispose();
      goldFoilTex.dispose();
      solarTex.dispose();
      coasTex.dispose();
      softTex.dispose();
      dashTex.dispose();
      starGeo.dispose();
      starMat.dispose();
      orbitalDustGeo.dispose();
      orbitalDustMat.dispose();
      renderer.dispose();
    };
  }, [missionPhase]);

  const resetSimulation = () => {
    const s = simRef.current;
    s.pos.set(1.8, 1.0, 28.0);
    s.vel.set(0, 0, -0.08);
    s.rotDeg.set(s.easyMode ? 0 : 3.5, s.easyMode ? 0 : -4.2, s.easyMode ? 0 : 1.5);
    s.angVelDeg.set(0, 0, 0);
    s.fuelKg = 420;
    s.elapsedSec = 0;
    s.status = 'APPROACH';
    s.safetyScore = 100;
    s.activeDrills = [];
    s.drillsResolved = 0;
    s.busBActive = false;
    s.radarBackupActive = false;
    s.spokenOutcome = false;
    s.captureProgress = 0;
    s.hoverSteer.orbitYawRad = 0;
    s.hoverSteer.orbitPitchRad = 0;
    s.hoverSteer.spinYawDeg = 0;
    s.hoverSteer.dragYawDeg = 0;
    s.hoverSteer.dragPitchDeg = 0;
    teachingDoneRef.current.clear();
    setSaveNotice(null);
    voiceGuide.speak('New docking flight ready! Remember, tap gently and let zero-gravity inertia carry your shuttle through the rings.', {
      priority: true,
      speaker: voiceGuide.resolveCoachSpeaker(),
      useNeuralTts: true,
    });
  };

  const autoAimShip = () => {
    const s = simRef.current;
    s.pos.x = THREE.MathUtils.lerp(s.pos.x, s.idaAlignmentOffset, 0.75);
    s.pos.y = THREE.MathUtils.lerp(s.pos.y, 0, 0.75);
    s.vel.x = 0;
    s.vel.y = 0;
    s.rotDeg.set(0, 0, 0);
    s.angVelDeg.set(0, 0, 0);
    s.hoverSteer.orbitYawRad = 0;
    s.hoverSteer.orbitPitchRad = 0;
    s.hoverSteer.spinYawDeg = 0;
    s.hoverSteer.dragYawDeg = 0;
    s.hoverSteer.dragPitchDeg = 0;
    telemetryAudio.playThrusterPulse();
    voiceGuide.speak('Auto-Aim cancelled your sideways velocity and lined your nose straight at the docking center!', {
      cooldownMs: 3000,
      speaker: 'maya',
    });
  };

  const toggleWebXr = async () => {
    const renderer = rendererRef.current;
    const xr = (navigator as Navigator & { xr?: { requestSession: (m: string) => Promise<XRSession> } }).xr;
    if (!renderer || !xr || !webXrSupported) {
      setStereoVrMode((prev) => !prev);
      return;
    }
    try {
      const session = await xr.requestSession('immersive-vr');
      await renderer.xr.setSession(session);
      setWebXrActive(true);
      session.addEventListener('end', () => setWebXrActive(false));
    } catch {
      setStereoVrMode((prev) => !prev);
    }
  };

  const injectDrill = (drillId: string) => {
    if (!simRef.current.activeDrills.includes(drillId)) {
      simRef.current.activeDrills = [...simRef.current.activeDrills, drillId];
      missionSocket.send('drill:inject', { drillId, sender: callsign });
      telemetryAudio.playAlertTone('critical');
      if (DRILL_VOICE[drillId]) {
        voiceGuide.speak(DRILL_VOICE[drillId].text, {
          priority: true,
          speaker: DRILL_VOICE[drillId].speaker,
          useNeuralTts: true,
        });
      }
      onAuditEvent?.('DRILL_TRIGGERED', 'IDSS-REV-D', `Injected docking drill ${drillId}`);
    }
  };

  const resolveDrill = (drillId: string) => {
    simRef.current.activeDrills = simRef.current.activeDrills.filter((d) => d !== drillId);
    simRef.current.drillsResolved += 1;
    if (drillId === 'COAS_BLACKOUT') simRef.current.radarBackupActive = true;
    if (drillId === 'BUS_A_TRIP') simRef.current.busBActive = true;
    missionSocket.send('drill:clear', { drillId });
    missionSocket.send('copilot:action', { action: 'clear_drill', value: drillId });
    voiceGuide.speak(
      drillId === 'COAS_BLACKOUT'
        ? 'Backup radar locked in! Radio waves bounce cleanly off the station even through dust!'
        : drillId === 'BUS_A_TRIP'
        ? 'Bus B backup battery online! Real spacecraft always carry twin power circuits for safety!'
        : 'Valve shut! Stopping that leaking thruster stopped the unwanted rotation!',
      { priority: true, speaker: 'maya', useNeuralTts: true }
    );
    onAuditEvent?.('DRILL_RESOLVED', 'IDSS-REV-D', `Resolved docking drill ${drillId}`);
  };

  const handleSaveRun = async () => {
    setSavingRun(true);
    setSaveNotice(null);
    try {
      const outcome =
        telemetry.dockingStatus === 'CAPTURED'
          ? 'SUCCESS'
          : telemetry.dockingStatus === 'COLLISION_ABORT'
          ? 'FAILED'
          : 'ABORTED';
      await onSaveRun({
        mode: 'docking',
        outcome,
        safetyScore: telemetry.safetyScore,
        durationSec: telemetry.elapsedSec,
        fuelRemainingPct: telemetry.fuelRemainingPct,
        closureRateMs: telemetry.closureRateMs,
        alignmentErrorDeg: telemetry.alignmentErrorDeg,
        drillsResolved: simRef.current.drillsResolved,
        vrUsed: telemetry.vrActive,
        hardwareInputUsed: telemetry.hardwareActive,
        multiplayerRoom: roomId,
        standardRef: 'IDSS-REV-D',
      });
      setSaveNotice('saved');
    } catch (err) {
      setSaveNotice(err instanceof Error ? err.message : 'err');
    } finally {
      setSavingRun(false);
    }
  };

  const setImpulse = (field: keyof typeof simRef.current.manualImpulse, val: number | boolean) => {
    (simRef.current.manualImpulse[field] as number | boolean) = val;
  };

  const coasBlackout = telemetry.activeDrills.includes('COAS_BLACKOUT') && !telemetry.radarBackupActive;
  const maxSafeSpeed = easyMode ? 0.45 : 0.25;
  const maxSafeOffset = easyMode ? 0.7 : 0.35;

  if (missionPhase === 'journey') {
    return (
      <ShuttleLaunchMission
        callsign={callsign}
        nasaFeed={nasaFeed}
        onEnterDocking={() => {
          setEntryVeil(true);
          setMissionPhase('docking');
          window.setTimeout(() => setEntryVeil(false), 650);
        }}
      />
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-72px)] min-h-[680px] bg-[#03060C] overflow-hidden select-none">
      <div
        className={`pointer-events-none absolute inset-0 bg-[#050811] z-30 transition-opacity duration-700 ease-out ${
          entryVeil ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {!webglFallback ? (
        <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-crosshair touch-none" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[#07090E] p-8">
          <AlertTriangle className="w-12 h-12 text-amber-400" />
        </div>
      )}

      {stereoVrMode && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 bg-cyan-500/45 z-10" />
      )}

      {cameraPreset === 'coas' && !coasBlackout && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
          <div className="relative w-56 h-56 rounded-full border border-cyan-400/50 flex items-center justify-center">
            <div className="w-28 h-28 rounded-full border border-cyan-400/35" />
            <div className="absolute inset-x-0 h-px bg-cyan-400/45" />
            <div className="absolute inset-y-0 w-px bg-cyan-400/45" />
          </div>
        </div>
      )}

      {coasBlackout && cameraPreset === 'coas' && (
        <div className="pointer-events-none absolute inset-0 bg-[#07090E]/90 flex items-center justify-center z-10">
          <AlertTriangle className="w-12 h-12 text-amber-400" />
        </div>
      )}

      {/* TOP-LEFT LABELED INSTRUMENT TELEMETRY */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 pointer-events-auto">
        <div className="bg-[#0B0E17]/92 border border-slate-700 px-3.5 py-2 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400">Status</span>
            <span
              className={`font-semibold whitespace-nowrap ${
                telemetry.dockingStatus === 'CAPTURED'
                  ? 'text-emerald-400'
                  : telemetry.dockingStatus === 'COLLISION_ABORT'
                  ? 'text-rose-400'
                  : 'text-cyan-300'
              }`}
            >
              {telemetry.dockingStatus === 'CAPTURED'
                ? 'Docked Safe'
                : telemetry.dockingStatus === 'COLLISION_ABORT'
                ? 'Too Fast Bump'
                : telemetry.dockingStatus === 'FINAL_CORRIDOR'
                ? 'Final Ring'
                : 'Approaching'}
            </span>
          </div>

          <div className="h-6 w-px bg-slate-800" />

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Rocket className="w-3 h-3 text-cyan-400" />
              Distance to Port
            </span>
            <span className="font-mono tabular-nums font-semibold text-slate-100">
              {telemetry.rangeMeters.toFixed(1)} m
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Gauge className="w-3 h-3 text-sky-400" />
              Approach Speed
            </span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                telemetry.closureRateMs > maxSafeSpeed ? 'text-rose-400' : 'text-cyan-300'
              }`}
            >
              {telemetry.closureRateMs.toFixed(2)} m/s
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Crosshair className="w-3 h-3 text-emerald-400" />
              Target Offset
            </span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                telemetry.lateralOffsetM > maxSafeOffset ? 'text-amber-300' : 'text-emerald-400'
              }`}
            >
              {telemetry.lateralOffsetM.toFixed(1)} m
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Flame className="w-3 h-3 text-emerald-400" />
              Thruster Fuel
            </span>
            <span className="font-mono tabular-nums font-semibold text-emerald-300">
              {telemetry.fuelRemainingPct}%
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Compass className="w-3 h-3 text-sky-400" />
              Ship Tilt
            </span>
            <span className="font-mono tabular-nums font-semibold text-slate-200">
              {telemetry.alignmentErrorDeg.toFixed(0)}°
            </span>
          </div>
        </div>

        {telemetry.activeDrills.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {telemetry.activeDrills.map((drillId) => (
              <button
                key={drillId}
                onClick={() => resolveDrill(drillId)}
                className="px-3 py-1.5 bg-rose-600/95 hover:bg-rose-500 border border-rose-400 text-white text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <Wrench className="w-3.5 h-3.5" />
                <span>
                  {drillId === 'RCS_VALVE_STUCK'
                    ? 'Shut Stuck Thruster Valve'
                    : drillId === 'COAS_BLACKOUT'
                    ? 'Switch to Backup Radar'
                    : 'Switch to Backup Battery'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* TOP-RIGHT LABELED MISSION OPTIONS */}
      <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="bg-[#0B0E17]/92 border border-slate-700 p-1.5 flex flex-wrap items-center justify-end gap-1.5">
          <button
            onClick={() => setMissionPhase('journey')}
            className="px-2.5 py-1.5 border border-orange-500/60 bg-orange-950/40 hover:bg-orange-900/50 text-orange-200 text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Launch Story</span>
          </button>

          <button
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              voiceGuide.setEnabled(next);
              if (next) {
                voiceGuide.speak('Voice guide turned on! I will help you fly safely.', { priority: true });
              }
            }}
            className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
              voiceEnabled
                ? 'bg-cyan-600/30 border-cyan-400 text-cyan-200'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{voiceEnabled ? 'Voice Guide: On' : 'Voice Guide: Off'}</span>
          </button>

          <button
            onClick={() => setEasyMode((e) => !e)}
            className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
              easyMode
                ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200'
                : 'bg-amber-600/25 border-amber-400 text-amber-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{easyMode ? 'Easy Assist' : 'Pro Pilot'}</span>
          </button>

          <button
            onClick={() =>
              setRoomId((r) => (r === 'ISS-NODE-01' ? 'GATEWAY-HALO-02' : 'ISS-NODE-01'))
            }
            className="px-2.5 py-1.5 border border-slate-700 bg-slate-900 text-cyan-300 hover:text-white text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Satellite className="w-3.5 h-3.5" />
            <span>{roomId === 'ISS-NODE-01' ? 'ISS Station' : 'Lunar Gateway'}</span>
          </button>

          <button
            onClick={() =>
              setCrewRole((r) => (r === 'commander' ? 'copilot' : 'commander'))
            }
            className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
              crewRole === 'commander'
                ? 'bg-slate-900 border-slate-700 text-slate-200'
                : 'bg-cyan-600/25 border-cyan-400 text-cyan-200'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>{crewRole === 'commander' ? 'Pilot Seat' : 'Port Latch Seat'}</span>
          </button>

          <button
            onClick={toggleWebXr}
            className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
              stereoVrMode || webXrActive
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <Glasses className="w-3.5 h-3.5" />
            <span>Stereo VR</span>
          </button>

          <button
            onClick={() => {
              const next = !musicEnabled;
              setMusicEnabled(next);
              telemetryAudio.setMusicEnabled(next);
            }}
            className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
              musicEnabled && !muted
                ? 'bg-indigo-600/25 border-indigo-400 text-indigo-200'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>{musicEnabled && !muted ? 'Music: On' : 'Music: Off'}</span>
          </button>

          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              telemetryAudio.setMuted(next);
            }}
            className="px-2.5 py-1.5 border border-slate-700 bg-slate-900 text-slate-300 hover:text-white text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>{muted ? 'SFX: Muted' : 'SFX: On'}</span>
          </button>
        </div>

        {/* AI Coach Drawer */}
        {showAiCoach && (
          <AskAiCoachPanel
            callsign={callsign}
            mode="docking"
            telemetry={telemetry}
            nasaFeed={nasaFeed}
            variant="drawer"
            voiceEnabled={voiceEnabled}
            onToggleVoice={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              voiceGuide.setEnabled(next);
            }}
            onClose={() => setShowAiCoach(false)}
          />
        )}

        {(telemetry.dockingStatus === 'CAPTURED' || telemetry.dockingStatus === 'COLLISION_ABORT') && (
          <div className="bg-[#0B0E17]/95 border border-cyan-500/60 px-3.5 py-2 flex items-center gap-3">
            {telemetry.dockingStatus === 'CAPTURED' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-100">
                {telemetry.dockingStatus === 'CAPTURED' ? 'Landed on Space Station' : 'Docking Bump Alert'}
              </span>
              <span className="font-mono tabular-nums text-xs text-cyan-300">
                Safety Score: {telemetry.safetyScore}%
              </span>
            </div>
            <button
              onClick={handleSaveRun}
              disabled={savingRun || !isSignedIn}
              className="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Score</span>
            </button>
            <button
              onClick={resetSimulation}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Fly Again</span>
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM COLLAPSIBLE FLIGHT DECK WITH FINE DESCRIPTIVE LABELS */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 max-w-[96vw] z-20 transition-transform duration-200 ${
          dockCollapsed ? 'bottom-0 translate-y-[calc(100%-32px)]' : 'bottom-3 translate-y-0'
        }`}
      >
        <div className="flex justify-center">
          <button
            onClick={() => setDockCollapsed((p) => !p)}
            className="px-4 py-1 bg-[#0B0E17]/95 border border-b-0 border-slate-700 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{dockCollapsed ? 'Show Flight Controls' : 'Hide Controls'}</span>
          </button>
        </div>

        <div className="bg-[#0B0E17]/95 border border-slate-700 px-3 py-2 flex flex-wrap items-center justify-center gap-3">
          {/* Camera Presets */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400">Camera View</span>
            <div className="flex items-center gap-1 bg-slate-900 p-1 border border-slate-800">
              <button
                onClick={() => setCameraPreset('chase')}
                className={`px-2 py-1 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap ${
                  cameraPreset === 'chase' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Chase</span>
              </button>
              <button
                onClick={() => setCameraPreset('coas')}
                className={`px-2 py-1 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap ${
                  cameraPreset === 'coas' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Port Sight</span>
              </button>
              <button
                onClick={() => setCameraPreset('station')}
                className={`px-2 py-1 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap ${
                  cameraPreset === 'station' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Satellite className="w-3.5 h-3.5" />
                <span>Station</span>
              </button>
              <button
                onClick={() => setCameraPreset('cockpit')}
                className={`px-2 py-1 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap ${
                  cameraPreset === 'cockpit' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Cockpit</span>
              </button>
            </div>
          </div>

          {/* Assist, Hover Turn, AI Coach, Speed, Reset */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400">Flight Helpers</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={autoAimShip}
                disabled={crewRole !== 'commander'}
                className="px-2.5 py-1.5 border border-cyan-500/60 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-200 disabled:opacity-40 text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Align</span>
              </button>
              <button
                onClick={() => setHoverSteerEnabled((h) => !h)}
                disabled={crewRole !== 'commander'}
                className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 ${
                  hoverSteerEnabled
                    ? 'bg-emerald-600/20 border-emerald-400 text-emerald-200'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>{hoverSteerEnabled ? 'Hover Turn: On' : 'Hover Turn: Off'}</span>
              </button>
              <button
                onClick={() => {
                  voiceGuide.primeSpeech();
                  setShowAiCoach((c) => !c);
                }}
                className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
                  showAiCoach
                    ? 'bg-cyan-600 border-cyan-400 text-white'
                    : 'bg-slate-900 border-cyan-500/60 text-cyan-200 hover:bg-cyan-950/60'
                }`}
              >
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>Ask AI Coach</span>
              </button>
              <button
                onClick={() => setPrecisionMode((p) => !p)}
                className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
                  precisionMode
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                <span>{precisionMode ? 'Fine Thrust' : 'Normal Thrust'}</span>
              </button>
              <button
                onClick={resetSimulation}
                className="px-2.5 py-1.5 border border-slate-700 bg-slate-900 text-slate-300 hover:text-white text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Ship</span>
              </button>
            </div>
          </div>

          {/* Flight Steering Thrusters */}
          {crewRole === 'commander' ? (
            <div className="flex flex-col gap-1 border-x border-slate-800 px-3">
              <span className="text-[10px] text-slate-400">
                Shuttle Thrusters (or Hover/Drag Screen · Keys · Space)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onPointerDown={() => setImpulse('tx', -1)}
                  onPointerUp={() => setImpulse('tx', 0)}
                  onPointerCancel={() => setImpulse('tx', 0)}
                  onPointerLeave={() => setImpulse('tx', 0)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-700 text-slate-100 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Left (A)</span>
                </button>
                <button
                  onPointerDown={() => setImpulse('ty', 1)}
                  onPointerUp={() => setImpulse('ty', 0)}
                  onPointerCancel={() => setImpulse('ty', 0)}
                  onPointerLeave={() => setImpulse('ty', 0)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-700 text-slate-100 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>Up (Q)</span>
                </button>
                <button
                  onPointerDown={() => setImpulse('ty', -1)}
                  onPointerUp={() => setImpulse('ty', 0)}
                  onPointerCancel={() => setImpulse('ty', 0)}
                  onPointerLeave={() => setImpulse('ty', 0)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-700 text-slate-100 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>Down (E)</span>
                </button>
                <button
                  onPointerDown={() => setImpulse('tx', 1)}
                  onPointerUp={() => setImpulse('tx', 0)}
                  onPointerCancel={() => setImpulse('tx', 0)}
                  onPointerLeave={() => setImpulse('tx', 0)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-700 text-slate-100 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Right (D)</span>
                </button>
                <button
                  onPointerDown={() => setImpulse('tz', -1)}
                  onPointerUp={() => setImpulse('tz', 0)}
                  onPointerCancel={() => setImpulse('tz', 0)}
                  onPointerLeave={() => setImpulse('tz', 0)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-400 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  <span>Forward (W)</span>
                </button>
                <button
                  onPointerDown={() => setImpulse('tz', 1)}
                  onPointerUp={() => setImpulse('tz', 0)}
                  onPointerCancel={() => setImpulse('tz', 0)}
                  onPointerLeave={() => setImpulse('tz', 0)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-700 text-slate-100 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Back (S)</span>
                </button>
                <button
                  onPointerDown={() => setImpulse('killRot', true)}
                  onPointerUp={() => setImpulse('killRot', false)}
                  onPointerCancel={() => setImpulse('killRot', false)}
                  onPointerLeave={() => setImpulse('killRot', false)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-400 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap touch-none select-none"
                >
                  <Hand className="w-3.5 h-3.5" />
                  <span>Brake (Space)</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 border-x border-slate-800 px-3">
              <span className="text-[10px] text-slate-400">Station Port Controls</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const next = !simRef.current.captureLatchArmed;
                    simRef.current.captureLatchArmed = next;
                    missionSocket.send('copilot:action', { action: 'toggle_latch', value: next });
                  }}
                  className={`px-2.5 py-1.5 border text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap ${
                    telemetry.captureLatchArmed
                      ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{telemetry.captureLatchArmed ? 'Latches Armed' : 'Latches Disarmed'}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-300 whitespace-nowrap">Port Trim:</span>
                  <input
                    type="range"
                    aria-label="Port Alignment Trim"
                    min={-1.5}
                    max={1.5}
                    step={0.05}
                    value={telemetry.idaAlignmentOffset}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      simRef.current.idaAlignmentOffset = v;
                      missionSocket.send('copilot:action', { action: 'trim_ida', value: v });
                    }}
                    className="w-24"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Practice Drills & Save */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400">Practice Drills &amp; Log</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => injectDrill('RCS_VALVE_STUCK')}
                className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Stuck Thruster</span>
              </button>
              <button
                onClick={() => injectDrill('COAS_BLACKOUT')}
                className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Camera Fog</span>
              </button>
              <button
                onClick={handleSaveRun}
                disabled={savingRun || !isSignedIn}
                className="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Score</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
