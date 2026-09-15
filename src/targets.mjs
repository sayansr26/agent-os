/**
 * One adapter per tool. Each turns the canonical source into that tool's own
 * format. The schemas genuinely differ — this file is where that cost is paid
 * once instead of by every user.
 *
 * Every adapter returns [{ path, content }]. Adapters that must merge into an
 * existing JSON config receive the current contents and return the merged file.
 */
import { BANNER } from "./source.mjs";

const hdr = (comment) => `${comment} ${BANNER}\n`;
const mdHeader = `<!-- ${BANNER} -->\n\n`;

/** Rules whose `paths` are empty apply everywhere. */
const scoped = (rules) => rules.filter((r) => !r.always);
const universal = (rules) => rules.filter((r) => r.always);

/** AGENTS.md — the one format 35+ tools read natively. */
function agentsMd(src) {
  const parts = [src.agents];
  for (const r of universal(src.rules)) parts.push(`## ${r.name}\n\n${r.body}`);
  const s = scoped(src.rules);
  if (s.length) {
    parts.push(
      "## Path-scoped rules\n\n" +
      "These apply only to matching files. Tools with conditional rule loading\n" +
      "receive them as real scoped rules; read the relevant one before editing.\n\n" +
      s.map((r) => `- \`${r.paths.join("`, `")}\` — ${r.description || r.name}`).join("\n")
    );
  }
  // The banner is what lets `sync` tell its own output from the user's file.
  // Without it AGENTS.md is indistinguishable from hand-written work.
  return mdHeader + parts.filter(Boolean).join("\n\n") + "\n";
}

export const TARGETS = {
  // ---- native `paths:` — copy verbatim -------------------------------------
  "claude-code": {
    label: "Claude Code",
    files: (src) => scoped(src.rules).map((r) => ({
      path: `.claude/rules/${r.name}.md`,
      content: `---\npaths:\n${r.paths.map((p) => `  - "${p}"`).join("\n")}\n---\n\n${mdHeader}${r.body}\n`,
    })),
  },

  cline: {
    label: "Cline",
    files: (src) => scoped(src.rules).map((r) => ({
      path: `.clinerules/${r.name}.md`,
      content: `---\npaths:\n${r.paths.map((p) => `  - "${p}"`).join("\n")}\n---\n\n${mdHeader}${r.body}\n`,
    })),
  },

  // ---- translate ----------------------------------------------------------
  cursor: {
    label: "Cursor",
    // .mdc, and a rule without frontmatter is ignored entirely.
    files: (src) => src.rules.map((r) => ({
      path: `.cursor/rules/${r.name}.mdc`,
      content: `---\ndescription: ${r.description || r.name}\n` +
        (r.always ? "alwaysApply: true\n" : `globs: ${r.paths.join(",")}\nalwaysApply: false\n`) +
        `---\n\n${mdHeader}${r.body}\n`,
    })),
  },

  windsurf: {
    label: "Windsurf",
    // `trigger:` rather than `alwaysApply:`. 12,000 char cap per file.
    files: (src) => src.rules.map((r) => {
      const body = r.body.length > 11500 ? r.body.slice(0, 11500) + "\n\n<!-- truncated: Windsurf caps rule files at 12,000 characters -->" : r.body;
      return {
        path: `.windsurf/rules/${r.name}.md`,
        content: `---\ntrigger: ${r.always ? "always_on" : "glob"}\n` +
          (r.always ? "" : `globs: ${r.paths.join(",")}\n`) +
          `description: ${r.description || r.name}\n---\n\n${mdHeader}${body}\n`,
      };
    }),
  },

  antigravity: {
    label: "Antigravity",
    // Glob activation exists but is set in the Customizations UI — the on-disk
    // syntax is undocumented. We write plain Markdown (which is what the docs
    // specify a rule is) and state the intended scope in the file so it can be
    // set by hand. 12,000 char cap.
    files: (src) => src.rules.map((r) => {
      const body = r.body.length > 11000 ? r.body.slice(0, 11000) + "\n\n<!-- truncated: Antigravity caps rule files at 12,000 characters -->" : r.body;
      const scope = r.always
        ? "Intended activation: Always On."
        : `Intended activation: Glob — ${r.paths.join(", ")}\nSet this in Customizations → Rules; Antigravity has no documented file syntax for it.`;
      return {
        path: `.agents/rules/${r.name}.md`,
        content: `${mdHeader}<!-- ${scope.replace(/\n/g, " ")} -->\n\n# ${r.description || r.name}\n\n${body}\n`,
      };
    }),
  },

  // ---- no conditional loading: AGENTS.md plus an instructions list ---------
  "gemini-cli": {
    label: "Gemini CLI",
    // Reads GEMINI.md by default; AGENTS.md only if context.fileName says so.
    merge: (src, existing) => {
      const cfg = existing ? JSON.parse(existing) : {};
      const names = new Set([].concat(cfg.context?.fileName || ["GEMINI.md"]));
      names.add("AGENTS.md");
      cfg.context = { ...(cfg.context || {}), fileName: [...names] };
      return [{ path: ".gemini/settings.json", content: JSON.stringify(cfg, null, 2) + "\n" }];
    },
    mergeFrom: ".gemini/settings.json",
  },

  opencode: {
    label: "OpenCode",
    merge: (src, existing) => {
      const cfg = existing ? JSON.parse(existing) : { $schema: "https://opencode.ai/config.json" };
      const want = scoped(src.rules).map((r) => `.agent-os/rules/${r.name}.md`);
      cfg.instructions = [...new Set([...(cfg.instructions || []), ...want])];
      return [{ path: "opencode.json", content: JSON.stringify(cfg, null, 2) + "\n" }];
    },
    mergeFrom: "opencode.json",
  },

  kilo: {
    label: "Kilo",
    merge: (src, existing) => {
      const cfg = existing ? JSON.parse(existing) : { $schema: "https://app.kilo.ai/config.json" };
      const want = scoped(src.rules).map((r) => `.agent-os/rules/${r.name}.md`);
      cfg.instructions = [...new Set([...(cfg.instructions || []), ...want])];
      return [{ path: "kilo.json", content: JSON.stringify(cfg, null, 2) + "\n" }];
    },
    mergeFrom: "kilo.json",
  },
};

