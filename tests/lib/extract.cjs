// Extract the single inline <script> body from index.html so it can be
// syntax-checked and evaluated inside the test sandbox.
const fs = require("fs");
const path = require("path");

function extract(file) {
  const html = fs.readFileSync(
    file || path.join(__dirname, "..", "..", "index.html"),
    "utf8"
  );
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("No inline <script> block found in index.html");
  return m[1];
}

module.exports = { extract };
