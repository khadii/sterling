import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { DepartmentIconsService } from './department-icons.service';

describe('DepartmentIconsService permanent deletion', () => {
  function setup(
    data: unknown = ['published/icon.png'],
    error: unknown = null,
  ) {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data, error })
      .mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const service = new DepartmentIconsService({
      adminClient: {
        rpc,
        storage: { from: jest.fn().mockReturnValue({ remove }) },
      },
    } as unknown as SupabaseService);
    return { service, rpc, remove };
  }
  it('removes files before physically deleting the record', async () => {
    const { service, rpc, remove } = setup();
    await service.remove('id');
    expect(remove).toHaveBeenCalledWith(['published/icon.png']);
    expect(rpc).toHaveBeenLastCalledWith('finish_department_icon_deletion', {
      p_icon_id: 'id',
    });
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[1],
    );
  });
  it('deletes unused built-ins without storage calls', async () => {
    const { service, remove } = setup([]);
    await service.remove('id');
    expect(remove).not.toHaveBeenCalled();
  });
  it.each(['22023', '23503'])(
    'protects default and referenced icons (%s)',
    async (code) => {
      const { service, remove } = setup(null, { code });
      await expect(service.remove('id')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it('returns 404 for a missing icon', async () => {
    const { service } = setup(null);
    await expect(service.remove('id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('retains the record for retry on storage failure', async () => {
    const { service, rpc, remove } = setup();
    remove.mockResolvedValue({ error: { message: 'offline' } });
    await expect(service.remove('id')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
