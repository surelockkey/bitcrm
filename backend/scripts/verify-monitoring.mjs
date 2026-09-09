#!/usr/bin/env node
/**
 * Guards the gap this script was written for: a service gets added, wires up
 * MetricsModule, and nothing in monitoring/ ever learns about it — so it is
 * invisible in Grafana and no alert can fire for it. Search and telephony had
 * been running unmonitored for exactly that reason.
 *
 * Services are discovered from the filesystem rather than a list, so a new
 * service fails this check the moment it exists.
 *
 *   node scripts/verify-monitoring.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVICES_DIR = join(BACKEND, 'services');
const MONITORING = join(BACKEND, 'monitoring');

const failures = [];
const fail = (msg) => failures.push(msg);

/** Reads a service's HTTP identity straight out of its bootstrap. */
function readService(name) {
  const mainPath = join(SERVICES_DIR, name, 'src', 'main.ts');
  if (!existsSync(mainPath)) return null;
  const src = readFileSync(mainPath, 'utf8');

  const prefix = src.match(/setGlobalPrefix\(\s*['"]([^'"]+)['"]/)?.[1];
  const port = src.match(/process\.env\.\w+_SERVICE_PORT\s*\|\|\s*(\d+)/)?.[1];
  const serviceName = src.match(/initTracing\(\s*['"]([^'"]+)['"]/)?.[1];

  if (!prefix || !port || !serviceName) {
    fail(`${name}: could not parse prefix/port/serviceName from main.ts`);
    return null;
  }
  return { dir: name, prefix, port, serviceName };
}

const services = readdirSync(SERVICES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => readService(e.name))
  .filter(Boolean);

if (services.length === 0) {
  console.error('No services discovered — is this the backend root?');
  process.exit(1);
}

// ── Prometheus ────────────────────────────────────────────────
const prom = load(readFileSync(join(MONITORING, 'prometheus/prometheus.yml'), 'utf8'));
const jobs = prom.scrape_configs ?? [];
const byName = new Map(jobs.map((j) => [j.job_name, j]));

const blackboxTargets = new Set(
  jobs
    .filter((j) => j.job_name.startsWith('blackbox'))
    .flatMap((j) => (j.static_configs ?? []).flatMap((s) => s.targets ?? [])),
);

for (const svc of services) {
  const job = byName.get(svc.serviceName);
  if (!job) {
    fail(`prometheus.yml: no scrape job "${svc.serviceName}"`);
    continue;
  }

  const wantPath = `/${svc.prefix}/metrics`;
  if (job.metrics_path !== wantPath) {
    fail(
      `prometheus.yml: job "${svc.serviceName}" scrapes ${job.metrics_path}, expected ${wantPath}`,
    );
  }

  const targets = (job.static_configs ?? []).flatMap((s) => s.targets ?? []);
  if (!targets.some((t) => t.endsWith(`:${svc.port}`))) {
    fail(
      `prometheus.yml: job "${svc.serviceName}" targets ${targets.join(', ') || '(none)'}, expected port ${svc.port}`,
    );
  }

  const wantProbe = `/${svc.prefix}/health`;
  if (![...blackboxTargets].some((t) => t.endsWith(wantProbe))) {
    fail(`prometheus.yml: no blackbox probe for ${wantProbe}`);
  }
}

// The stack's own pieces must be scraped too, or their dashboards are blank.
for (const job of ['redis-exporter', 'opensearch-exporter', 'nginx-exporter']) {
  if (!byName.has(job)) fail(`prometheus.yml: no scrape job "${job}"`);
}

// ── Grafana ───────────────────────────────────────────────────
const dashDir = join(MONITORING, 'grafana/dashboards');
for (const file of readdirSync(dashDir).filter((f) => f.endsWith('.json'))) {
  try {
    const d = JSON.parse(readFileSync(join(dashDir, file), 'utf8'));
    if (!d.uid) fail(`grafana: ${file} has no uid`);
    if (!d.title) fail(`grafana: ${file} has no title`);
  } catch (err) {
    fail(`grafana: ${file} is not valid JSON — ${err.message}`);
  }
}

// ── Alert rules ───────────────────────────────────────────────
const alerts = load(readFileSync(join(MONITORING, 'prometheus/alerts.yml'), 'utf8'));
const ruleNames = new Set(
  (alerts.groups ?? []).flatMap((g) => (g.rules ?? []).map((r) => r.alert)),
);
for (const rule of ['ServiceDown', 'HighErrorRate', 'HealthCheckFailing']) {
  if (!ruleNames.has(rule)) fail(`alerts.yml: missing rule "${rule}"`);
}

// ── Log shipping ──────────────────────────────────────────────
const compose = load(readFileSync(join(BACKEND, 'docker-compose.yml'), 'utf8'));
for (const svc of ['prometheus', 'grafana', 'tempo', 'loki', 'promtail']) {
  if (!compose.services?.[svc]) fail(`docker-compose.yml: no "${svc}" service`);
}

// ── Deployed environment ──────────────────────────────────────
// Same failure this script exists for, one layer out: a service can be added,
// wired for metrics locally, and still ship to ECS with no sidecar scraping it.
const renderer = readFileSync(join(BACKEND, 'scripts/render-taskdef.sh'), 'utf8');

// Each case arm looks like:  search) PORT=4005; PORT_ENV=...; PREFIX=api/search ;;
const armFor = (dir) =>
  renderer.match(
    new RegExp(`^\\s*${dir}\\)\\s*PORT=(\\d+);[^;]*;\\s*PREFIX=(\\S+)\\s*;;`, 'm'),
  );

for (const svc of services) {
  const arm = armFor(svc.dir);
  if (!arm) {
    fail(`render-taskdef.sh: no case arm for "${svc.dir}" — it would deploy unmonitored`);
    continue;
  }
  const [, port, prefix] = arm;
  if (port !== svc.port) {
    fail(`render-taskdef.sh: "${svc.dir}" port ${port}, main.ts says ${svc.port}`);
  }
  if (prefix !== svc.prefix) {
    fail(
      `render-taskdef.sh: "${svc.dir}" PREFIX ${prefix}, main.ts says ${svc.prefix} — the sidecar would scrape the wrong path`,
    );
  }

  const taskdef = join(SERVICES_DIR, svc.dir, 'taskdef.json');
  if (!existsSync(taskdef)) {
    fail(`services/${svc.dir}/taskdef.json is missing`);
  }
}

for (const f of [
  'scripts/render-alloy-sidecar.sh',
  'monitoring/alloy/ecs.alloy',
  'scripts/import-grafana.sh',
  'scripts/import-alerts.sh',
]) {
  if (!existsSync(join(BACKEND, f))) fail(`${f} is missing`);
}

// The renderer keys everything off GRAFANA_CLOUD_TOKEN being in its
// environment. Setting the GitHub secret is not enough — the workflow has to
// pass it into the render step, and forgetting that produced a completely
// successful deploy with no telemetry and no error anywhere.
const workflow = join(BACKEND, '..', '.github/workflows/deploy-dev.yml');
if (!existsSync(workflow)) {
  fail('.github/workflows/deploy-dev.yml is missing');
} else {
  const wf = readFileSync(workflow, 'utf8');
  if (!/GRAFANA_CLOUD_TOKEN:\s*\$\{\{\s*secrets\.GRAFANA_CLOUD_TOKEN\s*\}\}/.test(wf)) {
    fail(
      'deploy-dev.yml: the render step does not pass GRAFANA_CLOUD_TOKEN — the sidecar would be silently omitted',
    );
  }
}

// The sidecar scrapes over loopback, so it must not carry a hard-coded host.
const alloyCfg = readFileSync(join(BACKEND, 'monitoring/alloy/ecs.alloy'), 'utf8');
if (!alloyCfg.includes('127.0.0.1')) {
  fail('monitoring/alloy/ecs.alloy: scrape target is not loopback');
}
if (!alloyCfg.includes('constants.hostname')) {
  fail(
    'monitoring/alloy/ecs.alloy: no per-task instance label — every task would report the same series',
  );
}

// ── Report ────────────────────────────────────────────────────
const label = (s) => `${s.serviceName} (${s.prefix}, :${s.port})`;
console.log(`Discovered ${services.length} services:`);
for (const s of services) console.log(`  - ${label(s)}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} monitoring coverage failure(s):`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}

console.log('\nAll services are scraped, probed, and shipping logs.');
