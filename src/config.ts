import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const CONFIG_PATH = join(homedir(), ".config", "tchat", "config.json");
const MODELS_PATH = join(dirname(import.meta.dir), "docs", "models.md");
const OMARCHY_CMD = "omarchy-launch-webapp";

const OPTIONS = [
  { label: "t3.chat", baseUrl: "https://t3.chat/new" },
  { label: "ChatGPT", baseUrl: "https://chatgpt.com/" },
  { label: "Claude", baseUrl: "https://claude.ai/new" },
];

type Model = { name: string; id: string };
type State = { provider: number; omarchy: boolean; model?: string };

function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      process.stdin.off("data", onData);
      resolve(chunk.toString());
    };
    process.stdin.on("data", onData);
  });
}

async function loadModels(): Promise<Model[]> {
  try {
    const file = Bun.file(MODELS_PATH);
    if (await file.exists()) {
      const content = await file.text();
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
  } catch {}
  return [];
}

async function loadState(): Promise<State> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      const config = JSON.parse(await file.text());
      const idx = OPTIONS.findIndex((o) => o.baseUrl === config.baseUrl);
      return {
        provider: idx !== -1 ? idx : 0,
        omarchy: config.openCmd === OMARCHY_CMD,
        model: config.model,
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
  if (state.model !== undefined) {
    config.model = state.model;
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

function renderModelChoice(cursor: number): void {
  console.clear();
  console.log("t3.chat model configuration:\n");
  const options = [
    "Use last model from t3.chat (no custom model)",
    "Select a model from the list",
  ];
  options.forEach((opt, i) => {
    const dot = cursor === i ? "\x1b[36m●\x1b[0m" : "○";
    const arrow = cursor === i ? "\x1b[36m>\x1b[0m " : "  ";
    console.log(`${arrow}${dot} ${opt}`);
  });
  console.log("\n\x1b[90m↑/↓ move, Enter confirm, q cancel\x1b[0m");
}

function renderModelSearch(
  filtered: Model[],
  cursor: number,
  search: string,
  scrollOffset: number
): void {
  console.clear();
  console.log("Select a model (type to search):\n");
  console.log(`Search: ${search}\x1b[7m \x1b[0m\n`);

  const maxVisible = Math.min(15, process.stdout.rows - 8);
  const visibleModels = filtered.slice(scrollOffset, scrollOffset + maxVisible);

  if (filtered.length === 0) {
    console.log("\x1b[90mNo models match your search\x1b[0m");
  } else {
    visibleModels.forEach((model, i) => {
      const idx = scrollOffset + i;
      const isSelected = cursor === idx;
      const arrow = isSelected ? "\x1b[36m>\x1b[0m " : "  ";
      const name = isSelected ? `\x1b[36m${model.name}\x1b[0m` : model.name;
      console.log(`${arrow}${name} \x1b[90m(${model.id})\x1b[0m`);
    });
    if (filtered.length > maxVisible) {
      console.log(`\n\x1b[90m... ${filtered.length - maxVisible} more (scroll with ↑/↓)\x1b[0m`);
    }
  }
  console.log("\n\x1b[90m↑/↓ move, Enter confirm, Esc/q cancel, type to filter\x1b[0m");
}

async function runModelChoice(): Promise<"none" | "select" | "cancel"> {
  let cursor = 0;
  renderModelChoice(cursor);

  while (true) {
    const key = await readKey();
    if (key === "\x03" || key === "q" || key === "\x1b") {
      return "cancel";
    }
    if (key === "\r" || key === "\n") {
      return cursor === 0 ? "none" : "select";
    }
    if (key === "\x1b[A" || key === "k") cursor = cursor === 0 ? 1 : 0;
    if (key === "\x1b[B" || key === "j") cursor = cursor === 1 ? 0 : 1;
    renderModelChoice(cursor);
  }
}

async function runModelSearch(models: Model[]): Promise<string | null> {
  let cursor = 0;
  let search = "";
  let filtered = models;
  let scrollOffset = 0;

  const maxVisible = Math.min(15, process.stdout.rows - 8);

  const updateFiltered = () => {
    const s = search.toLowerCase();
    filtered = models.filter(
      (m) => m.name.toLowerCase().includes(s) || m.id.toLowerCase().includes(s)
    );
    cursor = 0;
    scrollOffset = 0;
  };

  const ensureCursorVisible = () => {
    if (cursor < scrollOffset) {
      scrollOffset = cursor;
    } else if (cursor >= scrollOffset + maxVisible) {
      scrollOffset = cursor - maxVisible + 1;
    }
  };

  renderModelSearch(filtered, cursor, search, scrollOffset);

  while (true) {
    const key = await readKey();

    if (key === "\x03" || key === "\x1b") {
      return null;
    }
    if (key === "q" && search === "") {
      return null;
    }
    if (key === "\r" || key === "\n") {
      if (filtered.length > 0) {
        return filtered[cursor].id;
      }
      continue;
    }
    if (key === "\x1b[A" || (key === "k" && search === "")) {
      if (filtered.length > 0) {
        cursor = (cursor - 1 + filtered.length) % filtered.length;
        ensureCursorVisible();
      }
    } else if (key === "\x1b[B" || (key === "j" && search === "")) {
      if (filtered.length > 0) {
        cursor = (cursor + 1) % filtered.length;
        ensureCursorVisible();
      }
    } else if (key === "\x7f" || key === "\b") {
      // Backspace
      if (search.length > 0) {
        search = search.slice(0, -1);
        updateFiltered();
      }
    } else if (key.length === 1 && key >= " " && key <= "~") {
      // Printable character
      search += key;
      updateFiltered();
    }

    renderModelSearch(filtered, cursor, search, scrollOffset);
  }
}

export async function runConfigMenu(): Promise<void> {
  const state = await loadState();
  let cursor = state.provider;
  let omarchy = state.omarchy;
  const totalItems = OPTIONS.length + 1;
  render(cursor, omarchy);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  while (true) {
    const key = await readKey();
    if (key === "\x03" || key === "q") {
      process.stdin.setRawMode(false);
      console.clear();
      console.log("Cancelled.");
      return;
    }
    if (key === "\r" || key === "\n") {
      const provider = cursor < OPTIONS.length ? cursor : state.provider;

      // If t3.chat is selected, ask about model configuration
      if (OPTIONS[provider].baseUrl.includes("t3.chat")) {
        const choice = await runModelChoice();
        if (choice === "cancel") {
          process.stdin.setRawMode(false);
          console.clear();
          console.log("Cancelled.");
          return;
        }

        let selectedModel: string | undefined;
        if (choice === "select") {
          const models = await loadModels();
          if (models.length === 0) {
            console.clear();
            console.log("No models found in docs/models.md");
            process.stdin.setRawMode(false);
            return;
          }
          const model = await runModelSearch(models);
          if (model === null) {
            process.stdin.setRawMode(false);
            console.clear();
            console.log("Cancelled.");
            return;
          }
          selectedModel = model;
        }

        process.stdin.setRawMode(false);
        await saveConfig({ provider, omarchy, model: selectedModel });
        console.clear();
        const omarchyStatus = omarchy ? " (Omarchy webapp)" : "";
        const modelStatus = selectedModel ? ` with model: ${selectedModel}` : "";
        console.log(`Set to: ${OPTIONS[provider].label}${modelStatus}${omarchyStatus}`);
        console.log(`Saved to: ${CONFIG_PATH}`);
        return;
      }

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
