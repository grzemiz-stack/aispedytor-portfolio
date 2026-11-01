import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { flagOn, isExplicitDevOrTest } from './node-env';

/**
 * Swagger (`/api/docs` and the JSON/YAML spec) is off by default outside development/test.
 *
 * On with an explicit `NODE_ENV=development` or `test`. Otherwise — also with no
 * `NODE_ENV` at all — it is set up only when `SWAGGER_ENABLED=true`, then all
 * of it, with no key. Off means the
 * routes do not exist (404) and no document is built.
 */
export function swaggerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isExplicitDevOrTest(env) || flagOn(env.SWAGGER_ENABLED);
}

/** Sets Swagger up under `/api/docs` when enabled. Returns whether it did. */
export function setupSwagger(
  app: INestApplication,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!swaggerEnabled(env)) return false;

  const config = new DocumentBuilder()
    .setTitle('AiSpedytor API')
    .setDescription('API of AiSpedytor — software for road transport and freight forwarding companies')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('auth', 'Login, company registration, JWT access and refresh tokens, logout')
    .addTag('users', 'Company users (list, add, deactivate — admin only), own profile, password change')
    .addTag('companies', 'Company details and logo')
    .addTag('offers', 'Freight offers — CRUD, import, filtering, assignment, status')
    .addTag('vehicles', 'Fleet — CRUD, expiring documents, status')
    .addTag('contractors', 'Contractors — CRUD')
    .addTag('demands', 'Transport demands — CRUD, matching offers, new-offer notifications')
    .addTag('notifications', 'User notifications — list, mark as read')
    .addTag('analytics', 'Route statistics, market overview')
    .addTag('ai-evaluation', 'Offer score — a heuristic, no AI model (the name is historical)')
    .addTag('matching', 'Vehicle ↔ offer matching with a score')
    .addTag('risk-analysis', 'Offer risk analysis (rule-based)')
    .addTag('negotiation', 'Price negotiation support — price range, arguments, simulation')
    .addTag('email-agent', 'E-mails sent to the API or pasted in the test panel — classification (LLM or rules), offers from e-mails; no mailbox is read')
    .addTag('route-planner', 'Route planning — distance, time, costs, country restrictions')
    .addTag('ltl', 'Part loads (LTL) — offers along a vehicle\'s route, free capacity, load plan')
    .addTag('health', 'Dependency status (behind login): database, Trans.eu connection, cache, queue')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
  return true;
}
