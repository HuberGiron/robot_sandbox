let errorChart = null;
let positionChart = null;
let controlChart = null;

const CHART_MAX_POINTS = 1200;

function rgbaFromHex(hex, alpha = 1) {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeDataset(label, color, dash = []) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: color,
    borderWidth: 1.5,
    borderDash: dash,
    fill: false,
    tension: 0.08,
    pointRadius: 0,
    spanGaps: true
  };
}

function commonOptions(yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    parsing: false,
    normalized: true,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: true, labels: { boxWidth: 18 } },
      decimation: { enabled: true, algorithm: 'min-max' }
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Tiempo (s)' },
        grid: { display: false },
        ticks: { maxTicksLimit: 10 }
      },
      y: {
        title: { display: true, text: yTitle },
        grid: { display: false }
      }
    }
  };
}

function initCharts(robotColors) {
  const errorDatasets = [];
  const positionDatasets = [];
  const controlDatasets = [];

  robotColors.forEach((color, i) => {
    const n = i + 1;
    errorDatasets.push(makeDataset(`R${n} Error X (mm)`, color));
    errorDatasets.push(makeDataset(`R${n} Error Y (mm)`, rgbaFromHex(color, 0.72), [6, 4]));

    positionDatasets.push(makeDataset(`R${n} Posición X (mm)`, color));
    positionDatasets.push(makeDataset(`R${n} Posición Y (mm)`, rgbaFromHex(color, 0.72), [6, 4]));

    controlDatasets.push(makeDataset(`R${n} V (mm/s)`, color));
    controlDatasets.push(makeDataset(`R${n} W (rad/s)`, rgbaFromHex(color, 0.72), [6, 4]));
  });

  errorChart = new Chart(document.getElementById('errorChart'), {
    type: 'line', data: { datasets: errorDatasets }, options: commonOptions('Error')
  });

  positionChart = new Chart(document.getElementById('positionChart'), {
    type: 'line', data: { datasets: positionDatasets }, options: commonOptions('Posición (mm)')
  });

  controlChart = new Chart(document.getElementById('controlChart'), {
    type: 'line', data: { datasets: controlDatasets }, options: commonOptions('Control')
  });
}

function setChartRobotVisibility(enabled) {
  [errorChart, positionChart, controlChart].forEach(chart => {
    if (!chart) return;
    enabled.forEach((active, i) => {
      chart.data.datasets[i * 2].hidden = !active;
      chart.data.datasets[i * 2 + 1].hidden = !active;
    });
    chart.update('none');
  });
}

function trimDataset(dataset) {
  if (dataset.data.length > CHART_MAX_POINTS + 200) {
    dataset.data.splice(0, dataset.data.length - CHART_MAX_POINTS);
  }
}

function appendRobotChartPoint(robotIndex, t, sample) {
  const a = robotIndex * 2;
  const b = a + 1;
  errorChart.data.datasets[a].data.push({ x: t, y: sample.ex });
  errorChart.data.datasets[b].data.push({ x: t, y: sample.ey });
  positionChart.data.datasets[a].data.push({ x: t, y: sample.controlPoint.x });
  positionChart.data.datasets[b].data.push({ x: t, y: sample.controlPoint.y });
  controlChart.data.datasets[a].data.push({ x: t, y: sample.V });
  controlChart.data.datasets[b].data.push({ x: t, y: sample.W });
  [errorChart.data.datasets[a], errorChart.data.datasets[b], positionChart.data.datasets[a], positionChart.data.datasets[b], controlChart.data.datasets[a], controlChart.data.datasets[b]].forEach(trimDataset);
}

function updateAllCharts() {
  errorChart?.update('none');
  positionChart?.update('none');
  controlChart?.update('none');
}

function clearRobotChartData(robotIndex) {
  [errorChart, positionChart, controlChart].forEach(chart => {
    if (!chart) return;
    chart.data.datasets[robotIndex * 2].data.length = 0;
    chart.data.datasets[robotIndex * 2 + 1].data.length = 0;
  });
}

function clearAllChartData() {
  [errorChart, positionChart, controlChart].forEach(chart => {
    if (!chart) return;
    chart.data.datasets.forEach(d => d.data.length = 0);
    chart.update('none');
  });
}

window.initCharts = initCharts;
window.setChartRobotVisibility = setChartRobotVisibility;
window.appendRobotChartPoint = appendRobotChartPoint;
window.updateAllCharts = updateAllCharts;
window.clearRobotChartData = clearRobotChartData;
window.clearAllChartData = clearAllChartData;
