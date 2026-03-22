import type {
  ExtractorFn,
  GlobalVars,
  StyleTypes,
  TraversalContext,
  SimplifiedNode,
} from "./types.js";
import { buildSimplifiedLayout } from "~/transformers/layout.js";
import { buildSimplifiedStrokes, parsePaint } from "~/transformers/style.js";
import { buildSimplifiedEffects } from "~/transformers/effects.js";
import {
  extractNodeText,
  extractTextStyle,
  hasTextStyle,
  isTextNode,
} from "~/transformers/text.js";
import { hasValue, isRectangleCornerRadii } from "~/utils/identity.js";
import { generateVarId } from "~/utils/common.js";
import type { Node as FigmaDocumentNode } from "@figma/rest-api-spec";

/**
 * Fast hash key for dedup. For flat objects with only scalar values (strings,
 * numbers, booleans, undefined), concatenate key=value pairs pipe-delimited —
 * much cheaper than JSON.stringify. Falls back to JSON.stringify for anything
 * containing nested objects/arrays (gradients, image fills).
 */
function hashStyleValue(value: StyleTypes): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);

  const entries = Object.entries(value);
  for (const [, v] of entries) {
    if (v !== null && v !== undefined && typeof v === "object") {
      return JSON.stringify(value);
    }
  }
  // Flat object — build a cheap key from sorted entries
  entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return entries.map(([k, v]) => `${k}=${v}`).join("|");
}

/**
 * Find an existing global variable with the same value, or create a new one.
 * Uses a reverse-lookup Map (_styleIndex) for O(1) dedup instead of
 * scanning all entries with JSON.stringify on every call.
 */
function findOrCreateVar(globalVars: GlobalVars, value: StyleTypes, prefix: string): string {
  if (!globalVars._styleIndex) {
    globalVars._styleIndex = new Map();
  }

  if (!globalVars._refCounts) {
    globalVars._refCounts = new Map();
  }

  const key = hashStyleValue(value);
  const existing = globalVars._styleIndex.get(key);
  if (existing) {
    globalVars._refCounts.set(existing, (globalVars._refCounts.get(existing) ?? 1) + 1);
    return existing;
  }

  const varId = generateVarId(prefix);
  globalVars.styles[varId] = value;
  globalVars._styleIndex.set(key, varId);
  globalVars._refCounts.set(varId, 1);
  return varId;
}

/**
 * Extracts layout-related properties from a node.
 */
export const layoutExtractor: ExtractorFn = (node, result, context) => {
  const layout = buildSimplifiedLayout(node, context.parent);
  if (Object.keys(layout).length > 1) {
    result.layout = findOrCreateVar(context.globalVars, layout, "layout");
  }
};

/**
 * Extracts text content and text styling from a node.
 */
export const textExtractor: ExtractorFn = (node, result, context) => {
  // Extract text content
  if (isTextNode(node)) {
    result.text = extractNodeText(node);
  }

  // Extract text style
  if (hasTextStyle(node)) {
    const textStyle = extractTextStyle(node);
    if (textStyle) {
      // Prefer Figma named style when available
      const styleName = getStyleName(node, context, ["text", "typography"]);
      if (styleName) {
        context.globalVars.styles[styleName] = textStyle;
        result.textStyle = styleName;
      } else {
        result.textStyle = findOrCreateVar(context.globalVars, textStyle, "style");
      }
    }
  }
};

/**
 * Extracts visual appearance properties (fills, strokes, effects, opacity, border radius).
 */
export const visualsExtractor: ExtractorFn = (node, result, context) => {
  // Check if node has children to determine CSS properties
  const hasChildren =
    hasValue("children", node) && Array.isArray(node.children) && node.children.length > 0;

  // fills
  if (hasValue("fills", node) && Array.isArray(node.fills) && node.fills.length) {
    const fills = node.fills.map((fill) => parsePaint(fill, hasChildren)).reverse();
    const styleName = getStyleName(node, context, ["fill", "fills"]);
    if (styleName) {
      context.globalVars.styles[styleName] = fills;
      result.fills = styleName;
    } else {
      result.fills = findOrCreateVar(context.globalVars, fills, "fill");
    }
  }

  // strokes
  const strokes = buildSimplifiedStrokes(node, hasChildren);
  if (strokes.colors.length) {
    const styleName = getStyleName(node, context, ["stroke", "strokes"]);
    if (styleName) {
      // Only colors are stylable; keep other stroke props on the node
      context.globalVars.styles[styleName] = strokes.colors;
      result.strokes = styleName;
      if (strokes.strokeWeight) result.strokeWeight = strokes.strokeWeight;
      if (strokes.strokeDashes) result.strokeDashes = strokes.strokeDashes;
      if (strokes.strokeWeights) result.strokeWeights = strokes.strokeWeights;
    } else {
      result.strokes = findOrCreateVar(context.globalVars, strokes, "stroke");
    }
  }

  // effects
  const effects = buildSimplifiedEffects(node);
  if (Object.keys(effects).length) {
    const styleName = getStyleName(node, context, ["effect", "effects"]);
    if (styleName) {
      // Effects styles store only the effect values
      context.globalVars.styles[styleName] = effects;
      result.effects = styleName;
    } else {
      result.effects = findOrCreateVar(context.globalVars, effects, "effect");
    }
  }

  // opacity
  if (hasValue("opacity", node) && typeof node.opacity === "number" && node.opacity !== 1) {
    result.opacity = node.opacity;
  }

  // border radius
  if (hasValue("cornerRadius", node) && typeof node.cornerRadius === "number") {
    result.borderRadius = `${node.cornerRadius}px`;
  }
  if (hasValue("rectangleCornerRadii", node, isRectangleCornerRadii)) {
    result.borderRadius = `${node.rectangleCornerRadii[0]}px ${node.rectangleCornerRadii[1]}px ${node.rectangleCornerRadii[2]}px ${node.rectangleCornerRadii[3]}px`;
  }
};

