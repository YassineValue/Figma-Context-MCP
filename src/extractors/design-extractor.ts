import type {
  GetFileResponse,
  GetFileNodesResponse,
  Node as FigmaDocumentNode,
  Component,
  ComponentSet,
  Style,
} from "@figma/rest-api-spec";
import { simplifyComponents, simplifyComponentSets } from "~/transformers/component.js";
import { isVisible } from "~/utils/common.js";
import type {
  ExtractorFn,
  TraversalOptions,
  SimplifiedDesign,
  SimplifiedNode,
  TraversalContext,
  StyleTypes,
} from "./types.js";
import { extractFromDesign } from "./node-walker.js";

/**
 * Extract a complete SimplifiedDesign from raw Figma API response using extractors.
 */
export function simplifyRawFigmaObject(
  apiResponse: GetFileResponse | GetFileNodesResponse,
  nodeExtractors: ExtractorFn[],
  options: TraversalOptions = {},
): SimplifiedDesign {
  // Extract components, componentSets, and raw nodes from API response
  const { metadata, rawNodes, components, componentSets, extraStyles } =
    parseAPIResponse(apiResponse);

  // Process nodes using the flexible extractor system
  const globalVars: TraversalContext["globalVars"] = { styles: {}, extraStyles };
  const { nodes: extractedNodes, globalVars: finalGlobalVars } = extractFromDesign(
    rawNodes,
    nodeExtractors,
    options,
    globalVars,
  );

  // Inline variables that are only referenced once to reduce output size.
  // Shared variables (referenced 2+) stay in globalVars for deduplication.
  const styles = inlineSingleUseVars(extractedNodes, finalGlobalVars.styles);

  return {
    ...metadata,
    nodes: extractedNodes,
    components: simplifyComponents(components),
    componentSets: simplifyComponentSets(componentSets),
    globalVars: { styles },
  };
}

// Style-referencing fields on SimplifiedNode that hold a globalVars key
const STYLE_REF_FIELDS = ["layout", "textStyle", "fills", "strokes", "effects"] as const;

/**
 * Inline global variables that are referenced by exactly one node.
 * This reduces output size by ~20-40% on typical Figma files by eliminating
 * indirection for styles that aren't actually shared.
 *
 * Mutates nodes in-place for efficiency (they're freshly created by extractors).
 * Returns the pruned styles map (only shared vars remain).
 */
function inlineSingleUseVars(
  nodes: SimplifiedNode[],
  styles: Record<string, StyleTypes>,
): Record<string, StyleTypes> {
  // Count how many times each variable ID is referenced across all nodes
  const refCounts = new Map<string, number>();
  visitNodes(nodes, (node) => {
    for (const field of STYLE_REF_FIELDS) {
      const varId = node[field];
      if (typeof varId === "string" && varId in styles) {
        refCounts.set(varId, (refCounts.get(varId) ?? 0) + 1);
      }
    }
  });

  // Collect single-use var IDs
  const singleUse = new Set<string>();
  for (const [varId, count] of refCounts) {
    if (count === 1) singleUse.add(varId);
  }

  if (singleUse.size === 0) return styles;

  // Replace var references with inline values on nodes
  visitNodes(nodes, (node) => {
    for (const field of STYLE_REF_FIELDS) {
      const varId = node[field];
      if (typeof varId === "string" && singleUse.has(varId)) {
        // Store the inlined value directly on the node
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic field assignment
        (node as any)[field] = styles[varId];
      }
    }
  });

  // Remove inlined vars from the shared styles map
  const pruned: Record<string, StyleTypes> = {};
  for (const [varId, value] of Object.entries(styles)) {
    if (!singleUse.has(varId)) {
      pruned[varId] = value;
    }
  }
  return pruned;
}

/** Depth-first visit of all nodes in the tree */
function visitNodes(nodes: SimplifiedNode[], fn: (node: SimplifiedNode) => void): void {
  for (const node of nodes) {
    fn(node);
    if (node.children) {
      visitNodes(node.children, fn);
    }
  }
}

/**
 * Parse the raw Figma API response to extract metadata, nodes, and components.
 */
function parseAPIResponse(data: GetFileResponse | GetFileNodesResponse) {
  const aggregatedComponents: Record<string, Component> = {};
  const aggregatedComponentSets: Record<string, ComponentSet> = {};
  let extraStyles: Record<string, Style> = {};
  let nodesToParse: Array<FigmaDocumentNode>;

  if ("nodes" in data) {
    // GetFileNodesResponse
    const nodeResponses = Object.values(data.nodes);
    nodeResponses.forEach((nodeResponse) => {
      if (nodeResponse.components) {
        Object.assign(aggregatedComponents, nodeResponse.components);
      }
      if (nodeResponse.componentSets) {
        Object.assign(aggregatedComponentSets, nodeResponse.componentSets);
      }
      if (nodeResponse.styles) {
        Object.assign(extraStyles, nodeResponse.styles);
      }
    });
    nodesToParse = nodeResponses.map((n) => n.document).filter(isVisible);
  } else {
    // GetFileResponse
    Object.assign(aggregatedComponents, data.components);
    Object.assign(aggregatedComponentSets, data.componentSets);
    if (data.styles) {
      extraStyles = data.styles;
    }
    nodesToParse = data.document.children.filter(isVisible);
  }

  const { name } = data;

  return {
    metadata: {
      name,
    },
    rawNodes: nodesToParse,
    extraStyles,
    components: aggregatedComponents,
    componentSets: aggregatedComponentSets,
  };
}
