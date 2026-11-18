# OJ Lab · 在线判题系统

前后端分离的 Online Judge 实现：用户登录 → 写代码 → 提交 → 逐测试点实时判题 → 排名统计。

- 前端：React 18 + TypeScript + Vite + Tailwind + CodeMirror 6
- 后端：Node.js + Express + TypeScript + SQLite（better-sqlite3）+ JWT
- 判题：独立队列 + 子进程沙箱（编译/运行、时间/内存/输出三重限制、逐点 SSE 推送）

## 快速开始

需要 Node.js 18+（开发机实测 22），本机已具备 gcc / g++ / javac / python / node。

```bash
# 1) 后端（端口 3001）
cd server
npm install
npm run seed        # 建表 + 5 道示例题 + admin/demo 账号（幂等）
npm run dev         # tsx watch 热重载

# 2) 前端（端口 5173，/api 已代理到 3001）
cd web
npm install
npm run dev
```

打开 http://localhost:5173

> 给别的电脑用？见 **[DEPLOY.md](./DEPLOY.md)**（局域网 / 云服务器 + 域名 HTTPS / Docker 三种方式，含安全红线说明）。

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 管理员 |
| demo | demo123 | 普通用户 |

> `npm run seed` 会以「不存在才插入」的方式补齐 `admin`（角色 admin），因此先 seed 再注册也不会出现「没有管理员」的死局；已有库缺管理员时重跑 seed 即可补上，日志会打印每个账号是新建还是已存在。
>
> 空库时首个注册的账号仍会自动成为管理员；登录 admin 后也可以在管理端改任意用户角色。

## 生产部署（单端口）

```bash
npm run install:all   # 装两端依赖
npm run build         # web 构建 + server 编译（前端产物由后端托管）
npm run seed          # 初始化题库（幂等）
npm run start         # 默认 0.0.0.0:3001，启动日志会打印局域网地址
```

访问 `http://<本机IP>:3001` 即可，前端路由（如 `/problems/5` 刷新）由后端回退到 `index.html`。
详细步骤、Nginx 配置（含 SSE 必须关 `proxy_buffering`）、systemd、Docker、备份升级、常见问题都在 **[DEPLOY.md](./DEPLOY.md)**。

## 支持语言

| 语言 | 编译/检查 | 运行 |
| --- | --- | --- |
| C | `gcc -O2 -std=c17` | `main.exe` |
| C++ | `g++ -O2 -std=c++17` | `main.exe` |
| Java | `javac -encoding UTF-8`（主类可任意命名，自动识别 `public class`） | `java -Xmx{limit}m -Dfile.encoding=UTF-8` |
| Python 3 | `python -m py_compile`（语法错误判 CE） | `python -X utf8` |
| Node.js | `node --check` | `node main.js` |

## 自测运行 vs 提交判题

| | 自测运行 `POST /api/run` | 提交判题 `POST /api/submissions` |
| --- | --- | --- |
| 输入 | 用户自己填 | 题库中的全部测试点 |
| 输出 | 程序原始 stdout/stderr | 逐测试点 AC/WA/TLE… |
| 是否入库 | 否，跑完即删临时目录 | 是，进提交记录与排行榜 |
| 限制 | 题目时间/内存限制、2 秒频控、64KB 输入、1MB 输出 | 同左 + 5 秒提交冷却 |

自测与判题共用 `judge/exec.ts` 的同一套编译与沙箱执行逻辑，所以「自测能过、提交判错」不会来自环境差异。

## 草稿箱的保存机制

1. **输入即写本地镜像** —— 每次改动同步写 `localStorage`（同步 API，关标签页也不会丢）
2. **700ms 防抖落库** —— 停止输入后 `PUT /api/files/:id`，工具栏显示「保存中… / 已保存 20:11:27」
3. **离开页面补存** —— `beforeunload` 用 `fetch(keepalive)` 再补一次
4. **重新打开** —— 先取服务端内容，若本地镜像的时间戳比 `updated_at` 新（说明上次没来得及落库），自动回填并补存

服务端限制：每人最多 200 个文件、单文件 128 KB、自测输入 64 KB。文件按用户隔离，别人的 id 直接返回 404。

## 自定义语言模板

