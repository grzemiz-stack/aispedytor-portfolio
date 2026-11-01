# email-agent — classifying e-mails and turning them into offers

Classifies e-mails that someone hands to the application — pasted in the test
panel of the web app or sent to `POST /api/email-agent/process` — saves them,
and creates a transport offer from the data extracted from an e-mail. It does
**not** read a mailbox: there is no IMAP or Gmail connector, and none is
planned (see "Scope" in the root README). "Inbox" in the paths is the list of
e-mails saved in the application.

This is the only module that calls an LLM (Claude Haiku). Without an API key,
or when the call fails, a rule-based classifier is used.

## Files

| File | What it does |
|---|---|
| `email-agent.controller.ts` | HTTP routes, all behind login (`JwtAuthGuard`), always scoped to the caller's company; 20 requests per minute per client (`@Throttle`). |
| `email-agent.service.ts` | Classification (LLM, falling back to rules), saving, the inbox list and statistics, creating an offer from an e-mail. The request classes are in `dto/` (`ProcessEmailDto`, `SimulateEmailDto`, `UpdateEmailDto`, `InboxQueryDto`). |
| `llm-classifier.service.ts` | Calls the Anthropic API (`claude-haiku-4-5-20251001`, 10 s timeout) and maps the JSON answer onto the database enums. Enabled only when `ANTHROPIC_API_KEY` is set. |
| `email-classifier.service.ts` | Rule-based classifier: keyword scores for the category and priority, tags, and regex extraction of weight, price with its currency, date, cities and countries. |
| `email-agent.module.ts` | Wires the controller and the three services; imports `OffersModule` (what a new offer sets off). |

## Endpoints

| Route | Body / query | Returns |
|---|---|---|
| `POST /api/email-agent/process` | `subject`, `fromEmail`, `toEmail`, `body`, optional `fromName`, `receivedAt` (ISO, default now), `messageId` | `{ email, classification }` — the saved e-mail and the classification |
| `POST /api/email-agent/simulate` | as above without `toEmail` | `{ classification }`; nothing is saved |
| `GET /api/email-agent/inbox` | optional `category` (`ALL` = no filter), `unreadOnly=true`, `starred=true`, `search`, `limit` (default 20, at most 100), `page` (from 1); `offset` — **deprecated**, the old name of `page` (with both, `page` wins) | `{ data, meta }`, unread first, then newest; each e-mail with `extractedCurrency` (below) |
| `GET /api/email-agent/stats` | — | `{ total, unread, offersToReview, byCategory, byPriority }` |
| `GET /api/email-agent/:emailId` | — | the full e-mail record with `extractedCurrency` |
| `POST /api/email-agent/:emailId/create-offer` | — | `{ offer, email }` |
| `PATCH /api/email-agent/:emailId` | `notes`, `tags` | the updated e-mail |
| `PATCH /api/email-agent/:emailId/read` | — | the e-mail, marked as read |
| `PATCH /api/email-agent/:emailId/star` | — | the e-mail with the star toggled |

Errors: `404` when the e-mail does not exist in the caller's company (the
message is Polish text, not a code); `create-offer` also answers
`400 EMAIL_OFFER_FIELDS_MISSING { fields }` and `409 EMAIL_OFFER_EXISTS { offerId }`.

## How it works

**Classification** (`process` and `simulate`):

1. With `ANTHROPIC_API_KEY` set, the LLM classifier is asked first. The prompt
   carries the subject, the sender and the first 3000 characters of the body.
   The answer is JSON: a category, a priority, tags, a confidence 0–1 and
   `extractedData` (cities, countries, postal codes, dates, weight, price,
   currency, vehicle type, pallets, ADR, temperatures, payment term,
   contact). Ten model categories are reduced to the five database values
   (`OFFER`, `INQUIRY`, `COMPLAINT`, `INVOICE`, `OTHER`; unknown → `OTHER`),
   priorities to `HIGH` / `MEDIUM` / `LOW` (`NORMAL` and unknown → `MEDIUM`).
   Confidence becomes a percentage (missing → 80). Weight and price are taken
   only when they are numbers; an unreadable pickup date is dropped. The raw
   model category is kept in `llmCategory`, the summary in `llmSummary`, the
   whole `extractedData` in `llmExtractedData`.
2. Without a key, or when the call or JSON parsing fails, the rule-based
   classifier answers (`method: 'regex'`):
   - category = the keyword list with the highest count (Polish and English
     words); "faktura"/"invoice" or "reklamacja"/"complaint" in the subject
     override it;
   - priority `HIGH` on any urgent word, `LOW` on two low-priority words or
     no category keyword at all, otherwise `MEDIUM`;
   - tags `ADR`, `FRIGO`, `CIĘŻKI`, `EKSPRES`, `KABOTAŻ`, `PALETY`;
   - weight in kg (`kg`, `t`, `ton`), price with its currency (EUR/€, PLN/zł;
     a labelled price like "Fracht: 2 850 EUR" wins over any amount), the
     first date (`YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`);
   - the place after a label ("Załadunek:", "Rozładunek:", "loading",
     "delivery", …, up to the end of the line, a semicolon or the next label)
     is taken apart into a country and a city: the country from "(PL)",
     ", PL", a postal-code prefix "PL-60-001" or a name ("Polska", "Niemcy");
     postal codes are removed; the city is the first part that is not a
     country — "Poznań 60-001 (PL)", "Polska, Poznań" and "Poznań, Polska"
     all give Poznań, PL. A country is never taken as a city;
   - without labels: cities from "z … do …" / "from … to …" (a country there,
     e.g. "z Polski do Niemiec", gives the countries, not cities), countries
     from "PL → NL", and the first country name in the text as the pickup
     country (the delivery country is not guessed);
   - a confidence from 40 to 95 built from the keyword count and the fields
     found.
