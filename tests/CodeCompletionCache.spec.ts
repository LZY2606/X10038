/*
 * This file is released under the MIT license.
 * Copyright (c) 2016, 2023 Mike Lischke
 *
 * See LICENSE file for more info.
 */

// cspell: disable

import {
    BaseErrorListener, CharStream, CommonTokenStream, RecognitionException, Recognizer, Token, ATNSimulator,
} from "antlr4ng";
import { describe, expect, it } from "vitest";

import { ExprLexer } from "./generated/ExprLexer";
import { ExprParser } from "./generated/ExprParser";
import { ExprConflictLexer } from "./generated/ExprConflictLexer";
import { ExprConflictParser } from "./generated/ExprConflictParser";
import { LongChainLexer } from "./generated/LongChainLexer";
import { LongChainParser } from "./generated/LongChainParser";

import { CandidatesCollection, CodeCompletionCore } from "../src/CodeCompletionCore";

class TestErrorListener extends BaseErrorListener {
    public errorCount = 0;

    public override syntaxError<S extends Token, T extends ATNSimulator>(_recognizer: Recognizer<T>,
        _offendingSymbol: S | null, _line: number, _column: number, _msg: string,
        _e: RecognitionException | null): void {
        ++this.errorCount;
    }
}

/**
 * Returns a deterministic, order independent representation of a candidates collection, so that collections
 * from different runs can be compared for equality.
 *
 * @param candidates The candidates collection to serialize.
 * @returns A plain object with sorted token and rule entries.
 */
const serializeCandidates = (candidates: CandidatesCollection): unknown => {
    const tokens = [...candidates.tokens.entries()]
        .sort((left, right) => {
            return left[0] - right[0]; 
        })
        .map(([token, following]) => {
            return [token, [...following]]; 
        });
    const rules = [...candidates.rules.entries()]
        .sort((left, right) => {
            return left[0] - right[0]; 
        })
        .map(([rule, info]) => {
            return [rule, info.startTokenIndex, [...info.ruleList]]; 
        });

    return { tokens, rules };
};

/**
 * Reads the (otherwise private) number of processed ATN states of the last collectCandidates run.
 *
 * @param core The completion core to inspect.
 * @returns The number of ATN states processed by the last collectCandidates call.
 */
const statesProcessed = (core: CodeCompletionCore): number => {
    return (core as unknown as { statesProcessed: number; }).statesProcessed;
};

