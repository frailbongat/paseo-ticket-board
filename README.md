# paseo-ticket-board

A Paseo panel that lists the GitHub tickets an agent can take, works out which skill each one was
written for, and dispatches it into its own worktree workspace. Tap tickets, tap Dispatch.

Each dispatched ticket gets a Paseo worktree workspace on `<number>-<slug>` off `main`, with a pi
agent already holding the right command.

Formerly `paseo-impeccable-board`, which only ever understood Impeccable tickets.

## Kinds

A ticket's kind is the name of the skill that runs it, so any installed skill can run a ticket.
`skill:tdd` on an issue draws a **Tdd** chip and dispatches `/skill:tdd <ticket-url>`.

The board decides the kind from the ticket's own labels first, then from the spec it hangs off, then
by asking the router, and falls back to `implement` last.

| Source            | A ticket takes its kind from this when                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `skill:<name>`    | the label is there, whoever put it there                                                   |
| `wayfinder:*`     | `/wayfinder` wrote the ticket and stamped its own family                                   |
| `impeccable:*`    | `/impeccable-to-tickets` wrote it                                                          |
| The spec above it | the nearest ancestor that declares a kind, up to three levels                              |
| `/skill:route`    | nothing above did. Asked once, and the answer is written back as a `skill:` label          |
| `implement`       | the router had no answer either                                                            |

### The routing table

`TICKET_KINDS` in `shared/tickets.ts` holds an entry only for a kind that needs something other than
"invoke `/skill:<kind>` on the ticket URL". Everything else runs off the fallback, which is why a
`skill:tdd` label needs no code change.

| Kind         | Entry exists because                                                                  | Prompt                                     |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `wayfinder`  | it is invoked on the map, with an extra line naming the ticket                           | `/skill:wayfinder <map-url>` + ticket line |
| `impeccable` | the skill is named `impeccable-implement`, and the body must carry two sections           | `/skill:impeccable-implement <ticket-url>` |
| `implement`  | it is the fallback kind, and its title is not its skill name by accident                  | `/skill:implement <ticket-url>`            |
| anything else | no entry. `skill:tdd` is `Tdd`, runs `tdd`, needs a non-empty body                       | `/skill:<name> <ticket-url>`               |

Wayfinder is the one kind whose skill is invoked on the **map**, not on the ticket: `/wayfinder`'s
"Work through the map" mode loads the map first and takes a named ticket as an option. So the
dispatched prompt is the map URL followed by "The ticket is `<url>`. Resolve that one and no other."
A wayfinder ticket with no map is invoked on itself and told so. That is a table entry
(`invokeOn: "spec"` plus a `note`), not a branch in the prompt builder.

### Routing a ticket that names no skill

A ticket that survives the filters with no kind of its own and no spec to inherit one from is routed:
the daemon runs `pi -p "/skill:route <issue-url> --json"`, reads the `{skill, command, target,
prompt}` object the router prints, and writes the skill straight back to the issue as
`skill:<name>`, creating the label when the repo has never seen it.

That write-back is the cost control: the question is asked once per ticket ever, and every later draw
reads a label. A router that fails or answers unreadably costs the ticket nothing; it is asked again
on the next draw.

**Routing never blocks a draw.** A repo that has never been routed can arrive with eighty kindless
issues, and waiting on even a few of them would mean a minute of spinner before anything appeared.
So the draw queues them and returns in about a second. One queue per checkout drains behind it, two
at a time, triaged first and newest before oldest. Each answer lands as a label on GitHub and drops
the cached board.

While the queue is draining, `TicketBoard.routing` is the number still unanswered, the header reads
"picking a skill for 8", and the panel refetches every 8 seconds. A queued ticket is listed the whole
time, as `implement`, and redraws as itself when its label lands. The backlog stops at 200.

The plugin's cleanup calls `stopRouting()`, because a route is a pi subprocess of a daemon
subprocess and nothing else would take one down.

Every filter that works without a kind runs before the queue, so an empty issue, a spec, or someone
else's ticket never costs a router call.

pi prints its reply and then stays up, so the board reads until the JSON object parses and kills the
process rather than waiting for a stdout that never closes.

