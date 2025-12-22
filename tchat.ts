#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_MODEL = "";
const DEFAULT_BASE_URL = "https://t3.chat/new";
const CONFIG_PATH = join(homedir(), ".config", "tchat", "config.json");
const URL_LENGTH_WARNING_THRESHOLD = 8000;

const HELP = `Usage:
  tchat [options] <query...>
  echo 'content' | tchat [options] [query...]

Options:
  -m, --model <model>     Model id (env: TCHAT_MODEL)
  -f, --file <path>       Read content from file(s), can be used multiple times
  --base <url>            Base URL (env: TCHAT_BASE_URL)
  --open-cmd <cmd>        Override opener command (env: TCHAT_OPEN_CMD)
  --print                 Print the URL instead of opening
  --stdin                 Read stdin even if TTY
  --no-stdin              Ignore stdin
  -h, --help              Show this help

Config file: ~/.config/tchat/config.json
  {
    "model": "model-id",
    "baseUrl": "https://t3.chat/new",
    "openCmd": "firefox"
  }

Priority: CLI flags > env vars > config file > defaults

Notes:
  Use -- to pass a query that starts with '-'.
  With --stdin, end input with Ctrl+D.`;

type StdinMode = "auto" | "force" | "disabled";

type Config = {
  model?: string;
  baseUrl?: string;
  openCmd?: string;
};

type ParsedArgs = {
  baseUrl: string;
  model: string;
  openCmd?: string;
  openMode: "open" | "print";
  queryText: string;
  filePaths: string[];
  showHelp: boolean;
  stdinMode: StdinMode;
  error?: string;
};

// --- Config File Support ---

async function loadConfig(): Promise<Config> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) return {};
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return {};
    return {
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
      openCmd: typeof parsed.openCmd === "string" ? parsed.openCmd : undefined,
    };
  } catch {
    return {};
  }
}

// --- Argument Parsing (DRY refactor) ---

type ArgParseContext = {
  argv: string[];
  index: number;
  queryParts: string[];
  model: string;
  baseUrl: string;
  openCmd?: string;
  openMode: "open" | "print";
  stdinMode: StdinMode;
  filePaths: string[];
};

function createErrorResult(ctx: ArgParseContext, error: string): ParsedArgs {
  return {
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    openCmd: ctx.openCmd,
    openMode: ctx.openMode,
    queryText: "",
    filePaths: ctx.filePaths,
    showHelp: false,
    stdinMode: ctx.stdinMode,
    error,
  };
}

function createHelpResult(ctx: ArgParseContext): ParsedArgs {
  return {
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    openCmd: ctx.openCmd,
    openMode: ctx.openMode,
    queryText: "",
    filePaths: ctx.filePaths,
    showHelp: true,
    stdinMode: ctx.stdinMode,
  };
}

function requireValue(
  ctx: ArgParseContext,
  flag: string
): { value: string; newIndex: number } | { error: ParsedArgs } {
  const value = ctx.argv[ctx.index + 1];
  if (!value) {
    return { error: createErrorResult(ctx, `Missing value for ${flag}.`) };
  }
  return { value, newIndex: ctx.index + 1 };
}

function parseArgs(argv: string[], config: Config): ParsedArgs {
  const ctx: ArgParseContext = {
    argv,
    index: 0,
    queryParts: [],
    model: process.env.TCHAT_MODEL ?? config.model ?? DEFAULT_MODEL,
    baseUrl: process.env.TCHAT_BASE_URL ?? config.baseUrl ?? DEFAULT_BASE_URL,
    openCmd: process.env.TCHAT_OPEN_CMD ?? config.openCmd,
    openMode: "open",
    stdinMode: "auto",
    filePaths: [],
  };

  for (ctx.index = 0; ctx.index < argv.length; ctx.index += 1) {
    const arg = argv[ctx.index];

    if (arg === "--") {
      ctx.queryParts.push(...argv.slice(ctx.index + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      return createHelpResult(ctx);
    }

    if (arg === "-m" || arg === "--model") {
      const result = requireValue(ctx, "--model");
      if ("error" in result) return result.error;
      ctx.model = result.value;
      ctx.index = result.newIndex;
      continue;
    }

    if (arg === "--base") {
      const result = requireValue(ctx, "--base");
      if ("error" in result) return result.error;
      ctx.baseUrl = result.value;
      ctx.index = result.newIndex;
      continue;
    }

    if (arg === "--open-cmd") {
      const result = requireValue(ctx, "--open-cmd");
      if ("error" in result) return result.error;
      ctx.openCmd = result.value;
      ctx.index = result.newIndex;
      continue;
    }

    if (arg === "-f" || arg === "--file") {
      const result = requireValue(ctx, "--file");
      if ("error" in result) return result.error;
      ctx.filePaths.push(result.value);
      ctx.index = result.newIndex;
      continue;
    }

    if (arg === "--print") {
      ctx.openMode = "print";
      continue;
    }

    if (arg === "--stdin") {
      ctx.stdinMode = "force";
      continue;
    }

    if (arg === "--no-stdin") {
      ctx.stdinMode = "disabled";
      continue;
    }

    if (arg.startsWith("-")) {
      return createErrorResult(ctx, `Unknown option: ${arg}`);
    }

    ctx.queryParts.push(arg);
  }

  return {
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    openCmd: ctx.openCmd,
    openMode: ctx.openMode,
    queryText: ctx.queryParts.join(" ").trim(),
    filePaths: ctx.filePaths,
    showHelp: false,
    stdinMode: ctx.stdinMode,
  };
}

// --- File Reading (Bun native) ---

function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastDot > lastSlash + 1) {
    return path.slice(lastDot + 1);
  }
  return "";
}

