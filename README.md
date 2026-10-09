# Hypit 视频复刻工作流：Seedance 2.5 / 云端 MiniMax H3

从参考视频到可交付成片：拆解构图与节奏、准备本人或获授权肖像、选择生成路线、筛选镜头、统一声音和字幕、检查首尾与封面、保留任务及费用记录。

本仓库 v1.2.0 整理了 **5次独立内容生成测试**：Seedance 2.5两次、云端MiniMax H3两次、设计图＋豆包TTS＋OmniHuman一次。本地布局复用仅属技术验证，已剔除出内容生成计数。详情见[匿名测试台账与避坑清单](skills/hypit-h3-video-replica/references/lessons.md)。这是个人实操流程，不是上述产品的官方发行版，也不保证一键复刻、逐帧换脸或批量产能。

## 安装

准备Node.js 22.20或更高，安装教程、模板和本地辅助工具：

```bash
npx --yes skills@1.7.0 add https://github.com/ghao0630-droid/hypit-h3-video-replica --skill hypit-h3-video-replica -g
```

沿用原仓库和Skill名称，方便已有使用者更新。安装器若发现同名Skill，先备份自己的修改，再按安装器支持的方式更新；不要直接覆盖。`-g`只表示全局Skill安装范围，不会安装模型、连接账号或授予积分/GPU使用权限。安装后开启新一轮对话。

只查看文件时：

```bash
git clone https://github.com/ghao0630-droid/hypit-h3-video-replica.git
```

可将这段话和仓库地址交给智能体：

```text
阅读README并使用hypit-h3-video-replica Skill。
先根据参考、素材和目标，确认采用Seedance、云端H3还是设计图展示路线。
检查现有工具，保留已有配置和成片；先准备素材、逐字稿、镜头表和预算。
现在不要读取密钥、上传素材、创建GPU或提交付费生成。
实际制作前按本次授权执行，结束后检查人物、背景信息、字幕、声音、首尾与封面。
```

## 选择路线

| 路线 | 已验证的制作方式 | 开始前读取 |
| --- | --- | --- |
| Seedance 2.5 | 即梦网页视频编辑／CLI生成，下载后在本地筛选与剪辑 | [Seedance指南](skills/hypit-h3-video-replica/references/seedance.md) |
| MiniMax H3 | 本地脚本编排云端GPU上的H3，短镜头生成后下载组装 | [H3完整教程](skills/hypit-h3-video-replica/references/tutorial.md) |
| 设计图＋人物短表演 | 确认过的设计图、统一配音、短人物表演与本地编排 | [设计图展示指南](skills/hypit-h3-video-replica/references/design-presentation.md) |

路线由用户目标和已有素材决定，不自动更换已选服务。H3的“本地”指编排、下载和后期；这里的案例在云端GPU进行推理，没有证明Mac本机GPU运行H3。不同案例的外部CLI、Hypit Runtime与FFmpeg各自承担部分步骤，不是所有环节都由Hypit原生执行。

## 统一制作与交付

阅读[统一工作流与交付检查](skills/hypit-h3-video-replica/references/workflow.md)，将[多路线任务模板](skills/hypit-h3-video-replica/assets/workflow.example.json)复制到独立制作项目。旧的[H3两段任务模板](skills/hypit-h3-video-replica/assets/task.example.json)和辅助脚本保持兼容。

1. 定参考、人物、准确文案、时长、字幕、封面与声音来源。
2. 预检实际引用文件；确认当前模型输入规格、费用和有效授权后生成。
3. 人物、背景字样、字幕、声音分别验收，再统计可用秒数与排剪辑表。
4. 本地组装，检查所有切点、首尾构图及实际首帧封面。
5. 核对视频流与音频流、完整解码、查看和听读；交付成片、剪辑表、QA及费用口径。

生成状态不明时先查原任务。GPU路线准备好素材再开机，结束、失败或中断后确认停机；兜底关机不能代替即时停机。安装、发布本仓库不授权后续付费生成。

## 工具与版本边界

按路线补依赖，详见[安装说明](skills/hypit-h3-video-replica/references/installation.md)。Seedance路线不要求安装H3插件或CompShare；`doctor.mjs`仍是H3专用本地检查，不能用它的H3缺项阻止Seedance工作。

现有工具不在PATH时，先检查项目依赖；H3检查支持`--ffprobe-bin`、`--hypit-bin`指定绝对路径，无效路径不回退。`local-handoff.mjs`支持本地文件交接、拼接列表和用量差值；费用溢出、倒序快照或重复资源记录会被拒绝。估算不是结算账单。

H3教程保留原实测提交`e0c97e2a0bf0afbfbbfd981359b091a38e7d0d76`及43文件基线；同版本号的新代码也可能不同，升级后重新核对。Seedance指南的CLI命令结构在本机1.0.2检查过；模型目录、规格和账号准入以制作时查询为准。安装和本地检查不产生云端费用，实际服务可能分别收费。

维护者在仓库根目录运行，无须`npm install`：

```bash
npm test
npm run verify
```

[验证说明](skills/hypit-h3-video-replica/references/verification.md)区分历史实机生成、本版本地检查与尚未完成的验证。当前没有统一批量成功率或稳定日产量测试。

**素材和实际配置留在独立制作项目。** 本仓库不包含肖像、原视频、录音、私有回执、实例配置、密钥或第三方模型/Skill代码。依赖来源见[来源说明](NOTICE.md)。