The map is found two ways: by expanding a `wayfinder:map` into its sub-issues, and by reading
`parent_issue_url` off a ticket that was seeded by its own `wayfinder:<type>` label. The second path
is what stops a labelled ticket being dispatched map-less just because the walk reached it first.

## Ticket rules

A ticket is **listed** when it is open, not deferred, not a spec, not assigned to somebody else, and
correctly shaped for its kind. Everything else is reported under "Skipped".

There is **no triage gate**. Every open issue in the repository is a candidate, because every ticket
routes to some skill now. The board used to demand the ready label only because it understood three
kinds and anything unlabelled was no use to it.

- **Triage**: the ready label, `ready-for-agent` unless settings say otherwise, sorts a ticket above
  the untriaged ones and is drawn as a chip. It admits nothing and excludes nothing.
- **Deferred**: the deferred label, `deferred` unless settings say otherwise, drops the ticket
  whatever else it carries. With the gate gone, this is the only way to say "not this one".
- **Spec**: an issue carrying `wayfinder:map` or `impeccable:spec`, or one that owns sub-issues.
  Specs are replaced by their open sub-issues, walked up to three levels down, then filtered like any
  other candidate. A spec hands its kind down, which is how a plain child of a wayfinder map still
  dispatches as wayfinder work.
- **Shape**: only a kind whose table entry declares `requiredSections` prescribes one. Impeccable is
  the only one that does, `## Agent prompt` plus `## Acceptance criteria`, because its own ticket
  writer guarantees it. Every other kind is a prose spec, so the only bar is a non-empty body.

Listed tickets carry one of four states:

| State     | Meaning                                                                       | Dispatch                  |
| --------- | ----------------------------------------------------------------------------- | ------------------------- |
| `ready`   | Unassigned, unblocked, nothing in flight                                      | Always                    |
| `running` | A live Paseo workspace, git worktree, or local branch already holds the number | Force only, on `-2`, `-3` |
| `claimed` | Assigned to you, no worktree left behind                                       | Force only                |
| `blocked` | At least one open blocker                                                      | Never                     |

Sort order: dispatchable first, then the tickets carrying the ready label, then the routing table's
own order, then any other skill alphabetically, then newest first.

## The claim

Worktree scanning only ever sees the machine the daemon runs on. Without a record on GitHub, a
second machine reads a ticket somebody is already working as `ready` and dispatches a duplicate.

So once a workspace and its agent actually come up, the board assigns you the issue. Another machine
then draws it as `claimed`, which needs Force. The assignee is the whole record: no comment is
posted, and the ticket's thread stays for humans.

The claim runs after dispatch, never before, so a workspace that fails to come up leaves the ticket
free. A claim that fails is a warning toast, not a failed dispatch, because the agent is already
working. That happens on a repository you cannot write to.

A claim costs no extra reads. Assignees already arrive with the issue list.

The claim is given back when the worktree goes away. `workspace.archived` waits for Paseo to remove
the directory, reads the `ticket` label off the workspace's agents, and drops your assignee, so a
workspace archived without merging puts its ticket back on the board as `ready`. `agent.turn_ended`
is the backstop for a worktree removed by hand under a workspace that still exists. A ticket that is
closed, assigned to somebody else, or still sitting in a live worktree is left alone.

## The dispatch card

A dispatched agent opens on its expanded skill. pi pastes the whole `SKILL.md` body inline before the
agent sees it, so the tab's first screen is several hundred lines of instructions with the ticket URL
at the very end of them. Nothing said which ticket the tab was for.

So the dispatch pins one row above that: number, title, kind, branch, a link to the issue, and a link
to the spec it was expanded out of. Blockers get a red block, though the planner refuses a blocked
ticket outright, so that row only appears if that gate ever loosens.

The daemon writes the row, because only a plugin session may append to a timeline; Paseo stamps the
plugin id from the caller and rejects anyone else. The client draws it from a registered renderer, so
a client without the plugin running sees a placeholder rather than a broken row. The row id is fixed
per agent, so a re-dispatch replaces the card instead of stacking a second one.

