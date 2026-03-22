import { Jimp } from "jimp";
import type { Transform } from "@figma/rest-api-spec";

type CropRegion = { left: number; top: number; width: number; height: number };

/**
 * Compute crop region from a Figma transform matrix and image dimensions.
 * Shared between applyCropTransform and downloadAndProcessImage.
 */
function computeCropRegion(
  transform: Transform,
  imageWidth: number,
  imageHeight: number,
): CropRegion | null {
  const scaleX = transform[0]?.[0] ?? 1;
  const translateX = transform[0]?.[2] ?? 0;
  const scaleY = transform[1]?.[1] ?? 1;
  const translateY = transform[1]?.[2] ?? 0;

  const left = Math.max(0, Math.round(translateX * imageWidth));
  const top = Math.max(0, Math.round(translateY * imageHeight));
  const width = Math.min(imageWidth - left, Math.round(scaleX * imageWidth));
  const height = Math.min(imageHeight - top, Math.round(scaleY * imageHeight));

  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

/**
 * Apply crop transform to an image based on Figma's transformation matrix.
 * Returns the crop region that was applied (or null if skipped).
 */
export async function applyCropTransform(
  imagePath: string,
  cropTransform: Transform,
): Promise<{ path: string; cropRegion: CropRegion | null }> {
  const { Logger } = await import("./logger.js");

  try {
    const image = await Jimp.read(imagePath);
    const region = computeCropRegion(cropTransform, image.width, image.height);

    if (!region) {
      Logger.log(`Invalid crop dimensions for ${imagePath}, using original image`);
      return { path: imagePath, cropRegion: null };
    }

    image.crop({ x: region.left, y: region.top, w: region.width, h: region.height });
    await image.write(imagePath as `${string}.${string}`);

    Logger.log(`Cropped image saved: ${imagePath}`);
    Logger.log(
      `Crop region: ${region.left}, ${region.top}, ${region.width}x${region.height} from ${image.width}x${image.height}`,
    );

    return { path: imagePath, cropRegion: region };
  } catch (error) {
    Logger.error(`Error cropping image ${imagePath}:`, error);
    return { path: imagePath, cropRegion: null };
  }
}

export type ImageProcessingResult = {
  filePath: string;
  originalDimensions: { width: number; height: number };
  finalDimensions: { width: number; height: number };
  wasCropped: boolean;
  cropRegion?: CropRegion;
  cssVariables?: string;
};

/**
 * Download a Figma image, optionally crop it, and return processing results.
 * Reads the image once with Jimp and reuses the instance for dimensions + cropping.
 */
export async function downloadAndProcessImage(
  fileName: string,
  localPath: string,
  imageUrl: string,
  needsCropping: boolean = false,
  cropTransform?: Transform,
  requiresImageDimensions: boolean = false,
): Promise<ImageProcessingResult> {
  const { Logger } = await import("./logger.js");
  const { downloadFigmaImage } = await import("./common.js");
  const originalPath = await downloadFigmaImage(fileName, localPath, imageUrl);
  Logger.log(`Downloaded original image: ${originalPath}`);

  // SVGs are vector -- jimp can't read them and cropping/dimensions don't apply
  if (fileName.toLowerCase().endsWith(".svg")) {
    return {
      filePath: originalPath,
      originalDimensions: { width: 0, height: 0 },
      finalDimensions: { width: 0, height: 0 },
      wasCropped: false,
    };
  }

  // Read image once with Jimp — reuse for dimensions and cropping
  const image = await Jimp.read(originalPath);
  const originalDimensions = { width: image.width, height: image.height };
  Logger.log(`Original dimensions: ${originalDimensions.width}x${originalDimensions.height}`);

  let wasCropped = false;
  let cropRegion: CropRegion | undefined;

  // Apply crop transform if needed (skip for GIFs -- cropping destroys animation frames)
  if (needsCropping && cropTransform && !fileName.toLowerCase().endsWith(".gif")) {
    Logger.log("Applying crop transform...");
    const region = computeCropRegion(cropTransform, image.width, image.height);

    if (region) {
      image.crop({ x: region.left, y: region.top, w: region.width, h: region.height });
      await image.write(originalPath as `${string}.${string}`);
      cropRegion = region;
      wasCropped = true;
      Logger.log(`Cropped to region: ${region.left}, ${region.top}, ${region.width}x${region.height}`);
    } else {
      Logger.log("Invalid crop dimensions, keeping original image");
    }
  }

  const finalDimensions = { width: image.width, height: image.height };
  Logger.log(`Final dimensions: ${finalDimensions.width}x${finalDimensions.height}`);

  let cssVariables: string | undefined;
  if (requiresImageDimensions) {
    cssVariables = `--original-width: ${finalDimensions.width}px; --original-height: ${finalDimensions.height}px;`;
  }

  return {
    filePath: originalPath,
    originalDimensions,
    finalDimensions,
    wasCropped,
    cropRegion,
    cssVariables,
  };
}
