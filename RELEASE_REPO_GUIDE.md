# AISCL 可发布仓库整理说明

当前工作目录承担了三类任务：

- 系统开发与调试
- UI smoke 与脚本验证
- 论文撰写相关的过程留档

这三类内容混在同一目录里，不适合直接作为 GitHub 部署仓库。更合理的做法是从当前目录导出一份“可发布版本”，只保留运行、构建、部署所需内容，再将该版本单独推送到 GitHub，并在云服务器上通过 `git pull` 更新。

## 1. 发布仓库应保留的内容

- `backend/`
- `frontend/`
- `nginx/`
- `shared/`
- `.github/`
- `.env.compose.server.example`
- `docker-compose.yml`
- `docker-compose.experiment.yml`
- `docker-compose.server.yml`
- `README.md`
- `DEPLOYMENT_GUIDE.md`
- `package.json`
- `package-lock.json`
- `scripts/prepare_release_repo.sh`

## 2. 发布仓库应排除的内容

- 本地依赖与构建产物
  - `node_modules/`
  - `frontend/node_modules/`
  - `frontend/dist/`
- 本地虚拟环境与缓存
  - `.venv-smoke/`
  - `.venv_smoke/`
  - `backend/.pytest_cache/`
  - `__pycache__/`
- 本地环境文件
  - `backend/.env`
  - `frontend/.env.local`
- 论文/过程留档目录
  - `Docs/`
- 本地 smoke/调试脚本
  - `scripts/ui_*`
  - `scripts/api_template_binding_smoke_run.py`
  - `backend/scripts/`
  - `backend/tests/`
  - `backend/test_*.py`
  - `backend/minimal_test.py`
  - `backend/fix_app.py`
  - `backend/create_test_users.py`
- 过程性总结文件
  - `OPTIMIZATION_SUMMARY.md`

## 3. 推荐发布流程

1. 在当前开发目录中完成代码修改。
2. 运行 `scripts/prepare_release_repo.sh <目标目录>` 导出一份可发布版本。
3. 在导出的目标目录中执行 Git 初始化、绑定 GitHub 远程仓库并推送。
4. 在云服务器上通过 `git clone` 首次部署。
5. 后续更新统一采用 `git pull && docker compose -f docker-compose.server.yml up -d --build`。

## 4. 推荐的仓库边界

建议将 GitHub 上的部署仓库独立为一个单独仓库，例如：

- `aiscl-platform`
- `aiscl-deploy`

不要直接把 `writing/` 工作区作为 Git 仓库根目录继续使用。当前 Git 顶层位于 `/Users/luoyuchen/Desktop/writing`，范围过大，会把论文材料与系统工程混在一起。

## 5. 当前结论

对当前项目，最稳妥的推进顺序是：

1. 先从现有目录导出一份“可发布仓库”
2. 再将该仓库推送 GitHub
3. 最后让云服务器只从 GitHub 拉取这份仓库

这样能把开发调试残留与线上部署边界彻底分开。
