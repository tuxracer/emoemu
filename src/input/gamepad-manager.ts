import HID from 'node-hid';
import { Controller, Button } from './controller.js';
import {
  GamepadProfile,
  findProfile,
  isGamepadDevice,
  gamepadProfiles,
} from './gamepad-profiles.js';

/**
 * Represents a connected gamepad device
 */
interface ConnectedGamepad {
  device: HID.HID;
  profile: GamepadProfile;
  deviceInfo: HID.Device;
  controllerPort: 1 | 2;
  lastButtonState: Map<Button, boolean>;
}

/**
 * Manages gamepad input via HID devices
 * Supports Xbox, PlayStation, Nintendo, and generic USB gamepads
 */
export class GamepadManager {
  private controller1: Controller;
  private controller2: Controller;
  private gamepads: ConnectedGamepad[] = [];
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private enabled: boolean = false;
  private debugMode: boolean = false;

  constructor(controller1: Controller, controller2: Controller) {
    this.controller1 = controller1;
    this.controller2 = controller2;
  }

  /**
   * Start the gamepad manager
   * Scans for devices and begins reading input
   */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Initial device scan
    this.scanForDevices();

    // Periodically scan for new devices (hotplug support)
    // Check every 3 seconds for new controllers
    this.scanInterval = setInterval(() => {
      this.scanForDevices();
    }, 3000);
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
      try {
        gamepad.device.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.gamepads = [];
  }

  /**
   * Enable debug mode to see raw HID data
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Scan for and connect to gamepad devices
   */
  private scanForDevices(): void {
    if (!this.enabled) return;

    try {
      const devices = HID.devices();
      const gamepadDevices = devices.filter(isGamepadDevice);

      for (const deviceInfo of gamepadDevices) {
        // Skip if already connected
        if (this.isDeviceConnected(deviceInfo)) continue;

        // Skip if we already have 2 gamepads
        if (this.gamepads.length >= 2) continue;

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
    if (!deviceInfo.path) return;

    try {
      const device = new HID.HID(deviceInfo.path);
      const profile = findProfile(
        deviceInfo.vendorId ?? 0,
        deviceInfo.productId ?? 0
      );

      // Assign to next available controller port
      const controllerPort: 1 | 2 = this.gamepads.length === 0 ? 1 : 2;

      const gamepad: ConnectedGamepad = {
        device,
        profile,
        deviceInfo,
        controllerPort,
        lastButtonState: new Map(),
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

      if (this.debugMode) {
        console.log(
          `Gamepad connected: ${profile.name} (${deviceInfo.product ?? 'Unknown'}) -> Player ${controllerPort}`
        );
      }
    } catch {
      // Failed to open device - might be in use or require permissions
    }
  }

  /**
   * Handle input data from a gamepad
   */
  private handleInput(gamepad: ConnectedGamepad, data: Buffer): void {
    if (this.debugMode) {
      console.log(
        `[${gamepad.profile.name}] Raw: ${Array.from(data)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ')}`
      );
    }

    try {
      const buttonStates = gamepad.profile.parseReport(data);
      const controller =
        gamepad.controllerPort === 1 ? this.controller1 : this.controller2;

      // Update controller with new button states
      for (const button of [
        Button.A,
        Button.B,
        Button.Select,
        Button.Start,
        Button.Up,
        Button.Down,
        Button.Left,
        Button.Right,
      ]) {
        const pressed = buttonStates.get(button) ?? false;
        const wasPressed = gamepad.lastButtonState.get(button) ?? false;

        // Only update if state changed
        if (pressed !== wasPressed) {
          // Handle opposite directions - don't allow Up+Down or Left+Right
          if (pressed) {
            this.handleButtonPress(controller, button, gamepad);
          } else {
            controller.setButton(button, false);
          }
          gamepad.lastButtonState.set(button, pressed);
        }
      }
    } catch {
      // Parsing failed - might be unexpected report format
    }
  }

  /**
   * Handle button press with opposite direction logic
   */
  private handleButtonPress(
    controller: Controller,
    button: Button,
    gamepad: ConnectedGamepad
  ): void {
    // Release opposite direction if pressing a direction
    const opposites: Map<Button, Button> = new Map([
      [Button.Up, Button.Down],
      [Button.Down, Button.Up],
      [Button.Left, Button.Right],
      [Button.Right, Button.Left],
    ]);

    const opposite = opposites.get(button);
    if (opposite !== undefined) {
      controller.setButton(opposite, false);
      gamepad.lastButtonState.set(opposite, false);
    }

    controller.setButton(button, true);
  }

  /**
   * Disconnect a gamepad
   */
  private disconnectGamepad(gamepad: ConnectedGamepad): void {
    const index = this.gamepads.indexOf(gamepad);
    if (index === -1) return;

    try {
      gamepad.device.close();
    } catch {
      // Ignore close errors
    }

    this.gamepads.splice(index, 1);

    // Release all buttons on the controller
    const controller =
      gamepad.controllerPort === 1 ? this.controller1 : this.controller2;
    for (const button of [
      Button.A,
      Button.B,
      Button.Select,
      Button.Start,
      Button.Up,
      Button.Down,
      Button.Left,
      Button.Right,
    ]) {
      controller.setButton(button, false);
    }

    if (this.debugMode) {
      console.log(
        `Gamepad disconnected: ${gamepad.profile.name} (Player ${gamepad.controllerPort})`
      );
    }
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

    return this.gamepads
      .map(
        (gp) =>
          `P${gp.controllerPort}: ${gp.profile.name.substring(0, 15)}`
      )
      .join(', ');
  }

  /**
   * Get short status string for player 1's input device
   */
  getPlayer1Status(): string | null {
    const p1 = this.gamepads.find((gp) => gp.controllerPort === 1);
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
      const devices = HID.devices();
      const gamepadDevices = devices.filter(isGamepadDevice);

      return gamepadDevices.map((d) => ({
        vendorId: d.vendorId ?? 0,
        productId: d.productId ?? 0,
        product: d.product ?? 'Unknown',
        manufacturer: d.manufacturer ?? 'Unknown',
        profile: findProfile(d.vendorId ?? 0, d.productId ?? 0).name,
        path: d.path ?? '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get list of supported controller profiles
   */
  static getSupportedProfiles(): string[] {
    return gamepadProfiles
      .filter((p) => p.vendorIds.length > 0)
      .map((p) => p.name);
  }
}
