import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class AssignVehicleDto {
  @ApiProperty({ nullable: true, type: String, description: 'A power unit of the company (not a trailer); null unassigns.' })
  @ValidateIf((o: AssignVehicleDto) => o.vehicleId !== null)
  @IsString()
  @IsNotEmpty()
  vehicleId!: string | null;
}
