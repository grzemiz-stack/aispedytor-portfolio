import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateDemandDto } from './create-demand.dto';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'FULFILLED', 'CANCELLED'];

export class UpdateDemandDto extends PartialType(CreateDemandDto) {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
}
