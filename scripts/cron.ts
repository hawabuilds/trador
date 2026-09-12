/**
 * Hit the app's own cron routes on a schedule.
 *
 * Runs as a Railway cron service rather than calling the indexer in-process,
 * so there is exactly one code path that writes to the store — the one the
 * deployed app serves. A second copy running against the same database from a
 * different build is how two versions of a schema end up fighting.
 *
 *   npm run cron
 */

const APP_URL = (process.env.CRON_TARGET_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
  .replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET ?? "";

const JOBS = ["/api/cron/prices", "/api/cron/index"];

async function main(): Promise<void> {
  if (!APP_URL) throw new Error("Set CRON_TARGET_URL to the deployed app's origin.");
  if (!SECRET) throw new Error("Set CRON_SECRET to the same value the app has.");

  let failures = 0;

  for (const job of JOBS) {
    const started = Date.now();
    try {
      const response = await fetch(`${APP_URL}${job}`, {
        headers: {authorization: `Bearer ${SECRET}`},
      });
      const body = await response.text();
      console.log(
        `${job} → ${response.status} in ${Date.now() - started}ms ${body.slice(0, 300)}`,
      );
      if (!response.ok) failures += 1;
    } catch (error) {
      failures += 1;
      console.error(`${job} → ${(error as Error).message}`);
    }
  }

  // Exit non-zero so Railway's ON_FAILURE policy and its logs both reflect a
  // bad run, rather than a silent green tick over a broken indexer.
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(`cron failed: ${(error as Error).message}`);
  process.exit(1);
});
