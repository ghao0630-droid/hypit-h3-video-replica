# 优云智算托管 MiniMax H3

这条路线调用优云智算的 HTTPS 视频任务 API，不开启 GPU，也不走 SSH。脚本是 [hosted-h3.mjs](../scripts/hosted-h3.mjs)。它和[自建 GPU 教程](tutorial.md)是两条路线：选定一条后，沿用该次的任务标识和费用口径，不要把积分估算和 GPU 小时费加在一起。

官方接口说明：<https://www.compshare.cn/docs/minimax-h3/api/minimax-h3-video-api>。下面的单价按该文档；2026-10-10 有一次 5 秒 480P 实测扣了 20 积分。估算不是结算账单。

## 什么时候用托管，什么时候用 SSH 自建

| | 托管 API | SSH 自建 GPU |
| --- | --- | --- |
| 网络 | 只需要出站 HTTPS 443 | 需要 SSH，以及插件里的上传和回传 |
| 推理位置 | 优云智算视频任务 API | 自己开机的云端 GPU / ComfyUI |
| 肖像 | 首帧或最多 9 张参考图的 Data URL，不先上传到第三方图床 | 按插件流程把素材送到实例 |
| 计费 | 按分辨率和秒数扣积分；提交时预占，失败或取消后释放 | 按实例小时价和用量计 GPU 费用 |
| 本地检查 | 不使用 `doctor.mjs` 的插件基线 | `doctor.mjs` 只服务这条路线 |

出站只能走 443、或不想管理开关机时，用托管。已经按教程绑好插件和实例、需要 ComfyUI 工作流时，继续用自建。`doctor.mjs` 报缺少 SSH 或插件，不能据此阻断托管路线，也不能据此改去开机。

## 费用

默认分辨率是 **768P**。1080P、2K、480P、4K 都必须显式写入；脚本不会把省略值当成 480P，也不会把 `768p`、`720P`、`1K` 悄悄当成 768P。

| 分辨率 | 积分/秒 | 5 秒官方估算 | 约合人民币 |
| --- | --- | --- | --- |
| 480P | 5 | 25 | ¥0.225 |
| 768P | 10 | 50 | ¥0.45 |
| 1080P | 19 | 95 | ¥0.855 |
| 2K | 20 | 100 | ¥0.90 |
| 4K | 22 | 110 | ¥0.99 |

人民币按公开套餐 **1100 积分 = ¥9.90** 折算，即 1 积分 = ¥0.009。账号里未必是这一档套餐。2026-10-10 一次 5 秒 480P 实际扣费是 **20 积分**（约 ¥0.18），低于文档上的 25 积分；其它档位没有这次对照。提交前以 `points` 读到的可用积分为准。

`compshare-cli` 0.4.4 的 `compshare minimax` 只接受 768P、1080P、2K 和 4–15 秒。托管 API 的时长是 4–30 秒整数，并接受 480P 和 4K。脚本遇到 CLI 不接受的组合会警告，但仍按托管 API 校验；警告不是改价。

## 准备

密钥只放在环境变量 `COMPSHARE_MINIMAX_API_KEY`，值以 `sk-ml-` 开头。不要写进命令行、配置文件、清单、提示词或调试输出。脚本拒绝从配置读取密钥字段；`--debug` 会把 `Authorization` 打成 `Bearer [redacted]`，并去掉 Data URL 的正文。

配置文件只放本次积分上限，例如 `{"maxPoints": 80}`。`--max-points` 和配置同时存在时，取更小的那个。

```bash
set -euo pipefail
export H3_SKILL_ROOT="<包含SKILL.md的技能目录绝对路径>"
export H3_PROJECT_ROOT="<新项目绝对路径>"
export COMPSHARE_MINIMAX_API_KEY="<以 sk-ml- 开头的密钥>"
mkdir -p "$H3_PROJECT_ROOT/prompts" "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01"
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" --help
```

`--help` 和 `estimate` 不访问网络。`points`、`submit`、`status`、`wait`、`download`、`resume` 会把密钥发给 `https://cp.compshare.cn`。

## 逐步使用

先估算，再看余额。`estimate` 的 `--count` 只用于一批镜头的合计；`submit` 每次只创建一条任务。

```bash
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" estimate --resolution 768P --duration 5 --count 1
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" points
```

提交必须同时满足三件事：估算不超过 `--max-points`（或配置里的 `maxPoints`）、显式 `--yes`、可用积分不少于估算。缺 `--yes` 或超出上限时，脚本打印估算并退出，不写清单，也不发创建请求。首帧从本地文件编码成 Data URL，角色固定为 `first_frame`。

```bash
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" submit \
  --prompt-file "$H3_PROJECT_ROOT/prompts/segment.txt" \
  --first-frame "$H3_PROJECT_ROOT/assets/keyframes/approved.png" \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json" \
  --resolution 768P \
  --duration 5 \
  --ratio 9:16 \
  --max-points 80 \
  --yes
```

