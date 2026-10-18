# maze

一个可部署到 Cloudflare Workers 的纯静态 WebGL 无尽迷宫。它使用程序化、确定性区块生成，因此玩家移动时会持续扩展世界，同时只保留附近区块以控制内存。

## 本地运行

```bash
npm install
npm run dev
```

## 部署到 Cloudflare Workers

首次部署前登录 Cloudflare：

```bash
npx wrangler login
npm run deploy
```

Cloudflare 会提供 `项目名.workers.dev` 域名；如需绑定自己的 `.dev` 域名，可在 Cloudflare Workers 项目的 **Settings > Domains & Routes** 中添加该域名。

## 控制方式

- **手机**：点击“启用遥感”授权设备方向；拖动左下角摇杆移动。
- **电脑**：鼠标拖动视角；`WASD` 或方向键移动。

> iOS 要求从 HTTPS 页面上的用户点击事件触发方向传感器授权。Cloudflare Workers 的默认域名满足该条件。
