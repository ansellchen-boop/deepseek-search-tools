/**
 * Regenerate `docs/USAGE.zh.md` and `docs/USAGE.md` from the same structured
 * guide the Settings panel renders (`lib/usage-guide.js`). Run:
 *
 *   node scripts/build-usage-docs.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE_GUIDE } from "../lib/usage-guide.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const pick = (value, lang) =>
  value && typeof value === "object" ? String(value[lang] ?? value.zh) : String(value ?? "");

function renderBlocks(blocks, lang) {
  const out = [];
  for (const block of blocks) {
    if (block.type === "p") out.push(pick(block.text, lang), "");
    else if (block.type === "h3") out.push(`### ${pick(block.text, lang)}`, "");
    else if (block.type === "ul") out.push(...block.items.map((item) => `- ${pick(item, lang)}`), "");
    else if (block.type === "ol") out.push(...block.items.map((item, index) => `${index + 1}. ${pick(item, lang)}`), "");
    else if (block.type === "table") {
      out.push(`| ${block.head.map((cell) => pick(cell, lang)).join(" | ")} |`);
      out.push(`| ${block.head.map(() => "---").join(" | ")} |`);
      for (const row of block.rows) out.push(`| ${row.map((cell) => pick(cell, lang)).join(" | ")} |`);
      out.push("");
    } else if (block.type === "code") {
      out.push(`\`\`\`${block.lang || ""}`.trimEnd(), block.text, "```", "");
    } else if (block.type === "faq") {
      for (const item of block.items) {
        out.push(`**Q: ${pick(item.q, lang)}**`, "", pick(item.a, lang), "");
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function renderGuide(lang) {
  const heading = lang === "zh" ? "使用说明" : "Usage";
  const intro = lang === "zh"
    ? "本文件由 `lib/usage-guide.js` 生成，设置页「使用说明」面板渲染的是同一份内容。"
    : "This file is generated from `lib/usage-guide.js`; the Settings page's Usage panel renders the same content.";
  const sections = USAGE_GUIDE.sections.map((section) => `## ${pick(section.title, lang)}\n\n${renderBlocks(section.blocks, lang)}`);
  return `# ${heading}\n\n${intro}\n\n${sections.join("\n\n")}\n`;
}

await mkdir(join(root, "docs"), { recursive: true });
await writeFile(join(root, "docs", "USAGE.zh.md"), renderGuide("zh"), "utf8");
await writeFile(join(root, "docs", "USAGE.md"), renderGuide("en"), "utf8");
console.log("docs/USAGE.zh.md and docs/USAGE.md written");