需要无声成片时加 `--mute`。竖屏口播常用 `--ratio 9:16` 或 `--ratio adaptive`。省略 `--resolution` 时发送的是 `768P`，不是 `480P`。1080P 和 2K 要写成 `--resolution 1080P`、`--resolution 2K`。

## 口播换人用参考图

换人口播不要把上一段的最后一帧只交给下一段当 `--first-frame`。这样接下去，人物和背景都会漂。每一段都用 `--reference-image`，而且不要和 `--first-frame` 一起用。托管接口不允许同一个任务里同时出现 `first_frame` 和 `reference_image`；脚本会直接拒绝。

每段按这个顺序重复传入，最多 9 张：

1. 要换成的本人照片。
2. 没有人的空场景，用来钉住背景。
3. 可选：上一段成片的最后一帧。它仍然是 `reference_image`，不是下一秒的首帧。

请求里的字段是 `type: image_url`、`image_url.url`（Data URL）和 `role: reference_image`。顺序就是 `<Picture 1>`、`<Picture 2>` 的编号。接口不认识 `<Image 1>`、`@图片1` 或文件名。

```bash
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" submit \
  --prompt-file "$H3_PROJECT_ROOT/prompts/segment.txt" \
  --reference-image "$H3_PROJECT_ROOT/assets/portraits/person.png" \
  --reference-image "$H3_PROJECT_ROOT/assets/scenes/empty.png" \
  --reference-image "$H3_PROJECT_ROOT/assets/keyframes/segment-00-last.png" \
  --spoken-language "普通话" \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json" \
  --resolution 768P \
  --duration 5 \
  --ratio 9:16 \
  --max-points 80 \
  --yes
```

提示词要写明每张图负责什么。例如：人物外观以 `<Picture 1>` 为准；背景和光线以 `<Picture 2>` 的空场景为准，不要把路人带进来；`<Picture 3>` 只参考景别和动作，不改背景。

各段对白保持同一种口语语言。`--spoken-language` 会在提示词末尾加上同一句「对白只使用该语言，各段保持同一种口语语言，不要中途换语言。」每一段传入同一个值，例如 `--spoken-language 普通话`。不传这个参数时，脚本不会改提示词，需要自己把这条约定写进每一段。

清单按同样顺序记下每张参考图的 SHA-256。`taskId` 还是空时，`resume` 会先核对这些哈希和口语语言，不一致就拒绝，不会拿原来的幂等键去提交另一组图。

```bash
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" resume \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json" \
  --prompt-file "$H3_PROJECT_ROOT/prompts/segment.txt" \
  --reference-image "$H3_PROJECT_ROOT/assets/portraits/person.png" \
  --reference-image "$H3_PROJECT_ROOT/assets/scenes/empty.png" \
  --reference-image "$H3_PROJECT_ROOT/assets/keyframes/segment-00-last.png" \
  --spoken-language "普通话"
```

成功时标准输出里有 `taskId`。接着查询、等待和下载。下载目录必须位于项目的 `outputs` 路径下；视频地址不会写入清单。

```bash
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" status \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json"
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" wait \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json"
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" download \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json" \
  --output-dir "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01"
```

等待按 2 秒、4 秒、8 秒递增，上限 20 秒。生产环境见过的过程状态是 `moderating`，然后 `running`，然后 `succeeded`。文档里的 `queued` 同样视为未结束。`succeeded`、`failed`、`cancelled` 才是终态。超时只停止等待，不会再提交一次。

## 幂等与恢复

创建请求带 `Idempotency-Key`（UUID）。同一个键再次提交，平台返回原先的任务。

脚本在任何网络请求之前，把清单写到磁盘并刷盘。此时已经有幂等键，`taskId` 仍是 `null`。这样进程在响应写回之前崩溃，也不会另起一个新键。

1. 清单里还没有 `taskId`：`resume` 使用清单中的同一个键再次提交。提示词、口语语言、首帧或每一张参考图的 SHA-256 必须和清单一致，否则拒绝，避免在第一次请求其实没送达时换了内容。
2. 清单里已经有 `taskId`：`resume`、`status`、`wait`、`download` 只查询或下载，不再 POST。
3. 任务失败或取消后，积分会释放，但这个 `taskId` 仍然留着。再生成一条要新建清单，让脚本生成新的幂等键。不要为了重试去删一个可能已经被平台接受的清单。
4. 余额不足时，清单会留下且 `taskId` 为 `null`，创建请求没有发出。补足积分后对同一清单 `resume`。

```bash
node "$H3_SKILL_ROOT/scripts/hosted-h3.mjs" resume \
  --manifest "$H3_PROJECT_ROOT/outputs/h3-hosted/segment-01/manifest.json" \
  --prompt-file "$H3_PROJECT_ROOT/prompts/segment.txt" \
  --first-frame "$H3_PROJECT_ROOT/assets/keyframes/approved.png"
```

已有 `taskId` 时，可以不带提示词和首帧。清单权限是 `0600`，里面有参数、哈希、幂等键和任务号，没有密钥、Data URL 或视频下载地址。
