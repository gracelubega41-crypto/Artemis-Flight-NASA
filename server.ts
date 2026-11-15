import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { buildDirectKidCoachAnswer } from './serverCoachKnowledge';

dotenv.config();

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));

// Derive a 256-bit key for AES-256-GCM credential encryption on the server
const MASTER_SECRET = process.env.CREDENTIAL_MASTER_KEY || process.env.GEMINI_API_KEY || 'artemis-flight-academy-dev-master-key-2026';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(MASTER_SECRET).digest();

// Server-side Gemini client
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// --- API ROUTES ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'artemis-flight-academy', timestamp: new Date().toISOString() });
});

// Live NASA Open APIs Proxy (DONKI Space Weather, InSight Mars Weather, NeoWs Asteroids)
let cachedNasaFeed: { expiresAt: number; data: Record<string, unknown> } | null = null;

async function fetchJsonWithTimeout(url: string, timeoutMs = 6000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadNasaMissionFeed(): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (cachedNasaFeed && cachedNasaFeed.expiresAt > now) {
    return cachedNasaFeed.data;
  }

  const nasaKey = process.env.NASA_API_KEY || 'DEMO_KEY';
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
  const endStr = today.toISOString().slice(0, 10);
  const startStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const [cmeRes, gstRes, notifRes, marsRes, neoRes] = await Promise.allSettled([
    fetchJsonWithTimeout(`https://api.nasa.gov/DONKI/CME?startDate=${startStr}&endDate=${endStr}&api_key=${nasaKey}`),
    fetchJsonWithTimeout(`https://api.nasa.gov/DONKI/GST?startDate=${startStr}&endDate=${endStr}&api_key=${nasaKey}`),
    fetchJsonWithTimeout(`https://api.nasa.gov/DONKI/notifications?startDate=${startStr}&endDate=${endStr}&type=all&api_key=${nasaKey}`),
    fetchJsonWithTimeout(`https://api.nasa.gov/insight_weather/?api_key=${nasaKey}&feedtype=json&ver=1.0`),
    fetchJsonWithTimeout(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${endStr}&end_date=${endStr}&api_key=${nasaKey}`),
  ]);

  const cmes = cmeRes.status === 'fulfilled' && Array.isArray(cmeRes.value) ? cmeRes.value : [];
  const gsts = gstRes.status === 'fulfilled' && Array.isArray(gstRes.value) ? gstRes.value : [];
  const notifs = notifRes.status === 'fulfilled' && Array.isArray(notifRes.value) ? notifRes.value : [];

  const cmeSpeeds: number[] = cmes
    .map((c: Record<string, unknown>) => {
      const analyses = Array.isArray(c.cmeAnalyses) ? c.cmeAnalyses : [];
      const primary = analyses.find((a: Record<string, unknown>) => a.isMostAccurate) || analyses[0];
      return Number((primary as Record<string, unknown> | undefined)?.speed || 0);
    })
    .filter((s: number) => s > 0);

  const latestCmeSpeedKms = cmeSpeeds.length ? Math.round(cmeSpeeds[cmeSpeeds.length - 1]) : 525;
  const fastestCmeSpeedKms = cmeSpeeds.length ? Math.round(Math.max(...cmeSpeeds)) : 974;

  let latestKpIndex = 3;
  if (gsts.length) {
    const lastGst = gsts[gsts.length - 1] as Record<string, unknown>;
    const kpArr = Array.isArray(lastGst.allKpIndex) ? lastGst.allKpIndex : [];
    const lastKp = kpArr[kpArr.length - 1] as Record<string, unknown> | undefined;
    if (lastKp?.kpIndex) latestKpIndex = Number(lastKp.kpIndex);
  }

  const latestNotif = (notifs.length ? notifs[notifs.length - 1] : null) as Record<string, unknown> | null;
  const rawBody = String(latestNotif?.messageBody || '');
  const summarySection = rawBody.includes('## Summary:')
    ? rawBody.split('## Summary:')[1].split('##')[0].replace(/\s+/g, ' ').trim()
    : rawBody.replace(/\s+/g, ' ').trim();

  const recentCmeCount = cmes.length;
  const hasHighSolar = fastestCmeSpeedKms >= 900 || latestKpIndex >= 6 || String(latestNotif?.messageType) === 'RBE';
  const spaceLevel = hasHighSolar ? 'STORM_WATCH' : recentCmeCount >= 20 ? 'ACTIVE' : 'CALM';
  const solarFluxMultiplier = spaceLevel === 'STORM_WATCH' ? 1.35 : spaceLevel === 'ACTIVE' ? 1.15 : 1.0;

  let marsWeather = {
    sol: '681',
    avgTempC: -62.4,
    minTempC: -95.4,
    maxTempC: -4.4,
    pressureKpa: 0.74,
    windMs: 5.6,
    maxWindMs: 18.6,
    windDirection: 'WNW',
    season: 'fall',
  };

  if (marsRes.status === 'fulfilled' && marsRes.value && Array.isArray(marsRes.value.sol_keys)) {
    const keys: string[] = marsRes.value.sol_keys;
    const latestSol = keys[keys.length - 1];
    const solObj = latestSol ? marsRes.value[latestSol] : null;
    if (solObj) {
      marsWeather = {
        sol: String(latestSol),
        avgTempC: Number((solObj.AT?.av ?? -62.4).toFixed(1)),
        minTempC: Number((solObj.AT?.mn ?? -95.4).toFixed(1)),
        maxTempC: Number((solObj.AT?.mx ?? -4.4).toFixed(1)),
        pressureKpa: Number(((solObj.PRE?.av ?? 743.5) / 1000).toFixed(2)),
        windMs: Number((solObj.HWS?.av ?? 5.6).toFixed(1)),
        maxWindMs: Number((solObj.HWS?.mx ?? 18.6).toFixed(1)),
        windDirection: String(solObj.WD?.most_common?.compass_point || 'WNW'),
        season: String(solObj.Season || 'fall'),
      };
    }
  }

  let asteroids: Array<{ name: string; diameterM: number; speedKmh: number; missKm: number; hazardous: boolean }> = [];
  if (neoRes.status === 'fulfilled' && neoRes.value?.near_earth_objects) {
    const dayObj = neoRes.value.near_earth_objects[endStr] || Object.values(neoRes.value.near_earth_objects)[0] || [];
    if (Array.isArray(dayObj)) {
      asteroids = dayObj
        .map((a: Record<string, any>) => ({
          name: String(a.name || 'Asteroid').replace(/[()]/g, '').trim(),
          diameterM: Math.round(Number(a.estimated_diameter?.meters?.estimated_diameter_max || 50)),
          speedKmh: Math.round(Number(a.close_approach_data?.[0]?.relative_velocity?.kilometers_per_hour || 35000)),
          missKm: Math.round(Number(a.close_approach_data?.[0]?.miss_distance?.kilometers || 15000000)),
          hazardous: Boolean(a.is_potentially_hazardous_asteroid),
        }))
        .sort((x, y) => x.missKm - y.missKm)
        .slice(0, 5);
    }
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: 'NASA Open APIs (DONKI · InSight · NeoWs)',
    spaceWeather: {
      level: spaceLevel,
      recentCmeCount,
      latestCmeSpeedKms,
      fastestCmeSpeedKms,
      latestKpIndex,
      latestAlertId: String(latestNotif?.messageID || 'DONKI-LIVE'),
      latestAlertType: String(latestNotif?.messageType || 'CME'),
      latestAlertTime: String(latestNotif?.messageIssueTime || new Date().toISOString()),
      latestAlertSummary:
        summarySection.slice(0, 220) ||
        'Solar energetic particles and coronal mass ejections detected by NASA GOES & SOHO satellites.',
      solarFluxMultiplier,
    },
    marsWeather,
    asteroids,
  };

  cachedNasaFeed = { expiresAt: now + 10 * 60 * 1000, data: payload };
  return payload;
}

app.get('/api/nasa/mission-feed', async (_req, res) => {
  try {
    const payload = await loadNasaMissionFeed();
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reach NASA APIs.';
    res.status(502).json({ error: message });
  }
});


// AES-256-GCM Flight Credential Encryption
app.post('/api/credentials/encrypt', (req, res) => {
  try {
    const { userId, callsign, certificationLevel, standardRef, score } = req.body ?? {};
    if (!userId || !callsign || !certificationLevel) {
      return res.status(400).json({ error: 'Missing required credential fields.' });
    }

    const payload = JSON.stringify({
      userId,
      callsign,
      certificationLevel,
      standardRef: standardRef || 'NASA-STD-3001',
      score: Number(score ?? 0),
      issuedAt: new Date().toISOString(),
      issuer: 'ARTEMIS-FLIGHT-ACADEMY-CA',
    });

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const fingerprintSha256 = crypto.createHash('sha256').update(payload).digest('hex');

    res.json({
      algorithm: 'AES-256-GCM',
      ivHex: iv.toString('hex'),
      authTagHex: authTag.toString('hex'),
      ciphertextHex: encrypted.toString('hex'),
      fingerprintSha256,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Encryption error';
    res.status(500).json({ error: message });
  }
});

// AES-256-GCM Flight Credential Verification & Decryption
app.post('/api/credentials/verify', (req, res) => {
  try {
    const { ivHex, authTagHex, ciphertextHex, fingerprintSha256 } = req.body ?? {};
    if (!ivHex || !authTagHex || !ciphertextHex) {
      return res.status(400).json({ error: 'Missing encrypted envelope fields.' });
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const computedFingerprint = crypto.createHash('sha256').update(decrypted).digest('hex');

    const verified = !fingerprintSha256 || computedFingerprint === fingerprintSha256;
    res.json({
      verified,
      computedFingerprint,
      payload: JSON.parse(decrypted),
    });
  } catch {
    res.status(400).json({ verified: false, error: 'Authentication tag mismatch or invalid ciphertext.' });
  }
});

// Tamper-evident SHA-256 audit hash generation
app.post('/api/audit/hash', (req, res) => {
  const { userId, action, standardRef, detail, timestamp } = req.body ?? {};
  const canonical = `${userId || ''}|${action || ''}|${standardRef || ''}|${detail || ''}|${timestamp || new Date().toISOString()}`;
  const integrityHash = crypto.createHash('sha256').update(canonical).digest('hex');
  res.json({ integrityHash });
});

function parseJsonResponse<T>(raw: string | undefined, fallback: T): T {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // Fall through to plain text check
      }
    }
    return fallback;
  }
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || 'AI Flight Coach error.');
  console.error('[AI Coach Gemini Error]:', raw);

  let detail = raw;
  try {
    const jsonStart = raw.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        detail = parsed.error.message;
      }
    }
  } catch {
    // Keep raw message if not embedded JSON
  }

  if (/API_KEY_INVALID|API key not valid|INVALID_ARGUMENT|Invalid JSON payload|Unknown name/i.test(raw)) {
    return { status: 400, message: detail };
  }
  if (/free tier is not available|billing/i.test(raw)) {
    return {
      status: 403,
      message:
        'Your current Gemini API project requires a billing-enabled API key. Please add or select a paid Gemini API key in Settings > Secrets.',
    };
  }
  if (/PERMISSION_DENIED|403/i.test(raw)) {
    return {
      status: 403,
      message: `Gemini API permission denied: ${detail} Please check GEMINI_API_KEY in Settings > Secrets.`,
    };
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(raw)) {
    return { status: 429, message: 'AI Coach is very busy right now. Please wait a few seconds and ask again!' };
  }
  if (/NOT_FOUND|404/i.test(raw)) {
    return { status: 404, message: `AI Coach model error: ${detail}` };
  }
  return { status: 500, message: detail };
}

// AI-Driven Training Gap Analysis & Automated Certification Report
app.post('/api/analytics/evaluate', async (req, res) => {
  try {
    const { callsign, runs } = req.body ?? {};
    const safeRuns = Array.isArray(runs) ? runs : [];

    const ai = getAiClient();
    const condensedRuns = safeRuns.slice(0, 15).map((r: Record<string, unknown>) => ({
      mode: r.mode,
      outcome: r.outcome,
      safetyScore: r.safetyScore,
      durationSec: r.durationSec,
      fuelRemainingPct: r.fuelRemainingPct,
      closureRateMs: r.closureRateMs,
      alignmentErrorDeg: r.alignmentErrorDeg,
      radiationDoseMsv: r.radiationDoseMsv,
      drillsResolved: r.drillsResolved,
      vrUsed: r.vrUsed,
      hardwareInputUsed: r.hardwareInputUsed,
      standardRef: r.standardRef,
    }));

    const prompt =
      condensedRuns.length > 0
        ? `Analyze the following NASA Junior Astronaut training mission history for cadet ${callsign || 'CADET-01'} (aged 7-12).
Explain in clear, friendly, encouraging everyday words what they did well and what to practice next across Space Docking (gentle speed, lining up with the target ring, saving fuel) and Moon/Mars Base Ops (keeping fresh air healthy, turning up the space shield during solar storms, balancing power and food, and fixing emergency alerts quickly).
Determine flight readiness against NASA-STD-3001 and IDSS-REV-D orbital safety standards.

Telemetry Runs:
${JSON.stringify(condensedRuns, null, 2)}`
        : `Cadet ${callsign || 'CADET-01'} (aged 7-12) is brand new and has 0 saved missions yet!
Create a welcoming, exciting Starter Training Report Card (status PROVISIONAL, readinessScore 70) explaining what fun missions await in Artemis Flight Academy (Space Docking, Moon & Mars Base, and Emergency Drills) with 3 simple first goals and 3 helpful starter tips using exact controls (Arrow Keys, Spacebar Brake & Hover, Air Maker, Space Shield, Space Farm).`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction:
          'You are Commander Maya, a friendly, encouraging NASA Junior Astronaut Flight Coach speaking to kids aged 7 to 12. Keep sentences short, plain, concrete, exciting, and accurate to the numbers.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: {
              type: Type.STRING,
              description: 'Must be one of: CERTIFIED, PROVISIONAL, RETEST_REQUIRED',
            },
            readinessScore: {
              type: Type.NUMBER,
              description: 'Overall readiness score from 0 to 100',
            },
            summary: {
              type: Type.STRING,
              description: 'Concise 2-3 sentence kid-friendly readiness summary citing mission trends or starter goals.',
            },
            identifiedGaps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 to 4 specific skills to practice next in plain language for kids aged 7-12.',
            },
            recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 to 4 targeted mission tips using actual game buttons and controls.',
            },
          },
          required: ['status', 'readinessScore', 'summary', 'identifiedGaps', 'recommendations'],
        },
      },
    });

    const parsed = parseJsonResponse<{
      status?: string;
      readinessScore?: number;
      summary?: string;
      identifiedGaps?: string[];
      recommendations?: string[];
    }>(response.text, {});

    const validStatus = ['CERTIFIED', 'PROVISIONAL', 'RETEST_REQUIRED'].includes(String(parsed.status))
      ? parsed.status
      : 'PROVISIONAL';

    res.json({
      status: validStatus,
      readinessScore: Math.min(100, Math.max(0, Number(parsed.readinessScore ?? 75))),
      summary: String(parsed.summary || 'Great job practicing! Keep flying carefully and watching your gauges.'),
      identifiedGaps: Array.isArray(parsed.identifiedGaps) ? parsed.identifiedGaps.slice(0, 6) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 6) : [],
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// In-memory LRU cache for neural TTS WAV clips to keep latency snappy
const ttsCache = new Map<string, string>();
const MAX_TTS_CACHE = 40;

const COACH_TTS_PROFILES: Record<string, { voiceName: 'Kore' | 'Puck' | 'Charon'; style: string }> = {
  maya: {
    voiceName: 'Kore',
    style: 'Warm, bright, enthusiastic female NASA astronaut coach speaking clearly to a 7-to-12-year-old child',
  },
  leo: {
    voiceName: 'Puck',
    style: 'Friendly, upbeat, curious male astronaut co-pilot explaining space physics playfully to a kid',
  },
  sam: {
    voiceName: 'Charon',
    style: 'Calm, wise, reassuring male NASA flight director guiding young astronauts steadily',
  },
};

// Multi-gender Neural Voice Synthesis via Gemini TTS (returns base64 audio/wav)
app.post('/api/coach/tts', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim().slice(0, 700);
    const rawVoice = String(req.body?.coachVoice || 'maya').toLowerCase();
    const profileKey = rawVoice in COACH_TTS_PROFILES ? rawVoice : 'maya';
    if (!text) {
      return res.status(400).json({ error: 'Text is required for speech synthesis.' });
    }

    const profile = COACH_TTS_PROFILES[profileKey];
    const cacheKey = `${profile.voiceName}:${text}`;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      return res.json({ audioBase64: cached, mimeType: 'audio/wav', voiceName: profile.voiceName });
    }

    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${profile.style}: ${text}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: profile.voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return res.status(502).json({ error: 'Voice synthesis returned empty audio.' });
    }

    if (ttsCache.size >= MAX_TTS_CACHE) {
      const oldestKey = ttsCache.keys().next().value;
      if (oldestKey) ttsCache.delete(oldestKey);
    }
    ttsCache.set(cacheKey, base64Audio);

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      voiceName: profile.voiceName,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// Interactive AI Flight Coach Q&A for Junior Astronauts (ages 7-12)
app.post('/api/coach/ask', async (req, res) => {
  const {
    callsign = 'CADET-01',
    question = '',
    mode = 'general',
    coachVoice = 'duo',
    history = [],
    telemetry = null,
    nasaFeed = null,
    runs = [],
  } = req.body ?? {};

  const cleanQuestion = String(question || '').trim().slice(0, 600);
  if (!cleanQuestion) {
    return res.status(400).json({ error: 'Please type or pick a question for your AI Flight Coach!' });
  }

  const safeHistory = Array.isArray(history) ? history.slice(-8) : [];
  const safeRuns = Array.isArray(runs) ? runs.slice(0, 8) : [];

  const lastCoachSpeaker = [...safeHistory]
    .reverse()
    .find((t: { role?: string; speaker?: string }) => t.role === 'coach' && t.speaker)?.speaker;
  const requestedVoice = ['maya', 'leo', 'sam', 'duo'].includes(String(coachVoice))
    ? String(coachVoice)
    : 'duo';
  const assignedSpeaker: 'maya' | 'leo' | 'sam' =
    requestedVoice === 'duo'
      ? lastCoachSpeaker === 'maya'
        ? 'leo'
        : 'maya'
      : (requestedVoice as 'maya' | 'leo' | 'sam');

  // Keep NASA feed non-blocking so kids get snappy answers
  const liveNasa =
    nasaFeed ||
    (await Promise.race([
      loadNasaMissionFeed().catch(() => null),
      new Promise<Record<string, unknown> | null>((resolve) =>
        setTimeout(() => resolve(cachedNasaFeed?.data || null), 900)
      ),
    ]));

  try {
    const ai = getAiClient();

    const personaDescription =
      assignedSpeaker === 'leo'
        ? 'Pilot Leo (energetic, friendly MALE astronaut co-pilot who loves explaining space physics, planets, thrusters, orbits, and Mars rovers with fun everyday comparisons!)'
        : assignedSpeaker === 'sam'
        ? 'Director Sam (calm, reassuring senior MALE Mission Director who explains flight safety, shielding, power grids, and teamwork clearly!)'
        : 'Commander Maya (warm, encouraging FEMALE AI Flight Coach and Shuttle Commander who guides young astronauts gently through flying and space science!)';

    const conversationLines = safeHistory
      .map((turn: { role?: string; text?: string; speaker?: string }) =>
        `${turn.role === 'kid' ? 'Cadet' : turn.speaker === 'leo' ? 'Pilot Leo' : turn.speaker === 'sam' ? 'Director Sam' : 'Commander Maya'}: ${String(turn.text || '').slice(0, 350)}`
      )
      .join('\n');

    const prompt = `Cadet Name: ${String(callsign || 'CADET-01').slice(0, 24)}
Active Coach Persona Speaking Now: ${personaDescription}
Current Screen Mode: ${mode}

Live Telemetry Snapshot (if currently inside a 3D mission):
${telemetry ? JSON.stringify(telemetry, null, 2) : 'Cadet is in the AI Coach Lounge (no live cockpit open right now).'}

Live NASA Space Weather & Mars Data Right Now:
${liveNasa ? JSON.stringify(liveNasa, null, 2) : 'Unavailable'}

Recent Saved Runs (${safeRuns.length}):
${safeRuns.length ? JSON.stringify(safeRuns.map((r: Record<string, unknown>) => ({ mode: r.mode, outcome: r.outcome, safetyScore: r.safetyScore, fuelRemainingPct: r.fuelRemainingPct, drillsResolved: r.drillsResolved }))) : 'None saved yet'}

Recent Chat History:
${conversationLines || '(New conversation)'}

Cadet's Question:
"${cleanQuestion}"

IMPORTANT: Answer the Cadet's exact question directly in the very first sentence! Keep your answer clear, concrete, fun, and natural to read aloud for a 7-to-12-year-old child.`;

    const systemInstruction = `You are ${personaDescription} in "Artemis Flight Academy", mentoring Junior Astronauts aged 7 to 12.

DIRECT ANSWER & VOICE RULES:
- ALWAYS answer the child's EXACT question directly in your very first 1-2 sentences in plain, warm everyday English. Never dodge, stall, or reply only with generic game tips if they asked a planet, astronomy, physics, or curiosity question!
- Craft \`reply\` in 2 to 3 crisp, conversational sentences so voice synthesis reads it smoothly from start to finish without breaking up (no markdown asterisks, no bullets, no parenthetical clutter).
- If they ask about what to do in the game or an active alert, cite the exact number from telemetry and name the exact button (Spacebar/Brake, Arrow keys/Steer, W/Forward, Auto-Aim, Fix Alert, Air Maker, Space Shield, Space Farm, Storm Shelter, Close Safety Door).
- When asked about solar storms, Mars weather, or asteroids today, cite real numbers from Live NASA Data.`;

    const requestPayload = {
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description: 'Direct, natural 2-3 sentence spoken answer addressing the exact question with zero markdown.',
            },
            scienceConcept: {
              type: Type.STRING,
              description: 'One short fun sentence (10-18 words) linking the answer to a real NASA or physics idea.',
            },
            actionTip: {
              type: Type.STRING,
              description: 'One short 6-14 word next step they can try right now.',
            },
            suggestedQuestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Exactly 3 short fun follow-up questions (each under 46 characters).',
            },
          },
          required: ['reply', 'scienceConcept', 'actionTip', 'suggestedQuestions'],
        },
      },
    };

    let response;
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          ...requestPayload,
          config: { ...requestPayload.config, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), 7500)),
      ]);
    } catch {
      // Fallback to lower-latency lightweight model if hydrogen hits tier/latency issues
      response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          ...requestPayload,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), 6500)),
      ]);
    }

    const rawText = (response.text || '').trim();
    const parsed = parseJsonResponse<{
      reply?: string;
      scienceConcept?: string;
      actionTip?: string;
      suggestedQuestions?: string[];
    }>(rawText, {});

    const fallbackAnswer = buildDirectKidCoachAnswer({
      question: cleanQuestion,
      callsign: String(callsign),
      mode: String(mode),
      speaker: assignedSpeaker,
      telemetry,
      nasaFeed: liveNasa as Record<string, unknown> | null,
    });

    const plainTextReply =
      !parsed.reply && rawText && !rawText.startsWith('{')
        ? rawText.replace(/[*_`#>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 420)
        : '';

    const reply = String(parsed.reply || plainTextReply || fallbackAnswer.reply).trim();
    const scienceConcept = String(parsed.scienceConcept || fallbackAnswer.scienceConcept).trim() || undefined;
    const actionTip = String(parsed.actionTip || fallbackAnswer.actionTip).trim() || undefined;
    const suggestedQuestions =
      Array.isArray(parsed.suggestedQuestions) && parsed.suggestedQuestions.length > 0
        ? parsed.suggestedQuestions.map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
        : fallbackAnswer.suggestedQuestions;

    return res.json({
      speaker: assignedSpeaker,
      reply,
      scienceConcept,
      actionTip,
      suggestedQuestions,
    });
  } catch (err) {
    console.warn(
      '[AI Coach Fallback Engaged]:',
      err instanceof Error ? err.message.slice(0, 180) : 'Gemini unavailable'
    );
    const directFallback = buildDirectKidCoachAnswer({
      question: cleanQuestion,
      callsign: String(callsign),
      mode: String(mode),
      speaker: assignedSpeaker,
      telemetry,
      nasaFeed: liveNasa as Record<string, unknown> | null,
    });
    return res.json(directFallback);
  }
});

// --- WEBSOCKET REAL-TIME MULTIPLAYER & GROUND CONTROL HUB ---

interface Participant {
  clientId: string;
  callsign: string;
  role: 'commander' | 'copilot' | 'ground_control';
  ws: WebSocket;
}

interface RoomState {
  roomId: string;
  mode: 'docking' | 'lunar_outpost' | 'mars_outpost';
  participants: Map<string, Participant>;
  dockingTelemetry: Record<string, unknown> | null;
  outpostTelemetry: Record<string, unknown> | null;
  directives: Array<{ id: string; sender: string; role: string; text: string; timestamp: string }>;
  activeDrills: string[];
  updatedAt: string;
}

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string): RoomState {
  const cleanId = roomId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32) || 'ISS-NODE-01';
  let room = rooms.get(cleanId);
  if (!room) {
    room = {
      roomId: cleanId,
      mode: 'docking',
      participants: new Map(),
      dockingTelemetry: null,
      outpostTelemetry: null,
      directives: [],
      activeDrills: [],
      updatedAt: new Date().toISOString(),
    };
    rooms.set(cleanId, room);
  }
  return room;
}

// Pre-seed default mission rooms so Ground Control always sees active channels
getOrCreateRoom('ISS-NODE-01');
getOrCreateRoom('GATEWAY-HALO-02');
getOrCreateRoom('SHACKLETON-BASE');

function serializeRoom(room: RoomState) {
  return {
    roomId: room.roomId,
    mode: room.mode,
    participants: Array.from(room.participants.values()).map((p) => ({
      clientId: p.clientId,
      callsign: p.callsign,
      role: p.role,
    })),
    dockingTelemetry: room.dockingTelemetry,
    outpostTelemetry: room.outpostTelemetry,
    directives: room.directives.slice(-20),
    activeDrills: room.activeDrills,
    updatedAt: room.updatedAt,
  };
}

function broadcastToRoom(room: RoomState, eventType: string, payload: unknown, excludeClientId?: string) {
  const msg = JSON.stringify({ type: eventType, payload });
  for (const participant of room.participants.values()) {
    if (excludeClientId && participant.clientId === excludeClientId) continue;
    if (participant.ws.readyState === WebSocket.OPEN) {
      participant.ws.send(msg);
    }
  }
}

function broadcastRoomsDirectory() {
  const directory = Array.from(rooms.values()).map((r) => ({
    roomId: r.roomId,
    mode: r.mode,
    participantCount: r.participants.size,
    activeDrills: r.activeDrills,
    updatedAt: r.updatedAt,
  }));
  const msg = JSON.stringify({ type: 'rooms:directory', payload: directory });
  for (const room of rooms.values()) {
    for (const p of room.participants.values()) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(msg);
      }
    }
  }
}

app.get('/api/rooms', (_req, res) => {
  const list = Array.from(rooms.values()).map((r) => ({
    roomId: r.roomId,
    mode: r.mode,
    participantCount: r.participants.size,
    participants: Array.from(r.participants.values()).map((p) => ({
      clientId: p.clientId,
      callsign: p.callsign,
      role: p.role,
    })),
    dockingTelemetry: r.dockingTelemetry,
    outpostTelemetry: r.outpostTelemetry,
    activeDrills: r.activeDrills,
    updatedAt: r.updatedAt,
  }));
  res.json({ rooms: list });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  let currentRoom: RoomState | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type, payload } = msg ?? {};

      if (type === 'room:join') {
        if (currentRoom) {
          currentRoom.participants.delete(clientId);
          broadcastToRoom(currentRoom, 'room:state', serializeRoom(currentRoom));
        }

        const room = getOrCreateRoom(String(payload?.roomId || 'ISS-NODE-01'));
        const role =
          payload?.role === 'copilot' || payload?.role === 'ground_control'
            ? payload.role
            : 'commander';
        const callsign = String(payload?.callsign || 'CADET-01').slice(0, 24);

        currentRoom = room;
        room.participants.set(clientId, { clientId, callsign, role, ws });
        room.updatedAt = new Date().toISOString();

        ws.send(JSON.stringify({ type: 'session:welcome', payload: { clientId, room: serializeRoom(room) } }));
        broadcastToRoom(room, 'room:state', serializeRoom(room), clientId);
        broadcastRoomsDirectory();
      } else if (type === 'telemetry:docking' && currentRoom) {
        currentRoom.mode = 'docking';
        currentRoom.dockingTelemetry = payload;
        currentRoom.updatedAt = new Date().toISOString();
        broadcastToRoom(currentRoom, 'telemetry:docking', payload, clientId);
      } else if (type === 'telemetry:outpost' && currentRoom) {
        currentRoom.mode = payload?.theater === 'mars' ? 'mars_outpost' : 'lunar_outpost';
        currentRoom.outpostTelemetry = payload;
        currentRoom.updatedAt = new Date().toISOString();
        broadcastToRoom(currentRoom, 'telemetry:outpost', payload, clientId);
      } else if (type === 'copilot:action' && currentRoom) {
        broadcastToRoom(currentRoom, 'copilot:action', payload, clientId);
      } else if (type === 'directive:send' && currentRoom) {
        const entry = {
          id: crypto.randomUUID().slice(0, 8),
          sender: String(payload?.sender || 'FLIGHT-DIR').slice(0, 24),
          role: String(payload?.role || 'ground_control'),
          text: String(payload?.text || '').slice(0, 280),
          timestamp: new Date().toISOString(),
        };
        if (entry.text) {
          currentRoom.directives.push(entry);
          if (currentRoom.directives.length > 50) currentRoom.directives.shift();
          currentRoom.updatedAt = new Date().toISOString();
          broadcastToRoom(currentRoom, 'directive:received', entry);
        }
      } else if (type === 'drill:inject' && currentRoom) {
        const drillId = String(payload?.drillId || '');
        if (drillId && !currentRoom.activeDrills.includes(drillId)) {
          currentRoom.activeDrills.push(drillId);
          currentRoom.updatedAt = new Date().toISOString();
          broadcastToRoom(currentRoom, 'drill:injected', { drillId, sender: payload?.sender || 'FLIGHT-DIR' });
          broadcastRoomsDirectory();
        }
      } else if (type === 'drill:clear' && currentRoom) {
        const drillId = String(payload?.drillId || '');
        currentRoom.activeDrills = currentRoom.activeDrills.filter((d) => d !== drillId);
        currentRoom.updatedAt = new Date().toISOString();
        broadcastToRoom(currentRoom, 'drill:cleared', { drillId });
        broadcastRoomsDirectory();
      }
    } catch {
      // Ignore malformed WebSocket packets
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.participants.delete(clientId);
      currentRoom.updatedAt = new Date().toISOString();
      broadcastToRoom(currentRoom, 'room:state', serializeRoom(currentRoom));
      broadcastRoomsDirectory();
    }
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Artemis Flight Academy server listening on port ${PORT}`);
  });
}

startServer();
