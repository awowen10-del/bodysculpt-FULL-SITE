// v284 — the reader records the whole reel, not just the first three seconds.
//
// Ash, on ideas built from the first line of a caption: "Why are we using this to influence
// what we post then?" An idea can only borrow what made a reel work if something saw the reel.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = (f) => path.join(__dirname, "..", f);
const hooks = fs.readFileSync(root("netlify/lib/hooks.js"), "utf8");
const ideas = fs.readFileSync(root("netlify/lib/ideas.js"), "utf8");

assert.ok(/"WATCHED: what actually happens from start to finish/.test(hooks), "Gemini is asked for the whole reel");
assert.ok(/Describe only what you can see and hear/.test(hooks), "and told not to guess");
assert.ok(/watched: clip\(field\(text, "WATCHED"\)/.test(hooks), "the answer is read");
assert.ok(/watched: read\.watched/.test(hooks) && /caption: clip\(cand\.caption, 600\)/.test(hooks), "and kept on the hook");
assert.ok(/!read\.spoken && !read\.onScreen && !read\.watched/.test(hooks), "a wordless reel is not thrown away");
assert.ok(/What happens in it: /.test(ideas), "the ideas engine reads what happened");
console.log("v284 passed");
