# 长期稳定部署说明

本平台是纯静态站点，推荐部署到 GitHub Pages。部署后会得到类似下面的长期链接：

`https://你的GitHub用户名.github.io/仓库名/`

## 需要上传的文件

发布到静态托管时只需要这些内容：

- `index.html`
- `.nojekyll`
- `src/`
- `README.md`

不要上传：

- `logs/`
- `tools/cloudflared.exe`
- 临时隧道相关文件

## GitHub Pages 推荐配置

1. 新建一个 public repository，例如 `wind-risk-platform`。
2. 上传本目录中的 `index.html`、`.nojekyll`、`src/`、`README.md`。
3. 打开仓库 `Settings` -> `Pages`。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后等待 1 到 3 分钟。

完成后入口为：

`https://你的GitHub用户名.github.io/wind-risk-platform/`

## 自动部署需要的授权

如果要让我直接替你部署，需要你提供其中一种授权方式：

- GitHub：在本机安装并登录 GitHub CLI，或提供一个具有创建仓库权限的 GitHub token。
- Cloudflare Pages：提供 Cloudflare API token 和账户信息。
- Netlify/Vercel：提供对应服务的登录 token。
