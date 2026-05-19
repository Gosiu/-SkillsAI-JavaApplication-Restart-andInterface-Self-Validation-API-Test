---
name: "dev-token-test"
description: "Dev environment Token and API testing tool. Automatically reads module config from app-restarter/config.json. Can fetch tokens, test any API endpoint, auto-read error logs on failures, and generate md test reports. Batch test files must be in batch-tests directory. Reports are limited to 10 most recent."
---

# Dev Token Test v3.5.0

开发环境Token获取与通用接口测试工具 - 自动从 app-restarter/config.json 读取配置，支持多模块多端口测试。

## 核心功能

1. **自动配置同步** - 从 app-restarter/config.json 读取模块配置
2. **Token自动获取** - 自动获取 System/App 模块的测试 Token
3. **Token缓存** - 获取的Token自动缓存，支持快速复用
4. **通用接口测试** - 使用获取的Token测试任意接口
5. **批量测试支持** - 支持通过 JSON 配置文件批量测试多个接口
6. **错误日志读取** - 接口报错时自动读取应用日志获取详细错误信息
7. **测试报告生成** - 自动生成 md 格式的测试报告，保留最近10个

## 重要变更 (v3.5.0)

### 1. 批量测试文件强制限制
- **所有批量测试配置文件必须放在 `batch-tests/` 目录中**
- 使用 `--batch-test <文件名>` 时，只需提供文件名，无需路径
- 脚本会自动检查文件是否在 `batch-tests` 目录内，防止路径遍历攻击

### 2. 测试报告管理
- **最多保留 10 个最近的测试报告**
- 旧报告会自动清理
- 每个报告文件开头会添加索引注释，显示生成时间和新旧程度
- 测试完成后会显示历史报告列表

### 3. 简化的命令参数
- 移除了复杂且不常用的参数组合
- 统一使用 `--batch-test <文件名>` 进行批量测试

## 快速开始

```bash
# 列出所有已配置的模块
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --list

# 列出 batch-tests 目录中的测试配置文件
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --list-batch

# 测试 Token 获取流程（默认测试所有模块）
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --module app

# 使用 App Token 测试单个接口
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --test GET /app/match/info

# 批量测试（配置文件必须在 batch-tests 目录中）
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --batch-test order-tests.json

# POST 请求带 Body
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --test POST /app/order/create --body '{"tid":"541735"}'

# 禁用测试报告生成
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --test GET /app/match/info --no-report
```

## 命令行参数

### 通用选项

| 参数 | 说明 |
|------|------|
| `--list` | 列出所有已配置的模块 |
| `--list-batch` | 列出 batch-tests 目录中的测试配置文件 |
| `--module <名称>` | 测试指定模块的Token获取流程 |
| `--test <方法> <路径>` | 测试指定接口 (如: GET /app/match/info) |
| `--batch-test <文件名>` | 批量测试，**文件必须在 batch-tests 目录中** |
| `--header <key:value>` | 添加请求头 (可多次使用) |
| `--body <json>` | 请求体 (JSON格式) |
| `--token-type <type>` | 使用哪种Token: `system` 或 `app` (默认: app) |
| `--no-report` | 禁用测试报告生成 |
| `--help, -h` | 显示帮助信息 |

## 批量测试配置

### 配置文件位置

**所有批量测试配置文件必须放在 `batch-tests/` 目录中！**

目录结构：
```
dev-token-test/
├── batch-tests/          # 批量测试配置文件目录
│   ├── order-tests.json
│   └── payment-tests.json
├── reports/              # 测试报告输出目录
└── scripts/
    └── test-dev-token.js
```

### 配置文件格式

创建 `batch-tests/order-tests.json`：

```json
[
  {
    "method": "POST",
    "path": "/app/order/create",
    "body": {
      "tid": "541735",
      "tnum": "1",
      "playtime": "2026-04-12",
      "ordertel": "17362605285:86",
      "ordername": "葛佳航",
      "personid": "420802200012030030",
      "zoneId": "5085",
      "seatId": "775410",
      "tidX": "114120"
    },
    "description": "创建订单-单人"
  },
  {
    "method": "POST",
    "path": "/app/order/create",
    "body": {
      "tid": "541735",
      "tnum": "4",
      "playtime": "2026-04-12",
      "ordertel": "17362605285:86",
      "ordername": "葛佳航,蔡明晔,李梦,刘强",
      "personid": "420802200012030030,410105197302022738,420822199110203126,420624199202242212",
      "zoneId": "5085",
      "seatId": "775410,775411,775412,775413",
      "tidX": "114120"
    },
    "description": "创建订单-多人"
  }
]
```

### 运行批量测试

```bash
# 使用 batch-tests/order-tests.json 进行批量测试
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --batch-test order-tests.json
```

