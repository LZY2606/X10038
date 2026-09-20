grammar ExprConflict;

@eader {
/* eslint-disable @typescript-eslint/no-unused-vars, no-useless-escape */
}

query: selectClause fromClause whereClause? EOF;

selectClause: SELECT columnList;
fromClause: FROM tableRef;
whereClause: WHERE columnRef;
columnList: columnRef (COMMA columnRef)*;
columnRef: IDENT;
tableRef: IDENT;

SELECT: 'SELECT';
FROM:   'FROM';
WHERE:  'WHERE';
COMMA:  ',';
IDENT:  [a-zA-Z]+;
WS:     [ \n\r\t] -> channel(HIDDEN);
