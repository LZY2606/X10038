grammar LongToken;

@header {
/* eslint-disable @typescript-eslint/no-unused-vars, no-useless-escape */
}

// Grammar for long token stream memoization tests.
//
// `cell` starts with the same non-terminal (`piece`) from many alternatives which all
// accept the same continuation token (TAIL). While walking the ATN the code completion
// engine therefore re-enters `piece` at the same token position once per alternative;
// only the first visit walks the rule and every following visit must be served by the
// shortcut memoization. A stream of such cells reaches token positions beyond 65535
// cheaply and deterministically.
file: cell+ EOF;
cell
    : piece TAIL
    | piece TAIL
    | piece TAIL
    | piece TAIL
    | piece TAIL
    | piece TAIL
    | piece TAIL
    | piece TAIL
    ;
piece: HEAD;

HEAD: 'HEAD';
TAIL: 'TAIL';
WS: [ \n\r\t] -> skip;
