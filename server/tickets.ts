import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  PluginHandlerContext,
  PluginHookContext,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";
import {
  DEFAULT_VOCABULARY,
  type LabelVocabulary,
} from "../shared/settings";
import {
  AGENT_TICKET_LABEL,
  DEFAULT_KIND,
  type DispatchPlan,
  IMPECCABLE_SPEC_LABEL,
  KIND_PATTERN,
  type SpecRef,
  TICKET_CARD_ID,
  TICKET_CARD_KIND,
  TICKET_CARD_VERSION,
  type Ticket,
  type TicketBoard,
  type TicketCard,
  type TicketKind,
  type TicketState,
  WAYFINDER_MAP_LABEL,
  detectKind,
  isTriaged,
  kindRank,
  kindsPresent,
  ownKind,
  shapeProblem,
  skillLabel,
  ticketPrompt,
} from "../shared/tickets";

/**
 * Daemon side of the ticket board: every `gh` call, every `git` call, and the
 * auth check. None of this may move into the client bundle.
 *
 * A ticket is workable when it is open, not a spec, not deferred, has a body,
 * is not assigned to somebody else, and has no work in flight. There is no
 * triage gate: every open issue is a candidate, because every ticket routes to
 * some skill now. The ready label sorts a ticket up, it does not admit it.
 *
 * A spec is an issue carrying `wayfinder:map` or `impeccable:spec`, or one that
 * owns sub-issues; specs are replaced by their open sub-issues and filtered
 * like any other candidate. A spec also hands its kind down, which is how a
 * plain child of a wayfinder map still dispatches as wayfinder work. A ticket
 * that declares no kind at all is routed once, by `/skill:route`, and the
 * answer is written back to the issue as a `skill:` label.
 *
 * Every GitHub fact the board needs arrives in one paginated GraphQL query:
 * labels, assignees, body, ancestry, sub-issue counts, and open blockers. The
 * REST version of this file spent thirty to sixty `gh` subprocesses per draw,
 * one per issue, and each one cost a process spawn plus a round trip.
 */

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 45_000;
/** One GraphQL page carries 100 issue bodies. */
const MAX_BUFFER = 32 * 1024 * 1024;
/** GitHub rate-limits hard on bursts. Only the claim mutation fans out now. */
const CONCURRENCY = 6;
const ISSUE_PAGE_SIZE = 100;
/** 1000 open issues. Past that the repo needs a narrower query, not more pages. */
const MAX_ISSUE_PAGES = 10;
/** How far up the parent chain a ticket may inherit its kind and its spec. */
const MAX_SPEC_DEPTH = 3;

/** The daemon inherits a launchd PATH that usually has no Homebrew in it. */
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/** Loud, readable failure. The panel renders `message` verbatim. */
class BoardError extends Error {}

function commandEnv(): NodeJS.ProcessEnv {
  const current = process.env.PATH ?? "";
  const parts = current.split(":").filter(Boolean);
  for (const dir of EXTRA_PATH) if (!parts.includes(dir)) parts.push(dir);
  return { ...process.env, PATH: parts.join(":") };
}

const binaryCache = new Map<string, string>();

function resolveBinary(name: string, install: string): string {
  const cached = binaryCache.get(name);
  if (cached) return cached;

  const candidates = [
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
    ...EXTRA_PATH,
    join(process.env.HOME ?? "", ".local", "bin"),
  ];

  for (const dir of candidates) {
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      binaryCache.set(name, path);
      return path;
    } catch {
      // Not here, keep looking.
    }
  }

  throw new BoardError(`${name} not found on the daemon's PATH. ${install}`);
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function run(
  bin: string,
  args: string[],
  cwd: string,
  timeout = COMMAND_TIMEOUT_MS,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      env: commandEnv(),
      timeout,
      maxBuffer: MAX_BUFFER,
    });
    return { stdout, stderr, code: 0 };
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      code: typeof error.code === "number" ? error.code : 1,
    };
  }
}

/** How long a finished command gets to flush what is left in its pipes. */
const DRAIN_MS = 750;

/**
 * Runs a command for one answer, and stops waiting the moment it has it.
 *
 * `run` cannot be used for pi. A `pi -p` turn prints its reply and then stays
 * up: it leaves a detached executor holding the pipe, so stdout never reaches
 * EOF, and the process itself does not return either. `execFile` resolves on
 * EOF, so it would hang on every route until the timeout killed it, however
 * quickly the router answered.
 *
 * So the answer ends the call rather than the process: `read` is tried against
 * everything printed so far, and the first time it returns something, the child
 * is killed and that something is the result. Exit and the timeout are the two
 * ways out when it never answers.
 *
 * `run` stays as it is for `gh` and `git`, which exit properly and can return
 * 30 MB of JSON that only EOF marks the end of.
 */
function runForAnswer<T>(
  bin: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeout: number,
  read: (stdout: string) => T | null,
): Promise<{ answer: T | null; detail: string }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ answer: null, detail: "stopped" });
      return;
    }

    // No stdin: a pi turn started with an open one waits for input that the
    // daemon is never going to send.
    const child = spawn(bin, args, {
      cwd,
      env: commandEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (answer: T | null, note: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      // SIGKILL because the thing being stopped is a process that has already
      // declined to end on its own.
      child.kill("SIGKILL");
      resolve({
        answer,
        detail: answer !== null ? "" : [note, stderr.trim(), stdout.trim()].find(Boolean) ?? note,
      });
    };

    const timer = setTimeout(
      () => finish(read(stdout), `no answer within ${Math.round(timeout / 1000)}s`),
      timeout,
    );

    // The plugin is stopping, and a pi turn must not outlive it.
    const onAbort = (): void => finish(null, "stopped");
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length > MAX_BUFFER) return;
      stdout += chunk;
      const answer = read(stdout);
      if (answer !== null) finish(answer, "");
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_BUFFER) stderr += chunk;
    });

    child.on("error", (error: Error) => finish(null, error.message));
    // Only reached by a command that answered with nothing readable. The drain
    // is there so a reply that landed in the same tick still counts.
    child.on("exit", (code) => {
      setTimeout(() => finish(read(stdout), `exit ${code ?? 1}`), DRAIN_MS);
    });
  });
}

