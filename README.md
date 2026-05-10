# 海上风电并网极端天气风险预警平台

这是根据桌面资料 `软件平台样例(1).docx`、`预警软件用户使用手册 - 南瑞修改(1).docx` 与 `参赛数据(1).zip` 重新搭建的静态 Web 平台原型。

## 打开方式

直接双击或用浏览器打开：

`C:\Users\Venuschen\Documents\New project\index.html`

平台不依赖外网、不需要安装前端依赖，数据已经写入 `src/data.js`。

## 页面结构

- 首页总览：左侧极端天气风险源，中间江苏近海地图、台风路径、30 节点拓扑，底部电网运行状态，右侧风险预警。
- 天气风险源：展示近期天气形势、风速气压、典型风电场运行数据。
- 运行状态详情：展示拓扑交互、节点/线路详情、越限统计、220kV 及以下节点列表。
- 风险评估：展示安全性指标、充裕性指标和自定义风险等级测定。
- 主动预警：展示风险曲线、预警时间轴、风险评分、历史准确率和累计准确率。

## 2026-05-10 修改完善

- 拓扑图重排为主线路走廊式布局，减少悬空节点和无意义交叉。
- 拓扑图新增电压等级配色和交叉点跨线桥提示，提升可读性。
- 台风路径滑块新增“固定2小时段 / 全时段”切换。
- 风险预警曲线默认使用固定两小时横轴，拖动台风路径时横坐标长度保持稳定。
- 删除首页右侧“85% 指标界面”入口，仅保留风险评估和主动预警入口。
- 主动预警曲线去掉原先含义不清的当前时刻虚线标记。

## 数据与计算

- 主时间轴采用 `综合风险评估结果.xlsx` 的 74 个 15 分钟采样点。
- 台风路径、风速、气压和风电功率来自 `台风数据.csv`。
- 负荷、风电注入、弃风、切负荷和 OPF 状态来自 `DC-OPF计算结果.csv`。
- 30 节点注入功率和 41 条线路潮流来自 `潮流计算结果.csv`。
- 风险曲线来自 `1.xlsx`、`2.xlsx`、`3.xlsx`、`4.xlsx` 与 `综合风险评估结果.xlsx`。
- 线路负载率、节点电压越限等运行统计由潮流结果派生，用于平台展示和拓扑着色。
- 风险等级阈值位于 `scripts/build_data.py` 的 `level_from_risk` 函数，可按比赛要求继续调整。

## 重新生成数据

如桌面 `参赛数据` 文件夹更新，可运行：

```powershell
& 'C:\Users\Venuschen\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'scripts\build_data.py'
```

若数据放在其他目录：

```powershell
$env:PLATFORM_SOURCE_DIR='D:\your\data\folder'
& 'C:\Users\Venuschen\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'scripts\build_data.py'
```
