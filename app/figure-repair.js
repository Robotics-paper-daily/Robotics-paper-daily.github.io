// Deterministic post-read figure backstop. The paper-reading skill is supposed
// to fetch each figure it embeds, but the model occasionally writes a
// `![[…/attachments/<id>/figN.png]]` embed without actually downloading it
// (leaving a dangling image). After a note is produced, repairFigures scans it
// for such embeds and fetches the missing ones via the skill's
// fetch_html_figures.py (matching figure number, normalizing to the referenced
// .png). It only ADDS missing files — never edits the note or deletes anything.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const pexec = promisify(execFile);

// Match figure embeds that live under an attachments/<id>/ folder, tolerating an
// Obsidian "|width" or "#anchor" suffix. Captures: 1=rel path, 2=id, 4=number, 5=ext.
const FIG_RE = /!\[\[([^\]|#]*\/attachments\/([^/\]|#]+)\/(fig_?(\d+))\.(png|jpe?g|webp|gif|svg))(?:[|#][^\]]*)?\]\]/gi;

function parseFigureRefs(text) {
  const out = [];
  if (!text) return out;
  const re = new RegExp(FIG_RE.source, "gi");
  let m;
  while ((m = re.exec(text))) {
    const rel = m[1];
    out.push({
      rel,
      dir: rel.slice(0, rel.lastIndexOf("/")),
      id: m[2],
      num: m[4],
      ext: m[5].toLowerCase(),
    });
  }
  return out;
}

// Repair dangling figure embeds in the note inside `noteDir`. Async (network +
// child processes) so it never blocks the main thread. Returns a summary.
async function repairFigures(noteDir, vaultPath, opts = {}) {
  const result = { checked: 0, missing: 0, fetched: 0, failures: [] };
  if (!noteDir || !vaultPath) return result;
  const md = path.join(noteDir, path.basename(noteDir) + ".md");
  if (!fs.existsSync(md)) return result;

  const scriptPath =
    opts.scriptPath ||
    path.join(vaultPath, ".claude/skills/paper-reading/scripts/fetch_html_figures.py");
  if (!fs.existsSync(scriptPath)) return result;
  const python = opts.python || "python3";

  const refs = parseFigureRefs(fs.readFileSync(md, "utf8"));
  result.checked = refs.length;
  const missing = refs.filter((r) => !fs.existsSync(path.join(vaultPath, r.rel)));
  result.missing = missing.length;
  if (!missing.length) return result;

  // group missing refs by their attachments folder
  const groups = {};
  for (const r of missing) {
    const outDir = path.join(vaultPath, r.dir);
    (groups[outDir] = groups[outDir] || { id: r.id, nums: new Set(), want: new Set() });
    groups[outDir].nums.add(r.num);
    groups[outDir].want.add(path.basename(r.rel));
  }

  for (const [outDir, g] of Object.entries(groups)) {
    try {
      await pexec(python, [scriptPath, g.id, outDir, "--only", [...g.nums].join(",")], {
        timeout: 120000,
      });
    } catch (e) {
      result.failures.push({ id: g.id, reason: "fetch: " + String(e.message || e).slice(0, 80) });
      continue;
    }
    for (const want of g.want) {
      const wantAbs = path.join(outDir, want);
      if (fs.existsSync(wantAbs)) {
        result.fetched++;
        continue;
      }
      // fetched under a different extension (svg/jpg) → normalize to the .png the note wants
      const num = (want.match(/fig_?(\d+)\./i) || [])[1];
      let alt = null;
      try {
        alt = num && fs.readdirSync(outDir).find((f) => new RegExp("^fig_?" + num + "\\.", "i").test(f) && f !== want);
      } catch {}
      if (!alt) {
        result.failures.push({ id: g.id, fig: want, reason: "figure number not in HTML" });
        continue;
      }
      try {
        if (/\.svg$/i.test(alt)) await pexec("rsvg-convert", ["-o", wantAbs, path.join(outDir, alt)]);
        else await pexec("sips", ["-s", "format", "png", path.join(outDir, alt), "--out", wantAbs]);
        fs.unlinkSync(path.join(outDir, alt));
        result.fetched++;
      } catch (e) {
        result.failures.push({ id: g.id, fig: want, reason: "convert: " + String(e.message || e).slice(0, 50) });
      }
    }
  }
  return result;
}

module.exports = { parseFigureRefs, repairFigures };
