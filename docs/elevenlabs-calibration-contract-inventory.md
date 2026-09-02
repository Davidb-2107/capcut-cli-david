# ElevenLabs Calibration Contract Inventory

**Captured:** 2026-09-02
**Gate status:** passed for the MVP bridge, with the constraints below

This document is the provider-specific source for Tasks 2–7. It records what
was observed in the shared Python package; it is not a second calibration
contract.

## Evidence and source revision

| Evidence | Observed value |
|---|---|
| Source checkout | `Shared/voice-calibration/` in the `Wiki_Claude` vault |
| Source revision | `2eedac32fd3f4275e58ca8510d0d49be0b589f96` |
| Package | `voice-calibration` version `0.1.0`, Python `>=3.11` |
| Authoritative README | `Shared/voice-calibration/README.md`, read with the enabled Obsidian CLI |
| Contract models | `Shared/voice-calibration/core/contracts.py` |
| Orchestration | `Shared/voice-calibration/core/calibration.py` |
| MCP adapter | `Shared/voice-calibration/mcp_server/server.py` |
| WPM authority | `Shared/voice-calibration/voice_wpm.py` and `voice_wpm.json` |
| Environment convention | `Shared/voice-calibration/calibrate_battery.py` |
| MCP wiring | `Shared/.mcp.json` in the vault; the file is hidden from the Obsidian file index, so its JSON was inspected read-only with all environment values redacted |

The source checkout was clean when its revision was read. The project
worktree does not contain a provider implementation and must not copy one.

The claim-to-source index used for this inventory is:

| Claim area | Evidence location / symbol |
| --- | --- |
| MCP purpose and environment convention | `Shared/voice-calibration/README.md`; `calibrate_battery.py::_load_env_file`, `discover_env` |
| Input and result models | `core/contracts.py`; `VoiceSettingsModel`, `TextSource`, `CalibrationRequest`, `CalibrationResult` |
| Tool shape and error mapping | `mcp_server/server.py`; `calibrate_voice`, `_reason_for`, `_harden_input_schema`, `main` |
| Planning, provider calls and dry-run boundary | `core/calibration.py`; `run_calibration`, `CalibrationDeps` and request/response helpers |
| Model limits and feature support | `core/capabilities.py`; `MODEL_CAPABILITIES` |
| Canonical WPM persistence and verification | `voice_wpm.py`; `WPM_PATH`, `RUNS_LOG_PATH`, `log_run`, `get_profile`, `get_wpm` |
| Stdio framing and process environment | installed `mcp==1.29.0` module `mcp/client/stdio.py`; `stdio_client`, `stdout_reader`, `stdin_writer` |
| End-to-end MCP behavior | `test_mcp_server.py`; entrypoint, schema and tool-call tests |

## Package and MCP entrypoint

`pyproject.toml` declares these runtime dependencies: `pydantic>=2,<3`,
`requests==2.34.2`, `filelock==3.32.0` and `mcp==1.29.0`. The installed console
entrypoint is:

```text
voice-calibration-mcp = mcp_server.server:main
```

The redacted `Shared/.mcp.json` entry is:

```json
{
  "mcpServers": {
    "voice-calibration": {
      "command": "voice-calibration-mcp"
    }
  }
}
```

There are no configured arguments or environment values in that entry. The
local backend must therefore resolve `.env` and pass the child environment
server-side before spawning the command.

## Transport and lifecycle

`mcp_server/server.py` creates `FastMCP("voice-calibration")` and calls
`mcp.run(transport="stdio")`. The existing `test_mcp_server.py` verifies the
installed console entrypoint with `mcp.client.stdio.StdioServerParameters` and
`stdio_client`, from an unrelated current working directory. The bridge must
therefore spawn the installed command, not a path relative to the vault and not
the deprecated CLI adapter.

The selected transport is **MCP JSON-RPC over the child process stdin/stdout
stdio streams**. The exact framing was checked in the installed `mcp==1.29.0`
`mcp/client/stdio.py`: UTF-8 JSON-RPC objects are written one per line with a
trailing `\n`; the reader accumulates chunks, splits on `\n`, and validates each
complete line as a JSON-RPC message. This is SDK-owned framing on the Python
side, but it is the wire contract the Node adapter must reproduce or delegate
to a compatible MCP client.

