import { HrQueryDto } from './hr.dto';
import { HrService } from './hr.service';
import { SupabaseService } from '../supabase/supabase.service';

function clientChain(response: unknown) {
  const calls: { range?: jest.Mock } = {};
  const node = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === 'abortSignal') return jest.fn(() => response);
        if (!calls[prop as keyof typeof calls])
          calls[prop as keyof typeof calls] = jest.fn(() => node);
        return calls[prop as keyof typeof calls];
      },
    },
  );
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
    expect(calls.range).toHaveBeenCalledWith(0, 499);
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

describe('Complete HR lists across the Data API row cap', () => {
  function batchedSetup(failAfterFirst = false, emptyAfterFirst = false) {
    const rows = Array.from({ length: 1203 }, (_, i) => ({
      id: String(i).padStart(5, '0'),
      organization_id: 'org',
      annual_salary: 0,
    }));
    const queries: {
      range?: [number, number];
      filters: [string, unknown][];
    }[] = [];
    const from = jest.fn(() => {
      const query: { range?: [number, number]; filters: [string, unknown][] } =
        { filters: [] };
      queries.push(query);
      const node: Record<string, unknown> = {
        select: jest.fn(() => node),
        eq: jest.fn((key: string, value: unknown) => {
          query.filters.push([key, value]);
          return node;
        }),
        order: jest.fn(() => node),
        range: jest.fn((start: number, end: number) => {
          query.range = [start, end];
          return node;
        }),
        abortSignal: jest.fn(() => {
          const [start, end] = query.range!;
          if (start > 0 && failAfterFirst)
            return Promise.resolve({
              data: null,
              error: { code: '57014', message: 'timeout' },
              count: null,
            });
          return Promise.resolve({
            data:
              start > 0 && emptyAfterFirst
                ? []
                : rows.slice(start, Math.min(end + 1, start + 137)),
            error: null,
            count: rows.length,
          });
        }),
      };
      return node;
    });
    const service = new HrService({
      adminClient: {
        from,
        rpc: jest.fn(() => ({
          abortSignal: () => Promise.resolve({ data: false, error: null }),
        })),
      },
    } as unknown as SupabaseService);
    return { service, queries };
  }

  it('returns more than 1000 records once each, without frontend pagination', async () => {
    const { service, queries } = batchedSetup();
    const result = await service.list(
      'actor',
      'org',
      'employees',
      new HrQueryDto(),
    );
    expect(result).toMatchObject({ total: 1203, limit: 1203, page: 1 });
    expect(result.items).toHaveLength(1203);
    expect(new Set(result.items.map((row) => row.id)).size).toBe(1203);
    expect(result.items.at(-1)).toMatchObject({
      id: '01202',
      annualSalary: null,
    });
    expect(queries[1].range).toEqual([137, 636]);
    expect(
      queries.every((q) =>
        q.filters.some(
          ([key, value]) => key === 'organization_id' && value === 'org',
        ),
      ),
    ).toBe(true);
  });

  it('preserves optional filters on every internal page', async () => {
    const { service, queries } = batchedSetup();
    await service.list(
      'actor',
      'org',
      'leave',
      Object.assign(new HrQueryDto(), { status: 'pending' }),
    );
    expect(queries).toHaveLength(9);
    expect(
      queries.every((q) =>
        q.filters.some(
          ([key, value]) => key === 'status' && value === 'pending',
        ),
      ),
    ).toBe(true);
  });

  it('uses a 50-record page when only page is supplied', async () => {
    const { service, queries } = batchedSetup();
    const result = await service.list(
      'actor',
      'org',
      'employees',
      Object.assign(new HrQueryDto(), { page: 2 }),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0].range).toEqual([50, 99]);
    expect(result).toMatchObject({ total: 1203, page: 2, limit: 50 });
    expect(result.items).toHaveLength(50);
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    'fails clearly instead of returning a partial list (error=%s, empty=%s)',
    async (fail, empty) => {
      const { service } = batchedSetup(fail, empty);
      await expect(
        service.list('actor', 'org', 'employees', new HrQueryDto()),
      ).rejects.toMatchObject({ status: 503 });
    },
  );
});
