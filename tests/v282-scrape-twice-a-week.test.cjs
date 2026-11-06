// v282 — the competitor scrape runs twice a week.
//
// Every night used up Apify's free $5 a month by 28 Oct, and then nothing updated. Ash agreed
// to twice a week. The miner still runs nightly because it also writes the day's ideas.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");

(async () => {
  const toml = read("netlify.toml");
  assert.ok(/\[functions\."ig-scrape-scheduled"\]\n  schedule = "0 5 \* \* 1,4"/.test(toml), "scrape on Mondays and Thursdays");
  assert.ok(/\[functions\."hooks-mine-scheduled"\]\n  schedule = "30 5 \* \* \*"/.test(toml), "miner and ideas still nightly");

  console.log("v282 passed");
})().catch((e) => { console.error(e); process.exit(1); });