describe("Code Completion Cache Tests", () => {
    describe("Follow set cache isolation between parsers:", () => {
        // ExprParser and ExprConflictParser share the same first constructor name letter ("E"), but have
        // completely different ATNs. They must not see each other's cached follow sets.
        const exprInput = "var c = a + b()";
        const conflictInput = "SELECT a, b FROM t";

        const createExprCore = (): CodeCompletionCore => {
            const lexer = new ExprLexer(CharStream.fromString(exprInput));
            const tokenStream = new CommonTokenStream(lexer);
            const parser = new ExprParser(tokenStream);
            const errorListener = new TestErrorListener();
            parser.removeErrorListeners();
            parser.addErrorListener(errorListener);
            parser.expression();
            expect(errorListener.errorCount).toEqual(0);

            const core = new CodeCompletionCore(parser);
            core.ignoredTokens = new Set([
                ExprLexer.ID, ExprLexer.PLUS, ExprLexer.MINUS, ExprLexer.MULTIPLY, ExprLexer.DIVIDE, ExprLexer.EQUAL,
            ]);
            core.preferredRules = new Set([ExprParser.RULE_functionRef, ExprParser.RULE_variableRef]);

            return core;
        };

        const createConflictCore = (): { core: CodeCompletionCore; eofIndex: number; } => {
            const lexer = new ExprConflictLexer(CharStream.fromString(conflictInput));
            const tokenStream = new CommonTokenStream(lexer);
            const parser = new ExprConflictParser(tokenStream);
            const errorListener = new TestErrorListener();
            parser.removeErrorListeners();
            parser.addErrorListener(errorListener);
            parser.query();
            expect(errorListener.errorCount).toEqual(0);

            tokenStream.fill();
            const eofIndex = tokenStream.getTokens().findIndex((token) => {
                return token.type === Token.EOF;
            });

            return { core: new CodeCompletionCore(parser), eofIndex };
        };

        it("Candidates of same-initial parsers do not depend on invocation order", () => {
            // Order 1: the Expr parser runs first in this process.
            const exprRun1 = serializeCandidates(createExprCore().collectCandidates(0));
            const exprAtRefRun1 = serializeCandidates(createExprCore().collectCandidates(6));
            const conflictRun1 = createConflictCore();
            const conflictAtStartRun1 = serializeCandidates(conflictRun1.core.collectCandidates(0));
            const conflictAtEndRun1 = serializeCandidates(conflictRun1.core.collectCandidates(conflictRun1.eofIndex));
            const exprRun2 = serializeCandidates(createExprCore().collectCandidates(0));

            // Order 2 (symmetric entry): the ExprConflict parser runs first.
            const conflictRun2 = createConflictCore();
            const conflictAtStartRun2 = serializeCandidates(conflictRun2.core.collectCandidates(0));
            const conflictAtEndRun2 = serializeCandidates(conflictRun2.core.collectCandidates(conflictRun2.eofIndex));
            const exprRun3 = serializeCandidates(createExprCore().collectCandidates(0));
            const exprAtRefRun2 = serializeCandidates(createExprCore().collectCandidates(6));
            const conflictRun3 = createConflictCore();
            const conflictAtStartRun3 = serializeCandidates(conflictRun3.core.collectCandidates(0));

            // Each parser must produce the same token and rule candidates, regardless of what ran before it.
            expect(exprRun2).toEqual(exprRun1);
            expect(exprRun3).toEqual(exprRun1);
            expect(exprAtRefRun2).toEqual(exprAtRefRun1);
            expect(conflictAtStartRun2).toEqual(conflictAtStartRun1);
            expect(conflictAtStartRun3).toEqual(conflictAtStartRun1);
            expect(conflictAtEndRun2).toEqual(conflictAtEndRun1);
        });

        it("Same-initial parsers return their own candidates when interleaved", () => {
            // Interleave both parsers and check the actual candidate content after each switch.
            const exprCore = createExprCore();
            const conflict = createConflictCore();

            const exprCandidates = exprCore.collectCandidates(0);
            expect(exprCandidates.tokens.size).toEqual(2);
            expect(exprCandidates.tokens.has(ExprLexer.VAR)).toEqual(true);
            expect(exprCandidates.tokens.has(ExprLexer.LET)).toEqual(true);

            const conflictCandidates = conflict.core.collectCandidates(0);
            expect(conflictCandidates.tokens.size).toEqual(1);
            expect(conflictCandidates.tokens.has(ExprConflictLexer.SELECT)).toEqual(true);

            // Rule candidates of the Expr parser must still be intact after the other parser ran.
            const exprRuleCandidates = exprCore.collectCandidates(6);
            expect(exprRuleCandidates.rules.get(ExprParser.RULE_functionRef)?.startTokenIndex).toEqual(6);
            expect(exprRuleCandidates.rules.get(ExprParser.RULE_variableRef)?.startTokenIndex).toEqual(6);

            // And the ExprConflict parser must still offer its own follow token at the input end.
            const conflictEndCandidates = conflict.core.collectCandidates(conflict.eofIndex);
            expect(conflictEndCandidates.tokens.has(ExprConflictLexer.WHERE)).toEqual(true);
        });
    });

    describe("Memoization for long token streams:", () => {
        // Builds a recursive chain with the given number of links, terminated by a STOP token
        // (39 IDs and a PLUS per link, the last link ends with STOP). Each link adds 40 default
        // channel tokens. Both link alternatives re-enter the same rules at the same token positions,
        // so only the memoization in processRule keeps the evaluation count linear in the input size.
        const linkText = "a".repeat(39);
        const buildChain = (links: number): string => {
            return (linkText + "+").repeat(links - 1) + linkText + ";";
        };

        const createChainCore = (input: string, parseInput: boolean) => {
            const lexer = new LongChainLexer(CharStream.fromString(input));
            const tokenStream = new CommonTokenStream(lexer);
            const parser = new LongChainParser(tokenStream);
            const errorListener = new TestErrorListener();
            parser.removeErrorListeners();
            parser.addErrorListener(errorListener);
            if (parseInput) {
                parser.chain();
            }
            tokenStream.fill();

            // Caret on the STOP token if there is one, otherwise on EOF (error recovery inputs).
            const tokens = tokenStream.getTokens();
            const caretIndex = tokens.findIndex((token) => {
                return token.type === LongChainLexer.STOP || token.type === Token.EOF;
            });

            return {
                core: new CodeCompletionCore(parser),
                caretIndex,
                errorListener,
                tokenCount: tokens.length,
            };
        };

        it("Long chain just below the 16-bit token boundary stays consistent", () => {
            // 1638 links produce 65521 default channel tokens, so every token list index still
            // fits into 16 bits.
            const run = createChainCore(buildChain(1638), false);
            expect(run.tokenCount).toEqual(65521);

            const firstCandidates = serializeCandidates(run.core.collectCandidates(run.caretIndex));
            const firstStates = statesProcessed(run.core);
            const secondCandidates = serializeCandidates(run.core.collectCandidates(run.caretIndex));
            const secondStates = statesProcessed(run.core);

            expect(secondCandidates).toEqual(firstCandidates);
            expect(secondStates).toEqual(firstStates);
        }, 120000);

        it("Long chain beyond the 16-bit token boundary keeps memoization", () => {
            // 1800 links produce 72001 default channel tokens. Token list indexes beyond 65535 must
            // still be memoized correctly and must not alias lower positions.
            const run = createChainCore(buildChain(1800), false);
            expect(run.tokenCount).toEqual(72001);

            // A short chain in the same syntactic situation at the caret acts as the oracle for
            // the expected candidates. It is parsed to prove the input shape is syntactically valid.
            const oracle = createChainCore(buildChain(3), true);
            expect(oracle.errorListener.errorCount).toEqual(0);
            const oracleCandidates = serializeCandidates(oracle.core.collectCandidates(oracle.caretIndex));

            const firstCandidates = serializeCandidates(run.core.collectCandidates(run.caretIndex));
            const firstStates = statesProcessed(run.core);

            // Repeated completion on the same engine instance.
            const secondCandidates = serializeCandidates(run.core.collectCandidates(run.caretIndex));
            const secondStates = statesProcessed(run.core);

            // Symmetric entry: a fresh engine instance on the same input.
            const fresh = createChainCore(buildChain(1800), false);
            const thirdCandidates = serializeCandidates(fresh.core.collectCandidates(fresh.caretIndex));

            expect(secondCandidates).toEqual(firstCandidates);
            expect(thirdCandidates).toEqual(firstCandidates);
            expect(firstCandidates).toEqual(oracleCandidates);

            // The memoization must not degrade: a repeated run visits the same number of states and the
            // overall work stays linear in the input size (a broken shortcut map grows exponentially).
            expect(secondStates).toEqual(firstStates);
            expect(firstStates).toBeLessThan(100 * run.tokenCount);
        }, 120000);

        it("Repeated completion after a syntax error near the input end stays consistent", () => {
            // A dangling operator at the end forces the parser into error recovery. Completion must still
            // produce stable candidates and stable visit counts on repeated calls.
            const run = createChainCore(("a".repeat(39) + "+").repeat(1500), true);
            expect(run.errorListener.errorCount).toBeGreaterThan(0);

            // Oracle: the same syntactic situation (a link is expected after an operator) in a short input.
            const oracle = createChainCore("a".repeat(39) + "+", true);
            expect(oracle.errorListener.errorCount).toBeGreaterThan(0);
            const oracleCandidates = serializeCandidates(oracle.core.collectCandidates(oracle.caretIndex));

            const firstCandidates = serializeCandidates(run.core.collectCandidates(run.caretIndex));
            const firstStates = statesProcessed(run.core);
            const secondCandidates = serializeCandidates(run.core.collectCandidates(run.caretIndex));
            const secondStates = statesProcessed(run.core);

            expect(secondCandidates).toEqual(firstCandidates);
            expect(firstCandidates).toEqual(oracleCandidates);
            expect(secondStates).toEqual(firstStates);
        }, 120000);
    });
});
