import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { withRequestDeadline } from '../supabase/request-timeout';
import { UploadedFile } from '../common/types/uploaded-file.type';
import {
  normalizeImageContentType,
  validateImage,
} from '../common/images/validate-image';
import { IconQueryDto, IconUploadDto, UpdateIconDto } from './icon.dto';

const BUCKET = 'department-icons';
const PREVIEW_URL_TIMEOUT_MS = 5_000;
interface IconRow {
  id: string;
  name: string;
  is_active: boolean;
  builtin_key: string | null;
  storage_path: string | null;
}
interface UploadRow {
  id: string;
  created_by: string;
  name: string;
  content_type: string;
  file_size: number;
  storage_path: string;
  expires_at: string;
  icon_id: string | null;
}

@Injectable()
export class DepartmentIconsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(query: IconQueryDto, includeInactive = false) {
    const offset = (query.page - 1) * query.limit;
    let request = this.supabase.adminClient
      .from('department_icons')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('name')
      .order('id')
      .range(offset, offset + query.limit - 1);
    if (!includeInactive) request = request.eq('is_active', true);
    const { data, error, count } = await withRequestDeadline(request);
    if (error) throw mapDatabaseError(error, 'list department icons');
    const rows = (data ?? []) as IconRow[];
    const urls = await this.previewUrls(rows);
    return {
      items: rows.map((row) =>
        this.response(
          row,
          row.storage_path ? (urls.get(row.storage_path) ?? null) : null,
        ),
      ),
      page: query.page,
      limit: query.limit,
      total: count ?? 0,
      hasMore: offset + query.limit < (count ?? 0),
    };
  }

  async uploadUrl(userId: string, dto: IconUploadDto) {
    const id = randomUUID();
    const path = `pending/${userId}/${id}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await this.supabase.adminClient
      .from('department_icon_uploads')
      .insert({
        id,
        created_by: userId,
        name: dto.name,
        content_type: dto.contentType,
        file_size: dto.fileSize,
        storage_path: path,
        expires_at: expiresAt,
      } as never);
    if (error) throw mapDatabaseError(error, 'create icon upload');
    const { data, error: storageError } =
      await this.supabase.adminClient.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
    if (storageError || !data)
      throw new ServiceUnavailableException(
        'Icon storage is temporarily unavailable',
      );
    return {
      uploadId: id,
      uploadUrl: data.signedUrl,
      token: data.token,
      expiresAt,
    };
  }

  async upload(userId: string, name: string, file: UploadedFile) {
    const contentType = normalizeImageContentType(file.mimetype);
    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'].includes(
        contentType,
      )
    )
      throw new BadRequestException('Unsupported icon image type');
    if (!file.size || file.size > 1_048_576)
      throw new BadRequestException('Icon must be between 1 byte and 1 MB');

    const id = randomUUID();
    const path = `pending/${userId}/${id}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await this.supabase.adminClient
      .from('department_icon_uploads')
      .insert({
        id,
        created_by: userId,
        name,
        content_type: contentType,
        file_size: file.size,
        storage_path: path,
        expires_at: expiresAt,
      } as never);
    if (error) throw mapDatabaseError(error, 'create icon upload');

    const stored = await this.supabase.adminClient.storage
      .from(BUCKET)
      .upload(path, file.buffer, { contentType, upsert: false });
    if (stored.error) {
      await this.supabase.adminClient.storage.from(BUCKET).remove([path]);
      throw new ServiceUnavailableException('Unable to store icon upload');
    }
    return this.confirm(userId, id);
  }

  async confirm(userId: string, uploadId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('department_icon_uploads')
      .select('*')
      .eq('id', uploadId)
      .eq('created_by', userId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load icon upload');
    if (!data) throw new NotFoundException('Icon upload not found');
    const upload = data as UploadRow;
    if (upload.icon_id) return this.get(upload.icon_id);
    if (Date.parse(upload.expires_at) <= Date.now())
      throw new ConflictException('Icon upload expired; request another URL');
    const downloaded = await this.supabase.adminClient.storage
      .from(BUCKET)
      .download(upload.storage_path);
    if (downloaded.error || !downloaded.data)
      throw new NotFoundException('Uploaded icon not found');
    const input = Buffer.from(await downloaded.data.arrayBuffer());
    if (input.length !== upload.file_size || input.length > 1_048_576)
      throw new BadRequestException(
        'Icon size does not match the upload request',
      );
    let safe: Buffer;
    try {
      safe = await validateImage(input, upload.content_type, 256, 256);
    } catch (error) {
      await this.supabase.adminClient.storage
        .from(BUCKET)
        .remove([upload.storage_path]);
      throw error;
    }
    const finalPath = `published/${upload.id}.png`;
    const saved = await this.supabase.adminClient.storage
      .from(BUCKET)
      .upload(finalPath, safe, { contentType: 'image/png', upsert: true });
    if (saved.error)
      throw new ServiceUnavailableException('Unable to store verified icon');
    const confirmed = await this.supabase.adminClient.rpc(
      'confirm_department_icon',
      { p_user_id: userId, p_upload_id: upload.id } as never,
    );
    if (confirmed.error) {
      if (confirmed.error.code === '40001')
        throw new ConflictException('Icon upload expired');
      throw mapDatabaseError(confirmed.error, 'confirm department icon');
    }
    await this.supabase.adminClient.storage
      .from(BUCKET)
      .remove([upload.storage_path]);
    return this.get(confirmed.data);
  }

  async update(id: string, dto: UpdateIconDto) {
    if (dto.name == null && dto.active == null)
      throw new BadRequestException('Supply name or active');
    const patch: Record<string, unknown> = {};
    if (dto.name != null) patch.name = dto.name;
    if (dto.active != null) patch.is_active = dto.active;
    const { data, error } = await this.supabase.adminClient
      .from('department_icons')
      .update(patch as never)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle();
    if (error?.code === '22023')
      throw new BadRequestException('The default icon cannot be deactivated');
    if (error) throw mapDatabaseError(error, 'update department icon');
    if (!data) throw new NotFoundException('Department icon not found');
    return this.serialize(data);
  }

  async remove(id: string): Promise<void> {
    const { data, error } = await this.supabase.adminClient.rpc(
      'prepare_department_icon_deletion',
      { p_icon_id: id } as never,
    );
    if (error?.code === '22023' || error?.code === '23503')
      throw new ConflictException(
        'Default icons or icons still in use cannot be deleted',
      );
    if (error) throw mapDatabaseError(error, 'delete department icon');
    if (!data) throw new NotFoundException('Department icon not found');
    const paths = data as unknown as string[];
    if (paths.length) {
      const removed = await this.supabase.adminClient.storage
        .from(BUCKET)
        .remove(paths);
      if (removed.error)
        throw new ServiceUnavailableException(
          'Icon file deletion failed; retry deletion',
        );
    }
    const finished = await this.supabase.adminClient.rpc(
      'finish_department_icon_deletion',
      { p_icon_id: id } as never,
    );
    if (finished.error)
      throw mapDatabaseError(finished.error, 'finish icon deletion');
  }

  private async get(id: string) {
    const { data, error } = await this.supabase.adminClient
      .from('department_icons')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load department icon');
    if (!data) throw new NotFoundException('Department icon not found');
    return this.serialize(data);
  }

  private async serialize(row: IconRow) {
    const urls = await this.previewUrls([row]);
    return this.response(
      row,
      row.storage_path ? (urls.get(row.storage_path) ?? null) : null,
    );
  }

  private async previewUrls(rows: IconRow[]): Promise<Map<string, string>> {
    const paths = [
      ...new Set(
        rows.flatMap((row) => (row.storage_path ? [row.storage_path] : [])),
      ),
    ];
    const urls = new Map<string, string>();
    if (!paths.length) return urls;
    try {
      const signed = await withRequestDeadline(
        this.supabase.adminClient.storage
          .from(BUCKET)
          .createSignedUrls(paths, 3600),
        PREVIEW_URL_TIMEOUT_MS,
      );
      if (!signed.error)
        for (const item of signed.data ?? []) {
          if (!item.error && item.path && item.signedUrl)
            urls.set(item.path, item.signedUrl);
        }
    } catch {
      // Catalogue data is still usable when preview storage is unavailable.
    }
    return urls;
  }

  private response(row: IconRow, url: string | null) {
    return {
      id: row.id,
      name: row.name,
      active: row.is_active,
      builtinKey: row.builtin_key,
      imageStatus: row.storage_path
        ? url
          ? 'available'
          : 'temporarily_unavailable'
        : 'builtin',
      retryable: Boolean(row.storage_path && !url),
      url,
    };
  }
}
