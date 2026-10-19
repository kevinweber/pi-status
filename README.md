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

The extension tracks two independent axes per tab:

- **activity** (`working` / `resting`) — set by agent and compaction events
- **promptOpen** (`true` / `false`) — set by `ui_prompt_start` / `ui_prompt_end`

Displayed state is always `promptOpen ? "needs-you" : activity`.

| State | Symbol | When |
| --- | --- | --- |
| working | ⏳ | `activity=working` and no prompt open |
| needs-you | ❗ | prompt open (regardless of activity) |
| resting | ✓ | `activity=resting` and no prompt open |

### Compaction activity mapping

All compaction events set `activity`; the displayed state is then derived from `promptOpen ? "needs-you" : activity`.

| Event | Condition | activity |
| --- | --- | --- |
| `session_before_compact` | — | working |
| `session_compact` / `session_compact_failed` | `reason=manual`, `willRetry=false` | resting |
| `session_compact` / `session_compact_failed` | otherwise | working |

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
