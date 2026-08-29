// v116 — copy-ready Meta/Facebook Ads import for the weekly Facebook entry step.
// Proves strict parsing, week safety and the five Facebook-field mapping.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./lib/env.cjs');

(async()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.ok(html.includes('id="facebookImportBtn"'),'Facebook entry panel has the import button');
  assert.ok(html.includes('id="facebookPasteFallback"'),'blocked clipboard has an on-page paste fallback');

  const {ctx}=await boot({defaults:[]});
  const parsed=ctx.parseFacebookImport(JSON.stringify({
    source:'meta',weekEnding:'2026-08-22',campaign:'6WC - 23rd July | Leads | Prospecting',
    adSpend:533.24,impressions:98911,linkClicks:918,leads:33,sales:6
  }));
  assert.strictEqual(parsed.ok,true,'valid Meta payload parses');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.values)),{
    adSpend:533.24,impressions:98911,linkClicks:918,leads:33,sales:6
  },'the five Facebook Ads KPIs map exactly');
  assert.strictEqual(ctx.parseFacebookImport('{nope').ok,false,'malformed JSON is rejected');
  assert.strictEqual(ctx.parseFacebookImport(JSON.stringify({source:'ontraport',adSpend:1,impressions:2,linkClicks:3})).ok,false,'wrong source is rejected');
  assert.strictEqual(ctx.parseFacebookImport(JSON.stringify({source:'meta',weekEnding:'2026-08-23',adSpend:1,impressions:2,linkClicks:3,leads:1,sales:1})).ok,false,'non-Saturday week ending is rejected');
  assert.strictEqual(ctx.parseFacebookImport(JSON.stringify({source:'meta',adSpend:-1,impressions:2,linkClicks:3,leads:1,sales:1})).ok,false,'negative spend is rejected');

  ctx.document.getElementById('fbPanel').dataset.weekEnding='2026-08-22';
  const fields={
    '.fb-adSpend':{value:''},'.fb-impressions':{value:''},'.fb-linkClicks':{value:''},
    '.fb-leads':{value:''},'.fb-sales':{value:''},
    '.fb-campaign-sel':{value:'',options:[{value:''},{value:'__new__'}]},
    '.fb-campaign-new':{value:'',style:{display:'none'}}
  };
  const block={querySelector:selector=>fields[selector]};
  const originalQuerySelector=ctx.document.querySelector.bind(ctx.document);
  ctx.document.querySelector=selector=>selector==='#fbCampaignBlocks .fb-block'?block:originalQuerySelector(selector);
  const applied=ctx.applyFacebookImport(parsed);
  assert.strictEqual(applied.ok,true,'parsed Meta payload applies');
  assert.strictEqual(fields['.fb-adSpend'].value,'533.24','spend prefills');
  assert.strictEqual(fields['.fb-impressions'].value,'98911','impressions prefill');
  assert.strictEqual(fields['.fb-linkClicks'].value,'918','link clicks prefill');
  assert.strictEqual(fields['.fb-leads'].value,'33','leads prefill');
  assert.strictEqual(fields['.fb-sales'].value,'6','sales prefill');
  assert.strictEqual(fields['.fb-campaign-sel'].value,'__new__','new campaign option is selected');
  assert.strictEqual(fields['.fb-campaign-new'].value,'6WC - 23rd July | Leads | Prospecting','campaign name prefills');

  const wrongWeek=ctx.parseFacebookImport(JSON.stringify({source:'meta',weekEnding:'2026-08-15',adSpend:1,impressions:2,linkClicks:3,leads:1,sales:1}));
  assert.strictEqual(ctx.applyFacebookImport(wrongWeek).ok,false,'payload cannot be applied to the wrong dashboard week');

  ctx.navigator.clipboard=undefined;
  await ctx.importFacebookFromClipboard();
  assert.strictEqual(ctx.document.getElementById('facebookPasteFallback').hidden,false,'blocked clipboard opens the paste box');
  assert.ok(ctx.document.getElementById('facebookImportMsg').textContent.includes('Paste below'),'fallback explains the next action');

  console.log('v116-facebook-clipboard-import.test: all assertions passed');
})().catch(e=>{console.error(e);process.exit(1);});
