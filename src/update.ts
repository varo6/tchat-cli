import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// XDG Base Directory: update info is cached/non-essential data
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "tchat");
const UPDATE_PATH = join(CACHE_DIR, "update.json");
const CURRENT_VERSION = "0.1.2";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@varo6/tchat-cli/latest";
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

type UpdateInfo = { lastCheck: number; latestVersion: string };

// Compare semver versions: returns true if a > b
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

async function loadUpdateInfo(): Promise<UpdateInfo | null> {
  try {
    const file = Bun.file(UPDATE_PATH);
    if (!(await file.exists())) return null;
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function saveUpdateInfo(info: UpdateInfo): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  await Bun.write(UPDATE_PATH, JSON.stringify(info));
}

// Display update banner if newer version available (sync check of local file)
export async function showUpdateBanner(): Promise<void> {
  const info = await loadUpdateInfo();
  if (info && isNewer(info.latestVersion, CURRENT_VERSION)) {
    console.error(
      `\x1b[33mUpdate available: ${CURRENT_VERSION} -> ${info.latestVersion}\x1b[0m\n` +
        `Run \x1b[36mbun add -g @varo6/tchat-cli\x1b[0m to update.\n`
    );
  }
}

// Spawn background worker if check is stale
export async function triggerBackgroundCheck(): Promise<void> {
  const info = await loadUpdateInfo();
  const lastCheck = info?.lastCheck ?? 0;
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;

  spawn(process.execPath, [process.argv[1], "--internal-check-update"], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

// Background worker: fetch latest version and save
export async function performUpdateCheck(): Promise<void> {
  try {
    const res = await fetch(NPM_REGISTRY_URL);
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (typeof data.version === "string") {
      await saveUpdateInfo({ lastCheck: Date.now(), latestVersion: data.version });
    }
  } catch {
    // Fail silently in background
  }
}
