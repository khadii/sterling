import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from './notification.service';
import { NotificationWorkerController } from './notification.controller';

function setup(jobs: object[] = []) {
  const rpc = jest.fn((name: string) => ({
    abortSignal: jest.fn().mockResolvedValue({
      data: name === 'claim_notification_emails' ? jobs : true,
      error: null,
    }),
  }));
  const getUserById = jest.fn().mockResolvedValue({
    data: {
      user: {
        email: 'member@example.test',
        email_confirmed_at: '2026-09-01',
      },
    },
    error: null,
  });
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest
      .fn()
      .mockResolvedValue({ data: { name: 'Example' }, error: null }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'SMTP_HOST'
        ? 'smtp.example.test'
        : key === 'NOTIFICATION_FRONTEND_URL'
          ? 'https://example.test/workspace'
          : key === 'NOTIFICATION_WORKER_SECRET'
            ? 'a'.repeat(32)
            : undefined,
    ),
  } as unknown as ConfigService;
  const mail = { send: jest.fn().mockResolvedValue({ messageId: 'message' }) };
  const service = new NotificationService(
    {
      adminClient: {
        rpc,
        from: jest.fn().mockReturnValue(query),
        auth: { admin: { getUserById } },
      },
    } as unknown as SupabaseService,
    config,
    mail as unknown as MailService,
  );
  return { service, rpc, mail, getUserById, config };
}
const job = {
  id: 'job1',
  lease_id: 'lease1',
  organization_id: 'org',
  recipient_id: 'member',
  recipient_email: null,
  subject: 'Assigned',
  body: 'A task was assigned.',
  kind: 'task.assigned',
  category: 'essential',
  payload: {},
};

it('delivers to the current verified account address and records the lease result', async () => {
  const { service, rpc, mail } = setup([job]);
  await expect(service.process()).resolves.toMatchObject({
    processed: 1,
    sent: 1,
  });
  expect(mail.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'member@example.test',
      text: expect.stringContaining(
        'https://example.test/workspace?organizationId=org',
      ) as unknown,
    }),
    0,
  );
  expect(rpc).toHaveBeenCalledWith('finish_notification_email', {
    p_id: 'job1',
    p_lease: 'lease1',
    p_success: true,
  });
});
it('records a delivery failure for durable retry rather than pretending it sent', async () => {
  const { service, rpc, mail } = setup([job]);
  mail.send.mockRejectedValue(new Error('SMTP offline'));
  await expect(service.process()).resolves.toMatchObject({
    sent: 0,
    retryOrFailed: 1,
  });
  expect(rpc).toHaveBeenCalledWith(
    'finish_notification_email',
    expect.objectContaining({ p_success: false }),
  );
});
it('does not email unverified user accounts', async () => {
  const { service, mail, getUserById } = setup([job]);
  getUserById.mockResolvedValue({
    data: { user: { email: 'changed@example.test' } },
    error: null,
  });
  await service.process();
  expect(mail.send).not.toHaveBeenCalled();
});
it('groups daily activity per recipient and workspace, with each lease acknowledged', async () => {
  const { service, mail, rpc } = setup([
    { ...job, category: 'activity', payload: { delivery: 'daily' } },
    {
      ...job,
      id: 'job2',
      lease_id: 'lease2',
      body: 'Another update',
      category: 'activity',
      payload: { delivery: 'daily' },
    },
  ]);
  await expect(service.process()).resolves.toEqual({
    processed: 2,
    sent: 2,
    retryOrFailed: 0,
  });
  expect(mail.send).toHaveBeenCalledTimes(1);
  expect(mail.send).toHaveBeenCalledWith(
    expect.objectContaining({
      subject: 'Your workspace activity summary',
      text: expect.stringContaining('Another update') as unknown,
    }),
    0,
  );
  expect(
    rpc.mock.calls.filter((x) => x[0] === 'finish_notification_email'),
  ).toHaveLength(2);
});
it('does not mix different organizations in a digest', async () => {
  const { service, mail } = setup([
    { ...job, category: 'activity', payload: { delivery: 'daily' } },
    {
      ...job,
      id: 'job2',
      organization_id: 'other',
      category: 'activity',
      payload: { delivery: 'daily' },
    },
  ]);
  await service.process();
  expect(mail.send).toHaveBeenCalledTimes(2);
});
it('puts invitation secrets in a fragment instead of a query or API response', async () => {
  const { service, mail, rpc } = setup([
    {
      ...job,
      recipient_id: null,
      recipient_email: 'invitee@example.test',
      kind: 'organization.invited',
      payload: { token: 'a'.repeat(64) },
    },
  ]);
  await service.process();
  expect(mail.send).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining('#invitationToken=') as unknown,
    }),
    0,
  );
  await service.invite('actor', 'org', {
    email: 'invitee@example.test',
    roleIds: ['role'],
  });
  const call = rpc.mock.calls.find(
    (x) => x[0] === 'create_organization_invitation',
  ) as unknown as [string, { p_token: string; p_hash: string }];
  expect(call[1].p_token).toMatch(/^[a-f0-9]{64}$/);
  expect(call[1].p_hash).not.toBe(call[1].p_token);
});
it('rejects missing and incorrect worker credentials before processing anything', () => {
  const { service, config } = setup();
  const process = jest
    .spyOn(service, 'process')
    .mockResolvedValue({ processed: 0, sent: 0, retryOrFailed: 0 });
  const controller = new NotificationWorkerController(config, service);
  expect(() => controller.process(undefined)).toThrow(UnauthorizedException);
  expect(() => controller.process('Bearer invalid')).toThrow(
    UnauthorizedException,
  );
  expect(process).not.toHaveBeenCalled();
  void controller.process(`Bearer ${'a'.repeat(32)}`);
  expect(process).toHaveBeenCalledTimes(1);
});

it('sends the workspace-ready welcome through the durable worker', async () => {
  const { service, mail } = setup([
    {
      ...job,
      kind: 'workspace.ready',
      subject: 'Your workspace is ready',
      body: 'Your workspace has been created successfully.',
    },
  ]);
  await expect(service.process()).resolves.toMatchObject({ sent: 1 });
  expect(mail.send).toHaveBeenCalledWith(
    expect.objectContaining({
      subject: 'Your workspace is ready',
      text: expect.stringContaining('created successfully') as unknown,
    }),
    0,
  );
});
it('does not claim mail when SMTP is missing', async () => {
  const { service, config, rpc } = setup([job]);
  jest
    .spyOn(config, 'get')
    .mockImplementation((key: string) =>
      key === 'NOTIFICATION_FRONTEND_URL' ? 'https://example.test' : undefined,
    );
  await expect(service.process()).rejects.toThrow('SMTP is not configured');
  expect(rpc).not.toHaveBeenCalled();
});
it('counts each failed digest record for retry', async () => {
  const { service, mail } = setup(
    [job, { ...job, id: 'job2' }].map((item) => ({
      ...item,
      category: 'activity',
      payload: { delivery: 'daily' },
    })),
  );
  mail.send.mockRejectedValue(new Error('offline'));
  await expect(service.process()).resolves.toEqual({
    processed: 2,
    sent: 0,
    retryOrFailed: 2,
  });
});
