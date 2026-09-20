grammar Wumpus;

@header {
/* eslint-disable @typescript-eslint/no-unused-vars, no-useless-escape */
}

// A second parser whose generated class name (WumpusParser) starts with the same
// letter as WhiteboxParser but whose ATN is intentionally different. It is used to
// prove that follow-set caching is scoped per parser class instead of keyed by the
// first character of the parser name.
//
// QUX is declared before WUMPUS so that WUMPUS gets a token type distinct from
// WhiteboxLexer.LOREM, making a cross-parser follow-set collision observable in the
// returned candidate tokens.
wumpus: creature QUX;
creature: WUMPUS;

QUX: 'QUX';
WUMPUS: 'WUMPUS';
WS: [ \n\r\t] -> skip;
