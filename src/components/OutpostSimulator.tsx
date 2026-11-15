import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AlertTriangle,
  BatteryCharging,
  BrainCircuit,
  CheckCircle2,
  Flame,
  HeartPulse,
  Minus,
  Music,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Satellite,
  Save,
  Shield,
  Sprout,
  Sun,
  Thermometer,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import type { NasaMissionFeed, OutpostTelemetry, SimulationRunRecord } from '../types/mission';
import { telemetryAudio } from '../services/telemetryAudio';
import { missionSocket } from '../services/websocketClient';
import { voiceGuide } from '../services/voiceGuide';
import { animateAstronaut, createAstronautRig } from '../three/astronautCharacter';
import {
  createAtmosphereRimMaterial,
  createCloudLayerTexture,
  createEarthRealisticTexture,
  createGoldFoilTexture,
  createSoftParticleTexture,
  createSolarCellTexture,
  createTerrainDetailTexture,
} from '../three/realisticMaterials';
import { AskAiCoachPanel } from './AskAiCoachPanel';

interface OutpostSimulatorProps {
  callsign: string;
  isSignedIn: boolean;
  onSaveRun: (
    run: Omit<SimulationRunRecord, 'runId' | 'userId' | 'callsign' | 'instructorEmail' | 'createdAt'>
  ) => Promise<void>;
  onAuditEvent?: (action: string, standardRef: string, detail: string) => void;
}

interface HistoryPoint {
  t: number;
  o2: number;
  co2: number;
}

const OUTPOST_DRILLS: Record<string, { title: string; detail: string; action: string; voice: string }> = {
  SOLAR_FLARE_SPE: {
    title: 'Solar Storm Alert!',
    detail: 'The Sun sent a big wave of space rays! Tap Hide in Storm Shelter to keep your astronauts safe.',
    action: 'Hide in Storm Shelter',
    voice: 'Solar storm alert! Space rays are coming from the Sun. Tap Hide in Storm Shelter to protect your astronauts!',
  },
  HULL_MICROMETEOROID: {
    title: 'Tiny Meteor Hole!',
    detail: 'A space rock poked a tiny leak in Room 2. Tap Close Safety Door to keep the air inside!',
    action: 'Close Safety Door',
    voice: 'Tiny meteor hole in Room 2! Air is leaking out. Tap Close Safety Door right away!',
  },
  DUST_STORM_BLACKOUT: {
    title: 'Low Sunlight Alert!',
    detail: 'Dust or shadow is blocking your solar panels! Tap Save Power to protect Fresh Air first.',
    action: 'Save Power Now',
    voice: 'Low sunlight alert! Your solar panels need help. Tap Save Power Now to protect Fresh Air!',
  },
};

