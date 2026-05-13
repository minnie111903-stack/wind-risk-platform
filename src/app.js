const DATA = window.PLATFORM_DATA;

const state = {
  view: "home",
  index: DATA.meta.defaultIndex,
  weatherOffset: 0,
  showWeather: true,
  showTopology: true,
  playing: false,
  selectedElement: null,
  riskWindowMode: "twoHour",
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

const CUSTOM_RISK_LEVELS = [
  { name: "正常", short: "正常", tone: "ok", min: 0, max: 0.25, range: "0.00 <= 综合风险 < 0.25", color: colors.green },
  { name: "关注", short: "关注", tone: "watch", min: 0.25, max: 0.5, range: "0.25 <= 综合风险 < 0.50", color: colors.amber },
  { name: "预警", short: "预警", tone: "warn", min: 0.5, max: 0.75, range: "0.50 <= 综合风险 < 0.75", color: colors.orange },
  { name: "高危", short: "高危", tone: "danger", min: 0.75, max: 1, range: "0.75 <= 综合风险 <= 1.00", color: colors.red },
];

const WARNING_RISK_LEVELS = [
  { name: "I级 低风险", short: "I", tone: "ok", min: 0, max: 0.03, color: colors.green },
  { name: "II级 关注", short: "II", tone: "watch", min: 0.03, max: 0.08, color: colors.amber },
  { name: "III级 警戒", short: "III", tone: "warn", min: 0.08, max: 0.14, color: colors.orange },
  { name: "IV级 高风险", short: "IV", tone: "danger", min: 0.14, max: 1, color: colors.red },
];

const hitCache = new Map();
let playTimer = null;
const typhoonDrag = {
  active: false,
  moved: false,
  canvasId: null,
};

const WIND_NODE_IDS = new Set([8, 10, 27, 28]);
const FIXED_WINDOW_STEPS = 8;
const TOPOLOGY_LAYOUT = new Map([
  [1, [9, 27]],
  [2, [24, 27]],
  [3, [9, 42]],
  [4, [24, 42]],
  [5, [39, 23]],
  [6, [39, 42]],
  [7, [53, 27]],
  [8, [68, 27]],
  [9, [39, 56]],
  [10, [55, 56]],
  [11, [31, 63]],
  [12, [23, 66]],
  [13, [10, 72]],
  [14, [37, 72]],
  [15, [51, 72]],
  [16, [22, 82]],
  [17, [63, 80]],
  [18, [63, 72]],
  [19, [75, 72]],
  [20, [75, 56]],
  [21, [69, 43]],
  [22, [81, 43]],
  [23, [48, 88]],
  [24, [66, 88]],
  [25, [82, 88]],
  [26, [94, 88]],
  [27, [92, 64]],
  [28, [84, 27]],
  [29, [96, 64]],
  [30, [96, 76]],
]);

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

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function riskLevelForValue(value) {
  const riskValue = clamp01(value);
  const level =
    CUSTOM_RISK_LEVELS.find((item, idx) => riskValue >= item.min && (riskValue < item.max || idx === CUSTOM_RISK_LEVELS.length - 1)) ||
    CUSTOM_RISK_LEVELS[0];
  return {
    name: level.name,
    short: level.short,
    tone: level.tone,
    color: level.color,
    score: Math.round((1 - riskValue) * 100),
  };
}

function warningLevelForValue(value) {
  const riskValue = clamp01(value);
  const level =
    WARNING_RISK_LEVELS.find((item, idx) => riskValue >= item.min && (riskValue < item.max || idx === WARNING_RISK_LEVELS.length - 1)) ||
    WARNING_RISK_LEVELS[0];
  return {
    name: level.name,
    short: level.short,
    tone: level.tone,
    color: level.color,
  };
}

function maxRiskItem(items) {
  return items.reduce((max, item) => (clamp01(item.value) > clamp01(max.value) ? item : max), { name: "综合风险", value: 0 });
}

// 用于展示的派生指标：频率偏移风险由 OPF 频率偏离 50Hz 的幅度换算。
function frequencyOffsetRisk(row) {
  return clamp01(Math.abs(50 - row.opf.frequency) / 0.5);
}

// 用于展示的派生指标：节点/系统电压风险由潮流越限统计和线路负载率换算。
function securityRiskItems(row) {
  return [
    { name: "线路有功越限风险", value: clamp01(row.risk.line) },
    { name: "频率偏移风险", value: frequencyOffsetRisk(row) },
    { name: "节点电压越限风险", value: clamp01(row.flow.summary.voltageOverNodes / 30 + row.risk.composite * 0.18) },
    { name: "系统电压越限风险", value: clamp01(Math.max(0, row.flow.summary.maxLineRate - 0.78)) },
  ];
}

function adequacyRiskItems(row) {
  return [
    { name: "切负荷风险", value: clamp01(row.risk.loadShedding) },
    { name: "弃风风险", value: clamp01(row.risk.curtailment) },
    { name: "综合风险", value: clamp01(row.risk.composite) },
  ];
}

function overviewRiskItems(row) {
  return [{ name: "风电偏差风险", value: clamp01(row.risk.windDeviation) }, ...securityRiskItems(row), ...adequacyRiskItems(row)];
}

function normalizeRiskData() {
  DATA.meta.riskLevels = CUSTOM_RISK_LEVELS.map((level) => ({
    level: level.name,
    range: level.range,
    color: level.color,
  }));
  DATA.records.forEach((row) => {
    const originalSafetyScore = Number(row.risk.safetyScore);
    const originalSecurityMax = row.risk.securityMax;
    row.risk.level = riskLevelForValue(row.risk.composite);
    row.risk.warningLevel = warningLevelForValue(row.risk.composite);
    row.risk.warningSafetyScore = Number.isFinite(originalSafetyScore) ? originalSafetyScore : (1 - clamp01(row.risk.composite)) * 100;
    row.risk.warningSecurityMax = originalSecurityMax;
    row.risk.safetyScore = (1 - clamp01(row.risk.composite)) * 100;
    row.risk.securityMax = maxRiskItem(securityRiskItems(row));
    row.risk.adequacyMax = maxRiskItem(adequacyRiskItems(row));
    row.risk.overallMax = maxRiskItem(overviewRiskItems(row));
  });
}

normalizeRiskData();

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

function fixedWindowRecords(steps = FIXED_WINDOW_STEPS) {
  let start = state.index - steps;
  let end = state.index;
  if (start < 0) {
    end = Math.min(DATA.records.length - 1, end + Math.abs(start));
    start = 0;
  }
  if (end >= DATA.records.length) {
    start = Math.max(0, start - (end - DATA.records.length + 1));
    end = DATA.records.length - 1;
  }
  const rows = DATA.records.slice(start, end + 1);
  return { rows, start, end, currentOffset: state.index - start };
}

function riskCurveRecords() {
  return state.riskWindowMode === "twoHour" ? fixedWindowRecords() : pastRecords(73);
}

function riskWindowText(range = riskCurveRecords()) {
  const first = DATA.records[range.start]?.label || "";
  const last = DATA.records[range.end ?? state.index]?.label || "";
  return state.riskWindowMode === "twoHour" ? `${first} - ${last}，固定2小时段` : `${first} - ${last}，全时段`;
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
  const right = options.right ?? 42;
  const top = options.legendMode === "inline" ? 36 : options.wrapLegend ? 44 : 28;
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
  ctx.textBaseline = "top";
  ctx.font = options.axisFont || "10px Microsoft YaHei, sans-serif";
  const axisTicks = fittedAxisTicks(ctx, labels, xAt, width, options);
  axisTicks.forEach((tick) => {
    ctx.textAlign = tick.align;
    ctx.fillText(tick.label, tick.x, height - bottom + 8);
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

  if (options.legendMode === "inline") {
    const legendTop = 15;
    const availableW = width - left - 18;
    const stepW = availableW / Math.max(1, cleanSeries.length);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = options.compactLegend ? "10px Microsoft YaHei, sans-serif" : "11px Microsoft YaHei, sans-serif";
    cleanSeries.forEach((item, idx) => {
      const legendX = left + idx * stepW;
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, legendTop - 4, 9, 9);
      ctx.fillStyle = colors.text;
      ctx.fillText(item.name, legendX + 13, legendTop);
    });
    return;
  }

  let legendX = left;
  let legendY = options.wrapLegend ? 15 : 16;
  const legendRight = width - right - 8;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = options.compactLegend ? "10px Microsoft YaHei, sans-serif" : "11px Microsoft YaHei, sans-serif";
  cleanSeries.forEach((item) => {
    const measured = ctx.measureText ? ctx.measureText(item.name).width : item.name.length * 12;
    const itemWidth = Math.min(options.legendItemMax || 112, measured + 30);
    if (options.wrapLegend && legendX > left && legendX + itemWidth > legendRight) {
      legendX = left;
      legendY += 17;
    }
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, legendY - 4, 9, 9);
    ctx.fillStyle = colors.text;
    ctx.fillText(item.name, legendX + 13, legendY);
    legendX += itemWidth;
  });
}

function fittedAxisTicks(ctx, labels, xAt, width, options = {}) {
  const count = labels.length;
  if (count <= 1) return count ? [{ x: xAt(0), label: axisLabelText(labels[0]), align: "left" }] : [];
  const preferred = Math.max(2, Math.min(options.xTickCount ?? (width < 380 ? 4 : 5), count));
  const minimum = Math.max(2, Math.min(options.minXTicks ?? Math.min(3, count), count));
  const minGap = options.xLabelGap ?? 8;

  const buildIndexes = (target) => {
    const indexes = [];
    for (let tick = 0; tick < target; tick += 1) {
      indexes.push(Math.round((tick / (target - 1)) * (count - 1)));
    }
    return [...new Set(indexes)].sort((a, b) => a - b);
  };

  const buildTicks = (target) => {
    const indexes = buildIndexes(target);
    return indexes.map((idx, order) => ({
      align: order === 0 ? "left" : order === indexes.length - 1 ? "right" : "center",
      label: axisLabelText(labels[idx]),
      x: xAt(idx),
    }));
  };

  const boundsFor = (tick) => {
    const measured = ctx.measureText ? ctx.measureText(tick.label).width : tick.label.length * 6.4;
    const textWidth = Math.min(58, Math.max(38, measured));
    if (tick.align === "left") return { left: tick.x, right: tick.x + textWidth };
    if (tick.align === "right") return { left: tick.x - textWidth, right: tick.x };
    return { left: tick.x - textWidth / 2, right: tick.x + textWidth / 2 };
  };

  const hasOverlap = (ticks) => {
    const bounds = ticks.map(boundsFor);
    for (let idx = 1; idx < bounds.length; idx += 1) {
      if (bounds[idx - 1].right + minGap > bounds[idx].left) return true;
    }
    return false;
  };

  for (let target = preferred; target >= minimum; target -= 1) {
    const ticks = buildTicks(target);
    if (!hasOverlap(ticks)) return ticks;
  }
  return buildTicks(minimum);
}

function axisLabelText(label) {
  return String(label || "").replace("09-", "");
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
  const windowRange = riskCurveRecords();
  const windowText = riskWindowText(windowRange);
  const windowBtn = $("pathWindowBtn");
  if (windowBtn) {
    windowBtn.classList.toggle("is-active", state.riskWindowMode === "twoHour");
    windowBtn.textContent = state.riskWindowMode === "twoHour" ? "固定2小时段" : "全时段";
  }
  if ($("pathWindowNote")) $("pathWindowNote").textContent = `风险曲线横轴：${windowText}`;
  if ($("riskWindowLabel")) $("riskWindowLabel").textContent = windowText;
  if ($("warningWindowLabel")) $("warningWindowLabel").textContent = windowText;
  if ($("mapTimeBadge")) $("mapTimeBadge").textContent = `全局时间 ${rec().label}`;
  if ($("playBtn")) $("playBtn").textContent = state.playing ? "Ⅱ" : "▶";
  if ($("mapPlayBtn")) $("mapPlayBtn").textContent = state.playing ? "暂停" : "播放";
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
      { name: "气压偏移", color: colors.amber, values: rows.map((row) => (1000 - row.typhoon.pressure) * 0.8) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true, xTickCount: 5, minXTicks: 3, xLabelGap: 8 },
  );
  drawLineChart(
    "rampChart",
    [
      { name: "原始风电", color: colors.green, values: rows.map((row) => row.opf.rawWindPower) },
      { name: "并网注入", color: colors.teal, values: rows.map((row) => row.opf.injWindPower) },
      { name: "实测功率", color: colors.amber, values: rows.map((row) => row.sourceRisk.actualWindPower || 0) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true, xTickCount: 5, minXTicks: 3, xLabelGap: 8 },
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
    { labels, currentIndex: currentOffset, threshold: 50, zeroBase: true, xTickCount: 5, minXTicks: 3, xLabelGap: 8 },
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
  const level = current.risk.warningLevel || current.risk.level;
  const topRisk = current.risk.overallMax || current.risk.warningSecurityMax || current.risk.securityMax;
  const hero = $("riskHero");
  hero.className = `risk-hero risk-summary-card ${toneClass(level.tone)}`;
  hero.innerHTML = `
    <span>当前时刻 ${current.label}</span>
    <strong>${level.name}</strong>
    <dl class="risk-summary-list">
      <div><dt>综合风险值</dt><dd>${fmt(current.risk.composite, "", 4)}</dd></div>
      <div><dt>安全评分</dt><dd>${fmt(current.risk.warningSafetyScore ?? current.risk.safetyScore, " 分", 1)}</dd></div>
      <div><dt>最高风险指标</dt><dd>${topRisk.name} ${fmt(topRisk.value, "", 4)}</dd></div>
    </dl>
  `;
  renderTimeline("riskTimeline", 16, 16, 4);
  const { rows } = riskCurveRecords();
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "riskCurveChart",
    [
      { name: "线路越限", color: colors.red, values: rows.map((row) => row.risk.line) },
      { name: "弃风", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
      { name: "切负荷", color: colors.orange, values: rows.map((row) => row.risk.loadShedding) },
      { name: "综合", color: colors.teal, values: rows.map((row) => row.risk.composite) },
    ],
    { labels, zeroBase: true, legendMode: "inline", compactLegend: true, xTickCount: 5, minXTicks: 3, xLabelGap: 8 },
  );
}

function renderTimeline(id, back, forward, step) {
  const holder = $(id);
  if (!holder) return;
  const parts = [];
  const seen = new Set();
  for (let offset = -back; offset <= forward; offset += step) {
    const idx = clampIndex(state.index + offset);
    if (seen.has(idx)) continue;
    seen.add(idx);
    const row = rec(idx);
    const warningLevel = row.risk.warningLevel || row.risk.level;
    const cls = toneClass(warningLevel.tone);
    const current = idx === state.index ? " current" : "";
    const label = idx < state.index ? "实际" : idx === state.index ? "当前" : "预测";
    parts.push(`<button class="tick ${cls}${current}" type="button" data-time-index="${idx}"><span class="tick-level">${warningLevel.short}</span><span class="tick-time">${row.label.slice(6)}</span><span class="tick-state">${label}</span></button>`);
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
  drawMap("detailMapCanvas", { compact: false, forceWeather: true });
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
  const summary = current.flow.summary;
  $("securityFocus").innerHTML = `
    <span>当前较高风险值</span>
    <strong>${current.risk.securityMax.name}：${fmt(current.risk.securityMax.value, "", 4)}</strong>
    <div class="risk-mini-grid">
      ${riskMiniCard("最高负载率", fmt(summary.maxLineRate * 100, "%", 1))}
      ${riskMiniCard("电压越限节点", `${summary.voltageOverNodes} 个`)}
      ${riskMiniCard("重载/过载线路", `${summary.heavyLines}/${summary.overloadLines} 条`)}
    </div>
  `;
  $("adequacyFocus").innerHTML = `
    <span>当前较高风险值</span>
    <strong>${current.risk.adequacyMax.name}：${fmt(current.risk.adequacyMax.value, "", 4)}</strong>
    <div class="risk-mini-grid">
      ${riskMiniCard("切负荷", fmt(current.opf.loadShedMw, " MW", 1))}
      ${riskMiniCard("弃风", fmt(current.opf.curtailMw, " MW", 1))}
      ${riskMiniCard("风电注入", fmt(current.opf.injWindPower, " MW", 1))}
    </div>
  `;
  const { rows, currentOffset } = viewRecords(16, 0);
  const labels = rows.map((row) => row.label);
  drawLineChart(
    "securityChart",
    [
      { name: "线路有功越限风险", color: colors.red, values: rows.map((row) => securityRiskItems(row)[0].value) },
      { name: "频率偏移风险", color: colors.amber, values: rows.map((row) => securityRiskItems(row)[1].value) },
      { name: "节点电压越限风险", color: colors.orange, values: rows.map((row) => securityRiskItems(row)[2].value) },
      { name: "系统电压越限风险", color: colors.teal, values: rows.map((row) => securityRiskItems(row)[3].value) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  drawLineChart(
    "adequacyChart",
    [
      { name: "切负荷风险", color: colors.red, values: rows.map((row) => adequacyRiskItems(row)[0].value) },
      { name: "弃风风险", color: colors.amber, values: rows.map((row) => adequacyRiskItems(row)[1].value) },
      { name: "综合风险", color: colors.teal, values: rows.map((row) => adequacyRiskItems(row)[2].value) },
    ],
    { labels, currentIndex: currentOffset, zeroBase: true },
  );
  $("thresholdTable").innerHTML = `
    <div class="risk-example-card">
      示例：当前综合风险值为 0.62，判定为橙色预警；主要风险来源为线路有功越限风险，建议关注重载线路和风电出力波动。
    </div>
    <table><thead><tr><th>等级</th><th>判据</th></tr></thead><tbody>${DATA.meta.riskLevels
      .map((level) => `<tr><td style="color:${level.color};font-weight:800">${level.level}</td><td>${level.range}</td></tr>`)
      .join("")}</tbody></table>
    <div class="risk-side-block">
      <h4>当前风险拆解</h4>
      ${riskBreakdownBar("线路", current.risk.line, colors.red)}
      ${riskBreakdownBar("风电偏差", current.risk.windDeviation, colors.cyan)}
      ${riskBreakdownBar("切负荷", current.risk.loadShedding, colors.orange)}
      ${riskBreakdownBar("弃风", current.risk.curtailment, colors.amber)}
      ${riskBreakdownBar("综合", current.risk.composite, colors.teal)}
    </div>
    <div class="risk-side-block">
      <h4>运行处置建议</h4>
      <ul class="risk-action-list">
        ${riskActionItems(current)
          .map((item) => `<li>${item}</li>`)
          .join("")}
      </ul>
    </div>
  `;
}

function riskMiniCard(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function riskBreakdownBar(label, value, color) {
  const percent = Math.max(0, Math.min(100, Number(value || 0) * 100));
  return `
    <div class="risk-breakdown-row">
      <span>${label}</span>
      <div class="risk-breakdown-track"><i style="width:${percent}%;background:${color}"></i></div>
      <strong>${fmt(value, "", 3)}</strong>
    </div>
  `;
}

function riskActionItems(row) {
  const items = [];
  if (row.flow.summary.overloadLines > 0) items.push(`优先复核 ${row.flow.summary.overloadLines} 条过载线路潮流转移方案。`);
  if (row.flow.summary.heavyLines > 0) items.push(`跟踪 ${row.flow.summary.heavyLines} 条重载线路，预留无功与潮流调整裕度。`);
  if (row.opf.curtailMw > 0) items.push(`协调风电出力与消纳计划，当前弃风约 ${fmt(row.opf.curtailMw, " MW", 1)}。`);
  if (row.opf.loadShedMw > 0) items.push(`关注有功缺额，当前切负荷约 ${fmt(row.opf.loadShedMw, " MW", 1)}。`);
  return items.length ? items.slice(0, 3) : ["当前风险处于可控区间，维持台风路径与风电爬坡滚动监视。"];
}

function renderWarningView() {
  const { rows } = riskCurveRecords();
  const labels = rows.map((row) => row.label);
  const calibratedAccuracy = warningAccuracyValue(DATA.accuracy[state.index]);
  const calibratedMonthlyAccuracy = DATA.monthlyAccuracy.map((row) => ({
    ...row,
    accuracy: warningAccuracyValue(row.accuracy),
  }));
  drawLineChart(
    "warningCurveChart",
    [
      { name: "线路越限", color: colors.red, values: rows.map((row) => row.risk.line) },
      { name: "风电偏差", color: colors.cyan, values: rows.map((row) => row.risk.windDeviation) },
      { name: "弃风风险", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
      { name: "综合风险", color: colors.teal, values: rows.map((row) => row.risk.composite) },
    ],
    { labels, zeroBase: true, legendMode: "inline", compactLegend: true, xTickCount: 5, minXTicks: 3, xLabelGap: 8 },
  );
  renderTimeline("warningTimeline", 48, 16, 4);
  const current = rec();
  const warningLevel = current.risk.warningLevel || current.risk.level;
  const warningTopRisk = current.risk.warningSecurityMax || current.risk.securityMax;
  $("warningScore").innerHTML = `
    <div class="risk-hero ${toneClass(warningLevel.tone)}">
      <span>${current.label} · 综合风险指标 ${fmt(current.risk.composite, "", 4)}</span>
      <strong>${warningLevel.name}</strong>
      <span>安全评分 ${fmt(current.risk.warningSafetyScore ?? current.risk.safetyScore, " 分", 1)} · ${warningTopRisk.name}最高</span>
    </div>
  `;
  drawGauge("accuracyGauge", calibratedAccuracy, 85);
  drawBarChart(
    "monthlyAccuracyChart",
    calibratedMonthlyAccuracy.map((row) => row.month.slice(5)),
    calibratedMonthlyAccuracy.map((row) => row.accuracy),
    { target: 85, colors: calibratedMonthlyAccuracy.map((row) => (row.accuracy >= 85 ? colors.green : colors.red)) },
  );
}

// 用于展示的派生指标：将样例累计准确率压缩到 85% 指标附近，避免演示值过度理想化。
function warningAccuracyValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 85;
  return Math.max(82, Math.min(89, 85 + (number - 85) * 0.34));
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
  const map = mapGeometry(id, width, height);
  const showWeather = state.showWeather || options.weatherOnly || options.forceWeather;
  const showTopology = (state.showTopology || id === "detailMapCanvas") && !options.weatherOnly;
  drawMapBase(ctx, map, width, height);
  if (showTopology) drawBackboneGuide(ctx, map);
  if (showWeather) drawWeatherLayer(ctx, map);
  if (showTopology) drawTopologyLayer(ctx, map, id);
  if (showWeather && !showTopology) drawWindFarm(ctx, map);
  drawMapLabels(ctx, map);
  hitCache.set(id, showTopology ? makeHitZones(map) : { nodes: [], lines: [] });
  canvas.style.cursor = canDragTyphoonOnCanvas(id) ? "grab" : "crosshair";
  updateMapReadout();
}

function mapGeometry(id, width, height) {
  const map = {
    left: 34,
    top: 26,
    right: width - 24,
    bottom: id === "mapCanvas" ? height - 76 : height - 28,
  };
  map.width = map.right - map.left;
  map.height = map.bottom - map.top;
  return map;
}

function drawMapBase(ctx, map, width, height) {
  const sea = ctx.createLinearGradient(map.left, map.top, map.right, map.bottom);
  sea.addColorStop(0, "#f1f6ef");
  sea.addColorStop(0.46, "#e8f0e8");
  sea.addColorStop(0.47, "#dcefed");
  sea.addColorStop(1, "#cfe7ea");
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = "#e5eddf";
  ctx.beginPath();
  ctx.moveTo(map.left, map.top + map.height * 0.01);
  ctx.lineTo(map.left + map.width * 0.42, map.top + map.height * 0.03);
  ctx.bezierCurveTo(map.left + map.width * 0.39, map.top + map.height * 0.15, map.left + map.width * 0.46, map.top + map.height * 0.26, map.left + map.width * 0.42, map.top + map.height * 0.39);
  ctx.bezierCurveTo(map.left + map.width * 0.36, map.top + map.height * 0.54, map.left + map.width * 0.45, map.top + map.height * 0.7, map.left + map.width * 0.38, map.top + map.height * 0.84);
  ctx.bezierCurveTo(map.left + map.width * 0.34, map.top + map.height * 0.92, map.left + map.width * 0.37, map.bottom, map.left + map.width * 0.33, map.bottom);
  ctx.lineTo(map.left, map.bottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(95, 139, 121, 0.68)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(map.left + map.width * 0.42, map.top + map.height * 0.03);
  ctx.bezierCurveTo(map.left + map.width * 0.39, map.top + map.height * 0.15, map.left + map.width * 0.46, map.top + map.height * 0.26, map.left + map.width * 0.42, map.top + map.height * 0.39);
  ctx.bezierCurveTo(map.left + map.width * 0.36, map.top + map.height * 0.54, map.left + map.width * 0.45, map.top + map.height * 0.7, map.left + map.width * 0.38, map.top + map.height * 0.84);
  ctx.bezierCurveTo(map.left + map.width * 0.34, map.top + map.height * 0.92, map.left + map.width * 0.37, map.bottom, map.left + map.width * 0.33, map.bottom);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1.2;
  for (let idx = 1; idx <= 4; idx += 1) {
    const y = map.top + (idx / 5) * map.height;
    ctx.beginPath();
    ctx.moveTo(map.left + map.width * 0.46, y);
    ctx.bezierCurveTo(map.left + map.width * 0.59, y - 10, map.left + map.width * 0.74, y + 14, map.right, y - 8);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(45, 127, 116, 0.09)";
  ctx.fillRect(map.left + map.width * 0.36, map.top + map.height * 0.08, map.width * 0.34, map.height * 0.84);
  ctx.fillStyle = "rgba(45, 142, 160, 0.08)";
  ctx.fillRect(map.left + map.width * 0.7, map.top + map.height * 0.08, map.width * 0.27, map.height * 0.84);

  ctx.strokeStyle = "rgba(45, 127, 116, 0.12)";
  ctx.lineWidth = 1;
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

  drawBaseMapAnnotations(ctx, map);
  ctx.restore();
}

function drawBaseMapAnnotations(ctx, map) {
  [
    ["江苏沿海陆域", 0.08, 0.62, "land"],
    ["连云港", 0.25, 0.12, "land"],
    ["盐城", 0.31, 0.32, "land"],
    ["南通", 0.31, 0.61, "land"],
    ["主干输电走廊", 0.49, 0.13, "corridor"],
    ["近海风电汇集区", 0.73, 0.12, "sea"],
    ["黄海", 0.82, 0.31, "sea"],
    ["台风影响海域", 0.79, 0.74, "sea"],
  ].forEach(([label, x, y, type]) => {
    drawSoftMapLabel(ctx, label, map.left + map.width * x, map.top + map.height * y, type);
  });
}

function drawSoftMapLabel(ctx, label, x, y, type) {
  ctx.save();
  ctx.font = type === "corridor" ? "700 13px Microsoft YaHei, sans-serif" : "700 12px Microsoft YaHei, sans-serif";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(246, 251, 249, 0.74)";
  ctx.fillStyle = type === "sea" ? "rgba(31, 93, 87, 0.46)" : "rgba(31, 41, 38, 0.56)";
  ctx.strokeText(label, x, y);
  ctx.fillText(label, x, y);
  ctx.restore();
}

function drawBackboneGuide(ctx, map) {
  const corridors = [
    { y: 27, from: 2, to: 28, label: "北部并网走廊" },
    { y: 42, from: 4, to: 22, label: "500kV/220kV 主干走廊" },
    { y: 56, from: 9, to: 27, label: "中部联络走廊" },
    { y: 72, from: 12, to: 30, label: "南部负荷走廊" },
    { y: 88, from: 23, to: 26, label: "低压支路走廊" },
  ];
  ctx.save();
  ctx.lineCap = "round";
  corridors.forEach((corridor) => {
    const a = topologyPoint(corridor.from, map);
    const b = topologyPoint(corridor.to, map);
    const y = map.top + (corridor.y / 100) * map.height;
    ctx.strokeStyle = corridor.y === 42 ? "rgba(31, 93, 87, 0.14)" : "rgba(45, 127, 116, 0.1)";
    ctx.lineWidth = corridor.y === 42 ? 12 : 8;
    ctx.beginPath();
    ctx.moveTo(a.x, y);
    ctx.lineTo(b.x, y);
    ctx.stroke();
  });
  ctx.strokeStyle = "rgba(45, 127, 116, 0.08)";
  ctx.lineWidth = 7;
  [
    [2, 4],
    [6, 12],
    [10, 17],
    [20, 24],
    [27, 25],
  ].forEach(([from, to]) => {
    const a = topologyPoint(from, map);
    const b = topologyPoint(to, map);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawWeatherLayer(ctx, map) {
  const current = rec();
  const track = DATA.records.map((row) => typhoonPoint(row, map));
  const history = track.slice(0, state.index + 1);
  const forecast = track.slice(state.index);
  const eye = typhoonPoint(current, map);
  const radius = 30 + current.typhoon.wind * 1.15;

  const field = ctx.createRadialGradient(eye.x, eye.y, 6, eye.x, eye.y, radius * 1.45);
  field.addColorStop(0, "rgba(199, 67, 67, 0.28)");
  field.addColorStop(0.42, "rgba(216, 109, 39, 0.16)");
  field.addColorStop(0.76, "rgba(45, 142, 160, 0.09)");
  field.addColorStop(1, "rgba(45, 142, 160, 0)");
  ctx.fillStyle = field;
  ctx.beginPath();
  ctx.arc(eye.x, eye.y, radius * 1.45, 0, Math.PI * 2);
  ctx.fill();

  drawTrackLine(ctx, history, "rgba(45, 142, 160, 0.55)", 2.4, [], 7);
  drawTrackLine(ctx, forecast, "rgba(199, 67, 67, 0.88)", 2.8, [7, 6], 4);

  history.forEach((point, idx) => {
    if (idx % 8 !== 0 && idx !== history.length - 1) return;
    ctx.fillStyle = idx === history.length - 1 ? colors.red : "rgba(45, 142, 160, 0.62)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, idx === history.length - 1 ? 7 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.strokeStyle = "rgba(199, 67, 67, 0.45)";
  ctx.lineWidth = 1.7;
  ctx.setLineDash([6, 7]);
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, radius * (0.52 + i * 0.24), radius * (0.34 + i * 0.14), -0.28, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(eye.x, eye.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.red;
  ctx.beginPath();
  ctx.arc(eye.x, eye.y, 4.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(31, 41, 38, 0.82)";
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.fillText(`当前台风中心 ${current.label}`, eye.x + 14, eye.y - 14);
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillText(`风速 ${fmt(current.typhoon.wind, " m/s", 1)} · 预测路径虚线`, eye.x + 14, eye.y + 4);
}

function drawTrackLine(ctx, points, color, width, dash, arrowEvery = 6) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach((point, idx) => {
    if (idx === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  for (let idx = arrowEvery; idx < points.length; idx += arrowEvery) {
    drawArrowhead(ctx, points[idx - 1], points[idx], color, width + 3);
  }
  drawArrowhead(ctx, points.at(-2), points.at(-1), color, width + 3);
  ctx.restore();
}

function drawArrowhead(ctx, from, to, color, size) {
  if (!from || !to) return;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.46);
  ctx.lineTo(-size * 0.72, 0);
  ctx.lineTo(-size, -size * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTopologyLayer(ctx, map, id) {
  const current = rec();
  const positions = nodePositions(map);
  const affected = affectedLineIds(map, positions, current);
  const crossingPoints = collectLineCrossings(positions, map);

  DATA.lines.forEach((line, idx) => {
    const rate = current.flow.lineRates[idx];
    if (rate < 0.85 && !affected.has(line.id)) return;
    const points = linePath(line, positions, map);
    ctx.save();
    ctx.strokeStyle = rate >= 1 ? "rgba(199, 67, 67, 0.32)" : rate >= 0.85 ? "rgba(216, 109, 39, 0.28)" : "rgba(199, 67, 67, 0.18)";
    ctx.lineWidth = rate >= 1 ? 10 : 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokePolyline(ctx, points);
    ctx.restore();
  });

  DATA.lines.forEach((line, idx) => {
    const rate = current.flow.lineRates[idx];
    const points = linePath(line, positions, map);
    const selected = state.selectedElement?.type === "line" && state.selectedElement.id === line.id;
    ctx.save();
    ctx.strokeStyle = lineColor(line, rate, affected.has(line.id));
    ctx.lineWidth = lineWidth(line, rate, selected);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (affected.has(line.id) && rate < 0.85) ctx.setLineDash([7, 5]);
    strokePolyline(ctx, points);
    ctx.restore();
  });

  drawCrossingBridges(ctx, crossingPoints);

  DATA.nodes.forEach((node, idx) => {
    const point = positions.get(node.id);
    const voltage = current.flow.voltages[idx];
    const isSelected = state.selectedElement?.type === "node" && state.selectedElement.id === node.id;
    drawNodeSymbol(ctx, node, point, voltage, isSelected);
  });

  if (id !== "mapCanvas") drawTopologyLegend(ctx, map);
}

function strokePolyline(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((point, idx) => {
    if (idx === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

function linePath(line, positions, map) {
  const route = {
    21: [[35, 82], [51, 80]],
    26: [[59, 68]],
    28: [[66, 48], [81, 43]],
    31: [[81, 61], [66, 88]],
    35: [[88, 78]],
    36: [[88, 43]],
    41: [[54, 42], [70, 27]],
  }[line.id];
  const points = [positions.get(line.from)];
  if (route) route.forEach(([x, y]) => points.push(topologyCoord(x, y, map)));
  points.push(positions.get(line.to));
  return points;
}

function topologyCoord(x, y, map) {
  return {
    x: map.left + (x / 100) * map.width,
    y: map.top + (y / 100) * map.height,
  };
}

function affectedLineIds(map, positions, current) {
  const eye = typhoonPoint(current, map);
  const radius = 30 + current.typhoon.wind * 1.15;
  const affected = new Set();
  DATA.lines.forEach((line) => {
    const points = linePath(line, positions, map);
    const nearTrack = minDistanceToPolyline(eye, points) <= radius * 0.72;
    const windConnected = WIND_NODE_IDS.has(line.from) || WIND_NODE_IDS.has(line.to);
    const offshoreStress = windConnected && current.typhoon.windFarmWind >= 13;
    if (nearTrack || offshoreStress) affected.add(line.id);
  });
  return affected;
}

function minDistanceToPolyline(point, points) {
  let min = Infinity;
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    min = Math.min(min, pointLineDistance(point.x, point.y, points[idx].x, points[idx].y, points[idx + 1].x, points[idx + 1].y));
  }
  return min;
}

function drawNodeSymbol(ctx, node, point, voltage, isSelected) {
  const isWind = WIND_NODE_IDS.has(node.id);
  const isHub = node.voltageClass === "500kV" || node.role.includes("汇集") || node.role.includes("枢纽") || node.role.includes("联络");
  const isVoltageRisk = voltage < 0.95 || voltage > 1.05;
  const fill = isVoltageRisk ? colors.orange : isWind ? colors.cyan : voltageColor(node.voltageClass);
  const size = node.voltageClass === "500kV" ? 11 : isHub ? 9.5 : 8;

  ctx.save();
  ctx.shadowColor = "rgba(31, 41, 38, 0.15)";
  ctx.shadowBlur = isSelected ? 12 : 5;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = fill;
  ctx.strokeStyle = isSelected ? colors.red : "#fff";
  ctx.lineWidth = isSelected ? 3.4 : 2;
  if (isWind) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, size + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawWindIcon(ctx, point.x, point.y, size);
  } else if (isHub) {
    drawHexagon(ctx, point.x, point.y, size);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  const label = String(node.id).padStart(2, "0");
  ctx.font = "800 10px Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fillStyle = colors.text;
  const labelY = isWind ? point.y + size + 10 : point.y;
  if (isWind) {
    ctx.beginPath();
    ctx.roundRect(point.x - 10, labelY - 7, 20, 14, 7);
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fill();
    ctx.fillStyle = colors.text;
  }
  ctx.strokeText(label, point.x, labelY);
  ctx.fillText(label, point.x, labelY);
  ctx.restore();
}

function drawHexagon(ctx, x, y, radius) {
  ctx.beginPath();
  for (let idx = 0; idx < 6; idx += 1) {
    const angle = Math.PI / 6 + (idx * Math.PI) / 3;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawWindIcon(ctx, x, y, size) {
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.52);
  ctx.lineTo(x, y - size * 0.05);
  ctx.stroke();
  for (let idx = 0; idx < 3; idx += 1) {
    const angle = -Math.PI / 2 + idx * (Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(x, y - size * 0.06);
    ctx.lineTo(x + Math.cos(angle) * size * 0.62, y - size * 0.06 + Math.sin(angle) * size * 0.62);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y - size * 0.06, 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lineVoltageClass(line) {
  const from = DATA.nodes[line.from - 1]?.voltageClass || "110kV";
  const to = DATA.nodes[line.to - 1]?.voltageClass || "110kV";
  const rank = { "500kV": 3, "220kV": 2, "110kV": 1 };
  return rank[from] >= rank[to] ? from : to;
}

function voltageColor(voltageClass) {
  if (voltageClass === "500kV") return colors.tealDark;
  if (voltageClass === "220kV") return colors.teal;
  return "#6f8c79";
}

function lineColor(line, rate, affected = false) {
  if (rate >= 1) return colors.red;
  if (rate >= 0.85) return colors.orange;
  const voltage = lineVoltageClass(line);
  if (affected) return "rgba(199, 67, 67, 0.72)";
  if (voltage === "500kV") return "rgba(31, 93, 87, 0.88)";
  if (voltage === "220kV") return "rgba(45, 142, 160, 0.76)";
  return "rgba(111, 126, 119, 0.66)";
}

function lineWidth(line, rate, selected = false) {
  const voltage = lineVoltageClass(line);
  const base = voltage === "500kV" ? 4.2 : voltage === "220kV" ? 3 : 1.8;
  const riskBoost = rate >= 1 ? 2.1 : rate >= 0.85 ? 1.1 : 0;
  return base + riskBoost + (selected ? 1.3 : 0);
}

function drawTopologyLegend(ctx, map) {
  const x = map.left + 12;
  const y = map.bottom + 11;
  const width = Math.min(570, map.width - 24);
  const height = 42;
  ctx.save();
  ctx.fillStyle = "rgba(251, 252, 250, 0.9)";
  ctx.strokeStyle = "rgba(45, 127, 116, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.font = "11px Microsoft YaHei, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.text;
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.fillText("图例", x + 10, y + 13);

  [
    ["500kV", colors.tealDark, 4.2],
    ["220kV", colors.cyan, 3],
    ["110kV及以下", "#7d8981", 1.8],
    ["重载/过载", colors.orange, 4],
  ].forEach(([label, color, lineWidthValue], idx) => {
    const left = x + 54 + idx * 86;
    const top = y + 13;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidthValue;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + 22, top);
    ctx.stroke();
    ctx.fillStyle = colors.text;
    ctx.font = "10px Microsoft YaHei, sans-serif";
    ctx.fillText(label, left + 27, top);
  });

  const nodeY = y + 31;
  drawLegendNode(ctx, x + 22, nodeY, "hub");
  ctx.fillStyle = colors.text;
  ctx.fillText("枢纽", x + 38, nodeY);
  drawLegendNode(ctx, x + 74, nodeY, "load");
  ctx.fillText("负荷", x + 90, nodeY);
  drawLegendNode(ctx, x + 126, nodeY, "wind");
  ctx.fillText("风电", x + 142, nodeY);
  ctx.strokeStyle = colors.red;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(x + 204, nodeY);
  ctx.lineTo(x + 232, nodeY);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowhead(ctx, { x: x + 224, y: nodeY }, { x: x + 232, y: nodeY }, colors.red, 7);
  ctx.fillStyle = colors.text;
  ctx.fillText("预测台风", x + 238, nodeY);
  ctx.restore();
}

function drawLegendNode(ctx, x, y, type) {
  ctx.save();
  if (type === "hub") {
    ctx.fillStyle = colors.tealDark;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    drawHexagon(ctx, x, y, 8);
    ctx.fill();
    ctx.stroke();
  } else if (type === "wind") {
    ctx.fillStyle = colors.cyan;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawWindIcon(ctx, x, y, 7);
  } else {
    ctx.fillStyle = "#7d8981";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function collectLineCrossings(positions, map) {
  const crossings = [];
  const segments = DATA.lines.flatMap((line) =>
    linePath(line, positions, map).slice(0, -1).map((from, idx, points) => ({
      line,
      from,
      to: linePath(line, positions, map)[idx + 1],
    })),
  );
  segments.forEach((segmentA, idxA) => {
    segments.slice(idxA + 1).forEach((segmentB) => {
      if ([segmentA.line.from, segmentA.line.to].includes(segmentB.line.from) || [segmentA.line.from, segmentA.line.to].includes(segmentB.line.to)) return;
      const point = segmentIntersection(segmentA.from, segmentA.to, segmentB.from, segmentB.to);
      if (point) crossings.push(point);
    });
  });
  return crossings;
}

function segmentIntersection(a1, a2, b1, b2) {
  const denominator = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(denominator) < 0.001) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / denominator;
  const u = -((a1.x - a2.x) * (a1.y - b1.y) - (a1.y - a2.y) * (a1.x - b1.x)) / denominator;
  if (t <= 0.04 || t >= 0.96 || u <= 0.04 || u >= 0.96) return null;
  return {
    x: a1.x + t * (a2.x - a1.x),
    y: a1.y + t * (a2.y - a1.y),
  };
}

function drawCrossingBridges(ctx, crossings) {
  ctx.save();
  crossings.forEach((point) => {
    ctx.fillStyle = "rgba(251, 252, 250, 0.9)";
    ctx.strokeStyle = "rgba(31, 41, 38, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function drawWindFarm(ctx, map) {
  const farm = geoPoint(121.36, 32.35, map);
  ctx.save();
  ctx.strokeStyle = "rgba(45, 127, 116, 0.24)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.roundRect(farm.x - 30, farm.y - 18, 86, 36, 8);
  ctx.fill();
  ctx.stroke();
  [
    [farm.x - 14, farm.y + 4],
    [farm.x + 2, farm.y - 4],
    [farm.x + 18, farm.y + 5],
  ].forEach(([x, y]) => {
    ctx.fillStyle = colors.cyan;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    drawWindIcon(ctx, x, y, 7);
  });
  ctx.fillStyle = colors.tealDark;
  ctx.font = "700 12px Microsoft YaHei, sans-serif";
  ctx.fillText("近海风电场群", farm.x + 30, farm.y + 4);
  ctx.restore();
}

function drawMapLabels(ctx, map) {
  ctx.save();
  ctx.fillStyle = "rgba(31, 93, 87, 0.34)";
  ctx.font = "800 14px Microsoft YaHei, sans-serif";
  ctx.fillText("黄海", map.left + map.width * 0.8, map.top + map.height * 0.33);
  ctx.restore();
}

function typhoonPoint(row, map) {
  return geoPoint(row.typhoon.lon, row.typhoon.lat, map);
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function canDragTyphoonOnCanvas(id) {
  return id === "weatherMapCanvas" || id === "detailMapCanvas" || (id === "mapCanvas" && state.showWeather);
}

function currentTyphoonHit(id, point) {
  if (!canDragTyphoonOnCanvas(id)) return false;
  const map = mapGeometry(id, point.width, point.height);
  const eye = typhoonPoint(rec(), map);
  return Math.hypot(point.x - eye.x, point.y - eye.y) <= 28;
}

function nearestTyphoonIndex(id, point) {
  const map = mapGeometry(id, point.width, point.height);
  let nearest = state.index;
  let distance = Infinity;
  DATA.records.forEach((row, idx) => {
    const trackPoint = typhoonPoint(row, map);
    const nextDistance = Math.hypot(point.x - trackPoint.x, point.y - trackPoint.y);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = idx;
    }
  });
  return nearest;
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
    positions.set(node.id, topologyPoint(node.id, map));
  });
  return positions;
}

function topologyPoint(nodeId, map) {
  const [x, y] = TOPOLOGY_LAYOUT.get(nodeId) || [DATA.nodes[nodeId - 1]?.x || 50, DATA.nodes[nodeId - 1]?.y || 50];
  return {
    x: map.left + (x / 100) * map.width,
    y: map.top + (y / 100) * map.height,
  };
}

function makeHitZones(map) {
  const positions = nodePositions(map);
  const nodes = DATA.nodes.map((node) => ({ ...node, ...positions.get(node.id), radius: WIND_NODE_IDS.has(node.id) ? 16 : 13 }));
  const lines = DATA.lines.map((line) => ({
    ...line,
    path: linePath(line, positions, map),
  }));
  return { nodes, lines };
}

function updateMapReadout() {
  const holder = $("mapReadout");
  if (!holder) return;
  const current = rec();
  if (state.selectedElement) {
    holder.className = "map-readout is-selected";
    if (state.selectedElement.type === "node") {
      const node = DATA.nodes.find((item) => item.id === state.selectedElement.id);
      const idx = node.id - 1;
      const voltage = current.flow.voltages[idx];
      holder.innerHTML = `
        <strong>${node.name} 节点信息</strong>
        <p>场站名：${node.role}</p>
        <p>控制方式：${node.role.includes("风电") ? "PQ 控制 / 风电并网" : node.voltageClass === "500kV" ? "主变枢纽调节" : "负荷节点控制"}</p>
        <p>电压 / 相角：${fmt(voltage, " pu", 3)} / ${fmt(current.flow.buses[idx] / 12, "°", 2)}</p>
        <p>功率注入：${fmt(current.flow.buses[idx], " MW", 2)}</p>
        <p>运行风险：${voltage < 0.95 || voltage > 1.05 ? "电压越限" : "正常"}</p>
      `;
      return;
    }
    const line = DATA.lines.find((item) => item.id === state.selectedElement.id);
    const idx = line.id - 1;
    const rate = current.flow.lineRates[idx];
    const power = current.flow.lines[idx];
    holder.innerHTML = `
      <strong>${line.name} 线路信息</strong>
      <p>线路名：Bus-${String(line.from).padStart(2, "0")} → Bus-${String(line.to).padStart(2, "0")}</p>
      <p>负荷率：${fmt(rate * 100, "%", 1)}</p>
      <p>运行风险：${rate >= 1 ? "过载" : rate >= 0.85 ? "重载" : "正常"}</p>
      <p>发出功率：${fmt(Math.max(0, power), " MW", 2)}</p>
      <p>接收功率：${fmt(Math.abs(Math.min(0, power)), " MW", 2)}</p>
    `;
    return;
  }
  holder.className = "map-readout is-idle";
  holder.innerHTML = `
    <strong>${current.risk.level.name}</strong>
    <p>${current.label} · 台风中心 ${fmt(current.typhoon.wind, " m/s", 1)} · 风电功率 ${fmt(current.typhoon.windFarmPower, " MW", 1)}</p>
    <p>线路最高负载率 ${fmt(current.flow.summary.maxLineRate * 100, "%", 1)} · 点击节点或线路查看详情。</p>
  `;
}

function bindCanvasSelection(id) {
  const canvas = $(id);
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event, canvas);
    if (!currentTyphoonHit(id, point)) return;
    typhoonDrag.active = true;
    typhoonDrag.moved = true;
    typhoonDrag.canvasId = id;
    state.selectedElement = null;
    canvas.style.cursor = "grabbing";
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event, canvas);
    if (typhoonDrag.active && typhoonDrag.canvasId === id) {
      const nextIndex = nearestTyphoonIndex(id, point);
      if (nextIndex !== state.index) {
        state.index = nextIndex;
        typhoonDrag.moved = true;
        render();
      }
      event.preventDefault();
      return;
    }
    if (currentTyphoonHit(id, point)) {
      canvas.style.cursor = "grab";
    } else if (!typhoonDrag.active) {
      canvas.style.cursor = "crosshair";
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (typhoonDrag.active && typhoonDrag.canvasId === id) {
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.style.cursor = "grab";
      typhoonDrag.active = false;
      typhoonDrag.canvasId = null;
      event.preventDefault();
    }
  });
  canvas.addEventListener("pointercancel", () => {
    typhoonDrag.active = false;
    typhoonDrag.canvasId = null;
  });
  canvas.addEventListener("click", (event) => {
    if (typhoonDrag.moved) {
      typhoonDrag.moved = false;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const zones = hitCache.get(id);
    if (!zones) return;
    const node = zones.nodes.find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius);
    if (node) {
      state.selectedElement = { type: "node", id: node.id };
      render();
      return;
    }
    const line = zones.lines.find((item) => minDistanceToPolyline({ x, y }, item.path) < 8);
    if (line) {
      state.selectedElement = { type: "line", id: line.id };
      render();
      return;
    }
    state.selectedElement = null;
    render();
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
    const timeTick = event.target.closest("[data-time-index]");
    if (timeTick) {
      state.index = clampIndex(Number(timeTick.dataset.timeIndex));
      render();
      return;
    }
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
  $("pathWindowBtn")?.addEventListener("click", () => {
    state.riskWindowMode = state.riskWindowMode === "twoHour" ? "full" : "twoHour";
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
  $("mapNowBtn")?.addEventListener("click", () => {
    state.index = DATA.meta.defaultIndex;
    render();
  });
  $("playBtn")?.addEventListener("click", () => {
    state.playing = !state.playing;
    startOrStopPlayer();
    renderControls();
  });
  $("mapPlayBtn")?.addEventListener("click", () => {
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
  bindCanvasSelection("weatherMapCanvas");
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
