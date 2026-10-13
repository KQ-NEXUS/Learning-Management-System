import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the workflow files and Dependabot configuration (Phase 15, D-10,
// NFR-04; plan 15-19 extends the trigger, permission and SHA-pin checks to every
// file in .github/workflows, so the nightly browser workflow is held to the same
// rules as ci.yml). Plain string and regular-expression checks only: yaml /
// js-yaml are transitive dependencies, not ones this repo declares. Each check
// is a pure function over the file text, so the negative cases below can prove
// that a regression in an in-memory copy is caught.

const workflowDir = resolve(".github/workflows");
const workflowFiles = readdirSync(workflowDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();
const workflows = workflowFiles.map((file) => ({ file, text: readFileSync(join(workflowDir, file), "utf8") }));
const workflow = readFileSync(join(workflowDir, "ci.yml"), "utf8");
const nightly = readFileSync(join(workflowDir, "e2e-nightly.yml"), "utf8");
const dependabot = readFileSync(resolve(".github/dependabot.yml"), "utf8");
const vitestConfig = readFileSync(resolve("vitest.config.mts"), "utf8");
const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const AUDIT_COMMAND = "npm audit --omit=dev --audit-level=high";
const REQUIRED_JOBS = ["static", "unit", "integration", "audit"] as const;

/** Test 1: untrusted pull requests stay unprivileged. Applies to every workflow file. */
function workflowTriggerProblems(text: string): string[] {
  const problems: string[] = [];
  if (/pull_request_target/.test(text)) problems.push("uses pull_request_target");
  if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(text)) {
    problems.push("top-level permissions is not contents: read");
  }
  if (/:\s*write\b/.test(text)) problems.push("grants a write permission");
  if (/\$\{\{\s*secrets\./.test(text)) problems.push("reads a repository secret");
  return problems;
}

/** The event names under the workflow's top-level `on:` map. */
function triggerNames(text: string): string[] {
  const start = text.search(/^on:\s*$/m);
  if (start === -1) return [];
  const names: string[] = [];
  for (const line of text.slice(start).split(/\r?\n/).slice(1)) {
    if (/^\S/.test(line)) break; // next top-level key
    const match = /^ {2}([A-Za-z_]\w*):/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

/** ci.yml gates pull requests, so it must run on them. */
function ciTriggerProblems(text: string): string[] {
  return triggerNames(text).includes("pull_request") ? [] : ["does not run on pull_request"];
}

/** The nightly browser workflow runs on a schedule and on manual dispatch only: no fork can start it. */
function nightlyTriggerProblems(text: string): string[] {
  const names = triggerNames(text).sort();
  const problems: string[] = [];
  if (names.join(",") !== "schedule,workflow_dispatch") {
    problems.push(`triggers are [${names.join(", ")}], expected [schedule, workflow_dispatch]`);
  }
  if ((text.match(/^\s+- cron:/gm) ?? []).length !== 1) problems.push("does not have exactly one cron schedule");
  return problems;
}

/** Test 2: every action is pinned to a full commit SHA with its version noted. */
function actionPinProblems(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => /^\s*(-\s+)?uses:/.test(line));
  if (lines.length === 0) return ["no uses: lines found"];
  return lines
    .filter(
      (line) =>
        !/uses:\s*[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}\s+#\s*v\d[\w.-]*\s*$/.test(line),
    )
    .map((line) => `not SHA-pinned with a version comment: ${line.trim()}`);
}

/** Splits the workflow's `jobs:` map into job id -> job text. */
function jobBlocks(text: string): Map<string, string> {
  const jobs = new Map<string, string>();
  const start = text.search(/^jobs:\s*$/m);
  if (start === -1) return jobs;
  const body = text.slice(start).split(/\r?\n/).slice(1);
  let current: string | null = null;
  for (const line of body) {
    if (/^\S/.test(line)) break; // next top-level key
    const header = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, "");
      continue;
    }
    if (current) jobs.set(current, `${jobs.get(current)}${line}\n`);
  }
  return jobs;
}

/** Test 3: the four jobs exist and run the commands the gate depends on. */
function jobProblems(text: string): string[] {
  const jobs = jobBlocks(text);
  const problems = REQUIRED_JOBS.filter((id) => !jobs.has(id)).map((id) => `missing job ${id}`);
  const audit = jobs.get("audit") ?? "";
  if (!audit.includes(AUDIT_COMMAND)) problems.push("audit job does not run the audit gate");
  const integration = jobs.get("integration") ?? "";
  if (!integration.includes("--no-file-parallelism")) {
    problems.push("integration job runs files in parallel");
  }
  if (!/--shard=\$\{\{\s*matrix\.shard\s*\}\}\/4/.test(integration)) {
    problems.push("integration job is not sharded four ways");
  }
  const unit = jobs.get("unit") ?? "";
  if (!unit.includes("--project node") || !unit.includes("--project components")) {
    problems.push("unit job does not run both vitest projects");
  }
  const staticJob = jobs.get("static") ?? "";
  if (!staticJob.includes("npm run lint") || !staticJob.includes("tsc --noEmit")) {
    problems.push("static job does not lint and type check");
  }
  return problems;
}

const SKIP_INTEGRATION_VARIABLE = "VITEST_SKIP_INTEGRATION";
const INTEGRATION_GLOB = "tests/**/*.integration.test.ts";

/**
 * Test 6 (checklist D-07): the unit job runs no *.integration.test.ts file.
 * The command line's --exclude does not reach a vitest project's own file
 * selection, so the job sets a variable and vitest.config.mts adds the exclude.
 * Both ends are checked: the switch in the workflow and the reader in the config.
 */
function unitSelectionProblems(workflowText: string, vitestConfigText: string): string[] {
  const problems: string[] = [];
  const unit = jobBlocks(workflowText).get("unit") ?? "";
  if (!new RegExp(`^\\s+${SKIP_INTEGRATION_VARIABLE}:\\s*"1"\\s*$`, "m").test(unit)) {
    problems.push(`unit job does not set ${SKIP_INTEGRATION_VARIABLE} to "1"`);
  }
  if (/--exclude\b/.test(unit)) {
    problems.push("unit job relies on a command-line --exclude, which does not apply to a vitest project");
  }
  const integration = jobBlocks(workflowText).get("integration") ?? "";
  if (integration.includes(SKIP_INTEGRATION_VARIABLE)) {
    problems.push(`integration job sets ${SKIP_INTEGRATION_VARIABLE}, so it would run nothing`);
  }
  if (!vitestConfigText.includes(`process.env.${SKIP_INTEGRATION_VARIABLE} === "1"`)) {
    problems.push(`vitest.config.mts does not read ${SKIP_INTEGRATION_VARIABLE}`);
  }
  if (!vitestConfigText.includes(`"${INTEGRATION_GLOB}"`)) {
    problems.push(`vitest.config.mts does not exclude ${INTEGRATION_GLOB}`);
  }
  return problems;
}

const LIVE_SMOKE_FILE = "brevo-live.smoke.test.ts";
const SMOKE_GLOB = "tests/**/*.smoke.test.ts";

/**
 * Test 6b: a test file that starts a throwaway Postgres (it imports tests/support/pg.ts)
 * needs Docker and must not run in the parallel unit job. The name is what keeps it out,
 * so every such file is named *.integration.test.ts (the sharded job) or *.perf.test.ts
 * (its own script). The one exception is the manual live email smoke, checked by Test 6c.
 */
function databaseBackedFilesOutsideIntegration(): string[] {
  return readdirSync(resolve("tests"))
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => !file.endsWith(".integration.test.ts") && !file.endsWith(".perf.test.ts"))
    .filter((file) => /from\s+"\.\/support\/pg"/.test(readFileSync(join(resolve("tests"), file), "utf8")))
    .sort();
}

/**
 * Test 6c: the live email smoke sends a real email. It must never run in CI unless a
 * person opts in: the unit job does not select it, every case in it is skipped unless
 * BREVO_LIVE is set, and no workflow sets BREVO_LIVE or names the file.
 */
function liveSmokeProblems(
  allWorkflows: ReadonlyArray<{ file: string; text: string }>,
  vitestConfigText: string,
  smokeText: string,
): string[] {
  const problems: string[] = [];
  if (!vitestConfigText.includes(`"${SMOKE_GLOB}"`)) {
    problems.push(`vitest.config.mts does not exclude ${SMOKE_GLOB} from the unit job`);
  }
  if (!smokeText.includes("const LIVE = !!process.env.BREVO_LIVE;")) {
    problems.push("the live smoke does not read BREVO_LIVE");
  }
  const cases = smokeText.match(/^\s*(?:it|test)[.(].*$/gm) ?? [];
  if (cases.length === 0 || cases.some((line) => !line.trim().startsWith("it.skipIf(!LIVE)("))) {
    problems.push("the live smoke has a case that is not skipped without BREVO_LIVE");
  }
  for (const { file, text } of allWorkflows) {
    if (/BREVO_LIVE|brevo-live|smoke\.test/.test(text)) problems.push(`${file} opts in to, or names, the live email smoke`);
  }
  return problems;
}

/**
 * Test 7 (checklist D-07): the integration job starts an object store before
 * the tests run. The storage integration tests expect one on the loopback
 * address at port 9000 with the bucket `lms-private`; without it they fail to
 * connect. The image is pinned by digest and nothing but the loopback address
 * is published.
 */
function objectStoreProblems(workflowText: string): string[] {
  const problems: string[] = [];
  const integration = jobBlocks(workflowText).get("integration") ?? "";
  const start = integration.indexOf("docker run");
  const tests = integration.indexOf("npx vitest run integration.test");
  if (start === -1) return ["integration job does not start an object store"];
  if (tests === -1 || start > tests) problems.push("integration job starts the object store after the tests");
  if (!/minio@sha256:[0-9a-f]{64}\b/.test(integration)) {
    problems.push("the object store image is not pinned by sha256 digest");
  }
  if (/minio:[\w.-]+\s/.test(integration)) problems.push("the object store image uses a tag");
  if (!integration.includes("-p 127.0.0.1:9000:9000")) {
    problems.push("the object store is not published on the loopback address at port 9000");
  }
  if (!integration.includes("minio-data/lms-private")) problems.push("the lms-private bucket is not created");
  const wait = integration.indexOf("/minio/health/live");
  if (wait === -1 || wait > tests) problems.push("integration job does not wait for the object store before the tests");
  return problems;
}

function exactPins(pkg: typeof manifest): string[] {
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([, version]) => /^\d/.test(version))
    .map(([name]) => name);
}

function ignoredNames(text: string): string[] {
  return [...text.matchAll(/dependency-name:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function coveredBy(name: string, pattern: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(name);
}

/** Test 4: every exact pin in package.json has a Dependabot ignore entry. */
function uncoveredPins(pkg: typeof manifest, text: string): string[] {
  const ignored = ignoredNames(text);
  return exactPins(pkg).filter((name) => !ignored.some((pattern) => coveredBy(name, pattern)));
}

/** Test 5: every update block targets develop. */
function ecosystemBlocks(text: string): string[] {
  return text.split(/^\s*-\s+package-ecosystem:/m).slice(1);
}

function targetBranchProblems(text: string): string[] {
  const blocks = ecosystemBlocks(text);
  if (blocks.length === 0) return ["no update blocks"];
  return blocks
    .filter((block) => !/^\s+target-branch:\s*"?develop"?\s*$/m.test(block))
    .map((block) => `block without target-branch develop: ${block.split(/\r?\n/)[0].trim()}`);
}

describe("workflow guard (D-10), every file in .github/workflows", () => {
  it("finds the CI workflow and the nightly browser workflow", () => {
    expect(workflowFiles).toContain("ci.yml");
    expect(workflowFiles).toContain("e2e-nightly.yml");
  });

  it("Test 1: no workflow uses pull_request_target, each declares contents: read and reads no secrets", () => {
    for (const { file, text } of workflows) {
      expect({ file, problems: workflowTriggerProblems(text) }).toEqual({ file, problems: [] });
    }
  });

  it("Test 2: every workflow pins every uses: line to a 40-character commit SHA with the version in a comment", () => {
    for (const { file, text } of workflows) {
      expect({ file, problems: actionPinProblems(text) }).toEqual({ file, problems: [] });
    }
  });

  it("Test 2b: ci.yml runs on pull requests and the nightly workflow only on a schedule and manual dispatch", () => {
    expect(ciTriggerProblems(workflow)).toEqual([]);
    expect(nightlyTriggerProblems(nightly)).toEqual([]);
  });

  it("Test 3: has the static, unit, integration and audit jobs with the audit gate and sharded serial integration", () => {
    expect(jobProblems(workflow)).toEqual([]);
  });

  it("Test 6: the unit job keeps integration files out through the switch vitest.config.mts reads", () => {
    expect(unitSelectionProblems(workflow, vitestConfig)).toEqual([]);
  });

  it("Test 6b: every test file that starts a database is an integration file, so the unit job runs none", () => {
    expect(databaseBackedFilesOutsideIntegration()).toEqual([LIVE_SMOKE_FILE]);
  });

  it("Test 6c: the live email smoke is out of the unit job, opt-in case by case, and no workflow opts in", () => {
    expect(liveSmokeProblems(workflows, vitestConfig, readFileSync(join(resolve("tests"), LIVE_SMOKE_FILE), "utf8"))).toEqual([]);
  });

  it("Test 7: the integration job starts a digest-pinned object store on the loopback address before the tests", () => {
    expect(objectStoreProblems(workflow)).toEqual([]);
  });

  it("Test 7b: the object store values in ci.yml are the ones the storage integration tests set for themselves", () => {
    const integration = jobBlocks(workflow).get("integration") ?? "";
    const storageTests = readdirSync(resolve("tests"))
      .filter((file) => file.endsWith(".integration.test.ts"))
      .map((file) => ({ file, text: readFileSync(join(resolve("tests"), file), "utf8") }))
      .filter(({ text }) => /^process\.env\.S3_ENDPOINT\s*=/m.test(text));
    expect(storageTests.length).toBeGreaterThanOrEqual(4);
    for (const { file, text } of storageTests) {
      const value = (name: string) => new RegExp(`^process\\.env\\.${name}\\s*=\\s*"([^"]+)";`, "m").exec(text)?.[1];
      expect(text, file).toContain('process.env.TEST_MINIO_ENDPOINT ?? "http://localhost:9000"');
      expect(integration, file).toContain(`-e MINIO_ROOT_USER=${value("S3_ACCESS_KEY_ID")}`);
      expect(integration, file).toContain(`-e MINIO_ROOT_PASSWORD=${value("S3_SECRET_ACCESS_KEY")}`);
      expect(integration, file).toContain(`minio-data/${value("S3_BUCKET")}`);
    }
  });
});

describe("Dependabot guard (D-10)", () => {
  it("Test 4: ignores every dependency that package.json pins exactly", () => {
    expect(exactPins(manifest).length).toBeGreaterThan(0);
    expect(uncoveredPins(manifest, dependabot)).toEqual([]);
  });

  it("Test 5: targets develop in every update block (npm, github-actions, docker, docker-compose)", () => {
    expect(targetBranchProblems(dependabot)).toEqual([]);
    const ecosystems = ecosystemBlocks(dependabot).map((block) =>
      block.split(/\r?\n/)[0].trim().replace(/"/g, ""),
    );
    expect(ecosystems.sort()).toEqual(["docker", "docker-compose", "github-actions", "npm"]);
  });
});

describe("the guard catches regressions in an in-memory copy", () => {
  it("fails when the nightly workflow gains a pull request or fork trigger", () => {
    const withPullRequest = nightly.replace(/^on:\s*$/m, "on:\n  pull_request:\n    branches: [main]");
    expect(withPullRequest).not.toBe(nightly);
    expect(nightlyTriggerProblems(withPullRequest).join("\n")).toContain("pull_request");
    const withTarget = nightly.replace(/^on:\s*$/m, "on:\n  pull_request_target:");
    expect(workflowTriggerProblems(withTarget)).toContain("uses pull_request_target");
    expect(nightlyTriggerProblems(withTarget).join("\n")).toContain("pull_request_target");
  });

  it("fails when the nightly workflow reads a secret or loses an action pin", () => {
    const secret = `${nightly}\n      - run: echo "\${{ secrets.TOKEN }}"\n`;
    expect(workflowTriggerProblems(secret)).toContain("reads a repository secret");
    const unpinned = nightly.replace(/actions\/upload-artifact@[0-9a-f]{40}/, "actions/upload-artifact@v7");
    expect(unpinned).not.toBe(nightly);
    expect(actionPinProblems(unpinned).length).toBe(1);
  });

  it("fails when pull_request_target is added", () => {
    const tampered = workflow.replace(/^ {2}pull_request:/m, "  pull_request_target:");
    expect(tampered).not.toBe(workflow);
    expect(workflowTriggerProblems(tampered)).toContain("uses pull_request_target");
    expect(ciTriggerProblems(tampered)).toContain("does not run on pull_request");
  });

  it("fails when the token is widened or a secret is read", () => {
    const widened = workflow.replace("contents: read", "contents: write");
    expect(workflowTriggerProblems(widened).length).toBeGreaterThan(0);
    const secret = `${workflow}\n      - run: echo "\${{ secrets.TOKEN }}"\n`;
    expect(workflowTriggerProblems(secret)).toContain("reads a repository secret");
  });

  it("fails when an action is unpinned", () => {
    const unpinned = workflow.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v7");
    expect(unpinned).not.toBe(workflow);
    expect(actionPinProblems(unpinned).length).toBe(1);
  });

  it("fails when the audit job is dropped or integration runs in parallel", () => {
    const noAudit = workflow.slice(0, workflow.search(/^ {2}audit:\s*$/m));
    expect(jobProblems(noAudit)).toContain("missing job audit");
    const parallel = workflow.replace("--no-file-parallelism", "");
    expect(jobProblems(parallel)).toContain("integration job runs files in parallel");
  });

  it("fails when the unit job loses the switch, goes back to --exclude, or the config stops reading it", () => {
    const noSwitch = workflow.replace(/^\s+VITEST_SKIP_INTEGRATION:.*\r?\n/m, "");
    expect(noSwitch).not.toBe(workflow);
    expect(unitSelectionProblems(noSwitch, vitestConfig)).toEqual(['unit job does not set VITEST_SKIP_INTEGRATION to "1"']);
    const cliExclude = workflow.replace("--project node --testTimeout", '--project node --exclude "**/*.integration.test.ts" --testTimeout');
    expect(cliExclude).not.toBe(workflow);
    expect(unitSelectionProblems(cliExclude, vitestConfig).join("\n")).toContain("--exclude");
    const deafConfig = vitestConfig.replace('process.env.VITEST_SKIP_INTEGRATION === "1"', "false");
    expect(deafConfig).not.toBe(vitestConfig);
    expect(unitSelectionProblems(workflow, deafConfig)).toEqual(["vitest.config.mts does not read VITEST_SKIP_INTEGRATION"]);
  });

  it("fails when the live email smoke can reach CI: not excluded, a case without the opt-in, or a workflow that opts in", () => {
    const smoke = readFileSync(join(resolve("tests"), LIVE_SMOKE_FILE), "utf8");
    const selected = vitestConfig.replace(`"${SMOKE_GLOB}"`, '"tests/**/*.none.test.ts"');
    expect(selected).not.toBe(vitestConfig);
    expect(liveSmokeProblems(workflows, selected, smoke)).toEqual([`vitest.config.mts does not exclude ${SMOKE_GLOB} from the unit job`]);
    const ungated = smoke.replace("it.skipIf(!LIVE)(", "it(");
    expect(ungated).not.toBe(smoke);
    expect(liveSmokeProblems(workflows, vitestConfig, ungated)).toEqual(["the live smoke has a case that is not skipped without BREVO_LIVE"]);
    const optedIn = [{ file: "ci.yml", text: workflow.replace('VITEST_SKIP_INTEGRATION: "1"', 'BREVO_LIVE: "1"') }];
    expect(liveSmokeProblems(optedIn, vitestConfig, smoke)).toEqual(["ci.yml opts in to, or names, the live email smoke"]);
  });

  it("fails when the object store is dropped, unpinned, started late or exposed beyond the loopback address", () => {
    const dropped = workflow.replace(/^\s+- name: Start local object storage[\s\S]*?(?=^\s+- name: Wait for object storage)/m, "");
    expect(dropped).not.toBe(workflow);
    expect(objectStoreProblems(dropped)).toEqual(["integration job does not start an object store"]);
    const tagged = workflow.replace(/minio@sha256:[0-9a-f]{64}/, "minio:latest");
    expect(tagged).not.toBe(workflow);
    expect(objectStoreProblems(tagged)).toEqual([
      "the object store image is not pinned by sha256 digest",
      "the object store image uses a tag",
    ]);
    const exposed = workflow.replace("-p 127.0.0.1:9000:9000", "-p 9000:9000");
    expect(objectStoreProblems(exposed)).toEqual(["the object store is not published on the loopback address at port 9000"]);
    const noBucket = workflow.replace("minio-data/lms-private", "minio-data/other");
    expect(objectStoreProblems(noBucket)).toEqual(["the lms-private bucket is not created"]);
  });

  it("fails when a new exact pin has no ignore entry", () => {
    const withNewPin = {
      ...manifest,
      dependencies: { ...manifest.dependencies, "left-pad": "1.3.0" },
    };
    expect(uncoveredPins(withNewPin, dependabot)).toEqual(["left-pad"]);
    // A wildcard entry covers the family.
    expect(uncoveredPins({ dependencies: { "@aws-sdk/client-s3": "3.1125.0" } }, dependabot)).toEqual(
      [],
    );
  });

  it("fails when an update block loses target-branch develop", () => {
    const tampered = dependabot.replace(/^\s+target-branch:\s*"develop"\s*$/m, "");
    expect(targetBranchProblems(tampered).length).toBe(1);
  });
});
