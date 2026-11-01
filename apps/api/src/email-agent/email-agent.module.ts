import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OffersModule } from '../offers/offers.module';
import { EmailClassifierService } from './email-classifier.service';
import { LlmClassifierService } from './llm-classifier.service';
import { EmailAgentService } from './email-agent.service';
import { EmailAgentController } from './email-agent.controller';

@Module({
  imports: [PrismaModule, OffersModule],
  controllers: [EmailAgentController],
  providers: [EmailAgentService, EmailClassifierService, LlmClassifierService],
})
export class EmailAgentModule {}
