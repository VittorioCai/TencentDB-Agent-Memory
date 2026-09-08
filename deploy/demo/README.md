# 演示实例

一台公网机器上跑起来的产品 + 交付文档，给评阅人点开看用的。

**它不是证据来源。** 交付的数字以仓库中的冻结基线（`evaluation/gate/artifacts/gate_baseline_batch3.json`）和十次运行的原始记录（`evaluation/runner/runs/`）为准。这台机器上的状态可以被访问者改动，改乱了一条命令还原。

## 它包含什么

| 端口 | 内容 |
|---|---|
| `80` | 总览页 + 渲染好的交付文档（第三批对照、闸门设计、作者证据链、执行计划） |
| `8125` | Panel，审核队列在 `#/review` |

两个端口都有 HTTP Basic Auth，用户名 `demo`。

**不包含**评测 harness（代理探针、ClickHouse）。那些只在**跑**批次时需要；这台机器是用来看结果的，不是用来产出结果的。

## 为什么要挂载源码

`agentmemory/memory-core` 和 `memory-hub` 是公开镜像，里面**没有**闸门。闸门在本分支的 `MemoryCore/src/metadata` 和六个网关/核心文件里，按 `eval-core.sh` 在本地的同样方式挂载上去。所以上传包里带着这些源码，以及 Panel 的构建产物（它被 gitignore，不在仓库里）。

## 部署

在**本机**打包：

```bash
# Panel 必须先构建过
(cd MemoryPanel && npm run build) && (cd MemoryPanel/web && npm run build)
bash deploy/demo/pack.sh
```

传到主机并启动（Linux + Docker）：

```bash
scp /private/tmp/claude-501/demo-bundle.tar.gz root@<IP>:/root/
ssh root@<IP>
mkdir -p /opt/topic4 && tar xzf /root/demo-bundle.tar.gz -C /opt/topic4
cd /opt/topic4 && DEMO_PASSWORD='<一次性口令>' ./up.sh
```

主机要求：**Linux**（Ubuntu 22.04 / Debian 12），2C2G 够用，装了 Docker。Windows 不行——镜像是 linux/amd64，Windows 容器和 Linux 容器不通用。

## 还原

访问者可以随便点：准入、拒绝、逐条推翻纠错。点乱了：

```bash
cd /opt/topic4 && ./reset.sh
```

整个 metadata 存储从部署时的副本还原——复核记录、状态、评估全部回到初始，约十秒。不做外科手术式的局部修改，那本身可能出错。

## 重新部署

上传新包后再跑一次 `./up.sh`。默认**不动**已有数据（可能有人正在看）；要连数据一起刷新：

```bash
RESEED=1 DEMO_PASSWORD='<口令>' ./up.sh
```

## 安全边界

- 地址是公网的，Panel 里是真实团队数据，所以整站加了口令
- 纯 HTTP 下 Basic Auth 的口令**明文传输**。用一次性口令，不要复用
- 大陆服务器用域名必须备案（1–3 周），所以直接用 `http://IP`，不配域名和 HTTPS
- 上传的是**演示副本**，与本地开发环境的数据是两份
