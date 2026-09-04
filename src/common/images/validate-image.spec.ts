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
  it('rejects excessive dimensions', async () => {
    await expect(
      validateImage(await png(801, 400), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
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
