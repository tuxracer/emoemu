import HID from 'node-hid';
import { pipe, filter, map } from 'remeda';
import { safeClose } from '../../utils/safeClose';
import { StandardButton } from '../../core/button';
import { createOppositeDirections } from '../inputUtils';

export * from './consts';

import { ALL_STANDARD_BUTTONS } from './consts';
import {
  GamepadProfile,
  AnalogState,
  findProfile,
  isGamepadDevice,
  gamepadProfiles,
} from '../gamepadProfiles';
import {
  notifyGamepadConnected,
  notifyGamepadDisconnected,
} from '../../frontend/notifications';
import {
  GAMEPAD_SCAN_INTERVAL_MS,
  MAX_GAMEPADS,
  HEX_BASE,
  PROFILE_NAME_DISPLAY_LENGTH,
  ANALOG_DEBUG_DECIMALS,
} from '..';
import { logger } from '../../utils/logger';

/**
 * Callback type for button state changes
 */
export type GamepadButtonCallback = (
  port: number,
  button: StandardButton,
  pressed: boolean
) => void;

/**
 * Callback type for analog axis changes
 * @param port Controller port (0-based)
 * @param index Analog stick (0=left, 1=right)
 * @param axis Axis (0=X, 1=Y)
 * @param value Normalized value from -1.0 to 1.0
 */
export type GamepadAnalogCallback = (
  port: number,
  index: number,
  axis: number,
  value: number
) => void;

/**
 * Represents a connected gamepad device
 */
interface ConnectedGamepad {
  device: HID.HID;
  profile: GamepadProfile;
  deviceInfo: HID.Device;
  controllerPort: 0 | 1;
  lastButtonState: Map<StandardButton, boolean>;
  lastAnalogState: AnalogState | null;
}


/**
 * Manages gamepad input via HID devices
 * Supports Xbox, PlayStation, Nintendo, and generic USB gamepads
 */
export class GamepadManager {
  private gamepads: ConnectedGamepad[] = [];
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private enabled: boolean = false;
  private initialScanComplete: boolean = false;

  /** Callback when button state changes */
  public onButtonChange: GamepadButtonCallback | null = null;

  /** Callback when analog axis changes */
  public onAnalogChange: GamepadAnalogCallback | null = null;

  constructor() {}

  /**
   * Start the gamepad manager
   * Scans for devices and begins reading input
   */
  start(): void {
    if (this.enabled) {return;}
    this.enabled = true;

    // Log joypad driver (RetroArch-style)
    logger.info('Found joypad driver: "hid"', 'Joypad');

    // Initial device scan (silent - no notifications)
    this.scanForDevices();
    this.initialScanComplete = true;

    // Periodically scan for new devices (hotplug support)
    this.scanInterval = setInterval(() => {
      this.scanForDevices();
    }, GAMEPAD_SCAN_INTERVAL_MS);
  }

  /**
   * Stop the gamepad manager and release all devices
   */
  stop(): void {
    this.enabled = false;

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    // Close all connected gamepads
    for (const gamepad of this.gamepads) {
      safeClose(gamepad.device);
    }
    this.gamepads = [];
  }

  /**
   * Scan for and connect to gamepad devices
   */
  private scanForDevices(): void {
    if (!this.enabled) {return;}

    try {
      const devices = HID.devices();
      const gamepadDevices = devices.filter(isGamepadDevice);

      for (const deviceInfo of gamepadDevices) {
        // Skip if already connected
        if (this.isDeviceConnected(deviceInfo)) {continue;}

        // Skip if we already have max gamepads
        if (this.gamepads.length >= MAX_GAMEPADS) {continue;}

        // Try to connect
        this.connectDevice(deviceInfo);
      }
    } catch {
      // HID enumeration can fail on some systems - ignore silently
    }
  }

  /**
   * Check if a device is already connected
   */
  private isDeviceConnected(deviceInfo: HID.Device): boolean {
    return this.gamepads.some(
      (gp) =>
        gp.deviceInfo.vendorId === deviceInfo.vendorId &&
        gp.deviceInfo.productId === deviceInfo.productId &&
        gp.deviceInfo.path === deviceInfo.path
    );
  }

