import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transform, GetFileResponse, GetFileNodesResponse } from '@figma/rest-api-spec';
import { Server } from 'http';

type CropRegion = {
    left: number;
    top: number;
    width: number;
    height: number;
};
type ImageProcessingResult = {
    filePath: string;
    originalDimensions: {
        width: number;
        height: number;
    };
    finalDimensions: {
        width: number;
        height: number;
    };
    wasCropped: boolean;
    cropRegion?: CropRegion;
    cssVariables?: string;
};

type FigmaCachingOptions = {
    cacheDir: string;
    ttlMs: number;
};

type FigmaAuthOptions = {
    figmaApiKey: string;
    figmaOAuthToken: string;
    useOAuth: boolean;
};
type CacheInfo = {
    usedCache: boolean;
    cachedAt?: number;
    ttlMs?: number;
};
type SvgOptions = {
    outlineText: boolean;
    includeId: boolean;
    simplifyStroke: boolean;
};
declare class FigmaService {
    private readonly apiKey;
    private readonly oauthToken;
    private readonly useOAuth;
    private readonly baseUrl;
    private readonly fileCache?;
    private readonly inflight;
    constructor({ figmaApiKey, figmaOAuthToken, useOAuth }: FigmaAuthOptions, cachingOptions?: FigmaCachingOptions);
    private getAuthHeaders;
    private filterValidImages;
    private request;
    private buildSvgQueryParams;
    getImageFillUrls(fileKey: string): Promise<Record<string, string>>;
    getNodeRenderUrls(fileKey: string, nodeIds: string[], format: "png" | "svg", options?: {
        pngScale?: number;
        svgOptions?: SvgOptions;
    }): Promise<Record<string, string>>;
    downloadImages(fileKey: string, localPath: string, items: Array<{
        imageRef?: string;
        nodeId?: string;
        fileName: string;
        needsCropping?: boolean;
        cropTransform?: Transform;
        requiresImageDimensions?: boolean;
    }>, options?: {
        pngScale?: number;
        svgOptions?: SvgOptions;
    }): Promise<ImageProcessingResult[]>;
    getRawFile(fileKey: string, depth?: number | null): Promise<{
        data: GetFileResponse;
        cacheInfo: CacheInfo;
    }>;
    getRawNode(fileKey: string, nodeId: string, depth?: number | null): Promise<{
        data: GetFileNodesResponse;
        cacheInfo: CacheInfo;
    }>;
    private loadFileFromCache;
    private fetchFileFromApi;
}

type CreateServerOptions = {
    outputFormat?: "yaml" | "json";
    skipImageDownloads?: boolean;
    imageDir?: string;
    caching?: FigmaCachingOptions;
};
declare function createServer(authOptions: FigmaAuthOptions, { outputFormat, skipImageDownloads, imageDir, caching, }?: CreateServerOptions): McpServer;

interface ServerConfig {
    auth: FigmaAuthOptions;
    port: number;
    host: string;
    outputFormat: "yaml" | "json";
    skipImageDownloads?: boolean;
    imageDir: string;
    caching?: FigmaCachingOptions;
}
declare function getServerConfig(isStdioMode: boolean): ServerConfig;

declare function startServer(): Promise<void>;
declare function startHttpServer(host: string, port: number, createMcpServer: () => McpServer): Promise<Server>;
declare function stopHttpServer(): Promise<void>;

declare const Metrics: {
    cacheHits: number;
    cacheMisses: number;
    apiCalls: number;
    reset(): void;
    summary(): string;
};

export { FigmaService, Metrics, createServer, getServerConfig, startHttpServer, startServer, stopHttpServer };
