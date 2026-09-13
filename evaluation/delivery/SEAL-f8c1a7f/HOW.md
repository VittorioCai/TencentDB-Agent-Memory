# 这份归档是怎么来的

**从远端重新克隆封版提交**后跑的验收,不是本机工作树:

```bash
git clone --branch topic4-attribution-gate --single-branch <fork> /tmp/seal
cd /tmp/seal
REJUDGE_DIR=/tmp/rejudge-seal-final RUN_RECORDS_ROOT=/tmp/runs-seal bash evaluation/deliver-check.sh
```

克隆环境:**无作者密钥**(`deploy/global-images/` 被 gitignore,克隆里 0 个密钥文件)、**无 Core**、**无 docker**;
`REJUDGE_DIR` 指向全新目录,强制从已烧毁值登记簿重算 14 份重判副本。

`rows.jsonl` 是这次跑出来的逐步记录,`evaluation/SEAL-CHECK.md` 由 `evaluation/seal-record.mjs` 从它生成。
