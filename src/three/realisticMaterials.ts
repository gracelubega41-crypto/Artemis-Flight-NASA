import * as THREE from 'three';

export function createSoftParticleTexture(
  innerColor = 'rgba(255,255,255,1)',
  midColor = 'rgba(255,220,160,0.45)',
  outerColor = 'rgba(255,160,60,0)'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.38, midColor);
  grad.addColorStop(1, outerColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createShuttleTileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#eef2f6';
  ctx.fillRect(0, 0, 512, 512);

  // Authentic staggered Shuttle TPS silica blankets & thermal tiles
  const tileW = 32;
  const tileH = 22;
  for (let y = 0; y < 512; y += tileH) {
    const offset = ((Math.round(y / tileH)) % 2) * (tileW / 2);
    for (let x = -tileW; x < 512; x += tileW) {
      const hash = Math.abs((x * 17 + y * 31) % 23);
      const shade = 228 + hash - 6;
      const scorch = ((x * 5 + y * 11) % 19 === 0) ? -12 : 0;
      const r = Math.min(255, Math.max(195, shade + scorch));
      const g = Math.min(255, Math.max(198, shade + 1 + scorch));
      const b = Math.min(255, Math.max(205, shade + 6 + scorch));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x + offset + 1, y + 1, tileW - 2, tileH - 2);

      // Subtle bevel highlight on top/left edge of each tile
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x + offset + 1, y + 1, tileW - 2, 1.5);
    }
  }

  // Structural panel seams & micro-fasteners
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.34)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i <= 512; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