function ghBinary(): string {
  return resolveBinary("gh", "Install it with `brew install gh`, then restart the Paseo daemon.");
}

function gitBinary(): string {
  return resolveBinary("git", "Install the Xcode command line tools, then restart the daemon.");
}

function piBinary(): string {
  return resolveBinary("pi", "Install pi and put it on the PATH, then restart the Paseo daemon.");
}

/** The most useful line a failed command left behind. */
function failure(result: RunResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
}

/** Runs `gh` and fails loudly with the real stderr when it does not succeed. */
async function gh(args: string[], cwd: string): Promise<string> {
  const result = await run(ghBinary(), args, cwd);
  if (result.code !== 0) {
    throw new BoardError(`gh ${args.slice(0, 2).join(" ")} failed: ${failure(result)}`);
  }
  return result.stdout;
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await run(gitBinary(), args, cwd);
  return result.code === 0 ? result.stdout : "";
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BoardError(`gh returned unreadable JSON for ${what}.`);
  }
}

async function mapLimit<In, Out>(
  items: readonly In[],
  limit: number,
  worker: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const results = new Array<Out>(items.length);
  let next = 0;

  async function pump(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as In);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

// --- the one GitHub query -----------------------------------------------------

/**
 * Ancestry is written out rather than paged, because `parent` returns the issue
 * whatever its state and a closed map with open children still has to hand its
 * kind down. Three levels, matching MAX_SPEC_DEPTH.
 */
const PARENT_FIELDS = "number title url labels(first:30){nodes{name}}";
const PARENT_CHAIN = `parent{${PARENT_FIELDS} parent{${PARENT_FIELDS} parent{${PARENT_FIELDS}}}}`;

const ISSUES_QUERY = `
query($owner:String!,$name:String!,$cursor:String){
  viewer{login}
  repository(owner:$owner,name:$name){
    defaultBranchRef{name}
    issues(first:${ISSUE_PAGE_SIZE},states:OPEN,after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url body
        labels(first:30){nodes{name}}
        assignees(first:10){nodes{login}}
        subIssuesSummary{total}
        blockedBy(first:20){nodes{number title state}}
        ${PARENT_CHAIN}
      }
    }
  }
}`;

interface GqlNamed {
  name?: string;
}

interface GqlParent {
  number: number;
  title: string;
  url: string;
  labels?: { nodes?: GqlNamed[] };
  parent?: GqlParent | null;
}

interface GqlIssue {
  number: number;
  title: string;
  url: string;
  body?: string | null;
  labels?: { nodes?: GqlNamed[] };
  assignees?: { nodes?: Array<{ login?: string }> };
  subIssuesSummary?: { total?: number };
  blockedBy?: { nodes?: Array<{ number: number; title: string; state?: string }> };
  parent?: GqlParent | null;
}

interface GqlPage {
  data?: {
    viewer?: { login?: string };
    repository?: {
      defaultBranchRef?: { name?: string } | null;
      issues?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: GqlIssue[];
      };
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

interface Snapshot {
  /** Your GitHub login, used to tell "assigned to you" from "assigned away". */
  viewer: string;
  defaultBranch: string;
  issues: GqlIssue[];
  /** True when the repo has more open issues than MAX_ISSUE_PAGES can hold. */
  truncated: boolean;
}

function names(labels: { nodes?: GqlNamed[] } | undefined): string[] {
  return (labels?.nodes ?? []).map((node) => node.name ?? "").filter((name) => name.length > 0);
}

/**
 * Every open issue in the repo, with everything the board decides on. One `gh`
 * subprocess per 100 issues, which for most repos means exactly one.
 */
async function fetchSnapshot(repo: string, root: string): Promise<Snapshot> {
  const slash = repo.indexOf("/");
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);

  const issues: GqlIssue[] = [];
  let viewer = "";
  let defaultBranch = "";
  let cursor: string | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_ISSUE_PAGES; page += 1) {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${ISSUES_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
    ];
    if (cursor !== null) args.push("-f", `cursor=${cursor}`);

    const result = await run(ghBinary(), args, root);
    if (result.code !== 0) {
      const detail = failure(result);
      // The old board paid for `gh auth status` on every draw. The first real
      // call says the same thing for free.
      if (/auth|credential|token|log in/i.test(detail)) {
        throw new BoardError("gh is not authenticated on this machine. Run: gh auth login");
      }
      throw new BoardError(`gh could not read ${repo}: ${detail}`);
    }

    const parsed = parseJson<GqlPage>(result.stdout, "the issue query");
    const problem = parsed.errors?.[0]?.message;
    if (problem !== undefined) throw new BoardError(`GitHub rejected the issue query: ${problem}`);

    const repository = parsed.data?.repository;
    if (!repository) throw new BoardError(`gh could not find the repository ${repo}.`);

    viewer = parsed.data?.viewer?.login ?? viewer;
    defaultBranch = repository.defaultBranchRef?.name ?? defaultBranch;
    issues.push(...(repository.issues?.nodes ?? []));

    const info = repository.issues?.pageInfo;
    if (info?.hasNextPage !== true || !info.endCursor) return { viewer, defaultBranch, issues, truncated };
    cursor = info.endCursor;
    truncated = page === MAX_ISSUE_PAGES - 1;
  }

  return { viewer, defaultBranch, issues, truncated: true };
}

// --- issues -------------------------------------------------------------------

interface Candidate {
  number: number;
  title: string;
  url: string;
  body: string;
  labels: string[];
  assignees: string[];
  /** Sub-issues owned, the second half of "is this a spec". */
  subIssues: number;
  /** Open blockers as `#12 title`, empty when the ticket is free. */
  blockers: string[];
  /** Kind handed down by the nearest ancestor that declares one. */
  inheritedKind: TicketKind | null;
  /** The spec that owns it, carried through so wayfinder can name the map. */
  spec: SpecRef | null;
  /** Carries the ready label. Sorts the ticket up; never admits or excludes it. */
  triaged: boolean;
}

/** A labelled spec is a spec whatever the sub-issue count says. */
function isLabelledSpec(labels: readonly string[]): boolean {
  return labels.includes(WAYFINDER_MAP_LABEL) || labels.includes(IMPECCABLE_SPEC_LABEL);
}

/** Parent, grandparent, great-grandparent, whatever the query returned. */
function ancestry(issue: GqlIssue): Array<{ ref: SpecRef; labels: string[] }> {
  const chain: Array<{ ref: SpecRef; labels: string[] }> = [];
  let node = issue.parent ?? null;
  while (node && chain.length < MAX_SPEC_DEPTH) {
    chain.push({
      ref: { number: node.number, title: node.title, url: node.url },
      labels: names(node.labels),
    });
    node = node.parent ?? null;
  }
  return chain;
}

function toCandidate(issue: GqlIssue, readyLabel: string): Candidate {
  const labels = names(issue.labels);
  const chain = ancestry(issue);

  // Own labels win; past that the nearest ancestor that declares a kind hands
  // it down, which is how a plain `ready-for-agent` child of a wayfinder map
  // still dispatches as wayfinder work.
  let inheritedKind: TicketKind | null = null;
  for (const link of chain) {
    const declared = ownKind(link.labels);
    if (declared !== null) {
      inheritedKind = declared;
      break;
    }
  }

  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    body: issue.body ?? "",
    labels,
    assignees: (issue.assignees?.nodes ?? []).map((a) => a.login ?? "").filter(Boolean),
    subIssues: Number(issue.subIssuesSummary?.total ?? 0) || 0,
    blockers: (issue.blockedBy?.nodes ?? [])
      .filter((node) => (node.state ?? "OPEN").toUpperCase() === "OPEN")
      .map((node) => `#${node.number} ${node.title}`),
    inheritedKind,
    // The immediate parent, matching how the old expansion walk assigned specs.
    spec: chain[0]?.ref ?? null,
    triaged: isTriaged(labels, readyLabel),
  };
}

