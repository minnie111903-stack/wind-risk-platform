(() => {
  const fixedSteps = 8;
  const windNodeIds = new Set([8, 10, 27, 28]);
  const layout = new Map([
    [1, [8, 45]], [2, [18, 45]], [3, [8, 62]], [4, [18, 62]], [5, [30, 36]],
    [6, [30, 52]], [7, [42, 36]], [8, [42, 52]], [9, [42, 66]], [10, [54, 66]],
    [11, [42, 80]], [12, [30, 75]], [13, [18, 83]], [14, [42, 75]], [15, [54, 75]],
    [16, [30, 88]], [17, [54, 88]], [18, [66, 75]], [19, [78, 75]], [20, [78, 66]],
    [21, [66, 56]], [22, [78, 56]], [23, [66, 88]], [24, [78, 88]], [25, [88, 88]],
    [26, [96, 88]], [27, [88, 66]], [28, [54, 52]], [29, [96, 66]], [30, [96, 75]],
  ]);

  if (typeof state === "undefined" || typeof DATA === "undefined") return;
  state.riskWindowMode = state.riskWindowMode || "twoHour";

  const fixedWindow = () => {
    let start = state.index - fixedSteps;
    let end = state.index;
    if (start < 0) {
      end = Math.min(DATA.records.length - 1, end + Math.abs(start));
      start = 0;
    }
    if (end >= DATA.records.length) {
      start = Math.max(0, start - (end - DATA.records.length + 1));
      end = DATA.records.length - 1;
    }
    return { rows: DATA.records.slice(start, end + 1), start, end, currentOffset: state.index - start };
  };

  const fullWindow = () => {
    const start = Math.max(0, state.index - 73);
    return { rows: DATA.records.slice(start, state.index + 1), start, end: state.index, currentOffset: state.index - start };
  };

  const riskWindow = () => (state.riskWindowMode === "twoHour" ? fixedWindow() : fullWindow());
  const riskWindowText = (range = riskWindow()) => {
    const first = DATA.records[range.start]?.label || "";
    const last = DATA.records[range.end]?.label || "";
    return state.riskWindowMode === "twoHour" ? `${first} - ${last}，固定2小时段` : `${first} - ${last}，全时段`;
  };

  const ensureControls = () => {
    const strip = $("pathSlider")?.closest(".path-strip");
    if (strip && !$("pathWindowBtn")) {
      const button = document.createElement("button");
      button.id = "pathWindowBtn";
      button.type = "button";
      button.className = "path-mode-button";
      strip.appendChild(button);
      button.addEventListener("click", () => {
        state.riskWindowMode = state.riskWindowMode === "twoHour" ? "full" : "twoHour";
        render();
      });
    }
    const mapPanel = strip?.closest(".map-panel");
    if (mapPanel && !$("pathWindowNote")) {
      const note = document.createElement("div");
      note.id = "pathWindowNote";
      note.className = "path-window-note";
      strip.insertAdjacentElement("afterend", note);
    }
    const riskTitle = $("riskCurveChart")?.previousElementSibling;
    if (riskTitle && !$("riskWindowLabel")) {
      const span = document.createElement("span");
      span.id = "riskWindowLabel";
      riskTitle.appendChild(span);
    }
    const warningTitle = $("warningCurveChart")?.closest(".surface")?.querySelector("h2");
    if (warningTitle && !$("warningWindowLabel")) {
      const span = document.createElement("span");
      span.id = "warningWindowLabel";
      warningTitle.appendChild(span);
    }
    document.querySelectorAll(".action-grid button").forEach((button) => {
      if (button.textContent.includes("85%")) button.remove();
    });
  };

  const originalRenderControls = renderControls;
  renderControls = function patchedRenderControls() {
    originalRenderControls();
    ensureControls();
    const range = riskWindow();
    const text = riskWindowText(range);
    const button = $("pathWindowBtn");
    if (button) {
      button.classList.toggle("is-active", state.riskWindowMode === "twoHour");
      button.textContent = state.riskWindowMode === "twoHour" ? "固定2小时段" : "全时段";
    }
    if ($("pathWindowNote")) $("pathWindowNote").textContent = `风险曲线横轴：${text}`;
    if ($("riskWindowLabel")) $("riskWindowLabel").textContent = text;
    if ($("warningWindowLabel")) $("warningWindowLabel").textContent = text;
  };

  renderRiskPanel = function patchedRenderRiskPanel() {
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
    const { rows } = riskWindow();
    const labels = rows.map((row) => row.label);
    drawLineChart(
      "riskCurveChart",
      [
        { name: "线路越限", color: colors.red, values: rows.map((row) => row.risk.line) },
        { name: "弃风", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
        { name: "切负荷", color: colors.orange, values: rows.map((row) => row.risk.loadShedding) },
        { name: "综合", color: colors.teal, values: rows.map((row) => row.risk.composite) },
      ],
      { labels, zeroBase: true },
    );
  };

  renderWarningView = function patchedRenderWarningView() {
    const { rows } = riskWindow();
    const labels = rows.map((row) => row.label);
    drawLineChart(
      "warningCurveChart",
      [
        { name: "线路越限", color: colors.red, values: rows.map((row) => row.risk.line) },
        { name: "风电偏差", color: colors.cyan, values: rows.map((row) => row.risk.windDeviation) },
        { name: "弃风风险", color: colors.amber, values: rows.map((row) => row.risk.curtailment) },
        { name: "综合风险", color: colors.teal, values: rows.map((row) => row.risk.composite) },
      ],
      { labels, zeroBase: true },
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
  };

  const topoPoint = (nodeId, map) => {
    const source = layout.get(nodeId) || [DATA.nodes[nodeId - 1]?.x || 50, DATA.nodes[nodeId - 1]?.y || 50];
    return { x: map.left + (source[0] / 100) * map.width, y: map.top + (source[1] / 100) * map.height };
  };

  nodePositions = function patchedNodePositions(map) {
    const positions = new Map();
    DATA.nodes.forEach((node) => positions.set(node.id, topoPoint(node.id, map)));
    return positions;
  };

  const voltageColor = (voltageClass) => (voltageClass === "500kV" ? colors.tealDark : voltageClass === "220kV" ? colors.teal : "#6f8c79");
  const lineVoltage = (line) => {
    const rank = { "500kV": 3, "220kV": 2, "110kV": 1 };
    const from = DATA.nodes[line.from - 1]?.voltageClass || "110kV";
    const to = DATA.nodes[line.to - 1]?.voltageClass || "110kV";
    return rank[from] >= rank[to] ? from : to;
  };
  const lineColor = (line, rate) => {
    if (rate >= 1) return colors.red;
    if (rate >= 0.85) return colors.orange;
    const voltage = lineVoltage(line);
    if (voltage === "500kV") return "rgba(31, 93, 87, 0.72)";
    if (voltage === "220kV") return "rgba(45, 127, 116, 0.62)";
    return "rgba(111, 140, 121, 0.58)";
  };

  const segmentIntersection = (a1, a2, b1, b2) => {
    const denominator = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
    if (Math.abs(denominator) < 0.001) return null;
    const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / denominator;
    const u = -((a1.x - a2.x) * (a1.y - b1.y) - (a1.y - a2.y) * (a1.x - b1.x)) / denominator;
    if (t <= 0.04 || t >= 0.96 || u <= 0.04 || u >= 0.96) return null;
    return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
  };

  const collectCrossings = (positions) => {
    const crossings = [];
    DATA.lines.forEach((lineA, idxA) => {
      const a1 = positions.get(lineA.from);
      const a2 = positions.get(lineA.to);
      DATA.lines.slice(idxA + 1).forEach((lineB) => {
        if ([lineA.from, lineA.to].includes(lineB.from) || [lineA.from, lineA.to].includes(lineB.to)) return;
        const point = segmentIntersection(a1, a2, positions.get(lineB.from), positions.get(lineB.to));
        if (point) crossings.push(point);
      });
    });
    return crossings;
  };

  const drawBackbone = (ctx, map) => {
    ctx.save();
    ctx.lineCap = "round";
    [
      { y: 36, from: 5, to: 7 },
      { y: 52, from: 6, to: 28 },
      { y: 66, from: 9, to: 29 },
      { y: 75, from: 12, to: 25 },
      { y: 88, from: 16, to: 26 },
    ].forEach((corridor) => {
      const a = topoPoint(corridor.from, map);
      const b = topoPoint(corridor.to, map);
      const y = map.top + (corridor.y / 100) * map.height;
      ctx.strokeStyle = "rgba(45, 127, 116, 0.12)";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(a.x, y);
      ctx.lineTo(b.x, y);
      ctx.stroke();
    });
    ctx.strokeStyle = "rgba(45, 127, 116, 0.1)";
    ctx.lineWidth = 7;
    [[2, 4], [6, 12], [10, 17], [20, 24], [27, 25]].forEach(([from, to]) => {
      const a = topoPoint(from, map);
      const b = topoPoint(to, map);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.restore();
  };

  drawWeatherLayer = function patchedDrawWeatherLayer(ctx, map) {
    const rows = DATA.records.slice(0, state.index + 1);
    const current = rec();
    const track = rows.map((row) => typhoonPoint(row, map));
    const activeStart = state.riskWindowMode === "twoHour" ? Math.max(0, track.length - fixedSteps - 1) : 0;
    if (activeStart > 0) {
      ctx.strokeStyle = "rgba(199, 67, 67, 0.24)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      track.slice(0, activeStart + 1).forEach((point, idx) => (idx === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.stroke();
    }
    ctx.strokeStyle = colors.red;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    track.slice(activeStart).forEach((point, idx) => (idx === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
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
    if (state.riskWindowMode === "twoHour") {
      ctx.font = "12px Microsoft YaHei, sans-serif";
      ctx.fillText("固定2小时段", eye.x + 12, eye.y + 6);
    }
  };

  drawTopologyLayer = function patchedDrawTopologyLayer(ctx, map, id) {
    const current = rec();
    const positions = nodePositions(map);
    DATA.lines.forEach((line, idx) => {
      const a = positions.get(line.from);
      const b = positions.get(line.to);
      const rate = current.flow.lineRates[idx];
      ctx.strokeStyle = lineColor(line, rate);
      ctx.lineWidth = rate >= 1 ? 3.6 : rate >= 0.85 ? 3 : lineVoltage(line) === "500kV" ? 2.3 : 1.7;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    collectCrossings(positions).forEach((point) => {
      ctx.fillStyle = "rgba(251, 252, 250, 0.9)";
      ctx.strokeStyle = "rgba(31, 41, 38, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    DATA.nodes.forEach((node, idx) => {
      const point = positions.get(node.id);
      const voltage = current.flow.voltages[idx];
      const isSelected = state.selectedElement?.type === "node" && state.selectedElement.id === node.id;
      ctx.fillStyle = voltage < 0.95 || voltage > 1.05 ? colors.orange : windNodeIds.has(node.id) ? colors.cyan : voltageColor(node.voltageClass);
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
    const legend = [["500kV", colors.tealDark], ["220kV", colors.teal], ["110kV", "#6f8c79"], ["重/过载", colors.orange]];
    ctx.font = "11px Microsoft YaHei, sans-serif";
    legend.forEach(([label, color], idx) => {
      const x = map.left + 12 + idx * 70;
      const y = map.bottom - 18;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20, y);
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.fillText(label, x + 25, y + 3);
    });
  };

  drawMap = function patchedDrawMap(id, options = {}) {
    const setup = canvasContext(id);
    if (!setup) return;
    const { canvas, ctx, width, height } = setup;
    const map = { left: 34, top: 26, right: width - 24, bottom: height - 28 };
    map.width = map.right - map.left;
    map.height = map.bottom - map.top;
    drawMapBase(ctx, map, width, height);
    if ((state.showTopology || id === "detailMapCanvas") && !options.weatherOnly) drawBackbone(ctx, map);
    if (state.showWeather || options.weatherOnly) drawWeatherLayer(ctx, map);
    if ((state.showTopology || id === "detailMapCanvas") && !options.weatherOnly) drawTopologyLayer(ctx, map, id);
    drawWindFarm(ctx, map);
    drawMapLabels(ctx, map);
    hitCache.set(id, makeHitZones(map));
    canvas.style.cursor = "crosshair";
    updateMapReadout();
  };

  ensureControls();
  render();
})();
