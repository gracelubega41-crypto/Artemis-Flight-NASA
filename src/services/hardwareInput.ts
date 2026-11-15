export interface HardwareFlightInput {
  connected: boolean;
  deviceName: string | null;
  hidSupported: boolean;
  hidDevices: string[];
  translateX: number;
  translateY: number;
  translateZ: number;
  pitch: number;
  yaw: number;
  roll: number;
  killRotationPressed: boolean;
  precisionTogglePressed: boolean;
  rawAxes: number[];
  rawButtons: boolean[];
}

const DEADZONE = 0.14;

function applyDeadzone(val: number): number {
  if (Math.abs(val) < DEADZONE) return 0;
  return (val - Math.sign(val) * DEADZONE) / (1 - DEADZONE);
}

export function pollFlightHardware(): HardwareFlightInput {
  const hidSupported = typeof navigator !== 'undefined' && 'hid' in navigator;
  const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const activePad = Array.from(gamepads || []).find((g) => g && g.connected) || null;

  if (!activePad) {
    return {
      connected: false,
      deviceName: null,
      hidSupported,
      hidDevices: [],
      translateX: 0,
      translateY: 0,
      translateZ: 0,
      pitch: 0,
      yaw: 0,
      roll: 0,
      killRotationPressed: false,
      precisionTogglePressed: false,
      rawAxes: [],
      rawButtons: [],
    };
  }

  const axes = activePad.axes.map((a) => Number(a.toFixed(3)));
  const buttons = activePad.buttons.map((b) => b.pressed);

  // Standard HOTAS / Dual-Stick mapping:
  // Left stick (axes 0, 1): Lateral X/Y translation
  // Right stick (axes 2, 3): Yaw / Pitch attitude
  // Triggers (buttons 6, 7): Forward / Aft Z translation
  // Shoulder bumpers (buttons 4, 5): Roll left / right
  const translateX = applyDeadzone(axes[0] || 0);
  const translateY = -applyDeadzone(axes[1] || 0);
  const yaw = -applyDeadzone(axes[2] || 0);
  const pitch = -applyDeadzone(axes[3] || 0);

  const forwardTrigger = activePad.buttons[7]?.value ?? 0;
  const aftTrigger = activePad.buttons[6]?.value ?? 0;
  const translateZ = forwardTrigger - aftTrigger;

  const rollLeft = buttons[4] ? 1 : 0;
  const rollRight = buttons[5] ? 1 : 0;
  const roll = rollLeft - rollRight;

  return {
    connected: true,
    deviceName: activePad.id,
    hidSupported,
    hidDevices: [],
    translateX,
    translateY,
    translateZ,
    pitch,
    yaw,
    roll,
    killRotationPressed: Boolean(buttons[0]),
    precisionTogglePressed: Boolean(buttons[1]),
    rawAxes: axes,
    rawButtons: buttons,
  };
}

export async function requestWebHidFlightHardware(): Promise<string[]> {
  const nav = navigator as Navigator & {
    hid?: {
      requestDevice: (opts: { filters: unknown[] }) => Promise<Array<{ productName?: string; vendorId: number; productId: number }>>;
    };
  };
  if (!nav.hid) {
    throw new Error('WebHID API is not available in this browser context.');
  }
  const devices = await nav.hid.requestDevice({ filters: [] });
  return devices.map((d) => d.productName || `HID Flight Peripheral (0x${d.vendorId.toString(16)})`);
}