The bridge must implement the MCP client lifecycle compatible with
`mcp==1.29.0`: resolve the configured `voice-calibration-mcp` command through
the child process PATH, start it, perform the `initialize` handshake and
initialized notification, call the advertised `calibrate_voice` tool with a
flat arguments object, correlate the response by JSON-RPC request id, read the
in-band result, then close stdin and terminate the process if needed. stdout
is protocol data; stderr is diagnostic data and must be captured separately. A
non-zero exit, malformed protocol response or closed stdout is a transport
failure. The Python SDK's safe inherited environment is a baseline; the local
bridge must add the server-side `.env` values explicitly and never put them in
arguments or browser responses.

The source tests verify that schema-invalid tool calls return an in-band
`CallToolResult(isError=True)` under this SDK, rather than a raw JSON-RPC
`-32602` response. A schema-valid domain rejection returns a normal tool result
with a structured error dictionary. The Node bridge must preserve this
distinction in its opaque result envelope.

The source provides no outer wall-clock deadline or cancellation API for
`run_calibration`. The provider calls use a 30-second timeout for voice lookup
and a 60-second timeout for each synthesis request. Task 4 must add a bounded
process/request timeout around the bridge; after a `tools/call` has been sent,
loss of the response is `execution_unknown`, never an automatic retry.

There is no idempotency field in `CalibrationRequest`, no run identifier passed
to `run_calibration`, and no idempotency header in the ElevenLabs POST made by
the core. The provider guarantee is therefore **unknown/not available**. The
application may retain its own run ID and idempotency key for local state and
reconciliation, but it must not claim external idempotency or retry an emitted
request blindly.

## Exact `calibrate_voice` contract

The MCP tool exposes one flat top-level tool, `calibrate_voice`. The server
constructs `CalibrationRequest` explicitly and then calls the single source of
truth, `core.calibration.run_calibration(request)`. The exact input fields are:

| Field | Required by schema | Exact type / values | Defaults and rules |
|---|---:|---|---|
| `voice` | yes | string | Display name, alias, or voice ID-like value |
| `model_id` | yes | `"eleven_v3"` or `"eleven_multilingual_v2"` | No default in `CalibrationRequest`; the legacy CLI supplies `eleven_v3` only outside MCP |
| `voice_settings` | yes | object `VoiceSettingsModel` | Unknown nested keys forbidden |
| `text_source` | yes | object `TextSource` | See discriminated shape below |
| `mode` | yes | `"battery"` or `"precision"` | No default |
| `language` | no | `"fr"` or `"en"` | Defaults to `"fr"` |
| `runs` | no | integer or null | Precision requires 3–10; battery forbids an override |
| `dry_run` | no | boolean | Defaults to `false` |
| `corpus_key` | no | string or null | Defaults to `voice`; this is the `voice_wpm.json` alias, not a local corpus-version ID |
| `voice_id` | no | string or null | If set, skips ElevenLabs name resolution |
| `postproc` | no (optional schema field) | `"cut"` or `"trim"` | `CalibrationRequest` and the MCP function both default it to `"cut"`; the UI always sends the chosen value explicitly |

`voice_settings` has these exact fields: `stability` and `similarity_boost` are
required floats in `[0, 1]`; `style` defaults to `0.0` in `[0, 1]`;
`use_speaker_boost` defaults to `true`; `speed` is optional in `[0.25, 4.0]`.
`speed` is unsupported/no-op for `eleven_v3`, and is supported for
`eleven_multilingual_v2` only in the live-probed range `[0.7, 1.2]`.

`text_source` has `kind` plus optional `path` and `text`:

- `{"kind":"default_battery"}` is valid only with `mode="battery"`;
- `{"kind":"episode_file","path":"..."}` is valid only with precision;
- `{"kind":"inline","text":"..."}` is valid only with precision.

`runs` defaults to `null` at the Pydantic model boundary. That default is not a
usable precision request: the precision validator requires an explicit integer
from 3 through 10. Battery mode uses the fixed reference battery and rejects a
non-null override. The `text_source` validator forbids unknown fields and
enforces the kind-specific path/text combinations listed above.

The target model limits are 5,000 characters per request for `eleven_v3` and
10,000 for `eleven_multilingual_v2`. Bracket tags are supported by v3 and
rejected for multilingual v2; SSML `<break>` is supported by multilingual v2
and rejected for v3.

