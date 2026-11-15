import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FastForward, Music, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { animateAstronaut, createAstronautRig } from '../three/astronautCharacter';
import {
  createAtmosphereRimMaterial,
  createCloudLayerTexture,
  createEarthRealisticTexture,
  createFoamTankTexture,
  createPadConcreteTexture,
  createShuttleTileTexture,
  createSoftParticleTexture,
  createTileBumpTexture,
} from '../three/realisticMaterials';
import { telemetryAudio } from '../services/telemetryAudio';
import { voiceGuide, type VoiceSpeaker } from '../services/voiceGuide';
import type { NasaMissionFeed } from '../types/mission';

export type MissionJourneyStage = 'earth_station' | 'boarding' | 'shuttle_cockpit' | 'shuttle_launch';

interface DialogueCue {
  stage: MissionJourneyStage;
  speaker: 'maya' | 'leo' | 'sam';
  voiceLine: string;
}

const STORY_CUES: DialogueCue[] = [
  {
    stage: 'earth_station',
    speaker: 'maya',
    voiceLine:
      'Hey Leo! Look at our Space Shuttle on Launch Pad 39B. Those giant white water pipes spray mist at liftoff to absorb roaring engine sound waves so the shuttle stays steady!',
  },
  {
    stage: 'earth_station',
    speaker: 'leo',
    voiceLine:
      'Awesome! And see that big orange tank, Commander Maya? It holds freezing liquid hydrogen and oxygen fuel, while the twin white boosters add huge push to beat Earth gravity!',
  },
  {
    stage: 'earth_station',
    speaker: 'sam',
    voiceLine:
      'Engines and Florida ocean winds are green, pilots! Walk across the closed bridge arm into the pressurized cockpit hatch so your air pressure stays safe as we climb.',
  },
  {
    stage: 'boarding',
    speaker: 'maya',
    voiceLine:
      'Walk calmly across the bridge, Leo! Our orange flight suits carry backup oxygen and keep pressure steady all the way to orbit.',
  },
  {
    stage: 'shuttle_cockpit',
    speaker: 'leo',
    voiceLine:
      'Check out the glowing flight screens! Remember the rocket rule: hot gas blasts downward with huge thrust so our shuttle shoots upward the opposite way!',
  },
  {
    stage: 'shuttle_cockpit',
    speaker: 'maya',
    voiceLine:
      'To stay in orbit without falling back down, we must reach twenty-eight thousand kilometers per hour sideways around Earth! Three, two, one, main engine ignition!',
  },
  {
    stage: 'shuttle_launch',
    speaker: 'leo',
    voiceLine:
      'Liftoff! Feel how light we feel as Earth drops below the clouds—in orbit we are gently falling around the curved planet, which makes astronauts float weightless!',
  },
  {
    stage: 'shuttle_launch',
    speaker: 'maya',
    voiceLine:
      'Zero air friction up here means a tiny thruster puff keeps you gliding smoothly! There is the Space Station ahead—take the controls, Cadet!',
  },
];

interface ShuttleLaunchMissionProps {
  callsign: string;
  nasaFeed: NasaMissionFeed | null;
  onEnterDocking: () => void;
}

const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _targetSky = new THREE.Color();

