/**
 * E-mail: the application does not read a mailbox — and says so (docs/decisions.md §9).
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmailAgentController } from '../../src/email-agent/email-agent.controller';

const op = (m: string) => Reflect.getMetadata('swagger/apiOperation', (EmailAgentController.prototype as any)[m]);

it('Swagger: e-mails come in through the API; the "inbox" is the list kept in the app', () => {
  expect(op('processEmail').description).toMatch(/does not read a mailbox.*out of scope/);
  expect(op('getInbox').summary).toMatch(/saved in the app.*not a mailbox/);
  expect(op('getInbox').summary).not.toMatch(/^(Inbox|Mailbox)\b/);
});

it('README says plainly there is no mailbox connector', () => {
  const readme = readFileSync(resolve(__dirname, '../../../../README.md'), 'utf8');
  expect(readme).toMatch(/\*\*a mailbox connector\*\* \(IMAP, Gmail\): the e-mail module classifies e-mails\s+pasted in its test panel or sent to `POST \/api\/email-agent\/process`/);
  expect(readme).not.toMatch(/classifies incoming spedytor mailbox/);
});

it('nothing in the e-mail module connects to a mailbox (IMAP/POP3/Gmail API)', () => {
  const dir = resolve(__dirname, '../../src/email-agent');
  const src = ['email-agent.service.ts', 'email-agent.controller.ts', 'email-agent.module.ts']
    .map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n');
  expect(src).not.toMatch(/imapflow|node-imap|\bpop3\b|googleapis|gmail\.users/i);
});
