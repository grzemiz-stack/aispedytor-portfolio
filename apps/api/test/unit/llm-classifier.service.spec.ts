/**
 * LlmClassifierService — mapping the LLM response onto the database enums.
 *
 * Apart from the model call, this service is a deterministic translation: it takes
 * the model's text, parses the JSON and reduces it to `EmailCategory`/`EmailPriority`.
 * These two mappings are the last barrier before Prisma — nothing else stops an
 * arbitrary string from reaching the database.
 *
 * Network: the Anthropic SDK is fully mocked; no test goes outside.
 */
import { LlmClassifierService } from '../../src/email-agent/llm-classifier.service';

// ── Anthropic SDK stub ────────────────────────────────────────────────────────
const createCalls: any[] = [];
let modelResponse: any = null;
let modelError: Error | null = null;

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class FakeAnthropic {
    constructor(public opts: any) {}
    messages = {
      create: (params: any, options: any) => {
        createCalls.push({ params, options });
        if (modelError) return Promise.reject(modelError);
        return Promise.resolve(modelResponse);
      },
    };
  },
}));

/** Builds an SDK response in the shape the service actually reads. */
function textResponse(responseText: string, usage?: { input_tokens: number; output_tokens: number }) {
  return {
    content: [{ type: 'text', text: responseText }],
    usage: usage ?? { input_tokens: 11, output_tokens: 22 },
  };
}

// No default value: `makeService(undefined)` would get the default instead of passing undefined.
function makeService(apiKey: string | undefined) {
  const config: any = { get: jest.fn().mockReturnValue(apiKey) };
  return new LlmClassifierService(config);
}

beforeEach(() => {
  createCalls.length = 0;
  modelResponse = null;
  modelError = null;
});

describe('isAvailable — no key turns the LLM path off', () => {
  it('without ANTHROPIC_API_KEY the service reports itself unavailable', () => {
    expect(makeService(undefined).isAvailable).toBe(false);
  });

  it('with a key the service is available', () => {
    expect(makeService('sk-ant-cokolwiek').isAvailable).toBe(true);
  });
});

