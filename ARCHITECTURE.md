# Mana 精细扫描计算节点

仅服务于独立正式站 https://mana-learning.site 。旧 ChatGPT Site 保持只读备份。

这是待验收的开发源码包，不是已发布的 Docker 镜像地址，不应直接用于正式任务。账号注册完成不代表扫描服务已经接通。
发布仓库需要你的 Docker Hub 或 GitHub 账号授权；包内不包含网站密码、密钥、R2 凭证或藏书。

## 引擎

- 与网站相同的 manga-ocr-q8 模型，固定 revision `8e15f1319f1ed70b9560a39f42340dd19ee49f92`。
- 复用网站的区域定位、阅读顺序、完整前缀解码和图像投影缓存；保留 256 token 上限。
- 一个常驻原生 Node/ONNX 进程共享模型权重；最多四个区域并行，按原索引合并结果。
- 小说和漫画统一使用精细模型。扫描页没有轻量 OCR 降级；失败返回待重试，不保存半页文字。
- 页面图片与检测尺寸上限分别为 16MP / 长边 1400；PDF 单页渲染长边 2200。
- 每页最长约八分钟；Python 监督进程会在超时后终止识别子进程，下个任务可重建。
- 区域调度 O(R)、解码与识别计算另计；沿用网站检测算法，未宣称其全部步骤为线性。

## 当前验收边界

漫画样本与浏览器文字一致。小说样本在原生运行环境仍有部分区域文字差异；尚未取得人工真值验收，发布到正式任务的质量门禁保持关闭。
样本对照结果位于 VALIDATION.json（打包时生成）。单路/四路结果相同仅证明并行一致性，不代表识别准确率。

此 Dockerfile 是 CPU 原生精细识别版本，适用于 CPU 计算环境。它不会利用 NVIDIA GPU。
不要把这个 CPU 镜像部署到收费 GPU 实例来验证 GPU 性能。
云端 GPU 容器、真实 Runpod 端到端执行、冷启动和费用尚未验收。

该包提供 Runpod Queue handler；接入网站还需要新增异步提交/结果回收与持久化调度。
现有网站的通用 OCR_WORKER_URL 接口是同步协议，不能直接填写 Runpod /run 地址。
模型输出由调用方逐页校验版本后持久化，需保留人工校正内容；不要把 Runpod 临时结果保存当作永久书库。

## 发布路径

可以把这个目录上传到自己的私有 GitHub 仓库，通过 Runpod 的 GitHub 部署入口自动构建。
也可以在已安装并启动 Docker 的电脑上执行：

```bash
bash publish-image.sh YOUR_DOCKER_HUB_USERNAME --development
```

该命令仅发布隔离开发测试用的 cpu-preview-v1，正式质量验收尚未通过。成功完成构建与推送后，脚本才会打印真实 Container image 地址。
`YOUR_DOCKER_HUB_USERNAME` 是占位符，不能原样填进 Runpod。
镜像构建只下载公开的固定版本模型，并校验 models-lock.json 与解码器 manifest 的 SHA-256。

## 后续节点配置

- Endpoint type: Queue。
- Active workers: 0；Max workers: 1；初次测试关闭自动充值。
- `MANA_R2_ACCOUNT`：自己的 Cloudflare account ID，32 位十六进制；这是账号标识，不是密钥。
- `MANA_OCR_WORKERS=4`，可以在 1–4 之间测试。
- `MANA_OCR_DEVICE=cpu`；运行设备与所选资源必须一致。
- `MANA_OCR_CACHE` 默认 `/tmp/mana-precision-cache`：上限 1GiB，闲置文件在后续请求时清理。

任务输入只接受该账号 R2 的短时签名对象 GET，ETag 和完整长度必须匹配。
计算节点不接收 R2 桶密钥、不访问 D1、不接受任意网站下载或跳转。
原件下载后在私有临时磁盘缓存；单页渲染随请求删除。

```json
{
  "input": {
    "documentId": "64位十六进制文档标识",
    "url": "由Mana后台生成的短时R2签名GET地址",
    "etag": "原件当前版本",
    "maxBytes": 12345,
    "page": 1,
    "direction": "vertical"
  }
}
```

`page=0` 返回页数和标题。每页一个任务，断点和去重应由 Mana 后台保存。
签名 URL 最长有效五分钟；排队过久要由后台重新签名，不能无限重试旧输入。

## 验收

构建该源码包：`node scripts/build-runpod.mjs`（在 Mana 项目根目录执行）。
项目内的 tests/runpod-ocr.mjs 验证共享算法来源、模型 SHA、单路/四路真实精细推理与顺序，并单独记录阻止正式上线的跨运行环境文字差异。
tests/runpod-handler.py 验证输入边界、对象版本/完整下载、缓存来源、错误输出和逐页封装。
验证结果只覆盖随包记录的样本，不代表所有书籍的准确率。