The card is appended after the agent exists and never fails a dispatch. A card that does not land is
an aside on the success toast, the same way a failed claim is.

## Per-project setup and teardown

Every dispatch gets its own worktree, but a worktree is only isolated if the project makes it so.
Give each repo you dispatch from a `paseo.json` with worktree scripts:

```json
{
  "worktree": {
    "setup": "./.paseo/setup.sh",
    "teardown": "./.paseo/teardown.sh",
    "servicePorts": { "range": "3000-3060" }
  },
  "scripts": {
    "dev": { "type": "service", "command": "./.paseo/dev.sh" }
  }
}
```

- **`setup`** runs once in the new worktree, before any script or agent. Write the env file, install
  dependencies, and stand up a database, cache, or fixture named after the branch. Must be
  idempotent, because it reruns on a workspace that already exists.
- **`teardown`** runs on archive, before Paseo removes the directory. Drop the env file, build
  output, the branch-scoped database, and the branch itself. Every step best-effort, always `exit 0`,
  so a failure never blocks the archive.
- **`servicePorts`** hands each workspace its own range, so several dispatched agents can run dev
  servers and end-to-end tests at the same time.

Without them, agents on the same machine share one port, one database, and one `.env`. Two tickets in
flight then fail each other's tests, and the agents read that as a bug in their ticket.

## Contributions

| Contribution                              | Where                    | Mobile |
| ----------------------------------------- | ------------------------ | ------ |
| Sidebar item **Tickets**                  | Sidebar, under Schedules | Yes    |
| Workspace panel **Tickets**               | Workspace new-tab menu   | No     |
| Command Center item **Dispatch ticket**   | ⌘K in any workspace      | No     |
| Command Center item **Ticket board settings** | ⌘K anywhere          | No     |
| Settings screen **Ticket board**          | Settings → Plugins       | Yes    |
| Timeline renderer `ticket-card`           | Dispatched agent's timeline | Yes |
| Settings document `board`                 | Daemon subprocess        | –      |
| RPC `ticket-board.tickets.list`           | Daemon subprocess        | –      |
| RPC `ticket-board.dispatch.plan`          | Daemon subprocess        | –      |
| RPC `ticket-board.dispatch.claim`         | Daemon subprocess        | –      |
| RPC `ticket-board.timeline.card`          | Daemon subprocess        | –      |
| Hook `workspace.archived`                 | Daemon subprocess        | –      |
| Hook `agent.turn_ended`                   | Daemon subprocess        | –      |

Only the sidebar item reaches a phone. The mobile workspace header menu offers agents, terminals, and
browsers and never consults the plugin panel catalog, and the Command Center opens on a keyboard
shortcut alone.

## Files

| File                       | Runtime | Holds                                                              |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `index.client.tsx`         | client  | Surface, sidebar item, panel, and Command Center wiring            |
| `index.server.ts`          | daemon  | RPC handler and lifecycle hook wiring, and stopping the route queue |
| `shared/settings.ts`       | both    | Settings document, its defaults, the label vocabulary sent to the daemon, and the appearance choices that stay client-side |
| `shared/tickets.ts`        | both    | Zod RPC contracts, fixed labels, the routing table, kind detection, prompts, the claim marker, the card contract |
| `server/tickets.ts`        | daemon  | Every `gh`, `git`, and `pi` call, the ready rules, routing, the claim and its release, the board cache |
| `client/board.tsx`         | client  | The board: list, kind filter, multi-select, force, refresh, dispatch |
| `client/board-panel.tsx`   | client  | Workspace-panel wrapper, repo from `projectRootPath`                |
| `client/board-surface.tsx` | client  | Sidebar wrapper, repo from the host's git projects                  |
| `client/dispatch.ts`       | client  | Workspace and agent creation through the Paseo SDK                  |
| `client/ticket-card.tsx`   | client  | The card pinned to a dispatched agent's timeline                    |
| `client/web.ts`            | client  | The one module allowed a browser global, for opening a link         |
| `client/settings.ts`       | client  | Reads the settings document, falling back to the defaults, and builds the live appearance tokens |
| `client/providers.ts`      | client  | Provider, model, and thinking dropdown options from the daemon      |
| `client/settings-screen.tsx` | client | The settings screen: one draft, saved as a whole document          |
| `client/theme.ts`          | client  | Appearance tokens and their context, ticket color mapping including the unknown-kind fallback, alpha helper |
| `client/ui.tsx`            | client  | Shared presentational pieces: the ticket frame, head, note, and run band, plus segments, chips, buttons |

