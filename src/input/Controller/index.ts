import {
  CONTROLLER_BUTTON_COUNT,
  NES_BUTTON_COUNT,
  CONTROLLER_SHIFT_REGISTER_HIGH_BIT,
} from '..';

export * from './consts';

export enum Button {
  // NES buttons (0-7)
  A = 0,
  B = 1,
  Select = 2,
  Start = 3,
  Up = 4,
  Down = 5,
  Left = 6,
  Right = 7,
  // SNES additional buttons (8-11)
  X = 8,
  Y = 9,
  L = 10,
  R = 11,
}

export class Controller {
  private buttons: boolean[] = new Array<boolean>(CONTROLLER_BUTTON_COUNT).fill(false);
  private shiftRegister: number = 0;
  private strobe: boolean = false;

  setButton(button: Button, pressed: boolean): void {
    this.buttons[button] = pressed;
  }

  getButton(button: Button): boolean {
    return this.buttons[button];
  }

  // Called when writing to $4016
  write(data: number): void {
    this.strobe = (data & 1) !== 0;
    if (this.strobe) {
      this.reload();
    }
  }

  // Called when reading from $4016 or $4017
  read(): number {
    if (this.strobe) {
      return this.buttons[Button.A] ? 1 : 0;
    }

    const value = (this.shiftRegister & 1);
    this.shiftRegister >>= 1;
    this.shiftRegister |= CONTROLLER_SHIFT_REGISTER_HIGH_BIT; // Fill with 1s after all bits read

    return value;
  }

  private reload(): void {
    this.shiftRegister = 0;
    for (let i = 0; i < NES_BUTTON_COUNT; i++) {
      if (this.buttons[i]) {
        this.shiftRegister |= (1 << i);
      }
    }
  }

  // Get string representation of pressed buttons for display
  getPressedButtons(): string {
    const buttonNames = ['A', 'B', 'Sel', 'Sta', '\u2191', '\u2193', '\u2190', '\u2192', 'X', 'Y', 'L', 'R'];
    const pressed: string[] = [];
    for (let i = 0; i < CONTROLLER_BUTTON_COUNT; i++) {
      if (this.buttons[i]) {
        pressed.push(buttonNames[i]);
      }
    }
    return pressed.length > 0 ? pressed.join(' ') : '-';
  }
}

