import { Module } from '@nestjs/common';
import { ExchangePublisherService } from './exchange-publisher.service';
import { ExchangePublisherController } from './exchange-publisher.controller';
import { TransEuAuthModule } from '../trans-eu-auth/trans-eu-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TIMOCOM_ADAPTER } from './exchange-adapter';

@Module({
  imports: [PrismaModule, TransEuAuthModule],
  controllers: [ExchangePublisherController],
  // No Timocom adapter (null): publishToTimocom → TIMOCOM_NOT_IMPLEMENTED.
  // To plug one in: `useClass: MyTimocomAdapter` (account per company, see exchange-adapter.ts).
  providers: [ExchangePublisherService, { provide: TIMOCOM_ADAPTER, useValue: null }],
  exports: [ExchangePublisherService],
})
export class ExchangePublisherModule {}
