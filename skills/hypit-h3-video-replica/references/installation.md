# 安装与环境检查

先按[路线入口](workflow.md)决定依赖。以下第2—4节中的CompShare、SSH、H3插件和doctor基线只用于自建 GPU。托管 API 只需要 Node.js 22.20 和 `COMPSHARE_MINIMAX_API_KEY`，不需要 SSH 或插件，见[托管 H3](hosted-h3.md)。Seedance不需要这些 H3 工具。

Seedance路线先核对可用即梦CLI的`--version`与`schema`，安装或登录按使用者实际获得的官方渠道执行；本仓库不猜安装源。设计图/人物表演路线按已选配音与表演服务配置账号。各路线都核对FFmpeg/FFprobe及可查看成片的宿主。

本版针对 macOS / Linux 终端。已完成样片的宿主为 Codex；其他智能体可安装标准 Skill 并调用本地命令，但每种宿主的付费端到端流程没有分别实测。Windows 的上游插件另有支持，本教程固定的旧基线和 Bash 示例没有验证 Windows，不能直接照抄。

## 1. 安装 Skill

Node.js 至少 22.20，符合本版 `skills@1.7.0` 的要求；Node 与 npm 不包含在仓库里。安装目标选择实际使用的智能体：

```bash
node --version
npm --version
npx --yes skills@1.7.0 add https://github.com/ghao0630-droid/hypit-h3-video-replica --skill hypit-h3-video-replica -g
npx --yes skills@1.7.0 list -g
```

Codex 用户可用 `list -g -a codex` 确认安装记录。以记录里的路径定位 `SKILL.md`，不要假定所有安装器都使用同一个目录。同名 Skill 已存在时先查看，不覆盖手工修改。

## 2. 检查基础工具

```bash
python3 --version
ssh -V
ffmpeg -version
ffprobe -version
compshare --version
```

缺工具时先确认安装方式。不要用 `sudo pip` 修改系统 Python；CompShare 可放进独立工具环境，教程固定为 0.4.4。FFmpeg 与 FFprobe 两个可执行文件都要存在。

全局 PATH 中找不到不等于整机未安装。先检查本次项目已有的依赖目录；项目内的 FFprobe 或 Hypit CLI 可以通过环境检查的 `--ffprobe-bin`、`--hypit-bin` 参数传入明确的绝对路径，无需修改全局 PATH 或重复安装。只使用已确认来源的本地可执行文件；选定路径无效时检查失败，不自动改用其他工具。

Hypit 官方 Skill 单独安装：

```bash
npx --yes skills@1.7.0 add hypit-ai/hypit -g
```

本次只装知识和本地工具，不运行 `hypit transcribe` 等服务调用。可选的 Hypit CLI 固定为 `@hypit/hypit@0.2.16`，见[完整教程第 1 节](tutorial.md#1-装好执行环境)。

## 3. 获取完整 H3 插件

本版依赖上游提交 `e0c97e2a0bf0afbfbbfd981359b091a38e7d0d76`，插件版本 0.1.0。不能仅凭版本号判定内容相同；`assets/h3-baseline.json` 保存该提交的 43 个文件哈希，环境检查会比对。

### Codex

先核对现有插件和 Marketplace。没有该来源时安装：

```bash
codex plugin marketplace add Sac-Y/MiniMax-H3-Cloud --ref e0c97e2a0bf0afbfbbfd981359b091a38e7d0d76
codex plugin add minimax-h3-cloud@sac-y-minimax-h3
```

已有同名 Marketplace 的另一版本时，不静默替换；可在独立源码目录检查固定基线，或经用户同意后选择升级。不得为教程破坏正在使用的插件环境。

### 有终端但没有 Codex 插件安装器

获得完整上游仓库，在全新目录定位命令入口；不复制个别脚本：

```bash
export H3_SOURCE="<不存在的上游源码绝对路径>"
test ! -e "$H3_SOURCE"
git clone --no-checkout https://github.com/Sac-Y/MiniMax-H3-Cloud.git "$H3_SOURCE"
git -C "$H3_SOURCE" checkout --detach e0c97e2a0bf0afbfbbfd981359b091a38e7d0d76
export H3_PLUGIN_ROOT="$H3_SOURCE/plugins/minimax-h3-cloud"
test -x "$H3_PLUGIN_ROOT/scripts/h3-cloud"
"$H3_PLUGIN_ROOT/scripts/h3-cloud" --help
```

这只是取得完整本地入口，不证明账号、SSH、库存或云端生成已可用。读取该插件的 `skills/minimax-h3-video/SKILL.md`，后续按完整教程配置。不能绕过账号、模型许可和费用确认。

## 4. 做不收费的本地检查

在实际安装后的 Skill 目录执行：

```bash
export H3_SKILL_ROOT="<包含SKILL.md的技能目录绝对路径>"
export H3_PLUGIN_ROOT="<实际H3插件根目录>"
node "$H3_SKILL_ROOT/scripts/doctor.mjs" --h3-plugin-root "$H3_PLUGIN_ROOT"
node "$H3_SKILL_ROOT/scripts/local-handoff.mjs" --help
```

工具已经装在项目目录但未加入 PATH 时：

```bash
node "$H3_SKILL_ROOT/scripts/doctor.mjs" --h3-plugin-root "$H3_PLUGIN_ROOT" \
  --ffprobe-bin "<已核实来源的FFprobe绝对路径>" \
  --hypit-bin "<已核实来源的Hypit可执行文件绝对路径>"
```

环境检查只运行本机版本命令、读取插件元数据并比对公开文件哈希。不会读取 API Key、验证账号、请求价格、启动 GPU 或生成视频。`readyForLocalPreparation=true` 只表示可以开始本地准备。

## 5. 托管 API 不检查 SSH

托管路线不要用上面的 doctor 结果决定能否开始。帮助和估算都不访问网络：

```bash
export H3_SKILL_ROOT="<包含SKILL.md的技能目录绝对路径>"
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" --help
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" estimate --resolution 768P --duration 5
```

密钥放在 `COMPSHARE_MINIMAX_API_KEY`。`points` 和 `submit` 才会请求优云智算。提交规则、费用表和幂等恢复见[托管 H3](hosted-h3.md)。

完成安装后开新一轮对话。开始制作前再准备参考视频、肖像、逐字台词、可用首帧编辑工具，以及本次价格与费用授权。
