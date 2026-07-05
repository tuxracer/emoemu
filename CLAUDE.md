# emoemu - Terminal Retro Emulator

A terminal-based multi-core emulator written in TypeScript that renders graphics using the Kitty graphics protocol, Unicode half-blocks, ASCII, or emoji characters. Supports any system via libretro cores (RetroArch cores).

For user-facing documentation (installation, usage, controls, CLI options), see **README.md**.

## Quick Reference

```bash
pnpm run build         # Build the project
pnpm run start <rom>   # Run a ROM (auto-detects core)
pnpm run check         # Run typecheck, lint, and tests (run before commits)
pnpm run lint:fix      # Auto-fix lint errors
```

**Important:** Always run `pnpm run check` before committing. Use `pnpm run test:run` for single test runs (not `pnpm test -- --run` which stays in watch mode).

**For Claude:** When running the emulator to debug issues, always use `--no-render` to prevent video output from flooding the conversation. When debugging netplay, also use `--clear-logs` for fresh logs. See [Netplay Logging](#logging) for log file paths.

**Documentation**: When making major changes (architecture, new modules, API changes, file structure), update the relevant technical reference doc in [docs/](docs/) (per-topic `*-trd.md` files, e.g. `cores-trd.md`, `netplay-trd.md`, `native-rendering-trd.md`).

## Project Structure

```
src/
├── index.ts              # CLI entry point, main loop
├── cli/                  # CLI argument parsing, commands, emulator runner
│   ├── parseArgs/        # Argument parsing, config-to-options mapping
│   ├── commands/         # CLI commands (usage, install-core, playlist, etc.)
│   └── runEmulator/      # Emulator launch, state file validation
├── Emulator/             # Main emulation loop, renderer orchestration
│   ├── saveState/        # Save state and battery save (.srm) management
│   ├── screenshot/       # Screenshot capture, thumbnails
│   └── terminalDimensions/ # Terminal display size calculation
├── core/                 # Multi-core interface definitions (Core, SystemInfo, AudioConfig)
├── frontend/             # Shared infrastructure (audio, notifications, state management)
├── cores/
│   └── libretro/         # Libretro wrapper (FFI via koffi, environment callbacks)
├── input/                # Keyboard (Kitty protocol) and gamepad (node-hid) handling
├── rendering/            # Kitty graphics, Unicode half-blocks, ASCII, emoji renderers
├── netplay/              # RetroArch-compatible netplay (rollback, LAN discovery)
├── ui/                   # React/Ink TUI (ROM browser, settings, netplay)
└── types/                # Type declarations
```

## Source Structure

Each module is a directory named after its primary export. Module directories may **only** contain these files — no other files are allowed:

- `index.ts` (or `index.tsx`) — required, main logic and public API
- `consts.ts` — optional, module-specific constants
- `types.ts` — optional, type definitions and type guards
- `tests.ts` — optional, related tests

## RetroArch Compatibility

We aim to be compatible with RetroArch conventions and terminology wherever practical. RetroArch is the most popular libretro frontend, so aligning with its patterns:

- Makes it easier for users to import existing RetroArch settings and data
- Feels familiar to users already experienced with RetroArch
- Allows sharing of cores, playlists, thumbnails, and save states

**Where we match RetroArch:**

| Area                | Compatibility                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Config keys         | Use same names where applicable (`video_driver`, `audio_enable`, `libretro_directory`)   |
| Core options        | Same INI format and file locations (`retroarch-core-options.cfg`, per-core `.opt` files) |
| Directory structure | `/cores`, `/playlists`, `/thumbnails`, `/saves`, `/states`, `/system`                    |
| Playlist format     | LPL JSON format, fully compatible with RetroArch                                         |
| Save states         | Same binary format and `.state`/`.state.auto` naming for libretro cores                  |
| Thumbnails          | Same directory layout (`Named_Boxarts/`, `Named_Snaps/`, `Named_Titles/`)                |
| Log format          | `[LEVEL] [Category]: message` format                                                     |
| Netplay             | Protocol v7 compatible, can connect to RetroArch hosts                                   |

**Where we diverge:**

- Terminal-specific renderers (Kitty, Unicode, ASCII, emoji) instead of GPU
- Some config keys are emoemu-specific (e.g., `render_mode`, `kitty_scale`)

When adding new features, check how RetroArch handles it first and match their approach unless there's a good reason not to.

## Multi-Core Architecture

The emulator uses a **libretro-based** architecture separating system-specific emulation (cores) from shared infrastructure (frontend).

All cores implement the `Core` interface in `src/core/core.ts`. Key methods: `loadRom()`, `runFrame()`, `getFramebuffer()`, `setButtonState()`, `getState()`/`setState()` for save states.

### Core Registry

Cores self-register when imported. ROM files are auto-detected by extension. When multiple cores support the same extension, the CLI prompts for selection (use `--core <id>` to bypass).

## Libretro Core Support

Loads native RetroArch cores via koffi FFI. **Not supported**: Cores requiring OpenGL/Vulkan.

### API Flow

Load core → `retro_set_environment()` → `retro_init()` → `retro_load_game()` → main loop: `retro_run()` (fires video/audio callbacks) → cleanup.

### Core Options

Core options configure libretro core behavior (e.g., video plugins, region settings). Uses RetroArch-compatible format and file locations.

**Key files:**

- `src/cores/libretro/coreOptions/index.ts` - Loading/saving options from config files
- `src/cores/libretro/environment/index.ts` - `GET_VARIABLE`/`SET_VARIABLES` handlers

**Config file locations** (RetroArch-compatible precedence, highest first):

1. Game-specific: `<config>/config/<core>/<game>.opt`
2. Core-specific: `<config>/config/<core>/<core>.opt`
3. Global: `<config>/retroarch-core-options.cfg`

**Format** (INI-style, same as RetroArch):

```ini
mupen64plus-rdp-plugin = "angrylion"
mupen64plus-rsp-plugin = "parallel"
genesis_plus_gx-region_detect = "auto"
```

**Usage:**

```typescript
// Load from config files
const options = loadCoreOptions("mupen64plus_next", "Super Mario 64");
const core = createCore("libretro-mupen64plus-next", { coreOptions: options });

// Set at runtime
core.setCoreOption("mupen64plus-rdp-plugin", "angrylion");

// Get available options (after core init)
const available = core.getAvailableCoreOptions();
// Returns: [{ key, description, values, defaultValue, currentValue }, ...]
```

**Automatic defaults** (`DEFAULT_CORE_OPTIONS`):
Some cores need specific options to work with emoemu (terminal-based, no GPU). These are applied automatically:

- `mupen64plus` - Uses Angrylion software renderer (CPU-only, no GPU required)

### Debugging

- Set `DEBUG_ENV = true` in `src/cores/libretro/environment/index.ts` to log environment commands
- Check core file extension (`.dylib`/`.so`/`.dll`) and BIOS files in `./system/`

## Input System

**Keyboard**: Auto-detects Kitty protocol for true keyup/keydown; falls back to legacy mode with 80ms auto-release.

**Gamepad**: Uses node-hid for raw HID access. Profiles in `src/input/gamepadProfiles` for Xbox, PlayStation, Nintendo, 8BitDo controllers.

**Input Mapper**: Translates `StandardButton` enum to core-specific button IDs across different cores.

## Rendering

All renderers use diff-based optimization (skip unchanged frames).

### Dual Code Paths

**Important:** Terminal renderers have separate code paths for initial full-frame rendering vs. diff-based updates. When adding or modifying rendering options (e.g., color limits, effects), ensure changes are applied to **both**:

- Full-frame render loops (used for initial paint)
- `renderChar*` methods (used for diff-based updates)

Search for all usages of the relevant rendering functions to ensure consistency.

### Kitty Encode Worker

Kitty PNG encoding (scale → palette → deflate → base64 → APC chunks) runs on a worker thread so it never blocks the emulation loop. The pieces:

- `src/rendering/kittyEncode/` — pure `KittyFrameEncoder` (shared by sync and worker paths); every frame's metadata is self-describing, so no config sync is needed when settings change
- `src/rendering/kittyEncodeWorker/` — worker entry, built as a separate bundle entry (`dist/kittyEncodeWorker.js`)
- `src/rendering/kittyEncodeWorkerClient/` — owns the worker; transfers pixel buffers (recycled round-trip), coalesces frames latest-wins so at most one frame is in flight

The main thread only does the diff check, gamma conversion, and post-processing. `KittyRenderer` falls back to synchronous inline encoding when the worker is unavailable (e.g. unbundled dev runs) or dies mid-session.

### Performance Considerations

**Terminal I/O is the primary bottleneck.** Optimization priorities:

1. **Minimize output size** - PNG compression is worth the CPU cost; indexed 256-color is ~3x smaller than RGB
2. **Apply effects at native resolution** - Post-processing runs before scaling (4x fewer pixels at scale=2)
3. **Avoid effects that expand palette** - Vignette/gradients force RGB fallback

## Netplay

RetroArch-compatible (protocol v7). Works with libretro cores only.

### Architecture

Deterministic lockstep with rollback: input exchange every frame → predict when delayed → rollback/replay when prediction wrong → CRC desync detection.

### Logging

| Platform | Log Path                                                |
| -------- | ------------------------------------------------------- |
| macOS    | `~/Library/Application Support/emoemu/logs/netplay.log` |
| Linux    | `~/.config/emoemu/logs/netplay.log`                     |
| Windows  | `%APPDATA%\emoemu\logs\netplay.log`                     |

Use `--clear-logs` for fresh logs. Log categories: `SERVER`, `CLIENT`, `SYNC`, `DISCOVERY`, `SESSION`.

## Save States

Raw binary (`.state.auto`), compatible with RetroArch.

## Data Directories

emoemu stores data in platform-specific directories:

| Platform | Base Directory                          |
| -------- | --------------------------------------- |
| macOS    | `~/Library/Application Support/emoemu/` |
| Linux    | `~/.config/emoemu/`                     |
| Windows  | `%APPDATA%\emoemu\`                     |

**Key subdirectories:**

| Directory | Purpose                                            |
| --------- | -------------------------------------------------- |
| `cores/`  | Installed libretro cores (`.dylib`, `.so`, `.dll`) |
| `logs/`   | Log files including `emoemu.log`                   |
| `saves/`  | Save data (SRAM, memory cards)                     |
| `states/` | Save states                                        |
| `system/` | BIOS files and system data                         |

## TypeScript Strict Mode

Unused variables fail the build (TS6133, TS6192). The underscore prefix only works for **function parameters**:

```typescript
function resize(_color: string, size: number) { ... }  // Valid: _color unused but needed for size
const _foo = true;  // Invalid: still errors if unused
```

## Coding Standards

- **Never log sensitive data**: Do not log API keys, tokens, passwords, or other secrets. Use placeholder text like `[REDACTED]` if you need to indicate a value exists without revealing it
- **Arrow functions**: Use `const foo = () => { ... }` (enforced by ESLint, auto-fixable)
- **Reserve `use` prefix for React hooks**: The `useFoo` naming convention is reserved for React hooks. For boolean options or flags, use names like `systemFont`, `enableCache`, or `withValidation` instead of `useSystemFont`, `useCache`, or `useValidation`
- **Boolean naming**: Prefer `is`/`has`/`should` prefixes for boolean variables (e.g., `isEnabled`, `hasContent`, `shouldRestore`). For enable/disable flags in options interfaces, `fooEnabled` is also acceptable (e.g., `colorEnabled`, `diffRenderingEnabled`)
- **Named imports**: Use `import { pipe, filter } from 'remeda'` not `import * as R` (tree-shaking)
- **ESM imports only**: Always use `import` syntax, never `require()`. This is an ESM project and `require` will throw `ReferenceError: require is not defined`
- **Prefer `@/` path alias**: Use `import { foo } from '@/utils/logger'` instead of deep relative imports like `'../../../utils/logger'`. The `@/` alias maps to `src/` via tsconfig paths. Relative imports within the same module (e.g., `'./consts'`, `'.'`) are fine
- **Remeda utilities**: Prefer for array/object manipulation over manual loops
- **Named constants**: Use `const HEADER_SIZE = 16` not magic numbers; use underscores for large numbers (`100_000`)
- **DRY (Don't Repeat Yourself)**: When a pattern appears 3+ times, extract it into a helper function. Place shared utilities in `src/utils/` (e.g., `src/utils/findLibrary/index.ts`). This improves readability and maintainability without impacting performance
- **Module structure**: Each module (component, hook, utility) should be in its own directory with `index.ts` + `consts.ts` + `types.ts` + `tests.ts`:
  - **Components**: Use PascalCase directories (e.g., `ui/NativeDialog/`, `ui/AddRomsPrompt/`)
  - **Hooks**: Use camelCase directories (e.g., `hooks/useGamepad/`, `hooks/useClearTerminal/`)
  - **Other modules**: Use PascalCase or camelCase directories (e.g., `rendering/nativeUi/`, `rendering/shared/`)
  - **Never use kebab-case** for directory names
  - Each directory contains `index.ts` (main logic, exports public API) and `consts.ts` (constants)
- **Re-export types and consts from index.ts**: Each module's `index.ts` should re-export all types and consts from `types.ts` and `consts.ts`. External code should import from the module, not directly from internal files:

  ```typescript
  // GOOD - import from the module
  import { TICK_RATE, GameState } from "../Game";

  // BAD - importing directly from internal module files
  import { TICK_RATE } from "../Game/consts";
  import type { GameState } from "../Game/types";
  ```

  In `Game/index.ts`:

  ```typescript
  export * from "./consts";
  export * from "./types";
  ```

  - **Avoid barrel-only files**: Don't create `index.ts` files that only re-export from child modules. Import directly from the specific module instead (e.g., `import { useGamepad } from '../hooks/useGamepad'` not `from '../hooks'`).

  ```
  src/ui/
  ├── hooks/
  │   ├── useGamepad/
  │   │   ├── index.ts          # Hook implementation
  │   │   └── consts.ts         # INITIAL_DELAY_MS, MIN_REPEAT_MS, etc.
  │   └── useClearTerminal/
  │       ├── index.ts
  │       └── consts.ts
  ├── NativeDialog/
  │   ├── index.tsx
  │   ├── tests.ts
  │   └── consts.ts
  └── index.ts                  # Exports from this module (not just re-exports)
  ```

- **User terminology**: Say "game library" not "playlist" in user-facing text
- **Settings**: Any setting exposed in the TUI settings menu must also apply immediately during gameplay. This requires:
  1. Adding the setting to `RuntimeSettings` interface in `src/frontend/SettingsManager`
  2. Adding the config key mapping to `SETTING_TO_CONFIG_KEY`
  3. Initializing it in the `SettingsManager` constructor and `reloadFromConfig`
  4. Adding an `onChange` listener in the Emulator to apply the change at runtime
  5. Adding the setting to `updateOptionsFromConfig()` in `src/index.ts` so it syncs from config when launching/resuming a game (CLI options are copied at startup; without this, settings changes won't take effect)
- **RetroArch compatibility**: Follow RetroArch conventions where practical (see [RetroArch Compatibility](#retroarch-compatibility))
- **React context over prop drilling**: For app-wide state that's needed across many components (e.g., capabilities, settings), use React context instead of passing props through multiple levels. See `src/ui/AppCapabilities` for an example. This keeps component interfaces clean and avoids threading props through intermediate components that don't use them.
- **JSDoc**: Skip `@param`/`@returns` tags (TypeScript provides types); use inline comments if needed
- **Loading indicators**: Delay by ~1 second to avoid flash for fast operations
- **Intl API**: Prefer `Intl.DateTimeFormat`, `Intl.NumberFormat`, etc. over manual formatting for dates, numbers, and currencies
- **Logging**: Use the centralized `logger` from `src/utils/logger` for runtime logging. Three patterns:
  1. **CLI commands** (e.g., `--help`, `--list-cores`): Use `console.*` directly - output must always be shown regardless of log settings.
  2. **Internal debug/info**: Use `logger` only - controlled by `log_verbosity` config.
  3. **Runtime errors** (e.g., "Core rejected ROM", "Unsupported format"): Use BOTH `console.error` (user must see it) AND `logger.error` (recorded in log file for debugging). The user needs immediate feedback, but it should also be in logs.

  **Log format**: Messages should follow `[LEVEL] [Category] message` pattern (e.g., `[ERROR] [Core] Failed to load ROM`). Don't indent log messages or use other prefixes. For multi-line diagnostic info, log each line separately so every line has the proper prefix. When throwing errors that will be caught and logged, don't also log the error message explicitly - only log additional diagnostic details to avoid duplicates.

- **Explicit conditionals for derived values**: When a value like `useTrueColor` is derived from another value like `limitColors`, use the source value in conditionals, not the derived value. This makes the logic clearer and avoids confusion:

  ```typescript
  // GOOD - explicit about what each branch handles
  if (this.limitColors === 16) {
    /* ANSI 16 */
  } else if (this.limitColors === 256) {
    /* ANSI 256 */
  } else {
    /* True color (limitColors === 0) */
  }

  // BAD - confusing because useTrueColor is derived from limitColors
  if (this.limitColors === 16) {
    /* ANSI 16 */
  } else if (this.useTrueColor) {
    /* True color */
  } else {
    /* ANSI 256 */
  }
  ```

- **Type guards over type assertions**: Never use `as` type assertions on values with unknown runtime types. Use type guards from Remeda (`isString`, `isNumber`, `isBoolean`, `isPlainObject`), existing custom guards from `src/frontend/config` (e.g. `src/frontend/config/types.ts`), or create a new custom type guard if none exist:

  ```typescript
  // GOOD - type guard validates at runtime
  import { isString } from "remeda";

  if (isString(value)) {
    config.name = value;
  }

  // BAD - blind cast assumes type without validation
  config.name = value as string;
  ```

  For union types (e.g., `"kitty" | "terminal" | "ascii"`), create a type guard that validates the actual values, not just the primitive type:

  ```typescript
  // GOOD - validates the value is one of the allowed options
  import { isPostProcessingMode } from "@/frontend/config";

  if (isPostProcessingMode(value)) {
    config.video_postprocessing_mode = value; // No cast needed
  }

  // BAD - isString only checks primitive type, not valid union values
  if (isString(value)) {
    config.video_postprocessing_mode = value as PostProcessingMode; // Still a blind cast!
  }
  ```

  When creating type guards for union types, use the named type in the return type annotation - don't hardcode the union:

  ```typescript
  // GOOD - uses the named type
  import type { VideoDriver } from "../frontend/config";

  const VIDEO_DRIVERS: readonly VideoDriver[] = [
    "kitty",
    "terminal",
    "ascii",
    "emoji",
  ];

  export const isVideoDriver = (value: unknown): value is VideoDriver => {
    return isString(value) && VIDEO_DRIVERS.includes(value as VideoDriver);
  };

  // BAD - hardcodes the union type (duplicates the type definition)
  export const isVideoDriver = (
    value: unknown,
  ): value is "kitty" | "terminal" | "ascii" | "emoji" => {
    // ...
  };
  ```

- **Typed errors over string messages**: When throwing errors, create a custom error class with a typed `code` property instead of using plain `Error` with string messages. This enables type-safe error handling:

  ```typescript
  // GOOD - typed error with machine-readable code
  type MyErrorCode = "NOT_FOUND" | "PERMISSION_DENIED" | "TIMEOUT";

  class MyError extends Error {
    readonly code: MyErrorCode;
    constructor(code: MyErrorCode) {
      super(code);
      this.name = "MyError";
      this.code = code;
    }
  }

  const isMyError = (error: unknown): error is MyError => {
    return error instanceof MyError;
  };

  // Usage - callers get autocomplete and type checking
  try {
    await doSomething();
  } catch (error) {
    if (isMyError(error)) {
      switch (error.code) {
        case "NOT_FOUND": // TypeScript knows valid codes
        // ...
      }
    }
  }

  // BAD - string messages aren't type-safe
  throw new Error("Not found");
  throw new Error("Permission denied");
  ```

- **Tests verify behavior, not implementation**: Tests should verify that code works correctly, not enshrine implementation details. Never write tests that just check constant values - if a constant matters, test the behavior it affects:

  ```typescript
  // BAD - tests implementation detail, provides no value
  it("should have expected default value", () => {
    expect(MAX_FRAMES_BEHIND).toBe(60);
  });

  // GOOD - tests actual behavior that depends on the constant
  it("should trigger catchup when too far behind", () => {
    // Simulate being far behind and verify the sync behavior
    for (let i = 0; i < 70; i++) {
      syncManager.advanceFrame();
    }
    expect(syncManager.needsCatchup).toBe(true);
  });
  ```

## Linting

Run `pnpm run lint:fix` to auto-fix style issues. Key rules: arrow functions, `const`/`let` only, `===` equality, curly braces required, promise handling, `interface` over `type`.