No `gh` call and no credential handling exists in the client bundle. The panel only ever sends a
repository path and a list of issue numbers.

## Speed

One draw of the board is one `gh api graphql` call per 100 open issues, which for most repos is one
call. Labels, assignees, bodies, ancestry, sub-issue counts, and open blockers all arrive together,
and the local worktree scan races the query rather than waiting on it. There is no `gh auth status`
round trip; the first real call reports a missing login just as clearly.

Dispatch plans from the board the panel drew, when that board is under 30 seconds old, and re-scans
only the local branches and worktrees. A batch of tickets creates up to three workspaces at a time by
default, because branch names are settled before the first one starts.

## Settings

**Settings → Plugins → paseo-ticket-board → Ticket board**, or **Ticket board settings** in ⌘K.
Values are stored per host and shared by every client connected to it. The defaults are what the
board used to hardcode, so a fresh install behaves as before.

| Setting               | Default                        | Why it moves                                                     |
| --------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Provider and model    | `pi/cliproxyapi/claude-opus-5` | Bare `pi` answers 400 "draws from your extra usage" here          |
| Thinking level        | `high`                         | Provider-specific reasoning option id                            |
| Ready label           | `ready-for-agent`              | Another repo's triage vocabulary. Sorts, never gates             |
| Deferred label        | `deferred`                     | Same                                                             |
| Worktrees in parallel | 3                              | The worktree adds all touch one repository index                 |
| Font                  | System                         | System, sans-serif, serif, or monospace                          |
| Text size             | Medium                         | Scales the whole board, small through extra large                |
| Card density          | Cozy                           | Tight, cozy, or roomy padding and gaps                           |

The three Appearance settings are the only ones the daemon never sees: the server picks tickets, it
does not draw them. `client/theme.ts` turns those three words into every size, face, and gap through
`buildAppearance`, and hands the result down on `AppearanceContext`. Because `useSettings` is a live
subscription, saving redraws the board, the sidebar surface, and the ticket card on a running
agent's timeline on the next render: no refetch, no remount, no reload. The settings screen previews
a real ticket card built from the same components, following the draft rather than the saved
document, so the choice is judged before it is committed.

At their defaults the tokens reproduce the sizes and spacing the board hardcoded before the group
existed, down to the 20px title line height and the 18px checkbox. The text face never touches issue
numbers, branch names, or skill commands, which stay monospaced as literal data, unless the reader
picks Monospace and unifies the two.

Provider, model, and thinking level are dropdowns filled from the daemon's own provider catalog:
providers from `providers.waitForReady()`, models and their thinking options from
`providers.listModels()`. Picking a provider selects that provider's default model, and picking a
model keeps the thinking level when it exists there. A saved id the catalog no longer offers, such
as a logged-out provider's, stays selectable and is marked "not available", and a provider that
lists nothing falls back to a text field so a typed id still works.

The daemon has no read side for plugin settings, so the client sends the two labels along with
`ticket-board.tickets.list` and `ticket-board.dispatch.plan`. Both fields are optional: a caller
that omits them gets the defaults. The board's query key carries them too, so editing a label
draws a new board instead of serving the old one from cache.

Every dispatched agent carries the labels `ticket: <number>` and `kind: <skill-name>`.

## Develop

```bash
npm install
npm run typecheck
paseo plugin install /Volumes/Dock/dev/frail/paseo-ticket-board
paseo plugin reload paseo-ticket-board
paseo plugin logs paseo-ticket-board
```

Upgrading from the old id:

```bash
paseo plugin remove paseo-impeccable-board
paseo plugin install /Volumes/Dock/dev/frail/paseo-ticket-board
```