3. `process` runs the classification through the in-process task queue
   (`common/queue`) and saves the e-mail with the result. `simulate` calls
   the classifier directly and saves nothing.

**Creating an offer** (`create-offer`):

1. If the e-mail already points to an offer that still exists →
   `409 EMAIL_OFFER_EXISTS { offerId }`. `createdOfferId` has no foreign key,
   so a deleted offer leaves a dead link and a new offer may be created.
2. Required fields: pickup and delivery city and country, pickup date and a
   currency. A missing one is not replaced by a default (no "Unknown" city,
   no PL→DE, no "today", no EUR — docs/decisions.md §2): the answer is
   `400 EMAIL_OFFER_FIELDS_MISSING { fields }` and no offer is created.
3. Currency: from the LLM data; otherwise, when the e-mail has a price, the
   currency the rule-based classifier finds next to the same amount in the
   text; without a price, the company's currency.
4. From the LLM data: ADR (only an exact `true`), ADR class, reefer (a
   temperature, `0` included, or vehicle type "frigo"/"chłodnia"),
   temperatures, pallet exchange and count, payment term, phone, postal codes,
   delivery date (unreadable → none). Numbers of the wrong type are dropped.
   Client name: `fromName`, then the LLM contact name, then the company name,
   then the sender address.
5. Price `0` and weight `0` are values, not missing data.
6. The offer (`source: EMAIL`, `status: NEW`, a note with the subject and the
   first 500 characters of the body) is created and linked to the e-mail in
   one transaction. The link is conditional on `createdOfferId` being what it
   was when read; if a parallel request linked first, the transaction rolls
   back and the answer is `409 EMAIL_OFFER_EXISTS` with that request's offer.
   The e-mail is marked as read.
7. After the transaction commits, the offer goes where an offer from the form
   goes (`OffersService.afterOfferCreated`): matching against active demands
   (notifications) and clearing the company's cached offer list. A rolled-back
   transaction sets off neither.

**Price currency** (`extractedCurrency` in the inbox list and the e-mail
detail) is computed when read; there is no column:

1. an e-mail an offer was created from → that offer's currency (the offer is
   looked up in the caller's company);
2. no offer, or the offer was deleted → the currency in the LLM data,
   otherwise the currency the rule-based classifier finds next to the same
   amount in the text (the rule of step 3 above);
3. none of these → `null`; the screen writes "waluta nieznana" (currency
   unknown), never a default "EUR".

Because it is computed from the saved text on every read, **a change to the
recognition rules (the rule-based classifier, or what the model saves) changes
the currency shown for older e-mails without an offer.** E-mails with an offer
are not affected — their currency comes from the offer.

The list reads the body and the LLM data only for this; neither is sent in the
list response.

## Message codes

Returned as `{ code, params }`; the web app turns them into text
(`apps/web/src/lib/plan-messages.ts`).

- `EMAIL_OFFER_FIELDS_MISSING` — `{ fields }`, comma-separated names of the
  missing offer fields (`pickupCity`, `pickupCountry`, `deliveryCity`,
  `deliveryCountry`, `pickupDate`, `currency`).
- `EMAIL_OFFER_EXISTS` — `{ offerId }`, the offer already created from this
  e-mail; the screen links to it.
- `OFFER_VALUE_OUT_OF_RANGE` — `{ field: 'price' }`, 400: the price read from
  the e-mail does not fit the offer's DECIMAL(10,2) column (0 …
  99,999,999.99); no offer is created.

## Tests

```bash
cd apps/api
npx jest test/unit/email- test/unit/llm-classifier
```

| Test | Covers |
|---|---|
| `test/unit/dto-classes.spec.ts` | Request bodies and the inbox query: a missing required field and a field outside the schema → 400 |
| `test/unit/email-inbox.spec.ts` | The offer from an e-mail sets off matching and the cache only after the transaction; the price currency (offer, model, regex at the same price, `null`; company scope); the body not in the list; `page`, deprecated `offset`, `page` wins |
| `test/unit/email-agent.service.spec.ts` | LLM/regex fallback, what `process` saves, mapping an e-mail to an offer, missing fields, the second offer from the same e-mail and the parallel-request case, inbox filters, statistics |
| `test/unit/llm-classifier.service.spec.ts` | Category and priority mapping, cleaning the model answer, numbers and dates, prompt length and timeout (the SDK is mocked) |
| `test/unit/email-classifier-numbers.spec.ts` | Prices and weights read as whole numbers |
| `test/unit/email-classifier-currency.spec.ts` | The currency kept next to the price |
| `test/unit/email-classifier-route.spec.ts` | Cities and countries from the route formats; a country never as a city |
| `test/unit/email-no-mailbox.spec.ts` | Swagger and the root README say there is no mailbox connector; no mailbox library in the module |

## Known limits

See also [docs/known-issues.md](../../../../docs/known-issues.md)
("Integrations", "API correctness").

- No mailbox connector (IMAP, Gmail) — out of the product's scope.
- `offset` in `GET /inbox` is a page number, not an offset — deprecated, use
  `page`; it stays so older clients keep working.
- `POST /simulate` is not queued; with an
  API key every call goes to the LLM.
- The rule-based classifier: keywords match substrings (Polish and English);
  without labels only the pickup country is taken from a country name, and
  cities after "z"/"do" stay inflected ("z Poznania" → "Poznania"); "City, PL →
  City, NL" gives countries only, not cities; an English thousands comma
  ("1,999 EUR") gives no price; only EUR and PLN are recognised.
- The `email` returned by `create-offer` is the record as read before the
  link, so it does not show the new `createdOfferId`.
- The `404` messages are Polish text, not codes.
- The LLM prompt and the summary it asks for are in Polish.
