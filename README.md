# Hypit + MiniMax H3：30 秒肖像视频复刻

把参考视频里的场景、构图和口播关系重建出来，换成自己的肖像，生成两段视频后拼成约 30 秒成片。

这是个人整理的实操流程，基于一条已完成的样片。不是 Hypit 或 MiniMax 的官方插件，也不承诺逐帧换脸、完全相同的手势或统一声纹。

## 安装

准备 Node.js **22.20 或更高**。安装教程、任务模板和本地辅助工具：

```bash
npx --yes skills@1.7.0 add https://github.com/ghao0630-droid/hypit-h3-video-replica --skill hypit-h3-video-replica -g
```

在安装器中选择你使用的智能体。不要把 `-g` 当成“装好了所有依赖”；它只选择 Skill 的全局安装范围。安装后开启新一轮对话，让智能体读取实际安装目录的 `SKILL.md`。

如果只想查看文件，也可以克隆仓库：

```bash
git clone https://github.com/ghao0630-droid/hypit-h3-video-replica.git
```

### 直接把这段话和仓库地址发给智能体

```text
阅读这个仓库的 README，并安装 hypit-h3-video-replica Skill。
先检查现有工具，只补缺失的依赖；已有配置不覆盖。
安装后做本地环境检查，告诉我还缺哪些工具和素材。
现在不要录入或读取密钥，不要创建实例、启动 GPU、上传肖像或提交付费生成。
等我提供参考视频、肖像、文案并确认本次预算后，再进入制作。
```

## 安装后还有哪些条件

| 条件 | 怎么解决 |
| --- | --- |
| Hypit Skill | 从 [Hypit 原仓库](https://github.com/hypit-ai/hypit)安装；用于参考拆解和制作组织 |
| H3 运行工具 | 从 [H3 插件原仓库](https://github.com/Sac-Y/MiniMax-H3-Cloud)安装完整插件，不只复制三个脚本 |
| Python、SSH、FFmpeg / FFprobe、CompShare CLI | 按[安装说明](skills/hypit-h3-video-replica/references/installation.md)检查和补齐 |
| 参考视频、肖像、逐字文案 | 使用者自行提供，确认参考素材与肖像的使用权限 |
| 首帧编辑工具 | 需能同时接受场景图与肖像；已有批准首帧可跳过 |
| 优云账号、凭证与 GPU 预算 | 使用者自行配置，创建和运行资源前明确本次授权 |

Hypit CLI 是可选的独立安装；Skill 不附带模型、API Key、积分或 GPU。本仓库安装和本地检查不会主动产生云端费用，实际图片、转录、视频和声音服务可能分别收费。

H3 模型有地域与用途限制，使用前阅读[完整社区许可证](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)。不能根据语言、时区或 IP 猜测许可资格。

## 开始制作

1. 让智能体读取 [Skill 入口](skills/hypit-h3-video-replica/SKILL.md)和[完整教程](skills/hypit-h3-video-replica/references/tutorial.md)。
2. 把[任务模板](skills/hypit-h3-video-replica/assets/task.example.json)复制到一个新项目，填写路径、台词、结束语和本次授权。密钥不填入 JSON。
3. 先验收首帧、准备两段文案，再查看库存与实时价格。批准以后才创建或启动 GPU。
4. 第一段用批准首帧；第二段用第一段已验收尾帧。每段下载后确认停机、记录真实文件和用量。
5. 本地处理声音接缝和字幕问题，完整观看、试听，再交付成片、并排对比和费用说明。

GPU 缺货、超预算或任务提交状态不明时先停。已有 `prompt_id` 只查询或恢复原任务，不再提交一次。

## 版本与验证

当前发布版 `1.1.1` 基于教程 v1.1 增加 GitHub 安装入口，并修正累计费用与增量费用的表述。H3 基线固定到 `e0c97e2a0bf0afbfbbfd981359b091a38e7d0d76`；该提交与原实测插件的 43 个文件一致。上游同为 `0.1.0` 的新代码也可能不同，升级前要重新核对。

验证方法和范围见[验证说明](skills/hypit-h3-video-replica/references/verification.md)。仓库没有自动安装钩子，也没有自动付费生成流程。

维护者可在仓库根目录运行不依赖账号的本地检查，无须 `npm install`：

```bash
npm test
npm run verify
```

**不要往这个仓库提交素材或运行配置。** 视频、肖像、`task.json`、实例配置、API Key、私有回执和账单都留在各自的制作项目。第三方依赖来源见[来源说明](NOTICE.md)。
