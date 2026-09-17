import { ServiceUnavailableException } from '@nestjs/common';
import { DepartmentIconsService } from './department-icons.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('Icon catalogue deadlines', () => {
  const rows = [
    {
      id: 'builtin',
      name: 'Built in',
      is_active: true,
      builtin_key: 'engineering',
      storage_path: null,
    },
    {
      id: 'upload',
      name: 'Uploaded',
      is_active: true,
      builtin_key: null,
      storage_path: 'published/icon.png',
    },
  ];
  function setup(database: Promise<unknown>, storage: Promise<unknown>) {
    const query = {
      select: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: database.then.bind(database),
    };
    const createSignedUrls = jest.fn().mockReturnValue(storage);
    const service = new DepartmentIconsService({
      adminClient: {
        from: jest.fn().mockReturnValue(query),
        storage: { from: jest.fn().mockReturnValue({ createSignedUrls }) },
      },
    } as unknown as SupabaseService);
    return { service, createSignedUrls };
  }
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('returns 503 instead of waiting indefinitely for the database', async () => {
    const { service } = setup(
      new Promise(() => {}),
      Promise.resolve({ data: [], error: null }),
    );
    const result = expect(
      service.list({ page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(10000);
    await result;
    expect(jest.getTimerCount()).toBe(0);
  });
  it('returns metadata after five seconds when storage stalls', async () => {
    const { service } = setup(
      Promise.resolve({ data: rows, count: 2, error: null }),
      new Promise(() => {}),
    );
    const result = service.list({ page: 1, limit: 20 });
    await jest.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({
      total: 2,
      items: [
        { id: 'builtin', url: null },
        { id: 'upload', url: null },
      ],
    });
    expect(jest.getTimerCount()).toBe(0);
  });
  it('signs uploaded icons in one batch and clears the timeout on success', async () => {
    const { service, createSignedUrls } = setup(
      Promise.resolve({ data: rows, count: 2, error: null }),
      Promise.resolve({
        data: [
          {
            path: 'published/icon.png',
            signedUrl: 'https://storage.example/icon?token=signed',
            error: null,
          },
        ],
        error: null,
      }),
    );
    expect((await service.list({ page: 1, limit: 20 })).items[1].url).toBe(
      'https://storage.example/icon?token=signed',
    );
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['published/icon.png'], 3600);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('still returns the catalogue when signing rejects', async () => {
    const { service } = setup(
      Promise.resolve({ data: rows, count: 2, error: null }),
      Promise.resolve().then(() => {
        throw new Error('offline');
      }),
    );
    expect(
      (await service.list({ page: 1, limit: 20 }, true)).items,
    ).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