/**
 * Assigns the ticket to you, so the next machine to draw the board sees it as
 * claimed. Worktree scanning is local only, which is why the claim has to live
 * on GitHub.
 *
 * Returns the failure as a string rather than throwing: the workspace and the
 * agent already exist by this point, and losing the claim must not read as a
 * failed dispatch.
 */
async function claimTicket(repo: string, root: string, number: number): Promise<string | null> {
  const assigned = await run(
    ghBinary(),
    ["issue", "edit", String(number), "--repo", repo, "--add-assignee", "@me"],
    root,
  );
  return assigned.code === 0 ? null : `could not assign #${number}: ${failure(assigned)}`;
}

// --- work already in flight ---------------------------------------------------

interface InFlight {
  /** Branch name to the reason it counts as taken. */
  readonly reasons: ReadonlyMap<string, string>;
  /** Every branch name that must not be reused. */
  readonly taken: ReadonlySet<string>;
}

function worktreeBranches(porcelain: string): Map<string, string> {
  const byPath = new Map<string, string>();
  let path: string | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch ") && path !== null) {
      byPath.set(path, line.slice("branch ".length).trim().replace(/^refs\/heads\//, ""));
    }
  }

  return byPath;
}

/**
 * Three separate records of "this ticket already has a worktree", because any
 * one of them can outlive the others: a live Paseo workspace, a git worktree on
 * disk, or a leftover local branch from an archived workspace.
 *
 * All three are local, so this runs alongside the GitHub query rather than
 * after it.
 */
async function scanInFlight(root: string, paseo: PluginHandlerContext["paseo"]): Promise<InFlight> {
  const [porcelain, branchList, workspaceDirectories] = await Promise.all([
    git(["worktree", "list", "--porcelain"], root),
    git(["branch", "--format=%(refname:short)"], root),
    (async () => {
      try {
        const { entries } = await paseo.workspaces.list();
        return entries.map((entry) => entry.workspaceDirectory).filter(Boolean);
      } catch (caught) {
        console.error("[tickets] workspace list failed", caught);
        return [] as string[];
      }
    })(),
  ]);

  const byPath = worktreeBranches(porcelain);
  const reasons = new Map<string, string>();
  const taken = new Set<string>();

  for (const directory of workspaceDirectories) {
    const branch = byPath.get(directory);
    // Paseo reports a workspace by directory. The porcelain listing translates
    // that to a branch and filters out other projects' workspaces for free.
    if (!branch) continue;
    taken.add(branch);
    reasons.set(branch, `a Paseo workspace on ${branch}`);
  }

  for (const [directory, branch] of byPath) {
    if (directory === root) continue;
    taken.add(branch);
    if (!reasons.has(branch)) reasons.set(branch, `a git worktree on ${branch}`);
  }

  for (const line of branchList.split("\n")) {
    const branch = line.trim();
    if (branch === "") continue;
    taken.add(branch);
    if (!reasons.has(branch)) reasons.set(branch, `an existing branch ${branch}`);
  }

  return { reasons, taken };
}

/** Prints why issue `number` is taken, or null when it is free. */
function takenBy(number: number, inFlight: InFlight): string | null {
  const prefix = `${number}-`;
  for (const [branch, reason] of inFlight.reasons) {
    if (branch === String(number) || branch.startsWith(prefix)) return reason;
  }
  return null;
}

