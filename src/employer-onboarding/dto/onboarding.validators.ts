import { registerDecorator, ValidationOptions } from 'class-validator';
import * as countries from 'i18n-iso-countries';

function validator(
  name: string,
  predicate: (value: unknown) => boolean,
  message: string,
) {
  return (options?: ValidationOptions): PropertyDecorator =>
    (target: object, propertyKey: string | symbol) =>
      registerDecorator({
        name,
        target: target.constructor,
        propertyName: String(propertyKey),
        options,
        validator: {
          validate: predicate,
          defaultMessage: () => message,
        },
      });
}

export const IsIsoCountryCode = validator(
  'isIsoCountryCode',
  (value) => typeof value === 'string' && countries.isValid(value),
  'countryCode must be a valid ISO 3166-1 alpha-2 country code',
);

export const IsIanaTimeZone = validator(
  'isIanaTimeZone',
  (value) => {
    if (typeof value !== 'string') return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return value.includes('/');
    } catch {
      return false;
    }
  },
  'timezone must be a valid IANA timezone',
);

export const IsBcp47Locale = validator(
  'isBcp47Locale',
  (value) => {
    if (typeof value !== 'string') return false;
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  },
  'locale must be a valid BCP 47 locale',
);
