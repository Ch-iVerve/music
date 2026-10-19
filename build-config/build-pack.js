/* eslint-disable no-template-curly-in-string */

const builder = require('electron-builder')
const beforePack = require('./build-before-pack')
const afterPack = require('./build-after-pack')

/**
* @type {import('electron-builder').Configuration}
* @see https://www.electron.build/configuration/configuration
*/
const options = {
  appId: 'com.chiverve.music',
  productName: 'chiverve-music',
  beforePack,
  afterPack,
  protocols: {
    name: 'chiverve-music-protocol',
    schemes: [
      'chiverve-music',
    ],
  },
  directories: {
    buildResources: './resources',
    output: './build',
  },
  files: [
    '!node_modules/**/*',
    'node_modules/font-list',
    'node_modules/better-sqlite3/lib',
    'node_modules/better-sqlite3/package.json',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/electron-font-manager/index.js',
    'node_modules/electron-font-manager/package.json',
    'node_modules/electron-font-manager/build/Release/font_manager.node',
    'node_modules/node-gyp-build',
    'node_modules/bufferutil',
    'node_modules/utf-8-validate',
    'dist/**/*',
  ],
  asar: {
    smartUnpack: false,
  },
  extraResources: [
    // 随安装包分发的许可与声明。⚠️ 根 LICENSE（Apache-2.0 全文）必须在这里显式列出：
    // 上面的 `files` 是**显式白名单**（只有 dist/** 与几个 node_modules 条目），electron-builder
    // 在 files 已指定时只会额外强制加 `package.json`，**不会自动带 LICENSE**——而
    // `licenses/` 里那三份是**上游补充协议**，不含 Apache-2.0 全文，而补充协议本身又写着
    // 「基于 Apache License 2.0 发行」，缺了全文就是自相矛盾（2026-09-24 审计发现）。
    './licenses',
    './LICENSE',
    './THIRD_PARTY_NOTICES.md',
  ],
  // 本项目不发布任何打包版（ADR-0008）：原 publish 段（provider: github / owner: climashscape /
  // repo: chiverve-music，指向自有 Releases）已于 2026-09-24 用户裁定删除。
  //
  // ⚠️ 仅删掉 publish 段**不够**：electron-builder 在「没有 publish 配置」时，会退回
  // **package.json 的 `repository` 字段**推断出 github 发布源，并且**无论 publish 策略是什么**
  // 都把 `resources/app-update.yml` 写进产物（`app-builder-lib/out/publish/PublishManager.js` 的
  // `getPublishConfigsForUpdateInfo`：publishConfigs 长度为 0 就 `detect using repository info`；
  // 官方原话是 "file should be generated regardless of publish state"）。实测：只删段后
  // `target=dir` 打出的包 resources/ 下仍有该文件，owner/repo 正是本仓库。
  // 显式写 `publish: null` 才是那条「do not publish」的开关：`getPublishConfigs` 一旦在
  // config / 平台 / 目标任一层拿到 null 就返回 null，app-update.yml 随之不再生成。
  publish: null,
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const winOptions = {
  // Windows 目标**关掉 @electron/rebuild**（2026-09-24 实测加的）：
  // 默认它会为本机的原生模块去拉「Windows 预编译件」，而在受限网络下这一步必中断
  // （`ReadError: The server aborted pending request`，卡在 `preparing moduleName=bufferutil`）。
  // 本仓库本来就不需要它：`deps.copyLib()` / `build-config/lib/` 里已备好各平台的
  // better-sqlite3 预编译件（含 `better_sqlite3_win32-x64.node`），打包前换进去即可。
  // ⚠️ 所以打 Windows 包**必须在打包前把 win32 的原生件换进 node_modules**（见
  // `docs/agents/build-and-pack.md` §7.3 的 Windows 一节）；关掉 rebuild 不会替你换。
  npmRebuild: false,
  win: {
    icon: './resources/icons/icon.ico',
    legalTrademarks: 'climashscape',
    // artifactName: '${productName}-v${version}-${env.ARCH}-${env.TARGET}.${ext}',
  },
  nsis: {
    oneClick: false,
    language: '2052',
    allowToChangeInstallationDirectory: true,
    // differentialPackage: true,
    license: './licenses/license.rtf',
    shortcutName: 'Ch\'iverve Music',
  },
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const linuxOptions = {
  linux: {
    // Maintainer / Vendor 会写进 deb 的包元数据，是用户会看到的署名。
    // 不能沿用上游作者（那会把问题反馈引向与本产品无关的人）；
    // 也不能省略——省略时 electron-builder 会退回 package.json 的 author，
    // 而 author 没写 email 会直接抛 authorEmailIsMissed（FpmTarget.js:85-96）。
    maintainer: 'climashscape <climashscape@users.noreply.github.com>',
    vendor: 'climashscape',
    // artifactName: '${productName}-${version}.${env.ARCH}.${ext}',
    icon: './resources/icons',
    // Categories：freedesktop 规范要求主分类（Main Category）**只能有一个**，多主分类会让应用
    // 在菜单里重复出现——desktop-file-validate 报 "contains more than one main category"（票 16）。
    // 这里用 AudioVideo 作唯一主分类，Audio 是它的子分类（Rhythmbox/mpv 同款写法），
    // 其余 Player / Music 都属 Additional Categories。原先的 Utility 是错的主分类，已去掉。
    category: 'AudioVideo;Audio;Player;Music;',
    desktop: {
      // https://www.electron.build/app-builder-lib.interface.linuxdesktopfile
      // https://www.electronjs.org/docs/latest/tutorial/linux-desktop-actions
      // https://specifications.freedesktop.org/desktop-entry-spec/latest/example.html
      // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html#desktop-files
      entry: {
        Name: 'Ch\'iverve Music',
        'Name[zh_CN]': 'Ch\'iverve Music',
        'Name[zh_TW]': 'Ch\'iverve Music',
        // 不写 Encoding：freedesktop 规范里 `.desktop` 一律 UTF-8，该键已废除
        // （desktop-file-validate 报 "key Encoding ... is deprecated"，票 16 已删）
        MimeType: 'x-scheme-handler/chiverve-music',
        StartupNotify: 'false',
      },
    },
  },
  deb: {
    // electron-builder 的默认依赖表是硬编码的（FpmTarget.js 的
    // ["libgtk-3-0", …, "libatspi2.0-0", …]），没有 t64 处理：
    // Ubuntu 24.04+ / Mint 22+ 因 time_t 64 位迁移把这两个包改名为
    // libgtk-3-0t64 / libatspi2.0-0t64，默认表在这类发行版上无法满足，
    // `dpkg -i` 会以「依赖不满足」拒绝配置（实测 Mint 22.3/noble）。
    // 用 `|` 备选名同时兼容新旧发行版；其余项与默认表逐项一致。
    depends: [
      'libgtk-3-0 | libgtk-3-0t64',
      'libnotify4',
      'libnss3',
      'libxss1',
      'libxtst6',
      'xdg-utils',
      'libatspi2.0-0 | libatspi2.0-0t64',
      'libuuid1',
      'libsecret-1-0',
      // 桌面歌词「非置顶时永远在最底层」要靠 EWMH 的 `_NET_WM_STATE_BELOW`
      // （Electron 没有置底 API），唯一可用通道是 wmctrl。缺了它只会降级成
      // 普通窗口（点击仍会置前），所以列为依赖而不是硬性启动条件。
      'wmctrl',
    ],
    // 默认的 "default" 在 Debian 策略里不是合法 section（lintian 会报）
    packageCategory: 'sound',
  },
  appImage: {
    license: './licenses/license_zh.txt',
    // 与上面 linux.category 同一份清单与理由（AppImage 内的 .desktop 同样要过 desktop-file-validate）
    category: 'AudioVideo;Audio;Player;Music;',
  },
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const macOptions = {
  mac: {
    icon: './resources/icons/icon.icns',
    category: 'public.app-category.music',
    // artifactName: '${productName}-${version}.${ext}',
  },
  dmg: {
    window: {
      width: 530,
      height: 380,
    },
    contents: [
      {
        x: 140,
        y: 200,
      },
      {
        x: 390,
        y: 200,
        type: 'link',
        path: '/Applications',
      },
    ],
    title: 'Ch\'iverve Music v${version}',
  },
}

// win: {
// tagret: {
//   setup: ['nsis', '${productName}-v${version}-${env.ARCH}-Setup.${ext}'],
//   green: ['7z', '${productName}-v${version}-${env.ARCH}-green.${ext}'],
//   portable: ['portable', '${productName}-v${version}-${env.ARCH}-portable.${ext}'],
// },
// },
// linux: {
// platform: Platform.WINDOWS,
// arch: {
//   x64: builder.Arch.x64,
//   arm64: builder.Arch.arm64,
//   armv7l: builder.Arch.armv7l,
// },
// tagret: {
//   deb: ['deb', '${productName}_${version}_${env.ARCH}.${ext}'],
//   appImage: ['AppImage', '${productName}_${version}_${env.ARCH}.${ext}'],
//   pacman: ['pacman', '${productName}_${version}_${env.ARCH}.${ext}'],
//   rpm: ['rpm', '${productName}-${version}.${env.ARCH}.${ext}'],
// },
// },
// mac: {
// arch: {
//   x64: builder.Arch.x64,
//   x86: builder.Arch.ia32,
//   arm64: builder.Arch.arm64,
// },
// tagret: {
//   dmg: ['dmg', '${productName}-${version}-${env.ARCH}.${ext}'],
// },
// },

const createTarget = {
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  win(arch, packageType) {
    switch (packageType) {
      case 'setup':
        winOptions.artifactName = `\${productName}-v\${version}-${arch}-Setup.\${ext}`
        return {
          buildOptions: { win: ['nsis'] },
          options: winOptions,
        }
      case 'green':
        winOptions.artifactName = `\${productName}-v\${version}-win_${arch}-green.\${ext}`
        return {
          buildOptions: { win: ['7z'] },
          options: winOptions,
        }
      case 'win7_setup':
        winOptions.artifactName = `\${productName}-v\${version}-win7_${arch}-Setup.\${ext}`
        return {
          buildOptions: { win: ['nsis'] },
          options: winOptions,
        }
      case 'win7_green':
        winOptions.artifactName = `\${productName}-v\${version}-win7_${arch}-green.\${ext}`
        return {
          buildOptions: { win: ['7z'] },
          options: winOptions,
        }
      case 'portable':
        winOptions.artifactName = `\${productName}-v\${version}-${arch}-portable.\${ext}`
        return {
          buildOptions: { win: ['portable'] },
          options: winOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  linux(arch, packageType) {
    switch (packageType) {
      case 'deb':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch == 'x64' ? 'amd64' : arch}.\${ext}`
        return {
          buildOptions: { linux: ['deb'] },
          options: linuxOptions,
        }
      case 'appImage':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch}.\${ext}`
        return {
          buildOptions: { linux: ['AppImage'] },
          options: linuxOptions,
        }
      case 'pacman':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch}.\${ext}`
        return {
          buildOptions: { linux: ['pacman'] },
          options: linuxOptions,
        }
      case 'rpm':
        linuxOptions.artifactName = `\${productName}-\${version}.${arch}.\${ext}`
        return {
          buildOptions: { linux: ['rpm'] },
          options: linuxOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  mac(arch, packageType) {
    switch (packageType) {
      case 'dmg':
        macOptions.artifactName = `\${productName}-\${version}-${arch}.\${ext}`
        return {
          buildOptions: { mac: ['dmg'] },
          options: macOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
}

/**
 *
 * @param {'win' | 'mac' | 'linux' | 'dir'} target 构建目标平台
 * @param {'x86_64' | 'x64' | 'x86' | 'arm64' | 'armv7l'} arch 包架构
 * @param {*} packageType 包类型
 */
const build = async(target, arch, packageType) => {
  if (target == 'dir') {
    await builder.build({
      dir: true,
      config: { ...options, ...winOptions, ...linuxOptions, ...macOptions },
    })
    return
  }
  const targetInfo = createTarget[target](arch, packageType)
  // Promise is returned
  await builder.build({
    ...targetInfo.buildOptions,
    // 硬编码 'never'：本项目不发布任何打包版（ADR-0008），发布参数面一并删掉了
    // （原先 `publish=always` 由 `publish:*` 脚本透传，那批脚本 2026-09-24 已删）
    publish: 'never',
    x64: arch == 'x64' || arch == 'x86_64',
    ia32: arch == 'x86' || arch == 'x86_64',
    arm64: arch == 'arm64',
    armv7l: arch == 'armv7l',
    config: { ...options, ...targetInfo.options },
  })
  // .then((result) => {
  //   console.log(JSON.stringify(result))
  // })
  // .catch((error) => {
  //   console.error(error)
  // })
}

const params = {}

for (const param of process.argv.slice(2)) {
  const [name, value] = param.split('=')
  params[name] = value
}

if (params.target == null) throw new Error('Missing target')
if (params.target != 'dir' && params.arch == null) throw new Error('Missing arch')
if (params.target != 'dir' && params.type == null) throw new Error('Missing type')

console.log(params.target, params.arch, params.type)
build(params.target, params.arch, params.type)
