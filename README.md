# tchat-cli

Open t3.chat with a prefilled prompt from the CLI.

## Install

```bash
bun i -g @varo6/tchat-cli
```

## Usage

```bash
tchat "hi! how are you"
echo "context from stdin" | tchat --stdin "extra prompt"
tchat -f README.md -f tchat.ts "review these files"
tchat --print "only output the URL"
```

## Options

```text
-m, --model <model>     Model id (env: TCHAT_MODEL)
-f, --file <path>       Read content from file(s), can be used multiple times
--base <url>            Base URL (env: TCHAT_BASE_URL)
--open-cmd <cmd>        Override opener command (env: TCHAT_OPEN_CMD)
--print                 Print the URL instead of opening
--stdin                 Read stdin even if TTY
--no-stdin              Ignore stdin
-h, --help              Show help
```

## Config

Config file: `~/.config/tchat/config.json`

```json
{
  "model": "model-id",
  "baseUrl": "https://t3.chat/new",
  "openCmd": "firefox"
}
```

Priority: CLI flags > env vars > config file > defaults.

## Build (optional)

The published package uses a bundled/minified build for faster cold starts.

```bash
bun run build
```
