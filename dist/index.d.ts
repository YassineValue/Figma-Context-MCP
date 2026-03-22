import { Transform, ComponentPropertyType, Node, Style, GetFileResponse, GetFileNodesResponse } from '@figma/rest-api-spec';

type SimplifiedTextStyle = Partial<{
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    lineHeight: string;
    letterSpacing: string;
    textCase: string;
    textAlignHorizontal: string;
    textAlignVertical: string;
}>;

interface SimplifiedLayout {
    mode: "none" | "row" | "column";
    justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "baseline" | "stretch";
    alignItems?: "flex-start" | "flex-end" | "center" | "space-between" | "baseline" | "stretch";
    alignSelf?: "flex-start" | "flex-end" | "center" | "stretch";
    wrap?: boolean;
    gap?: string;
    locationRelativeToParent?: {
        x: number;
        y: number;
    };
    dimensions?: {
        width?: number;
        height?: number;
        aspectRatio?: number;
    };
    padding?: string;
    sizing?: {
        horizontal?: "fixed" | "fill" | "hug";
        vertical?: "fixed" | "fill" | "hug";
    };
    overflowScroll?: ("x" | "y")[];
    position?: "absolute";
}

type CSSRGBAColor = `rgba(${number}, ${number}, ${number}, ${number})`;
type CSSHexColor = `#${string}`;
type SimplifiedImageFill = {
    type: "IMAGE";
    imageRef: string;
    scaleMode: "FILL" | "FIT" | "TILE" | "STRETCH";
    scalingFactor?: number;
    backgroundSize?: string;
    backgroundRepeat?: string;
    isBackground?: boolean;
    objectFit?: string;
    imageDownloadArguments?: {
        needsCropping: boolean;
        requiresImageDimensions: boolean;
        cropTransform?: Transform;
        filenameSuffix?: string;
    };
};
type SimplifiedGradientFill = {
    type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
    gradient: string;
};
type SimplifiedPatternFill = {
    type: "PATTERN";
    patternSource: {
        type: "IMAGE-PNG";
        nodeId: string;
    };
    backgroundRepeat: string;
    backgroundSize: string;
    backgroundPosition: string;
};
type SimplifiedFill = SimplifiedImageFill | SimplifiedGradientFill | SimplifiedPatternFill | CSSRGBAColor | CSSHexColor;
type SimplifiedStroke = {
    colors: SimplifiedFill[];
    strokeWeight?: string;
    strokeDashes?: number[];
    strokeWeights?: string;
};

type SimplifiedEffects = {
    boxShadow?: string;
    filter?: string;
    backdropFilter?: string;
    textShadow?: string;
};

interface ComponentProperties {
    name: string;
    value: string;
    type: ComponentPropertyType;
}
interface SimplifiedComponentDefinition {
    id: string;
    key: string;
    name: string;
    componentSetId?: string;
}
interface SimplifiedComponentSetDefinition {
    id: string;
    key: string;
    name: string;
    description?: string;
}

type StyleTypes = SimplifiedTextStyle | SimplifiedFill[] | SimplifiedLayout | SimplifiedStroke | SimplifiedEffects | string;
type GlobalVars = {
    styles: Record<string, StyleTypes>;
    _styleIndex?: Map<string, string>;
    _refCounts?: Map<string, number>;
};
interface TraversalContext {
    globalVars: GlobalVars & {
        extraStyles?: Record<string, Style>;
    };
    currentDepth: number;
    parent?: Node;
}
interface TraversalOptions {
    maxDepth?: number;
    nodeFilter?: (node: Node) => boolean;
    afterChildren?: (node: Node, result: SimplifiedNode, children: SimplifiedNode[]) => SimplifiedNode[];
}
type ExtractorFn = (node: Node, result: SimplifiedNode, context: TraversalContext) => void;
interface SimplifiedDesign {
    name: string;
    nodes: SimplifiedNode[];
    components: Record<string, SimplifiedComponentDefinition>;
    componentSets: Record<string, SimplifiedComponentSetDefinition>;
    globalVars: GlobalVars;
}
interface SimplifiedNode {
    id: string;
    name: string;
    type: string;
    text?: string;
    textStyle?: string;
    fills?: string;
    styles?: string;
    strokes?: string;
    strokeWeight?: string;
    strokeDashes?: number[];
    strokeWeights?: string;
    effects?: string;
    opacity?: number;
    borderRadius?: string;
    layout?: string;
    componentId?: string;
    componentProperties?: ComponentProperties[];
    children?: SimplifiedNode[];
}

declare function extractFromDesign(nodes: Node[], extractors: ExtractorFn[], options?: TraversalOptions, globalVars?: GlobalVars): {
    nodes: SimplifiedNode[];
    globalVars: GlobalVars;
};

declare function simplifyRawFigmaObject(apiResponse: GetFileResponse | GetFileNodesResponse, nodeExtractors: ExtractorFn[], options?: TraversalOptions): SimplifiedDesign;

declare const layoutExtractor: ExtractorFn;
declare const textExtractor: ExtractorFn;
declare const visualsExtractor: ExtractorFn;
declare const componentExtractor: ExtractorFn;
declare const allExtractors: ExtractorFn[];
declare const layoutAndText: ExtractorFn[];
declare const contentOnly: ExtractorFn[];
declare const visualsOnly: ExtractorFn[];
declare const layoutOnly: ExtractorFn[];
declare function collapseSvgContainers(node: Node, result: SimplifiedNode, children: SimplifiedNode[]): SimplifiedNode[];

export { type ExtractorFn, type GlobalVars, type SimplifiedDesign, type StyleTypes, type TraversalContext, type TraversalOptions, allExtractors, collapseSvgContainers, componentExtractor, contentOnly, extractFromDesign, layoutAndText, layoutExtractor, layoutOnly, simplifyRawFigmaObject, textExtractor, visualsExtractor, visualsOnly };