describe('mapping categories to the database enum', () => {
  // CATEGORY_MAP reduces the model's 10 categories to the 5 values of the EmailCategory enum.
  it.each([
    ['OFFER', 'OFFER'],
    ['ORDER_CONFIRMATION', 'OFFER'],
    ['CONTRACTOR', 'INQUIRY'],
    ['INQUIRY', 'INQUIRY'],
    ['INVOICE', 'INVOICE'],
    ['COMPLAINT', 'COMPLAINT'],
    ['ADVERTISEMENT', 'OTHER'],
    ['AUTHORITY', 'OTHER'],
    ['INTERNAL', 'OTHER'],
    ['OTHER', 'OTHER'],
  ])('%s from the model -> %s in the database', async (fromModel, inDb) => {
    modelResponse = textResponse(JSON.stringify({ category: fromModel }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe(inDb);
    expect(r.llmCategory).toBe(fromModel); // the raw model value is kept separately
  });

  it('a category outside the map does not leak into the database — it becomes OTHER', async () => {
    modelResponse = textResponse(JSON.stringify({ category: 'ZUPELNIE_NOWA_KATEGORIA' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe('OTHER');
    expect(r.llmCategory).toBe('ZUPELNIE_NOWA_KATEGORIA');
  });

  it('no category field gives OTHER, not undefined', async () => {
    modelResponse = textResponse(JSON.stringify({ summary: 'bez kategorii' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe('OTHER');
  });

  it('a lower-case category is normalised', async () => {
    modelResponse = textResponse(JSON.stringify({ category: 'invoice' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe('INVOICE');
  });
});

describe('mapping priority to the database enum', () => {
  it.each([
    ['HIGH', 'HIGH'],
    ['NORMAL', 'MEDIUM'],
    ['MEDIUM', 'MEDIUM'],
    ['LOW', 'LOW'],
  ])('%s from the model -> %s in the database', async (fromModel, inDb) => {
    modelResponse = textResponse(JSON.stringify({ priority: fromModel }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.priority).toBe(inDb);
  });

  it('a priority outside the map becomes MEDIUM', async () => {
    modelResponse = textResponse(JSON.stringify({ priority: 'KRYTYCZNY' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.priority).toBe('MEDIUM');
  });

  it('no priority field gives MEDIUM (through NORMAL)', async () => {
    modelResponse = textResponse(JSON.stringify({ category: 'OFFER' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.priority).toBe('MEDIUM');
  });
});

describe('cleaning the model response', () => {
  it('strips a ```json ... ``` fence', async () => {
    modelResponse = textResponse('```json\n{"category":"OFFER"}\n```');
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe('OFFER');
  });

  it('strips a fence without a language tag', async () => {
    modelResponse = textResponse('```\n{"category":"INVOICE"}\n```');
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe('INVOICE');
  });

  it('a response without a text block is read as an empty object (OTHER, MEDIUM) instead of throwing', async () => {
    modelResponse = { content: [{ type: 'image' }], usage: { input_tokens: 1, output_tokens: 1 } };
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.category).toBe('OTHER');
    expect(r.priority).toBe('MEDIUM');
  });

  it('invalid JSON throws (the caller handles it)', async () => {
    modelResponse = textResponse('to nie jest JSON');

    await expect(makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com')).rejects.toThrow();
  });
});

describe('numeric fields and dates', () => {
  it('confidence 0.0-1.0 is converted to a percentage', async () => {
    modelResponse = textResponse(JSON.stringify({ confidence: 0.85 }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.confidence).toBe(85);
  });

  it('confidence = 0 stays 0, not the default 80', async () => {
    // With `parsed.confidence ? ... : 80`, zero would vanish as falsy.
    modelResponse = textResponse(JSON.stringify({ confidence: 0 }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.confidence).toBe(0);
  });

  it('no confidence gives the default 80', async () => {
    modelResponse = textResponse(JSON.stringify({ category: 'OFFER' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.confidence).toBe(80);
  });

  it('confidence as a string is ignored in favour of the default 80', async () => {
    modelResponse = textResponse(JSON.stringify({ confidence: '0.9' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.confidence).toBe(80);
  });

  it('numeric weight and price pass through', async () => {
    modelResponse = textResponse(JSON.stringify({
      extractedData: { weight: 24000, price: 1850 },
    }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.extractedWeight).toBe(24000);
    expect(r.extractedPrice).toBe(1850);
  });

  it('a weight given as a string does not pass', async () => {
    modelResponse = textResponse(JSON.stringify({ extractedData: { weight: '24000' } }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.extractedWeight).toBeUndefined();
  });

  it('weight and price 0 pass as 0 — zero is not missing data', async () => {
    modelResponse = textResponse(JSON.stringify({ extractedData: { weight: 0, price: 0 } }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.extractedWeight).toBe(0);
    expect(r.extractedPrice).toBe(0);
  });

  it('a valid pickupDate becomes a Date', async () => {
    modelResponse = textResponse(JSON.stringify({ extractedData: { pickupDate: '2026-03-15' } }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.extractedDate).toBeInstanceOf(Date);
    expect(r.extractedDate!.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('an invalid pickupDate is dropped instead of giving an Invalid Date', async () => {
    modelResponse = textResponse(JSON.stringify({ extractedData: { pickupDate: 'kiedys w marcu' } }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.extractedDate).toBeUndefined();
  });

  it('non-array tags give an empty array instead of an exception', async () => {
    modelResponse = textResponse(JSON.stringify({ tags: 'ADR, FRIGO' }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.tags).toEqual([]);
  });

  it('tags are converted to strings', async () => {
    modelResponse = textResponse(JSON.stringify({ tags: ['ADR', 7, null] }));
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.tags).toEqual(['ADR', '7', 'null']);
  });

  it('missing usage does not break token counting', async () => {
    modelResponse = { content: [{ type: 'text', text: '{}' }] };
    const r = await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
  });
});

describe('calling the model', () => {
  it('the e-mail body is cut to 3000 characters', async () => {
    modelResponse = textResponse('{}');
    const longBody = 'x'.repeat(5000);
    await makeService('test-key').classifyWithLLM('temat', longBody, 'a@b.example.com');

    const prompt = createCalls[0].params.messages[0].content as string;
    expect(prompt).toContain('x'.repeat(3000));
    expect(prompt).not.toContain('x'.repeat(3001));
  });

  it('the call has a timeout — the request does not hang forever', async () => {
    modelResponse = textResponse('{}');
    await makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com');

    expect(createCalls[0].options).toMatchObject({ timeout: 10_000 });
  });

  it('an SDK error propagates to the caller (the fallback is higher up)', async () => {
    modelError = new Error('529 overloaded');

    await expect(makeService('test-key').classifyWithLLM('t', 'b', 'a@b.example.com')).rejects.toThrow('529 overloaded');
  });
});
