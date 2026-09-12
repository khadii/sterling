import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { safeSvg } from './safe-svg';

export function normalizeImageContentType(contentType: string): string {
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

const MAX_DECODABLE_PIXELS = 16_000_000;

/** Decode rather than trust filename/MIME. SVG is allowlisted before any renderer sees it. */
export async function validateImage(
  input: Buffer,
  contentType: string,
  maxWidth = 800,
  maxHeight = 400,
): Promise<Buffer> {
  contentType = normalizeImageContentType(contentType);
  if (!input.length || input.length > 5_242_880)
    throw new BadRequestException('Image must be between 1 byte and 5 MB');
  let body = input;
  if (contentType === 'image/svg+xml') {
    const source = input
      .toString('utf8')
      .trim()
      .replace(/^<\?xml[^>]*>\s*/i, '');
    if (!source.startsWith('<svg') || /<!DOCTYPE|<!ENTITY/i.test(source))
      throw new BadRequestException('Invalid SVG');
    const clean = safeSvg(source);
    body = Buffer.from(clean);
  }
  try {
    const image = sharp(body, {
      // Allow normal camera/design source sizes, but cap decompression work.
      // The output is resized to the endpoint's maximum dimensions below.
      limitInputPixels: MAX_DECODABLE_PIXELS,
      // Metadata/profile warnings are common in valid user-supplied images.
      // Decode errors still fail, but harmless warnings must not reject uploads.
      failOn: 'error',
    });
    const metadata = await image.metadata();
    const expected: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpeg',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
    };
    if (!expected[contentType] || metadata.format !== expected[contentType])
      throw new Error('type');
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
      throw new Error('dimensions');
    // No active SVG markup, embedded metadata, or animation is served to clients.
    const output = await image
      .rotate()
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (output.info.width > maxWidth || output.info.height > maxHeight)
      throw new Error('oriented dimensions');
    return output.data;
  } catch {
    throw new BadRequestException(
      `Invalid image: upload a valid single-frame PNG, JPEG, GIF or SVG under the size limit; it will be resized to ${maxWidth} × ${maxHeight} pixels`,
    );
  }
}
