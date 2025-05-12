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
    addScopeVariables(scopeInfoBuilder, [...toplevel.variables.values()]);
  }
  toplevel.original = { scope: scopeInfoBuilder.currentScope() };

  for (const node of toplevel.body) {
    node.walk(new TreeWalker((node, descend) => {
      if (node.is_block_scope()) {
        scopeInfoBuilder.startScope(node.block_scope.start.line, node.block_scope.start.col, { kind: "block" });
        if (node.block_scope.variables) {
          addScopeVariables(scopeInfoBuilder, [...node.block_scope.variables.values()]);
        }
        node.original = { scope: scopeInfoBuilder.currentScope() };

        descend();

        scopeInfoBuilder.endScope(node.block_scope.end.line, node.block_scope.end.col);
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

        scopeInfoBuilder.endScope(node.end.line, node.end.col);
        return true;
      }

      if (node instanceof AST_SymbolDefun || node instanceof AST_SymbolLambda) {
        scopeInfoBuilder.setScopeName(node.name);
      }
    }));
  }

  scopeInfoBuilder.endScope(end.line, end.col);
}

function addScopeVariables(scopeInfoBuilder, variableNodes) {
  scopeInfoBuilder.setScopeVariables(variableNodes.map(v => v.name));
  scopeInfoBuilder.currentScope().variableIds = variableNodes.map(v => v.original_id);
}

/**
 * Builds the GeneratedRanges for a given toplevel AST node.
 */
export function process_generated_ranges(toplevel, scopeInfoBuilder) {
  // TODO support multiple files
  const scope = toplevel.original?.scope;
  const values = [];
  if (scope?.variables) {
    for (let i = 0; i < scope.variables.length; i++) {
      values.push(SymbolDef.generated_names.get(scope.variableIds[i]) ?? scope.variables[i]);
    }
  }

  startRangeForNode(toplevel, values, scopeInfoBuilder);

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

  const endNode = toplevel.body.at(-1);
  endRangeForNode(endNode, scopeInfoBuilder);
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

function startRangeForNode(node, values, scopeInfoBuilder) {
  let callsite;
  if (node.original?.callsite) {
    const { line, col: column } = node.original.callsite;
    callsite = {
      sourceIndex: 0, // TODO use callsite.file to compute sourceIdx
      line,
      column,
    };
  }
  scopeInfoBuilder.startRange(node.gen_start.line, node.gen_start.col, { scope: node.original?.scope, values, callsite });
}

function endRangeForNode(node, scopeInfoBuilder) {
  scopeInfoBuilder.endRange(node.gen_end.line, node.gen_end.col);
}
