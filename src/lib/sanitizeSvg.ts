// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "defs",
  "clipPath",
  "mask",
  "title",
  "desc",
]);

const ALLOWED_ATTRS = new Set([
  "xmlns",
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "fill-rule",
  "clip-rule",
  "transform",
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "x2",
  "y1",
  "y2",
  "d",
  "points",
  "id",
  "role",
  "aria-label",
  "aria-hidden",
  "focusable",
  "preserveAspectRatio",
]);

const MAX_SVG_LENGTH = 8000;

function isSvgInput(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith("<svg") || trimmed.startsWith("<?xml");
}

export function sanitizeInlineSvg(input: string): string | null {
  if (!input || input.length > MAX_SVG_LENGTH || !isSvgInput(input)) {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, "image/svg+xml");
  const root = doc.documentElement;

  if (!root || root.tagName !== "svg") {
    return null;
  }

  if (doc.querySelector("parsererror")) {
    return null;
  }

  const elements = Array.from(root.querySelectorAll("*"));
  if (elements.length > 128) {
    return null;
  }

  for (const el of elements) {
    const tagName = el.tagName;
    if (!ALLOWED_TAGS.has(tagName)) {
      el.remove();
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      const lower = name.toLowerCase();
      const value = attr.value.trim().toLowerCase();

      const isAria = lower.startsWith("aria-");
      const isData = lower.startsWith("data-");
      const allowed = ALLOWED_ATTRS.has(name) || isAria || isData;

      if (!allowed || lower.startsWith("on") || lower === "style") {
        el.removeAttribute(name);
        continue;
      }

      if ((lower === "href" || lower === "xlink:href") && (value.startsWith("javascript:") || value.startsWith("data:"))) {
        el.removeAttribute(name);
      }
    }
  }

  for (const attr of Array.from(root.attributes)) {
    if (!ALLOWED_ATTRS.has(attr.name)) {
      root.removeAttribute(attr.name);
    }
  }

  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  const serialized = new XMLSerializer().serializeToString(root);
  return serialized.length <= MAX_SVG_LENGTH ? serialized : null;
}