/** Free branch name from a base, adding `-2`, `-3` when the base is taken. */
function uniqueBranch(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

const STOP_WORDS = new Set(
  "the a an and or of to in on at for its it is be by with from that this launch".split(" "),
);

/**
 * 2-3 words, matching the branchName rule in paseo.json. Paseo only generates a
 * branch name when none is passed, and the board always passes one, so the
 * length rule lives here.
 */
export function slug(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/\[p[0-9]\]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((word) => word.length > 0);

  const kept: string[] = [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    kept.push(word);
    if (kept.length === 3) break;
  }

  return kept.length > 0 ? kept.join("-") : (words[0] ?? "ticket");
}

// --- repo ---------------------------------------------------------------------

async function resolveRepoRoot(repoDir: string): Promise<string> {
  const root = (await git(["rev-parse", "--show-toplevel"], repoDir)).trim();
  if (root === "") throw new BoardError(`${repoDir} is not inside a git repository.`);
  // The main checkout, never a worktree: dispatching from inside a ticket
  // worktree would register that worktree as its own Paseo project.
  const common = (
    await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root)
  ).trim();
  if (common.endsWith("/.git")) return common.slice(0, -"/.git".length);
  return root;
}

/**
 * `owner/name` from the origin remote, which is a local read. `gh repo view`
 * answers the same question over the network, so it is only the fallback for a
 * remote this cannot parse.
 */
async function resolveRepo(root: string): Promise<string> {
  const url = (await git(["remote", "get-url", "origin"], root)).trim();
  const match = /github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (match) return `${match[1]}/${match[2]}`;

  const viaGh = (
    await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], root)
  ).trim();
  if (viaGh === "") throw new BoardError("gh could not tell which GitHub repository this is.");
  return viaGh;
}

// --- routing a ticket that names no skill -------------------------------------

/**
 * A ticket with no `skill:` label and no spec to inherit a kind from is asked
 * once: `/skill:route` reads the issue and answers with the skill it should
 * run. The answer is written straight back to the issue as `skill:<name>`, so
 * the next draw reads a label instead of spawning pi again.
 *
 * That write-back is the whole cost control. Without it this would be a pi turn
 * per unlabelled ticket per refresh.
 */

/** A route is a whole pi turn: reading the issue, then the catalog. */
const ROUTE_TIMEOUT_MS = 180_000;
/** Each one is a model call against the same account. */
const ROUTE_CONCURRENCY = 2;
/**
 * A ceiling on the backlog, not on a draw. A repo past this is telling you it
 * wants a narrower board, not a thousand router calls.
 */
const MAX_ROUTE_QUEUE = 200;
/** Muted violet, so the routed labels read as one family on GitHub. */
const ROUTE_LABEL_COLOR = "6f42c1";

interface RouteAnswer {
  /** Skill name, already checked against `KIND_PATTERN`. */
  readonly kind: TicketKind;
  /** Sub-command the router picked, or "". Logged, not dispatched. */
  readonly command: string;
}

/** One candidate object, or null when it is not the router's answer. */
function readAnswer(json: string): RouteAnswer | null {
  let parsed: { skill?: unknown; command?: unknown };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return null;
  }

  const skill = typeof parsed.skill === "string" ? parsed.skill.trim().toLowerCase() : "";
  // An empty skill is the router saying none of them fits, which is a real
  // answer and leaves the ticket on the default kind.
  if (!KIND_PATTERN.test(skill)) return null;
  return { kind: skill, command: typeof parsed.command === "string" ? parsed.command : "" };
}

/**
 * Pulls the router's object out of whatever pi printed around it.
 *
 * `--json` asks for a bare object and gets one, but this also reads a partial
 * stream, because the caller tries it on every chunk. Opening braces are walked
 * from the outside in, so a stray line printed before the answer costs a failed
 * parse rather than the ticket's kind.
 */
function parseRouteAnswer(stdout: string): RouteAnswer | null {
  const end = stdout.lastIndexOf("}");
  if (end === -1) return null;

  for (
    let start = stdout.indexOf("{");
    start !== -1 && start < end;
    start = stdout.indexOf("{", start + 1)
  ) {
    const answer = readAnswer(stdout.slice(start, end + 1));
    if (answer !== null) return answer;
  }
  return null;
}

/** Asks the router which skill runs this issue. Never throws; null means unknown. */
async function routeTicket(root: string, issueUrl: string): Promise<RouteAnswer | null> {
  const { answer, detail } = await runForAnswer(
    piBinary(),
    ["-p", `/skill:route ${issueUrl} --json`],
    root,
    routeAbort.signal,
    ROUTE_TIMEOUT_MS,
    parseRouteAnswer,
  );
  if (answer === null) console.error(`[tickets] route failed for ${issueUrl}: ${detail}`);
  return answer;
}

/**
 * Writes the kind back to the issue. Creating the label first because the repo
 * has never seen `skill:<name>` before and `gh issue edit --add-label` refuses
 * a label that does not exist; an already-created label fails that call and the
 * add below speaks for both.
 */
async function writeSkillLabel(
  repo: string,
  root: string,
  number: number,
  kind: TicketKind,
): Promise<string | null> {
  const label = skillLabel(kind);
  await run(
    ghBinary(),
    [
      "label",
      "create",
      label,
      "--repo",
      repo,
      "--color",
      ROUTE_LABEL_COLOR,
      "--description",
      "Skill the ticket board dispatches this with",
    ],
    root,
  );

  const edited = await run(
    ghBinary(),
    ["issue", "edit", String(number), "--repo", repo, "--add-label", label],
    root,
  );
  return edited.code === 0 ? null : failure(edited);
}

/**
 * The routing backlog for one checkout.
 *
 * Routing does not block a draw. A repo that has never been routed can arrive
 * with eighty kindless issues, and waiting for even six of them would mean a
 * minute of spinner before the board appeared. So the draw queues them and
 * returns; the queue drains behind it, each answer lands as a label on GitHub,
 * and the panel refetches while the count is above zero.
 *
 * Order is the one thing the queue insists on: the tickets you triaged are the
 * ones you are about to look at, so they route first, newest before oldest.
 */
interface RouteQueue {
  readonly repo: string;
  readonly root: string;
  /** Issue number to URL, waiting or in flight, so a redraw never queues one twice. */
  readonly pending: Map<number, string>;
  draining: boolean;
}

/** One queue per main checkout. Two repos route in parallel, one does not. */
const routeQueues = new Map<string, RouteQueue>();

