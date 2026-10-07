// Re-scope the pet window's sprite rules (src/style.css) for the web overlay:
// `body` becomes the pet box, `#pet` the sprite, and keyframes get an
// `omopet-` prefix so they cannot collide with the host page. Only rules that
// style #pet are kept; the overlay's own layer rules live in
// src/overlay/base.css.

function blocks(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out;
}

export function scopeCss(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const keyframes = new Set([...source.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const rename = (text) =>
    text.replace(/(animation(?:-name)?\s*:\s*)([\w-]+)/g, (all, prop, name) =>
      keyframes.has(name) ? `${prop}omopet-${name}` : all,
    );
  const kept = [];
  for (const block of blocks(source)) {
    const selector = block.slice(0, block.indexOf("{")).trim();
    if (selector.startsWith("@keyframes")) {
      kept.push(block.replace(/@keyframes\s+([\w-]+)/, "@keyframes omopet-$1"));
      continue;
    }
    if (!selector.includes("#pet")) continue;
    const scoped = selector
      .split(",")
      .map((s) => s.trim().replace(/^body\b/, ".omopet-box").replace(/#pet\b/g, ".omopet-pet"))
      .map((s) => (s === ".omopet-pet" ? ".omopet-box .omopet-pet" : s))
      .join(",\n");
    kept.push(rename(`${scoped} ${block.slice(block.indexOf("{"))}`));
  }
  return `${kept.join("\n\n")}\n`;
}