- 入口：草稿箱右上角「模板设置」，按语言分别编辑，存服务端（`user_templates` 表，主键 `user_id + language`）
- 优先级：**用户自定义模板 > 系统内置模板**；新建文件、以及在草稿里切换语言（当前内容为空或仍是旧模板时）都会自动套用
- **题目页同样生效**：题目详情页编辑器的初始代码也优先用你的自定义模板，「重置模板」也回到你的模板而不是内置模板
- 优先级：自己改过的代码（本地缓存） > 用户自定义模板 > 系统内置模板；只有真正改过模板内容才写缓存，避免「旧的系统模板缓存」盖住后来新建的自定义模板
- 只影响初始内容，不会改动已有文件；每个账号每种语言各存一份，互不可见
- 「填入当前文件」把正在编辑的代码直接搬进模板编辑器，适合把常用的读入/输出骨架固化成模板
- 「恢复系统默认」删除自定义模板，回退到 `web/src/lib/templates.ts` 里的内置模板

## 判题流水线

```
提交 → 入库(PENDING) → 内存队列 → Worker
  → 落盘源码 → 编译/语法检查（失败=CE）
  → 预热执行（规避 Windows Defender 首次扫描导致误判 TLE）
  → 逐测试点运行：stdin 注入、stdout 捕获、超时/超内存/超输出强杀进程树
  → 输出比对（归一化行尾与行末空白）；题目配了 checker 时改由 checker 判定
  → 首个非 AC 即终止后续测试点
  → 逐点写库 + SSE 推送 → 汇总最终状态
```

状态码：`AC` `WA` `TLE` `MLE` `RE` `CE` `OLE`（输出超限）`SE`（系统错误）。

## 功能清单

- 认证：注册 / 登录 / JWT 续期校验；token 只用来确认身份，**角色一律回查数据库**（普通请求与匿名可选鉴权都如此），管理员被降权后旧 token 立即失效
- 题目：列表（搜索、难度筛选、标签筛选、收藏筛选、通过率、个人解题状态）、详情（Markdown 题面 + 样例 + 提示 + 标签）；未公开题目仅管理员可见
- **错因定位**：WA 时给出「第 X 行第 Y 列起不同」，样例额外展示期望/实际那一行；隐藏测试点只回行列、不回数据，避免反推测试内容
- **提交演进**：提交详情页可「与上次提交对比」，逐行 diff 高亮增删（手写 LCS，零依赖）；只能对比自己的提交，管理员可对比任意两条（后端校验）
- **标签与收藏**：标签自由文本（trim + 去重 + 上限 10 个），列表按标签筛选；题目可收藏，支持「只看收藏」
- **个人主页** `/u/:id`：解题数 / 提交数 / 通过率 / 状态分布 + 最近 26 周提交热力图 + 最近提交
- **深色模式**：顶栏一键切换，主题存 localStorage，首次跟随系统；CodeMirror 跟随切换
- 提交：CodeMirror 编辑器、5 种语言模板、草稿存本地、提交冷却
- **自测运行**：自定义标准输入 → 运行 → 右侧看程序输出（含 stderr、退出码、耗时、内存），不入提交记录、不影响通过率；`Ctrl+Enter` 运行、`Ctrl+Shift+Enter` 提交；可一键填充题面样例
- **草稿箱**：自建任意语言的代码文件，输入即自动保存（700ms 防抖）、关页面/换浏览器再打开仍是原样；支持新建/重命名/切换语言/删除/搜索，可直接运行调试；题目页可一键「存草稿」把当前代码带进草稿箱
- **自定义语言模板**：每种语言可保存一份自己的初始模板，之后新建该语言文件自动套用；支持「填入当前文件」快速把已写好的代码结构存为模板、一键恢复系统默认
- **特殊评测（SPJ）**：题目的 checker 与题目一起存（`checker_language` + `checker_code`），从 argv 拿 `input.txt / output.txt / answer.txt`，stdout 首行 `AC` 或退出码 0 视为通过；WA 时把 checker 的 stderr 截断后作为错因展示；checker 为空时完全走原来的行比对
- 判题结果：SSE 实时逐点结果（前端断线自动降级轮询），编译错误输出、样例差异提示；推送完成后服务端主动断流，并用 60 秒一次性 ticket 代替 URL 上的长期 token
- 历史：我的提交列表（按状态筛选）、提交详情（代码只对本人/管理员可见）
- 排名：通过题数榜（同分看提交次数）、通过率、最近提交时间
- **比赛**：`/contests` 列表与详情、报名、10 分钟倒计时、实时榜单（首次 AC + 20 分钟/次罚时）；封榜期间非管理员只看到「?」，结束或手动解封后自动公布；比赛进行中禁止查看他人提交详情；未开始的比赛不下发题目
- 管理端：题目 CRUD、标签编辑、测试点增删改（样例标记）、可见性、提交列表、任意提交重判、用户角色调整
- **批量重判**：按题目 / 状态 / 时间范围筛选，一次最多 500 条，必须勾选二次确认；只入队不阻塞接口，进度走 SSE（`/api/streams/batch/:id`）实时推送，断线可查状态接口
- 安全：Zod 入参校验、密码 bcrypt、参数化 SQL、管理端接口双重鉴权、代码长度/输出体积上限、测试点提交总量上限 8MB

