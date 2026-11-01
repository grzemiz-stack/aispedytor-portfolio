/**
 * `ai-evaluation` is described as a heuristic (docs/decisions.md §9).
 *
 * The service is margin thresholds and the company's own average price per km,
 * so Swagger must not call it an AI score. The test guards the description and
 * that the module does not call an LLM.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AiEvaluationController } from '../../src/ai-evaluation/ai-evaluation.controller';

const op = (m: string) => Reflect.getMetadata('swagger/apiOperation', (AiEvaluationController.prototype as any)[m]);

it('Swagger calls it a heuristic, says no AI model and what the rules are', () => {
  expect(op('evaluateOffer').summary).toBe('Heuristic offer score 1–10 (no AI model)');
  expect(op('evaluateOffer').description).toMatch(/margin thresholds.*average of this company's other offers.*No model and no LLM call/);
  expect(op('batchEvaluate').summary).toMatch(/^Heuristic score \(no AI model\)/);
  expect(JSON.stringify([op('evaluateOffer'), op('batchEvaluate')])).not.toMatch(/AI (score|evaluation|assessment)/i);
});

it('the module does not reach for an LLM', () => {
  const dir = resolve(__dirname, '../../src/ai-evaluation');
  const src = ['ai-evaluation.service.ts', 'ai-evaluation.controller.ts', 'ai-evaluation.module.ts']
    .map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n');
  expect(src).not.toMatch(/anthropic|LlmClassifier|openai/i);
});