The MCP tool advertises a flat schema with `additionalProperties: false`.
Unknown top-level fields and invalid enum values are rejected before the
function body and surface as `isError=true`. Domain and validation failures
inside the adapter map as follows:

| Failure | Returned shape |
|---|---|
| `UnsupportedInputFeatureError` | `{ "status":"error", "reason":"unsupported_input_feature", "details":"..." }` |
| `ProfileMismatchDomainError` | `{ "status":"error", "reason":"profile_mismatch", "details":"..." }` |
| `QuotaDomainError` | `{ "status":"error", "reason":"quota_exceeded", "details":"..." }` |
| other `CalibrationDomainError` | `{ "status":"error", "reason":"domain_error", "details":"..." }` |
| Pydantic `ValidationError` | `{ "status":"error", "reason":"invalid_request", "details":"..." }` |
| core/runtime/provider failure | `CalibrationResult` with `status="error"` or `"partial"` and an `error` string |

A credential-free precision dry-run request accepted by the actual MCP schema
has this shape:

```json
{
  "voice": "Alice",
  "model_id": "eleven_v3",
  "voice_settings": {
    "stability": 0.3,
    "similarity_boost": 0.85,
    "style": 0.3,
    "use_speaker_boost": true
  },
  "text_source": {
    "kind": "inline",
    "text": "Bonjour le monde.\n\nCeci est le corpus standard."
  },
  "mode": "precision",
  "language": "fr",
  "runs": 3,
  "dry_run": true,
  "corpus_key": "Alice",
  "voice_id": null,
  "postproc": "cut"
}
```

The UI must generate the inline text from the active corpus mapping above; the
literal text here is only a contract fixture. `voice_id` may be omitted when
the display name should be resolved by the core.

## Standard corpus mapping for this MVP

The provider contract has no `corpus_version_id` field and no list-valued text
source. `corpus_key` is a voice WPM alias. These must not be conflated:

- local `CorpusVersion.id` is retained in the application snapshot and request
  fingerprint only;
- `params.corpus_key` defaults to the selected `voiceRef` (or an explicit WPM
  alias), and is the key under which Python `voice_wpm` stores results;
- all ordered items of the active local corpus are serialized by the backend
  into one `text_source` value:
  `{"kind":"inline","text":"<item 1>\n\n<item 2>\n\n..."}`;
- `items[].order` is authoritative, and the exact serialized text is part of
  the resolved request snapshot/digest;
- no splitting into multiple provider requests is added to the MVP. If the
  serialized standard corpus exceeds the selected model’s character limit,
  the core rejects it during dry-run and the UI must ask for a smaller/new
  corpus version.

This is an application-to-contract mapping, not frontend business logic. It
allows one precision calibration to send the complete standard corpus to
ElevenLabs repeatedly, as required by `runs`, while keeping the core’s own
word-counting and WPM logic authoritative.

## Dry-run and real-run semantics

`run_calibration` executes this order before a billable call: request
validation, text-source loading, feature/character checks, local WPM profile
resolution, plan construction and cost estimation. With `dry_run=true` it
returns immediately; it does not resolve an unknown voice through the
ElevenLabs API, synthesize, write audio, or write the WPM corpus.

For precision mode, the standard corpus mapping above creates one plan item per
requested run. The result is `CalibrationResult` with:

```json
{
  "status": "dry_run_success",
  "warnings": [],
  "corpus_updated": false,
  "requests_planned": 3,
  "billable_characters": 1234,
  "estimated_credits": 617.0,
  "estimated_cost_usd": 0.0617,
  "cost_basis": "...",
  "voice_resolution": "corpus"
}
```

The numeric values above are shape examples, not constants. The core computes
`billable_characters` as the sum of text lengths, applies a verified 0.5
credit/character estimate for both supported models, and uses
`0.0001 USD/credit` for the rough estimate. `actual_credits_used` and
`actual_cost_usd` are real-run fields only; actual credits come from the
`character-cost` header, with `x-character-cost` as fallback. Missing cost
headers or missing `ELEVENLABS_USD_PER_CREDIT` degrade cost reporting to
unknown, not to a guessed value.