/** Aborted when the plugin stops, which is the only thing that cancels a route. */
const routeAbort = new AbortController();

/**
 * Queues every candidate that survived the filters without a kind of its own.
 * Returns how many this checkout is now waiting on, including anything an
 * earlier draw queued.
 */
function scheduleRouting(
  repo: string,
  root: string,
  candidates: readonly Candidate[],
): number {
  const queue = routeQueues.get(root) ?? { repo, root, pending: new Map(), draining: false };
  routeQueues.set(root, queue);

  const unrouted = candidates
    .filter((candidate) => ownKind(candidate.labels) === null && candidate.inheritedKind === null)
    .sort((a, b) => Number(b.triaged) - Number(a.triaged) || b.number - a.number);

  for (const candidate of unrouted) {
    if (queue.pending.size >= MAX_ROUTE_QUEUE) break;
    if (!queue.pending.has(candidate.number)) queue.pending.set(candidate.number, candidate.url);
  }

  // Deliberately not awaited: the draw is done and the panel is waiting on it.
  void drainRouteQueue(queue);
  return queue.pending.size;
}

/**
 * Works the backlog down, a few at a time, until it is empty or the plugin
 * stops. Only one drain per checkout runs at a time, so a refresh mid-drain
 * adds to the queue rather than starting a second one.
 *
 * The cached board is dropped after every batch, because the labels just
 * written are what the next draw reads the kinds from.
 */
async function drainRouteQueue(queue: RouteQueue): Promise<void> {
  if (queue.draining) return;
  queue.draining = true;

  try {
    while (queue.pending.size > 0 && !routeAbort.signal.aborted) {
      const batch = [...queue.pending].slice(0, ROUTE_CONCURRENCY);
      await mapLimit(batch, ROUTE_CONCURRENCY, async ([number, url]) => {
        try {
          await routeOne(queue.repo, queue.root, number, url);
        } catch (caught) {
          console.error(`[tickets] route of #${number} threw: ${toMessage(caught)}`);
        } finally {
          // Dropped whatever happened. A ticket the router could not answer for
          // is asked again on the next draw, not in a loop inside this one.
          queue.pending.delete(number);
        }
      });
      invalidateBoard(queue.root);
    }
  } finally {
    queue.draining = false;
  }
}

/** One ticket: ask the router, write the answer back to the issue. */
async function routeOne(
  repo: string,
  root: string,
  number: number,
  url: string,
): Promise<void> {
  const answer = await routeTicket(root, url);
  if (answer === null) {
    console.log(`[tickets] #${number} stays ${DEFAULT_KIND}, the router had no answer`);
    return;
  }

  const problem = await writeSkillLabel(repo, root, number, answer.kind);
  console.log(
    `[tickets] routed #${number} to ${answer.kind}` +
      (answer.command === "" ? "" : ` (${answer.command})`) +
      (problem === null ? "" : `, but the label did not stick: ${problem}`),
  );
}

/**
 * Stops the backlog when the plugin does. Called from the entry's cleanup: a pi
 * turn is a subprocess of a subprocess, and nothing else would take it down.
 */
export function stopRouting(): void {
  routeAbort.abort();
  for (const queue of routeQueues.values()) queue.pending.clear();
  routeQueues.clear();
}

// --- selection ----------------------------------------------------------------

async function buildBoard(
  repoDir: string,
  paseo: PluginHandlerContext["paseo"],
  vocabulary: LabelVocabulary,
): Promise<TicketBoard> {
  const fetchedAt = new Date().toISOString();
  const root = await resolveRepoRoot(repoDir);
  const repo = await resolveRepo(root);

  // The GitHub query and the local scans share no state, so they race rather
  // than queue. The disk-local half almost always finishes first.
  const [snapshot, inFlight, localMain] = await Promise.all([
    fetchSnapshot(repo, root),
    scanInFlight(root, paseo),
    run(gitBinary(), ["rev-parse", "--verify", "--quiet", "main"], root),
  ]);

  const baseBranch = localMain.code === 0 ? "main" : snapshot.defaultBranch || "main";
  const me = snapshot.viewer;

  const skipped: string[] = [];
  const tickets: Ticket[] = [];

  if (snapshot.truncated) {
    skipped.push(
      `repo: more than ${MAX_ISSUE_PAGES * ISSUE_PAGE_SIZE} open issues, the tail was not read`,
    );
  }

  /**
   * Every filter that can run without knowing the kind runs here, including the
   * empty-body one, so a repo full of one-line issues never queues them for the
   * router.
   */
  const candidates: Candidate[] = [];

  for (const issue of snapshot.issues) {
    const candidate = toCandidate(issue, vocabulary.readyLabel);

    if (candidate.labels.includes(vocabulary.deferredLabel)) {
      skipped.push(`#${candidate.number}: ${vocabulary.deferredLabel}`);
      continue;
    }
    // Spec first, so a map reads as "tracking spec" rather than as a ticket
    // with something wrong with it.
    if (isLabelledSpec(candidate.labels)) {
      skipped.push(`#${candidate.number}: tracking spec, not a task`);
      continue;
    }
    if (candidate.subIssues > 0) {
      skipped.push(`#${candidate.number}: spec, it owns ${candidate.subIssues} sub-issue(s)`);
      continue;
    }
    const others = candidate.assignees.filter((login) => login !== me);
    if (others.length > 0) {
      skipped.push(`#${candidate.number}: assigned to ${others.join(", ")}, not you`);
      continue;
    }
    // Every kind needs a body, and the one kind that asks for more than that
    // asks for headings this would have failed anyway.
    if (candidate.body.trim() === "") {
      skipped.push(`#${candidate.number}: empty body`);
      continue;
    }

    candidates.push(candidate);
  }

  // Queued, not awaited. Anything still waiting on an answer lists as the
  // default kind for now and redraws as itself when its label lands.
  const routing = scheduleRouting(repo, root, candidates);

  for (const candidate of candidates) {
    const kind = detectKind(candidate.labels, candidate.inheritedKind);

    const problem = shapeProblem(kind, candidate.body);
    if (problem !== null) {
      skipped.push(`#${candidate.number}: ${problem}`);
      continue;
    }

    const reason = takenBy(candidate.number, inFlight);
    const state: TicketState =
      reason !== null
        ? "running"
        : candidate.blockers.length > 0
          ? "blocked"
          : candidate.assignees.length > 0
            ? "claimed"
            : "ready";

    tickets.push({
      number: candidate.number,
      title: candidate.title,
      url: candidate.url,
      kind,
      labels: candidate.labels,
      assignees: candidate.assignees,
      state,
      blockers: candidate.blockers,
      inFlight: reason,
      branch: uniqueBranch(`${candidate.number}-${slug(candidate.title)}`, inFlight.taken),
      spec: candidate.spec,
    });
  }

  // Dispatchable first, then the ones you triaged, then the routing table's own
  // order, then anything routed in from outside it alphabetically, then newest.
  //
  // Triage moved into the sort when the gate went: with every open issue listed,
  // the ready label is what separates "I said go" from "it exists".
  const rank: Record<TicketState, number> = { ready: 0, running: 1, claimed: 2, blocked: 3 };
  const triaged = (ticket: Ticket) => Number(isTriaged(ticket.labels, vocabulary.readyLabel));
  tickets.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      triaged(b) - triaged(a) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      a.kind.localeCompare(b.kind) ||
      b.number - a.number,
  );

  return {
    fetchedAt,
    repo,
    repoDir: root,
    baseBranch,
    tickets,
    skipped: skipped.sort(),
    routing,
    error: null,
  };
}

