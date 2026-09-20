# Changelog

本文件记录 antlr4-c3 在代码完成（completion）/follow set 缓存/长 token 流这一相关区域的修复与回归覆盖。

## 未发布（Unreleased）

### 修复

- **follow set 跨 parser 污染（缓存键冲突）**
  - 现象：同一进程里交错使用两个**类名首字母相同但 ATN 不同**的生成 parser 时，第二个 parser 的候选 token/rule 取决于调用顺序。
  - 根因：静态缓存 `CodeCompletionCore.followSetsByATN` 用 `this.parser.constructor.name[0]`（parser 类名的第一个字符）作键。两个首字母相同的 parser 类会命中同一张 `FollowSetsPerState`，而后者又以 ATN `stateNumber` 为键——不同 ATN 里相同状态号的语义完全不同，于是一个 parser 复用了另一个 parser 的 follow set。
  - 修复：改用 **parser 构造器本身**（`this.parser.constructor`，类型 `ParserConstructor = new (...args: unknown[]) => Parser`）作缓存键。构造器在每个进程内唯一标识一个 parser 类（也即其 ATN），与类名是否重名、是否同首字母无关；跨实例共享同一份 follow set 的既有优化保持不变。

- **默认通道 token 超过 65535 后递归语法失去 memoization**
  - 现象：默认通道 token 数越过 65535 后，按 token 位置缓存的递归规则 shortcut 开始失效，重复 ATN 走访增多（在高度歧义/递归语法里会显著放大）。
  - 根因：shortcut map **查找**用的是完整 `tokenListIndex`，**写入**却截断成 `tokenListIndex & 0xffff`。一旦过滤后的默认通道位置 ≥ 65536，写入键与查找键不再一致：`Map.has(full)` 永远找不到以 `full & 0xffff` 存入的条目（漏命中），而相隔 65536 的两个位置又互为别名（在 DFS 回溯时会读到别的位置的 `RuleEndStatus`）。
  - 修复：读写统一使用完整 `tokenListIndex`（`positionMap.set(tokenListIndex, result)`），删除 16 位掩码。JS 的 `Map` 键没有 16 位限制，无需掩码。
  - 诊断能力：新增公开只读计数器 `CodeCompletionCore.shortcutHits`，统计一次 `collectCandidates` 中“因 shortcut 命中而跳过的规则走访”次数，在每次调用开始时清零。它不改变任何算法行为，仅用于观察递归规则/长流上的 memoization 效果（本次回归测试即据此断言）。

### 实现选择

- follow set 缓存键选用**构造器对象**而非全限定类名字符串：构造器比较是 O(1) 引用相等，天然避免类名碰撞、压缩器改名（minification）以及同名不同类等问题，也不依赖任何命名约定。
- memoization 修复选择“去掉掩码”而不是“读写都掩码”：后者仍会让相隔 65536 的位置互为别名，属于保留缺陷；直接用完整索引才能在任意流长度下保持语义一致。
- 长流测试通过 `CommonToken.fromType` + `ListTokenSource` + `CommonTokenStream.fill()` **合成**确定性 token 流，不读取外部大文件、不使用本机绝对路径、不 sleep、不联网；既真实地越过 65535 边界，又把测试耗时控制在毫秒级。

### 原覆盖的空白（修复前为什么测不到）

- 原有 grammar 只有 `CPP14 / Expr / Whitebox` 三个 parser，且类名首字母各不相同（C/E/W），单一 parser 场景下首字母键永远不会碰撞，因此顺序依赖问题完全暴露不出来。
- 原有测试输入都很短（最长为仓库内的 `Parser.cpp`，约 3469 个完成位置），shortcut 位置远小于 65536，掩码在功能上等价于恒等映射；而且没有任何断言观测 memoization 的命中情况，所以掩码缺陷既不影响结果也无法被察觉。
- 新增 grammar 与测试精确补齐这两块：
  - `tests/Wumpus.g4`：生成 `WumpusParser`，与 `WhiteboxParser` 同首字母 W，但 ATN 不同（且刻意让 `QUX` 先于 `WUMPUS` 声明，使两 grammar 在冲突状态号上的首 token 类型不同，污染可直接体现在候选上）。
  - `tests/LongToken.g4`：`cell` 的多条分支都在同一位置调用非终止规则 `piece`，使每个位置的重复走访都依赖 shortcut；用合成流即可廉价地把 `piece` 位置推过 65535。

