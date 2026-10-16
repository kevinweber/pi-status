# @kevinweber/pi-status

Pi terminal tab titles with session names and working, waiting-for-input, and idle indicators. Updates come from Pi events and make no LLM calls.

```text
⏳ my-tab   working
❗ my-tab   waiting for input
✓ my-tab    idle
```

## Install

```text
pi install npm:@kevinweber/pi-status
```

## Behavior

The title uses the format `<state> <name>`.

| State | Symbol | Trigger event |
| --- | --- | --- |
| working | ⏳ | `agent_start` |
| needs-you | ❗ | `ui_prompt_start` |
| resting | ✓ | `agent_settled` |

## Naming

Set a session name with:

```text
/name my-tab
```

The session name remains in the title across state changes. Without a session name, the title uses the project directory name.

## Compatibility

Tested with VS Code's integrated terminal. Other terminals work when they honor Pi title updates. The extension is shell-independent and does not require zsh configuration.

## Configuration

Set `PI_STATUS_TITLE_CWD` to `0`, `false`, `no`, or `off` to hide the project directory when no session name is set. The default is to show it.

Each Pi session keeps its own state.

## Development

```bash
npm install
npm run ci
npm pack --dry-run
```

`npm run ci` runs the syntax check, type check, and test suite. Use `npm pack --dry-run` to inspect the package contents before publication.

Repository: <https://github.com/kevinweber/pi-status>

## Publishing

`npm publish` runs the test suite automatically before uploading.

```bash
npm login
npm publish --access public
```

## License

MIT © Kevin Weber
