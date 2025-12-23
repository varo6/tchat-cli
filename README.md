# tchat-cli 🔗

Open t3.chat, chatGPT & more with a prefilled prompt from the CLI with quick file support!

![Demo](https://raw.githubusercontent.com/varo6/tchat-cli/main/assets/demo.webp)

## Install

The package is just 22kb before minify, with no dependencies added 🪶

```bash
bun i -g @varo6/tchat-cli
```


[Bun](https://bun.sh/) is needed as we use their native File I/O api.

## Usage

Although it is recommended, tchat can be used with or without wrapping with `""`.

```bash
tchat "hi! how are you"
tchat -f README.md -f tchat.ts review these files
```

There's also sending context from stdin and print the url without opening the browser

```bash
echo "context from stdin" | tchat --stdin "extra prompt"
tchat --print "only output the URL"
```


tchat works better on linux. Expect some problems in Windows until testing is done.

## Config

Some options can be chosen  with an interactive menu by typing `tchat --config` . Default options are `t3.chat` with last used model as the default. You are free to change either the `model`, `baseUrl` , or browser with `openCmd`

Config file location is: `~/.config/tchat/config.json`

```json
{
  "model": "model-id",
  "baseUrl": "https://t3.chat/new",
  "openCmd": "firefox"
}
```

You can find a list of available model IDs [here](docs/models.md).

baseUrl for chagpt is: https://chatgpt.com/ and it is recommended to set `model` as `""`


## Options

Options that can make your experience better

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



## Build (optional)

The published package uses a bundled/minified build.

```bash
bun run build
```


## About the package

Huge thanks to theo, markr and t3.chat team for developing such a great product. This package is intended to use with quick prompts and small files and not for abusing the chat. The package will be changed or deleted if it breaks any of the terms of service
