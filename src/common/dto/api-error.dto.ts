import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];
  @ApiProperty() error!: string;
  @ApiProperty() path!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() timestamp!: string;
  @ApiProperty({ required: false }) code?: string;
  @ApiProperty({ required: false, type: Object })
  details?: Record<string, unknown>;
}
