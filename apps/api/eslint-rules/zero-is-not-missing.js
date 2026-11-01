/**
 * zero-is-not-missing
 *
 * Forbids turning a number into NULL through a truthiness test:
 *
 *   x || null              when `x` is a number
 *   x ? anything : null    when `x` is a number
 *
 * For numbers `0` is falsy, so both patterns treat zero as missing data. This
 * caused several defects (a price of 0 read as "no price", a price of 0 from
 * an e-mail saved as NULL, a 0 °C temperature lost on import, a contractor
 * rating of 0 shown as "no rating") — see docs/decisions.md §2.
 *
 * The correct forms are `!= null` or `??` — only `null` and `undefined` then
 * become NULL.
 *
 * The rule needs type information (`parserOptions.project`). Without it the
 * rule stays silent — it does not guess whether a field is a number.
 *
 * Text and date fields are skipped on purpose: for them an empty string does
 * mean "missing" and `|| null` is intended.
 *
 * `.length` is skipped too — `array.length ? … : null` is the idiom for an
 * empty array, where zero REALLY means no data. Without this exception the
 * rule raised false alarms on its own aggregate fakes.
 */
'use strict';

const ts = require('typescript');

/** Whether the type (or any member of a union) is numeric. */
function zawieraLiczbe(type, checker, glebokosc = 0) {
  if (!type || glebokosc > 3) return false;

  if (type.isUnion && type.isUnion()) {
    return type.types.some((t) => zawieraLiczbe(t, checker, glebokosc + 1));
  }
  if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return true;

  // Prisma maps Decimal columns to a `Decimal` object, not to `number`.
  // For this rule it counts the same: zero is a value there, not missing.
  const nazwa = type.symbol && type.symbol.getName();
  return nazwa === 'Decimal';
}

/** Expressions that are already a check in themselves — not a truthiness test. */
const JAWNE_SPRAWDZENIE = new Set([
  'BinaryExpression',    // x != null, typeof x === 'number'
  'LogicalExpression',   // a && b
  'UnaryExpression',     // !x
  'CallExpression',      // Array.isArray(x)
]);

const jestNullem = (node) =>
  node && node.type === 'Literal' && node.value === null && node.raw === 'null';

/**
 * Whether the expression reads `.length`. For an array or a string zero means
 * "empty", i.e. really no data — not the "zero as missing" defect.
 */
function czytaDlugosc(node) {
  const n = node && node.type === 'ChainExpression' ? node.expression : node;
  return !!n && n.type === 'MemberExpression' && !n.computed &&
    n.property && n.property.type === 'Identifier' && n.property.name === 'length';
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Zakazuje sprowadzania liczby do NULL przez test na prawdziwosc — zero to wartosc, nie brak danych',
    },
    schema: [],
    messages: {
      logiczneLub:
        "`|| null` na polu liczbowym zrownuje 0 z brakiem danych. Uzyj `?? null`.",
      warunkowe:
        "`… ? … : null` na polu liczbowym zrownuje 0 z brakiem danych. Uzyj `x != null ? … : null`.",
    },
  },

  create(context) {
    const services =
      (context.sourceCode && context.sourceCode.parserServices) || context.parserServices;

    // Without type information the rule cannot tell a number from a string.
    if (!services || !services.program || !services.esTreeNodeToTSNodeMap) return {};

    const checker = services.program.getTypeChecker();

    function liczbowe(node) {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      if (!tsNode) return false;
      try {
        return zawieraLiczbe(checker.getTypeAtLocation(tsNode), checker);
      } catch {
        return false;
      }
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||') return;
        if (!jestNullem(node.right)) return;
        if (czytaDlugosc(node.left)) return;
        if (!liczbowe(node.left)) return;
        context.report({ node, messageId: 'logiczneLub' });
      },

      ConditionalExpression(node) {
        if (!jestNullem(node.alternate)) return;
        if (JAWNE_SPRAWDZENIE.has(node.test.type)) return;
        if (czytaDlugosc(node.test)) return;
        if (!liczbowe(node.test)) return;
        context.report({ node, messageId: 'warunkowe' });
      },
    };
  },
};
