import { HrQueryDto } from './hr.dto';
import { HrService } from './hr.service';
import { SupabaseService } from '../supabase/supabase.service';

function clientChain(response: unknown) {
  const calls: { range?: jest.Mock } = {};
  const node = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => {
      if (prop === 'abortSignal') return jest.fn(() => response);
      if (!calls[prop as keyof typeof calls])
        calls[prop as keyof typeof calls] = jest.fn(() => node);
      return calls[prop as keyof typeof calls];
    },
  });
  return { node, calls };
}

describe('HrService list pagination', () => {
  it('returns the full list when page and limit are omitted', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { node, calls } = clientChain({ data: rows, error: null, count: 2 });
    const service = new HrService({
      adminClient: {
        rpc: jest.fn(() => ({
          abortSignal: jest.fn(() => ({ data: true, error: null })),
        })),
        from: jest.fn(() => node),
      },
    } as unknown as SupabaseService);

    const result = await service.list(
      '8a53bff5-a952-4ad7-b466-730659020a8e',
      '8a53bff5-a952-4ad7-b466-730659020a8e',
      'employees',
      new HrQueryDto(),
    );

    expect(result).toMatchObject({ total: 2, page: 1, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(calls.range).toBeUndefined();
  });

  it('paginates when page and limit are supplied', async () => {
    const { node, calls } = clientChain({
      data: [{ id: 2 }],
      error: null,
      count: 2,
    });
    const service = new HrService({
      adminClient: {
        rpc: jest.fn(() => ({
          abortSignal: jest.fn(() => ({ data: true, error: null })),
        })),
        from: jest.fn(() => node),
      },
    } as unknown as SupabaseService);

    const result = await service.list(
      '8a53bff5-a952-4ad7-b466-730659020a8e',
      '8a53bff5-a952-4ad7-b466-730659020a8e',
      'employees',
      Object.assign(new HrQueryDto(), { page: 2, limit: 25 }),
    );

    expect(result).toMatchObject({ total: 2, page: 2, limit: 25 });
    expect(calls.range).toHaveBeenCalledWith(25, 49);
  });
});
