
const base64Digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeVlq(n) {
  // Set the sign bit as the least significant bit.
  n = n >= 0 ? 2 * n : 1 - 2 * n;
  // Encode into a base64 run.
  let result = '';
  while (true) {
    // Extract the lowest 5 bits and remove them from the number.
    const digit = n & 0x1f;
    n >>= 5;
    // Is there anything more left to encode?
    if (n === 0) {
      // We are done encoding, finish the run.
      result += base64Digits[digit];
      break;
    } else {
      // There is still more encode, so add the digit and the continuation bit.
      result += base64Digits[0x20 + digit];
    }
  }
  return result;
}

export function encodeVlqList(list) {
  return list.map(encodeVlq).join('');
}


export class OriginalScopeBuilder {
  #encodedScope = '';
  #lastLine = 0;
  #lastColumn = 0;
  #lastKind = 0;
  #names = [];
  #scopeCounter = 0;

  /** The 'names' field of the SourceMap. The builder will modify it. */
  constructor(names) {
    this.#names = names;
  }

  get lastWrittenScopeIdx() {
    return this.#scopeCounter - 1;
  }

  start(line, column, options) {
    if (this.#encodedScope !== '') {
      this.#encodedScope += ',';
    }

    if (line < this.#lastLine || (line === this.#lastLine && column <= this.#lastColumn)) {
      // throw new Error('Scopes start must not overlap with previous scope!');
    }

    const lineDiff = line - this.#lastLine;
    this.#lastLine = line;
    this.#lastColumn = column;
    let flags = 0;
    const nameIdxAndKindIdx = [];

    if (options?.name) {
      flags |= 0x1;
      nameIdxAndKindIdx.push(this.#nameIdx(options.name));
    }
    if (options?.kind) {
      flags |= 0x2;
      nameIdxAndKindIdx.push(this.#encodeKind(options?.kind));
    }
    if (options?.isStackFrame) {
      flags |= 0x4;
    }

    this.#encodedScope += encodeVlqList([lineDiff, column, flags, ...nameIdxAndKindIdx]);

    if (options?.variables) {
      this.#encodedScope += encodeVlqList(options.variables.map(variable => this.#nameIdx(variable)));
    }

    this.#scopeCounter++;

    return this;
  }

  end(line, column) {
    if (this.#encodedScope !== '') {
      this.#encodedScope += ',';
    }

    if (line < this.#lastLine || (line === this.#lastLine && column <= this.#lastColumn)) {
      // throw new Error('Scopes end must not come before scope start!');
    }

    const lineDiff = line - this.#lastLine;
    this.#lastLine = line;
    this.#lastColumn = column;
    this.#encodedScope += encodeVlqList([lineDiff, column]);
    this.#scopeCounter++;

    return this;
  }

  build() {
    const result = this.#encodedScope;
    this.#lastLine = 0;
    this.#encodedScope = '';
    return result;
  }

  #encodeKind(kind) {
    const kindIdx = this.#nameIdx(kind);
    const encodedIdx = kindIdx - this.#lastKind;
    this.#lastKind = kindIdx;
    return encodedIdx;
  }

  #nameIdx(name) {
    let idx = this.#names.indexOf(name);
    if (idx < 0) {
      idx = this.#names.length;
      this.#names.push(name);
    }
    return idx;
  }
}

