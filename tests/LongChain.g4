grammar LongChain;

@eader {
/* eslint-disable @typescript-eslint/no-unused-vars, no-useless-escape */
}

chain: link EOF;

// The two middle alternatives are intentionally identical: both recurse back into link at the same
// token position, so the C3 engine re-enters the link rule at the same token positions over and
// over. Only the memoization in CodeCompletionCore.processRule keeps the number of rule evaluations
// linear in the input size. Each link contributes 40 tokens, so that even inputs beyond 65535 tokens
// keep a recursion depth which the call stack can handle. The STOP token terminates the chain, so
// every rule ends at exactly one token position.
link: ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID PLUS link
    | ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID PLUS link
    | ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID ID STOP
    ;

ID:    [a-zA-Z];
PLUS:  '+';
STOP:  ';';
WS:    [ \n\r\t] -> channel(HIDDEN);
