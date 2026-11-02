# Mana 云端精细 OCR — 开发测试分支

仅用于 https://mana-learning.site 的独立 OCR 计算节点；尚未部署到正式站。

## 当前状态

- 已通过漫画、小说的单路/四路实际 CPU 推理与并行一致性测试。
- 漫画样本文字与网页一致；小说 3 个区域仍有跨运行环境差异，需要对照原图验收。
- GPU 性能、真实 Docker 镜像构建和 Runpod 端到端执行尚未验证。当前不可用于正式任务。
- Dockerfile 是 CPU 版本。不要把它部署到按 GPU 收费的节点来测试 GPU 性能。
- VALIDATION.json 记录验收范围与阻止正式上线的状态，未声称 99% 准确率。

## 下一步：连接 Runpod 与 GitHub

在 Runpod Settings → Connections → GitHub 连接账号，只授权这个仓库。
回到 Serverless → Deploy from a GitHub repository，选择该仓库和 mana-ocr-preview 分支。
Dockerfile Path 为 Dockerfile，Endpoint Type 为 Queue。
先停在资源配置页，不创建收费实例；CPU/GPU 配置与质量验收完成后再继续。

Runpod 可以从这个分支构建镜像，不需要在 Mac 安装 Docker。
模型是公开的固定版本权重，构建期间按 models-lock.json 校验下载；
图像缓存解码器由源码生成，输出四个文件的 SHA-256 必须与已验收版本完全一致。
原件、OCR 文字、密码和密钥均不在这个代码仓库中。节点只接受短时签名的原件读取任务。

## 后续运行配置

MANA_R2_ACCOUNT：自己的 Cloudflare account ID（账号标识，不是 API 密钥）。
MANA_OCR_WORKERS=4；MANA_OCR_DEVICE=cpu。Active workers=0，Max workers=1。

模型与调度协议说明见 ARCHITECTURE.md。
