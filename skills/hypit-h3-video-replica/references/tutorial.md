# 用 Hypit 和 MiniMax H3 Cloud 复刻一条 30 秒口播视频

版本 v1.1.1（GitHub 安装版），更新于 2026-09-29。基于已验证的 v1.1 整理；原本地版本保留。H3 命令按本机插件 0.1.0 核对；Hypit CLI 示例固定为 0.2.16。换版本后先核对帮助和配置格式，不要只替换目录里的版本号。

这份教程从安装写到交付，适合有终端、文件读写、图片编辑和视频查看能力的 Agent。普通文字聊天窗口不能直接执行。其他 Agent 可以接手这套文件和命令，但要先确认自己能调用这些工具，不能把“支持读取 Skill”当成已经接通 H3。

案例最后得到 30.21 秒、608×1056、24fps 的竖屏成片。实例累计记录为 1335 秒、¥3.20/小时，折算约 ¥1.19；本次接入前基线为 371 秒，后续新增 964 秒，折算约 ¥0.86。两种口径不能相加，也不是纯推理费用、当前报价或结算账单。

这条路线复刻的是场景、构图和口播关系。H3 接收文字与图片，不接收原视频作为动作驱动，不能保证原片的手势、嘴型和节奏逐帧重现。两段独立生成也不能保证同一声纹。下面会把这些限制留在验收里。

## 先看要交什么

把本教程、[本地辅助脚本](../scripts/local-handoff.mjs)和[任务信息模板](../assets/task.example.json)一起交给下一位 Agent。分享时保留相对目录结构。参考视频、肖像、批准首帧和文案另外提供，不把密钥或平台私有配置打包。

| 工具 | 负责什么 | 本教程是否必须 |
| --- | --- | --- |
| Hypit Skill | 拆参考、整理 Brief/Treatment、组织生成和验收 | 使用其工作方法 |
| Hypit CLI | 媒体检查、时间格、转录等命令 | 可选；FFmpeg 可做本地检查 |
| MiniMax H3 Cloud | 云端 GPU、ComfyUI、生成、下载和停机 | 必须 |
| 图片编辑工具 | 用参考场景和肖像制作首帧 | 没有批准首帧时必须 |
| FFmpeg / FFprobe | 抽帧、音频微调、去字幕、拼接和媒体检查 | 必须 |

安装 Skill 不会安装 Hypit CLI，也不会送生成额度。H3 插件本身与 GPU 费用是两回事。首帧、转录、配音服务还可能分别收费。

本教程的顺序是：环境和输入 → 参考拆解 → 批准首帧与两段文案 → 配置和价格计划 → 本次费用确认 → 创建后立即生成 → 两段验收与停机 → 本地返修、拼接、交付。不要开着 GPU 等首帧和文案。

## 1. 装好执行环境

本文的终端示例使用 macOS/Linux 的 Bash 语法。Windows 用户需转换路径和命令；本案例没有验证 Windows 实跑。

准备 Node.js 22.20 或更高（`skills@1.7.0` 的安装要求）、Python 3.9 或更高，以及 SSH、FFmpeg 和 FFprobe。先回读：

```bash
node --version
npm --version
python3 --version
ssh -V
ffmpeg -version
ffprobe -version
```

只有一个独立的 `ffmpeg` 文件时，不一定有 `ffprobe`。macOS 可以在确认安装权限后用 `brew install ffmpeg` 安装完整套件。本次修订机器没有可调用的 FFprobe，因此下面的 FFprobe 命令做了语法检查，未冒充本机实跑。

### 安装 Hypit Skill

```bash
npx --yes skills@1.7.0 add hypit-ai/hypit -g
npx --yes skills@1.7.0 list -g
```

在安装器中选择本次使用的 Agent，读它实际发现的 `SKILL.md`。Codex 可进一步检查：

```bash
npx --yes skills@1.7.0 list -g -a codex
```

本案例安装在 `~/.agents/skills/hypit`，其他机器不一定相同。以安装记录为准。

需要 Hypit CLI 时再装。已有可用版本先验证，不必重复全局安装：

```bash
npm view @hypit/hypit@0.2.16 engines --json
npm install --global @hypit/hypit@0.2.16
hypit --version
hypit paths
```

Skill 和 CLI 各自更新。本文的基本路线不依赖 Hypit 云端转录服务。

### 安装 H3 插件

先检查现有 `compshare --version`。没有时，在独立的 Python 工具环境中安装，避免用 `sudo pip` 改系统 Python。下面固定本案例版本：

```bash
python3 -m venv "<CompShare工具环境绝对路径>"
"<CompShare工具环境绝对路径>/bin/python" -m pip install 'compshare-cli==0.4.4'
"<CompShare工具环境绝对路径>/bin/compshare" --version
```

后续 `compshare` 必须指向这个环境，或已验证的原有安装。不要混用几个 Python 环境。

该插件仓库提供的 Codex 安装入口：

```bash
codex plugin marketplace add Sac-Y/MiniMax-H3-Cloud --ref e0c97e2a0bf0afbfbbfd981359b091a38e7d0d76
codex plugin add minimax-h3-cloud@sac-y-minimax-h3
```

