import { BadRequestException, Injectable } from '@nestjs/common';
import * as countries from 'i18n-iso-countries';
import {
  CountriesQueryDto,
  LocalesQueryDto,
  TimezonesQueryDto,
} from './dto/geography-query.dto';

const LOCALES = [
  'ar-AE',
  'ar-SA',
  'de-DE',
  'en-AU',
  'en-CA',
  'en-GB',
  'en-GH',
  'en-IE',
  'en-KE',
  'en-NG',
  'en-NZ',
  'en-US',
  'en-ZA',
  'es-ES',
  'es-MX',
  'fr-CA',
  'fr-FR',
  'fr-SN',
  'hi-IN',
  'it-IT',
  'ja-JP',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'sv-SE',
  'tr-TR',
  'zh-CN',
  'zh-SG',
] as const;

const COUNTRY_TIMEZONES: Record<string, string[]> = {
  AE: ['Asia/Dubai'],
  AU: [
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Darwin',
    'Australia/Hobart',
    'Australia/Melbourne',
    'Australia/Perth',
    'Australia/Sydney',
  ],
  BR: [
    'America/Belem',
    'America/Fortaleza',
    'America/Manaus',
    'America/Recife',
    'America/Rio_Branco',
    'America/Sao_Paulo',
  ],
  CA: [
    'America/Edmonton',
    'America/Halifax',
    'America/St_Johns',
    'America/Toronto',
    'America/Vancouver',
    'America/Winnipeg',
  ],
  CN: ['Asia/Shanghai', 'Asia/Urumqi'],
  DE: ['Europe/Berlin'],
  ES: ['Europe/Madrid'],
  FR: ['Europe/Paris'],
  GB: ['Europe/London'],
  GH: ['Africa/Accra'],
  IE: ['Europe/Dublin'],
  IN: ['Asia/Kolkata'],
  IT: ['Europe/Rome'],
  JP: ['Asia/Tokyo'],
  KE: ['Africa/Nairobi'],
  MX: [
    'America/Cancun',
    'America/Chihuahua',
    'America/Hermosillo',
    'America/Matamoros',
    'America/Mazatlan',
    'America/Merida',
    'America/Mexico_City',
    'America/Monterrey',
    'America/Tijuana',
  ],
  NG: ['Africa/Lagos'],
  NL: ['Europe/Amsterdam'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham'],
  PL: ['Europe/Warsaw'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira'],
  SA: ['Asia/Riyadh'],
  SE: ['Europe/Stockholm'],
  SG: ['Asia/Singapore'],
  SN: ['Africa/Dakar'],
  TR: ['Europe/Istanbul'],
  US: [
    'America/Anchorage',
    'America/Chicago',
    'America/Denver',
    'America/Detroit',
    'America/Los_Angeles',
    'America/New_York',
    'America/Phoenix',
    'Pacific/Honolulu',
  ],
  ZA: ['Africa/Johannesburg'],
};

@Injectable()
export class GeographyReferenceService {
  countries(query: CountriesQueryDto) {
    const names = countries.getNames('en', { select: 'official' });
    const search = query.search?.trim().toLocaleLowerCase();
    const all = Object.entries(names)
      .map(([code, name]) => ({ code, name, flag: this.flag(code) }))
      .filter(
        (item) =>
          !search ||
          item.code.toLowerCase().includes(search) ||
          item.name.toLowerCase().includes(search),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: all.length,
      hasMore: start + query.limit < all.length,
    };
  }

  timezones(query: TimezonesQueryDto) {
    if (query.countryCode && !countries.isValid(query.countryCode))
      throw new BadRequestException(
        'countryCode must be a valid ISO 3166-1 alpha-2 code',
      );
    const supported = Intl.supportedValuesOf('timeZone');
    const candidates = query.countryCode
      ? (COUNTRY_TIMEZONES[query.countryCode] ?? [])
      : supported;
    const search = query.search?.trim().toLocaleLowerCase();
    const items = candidates
      .filter(
        (name) =>
          supported.includes(name) &&
          (!search || name.toLowerCase().includes(search)),
      )
      .map((name) => ({
        name,
        ...this.timezoneDisplay(name),
        countryCode: query.countryCode ?? this.countryForTimezone(name),
      }));
    return { items, total: items.length };
  }

  locales(query: LocalesQueryDto) {
    if (query.countryCode && !countries.isValid(query.countryCode))
      throw new BadRequestException(
        'countryCode must be a valid ISO 3166-1 alpha-2 code',
      );
    const countryNames = countries.getNames('en', { select: 'official' });
    const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const items = LOCALES.filter(
      (code) => !query.countryCode || code.endsWith(`-${query.countryCode}`),
    ).map((code) => {
      const locale = new Intl.Locale(code);
      const countryCode = locale.region!;
      const language = languageNames.of(locale.language) ?? locale.language;
      const countryName = countryNames[countryCode] ?? countryCode;
      return {
        code,
        name: `${language} (${countryName})`,
        language,
        countryCode,
        countryName,
        defaultWeekStart:
          countryCode === 'US' || countryCode === 'CA'
            ? ('sunday' as const)
            : ('monday' as const),
        defaultDateFormat:
          countryCode === 'US'
            ? ('MM/DD/YYYY' as const)
            : ('DD/MM/YYYY' as const),
      };
    });
    return { items, total: items.length };
  }

  private flag(code: string) {
    return [...code]
      .map((character) =>
        String.fromCodePoint(127397 + character.charCodeAt(0)),
      )
      .join('');
  }
  private timezoneDisplay(name: string) {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: name,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const abbr =
      parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    return {
      offset:
        abbr === 'GMT'
          ? '+00:00'
          : abbr
              .replace('GMT', '')
              .replace(/^(\+|-)(\d)$/, '$10$2:00')
              .replace(/^(\+|-)(\d{2})$/, '$1$2:00'),
      abbr,
    };
  }
  private countryForTimezone(name: string) {
    return (
      Object.entries(COUNTRY_TIMEZONES).find(([, zones]) =>
        zones.includes(name),
      )?.[0] ?? null
    );
  }
}
