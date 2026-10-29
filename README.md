<h1 align="center">Ch'iverve Music</h1>

> **Research source only — no binaries, no packaged releases.**
> Ch'iverve Music is a research fork of [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop) that rebuilds QQ Music as a native desktop client (login, my music, recommendations, multi-quality streaming, a managed local media library). It is **not affiliated with Tencent** in any way, and **this repository ships no installers and no build artifacts** — build it yourself from source. All documentation is written in Chinese.

> ### About this repository
>
> - **What it is / 是什么**：a QQ Music desktop client for Linux (the official Linux client has been unmaintained for years) — 弥补官方 Linux 版 QQ 音乐年久失修的缺口。Forked from LX Music Desktop `v2.12.6` (`ad95d509`), rebuilt around a single source: QQ Music.
> - **What you get / 你得到什么**：**source only**. Git tags and Releases mark development milestones and carry **release notes text only** — no installers, no archives, no other build artifacts. 只发源码：tag / Release 只作开发阶段的里程碑与说明，**不附带任何安装包或构建产物**。
> - **Build it yourself / 自行构建**：see the Chinese section 「自行构建」 below — it lists everything needed (Node ≥ 22, the two `npm i` network pitfalls, the four webpack targets, and how to make your own deb / Windows green build). 想用就自己构建。
> - **Not affiliated with Tencent / 与腾讯无关联**：built for technical research only; no risk-control evasion, no device-fingerprint spoofing. Please support the official service and clear any copyright data within 24 hours (upstream supplemental terms §2.1).
> - **License & attribution / 许可与署名**：Apache-2.0, with the upstream supplemental terms kept verbatim in [`licenses/`](./licenses) and at the end of this file. Third-party content is listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).