  /**
   * Attempt to connect to a gamepad device
   */
  private connectDevice(deviceInfo: HID.Device): void {
    if (!deviceInfo.path) {return;}

    try {
      const device = new HID.HID(deviceInfo.path);
      const profile = findProfile(
        deviceInfo.vendorId,
        deviceInfo.productId
      );

      // Assign to next available controller port (0-indexed for core compatibility)
      const controllerPort: 0 | 1 = this.gamepads.length === 0 ? 0 : 1;

      const gamepad: ConnectedGamepad = {
        device,
        profile,
        deviceInfo,
        controllerPort,
        lastButtonState: new Map(),
        lastAnalogState: null,
      };

      // Set up data handler
      device.on('data', (data: Buffer) => {
        this.handleInput(gamepad, data);
      });

      // Handle disconnection
      device.on('error', () => {
        this.disconnectGamepad(gamepad);
      });

      this.gamepads.push(gamepad);

      // Log gamepad connection (RetroArch-style)
      logger.info(`${profile.name} configured in port ${controllerPort + 1}`, 'Autoconf');
      logger.debug(`Joypad connected: ${deviceInfo.product ?? 'Unknown'} (VID=${deviceInfo.vendorId.toString(HEX_BASE)}, PID=${deviceInfo.productId.toString(HEX_BASE)})`, 'Joypad');

      // Only notify for hotplugged gamepads, not ones already connected at startup
      if (this.initialScanComplete) {
        notifyGamepadConnected(profile.name, controllerPort + 1);
      }

      logger.debug(
        `Gamepad connected: ${profile.name} (${deviceInfo.product ?? 'Unknown'}) -> Player ${controllerPort + 1}`,
        'Joypad'
      );
    } catch {
      // Failed to open device - might be in use or require permissions
    }
  }

  /** Deadzone threshold for analog stick changes (1%) */
  private static readonly ANALOG_DEADZONE = 0.01;

  /**
   * Handle input data from a gamepad
   */
  private handleInput(gamepad: ConnectedGamepad, data: Buffer): void {
    // Guard: the hex dump is built for every HID report, so skip the
    // string work entirely unless debug logging is actually on
    if (logger.isLevelEnabled('debug')) {
      logger.debug(
        `[${gamepad.profile.name}] Raw: ${Array.from(data)
          .map((b) => b.toString(HEX_BASE).padStart(2, '0'))
          .join(' ')}`,
        'Joypad'
      );
    }

    try {
      const buttonStates = gamepad.profile.parseReport(data);

      // Update all tracked buttons
      for (const button of ALL_STANDARD_BUTTONS) {
        const pressed = buttonStates.get(button) ?? false;
        const wasPressed = gamepad.lastButtonState.get(button) ?? false;

        // Only update if state changed
        if (pressed !== wasPressed) {
          // Handle opposite directions - don't allow Up+Down or Left+Right
          if (pressed) {
            this.handleButtonPress(button, gamepad);
          } else {
            // Fire callback for button release
            this.onButtonChange?.(gamepad.controllerPort, button, false);
          }
          gamepad.lastButtonState.set(button, pressed);
        }
      }

      // Handle analog stick input if profile supports it
      if (gamepad.profile.parseAnalog && this.onAnalogChange) {
        const analogState = gamepad.profile.parseAnalog(data);
        if (analogState) {
          this.handleAnalogInput(gamepad, analogState);
        }
      }
    } catch {
      // Parsing failed - might be unexpected report format
    }
  }

  /**
   * Handle analog stick input changes
   */
  private handleAnalogInput(gamepad: ConnectedGamepad, state: AnalogState): void {
    const last = gamepad.lastAnalogState;
    const port = gamepad.controllerPort;
    const dz = GamepadManager.ANALOG_DEADZONE;

    // Debug: Log raw analog values (guarded — runs on every analog report)
    if (logger.isLevelEnabled('debug')) {
      logger.debug(
        `Analog raw: L(${state.leftX.toFixed(ANALOG_DEBUG_DECIMALS)}, ${state.leftY.toFixed(ANALOG_DEBUG_DECIMALS)}) R(${state.rightX.toFixed(ANALOG_DEBUG_DECIMALS)}, ${state.rightY.toFixed(ANALOG_DEBUG_DECIMALS)})`,
        'Joypad'
      );
    }

    // Left stick X (index=0, axis=0)
    if (!last || Math.abs(state.leftX - last.leftX) > dz) {
      this.onAnalogChange?.(port, 0, 0, state.leftX);
    }
    // Left stick Y (index=0, axis=1)
    if (!last || Math.abs(state.leftY - last.leftY) > dz) {
      this.onAnalogChange?.(port, 0, 1, state.leftY);
    }
    // Right stick X (index=1, axis=0)
    if (!last || Math.abs(state.rightX - last.rightX) > dz) {
      this.onAnalogChange?.(port, 1, 0, state.rightX);
    }
    // Right stick Y (index=1, axis=1)
    if (!last || Math.abs(state.rightY - last.rightY) > dz) {
      this.onAnalogChange?.(port, 1, 1, state.rightY);
    }

    gamepad.lastAnalogState = state;
  }

