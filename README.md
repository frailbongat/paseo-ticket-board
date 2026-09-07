# paseo-ticket-board

A Paseo panel that lists the GitHub tickets an agent can take, works out which skill each one was
written for, and dispatches it into its own worktree workspace. Tap tickets, tap Dispatch.

Each dispatched ticket gets a Paseo worktree workspace on `<number>-<slug>` off `main`, with a pi
agent already holding the right command.

Formerly `paseo-impeccable-board`, which only ever understood Impeccable tickets.

## The three kinds

The board decides a ticket's kind from its labels first, then from the spec it hangs off, and falls
back to `implement` last.

| Kind         | A ticket is this when                                                                      | Prompt                                    |
| ------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `wayfinder`  | it carries any `wayfinder:*` label, or it is a sub-issue of a `wayfinder:map`                | `/skill:wayfinder <map-url>` + ticket line |
| `impeccable` | it carries any `impeccable:*` label, or it is a sub-issue of an `impeccable:spec`             | `/skill:impeccable-implement <ticket-url>` |
| `implement`  | anything else that passes the gate, e.g. a `/grill-with-docs` spec labelled `ready-for-agent` | `/skill:implement <ticket-url>`            |

Wayfinder is the one kind whose skill is invoked on the **map**, not on the ticket: `/wayfinder`'s
"Work through the map" mode loads the map first and takes a named ticket as an option. So the
dispatched prompt is the map URL followed by "The ticket is `<url>`. Resolve that one and no other."
A wayfinder ticket with no map is invoked on itself and told so.

The map is found two ways: by expanding a `wayfinder:map` into its sub-issues, and by reading
`parent_issue_url` off a ticket that was seeded by its own `wayfinder:<type>` label. The second path
is what stops a labelled ticket being dispatched map-less just because the walk reached it first.

## Ticket rules

A ticket is **listed** when it is open, past the gate, not deferred, not a spec, correctly shaped for
its kind, and not assigned to somebody else. Everything else is reported under "Skipped".

- **Gate**: the `ready-for-agent` label, or one of `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, `wayfinder:task`. Wayfinder writes its own tickets and never applies triage
  labels, so carrying a type label is its own gate.
- **Deferred**: a `deferred` label drops the ticket whatever else it carries.
- **Spec**: an issue carrying `wayfinder:map` or `impeccable:spec`, or one that owns sub-issues.
  Specs are replaced by their open sub-issues, walked up to three levels down, then filtered like any
  other candidate. A spec hands its kind down, which is how a plain `ready-for-agent` child of a
  wayfinder map still dispatches as wayfinder work.
- **Shape**: only Impeccable prescribes one, `## Agent prompt` plus `## Acceptance criteria`, because
  its own ticket writer guarantees it. Wayfinder and implement tickets are prose specs, so the only
  bar is a non-empty body.

Listed tickets carry one of four states:

| State     | Meaning                                                                       | Dispatch                  |
| --------- | ----------------------------------------------------------------------------- | ------------------------- |
| `ready`   | Unassigned, unblocked, nothing in flight                                      | Always                    |
| `running` | A live Paseo workspace, git worktree, or local branch already holds the number | Force only, on `-2`, `-3` |
| `claimed` | Assigned to you, no worktree left behind                                       | Force only                |
| `blocked` | At least one open blocker                                                      | Never                     |

Sort order: ready first, then wayfinder before impeccable before implement, then newest first.

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
| RPC `ticket-board.tickets.list`           | Daemon subprocess        | –      |
| RPC `ticket-board.dispatch.plan`          | Daemon subprocess        | –      |
| RPC `ticket-board.dispatch.claim`         | Daemon subprocess        | –      |

Only the sidebar item reaches a phone. The mobile workspace header menu offers agents, terminals, and
browsers and never consults the plugin panel catalog, and the Command Center opens on a keyboard
shortcut alone.

## Files

| File                       | Runtime | Holds                                                              |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `index.ts`                 | both    | Contribution wiring                                                |
| `tickets.shared.ts`        | both    | Zod RPC contracts, label vocabulary, kind detection, prompts, the claim marker |
| `tickets.server.ts`        | daemon  | Every `gh` and `git` call, the ready rules, the claim, the board cache |
| `board.client.tsx`         | client  | The board: list, kind filter, multi-select, force, refresh, dispatch |
| `board-panel.client.tsx`   | client  | Workspace-panel wrapper, repo from `projectRootPath`                |
| `board-surface.client.tsx` | client  | Sidebar wrapper, repo from the host's git projects                  |
| `dispatch.client.ts`       | client  | Workspace and agent creation through the Paseo SDK                  |

No `gh` call and no credential handling exists in the client bundle. The panel only ever sends a
repository path and a list of issue numbers.

## Speed

One draw of the board is one `gh api graphql` call per 100 open issues, which for most repos is one
call. Labels, assignees, bodies, ancestry, sub-issue counts, and open blockers all arrive together,
and the local worktree scan races the query rather than waiting on it. There is no `gh auth status`
round trip; the first real call reports a missing login just as clearly.

Dispatch plans from the board the panel drew, when that board is under 30 seconds old, and re-scans
only the local branches and worktrees. A batch of tickets creates up to three workspaces at a time,
because branch names are settled before the first one starts.

## Defaults that matter

`pi/cliproxyapi/claude-opus-5`, thinking `high`. Bare `pi` resolves a model that answers 400
"draws from your extra usage" on this account.

Every dispatched agent carries the labels `ticket: <number>` and `kind: <wayfinder|impeccable|implement>`.

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
