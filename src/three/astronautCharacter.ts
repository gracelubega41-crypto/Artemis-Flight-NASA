import * as THREE from 'three';

export type AstronautCharacterPreset = 'maya' | 'leo' | 'sam';

export interface AstronautRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  mouth: THREE.Group;
  mouthCavity: THREE.Mesh;
  upperLip: THREE.Mesh;
  lowerLip: THREE.Mesh;
  upperTeeth: THREE.Mesh;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  speechAnchor: THREE.Object3D;
  beaconLightMat: THREE.MeshBasicMaterial;
  dispose: () => void;
}

function createSuitWeaveTexture(baseHex: string, seamHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  // Ripstop Nomex pressure-suit micro-weave + stitched thermal quilting
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < 256; y += 6) {
    ctx.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 6) {
    ctx.fillRect(x, 0, 1, 256);
  }
  ctx.strokeStyle = seamHex;
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = 2;
  for (let y = 32; y < 256; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

const SUIT_CONFIGS: Record<
  AstronautCharacterPreset,
  {
    suitHex: string;
    seamHex: string;
    trimHex: number;
    visorHex: number;
    skinHex: number;
    cheekHex: number;
    hairHex: number;
    irisHex: number;
    bootHex: number;
    hasBackpack: boolean;
    hasHelmet: boolean;
  }
> = {
  // Commander Maya: NASA Orange ACES Launch Suit
  maya: {
    suitHex: '#ea580c',
    seamHex: '#9a3412',
    trimHex: 0x0284c7,
    visorHex: 0xfde68a,
    skinHex: 0xa4663b,
    cheekHex: 0x924f2d,
    hairHex: 0x1c1917,
    irisHex: 0x3b1f0e,
    bootHex: 0x1e293b,
    hasBackpack: true,
    hasHelmet: true,
  },
  // Pilot Leo: NASA Artemis White & Emerald xEMU Suit
  leo: {
    suitHex: '#f1f5f9',
    seamHex: '#94a3b8',
    trimHex: 0x059669,
    visorHex: 0x7dd3fc,
    skinHex: 0xeec49a,
    cheekHex: 0xdca07b,
    hairHex: 0x451a03,
    irisHex: 0x0369a1,
    bootHex: 0x334155,
    hasBackpack: true,
    hasHelmet: true,
  },
  // Director / Engineer Sam: Kennedy Space Center Jacket & Deep-Space Blue EVA Suit
  sam: {
    suitHex: '#1e40af',
    seamHex: '#172554',
    trimHex: 0xf59e0b,
    visorHex: 0xbae6fd,
    skinHex: 0xc9894b,
    cheekHex: 0xb17138,
    hairHex: 0x0f172a,
    irisHex: 0x45220c,
    bootHex: 0x0f172a,
    hasBackpack: false,
    hasHelmet: false,
  },
};

export function createAstronautRig(
  preset: AstronautCharacterPreset,
  scale = 1,
  options?: { forceHelmet?: boolean }
): AstronautRig {
  const cfg = SUIT_CONFIGS[preset];
  const useHelmet = options?.forceHelmet ?? cfg.hasHelmet;
  const useBackpack = options?.forceHelmet ? true : cfg.hasBackpack;
  const disposables: Array<{ dispose: () => void }> = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  const suitTex = createSuitWeaveTexture(cfg.suitHex, cfg.seamHex);
  disposables.push(suitTex);

  const suitMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: suitTex,
      bumpMap: suitTex,
      bumpScale: 0.016,
      roughness: 0.72,
      metalness: 0.06,
    })
  );
  const trimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: cfg.trimHex,
      roughness: 0.36,
      metalness: 0.32,
    })
  );
  const metalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.2,
      metalness: 0.9,
    })
  );
  const darkMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.34,
      metalness: 0.78,
    })
  );
  const bootMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: cfg.bootHex,
      roughness: 0.82,
      metalness: 0.14,
    })
  );
  const helmetShellMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      roughness: 0.16,
      metalness: 0.1,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
    })
  );
  // Crystal-clear aerospace dome visor so eyes, expressions, and speech stay unobstructed
  const visorGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: cfg.visorHex,
      roughness: 0.05,
      metalness: 0.12,
      iridescence: 0.55,
      iridescenceIOR: 1.33,
      transparent: true,
      opacity: 0.14,
      clearcoat: 1.0,
      depthWrite: false,
    })
  );
  const skinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: cfg.skinHex,
      emissive: cfg.skinHex,
      emissiveIntensity: 0.08,
      roughness: 0.52,
      metalness: 0.0,
    })
  );
  const cheekMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: cfg.cheekHex,
      emissive: cfg.cheekHex,
      emissiveIntensity: 0.05,
      roughness: 0.62,
    })
  );
  const hairMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: cfg.hairHex,
      roughness: 0.82,
      metalness: 0.04,
    })
  );
  const irisMat = trackMat(new THREE.MeshStandardMaterial({ color: cfg.irisHex, roughness: 0.16 }));
  const pupilMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.1 }));
  const eyeWhiteMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const mouthMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xb91c4a, roughness: 0.38 }));
  const mouthInteriorMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x24040e }));
  const teethMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 }));
  const patchBlueMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.42 }));
  const flagRedMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45 }));
  const beaconLightMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  const headlampMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfef3c7 }));

  const root = new THREE.Group();
  root.scale.setScalar(scale);

  // Pelvis & Harness (grounded so boots touch y = 0)
  const hips = new THREE.Group();
  hips.position.y = 0.78;
  root.add(hips);

  const pelvisMesh = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.18, 0.14, 8, 16)), trimMat);
  pelvisMesh.rotation.z = Math.PI / 2;
  pelvisMesh.scale.set(0.85, 1.15, 0.75);
  pelvisMesh.castShadow = true;
  hips.add(pelvisMesh);

  const beltBand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.215, 0.22, 0.08, 18)), darkMetalMat);
  beltBand.scale.set(1.12, 1, 0.76);
  beltBand.position.y = 0.06;
  hips.add(beltBand);

  const beltBuckle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 0.09, 0.05)), metalMat);
  beltBuckle.position.set(0, 0.06, 0.17);
  hips.add(beltBuckle);

  // Articulated 2-segment legs (Hip -> Thigh -> Knee Bellows -> Shin -> Contoured Boot)
  const buildLeg = (side: -1 | 1) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(side * 0.135, -0.04, 0);
    hips.add(hipPivot);

    const upperLeg = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.098, 0.2, 8, 14)), suitMat);
    upperLeg.position.y = -0.17;
    upperLeg.castShadow = true;
    hipPivot.add(upperLeg);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.34;
    hipPivot.add(kneePivot);

    const kneeRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.088, 0.022, 8, 16)), trimMat);
    kneeRing.rotation.x = Math.PI / 2;
    kneePivot.add(kneeRing);

    const lowerLeg = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.086, 0.18, 8, 14)), suitMat);
    lowerLeg.position.y = -0.16;
    lowerLeg.castShadow = true;
    kneePivot.add(lowerLeg);

    const ankleRing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.088, 0.092, 0.04, 14)), metalMat);
    ankleRing.position.y = -0.31;
    kneePivot.add(ankleRing);

    const bootUpper = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.085, 0.11, 6, 12)), bootMat);
    bootUpper.rotation.x = Math.PI / 2;
    bootUpper.position.set(0, -0.34, 0.045);
    bootUpper.castShadow = true;
    kneePivot.add(bootUpper);

    const bootSole = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.165, 0.045, 0.28)), darkMetalMat);
    bootSole.position.set(0, -0.378, 0.045);
    kneePivot.add(bootSole);

    return { hipPivot, kneePivot };
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);

  // Sculpted Torso HUT (Hard Upper Torso shell)
  const torso = new THREE.Group();
  torso.position.y = 0.1;
  hips.add(torso);

  const chestMesh = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.23, 0.3, 10, 18)), suitMat);
  chestMesh.position.y = 0.31;
  chestMesh.scale.set(1.16, 1.0, 0.78);
  chestMesh.castShadow = true;
  torso.add(chestMesh);

  const neckRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.175, 0.032, 10, 22)), metalMat);
  neckRing.rotation.x = Math.PI / 2;
  neckRing.position.y = 0.6;
  torso.add(neckRing);

  const dcmUnit = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.21, 0.075)), darkMetalMat);
  dcmUnit.position.set(0, 0.33, 0.175);
  torso.add(dcmUnit);

  const dcmPanel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.12, 0.02)), metalMat);
  dcmPanel.position.set(0, 0.35, 0.215);
  torso.add(dcmPanel);

  const dcmLed = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.025, 10, 10)), beaconLightMat);
  dcmLed.position.set(0.06, 0.37, 0.228);
  torso.add(dcmLed);

  // Chest/Shoulder Mission Insignias
  const patch = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.024, 16)), patchBlueMat);
  patch.rotation.x = Math.PI / 2;
  patch.position.set(-0.15, 0.47, 0.165);
  torso.add(patch);

  const stripeBadge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 0.045, 0.022)), flagRedMat);
  stripeBadge.position.set(0.15, 0.47, 0.165);
  torso.add(stripeBadge);

  // PLSS Backpack & Corrugated Oxygen Hoses
  if (useBackpack) {
    const plssPack = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.52, 0.22)), helmetShellMat);
    plssPack.position.set(0, 0.33, -0.25);
    plssPack.castShadow = true;
    torso.add(plssPack);

    const plssTopCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.18, 0.21, 0.08, 16)), darkMetalMat);
    plssTopCap.scale.set(1.1, 1, 0.55);
    plssTopCap.position.set(0, 0.61, -0.25);
    torso.add(plssTopCap);

    const stripe = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.43, 0.07, 0.23)), trimMat);
    stripe.position.set(0, 0.34, -0.25);
    torso.add(stripe);

    const antenna = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.012, 0.016, 0.32, 8)), metalMat);
    antenna.position.set(0.16, 0.72, -0.27);
    torso.add(antenna);

    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.16, 0.52, -0.18),
      new THREE.Vector3(-0.24, 0.62, 0.02),
      new THREE.Vector3(-0.16, 0.46, 0.19),
      new THREE.Vector3(-0.08, 0.35, 0.21),
    ]);
    const hose = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(hoseCurve, 18, 0.026, 8, false)), darkMetalMat);
    torso.add(hose);
  }

  // Sculpted Arms with Scye Shoulder Bearings, Pleated Elbow Bellows & Phase-VI Gloves
  const buildArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.31, 0.5, 0);
    torso.add(shoulder);

    const scyeRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.095, 0.022, 8, 16)), metalMat);
    scyeRing.rotation.y = Math.PI / 2;
    shoulder.add(scyeRing);

    const upperArm = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.075, 0.17, 6, 12)), suitMat);
    upperArm.position.y = -0.14;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);

    const elbowRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.07, 0.018, 8, 14)), trimMat);
    elbowRing.rotation.x = Math.PI / 2;
    elbow.add(elbowRing);

    const forearm = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.068, 0.15, 6, 12)), suitMat);
    forearm.position.y = -0.13;
    forearm.castShadow = true;
    elbow.add(forearm);

    const wristRing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.068, 0.072, 0.04, 14)), metalMat);
    wristRing.position.y = -0.24;
    elbow.add(wristRing);

    const glovePalm = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.072, 12, 12)), trimMat);
    glovePalm.scale.set(0.9, 1.15, 0.72);
    glovePalm.position.y = -0.3;
    elbow.add(glovePalm);

    return { shoulder, elbow };
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);

  // Sculpted Face + Lifelike Eyes with Specular Catchlights + Aerospace Helmet
  const head = new THREE.Group();
  head.position.y = 0.79;
  torso.add(head);

  const faceSphere = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.185, 24, 20)), skinMat);
  faceSphere.scale.set(0.94, 1.07, 0.98);
  faceSphere.castShadow = true;
  head.add(faceSphere);

  // Subtle jaw/cheek warmth and sculpted ears for realistic side profile
  [-0.088, 0.088].forEach((cx) => {
    const cheek = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.036, 10, 10)), cheekMat);
    cheek.scale.set(1.1, 0.85, 0.65);
    cheek.position.set(cx, -0.025, 0.145);
    head.add(cheek);
  });
  [-0.17, 0.17].forEach((earX) => {
    const ear = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.034, 10, 10)), skinMat);
    ear.scale.set(0.45, 1.1, 0.85);
    ear.position.set(earX, 0.0, 0.01);
    head.add(ear);
  });

  const nose = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.019, 0.032, 6, 8)), skinMat);
  nose.position.set(0, -0.008, 0.176);
  nose.rotation.x = -0.22;
  head.add(nose);

  const hairCap = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.195, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.56)),
    hairMat
  );
  hairCap.rotation.x = -0.28;
  head.add(hairCap);

  // Lifelike Eyes (Sclera + Colored Iris + Dark Pupil + White Catchlight Spark)
  const buildEye = (ex: number) => {
    const brow = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.058, 0.013, 0.016)), hairMat);
    brow.position.set(ex, 0.072, 0.166);
    brow.rotation.z = ex < 0 ? 0.08 : -0.08;
    head.add(brow);

    const sclera = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.033, 14, 12)), eyeWhiteMat);
    sclera.position.set(ex, 0.032, 0.16);
    head.add(sclera);

    const iris = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.02, 12, 12)), irisMat);
    iris.position.set(ex, 0.032, 0.179);
    head.add(iris);

    const pupil = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.011, 10, 10)), pupilMat);
    pupil.position.set(ex, 0.032, 0.19);
    head.add(pupil);

    const catchlight = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.0055, 8, 8)), eyeWhiteMat);
    catchlight.position.set(ex + 0.007, 0.039, 0.197);
    head.add(catchlight);
    return sclera;
  };
  const leftEye = buildEye(-0.064);
  const rightEye = buildEye(0.064);

  // Expressive Articulated Open-Up Mouth Assembly (dark cavity + parting upper/lower lips + teeth ridge)
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.072, 0.168);

  const mouthCavity = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.032, 14, 10)), mouthInteriorMat);
  mouthCavity.scale.set(1.05, 0.12, 0.48);
  mouthCavity.position.set(0, -0.002, 0.003);
  mouth.add(mouthCavity);

  const upperTeeth = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.042, 0.011, 0.016)), teethMat);
  upperTeeth.position.set(0, 0.01, 0.009);
  upperTeeth.visible = false;
  mouth.add(upperTeeth);

  const upperLip = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.0085, 0.046, 6, 10)), mouthMat);
  upperLip.rotation.z = Math.PI / 2;
  upperLip.position.set(0, 0.006, 0.011);
  mouth.add(upperLip);

  const lowerLip = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.009, 0.042, 6, 10)), mouthMat);
  lowerLip.rotation.z = Math.PI / 2;
  lowerLip.position.set(0, -0.007, 0.011);
  mouth.add(lowerLip);

  head.add(mouth);

  if (useHelmet) {
    const helmetOuter = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.285, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.72)),
      helmetShellMat
    );
    helmetOuter.rotation.x = -Math.PI * 0.42;
    helmetOuter.position.z = -0.02;
    helmetOuter.castShadow = true;
    head.add(helmetOuter);

    const visorRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.228, 0.022, 12, 28)), darkMetalMat);
    visorRing.position.set(0, 0.01, 0.125);
    head.add(visorRing);

    const visorGlass = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.246, 22, 16, -Math.PI * 0.45, Math.PI * 0.9, Math.PI * 0.18, Math.PI * 0.62)),
      visorGlassMat
    );
    visorGlass.position.set(0, 0.0, 0.052);
    visorGlass.renderOrder = 5;
    head.add(visorGlass);

    // Dual Helmet EVA/Launch Headlamps & Comms Pods
    [-0.255, 0.255].forEach((sideX) => {
      const pod = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.095, 0.13)), darkMetalMat);
      pod.position.set(sideX, 0.01, 0.02);
      head.add(pod);

      const lamp = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.022, 10)), headlampMat);
      lamp.position.set(sideX, 0.01, 0.088);
      head.add(lamp);
    });
  } else {
    // Engineer Sam Comms Headset
    const band = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.205, 0.018, 8, 22, Math.PI)),
      darkMetalMat
    );
    band.position.y = 0.02;
    head.add(band);
    [-0.195, 0.195].forEach((sx) => {
      const earCup = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.038, 14)), trimMat);
      earCup.rotation.z = Math.PI / 2;
      earCup.position.set(sx, 0.01, 0);
      head.add(earCup);
    });
    const mic = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.14, 8)), metalMat);
    mic.rotation.z = Math.PI / 2.6;
    mic.position.set(0.11, -0.06, 0.15);
    head.add(mic);
  }

  const speechAnchor = new THREE.Object3D();
  speechAnchor.position.set(0, 2.04, 0);
  root.add(speechAnchor);

  return {
    root,
    hips,
    torso,
    head,
    mouth,
    mouthCavity,
    upperLip,
    lowerLip,
    upperTeeth,
    leftEye,
    rightEye,
    leftShoulder: leftArm.shoulder,
    leftElbow: leftArm.elbow,
    rightShoulder: rightArm.shoulder,
    rightElbow: rightArm.elbow,
    leftHip: leftLeg.hipPivot,
    leftKnee: leftLeg.kneePivot,
    rightHip: rightLeg.hipPivot,
    rightKnee: rightLeg.kneePivot,
    speechAnchor,
    beaconLightMat,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export type AstronautPose = 'talk_idle' | 'walk' | 'seated_cockpit' | 'wave_cheer';

export function animateAstronaut(
  rig: AstronautRig,
  params: {
    timeSec: number;
    pose: AstronautPose;
    isSpeaking?: boolean;
    mouthOpen?: number;
    mouthSpread?: number;
    lookAtYaw?: number;
    stickX?: number;
    stickZ?: number;
  }
) {
  const {
    timeSec,
    pose,
    isSpeaking = false,
    mouthOpen,
    mouthSpread = 0.4,
    lookAtYaw = 0,
    stickX = 0,
    stickZ = 0,
  } = params;

  const blinkCycle = timeSec % 4.1;
  const eyeScaleY = blinkCycle > 3.96 ? 0.12 : 1.0;
  rig.leftEye.scale.y = eyeScaleY;
  rig.rightEye.scale.y = eyeScaleY;

  const activeSpeechLevel =
    mouthOpen !== undefined
      ? THREE.MathUtils.clamp(mouthOpen, 0, 1)
      : isSpeaking
      ? Math.min(1, Math.abs(Math.sin(timeSec * 14.5)) * 0.72 + Math.abs(Math.sin(timeSec * 8.4)) * 0.28)
      : 0;

  if (activeSpeechLevel > 0.04) {
    const spreadScale = 0.88 + mouthSpread * 0.28;
    rig.mouth.scale.set(spreadScale, 1, 1);
    rig.mouthCavity.scale.set(0.95 + mouthSpread * 0.22, 0.14 + activeSpeechLevel * 1.12, 0.56);
    rig.mouthCavity.position.y = -activeSpeechLevel * 0.008;
    rig.upperLip.position.y = 0.006 + activeSpeechLevel * 0.011;
    rig.lowerLip.position.y = -0.007 - activeSpeechLevel * 0.028;
    rig.upperTeeth.visible = activeSpeechLevel > 0.24;
    rig.upperTeeth.position.y = 0.008 + activeSpeechLevel * 0.006;
    rig.beaconLightMat.color.setHex(Math.floor(timeSec * 8) % 2 === 0 ? 0x10b981 : 0x38bdf8);
  } else {
    rig.mouth.scale.set(0.92, 1, 1);
    rig.mouthCavity.scale.set(0.85, 0.08, 0.42);
    rig.mouthCavity.position.y = 0;
    rig.upperLip.position.y = 0.004;
    rig.lowerLip.position.y = -0.005;
    rig.upperTeeth.visible = false;
    rig.beaconLightMat.color.setHex(0x38bdf8);
  }

  if (pose === 'walk') {
    const stride = timeSec * 5.6;
    rig.hips.position.y = 0.78 + Math.abs(Math.sin(stride)) * 0.042;
    rig.torso.rotation.x = 0.06;
    rig.leftHip.rotation.x = Math.sin(stride) * 0.52;
    rig.rightHip.rotation.x = -Math.sin(stride) * 0.52;
    rig.leftKnee.rotation.x = Math.max(0, -Math.cos(stride) * 0.58);
    rig.rightKnee.rotation.x = Math.max(0, Math.cos(stride) * 0.58);

    rig.leftShoulder.rotation.set(-Math.sin(stride) * 0.42, 0, 0.14);
    rig.leftElbow.rotation.x = -0.35;
    rig.rightShoulder.rotation.set(Math.sin(stride) * 0.42, 0, -0.14);
    rig.rightElbow.rotation.x = -0.35;
    rig.head.rotation.set(Math.sin(stride * 2) * 0.03, lookAtYaw * 0.3, 0);
  } else if (pose === 'seated_cockpit') {
    rig.hips.position.y = 0.5;
    rig.torso.rotation.x = -0.06;
    rig.leftHip.rotation.x = -Math.PI * 0.46;
    rig.rightHip.rotation.x = -Math.PI * 0.46;
    rig.leftKnee.rotation.x = Math.PI * 0.44;
    rig.rightKnee.rotation.x = Math.PI * 0.44;

    const gesture = isSpeaking ? Math.sin(timeSec * 5.8) * 0.12 : 0;
    rig.rightShoulder.rotation.set(-0.76 + stickZ * 0.18, 0, -0.18 + stickX * 0.15);
    rig.rightElbow.rotation.x = -0.68;
    rig.leftShoulder.rotation.set(-0.66 - gesture, 0, 0.16);
    rig.leftElbow.rotation.x = -0.74 + gesture;

    rig.head.rotation.set(
      isSpeaking ? Math.sin(timeSec * 4.2) * 0.055 : Math.sin(timeSec * 1.4) * 0.025,
      lookAtYaw + (isSpeaking ? Math.sin(timeSec * 2.4) * 0.08 : 0),
      0
    );
  } else if (pose === 'wave_cheer') {
    rig.hips.position.y = 0.78 + Math.abs(Math.sin(timeSec * 5.2)) * 0.045;
    rig.torso.rotation.x = 0;
    rig.leftHip.rotation.x = 0;
    rig.rightHip.rotation.x = 0;
    rig.leftKnee.rotation.x = 0;
    rig.rightKnee.rotation.x = 0;
    rig.rightShoulder.rotation.set(-0.2, 0, -2.2 + Math.sin(timeSec * 8.5) * 0.35);
    rig.rightElbow.rotation.x = -0.45;
    rig.leftShoulder.rotation.set(-0.2, 0, 0.32 + Math.sin(timeSec * 5) * 0.15);
    rig.leftElbow.rotation.x = -0.4;
    rig.head.rotation.set(-0.08, lookAtYaw, 0);
  } else {
    rig.hips.position.y = 0.78 + Math.sin(timeSec * 2.1) * 0.012;
    rig.torso.rotation.x = Math.sin(timeSec * 1.6) * 0.022;
    rig.leftHip.rotation.x = 0;
    rig.rightHip.rotation.x = 0;
    rig.leftKnee.rotation.x = 0;
    rig.rightKnee.rotation.x = 0;

    if (isSpeaking) {
      rig.rightShoulder.rotation.set(-0.6 + Math.sin(timeSec * 6.2) * 0.22, 0, -0.34);
      rig.rightElbow.rotation.x = -0.82 + Math.cos(timeSec * 5) * 0.16;
      rig.leftShoulder.rotation.set(-0.34 + Math.cos(timeSec * 5) * 0.14, 0, 0.22);
      rig.leftElbow.rotation.x = -0.64;
      rig.head.rotation.set(Math.sin(timeSec * 4) * 0.06, lookAtYaw, Math.sin(timeSec * 2) * 0.035);
    } else {
      rig.rightShoulder.rotation.set(-0.08, 0, -0.14);
      rig.rightElbow.rotation.x = -0.24;
      rig.leftShoulder.rotation.set(-0.08, 0, 0.14);
      rig.leftElbow.rotation.x = -0.24;
      rig.head.rotation.set(Math.sin(timeSec * 1.8) * 0.025, lookAtYaw, 0);
    }
  }
}

const _projVec = new THREE.Vector3();

export function projectObjectToScreen(
  obj: THREE.Object3D,
  camera: THREE.Camera,
  width: number,
  height: number
): { x: number; y: number; visible: boolean } {
  obj.getWorldPosition(_projVec);
  _projVec.project(camera);
  if (_projVec.z < -1 || _projVec.z > 1) {
    return { x: 0, y: 0, visible: false };
  }
  return {
    x: (_projVec.x * 0.5 + 0.5) * width,
    y: (-_projVec.y * 0.5 + 0.5) * height,
    visible: true,
  };
}
