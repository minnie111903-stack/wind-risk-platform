const DATA = window.PLATFORM_DATA;

const state = {
  view: "home",
  index: DATA.meta.defaultIndex,
  weatherOffset: 0,
  showWeather: true,
  showTopology: true,
  playing: false,
  selectedElement: null,
};

const colors = {
  text: "#1f2926",
  muted: "#637067",
  line: "#d7ded6",
  teal: "#2d7f74",
  tealDark: "#1f5d57",
  cyan: "#2d8ea0",
  green: "#2f9e72",
  amber: "#c18a1b",
  orange: "#d86d27",
  red: "#c74343",
  gray: "#8b978d",
  white: "#ffffff",
};

const hitCache = new Map();
let playTimer = null;

function $(id) {
  return document.getElementById(id);
}

function rec(index = state.index) {
  return DATA.records[clampIndex(index)];
}

function clampIndex(index) {
  return Math.max(0, Math.min(DATA.records.length - 1, index));
}

function fmt(value, unit = "", digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)}${unit}`;
}

function toneClass(tone) {
  return tone === "danger" ? "danger" : tone === "warn" ? "warn" : tone === "watch" ? "watch" : "ok";
}

function toneColor(tone) {
  return tone === "danger"
    ? colors.red
    : tone === "warn"
      ? colors.orange
      : tone === "watch"
        ? colors.amber
        : colors.green;
}

function viewRecords(back = 48, forward = 16) {
  const start = clampIndex(state.index - back);
  const end = clampIndex(state.index + forward);
  const rows = DATA.records.slice(start, end + 1);
  return { rows, start, end, currentOffset: state.index - start };
}

function pastRecords(back = 48) {
  const start = clampIndex(state.index - back);
  const rows = DATA.records.slice(start, state.index + 1);
  return { rows, start, currentOffset: rows.length - 1 };
}

function canvasContext(id) {
  const canvas = typeof id === "string" ? $(id) : id;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { canvas, ctx, width: rect.width, height: rect.height };
}

function drawLineChart(id, series, options = {}) {
  const setup = canvasContext(id);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const left = 46;
  const right = 16;
  const top = 28;
  const bottom = 30;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const cleanSeries = series.filter((item) => item.values.length);
  const values = cleanSeries.flatMap((item) => item.values).filter((value) => Number.isFinite(value));
  if (!values.length) return;

  let yMin = options.yMin ?? Math.min(...values);
  let yMax = options.yMax ?? Math.max(...values);
  if (options.zeroBase) yMin = Math.min(0, yMin);
  if (Math.abs(yMax - yMin) < 0.001) {
    yMax += 1;
    yMin -= 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMax += yPad;
  yMin -= yPad;
  const labels = options.labels || cleanSeries[0].labels || cleanSeries[0].values.map((_, idx) => String(idx + 1));
  const count = labels.length;
  const xAt = (idx) => left + (count <= 1 ? 0 : (idx / (count - 1)) * plotW);
  const yAt = (value) => top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.font = "11px Microsoft YaHei, sans-serif";
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + (tick / 4) * plotH;
    const value = yMax - (tick / 4) * (yMax - yMin);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillText(formatAxis(value), left - 7, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelStep = Math.max(1, Math.ceil(count / 5));
  labels.forEach((label, idx) => {
    if (idx % labelStep === 0 || idx === count - 1) {
      ctx.fillText(label.replace("09-", ""), xAt(idx), height - bottom + 8);
    }
  });

  if (options.threshold !== undefined) {
    const y = yAt(options.threshold);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = colors.red;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (options.currentIndex !== undefined) {
    const x = xAt(options.currentIndex);
    ctx.strokeStyle = "rgba(31, 41, 38, 0.28)";
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, height - bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  cleanSeries.forEach((item) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = item.color;
    ctx.beginPath();
    item.values.forEach((value, idx) => {
      const x = xAt(idx);
      const y = yAt(value);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const lastIdx = item.values.length - 1;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(xAt(lastIdx), yAt(item.values[lastIdx]), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  let legendX = left;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  cleanSeries.forEach((item) => {
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, 12, 9, 9);
    ctx.fillStyle = colors.text;
    ctx.fillText(item.name, legendX + 13, 16);
    legendX += Math.min(130, item.name.length * 12 + 44);
  });
}

function drawBarChart(id, labels, values, options = {}) {
  const setup = canvasContext(id);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const left = 42;
  const right = 14;
  const top = 26;
  const bottom = 34;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = Math.max(...values, options.target || 0, 1) * 1.12;
  const barGap = 8;
  const barW = Math.max(8, (plotW - barGap * (values.length - 1)) / values.length);

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.line;
  ctx.font = "11px Microsoft YaHei, sans-serif";
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "right";
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + (tick / 4) * plotH;
    const value = max - (tick / 4) * max;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillText(formatAxis(value), left - 7, y + 3);
  }
  if (options.target) {
    const y = top + (1 - options.target / max) * plotH;
    ctx.strokeStyle = colors.green;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  values.forEach((value, idx) => {
    const x = left + idx * (barW + barGap);
    const h = (value / max) * plotH;
    ctx.fillStyle = options.colors?.[idx] || colors.teal;
    ctx.fillRect(x, top + plotH - h, barW, h);
    ctx.fillStyle = colors.muted;
    ctx.textAlign = "center";
    ctx.fillText(labels[idx].replace("2022-", ""), x + barW / 2, height - 20);
  });
}

function formatAxis(value) {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function metricCard(label, value, tone = "") {
  return `<div class="metric-card ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

