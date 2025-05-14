import { AST_Defun, AST_Arrow, AST_Scope, TreeWalker, AST_SymbolDefun, AST_Accessor, AST_DefClass, AST_ClassExpression, AST_Function, AST_SymbolLambda } from "./ast.js";
import { SymbolDef } from "./scope.js";

/**
 * Builds the original scope tree for a single input file.
 */
export function process_original_scopes(options_parse, scopeInfoBuilder) {
  const { toplevel, filename } = options_parse;
  const startIndex = toplevel.body.findIndex(node => node.start.file === filename);
  const startNode = toplevel.body[startIndex];
  const end = toplevel.end;

  scopeInfoBuilder.startScope(startNode.start.line, startNode.start.col, { kind: "global" });
  if (toplevel.variables) {
    addScopeVariables(scopeInfoBuilder, filterByFile(toplevel.variables, filename));
  }
  const scope = scopeInfoBuilder.currentScope();
  toplevel.original = { scope };
  if (!scopeInfoBuilder.files) {
    scopeInfoBuilder.files = [];
  }
  scopeInfoBuilder.files.push(filename);
  if (!scopeInfoBuilder.fileScopes) {
    scopeInfoBuilder.fileScopes = [];
  }
  scopeInfoBuilder.fileScopes.push(scope);

  for (let i = startIndex; i < toplevel.body.length; i++) {
    const node = toplevel.body[i];
    node.walk(new TreeWalker((node, descend) => {
      if (node.is_block_scope()) {
        scopeInfoBuilder.startScope(node.block_scope.start.line, node.block_scope.start.col, { kind: "block" });
        if (node.block_scope.variables) {
          addScopeVariables(scopeInfoBuilder, [...node.block_scope.variables.values()]);
        }
        node.original = { scope: scopeInfoBuilder.currentScope() };

        descend();

        scopeInfoBuilder.endScope(node.block_scope.end.line, node.block_scope.end.col + 1);
        return true;
      }

      if (node instanceof AST_Scope && !(node instanceof AST_DefClass) && !(node instanceof AST_ClassExpression)) {
        const kind =
              (node instanceof AST_Defun) ? "function"
            : (node instanceof AST_Function) ? "function"
            : (node instanceof AST_Arrow) ? "function"
            : (node instanceof AST_Accessor) ? "accessor"
            : undefined;
        scopeInfoBuilder.startScope(node.start.line, node.start.col, { kind, isStackFrame: true });
        if (node.variables) {
          addScopeVariables(scopeInfoBuilder, filterUnusedArgumentsVar(node.variables));
        }
        node.original = { scope: scopeInfoBuilder.currentScope() };

        descend();

        scopeInfoBuilder.endScope(node.end.line, node.end.col + 1);
        return true;
      }

      if (node instanceof AST_SymbolDefun || node instanceof AST_SymbolLambda) {
        scopeInfoBuilder.setScopeName(node.name);
      }
    }));
  }

  scopeInfoBuilder.endScope(end.line, end.col + 1);
}

function addScopeVariables(scopeInfoBuilder, variableNodes) {
  scopeInfoBuilder.setScopeVariables(variableNodes.map(v => v.name));
  scopeInfoBuilder.currentScope().variableIds = variableNodes.map(v => v.original_id);
}

/**
 * Builds the GeneratedRanges for a given toplevel AST node.
 */
export function process_generated_ranges(toplevel, scopeInfoBuilder) {
  for (const scope of scopeInfoBuilder.fileScopes) {
    const values = [];
    if (scope?.variables) {
      for (let i = 0; i < scope.variables.length; i++) {
        values.push(SymbolDef.generated_names.get(scope.variableIds[i]) ?? scope.variables[i]);
      }
    }

    scopeInfoBuilder.startRange(toplevel.gen_start.line, toplevel.gen_start.col, { scope, values });
  }

  for (const node of toplevel.body) {
    node.walk(new TreeWalker((node, descend) => {
      const values = [];
      const scope = node.original?.scope;
      if (scope?.variables) {
        for (let i = 0; i < scope.variables.length; i++) {
          values.push(SymbolDef.generated_names.get(scope.variableIds[i]) ?? scope.variables[i]);
        }
      }

      if (node.is_block_scope()) {
        startRangeForNode(node, values, scopeInfoBuilder);
        descend();
        endRangeForNode(node, scopeInfoBuilder);
        return true;
      }

      if (node instanceof AST_Scope && !(node instanceof AST_DefClass) && !(node instanceof AST_ClassExpression)) {
        startRangeForNode(node, values, scopeInfoBuilder);
        scopeInfoBuilder.setRangeStackFrame(true);
        descend();
        endRangeForNode(node, scopeInfoBuilder);
        return true;
      }

      if (node.original) {
        startRangeForNode(node, values, scopeInfoBuilder);
        descend();
        endRangeForNode(node, scopeInfoBuilder);
        return true;
      }
    }));
  }

  for (let i = 0; i < scopeInfoBuilder.fileScopes.length; i++) {
    scopeInfoBuilder.endRange(toplevel.gen_end.line, toplevel.gen_end.col);
  }
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

function filterByFile(variables, filename) {
  const result = [];
  for (const [, value] of variables.entries()) {
    if (value.orig.some(node => node.start.file === filename)) {
      result.push(value);
    }
  }
  return result;
}

function startRangeForNode(node, values, scopeInfoBuilder) {
  let callSite;
  if (node.original?.callsite) {
    const { line, col: column } = node.original.callsite;
    callSite = {
      sourceIndex: scopeInfoBuilder.files.indexOf(node.original.callsite.file),
      line,
      column,
    };
  }
  scopeInfoBuilder.startRange(node.gen_start.line, node.gen_start.col, { scope: node.original?.scope, values, callSite });
}

function endRangeForNode(node, scopeInfoBuilder) {
  scopeInfoBuilder.endRange(node.gen_end.line, node.gen_end.col);
}