### 相邻语义的退化保护（回归测试同时守住的不变量）

- **候选结果与运行顺序无关**：两种交错顺序（Whitebox→Wumpus 与 Wumpus→Whitebox）下，各自的 token/rule 候选必须逐字节一致。
- **静态跨实例共享仍然成立**：同一 parser 类的多个 `CodeCompletionCore` 实例依旧共享 follow set（缓存按构造器、而非按实例），原有性能特征保留。
- **长流首次与重复 completion 一致**：第一次与第二次 `collectCandidates` 的候选 token 完全相同。
- **第二次调用访问量不退化**：重复 completion 的 `statesProcessed` 不大于第一次（`toBeLessThanOrEqual`），`shortcutHits` 两次相同。
- **边界两侧对称**：32768 个 cell（`piece` 最大位置 65534）与 32769 个 cell（`piece` 位置首次包含 65536）都保持完整 memoization；后者相对前者稳定地多命中 7 次（一次首访 + 其余 `cell` 分支命中），而不是在边界处掉回 0 增量。
- **失败恢复**：在交错污染场景下喂入多余 token、在长流中把某个 `TAIL` 改写成 `HEAD` 制造语法错误后，完成结果仍按各自 ATN 正确、可重复，且 memoization 依旧生效；错误监听器被移除，错误不会中断或污染完成过程。
- 既有的 22 条断言（Whitebox、Expr、CPP14，含真实 `Parser.cpp`）一条未删改，修复后全部继续通过。

### 最危险反例（ANTLR completion/follow set 缓存/长文件）及其回归用例

- **跨 parser follow set 污染**：在同一个进程/测试运行中先对 `WhiteboxParser`（输入 `"LOREM "`，caret 在 EOF）调用完成，再对首字母同为 W、ATN 不同的 `WumpusParser`（输入 `"WUMPUS "`）调用完成。被污染前，Wumpus 在 caret 处应返回 `QUX`；污染后，Wumpus 的 `creature` 起始状态（状态号 2）复用了 Whitebox `rule1/rule2` 在该状态号缓存的 follow set（首 token 是 `LOREM`，类型 1），与 `WUMPUS`（类型 2）不匹配，follow set 的提前剪枝直接把唯一正确候选 `QUX` 剪掉，返回**空候选集**。反向交错时则是 Whitebox 被清空。候选因此随“谁先运行”而变化。
  - 回归用例：`Follow-set cache isolation between parser classes:` 下的
    “Wumpus candidates are identical regardless of interleaving order”、
    “Whitebox candidates are identical regardless of interleaving order”、
    “exposes follow-set cache entries per parser constructor”。
  - 在未修复代码上这 3 条会失败（缓存键是字符串 `"W"` 而非构造器；交错后的候选为空），修复后通过。
- **长 token 流 memoization 失效**：32769 个 `HEAD TAIL` cell（默认通道位置越过 65535）的合成流上，位置 65536 的 `piece` 与位置 0 因 `& 0xffff` 互为别名；DFS 回溯再到该位置时漏掉本应命中的 shortcut，重复走访同一递归规则。规模再大、语法再歧义时即从多项式退化为指数级走访。
  - 回归用例：`Shortcut memoization on long token streams:` 下的
    “keeps full memoization below the 16-bit boundary (boundary side: under)”、
    “keeps full memoization once positions cross 65535 (boundary side: over)”、
    “returns identical results on the first and repeated completion of a long stream”、
    “preserves memoization and results after a syntax error in a long stream”。
  - 其中“cross 65535”一条在未修复代码上失败（越过边界后 `shortcutHits` 不再增加，停留在边界值），修复后稳定增加 7。

### 构建与验证

- 从仓库根目录依次执行：`npm ci` → `npm run generate`（已把 `Wumpus.g4`、`LongToken.g4` 加入生成命令）→ `npm test`。
- 新增用例可用 `npx vitest run tests/CodeCompletionCore.spec.ts -t "<describe 名>"` 单独定位运行；全套 `npm test` 通过 30/30。