/**
 * Extracts component-related properties from INSTANCE nodes.
 */
export const componentExtractor: ExtractorFn = (node, result, _context) => {
  if (node.type === "INSTANCE") {
    if (hasValue("componentId", node)) {
      result.componentId = node.componentId;
    }

    // Add specific properties for instances of components
    if (hasValue("componentProperties", node)) {
      result.componentProperties = Object.entries(node.componentProperties ?? {}).map(
        ([name, { value, type }]) => ({
          name,
          value: String(value),
          type,
        }),
      );
    }
  }
};

// Helper to fetch a Figma style name for specific style keys on a node
function getStyleName(
  node: FigmaDocumentNode,
  context: TraversalContext,
  keys: string[],
): string | undefined {
  if (!hasValue("styles", node)) return undefined;
  const styleMap = node.styles as Record<string, string>;
  for (const key of keys) {
    const styleId = styleMap[key];
    if (styleId) {
      const meta = context.globalVars.extraStyles?.[styleId];
      if (meta?.name) return meta.name;
    }
  }
  return undefined;
}

// -------------------- CONVENIENCE COMBINATIONS --------------------

/**
 * All extractors - replicates the current parseNode behavior.
 */
export const allExtractors = [layoutExtractor, textExtractor, visualsExtractor, componentExtractor];

/**
 * Layout and text only - useful for content analysis and layout planning.
 */
export const layoutAndText = [layoutExtractor, textExtractor];

/**
 * Text content only - useful for content audits and copy extraction.
 */
export const contentOnly = [textExtractor];

/**
 * Visuals only - useful for design system analysis and style extraction.
 */
export const visualsOnly = [visualsExtractor];

/**
 * Layout only - useful for structure analysis.
 */
export const layoutOnly = [layoutExtractor];

// -------------------- AFTER CHILDREN HELPERS --------------------

/**
 * Node types that can be exported as SVG images.
 * When a FRAME, GROUP, or INSTANCE contains only these types, we can collapse it to IMAGE-SVG.
 * Note: FRAME/GROUP/INSTANCE are NOT included here—they're only eligible if collapsed to IMAGE-SVG.
 */
export const SVG_ELIGIBLE_TYPES = new Set([
  "IMAGE-SVG", // VECTOR nodes are converted to IMAGE-SVG, or containers that were collapsed
  "STAR",
  "LINE",
  "ELLIPSE",
  "REGULAR_POLYGON",
  "RECTANGLE",
]);

/**
 * afterChildren callback that collapses SVG-heavy containers to IMAGE-SVG.
 *
 * If a FRAME, GROUP, or INSTANCE contains only SVG-eligible children, the parent
 * is marked as IMAGE-SVG and children are omitted, reducing payload size.
 *
 * @param node - Original Figma node
 * @param result - SimplifiedNode being built
 * @param children - Processed children
 * @returns Children to include (empty array if collapsed)
 */
export function collapseSvgContainers(
  node: FigmaDocumentNode,
  result: SimplifiedNode,
  children: SimplifiedNode[],
): SimplifiedNode[] {
  const allChildrenAreSvgEligible = children.every((child) => SVG_ELIGIBLE_TYPES.has(child.type));

  if (
    (node.type === "FRAME" || node.type === "GROUP" || node.type === "INSTANCE") &&
    allChildrenAreSvgEligible &&
    !hasImageFillInChildren(node)
  ) {
    // Collapse to IMAGE-SVG and omit children
    result.type = "IMAGE-SVG";
    return [];
  }

  // Include all children normally
  return children;
}

/**
 * Check whether a node or its direct children have image fills.
 *
 * Only direct children need checking because afterChildren runs bottom-up:
 * if a deeper descendant has image fills, its parent won't collapse (stays FRAME),
 * and FRAME isn't SVG-eligible, so the chain breaks naturally at each level.
 */
function hasImageFillInChildren(node: FigmaDocumentNode): boolean {
  if (hasValue("fills", node) && node.fills.some((fill) => fill.type === "IMAGE")) {
    return true;
  }
  if (hasValue("children", node)) {
    return node.children.some(
      (child) => hasValue("fills", child) && child.fills.some((fill) => fill.type === "IMAGE"),
    );
  }
  return false;
}
