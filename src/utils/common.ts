import { createWriteStream, existsSync, mkdirSync } from "fs";
import { unlink } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export type StyleId = `${string}_${string}` & { __brand: "StyleId" };

/**
 * Download a Figma image and save it locally using stream piping.
 * @returns Full file path where the image was saved
 */
export async function downloadFigmaImage(
  fileName: string,
  localPath: string,
  imageUrl: string,
): Promise<string> {
  if (!existsSync(localPath)) {
    mkdirSync(localPath, { recursive: true });
  }

  // Verify the resolved path stays within localPath (prevent path traversal)
  const fullPath = path.resolve(path.join(localPath, fileName));
  const resolvedLocalPath = path.resolve(localPath);
  if (!fullPath.startsWith(resolvedLocalPath + path.sep)) {
    throw new Error(`File path escapes target directory: ${fileName}`);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("Response has no body");
  }

  try {
    // Readable.fromWeb + pipeline handles backpressure, cleanup, and error propagation
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(fullPath));
  } catch (error) {
    // Clean up partial file on failure
    await unlink(fullPath).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error downloading image: ${message}`);
  }

  return fullPath;
}

/**
 * Generate a 6-character random variable ID
 * @param prefix - ID prefix
 * @returns A 6-character random ID string with prefix
 */
export function generateVarId(prefix: string = "var"): StyleId {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";

  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }

  return `${prefix}_${result}` as StyleId;
}

/**
 * Generate a CSS shorthand for values that come with top, right, bottom, and left
 *
 * input: { top: 10, right: 10, bottom: 10, left: 10 }
 * output: "10px"
 *
 * input: { top: 10, right: 20, bottom: 10, left: 20 }
 * output: "10px 20px"
 *
 * input: { top: 10, right: 20, bottom: 30, left: 40 }
 * output: "10px 20px 30px 40px"
 *
 * @param values - The values to generate the shorthand for
 * @returns The generated shorthand
 */
export function generateCSSShorthand(
  values: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  },
  {
    ignoreZero = true,
    suffix = "px",
  }: {
    /**
     * If true and all values are 0, return undefined. Defaults to true.
     */
    ignoreZero?: boolean;
    /**
     * The suffix to add to the shorthand. Defaults to "px".
     */
    suffix?: string;
  } = {},
) {
  const { top, right, bottom, left } = values;
  if (ignoreZero && top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined;
  }
  if (top === right && right === bottom && bottom === left) {
    return `${top}${suffix}`;
  }
  if (right === left) {
    if (top === bottom) {
      return `${top}${suffix} ${right}${suffix}`;
    }
    return `${top}${suffix} ${right}${suffix} ${bottom}${suffix}`;
  }
  return `${top}${suffix} ${right}${suffix} ${bottom}${suffix} ${left}${suffix}`;
}

/**
 * Check if an element is visible
 * @param element - The item to check
 * @returns True if the item is visible, false otherwise
 */
export function isVisible(element: { visible?: boolean }): boolean {
  return element.visible ?? true;
}

/**
 * Rounds a number to two decimal places, suitable for pixel value processing.
 * @param num The number to be rounded.
 * @returns The rounded number with two decimal places.
 * @throws TypeError If the input is not a valid number
 */
export function pixelRound(num: number): number {
  if (isNaN(num)) {
    throw new TypeError(`Input must be a valid number`);
  }
  return Number(Number(num).toFixed(2));
}