// --- board cache --------------------------------------------------------------

/**
 * The panel draws the board, then dispatch immediately asked for it again. That
 * second build cost as much as the first and ran while the user watched a
 * spinner. A board this fresh cannot have gone stale in a way the local
 * in-flight rescan below will not catch, so dispatch reuses it.
 */
const BOARD_CACHE_MS = 30_000;

const boardCache = new Map<string, { at: number; board: TicketBoard }>();

/** A board is only reusable for the vocabulary it was picked with. */
function cacheKey(root: string, vocabulary: LabelVocabulary): string {
  return `${root}\n${vocabulary.readyLabel}\n${vocabulary.deferredLabel}`;
}

function cacheBoard(board: TicketBoard, vocabulary: LabelVocabulary): void {
  if (board.repoDir !== null && board.error === null) {
    boardCache.set(cacheKey(board.repoDir, vocabulary), { at: Date.now(), board });
  }
}

function cachedBoard(root: string, vocabulary: LabelVocabulary): TicketBoard | null {
  const key = cacheKey(root, vocabulary);
  const hit = boardCache.get(key);
  if (hit === undefined) return null;
  if (Date.now() - hit.at > BOARD_CACHE_MS) {
    boardCache.delete(key);
    return null;
  }
  return hit.board;
}

/**
 * Drops every cached board for a checkout, whatever vocabulary it was drawn
 * with. Keys carry the vocabulary, so deleting by root alone never matched and
 * a board drawn seconds ago outlived the claim it was reporting.
 */
function invalidateBoard(root: string): void {
  for (const key of boardCache.keys()) {
    if (key.slice(0, key.indexOf("\n")) === root) boardCache.delete(key);
  }
}