## 目录结构

```
server/
  src/
    app.ts            路由挂载
    config.ts         环境变量与默认值
    db/               SQLite 连接与 schema.sql
    routes/           auth / problems / submissions / stats / admin
    judge/            languages（语言配置）/ runner（沙箱）/ comparator / index（队列与流程）
    seed/run.ts       示例题与账号（admin / demo，均幂等）
  scripts/smoke.mjs   判题端到端冒烟（建题 → 5 语言提交 → 校验状态）
  tests/              纯函数单测（node:test）
  judge-include/      C++ 万能头 shim（见下方说明）
web/
  src/
    api/              fetch 封装与类型
    context/          AuthContext / ThemeContext（深浅色）
    components/       Layout / StatusBadge / CodeEditor / CodeDiffView / SubmissionHeatmap / ResultPanel / SelfTestPanel / TemplateModal / ProtectedRoute
    pages/            列表 / 详情 / 草稿箱 / 提交 / 排名 / 个人主页 / 管理端
    lib/              format（状态与格式化）/ templates / diff（逐行 LCS）
  scripts/ui-check.mjs 用本机 Edge 跑一遍真实交互并截图
  scripts/ui-dark.mjs  逐页浅色/深色截图并校验深色生效
  tests/              前端格式化与 diff 单测（node:test + tsx）
.github/workflows/ci.yml  两端类型检查 + 单测
```

## 验证方式

```bash
npm run check                            # 两端 tsc --noEmit（CI 必跑）
npm run test:unit                        # 纯函数单测：输出比对 / Java 类名 / 前端格式化
cd server && node scripts/smoke.mjs      # 9 项断言：5 语言 AC + WA + TLE + CE + RE
cd web && node scripts/ui-check.mjs      # 登录→自测运行→提交→结果面板截图，收集控制台/HTTP 错误
cd web && node scripts/ui-drafts.mjs     # 草稿箱：新建→自动保存→刷新恢复→即时刷新兜底→运行→删除
cd web && node scripts/ui-templates.mjs  # 自定义模板：保存模板→新建文件自动套用→恢复默认
cd web && node scripts/ui-problem-template.mjs  # 题目页套用自定义模板 / 自己代码优先保留
cd web && node scripts/ui-dark.mjs       # 逐页浅色/深色截图，校验深色生效且无控制台/HTTP 错误
```

单元测试用 `node:test`，不引入测试框架；`ui-*.mjs` 依赖的 `playwright-core` 已在 `web/devDependencies` 中锁定版本，`npm ci` 后可直接运行。CI（`.github/workflows/ci.yml`）依次执行两端 `npm ci` → `tsc --noEmit` → 单测。

## API 速览

```
POST /api/auth/register|login        GET /api/auth/me
GET  /api/problems                  GET /api/problems/:id
POST /api/run                       # 自测运行（不落库）：{problemId?, language, code, input}
GET|POST /api/files                 # 草稿箱列表 / 新建
GET|PUT|DELETE /api/files/:id       # 打开 / 保存 / 删除
GET  /api/templates                 # 我的自定义语言模板
PUT|DELETE /api/templates/:language # 保存 / 恢复系统默认
POST /api/submissions               GET /api/submissions?mine=1&problemId=&status=
GET  /api/submissions/:id
GET  /api/submissions?userId=&beforeId=   # 提交对比定位相邻记录（userId 仅本人或管理员）
POST /api/submissions/:id/stream-ticket   # 换 60 秒一次性 SSE 票据
GET  /api/submissions/:id/stream?ticket=  # SSE（也兼容 Authorization 头）
GET  /api/problems/tags             # 标签云（含每标签题目数）
POST|DELETE /api/problems/:id/favorite    # 收藏 / 取消收藏
GET  /api/contests                  GET /api/contests/:id     # 比赛列表 / 详情（含题目）
POST|DELETE /api/contests/:id/register    # 报名 / 取消报名
GET  /api/contests/:id/standings    # 实时榜单（封榜时对非管理员隐藏结果）
GET  /api/stats/overview            GET /api/stats/leaderboard
GET  /api/stats/problems/:id        GET /api/stats/users/:id   # 个人主页（含 26 周热力图数据）
管理端（需 admin）
GET|POST /api/admin/problems        GET|PUT|DELETE /api/admin/problems/:id
GET|POST /api/admin/problems/:id/testcases
PUT|DELETE /api/admin/testcases/:tid
GET  /api/admin/submissions         POST /api/admin/submissions/:id/rejudge
POST /api/admin/submissions/rejudge-batch          # 批量重判（confirm=true，limit ≤ 500）
GET  /api/admin/submissions/rejudge-batch/:batchId # 进度查询
GET  /api/admin/users               PATCH /api/admin/users/:id/role
GET|POST /api/admin/contests        GET|PUT|DELETE /api/admin/contests/:id
PUT  /api/admin/contests/:id/problems              # 覆盖式挂题（A/B/C 编号）
POST /api/admin/contests/:id/unfreeze              # 手动解封
GET  /api/streams/batch/:id?ticket=                # 批量重判进度 SSE（一次性票据）
```

