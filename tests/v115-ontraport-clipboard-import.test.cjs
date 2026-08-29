// v115 — one-click Ontraport clipboard import for the weekly KPI entry form.
// Proves strict parsing, the five-field mapping, date safety and overwrite protection.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./lib/env.cjs');

(async()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.ok(html.includes('id="ontraportImportBtn"'), 'weekly entry panel has the Ontraport import button');
  assert.ok(html.includes('id="e_trialists"'), 'weekly entry panel has Total Active Trialists');
  assert.ok(html.includes('id="ontraportPasteFallback"'), 'local-file clipboard failures have an on-page paste fallback');

  const {ctx}=await boot({defaults:[]});
  const parsed=ctx.parseOntraportImport(JSON.stringify({
    source:'ontraport', weekEnding:'2026-08-15', trialSales:7,
    newMembers:3, cancellations:1, pausedMembers:5, totalActiveTrialists:12
  }));
  assert.strictEqual(parsed.ok,true,'valid Ontraport payload parses');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.values)),{
    trialSales:7,signups:3,cancellations:1,paused:5,trialists:12
  },'friendly Ontraport names map to dashboard fields');

  assert.strictEqual(ctx.parseOntraportImport('{nope').ok,false,'malformed clipboard JSON is rejected');
  assert.strictEqual(ctx.parseOntraportImport(JSON.stringify({source:'other'})).ok,false,'wrong source is rejected');
  assert.strictEqual(ctx.parseOntraportImport(JSON.stringify({
    source:'ontraport',weekEnding:'2026-08-16',trialSales:1,newMembers:1,cancellations:0,pausedMembers:0,totalActiveTrialists:2
  })).ok,false,'non-Saturday week ending is rejected');
  assert.strictEqual(ctx.parseOntraportImport(JSON.stringify({
    source:'ontraport',weekEnding:'2026-08-15',trialSales:-1,newMembers:1,cancellations:0,pausedMembers:0,totalActiveTrialists:2
  })).ok,false,'negative KPI values are rejected');

  ctx.document.getElementById('e_weekEnding').value='';
  const applied=ctx.applyOntraportImport(parsed);
  assert.strictEqual(applied.ok,true,'parsed payload applies');
  assert.strictEqual(ctx.document.getElementById('e_weekEnding').value,'2026-08-15','week ending prefills');
  assert.strictEqual(ctx.document.getElementById('e_trialSales').value,'7','trial signups prefill Trial Sales');
  assert.strictEqual(ctx.document.getElementById('e_signups').value,'3','member signups prefill New Members');
  assert.strictEqual(ctx.document.getElementById('e_cancellations').value,'1','cancellations prefill');
  assert.strictEqual(ctx.document.getElementById('e_paused').value,'5','paused members prefill');
  assert.strictEqual(ctx.document.getElementById('e_trialists').value,'12','Active Trialists group count prefills');
  assert.strictEqual(ctx.document.getElementById('e_leads').value,'','Facebook leads are untouched');

  ctx.navigator.clipboard=undefined;
  await ctx.importOntraportFromClipboard();
  assert.strictEqual(ctx.document.getElementById('ontraportPasteFallback').hidden,false,'blocked clipboard opens the manual paste box');
  assert.ok(ctx.document.getElementById('ontraportImportMsg').textContent.includes('Paste below'),'fallback explains the next action');

  ctx.document.getElementById('e_signups').value='99';
  ctx.confirm=()=>false;
  const blocked=ctx.applyOntraportImport(parsed);
  assert.strictEqual(blocked.ok,false,'user can cancel an overwrite');
  assert.strictEqual(ctx.document.getElementById('e_signups').value,'99','cancel leaves existing values unchanged');

  console.log('v115-ontraport-clipboard-import.test: all assertions passed');
})().catch(e=>{console.error(e);process.exit(1);});