function toMessage(error: unknown): string {
  if (error instanceof BoardError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function listTicketsHandler(
  input: { repoDir: string; vocabulary?: LabelVocabulary },
  context: PluginHandlerContext,
): Promise<TicketBoard> {
  const started = Date.now();
  const vocabulary = input.vocabulary ?? DEFAULT_VOCABULARY;
  try {
    const board = await buildBoard(input.repoDir, context.paseo, vocabulary);
    cacheBoard(board, vocabulary);
    const byKind = kindsPresent(board.tickets.map((ticket) => ticket.kind))
      .map((kind) => `${board.tickets.filter((ticket) => ticket.kind === kind).length} ${kind}`)
      .join(", ");
    console.log(
      `[tickets] ${board.repo}: ${board.tickets.filter((t) => t.state === "ready").length} ready, ` +
        `${board.tickets.length} listed (${byKind}), ${board.skipped.length} skipped, ` +
        `${board.routing} routing in ${Date.now() - started}ms`,
    );
    return board;
  } catch (caught) {
    const error = toMessage(caught);
    console.error(`[tickets] board failed: ${error}`);
    return {
      fetchedAt: new Date().toISOString(),
      repo: null,
      repoDir: null,
      baseBranch: null,
      tickets: [],
      skipped: [],
      routing: 0,
      error,
    };
  }
}

export async function claimDispatchHandler(input: {
  repoDir: string;
  numbers: number[];
}): Promise<{ results: Array<{ number: number; error: string | null }> }> {
  try {
    const root = await resolveRepoRoot(input.repoDir);
    const repo = await resolveRepo(root);

    const results = await mapLimit(input.numbers, CONCURRENCY, async (number) => ({
      number,
      error: await claimTicket(repo, root, number),
    }));

    const failed = results.filter((result) => result.error !== null);
    console.log(
      `[tickets] claimed ${results.length - failed.length}/${results.length} on ${repo}` +
        (failed.length > 0 ? `: ${failed.map((result) => result.error).join("; ")}` : ""),
    );
    return { results };
  } catch (caught) {
    const error = toMessage(caught);
    console.error(`[tickets] claim failed: ${error}`);
    return { results: input.numbers.map((number) => ({ number, error })) };
  }
}

export async function planDispatchHandler(
  input: {
    repoDir: string;
    numbers: number[];
    force: boolean;
    vocabulary?: LabelVocabulary;
  },
  context: PluginHandlerContext,
): Promise<{ plans: DispatchPlan[]; error: string | null }> {
  const started = Date.now();
  const vocabulary = input.vocabulary ?? DEFAULT_VOCABULARY;
  try {
    const root = await resolveRepoRoot(input.repoDir);

    // A board the panel drew seconds ago is good enough to plan from. What can
    // change underneath it is a branch, and the rescan below is local and free.
    const board =
      cachedBoard(root, vocabulary) ??
      (await buildBoard(input.repoDir, context.paseo, vocabulary));
    if (board.error !== null) return { plans: [], error: board.error };
    cacheBoard(board, vocabulary);

    const baseBranch = board.baseBranch as string;
    const inFlight = await scanInFlight(board.repoDir as string, context.paseo);
    const taken = new Set(inFlight.taken);
    const plans: DispatchPlan[] = [];

    for (const number of input.numbers) {
      const ticket = board.tickets.find((entry) => entry.number === number);
      if (!ticket) throw new BoardError(`#${number} is no longer a workable ticket.`);
      if (ticket.blockers.length > 0) {
        throw new BoardError(`#${number} is blocked by ${ticket.blockers.join(", ")}.`);
      }

      // The cached board's `state` predates this rescan, so the worktree half
      // is re-derived here. The assignee half cannot change without a dispatch,
      // and a dispatch would have dropped the cache entry anyway.
      const held =
        takenBy(number, inFlight) ??
        (ticket.assignees.length > 0 ? `a claim by ${ticket.assignees.join(", ")}` : null);
      if (held !== null && !input.force) {
        throw new BoardError(`#${number} already has ${held}. Hold Force to run it again.`);
      }

      const base = `${number}-${slug(ticket.title)}`;
      const branch = uniqueBranch(base, taken);
      taken.add(branch);

      plans.push({
        number,
        title: ticket.title,
        url: ticket.url,
        kind: ticket.kind,
        branch,
        baseBranch,
        cwd: board.repoDir as string,
        agentTitle: branch === base ? ticket.title : `${ticket.title} (${branch.split("-").pop()})`,
        prompt: ticketPrompt(ticket.kind, ticket.url, ticket.spec?.url ?? null),
        card: {
          number,
          title: ticket.title,
          url: ticket.url,
          kind: ticket.kind,
          branch,
          spec: ticket.spec,
          blockers: ticket.blockers,
        },
      });
    }

    console.log(
      `[tickets] planned ${plans.length} dispatch(es) in ${Date.now() - started}ms: ` +
        plans.map((plan) => `#${plan.number} ${plan.kind}->${plan.branch}`).join(" "),
    );
    return { plans, error: null };
  } catch (caught) {
    const error = toMessage(caught);
    console.error(`[tickets] plan failed: ${error}`);
    return { plans: [], error };
  }
}

/**
 * Pins the ticket to the new agent's timeline. Called once per dispatch that
 * actually came up, from the client, immediately after the agent exists.
 *
 * Every failure is reported rather than thrown. The agent is already running by
 * the time this fires, and losing the card is not worth failing the dispatch
 * the board just reported as green.
 */
export async function appendTicketCardHandler(
  input: { agentId: string; card: TicketCard },
  context: PluginHandlerContext,
): Promise<{ error: string | null }> {
  try {
    await context.paseo.agents.ref(input.agentId).timeline.append({
      type: "plugin",
      id: TICKET_CARD_ID,
      kind: TICKET_CARD_KIND,
      version: TICKET_CARD_VERSION,
      data: input.card,
    });
    return { error: null };
  } catch (caught) {
    const error = toMessage(caught);
    console.error(`[tickets] card for #${input.card.number} failed: ${error}`);
    return { error };
  }
}

// --- releasing a claim --------------------------------------------------------

/**
 * The claim is only true while the work is in flight. `claimTicket` assigns the
 * issue once a workspace comes up and nothing ever gave it back, so a workspace
 * archived without merging left its ticket reading `claimed` until someone
 * forced it.
 *
 * Both hooks below ask the same question: the worktree this ticket was
 * dispatched into is gone, so hand the ticket back. Nothing else about the
 * claim changes.
 */

/**
 * `workspace.archived` fires when the archive record is saved, which can be a
 * beat ahead of Paseo removing the worktree. The hook itself is killed at 30
 * seconds, so this waits well inside that.
 */
const WORKTREE_WAIT_MS = 20_000;
const WORKTREE_POLL_MS = 500;

/** How many recent agents a workspace's ticket labels are looked for in. */
const AGENT_PAGE_SIZE = 200;

/** True once the directory is gone, false when it outlived the wait. */
async function waitForWorktreeGone(dir: string, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + WORKTREE_WAIT_MS;
  for (;;) {
    if (!existsSync(dir)) return true;
    const left = deadline - Date.now();
    if (left <= 0 || signal.aborted) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(WORKTREE_POLL_MS, left)));
  }
}