export function createTileBumpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#404040';
  ctx.fillRect(0, 0, 512, 512);

  const tileW = 32;
  const tileH = 22;
  for (let y = 0; y < 512; y += tileH) {
    const offset = ((Math.round(y / tileH)) % 2) * (tileW / 2);
    for (let x = -tileW; x < 512; x += tileW) {
      const h = 195 + ((x * 13 + y * 29) % 35);
      ctx.fillStyle = `rgb(${h},${h},${h})`;
      ctx.fillRect(x + offset + 2, y + 2, tileW - 4, tileH - 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

export function createSolarCellTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 512, 512);
  bg.addColorStop(0, '#071739');
  bg.addColorStop(0.5, '#0c275e');
  bg.addColorStop(1, '#081b44');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 512);

  // Silicon solar wafer cells + fine silver collector lines + gold tabs
  for (let y = 0; y < 512; y += 64) {
    for (let x = 0; x < 512; x += 64) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.52)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, 60, 60);

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1;
      for (let sub = 12; sub < 60; sub += 12) {
        ctx.beginPath();
        ctx.moveTo(x + sub, y + 2);
        ctx.lineTo(x + sub, y + 62);
        ctx.stroke();
      }
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x + 28, y + 1, 8, 4);
      ctx.fillRect(x + 28, y + 59, 8, 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

export function createFoamTankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#7c2d12');
  grad.addColorStop(0.35, '#c2410c');
  grad.addColorStop(0.65, '#ea580c');
  grad.addColorStop(1, '#7c2d12');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Fine SOFI spray-on insulation foam grain & circumferential weld seams
  for (let y = 0; y < 512; y += 2) {
    const v = Math.sin(y * 0.41) + Math.cos(y * 0.17);
    ctx.fillStyle = v > 0 ? 'rgba(255,220,175,0.09)' : 'rgba(50,15,4,0.14)';
    ctx.fillRect(0, y, 512, 2);
  }
  for (let i = 0; i < 4500; i++) {
    const x = (i * 67) % 512;
    const y = (i * 113) % 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 200, 140, 0.08)' : 'rgba(67, 20, 7, 0.12)';
    ctx.fillRect(x, y, 2, 2);
  }
  for (let y = 48; y < 512; y += 96) {
    ctx.fillStyle = 'rgba(67, 20, 7, 0.56)';
    ctx.fillRect(0, y, 512, 7);
    ctx.fillStyle = 'rgba(251, 146, 60, 0.42)';
    ctx.fillRect(0, y + 7, 512, 3);
  }
  ctx.fillStyle = 'rgba(67, 20, 7, 0.24)';
  for (let x = 0; x < 512; x += 24) {
    ctx.fillRect(x, 0, 3, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createPadConcreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#64748b';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 5400; i++) {
    const x = (i * 73) % 512;
    const y = (i * 139) % 512;
    const g = 82 + (i % 56);
    ctx.fillStyle = `rgb(${g},${g + 4},${g + 10})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle tire/exhaust weathering streaks
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
    ctx.fillRect((i * 59) % 480, (i * 83) % 440, 44, 6);
  }

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.58)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  ctx.fillStyle = '#eab308';
  ctx.fillRect(0, 488, 512, 24);
  ctx.fillStyle = '#0f172a';
  for (let x = 0; x < 512; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 488);
    ctx.lineTo(x + 16, 488);
    ctx.lineTo(x + 6, 512);
    ctx.lineTo(x - 10, 512);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export function createGoldFoilTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d97706';
  ctx.fillRect(0, 0, 256, 256);

  // Multi-angle crinkled Kapton MLI diamond facets for metallic glint
  for (let y = 0; y < 256; y += 12) {
    for (let x = 0; x < 256; x += 12) {
      const tone = ((x * 13 + y * 29) % 7) / 7;
      ctx.fillStyle =
        tone > 0.65
          ? 'rgba(254, 240, 138, 0.45)'
          : tone > 0.35
          ? 'rgba(245, 158, 11, 0.35)'
          : 'rgba(120, 53, 15, 0.4)';
      ctx.beginPath();
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + 12, y + 6);
      ctx.lineTo(x + 6, y + 12);
      ctx.lineTo(x, y + 6);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

export function createEarthRealisticTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Deep ocean bathymetry gradient with turquoise coastal shelves
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, 512);
  oceanGrad.addColorStop(0, '#0f3f66');
  oceanGrad.addColorStop(0.28, '#03598c');
  oceanGrad.addColorStop(0.5, '#0274b5');
  oceanGrad.addColorStop(0.72, '#03598c');
  oceanGrad.addColorStop(1, '#0f3f66');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, 1024, 512);

  // Subtle oceanic currents
  for (let i = 0; i < 65; i++) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.beginPath();
    ctx.ellipse((i * 157) % 1024, 60 + ((i * 71) % 390), 54, 18, (i % 5) * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // Organic multi-lobed continental masses with turquoise coastal halos
  const landmassClusters = [
    { cx: 195, cy: 175, rx: 112, ry: 72, rot: 0.25, desert: '#d97706' },
    { cx: 155, cy: 145, rx: 64, ry: 44, rot: -0.2, desert: '#15803d' },
    { cx: 270, cy: 325, rx: 74, ry: 88, rot: -0.18, desert: '#16a34a' },
    { cx: 525, cy: 155, rx: 152, ry: 68, rot: 0.08, desert: '#a16207' },
    { cx: 640, cy: 185, rx: 86, ry: 55, rot: -0.12, desert: '#ca8a04' },
    { cx: 545, cy: 285, rx: 90, ry: 98, rot: 0.14, desert: '#eab308' },
    { cx: 795, cy: 205, rx: 124, ry: 75, rot: -0.22, desert: '#15803d' },
    { cx: 855, cy: 365, rx: 70, ry: 46, rot: 0.2, desert: '#d97706' },
  ];

  landmassClusters.forEach(({ cx, cy, rx, ry, rot, desert }) => {
    // Shallow turquoise continental shelf
    ctx.fillStyle = 'rgba(34, 211, 238, 0.24)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 12, ry + 10, rot, 0, Math.PI * 2);
    ctx.fill();

    // Continent biome gradient
    const cg = ctx.createRadialGradient(cx, cy, 8, cx, cy, Math.max(rx, ry));
    cg.addColorStop(0, desert);
    cg.addColorStop(0.55, '#15803d');
    cg.addColorStop(1, '#14532d');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();

    // Subtle mountain ridge lines inside continents
    ctx.fillStyle = 'rgba(248, 250, 252, 0.24)';
    for (let m = 0; m < 6; m++) {
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(m * 1.1) * rx * 0.36,
        cy + Math.sin(m * 1.3) * ry * 0.36,
        rx * 0.16,
        ry * 0.09,
        rot + m * 0.4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  });

  // Polar ice caps with jagged sea-ice fringe
  ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.fillRect(0, 0, 1024, 24);
  ctx.fillRect(0, 486, 1024, 26);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCloudLayerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 512);

  for (let i = 0; i < 190; i++) {
    const x = (i * 113) % 1024;
    const y = 30 + ((i * 67) % 452);
    const rx = 42 + (i % 5) * 18;
    const ry = 8 + (i % 3) * 5;
    const g = ctx.createRadialGradient(x, y, 2, x, y, rx);
    g.addColorStop(0, 'rgba(255,255,255,0.78)');
    g.addColorStop(0.55, 'rgba(241,245,249,0.34)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, ((i % 6) - 2.5) * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createAtmosphereRimMaterial(colorHex = 0x38bdf8, intensity = 0.85): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(colorHex) },
      intensity: { value: intensity },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 3.0);
        gl_FragColor = vec4(glowColor, fresnel * intensity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

export function createTerrainDetailTexture(baseHex: string, darkHex: string, highlightHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle wind ripples / geological strata
  for (let y = 0; y < 512; y += 6) {
    ctx.fillStyle = y % 12 === 0 ? highlightHex : darkHex;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(0, y, 512, 2);
  }
  ctx.globalAlpha = 1;

  // Multi-scale impact craters with bright sunlit rims & dark floor shadows
  for (let i = 0; i < 80; i++) {
    const x = (i * 89) % 512;
    const y = (i * 151) % 512;
    const r = 5 + (i % 24);
    ctx.fillStyle = darkHex;
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = highlightHex;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, r, -Math.PI * 0.85, Math.PI * 0.15);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 5500; i++) {
    ctx.fillStyle = i % 2 === 0 ? darkHex : highlightHex;
    ctx.globalAlpha = 0.18;
    ctx.fillRect((i * 47) % 512, (i * 97) % 512, 2, 2);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}
