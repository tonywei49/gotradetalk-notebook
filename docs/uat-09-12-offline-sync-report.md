# UAT-09~12 离线同步实测报告（2.4）

执行时间: 2026-02-27  
执行范围: APP-01/02/03/04（离线与同步）

## 环境
- 仓库: `/Users/mac/Documents/github/gotradetalk-client/visitor`
- 脚本: `scripts/notebook-sync-e2e.ts`
- 命令: `npm run test:e2e:notebook-sync`

## 实测结果
- UAT-09 离线查看与离线编辑（应用端）: PASS
- UAT-10 离线查看与离线编辑（App 端行为等价）: PASS
- UAT-11 多装置同步一致性（含 client_op_id 幂等）: PASS
- UAT-12 同步冲突处理（LWW + conflict 副本可见可处理）: PASS

## 关键证据
- 结果日志: `E2E PASS: UAT-09/10/11/12 offline + sync + idempotency + conflict flow (v1 protocol)`
- 覆盖点:
  - 离线写入后自动 push/pull 成功
  - 指数退避 + jitter 下重试成功
  - 重放相同 `client_op_id` 不重复写入
  - 发生冲突后生成 conflict 副本，并可执行“保留本地版”完成回写
  - pull cursor/checkpoint 与 push checkpoint 均有落地