**注意**：
- 只需提供文件名，不要提供路径
- 脚本会自动在 `batch-tests/` 目录中查找
- 测试完成后配置文件会被清空（`[]`）

## 测试报告

### 报告位置

测试报告生成在 `reports/` 目录中，格式为 `.md` 文件。

### 报告管理

- **最多保留 10 个最近的报告**
- 旧报告会自动删除
- 每个报告文件开头包含索引注释：
  ```markdown
  <!-- 报告索引: 1/5 | 生成时间: 2026/4/9 10:30:00 | 刚刚 -->
  ```

### 查看历史报告

测试完成后会显示历史报告列表：
```
历史报告 (5个):
  1. summary-report-2026-04-09T02-30-00-000Z.md (刚刚)
  2. summary-report-2026-04-09T02-25-00-000Z.md (5分钟前)
  3. summary-report-2026-04-09T02-20-00-000Z.md (10分钟前)
  4. summary-report-2026-04-09T01-00-00-000Z.md (1小时前)
  5. summary-report-2026-04-08T10-00-00-000Z.md (1天前)
```

## 接口请求与响应格式（JSON5 with Comments）

本工具生成的测试报告使用 **JSON5 格式**，支持在字段后添加注释说明。

### GET 请求示例

**请求信息**：
```json5
{
  // 请求方法
  method: "GET",
  // 请求路径
  path: "/app/match/info",
  // 认证Token (如有)
  token: "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**响应格式**：
```json5
{
  // 响应状态码
  code: 200,
  // 响应消息
  msg: "操作成功",
  // 响应数据体
  data: {
    mainImage: "http://pft-scenic.12301.cc/material_bank/1775548272895.png",  // 主图地址
    matchName: "足球门票0407楚超票名称",  // 赛事/产品名称
    venueName: "楚超",  // 场馆名称
    venueAddress: "荆门市",  // 场馆地址
    latitude: 31.058700183973233,  // 纬度 (百度坐标)
    longitude: 112.21262084250016,  // 经度 (百度坐标)
    priceRange: 9.9,  // 价格范围 (单位: 元)
    matchDetails: "【演出简介】123123【著名导演】123123",  // 演出介绍
    bookingNotes: "【发票说明】123【温馨提示】123【联系电话】123",  // 预订须知
    status: 1  // 状态 (1-正常)
  }
}
```

## 完整操作示例

### 1. 创建批量测试配置文件

创建文件 `batch-tests/order-api-tests.json`：

```json
[
  {
    "method": "GET",
    "path": "/app/match/info",
    "description": "获取赛事信息"
  },
  {
    "method": "POST",
    "path": "/app/order/create",
    "body": {
      "tid": "541735",
      "tnum": "1",
      "playtime": "2026-04-12",
      "ordertel": "17362605285:86",
      "ordername": "葛佳航",
      "personid": "420802200012030030",
      "zoneId": "5085",
      "seatId": "775410",
      "tidX": "114120"
    },
    "description": "创建订单-单人"
  }
]
```

### 2. 运行批量测试

```bash
node .\.trae\skills\dev-token-test\scripts\test-dev-token.js --batch-test order-api-tests.json
```

### 3. 查看测试报告

测试完成后会输出报告路径：
```
完整测试报告: D:\project\楚超足球\.trae\skills\dev-token-test\reports\summary-report-2026-04-09T02-30-00-000Z.md

历史报告 (3个):
  1. summary-report-2026-04-09T02-30-00-000Z.md (刚刚)
  2. summary-report-2026-04-09T02-25-00-000Z.md (5分钟前)
  3. summary-report-2026-04-09T02-20-00-000Z.md (10分钟前)
```

## 注意事项

1. **批量测试文件位置**：所有批量测试配置文件**必须**放在 `batch-tests/` 目录中
2. **报告数量限制**：最多保留 10 个最近的测试报告，旧报告会自动删除
3. **Token缓存**：获取的 Token 会被缓存到 `app-restarter/token-cache.json`，避免重复获取
4. **配置文件清理**：批量测试完成后，配置文件会被清空（设置为 `[]`）
5. **路径安全**：脚本会检查文件路径，防止路径遍历攻击

## 故障排查

| 错误现象 | 可能原因 | 解决方法 |
|---------|---------|---------|
| 找不到批量测试文件 | 文件不在 batch-tests 目录 | 将文件移动到 batch-tests/ 目录 |
| 报告文件太多 | 超过10个报告 | 脚本会自动清理旧报告 |
| Token 失效 | Token过期 | 删除 token-cache.json 重新获取 |
| 404 Not Found | 应用未启动或路径错误 | 检查应用状态和接口路径 |
| 401 Unauthorized | Token无效 | 检查认证逻辑和token-type参数 |