export const OutpostSimulator: React.FC<OutpostSimulatorProps> = ({
  callsign,
  isSignedIn,
  onSaveRun,
  onAuditEvent,
}) => {
  const threeMountRef = useRef<HTMLDivElement | null>(null);
  const [theater, setTheater] = useState<'lunar' | 'mars'>('lunar');
  const [running, setRunning] = useState(true);
  const [timeScale, setTimeScale] = useState<1 | 3 | 6>(1);
  const [roomId] = useState('SHACKLETON-BASE');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(voiceGuide.isEnabled());
  const [musicEnabled, setMusicEnabled] = useState<boolean>(telemetryAudio.isMusicEnabled());
  const [showAiCoach, setShowAiCoach] = useState(false);
  const [nasaFeed, setNasaFeed] = useState<NasaMissionFeed | null>(null);

  const [allocEclss, setAllocEclss] = useState(14);
  const [allocShielding, setAllocShielding] = useState(8);
  const [allocHydroponics, setAllocHydroponics] = useState(10);
  const [allocThermal, setAllocThermal] = useState(8);
  const [shelterActive, setShelterActive] = useState(false);
  const [hullIsolated, setHullIsolated] = useState(false);

  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [telemetry, setTelemetry] = useState<OutpostTelemetry>({
    theater: 'lunar',
    sol: 1,
    hourOfSol: 6,
    totalPowerKw: 44,
    batteryPct: 86,
    powerDemandKw: 40,
    allocEclss: 14,
    allocShielding: 8,
    allocHydroponics: 10,
    allocThermal: 8,
    o2Pct: 20.9,
    co2MmHg: 2.8,
    pressureKpa: 101.3,
    radiationMsv: 1.4,
    doseRateMsvHr: 0.08,
    foodSols: 14.0,
    waterRecoveryPct: 96.5,
    crewHealthPct: 99,
    insideTempC: 21.2,
    shelterActive: false,
    hullIsolated: false,
    activeDrills: [],
    status: 'NOMINAL',
    safetyScore: 96,
  });

  const stateRef = useRef({
    theater: 'lunar' as 'lunar' | 'mars',
    running: true,
    timeScale: 1,
    allocEclss: 14,
    allocShielding: 8,
    allocHydroponics: 10,
    allocThermal: 8,
    shelterActive: false,
    hullIsolated: false,
    sol: 1,
    hourOfSol: 6,
    batteryPct: 86,
    o2Pct: 20.9,
    co2MmHg: 2.8,
    pressureKpa: 101.3,
    radiationMsv: 1.4,
    foodSols: 14.0,
    waterRecoveryPct: 96.5,
    crewHealthPct: 99,
    insideTempC: 21.2,
    nasaFluxMult: 1.0,
    marsOutsideAvgC: -62.4,
    marsOutsideMinC: -95.4,
    activeDrills: [] as string[],
    drillsResolved: 0,
    elapsedRealSec: 0,
    lastBroadcastAt: 0,
  });

  const teachingDoneRef = useRef<Set<string>>(new Set());

  const toggleVoice = () => {
    const next = !voiceEnabled;
    voiceGuide.setEnabled(next);
    setVoiceEnabled(next);
    if (next) {
      voiceGuide.speak(
        `Voice guide turned on! You are running the ${theater === 'lunar' ? 'Moon South Pole' : 'Mars Red Crater'} Base. Keep Fresh Air and Crew Health green!`,
        { priority: true, speaker: voiceGuide.resolveCoachSpeaker(), useNeuralTts: true }
      );
    }
  };

  useEffect(() => {
    stateRef.current.theater = theater;
  }, [theater]);
  useEffect(() => {
    stateRef.current.running = running;
  }, [running]);
  useEffect(() => {
    stateRef.current.timeScale = timeScale;
  }, [timeScale]);
  useEffect(() => {
    stateRef.current.allocEclss = allocEclss;
    stateRef.current.allocShielding = allocShielding;
    stateRef.current.allocHydroponics = allocHydroponics;
    stateRef.current.allocThermal = allocThermal;
    stateRef.current.shelterActive = shelterActive;
    stateRef.current.hullIsolated = hullIsolated;
  }, [allocEclss, allocShielding, allocHydroponics, allocThermal, shelterActive, hullIsolated]);

  useEffect(() => {
    fetch('/api/nasa/mission-feed')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NasaMissionFeed | null) => {
        if (!data) return;
        setNasaFeed(data);
        stateRef.current.nasaFluxMult = data.spaceWeather?.solarFluxMultiplier ?? 1.0;
        stateRef.current.marsOutsideAvgC = data.marsWeather?.avgTempC ?? -62.4;
        stateRef.current.marsOutsideMinC = data.marsWeather?.minTempC ?? -95.4;
      })
      .catch(() => {});

    if (voiceGuide.isEnabled()) {
      voiceGuide.speak(
        'Welcome to your Space Base! Share solar and mini-reactor power between Air Maker, Space Shield, Space Farm, and Water Saver, and tap Ask AI Coach anytime to learn the science!',
        { cooldownMs: 8000, speaker: 'maya', useNeuralTts: true }
      );
    }
  }, []);

  // Continuous background guiding voice coaching kids as they manage the Moon/Mars Base
  const bgCoachIdxRef = useRef(0);
  useEffect(() => {
    if (!voiceEnabled || !running || showAiCoach) return;
    const interval = window.setInterval(() => {
      if (!voiceGuide.isEnabled() || voiceGuide.isSpeaking() || voiceGuide.isCoachBusy()) return;
      const s = stateRef.current;
      const idx = bgCoachIdxRef.current++;
      const speaker: 'maya' | 'leo' | 'sam' = idx % 3 === 0 ? 'maya' : idx % 3 === 1 ? 'leo' : 'sam';

      let line = '';
      if (idx % 2 === 0) {
        if (s.activeDrills.includes('SOLAR_FLARE_SPE')) {
          line = 'Reminder from Mission Control: turn up Space Shield or tap Storm Shelter to protect our crew from solar particles!';
        } else if (s.activeDrills.includes('HULL_MICROMETEOROID') && !s.hullIsolated) {
          line = 'Air pressure is dropping from the meteor leak! Tap Close Safety Door right away!';
        } else if (s.o2Pct < 19.6) {
          line = `Oxygen is ${s.o2Pct.toFixed(1)} percent. Give Air Maker a boost so astronauts breathe crisp fresh air!`;
        } else if (s.foodSols < 6) {
          line = `Food supply is down to ${s.foodSols.toFixed(1)} days. Give Space Farm extra power so green plants grow faster!`;
        } else if (s.batteryPct < 35) {
          line = `Battery is at ${Math.round(s.batteryPct)} percent. Watch your total power sliders so the base stays charged!`;
        } else {
          line = `Base Day ${s.sol} is looking great! Inside air is ${Math.round(s.insideTempC)} degrees Celsius and crew health is ${s.crewHealthPct} percent.`;
        }
      } else {
        const scienceNotes =
          s.theater === 'lunar'
            ? [
                'Moon science fact: permanent shadows inside South Pole craters hold ancient water ice we can turn into drinking water and breathable oxygen!',
                'Look at the rover rolling around the base: solar arrays follow the low horizon sunlight to power our habitats!',
                'You can swipe or hover around the 3D base to inspect our central dome, hydroponic garden, and crew outside!',
              ]
            : [
                'Mars science fact: Red Crater air is mostly carbon dioxide and super thin, so closed habitats keep Earth pressure safe inside!',
                'NASA Perseverance and InSight showed dust storms can dim Martian sunlight, making batteries and Kilopower reactors essential!',
                'Our green crops in the Space Farm drink the carbon dioxide astronauts breathe out and turn it back into oxygen and food!',
              ];
        line = scienceNotes[Math.floor(idx / 2) % scienceNotes.length];
      }

      voiceGuide.speak(line, { cooldownMs: 10000, speaker, useNeuralTts: false });
    }, 12000);

    return () => window.clearInterval(interval);
  }, [voiceEnabled, running, showAiCoach]);

  useEffect(() => {
    missionSocket.connect(roomId, callsign, 'commander');
    const unsub = missionSocket.subscribe((ev) => {
      if (ev.type === 'drill:injected') {
        const { drillId } = ev.payload as { drillId: string };
        if (drillId && !stateRef.current.activeDrills.includes(drillId) && OUTPOST_DRILLS[drillId]) {
          stateRef.current.activeDrills = [...stateRef.current.activeDrills, drillId];
          telemetryAudio.playAlertTone('critical');
          voiceGuide.speak(OUTPOST_DRILLS[drillId].voice, {
            priority: true,
            speaker: drillId === 'DUST_STORM_BLACKOUT' ? 'leo' : 'sam',
            useNeuralTts: true,
          });
        }
      } else if (ev.type === 'drill:cleared') {
        const { drillId } = ev.payload as { drillId: string };
        stateRef.current.activeDrills = stateRef.current.activeDrills.filter((d) => d !== drillId);
      }
    });
    return unsub;
  }, [roomId, callsign]);

  // Enhanced 3D Outpost Twin
  useEffect(() => {
    const container = threeMountRef.current;
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
      renderer = new THREE.WebGLRenderer({ antialias: !isSoftwareGl, powerPreference: 'high-performance' });
    } catch {
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      46,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      350
    );
    camera.position.set(16, 11, 18);
    camera.lookAt(0, 1.5, 0);

    const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sunLight.position.set(18, 22, 12);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.72);
    fillLight.position.set(-14, 10, 16);
    scene.add(fillLight);

    const crewApronLight = new THREE.PointLight(0xfff7ed, 2.4, 16);
    crewApronLight.position.set(1.85, 3.8, 4.4);
    scene.add(crewApronLight);

    const hemiLight = new THREE.HemisphereLight(0x94a3b8, 0x1e293b, 0.82);
    scene.add(hemiLight);

    // Soft Starfield sky
    const softParticleTex = createSoftParticleTexture();
    const starCount = 520;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 75 + Math.random() * 60;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.48;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = 10 + r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      map: softParticleTex,
      color: 0xe2e8f0,
      size: 0.78,
      transparent: true,
      alphaTest: 0.01,
      opacity: 0.88,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Photorealistic Earth + Cloud Layer + Fresnel Rim in Lunar Sky + Phobos/Deimos in Mars Sky
    const earthRealisticTex = createEarthRealisticTexture();
    earthRealisticTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const earthCloudTex = createCloudLayerTexture();
    earthCloudTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const earthGeo = new THREE.SphereGeometry(2.9, 32, 24);
    const earthMat = new THREE.MeshStandardMaterial({
      map: earthRealisticTex,
      roughness: 0.65,
      metalness: 0.08,
      emissive: 0x082a54,
      emissiveIntensity: 0.25,
    });
    const earthSkyMesh = new THREE.Mesh(earthGeo, earthMat);
    earthSkyMesh.position.set(-28, 24, -36);
    const earthCloudGeo = new THREE.SphereGeometry(2.96, 28, 20);
    const earthCloudMat = new THREE.MeshStandardMaterial({
      map: earthCloudTex,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const earthCloudMesh = new THREE.Mesh(earthCloudGeo, earthCloudMat);
    earthSkyMesh.add(earthCloudMesh);
    const earthAtmoGeo = new THREE.SphereGeometry(3.18, 24, 18);
    const earthAtmoMat = createAtmosphereRimMaterial(0x38bdf8, 0.9);
    earthSkyMesh.add(new THREE.Mesh(earthAtmoGeo, earthAtmoMat));
    scene.add(earthSkyMesh);

    const marsMoonsGroup = new THREE.Group();
    const phobosGeo = new THREE.DodecahedronGeometry(1.1, 1);
    const phobosMat = new THREE.MeshStandardMaterial({ color: 0xc29b82, roughness: 0.85 });
    const phobos = new THREE.Mesh(phobosGeo, phobosMat);
    phobos.position.set(22, 22, -32);
    marsMoonsGroup.add(phobos);
    const deimos = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 1), phobosMat);
    deimos.position.set(-18, 26, -38);
    marsMoonsGroup.add(deimos);
    scene.add(marsMoonsGroup);

    // Sculpted Cratered Terrain & Regolith Bump Texture (flat core r < 9.5 so habitats & characters sit flush)
    const lunarTerrainTex = createTerrainDetailTexture('#475569', '#1e293b', '#94a3b8');
    lunarTerrainTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    lunarTerrainTex.repeat.set(6, 6);
    lunarTerrainTex.wrapS = THREE.RepeatWrapping;
    lunarTerrainTex.wrapT = THREE.RepeatWrapping;
    const marsTerrainTex = createTerrainDetailTexture('#8c3b25', '#4c1d11', '#c26b4a');
    marsTerrainTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    marsTerrainTex.repeat.set(6, 6);
    marsTerrainTex.wrapS = THREE.RepeatWrapping;
    marsTerrainTex.wrapT = THREE.RepeatWrapping;
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: lunarTerrainTex,
      bumpMap: lunarTerrainTex,
      bumpScale: 0.16,
      roughness: 0.92,
      metalness: 0.04,
    });
    const terrainGeo = new THREE.PlaneGeometry(88, 88, 64, 64);
    terrainGeo.rotateX(-Math.PI / 2);
    const tPos = terrainGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tPos.count; i++) {
      const vx = tPos.getX(i);
      const vz = tPos.getZ(i);
      const r = Math.hypot(vx, vz);
      if (r > 9.6) {
        const outerFade = Math.min(1, (r - 9.6) / 6.0);
        const ridge = Math.sin(vx * 0.22) * Math.cos(vz * 0.21) * 0.75 + Math.sin(r * 0.32) * 0.35;
        const rimClimb = r > 22 ? Math.pow((r - 22) / 14, 1.35) * 2.8 : 0;
        tPos.setY(i, (ridge + rimClimb) * outerFade);
      }
    }
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.receiveShadow = true;
    scene.add(terrain);

    const craterRingGeo = new THREE.TorusGeometry(15.5, 0.52, 10, 48);
    const craterRing = new THREE.Mesh(craterRingGeo, terrainMat);
    craterRing.rotation.x = Math.PI / 2;
    craterRing.position.y = 0.05;
    scene.add(craterRing);

    const rockGeo = new THREE.DodecahedronGeometry(0.45, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const ang = (i / 32) * Math.PI * 2;
      const dist = 9.5 + (i % 5) * 3.1;
      dummy.position.set(Math.cos(ang) * dist, 0.15, Math.sin(ang) * dist);
      const sc = 0.6 + (i % 4) * 0.35;
      dummy.scale.set(sc, sc * 0.7, sc);
      dummy.rotation.set(i * 0.5, i * 1.1, 0);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.computeBoundingSphere();
    scene.add(rocks);

    const outpostGroup = new THREE.Group();
    const goldFoilTex = createGoldFoilTexture();
    goldFoilTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const habMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.36, metalness: 0.25 });
    const kaptonMat = new THREE.MeshPhysicalMaterial({
      color: 0xd97706,
      map: goldFoilTex,
      bumpMap: goldFoilTex,
      bumpScale: 0.04,
      roughness: 0.22,
      metalness: 0.92,
      clearcoat: 0.7,
    });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.32, metalness: 0.82 });
    const windowGlowMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.85,
      roughness: 0.12,
    });

    // Central Hub + Cupola Observation Deck + Comms Dish
    const centralHub = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.25, 2.3, 18), habMat);
    centralHub.position.set(0, 1.15, 0);
    centralHub.castShadow = true;
    outpostGroup.add(centralHub);

    const hubRoofDome = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      windowGlowMat
    );
    hubRoofDome.position.set(0, 2.3, 0);
    outpostGroup.add(hubRoofDome);

    const windowStripGeo = new THREE.CylinderGeometry(2.19, 2.19, 0.24, 18, 1, true, -0.75, 1.5);
    const hubViewport = new THREE.Mesh(windowStripGeo, windowGlowMat);
    hubViewport.position.set(0, 1.48, 0);
    outpostGroup.add(hubViewport);

    const commsMast = new THREE.Group();
    commsMast.position.set(0.8, 2.7, -0.6);
    const dishPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 8), metalMat);
    commsMast.add(dishPole);
    const dishBowl = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.35, 16, 1, true), habMat);
    dishBowl.position.y = 0.7;
    dishBowl.rotation.x = Math.PI * 0.7;
    commsMast.add(dishBowl);
    outpostGroup.add(commsMast);

    // Crew Quarters (Room 2) + Airlock Tunnel + Regolith Shield Berm
    const crewHab = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 5.2, 18), habMat);
    crewHab.rotation.z = Math.PI / 2;
    crewHab.position.set(-4.6, 1.15, 0.4);
    crewHab.castShadow = true;
    outpostGroup.add(crewHab);

    const habBand = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 1.4, 18), kaptonMat);
    habBand.rotation.z = Math.PI / 2;
    habBand.position.set(-4.6, 1.15, 0.4);
    outpostGroup.add(habBand);

    const tunnelLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.4, 12), metalMat);
    tunnelLeft.rotation.z = Math.PI / 2;
    tunnelLeft.position.set(-2.1, 1.0, 0.25);
    outpostGroup.add(tunnelLeft);

    // Safety Air Door Ring (turns bright cyan when closed!)
    const airDoorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.2,
    });
    const airDoorRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.12, 10, 20), airDoorMat);
    airDoorRing.rotation.y = Math.PI / 2;
    airDoorRing.position.set(-2.2, 1.0, 0.25);
    outpostGroup.add(airDoorRing);

    // Regolith Sandbags around Crew Quarters
    const sandbagGeo = new THREE.BoxGeometry(0.95, 0.55, 0.5);
    for (let s = 0; s < 5; s++) {
      const bag = new THREE.Mesh(sandbagGeo, rockMat);
      bag.position.set(-6.2 + s * 0.9, 0.28, 1.75);
      outpostGroup.add(bag);
    }

    // Hydroponic Farm Dome + Tunnel + 3D Growing Veggie Plants
    const tunnelRight = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.2, 12), metalMat);
    tunnelRight.rotation.z = Math.PI / 2;
    tunnelRight.position.set(2.1, 1.0, -0.25);
    outpostGroup.add(tunnelRight);

    const domeShellMat = new THREE.MeshStandardMaterial({
      color: 0xa7f3d0,
      transparent: true,
      opacity: 0.34,
      roughness: 0.15,
      metalness: 0.1,
    });
    const hydroDome = new THREE.Mesh(
      new THREE.SphereGeometry(2.7, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      domeShellMat
    );
    hydroDome.position.set(4.1, 0, -0.5);
    outpostGroup.add(hydroDome);

    const domeRibGeo = new THREE.TorusGeometry(2.71, 0.055, 8, 28, Math.PI);
    [0, Math.PI * 0.33, Math.PI * 0.67].forEach((rotY) => {
      const rib = new THREE.Mesh(domeRibGeo, metalMat);
      rib.position.set(4.1, 0, -0.5);
      rib.rotation.y = rotY;
      outpostGroup.add(rib);
    });

    const hydroGlowMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.8,
      roughness: 0.6,
    });
    const hydroBeds = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.35, 18), hydroGlowMat);
    hydroBeds.position.set(4.1, 0.18, -0.5);
    outpostGroup.add(hydroBeds);

    const plantsGroup = new THREE.Group();
    plantsGroup.position.set(4.1, 0.4, -0.5);
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x15803d,
      emissiveIntensity: 0.45,
      roughness: 0.65,
    });
    const plantGeo = new THREE.ConeGeometry(0.28, 0.65, 7);
    for (let p = 0; p < 12; p++) {
      const pang = (p / 12) * Math.PI * 2;
      const pr = p % 2 === 0 ? 1.35 : 0.75;
      const sprout = new THREE.Mesh(plantGeo, leafMat);
      sprout.position.set(Math.cos(pang) * pr, 0.3, Math.sin(pang) * pr);
      plantsGroup.add(sprout);
    }
    outpostGroup.add(plantsGroup);
    const hydroPointLight = new THREE.PointLight(0x4ade80, 1.8, 9);
    hydroPointLight.position.set(4.1, 1.9, -0.5);
    outpostGroup.add(hydroPointLight);

    // Kilopower Mini-Reactor
    const reactorCore = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 2.6, 12), metalMat);
    reactorCore.position.set(-1.5, 1.3, -5.5);
    outpostGroup.add(reactorCore);
    const reactorGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    reactorGlow.position.set(-1.5, 1.6, -5.5);
    outpostGroup.add(reactorGlow);
    const radiatorUmbrella = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.35, 16), kaptonMat);
    radiatorUmbrella.position.set(-1.5, 2.75, -5.5);
    outpostGroup.add(radiatorUmbrella);

    // Solar Panels with wafer cell grid + metallic frames
    const solarTex = createSolarCellTexture();
    solarTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const solarPanels: THREE.Mesh[] = [];
    const solarMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: solarTex,
      bumpMap: solarTex,
      bumpScale: 0.03,
      roughness: 0.18,
      metalness: 0.55,
    });
    [
      [6.5, 3.2, 4.2],
      [3.8, 3.2, 6.2],
    ].forEach(([sx, sy, sz]) => {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 3.6, 8), metalMat);
      mast.position.set(sx, 1.8, sz);
      outpostGroup.add(mast);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.55, 0.08), solarMat);
      wing.position.set(sx, sy, sz);
      outpostGroup.add(wing);
      solarPanels.push(wing);
    });

    // Animated 6-Wheel Astronaut Rover
    const roverGroup = new THREE.Group();
    const roverBody = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.85), kaptonMat);
    roverBody.position.y = 0.45;
    roverGroup.add(roverBody);
    const roverCab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.7), windowGlowMat);
    roverCab.position.set(0.32, 0.75, 0);
    roverGroup.add(roverCab);
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.18, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const roverWheels: THREE.Mesh[] = [];
    [-0.48, 0, 0.48].forEach((wx) => {
      [-0.48, 0.48].forEach((wz) => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.x = Math.PI / 2;
        w.position.set(wx, 0.2, wz);
        roverGroup.add(w);
        roverWheels.push(w);
      });
    });
    outpostGroup.add(roverGroup);

    // Space Shield Bubble
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.16,
      wireframe: true,
    });
    const shieldBubble = new THREE.Mesh(
      new THREE.SphereGeometry(8.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      shieldMat
    );
    shieldBubble.position.set(0, 0, 0);
    outpostGroup.add(shieldBubble);

    // Meteor Leak Vapor Puffs (visible when HULL_MICROMETEOROID is active & !hullIsolated)
    const leakPuffGroup = new THREE.Group();
    leakPuffGroup.position.set(-5.2, 2.1, 0.4);
    const puffGeo = new THREE.SphereGeometry(0.3, 10, 10);
    const puffMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.65 });
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const pf = new THREE.Mesh(puffGeo, puffMat);
      pf.position.y = i * 0.45;
      leakPuffGroup.add(pf);
      puffs.push(pf);
    }
    leakPuffGroup.visible = false;
    outpostGroup.add(leakPuffGroup);

    // Solar Storm Ray Streaks (visible when SOLAR_FLARE_SPE is active)
    const solarRaysGroup = new THREE.Group();
    const rayGeo = new THREE.CylinderGeometry(0.04, 0.04, 9, 6);
    const rayMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.75 });
    for (let r = 0; r < 10; r++) {
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.position.set((r - 4.5) * 2.2, 11 + (r % 3) * 1.5, ((r * 3) % 7) - 3);
      ray.rotation.z = 0.35;
      solarRaysGroup.add(ray);
    }
    solarRaysGroup.visible = false;
    scene.add(solarRaysGroup);

    // Parked Mini Space Shuttle Lander on Outpost Pad + Landing Thruster Bells
    const landerGroup = new THREE.Group();
    landerGroup.position.set(-8.2, 0.25, -5.8);
    landerGroup.rotation.y = Math.PI * 0.25;
    const landerHull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 3.0, 16), habMat);
    landerHull.position.y = 1.6;
    landerHull.castShadow = true;
    landerGroup.add(landerHull);
    const landerNose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.3, 16), habMat);
    landerNose.position.y = 3.75;
    landerGroup.add(landerNose);
    const landerWindshield = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.35, 0.4), windowGlowMat);
    landerWindshield.position.set(0, 3.1, 0.6);
    landerGroup.add(landerWindshield);
    const thrusterGeo = new THREE.ConeGeometry(0.45, 0.7, 14, 1, true);
    [-0.45, 0.45].forEach((tx) => {
      const nozzle = new THREE.Mesh(thrusterGeo, metalMat);
      nozzle.position.set(tx, -0.05, 0);
      landerGroup.add(nozzle);
    });
    [-1.4, 1.4].forEach((lx) => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1.1), kaptonMat);
      fin.position.set(lx, 0.75, 0);
      landerGroup.add(fin);
    });
    outpostGroup.add(landerGroup);

    // Front EVA Deck Apron + All 3 Crew Characters (Maya, Leo, and Sam in xEMU suit) clearly visible
    const apronGeo = new THREE.CylinderGeometry(2.6, 2.8, 0.06, 28);
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.75, metalness: 0.35 });
    const evaApron = new THREE.Mesh(apronGeo, apronMat);
    evaApron.position.set(1.85, 0.03, 4.1);
    evaApron.receiveShadow = true;
    outpostGroup.add(evaApron);

    const mayaOutpostRig = createAstronautRig('maya', 0.85, { forceHelmet: true });
    mayaOutpostRig.root.position.set(0.75, 0.06, 4.05);
    mayaOutpostRig.root.rotation.y = 0.55;
    outpostGroup.add(mayaOutpostRig.root);

    const leoOutpostRig = createAstronautRig('leo', 0.83, { forceHelmet: true });
    leoOutpostRig.root.position.set(1.85, 0.06, 4.45);
    leoOutpostRig.root.rotation.y = 0.05;
    outpostGroup.add(leoOutpostRig.root);

    const samOutpostRig = createAstronautRig('sam', 0.84, { forceHelmet: true });
    samOutpostRig.root.position.set(2.95, 0.06, 3.9);
    samOutpostRig.root.rotation.y = -0.58;
    outpostGroup.add(samOutpostRig.root);

    scene.add(outpostGroup);

    renderer.domElement.style.touchAction = 'none';
    let orbitOffsetTheta = 0;
    let orbitOffsetPitch = 0;
    let hoverTiltX = 0;
    let hoverTiltY = 0;
    let dragging = false;
    let activePointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      activePointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic capture failures
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (e.target === renderer.domElement || dragging)) {
        hoverTiltX = THREE.MathUtils.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        hoverTiltY = THREE.MathUtils.clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      orbitOffsetTheta -= dx * 0.009;
      orbitOffsetPitch = THREE.MathUtils.clamp(orbitOffsetPitch - dy * 0.025, -4.0, 5.5);
    };

    const endDrag = (e?: PointerEvent) => {
      if (e && activePointerId !== null && e.pointerId === activePointerId) {
        try {
          if (renderer.domElement.hasPointerCapture(activePointerId)) {
            renderer.domElement.releasePointerCapture(activePointerId);
          }
        } catch {
          // Ignore release failures
        }
      }
      dragging = false;
      activePointerId = null;
    };

    const onPointerLeave = () => {
      if (!dragging) {
        hoverTiltX = 0;
        hoverTiltY = 0;
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    const handleResize = () => {
      if (!container) return;
      camera.aspect = Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    let disposed = false;
    let frameId = 0;
    let angle = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
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
      const st = stateRef.current;

      if (st.theater === 'mars') {
        scene.background = new THREE.Color(0x2d1710);
        scene.fog = new THREE.FogExp2(0x3a1c12, 0.0085);
        if (terrainMat.map !== marsTerrainTex) {
          terrainMat.map = marsTerrainTex;
          terrainMat.bumpMap = marsTerrainTex;
          terrainMat.needsUpdate = true;
        }
        rockMat.color.setHex(0x6b2f1f);
        hemiLight.color.setHex(0xfdba74);
        earthSkyMesh.visible = false;
        marsMoonsGroup.visible = true;
        starMat.opacity = 0.45;
      } else {
        scene.background = new THREE.Color(0x05070c);
        scene.fog = null;
        if (terrainMat.map !== lunarTerrainTex) {
          terrainMat.map = lunarTerrainTex;
          terrainMat.bumpMap = lunarTerrainTex;
          terrainMat.needsUpdate = true;
        }
        rockMat.color.setHex(0x334155);
        hemiLight.color.setHex(0x94a3b8);
        earthSkyMesh.visible = true;
        marsMoonsGroup.visible = false;
        starMat.opacity = 0.88;
      }

      // Live responsive 3D graphics
      hydroGlowMat.emissiveIntensity = 0.25 + (st.allocHydroponics / 16) * 1.4;
      hydroPointLight.intensity = 0.8 + (st.allocHydroponics / 16) * 2.2;
      const plantScale = 0.55 + (st.allocHydroponics / 18) * 0.9;
      plantsGroup.scale.set(1, plantScale, 1);

      const solarStormActive = st.activeDrills.includes('SOLAR_FLARE_SPE');
      shieldMat.opacity = solarStormActive
        ? 0.3 + (st.allocShielding / 16) * 0.38
        : 0.06 + (st.allocShielding / 16) * 0.16;
      shieldMat.color.setHex(solarStormActive ? 0xf59e0b : st.shelterActive ? 0x22c55e : 0x06b6d4);

      airDoorMat.emissiveIntensity = st.hullIsolated ? 1.4 : 0.2;
      airDoorMat.color.setHex(st.hullIsolated ? 0x06b6d4 : 0x334155);

      const hasLeak = st.activeDrills.includes('HULL_MICROMETEOROID') && !st.hullIsolated;
      leakPuffGroup.visible = hasLeak;
      if (hasLeak) {
        puffs.forEach((pf, idx) => {
          const cycle = (angle * 3.5 + idx * 0.5) % 2.4;
          pf.position.y = cycle * 1.3;
          const sc = 0.6 + cycle * 0.6;
          pf.scale.setScalar(sc);
        });
      }

      solarRaysGroup.visible = solarStormActive;
      if (solarStormActive) {
        solarRaysGroup.position.y = -((angle * 12) % 4);
      }

      angle += 0.0028;
      // Hovering near the left or right side continuously rotates 360 degrees around the base
      if (!dragging && Math.abs(hoverTiltX) > 0.34) {
        orbitOffsetTheta += (Math.abs(hoverTiltX) - 0.34) * Math.sign(hoverTiltX) * 0.024;
      }
      // Scenic front-arc glide + full 360 hover/touch orbit around base domes, Rover & crew
      const camTheta = Math.PI * 0.38 + Math.sin(angle * 0.9) * 0.45 + orbitOffsetTheta + hoverTiltX * 0.16;
      camera.position.x = Math.cos(camTheta) * 16.8;
      camera.position.y = Math.max(3.0, 9.4 + Math.sin(angle * 0.6) * 0.8 + orbitOffsetPitch - hoverTiltY * 1.1);
      camera.position.z = Math.sin(camTheta) * 16.8;
      camera.lookAt(0.65 + hoverTiltX * 0.7, 1.35 - hoverTiltY * 0.4, 1.35);

      // Rotate comms dish, Earth + clouds, and drive rover along outer loop with spinning wheels
      commsMast.rotation.y = Math.sin(angle * 1.4) * 0.8;
      earthSkyMesh.rotation.y += 0.002;
      earthCloudMesh.rotation.y += 0.003;

      const roverAngle = angle * 1.65;
      const roverR = 11.2;
      roverGroup.position.set(Math.cos(roverAngle) * roverR, 0.05, Math.sin(roverAngle) * roverR);
      roverGroup.rotation.y = -roverAngle + Math.PI / 2;
      roverWheels.forEach((rw) => {
        rw.rotation.z -= 0.08;
      });

      // Animate Maya, Leo & Sam talking in sync with real speech audio on EVA apron
      const timeSec = angle * 16;
      const mayaTargetX = st.shelterActive ? -0.85 : 0.75;
      const mayaTargetZ = st.shelterActive ? 2.25 : 4.05;
      const leoTargetX = st.shelterActive ? 0.0 : 1.85;
      const leoTargetZ = st.shelterActive ? 2.55 : 4.45;
      const samTargetX = st.shelterActive ? 0.85 : 2.95;
      const samTargetZ = st.shelterActive ? 2.25 : 3.9;

      mayaOutpostRig.root.position.x = THREE.MathUtils.lerp(mayaOutpostRig.root.position.x, mayaTargetX, 0.08);
      mayaOutpostRig.root.position.z = THREE.MathUtils.lerp(mayaOutpostRig.root.position.z, mayaTargetZ, 0.08);
      leoOutpostRig.root.position.x = THREE.MathUtils.lerp(leoOutpostRig.root.position.x, leoTargetX, 0.08);
      leoOutpostRig.root.position.z = THREE.MathUtils.lerp(leoOutpostRig.root.position.z, leoTargetZ, 0.08);
      samOutpostRig.root.position.x = THREE.MathUtils.lerp(samOutpostRig.root.position.x, samTargetX, 0.08);
      samOutpostRig.root.position.z = THREE.MathUtils.lerp(samOutpostRig.root.position.z, samTargetZ, 0.08);

      const lip = voiceGuide.getLipSyncState();
      const lipOpenFor = (who: 'maya' | 'leo' | 'sam') => (lip.speaker === who ? lip.openness : 0);

      animateAstronaut(mayaOutpostRig, {
        timeSec,
        pose: 'talk_idle',
        isSpeaking: lip.speaker === 'maya',
        mouthOpen: lipOpenFor('maya'),
        mouthSpread: lip.spread,
        lookAtYaw: 0.28,
      });
      animateAstronaut(leoOutpostRig, {
        timeSec: timeSec + 0.5,
        pose: 'talk_idle',
        isSpeaking: lip.speaker === 'leo',
        mouthOpen: lipOpenFor('leo'),
        mouthSpread: lip.spread,
        lookAtYaw: 0.05,
      });
      animateAstronaut(samOutpostRig, {
        timeSec: timeSec + 1.0,
        pose: 'talk_idle',
        isSpeaking: lip.speaker === 'sam',
        mouthOpen: lipOpenFor('sam'),
        mouthSpread: lip.spread,
        lookAtYaw: -0.28,
      });

      solarPanels.forEach((p) => {
        p.rotation.y = Math.sin(angle * 0.7) * 0.4;
      });

      renderer.render(scene, camera);

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
      mayaOutpostRig.dispose();
      leoOutpostRig.dispose();
      samOutpostRig.dispose();
      starGeo.dispose();
      starMat.dispose();
      softParticleTex.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      earthRealisticTex.dispose();
      earthCloudGeo.dispose();
      earthCloudMat.dispose();
      earthCloudTex.dispose();
      earthAtmoGeo.dispose();
      earthAtmoMat.dispose();
      phobosGeo.dispose();
      phobosMat.dispose();
      terrainGeo.dispose();
      craterRingGeo.dispose();
      apronGeo.dispose();
      apronMat.dispose();
      domeRibGeo.dispose();
      thrusterGeo.dispose();
      windowStripGeo.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      lunarTerrainTex.dispose();
      marsTerrainTex.dispose();
      terrainMat.dispose();
      goldFoilTex.dispose();
      solarTex.dispose();
      solarMat.dispose();
      kaptonMat.dispose();
      habMat.dispose();
      metalMat.dispose();
      plantGeo.dispose();
      leafMat.dispose();
      wheelGeo.dispose();
      wheelMat.dispose();
      puffGeo.dispose();
      puffMat.dispose();
      rayGeo.dispose();
      rayMat.dispose();
      renderer.dispose();
    };
  }, []);

  // Outpost resource balance loop
  useEffect(() => {
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      if (!s.running) return;

      const simHours = 0.22 * s.timeScale;
      s.elapsedRealSec += 0.4;
      s.hourOfSol += simHours;
      if (s.hourOfSol >= 24) {
        s.hourOfSol -= 24;
        s.sol += 1;
      }

      const daylightFactor = Math.max(0, Math.sin(((s.hourOfSol - 6) / 24) * Math.PI * 2));
      const solarPeakKw = s.theater === 'lunar' ? 34 : 26;
      const dustPenalty = s.activeDrills.includes('DUST_STORM_BLACKOUT') ? 0.18 : 1.0;
      const kilopowerKw = 18;
      const totalPowerKw = Number((kilopowerKw + solarPeakKw * daylightFactor * dustPenalty).toFixed(1));

      const demandKw = s.allocEclss + s.allocShielding + s.allocHydroponics + s.allocThermal;
      const netKw = totalPowerKw - demandKw;
      s.batteryPct = Math.min(100, Math.max(0, s.batteryPct + netKw * 0.18 * s.timeScale));

      const brownoutScale = s.batteryPct <= 1 && netKw < 0 ? Math.max(0.2, totalPowerKw / Math.max(1, demandKw)) : 1;
      const effEclss = s.allocEclss * brownoutScale;
      const effShield = s.allocShielding * brownoutScale;
      const effHydro = s.allocHydroponics * brownoutScale;
      const effThermal = s.allocThermal * brownoutScale;

      const eclssBalance = (effEclss - 11.5) * 0.04 * simHours;
      // Mars outside pressure is ~0.74 kPa (<1% of Earth), so an open meteor hole vents faster on Mars
      const leakFactor = s.theater === 'mars' ? 1.05 : 0.85;
      const punctureLeak = s.activeDrills.includes('HULL_MICROMETEOROID') && !s.hullIsolated ? leakFactor * simHours : 0;
      s.pressureKpa = Math.min(102.5, Math.max(45, s.pressureKpa - punctureLeak + (s.hullIsolated ? 0.25 * simHours : 0)));
      s.o2Pct = Math.min(23.5, Math.max(14.0, s.o2Pct + eclssBalance * 0.5 - punctureLeak * 0.18));
      s.co2MmHg = Math.min(18.0, Math.max(1.2, s.co2MmHg - eclssBalance * 1.1));

      const baseSpaceFlux = (s.theater === 'lunar' ? 0.12 : 0.09) * s.nasaFluxMult;
      const speMultiplier = s.activeDrills.includes('SOLAR_FLARE_SPE') ? 14.0 : 1.0;
      const shieldAttenuation = Math.max(0.18, 1 - effShield / 20);
      const shelterAttenuation = s.shelterActive ? 0.22 : 1.0;
      const doseRateMsvHr = Number((baseSpaceFlux * speMultiplier * shieldAttenuation * shelterAttenuation).toFixed(3));
      s.radiationMsv = Number((s.radiationMsv + doseRateMsvHr * simHours).toFixed(2));

      const harvestMultiplier = s.shelterActive ? 0.55 : 1.0;
      const foodDeltaSols = ((effHydro / 11.0) * harvestMultiplier - 0.85) * (simHours / 24);
      s.foodSols = Math.max(0, Math.min(45, Number((s.foodSols + foodDeltaSols).toFixed(2))));

      s.waterRecoveryPct = Math.min(99.2, Math.max(72, 86 + (effThermal / 12) * 12));

      // Inside cozy habitat temperature driven by Water & Heater Saver against real Mars / Lunar night cold
      const outsideTempC = s.theater === 'mars'
        ? s.marsOutsideAvgC + (daylightFactor - 0.35) * (Math.abs(s.marsOutsideMinC - s.marsOutsideAvgC) * 0.6)
        : daylightFactor > 0.2 ? 45 : -130;
      const targetTempC = 14.0 + Math.min(9.0, effThermal * 0.9) + daylightFactor * 1.8 - (outsideTempC < -80 ? 1.5 : 0);
      s.insideTempC = Number((s.insideTempC + (targetTempC - s.insideTempC) * 0.22).toFixed(1));

      let healthDelta = 0;
      if (s.o2Pct < 18.5 || s.co2MmHg > 7.5 || s.pressureKpa < 82) healthDelta -= 1.8 * simHours;
      else if (s.insideTempC < 16.0) healthDelta -= 1.1 * simHours;
      else if (doseRateMsvHr > 0.65) healthDelta -= 1.4 * simHours;
      else if (s.foodSols <= 0.1) healthDelta -= 1.2 * simHours;
      else healthDelta += 0.35 * simHours;

      s.crewHealthPct = Math.round(Math.min(100, Math.max(0, s.crewHealthPct + healthDelta)));

      // Friendly multi-gender voice alerts & proactive science teaching
      if (s.o2Pct < 18.8) {
        voiceGuide.speak('Heads up! Fresh air is getting low. Give more power to Air Maker so it splits water into oxygen!', {
          cooldownMs: 12000,
          speaker: 'maya',
        });
      } else if (s.insideTempC < 16.5) {
        voiceGuide.speak('Brrr! Outside space is freezing cold! Turn up Water & Heater Saver to warm the habitat.', {
          cooldownMs: 12000,
          speaker: 'leo',
        });
      } else if (s.batteryPct < 18) {
        voiceGuide.speak('Battery is running low! Turn down extra machines to save stored power.', {
          cooldownMs: 12000,
          speaker: 'sam',
        });
      } else if ((s.hourOfSol >= 19.5 || s.hourOfSol < 4.5) && !teachingDoneRef.current.has('night_reactor')) {
        teachingDoneRef.current.add('night_reactor');
        voiceGuide.speak(
          'Nightfall on the base! Without sunlight, solar panels rest while our compact Kilopower nuclear reactor and batteries keep the lights and heaters warm!',
          { cooldownMs: 12000, speaker: 'leo', useNeuralTts: true }
        );
      } else if (s.allocEclss >= 16 && !teachingDoneRef.current.has('air_maker_science')) {
        teachingDoneRef.current.add('air_maker_science');
        voiceGuide.speak(
          'Science note: our Air Maker uses electricity to split water molecules into breathable oxygen and scrub carbon dioxide out of the dome!',
          { cooldownMs: 12000, speaker: 'maya', useNeuralTts: true }
        );
      } else if (s.allocHydroponics >= 14 && !teachingDoneRef.current.has('farm_science')) {
        teachingDoneRef.current.add('farm_science');
        voiceGuide.speak(
          'Look at the Space Farm! Just like plants on Earth, our dome crops drink crew carbon dioxide under purple lights and release fresh oxygen!',
          { cooldownMs: 12000, speaker: 'maya', useNeuralTts: true }
        );
      } else if ((s.allocShielding >= 14 || s.shelterActive) && !teachingDoneRef.current.has('shield_science')) {
        teachingDoneRef.current.add('shield_science');
        voiceGuide.speak(
          'Smart shielding! Thick water walls and packed Moon dirt slow down fast invisible particles blasted by solar storms before they reach astronauts!',
          { cooldownMs: 12000, speaker: 'sam', useNeuralTts: true }
        );
      }

      let status: OutpostTelemetry['status'] = 'NOMINAL';
      if (s.crewHealthPct <= 0) status = 'FAILED';
      else if (s.o2Pct < 18.0 || s.co2MmHg > 8.5 || s.pressureKpa < 80 || doseRateMsvHr > 0.7 || s.insideTempC < 15.0) status = 'CRITICAL';
      else if (s.batteryPct < 20 || s.activeDrills.length > 0 || s.foodSols < 3 || s.insideTempC < 17.5) status = 'CAUTION';

      const safetyScore = Math.round(
        Math.min(
          100,
          Math.max(
            0,
            s.crewHealthPct * 0.55 +
              Math.max(0, 25 - s.radiationMsv * 0.6) +
              Math.min(20, (s.waterRecoveryPct - 70) * 0.65)
          )
        )
      );

      const snap: OutpostTelemetry = {
        theater: s.theater,
        sol: s.sol,
        hourOfSol: Number(s.hourOfSol.toFixed(1)),
        totalPowerKw,
        batteryPct: Math.round(s.batteryPct),
        powerDemandKw: demandKw,
        allocEclss: s.allocEclss,
        allocShielding: s.allocShielding,
        allocHydroponics: s.allocHydroponics,
        allocThermal: s.allocThermal,
        o2Pct: Number(s.o2Pct.toFixed(1)),
        co2MmHg: Number(s.co2MmHg.toFixed(1)),
        pressureKpa: Number(s.pressureKpa.toFixed(1)),
        radiationMsv: s.radiationMsv,
        doseRateMsvHr,
        foodSols: s.foodSols,
        waterRecoveryPct: Number(s.waterRecoveryPct.toFixed(1)),
        crewHealthPct: s.crewHealthPct,
        insideTempC: s.insideTempC,
        shelterActive: s.shelterActive,
        hullIsolated: s.hullIsolated,
        activeDrills: [...s.activeDrills],
        status,
        safetyScore,
      };

      setTelemetry(snap);
      setHistory((prev) => [
        ...prev.slice(-39),
        {
          t: Math.round(s.sol * 24 + s.hourOfSol),
          o2: snap.o2Pct,
          co2: snap.co2MmHg,
        },
      ]);

      const now = performance.now();
      if (now - s.lastBroadcastAt > 900) {
        s.lastBroadcastAt = now;
        missionSocket.send('telemetry:outpost', snap);
      }
    }, 400);

    return () => window.clearInterval(interval);
  }, []);

  const applyPreset = (preset: 'balanced' | 'farm' | 'shield') => {
    if (preset === 'balanced') {
      setAllocEclss(14);
      setAllocShielding(8);
      setAllocHydroponics(10);
      setAllocThermal(8);
      setShelterActive(false);
      voiceGuide.speak('Balanced Base mode on! Matching power used with solar and reactor supply keeps our battery healthy!', {
        priority: true,
        speaker: 'leo',
        useNeuralTts: true,
      });
    } else if (preset === 'farm') {
      setAllocEclss(13);
      setAllocShielding(6);
      setAllocHydroponics(16);
      setAllocThermal(9);
      setShelterActive(false);
      voiceGuide.speak('Grow Food mode on! Hydroponic veggies grow in nutrient water without dirt and help recycle crew air!', {
        priority: true,
        speaker: 'maya',
        useNeuralTts: true,
      });
    } else {
      setAllocEclss(13);
      setAllocShielding(16);
      setAllocHydroponics(5);
      setAllocThermal(6);
      setShelterActive(true);
      voiceGuide.speak('Storm Shield mode on! Our astronauts step behind thick water and soil walls that block seventy-eight percent of solar storm radiation!', {
        priority: true,
        speaker: 'sam',
        useNeuralTts: true,
      });
    }
  };

  const triggerDrill = (drillId: string) => {
    if (!stateRef.current.activeDrills.includes(drillId)) {
      stateRef.current.activeDrills = [...stateRef.current.activeDrills, drillId];
      missionSocket.send('drill:inject', { drillId, sender: callsign });
      telemetryAudio.playAlertTone('critical');
      if (OUTPOST_DRILLS[drillId]) {
        voiceGuide.speak(OUTPOST_DRILLS[drillId].voice, {
          priority: true,
          speaker: drillId === 'DUST_STORM_BLACKOUT' ? 'leo' : 'sam',
          useNeuralTts: true,
        });
      }
      onAuditEvent?.('OUTPOST_DRILL_TRIGGERED', 'NASA-STD-3001', `Triggered ${drillId} in ${theater} outpost`);
    }
  };

  const resolveDrill = (drillId: string) => {
    if (drillId === 'SOLAR_FLARE_SPE') {
      setShelterActive(true);
      setAllocShielding(14);
    } else if (drillId === 'HULL_MICROMETEOROID') {
      setHullIsolated(true);
      stateRef.current.pressureKpa = Math.max(stateRef.current.pressureKpa, 94.0);
    } else if (drillId === 'DUST_STORM_BLACKOUT') {
      setAllocHydroponics(4);
      setAllocThermal(5);
      setAllocEclss(13);
    }
    stateRef.current.activeDrills = stateRef.current.activeDrills.filter((d) => d !== drillId);
    stateRef.current.drillsResolved += 1;
    missionSocket.send('drill:clear', { drillId });
    const lessonText =
      drillId === 'HULL_MICROMETEOROID'
        ? 'Airlock sealed! Closing bulkhead doors keeps cabin pressure safe instead of letting air rush into thin space!'
        : drillId === 'DUST_STORM_BLACKOUT'
        ? 'Power saved! Saving watts for the Air Maker lets our batteries survive huge planet-wide dust storms!'
        : 'Storm shelter locked! Thick shielding keeps the crew safe until solar storm particles calm down!';
    voiceGuide.speak(lessonText, { priority: true, speaker: 'maya', useNeuralTts: true });
    onAuditEvent?.('OUTPOST_DRILL_RESOLVED', 'NASA-STD-3001', `Mitigated ${drillId} in ${theater} outpost`);
  };

  const resetOutpost = () => {
    const s = stateRef.current;
    s.sol = 1;
    s.hourOfSol = 6;
    s.batteryPct = 86;
    s.o2Pct = 20.9;
    s.co2MmHg = 2.8;
    s.pressureKpa = 101.3;
    s.radiationMsv = 1.4;
    s.foodSols = 14.0;
    s.waterRecoveryPct = 96.5;
    s.crewHealthPct = 99;
    s.activeDrills = [];
    s.drillsResolved = 0;
    s.elapsedRealSec = 0;
    teachingDoneRef.current.clear();
    setShelterActive(false);
    setHullIsolated(false);
    setAllocEclss(14);
    setAllocShielding(8);
    setAllocHydroponics(10);
    setAllocThermal(8);
    setHistory([]);
    setSaveMsg(null);
    voiceGuide.speak('Base mission restarted! Ready for Day 1!', {
      priority: true,
      speaker: voiceGuide.resolveCoachSpeaker(),
      useNeuralTts: true,
    });
  };

  const handleSaveOutpost = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await onSaveRun({
        mode: theater === 'mars' ? 'mars_outpost' : 'lunar_outpost',
        outcome: telemetry.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
        safetyScore: telemetry.safetyScore,
        durationSec: Math.round(stateRef.current.elapsedRealSec),
        radiationDoseMsv: telemetry.radiationMsv,
        drillsResolved: stateRef.current.drillsResolved,
        multiplayerRoom: roomId,
        standardRef: 'NASA-STD-3001',
      });
      setSaveMsg('Base mission saved to your badge log!');
      voiceGuide.speak('Mission saved to your badge log! Great science teamwork, Commander!', {
        priority: true,
        speaker: 'maya',
        useNeuralTts: true,
      });
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const o2Points = history
    .map((pt, idx) => `${(idx / Math.max(1, history.length - 1)) * 420},${100 - ((pt.o2 - 14) / 10) * 90}`)
    .join(' ');
  const co2Points = history
    .map((pt, idx) => `${(idx / Math.max(1, history.length - 1)) * 420},${100 - (pt.co2 / 18) * 90}`)
    .join(' ');

  const heroImage =
    theater === 'lunar'
      ? '/src/assets/images/lunar_outpost_horizon_1794649072089.jpg'
      : '/src/assets/images/martian_outpost_horizon_1794649072579.jpg';

  const airQualityGood = telemetry.o2Pct >= 19.0 && telemetry.co2MmHg <= 6.5 && telemetry.pressureKpa >= 88;
  const powerOverloaded = telemetry.powerDemandKw > telemetry.totalPowerKw;

  const tradeoffTip = telemetry.activeDrills.includes('SOLAR_FLARE_SPE')
    ? 'Trade-Off: Hiding in Storm Shelter blocks 78% of NASA solar rays, while Space Farm crops grow slower until the storm ends!'
    : powerOverloaded
    ? 'Trade-Off: Total power used is higher than sunlight + reactor! Lower Space Farm or Shield slightly, or your battery will drain.'
    : theater === 'mars' && nasaFeed
    ? `Real Mars Challenge: Outside is ${nasaFeed.marsWeather.avgTempC}°C with ${nasaFeed.marsWeather.pressureKpa} kPa air! Keep Water & Heater Saver up to hold inside at ${(telemetry.insideTempC ?? 21).toFixed(0)}°C.`
    : shelterActive
    ? 'Trade-Off: Storm Shelter keeps rays super low, but crops grow 45% slower while astronauts stay sheltered.'
    : 'Trade-Off Tip: Giving more power to Space Farm grows bonus food faster, so watch Battery and Fresh Air!';

  const topAsteroid = nasaFeed?.asteroids?.[0];

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-[#0B0E17] border border-slate-800 p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <p className="text-xs text-slate-400">
                  Junior Astronaut Base Trainer · Day {telemetry.sol} · {telemetry.hourOfSol.toFixed(0)}:00
                </p>
                <h1 className="text-2xl font-bold text-slate-100 mt-0.5">
                  {theater === 'lunar' ? 'Moon South Pole Base' : 'Mars Red Crater Base'}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={toggleVoice}
                  className={`px-3 py-1.5 text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap ${
                    voiceEnabled
                      ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>{voiceEnabled ? 'Voice Guide On' : 'Voice Guide Off'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !musicEnabled;
                    setMusicEnabled(next);
                    telemetryAudio.setMusicEnabled(next);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap ${
                    musicEnabled
                      ? 'bg-indigo-950/60 border-indigo-400/60 text-indigo-200'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>{musicEnabled ? 'Space Music On' : 'Space Music Off'}</span>
                </button>

                <div className="flex items-center gap-1 bg-slate-900 p-1 border border-slate-800">
                  <button
                    onClick={() => {
                      setTheater('lunar');
                      voiceGuide.speak(
                        'Switching to Moon South Pole Base! Notice no air in the lunar sky and icy crater shadows that hide frozen water we can turn into oxygen!',
                        { priority: true, speaker: 'maya', useNeuralTts: true }
                      );
                    }}
                    className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      theater === 'lunar' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Moon Base
                  </button>
                  <button
                    onClick={() => {
                      setTheater('mars');
                      const marsFact = nasaFeed
                        ? `Real NASA InSight data shows Mars outside is minus ${Math.abs(Math.round(nasaFeed.marsWeather.avgTempC))} degrees Celsius with super-thin air!`
                        : 'Watch the super-thin icy Mars air!';
                      voiceGuide.speak(
                        `Switching to Mars Red Crater Base! ${marsFact} Keep Water and Heater Saver warm!`,
                        { priority: true, speaker: 'leo', useNeuralTts: true }
                      );
                    }}
                    className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      theater === 'mars' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Mars Base
                  </button>
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-300 mt-4 leading-relaxed max-w-2xl">
              You are the Base Commander! Share your solar and mini-reactor power between Fresh Air, Space Shield,
              Space Farm, and Water &amp; Heater Saver while reacting to real NASA Sun, Mars, and Asteroid data.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRunning((r) => !r)}
                className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 flex items-center gap-1.5 whitespace-nowrap"
              >
                {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{running ? 'Pause' : 'Play'}</span>
              </button>

              <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5">
                {([1, 3, 6] as const).map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setTimeScale(spd)}
                    className={`px-2.5 py-1 text-xs font-mono whitespace-nowrap ${
                      timeScale === spd ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              <button
                onClick={resetOutpost}
                className="px-3 py-2 text-xs font-medium border border-slate-800 bg-slate-900 text-slate-300 hover:text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Start Over</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  voiceGuide.primeSpeech();
                  setShowAiCoach((c) => !c);
                }}
                className={`px-3.5 py-2 text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap ${
                  showAiCoach
                    ? 'bg-cyan-600 border-cyan-400 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 border-cyan-500/60 text-cyan-200'
                }`}
              >
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>{showAiCoach ? 'Hide AI Coach' : 'Ask AI Coach'}</span>
              </button>

              <button
                onClick={handleSaveOutpost}
                disabled={saving || !isSignedIn}
                className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : isSignedIn ? 'Save Base Score' : 'Sign In to Save'}</span>
              </button>
            </div>
          </div>
          {saveMsg && <p className="text-xs text-cyan-300 mt-2">{saveMsg}</p>}
        </div>

        <div className="lg:col-span-5 relative border border-slate-800 bg-[#0B0E17] min-h-[220px] overflow-hidden">
          <img
            src={heroImage}
            alt={theater === 'lunar' ? 'Moon South Pole Base' : 'Mars Red Crater Base'}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#07090E]/90 via-black/30 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
            <div>
              <p className="text-xs text-slate-300">Base Status</p>
              <p
                className={`text-base font-semibold ${
                  telemetry.status === 'NOMINAL'
                    ? 'text-emerald-400'
                    : telemetry.status === 'CAUTION'
                    ? 'text-amber-300'
                    : 'text-rose-400'
                }`}
              >
                {telemetry.status === 'NOMINAL'
                  ? '● Everything Safe!'
                  : telemetry.status === 'CAUTION'
                  ? '▲ Watch Power or Alerts'
                  : '✖ Crew Needs Help!'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Base Score</p>
              <p className="text-2xl font-mono font-bold text-slate-100">{telemetry.safetyScore}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Live In-Base AI Flight Coach */}
      {showAiCoach && (
        <AskAiCoachPanel
          callsign={callsign}
          mode={theater === 'mars' ? 'mars_outpost' : 'lunar_outpost'}
          telemetry={telemetry}
          nasaFeed={nasaFeed}
          variant="embedded"
          voiceEnabled={voiceEnabled}
          onToggleVoice={toggleVoice}
          onClose={() => setShowAiCoach(false)}
        />
      )}

      {/* Live NASA Open APIs Telemetry Feed (DONKI Sun, InSight Mars, NeoWs Asteroids) */}
      {nasaFeed && (
        <div className="bg-[#0B0E17] border border-cyan-500/30 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Satellite className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Live NASA Space Data Feed · Real Missions Driving Your Base
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">{nasaFeed.source}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#07090E] border border-slate-800 p-3.5 flex flex-col justify-between gap-2.5">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <Sun className="w-3.5 h-3.5" />
                    NASA Sun Watch (DONKI)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {nasaFeed.spaceWeather.recentCmeCount} CME Waves / 30d
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  Latest Sun wave: <span className="font-mono text-amber-200">{nasaFeed.spaceWeather.latestCmeSpeedKms} km/s</span>{' '}
                  (Peak <span className="font-mono text-amber-200">{nasaFeed.spaceWeather.fastestCmeSpeedKms} km/s</span> · Kp {nasaFeed.spaceWeather.latestKpIndex}).
                  {nasaFeed.spaceWeather.level === 'STORM_WATCH' ? ' Space Radiation Belt active!' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerDrill('SOLAR_FLARE_SPE')}
                  className="flex-1 py-1.5 px-2 text-xs font-medium bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 text-amber-200 whitespace-nowrap"
                >
                  Run NASA Solar Wave
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!voiceGuide.isEnabled()) {
                      voiceGuide.setEnabled(true);
                      setVoiceEnabled(true);
                    }
                    voiceGuide.speak(
                      `Live from NASA Sun satellites! In the past 30 days there were ${nasaFeed.spaceWeather.recentCmeCount} solar coronal mass ejections, moving as fast as ${nasaFeed.spaceWeather.fastestCmeSpeedKms} kilometers per second! Tap Run NASA Solar Wave to practice shielding your astronauts.`,
                      { priority: true }
                    );
                  }}
                  className="py-1.5 px-2.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300"
                  aria-label="Listen to NASA Sun Watch"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-[#07090E] border border-slate-800 p-3.5 flex flex-col justify-between gap-2.5">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                    <Thermometer className="w-3.5 h-3.5" />
                    NASA Mars Lander (InSight Sol {nasaFeed.marsWeather.sol})
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {nasaFeed.marsWeather.pressureKpa} kPa Air
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  Outside Mars temp: <span className="font-mono text-cyan-200">{nasaFeed.marsWeather.avgTempC}°C</span>{' '}
                  (Night low <span className="font-mono text-cyan-200">{nasaFeed.marsWeather.minTempC}°C</span>) · Wind{' '}
                  <span className="font-mono">{nasaFeed.marsWeather.windMs} m/s {nasaFeed.marsWeather.windDirection}</span>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTheater('mars')}
                  className="flex-1 py-1.5 px-2 text-xs font-medium bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 whitespace-nowrap"
                >
                  {theater === 'mars' ? 'Active in Mars Base' : 'Load Into Mars Base'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!voiceGuide.isEnabled()) {
                      voiceGuide.setEnabled(true);
                      setVoiceEnabled(true);
                    }
                    voiceGuide.speak(
                      `Real weather measured by NASA InSight on Mars! Average temperature is minus ${Math.abs(Math.round(nasaFeed.marsWeather.avgTempC))} degrees Celsius, and outside air pressure is under 1 percent of Earth's! Keep your Safety Air Door closed and Water Heater running.`,
                      { priority: true }
                    );
                  }}
                  className="py-1.5 px-2.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300"
                  aria-label="Listen to NASA Mars Weather"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-[#07090E] border border-slate-800 p-3.5 flex flex-col justify-between gap-2.5">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-300 flex items-center gap-1.5">
                    <Orbit className="w-3.5 h-3.5" />
                    NASA Asteroid Radar (Today)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {nasaFeed.asteroids.length} Flybys Tracked
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  {topAsteroid ? (
                    <>
                      Closest today: <span className="font-mono text-rose-200">{topAsteroid.name}</span> ({topAsteroid.diameterM}m wide,{' '}
                      <span className="font-mono">{topAsteroid.speedKmh.toLocaleString()} km/h</span>).
                    </>
                  ) : (
                    'Space radar scanning near-Earth asteroids and micrometeoroids.'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerDrill('HULL_MICROMETEOROID')}
                  className="flex-1 py-1.5 px-2 text-xs font-medium bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-rose-200 whitespace-nowrap"
                >
                  Test Space Rock Drill
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!voiceGuide.isEnabled()) {
                      voiceGuide.setEnabled(true);
                      setVoiceEnabled(true);
                    }
                    const msg = topAsteroid
                      ? `NASA Asteroid Radar is tracking ${nasaFeed.asteroids.length} space rocks passing near Earth today! The closest is ${topAsteroid.name}, zooming at ${topAsteroid.speedKmh.toLocaleString()} kilometers per hour.`
                      : 'NASA Asteroid Radar helps astronauts spot tiny space rocks early.';
                    voiceGuide.speak(msg, { priority: true });
                  }}
                  className="py-1.5 px-2.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300"
                  aria-label="Listen to NASA Asteroid Radar"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5 Easy-to-Read Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-[#0B0E17] border border-slate-800 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Power & Battery</span>
            <BatteryCharging className="w-4 h-4 text-cyan-400" />
          </div>
          <p className={`text-2xl font-mono font-bold mt-1 ${powerOverloaded ? 'text-amber-300' : 'text-slate-100'}`}>
            {telemetry.batteryPct}%
          </p>
          <p className="text-xs font-mono text-slate-400 mt-1">
            Using {telemetry.powerDemandKw} / {telemetry.totalPowerKw} units
          </p>
        </div>

        <div className="bg-[#0B0E17] border border-slate-800 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Fresh Air</span>
            <Wind className="w-4 h-4 text-emerald-400" />
          </div>
          <p className={`text-2xl font-mono font-bold mt-1 ${airQualityGood ? 'text-emerald-400' : 'text-rose-400'}`}>
            {airQualityGood ? 'Good' : 'Low!'}
          </p>
          <p className="text-xs font-mono text-slate-400 mt-1">
            Oxygen {telemetry.o2Pct}% · Air {telemetry.pressureKpa.toFixed(0)} kPa
          </p>
        </div>

        <div className="bg-[#0B0E17] border border-slate-800 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Space Rays</span>
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <p
            className={`text-2xl font-mono font-bold mt-1 ${
              telemetry.doseRateMsvHr > 0.6 ? 'text-rose-400' : 'text-amber-300'
            }`}
          >
            {telemetry.doseRateMsvHr > 0.6 ? 'High!' : 'Safe'}
          </p>
          <p className="text-xs font-mono text-slate-400 mt-1">
            Total {telemetry.radiationMsv.toFixed(1)} units
          </p>
        </div>

        <div className="bg-[#0B0E17] border border-slate-800 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Food & Warmth</span>
            <Sprout className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-mono font-bold text-slate-100 mt-1">
            {telemetry.foodSols.toFixed(1)}
            <span className="text-xs text-slate-400 ml-1">Days</span>
          </p>
          <p className="text-xs font-mono text-slate-400 mt-1">
            Inside {(telemetry.insideTempC ?? 21).toFixed(0)}°C · Water {telemetry.waterRecoveryPct}%
          </p>
        </div>

        <div className="bg-[#0B0E17] border border-slate-800 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Crew Health</span>
            <HeartPulse className="w-4 h-4 text-cyan-400" />
          </div>
          <p
            className={`text-2xl font-mono font-bold mt-1 ${
              telemetry.crewHealthPct < 60 ? 'text-rose-400' : 'text-cyan-300'
            }`}
          >
            {telemetry.crewHealthPct}%
          </p>
          <p className="text-xs font-mono text-slate-400 mt-1">
            {telemetry.shelterActive ? 'In Storm Shelter' : 'Exploring Base'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Easy Power Controls */}
        <div className="lg:col-span-5 bg-[#0B0E17] border border-slate-800 p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-base font-semibold text-slate-100">Share Base Power</h2>
            <span className={`font-mono text-xs ${powerOverloaded ? 'text-amber-300' : 'text-cyan-300'}`}>
              {powerOverloaded ? 'Using Battery!' : 'Solar + Reactor OK'}
            </span>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 px-3 py-2 flex items-center justify-between gap-2 text-xs text-cyan-200">
            <span>{tradeoffTip}</span>
            <button
              type="button"
              onClick={() => {
                if (!voiceGuide.isEnabled()) {
                  voiceGuide.setEnabled(true);
                  setVoiceEnabled(true);
                }
                voiceGuide.speak(tradeoffTip, {
                  priority: true,
                  speaker: voiceGuide.resolveCoachSpeaker(),
                  useNeuralTts: true,
                });
              }}
              className="text-cyan-300 hover:text-white shrink-0"
              aria-label="Hear trade-off tip"
              title="Hear Trade-Off Tip"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>

          {/* 1-Tap Quick Presets */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => applyPreset('balanced')}
              className="px-2 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 whitespace-nowrap"
            >
              Balanced Base
            </button>
            <button
              onClick={() => applyPreset('farm')}
              className="px-2 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-emerald-700/60 text-emerald-300 whitespace-nowrap"
            >
              Grow Food
            </button>
            <button
              onClick={() => applyPreset('shield')}
              className="px-2 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-amber-700/60 text-amber-300 whitespace-nowrap"
            >
              Storm Shield
            </button>
          </div>

          <div className="space-y-4">
            {[
              {
                label: 'Air Maker (Keeps Oxygen Fresh)',
                value: allocEclss,
                min: 4,
                max: 20,
                color: 'text-cyan-300',
                setter: setAllocEclss,
              },
              {
                label: 'Space Shield (Blocks Solar Rays)',
                value: allocShielding,
                min: 2,
                max: 18,
                color: 'text-amber-300',
                setter: setAllocShielding,
              },
              {
                label: 'Space Farm (Grows Veggies & Food)',
                value: allocHydroponics,
                min: 2,
                max: 18,
                color: 'text-emerald-300',
                setter: setAllocHydroponics,
              },
              {
                label: 'Water Saver (Recycles Drinking Water)',
                value: allocThermal,
                min: 2,
                max: 16,
                color: 'text-cyan-300',
                setter: setAllocThermal,
              },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-200 font-medium">{item.label}</span>
                  <span className={`font-mono ${item.color}`}>{item.value} Power</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => item.setter(Math.max(item.min, item.value - 2))}
                    className="p-1.5 bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
                    aria-label={`Decrease ${item.label}`}
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    value={item.value}
                    onChange={(e) => item.setter(Number(e.target.value))}
                    className="w-full"
                  />
                  <button
                    type="button"
                    onClick={() => item.setter(Math.min(item.max, item.value + 2))}
                    className="p-1.5 bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
                    aria-label={`Increase ${item.label}`}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-800 grid grid-cols-2 gap-3">
            <button
              onClick={() => setShelterActive((v) => !v)}
              className={`px-3 py-2 text-xs font-medium border text-left transition-colors ${
                shelterActive
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              <span className="block font-semibold">Storm Shelter</span>
              <span className="text-[11px] text-slate-400">Blocks rays · Slower farming</span>
            </button>

            <button
              onClick={() => setHullIsolated((v) => !v)}
              className={`px-3 py-2 text-xs font-medium border text-left transition-colors ${
                hullIsolated
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              <span className="block font-semibold">Safety Air Door</span>
              <span className="text-[11px] text-slate-400">
                {hullIsolated ? 'Door Closed (Safe)' : 'Door Open'}
              </span>
            </button>
          </div>

          <div className="pt-3 border-t border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">Test Emergency Drills</span>
              <span className="text-slate-400">{telemetry.activeDrills.length} active</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => triggerDrill('SOLAR_FLARE_SPE')}
                className="px-2 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Solar Storm</span>
              </button>
              <button
                onClick={() => triggerDrill('HULL_MICROMETEOROID')}
                className="px-2 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-rose-300 flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Meteor Hit</span>
              </button>
              <button
                onClick={() => triggerDrill('DUST_STORM_BLACKOUT')}
                className="px-2 py-1.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 whitespace-nowrap"
              >
                Dark Sky
              </button>
            </div>

            {telemetry.activeDrills.map((dId) => {
              const info = OUTPOST_DRILLS[dId];
              if (!info) return null;
              return (
                <div key={dId} className="bg-[#1B1014] border border-rose-500/50 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{info.title}</span>
                  </div>
                  <p className="text-xs text-slate-300">{info.detail}</p>
                  <button
                    onClick={() => resolveDrill(dId)}
                    className="px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white whitespace-nowrap"
                  >
                    {info.action}
                  </button>
                </div>
              );
            })}
            {telemetry.activeDrills.length === 0 && (
              <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>All base rooms are calm and safe!</span>
              </p>
            )}
          </div>
        </div>

        {/* Right 3D Base Twin & Simple Air Graph */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="bg-[#0B0E17] border border-slate-800 flex-1 min-h-[340px] relative overflow-hidden">
            <div ref={threeMountRef} className="w-full h-full min-h-[340px] touch-none cursor-grab active:cursor-grabbing" />
            <button
              type="button"
              onClick={() => {
                if (!voiceGuide.isEnabled()) {
                  voiceGuide.setEnabled(true);
                  setVoiceEnabled(true);
                }
                const mayaLine = telemetry.shelterActive
                  ? 'Good call! Leo, Sam, and I are tucked safely inside the Storm Shelter!'
                  : telemetry.activeDrills.length > 0
                  ? 'Watch the red alert on the left, Commander! We need your help!'
                  : `Look at our green space veggies growing! Inside air is ${Math.round(telemetry.insideTempC ?? 21)} degrees Celsius.`;
                const leoLine = telemetry.shelterActive
                  ? 'Roger that Maya! Our water wall shield is holding strong!'
                  : 'Everything outside looks awesome, Maya! Rover patrol is checking the solar panels!';
                const samLine = 'Air pressure and mini-reactor power are steady across all base domes!';
                voiceGuide.speak(mayaLine, {
                  priority: true,
                  speaker: 'maya',
                  onEnd: () => {
                    window.setTimeout(() => {
                      voiceGuide.speak(leoLine, {
                        priority: true,
                        speaker: 'leo',
                        onEnd: () => {
                          window.setTimeout(() => {
                            voiceGuide.speak(samLine, { priority: true, speaker: 'sam' });
                          }, 350);
                        },
                      });
                    }, 350);
                  },
                });
              }}
              aria-label="Hear Crew Radio Talk"
              className="absolute bottom-3 right-3 px-3 py-1.5 bg-[#07090E]/92 border border-slate-700 text-cyan-200 hover:text-white text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Hear Crew Talk</span>
            </button>
          </div>

          <div className="bg-[#0B0E17] border border-slate-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-200">Fresh Air & Stale Air Graph</h3>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-emerald-400">― Fresh Oxygen</span>
                <span className="text-amber-400">― Stale Air (CO2)</span>
              </div>
            </div>
            <svg viewBox="0 0 420 110" className="w-full h-28 bg-[#07090E] border border-slate-800/80">
              <line x1="0" y1="28" x2="420" y2="28" stroke="#1E293B" strokeWidth="1" />
              <line x1="0" y1="55" x2="420" y2="55" stroke="#1E293B" strokeWidth="1" />
              <line x1="0" y1="82" x2="420" y2="82" stroke="#1E293B" strokeWidth="1" />
              {history.length > 1 && (
                <>
                  <polyline fill="none" stroke="#10B981" strokeWidth="2" points={o2Points} />
                  <polyline fill="none" stroke="#F59E0B" strokeWidth="2" points={co2Points} />
                </>
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