export class GeneratedRangeBuilder {
  #encodedRange = '';
  #state = {
    line: 0,
    column: 0,
    defSourceIdx: 0,
    defScopeIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };

  #names = [];

  /** The 'names' field of the SourceMap. The builder will modify it. */
  constructor(names) {
    this.#names = names;
  }

  start(line, column, options) {
    this.#emitLineSeparator(line);
    this.#emitItemSepratorIfRequired();

    const emittedColumn = column - (this.#state.line === line ? this.#state.column : 0);
    this.#encodedRange += encodeVlq(emittedColumn);

    this.#state.line = line;
    this.#state.column = column;

    let flags = 0;
    if (options?.definition) {
      flags |= 0x1;
    }
    if (options?.callsite) {
      flags |= 0x2;
    }
    if (options?.isStackFrame) {
      flags |= 0x4;
    }
    if (options?.isHidden) {
      flags |= 0x8;
    }
    this.#encodedRange += encodeVlq(flags);

    if (options?.definition) {
      const {sourceIdx, scopeIdx} = options.definition;
      this.#encodedRange += encodeVlq(sourceIdx - this.#state.defSourceIdx);

      const emittedScopeIdx = scopeIdx - (this.#state.defSourceIdx === sourceIdx ? this.#state.defScopeIdx : 0);
      this.#encodedRange += encodeVlq(emittedScopeIdx);

      this.#state.defSourceIdx = sourceIdx;
      this.#state.defScopeIdx = scopeIdx;
    }

    if (options?.callsite) {
      const {sourceIdx, line, column} = options.callsite;
      this.#encodedRange += encodeVlq(sourceIdx - this.#state.callsiteSourceIdx);

      const emittedLine = line - (this.#state.callsiteSourceIdx === sourceIdx ? this.#state.callsiteLine : 0);
      this.#encodedRange += encodeVlq(emittedLine);

      const emittedColumn = column - (this.#state.callsiteLine === line ? this.#state.callsiteColumn : 0);
      this.#encodedRange += encodeVlq(emittedColumn);

      this.#state.callsiteSourceIdx = sourceIdx;
      this.#state.callsiteLine = line;
      this.#state.callsiteColumn = column;
    }

    for (const bindings of options?.bindings ?? []) {
      if (bindings === undefined || typeof bindings === 'string') {
        this.#encodedRange += encodeVlq(this.#nameIdx(bindings));
        continue;
      }

      this.#encodedRange += encodeVlq(-bindings.length);
      this.#encodedRange += encodeVlq(this.#nameIdx(bindings[0].name));
      if (bindings[0].line !== line || bindings[0].column !== column) {
        throw new Error('First binding line/column must match the range start line/column');
      }

      for (let i = 1; i < bindings.length; ++i) {
        const {line, column, name} = bindings[i];
        const emittedLine = line - bindings[i - 1].line;
        const emittedColumn = column - (line === bindings[i - 1].line ? bindings[i - 1].column : 0);
        this.#encodedRange += encodeVlq(emittedLine);
        this.#encodedRange += encodeVlq(emittedColumn);
        this.#encodedRange += encodeVlq(this.#nameIdx(name));
      }
    }

    return this;
  }

  end(line, column) {
    this.#emitLineSeparator(line);
    this.#emitItemSepratorIfRequired();

    const emittedColumn = column - (this.#state.line === line ? this.#state.column : 0);
    this.#encodedRange += encodeVlq(emittedColumn);

    this.#state.line = line;
    this.#state.column = column;

    return this;
  }

  #emitLineSeparator(line) {
    for (let i = this.#state.line; i < line; ++i) {
      this.#encodedRange += ';';
    }
  }

  #emitItemSepratorIfRequired() {
    if (this.#encodedRange !== '' && this.#encodedRange[this.#encodedRange.length - 1] !== ';') {
      this.#encodedRange += ',';
    }
  }

  #nameIdx(name) {
    if (name === undefined) {
      return -1;
    }

    let idx = this.#names.indexOf(name);
    if (idx < 0) {
      idx = this.#names.length;
      this.#names.push(name);
    }
    return idx;
  }

  build() {
    const result = this.#encodedRange;
    this.#state = {
      line: 0,
      column: 0,
      defSourceIdx: 0,
      defScopeIdx: 0,
      callsiteSourceIdx: 0,
      callsiteLine: 0,
      callsiteColumn: 0,
    };
    this.#encodedRange = '';
    return result;
  }
}

export function encode_original_scopes(scopes, names) {
  if (!scopes) return null;

  let sourceIdx = 0;
  return scopes.map(scope => {
    const builder = new OriginalScopeBuilder(names);
    encode_original_scope(scope, builder, sourceIdx++);
    return builder.build();
  });
}

function encode_original_scope(scope, builder, sourceIdx) {
  builder.start(scope.start.line, scope.start.col, { kind: scope.kind, name: scope.name, variables: scope.variables, isStackFrame: scope.isStackFrame });
  scope.definition = { sourceIdx, scopeIdx: builder.lastWrittenScopeIdx };

  for (const child of scope.children) {
    try {
      encode_original_scope(child, builder, sourceIdx);
    } catch (e) {
      console.error("Unable to encode scope");
      console.error("Scope:  ", child);
      console.error("Parent: ", scope);
      throw e;
    }
  }

  builder.end(scope.end.line, scope.end.col);
}

export function encode_generated_ranges(ranges, names) {
  if (!ranges) return null;

  const builder = new GeneratedRangeBuilder(names);
  ranges.forEach(range => encode_generated_range(range, builder));
  return builder.build();
}

function encode_generated_range(range, builder) {
  builder.start(range.start.line, range.start.col, { definition: range.originalScope?.definition, bindings: range.values, callsite: range.callsite, isStackFrame: range.isStackFrame });

  for (const child of range.children) {
    encode_generated_range(child, builder);
  }

  builder.end(range.end.line, range.end.col);
}
