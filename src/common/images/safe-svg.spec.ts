import { safeSvg } from './safe-svg';

describe('safeSvg', () => {
  it('removes scripts, external resources, event handlers and animation', () => {
    const result = safeSvg(
      '<svg width="24" height="24"><script>bad()</script><image href="https://example.com"/><animate attributeName="href" values="javascript:bad()"/><path d="M0 0" onclick="bad()" fill="url(https://example.com/a)"/></svg>',
    );
    expect(result).not.toMatch(/script|image|animate|onclick|https:/);
    expect(result).toContain('<path d="M0 0">');
  });
  it('rejects malformed XML, external entities and excessive nesting', () => {
    expect(() => safeSvg('<svg><g></svg>')).toThrow();
    expect(() =>
      safeSvg(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
      ),
    ).toThrow();
    expect(() =>
      safeSvg('<svg>' + '<g>'.repeat(65) + '</g>'.repeat(65) + '</svg>'),
    ).toThrow();
  });
});