本版固定到与原实测插件 43 个文件完全一致的上游提交，避免同名版本的代码变化。已有该 Marketplace 时先检查当前来源，不直接切换已有生产环境；其他 Agent 的完整源码获取方式见 [安装说明](./installation.md)。

插件缓存可这样查找；使用自定义 `CODEX_HOME` 时，把搜索根目录换成实际位置：

```bash
rg --files --hidden "$HOME/.codex/plugins/cache" \
  | rg '/minimax-h3-cloud/[^/]+/scripts/h3-cloud$'
```

选择本次实际加载的安装，不凭“最新目录”猜版本。读根目录下的 `.codex-plugin/plugin.json` 和 `skills/minimax-h3-video/SKILL.md`，确认 `scripts/h3-onboard`、`scripts/h3-provision`、`scripts/h3-cloud` 存在且可执行。

其他 Agent 没有 Codex 插件安装器时，需要先通过仓库支持的方式获得完整插件和运行入口；仅拷贝三个脚本会缺少 Runtime 和模块。本教程不把未验证的跨宿主安装方式写成已支持。

插件安装报配置错误时，先保留错误并核对当前宿主的配置格式；不要为跑教程删除整份配置或改动无关设置。

## 2. 填任务信息，固定路径

复制任务模板到新项目，填写本机路径、工具、逐字台词和本次授权。模板里不放密钥。旧样片的 GPU 选择和 ¥3.30/小时批准，不是新任务的默认授权。

以下变量都要替换成实际值。所有后续命令在同一个 Bash 会话运行；Agent 每次开新终端时，须从 `task.json` 重建变量。不要依赖另一位 Agent 的 shell 状态。

```bash
set -euo pipefail

export H3_SKILL_ROOT="<安装后的技能目录绝对路径（包含 SKILL.md）>"
export H3_PROJECT_ROOT="<新项目绝对路径>"
export H3_PLUGIN_ROOT="<本机实际插件根目录>"
export H3_PROFILE="<本机隔离凭证名称>"
export H3_RESOURCE="<本次选择的GPU配置ID>"
export H3_MAX_HOURLY="<本次批准的小时价上限，纯数字>"
export H3_MAX_TOTAL="<本次批准的总费用上限，纯数字>"
export REFERENCE_VIDEO="<参考MP4绝对路径>"
export PORTRAIT_CLOSEUP="<正脸肖像绝对路径>"

export H3_CONFIG="$H3_PROJECT_ROOT/config/h3.json"
export H3_LOCAL_TOOL="$H3_SKILL_ROOT/scripts/local-handoff.mjs"
export APPROVED_FIRST_FRAME="$H3_PROJECT_ROOT/assets/keyframes/approved.png"
export FINAL_VIDEO="$H3_PROJECT_ROOT/deliverables/FINAL.mp4"

test -f "$H3_LOCAL_TOOL"
test -x "$H3_PLUGIN_ROOT/scripts/h3-onboard"
test -x "$H3_PLUGIN_ROOT/scripts/h3-provision"
test -x "$H3_PLUGIN_ROOT/scripts/h3-cloud"
test -s "$REFERENCE_VIDEO"
test -s "$PORTRAIT_CLOSEUP"

mkdir -p "$H3_PROJECT_ROOT/assets/portraits" \
  "$H3_PROJECT_ROOT/assets/keyframes" "$H3_PROJECT_ROOT/assets/overlays" \
  "$H3_PROJECT_ROOT/references" "$H3_PROJECT_ROOT/prompts" \
  "$H3_PROJECT_ROOT/config" "$H3_PROJECT_ROOT/evidence" \
  "$H3_PROJECT_ROOT/outputs/h3/segment-01" \
  "$H3_PROJECT_ROOT/outputs/h3/segment-02" \
  "$H3_PROJECT_ROOT/outputs/local" "$H3_PROJECT_ROOT/deliverables"

cp -n "$H3_SKILL_ROOT/assets/task.example.json" \
  "$H3_PROJECT_ROOT/task.json"
```

用 Agent 的文件编辑工具填写 `task.json`，同时建立三个短文件：

- `BRIEF.md`：参考、目标、不可改的地方、字幕要求、结束语、预算覆盖哪些服务。
- `TREATMENT.md`：首帧做法、两段切口、声画连续性、预计需要的后期。
- `PROGRESS.md`：当前步骤、批准记录、任务 ID、manifest、实际 MP4、实例状态、费用和剩余工作。

交接时以这些文件为准，不把聊天里的“上面那张图”“刚才的视频”留给下一位 Agent 猜。辅助脚本只操作本地文件，拒绝覆盖既有结果；重复操作应使用新的明确路径，不要删除保护文件强行重跑。

## 3. 配置凭证，但不启动 GPU

优云 API Key 由用户在自己的终端隐藏输入，不发聊天，不写项目 JSON：

```bash
compshare config set --name "$H3_PROFILE" --no-activate
compshare --json --profile "$H3_PROFILE" doctor
```

已有隔离配置可直接验证，无须重新录入。`doctor` 用来检查真实 API/SSH/SCP 连接；文件存在不代表账号可用。

