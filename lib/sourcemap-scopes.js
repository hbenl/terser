import { AST_Defun, AST_Arrow, AST_Scope, walk, TreeWalker, AST_SymbolDefun, AST_Accessor, AST_DefClass, AST_ClassExpression, AST_Function, AST_SymbolLambda } from "./ast.js";

/**
 * Builds the original scope tree for a single input file.
 */
export function process_original_scopes(options_parse) {
  const { toplevel, filename } = options_parse;
  const startIndex = toplevel.body.findIndex(node => node.start.file === filename);
  const startNode = toplevel.body[startIndex];
  const end = toplevel.end;

  const toplevelScope = {
    start: { line: startNode.start.line, col: startNode.start.col },
    end: { line: end.line, col: end.col },
    kind: "global",
    children: [],
  };
  
  for (let i = startIndex; i < toplevel.body.length; ++i) {
    let currentScope = toplevelScope;
    const tw = new TreeWalker((node, descend) => {
      if (node.is_block_scope()) {
        const scope = baseScopeFromNode(node.block_scope);
        scope.kind = "block";
        scope.variables = [...node.block_scope.variables?.keys()];
        currentScope.children.push(scope);
        node.originalScope = scope;

        const savedScope = currentScope;
        currentScope = scope;

        descend();

        currentScope = savedScope;
        return true;
      }
      if (node instanceof AST_Scope && !(node instanceof AST_DefClass) && !(node instanceof AST_ClassExpression)) {
        const scope = baseScopeFromNode(node);
        scope.kind =
              (node instanceof AST_Defun) ? "function"
            : (node instanceof AST_Function) ? "function"
            : (node instanceof AST_Arrow) ? "function"
            : (node instanceof AST_Accessor) ? "accessor"
            : undefined;
        if (node.variables) {
          scope.variables = filterUnusedArgumentsVar(node.variables).map(def => def.name);
        }
        scope.isStackFrame = true;
        currentScope.children.push(scope);
        node.originalScope = scope;

        const savedScope = currentScope;
        currentScope = scope;

        descend();

        currentScope = savedScope;
        return true;
      } else if (node instanceof AST_SymbolDefun) {
        currentScope.name = node.name;
      } else if (node instanceof AST_SymbolLambda) {
        currentScope.name = node.name;
      } else {
        // console.info(node);
      }
    });
    toplevel.body[i].walk(tw);
  }

  if (toplevel.originalScopes === undefined) {
    toplevel.originalScopes = [];
  }
  toplevel.originalScopes.push([startIndex, toplevel.body.length, toplevelScope]);

  return toplevelScope;
}

/**
 * Builds the GeneratedRanges for a given toplevel AST node.
 */
export function process_generated_ranges(toplevel) {
  const result = [];
  for (const [, , scope] of toplevel.originalScopes) {
    const startIndex = 0;
    const endIndex = toplevel.body.length;
    const startNode = toplevel.body[startIndex];
    const endNode = toplevel.body[endIndex - 1];
    const toplevelRange = {
      start: {...startNode.gen_start},
      end: {...endNode.gen_end},
      originalScope: scope,
      children: [],
    };

    for (let i = startIndex; i < endIndex; ++i) {
      let currentRange = toplevelRange;
      const tw = new TreeWalker((node, descend) => {
        if (node.is_block_scope()) {
          const range = baseRangeFromNode(node);
          if (node.block_scope.variables) {
            range.values = filterUnusedArgumentsVar(node.block_scope.variables).map(def => def.mangled_name ?? undefined);
          }
          currentRange.children.push(range);

          const savedRange = currentRange;
          currentRange = range;

          descend();

          currentRange = savedRange;
          return true;
        }
        if (node instanceof AST_Scope && !(node instanceof AST_DefClass) && !(node instanceof AST_ClassExpression)) {
          const range = baseRangeFromNode(node);
          if (node.variables) {
            range.values = [...node.variables.values()].map(def => def.mangled_name ?? undefined);
          }
          range.isStackFrame = true;
          currentRange.children.push(range);

          const savedRange = currentRange;
          currentRange = range;

          descend();

          currentRange = savedRange;
          return true;
        }
        if (node.originalScope) {
          const range = baseRangeFromNode(node);
          currentRange.children.push(range);

          const savedRange = currentRange;
          currentRange = range;

          descend();

          currentRange = savedRange;
          return true;
        }
      });
      toplevel.body[i].walk(tw);
    }

    result.push(toplevelRange);
  }
  return result;
}

function filterUnusedArgumentsVar(variables) {
  const result = [];
  for (const [key, value] of variables.entries()) {
    if (key !== "arguments" || value.references.length > 0) {
      result.push(value);
    }
  }
  return result;
}

function baseScopeFromNode(node) {
  return {
    start: { line: node.start.line, col: node.start.col },
    end: { line: node.end.line, col: node.end.col },
    children: [],
  };
}

function baseRangeFromNode(node) {
  return {
    start: {...node.gen_start},
    end: {...node.gen_end},
    originalScope: node.originalScope,
    children: [],
  };
}