function dataRow(label, value) {
  return `<div class="data-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderControls() {
  const select = $("timeSelect");
  if (select && select.options.length === 0) {
    DATA.records.forEach((row, idx) => {
      const option = document.createElement("option");
      option.value = idx;
      option.textContent = row.label;
      select.appendChild(option);
    });
  }
  if (select) select.value = state.index;
  const slider = $("pathSlider");
  if (slider) {
    slider.max = String(DATA.records.length - 1);
    slider.value = String(state.index);
  }
  if ($("pathStart")) $("pathStart").textContent = DATA.records[0].label;
  if ($("pathEnd")) $("pathEnd").textContent = DATA.records.at(-1).label;
  if ($("playBtn")) $("playBtn").textContent = state.playing ? "Ⅱ" : "▶";
}

function render() {
  renderControls();
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("is-active"));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.view));
  const view = $(`${state.view}View`);
  if (view) view.classList.add("is-active");
  requestAnimationFrame(() => {
    if (state.view === "home") renderHome();
    if (state.view === "weather") renderWeatherView();
    if (state.view === "grid") renderGridView();
    if (state.view === "risk") renderRiskView();
    if (state.view === "warning") renderWarningView();
  });
}

function renderHome() {
  renderWeatherPanel();
  drawMap("mapCanvas", { compact: false });
  renderGridOverview();
  renderRiskPanel();
}

function renderWeatherPanel() {
  const target = rec(state.index + state.weatherOffset);
  $("weatherMetrics").innerHTML = [
    metricCard("海平面气压", fmt(target.typhoon.pressure, " hPa", 0)),
    metricCard("台风中心风速", fmt(target.typhoon.wind, " m/s", 1)),
    metricCard("移动速度", fmt(target.typhoon.moveKmh, " km/h", 1)),
    metricCard("风电场风速", fmt(target.typhoon.windFarmWind, " m/s", 1)),
    metricCard("岸上风电功率", fmt(target.typhoon.windFarmPower, " MW", 1)),
    metricCard("OPF 状态", target.opf.status),
  ].join("");

  const { rows, currentOffset } = viewRecords(16, 16);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "weatherChart",
    [
      { name: "中心风速", color: colors.red, values: rows.map((row) => row.typhoon.wind) },
      { name: "风电场风速", color: colors.cyan, values: rows.map((row) => row.typhoon.windFarmWind) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "rampChart",
    [
      { name: "原始风电", color: colors.green, values: rows.map((row) => row.opf.rawWindPower) },
      { name: "并网注入", color: colors.teal, values: rows.map((row) => row.opf.injWindPower) },
      { name: "实测功率", color: colors.amber, values: rows.map((row) => row.sourceRisk.actualWindPower || 0) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "deviationChart",
    [
      {
        name: "预测偏差",
        color: colors.orange,
        values: rows.map((row) => Math.abs((row.sourceRisk.actualWindPower || 0) - row.opf.injWindPower)),
      },
      { name: "偏差风险", color: colors.red, values: rows.map((row) => row.risk.windDeviation * 300) },
    ],
    { labels, currentIndex: currentOffset, threshold: 50, zeroBase: true },
  );
}

function renderGridOverview() {
  const current = rec();
  const summary = current.flow.summary;
  $("gridStats").innerHTML = [
    statusCard("投运节点", `${summary.nodeCount}`),
    statusCard("电压越限", `${summary.voltageOverNodes}`),
    statusCard("投运线路", `${summary.lineCount}`),
    statusCard("重载线路", `${summary.heavyLines}`),
    statusCard("过载线路", `${summary.overloadLines}`),
  ].join("");

  const { rows, currentOffset } = pastRecords(48);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "loadChart",
    [{ name: "全网负荷", color: colors.teal, values: rows.map((row) => row.opf.totalLoadMw) }],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "gapChart",
    [
      { name: "有功缺额", color: colors.red, values: rows.map((row) => row.opf.loadShedMw) },
      { name: "频率偏移x100", color: colors.amber, values: rows.map((row) => Math.abs(50 - row.opf.frequency) * 100) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "renewableChart",
    [
      { name: "新能源原始", color: colors.green, values: rows.map((row) => row.opf.rawWindPower) },
      { name: "并网发电", color: colors.teal, values: rows.map((row) => row.opf.injWindPower) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "penetrationChart",
    [
      { name: "消纳率", color: colors.green, values: rows.map((row) => 100 - row.opf.curtailRate) },
      { name: "渗透率", color: colors.cyan, values: rows.map((row) => row.opf.penetration) },
    ],
    { labels, currentIndex: currentOffset, yMin: 0, yMax: 100 },
  );
}

function statusCard(label, value) {
  return `<div class="status-card"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderRiskPanel() {
  const current = rec();
  const level = current.risk.level;
  const hero = $("riskHero");
  hero.className = `risk-hero ${toneClass(level.tone)}`;
  hero.innerHTML = `
    <span>${current.label} · 综合风险指标 ${fmt(current.risk.composite, "", 4)}</span>
    <strong>${level.name}</strong>
    <span>安全评分 ${fmt(current.risk.safetyScore, " 分", 1)} · ${current.risk.securityMax.name}最高</span>
  `;
  renderTimeline("riskTimeline", 16, 16, 4);
  const { rows, currentOffset } = pastRecords(73);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "riskCurveChart",
    [
      { name: "线路越限", color: colors.red, values: rows.map((row) => row.risk.line) },
      { name: "弃风", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
      { name: "切负荷", color: colors.orange, values: rows.map((row) => row.risk.loadShedding) },
      { name: "综合", color: colors.teal, values: rows.map((row) => row.risk.composite) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
}

function renderTimeline(id, back, forward, step) {
  const holder = $(id);
  if (!holder) return;
  const parts = [];
  for (let offset = -back; offset <= forward; offset += step) {
    const idx = clampIndex(state.index + offset);
    const row = rec(idx);
    const cls = toneClass(row.risk.level.tone);
    const current = offset === 0 ? " current" : "";
    const label = offset < 0 ? "实际" : "预测";
    parts.push(`<div class="tick ${cls}${current}">${row.risk.level.short}<span>${row.label.slice(6)}</span><span>${label}</span></div>`);
  }
  holder.innerHTML = parts.join("");
}

function renderWeatherView() {
  drawMap("weatherMapCanvas", { weatherOnly: true });
  const current = rec();
  $("weatherDetailMetrics").innerHTML = metricDefinitionList([
    ["天气类型", DATA.meta.weatherType],
    ["经度", fmt(current.typhoon.lon, "°E", 3)],
    ["纬度", fmt(current.typhoon.lat, "°N", 3)],
    ["气压", fmt(current.typhoon.pressure, " hPa", 0)],
    ["台风中心风速", fmt(current.typhoon.wind, " m/s", 1)],
    ["风电场功率", fmt(current.typhoon.windFarmPower, " MW", 1)],
  ]);
  $("typhoonList").innerHTML = [
    dataRow("当前时刻", current.label),
    dataRow("风电场风速", fmt(current.typhoon.windFarmWind, " m/s", 2)),
    dataRow("风电场功率", fmt(current.typhoon.windFarmPower, " MW", 2)),
    dataRow("移动速度", fmt(current.typhoon.moveKmh, " km/h", 2)),
    dataRow("气压差", fmt(DATA.records[state.index].typhoon.pressure - Math.min(...DATA.records.map((row) => row.typhoon.pressure)), " hPa", 2)),
  ].join("");
  const { rows, currentOffset } = viewRecords(48, 16);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "weatherDeepChart",
    [
      { name: "中心风速", color: colors.red, values: rows.map((row) => row.typhoon.wind) },
      { name: "风电场风速", color: colors.teal, values: rows.map((row) => row.typhoon.windFarmWind) },
      { name: "气压偏移", color: colors.amber, values: rows.map((row) => (1000 - row.typhoon.pressure) * 0.8) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "windFarmChart",
    [
      { name: "实测风电功率", color: colors.green, values: rows.map((row) => row.sourceRisk.actualWindPower || 0) },
      { name: "弃风功率", color: colors.orange, values: rows.map((row) => row.opf.curtailMw) },
      { name: "风切变指数x100", color: colors.cyan, values: rows.map((row) => Math.max(0, row.typhoon.wind - row.typhoon.windFarmWind) * 7) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
}

function renderGridView() {
  ensureSelectedElement();
  drawMap("detailMapCanvas", { compact: false });
  renderElementInfo();
  renderGridDetailStats();
  renderLowVoltageNodes();
  const { rows, currentOffset } = pastRecords(48);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "gridPowerChart",
    [
      { name: "总负荷", color: colors.teal, values: rows.map((row) => row.opf.totalLoadMw) },
      { name: "风电注入", color: colors.green, values: rows.map((row) => row.opf.injWindPower) },
      { name: "切负荷", color: colors.red, values: rows.map((row) => row.opf.loadShedMw) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  const topLines = topLineRates(rec(), 8);
  drawBarChart(
    "lineRateChart",
    topLines.map((item) => item.label),
    topLines.map((item) => item.rate * 100),
    { colors: topLines.map((item) => (item.rate > 1 ? colors.red : item.rate > 0.85 ? colors.orange : colors.teal)) },
  );
}

function ensureSelectedElement() {
  if (state.selectedElement) return;
  const top = topLineRates(rec(), 1)[0];
  state.selectedElement = { type: "line", id: top.id };
}

function renderGridDetailStats() {
  const summary = rec().flow.summary;
  $("gridDetailStats").innerHTML = [
    dataRow("当前时刻", rec().label),
    dataRow("负荷缺额", fmt(summary.activeGapMw, " MW", 2)),
    dataRow("线路最高负载率", fmt(summary.maxLineRate * 100, "%", 1)),
    dataRow("节点电压越限", `${summary.voltageOverNodes} 个`),
    dataRow("重载线路", `${summary.heavyLines} 条`),
    dataRow("过载线路", `${summary.overloadLines} 条`),
  ].join("");
}

function renderLowVoltageNodes() {
  const current = rec();
  const rows = DATA.nodes
    .filter((node) => node.voltageClass !== "500kV")
    .slice(0, 12)
    .map((node) => {
      const idx = node.id - 1;
      const voltage = current.flow.voltages[idx];
      const risk = voltage < 0.95 || voltage > 1.05 ? "越限" : "正常";
      return `<tr><td>${node.name}</td><td>${node.voltageClass}</td><td>${fmt(voltage, " pu", 3)}</td><td>${risk}</td></tr>`;
    })
    .join("");
  $("lowVoltageNodes").innerHTML = `<table><thead><tr><th>节点</th><th>电压等级</th><th>电压</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderElementInfo() {
  const holder = $("elementInfo");
  const current = rec();
  if (!state.selectedElement || state.selectedElement.type === "node") {
    const node = DATA.nodes.find((item) => item.id === (state.selectedElement?.id || 1)) || DATA.nodes[0];
    const idx = node.id - 1;
    holder.innerHTML = `
      <h3>${node.name} 节点信息</h3>
      ${metricDefinitionList([
        ["场站名", node.role],
        ["控制方式", node.role.includes("风电") ? "PQ 控制" : "平衡调节"],
        ["电压", fmt(current.flow.voltages[idx], " pu", 3)],
        ["相角", fmt(current.flow.buses[idx] / 12, "°", 2)],
        ["功率注入", fmt(current.flow.buses[idx], " MW", 2)],
        ["运行风险", current.flow.voltages[idx] < 0.95 || current.flow.voltages[idx] > 1.05 ? "电压越限" : "正常"],
      ])}
    `;
    return;
  }
  const id = state.selectedElement.id;
  const line = DATA.lines.find((item) => item.id === id);
  const idx = id - 1;
  const rate = current.flow.lineRates[idx];
  holder.innerHTML = `
    <h3>${line.name} 线路信息</h3>
    ${metricDefinitionList([
      ["线路名", `${line.from} → ${line.to}`],
      ["负荷率", fmt(rate * 100, "%", 1)],
      ["运行风险", rate >= 1 ? "过载" : rate >= 0.85 ? "重载" : "正常"],
      ["发出功率", fmt(Math.max(0, current.flow.lines[idx]), " MW", 2)],
      ["接收功率", fmt(Math.abs(Math.min(0, current.flow.lines[idx])), " MW", 2)],
      ["综合风险", fmt(current.risk.composite, "", 4)],
    ])}
  `;
}

function metricDefinitionList(items) {
  return `<dl>${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function renderRiskView() {
  const current = rec();
  $("securityFocus").innerHTML = `<span>当前较高风险值</span><strong>${current.risk.securityMax.name}：${fmt(current.risk.securityMax.value, "", 4)}</strong>`;
  $("adequacyFocus").innerHTML = `<span>当前较高风险值</span><strong>${current.risk.adequacyMax.name}：${fmt(current.risk.adequacyMax.value, "", 4)}</strong>`;
  const { rows, currentOffset } = viewRecords(16, 0);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "securityChart",
    [
      { name: "线路有功越限风险", color: colors.red, values: rows.map((row) => row.risk.line) },
      { name: "频率偏移风险", color: colors.amber, values: rows.map((row) => row.risk.windDeviation) },
      { name: "节点电压越限风险", color: colors.orange, values: rows.map((row) => row.flow.summary.voltageOverNodes / 30 + row.risk.composite * 0.18) },
      { name: "系统电压越限风险", color: colors.teal, values: rows.map((row) => Math.max(0, row.flow.summary.maxLineRate - 0.78)) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "adequacyChart",
    [
      { name: "切负荷风险", color: colors.red, values: rows.map((row) => row.risk.loadShedding) },
      { name: "弃风风险", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
      { name: "综合风险", color: colors.teal, values: rows.map((row) => row.risk.composite) },
      { name: "备用不足风险", color: colors.cyan, values: rows.map((row) => row.opf.loadShedMw / Math.max(1, row.opf.totalLoadMw)) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  $("thresholdTable").innerHTML = `<table><thead><tr><th>等级</th><th>判据</th></tr></thead><tbody>${DATA.meta.riskLevels
    .map((level) => `<tr><td style="color:${level.color};font-weight:800">${level.level}</td><td>${level.range}</td></tr>`)
    .join("")}</tbody></table>`;
}

function renderWarningView() {
  const { rows, currentOffset } = viewRecords(48, 16);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "warningCurveChart",
    [
      { name: "线路越限", color: colors.red, values: rows.map((row) => row.risk.line) },
      { name: "风电偏差", color: colors.cyan, values: rows.map((row) => row.risk.windDeviation) },
      { name: "弃风风险", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
      { name: "综合风险", color: colors.teal, values: rows.map((row) => row.risk.composite) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  renderTimeline("warningTimeline", 48, 16, 4);
  const current = rec();
  $("warningScore").innerHTML = `
    <div class="risk-hero ${toneClass(current.risk.level.tone)}">
      <span>${current.label}</span>
      <strong>${current.risk.level.name}</strong>
      <span>风险评分 ${fmt(current.risk.composite * 100, " 分", 1)} · 安全评分 ${fmt(current.risk.safetyScore, " 分", 1)}</span>
    </div>
  `;
  drawGauge("accuracyGauge", DATA.accuracy[state.index], 85);
  drawBarChart(
    "monthlyAccuracyChart",
    DATA.monthlyAccuracy.map((row) => row.month.slice(5)),
    DATA.monthlyAccuracy.map((row) => row.accuracy),
    { target: 85, colors: DATA.monthlyAccuracy.map((row) => (row.accuracy >= 85 ? colors.green : colors.red)) },
  );
}

function drawGauge(id, value, target) {
  const setup = canvasContext(id);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const cx = width / 2;
  const cy = height * 0.72;
  const radius = Math.min(width * 0.36, height * 0.52);
  const start = Math.PI;
  const end = Math.PI * 2;
  const valueEnd = start + (Math.min(100, value) / 100) * Math.PI;
  const targetAngle = start + (target / 100) * Math.PI;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#e5ebe4";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();
  ctx.strokeStyle = value >= target ? colors.green : colors.orange;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, valueEnd);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.tealDark;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(targetAngle) * (radius - 16), cy + Math.sin(targetAngle) * (radius - 16));
  ctx.lineTo(cx + Math.cos(targetAngle) * (radius + 16), cy + Math.sin(targetAngle) * (radius + 16));
  ctx.stroke();
  ctx.fillStyle = colors.text;
  ctx.font = "700 34px Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${value.toFixed(1)}%`, cx, cy - 26);
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillStyle = colors.muted;
  ctx.fillText("优于指标 85%", cx, cy + 2);
}

function topLineRates(row, limit) {
  return row.flow.lineRates
    .map((rate, idx) => ({ id: idx + 1, label: `L${idx + 1}`, rate }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, limit);
}

function drawMap(id, options = {}) {
  const setup = canvasContext(id);
  if (!setup) return;
  const { canvas, ctx, width, height } = setup;
  const map = {
    left: 34,
    top: 26,
    right: width - 24,
    bottom: height - 28,
  };
  map.width = map.right - map.left;
  map.height = map.bottom - map.top;
  drawMapBase(ctx, map, width, height);
  if (state.showWeather || options.weatherOnly) drawWeatherLayer(ctx, map);
  if ((state.showTopology || id === "detailMapCanvas") && !options.weatherOnly) drawTopologyLayer(ctx, map, id);
  drawWindFarm(ctx, map);
  drawMapLabels(ctx, map);
  hitCache.set(id, makeHitZones(map));
  canvas.style.cursor = "crosshair";
  updateMapReadout();
}

function drawMapBase(ctx, map, width, height) {
  const sea = ctx.createLinearGradient(0, 0, width, height);
  sea.addColorStop(0, "#e8f5f2");
  sea.addColorStop(1, "#d8eceb");
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#e1eadc";
  ctx.beginPath();
  ctx.moveTo(map.left, map.top);
  ctx.lineTo(map.left + map.width * 0.43, map.top + map.height * 0.02);
  ctx.bezierCurveTo(map.left + map.width * 0.39, map.top + map.height * 0.2, map.left + map.width * 0.49, map.top + map.height * 0.34, map.left + map.width * 0.42, map.top + map.height * 0.49);
  ctx.bezierCurveTo(map.left + map.width * 0.33, map.top + map.height * 0.68, map.left + map.width * 0.47, map.top + map.height * 0.86, map.left + map.width * 0.36, map.bottom);
  ctx.lineTo(map.left, map.bottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#b5c7b5";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(map.left + map.width * 0.43, map.top + map.height * 0.02);
  ctx.bezierCurveTo(map.left + map.width * 0.39, map.top + map.height * 0.2, map.left + map.width * 0.49, map.top + map.height * 0.34, map.left + map.width * 0.42, map.top + map.height * 0.49);
  ctx.bezierCurveTo(map.left + map.width * 0.33, map.top + map.height * 0.68, map.left + map.width * 0.47, map.top + map.height * 0.86, map.left + map.width * 0.36, map.bottom);
  ctx.stroke();

  ctx.strokeStyle = "rgba(45, 127, 116, 0.14)";
  ctx.lineWidth = 1;
  ctx.font = "11px Microsoft YaHei, sans-serif";
  ctx.fillStyle = "rgba(31, 41, 38, 0.45)";
  for (let idx = 0; idx <= 4; idx += 1) {
    const x = map.left + (idx / 4) * map.width;
    const y = map.top + (idx / 4) * map.height;
    ctx.beginPath();
    ctx.moveTo(x, map.top);
    ctx.lineTo(x, map.bottom);
    ctx.moveTo(map.left, y);
    ctx.lineTo(map.right, y);
    ctx.stroke();
  }
}

function drawWeatherLayer(ctx, map) {
  const rows = DATA.records.slice(0, state.index + 1);
  const current = rec();
  const track = rows.map((row) => typhoonPoint(row, map));
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = 3;
  ctx.beginPath();
  track.forEach((point, idx) => {
    if (idx === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  track.forEach((point, idx) => {
    if (idx % 6 === 0 || idx === track.length - 1) {
      ctx.fillStyle = idx === track.length - 1 ? colors.red : "rgba(199, 67, 67, 0.45)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, idx === track.length - 1 ? 8 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const eye = typhoonPoint(current, map);
  const radius = 32 + current.typhoon.wind * 1.1;
  const gradient = ctx.createRadialGradient(eye.x, eye.y, 4, eye.x, eye.y, radius);
  gradient.addColorStop(0, "rgba(199, 67, 67, 0.34)");
  gradient.addColorStop(0.58, "rgba(216, 109, 39, 0.14)");
  gradient.addColorStop(1, "rgba(45, 142, 160, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(eye.x, eye.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(45, 142, 160, 0.42)";
  ctx.setLineDash([5, 7]);
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, radius * (0.58 + i * 0.25), radius * (0.36 + i * 0.16), -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = colors.red;
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.fillText("台风路径", eye.x + 12, eye.y - 12);
}

function drawTopologyLayer(ctx, map, id) {
  const current = rec();
  const positions = nodePositions(map);
  DATA.lines.forEach((line, idx) => {
    const a = positions.get(line.from);
    const b = positions.get(line.to);
    const rate = current.flow.lineRates[idx];
    ctx.strokeStyle = rate >= 1 ? colors.red : rate >= 0.85 ? colors.orange : "rgba(45, 127, 116, 0.58)";
    ctx.lineWidth = rate >= 1 ? 3.4 : rate >= 0.85 ? 2.7 : 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  DATA.nodes.forEach((node, idx) => {
    const point = positions.get(node.id);
    const voltage = current.flow.voltages[idx];
    const isSelected = state.selectedElement?.type === "node" && state.selectedElement.id === node.id;
    ctx.fillStyle = voltage < 0.95 || voltage > 1.05 ? colors.orange : node.role.includes("风电") ? colors.cyan : colors.teal;
    ctx.strokeStyle = isSelected ? colors.red : "#fff";
    ctx.lineWidth = isSelected ? 4 : 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, node.voltageClass === "500kV" ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  if (id === "detailMapCanvas") {
    ctx.fillStyle = colors.text;
    ctx.font = "10px Microsoft YaHei, sans-serif";
    DATA.nodes.forEach((node) => {
      const point = positions.get(node.id);
      ctx.fillText(String(node.id), point.x + 8, point.y - 6);
    });
  }
}

function drawWindFarm(ctx, map) {
  const farm = geoPoint(121.15, 32.35, map);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(farm.x, farm.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.green;
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.fillText("风电场群", farm.x + 12, farm.y + 4);
}

function drawMapLabels(ctx, map) {
  ctx.fillStyle = "rgba(31, 41, 38, 0.68)";
  ctx.font = "700 13px Microsoft YaHei, sans-serif";
  [
    ["南京", 0.17, 0.42],
    ["盐城", 0.36, 0.28],
    ["南通", 0.42, 0.62],
    ["连云港", 0.31, 0.1],
    ["黄海", 0.73, 0.22],
    ["东海", 0.72, 0.72],
  ].forEach(([label, x, y]) => {
    ctx.fillText(label, map.left + map.width * x, map.top + map.height * y);
  });
}

function typhoonPoint(row, map) {
  return geoPoint(row.typhoon.lon, row.typhoon.lat, map);
}

function geoPoint(lon, lat, map) {
  const lonMin = 120.2;
  const lonMax = 122.05;
  const latMin = 30.25;
  const latMax = 35.1;
  return {
    x: map.left + ((lon - lonMin) / (lonMax - lonMin)) * map.width,
    y: map.bottom - ((lat - latMin) / (latMax - latMin)) * map.height,
  };
}

function nodePositions(map) {
  const positions = new Map();
  DATA.nodes.forEach((node) => {
    positions.set(node.id, {
      x: map.left + (node.x / 100) * map.width,
      y: map.top + (node.y / 100) * map.height,
    });
  });
  return positions;
}

function makeHitZones(map) {
  const positions = nodePositions(map);
  const nodes = DATA.nodes.map((node) => ({ ...node, ...positions.get(node.id), radius: 12 }));
  const lines = DATA.lines.map((line) => ({
    ...line,
    a: positions.get(line.from),
    b: positions.get(line.to),
  }));
  return { nodes, lines };
}

function updateMapReadout() {
  const holder = $("mapReadout");
  if (!holder) return;
  const current = rec();
  if (state.selectedElement) {
    const label = state.selectedElement.type === "node" ? `Bus-${String(state.selectedElement.id).padStart(2, "0")}` : `Line-${String(state.selectedElement.id).padStart(2, "0")}`;
    holder.innerHTML = `<strong>${label}</strong><p>${current.label} · 综合风险 ${fmt(current.risk.composite, "", 4)}</p><p>点击“运行状态详情”查看元件时序数据。</p>`;
    return;
  }
  holder.innerHTML = `<strong>${current.risk.level.name}</strong><p>${current.label} · 台风中心 ${fmt(current.typhoon.wind, " m/s", 1)} · 风电功率 ${fmt(current.typhoon.windFarmPower, " MW", 1)}</p><p>线路最高负载率 ${fmt(current.flow.summary.maxLineRate * 100, "%", 1)}</p>`;
}

function bindCanvasSelection(id) {
  const canvas = $(id);
  if (!canvas) return;
  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const zones = hitCache.get(id);
    if (!zones) return;
    const node = zones.nodes.find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius);
    if (node) {
      state.selectedElement = { type: "node", id: node.id };
      if (state.view === "home") state.view = "grid";
      render();
      return;
    }
    const line = zones.lines.find((item) => pointLineDistance(x, y, item.a.x, item.a.y, item.b.x, item.b.y) < 7);
    if (line) {
      state.selectedElement = { type: "line", id: line.id };
      if (state.view === "home") state.view = "grid";
      render();
    }
  });
}

function pointLineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(px - x, py - y);
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-view]");
    if (!target) return;
    state.view = target.dataset.view;
    render();
  });
  $("timeSelect")?.addEventListener("change", (event) => {
    state.index = Number(event.target.value);
    render();
  });
  $("pathSlider")?.addEventListener("input", (event) => {
    state.index = Number(event.target.value);
    render();
  });
  $("weatherToggle")?.addEventListener("change", (event) => {
    state.showWeather = event.target.checked;
    render();
  });
  $("topologyToggle")?.addEventListener("change", (event) => {
    state.showTopology = event.target.checked;
    render();
  });
  $("nowBtn")?.addEventListener("click", () => {
    state.index = DATA.meta.defaultIndex;
    render();
  });
  $("playBtn")?.addEventListener("click", () => {
    state.playing = !state.playing;
    startOrStopPlayer();
    renderControls();
  });
  $("weatherOffsetTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-offset]");
    if (!button) return;
    state.weatherOffset = Number(button.dataset.offset);
    document.querySelectorAll("#weatherOffsetTabs button").forEach((item) => item.classList.toggle("is-active", item === button));
    renderWeatherPanel();
  });
  bindCanvasSelection("mapCanvas");
  bindCanvasSelection("detailMapCanvas");
  window.addEventListener("resize", () => render());
}

function startOrStopPlayer() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  if (!state.playing) return;
  playTimer = setInterval(() => {
    state.index = state.index >= DATA.records.length - 1 ? 0 : state.index + 1;
    render();
  }, 1200);
}

wireEvents();
render();
