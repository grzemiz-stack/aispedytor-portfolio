import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NegotiationController } from './negotiation.controller';
import { NegotiationService } from './negotiation.service';

@Module({
  imports: [PrismaModule],
  controllers: [NegotiationController],
  providers: [NegotiationService],
  exports: [NegotiationService],
})
export class NegotiationModule {}