出现 `Missing dependencies for SOCKS support` 时，把 `requests[socks]` 装进 CompShare CLI 自己的环境。出现 `Signature VerifyAC Error` 时，核对优云账户中心要求的公钥、私钥是否正确，用隐藏输入修正，再运行 `doctor`。

使用前读 [H3 社区许可证](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)，确认所在地和用途符合要求。许可证排除欧盟、英国、韩国、美国等区域；不能按用户语言或时区猜授权。

## 4. 看参考，先把文案和首帧做好

先完整观看原片，再抽帧。本案例保留的是暖色书房、正对镜头近景、下方手势和连续口播；不是逐帧复用原人物动作。

```bash
ffprobe -v error -show_format -show_streams -of json "$REFERENCE_VIDEO" \
  > "$H3_PROJECT_ROOT/evidence/reference-probe.json"

ffmpeg -n -ss 00:00:08 -i "$REFERENCE_VIDEO" -frames:v 1 \
  "$H3_PROJECT_ROOT/assets/keyframes/reference-08s.png"
```

第 8 秒只是本案例取样点。新素材要选脸、肩、手和背景都清楚、没有极端嘴型或遮脸的时刻。

若已装 Hypit CLI，也可做时间格：

```bash
hypit media probe "$REFERENCE_VIDEO"
hypit media tile "$REFERENCE_VIDEO" --start 0 --end 30 --every 1 \
  --to "$H3_PROJECT_ROOT/evidence/reference-contact.jpg"
```

对白优先使用已提供的逐字稿，并试听确认。需要转录时，先选择可调用的本地服务，或确认 Hypit Endpoint 已配置、费用已覆盖。`hypit transcribe` 会调用服务，不属于“无付费本地检查”。

以下命令只有在这些条件成立时执行：

```bash
hypit transcribe "$REFERENCE_VIDEO" --language zh \
  --to "$H3_PROJECT_ROOT/references/transcript.json"
```

### 制作人物首帧

有已批准首帧时直接使用，别重复付费。没有时，需要能同时接受场景参考和肖像的图片编辑工具。Codex 可用 `image_gen.imagegen`；其他 Agent 填写自己实际可调用的等价工具、账号和费用。H3 视频插件不替你完成这一步。

输入是代表帧、肖像近照和可选多视角肖像。先看输入图，再调用编辑工具。Codex 的参数形式如下；路径换成真实文件，省略不用的第三张图：

```json
{
  "referenced_image_paths": [
    "<场景代表帧绝对路径>",
    "<肖像近照绝对路径>",
    "<可选多视角肖像绝对路径>"
  ],
  "transparent_background": false,
  "prompt": "保持第一张图的暖色书房、固定机位和近景构图。把主角替换为后续肖像中的同一成年人，保留他的五官、身形、服装和配件。人物直视镜头，手在画面下方，不遮脸。不添加字幕、文字、水印或额外人物。"
}
```

使用工具实际返回的文件，不臆造输出路径。本案例人物戴深蓝帽、圆框眼镜和银色耳机；别把这些配件强加给新用户的肖像。

```bash
export FIRST_FRAME_EDIT="<图片工具实际返回的本地文件绝对路径>"

ffmpeg -n -i "$FIRST_FRAME_EDIT" \
  -vf "scale=576:1024:force_original_aspect_ratio=increase,crop=576:1024" \
  -frames:v 1 "$APPROVED_FIRST_FRAME"
```

看裁后的图片，确认脸像、肩颈自然、配件不粘连、文字干净，裁切没有伤到脸。批准记录写入 `PROGRESS.md`。静态图没过，先不跑视频。

### 写两段提示词

在 `prompts/segment-01.txt` 和 `prompts/segment-02.txt` 写入 UTF-8 纯文本。每段台词先按实际语速读一遍，给呼吸、停顿和结尾留时间；不靠挤满字数逼模型在 15 秒里说完。

```text
从提供的首帧自然开始，生成一个连续的写实口播镜头。
保持同一人物身份、服装、配件、背景和固定机位，不变焦，不切镜。
人物直视镜头，呼吸、眨眼和头部小动作自然，手势在画面下方，不遮脸。
用自然普通话逐字说出：“<这一段完整台词>”
不生成字幕、文字、Logo、水印或额外人物。
结尾自然收住，不抢断最后一个字。
```

画幅、时长、清晰度用生成命令指定。第二段明确接上第一段意思，结尾按本次 `task.json` 的 `endingLine`。案例使用 `Worder good`，不擅自改成 `World good`，也不强加给新任务；读法不清楚时先由用户提供示范。

H3 0.1.0 的单次时长是 2–15 秒。这里采用两段 15 秒、9:16、0.6MP。`--first-frame-image` 固定起始画面，`--reference-image` 只作参考（1–9 张），`--last-frame-image` 固定结束画面；别把它们当成同一种模式。

付费前检查：

```bash
test -s "$APPROVED_FIRST_FRAME"
test -s "$H3_PROJECT_ROOT/prompts/segment-01.txt"
test -s "$H3_PROJECT_ROOT/prompts/segment-02.txt"
```

