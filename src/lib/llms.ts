import { BG_STEPS, FEATURE_GROUPS, MALAYALAM_FONT_NAMES, MALAYALAM_STEPS, SHORTCUTS, SIZES } from "./content";
import { FACTS, FAQ, GUIDES, SITE } from "./site";

/** /llms.txt (llmstxt.org format): a short, factual summary with links to the pages that matter. */
export function llmsTxt() {
  return `# ${SITE.name}

> ${SITE.description}

Key facts:
${FACTS.map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Pages

- [Home](${SITE.url}/): what canvas.me is, features overview and FAQ
${GUIDES.map((g) => `- [${g.title}](${SITE.url}${g.href}): ${g.blurb}`).join("\n")}
- [Open the editor](${SITE.url}/app): start a design (no sign-up)

## Optional

- [Full product description](${SITE.url}/llms-full.txt): every feature, the guides and the FAQ as plain text
- [Source code](${SITE.source})
`;
}

const steps = (list: [string, string][]) => list.map(([t, b], i) => `${i + 1}. ${t}. ${b}`).join("\n");

/** /llms-full.txt: the same facts as the pages, in one plain-text file. */
export function llmsFullTxt() {
  return `# ${SITE.name}: ${SITE.tagline}

> ${SITE.description}

Website: ${SITE.url}
Editor: ${SITE.url}/app
Made by: ${SITE.maker.name} (${SITE.maker.url})
Last reviewed: ${SITE.updated}

## Key facts

${FACTS.map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Features

${FEATURE_GROUPS.map((g) => `### ${g.title}\n\n${g.items.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`).join("\n\n")}

### Design sizes

${SIZES.map(([k, v]) => `- ${k}: ${v}`).join("\n")}

### Keyboard shortcuts

${SHORTCUTS.map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Limits worth knowing

- Designs live only in the browser where they were made. Clearing site data deletes them, and they don't sync between devices. Download a .canvasme work file to keep a design.
- PNG and JPG exports include the page background colour; there is no transparent-background export yet.
- The background remover downloads its AI model (about 44 MB on CPU, 88 MB on WebGPU) the first time it is used.

## Guide: how to make a Malayalam poster

${steps(MALAYALAM_STEPS)}

Malayalam fonts in the editor: ${MALAYALAM_FONT_NAMES.join(", ")}.

## Guide: how to remove an image background for free, in the browser

${steps(BG_STEPS)}

How it works: the ormbg model (Apache-2.0) runs through transformers.js and ONNX Runtime Web, on WebGPU when the device supports it and on the CPU otherwise. The model and runtime download once from Hugging Face and jsDelivr and stay in the browser cache. The photo itself is processed on the device and is never uploaded.

## FAQ

${FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}
`;
}
