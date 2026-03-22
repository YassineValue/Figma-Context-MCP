import type { Node as FigmaDocumentNode } from "@figma/rest-api-spec";
import { isVisible } from "~/utils/common.js";
import { hasValue } from "~/utils/identity.js";
import type {
  ExtractorFn,
  TraversalContext,
  TraversalOptions,
  GlobalVars,
  SimplifiedNode,
} from "./types.js";

/**
 * Extract data from Figma nodes using a flexible, single-pass approach.
 *
 * @param nodes - The Figma nodes to process
 * @param extractors - Array of extractor functions to apply during traversal
 * @param options - Traversal options (filtering, depth limits, etc.)
 * @param globalVars - Global variables for style deduplication
 * @returns Object containing processed nodes and updated global variables
 */
export function extractFromDesign(
  nodes: FigmaDocumentNode[],
  extractors: ExtractorFn[],
  options: TraversalOptions = {},
  globalVars: GlobalVars = { styles: {} },
): { nodes: SimplifiedNode[]; globalVars: GlobalVars } {
  const context: TraversalContext = {
    globalVars,
    currentDepth: 0,
  };

  const processedNodes = nodes
    .filter((node) => shouldProcessNode(node, options))
    .map((node) => processNodeWithExtractors(node, extractors, context, options))
    .filter((node): node is SimplifiedNode => node !== null);

  return {
    nodes: processedNodes,
    globalVars: context.globalVars,
  };
}

/**
 * Process a single node with all provided extractors in one pass.
 * Callers are responsible for pre-filtering with shouldProcessNode.
 */
function processNodeWithExtractors(
  node: FigmaDocumentNode,
  extractors: ExtractorFn[],
  context: TraversalContext,
  options: TraversalOptions,
): SimplifiedNode | null {
  // Always include base metadata
  const result: SimplifiedNode = {
    id: node.id,
    name: node.name,
    type: node.type === "VECTOR" ? "IMAGE-SVG" : node.type,
  };

  // Apply all extractors to this node in a single pass
  for (const extractor of extractors) {
    extractor(node, result, context);
  }

  // Handle children recursively (depth check inlined from shouldTraverseChildren)
  const withinDepth = options.maxDepth === undefined || context.currentDepth < options.maxDepth;
  if (withinDepth && hasValue("children", node) && node.children.length > 0) {
    const childContext: TraversalContext = {
      ...context,
      currentDepth: context.currentDepth + 1,
      parent: node,
    };

    const children = node.children
      .filter((child) => shouldProcessNode(child, options))
      .map((child) => processNodeWithExtractors(child, extractors, childContext, options))
      .filter((child): child is SimplifiedNode => child !== null);

    if (children.length > 0) {
      const childrenToInclude = options.afterChildren
        ? options.afterChildren(node, result, children)
        : children;

      if (childrenToInclude.length > 0) {
        result.children = childrenToInclude;
      }
    }
  }

  return result;
}

/**
 * Determine if a node should be processed based on filters.
 */
function shouldProcessNode(node: FigmaDocumentNode, options: TraversalOptions): boolean {
  if (!isVisible(node)) {
    return false;
  }

  if (options.nodeFilter && !options.nodeFilter(node)) {
    return false;
  }

  return true;
}
