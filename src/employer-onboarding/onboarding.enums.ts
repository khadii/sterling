export enum CompanySize {
  ONE_TO_TEN = '1_10',
  ELEVEN_TO_TWENTY_FIVE = '11_25',
  TWENTY_SIX_TO_FIFTY = '26_50',
  FIFTY_ONE_TO_ONE_HUNDRED = '51_100',
  OVER_ONE_HUNDRED = '101_plus',
}

export enum WeekStart {
  SUNDAY = 'sunday',
  MONDAY = 'monday',
}

export enum SupportedDateFormat {
  DAY_MONTH_YEAR_SLASH = 'DD/MM/YYYY',
  MONTH_DAY_YEAR_SLASH = 'MM/DD/YYYY',
  ISO = 'YYYY-MM-DD',
  DAY_MONTH_YEAR_DASH = 'DD-MM-YYYY',
  MONTH_DAY_YEAR_DASH = 'MM-DD-YYYY',
}

export enum LogoContentType {
  SVG = 'image/svg+xml',
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  GIF = 'image/gif',
}