再人工检查模板占位符已全部替换、首帧已批准、两段文案能读完。之后才进入实例创建。

## 5. 选择 GPU，设置本次价格闸门

先读取选项，不开机：

```bash
"$H3_PLUGIN_ROOT/scripts/h3-onboard" options \
  --platform compshare --credential-profile "$H3_PROFILE"
```

0.1.0 的选项包括 `5090-96gb`、`5090-64gb`、`4090-64gb`。按本次目标和用户选择填写 `H3_RESOURCE`，缺货不能静默换卡。64GB 配置是系统内存，不是 64GB 显存；本案例使用的 RTX 5090 显存为 32GB。

新项目建立新配置，不继承旧实例 ID：

```bash
"$H3_PLUGIN_ROOT/scripts/h3-onboard" init \
  --platform compshare --resource-option "$H3_RESOURCE" \
  --credential-profile "$H3_PROFILE" --config "$H3_CONFIG"
```

检查 `safety.scheduleStopAfter="30m"`、`safety.stopAfterJob=true`，并确认 `provider.resourceId` 为空。本案例的 `5090-64gb` 默认 Binding 小时价上限为 ¥2.60，不会自动变成先前批准的 ¥3.30。

下方脚本为新配置复制一份项目内 Binding，只改 Binding ID 和本次获批的小时价上限；保留原配置备份，不修改插件缓存。它只支持已核对的插件 0.1.0，拒绝带旧实例 ID 的配置：

```bash
node "$H3_LOCAL_TOOL" bind --plugin-root "$H3_PLUGIN_ROOT" \
  --config "$H3_CONFIG" --max-hourly "$H3_MAX_HOURLY"

"$H3_PLUGIN_ROOT/scripts/h3-provision" plan --config "$H3_CONFIG" \
  > "$H3_PROJECT_ROOT/evidence/plan.json"
```

读计划里的 GPU、区域、库存和当前小时价，说明首帧、转录及后期费用是否另计。`plan` 不创建实例，历史价格不能代替它。

总费用上限要覆盖创建准备、启动、上传、生成、恢复和关机等待。30 分钟兜底只是单次定时停机，不是平台总账硬封顶；两次兜底也不等于严格保证总费用。若预算要求无法由当前估算和停机措施满足，先停在计划阶段。

本次目标、两段任务、价格和服务范围都在有效授权内，可继续；不要每条命令重复问。换 GPU、提高上限、增加第三次生成、重装旧实例或新增付费声音服务，不在默认授权里。

## 6. 创建后立即生成第一段

下面 `create` 开始产生云端费用。成功返回时实例正在运行，不能放着等素材。

```bash
"$H3_PLUGIN_ROOT/scripts/h3-provision" create --yes --config "$H3_CONFIG" \
  > "$H3_PROJECT_ROOT/evidence/create.json"

node "$H3_LOCAL_TOOL" new-instance-baseline \
  --creation-receipt "$H3_PROJECT_ROOT/evidence/create.json" \
  --output "$H3_PROJECT_ROOT/evidence/usage-before.json" \
  || { "$H3_PLUGIN_ROOT/scripts/h3-cloud" stop --yes --config "$H3_CONFIG"; exit 1; }

"$H3_PLUGIN_ROOT/scripts/h3-cloud" generate \
  --config "$H3_CONFIG" --aspect-ratio 9:16 \
  --duration-seconds 15 --megapixels 0.6 \
  --prompt-file "$H3_PROJECT_ROOT/prompts/segment-01.txt" \
  --first-frame-image "$APPROVED_FIRST_FRAME" \
  --output-dir "$H3_PROJECT_ROOT/outputs/h3/segment-01"
```

新实例从零记录用量，包含创建后的准备时间。已有实例不能用这份零基线：必须在本次启动前读取真实累计用量，完成后取差值。接入或重装已有实例是另一条有风险的流程，不包含在本教程默认路线中。

`generate` 会准备 Runtime、提交任务、下载并在结束时停机。不要另外先 `start`，不要加 `--keep-running`。保存运行日志；出现任务 ID 后，记录到 `PROGRESS.md`。

若失败，先按下一节判断提交状态，检查实例并停机；不要把整段命令再执行一遍：

```bash
"$H3_PLUGIN_ROOT/scripts/h3-cloud" status --config "$H3_CONFIG"
"$H3_PLUGIN_ROOT/scripts/h3-cloud" stop --yes --config "$H3_CONFIG"
"$H3_PLUGIN_ROOT/scripts/h3-cloud" status --config "$H3_CONFIG"
```

### 把真实输出接到下一步

`--output-dir` 下还会创建独立的 `h3-任务ID` 目录。MP4 名称由后端返回，不会自动叫 `segment-01.mp4`。

从这次运行日志取得 manifest 路径，不选“最新 MP4”。辅助脚本要求 manifest 成功、有 `prompt_id`，且实际 MP4 属于这个任务目录：