/** The issue number a dispatched agent carries, or null on any other agent. */
function ticketNumber(labels: Record<string, string> | undefined): number | null {
  const raw = labels?.[AGENT_TICKET_LABEL];
  if (raw === undefined) return null;
  const number = Number.parseInt(raw, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Every ticket dispatched into this workspace. A batch is one ticket per
 * workspace, but reading the set costs the same as reading one.
 */
async function workspaceTickets(
  paseo: PluginHookContext["paseo"],
  workspaceId: string,
): Promise<number[]> {
  const { entries } = await paseo.agents.list({
    // The agent is archived alongside its workspace, so the default live view
    // would already have lost it by the time this runs.
    filter: { includeArchived: true },
    sort: [{ key: "updated_at", direction: "desc" }],
    page: { limit: AGENT_PAGE_SIZE },
  });

  const numbers = new Set<number>();
  for (const entry of entries) {
    if (entry.agent.workspaceId !== workspaceId) continue;
    const number = ticketNumber(entry.agent.labels);
    if (number !== null) numbers.add(number);
  }
  return [...numbers];
}

/**
 * The main checkout behind a workspace, read from daemon state rather than from
 * disk, because the worktree the agent ran in no longer exists by this point.
 */
async function projectRootFor(
  paseo: PluginHookContext["paseo"],
  workspaceId: string | null,
  projectId: string | null,
): Promise<string | null> {
  if (projectId !== null) {
    const { projects } = await paseo.projects.list();
    const hit = projects.find((project) => project.projectId === projectId);
    if (hit) return hit.projectRootPath;
  }

  if (workspaceId !== null) {
    const { entries } = await paseo.workspaces.list();
    const hit = entries.find((entry) => entry.id === workspaceId);
    if (hit) return hit.projectRootPath;
  }

  return null;
}

/** State, assignees, and your login in one call, so the release can be careful. */
const CLAIM_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  viewer{login}
  repository(owner:$owner,name:$name){
    issue(number:$number){state assignees(first:10){nodes{login}}}
  }
}`;

interface ClaimPage {
  data?: {
    viewer?: { login?: string };
    repository?: {
      issue?: {
        state?: string;
        assignees?: { nodes?: Array<{ login?: string }> };
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

/**
 * Drops your assignee from an issue, so the board reads it as `ready` again.
 *
 * Never throws: this runs from a lifecycle hook nobody is watching, and a
 * GitHub failure must not take the archive down with it. A ticket that is
 * closed, or assigned to somebody else, is left exactly as it is.
 */
async function releaseClaim(
  root: string,
  repo: string,
  number: number,
  why: string,
): Promise<void> {
  const slash = repo.indexOf("/");
  const read = await run(
    ghBinary(),
    [
      "api",
      "graphql",
      "-f",
      `query=${CLAIM_QUERY}`,
      "-f",
      `owner=${repo.slice(0, slash)}`,
      "-f",
      `name=${repo.slice(slash + 1)}`,
      "-F",
      `number=${number}`,
    ],
    root,
  );
  if (read.code !== 0) {
    console.error(`[tickets] could not read #${number} on ${repo}: ${failure(read)}`);
    return;
  }

  const parsed = parseJson<ClaimPage>(read.stdout, "the claim query");
  const problem = parsed.errors?.[0]?.message;
  if (problem !== undefined) {
    console.error(`[tickets] GitHub rejected the claim query for #${number}: ${problem}`);
    return;
  }

  const issue = parsed.data?.repository?.issue;
  if (!issue) {
    console.error(`[tickets] #${number} is not an issue on ${repo}, claim left alone`);
    return;
  }
  if ((issue.state ?? "OPEN").toUpperCase() !== "OPEN") {
    console.log(`[tickets] #${number} is closed, nothing to release`);
    return;
  }

  const me = parsed.data?.viewer?.login ?? "";
  const assignees = (issue.assignees?.nodes ?? []).map((node) => node.login ?? "").filter(Boolean);
  if (!assignees.includes(me)) {
    console.log(
      `[tickets] #${number} is not claimed by ${me || "you"}` +
        (assignees.length > 0 ? ` (${assignees.join(", ")})` : "") +
        ", nothing to release",
    );
    return;
  }

  const edited = await run(
    ghBinary(),
    ["issue", "edit", String(number), "--repo", repo, "--remove-assignee", "@me"],
    root,
  );
  if (edited.code !== 0) {
    console.error(`[tickets] could not un-assign #${number}: ${failure(edited)}`);
    return;
  }

  // A board drawn seconds ago still calls this ticket claimed. Keys carry the
  // vocabulary they were drawn with, so this cannot be a delete by root.
  invalidateBoard(root);
  console.log(`[tickets] released #${number} on ${repo}: ${why}`);
}

/** Resolves the repo behind a main checkout and releases each ticket in turn. */
async function releaseAll(
  projectRoot: string,
  numbers: readonly number[],
  why: string,
): Promise<void> {
  const root = await resolveRepoRoot(projectRoot);
  const repo = await resolveRepo(root);
  for (const number of numbers) await releaseClaim(root, repo, number, why);
}

/**
 * A workspace archived without merging takes its worktree with it, so every
 * ticket dispatched into it goes back on the board.
 */
export async function workspaceArchivedHook(
  event: PluginLifecycleEvents["workspace.archived"],
  context: PluginHookContext,
): Promise<void> {
  const { workspace } = event;
  try {
    // Read the labels before the wait: the agents are archived with the
    // workspace and this is the only record of which ticket they held.
    const numbers = await workspaceTickets(context.paseo, workspace.id);
    if (numbers.length === 0) return;

    if (!(await waitForWorktreeGone(workspace.cwd, context.signal))) {
      console.log(`[tickets] ${workspace.cwd} is still on disk, claims left alone`);
      return;
    }

    const projectRoot = await projectRootFor(context.paseo, workspace.id, workspace.projectId);
    if (projectRoot === null) {
      console.error(`[tickets] no project root for archived workspace ${workspace.id}`);
      return;
    }

    await releaseAll(projectRoot, numbers, `${workspace.name ?? workspace.id} was archived`);
  } catch (caught) {
    console.error(`[tickets] release after archive failed: ${toMessage(caught)}`);
  }
}

/**
 * The backstop, for a worktree removed under a workspace that still exists.
 * Costs one `existsSync` on a turn that ended in its own worktree, which is
 * every normal turn.
 */
export async function agentTurnEndedHook(
  event: PluginLifecycleEvents["agent.turn_ended"],
  context: PluginHookContext,
): Promise<void> {
  const { agent } = event;
  try {
    if (agent.cwd === "" || existsSync(agent.cwd)) return;

    const refreshed = await context.paseo.agents.ref(agent.id).refresh();
    const number = ticketNumber(refreshed?.agent.labels);
    if (number === null) return;

    const projectRoot =
      refreshed?.project?.checkout.mainRepoRoot ??
      (await projectRootFor(context.paseo, agent.workspaceId, null));
    if (projectRoot === null) {
      console.error(`[tickets] no project root for agent ${agent.id}`);
      return;
    }

    await releaseAll(projectRoot, [number], `the worktree ${agent.cwd} is gone`);
  } catch (caught) {
    console.error(`[tickets] release after turn failed: ${toMessage(caught)}`);
  }
}
