import { Module } from '@nestjs/common';
import { AiEvaluationController } from './ai-evaluation.controller';
import { AiEvaluationService } from './ai-evaluation.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AiEvaluationController],
  providers: [AiEvaluationService],
})
export class AiEvaluationModule {}
