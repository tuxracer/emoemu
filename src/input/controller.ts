export enum Button {
  A = 0,
  B = 1,
  Select = 2,
  Start = 3,
  Up = 4,
  Down = 5,
  Left = 6,
  Right = 7,
}

export class Controller {
  private buttons: boolean[] = new Array(8).fill(false);
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
    this.shiftRegister |= 0x80; // Fill with 1s after all bits read

    return value;
  }

  private reload(): void {
    this.shiftRegister = 0;
    for (let i = 0; i < 8; i++) {
      if (this.buttons[i]) {
        this.shiftRegister |= (1 << i);
      }
    }
  }

  // Get string representation of pressed buttons for display
  getPressedButtons(): string {
    const buttonNames = ['A', 'B', 'Sel', 'Sta', '↑', '↓', '←', '→'];
    const pressed: string[] = [];
    for (let i = 0; i < 8; i++) {
      if (this.buttons[i]) {
        pressed.push(buttonNames[i]);
      }
    }
    return pressed.length > 0 ? pressed.join(' ') : '-';
  }
}

// Default keyboard mappings
export const defaultKeyMap: Record<string, Button> = {
  // WASD for D-Pad
  w: Button.Up,
  s: Button.Down,
  a: Button.Left,
  d: Button.Right,
  W: Button.Up,
  S: Button.Down,
  A: Button.Left,
  D: Button.Right,

  // Arrow keys (escape sequences from terminal)
  '\u001b[A': Button.Up,
  '\u001b[B': Button.Down,
  '\u001b[D': Button.Left,
  '\u001b[C': Button.Right,

  // Action buttons
  k: Button.A,
  z: Button.A,
  j: Button.B,
  x: Button.B,
  K: Button.A,
  Z: Button.A,
  J: Button.B,
  X: Button.B,

  // Start/Select
  '\r': Button.Start,      // Enter key
  ' ': Button.Select,      // Space key
};