For a real run, an unresolved display name is looked up with the ElevenLabs
voices endpoint (30-second timeout). Each plan item is synthesized with a
60-second provider timeout, written under
`Shared/voice-calibration/battery_cache/<corpus_key>/`, measured, post-processed
and logged through `voice_wpm.log_run`. The result can be `ok`, `partial` or
`error`. A partial result may already have updated the canonical corpus.

Precision results include `precision_stats` when clean entries exist:
`n`, `median`, `min`, `max`, `stddev` and `spread_pct`. This is the source WPM
measurement for the local report; the UI does not recalculate it.

The result envelope contains no artifact list. The known core side effect is
the cache MP3 path above, but the bridge must not invent an artifact field in
the MCP response. The application may record only artifact references it can
derive from an explicit bridge contract; otherwise `artifacts` remains empty.

## Canonical WPM authority and `canonicalRef`

The core imports `Shared/voice-calibration/voice_wpm.py` and uses the sibling
files:

```text
WPM_PATH       = Shared/voice-calibration/voice_wpm.json
RUNS_LOG_PATH  = Shared/voice-calibration/runs.jsonl
```

`voice_wpm.json` is the source of truth. `runs.jsonl` is append-only audit
history and is not the value consumed by duration gates. `voice_wpm.get_profile`
and `assert_profile` operate on the `(corpus_key, language)` bucket and compare
`voice_id`, `model_id` and `voice_settings`; a first profile is stored and a
later mismatch raises `ProfileMismatchError`.

`run_calibration` calls `voice_wpm.log_run` after each successful synthesis,
under file locks. `log_run` appends the observed run, writes `voice_wpm.json`,
and auto-recomputes the aggregate WPM only from the `postproc="cut"` pool once
at least three clean samples exist. For French this is the top-level
`<corpus_key>.wpm_calibrated`; for English it is
`<corpus_key>.wpm_calibrated_by_lang["en"]`. A `trim` or `raw` sample is logged
but never moves the cut-calibrated aggregate.

Therefore the canonical reference for the standard MVP path is:

```text
Shared/voice-calibration/voice_wpm.json#<corpus_key>.wpm_calibrated
```

for the default French path, or the language-specific
`wpm_calibrated_by_lang` entry for English. `CanonicalProfilePort` must first
verify that this record is present and agrees with `precision_stats`; it must
not create a competing Node WPM file. A calibration using `postproc="trim"`
can publish a local historical projection only if the canonical port can
verify an appropriate filtered `get_wpm(..., postproc="trim")` result. If the
requested mode has no verifiable canonical record, profile publication fails
closed.

No separate explicit “publish WPM” operation is exposed by
`run_calibration`; its supported write path is `voice_wpm.log_run` and its
verification/read paths are `voice_wpm.get_profile` and `voice_wpm.get_wpm`.
`calibrate_seed` exists as a bootstrap operation but is not used by this MVP,
because calling it would bypass the measured `run_calibration` workflow.

## Environment and secrets

The core reads `ELEVENLABS_API_KEY` from `os.environ`; the MCP adapter itself
does not load `.env`. The existing CLI adapter’s convention is:

1. explicit `--env-file` when supplied;
2. an already-set `ELEVENLABS_API_KEY`;
3. central `Wiki_Claude/Projects/.env`;
4. `Projects/*/.env` and `Projects/*/elevenlabs-mcp-server/.env` in sorted order.

Its loader accepts simple `KEY=VALUE` lines, ignores blanks/comments and uses
`os.environ.setdefault`. The local UI backend owns this loading/resolution and
passes the resulting environment only to the child process. It never sends
the key to the browser, stores it in a request snapshot, or writes it to logs,
reports, artifacts or error strings.

## Consequences for Task 4

The bridge must:

- spawn `voice-calibration-mcp` with the resolved server-side environment;
- use MCP stdio client framing and the flat `calibrate_voice` arguments;
- pass the exact resolved fields above, with explicit `postproc`;
- preserve the raw result envelope without adding provider fields;
- classify pre-emission failures as ordinary failures and post-emission lost
  responses as `execution_unknown`;
- never retry automatically because the core/provider exposes no idempotency;
- verify the Python `voice_wpm.json` record before `CanonicalProfilePort` allows
  a local `VoiceProfile` projection to be published.

No unresolved transport, schema or canonical WPM question remains for the MVP;
the only intentional limitation is that the provider has no exposed
idempotency guarantee and the standard corpus must fit in one precision text
request.
