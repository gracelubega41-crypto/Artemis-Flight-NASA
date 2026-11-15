export type AppSection = 'docking' | 'outpost' | 'ground_control' | 'analytics' | 'compliance';

export type CrewRole = 'commander' | 'copilot' | 'ground_control';

export type ClearanceTier = 'CADET' | 'FLIGHT_READY' | 'COMMANDER' | 'FLIGHT_DIRECTOR';

export interface UserProfile {
  uid: string;
  displayName: string;
  callsign: string;
  role: 'trainee' | 'instructor';
  clearanceTier: ClearanceTier;
  missionsCompleted: number;
  averageSafetyScore: number;
  updatedAt?: unknown;
}

export interface DockingTelemetry {
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
  angVelPitch: number;
  angVelYaw: number;
  angVelRoll: number;
  rangeMeters: number;
  closureRateMs: number;
  lateralOffsetM: number;
  alignmentErrorDeg: number;
  fuelKg: number;
  fuelRemainingPct: number;
  rcsActive: string[];
  captureLatchArmed: boolean;
  idaAlignmentOffset: number;
  busBActive: boolean;
  radarBackupActive: boolean;
  dockingStatus: 'APPROACH' | 'FINAL_CORRIDOR' | 'CAPTURED' | 'COLLISION_ABORT';
  safetyScore: number;
  elapsedSec: number;
  activeDrills: string[];
  vrActive: boolean;
  hardwareActive: boolean;
}

export interface OutpostTelemetry {
  theater: 'lunar' | 'mars';
  sol: number;
  hourOfSol: number;
  totalPowerKw: number;
  batteryPct: number;
  powerDemandKw: number;
  allocEclss: number;
  allocShielding: number;
  allocHydroponics: number;
  allocThermal: number;
  o2Pct: number;
  co2MmHg: number;
  pressureKpa: number;
  radiationMsv: number;
  doseRateMsvHr: number;
  foodSols: number;
  waterRecoveryPct: number;
  crewHealthPct: number;
  insideTempC?: number;
  shelterActive: boolean;
  hullIsolated: boolean;
  activeDrills: string[];
  status: 'NOMINAL' | 'CAUTION' | 'CRITICAL' | 'FAILED' | 'MISSION_COMPLETE';
  safetyScore: number;
}

export interface NasaAsteroidEntry {
  name: string;
  diameterM: number;
  speedKmh: number;
  missKm: number;
  hazardous: boolean;
}

export interface NasaMissionFeed {
  fetchedAt: string;
  source: string;
  spaceWeather: {
    level: 'CALM' | 'ACTIVE' | 'STORM_WATCH';
    recentCmeCount: number;
    latestCmeSpeedKms: number;
    fastestCmeSpeedKms: number;
    latestKpIndex: number;
    latestAlertId: string;
    latestAlertType: string;
    latestAlertTime: string;
    latestAlertSummary: string;
    solarFluxMultiplier: number;
  };
  marsWeather: {
    sol: string;
    avgTempC: number;
    minTempC: number;
    maxTempC: number;
    pressureKpa: number;
    windMs: number;
    maxWindMs: number;
    windDirection: string;
    season: string;
  };
  asteroids: NasaAsteroidEntry[];
}

export interface SimulationRunRecord {
  runId: string;
  userId: string;
  callsign: string;
  instructorEmail?: string;
  mode: 'docking' | 'lunar_outpost' | 'mars_outpost';
  outcome: 'SUCCESS' | 'ABORTED' | 'FAILED';
  safetyScore: number;
  durationSec: number;
  fuelRemainingPct?: number;
  closureRateMs?: number;
  alignmentErrorDeg?: number;
  radiationDoseMsv?: number;
  drillsResolved?: number;
  vrUsed?: boolean;
  hardwareInputUsed?: boolean;
  multiplayerRoom?: string;
  standardRef: string;
  createdAt?: unknown;
}

export interface FlightCredentialRecord {
  credentialId: string;
  userId: string;
  instructorEmail?: string;
  certificationLevel: 'ORBITAL_DOCKING_L1' | 'OUTPOST_OPS_L2' | 'COMMAND_READY_L3';
  algorithm: string;
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
  fingerprintSha256: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt?: unknown;
}

export interface CertificationReportRecord {
  reportId: string;
  userId: string;
  instructorEmail?: string;
  status: 'CERTIFIED' | 'PROVISIONAL' | 'RETEST_REQUIRED';
  readinessScore: number;
  summary: string;
  identifiedGaps: string[];
  recommendations: string[];
  createdAt?: unknown;
}

export interface AuditLogRecord {
  logId: string;
  userId: string;
  actorEmail?: string;
  action: string;
  standardRef: string;
  detail: string;
  integrityHash: string;
  createdAt?: unknown;
}

export interface RoomDirectoryEntry {
  roomId: string;
  mode: 'docking' | 'lunar_outpost' | 'mars_outpost';
  participantCount: number;
  participants?: Array<{ clientId: string; callsign: string; role: CrewRole }>;
  dockingTelemetry?: DockingTelemetry | null;
  outpostTelemetry?: OutpostTelemetry | null;
  activeDrills: string[];
  updatedAt: string;
}

export interface FlightDirective {
  id: string;
  sender: string;
  role: string;
  text: string;
  timestamp: string;
}
