/**
 * Core Builder Service
 *
 * Builds libretro cores from source for platforms where pre-built
 * binaries are not available or require specific build options.
 *
 * Currently supports:
 * - mupen64plus_next on ARM macOS (requires software rendering build)
 */

import { execSync, spawn } from "child_process";
import { existsSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { ensureDirectory } from '../../utils/ensureDirectory';
import { join } from "path";
import { platform, arch, tmpdir } from "os";
import { getCoresDirectory } from "../config";
import { logger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/getErrorMessage";
import { CoreBuildError } from "./types";

/** Default number of CPU cores to use for parallel builds */
const DEFAULT_CPU_COUNT = 4;

/** Number of recent output lines to show on build error */
const ERROR_OUTPUT_LINES = 10;

/** Bytes per kilobyte */
const BYTES_PER_KB = 1024;

/** Bytes per megabyte */
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

/** Buffer size multiplier for make dry run */
const MAKE_DRY_RUN_BUFFER_MB = 10;

/** Buffer size for make dry run (10MB to handle large projects) */
const MAKE_DRY_RUN_BUFFER_SIZE = MAKE_DRY_RUN_BUFFER_MB * BYTES_PER_MB;

/** Length of short git commit hash for display purposes */
const SHORT_COMMIT_HASH_LENGTH = 8;

/** Build progress phases */
export type BuildPhase = "cloning" | "building" | "installing" | "complete" | "error";

/** Progress callback for build operations */
export interface BuildProgress {
  phase: BuildPhase;
  message: string;
  /** Output lines from the build process */
  output?: string[];
  /** Progress percentage (0-100) if available */
  progressPercent?: number;
  /** Human-readable progress text (e.g., "15 of 238 files") */
  progressText?: string;
}

/** Core build configuration */
interface CoreBuildConfig {
  /** Git repository URL */
  repo: string;
  /** Specific commit hash to checkout (ensures reproducible builds and stable patches) */
  commit: string;
  /** Build command (uses make by default) */
  buildArgs: string[];
  /** Output filename after build */
  outputFile: string;
  /** Installed filename */
  installedFile: string;
  /** Human-readable description */
  description: string;
}

/** Cores that require building from source on specific platforms */
const BUILD_CONFIGS: Partial<Record<string, CoreBuildConfig>> = {
  mupen64plus_next: {
    repo: "https://github.com/libretro/mupen64plus-libretro-nx.git",
    // Pin to specific commit for reproducible builds and stable patches
    // Last verified: 2025-01-25 (patches for pngpriv.h and zutil.h tested against this commit)
    commit: "bc43bcedc276861254b48526f56799d63a30723b",
    buildArgs: [
      "platform=osx",
      "HAVE_PARALLEL_RDP=0",    // Disable Vulkan-dependent ParaLLEl RDP
      "HAVE_PARALLEL_RSP=1",    // Enable fast RSP dynarec (required for Angrylion)
      "HAVE_THR_AL=1",          // Enable Angrylion multi-threading
      "LLE=1",                  // Enable low-level emulation
      // Note: WITH_DYNAREC is intentionally omitted - the ARM64 dynarec assembly
      // uses GNU syntax (.hidden, .type) that's incompatible with macOS's assembler.
      // The Makefile defaults to interpreter mode on macOS, which is slower but
      // compatible. Parallel RSP still uses its own dynarec which works.
    ],
    outputFile: "mupen64plus_next_libretro.dylib",
    installedFile: "mupen64plus_next_libretro.dylib",
    description: "Nintendo 64 (Mupen64Plus-Next with Angrylion software renderer)",
  },
};

/**
 * Stub OpenGL library source code
 *
 * The mupen64plus core links against OpenGL even when using the Angrylion
 * software renderer. On macOS, loading the real OpenGL framework causes
 * hangs during library initialization (likely GPU probing).
 *
 * This stub provides empty implementations of the OpenGL functions needed
 * to satisfy the linker. Since we use Angrylion (software rendering),
 * these functions are never actually called at runtime.
 */
const GL_STUB_SOURCE = `
// Stub OpenGL functions to allow linking without the real OpenGL framework
// These functions will never be called at runtime when using Angrylion

typedef unsigned int GLenum;
typedef unsigned int GLuint;
typedef int GLint;
typedef int GLsizei;
typedef float GLfloat;
typedef double GLdouble;
typedef unsigned char GLboolean;
typedef void GLvoid;
typedef unsigned char GLubyte;

void glBindTexture(GLenum target, GLuint texture) {}
void glBlendFunc(GLenum sfactor, GLenum dfactor) {}
void glClear(GLuint mask) {}
void glClearColor(GLfloat r, GLfloat g, GLfloat b, GLfloat a) {}
void glClearDepth(GLdouble depth) {}
void glColorMask(GLboolean r, GLboolean g, GLboolean b, GLboolean a) {}
void glCullFace(GLenum mode) {}
void glDeleteTextures(GLsizei n, const GLuint *textures) {}
void glDepthFunc(GLenum func) {}
void glDepthMask(GLboolean flag) {}
void glDepthRange(GLdouble near, GLdouble far) {}
void glDisable(GLenum cap) {}
void glDrawArrays(GLenum mode, GLint first, GLsizei count) {}
void glDrawElements(GLenum mode, GLsizei count, GLenum type, const GLvoid *indices) {}
void glEnable(GLenum cap) {}
void glFinish(void) {}
void glFrontFace(GLenum mode) {}
void glGenTextures(GLsizei n, GLuint *textures) {}
GLenum glGetError(void) { return 0; }
void glGetFloatv(GLenum pname, GLfloat *params) {}
void glGetIntegerv(GLenum pname, GLint *params) {}
const GLubyte* glGetString(GLenum name) { return (const GLubyte*)""; }
void glLineWidth(GLfloat width) {}
void glPixelStorei(GLenum pname, GLint param) {}
void glPolygonMode(GLenum face, GLenum mode) {}
void glPolygonOffset(GLfloat factor, GLfloat units) {}
void glReadBuffer(GLenum mode) {}
void glReadPixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, GLvoid *pixels) {}
void glScissor(GLint x, GLint y, GLsizei width, GLsizei height) {}
void glStencilFunc(GLenum func, GLint ref, GLuint mask) {}
void glStencilMask(GLuint mask) {}
void glStencilOp(GLenum fail, GLenum zfail, GLenum zpass) {}
void glTexParameteri(GLenum target, GLenum pname, GLint param) {}
void glTexSubImage2D(GLenum target, GLint level, GLint xoffset, GLint yoffset, GLsizei width, GLsizei height, GLenum format, GLenum type, const GLvoid *pixels) {}
void glViewport(GLint x, GLint y, GLsizei width, GLsizei height) {}
`;

/** Name of the stub OpenGL library */
const GL_STUB_LIB_NAME = "libGL_stub.dylib";

/**
 * Create a stub OpenGL library for macOS
 *
 * This allows mupen64plus to link without the real OpenGL framework,
 * avoiding the library loading hang on macOS.
 *
 * @param outputDir Directory to create the stub library in
 * @returns Path to the created stub library
 */
const createGLStubLibrary = (outputDir: string): string => {
  const stubSourcePath = join(outputDir, "gl_stubs.c");
  const stubLibPath = join(outputDir, GL_STUB_LIB_NAME);

  // Write stub source
  writeFileSync(stubSourcePath, GL_STUB_SOURCE, "utf-8");

  // Compile stub library
  execSync(
    `clang -dynamiclib -o "${stubLibPath}" "${stubSourcePath}" -install_name @rpath/${GL_STUB_LIB_NAME}`,
    { cwd: outputDir }
  );

  logger.info(`Created stub OpenGL library: ${stubLibPath}`, "CoreBuilder");

  return stubLibPath;
};

/**
 * Fix library paths in the built core to use the stub library
 *
 * @param corePath Path to the built core dylib
 * @param coresDir Directory where the stub library is installed
 */
const fixLibraryPaths = (corePath: string, coresDir: string): void => {
  const stubLibPath = join(coresDir, GL_STUB_LIB_NAME);

  // Change the @rpath reference to an absolute path
  execSync(
    `install_name_tool -change "@rpath/${GL_STUB_LIB_NAME}" "${stubLibPath}" "${corePath}"`,
    { stdio: "pipe" }
  );

  logger.info(`Fixed library paths in ${corePath}`, "CoreBuilder");
};

/**
 * Apply source patches needed for modern macOS compatibility
 *
 * The bundled libpng and libzlib have outdated macOS compatibility checks
 * that assume Classic Mac OS (pre-OS X) rather than modern macOS.
 *
 * Issues fixed:
 * 1. libpng's pngpriv.h includes <fp.h> which was removed in modern macOS SDKs
 * 2. libzlib's zutil.h defines fdopen() as NULL for TARGET_OS_MAC, but modern
 *    macOS has fdopen() available - this breaks when _stdio.h is included
 */
const applySourcePatches = (repoDir: string): void => {
  // Patch 1: Fix libpng fp.h issue
  const pngPrivPath = join(repoDir, "custom/dependencies/libpng/pngpriv.h");
  if (existsSync(pngPrivPath)) {
    let content = readFileSync(pngPrivPath, "utf-8");
    const fpHPattern = /#\s*include\s*<fp\.h>/g;
    if (fpHPattern.test(content)) {
      content = content.replace(fpHPattern, "#     include <math.h>");
      writeFileSync(pngPrivPath, content, "utf-8");
      logger.info("Patched pngpriv.h: replaced <fp.h> with <math.h>", "CoreBuilder");
    }
  }

  // Patch 2: Fix libzlib fdopen issue
  // The bundled zlib defines fdopen(fd,mode) as NULL for TARGET_OS_MAC,
  // assuming Classic Mac OS. Modern macOS has fdopen(), and the NULL macro
  // breaks when _stdio.h declares the real fdopen function.
  //
  // Fix: Add a check for __APPLE__ to skip the NULL definition on modern macOS
  const zlibUtilPath = join(repoDir, "custom/dependencies/libzlib/zutil.h");
  if (existsSync(zlibUtilPath)) {
    let content = readFileSync(zlibUtilPath, "utf-8");

    // The problematic code block looks like:
    // #if defined(MACOS) || defined(TARGET_OS_MAC)
    // ...
    //     #ifndef fdopen
    //       #define fdopen(fd,mode) NULL /* No fdopen() */
    //     #endif
    //
    // We need to exclude modern macOS (__APPLE__) from this condition
    const oldCondition = "#if defined(MACOS) || defined(TARGET_OS_MAC)";
    const newCondition = "#if (defined(MACOS) || defined(TARGET_OS_MAC)) && !defined(__APPLE__)";

    if (content.includes(oldCondition)) {
      content = content.replace(oldCondition, newCondition);
      writeFileSync(zlibUtilPath, content, "utf-8");
      logger.info("Patched zutil.h: excluded modern macOS from fdopen NULL definition", "CoreBuilder");
    }
  }
};

/**
 * Check if a core requires building from source on the current platform
 */
export const requiresBuildFromSource = (coreName: string): boolean => {
  // Only ARM macOS requires building certain cores
  if (platform() !== "darwin" || arch() !== "arm64") {
    return false;
  }

  return coreName in BUILD_CONFIGS;
};

/**
 * Get description of why a core needs to be built
 */
export const getBuildReason = (coreName: string): string | null => {
  if (!requiresBuildFromSource(coreName)) {
    return null;
  }

  if (coreName === "mupen64plus_next") {
    return "The pre-built N64 core for ARM Mac requires OpenGL. Building from source with Angrylion software renderer enabled.";
  }

  return "Pre-built binary not available for ARM Mac.";
};

/**
 * Check if required build tools are available
 */
export const checkBuildPrerequisites = (): { ok: boolean; missing: string[] } => {
  const required = ["git", "make", "clang"];
  const missing: string[] = [];

  for (const tool of required) {
    try {
      execSync(`which ${tool}`, { stdio: "pipe" });
    } catch {
      missing.push(tool);
    }
  }

  return { ok: missing.length === 0, missing };
};

/**
 * Get the number of CPU cores for parallel builds
 */
const getCpuCount = (): number => {
  try {
    const result = execSync("sysctl -n hw.ncpu", { encoding: "utf-8" });
    return parseInt(result.trim(), 10) || DEFAULT_CPU_COUNT;
  } catch {
    return DEFAULT_CPU_COUNT;
  }
};

/**
 * Patterns that indicate a compilation step in make output
 * These are common patterns from C/C++ builds
 */
const COMPILATION_PATTERNS = [
  /^\s*(CC|CXX|COMPILE|Compiling)\s/i,        // GCC/Clang style
  /^\s*\[\s*\d+%\s*\]\s*(Building|Compiling)/i,  // CMake style
  /^(cc|c\+\+|gcc|g\+\+|clang|clang\+\+)\s/i,    // Direct compiler invocation
];

/**
 * Check if a line represents a compilation step
 */
const isCompilationLine = (line: string): boolean => {
  return COMPILATION_PATTERNS.some(pattern => pattern.test(line));
};

/**
 * Count the number of compilation targets in a make dry run output
 */
const countCompilationTargets = (output: string): number => {
  const lines = output.split("\n");
  let count = 0;
  for (const line of lines) {
    if (isCompilationLine(line)) {
      count++;
    }
  }
  return count;
};

/**
 * Get the total number of compilation steps by doing a make dry run
 */
const getMakeTargetCount = (cwd: string, makeArgs: string[]): number | null => {
  try {
    // -n does a dry run (prints commands without executing)
    const result = execSync(`make -n ${makeArgs.join(" ")}`, {
      cwd,
      encoding: "utf-8",
      maxBuffer: MAKE_DRY_RUN_BUFFER_SIZE,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const count = countCompilationTargets(result);
    logger.info(`Counted ${count} compilation targets from make dry run`, "CoreBuilder");
    return count > 0 ? count : null;
  } catch {
    // Dry run failed, continue without progress tracking
    logger.warn("Make dry run failed, build progress will not be tracked", "CoreBuilder");
    return null;
  }
};

/**
 * Build a core from source
 *
 * @param coreName Name of the core to build
 * @param onProgress Optional callback for progress updates
 * @returns Path to the installed core file
 */
export const buildCore = async (
  coreName: string,
  onProgress?: (progress: BuildProgress) => void
): Promise<string> => {
  const config = BUILD_CONFIGS[coreName];
  if (!config) {
    throw new CoreBuildError('NO_BUILD_CONFIG', coreName);
  }

  // Check prerequisites
  const prereqs = checkBuildPrerequisites();
  if (!prereqs.ok) {
    throw new CoreBuildError('MISSING_TOOLS', prereqs.missing.join(', '));
  }

  const coresDir = getCoresDirectory();
  const destPath = join(coresDir, config.installedFile);

  // Check if already exists
  if (existsSync(destPath)) {
    onProgress?.({ phase: "complete", message: "Core already installed" });
    return destPath;
  }

  ensureDirectory(coresDir);

  // Create temp directory for build
  const buildDir = join(tmpdir(), `emoemu-build-${coreName}-${Date.now()}`);
  ensureDirectory(buildDir);

  const repoDir = join(buildDir, coreName);

  try {
    // Clone repository at specific commit for reproducible builds
    onProgress?.({
      phase: "cloning",
      message: `Cloning ${config.repo} at ${config.commit.slice(0, SHORT_COMMIT_HASH_LENGTH)}...`,
    });

    logger.info(`Cloning ${config.repo} at commit ${config.commit} to ${repoDir}`, "CoreBuilder");

    // Use git init + fetch + checkout to get only the specific commit
    // This is more efficient than cloning everything and ensures reproducibility
    ensureDirectory(repoDir);

    await runCommand("git", ["init"], {
      cwd: repoDir,
      onProgress,
      phase: "cloning",
    });

    await runCommand("git", ["remote", "add", "origin", config.repo], {
      cwd: repoDir,
      onProgress,
      phase: "cloning",
    });

    await runCommand("git", ["fetch", "--depth", "1", "origin", config.commit], {
      cwd: repoDir,
      onProgress,
      phase: "cloning",
    });

    await runCommand("git", ["checkout", "FETCH_HEAD"], {
      cwd: repoDir,
      onProgress,
      phase: "cloning",
    });

    // Apply source patches for macOS compatibility
    applySourcePatches(repoDir);

    // Create stub OpenGL library for mupen64plus (avoids macOS OpenGL loading hang)
    let stubLibPath: string | null = null;
    if (coreName === "mupen64plus_next") {
      onProgress?.({
        phase: "building",
        message: "Creating stub OpenGL library...",
      });
      stubLibPath = createGLStubLibrary(buildDir);
    }

    // Build
    onProgress?.({
      phase: "building",
      message: `Building ${config.description}...`,
    });

    const cpuCount = getCpuCount();
    const baseArgs = ["-j" + cpuCount, ...config.buildArgs];

    // Add stub library to link args for mupen64plus
    const makeArgs = (stubLibPath && coreName === "mupen64plus_next")
      ? [...baseArgs, `GL_LIB=-L${buildDir} -lGL_stub`]
      : baseArgs;

    logger.info(`Building with: make ${makeArgs.join(" ")}`, "CoreBuilder");

    // Count compilation targets for progress tracking
    onProgress?.({
      phase: "building",
      message: "Analyzing build targets...",
    });
    const totalTargets = getMakeTargetCount(repoDir, makeArgs);

    await runCommand("make", makeArgs, {
      cwd: repoDir,
      onProgress,
      phase: "building",
      totalTargets,
    });

    // Install
    onProgress?.({
      phase: "installing",
      message: "Installing core...",
    });

    const builtPath = join(repoDir, config.outputFile);
    if (!existsSync(builtPath)) {
      throw new CoreBuildError('OUTPUT_NOT_FOUND', builtPath);
    }

    // Copy stub library first (needed before fixing library paths)
    if (stubLibPath && coreName === "mupen64plus_next") {
      const stubDestPath = join(coresDir, GL_STUB_LIB_NAME);
      copyFileSync(stubLibPath, stubDestPath);
      execSync(`chmod 755 "${stubDestPath}"`);
      logger.info(`Installed stub OpenGL library to ${stubDestPath}`, "CoreBuilder");
    }

    // Copy the core
    copyFileSync(builtPath, destPath);

    // Make executable
    execSync(`chmod 755 "${destPath}"`);

    // Fix library paths for mupen64plus to use absolute path to stub library
    if (coreName === "mupen64plus_next") {
      fixLibraryPaths(destPath, coresDir);
    }

    logger.info(`Installed ${coreName} to ${destPath}`, "CoreBuilder");

    onProgress?.({
      phase: "complete",
      message: "Build complete!",
    });

    return destPath;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error(`Failed to build ${coreName}: ${errorMessage}`, "CoreBuilder");

    onProgress?.({
      phase: "error",
      message: `Build failed: ${errorMessage}`,
    });

    throw error;
  } finally {
    // Clean up build directory
    try {
      rmSync(buildDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
};

/** Percentage multiplier for progress calculations */
const PERCENT_MULTIPLIER = 100;

/**
 * Run a command with progress reporting
 */
const runCommand = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    onProgress?: (progress: BuildProgress) => void;
    phase: BuildPhase;
    /** Total number of compilation targets for progress tracking */
    totalTargets?: number | null;
  }
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const outputLines: string[] = [];
    const MAX_OUTPUT_LINES = 50;
    let compiledCount = 0;

    const handleOutput = (data: Buffer): void => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        outputLines.push(line);
        if (outputLines.length > MAX_OUTPUT_LINES) {
          outputLines.shift();
        }

        // Track compilation progress
        if (options.totalTargets && isCompilationLine(line)) {
          compiledCount++;
        }
      }

      // Report last line as progress
      const lastLine = lines[lines.length - 1];
      if (lastLine && options.onProgress) {
        const progress: BuildProgress = {
          phase: options.phase,
          message: lastLine,
          output: outputLines,
        };

        // Add progress percentage if we're tracking compilation
        if (options.totalTargets && compiledCount > 0) {
          progress.progressPercent = Math.min(
            Math.round((compiledCount / options.totalTargets) * PERCENT_MULTIPLIER),
            PERCENT_MULTIPLIER
          );
          progress.progressText = `${compiledCount} of ${options.totalTargets} files`;
        }

        options.onProgress(progress);
      }
    };

    proc.stdout.on("data", handleOutput);
    proc.stderr.on("data", handleOutput);

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errorOutput = outputLines.slice(-ERROR_OUTPUT_LINES).join("\n");
        reject(new Error(`${command} exited with code ${code}\n${errorOutput}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start ${command}: ${err.message}`));
    });
  });
};

/**
 * Get list of cores that can be built from source
 */
export const getBuildableCores = (): Array<{ name: string; description: string }> => {
  if (platform() !== "darwin" || arch() !== "arm64") {
    return [];
  }

  return Object.entries(BUILD_CONFIGS)
    .filter((entry): entry is [string, CoreBuildConfig] => entry[1] !== undefined)
    .map(([name, config]) => ({
      name,
      description: config.description,
    }));
};

export * from "./types";
