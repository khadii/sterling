import { Injectable } from '@nestjs/common';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import {
  IndustryQueryDto,
  SuggestionQueryDto,
} from './dto/reference-query.dto';

interface IndustryRecord {
  id: string;
  name: string;
  category: string | null;
  is_active: boolean;
  is_popular: boolean;
}

interface DepartmentSuggestionRecord {
  icon_id: string;
  name: string;
  description: string | null;
  is_popular: boolean;
}

@Injectable()
export class ReferenceService {
  constructor(private readonly supabase: SupabaseService) {}

  async industries(query: IndustryQueryDto) {
    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;
    let request = this.supabase.adminClient
      .from('industries')
      .select('id,name,category,is_active,is_popular', { count: 'exact' })
      .eq('is_active', true)
      .order('is_popular', { ascending: false })
      .order('name')
      .range(from, to);
    const search = query.search?.trim().replace(/[%_]/g, '');
    if (search) request = request.ilike('name', `%${search}%`);
    const { data, error, count } = await request;
    if (error) throw mapDatabaseError(error, 'load industries');
    const total = count ?? 0;
    const industries = data as unknown as IndustryRecord[];
    return {
      items: industries.map((industry) => ({
        id: industry.id,
        name: industry.name,
        category: industry.category,
        active: industry.is_active,
        popular: industry.is_popular,
      })),
      page: query.page,
      limit: query.limit,
      total,
      hasMore: to + 1 < total,
    };
  }

  async departmentSuggestions(query: SuggestionQueryDto) {
    const { data, error } = await this.supabase.adminClient
      .from('department_suggestions')
      .select('name,description,is_popular,display_order,icon_id')
      .order('display_order')
      .limit(query.limit);
    if (error) throw mapDatabaseError(error, 'load department suggestions');
    const rows = data as unknown as DepartmentSuggestionRecord[];
    const suggestions = rows.map((item) => ({
      iconId: item.icon_id,
      name: item.name,
      description: item.description,
      popular: item.is_popular,
    }));
    return {
      suggestions,
      defaultSuggestion: suggestions.find(
        (item) => item.name === 'General',
      ) ?? {
        name: 'General',
        description: 'General company operations',
        popular: true,
      },
    };
  }
}
