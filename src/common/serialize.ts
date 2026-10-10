export function camel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camel(v),
      ]),
    );
  return value;
}

export function snake(data: object) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()),
      v,
    ]),
  );
}