```bash
export SEGMENT_01_MANIFEST="<本次第一段manifest绝对路径>"

SEGMENT_01_VIDEO="$(node "$H3_LOCAL_TOOL" artifact \
  --manifest "$SEGMENT_01_MANIFEST" \
  --within "$H3_PROJECT_ROOT/outputs/h3/segment-01")"
export SEGMENT_01_VIDEO

ffprobe -v error -show_format -show_streams -of json "$SEGMENT_01_VIDEO" \
  > "$H3_PROJECT_ROOT/evidence/segment-01-probe.json"
ffmpeg -v error -i "$SEGMENT_01_VIDEO" -f null -
"$H3_PLUGIN_ROOT/scripts/h3-cloud" status --config "$H3_CONFIG"
```

完整观看、试听：身份和配件稳定、台词完整、无字幕，末尾能接下一句。确认实例 `stopped`；若还在运行，先停机。写下 manifest、真实 MP4 路径和验收结果。

尾帧来自已通过的第一段：

```bash
ffmpeg -n -sseof -0.05 -i "$SEGMENT_01_VIDEO" -frames:v 1 \
  "$H3_PROJECT_ROOT/assets/keyframes/segment-01-last.png"
```

看这张尾帧；脸歪、手挡脸或构图异常时先解决，别直接传给第二段。

## 7. 跑第二段，回读用量

先查当前实例价格和本次已用费用，确认第二段仍在剩余预算内。未知费用不能填零。价格变化、预算不足或第一段未通过时，不提交第二段。

```bash
H3_RESOURCE_ID="$(node -e \
  'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!c.provider?.resourceId) throw Error("没有实例ID"); process.stdout.write(c.provider.resourceId);' \
  "$H3_CONFIG")"
export H3_RESOURCE_ID

compshare --json --profile "$H3_PROFILE" \
  instance show "$H3_RESOURCE_ID" --billing --status \
  | node "$H3_LOCAL_TOOL" usage-snapshot --resource-id "$H3_RESOURCE_ID" \
      --output "$H3_PROJECT_ROOT/evidence/usage-after-segment-01.json"

node "$H3_LOCAL_TOOL" usage-diff \
  --before "$H3_PROJECT_ROOT/evidence/usage-before.json" \
  --after "$H3_PROJECT_ROOT/evidence/usage-after-segment-01.json"
```

先读快照中的小时价、已用费用和额外收费项，再与 `H3_MAX_HOURLY`、`H3_MAX_TOTAL` 比较。插件的创建价格闸门不会替你为第二段强制执行项目总费用上限。

```bash
"$H3_PLUGIN_ROOT/scripts/h3-cloud" generate \
  --config "$H3_CONFIG" --aspect-ratio 9:16 \
  --duration-seconds 15 --megapixels 0.6 \
  --prompt-file "$H3_PROJECT_ROOT/prompts/segment-02.txt" \
  --first-frame-image "$H3_PROJECT_ROOT/assets/keyframes/segment-01-last.png" \
  --output-dir "$H3_PROJECT_ROOT/outputs/h3/segment-02"

export SEGMENT_02_MANIFEST="<本次第二段manifest绝对路径>"

SEGMENT_02_VIDEO="$(node "$H3_LOCAL_TOOL" artifact \
  --manifest "$SEGMENT_02_MANIFEST" \
  --within "$H3_PROJECT_ROOT/outputs/h3/segment-02")"
export SEGMENT_02_VIDEO

ffprobe -v error -show_format -show_streams -of json "$SEGMENT_02_VIDEO" \
  > "$H3_PROJECT_ROOT/evidence/segment-02-probe.json"
ffmpeg -v error -i "$SEGMENT_02_VIDEO" -f null -
"$H3_PLUGIN_ROOT/scripts/h3-cloud" status --config "$H3_CONFIG"
```

第二段同样看画面、听台词和结束语，确认 `stopped`。本案例第二段生成了烧录字幕；提示词写“无字幕”不是验收证据。

用官方 CLI 回读累计秒数，再保存不含凭证的精简快照：

```bash
H3_RESOURCE_ID="$(node -e \
  'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!c.provider?.resourceId) throw Error("没有实例ID"); process.stdout.write(c.provider.resourceId);' \
  "$H3_CONFIG")"
export H3_RESOURCE_ID

compshare --json --profile "$H3_PROFILE" \
  instance show "$H3_RESOURCE_ID" --billing --status \
  | node "$H3_LOCAL_TOOL" usage-snapshot --resource-id "$H3_RESOURCE_ID" \
      --output "$H3_PROJECT_ROOT/evidence/usage-after.json"

node "$H3_LOCAL_TOOL" usage-diff \
  --before "$H3_PROJECT_ROOT/evidence/usage-before.json" \
  --after "$H3_PROJECT_ROOT/evidence/usage-after.json"
```

保留第一段和最终快照，不相互覆盖。费用按本次秒数差计算；计数回退、价格改变或数据缺失时脚本拒绝估算，改查平台明细。

脚本输出只是实例用量估算，不是结算单；磁盘、镜像和其他服务需另查。`stopped` 不证明所有收费项停止。历史实例“未找到”也不等于 `stopped`，不能据此自行重建。

## 8. 中断时恢复原任务，不重复提交

先分三种情况：

