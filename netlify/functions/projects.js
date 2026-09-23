// Netlify Function: projects  (v213)
//
// The Projects page's one address. See netlify/lib/projects.js for the shape of a project
// and for why this is a separate function from kpi-store (short version: it cannot reach
// the weekly/monthly/quarterly data, by construction).
//
//   GET  ?list=1          every project, newest work first
//   GET  ?project=<id>    one project
//   GET  ?file=<id>       one file's bytes, with its own content type — this is the src of
//                         an <img>, the data of an <object>, and the scene a board loads
//   POST ?upload=1&name=&mime=   raw bytes in the body (4 MB cap) -> { file:{id,name,mime,size} }
//   POST { project:{…} }  save one project, whole. The page always holds the whole project,
//                         so a partial write can never half-erase a board.
//
// There is no delete route. Archiving a project and flagging a step are ordinary saves.
import { cleanProject, listProjects, readProject, writeProject, readFile, writeFile,
         newId, clip, json, CAP, MIMES } from "../lib/projects.js";

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const fid = clip(url.searchParams.get("file") || "", 40);
    if (fid) {
      const blob = await readFile(fid);
      if (!blob || !blob.data) return new Response("Not found", { status: 404 });
      const meta = blob.metadata || {};
      const mime = MIMES.includes(meta.mime) ? meta.mime : "application/octet-stream";
      const name = clip(meta.name || "file", 160).replace(/[^\w. -]/g, "_");
      return new Response(blob.data, {
        headers: {
          "Content-Type": mime,
          // inline, so a picture shows and a PDF opens in the page rather than downloading
          "Content-Disposition": 'inline; filename="' + name + '"',
          // the bytes behind an id never change — a new drawing gets a new id
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }
    const pid = clip(url.searchParams.get("project") || "", 40);
    if (pid) {
      const project = await readProject(pid);
      if (!project) return json({ error: "No such project" }, 404);
      return json({ ok: true, project });
    }
    if (url.searchParams.get("list") === "1") {
      return json({ ok: true, projects: await listProjects(), fetchedAt: new Date().toISOString() });
    }
    return json({ error: "Ask for ?list=1, ?project=<id> or ?file=<id>" }, 400);
  }

  if (req.method === "POST") {
    // ---- a file's bytes. Raw body, because base64 in JSON costs a third more of a budget
    // that is already the tightest thing here.
    if (url.searchParams.get("upload") === "1") {
      const mime = clip(url.searchParams.get("mime") || "", 120);
      if (!MIMES.includes(mime)) {
        return json({ error: "That kind of file cannot be stored here. Images, SVG, PDF and .excalidraw files can." }, 415);
      }
      const name = clip(url.searchParams.get("name") || "file", 160);
      let bytes;
      try { bytes = await req.arrayBuffer(); }
      catch { return json({ error: "Could not read the file" }, 400); }
      if (!bytes || !bytes.byteLength) return json({ error: "That file is empty" }, 400);
      if (bytes.byteLength > CAP.fileBytes) {
        return json({ error: "That file is " + Math.round(bytes.byteLength / 1048576 * 10) / 10 +
          " MB. Four is the most that fits — export the drawing smaller, or split the PDF." }, 413);
      }
      const fid = newId("f_");
      await writeFile(fid, bytes, { mime, name });
      return json({ ok: true, file: { id: fid, name, mime, size: bytes.byteLength } });
    }

    let body;
    try { body = await req.json(); }
    catch { return json({ error: "Bad JSON" }, 400); }

    if (body.project) {
      const project = cleanProject(body.project);
      if (!project) return json({ error: "A project needs an id and a name" }, 400);
      await writeProject(project);
      return json({ ok: true, project });
    }
    return json({ error: "Send { project: … }, or POST ?upload=1 with the bytes" }, 400);
  }

  return new Response("Method not allowed", { status: 405 });
};