## 环境变量（server/.env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| PORT | 3001 | 服务端口 |
| JWT_SECRET | dev-only-secret-change-me | 生产必须替换 |
| DB_PATH | data/oj.db | SQLite 文件路径 |
| JUDGE_WORK_DIR | data/judge | 判题临时目录（跑完即删） |
| JUDGE_CONCURRENCY | 2 | 并发判题数 |
| SUBMIT_COOLDOWN_SEC | 5（本地 .env 设为 1） | 同一用户提交间隔 |
| RUN_COOLDOWN_MS | 2000 | 同一用户自测运行间隔（毫秒） |
| CORS_ORIGIN | http://localhost:5173 | 允许的前端来源 |

## 已知限制（重要）

1. **沙箱不是安全隔离。** 子进程 + 资源限制只能防「跑太久/吃太多内存」，挡不住恶意代码读文件、联网、fork 炸弹。仅适合本地教学/内部使用；用于公网必须换 Docker/gVisor/nsjail 等隔离方案（`judge/languages.ts` 与 `judge/runner.ts` 已抽象，替换成本可控）。
2. **内存是采样值，不是 cgroup 精确值。** Windows 无 cgroup，靠每 120ms 轮询 `tasklist` 的工作集，几十毫秒就跑完的 C/C++ 程序可能采不到，界面显示 `—`（鼠标悬停有说明）；MLE 判定对长时间运行的程序才准确。
3. **判题在 API 进程内。** 提交量上来会拖慢接口，生产应把 judge 拆成独立进程/服务，队列换成 Redis/BullMQ。
4. **C++ 万能头 shim。** 本机 MinGW 8.1 的 `<bits/stdc++.h>` 会引入残缺的 `<filesystem>`，C++17 下必然编译失败；`judge-include/bits/stdc++.h` 提供了跳过 `<filesystem>` 的等价头，判题时用 `-I` 优先命中。换用 GCC 9+ 后可直接删掉该目录。
5. **题面 HTML 未做 sanitize。** 题面仅管理员可写，若开放给普通用户出题，需要接入 DOMPurify。
6. **JWT 存 localStorage。** 简单直接，但存在 XSS 窃取风险；更高安全要求应改用 httpOnly Cookie + CSRF token。SSE 已经不再把 JWT 放 URL，改用 60 秒一次性 ticket。
7. **SSE ticket 存在进程内存。** 单实例部署没问题；若将来多副本负载均衡，票据需要放到 Redis 等共享存储，否则换票与建连可能落到不同进程。
8. **热力图按 UTC 日期聚合。** 与 `created_at` 的存储口径一致；北京时间凌晨 0–8 点的提交会算到前一天。
9. **代码 diff 有规模上限。** 单侧超过 1500 行时降级成「整段删除 + 整段新增」，不再做 LCS（DP 表太占内存），行号仍然正确。
10. **SPJ 的 stderr 会原样给学生看。** 这是「说清楚为什么错」的代价：checker 如果把标准答案写进 stderr，等于泄露测试点。写 checker 时要像写报错信息一样克制（只给误差数值或判定依据）。
11. **checker 与选手代码共用一个沙箱。** checker 同样没有真正的隔离，只适合本地教学环境。
12. **批量重判的进度存在进程内存。** 服务重启后批次记录消失（提交本身仍会继续判完）；单次上限 500 条，更大的量应该拆成多批或改用独立任务系统。

## 后续可做

- 比赛模式（限时、封榜、实时排名）
- 特殊评测（SPJ）、交互题、多文件提交
- 题单（把标签组合成学习路径）
- judge 服务化 + Docker 沙箱、判题机水平扩容
- 单元测试扩展到判题流程与路由层（当前覆盖纯函数 + 端到端冒烟）