  /**
   * Opposite D-pad directions for preventing simultaneous Up+Down or Left+Right
   */
  private static readonly OPPOSITE_DIRECTIONS: Map<StandardButton, StandardButton> = createOppositeDirections(
    StandardButton.Up,
    StandardButton.Down,
    StandardButton.Left,
    StandardButton.Right
  );

  /**
   * Handle button press with opposite direction logic
   */
  private handleButtonPress(
    button: StandardButton,
    gamepad: ConnectedGamepad
  ): void {
    // Release opposite direction if pressing a direction
    const opposite = GamepadManager.OPPOSITE_DIRECTIONS.get(button);
    if (opposite !== undefined && gamepad.lastButtonState.get(opposite)) {
      // Release opposite direction first
      this.onButtonChange?.(gamepad.controllerPort, opposite, false);
      gamepad.lastButtonState.set(opposite, false);
    }

    // Fire callback for button press
    this.onButtonChange?.(gamepad.controllerPort, button, true);
  }

  /**
   * Disconnect a gamepad
   */
  private disconnectGamepad(gamepad: ConnectedGamepad): void {
    const index = this.gamepads.indexOf(gamepad);
    if (index === -1) {return;}

    safeClose(gamepad.device);

    this.gamepads.splice(index, 1);
    notifyGamepadDisconnected(gamepad.profile.name, gamepad.controllerPort + 1);

    // Release all buttons on the controller
    for (const button of ALL_STANDARD_BUTTONS) {
      if (gamepad.lastButtonState.get(button)) {
        this.onButtonChange?.(gamepad.controllerPort, button, false);
      }
    }

    logger.debug(
      `Gamepad disconnected: ${gamepad.profile.name} (Player ${gamepad.controllerPort + 1})`,
      'Joypad'
    );
  }

  /**
   * Get number of connected gamepads
   */
  getConnectedCount(): number {
    return this.gamepads.length;
  }

  /**
   * Get debug info about connected gamepads
   */
  getDebugInfo(): string {
    if (this.gamepads.length === 0) {
      return 'No gamepads';
    }

    return pipe(
      this.gamepads,
      map((gp) => `P${gp.controllerPort + 1}: ${gp.profile.name.substring(0, PROFILE_NAME_DISPLAY_LENGTH)}`)
    ).join(', ');
  }

  /**
   * Get short status string for player 1's input device
   */
  getPlayer1Status(): string | null {
    const p1 = this.gamepads.find((gp) => gp.controllerPort === 0);
    return p1 ? p1.profile.name : null;
  }

  /**
   * List all detected gamepad devices (for diagnostics)
   */
  static listDevices(): Array<{
    vendorId: number;
    productId: number;
    product: string;
    manufacturer: string;
    profile: string;
    path: string;
  }> {
    try {
      return pipe(
        HID.devices(),
        filter(isGamepadDevice),
        map((d) => ({
          vendorId: d.vendorId,
          productId: d.productId,
          product: d.product ?? 'Unknown',
          manufacturer: d.manufacturer ?? 'Unknown',
          profile: findProfile(d.vendorId, d.productId).name,
          path: d.path ?? '',
        }))
      );
    } catch {
      return [];
    }
  }

  /**
   * Get list of supported controller profiles
   */
  static getSupportedProfiles(): string[] {
    return pipe(
      gamepadProfiles,
      filter((p) => p.vendorIds.length > 0),
      map((p) => p.name)
    );
  }
}
