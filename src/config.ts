import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const CONFIG_PATH = join(homedir(), ".config", "tchat", "config.json");
const OMARCHY_CMD = "omarchy-launch-webapp";

const OPTIONS = [
  { label: "t3.chat", baseUrl: "https://t3.chat/new" },
  { label: "ChatGPT", baseUrl: "https://chatgpt.com/" },
  { label: "Claude", baseUrl: "https://claude.ai/new" },
];

type State = { provider: number; omarchy: boolean };

async function loadState(): Promise<State> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      const config = JSON.parse(await file.text());
      const idx = OPTIONS.findIndex((o) => o.baseUrl === config.baseUrl);
      return {
        provider: idx !== -1 ? idx : 0,
        omarchy: config.openCmd === OMARCHY_CMD,
      };
    }
  } catch {}
  return { provider: 0, omarchy: false };
}

async function saveConfig(state: State): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) config = JSON.parse(await file.text());
  } catch {}
  config.baseUrl = OPTIONS[state.provider].baseUrl;
  if (state.omarchy) {
    config.openCmd = OMARCHY_CMD;
  } else if (config.openCmd === OMARCHY_CMD) {
    delete config.openCmd;
  }
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function render(cursor: number, omarchy: boolean): void {
  console.clear();
  console.log("Select default chat provider:\n");
  OPTIONS.forEach((opt, i) => {
    const dot = cursor === i ? "\x1b[36m●\x1b[0m" : "○";
    const arrow = cursor === i ? "\x1b[36m>\x1b[0m " : "  ";
    console.log(`${arrow}${dot} ${opt.label}`);
  });
  console.log("");
  const check = omarchy ? "\x1b[36m[x]\x1b[0m" : "[ ]";
  const arrow = cursor === OPTIONS.length ? "\x1b[36m>\x1b[0m " : "  ";
  console.log(`${arrow}${check} Omarchy webapp`);
  console.log("\n\x1b[90m↑/↓ move, Space select, Enter confirm, q cancel\x1b[0m");
}

export async function runConfigMenu(): Promise<void> {
  const state = await loadState();
  let cursor = state.provider;
  let omarchy = state.omarchy;
  const totalItems = OPTIONS.length + 1;
  render(cursor, omarchy);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  for await (const chunk of process.stdin) {
    const key = chunk.toString();
    if (key === "\x03" || key === "q") {
      process.stdin.setRawMode(false);
      console.clear();
      console.log("Cancelled.");
      return;
    }
    if (key === "\r" || key === "\n") {
      const provider = cursor < OPTIONS.length ? cursor : state.provider;
      process.stdin.setRawMode(false);
      await saveConfig({ provider, omarchy });
      console.clear();
      const omarchyStatus = omarchy ? " (Omarchy webapp)" : "";
      console.log(`Set to: ${OPTIONS[provider].label}${omarchyStatus}`);
      console.log(`Saved to: ${CONFIG_PATH}`);
      return;
    }
    if (key === "\x1b[A" || key === "k") cursor = (cursor - 1 + totalItems) % totalItems;
    if (key === "\x1b[B" || key === "j") cursor = (cursor + 1) % totalItems;
    if (key === " " && cursor === OPTIONS.length) {
      omarchy = !omarchy;
    }
    render(cursor, omarchy);
  }
}