/**
 * Where each tool looks for skills.
 *
 * `.agents/skills/` is the one genuinely shared path in this whole landscape —
 * Antigravity treats it as primary, Gemini CLI as its highest-precedence alias,
 * and Cursor and Windsurf both read it. Four vendors, one directory, identical
 * `name`/`description` frontmatter. So it gets written once, not four times.
 *
 * OpenCode and Kilo have commands rather than skills — a different concept with
 * different invocation semantics — so they are deliberately absent.
 */
export const SKILL_DIRS = {
  antigravity: ".agents/skills",
  "gemini-cli": ".agents/skills",
  cursor: ".agents/skills",
  windsurf: ".agents/skills",
  "claude-code": ".claude/skills",
  cline: ".cline/skills",
};

/** Always written, for every project, regardless of which tools are present. */
export const UNIVERSAL = {
  label: "AGENTS.md",
  files: (src) => [{ path: "AGENTS.md", content: agentsMd(src) }],
};

export function compile(src, targetIds, readExisting) {
  const out = [];
  out.push(...UNIVERSAL.files(src).map((f) => ({ ...f, target: "universal" })));

  // Skills — deduped by destination, so `.agents/skills/` is emitted once even
  // when four tools that read it are all enabled.
  const dests = new Map();
  for (const id of targetIds) {
    const d = SKILL_DIRS[id];
    if (!d) continue;
    if (!dests.has(d)) dests.set(d, []);
    dests.get(d).push(id);
  }
  for (const [dest, ids] of dests)
    for (const skill of src.skills || [])
      for (const f of skill.files)
        out.push({ path: `${dest}/${skill.name}/${f.rel}`, content: f.content, target: `skills:${ids.join("+")}` });

  for (const id of targetIds) {
    const t = TARGETS[id];
    if (!t) continue;
    const files = t.merge
      ? t.merge(src, readExisting(t.mergeFrom))
      : t.files(src);
    out.push(...files.map((f) => ({ ...f, target: id })));
  }
  return out;
}
