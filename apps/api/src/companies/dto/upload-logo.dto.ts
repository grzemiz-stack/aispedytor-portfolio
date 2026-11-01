import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Company logo (PATCH /companies/me/logo). A missing `logoBase64` is 400. The
 * size and the `data:image/` prefix are checked by the service (`uploadLogo`).
 */
export class UploadLogoDto {
  @ApiProperty({ description: 'data:image/...;base64,... — do ok. 500 KB pliku' })
  @IsString()
  @IsNotEmpty()
  logoBase64: string;
}