export const ShuttleLaunchMission: React.FC<ShuttleLaunchMissionProps> = ({
  onEnterDocking,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(voiceGuide.isEnabled());
  const [musicEnabled, setMusicEnabled] = useState(telemetryAudio.isMusicEnabled());
  const [veilOpaque, setVeilOpaque] = useState(false);

  const currentCue = STORY_CUES[stepIndex] || STORY_CUES[0];

  const sceneStateRef = useRef({
    stage: 'earth_station' as MissionJourneyStage,
    speaker: 'maya' as 'maya' | 'leo' | 'sam',
    voiceEnabled: voiceGuide.isEnabled(),
    stepIndex: 0,
    boardingProgress: 0,
    launchElapsed: 0,
    snapCameraOnce: false,
  });

  useEffect(() => {
    sceneStateRef.current.voiceEnabled = voiceEnabled;
  }, [voiceEnabled]);

  const transitionToStep = (nextIndex: number) => {
    const bounded = Math.max(0, Math.min(STORY_CUES.length - 1, nextIndex));
    const prevStage = STORY_CUES[stepIndex]?.stage;
    const nextStage = STORY_CUES[bounded]?.stage;
    const isPortalSwitch =
      (prevStage === 'boarding' && nextStage === 'shuttle_cockpit') ||
      (prevStage === 'shuttle_cockpit' && nextStage === 'shuttle_launch') ||
      (prevStage !== nextStage && Math.abs(bounded - stepIndex) > 1);

    if (isPortalSwitch) {
      setVeilOpaque(true);
      window.setTimeout(() => {
        sceneStateRef.current.snapCameraOnce = true;
        setStepIndex(bounded);
        window.setTimeout(() => setVeilOpaque(false), 260);
      }, 420);
    } else {
      setStepIndex(bounded);
    }
  };

  const smoothEnterDocking = () => {
    setVeilOpaque(true);
    window.setTimeout(() => {
      onEnterDocking();
    }, 520);
  };

  // Drive audio & relaxed multi-act pacing without any text captions on screen
  useEffect(() => {
    sceneStateRef.current.stage = currentCue.stage;
    sceneStateRef.current.speaker = currentCue.speaker;
    sceneStateRef.current.stepIndex = stepIndex;

    if (currentCue.stage === 'earth_station') {
      sceneStateRef.current.boardingProgress = 0;
      sceneStateRef.current.launchElapsed = 0;
    } else if (currentCue.stage === 'shuttle_cockpit') {
      sceneStateRef.current.boardingProgress = 1;
      sceneStateRef.current.launchElapsed = 0;
    } else if (currentCue.stage === 'shuttle_launch' && stepIndex === 6) {
      telemetryAudio.playShuttleLaunchRumble(3.2);
    }

    let cancelled = false;
    let advanceTimer: number | null = null;
    const silentMs =
      currentCue.stage === 'boarding'
        ? 7200
        : currentCue.stage === 'shuttle_launch'
        ? 8200
        : 6400;

    const scheduleAdvance = (delayMs: number) => {
      if (!autoPlay || cancelled) return;
      if (advanceTimer !== null) window.clearTimeout(advanceTimer);
      advanceTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (stepIndex < STORY_CUES.length - 1) {
          transitionToStep(stepIndex + 1);
        } else {
          smoothEnterDocking();
        }
      }, delayMs);
    };

    if (voiceEnabled) {
      voiceGuide.speak(currentCue.voiceLine, {
        priority: true,
        speaker: currentCue.speaker as VoiceSpeaker,
        useNeuralTts: true,
        onEnd: () => {
          const extraWait =
            currentCue.stage === 'boarding' || currentCue.stage === 'shuttle_launch' ? 3000 : 1800;
          scheduleAdvance(extraWait);
        },
      });
    } else {
      scheduleAdvance(silentMs);
    }

    return () => {
      cancelled = true;
      if (advanceTimer !== null) window.clearTimeout(advanceTimer);
    };
  }, [stepIndex, currentCue, autoPlay, voiceEnabled]);

  useEffect(() => {
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
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x38bdf8);
    scene.background = skyColor;
    const fog = new THREE.FogExp2(0x7dd3fc, 0.0042);
    scene.fog = fog;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      48,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      900
    );
    camera.position.set(-8.2, 4.1, 10.6);

    // 3-Point Atmospheric Sunlight Rig
    const sunLight = new THREE.DirectionalLight(0xfff4d6, 2.7);
    sunLight.position.set(34, 42, 26);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -26;
    sunLight.shadow.camera.right = 26;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -18;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x1e293b, 0.88);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.85);
    rimLight.position.set(-28, 16, -24);
    scene.add(rimLight);

    const crewFillLight = new THREE.PointLight(0xfffbeb, 1.8, 12);
    crewFillLight.position.set(-8.3, 5.2, 5.5);
    scene.add(crewFillLight);

    const cockpitCabinLight = new THREE.PointLight(0xbae6fd, 2.8, 14);
    scene.add(cockpitCabinLight);

    const engineGlowLight = new THREE.PointLight(0xf97316, 0, 55, 1.5);
    scene.add(engineGlowLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const regGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      disposables.push(g);
      return g;
    };
    const regMat = <T extends THREE.Material>(m: T): T => {
      disposables.push(m);
      return m;
    };
    const regTex = <T extends THREE.Texture>(t: T): T => {
      t.anisotropy = maxAniso;
      disposables.push(t);
      return t;
    };

    const padTex = regTex(createPadConcreteTexture());
    const foamTex = regTex(createFoamTankTexture());
    const tileTex = regTex(createShuttleTileTexture());
    const tileBumpTex = regTex(createTileBumpTexture());
    const smokeTex = regTex(
      createSoftParticleTexture('rgba(255,255,255,0.92)', 'rgba(226,232,240,0.45)', 'rgba(203,213,225,0)')
    );
    const sparkTex = regTex(
      createSoftParticleTexture('rgba(255,250,220,1)', 'rgba(251,146,60,0.75)', 'rgba(239,68,68,0)')
    );

    // --- KENNEDY SPACE CENTER LAUNCH COMPLEX 39B ---
    const earthWorld = new THREE.Group();
    scene.add(earthWorld);

    const coastGround = new THREE.Mesh(
      regGeo(new THREE.CylinderGeometry(240, 240, 0.8, 64)),
      regMat(new THREE.MeshStandardMaterial({ color: 0x365314, roughness: 0.94, metalness: 0.02 }))
    );
    coastGround.position.y = -0.4;
    coastGround.receiveShadow = true;
    earthWorld.add(coastGround);

    const sandDune = new THREE.Mesh(
      regGeo(new THREE.PlaneGeometry(460, 42)),
      regMat(new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.9 }))
    );
    sandDune.rotation.x = -Math.PI / 2;
    sandDune.position.set(0, 0.02, -48);
    earthWorld.add(sandDune);

    const oceanBand = new THREE.Mesh(
      regGeo(new THREE.PlaneGeometry(520, 220)),
      regMat(
        new THREE.MeshPhysicalMaterial({
          color: 0x0284c7,
          roughness: 0.16,
          metalness: 0.2,
          clearcoat: 0.85,
          clearcoatRoughness: 0.14,
        })
      )
    );
    oceanBand.rotation.x = -Math.PI / 2;
    oceanBand.position.set(0, 0.04, -170);
    earthWorld.add(oceanBand);

    const concreteMat = regMat(
      new THREE.MeshStandardMaterial({
        map: padTex,
        bumpMap: padTex,
        bumpScale: 0.04,
        roughness: 0.86,
        metalness: 0.08,
      })
    );
    const padApron = new THREE.Mesh(regGeo(new THREE.BoxGeometry(36, 0.5, 30)), concreteMat);
    padApron.position.set(-1.5, 0.25, 0);
    padApron.receiveShadow = true;
    earthWorld.add(padApron);

    // Crawlerway Gravel Road leading up to Launch Pad 39B
    const crawlerway = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(10, 0.14, 72)),
      regMat(new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.96, metalness: 0.02 }))
    );
    crawlerway.position.set(-1.3, 0.07, 46);
    crawlerway.receiveShadow = true;
    earthWorld.add(crawlerway);

    // Scorched Concrete Flame Trench
    const trenchMat = regMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.92 }));
    const flameTrench = new THREE.Mesh(regGeo(new THREE.BoxGeometry(10, 0.55, 22)), trenchMat);
    flameTrench.position.set(0.6, 0.26, 0);
    earthWorld.add(flameTrench);

    const steelMat = regMat(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.34, metalness: 0.78 }));
    const mlpPlatform = new THREE.Mesh(regGeo(new THREE.BoxGeometry(13.5, 1.45, 11.5)), steelMat);
    mlpPlatform.position.set(-1.3, 1.15, 0);
    mlpPlatform.castShadow = true;
    mlpPlatform.receiveShadow = true;
    earthWorld.add(mlpPlatform);

    // Crew Boarding Platform + Sky Bridge + Retractable White Room
    const hazardMat = regMat(new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45, metalness: 0.2 }));
    const boardingDeck = new THREE.Mesh(regGeo(new THREE.BoxGeometry(7.2, 0.3, 5.0)), concreteMat);
    boardingDeck.position.set(-8.6, 1.8, 3.2);
    boardingDeck.receiveShadow = true;
    earthWorld.add(boardingDeck);

    const deckTrim = new THREE.Mesh(regGeo(new THREE.BoxGeometry(7.35, 0.14, 5.15)), hazardMat);
    deckTrim.position.set(-8.6, 1.65, 3.2);
    earthWorld.add(deckTrim);

    // Safety guardrails along boarding deck
    for (let gx = -11.5; gx <= -5.5; gx += 1.5) {
      const post = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8)), hazardMat);
      post.position.set(gx, 2.38, 5.6);
      earthWorld.add(post);
    }
    const topRail = new THREE.Mesh(regGeo(new THREE.BoxGeometry(6.4, 0.05, 0.05)), hazardMat);
    topRail.position.set(-8.5, 2.84, 5.6);
    earthWorld.add(topRail);

    const rampBridge = new THREE.Mesh(regGeo(new THREE.BoxGeometry(6.6, 0.24, 2.05)), steelMat);
    rampBridge.position.set(-4.3, 2.38, 2.1);
    rampBridge.rotation.z = 0.16;
    earthWorld.add(rampBridge);

    const whiteRoomShell = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(1.85, 2.25, 2.15)),
      regMat(new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, roughness: 0.28, clearcoat: 0.5 }))
    );
    whiteRoomShell.position.set(-1.3, 3.85, 1.7);
    whiteRoomShell.castShadow = true;
    earthWorld.add(whiteRoomShell);

    // Intricate Fixed Service Structure Truss Launch Tower
    const towerGroup = new THREE.Group();
    towerGroup.position.set(-6.4, 0.45, -2.8);
    const towerRedMat = regMat(new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.48, metalness: 0.52 }));
    const columnGeo = regGeo(new THREE.BoxGeometry(0.28, 21.5, 0.28));
    for (const [lx, lz] of [
      [-1.15, -1.15],
      [1.15, -1.15],
      [-1.15, 1.15],
      [1.15, 1.15],
    ]) {
      const col = new THREE.Mesh(columnGeo, towerRedMat);
      col.position.set(lx, 10.75, lz);
      col.castShadow = true;
      towerGroup.add(col);
    }
    const elevatorCore = new THREE.Mesh(regGeo(new THREE.BoxGeometry(1.1, 21, 1.1)), steelMat);
    elevatorCore.position.y = 10.5;
    towerGroup.add(elevatorCore);

    for (let tier = 0; tier < 7; tier++) {
      const deck = new THREE.Mesh(regGeo(new THREE.BoxGeometry(2.7, 0.22, 2.7)), steelMat);
      deck.position.y = 2.4 + tier * 3.0;
      towerGroup.add(deck);
    }
    // Instanced diagonal steel cross-braces
    const braceGeo = regGeo(new THREE.BoxGeometry(0.08, 3.3, 0.08));
    const braceCount = 24;
    const braceMesh = new THREE.InstancedMesh(braceGeo, steelMat, braceCount);
    const dummy = new THREE.Object3D();
    let bi = 0;
    for (let tier = 0; tier < 6; tier++) {
      const y = 3.9 + tier * 3.0;
      [
        [0, y, 1.15, 0, 0.56],
        [0, y, -1.15, 0, -0.56],
        [1.15, y, 0, 0.56, 0],
        [-1.15, y, 0, -0.56, 0],
      ].forEach(([bx, by, bz, rx, rz]) => {
        if (bi < braceCount) {
          dummy.position.set(bx, by, bz);
          dummy.rotation.set(rx, 0, rz);
          dummy.updateMatrix();
          braceMesh.setMatrixAt(bi++, dummy.matrix);
        }
      });
    }
    braceMesh.instanceMatrix.needsUpdate = true;
    braceMesh.computeBoundingSphere();
    towerGroup.add(braceMesh);

    const lightningMast = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.05, 0.16, 5.2, 10)), steelMat);
    lightningMast.position.y = 24.1;
    towerGroup.add(lightningMast);

    // Gantry Gaseous Oxygen Vent Arm & Crew Access Umbilical Arm
    const oxyArm = new THREE.Mesh(regGeo(new THREE.BoxGeometry(4.4, 0.32, 0.42)), steelMat);
    oxyArm.position.set(2.4, 15.8, 1.15);
    towerGroup.add(oxyArm);
    const beanieCap = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.45, 0.65, 0.9, 14)), concreteMat);
    beanieCap.position.set(4.5, 16.0, 1.15);
    towerGroup.add(beanieCap);
    earthWorld.add(towerGroup);

    // Pad Perimeter Floodlight Towers
    [
      [-15, 11],
      [13, 11],
      [13, -11],
    ].forEach(([lx, lz]) => {
      const pole = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.14, 0.22, 11, 10)), steelMat);
      pole.position.set(lx, 5.5, lz);
      earthWorld.add(pole);
      const lampHead = new THREE.Mesh(
        regGeo(new THREE.BoxGeometry(1.1, 0.45, 0.55)),
        regMat(new THREE.MeshBasicMaterial({ color: 0xfef3c7 }))
      );
      lampHead.position.set(lx, 11.1, lz);
      earthWorld.add(lampHead);
    });

    // Coastal Palm Trees around outer perimeter (Instanced)
    const palmTrunkGeo = regGeo(new THREE.CylinderGeometry(0.14, 0.24, 3.8, 8));
    const palmCanopyGeo = regGeo(new THREE.ConeGeometry(1.5, 1.4, 7));
    const palmTrunkMat = regMat(new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 }));
    const palmLeafMat = regMat(new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.78 }));
    const trunks = new THREE.InstancedMesh(palmTrunkGeo, palmTrunkMat, 16);
    const canopies = new THREE.InstancedMesh(palmCanopyGeo, palmLeafMat, 16);
    for (let i = 0; i < 16; i++) {
      const ang = -0.7 + i * 0.28;
      const dist = 34 + (i % 3) * 9;
      const px = Math.cos(ang) * dist;
      const pz = Math.sin(ang) * dist;
      dummy.position.set(px, 1.9, pz);
      dummy.rotation.set(0, i * 0.5, (i % 2 === 0 ? 1 : -1) * 0.06);
      dummy.scale.setScalar(0.88 + (i % 4) * 0.08);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(px, 4.1, pz);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.updateMatrix();
      canopies.setMatrixAt(i, dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    earthWorld.add(trunks);
    earthWorld.add(canopies);

    // Multi-altitude Volumetric Cumulus Cloud Deck
    const cloudsGroup = new THREE.Group();
    const cloudMat = regMat(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, transparent: true, opacity: 0.9 })
    );
    const cloudGeo = regGeo(new THREE.SphereGeometry(3.4, 14, 10));
    for (let i = 0; i < 34; i++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const ang = (i / 34) * Math.PI * 2;
      const layer = i < 18 ? 0 : 1;
      const dist = (layer === 0 ? 45 : 72) + (i % 4) * 14;
      const h = layer === 0 ? 22 + (i % 4) * 4 : 52 + (i % 5) * 7;
      puff.position.set(Math.cos(ang) * dist, h, Math.sin(ang) * dist - 12);
      puff.scale.set(2.1 + (i % 3) * 0.6, 0.72, 1.35);
      cloudsGroup.add(puff);
    }
    earthWorld.add(cloudsGroup);

    // --- PHOTOREALISTIC SPACE SHUTTLE STACK ---
    const shuttleStack = new THREE.Group();
    shuttleStack.position.set(0.6, 1.85, 0);
    scene.add(shuttleStack);

    // External Cryogenic Fuel Tank with foam texture bump relief
    const orangeTankMat = regMat(
      new THREE.MeshStandardMaterial({
        map: foamTex,
        bumpMap: foamTex,
        bumpScale: 0.035,
        roughness: 0.72,
        metalness: 0.08,
      })
    );
    const etBody = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(1.46, 1.46, 13.8, 28)), orangeTankMat);
    etBody.position.set(0, 7.75, -1.65);
    etBody.castShadow = true;
    shuttleStack.add(etBody);

    const etNose = new THREE.Mesh(regGeo(new THREE.ConeGeometry(1.46, 3.4, 28)), orangeTankMat);
    etNose.position.set(0, 16.35, -1.65);
    shuttleStack.add(etNose);

    const etCapTip = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.06, 0.2, 0.75, 14)), steelMat);
    etCapTip.position.set(0, 18.2, -1.65);
    shuttleStack.add(etCapTip);

    // Twin Solid Rocket Boosters
    const srbGroup = new THREE.Group();
    const whiteTileMat = regMat(
      new THREE.MeshPhysicalMaterial({
        map: tileTex,
        bumpMap: tileBumpTex,
        bumpScale: 0.022,
        roughness: 0.34,
        metalness: 0.16,
        clearcoat: 0.42,
      })
    );
    const blackRccMat = regMat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.68, metalness: 0.24 }));
    [-2.08, 2.08].forEach((sx) => {
      const booster = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.64, 0.64, 12.8, 24)), whiteTileMat);
      booster.position.set(sx, 6.6, -1.55);
      booster.castShadow = true;
      srbGroup.add(booster);

      const srbNose = new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.64, 1.8, 24)), whiteTileMat);
      srbNose.position.set(sx, 13.9, -1.55);
      srbGroup.add(srbNose);

      [2.6, 5.4, 8.2, 11.5].forEach((ry, ri) => {
        const ring = new THREE.Mesh(
          regGeo(new THREE.CylinderGeometry(0.66, 0.66, ri === 3 ? 0.55 : 0.16, 22)),
          blackRccMat
        );
        ring.position.set(sx, ry, -1.55);
        srbGroup.add(ring);
      });

      const skirt = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.56, 0.84, 1.1, 20)), steelMat);
      skirt.position.set(sx, 0.3, -1.55);
      srbGroup.add(skirt);
    });
    shuttleStack.add(srbGroup);

    // Orbiter Body & Wings
    const orbiterGroup = new THREE.Group();
    orbiterGroup.position.set(0, 0.4, 0.45);
    shuttleStack.add(orbiterGroup);

    const fuselage = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(1.14, 1.26, 9.4, 28)), whiteTileMat);
    fuselage.position.y = 5.45;
    fuselage.castShadow = true;
    orbiterGroup.add(fuselage);

    // Black Heat-Shield Belly Tile Liner
    const bellyHeatShield = new THREE.Mesh(
      regGeo(new THREE.CylinderGeometry(1.16, 1.28, 9.2, 24, 1, false, -Math.PI * 0.42, Math.PI * 0.84)),
      blackRccMat
    );
    bellyHeatShield.position.set(0, 5.4, 0.02);
    bellyHeatShield.rotation.y = Math.PI;
    orbiterGroup.add(bellyHeatShield);

    const cockpitCanopy = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.56, 1.14, 2.3, 24)), whiteTileMat);
    cockpitCanopy.position.y = 11.25;
    orbiterGroup.add(cockpitCanopy);

    const blackNoseCap = new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.57, 20, 14)), blackRccMat);
    blackNoseCap.position.y = 12.35;
    orbiterGroup.add(blackNoseCap);

    const glassMat = regMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x0ea5e9,
        roughness: 0.08,
        metalness: 0.25,
        clearcoat: 1.0,
        iridescence: 0.45,
      })
    );
    const windshield = new THREE.Mesh(regGeo(new THREE.BoxGeometry(1.32, 0.56, 0.44)), glassMat);
    windshield.position.set(0, 10.75, 0.72);
    windshield.rotation.x = -0.35;
    orbiterGroup.add(windshield);

    const hatchFrame = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(0.2, 1.1, 0.82)),
      regMat(new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 }))
    );
    hatchFrame.position.set(-1.12, 3.0, 0.4);
    orbiterGroup.add(hatchFrame);

    // Swept Double-Delta Wings + Carbon-Carbon Leading Edge Trim
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1.2, -1.2);
    wingShape.lineTo(3.8, -2.7);
    wingShape.lineTo(3.8, -3.65);
    wingShape.lineTo(0, -3.65);
    wingShape.closePath();
    const wingGeo = regGeo(
      new THREE.ExtrudeGeometry(wingShape, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05 })
    );
    const rightWing = new THREE.Mesh(wingGeo, whiteTileMat);
    rightWing.position.set(0.76, 4.45, -0.36);
    orbiterGroup.add(rightWing);

    const leftWing = rightWing.clone();
    leftWing.scale.x = -1;
    leftWing.position.set(-0.76, 4.45, -0.36);
    orbiterGroup.add(leftWing);

    // Swept Tail Fin + OMS Pods
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.lineTo(2.4, 0.9);
    tailShape.lineTo(2.4, 2.2);
    tailShape.lineTo(0, 2.7);
    tailShape.closePath();
    const tailGeo = regGeo(new THREE.ExtrudeGeometry(tailShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03 }));
    const tailFin = new THREE.Mesh(tailGeo, whiteTileMat);
    tailFin.rotation.y = Math.PI / 2;
    tailFin.position.set(-0.1, 0.9, -0.75);
    orbiterGroup.add(tailFin);

    [-0.95, 0.95].forEach((px) => {
      const oms = new THREE.Mesh(regGeo(new THREE.CapsuleGeometry(0.32, 1.3, 6, 14)), whiteTileMat);
      oms.position.set(px, 1.85, -0.78);
      orbiterGroup.add(oms);
    });

    const bellMat = regMat(new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.24, metalness: 0.92 }));
    [
      [0, 0.85, 0.3],
      [-0.56, 0.85, -0.32],
      [0.56, 0.85, -0.32],
    ].forEach(([ex, ey, ez]) => {
      const bell = new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.38, 0.92, 20, 1, true)), bellMat);
      bell.position.set(ex, ey, ez);
      orbiterGroup.add(bell);
    });

    // Multi-layered Volumetric Mach Shock-Diamond Plumes
    const flameGroup = new THREE.Group();
    const outerFlameMat = regMat(
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    const coreFlameMat = regMat(
      new THREE.MeshBasicMaterial({ color: 0xfef9c3, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    [
      [0, -3.0, 0.45, 1.2],
      [-2.08, -3.2, -1.55, 1.45],
      [2.08, -3.2, -1.55, 1.45],
    ].forEach(([fx, fy, fz, sc]) => {
      const outer = new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.95 * sc, 6.8 * sc, 18)), outerFlameMat);
      outer.rotation.x = Math.PI;
      outer.position.set(fx, fy, fz);
      flameGroup.add(outer);

      const core = new THREE.Mesh(regGeo(new THREE.ConeGeometry(0.46 * sc, 4.4 * sc, 14)), coreFlameMat);
      core.rotation.x = Math.PI;
      core.position.set(fx, fy + 0.65, fz);
      flameGroup.add(core);

      // Mach shock-diamond rings inside supersonic exhaust plume
      [0.3, -1.0, -2.2].forEach((dy, di) => {
        const diamond = new THREE.Mesh(
          regGeo(new THREE.OctahedronGeometry((0.36 - di * 0.08) * sc, 0)),
          coreFlameMat
        );
        diamond.scale.set(1, 1.8, 1);
        diamond.position.set(fx, fy + dy, fz);
        flameGroup.add(diamond);
      });
    });
    flameGroup.visible = false;
    shuttleStack.add(flameGroup);

    // Exhaust Sparks & Pad Deluge Steam Particle Systems
    const steamCount = 90;
    const steamPositions = new Float32Array(steamCount * 3);
    for (let i = 0; i < steamCount; i++) {
      const a = (i / steamCount) * Math.PI * 2;
      const rad = 1.8 + (i % 7) * 1.4;
      steamPositions[i * 3] = Math.cos(a) * rad;
      steamPositions[i * 3 + 1] = 1.2 + (i % 5) * 0.7;
      steamPositions[i * 3 + 2] = Math.sin(a) * rad;
    }
    const steamGeo = regGeo(new THREE.BufferGeometry());
    steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3));
    const steamMat = regMat(
      new THREE.PointsMaterial({
        map: smokeTex,
        size: 6.4,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      })
    );
    const delugeSteam = new THREE.Points(steamGeo, steamMat);
    delugeSteam.visible = false;
    earthWorld.add(delugeSteam);

    const sparkCount = 120;
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkGeo = regGeo(new THREE.BufferGeometry());
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = regMat(
      new THREE.PointsMaterial({
        map: sparkTex,
        size: 1.6,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const exhaustSparks = new THREE.Points(sparkGeo, sparkMat);
    exhaustSparks.visible = false;
    shuttleStack.add(exhaustSparks);

    // Subtle Cryogenic Venting Wisp at External Tank tip while on pad
    const ventPositions = new Float32Array(18 * 3);
    const ventGeo = regGeo(new THREE.BufferGeometry());
    ventGeo.setAttribute('position', new THREE.BufferAttribute(ventPositions, 3));
    const ventMat = regMat(
      new THREE.PointsMaterial({ map: smokeTex, size: 1.5, transparent: true, opacity: 0.45, depthWrite: false })
    );
    const cryoVent = new THREE.Points(ventGeo, ventMat);
    cryoVent.position.set(0.6, 19.8, -1.65);
    earthWorld.add(cryoVent);

    // --- EARTH PAD CHARACTERS ---
    const mayaPadRig = createAstronautRig('maya', 0.95);
    mayaPadRig.root.position.set(-9.4, 1.95, 3.6);
    mayaPadRig.root.rotation.y = Math.PI * 0.45;
    scene.add(mayaPadRig.root);

    const leoPadRig = createAstronautRig('leo', 0.92);
    leoPadRig.root.position.set(-7.3, 1.95, 3.6);
    leoPadRig.root.rotation.y = -Math.PI * 0.45;
    scene.add(leoPadRig.root);

    const samPadRig = createAstronautRig('sam', 0.95);
    samPadRig.root.position.set(-8.35, 1.95, 1.9);
    samPadRig.root.rotation.y = 0.08;
    scene.add(samPadRig.root);

    // --- SHUTTLE COCKPIT INTERIOR WITH LIVE-ANIMATED MFD & PANORAMIC SKY ---
    const cockpitGroup = new THREE.Group();
    cockpitGroup.visible = false;
    scene.add(cockpitGroup);

    const panelMat = regMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.48, metalness: 0.45 }));
    const seatMat = regMat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72, metalness: 0.18 }));

    const cockpitFloor = new THREE.Mesh(regGeo(new THREE.BoxGeometry(5.4, 0.3, 4.8)), panelMat);
    cockpitFloor.position.set(0, -0.15, 0);
    cockpitGroup.add(cockpitFloor);

    const rearLowerWall = new THREE.Mesh(regGeo(new THREE.BoxGeometry(5.4, 0.85, 0.35)), panelMat);
    rearLowerWall.position.set(0, 0.42, 2.25);
    cockpitGroup.add(rearLowerWall);

    const dashHousing = new THREE.Mesh(regGeo(new THREE.BoxGeometry(4.5, 1.15, 1.15)), panelMat);
    dashHousing.position.set(0, 0.65, -1.68);
    cockpitGroup.add(dashHousing);

    // Live-animated Canvas Avionics MFD (pure graphical artificial horizon, orbit arc, thrust bars — zero clutter text)
    const mfdCanvas = document.createElement('canvas');
    mfdCanvas.width = 512;
    mfdCanvas.height = 256;
    const mfdCtx = mfdCanvas.getContext('2d')!;
    const mfdTex = regTex(new THREE.CanvasTexture(mfdCanvas));
    mfdTex.colorSpace = THREE.SRGBColorSpace;

    const drawAnimatedMfd = (tSec: number, pitchDeg: number, thrustPct: number) => {
      mfdCtx.fillStyle = '#040914';
      mfdCtx.fillRect(0, 0, 512, 256);

      // Left Gyro Horizon Ball
      mfdCtx.strokeStyle = '#1e293b';
      mfdCtx.lineWidth = 4;
      mfdCtx.strokeRect(14, 14, 148, 228);

      mfdCtx.save();
      mfdCtx.beginPath();
      mfdCtx.arc(88, 128, 54, 0, Math.PI * 2);
      mfdCtx.clip();
      const pitchShift = Math.sin(tSec * 1.1) * 14 + pitchDeg * 1.2;
      mfdCtx.fillStyle = '#0284c7';
      mfdCtx.fillRect(24, 40, 128, 88 + pitchShift);
      mfdCtx.fillStyle = '#78350f';
      mfdCtx.fillRect(24, 128 + pitchShift, 128, 100);
      mfdCtx.restore();

      mfdCtx.strokeStyle = '#f8fafc';
      mfdCtx.lineWidth = 3;
      mfdCtx.beginPath();
      mfdCtx.arc(88, 128, 54, 0, Math.PI * 2);
      mfdCtx.stroke();
      mfdCtx.strokeStyle = '#f59e0b';
      mfdCtx.beginPath();
      mfdCtx.moveTo(56, 128);
      mfdCtx.lineTo(120, 128);
      mfdCtx.stroke();

      // Center Curved Trajectory Sweep
      mfdCtx.strokeStyle = '#1e293b';
      mfdCtx.strokeRect(178, 14, 156, 228);
      mfdCtx.strokeStyle = '#10b981';
      mfdCtx.lineWidth = 3.5;
      mfdCtx.beginPath();
      mfdCtx.moveTo(194, 214);
      mfdCtx.quadraticCurveTo(240, 104, 318, 56);
      mfdCtx.stroke();

      const progress = (tSec * 0.25) % 1;
      const dotX = (1 - progress) * (1 - progress) * 194 + 2 * (1 - progress) * progress * 240 + progress * progress * 318;
      const dotY = (1 - progress) * (1 - progress) * 214 + 2 * (1 - progress) * progress * 104 + progress * progress * 56;
      mfdCtx.fillStyle = '#fde047';
      mfdCtx.beginPath();
      mfdCtx.arc(dotX, dotY, 7, 0, Math.PI * 2);
      mfdCtx.fill();

      // Right Triple Engine Telemetry Bars
      mfdCtx.strokeStyle = '#1e293b';
      mfdCtx.strokeRect(350, 14, 148, 228);
      ['#06b6d4', '#10b981', '#f59e0b'].forEach((col, i) => {
        const x = 372 + i * 38;
        mfdCtx.fillStyle = '#0f172a';
        mfdCtx.fillRect(x, 42, 24, 174);
        const h = Math.round((0.5 + 0.45 * thrustPct + Math.sin(tSec * 7 + i) * 0.05) * 168);
        mfdCtx.fillStyle = col;
        mfdCtx.fillRect(x + 2, 214 - h, 20, h);
      });
      mfdTex.needsUpdate = true;
    };

    const mfdScreen = new THREE.Mesh(
      regGeo(new THREE.PlaneGeometry(3.8, 0.88)),
      regMat(new THREE.MeshBasicMaterial({ map: mfdTex }))
    );
    mfdScreen.position.set(0, 0.84, -1.07);
    mfdScreen.rotation.x = -0.25;
    cockpitGroup.add(mfdScreen);

    [-1.98, 1.98].forEach((px) => {
      const pillar = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.16, 1.95, 0.24)), steelMat);
      pillar.position.set(px, 1.7, 1.85);
      pillar.rotation.x = -0.24;
      cockpitGroup.add(pillar);
    });
    const headerBeam = new THREE.Mesh(regGeo(new THREE.BoxGeometry(4.5, 0.34, 0.82)), panelMat);
    headerBeam.position.set(0, 2.66, 1.5);
    cockpitGroup.add(headerBeam);

    // Center Flight-Engineer Jumpseat + Pilot & Co-Pilot Seats
    [-1.02, 1.02].forEach((sx) => {
      const seatBase = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.84, 0.42, 0.82)), seatMat);
      seatBase.position.set(sx, 0.21, -0.15);
      cockpitGroup.add(seatBase);

      const seatBack = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.8, 1.35, 0.22)), seatMat);
      seatBack.position.set(sx, 1.04, 0.24);
      seatBack.rotation.x = 0.1;
      cockpitGroup.add(seatBack);

      const stickStem = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.032, 0.044, 0.44, 10)), steelMat);
      stickStem.position.set(sx + (sx < 0 ? 0.35 : -0.35), 0.72, -0.78);
      cockpitGroup.add(stickStem);
    });

    const centerSeatBase = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.72, 0.56, 0.7)), seatMat);
    centerSeatBase.position.set(0, 0.28, 0.42);
    cockpitGroup.add(centerSeatBase);
    const centerSeatBack = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.7, 1.32, 0.2)), seatMat);
    centerSeatBack.position.set(0, 1.12, 0.82);
    centerSeatBack.rotation.x = 0.08;
    cockpitGroup.add(centerSeatBack);

    const mayaCockpitRig = createAstronautRig('maya', 0.9);
    mayaCockpitRig.root.position.set(-1.02, 0.1, -0.15);
    mayaCockpitRig.root.rotation.y = Math.PI * 0.92;
    cockpitGroup.add(mayaCockpitRig.root);

    const samCockpitRig = createAstronautRig('sam', 0.88);
    samCockpitRig.root.position.set(0, 0.24, 0.42);
    samCockpitRig.root.rotation.y = Math.PI;
    cockpitGroup.add(samCockpitRig.root);

    const leoCockpitRig = createAstronautRig('leo', 0.9);
    leoCockpitRig.root.position.set(1.02, 0.1, -0.15);
    leoCockpitRig.root.rotation.y = -Math.PI * 0.92;
    cockpitGroup.add(leoCockpitRig.root);

    // --- DEEP ORBIT STARFIELD, CURVED EARTH + FRESNEL ATMOSPHERE & STATION ---
    const starCount = 1400;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 220 + Math.random() * 180;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(ph) * Math.cos(th);
      starPositions[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      starPositions[i * 3 + 2] = r * Math.cos(ph);
    }
    const starGeo = regGeo(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = regMat(new THREE.PointsMaterial({ color: 0xf8fafc, size: 1.4, transparent: true, opacity: 0 }));
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    const earthOrbGroup = new THREE.Group();
    earthOrbGroup.position.set(-18, 95, 58);
    const earthTex = regTex(createEarthRealisticTexture());
    const earthCloudTex = regTex(createCloudLayerTexture());
    const orbitEarth = new THREE.Mesh(
      regGeo(new THREE.SphereGeometry(26, 48, 36)),
      regMat(new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.72, metalness: 0.08 }))
    );
    earthOrbGroup.add(orbitEarth);

    const orbitClouds = new THREE.Mesh(
      regGeo(new THREE.SphereGeometry(26.35, 42, 32)),
      regMat(new THREE.MeshStandardMaterial({ map: earthCloudTex, transparent: true, opacity: 0.75, depthWrite: false }))
    );
    earthOrbGroup.add(orbitClouds);

    const orbitAtmo = new THREE.Mesh(
      regGeo(new THREE.SphereGeometry(27.2, 40, 30)),
      regMat(createAtmosphereRimMaterial(0x38bdf8, 0.9))
    );
    earthOrbGroup.add(orbitAtmo);
    earthOrbGroup.visible = false;
    scene.add(earthOrbGroup);

    const spaceStationBeacon = new THREE.Group();
    const issBody = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.55, 0.55, 4.4, 18)), whiteTileMat);
    issBody.rotation.z = Math.PI / 2;
    spaceStationBeacon.add(issBody);
    const issCupola = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 16)), glassMat);
    issCupola.position.y = 0.7;
    spaceStationBeacon.add(issCupola);
    const issWing = new THREE.Mesh(
      regGeo(new THREE.BoxGeometry(8.2, 0.08, 1.7)),
      regMat(new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.22, metalness: 0.76 }))
    );
    spaceStationBeacon.add(issWing);
    spaceStationBeacon.visible = false;
    scene.add(spaceStationBeacon);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    renderer.domElement.style.touchAction = 'none';
    let orbitYawAngle = 0;
    let lookPitchOffset = 0;
    let hoverNormX = 0;
    let hoverNormY = 0;
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
        // Ignore capture errors
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (e.target === renderer.domElement || dragging)) {
        hoverNormX = THREE.MathUtils.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        hoverNormY = THREE.MathUtils.clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      orbitYawAngle -= dx * 0.008;
      lookPitchOffset = THREE.MathUtils.clamp(lookPitchOffset - dy * 0.008, -1.8, 2.2);
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
    };

    const onPointerLeave = () => {
      if (!dragging) {
        hoverNormX = 0;
        hoverNormY = 0;
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
    let lastTime = performance.now();
    let elapsedTotal = 0;
    let mfdAcc = 0;

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
      const now = performance.now();
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;
      elapsedTotal += dt;

      const st = sceneStateRef.current;
      const currentStage = st.stage;
      const speaker = st.speaker;
      const lip = voiceGuide.getLipSyncState();
      const mouthOpenFor = (who: 'maya' | 'leo' | 'sam') =>
        lip.speaker === who ? lip.openness : !st.voiceEnabled && speaker === who ? undefined : 0;

      // Animate drifting atmospheric clouds & cryo venting
      cloudsGroup.rotation.y = elapsedTotal * 0.008;
      if (earthWorld.visible) {
        const vAttr = ventGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < 18; i++) {
          const phase = ((elapsedTotal * 0.9 + i / 18) % 1);
          vAttr.setXYZ(i, -phase * 2.8, phase * 2.6, Math.sin(i * 1.3 + elapsedTotal) * 0.35);
        }
        vAttr.needsUpdate = true;
      }

      if (currentStage === 'earth_station' || currentStage === 'boarding' || currentStage === 'shuttle_cockpit') {
        _targetSky.setHex(0x38bdf8);
        skyColor.lerp(_targetSky, 1 - Math.exp(-3 * dt));
        fog.color.copy(skyColor);
        fog.density = 0.0038;
        starMat.opacity = THREE.MathUtils.damp(starMat.opacity, 0, 4, dt);
        shuttleStack.position.set(0.6, 1.85, 0);
        shuttleStack.rotation.set(0, 0, 0);
        flameGroup.visible = false;
        delugeSteam.visible = false;
        exhaustSparks.visible = false;
        engineGlowLight.intensity = 0;
        earthOrbGroup.visible = false;
        spaceStationBeacon.visible = false;
        earthWorld.visible = true;
      }

      if (currentStage === 'earth_station') {
        cockpitGroup.visible = false;
        mayaPadRig.root.visible = true;
        leoPadRig.root.visible = true;
        samPadRig.root.visible = true;

        // Arrange all 3 pilots in a clearly visible foreground triad on the boarding deck
        mayaPadRig.root.position.set(-9.75, 1.95, 3.5);
        mayaPadRig.root.rotation.y = Math.PI * 0.28;
        samPadRig.root.position.set(-8.35, 1.95, 2.45);
        samPadRig.root.rotation.y = 0.04;
        leoPadRig.root.position.set(-6.95, 1.95, 3.5);
        leoPadRig.root.rotation.y = -Math.PI * 0.28;

        animateAstronaut(mayaPadRig, {
          timeSec: elapsedTotal,
          pose: 'talk_idle',
          isSpeaking: lip.speaker === 'maya' || (!st.voiceEnabled && speaker === 'maya'),
          mouthOpen: mouthOpenFor('maya'),
          mouthSpread: lip.spread,
          lookAtYaw: speaker === 'sam' ? -0.3 : 0.25,
        });
        animateAstronaut(leoPadRig, {
          timeSec: elapsedTotal + 0.6,
          pose: 'talk_idle',
          isSpeaking: lip.speaker === 'leo' || (!st.voiceEnabled && speaker === 'leo'),
          mouthOpen: mouthOpenFor('leo'),
          mouthSpread: lip.spread,
          lookAtYaw: speaker === 'sam' ? 0.3 : -0.25,
        });
        animateAstronaut(samPadRig, {
          timeSec: elapsedTotal + 1.2,
          pose: 'talk_idle',
          isSpeaking: lip.speaker === 'sam' || (!st.voiceEnabled && speaker === 'sam'),
          mouthOpen: mouthOpenFor('sam'),
          mouthSpread: lip.spread,
          lookAtYaw: speaker === 'maya' ? -0.28 : 0.28,
        });

        _camPos.set(-8.35 + Math.sin(elapsedTotal * 0.22) * 0.45, 3.58, 9.15);
        _camLook.set(-6.9, 3.35, 1.6);
      } else if (currentStage === 'boarding') {
        cockpitGroup.visible = false;
        mayaPadRig.root.visible = true;
        leoPadRig.root.visible = true;
        samPadRig.root.visible = true;

        st.boardingProgress = Math.min(1, st.boardingProgress + dt * 0.145);
        const t = st.boardingProgress;

        mayaPadRig.root.position.set(
          THREE.MathUtils.lerp(-9.75, -1.6, t),
          THREE.MathUtils.lerp(1.95, 3.05, Math.max(0, (t - 0.15) / 0.85)),
          THREE.MathUtils.lerp(3.5, 1.3, t)
        );
        mayaPadRig.root.rotation.y = Math.PI * 0.62;

        const leoT = Math.max(0, (t - 0.1) / 0.9);
        leoPadRig.root.position.set(
          THREE.MathUtils.lerp(-6.95, -2.1, leoT),
          THREE.MathUtils.lerp(1.95, 2.95, Math.max(0, (leoT - 0.15) / 0.85)),
          THREE.MathUtils.lerp(3.5, 1.5, leoT)
        );
        leoPadRig.root.rotation.y = Math.PI * 0.62;

        samPadRig.root.position.set(-7.9, 1.95, 3.15);
        samPadRig.root.rotation.y = 0.25;

        animateAstronaut(mayaPadRig, {
          timeSec: elapsedTotal,
          pose: 'walk',
          isSpeaking: lip.speaker === 'maya' || !st.voiceEnabled,
          mouthOpen: mouthOpenFor('maya'),
          mouthSpread: lip.spread,
        });
        animateAstronaut(leoPadRig, {
          timeSec: elapsedTotal + 0.4,
          pose: 'walk',
          isSpeaking: lip.speaker === 'leo',
          mouthOpen: mouthOpenFor('leo'),
          mouthSpread: lip.spread,
        });
        animateAstronaut(samPadRig, {
          timeSec: elapsedTotal,
          pose: 'wave_cheer',
          isSpeaking: lip.speaker === 'sam',
          mouthOpen: mouthOpenFor('sam'),
          mouthSpread: lip.spread,
          lookAtYaw: 0.45,
        });

        _camPos.set(THREE.MathUtils.lerp(-8.0, -5.2, t), THREE.MathUtils.lerp(3.9, 4.65, t), 11.4);
        _camLook.set(THREE.MathUtils.lerp(-6.6, -3.7, t), 3.3, 1.6);
      } else if (currentStage === 'shuttle_cockpit') {
        mayaPadRig.root.visible = false;
        leoPadRig.root.visible = false;
        samPadRig.root.visible = false;

        cockpitGroup.visible = true;
        cockpitGroup.position.set(0.6, 12.2, 16.5);
        cockpitCabinLight.position.set(0.6, 14.5, 15.6);

        mfdAcc += dt;
        if (mfdAcc > 0.08) {
          mfdAcc = 0;
          drawAnimatedMfd(elapsedTotal, 0, 0.35);
        }

        animateAstronaut(mayaCockpitRig, {
          timeSec: elapsedTotal,
          pose: 'seated_cockpit',
          isSpeaking: lip.speaker === 'maya' || (!st.voiceEnabled && speaker === 'maya'),
          mouthOpen: mouthOpenFor('maya'),
          mouthSpread: lip.spread,
          lookAtYaw: -0.35,
          stickX: Math.sin(elapsedTotal * 1.4) * 0.25,
        });
        animateAstronaut(samCockpitRig, {
          timeSec: elapsedTotal + 0.25,
          pose: 'seated_cockpit',
          isSpeaking: lip.speaker === 'sam' || (!st.voiceEnabled && speaker === 'sam'),
          mouthOpen: mouthOpenFor('sam'),
          mouthSpread: lip.spread,
          lookAtYaw: speaker === 'leo' ? -0.22 : 0.22,
        });
        animateAstronaut(leoCockpitRig, {
          timeSec: elapsedTotal + 0.5,
          pose: 'seated_cockpit',
          isSpeaking: lip.speaker === 'leo' || (!st.voiceEnabled && speaker === 'leo'),
          mouthOpen: mouthOpenFor('leo'),
          mouthSpread: lip.spread,
          lookAtYaw: 0.35,
          stickZ: Math.cos(elapsedTotal * 1.2) * 0.25,
        });

        _camPos.set(0.6 + Math.sin(elapsedTotal * 0.25) * 0.14, 13.78, 14.22);
        _camLook.set(0.6, 13.48, 16.9);
      } else {
        // shuttle_launch: realistic rocket plume, sparks, deluge steam & climb into curved Earth orbit
        mayaPadRig.root.visible = false;
        leoPadRig.root.visible = false;
        samPadRig.root.visible = false;

        st.launchElapsed += dt;
        const lt = st.launchElapsed;
        const ascentFrac = Math.min(1, lt / 13.5);

        if (ascentFrac < 0.42) {
          _targetSky.setHex(0x38bdf8).lerp(new THREE.Color(0x1d4ed8), ascentFrac / 0.42);
          skyColor.copy(_targetSky);
          starMat.opacity = 0;
        } else {
          const sp = (ascentFrac - 0.42) / 0.58;
          _targetSky.setHex(0x1d4ed8).lerp(new THREE.Color(0x02040a), sp);
          skyColor.copy(_targetSky);
          starMat.opacity = sp;
        }
        fog.color.copy(skyColor);
        fog.density = THREE.MathUtils.lerp(0.004, 0.0004, ascentFrac);

        const altitude = Math.pow(ascentFrac, 1.5) * 150;
        shuttleStack.position.set(0.6 + Math.sin(lt * 14) * 0.045, 1.85 + altitude, 0);
        shuttleStack.rotation.z = -ascentFrac * 0.16;
        shuttleStack.rotation.x = ascentFrac * 0.05;

        flameGroup.visible = true;
        const pulse = 0.9 + Math.sin(lt * 38) * 0.16;
        flameGroup.scale.set(1, pulse, 1);
        engineGlowLight.position.set(shuttleStack.position.x, shuttleStack.position.y - 4, shuttleStack.position.z + 2);
        engineGlowLight.intensity = 6.5 + Math.sin(lt * 29) * 1.4;

        // Exhaust Sparks
        exhaustSparks.visible = true;
        const spAttr = sparkGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < sparkCount; i++) {
          const p = ((lt * 2.8 + i * 0.07) % 1);
          const ang = i * 2.39996;
          const spread = p * 2.8;
          spAttr.setXYZ(i, Math.cos(ang) * spread, -1.2 - p * 11.5, Math.sin(ang) * spread - 0.6);
        }
        spAttr.needsUpdate = true;

        // Expanding Water-Deluge Pad Steam Billow
        delugeSteam.visible = ascentFrac < 0.52;
        if (delugeSteam.visible) {
          const stAttr = steamGeo.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < steamCount; i++) {
            const ang = (i / steamCount) * Math.PI * 2;
            const ringRad = 2.2 + ascentFrac * 24 + (i % 7) * 1.5;
            stAttr.setXYZ(i, Math.cos(ang) * ringRad, 1.4 + (i % 6) * 1.1 + ascentFrac * 4.5, Math.sin(ang) * ringRad);
          }
          stAttr.needsUpdate = true;
        }

        mfdAcc += dt;
        if (mfdAcc > 0.08) {
          mfdAcc = 0;
          drawAnimatedMfd(elapsedTotal, ascentFrac * 18, 1.0);
        }

        if (st.stepIndex === 6) {
          cockpitGroup.visible = false;
          earthWorld.visible = true;
          earthOrbGroup.visible = ascentFrac > 0.4;
          spaceStationBeacon.visible = false;
          _camPos.set(-15, 9.5 + altitude * 0.74, 24.5);
          _camLook.set(0.6, 8 + altitude, 0);
        } else {
          cockpitGroup.visible = true;
          earthWorld.visible = false;
          earthOrbGroup.visible = true;
          orbitClouds.rotation.y = elapsedTotal * 0.025;
          spaceStationBeacon.visible = true;
          spaceStationBeacon.position.set(1.2, 143.2, 31);
          spaceStationBeacon.rotation.y = elapsedTotal * 0.14;

          cockpitGroup.position.set(0.6, 140, 16.5);
          cockpitCabinLight.position.set(0.6, 142.3, 15.6);
          const vib = ascentFrac < 0.85 ? Math.sin(lt * 26) * 0.012 : 0;

          animateAstronaut(mayaCockpitRig, {
            timeSec: elapsedTotal,
            pose: 'seated_cockpit',
            isSpeaking: lip.speaker === 'maya' || (!st.voiceEnabled && speaker === 'maya'),
            mouthOpen: mouthOpenFor('maya'),
            mouthSpread: lip.spread,
            lookAtYaw: -0.35,
          });
          animateAstronaut(samCockpitRig, {
            timeSec: elapsedTotal + 0.2,
            pose: 'seated_cockpit',
            isSpeaking: lip.speaker === 'sam' || (!st.voiceEnabled && speaker === 'sam'),
            mouthOpen: mouthOpenFor('sam'),
            mouthSpread: lip.spread,
            lookAtYaw: 0.18,
          });
          animateAstronaut(leoCockpitRig, {
            timeSec: elapsedTotal + 0.3,
            pose: 'seated_cockpit',
            isSpeaking: lip.speaker === 'leo' || (!st.voiceEnabled && speaker === 'leo'),
            mouthOpen: mouthOpenFor('leo'),
            mouthSpread: lip.spread,
            lookAtYaw: 0.35,
          });

          _camPos.set(0.6 + vib, 141.58 + vib, 14.22);
          _camLook.set(0.6, 141.28, 16.9);
        }
      }

      if (!dragging) {
        if (Math.abs(hoverNormX) > 0.38) {
          orbitYawAngle -= (Math.abs(hoverNormX) - 0.38) * Math.sign(hoverNormX) * 1.2 * dt;
        }
        lookPitchOffset = THREE.MathUtils.damp(lookPitchOffset, 0, 1.5, dt);
      }

      // Rotate _camPos smoothly 360 degrees around _camLook based on orbitYawAngle + subtle hover parallax
      const dxCam = _camPos.x - _camLook.x;
      const dzCam = _camPos.z - _camLook.z;
      const orbCos = Math.cos(orbitYawAngle);
      const orbSin = Math.sin(orbitYawAngle);
      _camPos.x = _camLook.x + dxCam * orbCos - dzCam * orbSin + hoverNormX * 0.4;
      _camPos.z = _camLook.z + dxCam * orbSin + dzCam * orbCos;
      _camPos.y += -hoverNormY * 0.35 + lookPitchOffset * 0.45;
      _camLook.y += -hoverNormY * 0.4 - lookPitchOffset * 0.4;

      if (st.snapCameraOnce) {
        camera.position.copy(_camPos);
        st.snapCameraOnce = false;
      } else {
        camera.position.lerp(_camPos, 1 - Math.exp(-3.2 * dt));
      }
      camera.lookAt(_camLook);
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
      mayaPadRig.dispose();
      leoPadRig.dispose();
      samPadRig.dispose();
      mayaCockpitRig.dispose();
      samCockpitRig.dispose();
      leoCockpitRig.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, []);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    voiceGuide.setEnabled(next);
    setVoiceEnabled(next);
    if (next) {
      voiceGuide.speak(currentCue.voiceLine, { priority: true, speaker: currentCue.speaker });
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-72px)] min-h-[680px] bg-[#07090E] overflow-hidden select-none">
      {/* Full-Viewport Pure Realistic 3D Graphics (Zero Text Captions / Zero Laws) */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing" />

      {/* Smooth Cinematic Crossfade Veil */}
      <div
        className={`pointer-events-none absolute inset-0 bg-[#050811] z-30 transition-opacity duration-500 ease-in-out ${
          veilOpaque ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Clean Bottom Playback Bar with Fine Descriptive Control Labels */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-wrap items-center gap-1.5 bg-[#07090E]/92 border border-slate-700 p-1.5">
        <button
          type="button"
          onClick={() => setAutoPlay((p) => !p)}
          aria-label={autoPlay ? 'Pause launch sequence' : 'Play launch sequence'}
          className="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 border border-slate-800 whitespace-nowrap transition-colors"
        >
          {autoPlay ? <Pause className="w-3.5 h-3.5 text-cyan-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
          <span>{autoPlay ? 'Pause Story' : 'Play Story'}</span>
        </button>

        <button
          type="button"
          onClick={toggleVoice}
          aria-label={voiceEnabled ? 'Mute crew voices' : 'Turn on crew voices'}
          className="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 border border-slate-800 whitespace-nowrap transition-colors"
        >
          {voiceEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyan-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
          <span>{voiceEnabled ? 'Crew Voices: On' : 'Crew Voices: Off'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = !musicEnabled;
            setMusicEnabled(next);
            telemetryAudio.setMusicEnabled(next);
          }}
          aria-label={musicEnabled ? 'Turn off space music' : 'Turn on space music'}
          className="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 border border-slate-800 whitespace-nowrap transition-colors"
        >
          <Music className={`w-3.5 h-3.5 ${musicEnabled ? 'text-indigo-400' : 'text-slate-500'}`} />
          <span>{musicEnabled ? 'Space Music: On' : 'Space Music: Off'}</span>
        </button>

        <button
          type="button"
          onClick={() => transitionToStep(0)}
          aria-label="Restart launch cutscene"
          className="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800 border border-slate-800 whitespace-nowrap transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
          <span>Restart Launch</span>
        </button>

        <button
          type="button"
          onClick={smoothEnterDocking}
          aria-label="Proceed to Space Station Docking"
          className="px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold bg-cyan-600 hover:bg-cyan-500 text-white whitespace-nowrap transition-colors"
        >
          <FastForward className="w-3.5 h-3.5" />
          <span>Fly Docking Mission</span>
        </button>
      </div>
    </div>
  );
};
