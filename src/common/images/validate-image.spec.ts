import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { validateImage } from './validate-image';

describe('validateImage', () => {
  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 4, background: '#123456' } })
      .png()
      .toBuffer();
  it('accepts a boundary-size logo and emits a PNG', async () => {
    const output = await validateImage(await png(800, 400), 'image/png');
    expect((await sharp(output).metadata()).format).toBe('png');
  });
  it.each([
    ['image/jpeg', 'jpeg'],
    ['image/gif', 'gif'],
  ] as const)('accepts a valid %s image', async (contentType, format) => {
    const input = await sharp({
      create: { width: 64, height: 64, channels: 4, background: '#123456' },
    })
      [format]()
      .toBuffer();
    const output = await validateImage(input, contentType, 256, 256);
    expect((await sharp(output).metadata()).format).toBe('png');
  });
  it('accepts the common image/jpg MIME alias as JPEG', async () => {
    const input = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
    await expect(validateImage(input, 'image/jpg', 256, 256)).resolves.toEqual(
      expect.any(Buffer),
    );
  });
  it('resizes valid source images above the display limit', async () => {
    const output = await validateImage(await png(801, 400), 'image/png');
    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(400);
  });
  it('rejects content-type spoofing and corrupt files', async () => {
    await expect(
      validateImage(await png(16, 16), 'image/jpeg'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateImage(Buffer.from('not an image'), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('strips active SVG and renders only a raster image', async () => {
    const source = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><script>alert(1)</script><rect width="24" height="24" fill="red" onclick="alert(1)"/><image href="https://example.com/secret"/></svg>',
    );
    const output = await validateImage(source, 'image/svg+xml', 256, 256);
    expect((await sharp(output).metadata()).format).toBe('png');
    expect(output.includes(Buffer.from('<script'))).toBe(false);
  });
  it('rejects SVG entity declarations', async () => {
    await expect(
      validateImage(Buffer.from('<!DOCTYPE svg><svg/>'), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