async function readFiles(paths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const path of paths) {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${path}`);
    }
    const content = await file.text();
    const ext = getFileExtension(path);
    const wrapped = `\`\`\`${ext}\n${content.trimEnd()}\n\`\`\``;
    results.push(wrapped);
  }
  return results;
}

// --- Stdin Reading ---

async function readStdin(mode: StdinMode): Promise<string> {
  if (mode === "disabled") return "";
  if (mode === "auto" && process.stdin.isTTY) return "";

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString().trimEnd();
}

// --- URL Building ---

function buildUrl(baseUrl: string, model: string, query: string): string {
  const url = new URL(baseUrl);
  if (model) {
    url.searchParams.set("model", model);
  }
  url.searchParams.set("q", query);
  return url.toString();
}

// --- URL Opening (with proper error handling) ---

function openUrl(url: string, openCmd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let command = openCmd?.trim() || "xdg-open";
    let args = [url];

    if (!openCmd?.trim()) {
      if (platform === "darwin") {
        command = "open";
      } else if (platform === "win32") {
        command = "cmd";
        args = ["/c", "start", "", url];
      }
    }

    const subprocess = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    let errorHandled = false;

    subprocess.on("error", (error) => {
      errorHandled = true;
      reject(new Error(`Failed to open URL: ${error.message}`));
    });

    subprocess.on("spawn", () => {
      // Give a brief moment for potential immediate errors (e.g., command not found)
      setTimeout(() => {
        if (!errorHandled) {
          subprocess.unref();
          resolve();
        }
      }, 100);
    });
  });
}

// --- Main ---

async function main(): Promise<void> {
  const config = await loadConfig();
  const parsed = parseArgs(process.argv.slice(2), config);

  if (parsed.showHelp) {
    console.log(HELP);
    return;
  }

  if (parsed.error) {
    console.error(parsed.error);
    console.error("");
    console.error(HELP);
    process.exit(1);
  }

  if (
    parsed.openMode === "open" &&
    parsed.openCmd !== undefined &&
    !parsed.openCmd.trim()
  ) {
    console.error("Open command cannot be empty.");
    process.exit(1);
  }

  // Gather all content sources
  const queryParts: string[] = [];

  if (parsed.queryText) {
    queryParts.push(parsed.queryText);
  }

  // Read files using Bun.file API
  if (parsed.filePaths.length > 0) {
    try {
      const fileContents = await readFiles(parsed.filePaths);
      queryParts.push(...fileContents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  }

  // Read stdin
  const piped = await readStdin(parsed.stdinMode);
  if (piped.trim()) {
    queryParts.push(piped);
  }

  const query = queryParts.join("\n\n");
  if (!query) {
    console.error("No query provided.");
    console.error("");
    console.error(HELP);
    process.exit(1);
  }

  let url: string;
  try {
    url = buildUrl(parsed.baseUrl, parsed.model, query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Invalid base URL: ${message}`);
    process.exit(1);
  }

  // URL length warning
  if (url.length > URL_LENGTH_WARNING_THRESHOLD) {
    console.warn(
      `Warning: URL is ${url.length} characters long and may be truncated by the browser.`
    );
  }

  if (parsed.openMode === "print") {
    console.log(url);
    return;
  }

  try {
    await openUrl(url, parsed.openCmd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

void main();
