import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "tchat");
const MODELS_CACHE_PATH = join(CACHE_DIR, "models.json");
const MODELS_URL = "https://raw.githubusercontent.com/varo6/tchat-cli/main/docs/models.md";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type Model = { name: string; id: string };
type ModelsCache = { models: Model[]; lastFetch: number; hash: string };

// Simple hash for comparing model lists (fast, no crypto needed)
function quickHash(models: Model[]): string {
  if (models.length === 0) return "empty";
  const first = models[0].id;
  const last = models[models.length - 1].id;
  return `${models.length}:${first}:${last}`;
}

function parseModelsMarkdown(content: string): Model[] {
  const models: Model[] = [];
  for (const line of content.split("\n")) {
    // Match: | Name | `model-id` |
    const match = line.match(/^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|$/);
    if (match && match[1] !== ":---") {
      models.push({ name: match[1].trim(), id: match[2] });
    }
  }
  return models;
}

async function loadCache(): Promise<ModelsCache | null> {
  try {
    const file = Bun.file(MODELS_CACHE_PATH);
    if (await file.exists()) {
      return JSON.parse(await file.text());
    }
  } catch {}
  return null;
}

async function saveCache(models: Model[]): Promise<void> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const cache: ModelsCache = {
      models,
      lastFetch: Date.now(),
      hash: quickHash(models),
    };
    await Bun.write(MODELS_CACHE_PATH, JSON.stringify(cache));
  } catch {}
}

// Background fetch: only updates cache if models changed
async function fetchAndUpdateCache(): Promise<void> {
  try {
    const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const content = await res.text();
    const models = parseModelsMarkdown(content);
    if (models.length === 0) return;

    const cache = await loadCache();
    const newHash = quickHash(models);

    // Only write if different or no cache exists
    if (!cache || cache.hash !== newHash) {
      await saveCache(models);
    } else {
      // Same content, just update timestamp
      cache.lastFetch = Date.now();
      await Bun.write(MODELS_CACHE_PATH, JSON.stringify(cache));
    }
  } catch {}
}

// Spawn background process to fetch models
function triggerBackgroundFetch(): void {
  spawn(process.execPath, [process.argv[1], "--internal-fetch-models"], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

// Load models: instant from cache, trigger background refresh if stale
export async function loadModels(): Promise<Model[]> {
  const cache = await loadCache();

  // Trigger background fetch if stale or no cache
  if (!cache || Date.now() - cache.lastFetch > CHECK_INTERVAL_MS) {
    triggerBackgroundFetch();
  }

  // Return cached models immediately (or empty if first run)
  if (cache && cache.models.length > 0) {
    return cache.models;
  }

  // First run: must fetch synchronously
  try {
    const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const content = await res.text();
      const models = parseModelsMarkdown(content);
      if (models.length > 0) {
        await saveCache(models);
        return models;
      }
    }
  } catch {}

  return [];
}

// Called by --internal-fetch-models
export async function performModelsFetch(): Promise<void> {
  await fetchAndUpdateCache();
}
