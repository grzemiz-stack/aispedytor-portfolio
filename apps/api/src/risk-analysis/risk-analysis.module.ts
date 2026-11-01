import { Module } from '@nestjs/common';
import { RiskAnalysisController } from './risk-analysis.controller';
import { RiskAnalysisService } from './risk-analysis.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RiskAnalysisController],
  providers: [RiskAnalysisService],
})
export class RiskAnalysisModule {}