| 证据 | 判断与处理 |
| --- | --- |
| 明确在创建/启动阶段报库存不足，尚未进入提交 | 不是一次视频生成；查资源和用量，确认停机后，在原授权内决定是否再尝试 |
| manifest 已有 `prompt_id` | 原任务已存在；查询、恢复和下载这个 ID，不再 `generate` |
| 本地无 `prompt_id`，但提交请求超时或保存失败 | 提交状态不明；保留日志，查原 ComfyUI 队列、历史及输出，停止重复提交 |

“没有本地回执”不等于“服务器没有接到任务”，更不等于没有 GPU 费用。本案例的四次容量不足，有启动阶段的明确错误作为依据，不能推广到所有无 ID 故障。

`h3-cloud` 0.1.0 没有顶层 `recover` 命令。原生成进程仍在时，它会对已有 ID 尝试最多三次恢复。不要同时开第二个恢复进程。

先查看本地是否已有成功下载的 MP4。已有可用文件时直接验收、补做停机，不为同一文件再连接云端恢复。

进程已经退出时，只有在原实例仍运行、原 ID 可查、恢复费用仍在授权内，才使用下面的底层恢复入口。它重新打开连接，不启动实例、不重新提交，结束后停机。原实例已经停了或历史丢失时，先调查，不能为了套用这段代码自动重启。

```bash
export RECOVERY_MANIFEST="<原任务manifest绝对路径>"

node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = process.env.H3_PLUGIN_ROOT;
const { loadProjectConfig, createProvider } =
  await import(pathToFileURL(join(root, 'runtime/src/project-config.mjs')));
const { openRuntimeEndpoint } =
  await import(pathToFileURL(join(root, 'runtime/src/runtime-endpoint.mjs')));
const manifest = process.env.RECOVERY_MANIFEST;
const record = JSON.parse(await readFile(manifest, 'utf8'));
const { config, runtime } = await loadProjectConfig(process.env.H3_CONFIG);
const id = config.provider.resourceId;
if (!record.prompt_id || !id || record.provider_resource_id !== id) {
  throw Error('原任务ID或实例不匹配，拒绝恢复');
}
const provider = createProvider(config);
const status = await provider.getStatus(id);
if (status.state !== 'running') throw Error('原实例未运行；不自动启动');
let endpoint;
try {
  endpoint = await openRuntimeEndpoint({ provider, resourceId: id, runtime });
  const result = await run(process.execPath, [
    join(root, 'runtime/scripts/h3-comfy.mjs'), 'recover',
    '--url', endpoint.url, '--manifest', manifest, '--timeout-seconds', '1200'
  ], { timeout: 1230000, maxBuffer: 1048576 });
  process.stdout.write(result.stdout);
} finally {
  try { await endpoint?.close(); } finally { await provider.stop(id); }
}
NODE

"$H3_PLUGIN_ROOT/scripts/h3-cloud" status --config "$H3_CONFIG"
```

1200 秒是示例查询超时，不是本次预算。如果剩余预算不能覆盖这么长的运行时间，先缩短超时并记录，或停机等待决定。底层恢复要求原 ID 仍在队列或历史中；找不到时不会重新提交。结果下载后，重新用 `artifact` 读取实际文件。

若状态不明、自动停机失败或恢复超预算，先停止有关操作并报告证据，不拿另一张卡“补跑”。

## 9. 本地返修：先小样，不动原文件

先设置当前待采用版本：

```bash
export SEGMENT_01_ACCEPTED="$SEGMENT_01_VIDEO"
export SEGMENT_02_ACCEPTED="$SEGMENT_02_VIDEO"
```

### 两段声音亮度、音量不一致

先测量并试听接缝。两段的相同基频，不代表相同音色：

```bash
ffmpeg -i "$SEGMENT_01_VIDEO" -vn -af ebur128 -f null -
ffmpeg -i "$SEGMENT_02_VIDEO" -vn -af ebur128 -f null -
```

若第二段偏亮、偏响，可从一个温和预览开始，保留画面和时间：

```bash
ffmpeg -n -i "$SEGMENT_02_VIDEO" -map 0:v:0 -map 0:a:0 \
  -c:v copy -af "equalizer=f=1600:t=q:w=1:g=-3,volume=-1dB" \
  -c:a aac -ar 32000 -b:a 192k \
  "$H3_PROJECT_ROOT/outputs/local/segment-02-audio-preview.mp4"
```

这组参数是试调起点，不是本案例定稿的完整滤波链。比较两段响度、齿音和浑浊程度，逐项调整；没有改善就不采用。通过后再把下游路径切到预览：

```bash
export SEGMENT_02_ACCEPTED="$H3_PROJECT_ROOT/outputs/local/segment-02-audio-preview.mp4"
```

EQ 和增益只能减轻接缝，不能保证统一声纹。要真正统一声音，需另选可用的语音转换/配音工具，让两段使用同一批准的声音参考，再验收时长和口型；新增费用另确认。不要把第三次 H3 生成当成可靠的音色修复。

### 第二段有烧录字幕

