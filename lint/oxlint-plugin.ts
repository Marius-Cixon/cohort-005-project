import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree, Scope } from "@oxlint/plugins";

// `sql.raw` and `sql.identifier` paste their argument into the query text.
// A value that can change at runtime belongs in a parameter instead.
const RAW_METHODS = new Set(["raw", "identifier"]);

function unwrap(node: ESTree.Expression): ESTree.Expression {
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    return unwrap(node.expression);
  }
  return node;
}

function findVariable(scope: Scope | null, name: string) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return undefined;
}

// Static means the text is fixed in the source: a string literal, a template
// without `${}`, or a `const` bound to one of those.
function isStatic(node: ESTree.Expression, scope: Scope, depth = 0): boolean {
  const expression = unwrap(node);
  if (expression.type === "Literal") {
    return typeof expression.value === "string";
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.length === 0;
  }
  if (expression.type !== "Identifier" || depth > 5) return false;

  const definition = findVariable(scope, expression.name)?.defs[0];
  if (definition?.type !== "Variable") return false;
  const declarator = definition.node;
  const declaration = definition.parent;
  if (declarator.type !== "VariableDeclarator" || !declarator.init) {
    return false;
  }
  if (declaration?.type !== "VariableDeclaration") return false;
  if (declaration.kind !== "const") return false;
  return isStatic(declarator.init, scope, depth + 1);
}

function isDrizzleSource(source: string) {
  return source === "drizzle-orm" || source.startsWith("drizzle-orm/");
}

export const noDynamicSqlRaw = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Allow drizzle's sql.raw / sql.identifier only with text fixed in the source.",
    },
    messages: {
      dynamic:
        "sql.{{method}}() pastes this value into the query text (SQL injection). " +
        "Pass values as parameters: sql`... ${value}` or drizzle operators like eq() and like().",
    },
  },
  create(context) {
    const sqlNames = new Set<string>();
    return {
      ImportSpecifier(node) {
        const declaration = node.parent;
        if (declaration.type !== "ImportDeclaration") return;
        if (!isDrizzleSource(String(declaration.source.value))) return;
        const imported = node.imported;
        if (imported.type === "Identifier" && imported.name === "sql") {
          sqlNames.add(node.local.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.object.type !== "Identifier") return;
        if (!sqlNames.has(callee.object.name)) return;
        if (callee.property.type !== "Identifier") return;
        if (!RAW_METHODS.has(callee.property.name)) return;

        const argument = node.arguments[0];
        if (!argument || argument.type === "SpreadElement") return;
        if (isStatic(argument, context.sourceCode.getScope(node))) return;

        context.report({
          node: argument,
          messageId: "dynamic",
          data: { method: callee.property.name },
        });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "local" },
  rules: { "no-dynamic-sql-raw": noDynamicSqlRaw },
});