> ## 关于本仓库
>
> > 由于官方 qq 音乐官方 Linux 版年久失修 不得以我们发布本研究仓库 我们十分尊重版权 所以我们的仓库仅供研究 所以我们不对外发布任何打包版 请自行学习建构
>
> 本仓库是 [LX Music 桌面版](https://github.com/lyswhut/lx-music-desktop)（作者 [lyswhut](https://github.com/lyswhut)，中文署名「落雪无痕」）的**独立衍生产品**，基于上游 `v2.12.6`（commit `ad95d509`）整树建立，改造目标是在桌面端内置完整的 QQ 音乐能力（登录、我的音乐、发现与推荐、关注歌手与关注动态、专辑 / 歌手 / MV、评论读写、多音质取流），并带一个**本地媒体库**（文件夹 / 拖拽导入、歌曲信息与歌词编辑、多格式导出，下载完成自动入库）。界面支持键盘操作（`Esc` 关弹窗与菜单、全局键盘焦点环、加载失败可就地重试）。**本仓库仅供技术研究与学习交流，不对外发布任何打包版。**
>
> - **不提供任何打包版**：不发安装包、**不提供任何构建产物**（CI 只跑测试与 lint）。**Release 只作开发阶段的成果标记**——附中英双语说明与源码快照，**不带任何二进制**。想用就自行学习建构，方式见下方「自行构建」——这是本仓库的定位，不是待补的缺口。
> - **与腾讯无关联**：本项目与腾讯及其关联公司**没有任何关系，也未获其授权、认可或支持**；内置能力仅为技术可行性研究。请支持正版，并在 **24 小时内清除**使用过程中产生的版权数据（沿用上游补充条款 §2.1）。
> - **不做对抗性设计**：不规避风控、不伪造设备指纹；用自己账号、低频、节流。**使用本仓库代码的合规责任由使用者自负。**
> - **与上游的关系**：本仓库**不跟随上游 rebase**；已配置 `upstream` remote，上游的接口修复按需 `git cherry-pick`（只取接口修复，不合并上游的整体演进）。
> - **版权**：代码沿用上游 Apache-2.0 许可证。**上游署名与协议全文完整保留**（`LICENSE` 与 `licenses/`；后者含上游补充条款：禁止违法使用、非商业性质、版权数据 24 小时内清除）。
> - **第三方内容与署名**：随本仓库入库的第三方内容（better-sqlite3 预编译二进制、上游打过补丁的 fork 依赖、上游本体）的出处与许可，汇总在 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
> - **关于源码里的注释**：注释里会引用 `AGENTS.md`、`docs/...` 或工单编号——那是维护者的**内部设计笔记**（记录「为什么这么改」与真机实测结论），**不随本仓库公开**。代码本身是自洽的；跟着注释读到不存在的文件时按这条理解即可。
> - **协作口径**：**欢迎报 Issues，也欢迎提 PR**——bug、构建失败、文档错漏、改进都收（[Issues](https://github.com/Ch-iVerve/chiverve-music/issues)）。但本仓库是单人业余维护的研究项目，**不承诺响应时限**；提 PR 请在描述里写清**你是怎么验证的**（下方「构建与自测」是这里通行的验证阶梯）。安全问题请走 [`SECURITY.md`](./SECURITY.md)。

## 界面预览 / Screenshots

> 都是**真实运行状态**的截图（用你自己的 QQ 账号登录；「每日 30 首」「雷达推荐」等数据来自 QQ 侧接口）。
> Real screenshots of the app running with a real QQ account. 点图可看原尺寸 / click to enlarge.

<table>
  <tr>
    <td width="50%" align="center"><img src="./screenshots/01-song-detail.png" alt="歌曲详情 / song detail" width="100%"><br><b>歌曲详情</b><br><sub>唱片公司 / 流派 / 发行时间 + 相似歌曲<br>Song detail: metadata &amp; similar tracks</sub></td>
    <td width="50%" align="center"><img src="./screenshots/02-radar.png" alt="雷达 / radar" width="100%"><br><b>雷达推荐</b><br><sub>每日 30 首 / 雷达推荐两个 tab，居中轮播挑选<br>Radar: two tabs, carousel pick</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="./screenshots/03-artist.png" alt="歌手页 / artist" width="100%"><br><b>歌手页</b><br><sub>歌曲 / 专辑 / MV / 相似歌手 四个 tab<br>Artist: songs / albums / MVs / similar</sub></td>
    <td width="50%" align="center"><img src="./screenshots/04-music-gene.png" alt="听歌基因 / music gene" width="100%"><br><b>听歌基因</b><br><sub>音乐人格 / 乐状态 / 偏好曲风与歌手<br>Listening profile from your account</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="./screenshots/05-favorites.png" alt="我的收藏 / favorites" width="100%"><br><b>我的收藏</b><br><sub>歌曲 / 歌单 / 专辑 / 歌手 四个 tab（写操作直通 QQ）<br>Favorites: four tabs, writes go to QQ</sub></td>
    <td width="50%" align="center"><img src="./screenshots/06-downloads.png" alt="下载 / downloads" width="100%"><br><b>下载管理</b><br><sub>任务列表 + 多档音质（FLAC / 320k / 128k）<br>Downloads: tasks &amp; quality tiers</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="./screenshots/07-album.png" alt="专辑页 / album" width="100%"><br><b>专辑页</b><br><sub>专辑简介 + 曲目表 + 收藏 / 分享 / 在 QQ 音乐打开<br>Album: intro, tracks, collect &amp; share</sub></td>
    <td width="50%" align="center"><img src="./screenshots/08-my-playlists.png" alt="我的歌单 / my playlists" width="100%"><br><b>我的歌单</b><br><sub>QQ 云端自建歌单 / 本地歌单，可加歌与刷新<br>My playlists: cloud (QQ) &amp; local lists</sub></td>
  </tr>
</table>

## 自行构建

本项目**只提供源码**，不提供任何构建产物。下面是从源码把项目跑起来的最小步骤，需要的东西全在这一节里。

### 环境要求

- **Node.js >= 22**、npm >= 8.5.2（`package.json` 的 `engines`）。Node 24/25 也能构建，node-gyp 相关包在 v25 上会打 `EBADENGINE` 警告——**只是警告，不影响构建**。
- 能访问 **GitHub**：`package.json` 里有 5 个 `github:lyswhut/*` 依赖是上游打过补丁的 fork 版（换成 npm 官方版会破坏构建）。
- Linux 桌面环境（Electron 运行需要图形环境；本项目主要在 Linux 上验证）。

### 装依赖（两个必踩的坑）

```bash
git clone https://github.com/Ch-iVerve/chiverve-music.git
cd chiverve-music
npm i
```

`npm i` 有两个环境相关的坑，都是网络问题、不是代码问题，**照着下面的对策来就不会卡**：

1. **`better-sqlite3` 会让 `npm i` 失败**：包内含 `binding.gyp`，npm 会自动跑 `node-gyp rebuild` 并从 **nodejs.org** 下载 Node 头文件，网络不通即报 `ConnectTimeoutError`。对策（二选一）——给 node-gyp 配镜像，或走你自己的 HTTP 代理：

   ```bash
   NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node/ npm i
   # 或：HTTPS_PROXY=http://127.0.0.1:<你的代理端口> npm i
   ```

   另注：`package.json` 里的 `allowScripts` 字段**对 npm 无效**（实测 npm 11 无此实现），别指望它跳过编译；最终生效的原生产物来自仓库的 `postinstall` → `deps.copyLib()`（用仓库自带的 `build-config/lib/*.node` 覆盖），所以这一步编译成功与否都不影响最终结果。

2. **Electron 二进制不会自动下载**：electron 包的 npm `scripts` 为 `null`（没有 postinstall），装完 `node_modules/electron` 里只有包装、没有二进制。手动补一步（配镜像）：

   ```bash
   cd node_modules/electron
   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js
   cd ../..
   ```

> 若你的网络需要代理才能访问 `github.com`，而 git 又走 `ssh://git@github.com` 拉那 5 个 fork 依赖，可以一次性改成 https（**未在本仓库实跑，仅作兜底**）：
> `git config --global url."https://github.com/".insteadOf ssh://git@github.com/`
> （2026-09-24 实测有效：加上这条后 `git ls-remote git@github.com:lyswhut/needle.git` 正常返回。）

### 跑开发版

```bash
npm run dev      # 起 9080/9081 + electron，产物在 dist-dev/
```

开发版的数据目录是 `~/.config/chiverve-music-dev/`（与安装版的 `~/.config/chiverve-music/` 分开，两者互不干扰），主进程日志在 `~/.config/chiverve-music-dev/logs/main.log` —— 日志含 ANSI 颜色码，**要用 `grep -a` 读**。

### 构建与自测

```bash
npm run build    # 四个 target 的生产构建 → dist/
npm run test     # vitest：node 侧（主进程 / common / musicSdk / worker / scripts）+ dom 侧（渲染 store / 组件）
npm run lint     # eslint（TS 文件在 build 期不跑 lint，改了 TS 要单独跑这条）
```

⚠️ **`npm run build` 必须确认退出码为 0**，并 `ls dist/index.html` 确认它生成了：构建失败会留下半成品 `dist/`，而打包步骤照样会按白名单拷出一只坏包（asar 12 MB vs 正常 30 MB，装上去白屏）。

### 命令行工具（可选）

`scripts/qqctl` 是随仓库附带、零 npm 依赖的 Node CLI：用应用本机的登录态直接操作 QQ 音乐账号——登录态体检（脱敏输出）、搜索、自建歌单读写与备份 / 受控恢复（backup / restore），含批量「歌手 - 歌名」匹配加歌（打分门槛 + 现场 / 综艺降权 + dry-run + 写后回读校验），默认低频节流、凭证不落日志。命令面与防错机制见 [`scripts/qqctl/README.md`](./scripts/qqctl/README.md)。

### 想自己造包（可选）

本仓库不发布打包版，打包只为本地自测：

```bash
npm run build && npm run pack:linux:deb:amd64   # → build/chiverve-music_<版本>_amd64.deb
```

**平台约束**：macOS 的 dmg 只能在 macOS 上构建；deb / rpm / pacman / AppImage **以及 Windows 的绿色版（`npm run pack:win:7z:x64`）** 都可在 Linux 本机构建；**Windows 的 NSIS 安装包**（`pack:win:setup:*` / `pack:win:portable:*`）额外需要一份能跑起来的 wine（宿主装的，或 electron-builder 自带的 wine 工具链）。`pack:*` 这类脚本**不含** `npm run build`，必须先构建再打包。

在 Linux 上构建 Windows 目标时有两处坑，**本仓库的构建配置已经处理好**（不用你手动折腾）：`@electron/rebuild` 会去拉 Windows 的预编译件（受限网络下必中断）——已对 win 目标关掉；`better_sqlite3.node` 必须是 Windows 的那份——已按**目标平台**自动换入（`build-config/lib/` 里备了各平台的预编译件）。

装机与卸载（Debian / Ubuntu / Mint）：

```bash
sudo dpkg -i build/chiverve-music_<版本>_amd64.deb   # 缺依赖时 sudo apt-get -f install
sudo dpkg -r chiverve-music
```

装好后数据目录是 `~/.config/chiverve-music/`（与开发版 `chiverve-music-dev` 分开）。⚠️ **不要在开发树里直接跑安装版的产物**：`userData` 的 dev/正式之分由 `NODE_ENV` 决定，误跑会污染安装版的凭证库。

## 许可与上游署名

本仓库代码沿用上游 **Apache-2.0** 许可证，全文见 [`LICENSE`](./LICENSE)。

上游（LX Music 桌面版）对本项目另有一份**补充协议**（禁止违法使用、非商业性质、版权数据 24 小时内清除等），**完整保留**在 `licenses/`（`license_zh.txt` / `license_en.txt` / `license.rtf`，同时用作安装器协议文本），并逐字附在下方。

随本仓库入库的第三方内容的出处与许可汇总在 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)；上游变更记录保留在 [`CHANGELOG.md`](./CHANGELOG.md)。

> 本 README **不再复刻上游 README 全文**——上游 README 讲的是它自己的软件下载渠道、开发分支与文档站，与本仓库无关，照抄只会误导。上游署名与许可文本则一个字都没有省。

---

*词语约定：本协议中的“本项目”指 LX Music（洛雪音乐助手）桌面版项目；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。*

### 一、数据来源

1.1 本项目的各官方平台在线数据来源原理是从其公开服务器中拉取数据（与未登录状态在官方平台 APP 获取的数据相同），经过对数据简单地筛选与合并后进行展示，因此本项目不对数据的合法性、准确性负责。

1.2 本项目本身没有获取某个音频数据的能力，本项目使用的在线音频数据来源来自软件设置内“自定义源”设置所选择的“源”返回的在线链接。例如播放某首歌，本项目所做的只是将希望播放的歌曲名、艺术家等信息传递给“源”，若“源”返回了一个链接，则本项目将认为这就是该歌曲的音频数据而进行使用，至于这是不是正确的音频数据本项目无法校验其准确性，所以使用本项目的过程中可能会出现希望播放的音频与实际播放的音频不对应或者无法播放的问题。

1.3 本项目的非官方平台数据（例如“我的列表”内列表）来自使用者本地系统或者使用者连接的同步服务，本项目不对这些数据的合法性、准确性负责。

### 二、版权数据

2.1 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 **24 小时内** 清除使用本项目的过程中所产生的版权数据。

### 三、音乐平台别名

3.1 本项目内的官方音乐平台别名为本项目内对官方音乐平台的一个称呼，不包含恶意。如果官方音乐平台觉得不妥，可联系本项目更改或移除。

### 四、资源使用

4.1 本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。

### 五、免责声明

5.1 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。

### 六、使用限制

6.1 本项目完全免费，且开源发布于 GitHub 面向全世界人用作对技术的学习交流。本项目不对项目内的技术可能存在违反当地法律法规的行为作保证。

6.2 **禁止在违反当地法律法规的情况下使用本项目。** 对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。

### 七、版权保护

7.1 音乐平台不易，请尊重版权，支持正版。

### 八、非商业性质

8.1 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。

### 九、接受协议

9.1 若你使用了本项目，即代表你接受本协议。

---

若对此有疑问请 mail to: lyswhut+qq.com (请将 `+` 替换为 `@`)
