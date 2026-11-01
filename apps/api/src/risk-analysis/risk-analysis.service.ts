import type { Offer } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { adrCompatibility } from '../common/adr';
import { RISK_KEYWORDS } from './risk-keywords.data';
import { TaskQueueService } from '../common/queue/task-queue.service';
import { isReefer, requiresReefer } from '../common/reefer';
import { counterpartyRisk, PAYMENT_RISK_MAX_RATING, RELIABILITY_RISK_BELOW } from '../common/counterparty-risk';

type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type TotalRiskScore = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskItem {
  type: string;
  level: RiskLevel;
  message: string;
  details?: string;
}

export interface RiskAnalysisResult {
  offerId: string;
  totalRiskScore: TotalRiskScore;
  risks: RiskItem[];
  safeToAccept: boolean;
  analyzedAt: string;
}

// EU member states (ISO 3166-1 alpha-2)
const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR',
  'HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);

/** Order of risk levels — to pick the highest one within a phrase category. */
const LEVEL_RANK: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

@Injectable()
export class RiskAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskQueue: TaskQueueService,
  ) {}

  async analyzeRisk(offerId: string, companyId: string): Promise<RiskAnalysisResult> {
    return this.taskQueue.enqueue(() => this.performAnalysis(offerId, companyId));
  }

  private async performAnalysis(offerId: string, companyId: string): Promise<RiskAnalysisResult> {
    // Simple query — no nested includes to avoid Prisma issues with new columns
    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, companyId },
    });
    if (!offer) throw new NotFoundException('Oferta nie znaleziona');

    // Fetch company vehicles for ADR/frigo checks
    const vehicles = await this.prisma.vehicle.findMany({
      where: { companyId },
      select: {
        vehicleType: true,
        trailerType: true,
        hasAdr: true,
        adrClasses: true,
      },
    });

    const risks: RiskItem[] = [];

    // a) Penalty clauses
    const penaltyClauses = offer.penaltyClauses as string | null | undefined;
    if (penaltyClauses && penaltyClauses.trim().length > 0) {
      risks.push({
        type: 'PENALTY_CLAUSES',
        level: 'HIGH',
        message: 'Oferta zawiera kary umowne — przeczytaj uważnie warunki!',
        details: penaltyClauses.length > 200
          ? penaltyClauses.slice(0, 200) + '…'
          : penaltyClauses,
      });
    }

    // b) Loading time window
    const loadingTimeWindow = offer.loadingTimeWindow as number | null | undefined;
    if (loadingTimeWindow != null) {
      if (loadingTimeWindow < 60) {
        risks.push({
          type: 'SHORT_LOADING_WINDOW',
          level: 'HIGH',
          message: `Bardzo krótkie okienko załadunku (${loadingTimeWindow} min) — wysokie ryzyko kary za spóźnienie.`,
        });
      } else if (loadingTimeWindow < 120) {
        risks.push({
          type: 'SHORT_LOADING_WINDOW',
          level: 'MEDIUM',
          message: `Krótkie okienko załadunku (${loadingTimeWindow} min) — upewnij się że kierowca dotrze na czas.`,
        });
      }
    }

    // c) Pallet exchange
    const palletExchange = offer.palletExchange as boolean | null | undefined;
    if (palletExchange) {
      const palletExchangeType = offer.palletExchangeType as string | null | undefined;
      const palletCount = offer.palletCount as number | null | undefined;
      const typeInfo = palletExchangeType ? ` (${palletExchangeType})` : '';
      const countInfo = palletCount ? `, ${palletCount} szt.` : '';
      risks.push({
        type: 'PALLET_EXCHANGE',
        level: 'MEDIUM',
        message: `Wymiana palet${typeInfo}${countInfo} — upewnij się że kierowca ma wymaganą liczbę palet do wymiany.`,
      });
    }

    // d) ADR cargo — the same rule as LTL and matching (common/adr.ts): a class
    // given with isAdr=false is an ADR load too; a vehicle has ADR only with
    // `hasAdr`, and `adrClasses` narrow it (docs/decisions.md §6).
    if (offer.isAdr || offer.adrClass?.trim()) {
      const classInfo = offer.adrClass ? ` (klasa ${offer.adrClass})` : '';
      risks.push({
        type: 'ADR_CARGO',
        level: 'HIGH',
        message: `Ładunek ADR${classInfo} — wymagane uprawnienia ADR kierowcy i pojazd z certyfikatem ADR.`,
      });
      const canCarry = vehicles.some((v) => adrCompatibility(offer, v).reasons.length === 0);
      if (!canCarry) {
        const anyCertified = vehicles.some((v) => v.hasAdr);
        risks.push({
          type: 'NO_ADR_VEHICLE',
          level: 'HIGH',
          message: anyCertified
            ? `Żaden pojazd ADR we flocie nie ma dopuszczenia do tego ładunku${classInfo}. Konieczne zlecenie podwykonawcy.`
            : 'Brak pojazdu z certyfikatem ADR w flocie! Konieczne zlecenie podwykonawcy.',
        });
      }
    }

    // e) Temperature / frigo
    if (requiresReefer(offer)) {
      // Shared rule (common/reefer.ts). A trailer stored as its own record is in
      // this list as a separate fleet record, so checking each record is enough.
      const hasFrigoVehicle = vehicles.some((v) => isReefer(v));
      if (!hasFrigoVehicle) {
        const tempInfo =
          offer.temperatureMin != null && offer.temperatureMax != null
            ? ` (${offer.temperatureMin}°C / ${offer.temperatureMax}°C)`
            : '';
        risks.push({
          type: 'NO_FRIGO_VEHICLE',
          level: 'HIGH',
          message: `Ładunek wymaga chłodni${tempInfo}, ale brak pojazdu chłodniczego w flocie!`,
        });
      }
    }

    // f) Required insurance minimum
    const requiredInsuranceMin = offer.requiredInsuranceMin as number | null | undefined;
    if (requiredInsuranceMin && Number(requiredInsuranceMin) > 0) {
      risks.push({
        type: 'INSURANCE_REQUIREMENT',
        level: 'MEDIUM',
        message: `Wymagane minimalne OCP: ${Number(requiredInsuranceMin).toLocaleString('pl-PL')} EUR — sprawdź aktualną polisę.`,
      });
    }

    // g) Payment terms
    const paymentTermDays = offer.paymentTermDays as number | null | undefined;
    if (paymentTermDays != null) {
      if (paymentTermDays > 90) {
        risks.push({
          type: 'LONG_PAYMENT_TERM',
          level: 'HIGH',
          message: `Bardzo długi termin płatności (${paymentTermDays} dni) — poważne ryzyko utraty płynności finansowej.`,
        });
      } else if (paymentTermDays > 60) {
        risks.push({
          type: 'LONG_PAYMENT_TERM',
          level: 'MEDIUM',
          message: `Długi termin płatności (${paymentTermDays} dni) — ryzyko problemów z cash flow.`,
        });
      }
    }

    // h) International / cabotage
    const pickup = (offer.pickupCountry ?? '').toUpperCase();
    const delivery = (offer.deliveryCountry ?? '').toUpperCase();
    if (pickup !== delivery && EU_COUNTRIES.has(pickup) && EU_COUNTRIES.has(delivery)) {
      risks.push({
        type: 'INTERNATIONAL_TRANSPORT',
        level: 'LOW',
        message: `Transport międzynarodowy (${pickup}→${delivery}) — sprawdź przepisy kabotażowe i wymagane dokumenty przewozowe.`,
      });
    }

    // i) The contractor — the same rule as the LTL card and negotiation (before,
    // risk analysis did not read the contractor, and an offer from a contractor
    // with a payment rating of 1 was "safe to accept").
    risks.push(...(await this.contractorRisks(offer, companyId)));

    // j) Free-text keyword scanning
    risks.push(...this.scanForRiskKeywords(offer));

    // Compute total risk score
    const highCount = risks.filter((r) => r.level === 'HIGH').length;
    const mediumCount = risks.filter((r) => r.level === 'MEDIUM').length;

    let totalRiskScore: TotalRiskScore;
    // A contractor on the company blacklist = CRITICAL whatever the rest of the offer.
    if (risks.some((r) => r.type === 'CONTRACTOR_BLACKLISTED')) totalRiskScore = 'CRITICAL';
    else if (highCount >= 3) totalRiskScore = 'CRITICAL';
    else if (highCount >= 1) totalRiskScore = 'HIGH';
    else if (mediumCount >= 1) totalRiskScore = 'MEDIUM';
    else totalRiskScore = 'LOW';

    return {
      offerId: offer.id,
      totalRiskScore,
      risks,
      safeToAccept: highCount === 0,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * The offer's contractor risk (common/counterparty-risk.ts): the blacklist
   * → HIGH and a CRITICAL total; a payment rating ≤ 2 → HIGH (the offer is not
   * "safe to accept"); reliability < 40 → MEDIUM. No ratings is not a risk.
   * The contractor is looked up in the caller's company.
   */
  private async contractorRisks(offer: Offer, companyId: string): Promise<RiskItem[]> {
    if (!offer.contractorId) return [];
    const c = await this.prisma.contractor.findFirst({
      where: { id: offer.contractorId, companyId },
      select: { name: true, isBlacklisted: true, paymentRating: true, reliabilityScore: true },
    });
    const out: RiskItem[] = [];
    for (const criterion of counterpartyRisk(c)) {
      if (criterion === 'BLACKLIST') {
        out.push({ type: 'CONTRACTOR_BLACKLISTED', level: 'HIGH', message: `Kontrahent ${c!.name} jest na czarnej liście firmy.` });
      } else if (criterion === 'PAYMENT') {
        out.push({ type: 'CONTRACTOR_PAYMENT_RISK', level: 'HIGH', message: `Niska ocena płatności kontrahenta ${c!.name}: ${c!.paymentRating}/5 (ryzyko od ${PAYMENT_RISK_MAX_RATING}/5 w dół) — ryzyko braku zapłaty.` });
      } else {
        out.push({ type: 'CONTRACTOR_RELIABILITY_RISK', level: 'MEDIUM', message: `Niska rzetelność kontrahenta ${c!.name}: ${c!.reliabilityScore}/100 (poniżej ${RELIABILITY_RISK_BELOW}) — sprawdź warunki zlecenia.` });
      }
    }
    return out;
  }

  private scanForRiskKeywords(offer: Offer): RiskItem[] {
    const fields = [
      offer.notes,
      offer.specialRequirements,
      offer.penaltyClauses,
    ].filter(Boolean);

    if (fields.length === 0) return [];

    const text = fields.join(' ').toLowerCase();
    const foundByCategory = new Map<string, { level: 'HIGH' | 'MEDIUM' | 'LOW'; message: string; keywords: string[] }>();

    for (const kw of RISK_KEYWORDS) {
      if (!text.includes(kw.keyword.toLowerCase())) continue;

      const existing = foundByCategory.get(kw.category);
      if (existing) {
        existing.keywords.push(kw.keyword);
        // The category level is the highest level of the phrases found
        // (LOW < MEDIUM < HIGH), with the message of the first phrase at that level.
        if (LEVEL_RANK[kw.level] > LEVEL_RANK[existing.level]) {
          existing.level = kw.level;
          existing.message = kw.message;
        }
      } else {
        foundByCategory.set(kw.category, {
          level: kw.level,
          message: kw.message,
          keywords: [kw.keyword],
        });
      }
    }

    const results: RiskItem[] = [];
    for (const [category, data] of foundByCategory) {
      results.push({
        type: `KEYWORD_${category}`,
        level: data.level,
        message: data.message,
        details: `Wykryte frazy: ${data.keywords.join(', ')}`,
      });
    }

    return results;
  }
}