字幕进入像素后，关闭字幕轨没有用。固定机位、字幕只压在变化小的衣服区域时，可以用同镜头的无字幕底片局部覆盖。

先抽一张没有字、且衣服纹理能接上的帧。这里第 0 秒只是候选，必须查看：

```bash
ffmpeg -n -ss 0 -i "$SEGMENT_02_VIDEO" -frames:v 1 \
  "$H3_PROJECT_ROOT/assets/overlays/segment-02-clean-frame.png"
```

没有可用底片时，先停止这条修补路线。字幕压到手、脸或复杂运动上，静态覆盖容易穿帮，应选择专门的视频修复或另批重生成，不能自动收费。

本案例 608×1056 的修补区约为 `x=20,y=750,w=568,h=205`。换分辨率、换字幕位置必须重新定位；不要直接复制坐标。

```bash
export CLEAN_FRAME="$H3_PROJECT_ROOT/assets/overlays/segment-02-clean-frame.png"
export MASK_SIZE="608x1056"
export MASK_X="20" MASK_Y="750" MASK_W="568" MASK_H="205"

ffmpeg -n -i "$SEGMENT_02_ACCEPTED" -loop 1 -i "$CLEAN_FRAME" \
  -f lavfi -i "color=black:s=$MASK_SIZE:r=24" \
  -filter_complex "[2:v]drawbox=x=$MASK_X:y=$MASK_Y:w=$MASK_W:h=$MASK_H:color=white:t=fill,gblur=sigma=5,format=gray[mask];[1:v]format=rgb24[plate];[plate][mask]alphamerge[patch];[0:v][patch]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]" \
  -map "[v]" -map 0:a:0 -c:v libx264 -crf 18 -preset medium \
  -c:a copy -shortest \
  "$H3_PROJECT_ROOT/outputs/local/segment-02-clean-preview.mp4"
```

查看第 1、5、9、12、14 秒和全段运动：字要消失，衣服不能冻结得明显，手和嘴不能被覆盖，遮罩边缘不能闪。通过后再采用：

```bash
export SEGMENT_02_ACCEPTED="$H3_PROJECT_ROOT/outputs/local/segment-02-clean-preview.mp4"
```

本地返修不产生新的云端服务费，但仍消耗本地时间和电力。原始 H3 输出保留不改，未通过的预览不能标成定稿。

## 10. 拼接，明确从粗剪到成片的路径

比较两段 FFprobe 记录。编码、分辨率、帧率、音频参数一致时，辅助脚本用实际采用的文件生成列表，兼容空格和单引号路径：

```bash
node "$H3_LOCAL_TOOL" concat-list \
  --first "$SEGMENT_01_ACCEPTED" --second "$SEGMENT_02_ACCEPTED" \
  --output "$H3_PROJECT_ROOT/outputs/local/concat.txt"

export ROUGH_VIDEO="$H3_PROJECT_ROOT/outputs/local/rough-30s.mp4"
ffmpeg -n -f concat -safe 0 \
  -i "$H3_PROJECT_ROOT/outputs/local/concat.txt" -c copy "$ROUGH_VIDEO"
```

参数不一致时不要硬拼。两段均有音频的情况下，可统一到本案例规格再拼接：

```bash
export ROUGH_VIDEO="$H3_PROJECT_ROOT/outputs/local/rough-30s-normalized.mp4"

ffmpeg -n -i "$SEGMENT_01_ACCEPTED" -i "$SEGMENT_02_ACCEPTED" \
  -filter_complex "[0:v]scale=608:1056:force_original_aspect_ratio=decrease,pad=608:1056:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[v0];[1:v]scale=608:1056:force_original_aspect_ratio=decrease,pad=608:1056:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[v1];[0:a]aformat=sample_rates=32000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0];[1:a]aformat=sample_rates=32000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset medium \
  -c:a aac -ar 32000 -b:a 192k "$ROUGH_VIDEO"
```

实际时长可能略超过 30 秒。本案例是 30.21 秒；若必须严格 30.00 秒，先找无台词的可剪位置，不能盲目 `-t 30` 截掉结束语。

验收当前粗剪：

```bash
ffprobe -v error -show_format -show_streams -of json "$ROUGH_VIDEO" \
  > "$H3_PROJECT_ROOT/evidence/final-probe.json"
ffmpeg -v error -i "$ROUGH_VIDEO" -f null -
ffmpeg -n -i "$ROUGH_VIDEO" \
  -vf "fps=1,scale=152:-1,tile=6x6" -frames:v 1 \
  "$H3_PROJECT_ROOT/evidence/final-contact.jpg"
```

时间格不能替代完整观看和试听。检查首帧、身份、字幕残留、第二段实际起点附近的姿势与声音、指定结束语是否说完。接缝不是一律第 15.00 秒，要看第一段实际时长，本案例约 15.08 秒。

通过后，才从这份粗剪保存最终文件：

```bash
cp -n "$ROUGH_VIDEO" "$FINAL_VIDEO"
test -s "$FINAL_VIDEO"
cmp -s "$ROUGH_VIDEO" "$FINAL_VIDEO"
ffmpeg -v error -i "$FINAL_VIDEO" -f null -
shasum -a 256 "$ROUGH_VIDEO" "$FINAL_VIDEO"
"$H3_PLUGIN_ROOT/scripts/h3-cloud" status --config "$H3_CONFIG"
```

