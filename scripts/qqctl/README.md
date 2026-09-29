# qqctl —— QQ 账号操作 CLI（agent 工具）

> 用**本机应用自己的登录态**直接操作 QQ 音乐账号：搜索、自建歌单读写。
> 为 agent（与人）复用而生——2026-09-28「大运河音乐节补曲」实战的沉淀，那次加 28 首歌全流程靠它验证。

```bash
# 零 npm 依赖，node >= 22 直接跑（下述 $Q 指 node scripts/qqctl/bin.mjs）
node scripts/qqctl/bin.mjs credential
node scripts/qqctl/bin.mjs playlist list
node scripts/qqctl/bin.mjs search "万能青年旅店 山雀" --num 5
node scripts/qqctl/bin.mjs playlist songs 9782416691
```

## 命令面

| 命令 | 说明 |
|---|---|
| `credential` | 登录态体检。**脱敏输出**：字段名、末 4 位、过期时间；过期提示先启动一次应用刷新（CLI 不做 refresh） |
| `search <query>` | 搜索。`--type song\|singer\|album`（mv/songlist 未沉淀）、`--num` |
| `playlist list` | 自建歌单：名称 / dirId / tid / 曲数 |
| `playlist songs <ref>` | 歌单内歌曲；`<ref>` 三形态：tid、dirId、名称（trim 全等，重名报错） |
| `playlist create <名称>` | 建歌单 |
| `playlist delete <dirId> --yes` | 删歌单。危险操作必须显式 `--yes`；「我喜欢」拒删 |
| `playlist add <ref> --song <songId[:songType]>…` | 直加（`--song 769125` 或 `--song 769125:13`，可逗号分隔/多 flag；`--batch` 批大小） |
| `playlist remove <ref> --song …` | 移歌（同参数；回滚通道） |
| `playlist add-matched <ref> --spec <文件> [--dry-run]` | 批量「歌手 - 歌名」：搜+打分+去重+分批加+**回读校验** |
| `playlist backup <ref> --dir <目录>` | 备份歌单：JSON（原始行全量，恢复的输入）+ MD 可读表（表首自带恢复命令） |
| `playlist restore <ref> --from <备份.json> [--yes] [--force]` | **受控重建**：删光现单 → 按备份顺序重加 → 回读逐位比对。`--dry-run` 出计划；备份后新加的歌要 `--force` 才会删 |

所有命令支持 `--json`（stdout 单行 JSON，人读日志走 stderr）、`--profile prod|dev`（数据目录，默认 prod）、`--throttle <ms>`（节流，默认 400）。

## add-matched 的纪律（实战沉淀的防错机制）

- **打分**：`[歌名全等2|含1]×10 + [歌手全等2|含1]`，**≥22 才自动加**；21 分几乎都是「歌手带乐队后缀」（二手玫瑰乐队/盘尼西林乐队）这类该人工定案的形态——宁可交人工，不静默加错。
- **两段式**：先 `--dry-run` 出计划（低置信列候选，exit 3）；人工核对后可把定案写成 spec 或改用 `playlist add` 直加。
- **闭环**：写接口判读「模块 code 与 retCode 双 0 才算成功」（防 80105 假成功），写完**回读歌单逐 songId 校验**，有失败/缺失 exit 2。
- spec 文件：每行 `歌手 - 歌名`（第一个 ` - ` 分隔），`#` 注释与空行跳过。

## 备份/恢复与歌单顺序语义（2026-09-28 临时歌单受控实验）

- **读序 = 加序倒序**：CgiGetDiss 读出的顺序里，越新加入的歌越靠前；整批 `AddSonglist` 时批内数组按倒序落位（`[A,B,C]` → 读出 `[C,B,A]`）。两条实验记录都钉在 `lib/sequence.test.mjs`。
- 因此**目标读序 F 要按 `reverse(F)` 分批加入**（`restore` 内部就是这么做的，最后回读逐位比对，不符 exit 2）。
- **重排一个歌单 = backup → 生成新顺序的规格文件（`songId:type` 每行一个，按目标读序）→ `restore --from`**。恢复是幂等的：中途失败重跑即可（先删光再重加）。
- 想加专用「整单重排」端点前先看 `AdjustSonglist`（`music.musicasset.PlaylistDetailWrite` 下确认存在，2026-09-28 六种参数形状未命中，见 `/tmp/life-playlist/` 的探测脚本）。

## 维护约束（改之前读）

- **端点形状照搬 `src/renderer/utils/musicSdk/tx/`**（request.js 的 comm/回退链、crypto.js 的 zzc 签名、songList.js 的写侧与 readWriteResult、user.js 的读侧）——那边实测记录在 `docs/agents/qq-music-native.md`，那边改了这边要跟；本 CLI **只沉淀真机验证过的端点**，没测过的不加。
- **comm 档案分档**：dirId=201（我喜欢）写侧必须安卓档案，自建歌单用 WEB 档案（工单 09 的 A/B，`playlist.mjs` 有注）。
- **凭证纪律**（`scripts/verify/README.md` 坑 4）：凭证只在内存；任何输出/日志不含凭证值，只许字段名与脱敏值。`credential` 命令是范例。
- **行为不对 QQ 侧做对抗性设计**：低频（默认节流 400ms）、不并发、写失败不自动重试。
- 测试在 `lib/*.test.mjs`（vitest node project，`vitest.config.ts` include 已挂），跑 `npm run test`。
