import type { CrewRole, DockingTelemetry, FlightDirective, OutpostTelemetry } from '../types/mission';

export interface RoomParticipant {
  clientId: string;
  callsign: string;
  role: CrewRole;
}

export interface RoomSnapshot {
  roomId: string;
  mode: 'docking' | 'lunar_outpost' | 'mars_outpost';
  participants: RoomParticipant[];
  dockingTelemetry: DockingTelemetry | null;
  outpostTelemetry: OutpostTelemetry | null;
  directives: FlightDirective[];
  activeDrills: string[];
  updatedAt: string;
}

type EventCallback = (event: { type: string; payload: unknown }) => void;

class MissionWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<EventCallback>();
  private reconnectTimer: number | null = null;
  private currentJoin: { roomId: string; callsign: string; role: CrewRole } | null = null;
  public connected = false;
  public clientId: string | null = null;

  public connect(roomId: string, callsign: string, role: CrewRole) {
    this.currentJoin = { roomId, callsign, role };
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.send('room:join', this.currentJoin);
      }
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      this.connected = true;
      if (this.currentJoin) {
        this.send('room:join', this.currentJoin);
      }
      this.emit({ type: 'ws:status', payload: { connected: true } });
    };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'session:welcome' && msg.payload?.clientId) {
          this.clientId = msg.payload.clientId;
        }
        this.emit(msg);
      } catch {
        // Ignore malformed packets
      }
    };

    socket.onclose = () => {
      this.connected = false;
      this.emit({ type: 'ws:status', payload: { connected: false } });
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => {
        if (this.currentJoin) {
          this.connect(this.currentJoin.roomId, this.currentJoin.callsign, this.currentJoin.role);
        }
      }, 2500);
    };
  }

  public send(type: string, payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  public subscribe(cb: EventCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: { type: string; payload: unknown }) {
    this.listeners.forEach((cb) => cb(event));
  }
}

export const missionSocket = new MissionWebSocketClient();
