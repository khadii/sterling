import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { UploadedFile as Upload } from '../common/types/uploaded-file.type';
import { WorkflowService } from './workflow.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';

export function validateTaskAttachment(file?: Upload) {
  if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024)
    throw new BadRequestException(
      'Upload a PDF or UTF-8 CSV file, 1 byte to 5 MiB',
    );
  const name = file.originalname.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(-160);
  const extension = name.split('.').pop()?.toLowerCase();
  let contentType: string;
  if (extension === 'pdf' && file.mimetype === 'application/pdf') {
    const text = file.buffer.toString('latin1');
    if (
      !text.startsWith('%PDF-') ||
      !/%%EOF\s*$/.test(text) ||
      /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/i.test(text)
    )
      throw new BadRequestException(
        'Invalid PDF or unsupported active PDF content',
      );
    contentType = 'application/pdf';
  } else if (
    extension === 'csv' &&
    ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(
      file.mimetype,
    )
  ) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new BadRequestException('CSV must be UTF-8 text');
    }
    if (
      !text.trim() ||
      file.buffer.some((byte) => byte < 32 && ![9, 10, 13].includes(byte)) ||
      /^\s*</.test(text)
    )
      throw new BadRequestException('Invalid CSV content');
    contentType = 'text/csv';
  } else
    throw new BadRequestException(
      'Task attachments must be PDF (.pdf) or UTF-8 CSV (.csv), maximum 5 MiB',
    );
  return {
    fileName: name,
    contentType,
    fileSize: file.buffer.length,
    extension,
  };
}

@Injectable()
export class TaskAttachmentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly workflow: WorkflowService,
  ) {}
  async upload(user: string, org: string, task: string, file?: Upload) {
    await this.workflow.detail(user, org, 'tasks', task);
    await this.workflow.access(user, org, 'tasks.manage');
    const meta = validateTaskAttachment(file);
    const path = `${org}/${task}/${randomUUID()}.${meta.extension}`;
    const bucket = this.supabase.adminClient.storage.from('task-attachments');
    const upload = await bucket.upload(path, file!.buffer, {
      contentType: meta.contentType,
      upsert: false,
    });
    if (upload.error)
      throw new ServiceUnavailableException('Unable to store task attachment');
    try {
      return await this.workflow.mutate(user, org, 'task.attach', task, {
        fileName: meta.fileName,
        contentType: meta.contentType,
        fileSize: meta.fileSize,
        storagePath: path,
      });
    } catch (error) {
      // A timed-out RPC may have committed. Never delete bytes referenced by a committed row.
      const saved = await this.supabase.adminClient
        .from('organization_task_attachments')
        .select('id')
        .eq('storage_path', path)
        .abortSignal(AbortSignal.timeout(10000))
        .maybeSingle();
      if (!saved.error && !saved.data) await bucket.remove([path]);
      throw error;
    }
  }
  async list(user: string, org: string, task: string) {
    await this.workflow.detail(user, org, 'tasks', task);
    const { data, error } = await this.supabase.adminClient
      .from('organization_task_attachments')
      .select('id,file_name,content_type,file_size,created_at')
      .eq('organization_id', org)
      .eq('task_id', task)
      .order('created_at')
      .limit(100)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load task attachments');
    return {
      items: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id,
        fileName: r.file_name,
        contentType: r.content_type,
        fileSize: r.file_size,
        createdAt: r.created_at,
      })),
    };
  }
  private async get(org: string, task: string, id: string) {
    const { data, error } = await this.supabase.adminClient
      .from('organization_task_attachments')
      .select('*')
      .eq('id', id)
      .eq('task_id', task)
      .eq('organization_id', org)
      .abortSignal(AbortSignal.timeout(10000))
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load task attachment');
    if (!data) throw new NotFoundException('Task attachment not found');
    return data as Record<string, unknown>;
  }
  async download(user: string, org: string, task: string, id: string) {
    await this.workflow.detail(user, org, 'tasks', task);
    const row = await this.get(org, task, id);
    const { data, error } = await this.supabase.adminClient.storage
      .from('task-attachments')
      .createSignedUrl(String(row.storage_path), 300, {
        download: String(row.file_name),
      });
    if (error || !data)
      throw new ServiceUnavailableException(
        'Unable to create attachment download URL',
      );
    return { url: data.signedUrl, expiresIn: 300 };
  }
  async remove(user: string, org: string, task: string, id: string) {
    await this.workflow.access(user, org, 'tasks.manage');
    const row = await this.get(org, task, id);
    const { error } = await this.supabase.adminClient.storage
      .from('task-attachments')
      .remove([String(row.storage_path)]);
    if (error)
      throw new ServiceUnavailableException(
        'Unable to remove attachment; retry later',
      );
    return this.workflow.mutate(user, org, 'task.detach', task, {
      attachmentId: id,
    });
  }

  async deleteTask(user: string, org: string, task: string) {
    await this.workflow.access(user, org, 'tasks.manage');
    const { data, error } = await this.supabase.adminClient
      .from('organization_task_attachments')
      .select('id')
      .eq('organization_id', org)
      .eq('task_id', task)
      .limit(100)
      .abortSignal(AbortSignal.timeout(10000));
    if (error)
      throw mapDatabaseError(error, 'load attachments for task deletion');
    for (const row of (data ?? []) as Record<string, unknown>[])
      await this.remove(user, org, task, String(row.id));
    // The DB refuses deletion if a concurrent upload has added another attachment.
    return this.workflow.mutate(user, org, 'task.delete', task, {});
  }
}