两个哈希应一致；目标路径已有其他文件时，不覆盖，也不把旧文件当新成片。确认实际实例已停止，回读费用，记录到 `PROGRESS.md`。磁盘、镜像费和远端肖像留存另核对；插件 0.1.0 未保证自动删除上传素材。

交付最终 MP4、参考与成果的并排对比、使用过的素材路径、关键任务记录和实际费用。人物、字幕、口播或声音仍有未接受的问题时，交“待审预览”和问题，不宣称全部完成。

需要可播放的并排对比时，可以本地生成：左边参考，右边成果，只播放成果声音。

```bash
ffmpeg -n -i "$REFERENCE_VIDEO" -i "$FINAL_VIDEO" \
  -filter_complex "[0:v]scale=304:528:force_original_aspect_ratio=decrease,pad=304:528:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[ref];[1:v]scale=304:528:force_original_aspect_ratio=decrease,pad=304:528:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,setpts=PTS-STARTPTS[result];[ref][result]hstack=inputs=2:shortest=1,format=yuv420p[v]" \
  -map "[v]" -map 1:a:0 -c:v libx264 -crf 18 -preset medium \
  -c:a aac -shortest "$H3_PROJECT_ROOT/deliverables/comparison.mp4"
```

这份对比只覆盖两条视频共有的时长，不替代完整成片验收，也不更改 `FINAL.mp4`。

## 11. 这次样片的成本，怎么理解

原日志有两个不同的用量口径：

| 口径 | 秒数 | 按当时 ¥3.20/小时估算 |
| --- | ---: | ---: |
| 实例累计用量 | 1335 | ¥1.19 |
| 接入前已有基线 | 371 | ¥0.33 |
| 基线后的新增用量 | 964 | ¥0.86 |

如果把基线前的实例部署也计入这个项目，可以用累计 ¥1.19；只核算接入后的增量则约 ¥0.86。不能相加，也不能写成纯视频推理费。这里只是用量乘当时价格，未取得结算订单。无字幕和音频调整使用本地处理，没有新增云端生成费。

没有计入既有订阅、人工、本地电力和等待库存的时间，也没有获得结算订单明细。批量估算还需记录每条总耗时、失败率和人工返修时间；一次成功样片不是稳定单价。

## 常见故障

| 现象 | 处理 |
| --- | --- |
| Skill 已安装但没有 `hypit` | CLI 是另一项安装；可走 FFmpeg 基本路线 |
| `plan` 无库存或超过上限 | 停在计划阶段，不换卡、不提高上限 |
| 辅助脚本拒绝版本或重复文件 | 核对版本/状态，保留备份，不删除保护来绕过 |
| 没有 `prompt_id` | 看错误发生阶段；提交不明时先查原队列/历史 |
| 已有 `prompt_id` | 恢复原任务；不存在顶层 `h3-cloud recover` |
| 两段声音变了 | EQ 只减轻差异；统一声纹另选声音工具 |
| 字幕遮住手或脸 | 不用静态底片硬盖，换修复方法并单独评估费用 |
| 成片完成但实例还运行 | `stop --yes` 后回读状态和用量 |
| 旧实例“未找到” | 平台核对资源与账单，不算停机证明，也不自动重建 |

## 给下一位 Agent 的开工说明

连同教程、辅助脚本、填写后的 `task.json` 和素材一起交付：

```text
按教程 v1.1.1 执行，以 task.json 和当前项目文件为输入，不依赖之前聊天。
先验证工具、素材、许可和本次授权；缺少已批准首帧时先制作并验收。
准备完两段逐字提示词以后再配置和 plan，不开着 GPU 等文案。
本次费用批准覆盖且没有变化时继续执行，不为每条命令重复确认。
第一段用批准首帧，第二段用第一段已验收尾帧；每段记录 manifest、实际 artifact_path、用量和停机状态。
已有 prompt_id 只恢复原任务；没有 ID 且提交状态不明时，不盲目 generate。
本地返修先出可回退预览，不能把 EQ 说成统一声纹。
最终以实际采用文件拼接，验收完整台词、无字幕、接缝、声音、结束语和费用，再保存到 task.json 的 finalVideo。
任何换卡、加价、额外付费任务或破坏性实例操作，超出批准范围就停下说明。
```

本次修订核对了文档、插件代码和本地处理；具体验证结果见[验证说明](./verification.md)。没有启动新的 GPU，也没有完成另一 Agent 的付费端到端实跑，因此不承诺所有 Agent、所有视频都能一次通过。

## 参考资料

- [Hypit Agent 安装说明](https://github.com/hypit-ai/hypit/blob/main/docs/guide/agents.md)
- [Hypit Quickstart](https://github.com/hypit-ai/hypit/blob/main/docs/quickstart.md)
- [MiniMax H3 Cloud 插件仓库](https://github.com/Sac-Y/MiniMax-H3-Cloud)
- [MiniMax H3 社区许可证](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
